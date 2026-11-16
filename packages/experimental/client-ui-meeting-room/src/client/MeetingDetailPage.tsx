/** Meeting detail page: the stage bar, the round timeline and the meeting's side cards. */
import type { ReactElement } from 'react'
import { Button, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MeetingStage } from './demo-data.ts'
import { formatUpdated, planStateKey, reviewStateKey, roleKey, stageKey, statusKey } from './meeting-format.ts'
import type { MeetingRoomInjected } from './meeting-records.ts'
import type { MeetingStoreProps } from './meeting-store.ts'
import { NS } from './locales.ts'
import css from './MeetingDetailPage.module.css'

/** Root-scoped props of the meeting detail page. */
export type MeetingDetailPageProps = PropsRuntime<'main'>
  & MeetingStoreProps
  & InjectFace<MeetingRoomInjected>
  & PropsLocale<typeof NS>
  & { readonly meetingId: string }

/** Stages of the meeting flow, in order. */
const STAGES: readonly MeetingStage[] = ['independent', 'discussion', 'synthesis', 'final', 'published']

/** Dot state of every meeting status. */
const DOT_STATES = {
  running: 'ongoing',
  awaiting: 'warning',
  pending: 'idle',
  completed: 'done',
  blocked: 'error',
  paused: 'idle',
} as const

/**
 * Render the detail page of one meeting.
 * @param props - viewing state, records and localized copy.
 * @returns the meeting detail page.
 */
export function MeetingDetailPage(props: MeetingDetailPageProps): ReactElement {
  const { t, actions, meetings, details, meetingId } = props
  const summary = meetings.find(meeting => meeting.id === meetingId)
  const detail = details[meetingId]
  const stageIndex = detail === undefined ? -1 : STAGES.indexOf(detail.stage)
  const currentPlan = detail?.plans[0]

  return (
    <section className={css.page}>
      <header className={css.heading}>
        <Button variant="ghost" onClick={() =>{  actions.close() }}>{t('detail.back')}</Button>
        <h1 className={css.title}>{summary?.title ?? ''}</h1>
        {summary === undefined
          ? null
          : (
            <span className={css.status}>
              <StateDot state={DOT_STATES[summary.status]} />
              <span>{t(statusKey(summary.status))}</span>
            </span>
          )}
        <span className={css.headingActions}>
          <Button variant="outline">{t('detail.pause')}</Button>
          <Button variant="primary">{t('detail.append')}</Button>
        </span>
      </header>
      <ol className={css.stages}>
        {STAGES.map((stage, index) => (
          <li
            key={stage}
            className={css.stage}
            data-state={index < stageIndex ? 'done' : index === stageIndex ? 'current' : 'pending'}
          >
            {t(stageKey(stage))}
          </li>
        ))}
      </ol>
      <div className={css.body}>
        <div className={css.main}>
          {detail?.rounds.map(round => (
            <section key={round.index} className={css.round}>
              <header className={css.roundHeader}>
                <span className={css.roundTitle}>{`${t('detail.round', { index: round.index + 1 })} · ${t(stageKey(round.stage))}`}</span>
                <span className={css.roundProgress}>{t('detail.progress', { done: round.speeches.length, total: round.speeches.length })}</span>
              </header>
              {round.speeches.map(speech => (
                <article key={`${round.index}-${speech.role}`} className={css.speech}>
                  <span className={css.speechAvatar}>{speech.role.slice(0, 1)}</span>
                  <div className={css.speechBody}>
                    <header className={css.speechHeader}>
                      <span className={css.speechRole}>{speech.role}</span>
                      <Tag tone="quiet">{speech.model}</Tag>
                      <span className={css.speechTime}>{formatUpdated(speech.minutesAgo, t)}</span>
                    </header>
                    {speech.quote === undefined
                      ? null
                      : <blockquote className={css.speechQuote}>{speech.quote}</blockquote>}
                    {speech.masked === true
                      ? <p className={css.speechMasked}>{t('detail.masked')}</p>
                      : <p className={css.speechText}>{speech.text}</p>}
                  </div>
                </article>
              ))}
            </section>
          ))}
          {detail === undefined
            ? null
            : (
              <>
                <section className={css.block}>
                  <h2 className={css.blockTitle}>{t('detail.objections')}</h2>
                  <table className={css.table}>
                    <thead>
                      <tr>
                        <th>{t('detail.objection.claim')}</th>
                        <th>{t('detail.objection.author')}</th>
                        <th>{t('detail.objection.verdict')}</th>
                        <th>{t('detail.objection.basis')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.objections.map(objection => (
                        <tr key={objection.claim}>
                          <td>{objection.claim}</td>
                          <td>{objection.author}</td>
                          <td>{objection.verdict}</td>
                          <td>{objection.basis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className={css.block}>
                  <h2 className={css.blockTitle}>{t('detail.artifacts')}</h2>
                  {detail.artifacts.map(artifact => (
                    <div key={artifact.name} className={css.artifact}>
                      <span className={css.artifactName}>{artifact.name}</span>
                      <span className={css.artifactMeta}>{`${artifact.size} · ${artifact.checksum}`}</span>
                      <Button size="sm">{t('detail.accept')}</Button>
                    </div>
                  ))}
                </section>
              </>
            )}
        </div>
        <aside className={css.side}>
          <section className={css.card}>
            <h2 className={css.cardTitle}>{t('detail.control')}</h2>
            <div className={css.cardActions}>
              <Button size="sm">{t('detail.start')}</Button>
              <Button size="sm">{t('detail.pause')}</Button>
              <Button size="sm">{t('detail.stop')}</Button>
              <Button size="sm">{t('detail.append')}</Button>
            </div>
            {detail === undefined
              ? null
              : (
                <div className={css.budget}>
                  <span className={css.budgetLabel}>{t('detail.budget', { used: detail.budget.used, total: detail.budget.total })}</span>
                  <span className={css.budgetTrack}>
                    <span className={css.budgetFill} style={{ width: `${Math.round(detail.budget.used / detail.budget.total * 100)}%` }} />
                  </span>
                </div>
              )}
          </section>
          <section className={css.card}>
            <h2 className={css.cardTitle}>{t('detail.materials')}</h2>
            {detail?.materials.map(material => (
              <div key={material} className={css.cardRow}>
                <span>{material}</span>
                <Tag>{t('detail.readonly')}</Tag>
              </div>
            ))}
          </section>
          <section className={css.card}>
            <h2 className={css.cardTitle}>{t('detail.plan')}</h2>
            {detail?.plans.map(plan => (
              <div key={plan.version} className={css.cardRow}>
                <span>{plan.version}</span>
                <Tag tone={plan.version === detail.plans[0]?.version ? 'solid' : 'outline'}>
                  {t(planStateKey(plan.state))}
                </Tag>
              </div>
            ))}
            {currentPlan === undefined
              ? null
              : (
                <p className={css.cardNote}>
                  {t('detail.review', { state: t(reviewStateKey(currentPlan.state)) })}
                </p>
              )}
          </section>
          <section className={css.card}>
            <h2 className={css.cardTitle}>{t('detail.members')}</h2>
            {(detail?.members ?? summary?.members ?? []).map(member => (
              <div key={member.name} className={css.cardRow}>
                <span>{member.name}</span>
                <Tag tone="quiet">{t(roleKey(member.role))}</Tag>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </section>
  )
}
