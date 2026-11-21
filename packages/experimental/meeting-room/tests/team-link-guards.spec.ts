/** Team-link guards: every board divergence is reported, never overwritten. */
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { TeamTaskId, type TeamService, type TeamTaskStatus, type TeamTaskView } from '@deepseek-ai/dsh-agent-team'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  completeProjectTeamTask, claimProjectTeamTask, linkProjectTeamTasks, registerTeamClaimGates,
  teamTaskMarker, verifyProjectTeamTasks,
} from '../src/team-link.ts'
import { MeetingStore } from '../src/store.ts'
import { projectPlanSchema } from '../src/plans.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { ProjectExecutionId, ProjectPlan, ProjectTeamTaskId } from '../src/types.ts'

const projectId = brandString<ProjectExecutionId>('run-1')

/** One-task confirmed-shape plan used by every guard scenario. */
function plan(): ProjectPlan {
  return projectPlanSchema.parse({
    id: 'plan', revision: 1, goal: 'Delivery', background: [], confirmed: true,
    team: { id: 'team', revision: 1, name: 'Team', memberIds: ['author'] },
    employees: [{ id: 'author', revision: 1, name: 'Author', responsibility: 'Develop', provider: 'provider', model: 'model' }],
    tasks: [{ employeeId: 'author', role: 'Author', instruction: 'Develop', acceptance: 'Deliver' }],
  })
}

/** Board task view carrying the exact project marker so content checks pass. */
function taskView(plan_: ProjectPlan, overrides: Partial<TeamTaskView> = {}): TeamTaskView {
  return {
    id: TeamTaskId('task-1'), revision: 1, subject: '1/1 Author',
    description: `Author\n\nDevelop\n\nAcceptance\nDeliver\n\n${teamTaskMarker(projectId, plan_, 0)}`,
    status: 'pending', blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [], ...overrides,
  }
}

/** Effect-free context stub resolving only the Team service and the agent registry. */
function fakeCtx(service: TeamService | undefined, child?: { id: string }): CordisContext {
  return {
    get: (key: string) => key === 'agentTeams' ? service : undefined,
    agents: { get: (id: string) => child?.id === id ? child : undefined },
  } as unknown as CordisContext
}

/** Configurable Team service double recording every mutation. */
function fakeService(task: TeamTaskView | undefined, overrides: {
  enabled?: boolean | 'unauthorized' | 'broken'
  create?: (request: object, signal: AbortSignal) => Promise<TeamTaskView>
  update?: (request: object, signal: AbortSignal) => Promise<TeamTaskView>
} = {}): TeamService {
  const enabled = overrides.enabled ?? true
  return {
    isEnabled: vi.fn(() => {
      if (enabled === 'unauthorized') throw Object.assign(new Error('denied'), { code: 'UNAUTHORIZED' })
      if (enabled === 'broken') throw new Error('INVALID_TEAM_SETTINGS')
      return enabled
    }),
    listTasks: vi.fn(() => task === undefined ? [] : [task]),
    getTask: vi.fn(() => {
      if (task === undefined) throw new Error('Team task task-1 not found.')
      return task
    }),
    createTask: vi.fn((_root: Agent, request: object, signal: AbortSignal) => overrides.create?.(request, signal)
      ?? Promise.resolve(taskView(plan(), { description: (request as { description: string }).description }))),
    updateTask: vi.fn((_root: Agent, request: object, signal: AbortSignal) => overrides.update?.(request, signal)
      ?? Promise.resolve(task)),
  } as unknown as TeamService
}

/** Save the association row a guard scenario reads back. */
function saveLink(store: MeetingStore, plan_: ProjectPlan, overrides: { status?: TeamTaskStatus; revision?: number } = {}): void {
  store.saveTeamTask({ projectId, index: 0, planId: plan_.id, planRevision: plan_.revision,
    taskId: brandString<ProjectTeamTaskId>('task-1'), revision: overrides.revision ?? 1,
    status: overrides.status ?? 'pending' })
}

const root = { session: { id: 'root' } } as unknown as Agent
const child = { id: 'child-1', session: { id: 'child-1' } }
const signal = new AbortController().signal

it('reports a missing Team service instead of silently skipping the mirror', async () => {
  const store = new MeetingStore(':memory:')
  try {
    await expect(linkProjectTeamTasks(fakeCtx(undefined), store, root, plan(), projectId, signal)).resolves.toBe('unavailable')
    await expect(claimProjectTeamTask(fakeCtx(undefined), store, root, projectId, 0, 'child-1' as SessionId, signal))
      .rejects.toMatchObject({ code: 'PROJECT_TEAM_UNAVAILABLE' })
  } finally { store.close() }
})

it('treats an unauthorized board probe as disabled and rethrows unrelated service failures', async () => {
  const store = new MeetingStore(':memory:')
  const plan_ = plan()
  try {
    await expect(linkProjectTeamTasks(fakeCtx(fakeService(taskView(plan_), { enabled: 'unauthorized' })),
      store, root, plan_, projectId, signal)).resolves.toBe('disabled')
    await expect(linkProjectTeamTasks(fakeCtx(fakeService(taskView(plan_), { enabled: 'broken' })),
      store, root, plan_, projectId, signal)).rejects.toThrow('INVALID_TEAM_SETTINGS')
    await expect(claimProjectTeamTask(fakeCtx(fakeService(undefined, { enabled: false })),
      store, root, projectId, 0, 'child-1' as SessionId, signal)).rejects.toMatchObject({ code: 'PROJECT_TEAM_DISABLED' })
    await expect(completeProjectTeamTask(fakeCtx(fakeService(undefined, { enabled: false })),
      store, root, projectId, 0, 'child-1' as SessionId, signal)).rejects.toMatchObject({ code: 'PROJECT_TEAM_DISABLED' })
    expect(() => { verifyProjectTeamTasks(fakeCtx(fakeService(undefined, { enabled: false })),
      store, root, projectId, []) }).toThrow('Team mode was disabled')
  } finally { store.close() }
})

it('refuses oversized task text and duplicated board markers before creating anything', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const long = projectPlanSchema.parse({
      ...plan(), tasks: [{ employeeId: 'author', role: 'Author', instruction: 'x'.repeat(17_000), acceptance: 'Deliver' }],
    })
    await expect(linkProjectTeamTasks(fakeCtx(fakeService(undefined)), store, root, long, projectId, signal))
      .rejects.toMatchObject({ code: 'PROJECT_TEAM_TASK_TEXT_TOO_LONG' })
    const duplicate = taskView(plan())
    const duplicated = fakeService(duplicate)
    ;(duplicated.listTasks as ReturnType<typeof vi.fn>).mockReturnValue([duplicate, duplicate])
    await expect(linkProjectTeamTasks(fakeCtx(duplicated), store, root, plan(), projectId, signal))
      .rejects.toMatchObject({ code: 'PROJECT_TEAM_TASK_DUPLICATE' })
    expect(store.teamTasks(projectId)).toEqual([])
  } finally { store.close() }
})

it('reports deleted saved tasks instead of recreating the mirror', async () => {
  const store = new MeetingStore(':memory:')
  const plan_ = plan()
  saveLink(store, plan_, { status: 'pending' })
  try {
    await expect(linkProjectTeamTasks(fakeCtx(fakeService(taskView(plan_, { status: 'deleted' }))),
      store, root, plan_, projectId, signal)).rejects.toMatchObject({ code: 'PROJECT_TEAM_TASK_DELETED' })
  } finally { store.close() }
})

it('rejects an unmarked adopt candidate whose content diverges from the plan task', async () => {
  const store = new MeetingStore(':memory:')
  try {
    await expect(linkProjectTeamTasks(fakeCtx(fakeService(taskView(plan(), { description: `${teamTaskMarker(projectId, plan(), 0)} tampered` }))),
      store, root, plan(), projectId, signal)).rejects.toMatchObject({ code: 'PROJECT_TEAM_TASK_CONFLICT' })
  } finally { store.close() }
})

it('adopts an unconfirmed creation when the board holds exactly one marker match and fails loudly otherwise', async () => {
  const store = new MeetingStore(':memory:')
  const plan_ = plan()
  const service = fakeService(undefined, { create: async () => { throw Object.assign(new Error('unconfirmed'), { code: 'TEAM_TASK_PERSISTENCE_UNCONFIRMED' }) } })
  try {
    await expect(linkProjectTeamTasks(fakeCtx(service), store, root, plan_, projectId, signal))
      .rejects.toMatchObject({ code: 'PROJECT_TEAM_TASK_UNKNOWN' })
    await expect(linkProjectTeamTasks(fakeCtx(service), store, root, plan_, projectId, signal))
      .rejects.toMatchObject({ code: 'PROJECT_TEAM_TASK_UNKNOWN' })
    const adopted = taskView(plan_, { description: `Author\n\nDevelop\n\nAcceptance\nDeliver\n\n${teamTaskMarker(projectId, plan_, 0)}` })
    ;(service.listTasks as ReturnType<typeof vi.fn>).mockReturnValue([adopted])
    await expect(linkProjectTeamTasks(fakeCtx(service), store, root, plan_, projectId, signal)).resolves.toBe('linked')
    expect(store.teamTasks(projectId)[0]).toMatchObject({ taskId: 'task-1', status: 'pending', revision: 1 })
  } finally { store.close() }
})

it('blocks the claim when the association, board state or worker is gone', async () => {
  const store = new MeetingStore(':memory:')
  const plan_ = plan()
  const service = fakeService(undefined)
  try {
    await expect(claimProjectTeamTask(fakeCtx(service), store, root, projectId, 0, 'child-1' as SessionId, signal))
      .rejects.toMatchObject({ code: 'PROJECT_TEAM_TASK_MISSING' })
    saveLink(store, plan_)
    ;(service.getTask as ReturnType<typeof vi.fn>).mockReturnValue(taskView(plan_, { status: 'deleted' }))
    await expect(claimProjectTeamTask(fakeCtx(service), store, root, projectId, 0, 'child-1' as SessionId, signal))
      .rejects.toMatchObject({ code: 'PROJECT_TEAM_TASK_DELETED' })
    ;(service.getTask as ReturnType<typeof vi.fn>).mockReturnValue(taskView(plan_, { status: 'completed' }))
    await expect(claimProjectTeamTask(fakeCtx(service), store, root, projectId, 0, 'child-1' as SessionId, signal))
      .rejects.toMatchObject({ code: 'PROJECT_TEAM_TASK_COMPLETED' })
    ;(service.getTask as ReturnType<typeof vi.fn>).mockReturnValue(taskView(plan_, { ready: false }))
    await expect(claimProjectTeamTask(fakeCtx(service), store, root, projectId, 0, 'child-1' as SessionId, signal))
      .rejects.toMatchObject({ code: 'PROJECT_TEAM_TASK_BLOCKED' })
    ;(service.getTask as ReturnType<typeof vi.fn>).mockReturnValue(taskView(plan_))
    await expect(claimProjectTeamTask(fakeCtx(service), store, root, projectId, 0, 'child-1' as SessionId, signal))
      .rejects.toMatchObject({ code: 'PROJECT_TEAM_WORKER_OFFLINE' })
  } finally { store.close() }
})

it('fails the claim when the claimed task does not end up owned by the dispatched worker', async () => {
  const store = new MeetingStore(':memory:')
  const plan_ = plan()
  saveLink(store, plan_)
  const service = fakeService(taskView(plan_), {
    update: async () => taskView(plan_, { status: 'in_progress', ownerId: 'someone-else' as SessionId, revision: 2 }),
  })
  try {
    await expect(claimProjectTeamTask(fakeCtx(service, child), store, root, projectId, 0, 'child-1' as SessionId, signal))
      .rejects.toMatchObject({ code: 'PROJECT_TEAM_TASK_OWNER' })
  } finally { store.close() }
})

it('releases a confirmed rework handoff back to pending and claims it for the new worker', async () => {
  const store = new MeetingStore(':memory:')
  const plan_ = plan()
  saveLink(store, plan_, { status: 'in_progress', revision: 2 })
  const updates: string[] = []
  const service = fakeService(taskView(plan_, { status: 'in_progress', ownerId: 'old-worker' as SessionId, revision: 2 }), {
    update: async (request: object) => {
      const action = (request as { action: string }).action
      updates.push(action)
      return action === 'release'
        ? taskView(plan_, { status: 'pending', revision: 3 })
        : taskView(plan_, { status: 'in_progress', ownerId: 'child-1' as SessionId, revision: 4 })
    },
  })
  try {
    await claimProjectTeamTask(fakeCtx(service, child), store, root, projectId, 0, 'child-1' as SessionId, signal, 'old-worker' as SessionId)
    expect(updates).toEqual(['release', 'claim'])
    expect(store.teamTasks(projectId)[0]).toMatchObject({ status: 'in_progress', revision: 4 })
  } finally { store.close() }
})

it('blocks completion on a missing association or a deleted board task', async () => {
  const store = new MeetingStore(':memory:')
  const plan_ = plan()
  const service = fakeService(undefined)
  try {
    await expect(completeProjectTeamTask(fakeCtx(service), store, root, projectId, 0, undefined, signal))
      .rejects.toMatchObject({ code: 'PROJECT_TEAM_TASK_MISSING' })
    saveLink(store, plan_)
    ;(service.getTask as ReturnType<typeof vi.fn>).mockReturnValue(taskView(plan_, { status: 'deleted' }))
    await expect(completeProjectTeamTask(fakeCtx(service), store, root, projectId, 0, 'child-1' as SessionId, signal))
      .rejects.toMatchObject({ code: 'PROJECT_TEAM_TASK_DELETED' })
  } finally { store.close() }
})

it('rejects a board task completed before the project released its node', async () => {
  const store = new MeetingStore(':memory:')
  const plan_ = plan()
  saveLink(store, plan_, { status: 'completed' })
  try {
    expect(() => { verifyProjectTeamTasks(fakeCtx(fakeService(taskView(plan_, { status: 'completed' }))),
      store, root, projectId, []) }).toThrow('completed before project acceptance released')
  } finally { store.close() }
})

it('fails every pending claim gate and detaches the listener when the project execution is disposed', async () => {
  const ctx = new Context()
  const open = registerTeamClaimGates(ctx)
  open('child-1' as SessionId)
  await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
})
