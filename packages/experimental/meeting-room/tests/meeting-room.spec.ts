import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { taskAcceptanceSchema, projectPlanSchema } from '../src/plans.ts'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { observePlanDocument } from '../src/plan-document.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { MeetingStore } from '../src/store.ts'
import ApprovalService from '../../../interaction/user-approval/src/index.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, textResponse, toolCallResponse, maxTokensResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { defineTool, assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { loadStoredSession } from '../../../subagent/subagent/tests/persistence-helpers.ts'
import { mountLocalActivations } from '../../../subagent/subagent/tests/local-activation.ts'
import { mountWorkingDirectoryFixture } from '../../../subagent/subagent/tests/working-directory-fixture.ts'
import MeetingRoom, { Config } from '../src/index.ts'
import type { EmployeeId, ProjectTeamId, ProjectExecutionId } from '../src/types.ts'
import type {} from '../src/dashboard.ts'
import type {} from '../src/roster-management.ts'
import type {} from '../src/team-context.ts'
import LocalFileSystem from '../../../fs/fs-local/src/index.ts'
import TeamService from '@deepseek-ai/dsh-agent-team'
import { linkProjectTeamTasks, teamTaskMarker } from '../src/team-link.ts'

const contexts: Context[] = []
const directories: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** Meeting service over the real Agent loop, subagent runtime, and JSONL persistence. */
async function setup(script: ConstructorParameters<typeof MockAdapter>[0], options: { team?: boolean } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const adapter = new MockAdapter(script)
  const directory = await mkdtemp(join(tmpdir(), 'meeting-room-'))
  directories.push(directory)
  execFileSync('git', ['init', '--quiet', directory])
  await writeFile(join(directory, 'plan.md'), '# Delivery plan\n')
  const databasePath = join(directory, 'meetings.sqlite')
  await ctx.plugin(LocalFileSystem, { cwd: directory })
  await mountAgentLoopTestDependencies(ctx)
  await mountLocalActivations(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'meeting-test-spawn' })
  if (options.team) await ctx.plugin(TeamService)
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, { include: Include, 'meeting-product': MeetingRoom })
  const fixture = await readFile(new URL('./fixtures/project.yml', import.meta.url), 'utf8')
  const configPath = join(directory, 'cordis.yml')
  await writeFile(configPath, fixture.replace('DATABASE_PATH', JSON.stringify(databasePath)))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, databasePath, adapter, directory }
}

/** Concatenate the text blocks of one logged user message. */
function userText(content: readonly { type: string; text?: string }[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

/** Real files and logged read-tool results for acceptance and continuation tests. */
async function acceptanceFixture(release: 'automatic' | 'human', options: {
  read?: boolean
  submission?: 'missing' | 'duplicate' | 'empty-evidence'
  verdict?: 'pass' | 'fail'
  secondReviewer?: boolean
  reworkLimit?: number
  repairVerdicts?: ('pass' | 'fail')[]
  downstreamReview?: boolean
  downstreamVerdict?: 'pass' | 'fail'
  team?: boolean
  teamEnabled?: boolean
  onAuthor?: () => void
  repairGate?: { entered: () => void; wait: Promise<void> } } = {}) {
  let artifact = ''
  const script: ConstructorParameters<typeof MockAdapter>[0] = [() => {
    options.onAuthor?.()
    return textResponse('Author handoff')
  }]
  for (let index = 0; index < (options.secondReviewer ? 2 : 1); index++) {
    if (options.read !== false) script.push(() => toolCallResponse(`read-${index}`, 'read', { file_path: artifact }))
    script.push(() => {
      const criterion = { id: 'AC-1', status: options.verdict ?? 'pass',
        notes: 'Read the delivery specification and checked its content.',
        evidencePaths: options.submission === 'empty-evidence' ? [] : [artifact] }
      return toolCallResponse(`report-${index}`, 'structured_output', { criteria:
        options.submission === 'missing' ? [] : options.submission === 'duplicate' ? [criterion, criterion] : [criterion] })
    })
  }
  for (const [attempt, verdict] of (options.repairVerdicts ?? []).entries()) {
    script.push(() => toolCallResponse(`repair-${attempt}`, 'repair', { content: `Repaired delivery ${attempt + 1}` }))
    script.push(textResponse('Repaired artifact handoff'))
    script.push(() => toolCallResponse(`repair-read-${attempt}`, 'read', { file_path: artifact }))
    script.push(() => toolCallResponse(`repair-report-${attempt}`, 'structured_output', { criteria: [{
      id: 'AC-1', status: verdict, notes: 'Read the repaired delivery.', evidencePaths: [artifact],
    }] }))
  }
  script.push(textResponse('Downstream delivery'))
  if (options.downstreamReview) {
    script.push(() => toolCallResponse('downstream-read', 'read', { file_path: artifact }))
    script.push(() => toolCallResponse('downstream-report', 'structured_output', { criteria: [{
      id: 'AC-1', status: options.downstreamVerdict ?? 'fail',
      notes: options.downstreamVerdict === 'pass' ? 'Downstream delivery checked.' : 'Downstream requires a separate change.',
      evidencePaths: [artifact],
    }] }))
  }
  const result = await setup(script, { team: options.team === true })
  const { ctx, directory, databasePath } = result
  artifact = join(directory, 'delivery.md')
  await writeFile(artifact, 'Confirmed delivery content')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'repair', description: 'Replace the fixture delivery.', parameters: { content: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async (args, exec) => {
      if (options.repairGate) { options.repairGate.entered(); await options.repairGate.wait }
      exec.signal.throwIfAborted()
      await writeFile(artifact, args.content)
      return 'Repaired'
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'read', description: 'Read a test delivery file.', parameters: { file_path: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }],
      presentationMeta: args => ({ path: args.file_path }) },
    execute: args => readFile(args.file_path, 'utf8'),
  })))
  const store = new MeetingStore(databasePath)
  const author = store.saveEmployee({ id: brandString<EmployeeId>('author'), revision: 1,
    name: 'Author', responsibility: 'Produce delivery.', provider: 'mock', model: 'mock' }, 0)
  const reviewers = [store.saveEmployee({ ...author, id: brandString<EmployeeId>('reviewer'), name: 'Reviewer' }, 0)]
  if (options.secondReviewer) reviewers.push(store.saveEmployee({ ...author, id: brandString<EmployeeId>('reviewer-2'), name: 'Second reviewer' }, 0))
  const team = store.saveTeam({ id: brandString<ProjectTeamId>('delivery-team'), revision: 1,
    name: 'Delivery team', memberIds: [author.id, ...reviewers.map(employee => employee.id)] }, 0)
  const plan = store.savePlan(projectPlanSchema.parse({ document: await observePlanDocument(ctx, 'plan.md', directory, 4194304, new AbortController().signal), id: 'delivery-plan', revision: 1, goal: 'Acceptance delivery',
    background: [], team, employees: [author, ...reviewers], confirmed: false,
    tasks: [{ role: 'Author', employeeId: author.id, instruction: 'Produce delivery.md', acceptance: 'Content matches',
      review: { reviewerIds: reviewers.map(employee => employee.id), release, artifactPaths: ['delivery.md'], downstream: ['Approved delivery'],
        ...(options.reworkLimit === undefined ? {} : { rework: { maxAttempts: options.reworkLimit } }),
        criteria: [{ id: 'AC-1', description: 'Delivery content', method: 'Read the specification', expected: 'Confirmed content', evidence: 'delivery.md' }] } },
    { role: 'Downstream', employeeId: author.id, instruction: 'Deliver approved content', acceptance: 'Delivered',
      ...(options.downstreamReview ? { review: { reviewerIds: reviewers.map(employee => employee.id), release,
        artifactPaths: ['delivery.md'], downstream: [], criteria: [{ id: 'AC-1', description: 'Downstream delivery',
          method: 'Read delivery', expected: 'Downstream content', evidence: 'delivery.md' }] } } : {}) }],
  }), 0)
  store.confirmPlan(plan.id, 1)
  const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('delivery-caller'), agentOptions: { provider: 'mock', model: 'mock' } })
  await ctx.workingDirectory.set(caller.agent, directory)
  if (options.team && options.teamEnabled !== false) await ctx.agentTeams.setEnabled(caller.agent, true)
  caller.agent.session.append('turn/start', { turn: 1 })
  let sequence = 0
  const execute = (args: object, signal = new AbortController().signal) => ctx.tools.execute({ agent: caller.agent, signal,
    calls: [{ type: 'tool-call', id: brandString<ToolCallId>(`delivery-${++sequence}`), name: 'project_execute', arguments: JSON.stringify(args) }] })
  return { ...result, store, plan, caller, execute, artifact }
}

describe('meeting room', () => {

  it('restricts acceptance submissions to the confirmed criteria and canonical planned artifacts', async () => {
    const { adapter, store, plan, caller, execute, artifact } = await acceptanceFixture('automatic')
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const planTool = adapter.requests[0]?.tools?.find(item => item.name === 'project_plan_save')
      if (!planTool) throw new Error('Expected the real plan-save tool schema in the worker request')
      await expect(JSON.stringify(planTool, null, 2) + '\n').toMatchFileSnapshot('expected/project-plan-save-schema.json')
      const tool = adapter.requests[1]?.tools?.find(item => item.name === 'structured_output')
      if (!tool) throw new Error('Expected the reviewer structured-output schema')
      const schema = tool.parameters
      assertSupportedJsonSchema(schema)
      const criterion = { id: 'AC-1', status: 'pass', notes: 'Read and checked.', evidencePaths: [artifact] }
      expect(validateJsonSchemaValue(schema, { criteria: [criterion] })).toEqual([])
      for (const invalid of [
        { ...criterion, id: 'other' },
        { ...criterion, evidencePaths: ['delivery.md'] },
        { ...criterion, evidencePaths: [join(artifact, 'unplanned.md')] },
      ]) expect(validateJsonSchemaValue(schema, { criteria: [invalid] }).length).toBeGreaterThan(0)
      const rendered = JSON.stringify(tool, null, 2).split(JSON.stringify(artifact)).join(JSON.stringify('<artifact>'))
      await expect(rendered + '\n').toMatchFileSnapshot(join(import.meta.dirname, 'expected/acceptance-output-schema.json'))
      expect(JSON.stringify(adapter.requests[1])).toContain('First use the read tool to inspect every listed artifact')
    } finally { store.close(); await caller.dispose() }
  })

  it('retains reviewer failure observations when required artifact reads are missing', async () => {
    const { store, plan, caller, execute, artifact } = await acceptanceFixture('automatic', { read: false, verdict: 'fail' })
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const project = store.projectTimeline().at(-1)
      if (!project) throw new Error('Expected a blocked project')
      const history = store.execution(brandString<ProjectExecutionId>((JSON.parse(project.record) as { projectId: string }).projectId))
      const report = history.at(-1)?.report
      expect(report?.passed).toBe(false)
      const criterion = report?.reviewers[0]?.criteria[0]
      expect(criterion?.status).toBe('unverifiable')
      expect(criterion?.notes).toContain('Artifacts without observed reads:')
      expect(criterion?.notes).toContain(JSON.stringify([artifact]))
      expect(criterion?.notes).toContain('Reviewer submitted fail: Read the delivery specification and checked its content.')
      expect(history.some(entry => entry.index === 1)).toBe(false)
    } finally { store.close(); await caller.dispose() }
  })

  it.each([
    ['missing', 'Missing criterion IDs:'],
    ['duplicate', 'Duplicate criterion IDs:'],
    ['empty-evidence', 'No evidence paths submitted.'],
  ] as const)('blocks acceptance with %s submissions after artifact reads', async (submission, diagnostic) => {
    const { store, plan, caller, execute } = await acceptanceFixture('automatic', { submission })
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const project = store.projectTimeline().at(-1)
      if (!project) throw new Error('Expected a blocked project')
      const record = JSON.parse(project.record) as { projectId: string }
      const history = store.execution(brandString<ProjectExecutionId>(record.projectId))
      const report = history.at(-1)?.report
      expect(report?.passed).toBe(false)
      expect(report?.reviewers[0]?.criteria[0]?.status).toBe('unverifiable')
      expect(report?.reviewers[0]?.criteria[0]?.notes).toContain(diagnostic)
      if (submission !== 'missing') expect(report?.reviewers[0]?.criteria[0]?.notes).toContain('Reviewer submitted pass:')
      expect(history.some(entry => entry.index === 1)).toBe(false)
    } finally { store.close(); await caller.dispose() }
  })

  it('holds a Team-linked plan before its first worker when user input is already queued', async () => {
    const { caller, execute, store, plan, adapter } = await acceptanceFixture('automatic', { team: true })
    caller.agent.inbox.append('next-turn', createUserMessage({ content: [{ type: 'text', text: 'Review this direction first.' }],
      source: { kind: 'user' } }))
    try {
      await execute({ planId: plan.id, planRevision: plan.revision })
      const initial = store.projectTimeline().at(-1)
      if (!initial) throw new Error('Expected a persisted checkpoint')
      const paused = z.object({ projectId: z.string(), state: z.literal('awaiting-direction'), index: z.literal(0) })
        .parse(JSON.parse(initial.record))
      expect(adapter.requests).toHaveLength(0)
      caller.agent.inbox.clear()
      const resumed = await execute({ projectId: paused.projectId, expectedCheckpoint: initial.checkpoint })
      expect(resumed.results[0]?.result.isError).toBe(false)
      expect(adapter.requests).toHaveLength(4)
    } finally { store.close(); await caller.dispose() }
  })

  it('stops an inline execution for pending user direction without offering an unsupported continuation', async () => {
    let queueDirection: () => void = () => { throw new Error('Caller must exist before its worker runs') }
    const { ctx, adapter, databasePath } = await setup([() => { queueDirection(); return textResponse('First task produced') }])
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('inline-direction'),
      agentOptions: { provider: 'mock', model: 'mock' } })
    queueDirection = () => { caller.agent.inbox.append('next-turn', createUserMessage({
      content: [{ type: 'text', text: 'Change direction.' }], source: { kind: 'user' },
    })) }
    const store = new MeetingStore(databasePath)
    try {
      caller.agent.session.append('turn/start', { turn: 1 })
      const task = { role: 'Author', instruction: 'Produce a handoff', acceptance: 'Inspect handoff' }
      const result = await ctx.tools.execute({ agent: caller.agent, signal: new AbortController().signal, calls: [{
        type: 'tool-call', id: brandString<ToolCallId>('inline-direction-run'), name: 'project_execute',
        arguments: JSON.stringify({ goal: 'Inline delivery', tasks: [task, task] }),
      }] })
      expect(result.results[0]?.result.isError).toBe(false)
      expect(JSON.stringify(result.results)).toContain('Inline execution stopped before the next task')
      expect(JSON.parse(store.projectTimeline().at(-1)?.record ?? '{}')).toMatchObject({ state: 'interrupted', index: 1 })
      expect(adapter.requests).toHaveLength(1)
    } finally { store.close(); await caller.dispose() }
  })

  it.each(['next-turn', 'next-step'] as const)('yields before downstream dispatch for new main-conversation %s input and resumes without repeating work', async (target) => {
    let queueDirection: () => void = () => { throw new Error('Caller must exist before its worker runs') }
    const fixture = await acceptanceFixture('automatic', { onAuthor: () => { queueDirection() } })
    const { caller, execute, store, plan, adapter } = fixture
    const correction = createUserMessage({ content: [{ type: 'text', text: 'Check my new direction before the next task.' }],
      source: { kind: 'user' } })
    queueDirection = () => { caller.agent.inbox.append(target, correction) }
    try {
      const result = await execute({ planId: plan.id, planRevision: plan.revision })
      expect(result.results[0]?.result.isError).toBe(false)
      expect(JSON.stringify(result.results)).toContain('awaiting-direction')
      const content = result.results[0]?.result.content
      if (!content) throw new Error('Expected a project tool result')
      const visible = z.object({ state: z.literal('awaiting-direction'), index: z.number(), message: z.string() })
        .parse(JSON.parse(userText(content)))
      expect(`${JSON.stringify(visible, null, 2)}\n`).toBe(await readFile(
        new URL('./expected/project-awaiting-direction.json', import.meta.url), 'utf8'))
      const records = (await fixture.ctx.projectDashboard.timeline(new AbortController().signal))
      const latest = records.at(-1)
      expect(latest).toMatchObject({ state: 'awaiting-direction', index: 1 })
      expect(adapter.requests).toHaveLength(3)
      expect(records.filter(record => record.state === 'task-produced').map(record => record.index)).toEqual([0])
      expect([...caller.agent.inbox.nextTurn, ...caller.agent.inbox.nextStep]).toContainEqual(correction)
      if (!latest) throw new Error('Expected a persisted direction checkpoint')
      const retained = new MeetingStore(fixture.databasePath)
      try { expect(retained.execution(brandString<ProjectExecutionId>(latest.projectId)).at(-1)).toMatchObject({ state: 'awaiting-direction', index: 1 }) }
      finally { retained.close() }
      const premature = await execute({ projectId: latest.projectId, expectedCheckpoint: latest.checkpoint })
      expect(JSON.stringify(premature.results)).toContain('PROJECT_DIRECTION_PENDING')
      expect(store.execution(brandString<ProjectExecutionId>(latest.projectId)).at(-1)?.checkpoint).toBe(latest.checkpoint)
      expect(adapter.requests).toHaveLength(3)
      caller.agent.inbox.clear()
      const resumed = await execute({ projectId: latest.projectId, expectedCheckpoint: latest.checkpoint })
      expect(resumed.results[0]?.result.isError).toBe(false)
      expect(adapter.requests).toHaveLength(4)
      expect(store.execution(brandString<ProjectExecutionId>(latest.projectId)).filter(record => record.state === 'task-produced').map(record => record.index))
        .toEqual([0, 1])
    } finally { store.close(); await caller.dispose() }
  })

  it('refuses an awaiting-direction continuation after the confirmed plan is revised', async () => {
    let queueDirection: () => void = () => { throw new Error('Caller must exist before its worker runs') }
    const { ctx, caller, execute, store, plan, adapter } = await acceptanceFixture('automatic', { onAuthor: () => { queueDirection() } })
    queueDirection = () => { caller.agent.inbox.append('next-turn', createUserMessage({
      content: [{ type: 'text', text: 'Change the delivery direction.' }], source: { kind: 'user' },
    })) }
    try {
      await execute({ planId: plan.id, planRevision: plan.revision })
      const latest = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)
      if (!latest) throw new Error('Expected a persisted direction checkpoint')
      caller.agent.inbox.clear()
      store.savePlan({ ...plan, revision: 2, goal: 'Revised delivery', confirmed: false }, 1)
      const result = await execute({ projectId: latest.projectId, expectedCheckpoint: latest.checkpoint })
      expect(result.results[0]?.result.isError).toBe(true)
      expect(JSON.stringify(result.results)).toContain('PROJECT_PLAN_STALE')
      expect(adapter.requests).toHaveLength(3)
      expect(store.execution(brandString<ProjectExecutionId>(latest.projectId)).at(-1)?.state).toBe('awaiting-direction')
    } finally { store.close(); await caller.dispose() }
  })

  it('refuses a roster change from another connection between choosing and saving team defaults', async () => {
    const { ctx, databasePath, adapter } = await setup([])
    const other = new MeetingStore(databasePath)
    const employee = other.saveEmployee({ id: brandString<EmployeeId>('racing-selection-employee'), revision: 1,
      name: 'Employee', responsibility: 'Deliver files.', provider: 'mock', model: 'before' }, 0)
    const team = other.saveTeam({ id: brandString<ProjectTeamId>('racing-selection-team'), revision: 1,
      name: 'Team', memberIds: [employee.id] }, 0)
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('racing-selection-main'),
      agentOptions: { provider: 'mock', model: 'mock' } })
    // oxlint-disable-next-line typescript/unbound-method -- call() supplies the actual store receiver inside the prototype spy.
    const save = MeetingStore.prototype.saveSessionTeam
    vi.spyOn(MeetingStore.prototype, 'saveSessionTeam').mockImplementationOnce(function (this: MeetingStore, id, selection, revision) {
      other.saveEmployee({ ...employee, revision: 2, model: 'changed-before-commit' }, 1)
      return save.call(this, id, selection, revision)
    })
    try {
      expect(() => ctx.projectTeamContext.select(caller.agent.session, { expectedRevision: 0, teamId: team.id,
        teamRevision: 1, employees: [{ id: employee.id, revision: 1 }] }, new AbortController().signal))
        .toThrow(expect.objectContaining({ code: 'PROJECT_TEAM_SELECTION_ROSTER_STALE' }))
      expect(other.sessionTeam(caller.agent.session.id)).toBeNull()
      expect(adapter.requests).toHaveLength(0)
    } finally { other.close(); await caller.dispose() }
  })

  it('keeps a child with no active parent usable without applying main-conversation team preferences', async () => {
    const { ctx, adapter } = await setup([textResponse('Independent child request')])
    const orphan = await ctx.agents.create({ sessionId: brandString<SessionId>('independent-selection-child'),
      meta: { origin: 'subagent' }, agentOptions: { provider: 'mock', model: 'mock' } })
    try {
      expect(() => ctx.projectTeamContext.current(orphan.agent.session, new AbortController().signal))
        .toThrow(expect.objectContaining({ code: 'PROJECT_TEAM_SELECTION_MAIN_REQUIRED' }))
      orphan.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue the assigned task.' }],
        source: { kind: 'user' } }))
      await orphan.agent.whenIdle()
      expect(adapter.requests).toHaveLength(1)
      expect(JSON.stringify(adapter.requests[0])).not.toContain('Selected project team for planning')
    } finally { await orphan.dispose() }
  })

  it('retains exact conversation team defaults, logs model context and isolates workers before explicit clearing', async () => {
    const { ctx, databasePath, adapter } = await setup([
      textResponse('Main planning context observed'), textResponse('Independent employee context'), textResponse('Cleared defaults observed'),
    ])
    const store = new MeetingStore(databasePath)
    const employee = store.saveEmployee({ id: brandString<EmployeeId>('selection-employee'), revision: 1,
      name: 'SELECTED_EMPLOYEE', responsibility: 'Prepare deliverables.', provider: 'worker-vendor', model: 'worker-model' }, 0)
    const team = store.saveTeam({ id: brandString<ProjectTeamId>('selection-team'), revision: 1,
      name: 'SELECTED_TEAM', memberIds: [employee.id] }, 0)
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('selected-main'),
      agentOptions: { provider: 'mock', model: 'main-model' } })
    const other = await ctx.agents.create({ sessionId: brandString<SessionId>('other-selection-main'),
      agentOptions: { provider: 'mock', model: 'main-model' } })
    const signal = new AbortController().signal
    const choice = { expectedRevision: 0, teamId: team.id, teamRevision: 1, employees: [{ id: employee.id, revision: 1 }] }
    try {
      const selection = await ctx.projectTeamContext.select(caller.agent.session, choice, signal)
      expect(selection).toMatchObject({ revision: 1, team, employees: [employee] })
      expect(adapter.requests).toHaveLength(0)
      expect(store.plans()).toEqual([])
      expect(store.projectTimeline()).toEqual([])
      expect(await ctx.projectTeamContext.current(other.agent.session, signal)).toEqual({ revision: 0, team: null, employees: [] })
      expect(() => ctx.projectTeamContext.select(caller.agent.session, choice, signal))
        .toThrow(expect.objectContaining({ code: 'PROJECT_TEAM_SELECTION_STALE' }))
      const reopened = new MeetingStore(databasePath)
      try { expect(reopened.sessionTeam(caller.agent.session.id)).toEqual(selection) }
      finally { reopened.close() }
      store.saveEmployee({ ...employee, revision: 2, model: 'changed-after-selection' }, 1)
      expect((await ctx.projectTeamContext.current(caller.agent.session, signal)).employees[0]?.model).toBe('worker-model')
      expect(() => ctx.projectTeamContext.select(caller.agent.session, { ...choice, expectedRevision: 1 }, signal))
        .toThrow(expect.objectContaining({ code: 'PROJECT_TEAM_SELECTION_ROSTER_STALE' }))
      caller.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Prepare a plan using the selected defaults.' }],
        source: { kind: 'user' } }))
      await caller.agent.whenIdle()
      expect(adapter.requests[0]).toMatchObject({ provider: 'mock', model: 'main-model' })
      const logged = caller.agent.session.snapshotEvents().filter(event => event.type === 'user/message'
        && event.data.source.kind === 'runtime-context')
      expect(JSON.stringify(logged.at(-1))).toContain('SELECTED_TEAM')
      expect(JSON.stringify(logged.at(-1))).toContain('worker-model')
      for (const instruction of ['meeting_start', 'employeeId', 'meeting_record_decision', 'project_plan_save',
        'project_execute', 'project_records', 'testing assignment', 'command tools', 'user correction']) {
        expect(JSON.stringify(logged.at(-1))).toContain(instruction)
      }
      expect(JSON.stringify(logged.at(-1))).not.toContain('changed-after-selection')
      const context = logged.at(-1)
      if (context?.type !== 'user/message') throw new Error('Expected a logged runtime context')
      await expect(userText(context.data.content)).toMatchFileSnapshot(join(import.meta.dirname, 'expected/session-team-context.txt'))
      let descendantRefused = false
      const stopCheck = ctx.on('agent/pre-step', async (payload, next) => {
        if (payload.agent !== caller.agent && ctx.subagents.rootOf(payload.agent) === caller.agent) {
          expect(() => ctx.projectTeamContext.select(payload.agent.session, { ...choice, expectedRevision: 1 }, signal))
            .toThrow(expect.objectContaining({ code: 'PROJECT_TEAM_SELECTION_MAIN_REQUIRED' }))
          descendantRefused = true
        }
        return next()
      })
      const child = await ctx.subagents.startActivation({ provider: 'meeting-test-spawn', parent: caller.agent,
        label: 'Independent employee', prompt: [{ type: 'text', text: 'Only perform the assigned task.' }], signal, delivery: 'caller' })
      try {
        expect((await child.result).stopReason).toBe('completed')
        expect(descendantRefused).toBe(true)
        expect(JSON.stringify(adapter.requests[1])).not.toContain('SELECTED_TEAM')
      } finally { await child.dispose(); stopCheck() }
      const cleared = await ctx.projectTeamContext.select(caller.agent.session, {
        expectedRevision: 1, teamId: null, teamRevision: null, employees: [],
      }, signal)
      expect(cleared).toEqual({ revision: 2, team: null, employees: [] })
      caller.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue without a default team.' }],
        source: { kind: 'user' } }))
      await caller.agent.whenIdle()
      const clearedContext = caller.agent.session.snapshotEvents().filter(event => event.type === 'user/message'
        && event.data.source.kind === 'runtime-context').at(-1)
      expect(JSON.stringify(clearedContext)).toContain('no default team is selected')
      expect(JSON.stringify(clearedContext)).not.toContain('SELECTED_TEAM')
    } finally { store.close(); await other.dispose(); await caller.dispose() }
  })

  it('rejects catalog deadlines outside the supported timer range at configuration parsing', () => {
    expect(() => Config.parse({ modelCatalogTimeoutMs: 4_294_967_296 })).toThrow()
    expect(() => Config.parse({ modelCatalogTimeoutMs: 0 })).toThrow()
  })

  it.each(['caller', 'plugin'])('cancels catalog discovery through %s without waiting for an unresponsive provider', async (source) => {
    const { ctx } = await setup([])
    const blocked = Promise.withResolvers<[]>()
    const listing = vi.spyOn(ctx.llm, 'listModels').mockReturnValue(blocked.promise)
    const controller = new AbortController()
    const outcome = ctx.projectRoster.connections(controller.signal).then(() => 'returned', () => 'cancelled')
    try {
      expect(listing).toHaveBeenCalled()
      if (source === 'caller') controller.abort()
      else await ctx.fiber.dispose()
      expect(await outcome).toBe('cancelled')
    } finally { blocked.resolve([]); await blocked.promise }
  })

  it('edits reusable multi-provider employees and teams without dispatching work or overwriting a newer revision', async () => {
    const { ctx, adapter, databasePath } = await setup([])
    const other = new MockAdapter([])
    ctx.effect(() => ctx.llm.registerAdapter(['another-vendor'], other))
    const signal = new AbortController().signal
    const connections = await ctx.projectRoster.connections(signal)
    expect(connections.map(connection => connection.id)).toEqual(['mock', 'another-vendor'])
    const input = { expectedRevision: 0, name: 'Independent reviewer', responsibility: 'Read and review actual files.',
      provider: 'another-vendor', model: 'custom-model-not-in-catalog' }
    const reviewer = await ctx.projectRoster.saveEmployee(input, signal)
    const author = await ctx.projectRoster.saveEmployee({ ...input, name: 'Author', provider: 'mock', model: 'author-model' }, signal)
    const team = await ctx.projectRoster.saveTeam({ expectedRevision: 0, name: 'Two vendors', memberIds: [author.id, reviewer.id] }, signal)
    const updated = await ctx.projectRoster.saveEmployee({ ...input, id: reviewer.id, expectedRevision: 1,
      responsibility: 'Check every acceptance criterion.' }, signal)
    expect(updated.revision).toBe(2)
    expect(() => ctx.projectRoster.saveEmployee({ ...input, id: reviewer.id, expectedRevision: 1 }, signal))
      .toThrow(expect.objectContaining({ code: 'PROJECT_ROSTER_STALE' }))
    expect(() => ctx.projectRoster.saveEmployee({ ...input, provider: 'not-registered' }, signal))
      .toThrow(expect.objectContaining({ code: 'PROJECT_ROSTER_PROVIDER' }))
    expect(() => ctx.projectRoster.saveTeam({ expectedRevision: 0, name: 'Duplicate', memberIds: [author.id, author.id] }, signal))
      .toThrow(expect.objectContaining({ code: 'PROJECT_ROSTER_INPUT' }))
    const persisted = new MeetingStore(databasePath)
    try {
      expect(persisted.employees().find(employee => employee.id === reviewer.id)).toEqual(updated)
      expect(persisted.teams()).toEqual([team])
      expect(persisted.plans()).toEqual([])
      expect(persisted.projectTimeline()).toEqual([])
    } finally { persisted.close() }
    expect(adapter.requests).toHaveLength(0)
    expect(other.requests).toHaveLength(0)
  })

  it('routes an author and independent reviewer to different provider adapters within the same Team execution', async () => {
    const { ctx, databasePath, directory, adapter: mainAdapter } = await setup([], { team: true })
    const artifact = join(directory, 'mixed-provider.md')
    const authorAdapter = new MockAdapter([
      toolCallResponse('mixed-write', 'write_delivery', { content: 'MULTI_PROVIDER_DELIVERY' }),
      textResponse('Produced mixed-provider.md for independent review.'),
      () => {
        store.saveEmployee({ ...reviewer, revision: 2, provider: 'unavailable-provider', model: 'unavailable-model' }, 1)
        return textResponse('Author provider independent opinion')
      },
    ])
    const reviewerAdapter = new MockAdapter([
      toolCallResponse('mixed-read', 'read', { file_path: artifact }),
      toolCallResponse('mixed-verdict', 'structured_output', { criteria: [{ id: 'AC-1', status: 'pass',
        notes: 'Read the artifact through the independent provider.', evidencePaths: [artifact] }] }),
      textResponse('Reviewer provider independent opinion'),
    ])
    ctx.effect(() => ctx.llm.registerAdapter(['author-provider'], authorAdapter))
    ctx.effect(() => ctx.llm.registerAdapter(['review-provider'], reviewerAdapter))
    ctx.effect(() => ctx.tools.register(defineTool({ name: 'write_delivery', description: 'Write the fixture delivery.',
      parameters: { content: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (args) => { await writeFile(artifact, args.content); return artifact },
    })))
    ctx.effect(() => ctx.tools.register(defineTool({ name: 'read', description: 'Read the fixture artifact.',
      parameters: { file_path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }],
        presentationMeta: args => ({ path: args.file_path }) },
      execute: args => readFile(args.file_path, 'utf8'),
    })))
    const store = new MeetingStore(databasePath)
    const author = store.saveEmployee({ id: brandString<EmployeeId>('mixed-author'), revision: 1,
      name: 'Author', responsibility: 'Write the delivery.', provider: 'author-provider', model: 'author-model' }, 0)
    const reviewer = store.saveEmployee({ ...author, id: brandString<EmployeeId>('mixed-reviewer'), name: 'Reviewer',
      provider: 'review-provider', model: 'review-model' }, 0)
    const team = store.saveTeam({ id: brandString<ProjectTeamId>('mixed-team'), revision: 1, name: 'Mixed providers',
      memberIds: [author.id, reviewer.id] }, 0)
    const plan = store.savePlan(projectPlanSchema.parse({ document: await observePlanDocument(ctx, 'plan.md', directory, 4194304, new AbortController().signal), id: 'mixed-plan', revision: 1, goal: 'Mixed provider delivery',
      background: [], team, employees: [author, reviewer], confirmed: false, tasks: [{ role: 'Author', employeeId: author.id,
        instruction: 'Write mixed-provider.md using the tool.', acceptance: 'Contains MULTI_PROVIDER_DELIVERY',
        review: { reviewerIds: [reviewer.id], release: 'automatic', artifactPaths: ['mixed-provider.md'], downstream: [],
          criteria: [{ id: 'AC-1', description: 'Delivery marker', method: 'Read the file', expected: 'MULTI_PROVIDER_DELIVERY', evidence: 'mixed-provider.md' }] } }] }), 0)
    store.confirmPlan(plan.id, 1)
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('mixed-main'),
      agentOptions: { provider: 'mock', model: 'main-model' } })
    try {
      await ctx.workingDirectory.set(caller.agent, directory)
      await ctx.agentTeams.setEnabled(caller.agent, true)
      caller.agent.session.append('turn/start', { turn: 1 })
      const result = await ctx.tools.execute({ agent: caller.agent, signal: new AbortController().signal,
        calls: [{ type: 'tool-call', id: brandString<ToolCallId>('mixed-execute'), name: 'project_execute',
          arguments: JSON.stringify({ planId: plan.id, planRevision: 1 }) }] })
      expect(result.results[0]?.result.isError).not.toBe(true)
      expect(await readFile(artifact, 'utf8')).toBe('MULTI_PROVIDER_DELIVERY')
      expect(authorAdapter.requests.map(request => [request.provider, request.model])).toEqual([
        ['author-provider', 'author-model'], ['author-provider', 'author-model'],
      ])
      expect(reviewerAdapter.requests.map(request => [request.provider, request.model])).toEqual([
        ['review-provider', 'review-model'], ['review-provider', 'review-model'],
      ])
      expect(mainAdapter.requests).toHaveLength(0)
      expect(ctx.agentTeams.listTasks(caller.agent).map(task => task.status)).toEqual(['completed'])
      const meeting = await ctx.meetingRoom.startMeeting({ requirement: 'Compare independent delivery opinions.', roles: [
        { name: 'Author specialist', brief: 'Give an independent opinion.', employeeId: author.id },
        { name: 'Review specialist', brief: 'Give an independent opinion.', employeeId: reviewer.id },
      ] }, new AbortController().signal, caller.agent)
      expect(meeting.rounds.map(round => round.output)).toEqual([
        'Author provider independent opinion', 'Reviewer provider independent opinion',
      ])
      expect(authorAdapter.requests.at(-1)).toMatchObject({ provider: 'author-provider', model: 'author-model' })
      expect(reviewerAdapter.requests.at(-1)).toMatchObject({ provider: 'review-provider', model: 'review-model' })
      expect(JSON.stringify(reviewerAdapter.requests.at(-1))).not.toContain('Author provider independent opinion')
      expect(JSON.stringify(reviewerAdapter.requests.at(-1))).toContain('review-provider')
      expect(mainAdapter.requests).toHaveLength(0)
      await expect(ctx.meetingRoom.startMeeting({ requirement: 'Reject missing employee before dispatch.', roles: [
        { name: 'Existing', brief: 'Do not start.', employeeId: author.id },
        { name: 'Missing', brief: 'Do not start.', employeeId: brandString<EmployeeId>('missing-provider-employee') },
      ] }, new AbortController().signal, caller.agent)).rejects.toMatchObject({ code: 'MEETING_EMPLOYEE_MISSING' })
      expect(authorAdapter.requests).toHaveLength(3)
      expect(reviewerAdapter.requests).toHaveLength(3)
      await expect(ctx.meetingRoom.startMeeting({ requirement: 'Do not substitute an unavailable route.', roles: [
        { name: 'Unavailable reviewer', brief: 'Use only the selected route.', employeeId: reviewer.id },
        { name: 'Must not start', brief: 'Wait for the reviewer.', employeeId: author.id },
      ] }, new AbortController().signal, caller.agent)).rejects.toBeDefined()
      expect(mainAdapter.requests).toHaveLength(0)
      expect(authorAdapter.requests).toHaveLength(3)
      expect(reviewerAdapter.requests).toHaveLength(3)
    } finally { store.close(); await caller.dispose() }
  })
  it('does not attach an upstream repair allowance to a blocked downstream task', async () => {
    const { ctx, store, plan, caller, execute } = await acceptanceFixture('automatic', {
      verdict: 'fail', reworkLimit: 2, repairVerdicts: ['pass'], downstreamReview: true,
    })
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const blocked = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)!
      await execute({ projectId: blocked.projectId, expectedCheckpoint: blocked.checkpoint })
      const history = store.execution(brandString<ProjectExecutionId>(blocked.projectId))
      expect(history.at(-1)).toMatchObject({ state: 'acceptance-blocked', index: 1 })
      expect(history.filter(entry => entry.index === 1).every(entry => entry.rework === undefined)).toBe(true)
      const latest = history.at(-1)!
      const denied = await execute({ projectId: blocked.projectId, expectedCheckpoint: latest.checkpoint })
      expect(denied.results[0]?.result).toMatchObject({ isError: true, error: { info: { code: 'PROJECT_REWORK_LIMIT' } } })
    } finally { store.close(); await caller.dispose() }
  })

  it('retains a consumed repair attempt after cancellation and does not automatically retry unknown work', async () => {
    let entered!: () => void
    const ready = new Promise<void>((resolve) => { entered = resolve })
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    const { ctx, store, plan, caller, execute, artifact } = await acceptanceFixture('automatic', {
      verdict: 'fail', reworkLimit: 1, repairVerdicts: ['pass'], repairGate: { entered, wait },
    })
    const controller = new AbortController()
    let pendingRepair: ReturnType<typeof execute> | undefined
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const blocked = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)!
      pendingRepair = execute({ projectId: blocked.projectId, expectedCheckpoint: blocked.checkpoint }, controller.signal)
      await ready
      controller.abort()
      release()
      await pendingRepair
      const history = store.execution(brandString<ProjectExecutionId>(blocked.projectId))
      expect(history.filter(entry => entry.state === 'reworking')).toHaveLength(1)
      expect(history.at(-1)?.state).toBe('interrupted')
      expect(history.some(entry => entry.index === 1)).toBe(false)
      expect(await readFile(artifact, 'utf8')).toBe('Confirmed delivery content')
      const result = await execute({ projectId: blocked.projectId, expectedCheckpoint: history.at(-1)!.checkpoint })
      expect(result.results[0]?.result.isError).toBe(true)
    } finally {
      controller.abort()
      release()
      if (pendingRepair) await pendingRepair
      store.close()
      await caller.dispose()
    }
  })
  it('repairs only the failing task in its original execution and independently reviews the changed artifact', async () => {
    const { ctx, store, plan, caller, execute, artifact, adapter } = await acceptanceFixture('automatic', {
      verdict: 'fail', reworkLimit: 1, repairVerdicts: ['pass'],
    })
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const blocked = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)!
      expect(blocked).toMatchObject({ state: 'acceptance-blocked', rework: { attempt: 0, maxAttempts: 1 } })
      expect(store.execution(brandString<ProjectExecutionId>(blocked.projectId)).some(entry => entry.index === 1)).toBe(false)
      const results = await Promise.all([
        execute({ projectId: blocked.projectId, expectedCheckpoint: blocked.checkpoint }),
        execute({ projectId: blocked.projectId, expectedCheckpoint: blocked.checkpoint }),
      ])
      expect(results.filter(result => result.results[0]?.result.isError)).toHaveLength(1)
      expect(await readFile(artifact, 'utf8')).toBe('Repaired delivery 1')
      const history = store.execution(brandString<ProjectExecutionId>(blocked.projectId))
      expect(history.filter(entry => entry.state === 'reworking')).toMatchObject([
        { index: 0, rework: { attempt: 1, maxAttempts: 1, sourceCheckpoint: blocked.checkpoint } },
      ])
      const reports = history.flatMap(entry => entry.report ? [entry.report] : [])
      expect(reports.map(report => report.passed)).toEqual([false, true])
      expect(reports[0]?.artifacts[0]?.sha256).not.toBe(reports[1]?.artifacts[0]?.sha256)
      expect(reports[0]?.reviewers[0]?.sessionId).not.toBe(reports[1]?.reviewers[0]?.sessionId)
      expect(history.filter(entry => entry.state === 'starting' && entry.index === 1)).toHaveLength(1)
      expect(JSON.stringify(adapter.requests)).toContain('Failed independent acceptance')
      const requestCount = adapter.requests.length
      const stale = await execute({ projectId: blocked.projectId, expectedCheckpoint: blocked.checkpoint })
      expect(stale.results[0]?.result.isError).toBe(true)
      expect(adapter.requests).toHaveLength(requestCount)
    } finally { store.close(); await caller.dispose() }
  })

  it.each([undefined, 1])('retains failed reports and refuses repairs beyond the confirmed limit %s', async (reworkLimit) => {
    const { ctx, store, plan, caller, execute, adapter, databasePath } = await acceptanceFixture('automatic', {
      verdict: 'fail', ...(reworkLimit === undefined ? {} : { reworkLimit }), repairVerdicts: reworkLimit ? ['fail'] : [],
    })
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      let blocked = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)!
      if (reworkLimit) {
        await execute({ projectId: blocked.projectId, expectedCheckpoint: blocked.checkpoint })
        blocked = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)!
      }
      const reopened = new MeetingStore(databasePath)
      try {
        expect(reopened.execution(brandString<ProjectExecutionId>(blocked.projectId)).at(-1)?.state).toBe('acceptance-blocked')
      } finally { reopened.close() }
      const count = adapter.requests.length
      const result = await execute({ projectId: blocked.projectId, expectedCheckpoint: blocked.checkpoint })
      expect(result.results[0]?.result).toMatchObject({ isError: true, error: { info: { code: 'PROJECT_REWORK_LIMIT' } } })
      expect(adapter.requests).toHaveLength(count)
      expect(store.execution(brandString<ProjectExecutionId>(blocked.projectId)).some(entry => entry.index === 1)).toBe(false)
    } finally { store.close(); await caller.dispose() }
  })

  it('keeps human release after a successful repair and rejects a different main conversation', async () => {
    const { ctx, store, plan, caller, execute } = await acceptanceFixture('human', {
      verdict: 'fail', reworkLimit: 1, repairVerdicts: ['pass'],
    })
    const other = await ctx.agents.create({ sessionId: brandString<SessionId>('other-repair-main'), agentOptions: { provider: 'mock', model: 'mock' } })
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const blocked = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)!
      const args = { projectId: blocked.projectId, expectedCheckpoint: blocked.checkpoint }
      const denied = await ctx.tools.execute({ agent: other.agent, signal: new AbortController().signal,
        calls: [{ type: 'tool-call', id: brandString<ToolCallId>('wrong-repair-owner'), name: 'project_execute', arguments: JSON.stringify(args) }] })
      expect(denied.results[0]?.result).toMatchObject({ isError: true, error: { info: { code: 'TOOL_CONTEXT_UNAVAILABLE' } } })
      expect(store.execution(brandString<ProjectExecutionId>(blocked.projectId)).at(-1)?.checkpoint).toBe(blocked.checkpoint)
      await execute(args)
      const waiting = store.execution(brandString<ProjectExecutionId>(blocked.projectId)).at(-1)!
      expect(waiting).toMatchObject({ state: 'awaiting-human', report: { passed: true } })
      expect(store.execution(waiting.projectId).some(entry => entry.index === 1)).toBe(false)
      await ctx.projectDashboard.confirmAcceptance(waiting.projectId, waiting.checkpoint, new AbortController().signal)
      const released = store.execution(waiting.projectId).at(-1)!
      await execute({ projectId: waiting.projectId, expectedCheckpoint: released.checkpoint })
      expect(store.execution(waiting.projectId).filter(entry => entry.state === 'starting' && entry.index === 1)).toHaveLength(1)
    } finally { await other.dispose(); store.close(); await caller.dispose() }
  })

  it('rejects a repair after a newer plan revision and rejects invalid preconfirmed attempt limits', async () => {
    const { ctx, store, plan, caller, execute, adapter } = await acceptanceFixture('automatic', { verdict: 'fail', reworkLimit: 1 })
    try {
      for (const maxAttempts of [0, -1, 1.5]) {
        expect(projectPlanSchema.safeParse({ ...plan, tasks: plan.tasks.map(task => task.review
          ? { ...task, review: { ...task.review, rework: { maxAttempts } } } : task) }).success).toBe(false)
      }
      await execute({ planId: plan.id, planRevision: 1 })
      const blocked = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)!
      store.savePlan({ ...plan, revision: 2, confirmed: false }, 1)
      const count = adapter.requests.length
      const result = await execute({ projectId: blocked.projectId, expectedCheckpoint: blocked.checkpoint })
      expect(result.results[0]?.result.isError).toBe(true)
      expect(adapter.requests).toHaveLength(count)
      expect(store.execution(brandString<ProjectExecutionId>(blocked.projectId)).at(-1)?.checkpoint).toBe(blocked.checkpoint)
    } finally { store.close(); await caller.dispose() }
  })

  it('keeps meeting participants under the main conversation and retains versioned conclusions without confirming plans', async () => {
    const { ctx, databasePath, adapter } = await setup([textResponse('Product opinion'), textResponse('Independent technical opinion')])
    await ctx.plugin(ApprovalService)
    ctx.on('approval/request', () => Promise.resolve('allowed-once'))
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('meeting-main'), agentOptions: { provider: 'mock', model: 'mock' } })
    const other = await ctx.agents.create({ sessionId: brandString<SessionId>('unrelated-main'), agentOptions: { provider: 'mock', model: 'mock' } })
    let sequence = 0
    const execute = (name: string, args: object, agent = caller.agent) => ctx.tools.execute({ agent,
      signal: new AbortController().signal, calls: [{ type: 'tool-call', id: brandString<ToolCallId>(`meeting-${++sequence}`), name, arguments: JSON.stringify(args) }] })
    try {
      caller.agent.session.append('turn/start', { turn: 1 })
      other.agent.session.append('turn/start', { turn: 1 })
      const result = await execute('meeting_start', { requirement: 'Clarify a product tradeoff',
        roles: [{ name: 'Product', brief: 'Assess user needs' }, { name: 'Technical', brief: 'Assess feasibility' }] })
      expect(result.results[0]?.result.isError).toBe(false)
      const records = await ctx.projectDashboard.meetings(caller.agent.session.id, new AbortController().signal)
      const meeting = records[0]
      if (!meeting) throw new Error('Expected a linked meeting')
      expect(meeting).toMatchObject({ originSessionId: caller.agent.session.id, sessionId: caller.agent.session.id,
        state: 'awaiting-decision', decisions: [] })
      expect(meeting.rounds.map(round => round.output)).toEqual(['Product opinion', 'Independent technical opinion'])
      expect(caller.agent.session.snapshotEvents().filter(event => event.type === 'subagent/catalog')).toHaveLength(2)
      expect(JSON.stringify(adapter.requests[1])).not.toContain('Product opinion')
      expect(await ctx.projectDashboard.meetings(other.agent.session.id, new AbortController().signal)).toEqual([])
      const decision = { meetingId: meeting.id, expectedRevision: 0, summary: 'Retain the feasible proposal for user review', actions: ['Revise the project plan'] }
      expect(JSON.stringify((await execute('meeting_record_decision', decision, other.agent)).results)).toContain('MEETING_DECISION_STALE')
      expect((await execute('meeting_record_decision', decision)).results[0]?.result.isError).toBe(false)
      expect(JSON.stringify((await execute('meeting_record_decision', decision)).results)).toContain('MEETING_DECISION_STALE')
      expect((await execute('meeting_record_decision', { ...decision, expectedRevision: 1, summary: 'Clarify the proposal scope' })).results[0]?.result.isError).toBe(false)
      const store = new MeetingStore(databasePath)
      try {
        expect(store.meetingsForSession(caller.agent.session.id)[0]?.decisions.map(item => item.revision)).toEqual([1, 2])
        expect(store.plans()).toEqual([])
      } finally { store.close() }
      expect((await execute('meeting_records', {})).results[0]?.result.isError).toBe(false)
    } finally { await other.dispose(); await caller.dispose() }
  })

  it('records cancelled meetings and rejects conclusions on unfinished discussions', async () => {
    const controller = new AbortController()
    const { ctx, databasePath } = await setup([() => { controller.abort(); return textResponse('Partial opinion') }])
    const store = new MeetingStore(databasePath)
    store.recordMeeting('pending-discussion', 'Still running', { sessionId: 'main', originSessionId: 'main' })
    expect(() => { store.recordMeetingDecision('main', 'pending-discussion', 0, 'Premature', []) })
      .toThrow(expect.objectContaining({ code: 'MEETING_DECISION_STALE' }))
    store.close()
    await expect(ctx.meetingRoom.startMeeting({ requirement: 'Cancelled discussion', roles: [{ name: 'Reviewer', brief: 'Review' }] }, controller.signal)).rejects.toBeDefined()
    const reopened = new MeetingStore(databasePath)
    try {
      const database = new DatabaseSync(databasePath)
      try {
        const row = database.prepare('SELECT origin_session_id FROM meeting_links WHERE state = ?').get('interrupted')
        if (!row) throw new Error('Expected interrupted meeting')
        expect(reopened.meetingsForSession(String(row['origin_session_id']))[0]?.state).toBe('interrupted')
      } finally { database.close() }
    } finally { reopened.close() }
  })

  it('joins a running meeting before closing its store during plugin unload', async () => {
    const { ctx, databasePath, adapter } = await setup(['hang'])
    const outcome = ctx.meetingRoom.startMeeting({ requirement: 'Unloading discussion', roles: [{ name: 'Reviewer', brief: 'Review' }] })
      .then(() => 'completed', () => 'stopped')
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const entry = [...ctx.loader.entries()].find(item => item.options.id === 'meeting-product')
    if (!entry?.fiber) throw new Error('Expected loaded meeting product')
    await entry.fiber.dispose()
    expect(await outcome).toBe('stopped')
    const database = new DatabaseSync(databasePath)
    try { expect(database.prepare('SELECT state FROM meeting_links').get()?.['state']).toBe('interrupted') }
    finally { database.close() }
  })

  it('runs every independent reviewer and automatically supplies accepted evidence to downstream work', async () => {
    const { ctx, store, plan, caller, execute, adapter } = await acceptanceFixture('automatic', { secondReviewer: true })
    try {
      const result = await execute({ planId: plan.id, planRevision: 1 })
      expect(result.results[0]?.result.isError).toBe(false)
      const timeline = await ctx.projectDashboard.timeline(new AbortController().signal)
      const accepted = timeline.find(entry => entry.state === 'acceptance-passed')
      expect(accepted?.report?.reviewers).toHaveLength(2)
      expect(accepted?.report?.passed).toBe(true)
      expect(timeline.some(entry => entry.index === 1 && entry.state === 'task-produced')).toBe(true)
      expect(JSON.stringify(adapter.requests.at(-1))).toContain('Released acceptance evidence')
      expect(timeline.at(-1)?.state).toBe('awaiting-review')
    } finally { store.close(); await caller.dispose() }
  })

  it('requires workspace release and continues once from the next task with the original directory', async () => {
    const { ctx, store, plan, caller, execute, directory, adapter } = await acceptanceFixture('human')
    try {
      expect((await execute({ planId: plan.id, planRevision: 1 })).results[0]?.result.isError).toBe(false)
      const waiting = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)
      if (!waiting) throw new Error('Expected awaiting-human checkpoint')
      expect(waiting.state).toBe('awaiting-human')
      const premature = await execute({ projectId: waiting.projectId, expectedCheckpoint: waiting.checkpoint })
      expect(JSON.stringify(premature.results)).toContain('PROJECT_EXECUTION_NOT_RELEASED')
      await ctx.projectDashboard.confirmAcceptance(waiting.projectId, waiting.checkpoint, new AbortController().signal)
      await expect(ctx.projectDashboard.confirmAcceptance(waiting.projectId, waiting.checkpoint, new AbortController().signal))
        .rejects.toMatchObject({ code: 'PROJECT_EXECUTION_NOT_APPROVABLE' })
      const projectId = brandString<ProjectExecutionId>(waiting.projectId)
      const released = store.execution(projectId).at(-1)
      if (!released) throw new Error('Expected released checkpoint')
      await ctx.workingDirectory.set(caller.agent, join(directory, 'different-caller-directory'))
      const starts = vi.spyOn(ctx.subagents, 'startActivation')
      const ref = { projectId: waiting.projectId, expectedCheckpoint: released.checkpoint }
      const [first, duplicate] = await Promise.all([execute(ref), execute(ref)])
      expect([first, duplicate].filter(result => result.results[0]?.result.isError === false)).toHaveLength(1)
      expect(adapter.requests).toHaveLength(4)
      expect(store.execution(projectId).filter(entry => entry.state === 'task-produced').map(entry => entry.index)).toEqual([0, 1])
      expect(starts).toHaveBeenCalledWith(expect.objectContaining({ cwd: directory }))
      expect(store.execution(projectId).find(entry => entry.state === 'started')?.cwd).toBe(directory)
      expect(ctx.tools.get('project_acceptance_confirm')).toBeUndefined()
    } finally { store.close(); await caller.dispose() }
  })

  it.each([{ read: false, verdict: 'pass' as const }, { read: true, verdict: 'fail' as const }])('blocks downstream work for incomplete or failing acceptance: %j', async (options) => {
    const { ctx, store, plan, caller, execute } = await acceptanceFixture('automatic', options)
    try {
      expect((await execute({ planId: plan.id, planRevision: 1 })).results[0]?.result.isError).toBe(false)
      const timeline = await ctx.projectDashboard.timeline(new AbortController().signal)
      expect(timeline.at(-1)).toMatchObject({ state: 'acceptance-blocked', report: { passed: false } })
      expect(timeline.some(entry => entry.index === 1)).toBe(false)
    } finally { store.close(); await caller.dispose() }
  })

  it('rejects human release after artifact changes without advancing the waiting checkpoint', async () => {
    const { ctx, store, plan, caller, execute, artifact } = await acceptanceFixture('human')
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const waiting = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)
      if (!waiting) throw new Error('Expected waiting checkpoint')
      await writeFile(artifact, 'Changed after review')
      await expect(ctx.projectDashboard.confirmAcceptance(waiting.projectId, waiting.checkpoint, new AbortController().signal))
        .rejects.toMatchObject({ code: 'PROJECT_ACCEPTANCE_STALE' })
      expect(store.execution(brandString<ProjectExecutionId>(waiting.projectId)).at(-1)?.checkpoint).toBe(waiting.checkpoint)
    } finally { store.close(); await caller.dispose() }
  })

  it('completes a plan when every task has passed its configured acceptance', async () => {
    const { ctx, store, plan, caller, execute } = await acceptanceFixture('automatic')
    try {
      const first = plan.tasks[0]
      if (!first) throw new Error('Expected first task')
      const revised = store.savePlan({ ...plan, revision: 2, tasks: [first], confirmed: false }, 1)
      store.confirmPlan(revised.id, 2)
      expect((await execute({ planId: revised.id, planRevision: 2 })).results[0]?.result.isError).toBe(false)
      expect((await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)?.state).toBe('completed')
    } finally { store.close(); await caller.dispose() }
  })

  it('rejects a released artifact reference that resolves to a different file even when its content matches', async () => {
    const { ctx, store, plan, caller, execute, directory } = await acceptanceFixture('human')
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const waiting = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)
      if (!waiting) throw new Error('Expected waiting checkpoint')
      await ctx.projectDashboard.confirmAcceptance(waiting.projectId, waiting.checkpoint, new AbortController().signal)
      const released = store.execution(brandString<ProjectExecutionId>(waiting.projectId)).at(-1)
      if (!released) throw new Error('Expected release checkpoint')
      const replacement = join(directory, 'replacement.md')
      await writeFile(replacement, 'Confirmed delivery content')
      const resolve = ctx.fs.resolve.bind(ctx.fs)
      vi.spyOn(ctx.fs, 'resolve').mockImplementation((path, options) => resolve(path === 'delivery.md' ? replacement : path, options))
      const result = await execute({ projectId: waiting.projectId, expectedCheckpoint: released.checkpoint })
      expect(JSON.stringify(result.results)).toContain('PROJECT_ACCEPTANCE_STALE')
      expect(store.execution(brandString<ProjectExecutionId>(waiting.projectId)).some(entry => entry.index === 1)).toBe(false)
    } finally { store.close(); await caller.dispose() }
  })

  it('atomically rejects release when a newer plan exists, including through a separately opened store', async () => {
    const { ctx, store, plan, caller, execute, databasePath } = await acceptanceFixture('human')
    const concurrent = new MeetingStore(databasePath)
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const waiting = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)
      if (!waiting) throw new Error('Expected waiting checkpoint')
      concurrent.savePlan({ ...plan, revision: 2, confirmed: false }, 1)
      expect(() => {
        store.transitionExecution(brandString<ProjectExecutionId>(waiting.projectId), waiting.checkpoint,
          waiting.sessionId, { state: 'released', index: waiting.index, report: waiting.report }, plan)
      }).toThrow(expect.objectContaining({ code: 'PROJECT_EXECUTION_STALE' }))
      expect(store.execution(brandString<ProjectExecutionId>(waiting.projectId)).at(-1)?.state).toBe('awaiting-human')
    } finally { concurrent.close(); store.close(); await caller.dispose() }
  })

  it.each(['human', 'automatic'])('retains legacy %s acceptance without artifact paths while stopping downstream work', async (release) => {
    const { ctx, databasePath, adapter, directory } = await setup([textResponse('Produced artifact with checks')])
    const store = new MeetingStore(databasePath)
    const author = store.saveEmployee({ id: brandString<EmployeeId>('acceptance-author'), revision: 1,
      name: 'Author', responsibility: 'Produce the artifact.', provider: 'mock', model: 'mock' }, 0)
    const reviewer = store.saveEmployee({ ...author, id: brandString<EmployeeId>('acceptance-reviewer'), name: 'Reviewer' }, 0)
    const team = store.saveTeam({ id: brandString<ProjectTeamId>('acceptance-team'), revision: 1,
      name: 'Acceptance team', memberIds: [author.id, reviewer.id] }, 0)
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('acceptance-caller'),
      agentOptions: { provider: 'mock', model: 'mock' } })
    await ctx.workingDirectory.set(caller.agent, directory)
    let sequence = 0
    const execute = (name: string, args: object) => ctx.tools.execute({ agent: caller.agent,
      signal: new AbortController().signal, calls: [{ type: 'tool-call', id: brandString<ToolCallId>(`acceptance-${++sequence}`),
        name, arguments: JSON.stringify(args) }] })
    const review = { reviewerIds: [reviewer.id], release, downstream: ['Approved specification'],
      criteria: [{ id: 'AC-1', description: 'Offline operation', method: 'Disconnect networking and open the artifact',
        expected: 'Content remains readable', evidence: 'offline-check.md' }] }
    const task = { role: 'Author', employeeId: author.id, instruction: 'Produce specification', acceptance: 'Offline use', review }
    const draft = { expectedRevision: 0, goal: 'Acceptance-controlled delivery', teamId: team.id, background: [],
      tasks: [task, { role: 'Next worker', employeeId: author.id, instruction: 'Build from approved specification', acceptance: 'Tests pass' }] }
    try {
      caller.agent.session.append('turn/start', { turn: 1 })
      for (const invalid of [
        { ...review, reviewerIds: [author.id] },
        { ...review, reviewerIds: ['missing-reviewer'] },
        { ...review, reviewerIds: [reviewer.id, reviewer.id] },
        { ...review, criteria: [review.criteria[0], review.criteria[0]] },
        { ...review, criteria: [] },
      ]) {
        expect((await execute('project_plan_save', { ...draft, tasks: [{ ...task, review: { artifactPaths: ['offline-check.md'], ...invalid } }] })).results[0]?.result.isError).toBe(true)
      }
      expect(store.plans()).toEqual([])
      store.savePlan(projectPlanSchema.parse({ ...draft, document: await observePlanDocument(ctx, 'plan.md', directory, 4194304, new AbortController().signal), id: 'legacy-acceptance-plan', revision: 1, confirmed: false, team, employees: [author, reviewer] }), 0)
      const plan = store.plans()[0]
      if (!plan) throw new Error('Expected acceptance plan')
      expect(plan.employees.map(employee => employee.id)).toContain(reviewer.id)
      store.confirmPlan(plan.id, plan.revision)
      const result = await execute('project_execute', { planId: plan.id, planRevision: plan.revision })
      expect(result.results[0]?.result.isError).toBe(false)
      expect(JSON.stringify(result.results)).toContain('awaiting-acceptance')
      expect(adapter.requests).toHaveLength(1)
      expect(JSON.stringify(adapter.requests)).toContain('offline-check.md')
      const checkpoints = store.projectTimeline().map(row => z.object({
        state: z.string(), index: z.number().optional(), review: taskAcceptanceSchema.optional(),
      }).parse(JSON.parse(row.record)))
      expect(checkpoints.at(-1)).toMatchObject({ state: 'awaiting-acceptance', index: 0, review })
      expect(checkpoints.some(row => row.index === 1)).toBe(false)
      expect((await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)?.state).toBe('awaiting-acceptance')
    } finally {
      store.close()
      await caller.dispose()
    }
    const reopened = new MeetingStore(databasePath)
    try { expect(reopened.plans()[0]?.tasks[0]?.review).toEqual(review) }
    finally { reopened.close() }
  })

  it('keeps legacy plans readable and rejects absent or changed disk documents before confirmation and dispatch', async () => {
    const { ctx, store, plan, caller, execute, directory, adapter } = await acceptanceFixture('automatic')
    const signal = new AbortController().signal
    try {
      const legacy = store.savePlan({ ...plan, revision: 2, document: undefined, confirmed: false }, 1)
      expect(store.plans().some(item => item.revision === 2)).toBe(true)
      await expect(ctx.projectDashboard.confirmPlan(legacy.id, 2, signal)).rejects.toMatchObject({ code: 'PROJECT_PLAN_DOCUMENT_MISSING' })
      store.confirmPlan(legacy.id, 2)
      expect(JSON.stringify((await execute({ planId: legacy.id, planRevision: 2 })).results)).toContain('PROJECT_PLAN_DOCUMENT_MISSING')
      const revised = store.savePlan({ ...plan, revision: 3, confirmed: false }, 2)
      await writeFile(join(directory, 'plan.md'), '# Changed requirements\n')
      await expect(ctx.projectDashboard.confirmPlan(revised.id, 3, signal)).rejects.toMatchObject({ code: 'PROJECT_PLAN_DOCUMENT_STALE' })
      store.confirmPlan(revised.id, 3)
      expect(JSON.stringify((await execute({ planId: revised.id, planRevision: 3 })).results)).toContain('PROJECT_PLAN_DOCUMENT_STALE')
      expect(adapter.requests).toHaveLength(0)
      await expect(observePlanDocument(ctx, '../outside.md', directory, 4194304, signal)).rejects.toBeDefined()
      await rm(join(directory, '.git'), { recursive: true })
      await expect(observePlanDocument(ctx, 'plan.md', directory, 4194304, signal)).rejects.toMatchObject({ code: 'PROJECT_PLAN_GIT_REQUIRED' })
    } finally { await caller.dispose(); store.close() }
  })

  it('runs a user-confirmed plan once with its captured employees and sourced background, retaining edited versions', async () => {
    const { ctx, databasePath, adapter, directory } = await setup([textResponse('Plan delivery')])
    const store = new MeetingStore(databasePath)
    const employee = store.saveEmployee({ id: brandString<EmployeeId>('plan-employee'), revision: 1, name: 'Plan employee',
      responsibility: 'Use the confirmed background.', provider: 'mock', model: 'mock' }, 0)
    const team = store.saveTeam({ id: brandString<ProjectTeamId>('plan-team'), revision: 1,
      name: 'Plan team', memberIds: [employee.id] }, 0)
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('plan-caller'), agentOptions: { provider: 'mock', model: 'mock' } })
    await ctx.workingDirectory.set(caller.agent, directory)
    let sequence = 0
    const execute = (name: string, args: object) => ctx.tools.execute({ agent: caller.agent,
      signal: new AbortController().signal, calls: [{ type: 'tool-call', id: brandString<ToolCallId>(`plan-call-${++sequence}`),
        name, arguments: JSON.stringify(args) }] })
    try {
      caller.agent.session.append('turn/start', { turn: 1 })
      const draft = { documentPath: 'plan.md', expectedRevision: 0, goal: 'Deliver confirmed content', teamId: team.id,
        background: [{ title: 'Product decision', source: 'decision-42', content: 'The product must support offline review.' }],
        tasks: [{ role: 'Product', employeeId: employee.id, instruction: 'Write the specification', acceptance: 'Include offline review' }] }
      expect((await execute('project_plan_save', draft)).results[0]?.result.isError).toBe(false)
      const plan = store.plans()[0]
      if (!plan) throw new Error('Expected a saved plan')
      expect(plan.originSessionId).toBe(caller.agent.session.id)
      const ref = { planId: plan.id, planRevision: 1 }
      const unconfirmed = await execute('project_execute', ref)
      expect(unconfirmed.results[0]?.result.isError).toBe(true)
      expect(JSON.stringify(unconfirmed.results)).toContain('PROJECT_PLAN_UNCONFIRMED')
      expect(adapter.requests).toHaveLength(0)
      await ctx.projectDashboard.confirmPlan(plan.id, 1, new AbortController().signal)
      await ctx.projectDashboard.confirmPlan(plan.id, 1, new AbortController().signal)
      store.saveEmployee({ ...employee, revision: 2, responsibility: 'A later unrelated instruction.', model: 'later-model' }, 1)
      const result = await execute('project_execute', ref)
      expect(result.results[0]?.result.isError).toBe(false)
      expect(JSON.stringify(adapter.requests[0])).toContain('The product must support offline review.')
      expect(JSON.stringify(adapter.requests[0])).toContain('decision-42')
      expect(JSON.stringify(adapter.requests[0])).toContain(employee.responsibility)
      expect(JSON.stringify(adapter.requests[0])).not.toContain('A later unrelated instruction.')
      const duplicate = await execute('project_execute', ref)
      expect(duplicate.results[0]?.result.isError).toBe(true)
      expect(JSON.stringify(duplicate.results)).toContain('PROJECT_PLAN_NOT_RUNNABLE')
      expect(adapter.requests).toHaveLength(1)
      expect(store.projectTimeline().filter(row => z.object({ state: z.string() }).parse(JSON.parse(row.record)).state === 'started')).toHaveLength(1)
      const edited = { ...draft, id: plan.id, expectedRevision: 1, goal: 'Revised goal' }
      expect((await execute('project_plan_save', edited)).results[0]?.result.isError).toBe(false)
      const stale = await execute('project_plan_save', edited)
      expect(JSON.stringify(stale.results)).toContain('PROJECT_PLAN_STALE')
      await expect(async () => ctx.projectDashboard.confirmPlan(plan.id, 1, new AbortController().signal)).rejects.toMatchObject({ code: 'PROJECT_PLAN_STALE' })
      expect(JSON.stringify((await execute('project_execute', ref)).results)).toContain('PROJECT_PLAN_STALE')
      expect(store.plans().map(item => ({ revision: item.revision, confirmed: item.confirmed })))
        .toEqual([{ revision: 1, confirmed: true }, { revision: 2, confirmed: false }])
      expect(ctx.tools.get('project_plan_confirm')).toBeUndefined()
    } finally {
      store.close()
      await caller.dispose()
    }
    await ctx.fiber.dispose()
    const reopened = new MeetingStore(databasePath)
    try {
      expect(reopened.plans()).toHaveLength(2)
      expect(reopened.plans()[0]?.background[0]?.source).toBe('decision-42')
      expect(reopened.plans()[1]?.confirmed).toBe(false)
    } finally { reopened.close() }
  })

  it('adds the roster to a version-one project database while retaining its execution history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'project-roster-upgrade-'))
    directories.push(directory)
    const path = join(directory, 'old.sqlite')
    const old = new DatabaseSync(path)
    old.exec('CREATE TABLE project_records (sequence INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, record TEXT NOT NULL)')
    old.prepare('INSERT INTO project_records (session_id, record) VALUES (?, ?)').run('old-session', '{"state":"awaiting-review"}')
    old.exec('PRAGMA user_version = 1')
    old.close()
    const store = new MeetingStore(path)
    try {
      expect(store.employees()).toEqual([])
      expect(store.teams()).toEqual([])
      expect(store.projectRecords('old-session', 1)).toEqual(['{"state":"awaiting-review"}'])
    } finally { store.close() }
    const database = new DatabaseSync(path)
    try { expect(database.prepare('PRAGMA user_version').get()?.['user_version']).toBe(6) }
    finally { database.close() }
  })

  it('reports invalid roster revisions as argument failures before saving', async () => {
    const { ctx, databasePath } = await setup([])
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('invalid-revision'), agentOptions: { provider: 'mock', model: 'mock' } })
    try {
      caller.agent.session.append('turn/start', { turn: 1 })
      const result = await ctx.tools.execute({ agent: caller.agent, signal: new AbortController().signal, calls: [{
        type: 'tool-call', id: brandString<ToolCallId>('negative-revision'), name: 'employee_save',
        arguments: JSON.stringify({ expectedRevision: -1, name: 'Employee', responsibility: 'Work', provider: 'mock', model: 'mock' }),
      }] })
      expect(result.results[0]?.result.isError).toBe(true)
      expect(JSON.stringify(result.results)).toContain('INVALID_ARGS')
      const store = new MeetingStore(databasePath)
      try { expect(store.employees()).toEqual([]) } finally { store.close() }
    } finally { await caller.dispose() }
  })

  it('saves reusable employees and teams and executes their captured model and responsibilities', async () => {
    const { ctx, databasePath, adapter } = await setup([textResponse('Employee delivery')])
    ctx.llm.registerAdapter(['employee-model'], adapter)
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('roster-caller'), agentOptions: { provider: 'mock', model: 'mock' } })
    const starts = vi.spyOn(ctx.subagents, 'startActivation')
    const stored = new MeetingStore(databasePath)
    let call = 0
    const execute = (name: string, args: object) => ctx.tools.execute({
      agent: caller.agent, signal: new AbortController().signal,
      calls: [{ type: 'tool-call', id: brandString<ToolCallId>(`roster-${++call}`), name, arguments: JSON.stringify(args) }],
    })
    try {
      caller.agent.session.append('turn/start', { turn: 1 })
      const saved = await execute('employee_save', { expectedRevision: 0, name: 'Product specialist',
        responsibility: 'Always inspect the actual artifact before reporting delivery.', provider: 'employee-model', model: 'specialist' })
      expect(saved.results[0]?.result.isError).toBe(false)
      const employee = stored.employees()[0]
      if (!employee) throw new Error('Expected a persisted employee')
      const teamResult = await execute('team_save', { expectedRevision: 0, name: 'Delivery team', memberIds: [employee.id] })
      expect(teamResult.results[0]?.result.isError).toBe(false)
      const team = stored.teams()[0]
      if (!team) throw new Error('Expected a persisted team')
      await execute('employee_save', { expectedRevision: 0, name: 'Outside specialist',
        responsibility: 'Other team work', provider: 'mock', model: 'mock' })
      const outside = stored.employees()[1]
      if (!outside) throw new Error('Expected the outside employee')
      const refused = await execute('project_execute', { goal: 'Deliver a report', teamId: team.id,
        tasks: [{ role: 'Product', employeeId: outside.id, instruction: 'Create a report', acceptance: 'Report exists' }] })
      expect(refused.results[0]?.result.isError).toBe(true)
      expect(starts).not.toHaveBeenCalled()
      const result = await execute('project_execute', { goal: 'Deliver a report', teamId: team.id,
        tasks: [{ role: 'Product', employeeId: employee.id, instruction: 'Create a report', acceptance: 'Report exists' }] })
      expect(result.results[0]?.result.isError).toBe(false)
      expect(starts.mock.calls[0]?.[0]).toMatchObject({ label: employee.name,
        agentOptions: { provider: 'employee-model', model: 'specialist' } })
      expect(JSON.stringify(adapter.requests[0])).toContain(employee.responsibility)
      expect(stored.projectRecords(caller.agent.session.id, 20).join('\n')).toContain(employee.id)
      const update = { ...employee, id: employee.id, expectedRevision: 1, name: 'Updated specialist' }
      expect((await execute('employee_save', update)).results[0]?.result.isError).toBe(false)
      const stale = await execute('employee_save', update)
      expect(stale.results[0]?.result.isError).toBe(true)
      expect(JSON.stringify(stale.results)).toContain('PROJECT_ROSTER_STALE')
      expect(stored.employees()[0]?.revision).toBe(2)
      expect(stored.projectRecords(caller.agent.session.id, 20).join('\n')).toContain('Product specialist')
    } finally {
      stored.close()
      await caller.dispose()
    }
    await ctx.fiber.dispose()
    const reopened = new MeetingStore(databasePath)
    try {
      expect(reopened.employees()[0]?.name).toBe('Updated specialist')
      expect(reopened.teams()[0]?.name).toBe('Delivery team')
    } finally { reopened.close() }
  })

  it('rejects missing team members and unknown project employees before starting work', async () => {
    const { ctx, adapter } = await setup([])
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('invalid-roster'), agentOptions: { provider: 'mock', model: 'mock' } })
    try {
      caller.agent.session.append('turn/start', { turn: 1 })
      const result = await ctx.tools.execute({ agent: caller.agent, signal: new AbortController().signal, calls: [
        { type: 'tool-call', id: brandString<ToolCallId>('missing-member'), name: 'team_save',
          arguments: JSON.stringify({ expectedRevision: 0, name: 'Team', memberIds: ['missing'] }) },
        { type: 'tool-call', id: brandString<ToolCallId>('missing-employee'), name: 'project_execute',
          arguments: JSON.stringify({ goal: 'Ship', tasks: [{ role: 'Dev', employeeId: 'missing', instruction: 'Work', acceptance: 'Pass' }] }) },
      ] })
      expect(result.results.every(item => item.result.isError)).toBe(true)
      expect(JSON.stringify(result.results)).toContain('PROJECT_EMPLOYEE_MISSING')
      expect(adapter.requests).toHaveLength(0)
    } finally { await caller.dispose() }
  })

  it('cancels the current worker and retains an interrupted checkpoint', async () => {
    const controller = new AbortController()
    const { ctx, databasePath, adapter } = await setup([() => {
      controller.abort()
      return textResponse('Partial output')
    }])
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('cancelled-project'), agentOptions: { provider: 'mock', model: 'mock' } })
    try {
      caller.agent.session.append('turn/start', { turn: 1 })
      const task = { role: 'Developer', instruction: 'Do work', acceptance: 'Tests pass' }
      const result = await ctx.tools.execute({ agent: caller.agent, signal: controller.signal, calls: [{
        type: 'tool-call', id: brandString<ToolCallId>('cancelled-run'), name: 'project_execute', arguments: JSON.stringify({ goal: 'Ship', tasks: [task, task] }),
      }] })
      expect(result.results[0]?.result.isError).toBe(true)
      expect(adapter.requests).toHaveLength(1)
      const reopened = new MeetingStore(databasePath)
      try {
        expect(reopened.projectRecords('cancelled-project', 1)[0]).toContain('interrupted')
      } finally { reopened.close() }
    } finally { await caller.dispose() }
  })

  it('unregisters project tools when the product is unloaded', async () => {
    const { ctx } = await setup([])
    const entry = [...ctx.loader.entries()].find(item => item.options.id === 'meeting-product')
    if (!entry?.fiber) throw new Error('Meeting product was not loaded')
    expect(ctx.tools.get('project_execute')).toBeDefined()
    await entry.fiber.dispose()
    expect(ctx.tools.get('project_execute')).toBeUndefined()
    expect(ctx.tools.get('project_records')).toBeUndefined()
  })

  it('executes tools, hands work to the next worker and persists checkpoints for the caller', async () => {
    const { ctx, databasePath, adapter, directory } = await setup([
      toolCallResponse('write-artifact', 'write_project_artifact', {}),
      textResponse('Artifact report.txt contains shipped. Verify its contents.'),
      textResponse('Verified report.txt. Ready for user review.'),
    ])
    const artifact = join(directory, 'report.txt')
    ctx.tools.register(defineTool({
      name: 'write_project_artifact', description: 'Write the project test artifact.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { await writeFile(artifact, 'shipped'); return artifact },
    }))
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('project-caller'), agentOptions: { provider: 'mock', model: 'mock' } })
    try {
      caller.agent.session.append('turn/start', { turn: 1 })
      const result = await ctx.tools.execute({ agent: caller.agent, signal: new AbortController().signal, calls: [{
        type: 'tool-call', id: brandString<ToolCallId>('project-run'), name: 'project_execute', arguments: JSON.stringify({
          goal: 'Ship a report', tasks: [
            { role: 'Developer', instruction: 'Write report.txt', acceptance: 'File contains shipped' },
            { role: 'Reviewer', instruction: 'Review the report', acceptance: 'Check artifact contents' },
          ],
        }),
      }] })
      expect(result.results[0]?.result.isError).toBe(false)
      expect(await readFile(artifact, 'utf8')).toBe('shipped')
      expect(JSON.stringify(adapter.requests[2])).toContain('Artifact report.txt contains shipped')
      expect(JSON.stringify(adapter.requests[2])).toContain('Check artifact contents')
      const reopened = new MeetingStore(databasePath)
      try {
        const records = reopened.projectRecords('project-caller', 20)
        expect(records[0]).toContain('awaiting-review')
        expect(records.filter(record => record.includes('task-produced'))).toHaveLength(2)
        expect(reopened.projectRecords('another-session', 20)).toEqual([])
      } finally { reopened.close() }
      const history = await ctx.tools.execute({ agent: caller.agent, signal: new AbortController().signal, calls: [{
        type: 'tool-call', id: brandString<ToolCallId>('project-history'), name: 'project_records', arguments: '{"limit":20}',
      }] })
      expect(JSON.stringify(history.results)).toContain('awaiting-review')
    } finally { await caller.dispose() }
  })

  it('stops dependent tasks when a worker reaches its token ceiling', async () => {
    const { ctx, databasePath, adapter } = await setup([maxTokensResponse('Partial work')])
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('failed-project'), agentOptions: { provider: 'mock', model: 'mock' } })
    try {
      caller.agent.session.append('turn/start', { turn: 1 })
      const task = { role: 'Developer', instruction: 'Do work', acceptance: 'Tests pass' }
      const result = await ctx.tools.execute({ agent: caller.agent, signal: new AbortController().signal, calls: [{
        type: 'tool-call', id: brandString<ToolCallId>('failed-run'), name: 'project_execute', arguments: JSON.stringify({ goal: 'Ship', tasks: [task, task] }),
      }] })
      expect(result.results[0]?.result.isError).toBe(true)
      expect(JSON.stringify(result.results)).toContain('PROJECT_TASK_STOPPED')
      expect(adapter.requests).toHaveLength(1)
      const reopened = new MeetingStore(databasePath)
      try {
        const records = reopened.projectRecords('failed-project', 20)
        expect(records[0]).toContain('failed')
        expect(records.join('\n')).not.toContain('awaiting-review')
      } finally { reopened.close() }
    } finally { await caller.dispose() }
  })

  it('rejects empty project plans before starting a worker', async () => {
    const { ctx, adapter } = await setup([])
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('invalid-project'), agentOptions: { provider: 'mock', model: 'mock' } })
    try {
      caller.agent.session.append('turn/start', { turn: 1 })
      const result = await ctx.tools.execute({ agent: caller.agent, signal: new AbortController().signal, calls: [{
        type: 'tool-call', id: brandString<ToolCallId>('invalid-run'), name: 'project_execute', arguments: '{"goal":"Ship","tasks":[]}',
      }] })
      expect(result.results[0]?.result.isError).toBe(true)
      expect(JSON.stringify(result.results)).toContain('INVALID_ARGS')
      expect(adapter.requests).toHaveLength(0)
    } finally { await caller.dispose() }
  })

  it('runs each role in its own child Session and keeps first rounds independent', async () => {
    const { ctx, databasePath } = await setup([textResponse('产品初稿：先做会议列表'), textResponse('架构初稿：先定会话模型')])
    const recordRound = Object.getOwnPropertyDescriptor(MeetingStore.prototype, 'recordRound')?.value as
      | ((this: MeetingStore, ...args: Parameters<MeetingStore['recordRound']>) => void)
      | undefined
    if (recordRound === undefined) throw new Error('expected MeetingStore.recordRound')
    const writes = vi.spyOn(MeetingStore.prototype, 'recordRound').mockImplementation(function (this: MeetingStore, meetingId, round) {
      recordRound.call(this, meetingId, round)
      expect(this.roundsOf(meetingId)).toContainEqual(round)
    })

    const meeting = await ctx.meetingRoom.startMeeting({
      requirement: '设计会议室 v1',
      roles: [
        { name: '产品经理', brief: '从用户价值出发给出第一版方案' },
        { name: '架构师', brief: '从系统结构出发给出第一版方案' },
      ],
    })

    expect(meeting.rounds.map(round => round.role)).toEqual(['产品经理', '架构师'])
    expect(writes).toHaveBeenCalledTimes(2)
    const reopened = new MeetingStore(databasePath)
    try {
      expect(reopened.roundsOf(meeting.sessionId).map(round => round.childSessionId)).toEqual(meeting.rounds.map(round => round.sessionId))
    } finally {
      reopened.close()
    }
    expect(ctx.tools.get('meeting_start')?.name).toBe('meeting_start')
    expect(meeting.rounds[0]?.output).toContain('产品初稿')
    expect(meeting.rounds[1]?.output).toContain('架构初稿')

    const storedMeeting = await loadStoredSession(ctx.sessionPersistence, meeting.sessionId)
    expect(storedMeeting.events.filter(event => event.type === 'subagent/catalog')).toHaveLength(2)

    const architectRound = meeting.rounds[1]
    if (architectRound === undefined) throw new Error('expected the architect round')
    const storedChild = await loadStoredSession(ctx.sessionPersistence, architectRound.sessionId)
    const prompt = storedChild.events.find(event => event.type === 'user/message')
    if (prompt?.type !== 'user/message') throw new Error('expected the architect prompt in its stored log')
    const architectPrompt = userText(prompt.data.content)

    expect(architectPrompt).toContain('架构师')
    expect(architectPrompt).toContain('设计会议室 v1')
    expect(architectPrompt).not.toContain('产品经理')
    expect(architectPrompt).not.toContain('产品初稿')
    expect(storedChild.meta.parentSession).toBe(meeting.sessionId)
    await ctx.fiber.dispose()
    const afterUnload = new MeetingStore(databasePath)
    try {
      expect(afterUnload.roundsOf(meeting.sessionId)).toHaveLength(2)
    } finally {
      afterUnload.close()
    }
  })

  it.each(['rejected', 'allowed-once'] as const)('pairs approval events and honors %s through the tool executor', async (outcome) => {
    const { ctx, databasePath } = await setup([textResponse('approved draft')])
    await ctx.plugin(ApprovalService)
    ctx.on('approval/request', () => Promise.resolve(outcome))
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('approval-caller'), agentOptions: { provider: 'mock', model: 'mock' } })
    const writes = vi.spyOn(MeetingStore.prototype, 'recordMeeting')
    const starts = vi.spyOn(ctx.subagents, 'startActivation')
    try {
      caller.agent.session.append('turn/start', { turn: 1 })
      const callId = brandString<ToolCallId>('meeting-approval')
      const batch = await ctx.tools.execute({
        agent: caller.agent,
        signal: new AbortController().signal,
        calls: [{ type: 'tool-call', id: callId, name: 'meeting_start', arguments: JSON.stringify({
          requirement: 'Plan a meeting', roles: [{ name: 'Reviewer', brief: 'Review the plan' }],
        }) }],
      })
      const events = caller.agent.session.snapshotEvents()
      const asked = events.find(event => event.type === 'approval/asked')
      const decided = events.find(event => event.type === 'approval/decided')
      expect(asked?.data).toMatchObject({ callId, toolName: 'meeting_start' })
      expect(decided?.data).toMatchObject({ id: asked?.data.id, outcome })
      expect(batch.results[0]?.result.isError).toBe(outcome === 'rejected')
      expect(writes).toHaveBeenCalledTimes(outcome === 'rejected' ? 0 : 1)
      expect(starts).toHaveBeenCalledTimes(outcome === 'rejected' ? 0 : 1)
      if (outcome === 'allowed-once') {
        const meetingId = writes.mock.calls[0]?.[0]
        if (meetingId === undefined) throw new Error('expected a persisted meeting')
        const stored = new MeetingStore(databasePath)
        try {
          expect(stored.roundsOf(meetingId)).toHaveLength(1)
        } finally {
          stored.close()
        }
      }
    } finally {
      await caller.dispose()
    }
  })

  it('links confirmed plan tasks to Team and completes them only after project release', async () => {
    const { ctx, store, plan, caller, execute } = await acceptanceFixture('automatic', {
      team: true, downstreamReview: true, downstreamVerdict: 'pass',
    })
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const timeline = await ctx.projectDashboard.timeline(new AbortController().signal)
      const initial = timeline.find(record => record.state === 'started')
      if (!initial) throw new Error('expected a started checkpoint')
      expect(initial.teamLink).toBe('linked')
      const projectId = brandString<ProjectExecutionId>(initial.projectId)
      const tasks = ctx.agentTeams.listTasks(caller.agent)
      expect(tasks.map(task => task.status)).toEqual(['completed', 'completed'])
      expect(tasks[1]?.blockedBy).toEqual([tasks[0]?.id])
      const workers = store.execution(projectId).filter(entry => entry.state === 'task-produced')
      expect(tasks.map(task => task.ownerId)).toEqual(workers.map(entry => entry.childSessionId))
      expect(store.teamTasks(projectId).map(link => link.status)).toEqual(['completed', 'completed'])
      expect(timeline.filter(record => record.teamTask).map(record => record.teamTask?.status)).toContain('completed')
    } finally { store.close(); await caller.dispose() }
  })

  it('keeps Team tasks claimed across human releases and syncs each release before continuation', async () => {
    const { ctx, store, plan, caller, execute } = await acceptanceFixture('human', {
      team: true, downstreamReview: true, downstreamVerdict: 'pass',
    })
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      let timeline = await ctx.projectDashboard.timeline(new AbortController().signal)
      let node = timeline.at(-1)
      if (!node || node.state !== 'awaiting-human') throw new Error('expected a human release node')
      let tasks = ctx.agentTeams.listTasks(caller.agent)
      expect(tasks.map(task => task.status)).toEqual(['in_progress', 'pending'])
      expect(tasks[1]?.blockedBy).toEqual([tasks[0]?.id])

      await ctx.projectDashboard.confirmAcceptance(node.projectId, node.checkpoint, new AbortController().signal)
      timeline = await ctx.projectDashboard.timeline(new AbortController().signal)
      node = timeline.at(-1)
      if (!node || node.state !== 'released' || node.index !== 0) throw new Error('expected the first release')
      await execute({ projectId: node.projectId, expectedCheckpoint: node.checkpoint })
      tasks = ctx.agentTeams.listTasks(caller.agent)
      expect(tasks.map(task => task.status)).toEqual(['completed', 'in_progress'])

      timeline = await ctx.projectDashboard.timeline(new AbortController().signal)
      node = timeline.at(-1)
      if (!node || node.state !== 'awaiting-human' || node.index !== 1) throw new Error('expected the second human release node')
      await ctx.projectDashboard.confirmAcceptance(node.projectId, node.checkpoint, new AbortController().signal)
      timeline = await ctx.projectDashboard.timeline(new AbortController().signal)
      node = timeline.at(-1)
      if (!node || node.state !== 'released' || node.index !== 1) throw new Error('expected the second release')
      await execute({ projectId: node.projectId, expectedCheckpoint: node.checkpoint })
      expect(ctx.agentTeams.listTasks(caller.agent).map(task => task.status)).toEqual(['completed', 'completed'])
      expect((await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)?.state).toBe('completed')
    } finally { store.close(); await caller.dispose() }
  })

  it('records an unlinked execution when Team mode is off at admission', async () => {
    const { ctx, store, plan, caller, execute } = await acceptanceFixture('automatic', { team: true, teamEnabled: false })
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const timeline = await ctx.projectDashboard.timeline(new AbortController().signal)
      const initial = timeline.find(record => record.state === 'started')
      if (!initial) throw new Error('expected a started checkpoint')
      expect(initial.teamLink).toBe('disabled')
      expect(store.teamTasks(brandString<ProjectExecutionId>(initial.projectId))).toEqual([])
    } finally { store.close(); await caller.dispose() }
  })

  it('records an unlinked execution when the Team service is absent', async () => {
    const { ctx, store, plan, caller, execute } = await acceptanceFixture('automatic')
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const initial = (await ctx.projectDashboard.timeline(new AbortController().signal))
        .find(record => record.state === 'started')
      if (!initial) throw new Error('expected a started checkpoint')
      expect(initial.teamLink).toBe('unavailable')
      expect(store.teamTasks(brandString<ProjectExecutionId>(initial.projectId))).toEqual([])
    } finally { store.close(); await caller.dispose() }
  })

  it('adopts marker-matched Team tasks instead of creating duplicates after an interrupted admission', async () => {
    const { ctx, store, plan, caller } = await acceptanceFixture('automatic', { team: true })
    try {
      const projectId = brandString<ProjectExecutionId>('adoption-project')
      const signal = new AbortController().signal
      await expect(linkProjectTeamTasks(ctx, store, caller.agent, plan, projectId, signal)).resolves.toBe('linked')
      const first = ctx.agentTeams.listTasks(caller.agent)
      await expect(linkProjectTeamTasks(ctx, store, caller.agent, plan, projectId, signal)).resolves.toBe('linked')
      const second = ctx.agentTeams.listTasks(caller.agent)
      expect(second).toHaveLength(first.length)
      expect(second.filter(task => task.description.includes(teamTaskMarker(projectId, plan, 0)))).toHaveLength(1)
      expect(store.teamTasks(projectId)).toHaveLength(2)
    } finally { store.close(); await caller.dispose() }
  })

  it('reuses a durably admitted run when admission stopped before dispatch', async () => {
    const { ctx, store, plan, caller, execute } = await acceptanceFixture('automatic', { team: true })
    try {
      const admitted = brandString<ProjectExecutionId>('admitted-project')
      store.claimPlanRun(plan.id, plan.revision, admitted)
      await execute({ planId: plan.id, planRevision: plan.revision })
      const initial = (await ctx.projectDashboard.timeline(new AbortController().signal))
        .find(record => record.state === 'started')
      expect(initial?.projectId).toBe(admitted)
      expect(store.teamTasks(admitted)).toHaveLength(2)
      expect(ctx.agentTeams.listTasks(caller.agent).filter(task =>
        task.description.includes(teamTaskMarker(admitted, plan, 0)))).toHaveLength(1)
      const duplicate = await execute({ planId: plan.id, planRevision: plan.revision })
      expect(duplicate.results[0]?.result).toMatchObject({ isError: true, error: { info: { code: 'PROJECT_PLAN_NOT_RUNNABLE' } } })
      expect(ctx.agentTeams.listTasks(caller.agent)).toHaveLength(2)
    } finally { store.close(); await caller.dispose() }
  })

  it('stops a linked continuation after Team mode is disabled', async () => {
    const { ctx, store, plan, caller, execute } = await acceptanceFixture('human', { team: true })
    try {
      await execute({ planId: plan.id, planRevision: 1 })
      const node = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)
      if (!node || node.state !== 'awaiting-human') throw new Error('expected a human release node')
      await ctx.projectDashboard.confirmAcceptance(node.projectId, node.checkpoint, new AbortController().signal)
      const released = (await ctx.projectDashboard.timeline(new AbortController().signal)).at(-1)
      if (!released || released.state !== 'released') throw new Error('expected a release checkpoint')
      await ctx.agentTeams.setEnabled(caller.agent, false)
      const denied = await execute({ projectId: released.projectId, expectedCheckpoint: released.checkpoint })
      expect(denied.results[0]?.result).toMatchObject({ isError: true, error: { info: { code: 'PROJECT_TEAM_DISABLED' } } })
    } finally { store.close(); await caller.dispose() }
  })
})
