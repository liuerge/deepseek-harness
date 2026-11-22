// @vitest-environment jsdom

/** Panel registration routes every action to its exact destination and reports failures loudly. */
import { expect, it, vi, type Mock } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { EmployeeId } from '@deepseek-ai/dsh-experimental-meeting-room/types'
import { mountPanel } from './support/panel-runtime.client.ts'
import { zh } from '../src/client/locales.ts'

/** Last prompt argument recorded on a start-session or draft-initialization mock. */
function recordedPrompt(mock: Mock): string {
  return (mock.mock.calls.at(-1)?.[1] as { prompt: string } | undefined)?.prompt ?? ''
}

/** Resolve a slot label option, which may be a fixed string or a render callback. */
function panelLabel(label: unknown): string | undefined {
  return typeof label === 'function' ? (label as () => string)() : label as string | undefined
}

it('routes every panel action to its exact destination', async () => {
  const mounted = await mountPanel()
  const { runtime, handle, project, rosterFace, openSession, initialize, selectPanel, startSession } = mounted
  try {
    await vi.waitFor(() => { expect(project.hooks.catalog.getSnapshot().loading).toBe(false) })
    expect(project.hooks.catalog.getSnapshot().failed).toBe(false)
    // Sidebar entries carry their localized labels.
    const panels = runtime.slots.entries('sidebar.panellist')
    expect(panels.map(entry => panelLabel(entry.options.label))).toEqual([zh['project.title'], zh['roster.title']])
    // Session panel section and its actions.
    const section = runtime.slots.entries('conversation.session.panel.section')[0]
    expect(panelLabel(section?.options.label)).toBe(zh['project.session-tasks'])
    const sectionFace = section?.inject?.() as { hooks: { catalog: { getSnapshot: () => { records: unknown[] } } } }
    expect(sectionFace.hooks.catalog.getSnapshot().records).toHaveLength(1)
    const sectionActions = runtime.slots.entries('conversation.session.panel.section.actions')[0]
    const actionsFace = sectionActions?.inject?.() as { refresh: () => void; openWorkspace: () => void }
    actionsFace.openWorkspace()
    expect(selectPanel).toHaveBeenLastCalledWith('project-workspace')
    expect(() => { actionsFace.refresh() }).not.toThrow()
    // Roster mutations and delegation.
    await expect(rosterFace.saveEmployee({ expectedRevision: 0, name: 'Worker', responsibility: 'Work',
      provider: 'vendor-a', model: 'm1' })).resolves.toBe(true)
    await expect(rosterFace.saveTeam({ expectedRevision: 0, name: 'Team', memberIds: [brandString<EmployeeId>('a')] })).resolves.toBe(true)
    rosterFace.delegateTeam('team-1')
    expect(startSession).toHaveBeenCalledOnce()
    expect(recordedPrompt(startSession)).toContain('teamId="team-1"')
    // Requirement routing: edit, run, prepare, adopt, roster jump.
    project.editPlan('plan-1', 3)
    expect(openSession).toHaveBeenLastCalledWith('main-root')
    expect((initialize.mock.calls.at(-1)?.[1] as { prompt: string } | undefined)?.prompt).toContain('"expectedRevision":3')
    project.runPlan('plan-1', 3)
    expect(recordedPrompt(initialize)).toContain('"planRevision":3')
    project.continueProject('run-1', 2)
    expect(recordedPrompt(initialize)).toContain('"expectedCheckpoint":2')
    project.preparePlan()
    expect(startSession).toHaveBeenLastCalledWith(undefined, expect.objectContaining({ prompt: zh['plan.preparePrompt'] }))
    project.openRoster()
    expect(selectPanel).toHaveBeenLastCalledWith('project-roster')
    // New project prompts: header composition with and without content.
    project.newProject({ name: '新项目', instructions: '指令' })
    const prompt = recordedPrompt(startSession)
    expect(prompt).toContain('新项目')
    expect(prompt).toContain('指令')
    project.newProject()
    expect(startSession).toHaveBeenLastCalledWith(undefined, expect.objectContaining({ prompt: zh['plan.preparePrompt'] }))
    project.newProject({ name: '  ', instructions: ' ' })
    expect(startSession).toHaveBeenLastCalledWith(undefined, expect.objectContaining({ prompt: zh['plan.preparePrompt'] }))
    // Artifact reads resolve through the remote face.
    await expect(project.readArtifact('main-root', 'build/hello.txt')).resolves.toEqual({ path: 'p', content: 'text' })
    // Conversation artifacts view contribution.
    const view = runtime.slots.entries('conversation.view')[0]
    const viewFace = view?.inject?.() as { openWorkspace: () => void; confirmPlan: (id: string, revision: number) => Promise<void> }
    viewFace.openWorkspace()
    expect(selectPanel).toHaveBeenLastCalledWith('project-workspace')
    await expect(viewFace.confirmPlan('plan-1', 1)).resolves.toBeUndefined()
  } finally { await handle.dispose(); await runtime.dispose() }
})

it('reports refresh, confirm, save and read failures without losing the panel', async () => {
  const mounted = await mountPanel({
    timeline: vi.fn().mockRejectedValueOnce(new Error('stream down'))
      .mockImplementationOnce(async () => ({ ok: false as const, error: { message: 'plans unavailable' } }))
      .mockResolvedValue({ ok: true as const, value: [] }),
    connections: vi.fn(async () => { throw new Error('discovery down') }),
    confirmPlan: vi.fn(async () => { throw new Error('confirm rejected') }),
    saveEmployee: vi.fn(async () => { throw new Error('save rejected') }),
    readProjectArtifact: vi.fn(async () => ({ ok: false as const, error: { message: 'not registered' } })),
    initialize: vi.fn(() => 'blocked' as const),
  })
  const { runtime, handle, project, rosterFace, notify } = mounted
  try {
    await vi.waitFor(() => { expect(project.hooks.catalog.getSnapshot().failed).toBe(true) })
    // Connections discovery failure is surfaced separately from the timeline.
    runtime.remote.emit('settings/document-updated', [])
    await vi.waitFor(() => { expect(project.hooks.catalog.getSnapshot().connectionsFailed).toBe(true) })
    // Confirmed-plan writes report failure instead of throwing.
    await expect(project.confirmPlan('plan-1', 1)).resolves.toBeUndefined()
    await vi.waitFor(() => { expect(project.hooks.catalog.getSnapshot().failed).toBe(true) })
    // Roster saves report failure instead of throwing.
    await expect(rosterFace.saveEmployee({ expectedRevision: 0, name: 'Worker', responsibility: 'Work',
      provider: 'vendor-a', model: 'm1' })).resolves.toBe(false)
    // Artifact reads surface the localized read failure.
    await expect(project.readArtifact('main-root', 'p')).rejects.toThrow()
    // A blocked main conversation draft falls back to the menu notification.
    project.openMain('main-root', 'run-1')
    await vi.waitFor(() => { expect(notify).toHaveBeenCalled() })
  } finally { await handle.dispose(); await runtime.dispose() }
})

it('serializes roster saves and refreshes after a successful write', async () => {
  let releaseSave!: () => void
  const gate = new Promise<void>((resolve) => { releaseSave = resolve })
  let calls = 0
  const mounted = await mountPanel({
    saveEmployee: vi.fn(async () => { calls += 1; await gate; return { ok: true as const, value: {} } }),
  })
  const { runtime, handle, project, rosterFace, timeline } = mounted
  try {
    await vi.waitFor(() => { expect(project.hooks.catalog.getSnapshot().loading).toBe(false) })
    const refreshes = timeline.mock.calls.length
    const first = rosterFace.saveEmployee({ expectedRevision: 0, name: 'Worker', responsibility: 'Work',
      provider: 'vendor-a', model: 'm1' })
    await expect(rosterFace.saveEmployee({ expectedRevision: 0, name: 'Other', responsibility: 'Work',
      provider: 'vendor-a', model: 'm1' })).resolves.toBe(false)
    releaseSave()
    await expect(first).resolves.toBe(true)
    expect(calls).toBe(1)
    await vi.waitFor(() => { expect(timeline.mock.calls.length).toBeGreaterThan(refreshes) })
  } finally { await handle.dispose(); await runtime.dispose() }
})
