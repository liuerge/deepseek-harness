/** Presentation helpers that turn meeting records into localized text. */
import type { MeetingRole, MeetingStage, MeetingStatus } from './demo-data.ts'
import type { MeetingRoomKey } from './locales.ts'
import type { MeetingFilter } from './meeting-store.ts'

/** Translate function of the meeting namespace. */
type Translate = (key: MeetingRoomKey, params?: Record<string, unknown>) => string

const STATUS_KEYS = {
  running: 'status.running',
  awaiting: 'status.awaiting',
  pending: 'status.pending',
  completed: 'status.completed',
  blocked: 'status.blocked',
  paused: 'status.paused',
} satisfies Record<MeetingStatus, MeetingRoomKey>

const STAGE_KEYS = {
  independent: 'detail.stage.independent',
  discussion: 'detail.stage.discussion',
  synthesis: 'detail.stage.synthesis',
  final: 'detail.stage.final',
  published: 'detail.stage.published',
} satisfies Record<MeetingStage, MeetingRoomKey>

const ROLE_KEYS = {
  host: 'member.host',
  participant: 'member.participant',
  observer: 'member.observer',
} satisfies Record<MeetingRole, MeetingRoomKey>

const PLAN_STATE_KEYS = {
  draft: 'detail.plan.draft',
  pending: 'detail.plan.pending',
  done: 'detail.plan.published',
} satisfies Record<'draft' | 'pending' | 'done', MeetingRoomKey>

const REVIEW_STATE_KEYS = {
  draft: 'detail.review.draft',
  pending: 'detail.review.pending',
  done: 'detail.review.done',
} satisfies Record<'draft' | 'pending' | 'done', MeetingRoomKey>

/**
 * Name the lifecycle state of a meeting.
 * @param status - Lifecycle state of the meeting.
 * @returns the dictionary key naming that state.
 */
export function statusKey(status: MeetingStatus): MeetingRoomKey {
  return STATUS_KEYS[status]
}

/**
 * Name one stage of the meeting flow.
 * @param stage - Stage of the meeting.
 * @returns the dictionary key naming that stage.
 */
export function stageKey(stage: MeetingStage): MeetingRoomKey {
  return STAGE_KEYS[stage]
}

/**
 * Name the permission a member holds.
 * @param role - Permission of the member.
 * @returns the dictionary key naming that permission.
 */
export function roleKey(role: MeetingRole): MeetingRoomKey {
  return ROLE_KEYS[role]
}

/**
 * Name the state of a plan version.
 * @param state - State of the plan.
 * @returns the dictionary key naming that state.
 */
export function planStateKey(state: 'draft' | 'pending' | 'done'): MeetingRoomKey {
  return PLAN_STATE_KEYS[state]
}

/**
 * Name the final-review state of a plan version.
 * @param state - Review state of the plan.
 * @returns the dictionary key naming that review state.
 */
export function reviewStateKey(state: 'draft' | 'pending' | 'done'): MeetingRoomKey {
  return REVIEW_STATE_KEYS[state]
}

/**
 * Render how long ago the meeting changed, in the reader's language.
 * @param minutesAgo - Minutes since the meeting was last updated.
 * @param t - Translate function of the meeting namespace.
 * @returns the relative time as a phrase.
 */
export function formatUpdated(minutesAgo: number, t: Translate): string {
  if (minutesAgo < 60) return t('list.updated.minutes', { count: minutesAgo })
  if (minutesAgo < 1440) return t('list.updated.hours', { count: Math.round(minutesAgo / 60) })
  return t('list.updated.days', { count: Math.round(minutesAgo / 1440) })
}

/**
 * Keep the meetings whose title or project matches the query.
 * @param meetings - Meetings the list page holds.
 * @param query - Search query typed by the reader.
 * @returns the meetings matching the query, in the given order.
 */
export function filterByQuery<T extends { readonly title: string; readonly project: string }>(
  meetings: readonly T[],
  query: string,
): readonly T[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return meetings
  return meetings.filter(meeting =>
    meeting.title.toLowerCase().includes(needle)
    || meeting.project.toLowerCase().includes(needle))
}

/**
 * Keep the meetings the filter selects.
 * @param status - Lifecycle state of one meeting.
 * @param filter - Filter applied to the rows.
 * @returns whether the meeting belongs in the filtered list.
 */
export function matchesFilter(status: MeetingStatus, filter: MeetingFilter): boolean {
  switch (filter) {
    case 'all': return true
    case 'running': return status === 'running'
    case 'awaiting': return status === 'awaiting'
    case 'completed': return status === 'completed'
  }
}
