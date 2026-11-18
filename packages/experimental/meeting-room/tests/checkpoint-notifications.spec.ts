import { expect, it, vi } from 'vitest'
import { MeetingStore } from '../src/store.ts'
import { Context } from '@deepseek-ai/cordis'
import ProjectDashboard from '../src/dashboard.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ProjectExecutionId, ProjectPlanId } from '../src/types.ts'
import { projectPlanSchema } from '../src/plans.ts'

it('notifies only after checkpoint persistence and stops after unsubscribe', () => {
  const store = new MeetingStore(':memory:')
  try {
    const listener = vi.fn()
    const stop = store.onProjectChange(listener)
    store.recordProject('session', '{"projectId":"project"}')
    expect(listener).toHaveBeenCalledOnce()
    expect(() => { store.transitionExecution(brandString<ProjectExecutionId>('missing'), 1, 'session', {},
      { id: brandString<ProjectPlanId>('missing'), revision: 1 }) }).toThrow()
    expect(listener).toHaveBeenCalledOnce()
    stop()
    store.recordProject('session', '{"projectId":"project"}')
    expect(listener).toHaveBeenCalledOnce()
  } finally { store.close() }
})

it('follows committed checkpoints and closes on cancellation', async () => {
  const store = new MeetingStore(':memory:')
  const abort = new AbortController()
  try {
    const dashboard = new ProjectDashboard(new Context(), { store, acceptanceMaxBytes: 1000 })
    const iterator = dashboard.follow(abort.signal)[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toBe(true)
    const next = iterator.next()
    store.recordProject('session', '{"projectId":"project"}')
    expect((await next).value).toBe(true)
    const ending = iterator.next()
    abort.abort()
    expect((await ending).done).toBe(true)
  } finally { abort.abort(); store.close() }
})

it('notifies saved and confirmed plans without notifying rejected or repeated writes', () => {
  const store = new MeetingStore(':memory:')
  try {
    const listener = vi.fn()
    const stop = store.onProjectChange(listener)
    const draft = projectPlanSchema.parse({
      id: 'plan', revision: 1, goal: 'Delivery', background: [], confirmed: false,
      team: { id: 'team', revision: 1, name: 'Team', memberIds: ['author'] },
      employees: [{ id: 'author', revision: 1, name: 'Author', responsibility: 'Develop',
        provider: 'provider', model: 'model' }],
      tasks: [{ employeeId: 'author', role: 'Author', instruction: 'Develop', acceptance: 'Deliver' }],
    })
    store.savePlan(draft, 0)
    expect(listener).toHaveBeenCalledOnce()
    expect(() => store.savePlan(draft, 0)).toThrow()
    expect(() => store.confirmPlan(draft.id, 2)).toThrow()
    expect(listener).toHaveBeenCalledOnce()
    store.confirmPlan(draft.id, 1)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.plans()[0]?.confirmed).toBe(true)
    store.confirmPlan(draft.id, 1)
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    store.savePlan({ ...draft, revision: 2 }, 1)
    expect(listener).toHaveBeenCalledTimes(2)
  } finally { store.close() }
})
