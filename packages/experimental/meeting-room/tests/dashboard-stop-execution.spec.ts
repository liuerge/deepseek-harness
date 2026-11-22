/** Stopping a project execution cancels the owning agent without dropping its queued user input. */
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ProjectDashboard from '../src/dashboard.ts'
import { MeetingStore } from '../src/store.ts'

const signal = new AbortController().signal

/** Dashboard over a store and an injectable agent registry double. */
function dashboard(agents: { get: ReturnType<typeof vi.fn> }) {
  const ctx = new Context()
  ctx.provide('agents', agents)
  return new ProjectDashboard(ctx, { store: new MeetingStore(':memory:'), acceptanceMaxBytes: 1000 })
}

it('cancels the live agent of an execution owner with keepInbox so the adjustment prompt survives', async () => {
  const cancel = vi.fn()
  const agents = { get: vi.fn(() => ({ cancel })) }
  const dashboard_ = dashboard(agents)
  await expect(dashboard_.stopExecution('session', signal)).resolves.toEqual({ cancelled: true })
  expect(agents.get).toHaveBeenCalledWith('session')
  expect(cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
})

it('reports no cancellation for a session without a live agent and requires the agent service', async () => {
  const agents = { get: vi.fn(() => undefined) }
  const dashboard_ = dashboard(agents)
  await expect(dashboard_.stopExecution('idle-session', signal)).resolves.toEqual({ cancelled: false })
  const bare = new ProjectDashboard(new Context(), { store: new MeetingStore(':memory:'), acceptanceMaxBytes: 1000 })
  let thrown: unknown
  try { await bare.stopExecution('session', signal) } catch (error) { thrown = error }
  expect(thrown).toBeInstanceOf(Error)
  expect((thrown as Error).message).toContain('agent service')
})
