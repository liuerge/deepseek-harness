/** Dashboard artifact reads enforce the conversation-scoped registration whitelist. */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ProjectExecutionId, ProjectPlanId, ProjectTeamTaskId } from '../src/types.ts'
import ProjectDashboard from '../src/dashboard.ts'
import { MeetingStore } from '../src/store.ts'
import { projectPlanSchema } from '../src/plans.ts'
import LocalFileSystem from '../../../fs/fs-local/src/index.ts'

const HASH = 'a'.repeat(64)

/** Mount a dashboard over a real store and a local filesystem rooted at `directory`. */
async function dashboard(directory: string, store: MeetingStore) {
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: directory })
  return new ProjectDashboard(ctx, { store, acceptanceMaxBytes: 1_000_000 })
}

/** Parse a one-task plan whose document registers `path` under `cwd` for `sessionId`. */
function plan(sessionId: string, document: { path: string; sha256: string; cwd: string }) {
  return projectPlanSchema.parse({
    id: 'plan', revision: 1, goal: 'Delivery', background: [], confirmed: false,
    originSessionId: sessionId,
    team: { id: 'team', revision: 1, name: 'Team', memberIds: ['author'] },
    employees: [{ id: 'author', revision: 1, name: 'Author', responsibility: 'Develop', provider: 'provider', model: 'model' }],
    tasks: [{ employeeId: 'author', role: 'Author', instruction: 'Develop', acceptance: 'Deliver' }],
    document,
  })
}

/** Persist one acceptance report checkpoint registering `artifacts` under `cwd`. */
function record(store: MeetingStore, checkpoint: number, cwd: string | undefined,
  artifacts: { sourcePath: string; path: string; sha256: string }[]): void {
  store.recordProject('session', JSON.stringify({
    projectId: 'run', state: 'acceptance-passed', checkpoint, index: 0, ...(cwd === undefined ? {} : { cwd }),
    report: { planId: 'plan', planRevision: 1, index: 0, artifacts, passed: true, reviewers: [] },
  }))
}

it('reads a registered plan document from its recorded execution directory with the observed hash', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const directory = await mkdtemp(join(tmpdir(), 'dashboard-read-'))
    const artifact = join(directory, 'plan.md')
    await writeFile(artifact, '# Delivery plan\n')
    store.savePlan(plan('session', { path: artifact, sha256: '0'.repeat(64), cwd: directory }), 0)
    const dashboard_ = await dashboard(directory, store)
    const result = await dashboard_.readProjectArtifact('session', artifact, new AbortController().signal)
    expect(result.content).toBe('# Delivery plan\n')
    expect(result.path).toBe(artifact)
    expect(result.sha256).not.toBe('0'.repeat(64))
  } finally { store.close() }
})

it('rejects unregistered paths and registered paths without a recorded execution directory', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const directory = await mkdtemp(join(tmpdir(), 'dashboard-read-'))
    const dashboard_ = await dashboard(directory, store)
    const signal = new AbortController().signal
    await expect(dashboard_.readProjectArtifact('session', join(directory, 'outside.txt'), signal))
      .rejects.toMatchObject({ code: 'PROJECT_ARTIFACT_NOT_REGISTERED' })
    record(store, 1, undefined, [{ sourcePath: 'gone.md', path: join(directory, 'gone.md'), sha256: HASH }])
    await expect(dashboard_.readProjectArtifact('session', join(directory, 'gone.md'), signal))
      .rejects.toMatchObject({ code: 'PROJECT_ARTIFACT_NOT_REGISTERED' })
  } finally { store.close() }
})

it('reads verified report artifacts and fails loudly when the file disappeared', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const directory = await mkdtemp(join(tmpdir(), 'dashboard-read-'))
    const dashboard_ = await dashboard(directory, store)
    const signal = new AbortController().signal
    record(store, 1, directory, [{ sourcePath: 'gone.md', path: join(directory, 'gone.md'), sha256: HASH }])
    await expect(dashboard_.readProjectArtifact('session', join(directory, 'gone.md'), signal))
      .rejects.toMatchObject({ code: 'PROJECT_ACCEPTANCE_ARTIFACT_INVALID' })
    const kept = join(directory, 'kept.md')
    await writeFile(kept, 'verified content')
    record(store, 2, directory, [{ sourcePath: 'kept.md', path: kept, sha256: HASH }])
    const result = await dashboard_.readProjectArtifact('session', kept, signal)
    expect(result.content).toBe('verified content')
    expect(result.sha256).toBeTypeOf('string')
  } finally { store.close() }
})

it('exposes roster and plan reads over the remote face', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const dashboard_ = new ProjectDashboard(new Context(), { store, acceptanceMaxBytes: 1000 })
    const signal = new AbortController().signal
    await expect(dashboard_.roster(signal)).resolves.toEqual({ employees: [], teams: [] })
    await expect(dashboard_.plans(signal)).resolves.toEqual([])
    await expect(dashboard_.meetings('session', signal)).resolves.toEqual([])
  } finally { store.close() }
})

it('merges team task links into timeline rows by project and index', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const dashboard_ = new ProjectDashboard(new Context(), { store, acceptanceMaxBytes: 1000 })
    store.recordProject('session', JSON.stringify({ projectId: 'run', state: 'running', checkpoint: 1, index: 0 }))
    store.saveTeamTask({ projectId: brandString<ProjectExecutionId>('run'), index: 0,
      planId: brandString<ProjectPlanId>('plan'), planRevision: 1,
      taskId: brandString<ProjectTeamTaskId>('task-1'), revision: 3, status: 'in_progress' })
    const rows = await dashboard_.timeline(new AbortController().signal)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ projectId: 'run', state: 'running',
      teamTask: { id: 'task-1', revision: 3, status: 'in_progress' } })
  } finally { store.close() }
})

it('cancels artifact reads through the signal', async () => {
  const store = new MeetingStore(':memory:')
  try {
    const directory = await mkdtemp(join(tmpdir(), 'dashboard-read-'))
    const dashboard_ = await dashboard(directory, store)
    const controller = new AbortController()
    controller.abort()
    await expect(dashboard_.readProjectArtifact('session', join(directory, 'plan.md'), controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
  } finally { store.close() }
})
