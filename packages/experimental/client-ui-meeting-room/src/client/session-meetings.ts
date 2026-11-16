/** Session-header meeting menu and its actual persisted discussion view. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionMeetings, type MeetingCatalog } from './SessionMeetings.tsx'
import { NS } from './locales.ts'
import { prepareMainPrompt } from './session-navigation.ts'

/**
 * Register session-specific meeting requests and a cancellable retained-record query.
 * @param ctx - Meeting Remote, menu, layout and conversation services owned by this plugin.
 */
export function mountSessionMeetings(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  const panel = 'meeting-room' as MainPanelId
  const catalog = createSnapshotStore<MeetingCatalog>({ meetings: [], loading: false, failed: false })
  const pending = new Set<Promise<void>>()
  let current: AbortController | undefined
  let closing = false
  ctx.effect(() => async () => {
    closing = true
    current?.abort()
    await Promise.allSettled(pending)
  })
  const load = (sessionId: string): void => {
    if (closing) return
    current?.abort()
    const controller = new AbortController()
    current = controller
    catalog.update((state) => {
      if (state.sessionId !== sessionId) state.meetings = []
      state.sessionId = sessionId
      state.loading = true
      state.failed = false
    })
    const query = (async () => {
      try {
        const result = await ctx.remote.projectDashboard.meetings(sessionId, controller.signal)
        if (controller.signal.aborted) return
        if (result.ok) catalog.set({ sessionId, meetings: result.value, loading: false, failed: false })
        else catalog.update((state) => { state.loading = false; state.failed = true })
      } catch (_error) {
        if (!controller.signal.aborted) catalog.update((state) => { state.loading = false; state.failed = true })
      }
    })().finally(() => { pending.delete(query) })
    pending.add(query)
  }
  const prepare = (sessionId: string): void => {
    prepareMainPrompt(ctx, sessionId, t('meeting.prompt'), t('project.error'))
  }
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: panel, locale: NS,
    inject: () => ({ hooks: { meetings: catalog },
      refresh: () => { const id = catalog.getSnapshot().sessionId; if (id) load(id) },
      openMain: () => { const id = catalog.getSnapshot().sessionId; if (id) ctx.uiWorkspace.openSession(id as SessionId) },
      prepareMeeting: () => {
        const id = catalog.getSnapshot().sessionId
        if (!id) return
        try { prepare(id) }
        catch (_error) { ctx.contextMenus.notify(t('project.error')) }
      },
      openParticipant: (parent: string, child: string) => {
        ctx.uiWorkspace.openSession({ parentSessionId: parent as SessionId, childSessionId: child as SessionId, mode: 'continuable' })
      },
    }),
  }, SessionMeetings))
  ctx.effect(() => ctx.contextMenus.register({
    id: 'meeting-room.session', target: 'sessionHeader', order: 350,
    observe: () => [ctx.locale, ctx.sessions.list],
    resolve: ({ sessionId }) => ctx.sessions.list.getSnapshot().byId[sessionId]?.origin === 'subagent' ? [] : [{
      id: 'start-meeting', label: t('meeting.prepare'), failureLabel: t('project.error'), run: () => { prepare(sessionId) },
    }, {
      id: 'session-meetings', label: t('meeting.session-title'), run: () => { load(sessionId); ctx.layout.selectPanel(panel) },
    }],
  }))
}
