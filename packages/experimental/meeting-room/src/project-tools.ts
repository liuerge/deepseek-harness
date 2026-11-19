/** Ordered project execution with durable checkpoints and logged handoffs. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-working-directory'
import { defineTool, ToolContextUnavailableError, ToolArgsError } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentActivation } from '@deepseek-ai/dsh-subagent'
import type { Config } from './index.ts'
import type { MeetingStore } from './store.ts'
import { resolveEmployeeRoute, resolveEmployeeFallback } from './employee-route.ts'
import type { EmployeeId, ProjectPlanId, ProjectExecutionId, AcceptanceReport, ProjectTeamLinkState } from './types.ts'
import { verifyPlanDocument, requireGitProject } from './plan-document.ts'
import { reviewTask, verifyAcceptanceArtifacts } from './acceptance.ts'
import {
  claimProjectTeamTask, completeProjectTeamTask, linkProjectTeamTasks, registerTeamClaimGates, syncReleasedProjectTeamTasks,
  verifyProjectTeamTasks,
} from './team-link.ts'

/**
 * Register execution and history tools in the meeting product composition.
 * @param ctx - Owning plugin context with tools and subagents.
 * @param store - Checkpoint store that remains open through tool cleanup.
 * @param config - Selected child provider and model route.
 * @returns Idempotent drain that the store owner must await before closing storage.
 */
export function registerProjectTools(ctx: Context, store: MeetingStore, config: Config): () => Promise<void> {
  const running = new Map<AbortController, Promise<void>>()
  const admissions = new Set<string>()
  const claimGates = registerTeamClaimGates(ctx)
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
    description: 'Execute a confirmed saved plan, ordered inline tasks, or continue an exact execution checkpoint. New user input in the main conversation stops dispatch before the next task and returns awaiting-direction; process that input before continuing an unchanged confirmed plan. Released nodes continue downstream. Acceptance-blocked nodes may repair the same task only within the confirmed rework limit, then undergo fresh independent review. Other failures or interruptions require inspection and a revised plan.',
    parameters: {
      projectId: { type: 'string', description: 'Execution from project_records to continue after release or processing pending user direction, or repair after failed acceptance. Supply expectedCheckpoint and omit all plan and inline fields.' },
      expectedCheckpoint: { type: 'integer', description: 'Exact latest released, awaiting-direction or acceptance-blocked checkpoint sequence from project_records. Continuation claims this checkpoint once.' },
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
      const root = ctx.subagents.rootOf(parent)
      let projectId = args.projectId === undefined
        ? brandString<ProjectExecutionId>(randomUUID())
        : brandString<ProjectExecutionId>(args.projectId)
      const history = args.projectId === undefined ? [] : store.execution(projectId)
      const latest = history.at(-1)
      const initial = history.find(entry => entry.state === 'started')
      const repairing = latest?.state === 'acceptance-blocked'
      const awaitingDirection = latest?.state === 'awaiting-direction'
      if (args.projectId !== undefined && (!latest || (!repairing && !awaitingDirection && latest.state !== 'released')
        || latest.checkpoint !== args.expectedCheckpoint
        || latest.index === undefined || (!awaitingDirection && (!latest.report || latest.report.passed === repairing))
        || !initial?.planId || !initial.planRevision || !initial.cwd)) {
        throw new HarnessError('Continue only an exact released, awaiting-direction or acceptance-blocked checkpoint. Inspect other failures before retrying.',
          'PROJECT_EXECUTION_NOT_RELEASED')
      }
      const plan = initial?.planId && initial.planRevision ? store.currentPlan(initial.planId, initial.planRevision, true)
        : args.planId === undefined ? undefined
          : store.currentPlan(brandString<ProjectPlanId>(args.planId), args.planRevision ?? 0, true)
      if (args.projectId !== undefined && (root !== parent || initial?.sessionId !== parent.session.id)) {
        throw new ToolContextUnavailableError('Continue or repair the execution from its original main conversation.')
      }
      const hasUserInput = (): boolean => [...parent.inbox.nextTurn, ...parent.inbox.nextStep]
        .some(message => message.source.kind === 'user')
      if (awaitingDirection && hasUserInput()) {
        throw new HarnessError('Process the queued user input in the main conversation before continuing. End this response to let that input be claimed.',
          'PROJECT_DIRECTION_PENDING')
      }
      const scheduled: ProjectTeamLinkState | undefined = initial?.teamLink
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
      const admission = args.projectId === undefined && plan !== undefined ? `${plan.id}|${plan.revision}` : undefined
      if (admission !== undefined) {
        if (admissions.has(admission)) {
          throw new HarnessError('Another request on this Host is already starting this plan execution. Inspect its checkpoints before retrying.',
            'PROJECT_EXECUTION_BUSY')
        }
        admissions.add(admission)
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([exec.signal, controller.signal])
      let settle!: () => void
      running.set(controller, new Promise<void>((resolve) => { settle = resolve }))
      const owner = initial?.sessionId ?? parent.session.id
      const workers = new Map<number, SessionId>()
      for (const entry of history) {
        if (entry.index !== undefined && entry.state === 'task-produced' && entry.childSessionId !== undefined) {
          workers.set(entry.index, brandString<SessionId>(entry.childSessionId))
        }
      }
      try {
        let teamLink = scheduled
        if (args.projectId !== undefined && teamLink === 'linked') {
          verifyProjectTeamTasks(ctx, store, root, projectId, history)
          await syncReleasedProjectTeamTasks(ctx, store, root, projectId, history, signal)
        }
        const cwd = initial?.cwd ?? await ctx.workingDirectory.ensure(parent, signal)
        await requireGitProject(ctx, cwd, signal)
        if (plan) await verifyPlanDocument(ctx, plan, config.acceptanceMaxBytes, signal, cwd)
        assertOpen()
        signal.throwIfAborted()
        if (latest === undefined && plan) {
          if (plan.executionId !== undefined) {
            if (store.execution(plan.executionId).length > 0) {
              throw new HarnessError('This plan revision was already started. Inspect its execution before retrying.', 'PROJECT_PLAN_NOT_RUNNABLE')
            }
            projectId = plan.executionId
          } else {
            store.claimPlanRun(plan.id, plan.revision, projectId)
          }
          teamLink = await linkProjectTeamTasks(ctx, store, root, plan, projectId, signal)
        }
        assertOpen()
        signal.throwIfAborted()
        const teamNotice = teamLink === 'disabled'
          ? 'Team mode is off, so this execution is not mirrored to the shared Team task board.'
          : teamLink === 'unavailable'
            ? 'The Team service is unavailable, so this execution is not mirrored to the shared Team task board.'
            : undefined
        if (latest && plan) store.transitionExecution(projectId, latest.checkpoint, owner,
          { state: repairing ? 'reworking' : 'resuming', index: latest.index, ...(rework ? { rework } : {}) }, plan)
        const record = (entry: object) => {
          store.recordProject(owner, JSON.stringify({ projectId,
            ...(rework && 'index' in entry && entry.index === latest?.index ? { rework } : {}), ...entry }))
        }
        const linkage = { ...(teamLink === undefined ? {} : { teamLink }), ...(teamNotice === undefined ? {} : { teamNotice }) }
        let handoff = history.filter(entry => entry.state === 'task-produced').at(-1)?.handoff ?? ''
        const accepted: AcceptanceReport[] = history.flatMap(entry =>
          (entry.state === 'released' || entry.state === 'acceptance-passed') && entry.report?.passed ? [entry.report] : [])
        try {
          signal.throwIfAborted()
          if (!latest) record({ state: 'started', goal, tasks, cwd, ...(team === undefined ? {} : { team }), ...linkage,
            ...(plan === undefined ? {} : { planId: plan.id, planRevision: plan.revision, background: plan.background }) })
          for (const report of accepted) await verifyAcceptanceArtifacts(ctx, report, cwd, config.acceptanceMaxBytes, signal)
          for (const [index, task] of tasks.entries()) {
            if (latest?.index !== undefined
              && (index < latest.index || (!repairing && !awaitingDirection && index === latest.index))) continue
            signal.throwIfAborted()
            for (const report of accepted) await verifyAcceptanceArtifacts(ctx, report, cwd, config.acceptanceMaxBytes, signal)
            if (plan) {
              store.currentPlan(plan.id, plan.revision, true)
              await verifyPlanDocument(ctx, plan, config.acceptanceMaxBytes, signal, cwd)
            }
            if (hasUserInput()) {
              const state = plan ? 'awaiting-direction' : 'interrupted'
              record({ state, index, handoff })
              return JSON.stringify({ projectId, state, index, handoff, ...linkage,
                message: plan
                  ? 'New user input is waiting in the main conversation. No next task was dispatched. End this response so the main assistant can process that input. Inspect project_records afterward; continue this exact checkpoint only if the confirmed plan is unchanged, otherwise save and confirm a revised plan.'
                  : 'New user input is waiting in the main conversation. Inline execution stopped before the next task. End this response to process that input, inspect existing work, then save and confirm a plan for the remaining work. Do not repeat completed tasks.' })
            }
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
            const workerId = teamLink === 'linked' ? brandString<SessionId>(randomUUID()) : undefined
            const gate = workerId === undefined ? undefined : claimGates(workerId)
            let activation: SubagentActivation
            try {
              const repairAttempt = repairing && rework && index === latest.index
                ? rework.attempt : undefined
              const workerRoute = task.employee === undefined ? config.agentOptions
                : (repairAttempt === undefined ? undefined
                  : resolveEmployeeFallback(ctx, task.employee, repairAttempt, signal))
                  ?? resolveEmployeeRoute(ctx, task.employee, signal)
              activation = await ctx.subagents.startActivation({
                provider: config.provider, label: task.employee?.name ?? task.role, parent, cwd,
                prompt: [{ type: 'text', text: prompt }], signal, delivery: 'caller',
                ...(workerId === undefined ? {} : { childId: workerId }),
                ...(workerRoute === undefined ? {} : { agentOptions: workerRoute }),
                ...(task.employee?.preset === undefined ? {} : { agentPreset: task.employee.preset }),
              })
            } catch (error) {
              gate?.fail(error)
              gate?.close()
              const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined
              if (teamLink === 'linked' && code === 'UNSUPPORTED_CAPABILITY') {
                throw new HarnessError('Team-linked project work requires a local continuable subagent provider so the worker can wait for its claim. Configure a local provider or disable Team mode for this execution.',
                  'PROJECT_TEAM_GATE_UNAVAILABLE', { cause: error })
              }
              throw error
            }
            try {
              record({ state: 'running', index, sessionId: activation.childId,
                childSessionId: activation.childId, parentSessionId: parent.session.id })
              if (teamLink === 'linked') {
                try {
                  await claimProjectTeamTask(ctx, store, root, projectId, index, activation.childId, signal,
                    workers.get(index))
                  gate?.release()
                } catch (error) {
                  gate?.fail(error)
                  throw error
                }
              }
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
                workers.set(index, activation.childId)
                record({ state: 'task-produced', index, sessionId: activation.childId, handoff,
                  childSessionId: activation.childId, parentSessionId: parent.session.id })
              } finally {
                signal.removeEventListener('abort', abort)
              }
            } finally {
              gate?.fail(new HarnessError('Project execution closed before its Team claim settled.', 'PROJECT_TEAM_GATE_CLOSED'))
              await activation.dispose()
              gate?.close()
            }
            const plannedTask = plan?.tasks[index]
            if (plan && plannedTask?.review) {
              if (!plannedTask.review.artifactPaths) {
                record({ state: 'awaiting-acceptance', index, review: plannedTask.review })
                return JSON.stringify({ projectId, state: 'awaiting-acceptance', index, handoff, ...linkage,
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
                return JSON.stringify({ projectId, state, index, handoff, report, ...(repair ? { rework: repair } : {}), ...linkage })
              }
              record({ state: 'acceptance-passed', index, report })
              if (teamLink === 'linked') {
                await completeProjectTeamTask(ctx, store, root, projectId, index, workers.get(index), signal)
              }
              accepted.push(report)
            }
          }
          const state = plan && plan.tasks.every(task => task.review?.artifactPaths) ? 'completed' : 'awaiting-review'
          if (state === 'completed' && teamLink === 'linked') {
            for (let index = 0; index < tasks.length; index++) {
              await completeProjectTeamTask(ctx, store, root, projectId, index, workers.get(index), signal)
            }
          }
          record({ state })
          return JSON.stringify({ projectId, state, handoff, ...linkage })
        } catch (error) {
          try {
            record({ state: signal.aborted ? 'interrupted' : 'failed' })
          } catch (checkpointError) {
            throw new HarnessError('Project execution stopped and its final checkpoint could not be saved. Inspect child sessions before retrying.', 'PROJECT_PERSISTENCE_FAILED', { cause: new AggregateError([error, checkpointError]) })
          }
          throw error
        }
      } finally {
        running.delete(controller)
        settle()
        if (admission !== undefined) admissions.delete(admission)
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
