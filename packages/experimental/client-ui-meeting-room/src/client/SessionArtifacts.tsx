/** File-only results tab for the displayed main conversation. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProjectInjected } from './ProjectPage.tsx'
import { planFileName, sessionArtifacts, sessionPlans } from './session-artifacts.ts'
import type { NS } from './locales.ts'
import css from './SessionArtifacts.module.css'

/** Shared project source and explicit document actions, independent of the chat renderer. */
export interface SessionArtifactsInjected {
  hooks: ProjectInjected['hooks']
  refresh: () => void
  confirmPlan: (id: string, revision: number) => Promise<void>
  openWorkspace: () => void
}

type Props = PropsRuntime<'conversation.view'> & PropsLocale<typeof NS> & InjectFace<SessionArtifactsInjected>

/**
 * Render versioned plan exports and reviewed file references without embedding document content.
 * @param props - Exact conversation, live project catalog and shared file-menu bindings.
 * @returns File rows, confirmation controls and explicit loading, failure or empty feedback.
 */
export function SessionArtifacts({ sessionId, useCatalog, refresh, confirmPlan, openWorkspace, useContextMenu, t }: Props) {
  const catalog = useCatalog(value => value)
  const plans = sessionPlans(sessionId, catalog.plans, catalog.records)
  const files = sessionArtifacts(sessionId, catalog.records)
  const { getTriggerProps } = useContextMenu()
  return <section className={css.root} aria-label={t('artifacts.title')}>
    <header className={css.header}>
      <h2>{t('artifacts.title')}</h2>
      <div className={css.actions}>
        <Button size="sm" disabled={catalog.loading} onClick={refresh}>{t('project.refresh')}</Button>
        <Button size="sm" onClick={openWorkspace}>{t('project.open-workspace')}</Button>
      </div>
    </header>
    {catalog.loading && <p role="status">{t('project.loading')}</p>}
    {catalog.failed && <p role="alert">{t('project.error')}</p>}
    <section className={css.group}>
      <h3>{t('artifacts.plans')}</h3>
      {plans.length === 0 ? <p className={css.secondary}>{t('artifacts.no-plans')}</p> : <ul className={css.list}>
        {plans.map(plan => <li className={css.row} key={`${plan.id}:${plan.revision}`}
          {...getTriggerProps(plan.document ? { kind: 'file', value: { sessionId, path: plan.document.path } } : undefined)}>
          <div className={css.file}>
            <span className={css.name}>{planFileName(plan) ?? t('artifacts.missing-document')}</span>
            {plan.document && <span className={css.path}>{plan.document.path}</span>}
            <span className={css.secondary}>{t(plan.confirmed ? 'plan.confirmed' : 'plan.draft')} · {t('plan.version', { revision: plan.revision })}</span>
          </div>
          <div className={css.actions}>
            {!plan.confirmed && <Button size="sm" disabled={!plan.document || catalog.loading || catalog.failed}
              onClick={() => { void confirmPlan(plan.id, plan.revision) }}>{t('plan.confirm')}</Button>}
          </div>
        </li>)}
      </ul>}
    </section>
    <section className={css.group}>
      <h3>{t('artifacts.files')}</h3>
      <p className={css.secondary}>{t('artifacts.observed')}</p>
      {files.length === 0 ? <p className={css.secondary}>{t('artifacts.no-files')}</p> : <ul className={css.list}>
        {files.map(file => <li className={css.row} key={`${file.projectId}:${file.checkpoint}:${file.path}`}
          {...getTriggerProps({ kind: 'file', value: { sessionId, path: file.path } })}>
          <div className={css.file}>
            <span className={css.name}>{file.path.replaceAll('\\', '/').split('/').at(-1)}</span>
            <span className={css.path}>{file.path}</span>
            <span className={css.secondary}>{file.role} · {file.state === 'acceptance-blocked' ? t('review.blocked')
              : file.state === 'awaiting-human' ? t('review.awaiting-human') : t('artifacts.recorded')}</span>
          </div>
        </li>)}
      </ul>}
    </section>
  </section>
}
