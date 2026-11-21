// @vitest-environment jsdom

/** Workbench interactions: list navigation, plan lifecycle, artifact viewer, board views and pending approvals. */
import { afterEach, beforeAll, expect, it, vi, type Mock } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { Employee, ProjectPlan, ProjectTeam, AcceptanceReport } from '@deepseek-ai/dsh-meeting-room/types'
import { ProjectPage, type ProjectCheckpoint } from '../src/client/ProjectPage.tsx'
import { FileChip } from '../src/client/FileChip.tsx'
import { RosterPanel } from '../src/client/RosterPanel.tsx'
import { statusTone } from '../src/client/StatusChip.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

beforeAll(() => {
  // jsdom does not implement smooth scrolling; the anchor handler only needs the call.
  if (Element.prototype.scrollIntoView === undefined) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => {}, configurable: true, writable: true })
  }
})

const employee: Employee = { id: 'author' as Employee['id'], revision: 1, name: 'Author',
  responsibility: 'Develop.', provider: 'vendor-a', model: 'm1' }

const team: ProjectTeam = { id: 'team' as ProjectTeam['id'], revision: 1, name: 'Delivery team', memberIds: [employee.id] }

const report: AcceptanceReport = { planId: 'plan' as AcceptanceReport['planId'], planRevision: 2, index: 0,
  artifacts: [{ sourcePath: 'hello.txt', path: 'build/hello.txt', sha256: 'a'.repeat(64) }], passed: true,
  reviewers: [{ employeeId: employee.id, sessionId: 'reviewer-session',
    criteria: [{ id: 'AC-1', status: 'pass', notes: 'Verified content', evidencePaths: ['build/hello.txt'] }] }] }

function plan(overrides: Partial<ProjectPlan> = {}): ProjectPlan {
  return {
    id: 'plan' as ProjectPlan['id'], revision: 2, goal: 'Delivery goal', originSessionId: 'main',
    executionId: 'project' as ProjectPlan['executionId'], confirmed: true,
    document: { path: 'D:/work/plan.md', sha256: 'b'.repeat(64), cwd: 'D:/work' },
    background: [{ title: 'Context', source: 'notes.md', content: 'Background material' }],
    team, employees: [{ ...employee, preset: '预置职责' }],
    tasks: [{ employeeId: employee.id, role: 'Developer', instruction: 'Build it', acceptance: 'It works',
      review: { reviewerIds: [employee.id], release: 'automatic', artifactPaths: ['build/hello.txt'],
        downstream: ['Released delivery'], criteria: [{ id: 'AC-1', description: 'Content matches', method: 'Read the file',
          expected: 'hello walkthrough', evidence: 'build/hello.txt' }] } }],
    ...overrides,
  }
}

function records(extra: ProjectCheckpoint[] = []): ProjectCheckpoint[] {
  return [
    { sessionId: 'main', projectId: 'project', checkpoint: 1, state: 'started', goal: 'Delivery goal',
      tasks: [{ role: 'Developer', instruction: 'Build it', acceptance: 'It works' }] },
    { sessionId: 'main', projectId: 'project', checkpoint: 2, state: 'running', index: 0, parentSessionId: 'main',
      childSessionId: 'worker-1', handoff: 'Worker handoff note' },
    ...extra,
  ]
}

/** Catalog snapshot shape the workbench reads. */
interface Catalog {
  records: ProjectCheckpoint[]
  employees: Employee[]
  teams: ProjectTeam[]
  plans: ProjectPlan[]
  loading: boolean
  failed: boolean
  connections: { id: string; name: string; models: { id: string; name: string }[]; failed: boolean }[]
  connectionsLoading: boolean
  connectionsFailed: boolean
}

const baseCatalog: Catalog = { records: records(), employees: [employee], teams: [team], plans: [plan()],
  loading: false, failed: false,
  connections: [{ id: 'vendor-a', name: 'Vendor A', models: [{ id: 'm1', name: 'M one' }], failed: false }],
  connectionsLoading: false, connectionsFailed: false }

/** Render the workbench over a static catalog snapshot and expose the action stubs. */
function renderPage(catalog: Catalog, overrides: Record<string, unknown> = {}) {
  const useCatalog = <S,>(select: (value: Catalog) => S): S => select(catalog)
  const props = {
    useCatalog, t: makeTranslate(zh), refresh: vi.fn(), newProject: vi.fn(), openRoster: vi.fn(),
    readArtifact: vi.fn(async () => ({ path: 'build/hello.txt', sha256: 'c'.repeat(64), content: 'file content' })),
    preparePlan: vi.fn(), confirmPlan: vi.fn(async () => {}), runPlan: vi.fn(), editPlan: vi.fn(),
    useContextMenu: () => ({ getTriggerProps: (target?: unknown) => ({ 'data-menu-target': JSON.stringify(target ?? null) }) }),
    approveAcceptance: vi.fn(async () => {}), continueProject: vi.fn(), openMain: vi.fn(), openWorker: vi.fn(),
    adoptPlan: vi.fn(), ...overrides,
  } as Parameters<typeof ProjectPage>[0]
  render(<ProjectPage {...props} />)
  return props as {
    newProject: Mock
    readArtifact: Mock
    confirmPlan: Mock
    approveAcceptance: Mock
    continueProject: Mock
    openMain: Mock
    openWorker: Mock
    adoptPlan: Mock
    editPlan: Mock
    runPlan: Mock
    refresh: Mock
  }
}

const PIN_KEY = 'meetingRoom.pinnedProjects'

it('renders the project list with pinning, templates and the new-project dialog', () => {
  window.localStorage.removeItem(PIN_KEY)
  const actions = renderPage(baseCatalog)
  expect(screen.getByText(zh['list.projects'])).toBeTruthy()
  expect(screen.getByText('Delivery goal')).toBeTruthy()
  expect(screen.getByRole('button', { name: zh['list.pin'] })).toBeTruthy()
  expect(screen.getByText(zh['list.templates'])).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: new RegExp(zh['list.template.1.name']) }))
  const dialog = screen.getByRole('dialog', { name: zh['project.new-title'] })
  expect(within(dialog).getByDisplayValue(zh['list.template.1.name'])).toBeTruthy()
  expect(within(dialog).getByDisplayValue(zh['list.template.1.instructions'])).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: zh['project.new-confirm'] }))
  expect(actions.newProject).toHaveBeenCalledWith({ name: zh['list.template.1.name'], instructions: zh['list.template.1.instructions'] })
  expect(screen.queryByRole('dialog', { name: zh['project.new-title'] })).toBeNull()
})

it('keeps the new-project dialog gated on a name and closes it without side effects', () => {
  const actions = renderPage(baseCatalog)
  fireEvent.click(screen.getByRole('button', { name: zh['project.new'] }))
  const dialog = screen.getByRole('dialog', { name: zh['project.new-title'] })
  expect(within(dialog).getByRole('button', { name: zh['project.new-confirm'] }).hasAttribute('disabled')).toBe(true)
  fireEvent.change(within(dialog).getByLabelText(zh['project.new-name']), { target: { value: '新项目' } })
  fireEvent.change(within(dialog).getByLabelText(zh['project.new-instructions']), { target: { value: '指令内容' } })
  expect(within(dialog).getByRole('button', { name: zh['project.new-confirm'] }).hasAttribute('disabled')).toBe(false)
  fireEvent.click(within(dialog).getAllByRole('button', { name: zh['roster.cancel'] })[0]!)
  expect(screen.queryByRole('dialog', { name: zh['project.new-title'] })).toBeNull()
  expect(actions.newProject).not.toHaveBeenCalled()
})

it('pins projects through pointer and keyboard and reads corrupt pin storage as empty', () => {
  window.localStorage.removeItem(PIN_KEY)
  renderPage(baseCatalog)
  fireEvent.click(screen.getByRole('button', { name: zh['list.pin'] }))
  expect(JSON.parse(window.localStorage.getItem(PIN_KEY) ?? '[]')).toEqual(['project'])
  expect(screen.getByRole('button', { name: zh['list.unpin'] })).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('button', { name: zh['list.unpin'] }), { key: ' ' })
  expect(JSON.parse(window.localStorage.getItem(PIN_KEY) ?? '[]')).toEqual([])
  window.localStorage.setItem(PIN_KEY, '{corrupt')
  cleanup()
  renderPage(baseCatalog)
  expect(screen.getByRole('button', { name: zh['list.pin'] })).toBeTruthy()
  window.localStorage.removeItem(PIN_KEY)
})

it('offers disabled draft actions on the list and adopts through the exact plan revision', () => {
  const draft = plan({ id: 'draft' as ProjectPlan['id'], executionId: undefined, confirmed: true,
    revision: 1, originSessionId: undefined })
  const actions = renderPage({ ...baseCatalog, plans: [draft], records: [] })
  expect(screen.getByRole('button', { name: zh['plan.edit'] }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: zh['plan.run'] }).hasAttribute('disabled')).toBe(true)
  expect(screen.queryByRole('button', { name: zh['plan.confirm'] })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh['plan.adopt'] }))
  expect(actions.adoptPlan).toHaveBeenCalledWith('draft', 1)
})

it('shows loading and failure feedback with the refresh gate before any project content', () => {
  const loading = renderPage({ ...baseCatalog, loading: true, records: [], plans: [] })
  expect(screen.getAllByText(zh['project.loading']).length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: zh['project.refresh'] }).hasAttribute('disabled')).toBe(true)
  loading.refresh.mockClear()
  cleanup()
  renderPage({ ...baseCatalog, failed: true })
  expect(screen.getByText(zh['project.error'])).toBeTruthy()
  expect(screen.getByRole('button', { name: zh['project.refresh'] }).hasAttribute('disabled')).toBe(false)
})

it('enters the workspace, flashes the plan anchor and routes the correction to the main conversation', () => {
  const actions = renderPage(baseCatalog)
  fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
  expect(screen.getByRole('button', { name: zh['project.back-to-list'] })).toBeTruthy()
  const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
  fireEvent.click(screen.getByText(zh['project.view-plan']))
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
  scrollIntoView.mockRestore()
  fireEvent.click(screen.getByRole('button', { name: zh['project.correct-main'] }))
  expect(actions.openMain).toHaveBeenCalledWith('main', 'project')
  expect(screen.getAllByText(zh['plan.version'].replace('{revision}', '2')).length).toBeGreaterThan(1)
})

it('opens the plan document and verified artifacts in the viewer with download and copy actions', async () => {
  const createObjectURL = vi.fn(() => 'blob:mock')
  const revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  try {
    const actions = renderPage(baseCatalog)
    fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
    fireEvent.click(screen.getAllByText('plan.md')[0]!)
    const viewer = await screen.findByRole('dialog', { name: 'plan.md' })
    await waitFor(() => { expect(within(viewer).getByText('file content')).toBeTruthy() })
    expect(within(viewer).getByText('b'.repeat(64))).toBeTruthy()
    fireEvent.click(within(viewer).getByRole('button', { name: zh['viewer.copy-path'] }))
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith('D:/work/plan.md') })
    fireEvent.click(within(viewer).getByRole('button', { name: zh['viewer.download'] }))
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    fireEvent.click(within(viewer).getByRole('button', { name: zh['roster.cancel'] }))
    expect(screen.queryByRole('dialog', { name: 'plan.md' })).toBeNull()
    // Verified artifact rows resolve their read session from the owning record.
    fireEvent.click(screen.getAllByText('hello.txt')[0]!)
    await waitFor(() => { expect(actions.readArtifact).toHaveBeenCalledWith('main', 'build/hello.txt') })
  } finally {
    Object.defineProperty(URL, 'createObjectURL', { value: undefined, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: undefined, configurable: true })
  }
})

it('reports artifact read failures instead of a blank viewer', async () => {
  renderPage(baseCatalog, { readArtifact: vi.fn(async () => { throw new Error('读取失败') }) })
  fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
  fireEvent.click(screen.getAllByText('plan.md')[0]!)
  const viewer = await screen.findByRole('dialog', { name: 'plan.md' })
  await waitFor(() => { expect(within(viewer).getByText('读取失败')).toBeTruthy() })
})

it('keeps the started plan card read-only with editing, background and preset details', () => {
  const actions = renderPage(baseCatalog)
  fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
  expect(screen.getByText(zh['project.started'])).toBeTruthy()
  expect(screen.getByText('预置职责')).toBeTruthy()
  expect(screen.queryByRole('button', { name: zh['plan.confirm'] })).toBeNull()
  const edit = screen.getAllByRole('button', { name: zh['plan.edit'] })
    .find(node => !node.hasAttribute('disabled'))!
  fireEvent.click(edit)
  expect(actions.editPlan).toHaveBeenCalledWith('plan', 2)
  fireEvent.click(screen.getByText(`${zh['plan.background']} · 1`).closest('summary')!)
  expect(screen.getByText('Background material')).toBeTruthy()
  fireEvent.click(screen.getByText('Context').closest('summary')!)
  expect(screen.getByText('notes.md')).toBeTruthy()
})

it('confirms and runs draft plan revisions from the project list', async () => {
  const confirmedDraft = plan({ executionId: undefined })
  const actions = renderPage({ ...baseCatalog, plans: [confirmedDraft] })
  fireEvent.click(screen.getByRole('button', { name: zh['plan.run'] }))
  expect(actions.runPlan).toHaveBeenCalledWith('plan', 2)
  cleanup()
  const draft = plan({ executionId: undefined, confirmed: false })
  const confirmActions = renderPage({ ...baseCatalog, plans: [draft] })
  fireEvent.click(screen.getByRole('button', { name: zh['plan.confirm'] }))
  await waitFor(() => { expect(confirmActions.confirmPlan).toHaveBeenCalledWith('plan', 2) })
})

it('toggles board and list views with collapsible groups and opens worker sessions', () => {
  const actions = renderPage(baseCatalog)
  fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
  fireEvent.click(screen.getByRole('button', { name: zh['project.open-worker'] }))
  expect(actions.openWorker).toHaveBeenCalledWith('main', 'worker-1')
  fireEvent.click(screen.getByRole('tab', { name: zh['board.view-list'] }))
  const group = screen.getAllByRole('button', { name: new RegExp(zh['board.column.active']) })
    .find(node => node.getAttribute('aria-expanded') !== null)!
  expect(group.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(group)
  expect(group.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(group)
  expect(group.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getAllByRole('button', { name: zh['board.task-detail'] })[0]!)
  expect(screen.getByText('Worker handoff note')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: zh['board.close'] })[0]!)
  expect(screen.queryByText('Worker handoff note')).toBeNull()
})

it('renders verified assets and review evidence with the session-bound menu target', () => {
  const reportRecord: ProjectCheckpoint = { sessionId: 'main', projectId: 'project', checkpoint: 3,
    state: 'acceptance-passed', index: 0, report }
  renderPage({ ...baseCatalog, records: [...records(), reportRecord] })
  fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
  expect(screen.getByText(zh['assets.plan'])).toBeTruthy()
  expect(screen.getByText(zh['assets.kind-verified'])).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: zh['board.task-detail'] })[0]!)
  fireEvent.click(screen.getByText(`${zh['review.title']} · ${zh['review.automatic']}`).closest('summary')!)
  expect(screen.getByText(/Content matches/)).toBeTruthy()
  const evidence = screen.getAllByText('hello.txt').at(-1)!.closest('[data-menu-target]')
  expect(JSON.parse(evidence?.getAttribute('data-menu-target') ?? '{}'))
    .toEqual({ kind: 'file', value: { sessionId: 'main', path: 'build/hello.txt' } })
})

it('surfaces pending approvals, continuations and rework allowances with exact checkpoints', async () => {
  const actions = renderPage({ ...baseCatalog, records: records([{ sessionId: 'main', projectId: 'project',
    checkpoint: 3, state: 'awaiting-human', index: 0, report }]) })
  fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
  fireEvent.click(screen.getByRole('button', { name: zh['review.approve'] }))
  await waitFor(() => { expect(actions.approveAcceptance).toHaveBeenCalledWith('project', 3) })
  cleanup()
  const released = renderPage({ ...baseCatalog, records: records([{ sessionId: 'main', projectId: 'project',
    checkpoint: 3, state: 'released', index: 0 }]) })
  fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
  fireEvent.click(screen.getByRole('button', { name: zh['review.continue'] }))
  expect(released.continueProject).toHaveBeenCalledWith('project', 3)
  cleanup()
  const rework = renderPage({ ...baseCatalog, records: records([{ sessionId: 'main', projectId: 'project',
    checkpoint: 3, state: 'acceptance-blocked', index: 0,
    rework: { attempt: 1, maxAttempts: 2 }, report: { ...report, passed: false } }]) })
  fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
  fireEvent.click(screen.getByRole('button', { name: zh['review.rework'] }))
  expect(rework.continueProject).toHaveBeenCalledWith('project', 3)
})

it('marks failed, completed and unknown states in their own board columns', () => {
  renderPage({ ...baseCatalog, records: records([{ sessionId: 'main', projectId: 'project',
    checkpoint: 2, state: 'failed', index: 0 }]) })
  fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
  expect(screen.getAllByText(zh['project.failed']).length).toBeGreaterThan(0)
  cleanup()
  renderPage({ ...baseCatalog, records: records([{ sessionId: 'main', projectId: 'project',
    checkpoint: 2, state: 'completed', index: 0 }]) })
  fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
  expect(screen.getAllByText(zh['review.completed']).length).toBeGreaterThan(0)
  cleanup()
  renderPage({ ...baseCatalog, records: records([{ sessionId: 'main', projectId: 'project',
    checkpoint: 2, state: 'mystery-state', index: 0 }]) })
  fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
  expect(screen.getAllByText(zh['board.column.pending']).length).toBeGreaterThan(0)
})

it('shows team-link unavailability and disabled notices on the board', () => {
  const unavailable: ProjectCheckpoint = { sessionId: 'main', projectId: 'project', checkpoint: 1,
    state: 'started', goal: 'Delivery goal', teamLink: 'unavailable' }
  renderPage({ ...baseCatalog, records: [unavailable] })
  fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
  expect(screen.getByText(zh['project.team-unavailable'])).toBeTruthy()
  cleanup()
  const disabled: ProjectCheckpoint = { sessionId: 'main', projectId: 'project', checkpoint: 1,
    state: 'started', goal: 'Delivery goal', teamLink: 'disabled' }
  renderPage({ ...baseCatalog, records: [disabled] })
  fireEvent.click(screen.getByRole('button', { name: /Delivery goal/ }))
  expect(screen.getByText(zh['project.team-disabled'])).toBeTruthy()
})

it('binds file chips to the base menu only when the target session is known', () => {
  const openMenu = vi.fn()
  const stopPropagation = vi.fn()
  render(<FileChip path={'D:\\work\\report.md'} hash={'a'.repeat(64)} triggerProps={{ onContextMenu: openMenu }} />)
  const chip = screen.getByText('report.md')
  expect(chip.parentElement!.getAttribute('title')).toBe('D:\\work\\report.md')
  expect(screen.getByText('a'.repeat(8))).toBeTruthy()
  fireEvent.click(chip, { stopPropagation })
  expect(openMenu).toHaveBeenCalledTimes(1)
  cleanup()
  const onOpen = vi.fn()
  render(<FileChip path="build/hello.txt" onOpen={onOpen} />)
  fireEvent.click(screen.getByText('hello.txt'), { stopPropagation })
  expect(onOpen).toHaveBeenCalledTimes(1)
  cleanup()
  render(<FileChip path="plain.txt" />)
  expect(screen.getByText('plain.txt').parentElement!.getAttribute('title')).toBe('plain.txt')
})

it('renders the roster panel with loading and failure feedback and forwards the settings action', () => {
  const useCatalog = <S,>(select: (value: Catalog) => S): S => select({ ...baseCatalog, loading: true, failed: true })
  render(<RosterPanel {...{ useCatalog, t: makeTranslate(zh), openModelSettings: vi.fn(),
    saveEmployee: vi.fn(async () => true), saveTeam: vi.fn(async () => true), delegateTeam: vi.fn(),
  } as Parameters<typeof RosterPanel>[0]} />)
  expect(screen.getByText(zh['project.loading'])).toBeTruthy()
  expect(screen.getByText(zh['project.error'])).toBeTruthy()
  expect(screen.getByText(zh['roster.title'])).toBeTruthy()
})

it('maps execution states and verdicts to idle, warning, ongoing, done and error tones', () => {
  expect(statusTone('passed')).toBe('done')
  expect(statusTone('draft')).toBe('warning')
  expect(statusTone('running')).toBe('ongoing')
  expect(statusTone('acceptance-blocked')).toBe('error')
  expect(statusTone('mystery')).toBe('idle')
})
