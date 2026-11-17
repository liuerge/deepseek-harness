import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import TeamService from '@deepseek-ai/dsh-agent-team'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountLocalActivations } from '../../../subagent/subagent/tests/local-activation.ts'
import { mountWorkingDirectoryFixture } from '../../../subagent/subagent/tests/working-directory-fixture.ts'
import LocalFileSystem from '../../../fs/fs-local/src/index.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import MeetingRoom from '../src/index.ts'
import { MeetingStore } from '../src/store.ts'
import { projectPlanSchema } from '../src/plans.ts'
import type { EmployeeId, ProjectTeamId } from '../src/types.ts'

/** Contexts created by these fixtures; the spec disposes them after each test. */
export const contexts: Context[] = []
/** Temporary directories created by these fixtures; the spec removes them after each test. */
export const directories: string[] = []

/** Mock model script accepted by {@link MockAdapter}. */
export type TeamScript = ConstructorParameters<typeof MockAdapter>[0]

/**
 * Mount the real meeting product over the Agent loop, subagent runtime, JSONL
 * persistence, and Team service.
 * @param script - Scripted model responses consumed in request order.
 * @returns The mounted context and persisted database path.
 */
export async function setupTeam(script: TeamScript) {
  const ctx = new Context()
  contexts.push(ctx)
  const adapter = new MockAdapter(script)
  const directory = await mkdtemp(join(tmpdir(), 'team-dispatch-'))
  directories.push(directory)
  const databasePath = join(directory, 'meetings.sqlite')
  await ctx.plugin(LocalFileSystem, { cwd: directory })
  await mountAgentLoopTestDependencies(ctx)
  await mountLocalActivations(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'meeting-test-spawn' })
  await ctx.plugin(TeamService)
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

/** Options for a confirmed project whose tasks are mirrored onto Team. */
export interface TeamFixtureOptions {
  /** Scripted model responses. */
  script: TeamScript
  /** Add a structured review on the first task with this release policy. */
  review?: 'human' | 'automatic'
  /** Create the first task with a confirmed rework allowance. */
  rework?: { maxAttempts: number }
  /** Number of ordered tasks; defaults to two. */
  taskCount?: number
}

/**
 * Create a confirmed two-task plan, caller conversation, capture directory, and
 * the tools used to observe real worker effects.
 * @param options - Model script and plan review configuration.
 * @returns Ready-to-execute fixture values.
 */
export async function teamFixture(options: TeamFixtureOptions) {
  const mount = await setupTeam(options.script)
  const { ctx, directory, databasePath } = mount
  const artifact = join(directory, 'dispatch.md')
  await writeFile(artifact, 'Initial delivery')
  const effects = { writes: 0 }
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'write_dispatch', description: 'Write the fixture dispatch artifact.',
    parameters: { content: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async (args) => {
      effects.writes += 1
      await writeFile(artifact, args.content)
      return artifact
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'read', description: 'Read a fixture artifact.',
    parameters: { file_path: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }],
      presentationMeta: args => ({ path: args.file_path }) },
    execute: args => readFile(args.file_path, 'utf8'),
  })))
  const store = new MeetingStore(databasePath)
  const author = store.saveEmployee({ id: brandString<EmployeeId>('dispatch-author'), revision: 1,
    name: 'Author', responsibility: 'Produce the dispatch delivery.', provider: 'mock', model: 'mock' }, 0)
  const reviewer = store.saveEmployee({ ...author, id: brandString<EmployeeId>('dispatch-reviewer'),
    name: 'Reviewer' }, 0)
  const team = store.saveTeam({ id: brandString<ProjectTeamId>('dispatch-team'), revision: 1,
    name: 'Dispatch team', memberIds: [author.id, reviewer.id] }, 0)
  const review = options.review === undefined ? undefined : {
    reviewerIds: [reviewer.id], release: options.review, artifactPaths: ['dispatch.md'], downstream: ['Approved delivery'],
    ...(options.rework === undefined ? {} : { rework: options.rework }),
    criteria: [{ id: 'AC-1', description: 'Delivery content', method: 'Read the artifact',
      expected: 'Initial delivery', evidence: 'dispatch.md' }],
  }
  const plan = store.savePlan(projectPlanSchema.parse({ id: 'dispatch-plan', revision: 1,
    goal: 'Dispatch reliability', background: [], team, employees: [author, reviewer], confirmed: false,
    tasks: [
      { role: 'Author', employeeId: author.id, instruction: 'Produce dispatch.md', acceptance: 'Content matches',
        ...(review === undefined ? {} : { review }) },
      ...(options.taskCount === 1 ? [] : [
        { role: 'Downstream', employeeId: author.id, instruction: 'Use the released delivery', acceptance: 'Delivery used' },
      ]),
    ] }), 0)
  store.confirmPlan(plan.id, 1)
  const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('dispatch-caller'),
    agentOptions: { provider: 'mock', model: 'mock' } })
  await ctx.workingDirectory.set(caller.agent, directory)
  await ctx.agentTeams.setEnabled(caller.agent, true)
  caller.agent.session.append('turn/start', { turn: 1 })
  let sequence = 0
  const execute = (args: object, signal = new AbortController().signal) => ctx.tools.execute({
    agent: caller.agent, signal,
    calls: [{ type: 'tool-call', id: brandString<ToolCallId>(`dispatch-${++sequence}`), name: 'project_execute',
      arguments: JSON.stringify(args) }],
  })
  return { ...mount, store, plan, caller, execute, artifact, effects, author, reviewer, team }
}

/** Worker response that writes the artifact before reporting a handoff. */
export function writingWorker(content: string) {
  return toolCallResponse(`dispatch-write-${content}`, 'write_dispatch', { content })
}

/** Plain worker response. */
export const workerText = textResponse

/** Wait for one observation without polling or fixed sleeps. */
export function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}
