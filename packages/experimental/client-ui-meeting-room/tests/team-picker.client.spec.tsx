// @vitest-environment jsdom
/** Conversation-targeted choices retain explicit partial failures without dispatching work. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SlotTestRuntime, bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Employee, ProjectTeam, SelectSessionTeamInput } from '@deepseek-ai/dsh-meeting-room/types'
import { TeamPickerController } from '../src/client/team-picker.ts'
import { TeamPickerLabel, TeamPickerOption } from '../src/client/TeamPicker.tsx'
import { zh } from '../src/client/locales.ts'
import type { ComponentProps } from 'react'

afterEach(cleanup)

const employee: Employee = { id: 'worker' as Employee['id'], revision: 4, name: 'Writer',
  responsibility: 'Write evidence', provider: 'vendor-b', model: 'model-b' }
const team: ProjectTeam = { id: 'team' as ProjectTeam['id'], revision: 2, name: 'Delivery', memberIds: [employee.id] }

it('targets the chosen main conversation, retains saved defaults when board activation fails and clears without disabling tasks', async () => {
  const runtime = await SlotTestRuntime.create()
  const current = vi.fn(async () => ({ ok: true, value: { revision: 0, team: null, employees: [] } }))
  const select = vi.fn(async (_id: SessionId, _input: SelectSessionTeamInput, _signal: AbortSignal) =>
    ({ ok: true, value: { revision: 1, team, employees: [employee] } }))
  const setEnabled = vi.fn().mockResolvedValueOnce({ ok: false, error: { message: 'Unavailable' } })
    .mockResolvedValue({ ok: true, value: undefined })
  runtime.remote.provideNamespaces({ projectTeamContext: { current, select },
    projectDashboard: { roster: async () => ({ ok: true, value: { teams: [team], employees: [employee] } }) },
    agentTeams: { setEnabled } })
  const a = new TeamPickerController(runtime.ctx, 'main-a' as SessionId)
  const b = new TeamPickerController(runtime.ctx, 'main-b' as SessionId)
  try {
    await a.load(); await b.load()
    a.open(); await a.load()
    await a.choose(team)
    expect(select).toHaveBeenLastCalledWith('main-a', { expectedRevision: 0, teamId: team.id,
      teamRevision: 2, employees: [{ id: employee.id, revision: 4 }] }, expect.any(AbortSignal))
    expect(a.store.getSnapshot()).toMatchObject({ open: true, boardFailed: true, selection: { revision: 1, team } })
    expect(b.store.getSnapshot().selection.team).toBeNull()
    await a.choose(team)
    expect(select.mock.calls.at(-1)?.[1]).toMatchObject({ expectedRevision: 1 })
    expect(a.store.getSnapshot()).toMatchObject({ open: false, boardFailed: false })
    setEnabled.mockClear()
    await a.choose(null)
    expect(select.mock.calls.at(-1)?.[1]).toMatchObject({ teamId: null, teamRevision: null, employees: [] })
    expect(setEnabled).not.toHaveBeenCalled()
  } finally { await a.dispose(); await b.dispose(); await runtime.dispose() }
})

it('cancels the board request on disposal and refuses a second choice while it is pending', async () => {
  const runtime = await SlotTestRuntime.create()
  const entered = Promise.withResolvers<undefined>()
  const result = Promise.withResolvers<{ ok: true; value: undefined }>()
  const select = vi.fn(async () => ({ ok: true, value: { revision: 1, team, employees: [employee] } }))
  runtime.remote.provideNamespaces({
    projectTeamContext: { current: async () => ({ ok: true, value: { revision: 0, team: null, employees: [] } }), select },
    projectDashboard: { roster: async () => ({ ok: true, value: { teams: [team], employees: [employee] } }) },
    agentTeams: { setEnabled: (_id: SessionId, _enabled: boolean, signal: AbortSignal) => {
      entered.resolve(undefined)
      return new Promise((resolve, reject) => {
        const abort = (): void => { reject(signal.reason instanceof Error ? signal.reason : new Error('Request cancelled')) }
        signal.addEventListener('abort', abort, { once: true })
        result.promise.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
      })
    } },
  })
  const controller = new TeamPickerController(runtime.ctx, 'main' as SessionId)
  try {
    await controller.load()
    const choosing = controller.choose(team)
    await entered.promise
    const duplicate = controller.choose(null)
    expect(select).toHaveBeenCalledTimes(1)
    await controller.dispose()
    await Promise.all([choosing, duplicate])
    expect(controller.store.getSnapshot().selection.team?.id).toBe(team.id)
  } finally { result.resolve({ ok: true, value: undefined }); await controller.dispose(); await runtime.dispose() }
})

it('shows individual routes and a saved-choice activation failure, and requires a workspace before choosing', async () => {
  const runtime = await SlotTestRuntime.create()
  const controller = new TeamPickerController(runtime.ctx, 'main' as SessionId)
  const open = vi.fn()
  const closeMenu = vi.fn()
  try {
    render(<TeamPickerOption {...{ sessionId: undefined,
      useSessions: (selector: (value: { byId: object }) => unknown) => selector({ byId: {} }),
      open, closeMenu, t: makeTranslate(zh) } as ComponentProps<typeof TeamPickerOption>} />)
    fireEvent.click(screen.getByRole('menuitem'))
    expect(open).not.toHaveBeenCalled()
    cleanup()
    controller.store.update((state) => {
      state.open = true; state.teams = [team]; state.employees = [employee]; state.boardFailed = true
      state.selection = { revision: 1, team, employees: [employee] }
    })
    const choose = vi.fn(async () => {})
    render(<TeamPickerLabel {...{
      sessionId: 'main' as SessionId, useTeamPicker: bindSnapshotSelector(controller.store),
      useSessions: (selector: (value: { byId: object }) => unknown) => selector({ byId: {} }),
      useProjection: () => ({ enabled: false }), load: vi.fn(async () => {}), open, close: vi.fn(), choose,
      configure: vi.fn(), t: makeTranslate(zh),
    } as ComponentProps<typeof TeamPickerLabel>} />)
    expect(screen.getByText('Writer · vendor-b / model-b')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(zh['team-mode.board-failed'])
    fireEvent.click(screen.getByRole('button', { name: '使用 Delivery' }))
    expect(choose).toHaveBeenLastCalledWith(team)
  } finally { cleanup(); await controller.dispose(); await runtime.dispose() }
})
