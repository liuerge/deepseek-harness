/** Model-visible draft planning with sourced background and user-owned confirmation. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineTool, ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import { planTaskSchema, planBackgroundSchema } from './plans.ts'
import type { ProjectPlanId } from './types.ts'
import type { MeetingStore } from './store.ts'

/**
 * Register plan drafting and reading tools; user confirmation is provided by the workspace.
 * @param ctx - Owning plugin lifetime.
 * @param store - Durable project store.
 */
export function registerPlanTools(ctx: Context, store: MeetingStore): void {
  const output = {
    schema: { type: 'string' as const },
    render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
  }
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'project_plan_list',
    description: 'Read retained project plan versions, their task and background content, captured employee settings and user confirmation state. Only a confirmed latest revision can run.',
    parameters: {}, output,
    execute: () => Promise.resolve(JSON.stringify(store.plans())),
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'project_plan_save',
    description: 'Save a project plan draft for user review in the project workspace. Captures the selected team and employee settings. Each edit creates an unconfirmed revision and retains earlier versions.',
    parameters: {
      id: { type: 'string', description: 'Existing plan id for an edit. Omit when creating.' },
      expectedRevision: { type: 'integer', required: true, description: 'Zero for creation, otherwise latest content revision from project_plan_list.' },
      goal: { type: 'string', required: true, description: 'Project goal, constraints and expected delivery.' },
      teamId: { type: 'string', required: true, description: 'Saved team from employee_list.' },
      background: { type: 'array', required: true, description: 'Relevant source material and confirmed decisions. An empty array explicitly records that none is supplied.',
        items: { type: 'object', additionalProperties: false, properties: {
          title: { type: 'string', required: true, description: 'Material title.' },
          source: { type: 'string', required: true, description: 'Source URL, file path or decision reference.' },
          content: { type: 'string', required: true, description: 'Relevant content or sourced summary delivered to each employee.' },
        } },
      },
      tasks: { type: 'array', required: true, description: 'Work items in execution order, with assigned team members and acceptance criteria.',
        items: { type: 'object', additionalProperties: false, properties: {
          role: { type: 'string', required: true, description: 'Responsibility of this task.' },
          employeeId: { type: 'string', required: true, description: 'Saved employee in the selected team.' },
          instruction: { type: 'string', required: true, description: 'Work to perform and expected artifacts.' },
          acceptance: { type: 'string', required: true, description: 'Checks and evidence required for subsequent acceptance.' },
          review: { type: 'object', description: 'Optional acceptance by independent employees. Failed or unverifiable checks block downstream work.', additionalProperties: false,
            properties: {
              rework: { type: 'object', additionalProperties: false, description: 'Optional preauthorized repair of failing acceptance under unchanged criteria. Omit to disable repair.',
                properties: { maxAttempts: { type: 'integer', required: true, description: 'Positive maximum repair executions for this task across the execution history. Failures and interruptions consume an attempt.' } } },
              reviewerIds: { type: 'array', required: true, description: 'Distinct saved team employees other than the author.', items: { type: 'string' } },
              release: { type: 'string', required: true, enum: ['automatic', 'human'], description: 'Continue after all reviewers pass, or wait for workspace user confirmation before continuing.' },
              artifactPaths: { type: 'array', required: true, description: 'Nonempty UTF-8 artifact paths within the execution directory. Host verifies decoded-content hashes before release.', items: { type: 'string' } },
              downstream: { type: 'array', required: true, description: 'Inputs required by downstream nodes. An empty array explicitly means no downstream inputs.', items: { type: 'string' } },
              criteria: { type: 'array', required: true, description: 'Nonempty individually verifiable requirements with distinct references.',
                items: { type: 'object', additionalProperties: false, properties: {
                  id: { type: 'string', required: true, description: 'Criterion reference within this task.' },
                  description: { type: 'string', required: true, description: 'Requirement to assess.' },
                  method: { type: 'string', required: true, description: 'Check procedure.' },
                  expected: { type: 'string', required: true, description: 'Observable pass condition or threshold.' },
                  evidence: { type: 'string', required: true, description: 'Required evidence references or artifact paths.' },
                } },
              },
            },
          },
        } },
      },
    }, output,
    execute: (args, exec) => {
      if (!exec.agent || ctx.subagents.rootOf(exec.agent) !== exec.agent) {
        throw new ToolContextUnavailableError('Save project plans from the main conversation.')
      }
      if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0
        || args.expectedRevision >= Number.MAX_SAFE_INTEGER
        || (args.id === undefined) !== (args.expectedRevision === 0) || args.id?.trim() === '' || !args.goal.trim()) {
        throw new ToolArgsError(['Provide a goal and the current plan revision; omit id and use revision zero to create.'])
      }
      const tasks = planTaskSchema.array().min(1).safeParse(args.tasks)
      const background = planBackgroundSchema.array().safeParse(args.background)
      if (!tasks.success || !background.success) throw new ToolArgsError(['Provide non-empty task, source and review fields, with distinct reviewers and criterion references.'])
      const team = store.teams().find(item => item.id === args.teamId)
      if (!team) throw new ToolArgsError(['The selected team does not exist. Read employee_list.'])
      const employees = store.employees().filter(employee => tasks.data.some(task =>
        task.employeeId === employee.id || task.review?.reviewerIds.includes(employee.id)))
      const outsideTeam = tasks.data.some(task =>
        !team.memberIds.includes(task.employeeId) || !employees.some(employee => employee.id === task.employeeId))
      if (outsideTeam) {
        throw new ToolArgsError(['Every task must select an existing employee in the team.'])
      }
      if (tasks.data.some(task => task.review?.reviewerIds.some(id => id === task.employeeId
        || !team.memberIds.includes(id) || !employees.some(employee => employee.id === id)))) {
        throw new ToolArgsError(['Reviewers must be existing team employees other than the task author.'])
      }
      return Promise.resolve(JSON.stringify(store.savePlan({
        originSessionId: args.id === undefined ? exec.agent.session.id
          : store.currentPlan(brandString<ProjectPlanId>(args.id), args.expectedRevision).originSessionId ?? exec.agent.session.id,
        id: brandString<ProjectPlanId>(args.id ?? randomUUID()), revision: args.expectedRevision + 1,
        goal: args.goal, background: background.data, tasks: tasks.data, team, employees, confirmed: false,
      }, args.expectedRevision)))
    },
  })))
}
