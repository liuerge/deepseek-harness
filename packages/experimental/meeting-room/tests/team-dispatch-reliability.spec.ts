import { afterEach, describe, expect, it, vi } from 'vitest'
import { rm } from 'node:fs/promises'
import { z } from 'zod'
import { DatabaseSync } from 'node:sqlite'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Context } from '@deepseek-ai/cordis'
import { TeamError } from '@deepseek-ai/dsh-agent-team'
import { toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { MeetingStore } from '../src/store.ts'
import { linkProjectTeamTasks, teamTaskMarker } from '../src/team-link.ts'
import type { ProjectExecutionId } from '../src/types.ts'
import {
  contexts, deferred, directories, teamFixture, workerText, writingWorker, type TeamScript,
} from './team-dispatch-fixtures.ts'

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** Read the latest dashboard checkpoint. */
async function latest(ctx: Context) {
  const timeline = await ctx.projectDashboard.timeline(new AbortController().signal)
  const node = timeline.at(-1)
  if (!node) throw new Error('Expected a project checkpoint')
  return node
}

/** Find the loaded meeting product entry so the test can unload exactly that plugin. */
function productFiber(ctx: Context) {
  const entry = [...ctx.loader.entries()].find(item => item.options.id === 'meeting-product')
  if (!entry?.fiber) throw new Error('Expected the loaded meeting product')
  return entry.fiber
}

/** Race one optional signal, used by barriers so cancellation always releases them. */
function aborted(signal: AbortSignal | undefined): Promise<never> {
  if (signal === undefined) return new Promise<never>(() => { /* Released only by the test barrier. */ })
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
    }, { once: true })
  })
}

describe('team dispatch reliability', () => {
  it('rejects a manually reassigned node instead of reclaiming it for the project', async () => {
    let artifact = ''
    const script: TeamScript = [
      workerText('Author handoff'),
      () => toolCallResponse('review-read', 'read', { file_path: artifact }),
      () => toolCallResponse('review-pass', 'structured_output', { criteria: [{ id: 'AC-1', status: 'pass',
        notes: 'Read the artifact.', evidencePaths: [artifact] }] }),
      workerText('Downstream delivery'),
    ]
    const fixture = await teamFixture({ script, review: 'human' })
    const { ctx, store, plan, caller, execute } = fixture
    artifact = fixture.artifact
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const waiting = await latest(ctx)
      expect(waiting.state).toBe('awaiting-human')
      const task = ctx.agentTeams.listTasks(caller.agent)[0]
      if (!task) throw new Error('Expected the first Team task')
      await ctx.agentTeams.updateTask(caller.agent, { taskId: task.id, expectedRevision: task.revision,
        action: 'reassign', owner: caller.agent.session.id })
      await ctx.projectDashboard.confirmAcceptance(waiting.projectId, waiting.checkpoint, new AbortController().signal)
      const released = await latest(ctx)
      expect(released.state).toBe('released')
      const requests = fixture.adapter.requests.length

      const result = await execute({ projectId: projectOf(released), expectedCheckpoint: released.checkpoint })
      expect(result.results[0]?.result).toMatchObject({ isError: true, error: { info: { code: 'PROJECT_TEAM_TASK_CONFLICT' } } })
      const message = (result.results[0]?.result as { error?: { message?: string } }).error?.message ?? ''
      expect(message).toContain(task.id)
      expect(message).toContain('"index":0')
      expect(message).toContain('"taskId":"' + task.id + '"')
      expect(fixture.adapter.requests).toHaveLength(requests)
      const history = store.execution(brandString<ProjectExecutionId>(released.projectId))
      expect(history.some(entry => entry.index === 1)).toBe(false)
      expect(ctx.agentTeams.listTasks(caller.agent)[0]).toMatchObject({ status: 'in_progress', ownerId: caller.agent.session.id })
    } finally { store.close(); await caller.dispose() }
  })

  it('rejects a manually released node instead of claiming it back', async () => {
    let artifact = ''
    const script: TeamScript = [
      workerText('Author handoff'),
      () => toolCallResponse('review-read', 'read', { file_path: artifact }),
      () => toolCallResponse('review-pass', 'structured_output', { criteria: [{ id: 'AC-1', status: 'pass',
        notes: 'Read the artifact.', evidencePaths: [artifact] }] }),
      workerText('Downstream delivery'),
    ]
    const fixture = await teamFixture({ script, review: 'human' })
    const { ctx, store, plan, caller, execute } = fixture
    artifact = fixture.artifact
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const waiting = await latest(ctx)
      const task = ctx.agentTeams.listTasks(caller.agent)[0]
      if (!task) throw new Error('Expected the first Team task')
      await ctx.agentTeams.updateTask(caller.agent, { taskId: task.id, expectedRevision: task.revision, action: 'release' })
      await ctx.projectDashboard.confirmAcceptance(waiting.projectId, waiting.checkpoint, new AbortController().signal)
      const released = await latest(ctx)
      const requests = fixture.adapter.requests.length

      const result = await execute({ projectId: projectOf(released), expectedCheckpoint: released.checkpoint })
      expect(result.results[0]?.result).toMatchObject({ isError: true, error: { info: { code: 'PROJECT_TEAM_TASK_CONFLICT' } } })
      expect(fixture.adapter.requests).toHaveLength(requests)
      expect(store.execution(brandString<ProjectExecutionId>(released.projectId)).some(entry => entry.index === 1)).toBe(false)
      expect(ctx.agentTeams.getTask(caller.agent, task.id)).toMatchObject({ status: 'pending' })
    } finally { store.close(); await caller.dispose() }
  })

  it('rejects an externally edited association instead of adopting the latest revision', async () => {
    let artifact = ''
    const script: TeamScript = [
      workerText('Author handoff'),
      () => toolCallResponse('review-read', 'read', { file_path: artifact }),
      () => toolCallResponse('review-pass', 'structured_output', { criteria: [{ id: 'AC-1', status: 'pass',
        notes: 'Read the artifact.', evidencePaths: [artifact] }] }),
      workerText('Downstream delivery'),
    ]
    const fixture = await teamFixture({ script, review: 'human' })
    const { ctx, store, plan, caller, execute } = fixture
    artifact = fixture.artifact
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const waiting = await latest(ctx)
      const second = ctx.agentTeams.listTasks(caller.agent)[1]
      if (!second) throw new Error('Expected the downstream Team task')
      await ctx.agentTeams.updateTask(caller.agent, { taskId: second.id, expectedRevision: second.revision,
        action: 'edit', description: `${second.description}\nExternal change` })
      await ctx.projectDashboard.confirmAcceptance(waiting.projectId, waiting.checkpoint, new AbortController().signal)
      const released = await latest(ctx)
      const requests = fixture.adapter.requests.length

      const result = await execute({ projectId: projectOf(released), expectedCheckpoint: released.checkpoint })
      expect(result.results[0]?.result).toMatchObject({ isError: true, error: { info: { code: 'PROJECT_TEAM_TASK_CONFLICT' } } })
      expect(fixture.adapter.requests).toHaveLength(requests)
      expect(ctx.agentTeams.listTasks(caller.agent)[0]).toMatchObject({ status: 'in_progress' })
      expect(store.execution(brandString<ProjectExecutionId>(released.projectId)).some(entry => entry.index === 1)).toBe(false)
    } finally { store.close(); await caller.dispose() }
  })

  it('reports a deleted associated task without dispatching downstream work', async () => {
    let artifact = ''
    const script: TeamScript = [
      workerText('Author handoff'),
      () => toolCallResponse('review-read', 'read', { file_path: artifact }),
      () => toolCallResponse('review-pass', 'structured_output', { criteria: [{ id: 'AC-1', status: 'pass',
        notes: 'Read the artifact.', evidencePaths: [artifact] }] }),
      workerText('Downstream delivery'),
    ]
    const fixture = await teamFixture({ script, review: 'human' })
    const { ctx, store, plan, caller, execute } = fixture
    artifact = fixture.artifact
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const waiting = await latest(ctx)
      const second = ctx.agentTeams.listTasks(caller.agent)[1]
      if (!second) throw new Error('Expected the downstream Team task')
      await ctx.agentTeams.updateTask(caller.agent, { taskId: second.id, expectedRevision: second.revision, action: 'delete' })
      await ctx.projectDashboard.confirmAcceptance(waiting.projectId, waiting.checkpoint, new AbortController().signal)
      const released = await latest(ctx)
      const requests = fixture.adapter.requests.length

      const result = await execute({ projectId: projectOf(released), expectedCheckpoint: released.checkpoint })
      expect(result.results[0]?.result).toMatchObject({ isError: true, error: { info: { code: 'PROJECT_TEAM_TASK_DELETED' } } })
      expect(fixture.adapter.requests).toHaveLength(requests)
      expect(store.execution(brandString<ProjectExecutionId>(released.projectId)).some(entry => entry.index === 1)).toBe(false)
    } finally { store.close(); await caller.dispose() }
  })

  it('reports a Team task completed before project release without running the worker', async () => {
    const fixture = await teamFixture({ script: [workerText('Must not run')], review: 'human' })
    const { ctx, store, plan, caller, execute } = fixture
    try {
      const projectId = brandString<ProjectExecutionId>('completed-before-release')
      const signal = new AbortController().signal
      await expect(linkProjectTeamTasks(ctx, store, caller.agent, plan, projectId, signal)).resolves.toBe('linked')
      store.claimPlanRun(plan.id, plan.revision, projectId)
      const task = ctx.agentTeams.listTasks(caller.agent)[0]
      if (!task) throw new Error('Expected the first Team task')
      const claimed = await ctx.agentTeams.updateTask(caller.agent, { taskId: task.id,
        expectedRevision: task.revision, action: 'claim' })
      await ctx.agentTeams.updateTask(caller.agent, { taskId: task.id, expectedRevision: claimed.revision, action: 'complete' })

      const result = await execute({ planId: plan.id, planRevision: plan.revision })
      expect(result.results[0]?.result).toMatchObject({ isError: true, error: { info: { code: 'PROJECT_TEAM_TASK_COMPLETED' } } })
      expect(fixture.adapter.requests).toHaveLength(0)
      expect(fixture.effects.writes).toBe(0)
      expect(store.execution(projectId).some(entry => entry.state === 'task-produced')).toBe(false)
    } finally { store.close(); await caller.dispose() }
  })

  it('hands a failing rework node from its previous worker to a new worker session', async () => {
    let artifact = ''
    const responses: TeamScript = [
      workerText('First author handoff'),
      () => toolCallResponse('first-read', 'read', { file_path: artifact }),
      () => toolCallResponse('first-report', 'structured_output', { criteria: [{ id: 'AC-1', status: 'fail',
        notes: 'Delivery does not match yet.', evidencePaths: [artifact] }] }),
      () => toolCallResponse('repair', 'write_dispatch', { content: 'Repaired delivery' }),
      workerText('Repaired handoff'),
      () => toolCallResponse('repair-read', 'read', { file_path: artifact }),
      () => toolCallResponse('repair-report', 'structured_output', { criteria: [{ id: 'AC-1', status: 'pass',
        notes: 'Read the repaired delivery.', evidencePaths: [artifact] }] }),
      workerText('Downstream delivery'),
    ]
    const fixture = await teamFixture({ script: responses, review: 'automatic', rework: { maxAttempts: 1 } })
    const { ctx, store, plan, caller, execute } = fixture
    artifact = fixture.artifact
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const blocked = await latest(ctx)
      expect(blocked).toMatchObject({ state: 'acceptance-blocked', index: 0 })
      const firstTask = ctx.agentTeams.listTasks(caller.agent)[0]
      if (!firstTask) throw new Error('Expected the first Team task')
      const projectId = brandString<ProjectExecutionId>(blocked.projectId)
      const firstWorker = store.execution(projectId).find(entry => entry.state === 'task-produced')?.childSessionId
      expect(firstTask).toMatchObject({ status: 'in_progress', ownerId: firstWorker })

      await execute({ projectId: blocked.projectId, expectedCheckpoint: blocked.checkpoint })
      const repaired = await latest(ctx)
      expect(repaired).toMatchObject({ state: 'awaiting-review' })
      const tasks = ctx.agentTeams.listTasks(caller.agent)
      const workers = store.execution(projectId).filter(entry => entry.state === 'task-produced')
      expect(tasks[0]?.status).toBe('completed')
      expect(tasks[0]?.ownerId).not.toBe(firstWorker)
      expect(tasks[0]?.ownerId).toBe(workers.filter(entry => entry.index === 0).at(-1)?.childSessionId)
      expect(ctx.agentTeams.listTasks(caller.agent).filter(task =>
        task.description.includes(teamTaskMarker(projectId, plan, 0)))).toHaveLength(1)
      const reports = store.execution(projectId).flatMap(entry => entry.report ? [entry.report] : [])
      expect(reports.map(report => report.passed)).toEqual([false, true])
    } finally { store.close(); await caller.dispose() }
  })

  it('holds every model request and side effect until the Team claim completes', async () => {
    const fixture = await teamFixture({
      script: [workerText('Unrelated child completed'), writingWorker('GATED DELIVERY'), workerText('First handoff')],
      taskCount: 1,
    })
    const { ctx, store, plan, caller, execute } = fixture
    const original = ctx.agentTeams.updateTask.bind(ctx.agentTeams)
    const entered = deferred()
    const releaseClaim = deferred()
    let held = false
    vi.spyOn(ctx.agentTeams, 'updateTask').mockImplementation(async (member, request, signal) => {
      if (request.action === 'claim' && !held) {
        held = true
        entered.resolve()
        await Promise.race([releaseClaim.promise, aborted(signal)])
        signal?.throwIfAborted()
      }
      return original(member, request, signal)
    })
    try {
      const running = execute({ planId: plan.id, planRevision: 1 })
      await entered.promise
      expect(fixture.adapter.requests).toHaveLength(0)
      expect(fixture.effects.writes).toBe(0)

      const unrelated = await ctx.subagents.startActivation({ provider: 'meeting-test-spawn', label: 'unrelated',
        parent: caller.agent, prompt: [{ type: 'text', text: 'Do unrelated work' }],
        signal: new AbortController().signal, delivery: 'caller' })
      try {
        const result = await unrelated.result
        expect(result.stopReason).toBe('completed')
      } finally { await unrelated.dispose() }
      expect(fixture.adapter.requests).toHaveLength(1)
      expect(JSON.stringify(fixture.adapter.requests[0])).toContain('Do unrelated work')
      expect(fixture.effects.writes).toBe(0)

      releaseClaim.resolve()
      const result = await running
      expect(result.results[0]?.result.isError).not.toBe(true)
      expect(fixture.effects.writes).toBe(1)
      const projectId = brandString<ProjectExecutionId>((await latest(ctx)).projectId)
      const produced = store.execution(projectId).filter(entry => entry.state === 'task-produced')
      expect(ctx.agentTeams.listTasks(caller.agent)[0]?.ownerId).toBe(produced[0]?.childSessionId)
    } finally {
      releaseClaim.resolve()
      store.close()
      await caller.dispose()
    }
  })

  it('does not execute the worker when the Team claim is rejected', async () => {
    const fixture = await teamFixture({ script: [workerText('Must not run')] })
    const { ctx, store, plan, caller, execute } = fixture
    const original = ctx.agentTeams.updateTask.bind(ctx.agentTeams)
    vi.spyOn(ctx.agentTeams, 'updateTask').mockImplementation(async (member, request, signal) => {
      if (request.action === 'claim') throw new TeamError('task is owned by another member', 'TEAM_TASK_ALREADY_CLAIMED')
      return original(member, request, signal)
    })
    try {
      const result = await execute({ planId: plan.id, planRevision: 1 })
      expect(result.results[0]?.result).toMatchObject({ isError: true, error: { info: { code: 'TEAM_TASK_ALREADY_CLAIMED' } } })
      expect(fixture.adapter.requests).toHaveLength(0)
      expect(fixture.effects.writes).toBe(0)
      const projectId = brandString<ProjectExecutionId>((await latest(ctx)).projectId)
      const history = store.execution(projectId)
      expect(history.at(-1)?.state).toBe('failed')
      expect(history.some(entry => entry.state === 'task-produced')).toBe(false)
      expect(history.some(entry => entry.index === 1)).toBe(false)
    } finally { store.close(); await caller.dispose() }
  })

  it('does not execute the worker when Team mode is disabled before the claim', async () => {
    const fixture = await teamFixture({ script: [workerText('Must not run')] })
    const { ctx, store, plan, caller, execute } = fixture
    const original = ctx.subagents.startActivation.bind(ctx.subagents)
    vi.spyOn(ctx.subagents, 'startActivation').mockImplementation(async (spec) => {
      await ctx.agentTeams.setEnabled(caller.agent, false)
      return original(spec)
    })
    try {
      const result = await execute({ planId: plan.id, planRevision: 1 })
      expect(result.results[0]?.result).toMatchObject({ isError: true, error: { info: { code: 'PROJECT_TEAM_DISABLED' } } })
      expect(fixture.adapter.requests).toHaveLength(0)
      expect(fixture.effects.writes).toBe(0)
      const projectId = brandString<ProjectExecutionId>((await latest(ctx)).projectId)
      expect(store.execution(projectId).some(entry => entry.index === 1)).toBe(false)
    } finally { store.close(); await caller.dispose() }
  })

  it('releases a gated worker on cancellation without executing or leaving a sticky gate', async () => {
    const fixture = await teamFixture({ script: [workerText('Unrelated after cancellation'), workerText('Must not run')] })
    const { ctx, store, plan, caller, execute } = fixture
    const original = ctx.agentTeams.updateTask.bind(ctx.agentTeams)
    const entered = deferred()
    vi.spyOn(ctx.agentTeams, 'updateTask').mockImplementation(async (member, request, signal) => {
      if (request.action === 'claim') {
        entered.resolve()
        await aborted(signal)
      }
      return original(member, request, signal)
    })
    const controller = new AbortController()
    try {
      const running = execute({ planId: plan.id, planRevision: 1 }, controller.signal)
      await entered.promise
      controller.abort()
      const result = await running
      expect(result.results[0]?.result.isError).toBe(true)
      expect(fixture.adapter.requests).toHaveLength(0)
      expect(fixture.effects.writes).toBe(0)
      const projectId = brandString<ProjectExecutionId>((await latest(ctx)).projectId)
      expect(store.execution(projectId).at(-1)?.state).toBe('interrupted')

      const unrelated = await ctx.subagents.startActivation({ provider: 'meeting-test-spawn', label: 'after-cancel',
        parent: caller.agent, prompt: [{ type: 'text', text: 'Unrelated after cancellation' }],
        signal: new AbortController().signal, delivery: 'caller' })
      try { expect((await unrelated.result).stopReason).toBe('completed') } finally { await unrelated.dispose() }
      expect(fixture.adapter.requests).toHaveLength(1)
    } finally { store.close(); await caller.dispose() }
  })

  it('waits for an in-flight association and closes storage after it settles on unload', async () => {
    const fixture = await teamFixture({ script: [] })
    const { ctx, store, plan, caller, execute, databasePath } = fixture
    const original = ctx.agentTeams.createTask.bind(ctx.agentTeams)
    const entered = deferred()
    vi.spyOn(ctx.agentTeams, 'createTask').mockImplementation(async (member, request, signal) => {
      entered.resolve()
      await aborted(signal)
      signal?.throwIfAborted()
      return original(member, request, signal)
    })
    let closed = false
    const close = Object.getOwnPropertyDescriptor(MeetingStore.prototype, 'close')?.value as
      | ((this: MeetingStore) => void) | undefined
    const record = Object.getOwnPropertyDescriptor(MeetingStore.prototype, 'recordProject')?.value as
      | ((this: MeetingStore, ...args: Parameters<MeetingStore['recordProject']>) => void) | undefined
    if (close === undefined || record === undefined) throw new Error('Expected store lifecycle methods')
    vi.spyOn(MeetingStore.prototype, 'close').mockImplementation(function (this: MeetingStore) {
      closed = true
      close.call(this)
    })
    vi.spyOn(MeetingStore.prototype, 'recordProject').mockImplementation(function (this: MeetingStore, ...args) {
      if (closed) throw new Error('late write after store close')
      record.apply(this, args)
    })
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown): void => { unhandled.push(error) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const running = execute({ planId: plan.id, planRevision: 1 }).then(
        value => ({ kind: 'value' as const, value }), (error: unknown) => ({ kind: 'error' as const, error }))
      await entered.promise
      await productFiber(ctx).dispose()
      const outcome = await running
      expect(stopped(outcome)).toBe(true)
      await new Promise(resolve => setImmediate(resolve))
      expect(unhandled).toEqual([])
      expect(closed).toBe(true)
      expect(store.plans()[0]?.executionId).toBeDefined()
      expect(() => { const db = new DatabaseSync(databasePath); db.close() }).not.toThrow()
    } finally {
      process.off('unhandledRejection', onUnhandled)
      store.close()
      await caller.dispose()
    }
  })

  it('waits for an in-flight release sync and keeps downstream work unstarted on unload', async () => {
    let artifact = ''
    const script: TeamScript = [
      workerText('Author handoff'),
      () => toolCallResponse('sync-read', 'read', { file_path: artifact }),
      () => toolCallResponse('sync-pass', 'structured_output', { criteria: [{ id: 'AC-1', status: 'pass',
        notes: 'Read the artifact.', evidencePaths: [artifact] }] }),
      workerText('Downstream delivery'),
    ]
    const fixture = await teamFixture({ script, review: 'human' })
    const { ctx, store, plan, caller, execute } = fixture
    artifact = fixture.artifact
    const original = ctx.agentTeams.updateTask.bind(ctx.agentTeams)
    const entered = deferred()
    vi.spyOn(ctx.agentTeams, 'updateTask').mockImplementation(async (member, request, signal) => {
      if (request.action === 'complete') {
        entered.resolve()
        await aborted(signal)
        signal?.throwIfAborted()
      }
      return original(member, request, signal)
    })
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const waiting = await latest(ctx)
      await ctx.projectDashboard.confirmAcceptance(waiting.projectId, waiting.checkpoint, new AbortController().signal)
      const released = await latest(ctx)
      const requests = fixture.adapter.requests.length
      const running = execute({ projectId: projectOf(released), expectedCheckpoint: released.checkpoint })
        .then(value => ({ kind: 'value' as const, value }), (error: unknown) => ({ kind: 'error' as const, error }))
      await entered.promise
      await productFiber(ctx).dispose()
      const outcome = await running
      expect(stopped(outcome)).toBe(true)
      expect(fixture.adapter.requests).toHaveLength(requests)
      const projectId = brandString<ProjectExecutionId>(released.projectId)
      expect(store.execution(projectId).some(entry => entry.index === 1)).toBe(false)
      expect(() => { const db = new DatabaseSync(fixture.databasePath); db.close() }).not.toThrow()
    } finally { store.close(); await caller.dispose() }
  })

  it('waits for a running employee and retains an interrupted checkpoint on unload', async () => {
    const fixture = await teamFixture({ script: ['hang'] })
    const { ctx, store, plan, caller, execute, databasePath } = fixture
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown): void => { unhandled.push(error) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const running = execute({ planId: plan.id, planRevision: 1 }).then(
        value => ({ kind: 'value' as const, value }), (error: unknown) => ({ kind: 'error' as const, error }))
      await vi.waitFor(() => { expect(fixture.adapter.requests).toHaveLength(1) })
      await productFiber(ctx).dispose()
      const outcome = await running
      expect(stopped(outcome)).toBe(true)
      await new Promise(resolve => setImmediate(resolve))
      expect(unhandled).toEqual([])
      const reopened = new MeetingStore(databasePath)
      try {
        const row = reopened.projectTimeline().at(-1)
        if (!row) throw new Error('Expected a retained checkpoint')
        expect(z.object({ state: z.string() }).parse(JSON.parse(row.record)).state).toBe('interrupted')
      } finally { reopened.close() }
    } finally {
      process.off('unhandledRejection', onUnhandled)
      store.close()
      await caller.dispose()
    }
  })

  it.each([false, true])('admits one concurrent request per plan while linking (reserved=%s)', async (reserved) => {
    let artifact = ''
    const script: TeamScript = [
      workerText('First delivery'),
      () => toolCallResponse('admit-read', 'read', { file_path: artifact }),
      () => toolCallResponse('admit-pass', 'structured_output', { criteria: [{ id: 'AC-1', status: 'pass',
        notes: 'Read the artifact.', evidencePaths: [artifact] }] }),
      workerText('Second delivery'),
    ]
    const fixture = await teamFixture({ script, review: 'automatic' })
    artifact = fixture.artifact
    const { ctx, store, plan, caller, execute } = fixture
    if (reserved) store.claimPlanRun(plan.id, plan.revision, brandString<ProjectExecutionId>('reserved-run'))
    const original = ctx.agentTeams.createTask.bind(ctx.agentTeams)
    const entered = deferred()
    const releaseLink = deferred()
    let held = false
    vi.spyOn(ctx.agentTeams, 'createTask').mockImplementation(async (member, request, signal) => {
      if (!held) {
        held = true
        entered.resolve()
        await Promise.race([releaseLink.promise, aborted(signal)])
        signal?.throwIfAborted()
      }
      return original(member, request, signal)
    })
    try {
      const first = execute({ planId: plan.id, planRevision: plan.revision })
      await entered.promise
      const second = await execute({ planId: plan.id, planRevision: plan.revision })
      expect(second.results[0]?.result).toMatchObject({ isError: true, error: { info: { code: 'PROJECT_EXECUTION_BUSY' } } })
      releaseLink.resolve()
      const completed = await first
      expect(completed.results[0]?.result.isError).not.toBe(true)
      const tasks = ctx.agentTeams.listTasks(caller.agent)
      expect(tasks).toHaveLength(2)
      const projectId = brandString<ProjectExecutionId>((await latest(ctx)).projectId)
      expect(store.execution(projectId).filter(entry => entry.state === 'started')).toHaveLength(1)
      expect(store.execution(projectId).filter(entry => entry.state === 'task-produced').map(entry => entry.index)).toEqual([0, 1])
      expect(fixture.adapter.requests).toHaveLength(4)
      for (const index of [0, 1]) {
        expect(tasks.filter(task => task.description.includes(teamTaskMarker(projectId, plan, index)))).toHaveLength(1)
      }
      if (reserved) expect(projectId).toBe('reserved-run')
    } finally {
      releaseLink.resolve()
      store.close()
      await caller.dispose()
    }
  })

  it('absorbs marker tasks after a partial association failure instead of creating duplicates', async () => {
    let artifact = ''
    const script: TeamScript = [
      workerText('First delivery'),
      () => toolCallResponse('retry-read', 'read', { file_path: artifact }),
      () => toolCallResponse('retry-pass', 'structured_output', { criteria: [{ id: 'AC-1', status: 'pass',
        notes: 'Read the artifact.', evidencePaths: [artifact] }] }),
      workerText('Second delivery'),
    ]
    const fixture = await teamFixture({ script, review: 'automatic' })
    artifact = fixture.artifact
    const { ctx, store, plan, caller, execute } = fixture
    const original = ctx.agentTeams.createTask.bind(ctx.agentTeams)
    let calls = 0
    vi.spyOn(ctx.agentTeams, 'createTask').mockImplementation(async (member, request, signal) => {
      calls += 1
      if (calls === 2) throw new Error('synthetic association failure')
      return original(member, request, signal)
    })
    try {
      const failed = await execute({ planId: plan.id, planRevision: plan.revision })
      expect(failed.results[0]?.result.isError).toBe(true)
      const reserved = store.plans().find(item => item.id === plan.id)?.executionId
      if (reserved === undefined) throw new Error('Expected a reserved execution')
      expect(store.execution(reserved)).toEqual([])
      expect(ctx.agentTeams.listTasks(caller.agent)).toHaveLength(1)

      const retried = await execute({ planId: plan.id, planRevision: plan.revision })
      expect(retried.results[0]?.result.isError).not.toBe(true)
      const tasks = ctx.agentTeams.listTasks(caller.agent)
      expect(tasks).toHaveLength(2)
      expect(store.execution(reserved).filter(entry => entry.state === 'started')).toHaveLength(1)
      expect(store.execution(reserved).filter(entry => entry.state === 'task-produced').map(entry => entry.index)).toEqual([0, 1])
      expect(fixture.adapter.requests).toHaveLength(4)
      for (const index of [0, 1]) {
        expect(tasks.filter(task => task.description.includes(teamTaskMarker(reserved, plan, index)))).toHaveLength(1)
      }
      expect(store.teamTasks(reserved)).toHaveLength(2)
    } finally { store.close(); await caller.dispose() }
  })
})

/** Project id of a dashboard node. */
function projectOf(node: { projectId: string }): ProjectExecutionId {
  return brandString<ProjectExecutionId>(node.projectId)
}

/** Whether a tool batch ended by rejection or a failed canonical tool result. */
function stopped(outcome: { kind: 'value'; value: { results: readonly { result: { isError?: boolean } }[] } } | { kind: 'error' }): boolean {
  return outcome.kind === 'error' || outcome.value.results.every(item => item.result.isError === true)
}
