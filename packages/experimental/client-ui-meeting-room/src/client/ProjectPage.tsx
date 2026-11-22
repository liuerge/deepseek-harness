/** Project workbench: a status board over the persisted plan and execution checkpoints. */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Employee, ProjectTeam, ProjectPlan, AcceptanceReport } from '@deepseek-ai/dsh-experimental-meeting-room/types'
import type { ContextMenuTriggerProps } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, IconChevronDownOutlineRegular, IconCloseOutlineRegular, IconFullscreenOutlineRegular, Input, Modal, SegmentedControl, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import css from './ProjectPage.module.css'
import { StatusChip, statusTone } from './StatusChip.tsx'
import { FileChip } from './FileChip.tsx'
import { RosterAvatar } from './RosterAvatar.tsx'
import type { RosterConnection } from '@deepseek-ai/dsh-experimental-meeting-room/types'

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
  newProject: (request?: { name: string; instructions?: string | undefined }) => void
  openRoster: () => void
  readArtifact: (sessionId: string, path: string) => Promise<{ path: string; sha256?: string; content: string }>
  preparePlan: () => void
  confirmPlan: (id: string, revision: number) => Promise<void>
  runPlan: (id: string, revision: number) => void
  editPlan: (id: string, revision: number) => void
  approveAcceptance: (id: string, checkpoint: number) => Promise<void>
  continueProject: (id: string, checkpoint: number) => void
  openMain: (id: string, projectId: string) => void
  stopExecution: (sessionId: string) => void
  openArtifactLocation: (sessionId: string, path: string, action: 'open' | 'reveal', application?: string) => Promise<void>
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

/** Preset project templates shown on the workbench list; each pre-fills the new-project dialog from locale keys. */
const PROJECT_TEMPLATES = [
  { nameKey: 'list.template.1.name', descriptionKey: 'list.template.1.description', instructionsKey: 'list.template.1.instructions' },
  { nameKey: 'list.template.2.name', descriptionKey: 'list.template.2.description', instructionsKey: 'list.template.2.instructions' },
  { nameKey: 'list.template.3.name', descriptionKey: 'list.template.3.description', instructionsKey: 'list.template.3.instructions' },
  { nameKey: 'list.template.4.name', descriptionKey: 'list.template.4.description', instructionsKey: 'list.template.4.instructions' },
  { nameKey: 'list.template.5.name', descriptionKey: 'list.template.5.description', instructionsKey: 'list.template.5.instructions' },
] as const

/** Pinned project ids persist per browser; pinning only reorders the workbench list. */
const PIN_STORAGE_KEY = 'meetingRoom.pinnedProjects'

/** Reads the pinned project ids from local storage; corrupt entries fall back to none. */
function readPinnedProjects(): string[] {
  try {
    const raw = window.localStorage.getItem(PIN_STORAGE_KEY)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch (_error) { return [] }
}

const COLUMNS = [
  { key: 'pending', label: 'board.column.pending', tone: 'idle' },
  { key: 'active', label: 'board.column.active', tone: 'ongoing' },
  { key: 'review', label: 'board.column.review', tone: 'warning' },
  { key: 'done', label: 'board.column.done', tone: 'done' },
  { key: 'blocked', label: 'board.column.blocked', tone: 'error' },
] as const

/** Whether a checkpoint state belongs to an in-flight execution that can be interrupted. */
function isInFlight(state: string | undefined): boolean {
  return state !== undefined && ['starting', 'running', 'task-produced', 'reviewer-produced', 'resuming', 'reworking', 'awaiting-acceptance', 'awaiting-human', 'awaiting-review'].includes(state)
}

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

/** One read-only row of the project asset table, keyed by kind for localized rendering. */
type AssetRow = {
  path: string
  hash?: string | undefined
  sessionId?: string | undefined
  /** Zero-based owning task position; the plan document row has none. */
  taskIndex?: number | undefined
  kind: 'plan' | 'planned' | 'verified'
}

/** Aggregate the plan document, planned artifact paths and verified report artifacts, deduplicated by path and version. */
function collectAssets(plan: ProjectPlan | undefined, records: ProjectCheckpoint[]): AssetRow[] {
  const rows: AssetRow[] = []
  if (plan?.document) rows.push({ path: plan.document.path, hash: plan.document.sha256, kind: 'plan' })
  for (const [index, task] of (plan?.tasks ?? []).entries()) {
    for (const path of task.review?.artifactPaths ?? []) {
      rows.push({ path, taskIndex: index, kind: 'planned' })
    }
  }
  const verified = new Map<string, { path: string; sha256: string; sessionId: string | undefined; taskIndex: number }>()
  for (const record of records) {
    for (const artifact of record.report?.artifacts ?? []) {
      const key = `${artifact.path}:${artifact.sha256}`
      if (!verified.has(key)) {
        verified.set(key, { path: artifact.path, sha256: artifact.sha256, sessionId: record.sessionId, taskIndex: record.index ?? 0 })
      }
    }
  }
  for (const artifact of verified.values()) {
    rows.push({ path: artifact.path, hash: artifact.sha256, sessionId: artifact.sessionId, taskIndex: artifact.taskIndex, kind: 'verified' })
  }
  return rows
}

/**
 * Render saved employees, the confirmed plan and a status board of actual executions.
 * @param props - Host catalog, localized copy and navigation actions.
 * @returns Workbench with loading, failure and empty feedback.
 */
export function ProjectPage(props: Props) {
  const { useCatalog, t, refresh, newProject, openRoster, readArtifact, useContextMenu } = props
  const { preparePlan, confirmPlan, runPlan, editPlan, approveAcceptance, continueProject } = props
  const { openMain, openWorker, stopExecution, openArtifactLocation, adoptPlan } = props
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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'workspace'>('list')
  const [, setPinnedRevision] = useState(0)
  const primary = entries.find(([id]) => id === selectedProjectId) ?? entries[0]
  const pinnedProjects = readPinnedProjects()
  const listProjects = entries.map(([id, records]) => ({
    id,
    goal: records.find(record => record.goal)?.goal ?? id,
    latest: records.at(-1),
    plan: catalog.plans.find(item => item.executionId === id),
    pinned: pinnedProjects.includes(id),
    running: records.at(-1) !== undefined && !['completed', 'failed', 'interrupted'].includes(records.at(-1)?.state ?? 'completed'),
  })).sort((left, right) => (right.pinned ? 1 : 0) - (left.pinned ? 1 : 0)
    || (right.running ? 1 : 0) - (left.running ? 1 : 0))
  const draftPlans = plans.filter(plan => plan.executionId === undefined)
  const detailPlans = primary === undefined ? [] : plans.filter(plan => plan.executionId === primary[0])
  const primaryPlan = primary
    ? catalog.plans.find(item => item.executionId === primary[0]) ?? plans[0]
    : plans[0]
  const primaryLatest = primary?.[1].at(-1)
  const primaryGoal = primary?.[1].find(record => record.goal)?.goal ?? primaryPlan?.goal ?? primary?.[0] ?? ''
  const [openDetail, setOpenDetail] = useState<{ id: string; index: number } | null>(null)
  const [fullBoard, setFullBoard] = useState<string | null>(null)
  const [listViews, setListViews] = useState<ReadonlySet<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set())
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newInstructions, setNewInstructions] = useState('')
  const submitNewProject = (): void => {
    newProject({ name: newName, instructions: newInstructions })
    setNewProjectOpen(false)
    setNewName('')
    setNewInstructions('')
  }
  /** Scrolls an in-page target clear of the fixed app header and flashes its border as a focus cue. */
  const flashScrollTo = (id: string | undefined): void => {
    if (id === undefined || id === '') return
    const node = document.getElementById(id)
    if (!node) return
    node.scrollIntoView({ block: 'start', behavior: 'smooth' })
    node.classList.add(css.focusFlash as string)
    window.setTimeout(() => { node.classList.remove(css.focusFlash as string) }, 1800)
  }
  const togglePinned = (id: string): void => {
    const pinned = readPinnedProjects()
    const next = pinned.includes(id) ? pinned.filter(item => item !== id) : [...pinned, id]
    window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(next))
    setPinnedRevision(revision => revision + 1)
  }
  const [fileView, setFileView] = useState<{ sessionId: string; path: string; hash?: string | undefined } | null>(null)
  const [fileContent, setFileContent] = useState<{
    loading: boolean
    content?: string
    sha256?: string
    error?: string
  }>({ loading: false })
  const [openError, setOpenError] = useState<string | undefined>(undefined)
  const openArtifact = (sessionId: string | undefined, path: string, hash?: string): void => {
    if (sessionId === undefined || sessionId === '') return
    setFileView({ sessionId, path, hash })
    setOpenError(undefined)
    setFileContent({ loading: true })
    void readArtifact(sessionId, path).then((result) => {
      setFileContent({ loading: false, content: result.content, ...(result.sha256 === undefined ? {} : { sha256: result.sha256 }) })
    }).catch((error: unknown) => {
      setFileContent({ loading: false, error: error instanceof Error ? error.message : String(error) })
    })
  }

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
    const isList = listViews.has(id)
    const columns: Record<ColumnKey, ReactNode[]> = { pending: [], active: [], review: [], done: [], blocked: [] }
    const rows: Record<ColumnKey, ReactNode[]> = { pending: [], active: [], review: [], done: [], blocked: [] }
    const assetRows = collectAssets(plan, records).map((row, position) => ({
      ...row,
      rowKey: `${row.kind}-${position}`,
      source: row.kind === 'plan' ? t('assets.plan') : t('assets.task', { index: (row.taskIndex ?? 0) + 1 }),
      kindLabel: t(row.kind === 'plan' ? 'assets.kind-plan' : row.kind === 'planned' ? 'assets.kind-planned' : 'assets.kind-verified'),
    }))
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
          <FileChip key={path} path={path} onOpen={() => { openArtifact(record?.sessionId, path) }} />)}</div>}
        <div className={css.cardActions}>
          {parentId && childId && <Button size="sm" variant="outline"
            onClick={() => { openWorker(parentId, childId) }}>{t('project.open-worker')}</Button>}
          <Button size="sm" variant="outline" onClick={() => { setOpenDetail(open ? null : { id, index }) }}>
            {t(open ? 'board.close' : 'board.task-detail')}
          </Button>
        </div>
      </article>)
      rows[column].push(<article className={css.listRow} key={index}>
        <RosterAvatar id={task.employeeId ?? task.role} name={employee?.name ?? task.role} />
        <div className={css.listRowMain}>
          <strong>{employee?.name ?? task.role}</strong>
          <span className={css.listRowRole}>{task.role}</span>
          {teamTask && <span className={css.secondary}>
            {t('project.team-task', { id: teamTask.id, status: t(`project.team-status.${teamTask.status}`) })}
          </span>}
        </div>
        <StatusChip tone={statusTone(state)}>{label(state)}</StatusChip>
        <div className={css.cardActions}>
          {parentId && childId && <Button size="sm" variant="outline"
            onClick={() => { openWorker(parentId, childId) }}>{t('project.open-worker')}</Button>}
          <Button size="sm" variant="outline" onClick={() => { setOpenDetail(open ? null : { id, index }) }}>
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
        <div className={css.actions}>
          <SegmentedControl id={`board-view-${id}`} className={css.viewSwitch}
            value={isList ? 'list' : 'board'}
            options={[{ value: 'board', label: t('board.view-board') }, { value: 'list', label: t('board.view-list') }]}
            onChange={(next) => { setListViews((current) => {
              const views = new Set(current)
              if (next === 'list') views.add(id)
              else views.delete(id)
              return views
            }) }} label={t('board.view-switch')} />
          {fullscreen
            ? <Button size="sm" icon={<IconCloseOutlineRegular size={14} />}
              data-modal-autofocus onClick={() => { setFullBoard(null) }}>{t('board.exit-fullscreen')}</Button>
            : <Button size="sm" icon={<IconFullscreenOutlineRegular size={14} />}
              onClick={() => { setFullBoard(id) }}>{t('board.fullscreen')}</Button>}
        </div>
      </header>
      {goalRecord?.teamLink === 'disabled' && <p className={css.secondary}>{t('project.team-disabled')}</p>}
      {goalRecord?.teamLink === 'unavailable' && <p className={css.secondary}>{t('project.team-unavailable')}</p>}
      {isList ? <div className={css.listGroups} id={`board-view-${id}-list-panel`}
        aria-labelledby={`board-view-${id}-list`}>
        {COLUMNS.map((column) => {
          const groupRows = rows[column.key]
          if (groupRows.length === 0) return null
          const groupKey = `${id}:${column.key}`
          const expanded = !collapsedGroups.has(groupKey)
          return <div className={css.listGroup} key={column.key}>
            <button type="button" className={css.listGroupHead} data-tone={column.tone} aria-expanded={expanded}
              onClick={() => { setCollapsedGroups((current) => {
                const groups = new Set(current)
                if (groups.has(groupKey)) groups.delete(groupKey)
                else groups.add(groupKey)
                return groups
              }) }}>
              <IconChevronDownOutlineRegular className={css.listChevron} />
              <StateDot state={column.tone} className={css.columnDot} />
              <span>{t(column.label)}</span>
              <span className={css.count}>{groupRows.length}</span>
            </button>
            {expanded && <div className={css.listRows}>{groupRows}</div>}
          </div>
        })}
        {tasks.length === 0 && <p className={css.emptyColumn}>{t('board.empty-column')}</p>}
      </div>
        : <div className={css.columns} id={`board-view-${id}-board-panel`} aria-labelledby={`board-view-${id}-board`}>
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
        </div>}
      <section className={css.assets} id={`assets-${id}`}>
        <header className={css.assetsHead}>
          <h3>{t('board.assets')}</h3>
          <span className={css.count}>{assetRows.length}</span>
        </header>
        {assetRows.length === 0
          ? <p className={css.emptyColumn}>{t('assets.empty')}</p>
          : <div className={css.assetsTable}>{assetRows.map(row => <div className={css.assetsRow} key={row.rowKey}>
            <span className={css.assetFile}>
              <FileChip path={row.path} hash={row.hash}
                onOpen={() => { openArtifact(row.sessionId ?? records.at(-1)?.sessionId, row.path, row.hash) }} />
            </span>
            <span className={css.assetSource}>{row.source}</span>
            <span className={css.assetKind}>{row.kindLabel}</span>
          </div>)}</div>}
      </section>
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

  return <section className={viewMode === 'workspace' && primary ? `${css.page} ${css.pageWide}` : css.page}>
    <header className={css.header}>
      <h1>{t('project.title')}</h1>
      <div className={css.actions}>
        {viewMode === 'workspace' && <Button variant="outline" onClick={() => { setViewMode('list') }}>{t('project.back-to-list')}</Button>}
        <Button variant="outline" disabled={catalog.loading} onClick={refresh}>{t('project.refresh')}</Button>
        <Button variant="primary" onClick={() => { setNewProjectOpen(true) }}>{t('project.new')}</Button>
        <Button variant="outline" onClick={openRoster}>{t('rail.team-config')}</Button>
      </div>
    </header>
    {catalog.loading && <p role="status">{t('project.loading')}</p>}
    {catalog.failed && <p role="alert">{t('project.error')}</p>}
    {viewMode === 'list' ? <>
      <div className={css.projectList}>
        <h2>{t('list.projects')}</h2>
        {listProjects.length === 0 && draftPlans.length === 0 && <p className={css.emptyColumn}>{t('list.empty')}</p>}
        {listProjects.map(project => <button type="button" key={project.id} className={css.projectCard}
          onClick={() => { setSelectedProjectId(project.id); setViewMode('workspace') }}>
          <span className={css.projectCardHead}>
            <StateDot state={statusTone(project.latest?.state ?? 'pending')} className={css.columnDot} />
            <strong>{project.goal}</strong>
            {project.pinned && <span className={css.railMeta}>{t('list.pinned')}</span>}
          </span>
          <span className={css.projectCardMeta}>
            <StatusChip tone={statusTone(project.latest?.state ?? 'pending')}>{label(project.latest?.state ?? 'pending')}</StatusChip>
            {project.plan && <span>{t('plan.version', { revision: project.plan.revision })} · {project.plan.team.name}</span>}
            <span className={css.railMeta}
              role="button" tabIndex={0}
              onClick={(event) => { event.stopPropagation(); togglePinned(project.id) }}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); togglePinned(project.id) } }}>
              {project.pinned ? t('list.unpin') : t('list.pin')}
            </span>
          </span>
        </button>)}
        {draftPlans.map((plan) => {
          const mainSession = plan.originSessionId ?? catalog.records.find(record => record.projectId === plan.executionId)?.sessionId
          return <div key={plan.id} className={css.projectCard}>
            <span className={css.projectCardHead}><strong>{plan.goal}</strong></span>
            <span className={css.projectCardMeta}>
              <StatusChip tone={statusTone(plan.confirmed ? 'confirmed' : 'draft')}>{t(plan.confirmed ? 'plan.confirmed' : 'plan.draft')}</StatusChip>
              <span>{t('plan.unlinked')}</span>
              <Button variant="outline" size="sm" disabled={!mainSession} onClick={() => { editPlan(plan.id, plan.revision) }}>{t('plan.edit')}</Button>
              {plan.confirmed
                ? <Button variant="primary" size="sm" disabled={!plan.document || catalog.loading || !mainSession} onClick={() => { runPlan(plan.id, plan.revision) }}>{t('plan.run')}</Button>
                : <Button variant="primary" size="sm" disabled={!plan.document || catalog.loading}
                  onClick={() => { void confirmPlan(plan.id, plan.revision) }}>{t('plan.confirm')}</Button>}
              <Button variant="outline" size="sm" onClick={() => { adoptPlan(plan.id, plan.revision) }}>{t('plan.adopt')}</Button>
            </span>
          </div>
        })}
      </div>
      <div className={css.templateGrid}>
        <h2>{t('list.templates')}</h2>
        <div className={css.templateCards}>
          {PROJECT_TEMPLATES.map(template => <button type="button" key={template.nameKey} className={css.templateCard}
            onClick={() => { setNewName(t(template.nameKey)); setNewInstructions(t(template.instructionsKey)); setNewProjectOpen(true) }}>
            <strong>{t(template.nameKey)}</strong>
            <span>{t(template.descriptionKey)}</span>
          </button>)}
        </div>
      </div>
    </> : <>
      <div className={css.workbench}>
        <div className={css.main}>
          {catalog.loading && <p role="status">{t('project.loading')}</p>}
          {!catalog.loading && catalog.employees.length === 0 && <p role="alert" className={css.pendingItem}>
            <span>{t('project.roster-empty-hint')}</span>
            <Button variant="outline" size="sm" onClick={openRoster}>{t('rail.team-config')}</Button>
          </p>}

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
                  flashScrollTo(`plan-${primaryPlan.id}`)
                }}>{t('project.view-plan')}</a></>}
            {primaryLatest && <StatusChip tone={statusTone(primaryLatest.state)}>{label(primaryLatest.state)}</StatusChip>}
            <span className={css.actions}>
              <Button variant="outline" onClick={() => { openMain(primary[1][0]?.sessionId ?? primaryLatest?.sessionId ?? '', primary[0]) }}>
                {t('project.correct-main')}
              </Button>
              {isInFlight(primaryLatest?.state) && <Button variant="outline"
                onClick={() => { stopExecution(primary[1][0]?.sessionId ?? primaryLatest?.sessionId ?? '') }}>
                {t('project.stop')}
              </Button>}
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
                <Button variant="outline" disabled={catalog.loading || latest.rework.attempt >= latest.rework.maxAttempts}
                  onClick={() => { continueProject(id, latest.checkpoint) }}>{t('review.rework')}</Button>
              </div>)
            }
            for (const plan of plans) {
              const mainSession = plan.originSessionId ?? catalog.records.find(record => record.projectId === plan.executionId)?.sessionId
              if (!mainSession) items.push(<div className={css.pendingItem} key={`adopt-${plan.id}`}>
                <span>{t('plan.unlinked')}</span>
                <Button variant="outline" onClick={() => { adoptPlan(plan.id, plan.revision) }}>{t('plan.adopt')}</Button>
              </div>)
            }
            return items.length > 0 ? <section className={css.pending}>
              <h2>{t('board.pending')}</h2>
              {items}
            </section> : null
          })()}

          <section className={css.project}>
            <header className={css.header}>
              <h2>{t('plan.title')}</h2><Button variant="outline" onClick={preparePlan}>{t('plan.prepare')}</Button>
            </header>
            {detailPlans.map((plan, planIndex) => {
              const mainSession = plan.originSessionId ?? catalog.records.find(record => record.projectId === plan.executionId)?.sessionId
              const doc = plan.document
              const started = plan.executionId !== undefined
              return <article key={plan.id} id={`plan-${plan.id}`} className={css.planCard}>
                <header className={css.planCardHead}>
                  <h3><span className={css.planIndex}>{String(planIndex + 1).padStart(2, '0')}</span>{plan.goal}</h3>
                  <Button variant="outline" disabled={!mainSession} onClick={() => { editPlan(plan.id, plan.revision) }}>{t('plan.edit')}</Button>
                </header>
                <div className={css.planMetaBox}>
                  <span>{t('plan.version', { revision: plan.revision })}</span>
                  <span>·</span>
                  <span>{plan.team.name}</span>
                  <StatusChip tone={statusTone(plan.confirmed ? 'confirmed' : 'draft')}>
                    {t(plan.confirmed ? 'plan.confirmed' : 'plan.draft')}
                  </StatusChip>
                  {started && <StatusChip tone={statusTone('started')}>{t('project.started')}</StatusChip>}
                  <span>{doc
                    ? <FileChip path={doc.path} onOpen={() => { openArtifact(mainSession, doc.path, doc.sha256) }} />
                    : t('artifacts.missing-document')}</span>
                </div>
                <ul className={css.planEmployees}>{plan.employees.map(employee => <li key={employee.id}>
                  <div className={css.planEmployeeHead}>
                    <strong>{employee.name}</strong>
                    <span className={css.routeTag}>{employee.provider} / {employee.model}</span>
                  </div>
                  <p>{employee.responsibility}</p>{employee.preset && <p>{employee.preset}</p>}
                </li>)}</ul>
                {plan.background.length > 0 && <details className={css.backgroundBlock}>
                  <summary>{t('plan.background')} · {plan.background.length}</summary>
                  {plan.background.map((item, index) => <details key={index} className={css.backgroundItem}>
                    <summary>{item.title}</summary>
                    <p className={css.backgroundSource}>{item.source}</p>
                    <pre>{item.content}</pre>
                  </details>)}
                </details>}
                <div className={css.planActions}>
                  {!mainSession && <span className={css.secondary}>{t('plan.unlinked')}</span>}
                  {!started && (plan.confirmed
                    ? <Button variant="primary" disabled={!plan.document || catalog.loading || !mainSession} onClick={() => { runPlan(plan.id, plan.revision) }}>{t('plan.run')}</Button>
                    : <Button variant="primary" disabled={!plan.document || catalog.loading}
                      onClick={() => { void confirmPlan(plan.id, plan.revision) }}>{t('plan.confirm')}</Button>)}
                </div>
              </article>
            })}
          </section>

          {primary && renderBoard(primary[0], primary[1], false)}

          {fullBoard !== null && (() => {
            const entry = entries.find(([id]) => id === fullBoard)
            if (!entry) return null
            return <Modal open headless onClose={() => { setFullBoard(null) }} title={t('board.title')} className={css.boardModal as string}>
              {renderBoard(entry[0], entry[1], true)}
            </Modal>
          })()}


          {!catalog.loading && !catalog.failed && projects.size === 0 && <div className={css.empty}>
            <h2>{t('project.empty')}</h2><p>{t('project.hint')}</p>
          </div>}
        </div>
      </div>
    </>}
    <Modal open={fileView !== null} onClose={() => { setFileView(null) }} title={fileView === null ? '' : fileView.path.replaceAll('\\', '/').split('/').at(-1) ?? ''} closeLabel={t('roster.cancel')}
      className={css.fileViewerModal as string} contentClassName={css.fileViewerContent as string}>
      {fileContent.loading && <p role="status">{t('project.loading')}</p>}
      {fileContent.error !== undefined && <p role="alert">{fileContent.error}</p>}
      {fileContent.content !== undefined && <pre className={css.fileViewerPre}>{fileContent.content}</pre>}
      {fileView?.hash !== undefined && <p className={css.secondary}>{fileView.hash}</p>}
      {openError !== undefined && <p role="alert">{openError}</p>}
      <div className={css.fileViewerActions}>
        <Button variant="outline" size="sm" onClick={() => {
          if (fileView === null) return
          void openArtifactLocation(fileView.sessionId, fileView.path, 'reveal')
            .catch((error: unknown) => { setOpenError(error instanceof Error ? error.message : String(error)) })
        }}>{t('viewer.open-folder')}</Button>
        <Button variant="outline" size="sm" onClick={() => {
          if (fileView === null) return
          void openArtifactLocation(fileView.sessionId, fileView.path, 'open')
            .catch((error: unknown) => { setOpenError(error instanceof Error ? error.message : String(error)) })
        }}>{t('viewer.open-app')}</Button>
        <Button variant="outline" size="sm" onClick={() => {
          if (fileView === null) return
          void openArtifactLocation(fileView.sessionId, fileView.path, 'open', 'vscode')
            .catch((error: unknown) => { setOpenError(error instanceof Error ? error.message : String(error)) })
        }}>{t('viewer.open-vscode')}</Button>
        <Button variant="outline" size="sm" onClick={() => {
          const blob = new Blob([fileContent.content ?? ''], { type: 'text/plain;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = fileView === null ? 'artifact.txt' : fileView.path.replaceAll('\\', '/').split('/').at(-1) ?? 'artifact.txt'
          anchor.click()
          URL.revokeObjectURL(url)
        }}>{t('viewer.download')}</Button>
        <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(fileView?.path ?? '') }}>
          {t('viewer.copy-path')}
        </Button>
      </div>
    </Modal>
    <Modal open={newProjectOpen} onClose={() => { setNewProjectOpen(false) }} title={t('project.new-title')} closeLabel={t('roster.cancel')}
      className={css.newProjectModal as string} contentClassName={css.newProjectModalContent as string}>
      <div className={css.newProjectForm}>
        <label>{t('project.new-name')}<Input required value={newName} autoFocus
          onChange={(event) => { setNewName(event.target.value) }} /></label>
        <label>{t('project.new-instructions')}<textarea value={newInstructions}
          onChange={(event) => { setNewInstructions(event.target.value) }} /></label>
        <p className={css.secondary}>{t('project.new-hint')}</p>
        <div className={css.actions}>
          <Button variant="primary" disabled={newName.trim() === ''} onClick={submitNewProject}>{t('project.new-confirm')}</Button>
          <Button onClick={() => { setNewProjectOpen(false) }}>{t('roster.cancel')}</Button>
        </div>
      </div>
    </Modal>
  </section>
}
