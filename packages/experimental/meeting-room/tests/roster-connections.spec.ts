/** Roster connection discovery and team template guards over the durable store. */
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import ProjectRoster from '../src/roster-management.ts'
import ProjectTeamContext from '../src/team-context.ts'
import { MeetingStore } from '../src/store.ts'
import type { EmployeeId, ProjectTeamId } from '../src/types.ts'

/** Bare context with the roster's LLM surface replaced by a configurable double. */
function ctxWithLlm(llm: object): Context {
  const ctx = new Context()
  ctx.provide('llm', llm)
  return ctx
}

const signal = new AbortController().signal

it('annotates discovered models with their declared reasoning efforts and keeps failures per provider', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const roster = new ProjectRoster(ctxWithLlm({
      listProviders: () => [{ id: 'vendor-a', name: 'Vendor A' }, { id: 'vendor-b', name: 'Vendor B' }],
      listModels: vi.fn()
        .mockResolvedValueOnce([{ id: 'm1', name: 'M one' }])
        .mockRejectedValueOnce(new Error('catalog offline')),
      resolveModelInfo: vi.fn().mockRejectedValueOnce(new Error('no reasoning metadata'))
        .mockResolvedValueOnce({ reasoning: { efforts: [{ id: 'high', name: 'High', description: 'Deep' }] } }),
    }), { store, modelCatalogTimeoutMs: 5_000 })
    const connections = await roster.connections(signal)
    expect(connections).toEqual([
      { id: 'vendor-a', name: 'Vendor A', failed: false, models: [{ id: 'm1', name: 'M one' }] },
      { id: 'vendor-b', name: 'Vendor B', failed: true, models: [] },
    ])
  } finally { store.close() }
})

it('annotates efforts when the catalog publishes them for every model of one provider', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const roster = new ProjectRoster(ctxWithLlm({
      listProviders: () => [{ id: 'vendor-a', name: 'Vendor A' }],
      listModels: async () => [{ id: 'm1', name: 'M one' }],
      resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'high', name: 'High', description: 'Deep' }] } }),
    }), { store, modelCatalogTimeoutMs: 5_000 })
    const connections = await roster.connections(signal)
    expect(connections[0]).toMatchObject({ failed: false,
      models: [{ id: 'm1', name: 'M one', efforts: [{ id: 'high', name: 'High', description: 'Deep' }] }] })
  } finally { store.close() }
})

it('rejects a team owner outside the selected members and a revision that does not match creation or update', () => {
  const store = new MeetingStore(':memory:')
  try {
    const roster = new ProjectRoster(new Context(), { store, modelCatalogTimeoutMs: 100 })
    const author = store.saveEmployee({ id: brandString<EmployeeId>('author'), revision: 1,
      name: 'Author', responsibility: 'Develop', provider: 'vendor-a', model: 'm1' }, 0)
    expect(() => roster.saveTeam({ name: 'Team', memberIds: [author.id], ownerEmployeeId: brandString<EmployeeId>('other'), expectedRevision: 0 }, signal))
      .toThrow('The owner must be one of the selected members.')
    expect(() => roster.saveTeam({ id: brandString<ProjectTeamId>('team'), name: 'Team', memberIds: [author.id], expectedRevision: 0 }, signal))
      .toThrow('Create with revision zero and no id')
  } finally { store.close() }
})

it('refuses a stale team template or a cleared choice that still carries employees', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const ctx = new Context()
    ctx.provide('systemPrompt', { context: vi.fn(() => () => {}), getContextOrder: vi.fn(() => 7) })
    const teamContext = new ProjectTeamContext(ctx, { store })
    const session = { id: 'session', header: { origin: 'main' } } as unknown as Session
    expect(() => teamContext.select(session, { expectedRevision: 0, teamId: brandString<ProjectTeamId>('missing'), teamRevision: 1, employees: [] }, signal))
      .toThrow('The team template changed')
    expect(() => teamContext.select(session, { expectedRevision: 0, teamId: null, teamRevision: null,
      employees: [{ id: brandString<EmployeeId>('author'), revision: 1 }] }, signal)).toThrow('The team template changed')
    await expect(teamContext.current(session, signal)).resolves.toEqual({ revision: 0, team: null, employees: [] })
  } finally { store.close() }
})
