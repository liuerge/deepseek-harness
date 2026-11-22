// @vitest-environment jsdom

/** Main-conversation process requests use exact menu targets and retained editor bindings. */
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { expect, it, vi } from 'vitest'
import * as browserPlugin from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import type { ProjectInjected } from '../src/client/ProjectPage.tsx'
import type { RosterInjected } from '../src/client/RosterPanel.tsx'
import type { SessionMeetingsInjected } from '../src/client/SessionMeetings.tsx'
import type { MenuContribution } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MeetingRecord, RosterConnection } from '@deepseek-ai/dsh-experimental-meeting-room/types'
import type { TeamPickerInjected } from '../src/client/TeamPicker.tsx'

it('contributes session meeting actions and routes project corrections and continuation to the original main conversation', async () => {
  expect(() => { hostApply() }).not.toThrow()
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('locale', new LocaleRuntime(runtime.ctx))
  const openSession = vi.fn()
  const initialize = vi.fn<(binding: object, options: { prompt: string; whenDraftExists: string }) => 'applied'>(() => 'applied')
  const selectPanel = vi.fn()
  runtime.ctx.provide('uiWorkspace', { startSession: vi.fn(), openSession } as never)
  runtime.ctx.provide('conversation', { input: { requestDraftInitialization: initialize } } as never)
  runtime.ctx.provide('layout', { selectPanel } as never)
  const menus: MenuContribution<'sessionHeader'>[] = []
  runtime.ctx.provide('contextMenus', { notify: vi.fn(), register: (menu: MenuContribution<'sessionHeader'>) => {
    menus.push(menu)
    return () => { menus.splice(menus.indexOf(menu), 1) }
  } } as never)
  vi.spyOn(runtime.ctx.sessions, 'binding').mockReturnValue({ sessionId: 'main-root' } as never)
  const confirmPlan = vi.fn(async () => ({ ok: true, value: {} }))
  const confirmAcceptance = vi.fn(async () => ({ ok: true, value: { projectId: 'approved-run' } }))
  const checkpoint = Promise.withResolvers<true>()
  const checkpointDelivered = Promise.withResolvers<true>()
  const timelineResult = { ok: true as const, value: [{ sessionId: 'main-root', projectId: 'approved-run', state: 'released', checkpoint: 43 }] }
  const firstTimeline = Promise.withResolvers<typeof timelineResult>()
  const timeline = vi.fn(async () => timelineResult).mockImplementationOnce(() => firstTimeline.promise)
  const meetings = vi.fn<(id: string, signal: AbortSignal) => Promise<{ ok: true; value: MeetingRecord[] }>>(
    async () => ({ ok: true, value: [] }),
  )
  const directory = Promise.withResolvers<{ ok: true; value: RosterConnection[] }>()
  const connections = vi.fn((signal: AbortSignal) => {
    signal.addEventListener('abort', () => { directory.resolve({ ok: true, value: [] }) }, { once: true })
    return directory.promise
  })
  runtime.remote.provideNamespaces({ projectRoster: {
    connections,
    saveEmployee: async () => ({ ok: true, value: {} }), saveTeam: async () => ({ ok: true, value: {} }),
  }, projectDashboard: {
    timeline,
    follow: async function* (signal: AbortSignal) {
      yield true
      await Promise.race([checkpoint.promise, new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })])
      if (!signal.aborted) yield true
      checkpointDelivered.resolve(true)
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    },
    plans: async () => ({ ok: true, value: [] }),
    roster: async () => ({ ok: true, value: { employees: [], teams: [] } }), confirmPlan, confirmAcceptance, meetings,
  }, projectTeamContext: {
    current: async () => ({ ok: true, value: { revision: 0, team: null, employees: [] } }),
  }, agentTeams: { setEnabled: vi.fn(async () => ({ ok: true, value: undefined })) },
  session: { openWorkspacePath: vi.fn(async () => ({ ok: true, value: { opened: true } })) } })
  vi.spyOn(runtime.ctx.remote, '$mount').mockResolvedValue(async () => {})
  await runtime.declare({ main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' },
    'conversation.hero.options': { kind: 'list', scope: 'session' },
    'conversation.input.model.options': { kind: 'list', scope: 'session' },
  })
  const handle = await runtime.mount(browserPlugin)
  try {
    await vi.waitFor(() => { expect(timeline).toHaveBeenCalled() })
    const priorCalls = timeline.mock.calls.length
    checkpoint.resolve(true)
    await checkpointDelivered.promise
    firstTimeline.resolve(timelineResult)
    await vi.waitFor(() => { expect(timeline.mock.calls.length).toBeGreaterThan(priorCalls) })
    const pickerEntry = runtime.slots.entries('conversation.hero.options')[0]
    const injectPicker = pickerEntry?.inject as ((sessionId: SessionId) => TeamPickerInjected) | undefined
    const picker = injectPicker?.('main-root' as SessionId)
    if (!picker) throw new Error('Expected team picker injection')
    await picker.load()
    expect(picker.hooks.teamPicker.getSnapshot().failed).toBe(false)
    const projectEntry = runtime.slots.entries('main').find(entry => entry.options.key === 'project-workspace')
    const project = projectEntry?.inject?.() as (Record<string, unknown> & ProjectInjected) | undefined
    if (!project) throw new Error('Expected project injection')
    const rosterEntry = runtime.slots.entries('main').find(entry => entry.options.key === 'project-roster')
    const roster = rosterEntry?.inject?.() as (Record<string, unknown> & RosterInjected) | undefined
    if (!roster) throw new Error('Expected roster injection')
    await vi.waitFor(() => { expect(project.hooks.catalog.getSnapshot().loading).toBe(false) })
    expect(project.hooks.catalog.getSnapshot().failed).toBe(false)
    expect(project.hooks.catalog.getSnapshot().connectionsLoading).toBe(true)
    connections.mockResolvedValueOnce({ ok: true, value: [{ id: 'new-route', name: 'New route', models: [], failed: false }] })
    runtime.remote.emit('settings/document-updated', [])
    directory.resolve({ ok: true, value: [] })
    await vi.waitFor(() => { expect(project.hooks.catalog.getSnapshot().connections[0]?.id).toBe('new-route') })
    expect(connections).toHaveBeenCalledTimes(2)
    await project.confirmPlan('reviewed-plan', 3)
    expect(confirmPlan).toHaveBeenCalledWith('reviewed-plan', 3, expect.any(AbortSignal))
    await vi.waitFor(() => { expect(project.hooks.catalog.getSnapshot().loading).toBe(false) })
    await project.approveAcceptance('approved-run', 42)
    expect(confirmAcceptance).toHaveBeenCalledWith('approved-run', 42, expect.any(AbortSignal))
    project.continueProject('approved-run', 43)
    expect(openSession).toHaveBeenLastCalledWith('main-root')
    expect(initialize.mock.calls.at(-1)?.[1].prompt).toContain('"expectedCheckpoint":43')
    expect(initialize.mock.calls.at(-1)?.[1].whenDraftExists).toBe('append')
    project.openMain('main-root', 'approved-run')
    expect(openSession).toHaveBeenLastCalledWith('main-root')
    expect(initialize.mock.calls.at(-1)?.[1].prompt).toContain('approved-run')
    project.openWorker('worker-parent', 'worker-child')
    expect(openSession).toHaveBeenLastCalledWith({ parentSessionId: 'worker-parent', childSessionId: 'worker-child', mode: 'continuable' })
    const menu = menus[0]
    if (!menu) throw new Error('Expected session-header meeting menu')
    const actions = await menu.resolve({ sessionId: 'menu-main' as SessionId }, new AbortController().signal)
    await actions.find(action => action.id === 'session-meetings')?.run?.()
    expect(selectPanel).toHaveBeenLastCalledWith('meeting-room')
    expect(meetings).toHaveBeenLastCalledWith('menu-main', expect.any(AbortSignal))
    const meetingEntry = runtime.slots.entries('main').find(entry => entry.options.key === 'meeting-room')
    const meetingFace = meetingEntry?.inject?.() as (Record<string, unknown> & SessionMeetingsInjected) | undefined
    if (!meetingFace) throw new Error('Expected meeting panel')
    await vi.waitFor(() => { expect(meetingFace.hooks.meetings.getSnapshot().loading).toBe(false) })
    expect(meetingFace.hooks.meetings.getSnapshot().sessionId).toBe('menu-main')
    const first = Promise.withResolvers<{ ok: true; value: MeetingRecord[] }>()
    const second = Promise.withResolvers<{ ok: true; value: MeetingRecord[] }>()
    meetings.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    const a = await menu.resolve({ sessionId: 'main-a' as SessionId }, new AbortController().signal)
    await a.find(action => action.id === 'session-meetings')?.run?.()
    const firstSignal = meetings.mock.calls.at(-1)?.[1]
    const b = await menu.resolve({ sessionId: 'main-b' as SessionId }, new AbortController().signal)
    await b.find(action => action.id === 'session-meetings')?.run?.()
    expect(firstSignal?.aborted).toBe(true)
    const record = (id: string): MeetingRecord => ({ id: id as MeetingRecord['id'], sessionId: id,
      originSessionId: id, requirement: id, state: 'awaiting-decision', createdAt: 0, rounds: [], decisions: [] })
    second.resolve({ ok: true, value: [record('main-b')] })
    await vi.waitFor(() => { expect(meetingFace.hooks.meetings.getSnapshot().meetings[0]?.requirement).toBe('main-b') })
    first.resolve({ ok: true, value: [record('main-a')] })
    await first.promise
    expect(meetingFace.hooks.meetings.getSnapshot().sessionId).toBe('main-b')
    expect(meetingFace.hooks.meetings.getSnapshot().meetings[0]?.requirement).toBe('main-b')
    project.adoptPlan('legacy-plan', 1)
    const panels = runtime.slots.entries('sidebar.panellist')
    expect(panels).toHaveLength(2)
    expect(panels.map(entry => entry.options.id)).toEqual(['project-workspace', 'project-roster'])
  } finally { await handle.dispose(); await runtime.dispose() }
  expect(menus).toHaveLength(0)
})
