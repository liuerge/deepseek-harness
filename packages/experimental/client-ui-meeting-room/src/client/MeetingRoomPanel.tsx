/** Occupant of the meeting panel: the list page, or the detail page of the open meeting. */
import type { ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MeetingRoomInjected } from './meeting-records.ts'
import type { MeetingStoreProps } from './meeting-store.ts'
import { MeetingListPage } from './MeetingListPage.tsx'
import { MeetingDetailPage } from './MeetingDetailPage.tsx'
import { NS } from './locales.ts'

/** Root-scoped props of the meeting panel. */
export type MeetingRoomPanelProps = PropsRuntime<'main'>
  & MeetingStoreProps
  & InjectFace<MeetingRoomInjected>
  & PropsLocale<typeof NS>

/**
 * Render the meeting list, or the detail page of the meeting the reader opened.
 * @param props - viewing state, records and localized copy.
 * @returns the meeting panel.
 */
export function MeetingRoomPanel(props: MeetingRoomPanelProps): ReactElement {
  const selectedId = props.useStore(state => state.selectedId)
  if (selectedId === undefined) return <MeetingListPage {...props} />
  return <MeetingDetailPage {...props} meetingId={selectedId} />
}
