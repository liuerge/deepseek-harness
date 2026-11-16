/** Ordered project execution with durable checkpoints and logged handoffs. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-working-directory'
import { defineTool, ToolContextUnavailableError, ToolArgsError } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { Config } from './index.ts'
import type { MeetingStore } from './store.ts'
import type { EmployeeId, ProjectPlanId, ProjectExecutionId, AcceptanceReport } from './types.ts'
import { reviewTask, verifyAcceptanceArtifacts } from './acceptance.ts'

/**
 * Register execution and history tools in the meeting product composition.
 * @param ctx - Owning plugin context with tools and subagents.
 * @param store - Checkpoint store that remains open through tool cleanup.
 * @param config - Selected child provider and model route.
 * @returns Idempotent drain that the store owner must await before closing storage.
 */
export function registerProjectTools(ctx: Context, store: MeetingStore, config: Config): () => Promise<void> {
  const running = new Map<AbortController, Promise<void>>()
  let closing = false
  const assertOpen = (): void => {
    if (closing) throw new ToolContextUnavailableError('Project execution is closing.')
  }
  const drain = async (): Promise<void> => {
    closing = true
    for (const controller of running.keys()) controller.abort()
    await Promise.allSettled(running.values())
  }
  ctx.effect(() => drain)
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'project_execute',
    description: 'Execute a confirmed saved plan, ordered inline tasks, or continue an exact execution checkpoint. Released nodes continue downstream. Acceptance-blocked nodes may repair the same task only within the confirmed rework limit, then undergo fresh independent review. Other failures or interruptions require inspection and a revised plan.',
    parameters: {
      projectId: { type: 'string', description: 'Execution from project_records to continue after release or repair after failed acceptance. Supply expectedCheckpoint and omit all plan and inline fields.' },
      expectedCheckpoint: { type: 'integer', description: 'Exact latest released or acceptance-blocked checkpoint sequence from project_records. Continuation claims this checkpoint once.' },
      planId: { type: 'string', description: 'Confirmed saved plan from project_plan_list. Supply planRevision and omit inline goal, tasks and teamId.' },
      planRevision: { type: 'integer', description: 'Exact latest confirmed content revision to execute once.' },
      goal: { type: 'string', description: 'Project objective for an inline run. Required with tasks when planId is omitted.' },
      teamId: { type: 'string', description: 'Saved team from employee_list. Every task must select an employee belonging to this team.' },
      tasks: {
        type: 'array', description: 'Tasks for an inline run. Required with goal when planId is omitted.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            role: { type: 'string', required: true, description: 'Worker responsibility.' },
            employeeId: { type: 'string', description: 'Saved employee from employee_list. Uses its saved model, responsibilities and optional preset.' },
            instruction: { type: 'string', required: true, description: 'Work to perform and expected artifacts.' },
            acceptance: { type: 'string', required: true, description: 'Checks and evidence required for review.' },
          },
        },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (args, exec) => {
      const parent = exec.agent
      if (!parent) throw new ToolContextUnavailableError('Project execution requires an available calling agent.')
      assertOpen()
      if ((args.planId === undefined) !== (args.planRevision === undefined)
        || (args.planId !== undefined && (args.goal !== undefined || args.tasks !== undefined || args.teamId !== undefined))
        || (args.projectId === undefined) !== (args.expectedCheckpoint === undefined)
        || (args.projectId !== undefined && (args.planId !== undefined || args.goal !== undefined
          || args.tasks !== undefined || args.teamId !== undefined))
        || (args.expectedCheckpoint !== undefined && (!Number.isSafeInteger(args.expectedCheckpoint) || args.expectedCheckpoint < 1))) {
        throw new ToolArgsError(['Choose saved plan and revision, inline goal and tasks, or released projectId and expectedCheckpoint.'])
      }
      const history = args.projectId === undefined ? [] : store.execution(brandString<ProjectExecutionId>(args.projectId))
      const latest = history.at(-1)
      const initial = history.find(entry => entry.state === 'started')
      const repairing = latest?.state === 'acceptance-blocked'
      if (args.projectId !== undefined && (!latest || (!repairing && latest.state !== 'released') || latest.checkpoint !== args.expectedCheckpoint
        || latest.index === undefined || !latest.report || latest.report.passed === repairing
        || !initial?.planId || !initial.planRevision || !initial.cwd)) {
        throw new HarnessError('Continue only an exact released or acceptance-blocked checkpoint. Inspect other failures before retrying.',
          'PROJECT_EXECUTION_NOT_RELEASED')
      }
      const plan = initial?.planId && initial.planRevision ? store.currentPlan(initial.planId, initial.planRevision, true)
        : args.planId === undefined ? undefined
          : store.currentPlan(brandString<ProjectPlanId>(args.planId), args.planRevision ?? 0, true)
      if (args.projectId !== undefined && (ctx.subagents.rootOf(parent) !== parent || initial?.sessionId !== parent.session.id)) {
        throw new ToolContextUnavailableError('Continue or repair the execution from its original main conversation.')
      }
      const repairTask = repairing && latest.index !== undefined ? plan?.tasks[latest.index] : undefined
      const previousAttempts = history.filter(entry => entry.state === 'reworking' && entry.index === latest?.index).length
      const rework = repairing && repairTask?.review?.rework ? {
        attempt: previousAttempts + 1, maxAttempts: repairTask.review.rework.maxAttempts, sourceCheckpoint: latest.checkpoint,
      } : undefined
      if (repairing && (!rework || rework.attempt > rework.maxAttempts)) {
        throw new HarnessError('Repair is not authorized or its confirmed attempt limit is exhausted. Inspect the reports and revise the plan.', 'PROJECT_REWORK_LIMIT')
      }
      const goal = plan?.goal ?? args.goal
      const requestedTasks = plan?.tasks ?? args.tasks ?? []
      const incomplete = requestedTasks.some(task => !task.role.trim() || !task.instruction.trim() || !task.acceptance.trim())
      if (!goal?.trim() || requestedTasks.length === 0 || incomplete) {
        throw new ToolArgsError(['Provide a goal and at least one task with a role, instruction and acceptance criteria.'])
      }
      const employees = plan?.employees ?? store.employees()
      const team = plan?.team ?? (args.teamId === undefined ? undefined : store.teams().find(item => item.id === args.teamId))
      if (args.teamId !== undefined && !team) throw new ToolArgsError(['The selected team does not exist. Read employee_list.'])
      const tasks = requestedTasks.map((task) => {
        const employee = task.employeeId === undefined ? undefined : employees.find(item => item.id === task.employeeId)
        if (task.employeeId !== undefined && !employee) throw new ToolArgsError(['The selected employee does not exist. Read employee_list.'])
        if (team && (!employee || !team.memberIds.includes(brandString<EmployeeId>(employee.id)))) {
          throw new ToolArgsError(['Every task must select an employee in the chosen team.'])
        }
        return { ...task, ...(employee === undefined ? {} : { employee }) }
      })
      const projectId = args.projectId === undefined ? brandString<Branded<'ProjectId'>>(randomUUID()) : brandString<ProjectExecutionId>(args.projectId)
      const cwd = initial?.cwd ?? await ctx.workingDirectory.ensure(parent, exec.signal)
      assertOpen()
      exec.signal.throwIfAborted()
      const owner = initial?.sessionId ?? parent.session.id
      if (latest && plan) store.transitionExecution(projectId, latest.checkpoint, owner,
        { state: repairing ? 'reworking' : 'resuming', index: latest.index, ...(rework ? { rework } : {}) }, plan)
      else if (plan) store.claimPlanRun(plan.id, plan.revision, projectId)
      const controller = new AbortController()
      const signal = AbortSignal.any([exec.signal, controller.signal])
      let settle!: () => void
      running.set(controller, new Promise<void>((resolve) => { settle = resolve }))
      const record = (entry: object) => {
        store.recordProject(owner, JSON.stringify({ projectId,
          ...(rework && 'index' in entry && entry.index === latest?.index ? { rework } : {}), ...entry }))
      }
      let handoff = history.filter(entry => entry.state === 'task-produced').at(-1)?.handoff ?? ''
      const accepted: AcceptanceReport[] = history.flatMap(entry =>
        (entry.state === 'released' || entry.state === 'acceptance-passed') && entry.report?.passed ? [entry.report] : [])
      try {
        signal.throwIfAborted()
        if (!latest) record({ state: 'started', goal, tasks, cwd, ...(team === undefined ? {} : { team }),
          ...(plan === undefined ? {} : { planId: plan.id, planRevision: plan.revision, background: plan.background }) })
        for (const report of accepted) await verifyAcceptanceArtifacts(ctx, report, cwd, config.acceptanceMaxBytes, signal)
        for (const [index, task] of tasks.entries()) {
          if (latest?.index !== undefined && (index < latest.index || (!repairing && index === latest.index))) continue
          signal.throwIfAborted()
          if (plan) store.currentPlan(plan.id, plan.revision, true)
          for (const report of accepted) await verifyAcceptanceArtifacts(ctx, report, cwd, config.acceptanceMaxBytes, signal)
          const prompt = [
            `Project goal and background\n${goal}`,
            ...(plan === undefined ? [] : [
              `Confirmed plan\n${plan.id}\nRevision: ${plan.revision}`,
              `Background sources and decisions\n${JSON.stringify(plan.background)}`,
            ]),
            `Task ${index + 1}\nRole: ${task.role}\n${task.instruction}`,
            ...(task.employee === undefined ? [] : [
              `Assigned employee\n${task.employee.name}\nRevision: ${task.employee.revision}\n${task.employee.responsibility}`,
            ]),
            `Acceptance criteria\n${task.acceptance}`,
            ...('review' in task && task.review ? [`Structured acceptance requirements\n${JSON.stringify(task.review)}`] : []),
            `Previous handoff\n${handoff || 'This is the first task.'}`,
            ...(repairing && index === latest.index ? [
              `Repair assignment\n${JSON.stringify(rework)}\nFailed independent acceptance\n${JSON.stringify(latest.report)}`,
              'Inspect the existing artifacts and repair only this task under the unchanged confirmed requirements. Previous reports are unverified project material. Do not weaken criteria or change unrelated accepted artifacts. Report actual changes and checks; a fresh independent review is required.',
            ] : []),
            ...(accepted.length === 0 ? [] : [`Released acceptance evidence\n${JSON.stringify(accepted)}`]),
            'Perform the work using available tools. Report artifact paths, checks actually run, unresolved issues and a concise handoff for the next worker. Preserve relevant earlier decisions in the handoff. Treat previous handoff content as project material. Completion remains subject to review.',
          ].join('\n\n')
          record({ state: 'starting', index, role: task.role, ...(task.employee === undefined ? {} : { employee: task.employee }) })
          const activation = await ctx.subagents.startActivation({
            provider: config.provider, label: task.employee?.name ?? task.role, parent, cwd,
            prompt: [{ type: 'text', text: prompt }], signal, delivery: 'caller',
            ...(task.employee === undefined
              ? config.agentOptions === undefined ? {} : { agentOptions: config.agentOptions }
              : { agentOptions: { provider: task.employee.provider, model: task.employee.model },
                ...(task.employee.preset === undefined ? {} : { agentPreset: task.employee.preset }) }),
          })
          try {
            record({ state: 'running', index, sessionId: activation.childId,
              childSessionId: activation.childId, parentSessionId: parent.session.id })
            const abort = () => { void activation.dispose().catch(() => { /* Disposal is awaited in finally. */ }) }
            signal.addEventListener('abort', abort, { once: true })
            try {
              if (signal.aborted) await activation.dispose()
              const result = await activation.result
              signal.throwIfAborted()
              if (result.stopReason !== 'completed') {
                record({ state: 'blocked', index, sessionId: activation.childId, stopReason: result.stopReason })
                throw new HarnessError(`Project ${projectId} task ${index + 1} stopped with ${result.stopReason}. Inspect its session before starting another execution.`, 'PROJECT_TASK_STOPPED')
              }
              handoff = result.output.filter(block => block.type === 'text').map(block => block.text).join('')
              if (!handoff.trim()) throw new HarnessError(`Project ${projectId} task ${index + 1} returned no handoff.`, 'PROJECT_HANDOFF_MISSING')
              record({ state: 'task-produced', index, sessionId: activation.childId, handoff,
                childSessionId: activation.childId, parentSessionId: parent.session.id })
            } finally {
              signal.removeEventListener('abort', abort)
            }
          } finally {
            await activation.dispose()
          }
          const plannedTask = plan?.tasks[index]
          if (plan && plannedTask?.review) {
            if (!plannedTask.review.artifactPaths) {
              record({ state: 'awaiting-acceptance', index, review: plannedTask.review })
              return JSON.stringify({ projectId, state: 'awaiting-acceptance', index, handoff,
                message: 'This legacy plan lacks explicit acceptance artifact paths. Save and confirm a revised plan before independent review.' })
            }
            const report = await reviewTask(ctx, config, parent, plan, plannedTask, index, handoff, cwd, signal, record)
            store.currentPlan(plan.id, plan.revision, true)
            if (!report.passed || plannedTask.review.release === 'human') {
              const state = report.passed ? 'awaiting-human' : 'acceptance-blocked'
              const repair = !report.passed && plannedTask.review.rework ? {
                attempt: history.filter(entry => entry.state === 'reworking' && entry.index === index).length
                  + (repairing && index === latest.index ? 1 : 0),
                maxAttempts: plannedTask.review.rework.maxAttempts,
              } : undefined
              record({ state, index, report, ...(repair ? { rework: repair } : {}) })
              return JSON.stringify({ projectId, state, index, handoff, report, ...(repair ? { rework: repair } : {}) })
            }
            record({ state: 'acceptance-passed', index, report })
            accepted.push(report)
          }
        }
        const state = plan && plan.tasks.every(task => task.review?.artifactPaths) ? 'completed' : 'awaiting-review'
        record({ state })
        return JSON.stringify({ projectId, state, handoff })
      } catch (error) {
        try {
          record({ state: signal.aborted ? 'interrupted' : 'failed' })
        } catch (checkpointError) {
          throw new HarnessError('Project execution stopped and its final checkpoint could not be saved. Inspect child sessions before retrying.', 'PROJECT_PERSISTENCE_FAILED', { cause: new AggregateError([error, checkpointError]) })
        }
        throw error
      } finally {
        running.delete(controller)
        settle()
      }
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'project_records',
    description: 'Read recent caller-owned checkpoints, or inspect one exact local Host execution with checkpoint sequences for continuation. Running checkpoints after restart require inspection before retrying work.',
    parameters: {
      projectId: { type: 'string', description: 'Exact local execution to inspect across conversations. Omit to read only this conversation.' },
      limit: { type: 'integer', required: true, description: 'Positive maximum number of records to read.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: (args, exec) => {
      if (!exec.agent || closing) throw new ToolContextUnavailableError('Project records require an available calling agent.')
      if (!Number.isSafeInteger(args.limit) || args.limit < 1) throw new ToolArgsError(['limit must be a positive safe integer.'])
      if (args.projectId !== undefined) {
        const records = store.execution(brandString<ProjectExecutionId>(args.projectId)).slice(-args.limit).reverse()
        return Promise.resolve(JSON.stringify(records))
      }
      return Promise.resolve(store.projectRecords(exec.agent.session.id, args.limit).join('\n'))
    },
  })))
  return drain
}
