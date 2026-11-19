/** Project tasks in the Session panel, beside the subagent and background-job sections. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
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

/** Full props of the Session panel's project-tasks section body. */
export type SessionProjectsProps =
  PropsRuntime<'conversation.session.panel.section'>
  & PropsLocale<typeof NS>
  & InjectFace<Pick<SessionProjectsInjected, 'hooks'>>

/** Registration-side business face of the section title's trailing controls. */
export type ProjectSectionActionsInjected = Pick<SessionProjectsInjected, 'refresh' | 'openWorkspace'>

/** Full props of the section title's trailing controls. */
export type ProjectSectionActionsProps =
  PropsRuntime<'conversation.session.panel.section.actions'>
  & PropsLocale<typeof NS>
  & InjectFace<ProjectSectionActionsInjected>

/**
 * Display produced-task counts without treating production as acceptance or Team completion.
 * The panel draws the section title; this body renders nothing without session-associated
 * checkpoints, which keeps the section hidden with its title.
 * @param props - Exact root conversation, the shared project catalog, and the namespace translator.
 * @returns Session-associated project tasks, or no content.
 */
export function SessionProjects({ sessionId, useCatalog, t }: SessionProjectsProps) {
  const catalog = useCatalog(value => value)
  const groups = new Map<string, ProjectCheckpoint[]>()
  for (const record of catalog.records) {
    if (record.sessionId !== sessionId) continue
    const group = groups.get(record.projectId) ?? []
    group.push(record)
    groups.set(record.projectId, group)
  }
  if (groups.size === 0) return null
  return <div className={css.root}>
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
  </div>
}

/**
 * Refresh and workspace entry controls on the section title row.
 * @param props - The shared project catalog and the workspace opener.
 * @returns The title-row controls.
 */
export function ProjectSectionActions({ useCatalog, refresh, openWorkspace, t }: ProjectSectionActionsProps) {
  const catalog = useCatalog(value => value)
  return <>
    <Button disabled={catalog.loading} onClick={refresh}>{t('project.refresh')}</Button>
    <Button onClick={openWorkspace}>{t('project.open-workspace')}</Button>
  </>
}
