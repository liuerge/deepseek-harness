/** Preset roster seeding: fresh installs ship the reference team; user records survive re-seeding. */
import { describe, expect, test } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MeetingStore } from '../src/store.ts'
import { seedPresetRoster } from '../src/preset-roster.ts'
import { registeredArtifacts } from '../src/dashboard.ts'
import type { Employee, EmployeeId, ProjectPlan, ProjectTeamId } from '../src/types.ts'

const ROUTE = { provider: 'deepseek-official', model: 'deepseek-flash' }

describe('preset roster seeding', () => {
  test('seeds five employees and the reference team on a fresh store', () => {
    const store = new MeetingStore(':memory:')
    seedPresetRoster(store, ROUTE)
    const employees = store.employees()
    expect(employees).toHaveLength(5)
    expect(employees.every(employee => employee.provider === ROUTE.provider && employee.model === ROUTE.model)).toBe(true)
    const teams = store.teams()
    expect(teams).toHaveLength(1)
    expect(teams[0]?.name).toBe('软件开发专家团')
    expect(teams[0]?.ownerEmployeeId).toBe(brandString('preset-pm'))
    expect(teams[0]?.allowAssignment).toBe(true)
    expect(teams[0]?.memberIds).toHaveLength(5)
    expect(teams[0]?.description).toContain('需求澄清到验收')
  })

  test('re-seeding is idempotent and preserves user edits of preset records', () => {
    const store = new MeetingStore(':memory:')
    seedPresetRoster(store, ROUTE)
    const pm = store.employees().find(employee => employee.id === brandString('preset-pm'))
    expect(pm).toBeDefined()
    store.saveEmployee({ ...pm!, description: '用户改过的说明', revision: pm!.revision + 1 }, pm!.revision)
    seedPresetRoster(store, ROUTE)
    const after = store.employees().find(employee => employee.id === pm!.id)
    expect(after?.description).toBe('用户改过的说明')
    expect(store.employees()).toHaveLength(5)
    expect(store.teams()).toHaveLength(1)
  })

  test('user-created teams survive re-seeding', () => {
    const store = new MeetingStore(':memory:')
    seedPresetRoster(store, ROUTE)
    store.saveTeam({
      id: brandString<ProjectTeamId>('user-team'), revision: 1, name: '手动创建的团队',
      memberIds: [brandString<EmployeeId>('preset-pm')], allowAssignment: true,
    }, 0)
    seedPresetRoster(store, ROUTE)
    expect(store.teams().map(team => team.name)).toContain('手动创建的团队')
    expect(store.teams()).toHaveLength(2)
  })

  test('seeded employees are editable records like any other', () => {
    const store = new MeetingStore(':memory:')
    seedPresetRoster(store, ROUTE)
    const tester = store.employees().find(employee => employee.id === brandString('preset-tester'))
    expect(tester).toBeDefined()
    store.saveEmployee({
      ...tester!, revision: tester!.revision + 1, provider: 'llm-deepseek', model: 'DeepSeek-V4.1-Flash',
    }, tester!.revision)
    const after = store.employees().find(employee => employee.id === tester!.id)
    expect(after?.provider).toBe('llm-deepseek')
    expect(after?.model).toBe('DeepSeek-V4.1-Flash')
    expect(after?.responsibility).toBe(tester!.responsibility)
  })
})

describe('registered artifacts allowlist', () => {
  const planId = 'plan-1' as unknown as ProjectPlan['id']
  const makePlan = (document: ProjectPlan['document'] | undefined, artifactPaths: string[]):
  ProjectPlan => ({
    id: planId, revision: 1, goal: 'goal', background: [],
    team: { id: 'team' as ProjectPlan['team']['id'], revision: 1, name: 'Team', memberIds: [] },
    employees: [], tasks: [{ role: 'Author', employeeId: 'emp' as Employee['id'], instruction: 'i', acceptance: 'a',
      review: { reviewerIds: [], release: 'automatic', artifactPaths, downstream: [], criteria: [] } }],
    confirmed: true, document, originSessionId: 'main',
  })

  test('plan documents, planned paths and report artifacts register for their owning conversation', () => {
    const plan = makePlan({ path: '/root/plan-doc.md', sha256: 'a'.repeat(64), cwd: '/root' }, ['index.html'])
    const timeline = [{ sessionId: 'main', record: JSON.stringify({ projectId: 'p1', state: 'acceptance-passed',
      report: { planId: 'plan-1' as ProjectPlan['id'], planRevision: 1, index: 1, artifacts: [{ sourcePath: 'index.html', path: '/root/index.html', sha256: 'b'.repeat(64) }], passed: true, reviewers: [] } }) }]
    const registered = registeredArtifacts([plan], timeline, 'main')
    expect(registered.get('/root/plan-doc.md')?.sha256).toBe('a'.repeat(64))
    expect(registered.get('index.html')?.cwd).toBe('/root')
    expect(registered.get('/root/index.html')?.sha256).toBe('b'.repeat(64))
  })

  test('other conversations and unregistered paths do not register', () => {
    const plan = makePlan({ path: '/root/plan-doc.md', sha256: 'a'.repeat(64), cwd: '/root' }, [])
    const timeline = [{ sessionId: 'other', record: JSON.stringify({ projectId: 'p2', state: 'acceptance-passed',
      report: { planId: 'plan-2' as ProjectPlan['id'], planRevision: 1, index: 0, artifacts: [{ sourcePath: 'x', path: '/other/file.txt', sha256: 'c'.repeat(64) }], passed: true, reviewers: [] } }) }]
    const registered = registeredArtifacts([plan], timeline, 'main')
    expect(registered.has('/other/file.txt')).toBe(false)
    expect(registered.get('/root/plan-doc.md')?.cwd).toBe('/root')
    expect(registered.has('/root/plan-doc.md')).toBe(true)
  })
})
