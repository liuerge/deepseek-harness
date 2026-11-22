/** Tool-boundary guards: caller identity, argument validation and team membership. */
import { expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { registerPlanTools } from '../src/plan-tools.ts'
import { registerRosterTools } from '../src/roster-tools.ts'
import { registerProjectTools } from '../src/project-tools.ts'
import { Config } from '../src/index.ts'
import { MeetingStore } from '../src/store.ts'
import type { EmployeeId, ProjectTeamId } from '../src/types.ts'

/** A registered tool definition with its raw execute entry. */
interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, exec: { agent?: unknown }) => Promise<unknown>
}

/** Effect-free context double capturing tool registrations (subset fake, like the service doubles above). */
function fakeToolCtx(rootOf: (agent: unknown) => unknown = agent => agent): { ctx: Context; tools: Map<string, RegisteredTool> } {
  const tools = new Map<string, RegisteredTool>()
  const ctx = {
    effect: (fn: () => unknown) => { fn(); return () => {} },
    on: () => () => {},
    tools: { register: (def: RegisteredTool) => { tools.set(def.name, def); return () => {} } },
    subagents: { rootOf },
  } as unknown as Context
  return { ctx, tools }
}

const root = { session: { id: 'caller' } }
const child = { session: { id: 'child' } }

it('project_plan_list returns the retained plans and project_plan_save guards caller, arguments and team', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const { ctx, tools } = fakeToolCtx(agent => agent === root ? agent : undefined)
    registerPlanTools(ctx, store, 1_000_000)
    await expect(tools.get('project_plan_list')!.execute({}, { agent: root })).resolves.toBe('[]')
    const author = store.saveEmployee({ id: brandString<EmployeeId>('author'), revision: 1,
      name: 'Author', responsibility: 'Develop', provider: 'vendor-a', model: 'm1' }, 0)
    store.saveTeam({ id: brandString<ProjectTeamId>('team'), revision: 1, name: 'Team', memberIds: [author.id] }, 0)
    const save = tools.get('project_plan_save')!
    const fullArgs = { expectedRevision: 0, documentPath: 'plan.md', goal: 'Goal', teamId: 'team',
      background: [], tasks: [{ employeeId: 'author', role: 'Build', instruction: 'Build', acceptance: 'Works' }] }
    await expect(save.execute({ ...fullArgs }, { agent: child }))
      .rejects.toMatchObject({ name: 'ToolContextUnavailableError' })
    await expect(save.execute({ ...fullArgs, id: 'plan' }, { agent: root }))
      .rejects.toMatchObject({ name: 'ToolArgsError' })
    await expect(save.execute({ ...fullArgs, teamId: 'missing' }, { agent: root }))
      .rejects.toMatchObject({ name: 'ToolArgsError' })
    await expect(save.execute({ ...fullArgs, tasks: [{ employeeId: 'outsider', role: 'Build', instruction: 'Build', acceptance: 'Works' }] }, { agent: root }))
      .rejects.toMatchObject({ name: 'ToolArgsError' })
    await expect(save.execute({ ...fullArgs, tasks: [{ employeeId: 'author', role: 'Build', instruction: 'Build', acceptance: 'Works',
      review: { reviewerIds: ['author'], release: 'automatic', downstream: [], artifactPaths: ['out.md'],
        criteria: [{ id: 'AC-1', description: 'Works', method: 'Read', expected: 'Works', evidence: 'out.md' }] } }] }, { agent: root }))
      .rejects.toMatchObject({ name: 'ToolArgsError' })
  } finally { store.close() }
})

it('employee_list returns the roster and employee_save and team_save validate fields and revisions', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const { ctx, tools } = fakeToolCtx()
    registerRosterTools(ctx, store)
    await expect(tools.get('employee_list')!.execute({}, { agent: root })).resolves.toBe(JSON.stringify({ employees: [], teams: [] }))
    const saveEmployee = tools.get('employee_save')!
    await expect(saveEmployee.execute({ name: ' ', responsibility: 'Deliver', provider: 'vendor-a', model: 'm1', expectedRevision: 0 }, { agent: root }))
      .rejects.toMatchObject({ name: 'ToolArgsError' })
    await expect(saveEmployee.execute({ id: 'worker', name: 'Worker', responsibility: 'Deliver', provider: 'vendor-a', model: 'm1', expectedRevision: 0 }, { agent: root }))
      .rejects.toMatchObject({ name: 'ToolArgsError' })
    const saveTeam = tools.get('team_save')!
    await expect(saveTeam.execute({ expectedRevision: -1 }, { agent: root }))
      .rejects.toMatchObject({ name: 'ToolArgsError' })
    const author = store.saveEmployee({ id: brandString<EmployeeId>('author'), revision: 1,
      name: 'Author', responsibility: 'Develop', provider: 'vendor-a', model: 'm1' }, 0)
    await expect(saveTeam.execute({ name: 'Team', memberIds: [author.id], expectedRevision: 0 }, { agent: root }))
      .resolves.toContain('"name":"Team"')
  } finally { store.close() }
})

it('project_records inspects one execution across conversations and falls back to caller records', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const { ctx, tools } = fakeToolCtx()
    registerProjectTools(ctx, store, Config.parse({}))
    store.recordProject('caller', JSON.stringify({ projectId: 'run-1', state: 'running', checkpoint: 1, index: 0 }))
    const records = tools.get('project_records')!
    await expect(records.execute({ projectId: 'run-1', limit: 5 }, { agent: root }))
      .resolves.toContain('"projectId":"run-1"')
    await expect(records.execute({ limit: 5 }, { agent: root })).resolves.toContain('"projectId":"run-1"')
    await expect(records.execute({ limit: 0 }, { agent: root })).rejects.toMatchObject({ name: 'ToolArgsError' })
    const execute = tools.get('project_execute')!
    await expect(execute.execute({ planId: 'plan', planRevision: 1, goal: 'Inline goal' }, { agent: root }))
      .rejects.toMatchObject({ name: 'ToolArgsError' })
    await expect(execute.execute({ projectId: 'run-1', expectedCheckpoint: 0 }, { agent: root }))
      .rejects.toMatchObject({ name: 'ToolArgsError' })
  } finally { store.close() }
})

it('project_execute refuses an empty roster with a configuration hint', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const { ctx, tools } = fakeToolCtx()
    registerProjectTools(ctx, store, Config.parse({}))
    const execute = tools.get('project_execute')!
    await expect(execute.execute({
      goal: 'Build a page',
      tasks: [{ role: 'Dev', instruction: 'Implement', acceptance: 'Works' }],
    }, { agent: root })).rejects.toMatchObject({ code: 'PROJECT_ROSTER_EMPTY' })
  } finally { store.close() }
})
