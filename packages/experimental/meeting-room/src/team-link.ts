/** Optional Team shared-task mirror for confirmed project plan tasks. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-team'
import type { TeamService, TeamTaskId, TeamTaskView } from '@deepseek-ai/dsh-agent-team'
import { brandString } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ExecutionCheckpoint } from './checkpoints.ts'
import type { MeetingStore } from './store.ts'
import type { PlanTask, ProjectExecutionId, ProjectPlan, ProjectTeamLinkState, ProjectTeamTaskId, ProjectTeamTaskLink } from './types.ts'

/** Team task text limits enforced by the service. */
const TASK_TEXT = { subject: 200, description: 16_384 } as const

/**
 * Deterministic marker placed in a Team task description so a retry can adopt a
 * task created before the association row was saved.
 * @param projectId - Admitted execution identity.
 * @param plan - Confirmed plan generation.
 * @param index - Zero-based task position.
 * @returns marker unique within the Host database.
 */
export function teamTaskMarker(projectId: ProjectExecutionId, plan: Pick<ProjectPlan, 'id' | 'revision'>, index: number): string {
  const digest = createHash('sha256').update(`${projectId}|${plan.id}|${plan.revision}|${index}`).digest('hex').slice(0, 24)
  return `[dsh-project-task:${digest}]`
}

/** Read the Team service, failing when a linked execution can no longer synchronize. */
function requireService(ctx: Context): TeamService {
  const service = ctx.get('agentTeams')
  if (!service) {
    throw new HarnessError('Team tasks are unavailable. Enable Agent Teams and the Team service before continuing.', 'PROJECT_TEAM_UNAVAILABLE')
  }
  return service
}

/** Test the live root's saved Team selection without treating an unavailable root as enabled. */
function teamEnabled(service: TeamService, root: Agent): boolean {
  try {
    return service.isEnabled(root)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'UNAUTHORIZED') return false
    throw error
  }
}

/** Read a typed Team error code without importing the service error class. */
function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

/** Project one Team task view onto the stored association. */
function association(task: TeamTaskView, link: Pick<ProjectTeamTaskLink, 'projectId' | 'index' | 'planId' | 'planRevision'>): ProjectTeamTaskLink {
  return { ...link, taskId: brandString<ProjectTeamTaskId>(task.id), revision: task.revision, status: task.status }
}

/**
 * Create or adopt one Team task per confirmed plan task before dispatch.
 * Existing tasks are recognized by {@link teamTaskMarker}; a second set is never
 * created for the same execution and plan revision.
 * @param ctx - Context that may carry the optional Team service.
 * @param store - Project association owner.
 * @param root - Live main conversation that owns the Team board.
 * @param plan - Confirmed plan with captured employees.
 * @param projectId - Admitted execution identity.
 * @param signal - Cancellation checked by each Team mutation.
 * @returns whether the run is linked, Team mode is off, or the service is absent.
 */
export async function linkProjectTeamTasks(ctx: Context, store: MeetingStore, root: Agent, plan: ProjectPlan,
  projectId: ProjectExecutionId, signal: AbortSignal): Promise<ProjectTeamLinkState> {
  const service = ctx.get('agentTeams')
  if (!service) return 'unavailable'
  if (!teamEnabled(service, root)) return 'disabled'
  for (const [index, task] of plan.tasks.entries()) {
    if (taskDescription(plan, task, index, projectId).length > TASK_TEXT.description) {
      throw new HarnessError(`Project task ${index + 1} exceeds the Team task description limit. Shorten its instruction and acceptance text, then save a new plan revision.`,
        'PROJECT_TEAM_TASK_TEXT_TOO_LONG')
    }
  }
  const known = service.listTasks(root)
  const ids: TeamTaskId[] = []
  for (const [index, task] of plan.tasks.entries()) {
    const marker = teamTaskMarker(projectId, plan, index)
    const matches = known.filter(candidate => candidate.description.includes(marker))
    if (matches.length > 1) {
      throw new HarnessError(`Team task ${matches.map(match => match.id).join(', ')} duplicate project task ${index + 1}. Inspect the board before running it.`,
        'PROJECT_TEAM_TASK_DUPLICATE')
    }
    let linked = matches[0]
    if (!linked) {
      const previous = ids[index - 1]
      linked = await createAdopting(service, root, {
        subject: `${index + 1}/${plan.tasks.length} ${task.role}`.slice(0, TASK_TEXT.subject),
        description: taskDescription(plan, task, index, projectId),
        ...(previous === undefined ? {} : { blockedBy: [previous] }),
        ...(task.review?.artifactPaths === undefined ? {} : { writeScopes: task.review.artifactPaths }),
      }, marker, signal)
      known.push(linked)
    }
    ids.push(linked.id)
    store.saveTeamTask(association(linked, { projectId, index, planId: plan.id, planRevision: plan.revision }))
  }
  return 'linked'
}

/** Render the Team task text that identifies its employee, work and project association. */
function taskDescription(plan: ProjectPlan, task: PlanTask, index: number, projectId: ProjectExecutionId): string {
  const employee = plan.employees.find(item => item.id === task.employeeId)?.name ?? task.role
  return `${employee}\n\n${task.instruction}\n\nAcceptance\n${task.acceptance}\n\n${teamTaskMarker(projectId, plan, index)}`
}

/** Create one task, adopting a visible task when its durability was not confirmed. */
async function createAdopting(service: TeamService, root: Agent, request: Parameters<TeamService['createTask']>[1],
  marker: string, signal: AbortSignal): Promise<TeamTaskView> {
  try {
    return await service.createTask(root, request, signal)
  } catch (error) {
    if (errorCode(error) !== 'TEAM_TASK_PERSISTENCE_UNCONFIRMED') throw error
    const matches = service.listTasks(root).filter(candidate => candidate.description.includes(marker))
    const adopted = matches[0]
    if (adopted !== undefined && matches.length === 1) return adopted
    throw new HarnessError('The Team task was created but its durability is unknown. Inspect the board before retrying.',
      'PROJECT_TEAM_TASK_UNKNOWN', { cause: error })
  }
}

/**
 * Give the dispatched worker Session ownership of its Task before it runs.
 * @param ctx - Context carrying the Team service and live Agent registry.
 * @param store - Project association owner.
 * @param root - Live main conversation that owns the board.
 * @param projectId - Execution identity.
 * @param index - Zero-based task position.
 * @param childId - Worker Session dispatched for this task.
 * @param signal - Cancellation checked by each Team mutation.
 */
export async function claimProjectTeamTask(ctx: Context, store: MeetingStore, root: Agent, projectId: ProjectExecutionId,
  index: number, childId: SessionId, signal: AbortSignal): Promise<void> {
  const service = requireService(ctx)
  if (!teamEnabled(service, root)) {
    throw new HarnessError('Team mode was disabled during the project execution. Re-enable Agent Teams and inspect the board before continuing.',
      'PROJECT_TEAM_DISABLED')
  }
  const link = store.teamTasks(projectId).find(item => item.index === index)
  if (!link) {
    throw new HarnessError(`Project task ${index + 1} has no Team association. Inspect the board and execution checkpoints before continuing.`,
      'PROJECT_TEAM_TASK_MISSING')
  }
  const taskId = brandString<TeamTaskId>(link.taskId)
  let current = service.getTask(root, taskId)
  if (current.status === 'deleted') {
    throw new HarnessError(`Team task ${current.id} was deleted. Restore the board entry or revise the confirmed plan before continuing.`,
      'PROJECT_TEAM_TASK_DELETED')
  }
  if (current.status === 'completed') {
    throw new HarnessError(`Team task ${current.id} was completed before the project released this node. Inspect the board and acceptance records.`,
      'PROJECT_TEAM_TASK_COMPLETED')
  }
  if (current.status === 'in_progress' && current.ownerId !== childId) {
    current = await service.updateTask(root, { taskId, expectedRevision: current.revision, action: 'release' }, signal)
  }
  if (current.status === 'pending') {
    if (!current.ready) {
      throw new HarnessError(`Team task ${current.id} is still blocked. Release its upstream node before dispatching this task.`,
        'PROJECT_TEAM_TASK_BLOCKED')
    }
    const child = ctx.agents.get(childId)
    if (!child) {
      throw new HarnessError('The dispatched worker Session ended before claiming its Team task. Inspect the worker before retrying.',
        'PROJECT_TEAM_WORKER_OFFLINE')
    }
    current = await service.updateTask(child, { taskId, expectedRevision: current.revision, action: 'claim' }, signal)
  }
  if (current.status !== 'in_progress' || current.ownerId !== childId) {
    throw new HarnessError(`Team task ${current.id} is not owned by the dispatched worker. Inspect the board before continuing.`,
      'PROJECT_TEAM_TASK_OWNER')
  }
  store.saveTeamTask(association(current, link))
}

/**
 * Complete the associated Team task after the project released its node.
 * A pending association is claimed by the Lead first so the project's released
 * record remains authoritative during recovery.
 * @param ctx - Context carrying the Team service.
 * @param store - Project association owner.
 * @param root - Live main conversation that owns the board.
 * @param projectId - Execution identity.
 * @param index - Zero-based task position.
 * @param signal - Cancellation checked by each Team mutation.
 */
export async function completeProjectTeamTask(ctx: Context, store: MeetingStore, root: Agent, projectId: ProjectExecutionId,
  index: number, signal: AbortSignal): Promise<void> {
  const service = requireService(ctx)
  if (!teamEnabled(service, root)) {
    throw new HarnessError('Team mode was disabled during the project execution. Re-enable Agent Teams and inspect the board before continuing.',
      'PROJECT_TEAM_DISABLED')
  }
  const link = store.teamTasks(projectId).find(item => item.index === index)
  if (!link) {
    throw new HarnessError(`Project task ${index + 1} has no Team association. Inspect the board and execution checkpoints before continuing.`,
      'PROJECT_TEAM_TASK_MISSING')
  }
  const taskId = brandString<TeamTaskId>(link.taskId)
  let current = service.getTask(root, taskId)
  if (current.status === 'deleted') {
    throw new HarnessError(`Team task ${current.id} was deleted. Restore the board entry or revise the confirmed plan before continuing.`,
      'PROJECT_TEAM_TASK_DELETED')
  }
  if (current.status === 'completed') {
    store.saveTeamTask(association(current, link))
    return
  }
  if (current.status === 'pending') {
    current = await service.updateTask(root, { taskId, expectedRevision: current.revision, action: 'claim' }, signal)
  }
  if (current.status !== 'in_progress') {
    throw new HarnessError(`Team task ${current.id} is not in progress. Inspect the board before continuing.`, 'PROJECT_TEAM_TASK_STATE')
  }
  const completed = await service.updateTask(root, { taskId, expectedRevision: current.revision, action: 'complete' }, signal)
  store.saveTeamTask(association(completed, link))
}

/**
 * Check that Team tasks still agree with the project's retained acceptance facts.
 * @param ctx - Context carrying the Team service.
 * @param store - Project association owner.
 * @param root - Live main conversation that owns the board.
 * @param projectId - Execution identity.
 * @param history - Complete retained checkpoints for this execution.
 */
export function verifyProjectTeamTasks(ctx: Context, store: MeetingStore, root: Agent, projectId: ProjectExecutionId,
  history: readonly ExecutionCheckpoint[]): void {
  const service = requireService(ctx)
  if (!teamEnabled(service, root)) {
    throw new HarnessError('Team mode was disabled after this execution was linked. Re-enable Agent Teams and inspect the board before continuing.',
      'PROJECT_TEAM_DISABLED')
  }
  const released = new Set(history.flatMap(entry => entry.index !== undefined && entry.report?.passed === true
    && (entry.state === 'released' || entry.state === 'acceptance-passed') ? [entry.index] : []))
  for (const link of store.teamTasks(projectId)) {
    const current = service.getTask(root, brandString<TeamTaskId>(link.taskId))
    if (current.status === 'deleted') {
      throw new HarnessError(`Team task ${current.id} was deleted. Restore the board entry or revise the confirmed plan before continuing.`,
        'PROJECT_TEAM_TASK_DELETED')
    }
    if (current.status === 'completed' && !released.has(link.index)) {
      throw new HarnessError(`Team task ${current.id} was completed before project acceptance released the node. Inspect the acceptance records.`,
        'PROJECT_TEAM_TASK_AHEAD')
    }
  }
}

/**
 * Complete every node whose project release is retained but whose Team task is not complete.
 * @param ctx - Context carrying the Team service.
 * @param store - Project association owner.
 * @param root - Live main conversation that owns the board.
 * @param projectId - Execution identity.
 * @param history - Complete retained checkpoints for this execution.
 * @param signal - Cancellation checked by each Team mutation.
 */
export async function syncReleasedProjectTeamTasks(ctx: Context, store: MeetingStore, root: Agent, projectId: ProjectExecutionId,
  history: readonly ExecutionCheckpoint[], signal: AbortSignal): Promise<void> {
  const released = new Set<number>()
  for (const entry of history) {
    if (entry.index === undefined || entry.report?.passed !== true) continue
    if (entry.state === 'released' || entry.state === 'acceptance-passed') released.add(entry.index)
  }
  for (const index of released) await completeProjectTeamTask(ctx, store, root, projectId, index, signal)
}
