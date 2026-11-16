/** Meeting list page: the filter row, the search field and one row per meeting. */
import type { ReactElement } from 'react'
import { Button, Input, SegmentedControl, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { filterByQuery, formatUpdated, matchesFilter, planStateKey, statusKey } from './meeting-format.ts'
import type { MeetingRoomInjected } from './meeting-records.ts'
import type { MeetingFilter, MeetingStoreProps } from './meeting-store.ts'
import { NS } from './locales.ts'
import css from './MeetingListPage.module.css'

/** Root-scoped props of the meeting list page. */
export type MeetingListPageProps = PropsRuntime<'main'>
  & MeetingStoreProps
  & InjectFace<MeetingRoomInjected>
  & PropsLocale<typeof NS>

/** Filter options of the list page, in the order the segmented control shows them. */
const FILTERS: readonly {
  readonly value: MeetingFilter
  readonly key: 'list.filter.all' | 'list.filter.running' | 'list.filter.awaiting' | 'list.filter.completed'
}[] = [
  { value: 'all', key: 'list.filter.all' },
  { value: 'running', key: 'list.filter.running' },
  { value: 'awaiting', key: 'list.filter.awaiting' },
  { value: 'completed', key: 'list.filter.completed' },
]

/** Dot state of every meeting status. */
const DOT_STATES = {
  running: 'ongoing',
  awaiting: 'warning',
  pending: 'idle',
  completed: 'done',
  blocked: 'error',
  paused: 'idle',
} as const

/** Number of member avatars a row draws before it counts the rest. */
const AVATAR_LIMIT = 3

/**
 * Render the meeting list with its filter, search field and rows.
 * @param props - viewing state, records and localized copy.
 * @returns the list page.
 */
export function MeetingListPage(props: MeetingListPageProps): ReactElement {
  const { t, useStore, actions, meetings } = props
  const filter = useStore(state => state.filter)
  const query = useStore(state => state.query)
  const visible = filterByQuery(meetings.filter(meeting => matchesFilter(meeting.status, filter)), query)
  const unfiltered = filter === 'all' && query.trim() === ''

  return (
    <section className={css.page}>
      <header className={css.heading}>
        <h1 className={css.title}>{t('list.title')}</h1>
        <Button variant="primary">{t('list.create')}</Button>
      </header>
      <div className={css.toolbar}>
        <SegmentedControl
          id="meeting-filter"
          label={t('list.filter.all')}
          value={filter}
          options={FILTERS.map(option => ({ value: option.value, label: t(option.key) }))}
          onChange={(next) =>{  actions.setFilter(next) }}
        />
        <div className={css.search}>
          <Input
            value={query}
            placeholder={t('list.search')}
            onChange={(event) =>{  actions.setQuery(event.target.value) }}
          />
        </div>
      </div>
      {visible.length === 0
        ? (
          <div className={css.empty}>
            <p className={css.emptyTitle}>{t(unfiltered ? 'list.empty.title' : 'list.empty.filtered')}</p>
            {unfiltered ? <p className={css.emptyHint}>{t('list.empty.hint')}</p> : null}
          </div>
        )
        : (
          <ul className={css.rows}>
            {visible.map(meeting => (
              <li key={meeting.id}>
                <button type="button" className={css.row} onClick={() =>{  actions.open(meeting.id) }}>
                  <span className={css.rowMain}>
                    <span className={css.rowTitle}>{meeting.title}</span>
                    <span className={css.rowProject}>{meeting.project}</span>
                  </span>
                  <span className={css.rowStatus}>
                    <StateDot state={DOT_STATES[meeting.status]} />
                    <span>{t(statusKey(meeting.status))}</span>
                  </span>
                  <span className={css.rowMembers}>
                    {meeting.members.slice(0, AVATAR_LIMIT).map(member => (
                      <span key={member.name} className={css.avatar}>{member.initials}</span>
                    ))}
                    {meeting.members.length > AVATAR_LIMIT
                      ? (
                        <span className={css.avatarMore} aria-label={t('list.moreRoles', { count: meeting.members.length - AVATAR_LIMIT })}>
                          {`+${meeting.members.length - AVATAR_LIMIT}`}
                        </span>
                      )
                      : null}
                  </span>
                  <span className={css.rowRounds}>{`${meeting.roundsDone}/${meeting.roundsTotal}`}</span>
                  <span className={css.rowUpdated}>{formatUpdated(meeting.updatedMinutesAgo, t)}</span>
                  <span className={css.rowPlan}>
                    {meeting.planVersion === undefined || meeting.planState === undefined
                      ? null
                      : <Tag>{`${meeting.planVersion} ${t(planStateKey(meeting.planState))}`}</Tag>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
