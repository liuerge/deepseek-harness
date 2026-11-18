// @vitest-environment jsdom
/** Result rows retain exact plan revisions, session ownership and observed file identities. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ProjectPlan, AcceptanceReport } from '@deepseek-ai/dsh-meeting-room/types'
import type { ContextMenuTarget } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import { SessionArtifacts } from '../src/client/SessionArtifacts.tsx'
import { sessionArtifacts, sessionPlans, planFileName } from '../src/client/session-artifacts.ts'
import type { ProjectCheckpoint } from '../src/client/ProjectPage.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

function plan(revision: number, sessionId = 'main'): ProjectPlan {
  return { id: 'delivery-plan' as ProjectPlan['id'], revision, originSessionId: sessionId,
    document: { path: `/workspace/docs/plan-v${revision}.md`, sha256: 'b'.repeat(64), cwd: '/workspace' },
    goal: 'A long project goal stays inside the downloadable plan, not in the file list',
    team: { id: 'team' as ProjectPlan['team']['id'], revision: 1, name: 'Team', memberIds: [] },
    employees: [], tasks: [], background: [], confirmed: revision === 1 }
}

function report(path: string): AcceptanceReport {
  return { planId: plan(1).id, planRevision: 1, index: 0, passed: false, reviewers: [],
    artifacts: [{ sourcePath: 'delivery.md', path, sha256: 'a'.repeat(64) }] }
}

const records: ProjectCheckpoint[] = [
  { sessionId: 'other', projectId: 'unrelated', checkpoint: 8, index: 0, state: 'acceptance-blocked', report: report('/private/other.md') },
  { sessionId: 'main', projectId: 'delivery', checkpoint: 1, state: 'started',
    tasks: [{ role: 'Developer', instruction: 'Write /planned-only.md', acceptance: 'Inspect delivery' }] },
  { sessionId: 'main', projectId: 'delivery', checkpoint: 3, index: 0, state: 'acceptance-blocked', report: report('/old/report.md') },
  { sessionId: 'main', projectId: 'delivery', checkpoint: 5, index: 0, state: 'awaiting-human', report: report('/workspace/report.md') },
]

it('keeps the latest owned plan revision and latest observed task files without inferring files from instructions', () => {
  expect(sessionPlans('main', [plan(2), plan(1), { ...plan(3, 'other'), id: 'other-plan' as ProjectPlan['id'] }], records))
    .toEqual([plan(2)])
  expect(sessionArtifacts('main', records)).toEqual([{
    projectId: 'delivery', checkpoint: 5, path: '/workspace/report.md', sha256: 'a'.repeat(64), role: 'Developer', state: 'awaiting-human',
  }])
  expect(sessionArtifacts('unbound', records)).toEqual([])
})

it('offers exact-revision confirmation and shared file menus for real plan and artifact paths without rendering content', async () => {
  const latest = plan(2)
  const catalog = { records, plans: [plan(1), latest], employees: [], teams: [], connections: [],
    loading: false, failed: false, connectionsLoading: false, connectionsFailed: false }
  const useCatalog = <S,>(select: (value: typeof catalog) => S): S => select(catalog)
  const confirmPlan = vi.fn(async () => {})
  const openMenu = vi.fn()
  const { container } = render(<SessionArtifacts {...{
    sessionId: 'main', useCatalog, t: makeTranslate(zh), refresh: vi.fn(), confirmPlan, openWorkspace: vi.fn(),
    useContextMenu: () => ({ getTriggerProps: (target: ContextMenuTarget) => ({
      tabIndex: 0, onContextMenu: () => { openMenu(target) },
    }) }),
  } as Parameters<typeof SessionArtifacts>[0]} />)
  expect(screen.getByText('plan-v2.md')).toBeTruthy()
  expect(screen.queryByText('plan-v1.md')).toBeNull()
  expect(screen.queryByText(latest.goal)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh['plan.confirm'] }))
  expect(confirmPlan).toHaveBeenCalledWith(latest.id, 2)
  const file = screen.getByText('report.md').closest('li')
  if (!file) throw new Error('Expected observed file row')
  fireEvent.contextMenu(file)
  expect(openMenu).toHaveBeenCalledWith({ kind: 'file', value: { sessionId: 'main', path: '/workspace/report.md' } })
  fireEvent.contextMenu(screen.getByText('plan-v2.md').closest('li')!)
  expect(openMenu).toHaveBeenLastCalledWith({ kind: 'file', value: { sessionId: 'main', path: '/workspace/docs/plan-v2.md' } })
  await expect(container.textContent).toMatchFileSnapshot('expected/session-artifacts.txt')
})

it('keeps cached rows readable but blocks confirmation while the shared catalog is stale or loading', () => {
  const catalog = { records: [], plans: [plan(2)], employees: [], teams: [], connections: [],
    loading: true, failed: true, connectionsLoading: false, connectionsFailed: false }
  const useCatalog = <S,>(select: (value: typeof catalog) => S): S => select(catalog)
  render(<SessionArtifacts {...{
    sessionId: 'main', useCatalog, t: makeTranslate(zh), refresh: vi.fn(), confirmPlan: vi.fn(), openWorkspace: vi.fn(),
    useContextMenu: () => ({ getTriggerProps: () => ({}) }),
  } as Parameters<typeof SessionArtifacts>[0]} />)
  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.getByRole('button', { name: zh['plan.confirm'] }).hasAttribute('disabled')).toBe(true)
})

it('does not manufacture a document for a retained plan without a file and blocks its confirmation', () => {
  const legacy = { ...plan(2), document: undefined }
  const catalog = { records: [], plans: [legacy], employees: [], teams: [], connections: [],
    loading: false, failed: false, connectionsLoading: false, connectionsFailed: false }
  const useCatalog = <S,>(select: (value: typeof catalog) => S): S => select(catalog)
  render(<SessionArtifacts {...{
    sessionId: 'main', useCatalog, t: makeTranslate(zh), refresh: vi.fn(), confirmPlan: vi.fn(), openWorkspace: vi.fn(),
    useContextMenu: () => ({ getTriggerProps: () => ({}) }),
  } as Parameters<typeof SessionArtifacts>[0]} />)
  expect(planFileName(legacy)).toBeUndefined()
  expect(screen.getByText(zh['artifacts.missing-document'])).toBeTruthy()
  expect(screen.getByRole('button', { name: zh['plan.confirm'] }).hasAttribute('disabled')).toBe(true)
  expect(screen.queryByText('plan-v2.md')).toBeNull()
})
