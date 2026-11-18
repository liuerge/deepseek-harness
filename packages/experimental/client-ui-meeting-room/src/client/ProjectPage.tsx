/** Actual project executions and the reusable employees available to the assistant. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Employee, ProjectTeam, ProjectPlan, AcceptanceReport } from '@deepseek-ai/dsh-meeting-room/types'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import css from './ProjectPage.module.css'
import { RosterEditor } from './RosterEditor.tsx'
import type { EmployeeSaveInput, TeamSaveInput, RosterConnection } from '@deepseek-ai/dsh-meeting-room/types'

/** Persisted execution checkpoint exposed by the project query. */
export interface ProjectCheckpoint {
  sessionId: string
  projectId: string
  state: string
  checkpoint: number
  rework?: { attempt: number; maxAttempts: number; sourceCheckpoint?: number | undefined } | undefined
  report?: AcceptanceReport | undefined
  childSessionId?: string | undefined
  parentSessionId?: string | undefined
  goal?: string | undefined
  handoff?: string | undefined
  index?: number | undefined
  role?: string | undefined
  tasks?: { role: string; instruction: string; acceptance: string }[] | undefined
  teamLink?: 'linked' | 'disabled' | 'unavailable' | undefined
  teamTask?: { id: string; revision: number; status: 'pending' | 'in_progress' | 'completed' | 'deleted' } | undefined
}

/** Project and roster data plus user actions supplied by the registration. */
export interface ProjectInjected {
  hooks: { catalog: HostObservable<{
    records: ProjectCheckpoint[]
    employees: Employee[]
    teams: ProjectTeam[]
    plans: ProjectPlan[]
    loading: boolean
    failed: boolean
    connections: RosterConnection[]
    connectionsLoading: boolean
    connectionsFailed: boolean
  }> }
  refresh: () => void
  openModelSettings: () => void
  newProject: () => void
  configureEmployee: () => void
  configureTeam: () => void
  saveEmployee: (input: EmployeeSaveInput) => Promise<boolean>
  saveTeam: (input: TeamSaveInput) => Promise<boolean>
  delegateTeam: (id: string) => void
  preparePlan: () => void
  confirmPlan: (id: string, revision: number) => Promise<void>
  runPlan: (id: string, revision: number) => void
  editPlan: (id: string, revision: number) => void
  approveAcceptance: (id: string, checkpoint: number) => Promise<void>
  continueProject: (id: string, checkpoint: number) => void
  openMain: (id: string, projectId: string) => void
  openWorker: (parent: string, child: string) => void
  adoptPlan: (id: string, revision: number) => void
}

type Props = PropsRuntime<'main'> & PropsLocale<typeof NS> & InjectFace<ProjectInjected>

/**
 * Render saved employees, teams and actual project handoffs.
 * @param props - Host catalog, localized copy and navigation actions.
 * @returns Dashboard with loading, failure and empty feedback.
 */
export function ProjectPage(props: Props) {
  const { useCatalog, t, refresh, newProject, saveEmployee, saveTeam, delegateTeam } = props
  const { preparePlan, confirmPlan, runPlan, editPlan, approveAcceptance, continueProject, openMain, openWorker } = props
  const { adoptPlan } = props
  const catalog = useCatalog(value => value)
  const projects = new Map<string, ProjectCheckpoint[]>()
  for (const record of catalog.records) {
    const records = projects.get(record.projectId) ?? []
    records.push(record)
    projects.set(record.projectId, records)
  }
  const states = {
    started: 'project.started', starting: 'project.starting', running: 'project.running',
    'task-produced': 'project.task-produced', 'awaiting-review': 'project.awaiting-review',
    'awaiting-direction': 'project.awaiting-direction',
    'awaiting-acceptance': 'project.awaiting-acceptance',
    reviewing: 'review.running', 'reviewer-produced': 'review.running',
    'acceptance-passed': 'review.passed', 'acceptance-blocked': 'review.blocked',
    'awaiting-human': 'review.awaiting-human', released: 'review.released', resuming: 'project.running', reworking: 'review.reworking', completed: 'review.completed',
    failed: 'project.failed', blocked: 'project.blocked', interrupted: 'project.interrupted',
  } as const
  return <section className={css.page}>
    <header className={css.header}>
      <h1>{t('project.title')}</h1>
      <div className={css.actions}>
        <Button disabled={catalog.loading} onClick={refresh}>{t('project.refresh')}</Button>
        <Button variant="primary" onClick={newProject}>{t('project.new')}</Button>
      </div>
    </header>
    {catalog.loading && <p role="status">{t('project.loading')}</p>}
    {catalog.failed && <p role="alert">{t('project.error')}</p>}
    <RosterEditor employees={catalog.employees} teams={catalog.teams} connections={catalog.connections}
      connectionsLoading={catalog.connectionsLoading} connectionsFailed={catalog.connectionsFailed}
      loading={catalog.loading} saveEmployee={saveEmployee} saveTeam={saveTeam} delegateTeam={delegateTeam}
      openModelSettings={props.openModelSettings} t={t} />
    <section className={css.project}>
      <header className={css.header}>
        <h2>{t('plan.title')}</h2><Button onClick={preparePlan}>{t('plan.prepare')}</Button>
      </header>
      {catalog.plans.filter(plan => !catalog.plans.some(other => other.id === plan.id && other.revision > plan.revision)).map((plan) => {
        const mainSession = plan.originSessionId ?? catalog.records.find(record => record.projectId === plan.executionId)?.sessionId
        return <article key={plan.id}>
          <header className={css.header}><h3>{plan.goal}</h3>
            <Button disabled={!mainSession} onClick={() => { editPlan(plan.id, plan.revision) }}>{t('plan.edit')}</Button>
          </header>
          <p>{t('plan.version', { revision: plan.revision })} · {plan.team.name} · {t(plan.confirmed ? 'plan.confirmed' : 'plan.draft')}</p>
          <p>{plan.document?.path ?? t('artifacts.missing-document')}</p>
          {!mainSession && <><p>{t('plan.unlinked')}</p>
            <Button onClick={() => { adoptPlan(plan.id, plan.revision) }}>{t('plan.adopt')}</Button></>}
          <ul className={css.tasks}>{plan.employees.map(employee => <li key={employee.id}>
            <strong>{employee.name}</strong> {employee.provider} / {employee.model}
            <p>{employee.responsibility}</p>{employee.preset && <p>{employee.preset}</p>}
          </li>)}</ul>
          <h3>{t('project.tasks')}</h3>
          <ol className={css.tasks}>{plan.tasks.map((task, index) => <li key={index}>
            <strong>{plan.employees.find(employee => employee.id === task.employeeId)?.name ?? task.role}</strong>
            <p>{task.instruction}</p><p>{task.acceptance}</p>
            {task.review && <details>
              <summary>{t('review.title')} · {t(task.review.release === 'automatic' ? 'review.automatic' : 'review.human')}</summary>
              <p>{t('review.reviewers')} · {task.review.reviewerIds.map(id =>
                plan.employees.find(employee => employee.id === id)?.name ?? id).join(' · ')}</p>
              <ol>{task.review.criteria.map(criterion => <li key={criterion.id}>
                <strong>{criterion.id} · {criterion.description}</strong>
                <p>{t('review.method')} · {criterion.method}</p>
                <p>{t('review.expected')} · {criterion.expected}</p>
                <p>{t('review.evidence')} · {criterion.evidence}</p>
              </li>)}</ol>
              <p>{t('review.downstream')} · {task.review.downstream.join(' · ') || t('review.none')}</p>
              {task.review.rework && <p>{t('review.rework-limit', { count: task.review.rework.maxAttempts })}</p>}
              {task.review.artifactPaths ? <p>{t('review.artifacts')} · {task.review.artifactPaths.join(' · ')}</p>
                : <p>{t('review.pending')}</p>}
            </details>}
          </li>)}</ol>
          {plan.background.length > 0 && <><h3>{t('plan.background')}</h3>
            {plan.background.map((item, index) => <details key={index}>
              <summary>{item.title}</summary><p>{item.source}</p><pre>{item.content}</pre>
            </details>)}
          </>}
          {plan.executionId ? <p>{t('project.started')}</p> : plan.confirmed
            ? <Button disabled={!plan.document || catalog.loading || !mainSession} onClick={() => { runPlan(plan.id, plan.revision) }}>{t('plan.run')}</Button>
            : <Button variant="primary" disabled={!plan.document || catalog.loading}
              onClick={() => { void confirmPlan(plan.id, plan.revision) }}>{t('plan.confirm')}</Button>}
        </article>
      })}
    </section>
    {!catalog.loading && !catalog.failed && projects.size === 0 && <div className={css.empty}>
      <h2>{t('project.empty')}</h2><p>{t('project.hint')}</p>
    </div>}
    {[...projects.entries()].reverse().map(([id, records]) => {
      const plan = records.find(record => record.goal)
      const latest = records.at(-1)
      if (!latest) return null
      const stateKey = states[latest.state as keyof typeof states]
      return <article key={id} className={css.project}>
        <header className={css.header}><h2>{plan?.goal ?? id}</h2><span>{t(stateKey)}</span></header>
        {plan?.teamLink === 'disabled' && <p className={css.secondary}>{t('project.team-disabled')}</p>}
        {plan?.teamLink === 'unavailable' && <p className={css.secondary}>{t('project.team-unavailable')}</p>}
        <Button onClick={() => { openMain(records[0]?.sessionId ?? latest.sessionId, id) }}>{t('project.correct-main')}</Button>
        {latest.state === 'awaiting-acceptance' && <p role="status">{t('review.pending')}</p>}
        {latest.state === 'awaiting-human' && <Button variant="primary" disabled={catalog.loading}
          onClick={() => { void approveAcceptance(id, latest.checkpoint) }}>{t('review.approve')}</Button>}
        {latest.state === 'released' && <Button variant="primary" disabled={catalog.loading}
          onClick={() => { continueProject(id, latest.checkpoint) }}>{t('review.continue')}</Button>}
        {latest.rework && <p>{t('review.rework-count', { count: latest.rework.attempt, limit: latest.rework.maxAttempts })}</p>}
        {latest.state === 'acceptance-blocked' && latest.rework && <Button disabled={catalog.loading || latest.rework.attempt >= latest.rework.maxAttempts}
          onClick={() => { continueProject(id, latest.checkpoint) }}>{t('review.rework')}</Button>}
        {records.filter((record, position) => record.report && !records.slice(position + 1).some(other =>
          other.report?.reviewers[0]?.sessionId === record.report?.reviewers[0]?.sessionId)).map((record) => {
          const report = record.report
          if (!report) return null
          return <details key={record.checkpoint}>
            <summary>{t('review.report')} · {t(report.passed ? 'review.passed' : 'review.blocked')}</summary>
            <p>{t('plan.version', { revision: report.planRevision })}</p>
            <p>{t('project.tasks')} · {report.index + 1} · {plan?.tasks?.[report.index]?.role}</p>
            {record.rework && <p>{t('review.rework-count', { count: record.rework.attempt, limit: record.rework.maxAttempts })}</p>}
            {report.reviewers.map(reviewer => <div key={reviewer.sessionId}>
              <strong>{catalog.plans.find(item => item.id === report.planId && item.revision === report.planRevision)
                ?.employees.find(employee => employee.id === reviewer.employeeId)?.name ?? reviewer.employeeId}</strong>
              <ol>{reviewer.criteria.map(criterion => <li key={criterion.id}>
                <strong>{criterion.id} · {t(`review.status.${criterion.status}`)}</strong>
                <p>{criterion.notes}</p><p>{criterion.evidencePaths.join(' · ')}</p>
              </li>)}</ol>
            </div>)}
            <h3>{t('review.artifacts')}</h3>
            {report.artifacts.map(artifact => <pre key={artifact.path}>{artifact.path}{'\n'}{artifact.sha256}</pre>)}
          </details>
        })}
        <h3>{t('project.tasks')}</h3>
        <ol className={css.tasks}>{plan?.tasks?.map((task, index) => {
          const produced = records.some(record => record.index === index && record.state === 'task-produced')
          const worker = records.findLast(record => record.index === index
            && (record.state === 'task-produced' || record.state === 'running') && record.childSessionId && record.parentSessionId)
          const parentId = worker?.parentSessionId
          const childId = worker?.childSessionId
          const teamTask = records.findLast(record => record.index === index && record.teamTask)?.teamTask
          return <li key={index}><strong>{task.role}</strong>{produced && <span>{t('project.task-produced')}</span>}
            <p>{task.instruction}</p><p className={css.secondary}>{task.acceptance}</p>
            {teamTask && <p className={css.secondary}>
              {t('project.team-task', { id: teamTask.id, status: t(`project.team-status.${teamTask.status}`) })}
            </p>}
            {parentId && childId && <Button onClick={() => { openWorker(parentId, childId) }}>{t('project.open-worker')}</Button>}
          </li>
        })}</ol>
        <h3>{t('project.handoff')}</h3>
        {records.filter(record => record.handoff).map((record, index) => <details key={index}>
          <summary>{plan?.tasks?.[record.index ?? 0]?.role ?? record.sessionId}</summary>
          <pre>{record.handoff}</pre>
        </details>)}
      </article>
    })}
  </section>
}
