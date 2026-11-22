/** Actual meeting records associated with the main conversation selected from its menu. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MeetingRecord } from '@deepseek-ai/dsh-experimental-meeting-room/types'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import css from './ProjectPage.module.css'

/** Session-scoped query state exposed through a root panel's selected conversation. */
export interface MeetingCatalog {
  sessionId?: string | undefined
  meetings: MeetingRecord[]
  loading: boolean
  failed: boolean
}

/** Navigation and query actions owned by the meeting plugin registration. */
export interface SessionMeetingsInjected {
  hooks: { meetings: HostObservable<MeetingCatalog> }
  refresh: () => void
  openMain: () => void
  prepareMeeting: () => void
  openParticipant: (parent: string, child: string) => void
}

type Props = PropsRuntime<'main'> & PropsLocale<typeof NS> & InjectFace<SessionMeetingsInjected>

/**
 * Show participant opinions separately from the main assistant's retained conclusions.
 * @param props - Selected conversation records, localized copy and navigation.
 * @returns Actual meetings with explicit empty, loading and failure states.
 */
export function SessionMeetings({ useMeetings, refresh, openMain, prepareMeeting, openParticipant, t }: Props) {
  const catalog = useMeetings(value => value)
  const states = { running: 'project.running', 'awaiting-decision': 'meeting.awaiting-decision', decided: 'meeting.decided',
    failed: 'project.failed', interrupted: 'project.interrupted' } as const
  return <section className={css.page}>
    <header className={css.header}><h1>{t('meeting.session-title')}</h1><div className={css.actions}>
      <Button disabled={!catalog.sessionId} onClick={openMain}>{t('meeting.main')}</Button>
      <Button disabled={!catalog.sessionId || catalog.loading} onClick={refresh}>{t('project.refresh')}</Button>
      <Button disabled={!catalog.sessionId} onClick={prepareMeeting}>{t('meeting.prepare')}</Button>
    </div></header>
    <p>{t('meeting.context')}</p>
    {catalog.loading && <p role="status">{t('project.loading')}</p>}
    {catalog.failed && <p role="alert">{t('project.error')}</p>}
    {!catalog.loading && !catalog.failed && catalog.meetings.length === 0 && <p>{t('meeting.empty')}</p>}
    {[...catalog.meetings].reverse().map(meeting => <article className={css.project} key={meeting.id}>
      <header className={css.header}><h2>{meeting.requirement}</h2><span>{t(states[meeting.state])}</span></header>
      <h3>{t('meeting.opinions')}</h3>
      {meeting.rounds.map(round => <details key={round.index}>
        <summary>{round.role}</summary><pre>{round.output}</pre>
        <Button onClick={() => { openParticipant(meeting.sessionId, round.childSessionId) }}>{t('project.open-worker')}</Button>
      </details>)}
      <h3>{t('meeting.conclusions')}</h3>
      {meeting.decisions.length === 0 && <p>{t('meeting.no-decision')}</p>}
      {meeting.decisions.map(decision => <details key={decision.revision}>
        <summary>{t('plan.version', { revision: decision.revision })}</summary>
        <pre>{decision.summary}</pre><h3>{t('meeting.actions')}</h3>
        <ul>{decision.actions.map((action, index) => <li key={index}>{action}</li>)}</ul>
      </details>)}
    </article>)}
  </section>
}
