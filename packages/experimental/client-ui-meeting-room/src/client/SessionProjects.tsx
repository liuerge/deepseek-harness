/** Project tasks in the existing root conversation's subagent-catalog extension position. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-subagent/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProjectInjected, ProjectCheckpoint } from './ProjectPage.tsx'
import type { NS } from './locales.ts'
import css from './SessionProjects.module.css'

/** The existing project checkpoint source, filtered by the rendered main conversation. */
export interface SessionProjectsInjected {
  hooks: ProjectInjected['hooks']
  refresh: () => void
  openWorkspace: () => void
}

type Props = PropsRuntime<'conversation.session.header.actions.subagent.footer'>
  & PropsLocale<typeof NS> & InjectFace<SessionProjectsInjected>

/**
 * Display produced-task counts without treating production as acceptance or Team completion.
 * @param props - Exact root conversation and the shared project catalog.
 * @returns Session-associated project tasks inside the existing subagent menu, or no content.
 */
export function SessionProjects({ sessionId, useCatalog, refresh, openWorkspace, t }: Props) {
  const catalog = useCatalog(value => value)
  const groups = new Map<string, ProjectCheckpoint[]>()
  for (const record of catalog.records) {
    if (record.sessionId !== sessionId) continue
    const group = groups.get(record.projectId) ?? []
    group.push(record)
    groups.set(record.projectId, group)
  }
  if (groups.size === 0) return null
  return <section className={css.root}>
    <header className={css.header}><h3>{t('project.session-tasks')}</h3>
      <Button disabled={catalog.loading} onClick={refresh}>{t('project.refresh')}</Button>
    </header>
    {catalog.failed && <p role="alert">{t('project.error')}</p>}
    {[...groups].map(([id, records]) => {
      const initial = records.find(record => record.goal)
      const produced = new Set(records.filter(record => record.state === 'task-produced').map(record => record.index)).size
      return <div className={css.item} key={id}>
        <p>{initial?.goal ?? id}</p>
        <p>{t('project.produced-count', { count: produced, total: initial?.tasks?.length ?? 0 })}</p>
        <ol>{initial?.tasks?.map((task, index) => <li key={index}>{task.role}</li>)}</ol>
      </div>
    })}
    <Button onClick={openWorkspace}>{t('project.open-workspace')}</Button>
  </section>
}
