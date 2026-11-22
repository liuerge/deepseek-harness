// @vitest-environment jsdom

/** Team picker details: header availability, modal actions and controller failure isolation. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SlotTestRuntime, bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ComponentProps } from 'react'
import type { Employee, EmployeeId, ProjectTeam } from '@deepseek-ai/dsh-experimental-meeting-room/types'
import { TeamPickerController, mountTeamPicker } from '../src/client/team-picker.ts'
import { TeamPickerHeader, TeamPickerLabel, TeamPickerOption } from '../src/client/TeamPicker.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const employee: Employee = { id: 'worker' as Employee['id'], revision: 4, name: 'Writer',
  responsibility: 'Write evidence', provider: 'vendor-b', model: 'model-b' }
const team: ProjectTeam = { id: 'team' as ProjectTeam['id'], revision: 2, name: 'Delivery', memberIds: [employee.id] }

function sessions(summary: object | undefined) {
  return (selector: (value: { byId: Record<string, unknown> }) => unknown) =>
    selector({ byId: summary === undefined ? {} : { main: summary } })
}

it('hides the header action for unknown conversations and shows it for an active main conversation', () => {
  const open = vi.fn()
  const { store } = new TeamPickerController(undefined as never, 'main' as SessionId)
  const props = {
    sessionId: 'main' as SessionId, useTeamPicker: bindSnapshotSelector(store),
    useSessions: sessions({ blank: false, origin: 'main' }), useProjection: () => ({ enabled: false }),
    load: vi.fn(async () => {}),
    open, close: vi.fn(), choose: vi.fn(async () => {}), configure: vi.fn(), t: makeTranslate(zh),
  } as ComponentProps<typeof TeamPickerHeader>
  const hiddenProps = { ...props, useSessions: sessions(undefined) } as ComponentProps<typeof TeamPickerHeader>
  const { rerender } = render(<TeamPickerHeader {...hiddenProps} />)
  expect(screen.queryByRole('button')).toBeNull()
  rerender(<TeamPickerHeader {...props} />)
  fireEvent.click(screen.getByRole('button', { name: zh['team-mode.title'] }))
  expect(open).toHaveBeenCalledTimes(1)
})

it('offers a disabled choice before a workspace exists and hides the option on child conversations', () => {
  const open = vi.fn()
  const dismiss = vi.fn()
  render(<TeamPickerOption {...{ sessionId: undefined, useSessions: sessions(undefined), open, dismiss,
    t: makeTranslate(zh) } as ComponentProps<typeof TeamPickerOption>} />)
  const item = screen.getByRole('menuitem')
  expect(item.getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(item)
  expect(open).not.toHaveBeenCalled()
  cleanup()
  render(<TeamPickerOption {...{ sessionId: 'main' as SessionId,
    useSessions: (selector: (value: { byId: Record<string, unknown> }) => unknown) =>
      selector({ byId: { main: { origin: 'subagent' } } }), open, dismiss,
    t: makeTranslate(zh) } as ComponentProps<typeof TeamPickerOption>} />)
  expect(screen.queryByRole('menuitem')).toBeNull()
})

it('reloads the roster from the modal and selects a team before saving', async () => {
  const load = vi.fn(async () => {})
  const choose = vi.fn(async () => {})
  const openCount = vi.fn()
  const controller = new TeamPickerController(undefined as never, 'main' as SessionId)
  controller.store.update((state) => {
    state.open = true; state.teams = [team]; state.employees = [employee]
    state.selection = { revision: 1, team, employees: [employee] }
  })
  render(<TeamPickerLabel {...{
    sessionId: 'main' as SessionId, useTeamPicker: bindSnapshotSelector(controller.store),
    useSessions: sessions({ blank: false, origin: 'main' }), useProjection: () => ({ enabled: true }),
    load, open: () => { openCount() }, close: vi.fn(), choose, configure: vi.fn(), t: makeTranslate(zh),
  } as ComponentProps<typeof TeamPickerLabel>} />)
  const trigger = screen.getByRole('button', { name: /团队模式 · Delivery/ })
  fireEvent.click(trigger)
  expect(openCount).toHaveBeenCalledTimes(1)
  // The modal body lists team members and refreshes on demand.
  expect(screen.getByText(new RegExp(zh['roster.members']))).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh['project.refresh'] }))
  expect(load).toHaveBeenCalledTimes(2)
  // Selecting radios switches the pending choice and the save label.
  fireEvent.click(screen.getByRole('radio', { name: /Delivery/ }))
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(zh['team-mode.no-team']) }))
  fireEvent.click(screen.getByRole('button', { name: zh['team-mode.clear'] }))
  expect(choose).toHaveBeenLastCalledWith(null)
  await controller.dispose()
})

it('isolates read failures, missing members, duplicate writes and disposal', async () => {
  const runtime = await SlotTestRuntime.create()
  const current = vi.fn().mockRejectedValueOnce(new Error('preference read failed'))
    .mockResolvedValue({ ok: true as const, value: { revision: 0, team: null, employees: [] } })
  const select = vi.fn(async () => { throw new Error('write failed') })
  runtime.remote.provideNamespaces({
    projectTeamContext: { current, select },
    projectDashboard: { roster: async () => ({ ok: true as const, value: { teams: [team], employees: [employee] } }) },
    agentTeams: { setEnabled: vi.fn(async () => ({ ok: true as const, value: undefined })) },
  })
  const selectPanel = vi.fn()
  runtime.ctx.provide('layout', { selectPanel } as never)
  await runtime.declare({
    'conversation.hero.options': { kind: 'list', scope: 'session' },
    'conversation.input.model.options': { kind: 'list', scope: 'session' },
    'conversation.session.header.actions': { kind: 'list', scope: 'session' },
  })
  mountTeamPicker(runtime.ctx)
  try {
    // A rejected preference read marks the picker failed with the message.
    const suffixEntry = runtime.slots.entries('conversation.hero.options')[0]
    const picker = (suffixEntry?.inject as ((sessionId: SessionId) => Record<string, unknown>) | undefined)?.('main' as SessionId) as {
      hooks: { teamPicker: { getSnapshot: () => { failed: boolean; failure: string | null; open: boolean } } }
      load: () => Promise<void>
      open: () => void
      close: () => void
      choose: (team: ProjectTeam | null) => Promise<void>
      configure: () => void
    }
    await picker.load()
    expect(picker.hooks.teamPicker.getSnapshot()).toMatchObject({ failed: true, failure: 'preference read failed' })
    picker.close()
    expect(picker.hooks.teamPicker.getSnapshot().open).toBe(false)
    // A clean read enables choosing.
    await picker.load()
    expect(picker.hooks.teamPicker.getSnapshot().failed).toBe(false)
    // Configure routes to the roster panel and closes the modal.
    picker.open()
    await picker.load()
    picker.configure()
    expect(selectPanel).toHaveBeenCalledWith('project-workspace')
    expect(picker.hooks.teamPicker.getSnapshot().open).toBe(false)
    // A write rejection keeps the modal state and marks the failure.
    await picker.choose(team)
    expect(picker.hooks.teamPicker.getSnapshot().failed).toBe(true)
    // A refused write (failed state) resolves without contacting the remote.
    await picker.choose(team)
  } finally { await runtime.dispose() }
})

it('refuses a choice whose team carries unknown employees without writing', async () => {
  const runtime = await SlotTestRuntime.create()
  const select = vi.fn(async () => ({ ok: true as const, value: { revision: 1, team, employees: [employee] } }))
  runtime.remote.provideNamespaces({
    projectTeamContext: { current: async () => ({ ok: true as const, value: { revision: 0, team: null, employees: [] } }), select },
    projectDashboard: { roster: async () => ({ ok: true as const, value: { teams: [{ ...team, memberIds: ['ghost'] }], employees: [employee] } }) },
    agentTeams: { setEnabled: vi.fn(async () => ({ ok: true as const, value: undefined })) },
  })
  const controller = new TeamPickerController(runtime.ctx, 'main' as SessionId)
  try {
    await controller.load()
    await controller.choose({ ...team, memberIds: [brandString<EmployeeId>('ghost')] })
    expect(controller.store.getSnapshot().failed).toBe(true)
    expect(select).not.toHaveBeenCalled()
  } finally { await controller.dispose(); await runtime.dispose() }
})
