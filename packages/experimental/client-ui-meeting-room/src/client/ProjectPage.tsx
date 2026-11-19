/** Project workbench: a status board over the persisted plan and execution checkpoints. */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Employee, ProjectTeam, ProjectPlan, AcceptanceReport } from '@deepseek-ai/dsh-meeting-room/types'
import type { ContextMenuTriggerProps } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, IconCloseOutlineRegular, IconFullscreenOutlineRegular, Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import css from './ProjectPage.module.css'
import { RosterEditor } from './RosterEditor.tsx'
import { StatusChip, statusTone } from './StatusChip.tsx'
import { FileChip } from './FileChip.tsx'
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

type ColumnKey = 'pending' | 'active' | 'review' | 'done' | 'blocked'

/** Plan tasks and record-only task summaries share the fields the board renders. */
type BoardTask = {
  role: string
  instruction: string
  acceptance: string
  employeeId?: Employee['id'] | undefined
  review?: ProjectPlan['tasks'][number]['review'] | undefined
}

const COLUMNS = [
  { key: 'pending', label: 'board.column.pending', tone: 'idle' },
  { key: 'active', label: 'board.column.active', tone: 'ongoing' },
  { key: 'review', label: 'board.column.review', tone: 'warning' },
  { key: 'done', label: 'board.column.done', tone: 'done' },
  { key: 'blocked', label: 'board.column.blocked', tone: 'error' },
] as const

/** Map a checkpoint state to the board column that owns it. */
function columnOf(state: string): ColumnKey {
  switch (state) {
    case 'running': case 'reviewing': case 'reworking': case 'task-produced':
    case 'reviewer-produced': case 'resuming':
      return 'active'
    case 'awaiting-acceptance': case 'awaiting-human': case 'awaiting-review':
    case 'awaiting-direction': case 'released':
      return 'review'
    case 'acceptance-passed': case 'completed': case 'passed':
      return 'done'
    case 'acceptance-blocked': case 'failed': case 'blocked': case 'interrupted':
      return 'blocked'
    default:
      return 'pending'
  }
}

/**
 * Render saved employees, the confirmed plan and a status board of actual executions.
 * @param props - Host catalog, localized copy and navigation actions.
 * @returns Workbench with loading, failure and empty feedback.
 */
export function ProjectPage(props: Props) {
  const { useCatalog, t, refresh, newProject, saveEmployee, saveTeam, delegateTeam, useContextMenu } = props
  const { preparePlan, confirmPlan, runPlan, editPlan, approveAcceptance, continueProject, openMain, openWorker } = props
  const { adoptPlan } = props
  const catalog = useCatalog(value => value)
  const { getTriggerProps } = useContextMenu()
  const fileTrigger = (sessionId: string | undefined, path: string): ContextMenuTriggerProps => {
    if (!sessionId) return getTriggerProps(undefined)
    return getTriggerProps({ kind: 'file', value: { sessionId: sessionId as SessionId, path } })
  }
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
  const label = (state: string): string => t(states[state as keyof typeof states])
  const entries = [...projects.entries()].reverse()
  const plans = catalog.plans.filter(plan => !catalog.plans.some(other => other.id === plan.id && other.revision > plan.revision))
  const primary = entries[0]
  const primaryPlan = primary
    ? catalog.plans.find(item => item.executionId === primary[0]) ?? plans[0]
    : plans[0]
  const primaryLatest = primary?.[1].at(-1)
  const primaryGoal = primary?.[1].find(record => record.goal)?.goal ?? primaryPlan?.goal ?? primary?.[0] ?? ''
  const [openDetail, setOpenDetail] = useState<{ id: string; index: number } | null>(null)
  const [fullBoard, setFullBoard] = useState<string | null>(null)

  const renderTaskDetail = (
    plan: ProjectPlan | undefined,
    records: ProjectCheckpoint[],
    task: BoardTask,
    index: number,
  ): ReactNode => {
    const handoffs = records.filter(item => (item.index ?? 0) === index && item.handoff)
    const reports = records.filter((item, position) => (item.index ?? 0) === index && item.report
      && !records.slice(position + 1).some(other => other.report?.reviewers[0]?.sessionId === item.report?.reviewers[0]?.sessionId))
    return <>
      <p>{task.instruction}</p>
      <p>{task.acceptance}</p>
      {task.review && <details>
        <summary>{t('review.title')} · {t(task.review.release === 'automatic' ? 'review.automatic' : 'review.human')}</summary>
        <p>{t('review.reviewers')} · {task.review.reviewerIds.map(reviewer =>
          plan?.employees.find(item => item.id === reviewer)?.name ?? reviewer).join(' · ')}</p>
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
      {reports.map((item) => {
        const report = item.report
        if (!report) return null
        return <details key={`report-${item.checkpoint}`}>
          <summary>{t('review.report')} · {t(report.passed ? 'review.passed' : 'review.blocked')}</summary>
          <p>{t('plan.version', { revision: report.planRevision })}</p>
          {item.rework && <p>{t('review.rework-count', { count: item.rework.attempt, limit: item.rework.maxAttempts })}</p>}
          {report.reviewers.map(reviewer => <div key={reviewer.sessionId}>
            <strong>{catalog.plans.find(other => other.id === report.planId && other.revision === report.planRevision)
              ?.employees.find(other => other.id === reviewer.employeeId)?.name ?? reviewer.employeeId}</strong>
            <ol>{reviewer.criteria.map(criterion => <li key={criterion.id}>
              <strong>{criterion.id} · <StatusChip tone={statusTone(criterion.status)}>{t(`review.status.${criterion.status}`)}</StatusChip></strong>
              <p>{criterion.notes}</p>
              {criterion.evidencePaths.length > 0 && <p className={css.chips}>{criterion.evidencePaths.map(path =>
                <FileChip key={path} path={path} triggerProps={fileTrigger(item.sessionId, path)} />)}</p>}
            </li>)}</ol>
          </div>)}
          <h3>{t('review.artifacts')}</h3>
          {report.artifacts.map(artifact => <p key={artifact.path}>
            <FileChip path={artifact.path} hash={artifact.sha256} triggerProps={fileTrigger(item.sessionId, artifact.path)} />
          </p>)}
        </details>
      })}
      {handoffs.map((item, position) => <div key={`handoff-${position}`}>
        <h3>{t('project.handoff')}</h3><pre>{item.handoff}</pre>
      </div>)}
    </>
  }

  const renderBoard = (id: string, records: ProjectCheckpoint[], fullscreen: boolean): ReactNode => {
    const plan = catalog.plans.find(item => item.executionId === id) ?? plans[0]
    const goalRecord = records.find(record => record.goal)
    const tasks: BoardTask[] = plan?.tasks ?? goalRecord?.tasks ?? []
    const columns: Record<ColumnKey, ReactNode[]> = { pending: [], active: [], review: [], done: [], blocked: [] }
    tasks.forEach((task, index) => {
      const record = records.findLast(item => item.index === index)
      const state = record?.state ?? 'pending'
      const column = columnOf(state)
      const employee = plan?.employees.find(item => item.id === task.employeeId)
      const worker = records.findLast(item => item.index === index && item.childSessionId && item.parentSessionId)
      const parentId = worker?.parentSessionId
      const childId = worker?.childSessionId
      const teamTask = records.findLast(item => item.index === index && item.teamTask)?.teamTask
      const artifactPaths = task.review?.artifactPaths ?? []
      const open = openDetail?.id === id && openDetail.index === index
      columns[column].push(<article className={css.card} key={index}>
        <div className={css.cardHead}>
          <strong>{employee?.name ?? task.role}</strong>
          <StatusChip tone={statusTone(state)}>{label(state)}</StatusChip>
        </div>
        <p className={css.cardTitle}>{task.role}</p>
        {record?.handoff && <p className={css.cardNote}>{record.handoff.slice(0, 100)}</p>}
        {teamTask && <p className={css.secondary}>
          {t('project.team-task', { id: teamTask.id, status: t(`project.team-status.${teamTask.status}`) })}
        </p>}
        {artifactPaths.length > 0 && <div className={css.chips}>{artifactPaths.map(path =>
          <FileChip key={path} path={path} triggerProps={fileTrigger(record?.sessionId, path)} />)}</div>}
        <div className={css.cardActions}>
          {parentId && childId && <Button size="sm"
            onClick={() => { openWorker(parentId, childId) }}>{t('project.open-worker')}</Button>}
          <Button size="sm" onClick={() => { setOpenDetail(open ? null : { id, index }) }}>
            {t(open ? 'board.close' : 'board.task-detail')}
          </Button>
        </div>
      </article>)
    })
    const title = entries.length > 1 ? `${t('board.title')} · ${goalRecord?.goal ?? id}` : t('board.title')
    const detailOpen = openDetail?.id === id
    const boardClass = fullscreen
      ? `${css.board} ${css.boardFullscreen}${detailOpen ? ` ${css.boardFullscreenDetail}` : ''}`
      : css.board
    return <section className={boardClass} key={id}>
      <header className={css.boardHeader}>
        <h2>{title}</h2>
        {fullscreen
          ? <Button size="sm" icon={<IconCloseOutlineRegular size={14} />}
            data-modal-autofocus onClick={() => { setFullBoard(null) }}>{t('board.exit-fullscreen')}</Button>
          : <Button size="sm" icon={<IconFullscreenOutlineRegular size={14} />}
            onClick={() => { setFullBoard(id) }}>{t('board.fullscreen')}</Button>}
      </header>
      {goalRecord?.teamLink === 'disabled' && <p className={css.secondary}>{t('project.team-disabled')}</p>}
      {goalRecord?.teamLink === 'unavailable' && <p className={css.secondary}>{t('project.team-unavailable')}</p>}
      <div className={css.columns}>
        {COLUMNS.map(column => <div className={css.column} key={column.key}>
          <h3 className={css.columnHead} data-tone={column.tone}>
            <StateDot state={column.tone} className={css.columnDot} />
            <span>{t(column.label)}</span>
            <span className={css.count}>{columns[column.key].length}</span>
          </h3>
          <div className={css.columnBody}>
            {columns[column.key].length === 0 && <p className={css.emptyColumn}>{t('board.empty-column')}</p>}
            {columns[column.key]}
          </div>
        </div>)}
      </div>
      {openDetail?.id === id && (() => {
        const task = tasks[openDetail.index]
        if (!task) return null
        const employee = plan?.employees.find(item => item.id === task.employeeId)
        return <section className={css.detailPanel}>
          <header className={css.header}>
            <h3>{employee?.name ?? task.role} · {task.role}</h3>
            <div className={css.actions}>
              <Button onClick={() => { setOpenDetail(null) }}>{t('board.close')}</Button>
            </div>
          </header>
          {renderTaskDetail(plan, records, task, openDetail.index)}
        </section>
      })()}
    </section>
  }

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

    {primary && <div className={css.summary}>
      <span className={css.summaryGoal} title={primaryGoal}>{primaryGoal}</span>
      {primaryPlan && <><span>{t('plan.version', { revision: primaryPlan.revision })}</span>
        <span>{primaryPlan.team.name}</span>
        <StatusChip tone={statusTone(primaryPlan.confirmed ? 'confirmed' : 'draft')}>
          {t(primaryPlan.confirmed ? 'plan.confirmed' : 'plan.draft')}
        </StatusChip>
        <a className={css.link} href={`#plan-${primaryPlan.id}`}
          onClick={(event) => {
            event.preventDefault()
            document.getElementById(`plan-${primaryPlan.id}`)?.scrollIntoView({ block: 'start' })
          }}>{t('project.view-plan')}</a></>}
      {primaryLatest && <StatusChip tone={statusTone(primaryLatest.state)}>{label(primaryLatest.state)}</StatusChip>}
      <span className={css.actions}>
        <Button onClick={() => { openMain(primary[1][0]?.sessionId ?? primaryLatest?.sessionId ?? '', primary[0]) }}>
          {t('project.correct-main')}
        </Button>
      </span>
    </div>}

    {(() => {
      const items: ReactNode[] = []
      for (const [id, records] of entries) {
        const latest = records.at(-1)
        if (!latest) continue
        if (latest.state === 'awaiting-human') items.push(<div className={css.pendingItem} key={`approve-${id}`}>
          <span>{t('review.approve')}</span>
          <Button variant="primary" disabled={catalog.loading}
            onClick={() => { void approveAcceptance(id, latest.checkpoint) }}>{t('review.approve')}</Button>
        </div>)
        if (latest.state === 'awaiting-acceptance') items.push(<div className={css.pendingItem} key={`review-${id}`}>
          <span>{t('review.pending')}</span>
        </div>)
        if (latest.state === 'released') items.push(<div className={css.pendingItem} key={`continue-${id}`}>
          <span>{t('review.continue')}</span>
          <Button variant="primary" disabled={catalog.loading}
            onClick={() => { continueProject(id, latest.checkpoint) }}>{t('review.continue')}</Button>
        </div>)
        if (latest.state === 'acceptance-blocked' && latest.rework) items.push(<div className={css.pendingItem} key={`rework-${id}`}>
          <span>{t('review.rework-count', { count: latest.rework.attempt, limit: latest.rework.maxAttempts })}</span>
          <Button disabled={catalog.loading || latest.rework.attempt >= latest.rework.maxAttempts}
            onClick={() => { continueProject(id, latest.checkpoint) }}>{t('review.rework')}</Button>
        </div>)
      }
      for (const plan of plans) {
        const mainSession = plan.originSessionId ?? catalog.records.find(record => record.projectId === plan.executionId)?.sessionId
        if (!mainSession) items.push(<div className={css.pendingItem} key={`adopt-${plan.id}`}>
          <span>{t('plan.unlinked')}</span>
          <Button onClick={() => { adoptPlan(plan.id, plan.revision) }}>{t('plan.adopt')}</Button>
        </div>)
      }
      return items.length > 0 ? <section className={css.pending}>
        <h2>{t('board.pending')}</h2>
        {items}
      </section> : null
    })()}

    {entries.map(([id, records]) => fullBoard === id ? null : renderBoard(id, records, false))}

    {fullBoard !== null && (() => {
      const entry = entries.find(([id]) => id === fullBoard)
      if (!entry) return null
      return <Modal open headless onClose={() => { setFullBoard(null) }} title={t('board.title')} className={css.boardModal as string}>
        {renderBoard(entry[0], entry[1], true)}
      </Modal>
    })()}

    <section className={css.project}>
      <header className={css.header}>
        <h2>{t('plan.title')}</h2><Button onClick={preparePlan}>{t('plan.prepare')}</Button>
      </header>
      {plans.map((plan) => {
        const mainSession = plan.originSessionId ?? catalog.records.find(record => record.projectId === plan.executionId)?.sessionId
        return <article key={plan.id} id={`plan-${plan.id}`}>
          <header className={css.header}><h3>{plan.goal}</h3>
            <Button disabled={!mainSession} onClick={() => { editPlan(plan.id, plan.revision) }}>{t('plan.edit')}</Button>
          </header>
          <p>{t('plan.version', { revision: plan.revision })} · {plan.team.name} · <StatusChip tone={statusTone(plan.confirmed ? 'confirmed' : 'draft')}>{t(plan.confirmed ? 'plan.confirmed' : 'plan.draft')}</StatusChip></p>
          <p>{plan.document
            ? <FileChip path={plan.document.path} triggerProps={fileTrigger(mainSession, plan.document.path)} />
            : t('artifacts.missing-document')}</p>
          <ul className={css.tasks}>{plan.employees.map(employee => <li key={employee.id}>
            <strong>{employee.name}</strong> {employee.provider} / {employee.model}
            <p>{employee.responsibility}</p>{employee.preset && <p>{employee.preset}</p>}
          </li>)}</ul>
          {plan.background.length > 0 && <details>
            <summary>{t('plan.background')}</summary>
            {plan.background.map((item, index) => <div key={index}><p>{item.title}</p><p>{item.source}</p><pre>{item.content}</pre></div>)}
          </details>}
          {!mainSession && <p>{t('plan.unlinked')}</p>}
          {plan.executionId ? <p>{t('project.started')}</p> : plan.confirmed
            ? <Button disabled={!plan.document || catalog.loading || !mainSession} onClick={() => { runPlan(plan.id, plan.revision) }}>{t('plan.run')}</Button>
            : <Button variant="primary" disabled={!plan.document || catalog.loading}
              onClick={() => { void confirmPlan(plan.id, plan.revision) }}>{t('plan.confirm')}</Button>}
        </article>
      })}
    </section>

    <RosterEditor employees={catalog.employees} teams={catalog.teams} connections={catalog.connections}
      connectionsLoading={catalog.connectionsLoading} connectionsFailed={catalog.connectionsFailed}
      loading={catalog.loading} saveEmployee={saveEmployee} saveTeam={saveTeam} delegateTeam={delegateTeam}
      openModelSettings={props.openModelSettings} t={t} />

    {!catalog.loading && !catalog.failed && projects.size === 0 && <div className={css.empty}>
      <h2>{t('project.empty')}</h2><p>{t('project.hint')}</p>
    </div>}
  </section>
}
