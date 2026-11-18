/** Host dashboard queries over persisted project executions. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { MeetingStore } from './store.ts'
import type {
  Employee, ProjectTeam, ProjectPlan, ProjectPlanId, ProjectExecutionId, AcceptanceReport, MeetingRecord,
  ProjectTeamTaskLink,
} from './types.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { verifyAcceptanceArtifacts } from './acceptance.ts'
import { verifyPlanDocument } from './plan-document.ts'
import { executionCheckpointSchema } from './checkpoints.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Retained project execution timeline. */
    projectDashboard: ProjectDashboard
  }
}

/** Project queries and user-owned plan confirmation for the authenticated Host client. */
export default class ProjectDashboard extends TypertRemoteService {
  static inject = ['fs']
  /** @param ctx - Owning plugin scope. @param options - Shared store and bounded artifact-read policy. */
  constructor(ctx: Context, private readonly options: { store: MeetingStore; acceptanceMaxBytes: number }) {
    super(ctx, 'projectDashboard')
  }

  /**
   * Follow committed plan and checkpoint invalidations.
   * @param signal - Cancellation that releases the store subscription.
   * @returns A ready frame followed by coalesced invalidations requiring fresh plan and timeline reads.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<boolean> {
    const pending = { changed: false }
    let wake: (() => void) | undefined
    const stop = this.store.onProjectChange(() => { pending.changed = true; wake?.() })
    const abort = (): void => { wake?.() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted()
      yield true
      for (;;) {
        if (!pending.changed) await new Promise<void>((resolve) => {
          wake = resolve
          if (signal.aborted) resolve()
        })
        wake = undefined
        if (signal.aborted) break
        pending.changed = false
        yield true
      }
    } finally {
      stop()
      signal.removeEventListener('abort', abort)
    }
  }

  private get store(): MeetingStore { return this.options.store }

  /**
   * Read real meetings associated with an exact initiating conversation.
   * @param sessionId - Main conversation selected by the menu.
   * @param signal - Query cancellation.
   * @returns Discussion records and separately recorded main-assistant conclusions.
   */
  @Remote
  meetings(sessionId: string, signal: AbortSignal): Promise<MeetingRecord[]> {
    signal.throwIfAborted()
    return Promise.resolve(this.store.meetingsForSession(sessionId))
  }

  /**
   * Read reusable employees and team templates for the local Host.
   * @param signal - Query cancellation.
   * @returns Current roster with revisions.
   */
  @Remote
  roster(signal: AbortSignal): Promise<{ employees: Employee[]; teams: ProjectTeam[] }> {
    signal.throwIfAborted()
    return Promise.resolve({ employees: this.store.employees(), teams: this.store.teams() })
  }

  /**
   * Read retained plans for review with exact background and employee configurations.
   * @param signal - Query cancellation.
   * @returns Immutable plan versions and their confirmation state.
   */
  @Remote
  plans(signal: AbortSignal): Promise<ProjectPlan[]> {
    signal.throwIfAborted()
    return Promise.resolve(this.store.plans())
  }

  /**
   * Record the workspace user's confirmation of the displayed latest plan revision.
   * @param id - Plan identity displayed by the workspace.
   * @param revision - Exact reviewed content revision.
   * @param signal - Query cancellation before committing the confirmation.
   * @returns Confirmed plan; stale views fail without confirming newer content.
   */
  @Remote
  async confirmPlan(id: string, revision: number, signal: AbortSignal): Promise<ProjectPlan> {
    signal.throwIfAborted()
    const plan = this.store.currentPlan(brandString<ProjectPlanId>(id), revision)
    await verifyPlanDocument(this.ctx, plan, this.options.acceptanceMaxBytes, signal)
    signal.throwIfAborted()
    return this.store.confirmPlan(brandString<ProjectPlanId>(id), revision)
  }

  /**
   * Release the exact passing human-review node after rechecking artifact versions.
   * @param id - Execution displayed by the workspace.
   * @param checkpoint - Latest awaiting-human checkpoint reviewed by the user.
   * @param signal - Cancellation before the release is committed.
   * @returns Released execution identity; continuation requires a separate execute call.
   */
  @Remote
  async confirmAcceptance(id: string, checkpoint: number, signal: AbortSignal): Promise<{ projectId: string }> {
    signal.throwIfAborted()
    const projectId = brandString<ProjectExecutionId>(id)
    const history = this.store.execution(projectId)
    const latest = history.at(-1)
    const initial = history.find(entry => entry.state === 'started')
    if (!latest || latest.checkpoint !== checkpoint || latest.state !== 'awaiting-human' || !latest.report?.passed
      || !initial?.cwd || !initial.planId || !initial.planRevision || latest.index === undefined) {
      throw new HarnessError('Refresh the execution and review a passing node awaiting human confirmation.', 'PROJECT_EXECUTION_NOT_APPROVABLE')
    }
    const plan = this.store.currentPlan(initial.planId, initial.planRevision, true)
    await verifyPlanDocument(this.ctx, plan, this.options.acceptanceMaxBytes, signal, initial.cwd)
    if (plan.tasks[latest.index]?.review?.release !== 'human') throw new HarnessError('This node does not request human release.', 'PROJECT_EXECUTION_NOT_APPROVABLE')
    const reports = history.flatMap(entry =>
      (entry.state === 'acceptance-passed' || entry.state === 'released') && entry.report?.passed ? [entry.report] : [])
    for (const report of [...reports, latest.report]) {
      await verifyAcceptanceArtifacts(this.ctx, report, initial.cwd, this.options.acceptanceMaxBytes, signal)
    }
    signal.throwIfAborted()
    this.store.currentPlan(initial.planId, initial.planRevision, true)
    this.store.transitionExecution(projectId, checkpoint, initial.sessionId, {
      state: 'released', index: latest.index, report: latest.report,
    }, plan)
    return { projectId }
  }

  /**
   * Read persisted execution checkpoints across this Host.
   * @param signal - Query cancellation.
   * @returns Checkpoints in execution order with owning Session ids.
   */
  @Remote
  timeline(signal: AbortSignal): Promise<{
    sessionId: string
    projectId: string
    state: string
    checkpoint: number
    rework?: { attempt: number; maxAttempts: number; sourceCheckpoint?: number | undefined } | undefined
    report?: AcceptanceReport | undefined
    childSessionId?: string | undefined
    parentSessionId?: string | undefined
    goal?: string | undefined
    handoff?: string | undefined
    index?: number | undefined
    role?: string | undefined
    tasks?: { role: string; instruction: string; acceptance: string }[] | undefined
    teamLink?: 'linked' | 'disabled' | 'unavailable' | undefined
    teamTask?: { id: string; revision: number; status: ProjectTeamTaskLink['status'] } | undefined
  }[]> {
    signal.throwIfAborted()
    const links = new Map<string, Map<number, ProjectTeamTaskLink>>()
    for (const link of this.store.allTeamTasks()) {
      const byIndex = links.get(link.projectId) ?? new Map<number, ProjectTeamTaskLink>()
      byIndex.set(link.index, link)
      links.set(link.projectId, byIndex)
    }
    return Promise.resolve(this.store.projectTimeline().map((row) => {
      const parsed = executionCheckpointSchema.parse(JSON.parse(row.record))
      const link = parsed.index === undefined ? undefined : links.get(parsed.projectId)?.get(parsed.index)
      return {
        sessionId: row.sessionId, checkpoint: row.checkpoint, ...parsed,
        ...(link === undefined ? {} : { teamTask: { id: link.taskId, revision: link.revision, status: link.status } }),
      }
    }))
  }
}
