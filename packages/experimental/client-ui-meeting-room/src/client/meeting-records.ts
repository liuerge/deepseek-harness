/** Records the meeting pages read from their registrant. */
import type { MeetingDetail, MeetingSummary } from './demo-data.ts'

/** Records the meeting pages show. */
export interface MeetingRoomInjected {
  /** Meetings the pages list and look their summary up in. */
  readonly meetings: readonly MeetingSummary[]
  /** Full records of the meetings that have one. */
  readonly details: Readonly<Record<string, MeetingDetail>>
}
