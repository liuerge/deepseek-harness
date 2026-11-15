/**
 * Browser registration of the meeting panel: the sidebar entry, the main
 * panel and the copy both pages read.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { MEETINGS, MEETING_DETAILS } from './demo-data.ts'
import { de, en, es, fr, ja, NS, pt, ru, zh, type MeetingRoomKey } from './locales.ts'
import { MeetingPanelIcon } from './MeetingPanelIcon.tsx'
import { MeetingRoomPanel } from './MeetingRoomPanel.tsx'
import { createMeetingStore } from './meeting-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Meeting list, meeting detail and sidebar entry copy. */
    'meetingRoom': MeetingRoomKey
  }
}

/** Identity of the meeting panel in the sidebar and in the main slot. */
const PANEL_ID = 'meeting-room' as MainPanelId

/** Services the registration reads. */
export const inject = ['slots', 'locale']

/**
 * Register the meeting panel, its sidebar entry and its copy.
 * @param ctx - browser services used by these contributions.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'client-ui-meeting-room: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    store: createMeetingStore(),
    inject: () => ({ meetings: MEETINGS, details: MEETING_DETAILS }),
  }, MeetingRoomPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    locale: NS,
    label: () => t('panel'),
  }, MeetingPanelIcon))
}
