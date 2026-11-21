/** Store failure contracts: stale revisions, unsupported schemas and closed-database wraps. */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { MeetingStore } from '../src/store.ts'
import { projectPlanSchema } from '../src/plans.ts'
import type { EmployeeId, ProjectExecutionId, ProjectPlanId, ProjectTeamId, ProjectTeamTaskId } from '../src/types.ts'

/** Parse a one-task draft plan; overrides shape the specific guard scenario. */
function plan(overrides: Record<string, unknown> = {}) {
  return projectPlanSchema.parse({
    id: 'plan', revision: 1, goal: 'Delivery', background: [], confirmed: false,
    team: { id: 'team', revision: 1, name: 'Team', memberIds: ['author'] },
    employees: [{ id: 'author', revision: 1, name: 'Author', responsibility: 'Develop', provider: 'vendor-a', model: 'm1' }],
    tasks: [{ employeeId: 'author', role: 'Author', instruction: 'Develop', acceptance: 'Deliver' }],
    ...overrides,
  })
}

/** A minimal valid employee at the given next revision. */
function employee(id = 'author', revision = 1) {
  return { id: brandString<EmployeeId>(id), revision, name: 'Author', responsibility: 'Develop',
    provider: 'vendor-a', model: 'm1' }
}

it('refuses a database written by a newer application version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'store-schema-'))
  const path = join(directory, 'meetings.sqlite')
  const store = new MeetingStore(path)
  store.close()
  const raw = new DatabaseSync(path)
  raw.exec('PRAGMA user_version = 999')
  raw.close()
  expect(() => { new MeetingStore(path) }).toThrow('requires a newer application version')
})

it('enforces conversation-team revisions and wraps closed-database writes', () => {
  const store = new MeetingStore(':memory:')
  let closed = false
  const selection = { revision: 1, team: null, employees: [] }
  try {
    expect(() => { store.saveSessionTeam('session' as SessionId, selection, 5) })
      .toThrow('The team selection revision must advance by one.')
    closed = true
    store.close()
    expect(() => { store.saveSessionTeam('session' as SessionId, selection, 0) })
      .toThrow('The conversation team could not be saved.')
  } finally { if (!closed) store.close() }
})

it('rejects confirmed drafts, members outside the team and reviewers matching the author', () => {
  const store = new MeetingStore(':memory:')
  let closed = false
  try {
    expect(() => { store.savePlan(plan({ confirmed: true }), 0) }).toThrow('Save an unconfirmed draft')
    expect(() => { store.savePlan(plan({ tasks: [{ employeeId: 'outsider', role: 'Build', instruction: 'Build', acceptance: 'Works' }] }), 0) })
      .toThrow('Every plan task must select a captured employee')
    expect(() => { store.savePlan(plan({ tasks: [{ employeeId: 'author', role: 'Build', instruction: 'Build', acceptance: 'Works',
      review: { reviewerIds: ['author'], release: 'automatic', downstream: [], artifactPaths: ['out.md'],
        criteria: [{ id: 'AC-1', description: 'Works', method: 'Read', expected: 'Works', evidence: 'out.md' }] } }] }), 0) })
      .toThrow('Reviewers must be captured team members')
    closed = true
    store.close()
    expect(() => { store.savePlan(plan(), 0) }).toThrow('Plan storage failed')
  } finally { if (!closed) store.close() }
})

it('reserves one execution per confirmed revision', () => {
  const store = new MeetingStore(':memory:')
  try {
    const saved = store.savePlan(plan(), 0)
    store.confirmPlan(saved.id, 1)
    store.claimPlanRun(saved.id, 1, brandString<ProjectExecutionId>('run-1'))
    expect(() => { store.claimPlanRun(saved.id, 1, brandString<ProjectExecutionId>('run-2')) })
      .toThrow('already started')
    expect(() => { store.claimPlanRun(saved.id, 1, brandString<ProjectExecutionId>('run-1')) })
      .toThrow('already started')
    expect(() => { store.claimPlanRun(brandString<ProjectPlanId>('missing'), 1, brandString<ProjectExecutionId>('run-3')) })
      .toThrow('already started')
  } finally { store.close() }
})

it('enforces roster revisions and wraps closed-database reads and writes', () => {
  const store = new MeetingStore(':memory:')
  let closed = false
  try {
    expect(() => { store.saveEmployee(employee(), 1) }).toThrow('The roster revision must advance by one.')
    const author = store.saveEmployee(employee(), 0)
    store.saveTeam({ id: brandString<ProjectTeamId>('team'), revision: 1, name: 'Team', memberIds: [author.id] }, 0)
    store.saveTeamTask({ projectId: brandString<ProjectExecutionId>('run-1'), index: 0,
      planId: brandString<ProjectPlanId>('plan'), planRevision: 1,
      taskId: brandString<ProjectTeamTaskId>('task-1'), revision: 1, status: 'pending' })
    closed = true
    store.close()
    expect(() => { store.saveEmployee(employee('other'), 0) }).toThrow('The roster could not be saved.')
    expect(() => { store.recordProject('session', '{"projectId":"run"}') }).toThrow('Project checkpoint persistence failed')
    expect(() => { store.projectRecords('session', 5) }).toThrow('Project checkpoints could not be read')
    expect(() => { store.saveTeamTask({ projectId: brandString<ProjectExecutionId>('run-1'), index: 0,
      planId: brandString<ProjectPlanId>('plan'), planRevision: 1,
      taskId: brandString<ProjectTeamTaskId>('task-1'), revision: 1, status: 'pending' }) })
      .toThrow('The Team task association could not be saved')
    expect(() => { store.settleMeeting('missing', 'failed') }).toThrow('Meeting storage failed')
  } finally { if (!closed) store.close() }
})
