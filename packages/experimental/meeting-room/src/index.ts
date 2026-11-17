/** Main-conversation meeting processes with isolated role Sessions and retained conclusions. */
import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineTool, ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { MeetingStore } from './store.ts'
import { registerProjectTools } from './project-tools.ts'
import ProjectDashboard from './dashboard.ts'
import ProjectRoster from './roster-management.ts'
import { registerRosterTools } from './roster-tools.ts'
import { registerPlanTools } from './plan-tools.ts'
import type { MeetingId, EmployeeId, Employee } from './types.ts'

/** Deployment-tunable meeting defaults. */
export const Config = z.object({
  /** Registered subagent provider used for every role round. */
  provider: z.string().min(1).default('spawn'),
  /** Model route for standalone meetings and unassigned project workers. */
  agentOptions: z.object({ provider: z.string().min(1), model: z.string().min(1) }).optional(),
  /** SQLite file holding meeting state; `:memory:` keeps it in-process. */
  databasePath: z.string().min(1).optional(),
  /** Maximum bytes per UTF-8 acceptance artifact; unknown sizes fail before reading. */
  acceptanceMaxBytes: z.number().int().positive().default(4 * 1024 * 1024),
  /** Maximum milliseconds spent discovering one employee model connection catalog. */
  modelCatalogTimeoutMs: z.number().int().positive().max(2_147_483_647).default(10_000),
}).prefault({})
/** Validated meeting defaults after schema defaults. */
export type Config = z.infer<typeof Config>

/** One role taking part in a meeting round. */
export interface MeetingRole {
  /** Saved employee whose model route, responsibilities and optional preset are captured for this meeting. */
  readonly employeeId?: EmployeeId | undefined
  /** Display name of the role, such as `产品经理`. */
  readonly name: string
  /** Role brief delivered with the shared goal and optional employee configuration. */
  readonly brief: string
}

/** A meeting start request: the shared goal plus the roles that answer independently. */
export interface MeetingStartRequest {
  /** Goal every role receives. */
  readonly requirement: string
  /** Roles that answer in the first independent round. */
  readonly roles: readonly MeetingRole[]
}

/** One role's completed first round. */
export interface MeetingRound {
  /** The role that answered. */
  readonly role: string
  /** The child Session that produced the answer. */
  readonly sessionId: SessionId
  /** Final assistant text of the round. */
  readonly output: string
}

/** Outcome of starting a meeting. */
export interface MeetingStartResult {
  /** Independent process identity used to read and conclude this meeting. */
  readonly meetingId: MeetingId
  /** Session that owns the meeting and catalogues its role children. */
  readonly sessionId: SessionId
  /** Completed rounds in request order. */
  readonly rounds: readonly MeetingRound[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Meeting orchestration service. */
    meetingRoom: MeetingRoom
  }
}

/** Concatenate the text blocks of one model output. */
function textOf(blocks: readonly ContentBlock[]): string {
  return blocks.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** Shared goal, role brief and optional employee configuration, without sibling inputs or outputs. */
function rolePrompt(request: MeetingStartRequest, role: MeetingRole, employee?: Employee): string {
  return [`会议目标：${request.requirement}\n\n角色：${role.name}\n${role.brief}`,
    ...(employee === undefined ? [] : [`Assigned employee configuration\n${JSON.stringify(employee)}`]),
  ].join('\n\n')
}

/**
 * Orchestrates independent first rounds under the main conversation or an owned standalone root.
 *
 * Each role runs through the configured spawn provider, so its child Session
 * starts empty and receives only {@link rolePrompt}. Isolation therefore holds
 * by construction: no sibling draft reaches another role's first request.
 */
/** Model-supplied meeting request; validated at the tool boundary. */
const meetingRequest = z.object({
  requirement: z.string().min(1),
  roles: z.array(z.object({ name: z.string().min(1), brief: z.string().min(1),
    employeeId: z.string().min(1).transform(id => brandString<EmployeeId>(id)).optional() })).min(1),
})

/** Owns meeting rounds, project execution tools and their checkpoint database. */
export default class MeetingRoom extends Service {
  static inject = ['agents', 'subagents', 'tools', 'workingDirectory', 'fs']
  static Config = Config

  /** @param ctx - Owning plugin context. @param config - Validated meeting defaults. */
  private readonly store: MeetingStore
  private readonly running = new Map<AbortController, Promise<void>>()
  private closing = false

  constructor(ctx: Context, private readonly config: Config = Config.parse({})) {
    super(ctx, 'meetingRoom')
    this.store = new MeetingStore(this.config.databasePath ?? ':memory:')
    const drains: (() => Promise<void>)[] = [() => this.drainMeetings()]
    ctx.effect(() => async () => {
      await Promise.all(drains.map(drain => drain()))
      this.store.close()
    })
    drains.push(registerProjectTools(ctx, this.store, config))
    registerRosterTools(ctx, this.store)
    registerPlanTools(ctx, this.store)
    ctx.plugin(ProjectDashboard, { store: this.store, acceptanceMaxBytes: config.acceptanceMaxBytes })
    ctx.plugin(ProjectRoster, { store: this.store, modelCatalogTimeoutMs: config.modelCatalogTimeoutMs })
    this.ctx.tools.register(defineTool({
      name: 'meeting_start',
      description: 'Run an independent discussion from the main conversation. Participant children appear in its existing subagent catalog. Returns meeting identity and opinions, not an approved requirement. Use meeting_record_decision to retain the main assistant conclusion and follow-up actions.',
      parameters: {
        requirement: { type: 'string', required: true, description: 'Shared goal every role receives.' },
        roles: {
          type: 'array',
          required: true,
          description: 'Roles answering the independent first round.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', required: true, description: 'Role display name.' },
              brief: { type: 'string', required: true, description: 'Role brief delivered with the shared goal and optional employee configuration.' },
              employeeId: { type: 'string', description: 'Saved employee from employee_list. Uses that employee model provider, model, responsibility and optional preset independently of the main assistant. Omit to inherit the main assistant route.' },
            },
          },
        },
      },
      output: {
        schema: { type: 'string' as const },
        render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
      },
      execute: async (args, exec) => {
        if (!exec.agent) throw new ToolContextUnavailableError('Meetings require a main conversation.')
        const request = meetingRequest.safeParse(args)
        if (!request.success) throw new ToolArgsError(['Provide a meeting goal and at least one non-empty role and brief.'])
        const result = await this.startMeeting(request.data, exec.signal, exec.agent)
        return JSON.stringify(result)
      },
    }))
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'meeting_records', description: 'Read actual discussions and retained main-assistant conclusion revisions initiated by this conversation. The last conclusion revision is current.',
      parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: (_args, exec) => {
        if (!exec.agent || this.closing) throw new ToolContextUnavailableError('Meeting records require an available conversation.')
        return Promise.resolve(JSON.stringify(this.store.meetingsForSession(exec.agent.session.id)))
      },
    })))
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'meeting_record_decision', description: 'Retain the initiating main assistant conclusion and follow-up actions after discussion. Preserves earlier conclusion revisions. This records a decision; it does not confirm a project plan or schedule work.',
      parameters: {
        meetingId: { type: 'string', required: true, description: 'Meeting identity from meeting_records or meeting_start.' },
        expectedRevision: { type: 'integer', required: true, description: 'Zero for the first conclusion, otherwise the latest conclusion revision.' },
        summary: { type: 'string', required: true, description: 'Main assistant synthesis distinguishing confirmed facts, proposals and unresolved issues.' },
        actions: { type: 'array', required: true, description: 'Follow-up actions to incorporate into the project plan separately; an empty array explicitly means none.', items: { type: 'string' } },
      }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: (args, exec) => {
        if (!exec.agent || this.closing) throw new ToolContextUnavailableError('Meeting conclusions require an available main conversation.')
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0 || args.expectedRevision >= Number.MAX_SAFE_INTEGER
          || !args.summary.trim() || args.actions.some(action => !action.trim())) throw new ToolArgsError(['Provide a current revision, summary and non-empty follow-up actions.'])
        const revision = this.store.recordMeetingDecision(exec.agent.session.id, args.meetingId, args.expectedRevision,
          args.summary.trim(), args.actions.map(action => action.trim()))
        return Promise.resolve(JSON.stringify({ meetingId: args.meetingId, revision }))
      },
    })))
    this.ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name !== 'meeting_start') return next()
      return { kind: 'ask' as const, reason: 'Starting a meeting spawns one subagent per role and spends model calls.' }
    })
  }

  private async drainMeetings(): Promise<void> {
    this.closing = true
    for (const controller of this.running.keys()) controller.abort()
    await Promise.allSettled(this.running.values())
  }

  /**
   * Run participant children under the initiating main conversation, or an owned standalone root.
   * @param request - Meeting goal and roles.
   * @param signal - Cancels child startup and remaining work.
   * @param caller - Initiating main agent; omission creates and disposes a standalone root.
   * @returns The meeting Session id and each role's output.
   */
  async startMeeting(request: MeetingStartRequest, signal: AbortSignal = new AbortController().signal,
    caller?: Agent): Promise<MeetingStartResult> {
    if (this.closing) throw new ToolContextUnavailableError('Meeting service is closing.')
    if (caller && this.ctx.subagents.rootOf(caller) !== caller) throw new HarnessError('Start the meeting from the main conversation.', 'MEETING_MAIN_REQUIRED')
    const employees = this.store.employees()
    const participants = request.roles.map((role) => {
      const employee = role.employeeId === undefined ? undefined : employees.find(item => item.id === role.employeeId)
      if (role.employeeId !== undefined && !employee) {
        throw new HarnessError('A selected meeting employee is missing. Read employee_list and select an existing employee.', 'MEETING_EMPLOYEE_MISSING')
      }
      return { role, employee }
    })
    const controller = new AbortController()
    const activeSignal = AbortSignal.any([signal, controller.signal])
    activeSignal.throwIfAborted()
    let settle!: () => void
    this.running.set(controller, new Promise<void>((resolve) => { settle = resolve }))
    const meetingId = brandString<MeetingId>(`meeting-${randomUUID()}`)
    const sessionId = caller?.session.id ?? brandString<SessionId>(meetingId)
    const rounds: MeetingRound[] = []
    let recorded = false
    try {
      this.store.recordMeeting(meetingId, request.requirement, { sessionId, originSessionId: sessionId })
      recorded = true
      const owned = caller ? undefined : await this.ctx.agents.create({ sessionId,
        ...(this.config.agentOptions === undefined ? {} : { agentOptions: this.config.agentOptions }),
      })
      const parent = caller ?? owned?.agent
      if (!parent) throw new ToolContextUnavailableError('Meeting parent is unavailable.')
      try {
        for (const { role, employee } of participants) {
          activeSignal.throwIfAborted()
          const activation = await this.ctx.subagents.startActivation({
            provider: this.config.provider, label: role.name, parent,
            prompt: [{ type: 'text', text: rolePrompt(request, role, employee) }], signal: activeSignal, delivery: 'caller',
            ...(employee === undefined ? {} : {
              agentOptions: { provider: employee.provider, model: employee.model },
              ...(employee.preset === undefined ? {} : { agentPreset: employee.preset }),
            }),
          })
          try {
            const abort = () => { void activation.dispose().catch(() => { /* Awaited in the activation finally. */ }) }
            activeSignal.addEventListener('abort', abort, { once: true })
            try {
              if (activeSignal.aborted) await activation.dispose()
              const result = await activation.result
              activeSignal.throwIfAborted()
              const output = textOf(result.output)
              rounds.push({ role: role.name, sessionId: activation.childId, output })
              this.store.recordRound(meetingId, { index: rounds.length - 1, role: role.name,
                childSessionId: activation.childId, stopReason: result.stopReason }, output)
              if (result.stopReason !== 'completed' || !output.trim()) {
                throw new HarnessError('Meeting participant did not complete a discussion output. Inspect its Session before retrying.', 'MEETING_PARTICIPANT_STOPPED')
              }
            } finally { activeSignal.removeEventListener('abort', abort) }
          } finally { await activation.dispose() }
        }
      } finally { await owned?.dispose() }
      this.store.settleMeeting(meetingId, 'awaiting-decision')
      return { meetingId, sessionId, rounds }
    } catch (error) {
      if (recorded) {
        try { this.store.settleMeeting(meetingId, activeSignal.aborted ? 'interrupted' : 'failed') }
        catch (checkpointError) {
          throw new HarnessError('Meeting stopped but its final state could not be saved. Inspect participant Sessions before retrying.', 'MEETING_STORAGE_FAILED', {
            cause: new AggregateError([error, checkpointError]),
          })
        }
      }
      throw error
    } finally {
      this.running.delete(controller)
      settle()
    }
  }
}
