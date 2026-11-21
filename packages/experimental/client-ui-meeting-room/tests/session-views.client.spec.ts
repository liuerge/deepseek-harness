// @vitest-environment jsdom

/** Meeting panel actions and session-header menu route through the retained main conversation. */
import { expect, it, vi } from 'vitest'
import { mountPanel } from './support/panel-runtime.client.ts'
import { zh } from '../src/client/locales.ts'
import type { Mock } from 'vitest'

/** Last prompt argument recorded on a draft-initialization mock. */
function recordedPrompt(mock: Mock): string {
  return (mock.mock.calls.at(-1)?.[1] as { prompt: string } | undefined)?.prompt ?? ''
}

it('refreshes, opens and prepares meetings through the exact main conversation', async () => {
  const mounted = await mountPanel({
    meetings: vi.fn().mockRejectedValueOnce(new Error('meetings down'))
      .mockImplementationOnce(async () => ({ ok: false as const, error: { message: 'meetings unavailable' } }))
      .mockResolvedValue({ ok: true as const, value: [] }),
  })
  const { runtime, handle, meetingFace, openSession, initialize, menus, meetings } = mounted
  try {
    // The session-header menu binds the retained query to the exact conversation.
    const menu = menus.find(entry => entry.id === 'meeting-room.session')
    expect(menu).toBeTruthy()
    const actions = await menu!.resolve({ sessionId: 'menu-main' } as never, new AbortController().signal)
    // A rejected meetings read surfaces the failure state.
    await actions.find(action => action.id === 'session-meetings')?.run?.()
    await vi.waitFor(() => { expect(meetingFace.hooks.meetings.getSnapshot().failed).toBe(true) })
    // A not-ok read fails the same way, then a clean read recovers.
    meetingFace.refresh()
    await vi.waitFor(() => { expect(meetings).toHaveBeenCalledTimes(2) })
    meetingFace.refresh()
    await vi.waitFor(() => { expect(meetingFace.hooks.meetings.getSnapshot().failed).toBe(false) })
    // Opening the main conversation and a participant child.
    meetingFace.openMain()
    expect(openSession).toHaveBeenLastCalledWith('menu-main')
    meetingFace.openParticipant('menu-main', 'participant-1')
    expect(openSession).toHaveBeenLastCalledWith({ parentSessionId: 'menu-main', childSessionId: 'participant-1', mode: 'continuable' })
    // Preparing a requirement edit writes a draft into the retained conversation.
    meetingFace.prepareMeeting()
    expect(initialize).toHaveBeenCalled()
    await actions.find(action => action.id === 'start-meeting')?.run?.()
    expect(recordedPrompt(initialize)).toContain(zh['meeting.prompt'])
    void runtime
  } finally { await handle.dispose(); await runtime.dispose() }
})

it('notifies instead of throwing when the retained editor cannot accept a meeting draft', async () => {
  const mounted = await mountPanel({ initialize: vi.fn(() => 'blocked' as const) })
  const { runtime, handle, meetingFace, notify, menus } = mounted
  try {
    const menu = menus.find(entry => entry.id === 'meeting-room.session')
    const actions = await menu!.resolve({ sessionId: 'menu-main' } as never, new AbortController().signal)
    await actions.find(action => action.id === 'session-meetings')?.run?.()
    await vi.waitFor(() => { expect(meetingFace.hooks.meetings.getSnapshot().loading).toBe(false) })
    meetingFace.prepareMeeting()
    expect(notify).toHaveBeenCalledWith(zh['project.error'])
  } finally { await handle.dispose(); await runtime.dispose() }
})
