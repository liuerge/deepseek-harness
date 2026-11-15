/** Meeting orchestration: one root Session per meeting, one spawn subagent per role round. */
import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Deployment-tunable meeting defaults. */
export const Config = z.object({
  /** Registered subagent provider used for every role round. */
  provider: z.string().min(1).default('spawn'),
  /** Route for the meeting root Session and its role children. */
  agentOptions: z.object({ provider: z.string().min(1), model: z.string().min(1) }).optional(),
}).prefault({})
/** Validated meeting defaults after schema defaults. */
export type Config = z.infer<typeof Config>

/** One role taking part in a meeting round. */
export interface MeetingRole {
  /** Display name of the role, such as `产品经理`. */
  readonly name: string
  /** Role brief delivered as the child's only task text. */
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

/** The task text a role receives: the shared goal, its own brief, and nothing from other roles. */
function rolePrompt(request: MeetingStartRequest, role: MeetingRole): string {
  return `会议目标：${request.requirement}\n\n角色：${role.name}\n${role.brief}`
}

/**
 * Orchestrates independent first rounds under one meeting root Session.
 *
 * Each role runs through the configured spawn provider, so its child Session
 * starts empty and receives only {@link rolePrompt}. Isolation therefore holds
 * by construction: no sibling draft reaches another role's first request.
 */
/** Model-supplied meeting request; validated at the tool boundary. */
const meetingRequest = z.object({
  requirement: z.string().min(1),
  roles: z.array(z.object({ name: z.string().min(1), brief: z.string().min(1) })).min(1),
})

export default class MeetingRoom extends Service {
  static inject = ['agents', 'subagents', 'tools']
  static Config = Config

  /** @param ctx - Owning plugin context. @param config - Validated meeting defaults. */
  constructor(ctx: Context, private readonly config: Config = Config.parse({})) {
    super(ctx, 'meetingRoom')
    this.ctx.tools.register(defineTool({
      name: 'meeting_start',
      description: 'Run one meeting round. Each role answers independently in its own child session and never sees another role prompt or draft.',
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
              brief: { type: 'string', required: true, description: 'Role brief delivered as the child only task text.' },
            },
          },
        },
      },
      output: {
        schema: { type: 'string' as const },
        render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
      },
      execute: async (args, exec) => {
        const result = await this.startMeeting(meetingRequest.parse(args), exec.signal)
        return result.rounds.map(round => `${round.role}:\n${round.output}`).join('\n\n')
      },
    }))
    this.ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name !== 'meeting_start') return next()
      return { kind: 'ask' as const, reason: 'Starting a meeting spawns one subagent per role and spends model calls.' }
    })
  }

  /**
   * Create the meeting root Session and run every role's first round.
   * @param request - Meeting goal and roles.
   * @param signal - Cancels child startup and remaining work.
   * @returns The meeting Session id and each role's output.
   */
  async startMeeting(request: MeetingStartRequest, signal: AbortSignal = new AbortController().signal): Promise<MeetingStartResult> {
    const sessionId = brandString<SessionId>(`meeting-${randomUUID()}`)
    const meeting = await this.ctx.agents.create({
      sessionId,
      ...(this.config.agentOptions === undefined ? {} : { agentOptions: this.config.agentOptions }),
    })
    const rounds: MeetingRound[] = []
    try {
      for (const role of request.roles) {
        const activation = await this.ctx.subagents.startActivation({
          provider: this.config.provider,
          label: role.name,
          parent: meeting.agent,
          prompt: [{ type: 'text', text: rolePrompt(request, role) }],
          signal,
          delivery: 'caller',
        })
        try {
          const result = await activation.result
          rounds.push({ role: role.name, sessionId: activation.childId, output: textOf(result.output) })
        } finally {
          await activation.dispose()
        }
      }
    } finally {
      await meeting.dispose()
    }
    return { sessionId, rounds }
  }
}
