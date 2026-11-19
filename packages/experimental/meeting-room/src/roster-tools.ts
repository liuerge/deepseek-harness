/** Discover and maintain reusable employees and team templates through model tools. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MeetingStore } from './store.ts'
import { assertEmployeeRouteConfig } from './employee-route.ts'
import type { EmployeeId, ProjectTeamId } from './types.ts'

/**
 * Register roster discovery and version-checked saving tools.
 * @param ctx - Owning registration lifetime.
 * @param store - Durable project store.
 */
export function registerRosterTools(ctx: Context, store: MeetingStore): void {
  const output = {
    schema: { type: 'string' as const },
    render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
  }
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'employee_list',
    description: 'Read saved employees and team templates before assigning project tasks. Employee records include responsibilities, model routes, optional presets and revisions.',
    parameters: {}, output,
    execute: () => Promise.resolve(JSON.stringify({ employees: store.employees(), teams: store.teams() })),
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'employee_save',
    description: 'Save a reusable employee. Updates require its current revision from employee_list. The optional DSH preset selects persona, tools and skills for subsequent runs.',
    parameters: {
      id: { type: 'string', description: 'Existing employee id when updating. Omit to create.' },
      expectedRevision: { type: 'integer', required: true, description: 'Zero to create, or the current saved revision to update.' },
      name: { type: 'string', required: true, description: 'Employee display name.' },
      responsibility: { type: 'string', required: true, description: 'Persistent work responsibilities and instructions.' },
      provider: { type: 'string', required: true, description: 'Configured model provider.' },
      model: { type: 'string', required: true, description: 'Model id on that provider.' },
      reasoningEffort: { type: 'string', description: 'Adapter reasoning effort for this provider/model; omission keeps the model default.' },
      fallbacks: { type: 'array', description: 'Ordered backup provider/model routes tried when the primary is unavailable.' },
      preset: { type: 'string', description: 'Registered DSH preset. Omission uses the caller composition.' },
    }, output,
    execute: (args) => {
      const fallbacks = z.array(z.object({ provider: z.string().min(1), model: z.string().min(1) })).safeParse(args.fallbacks ?? [])
      if (!fallbacks.success) throw new ToolArgsError(['fallbacks must be a list of provider/model routes.'])
      assertEmployeeRouteConfig(ctx, args.provider, args.model)
      for (const route of fallbacks.data) assertEmployeeRouteConfig(ctx, route.provider, route.model)
      if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0 || args.expectedRevision >= Number.MAX_SAFE_INTEGER) {
        throw new ToolArgsError(['expectedRevision must be a non-negative safe integer with room for the next revision.'])
      }
      if ((args.id === undefined) !== (args.expectedRevision === 0)) throw new ToolArgsError(['Creation omits id and uses revision zero.'])
      if ([args.name, args.responsibility, args.provider, args.model].some(value => !value.trim()) || args.preset?.trim() === '') {
        throw new ToolArgsError(['Employee fields must contain text.'])
      }
      if (args.id?.trim() === '') throw new ToolArgsError(['Employee id must contain text.'])
      return Promise.resolve(JSON.stringify(store.saveEmployee({
        id: brandString<EmployeeId>(args.id ?? randomUUID()), revision: args.expectedRevision + 1,
        name: args.name, responsibility: args.responsibility, provider: args.provider, model: args.model,
        ...(args.reasoningEffort === undefined ? {} : { reasoningEffort: args.reasoningEffort }),
        ...(fallbacks.data.length === 0 ? {} : { fallbacks: fallbacks.data }),
        ...(args.preset === undefined ? {} : { preset: args.preset }),
      }, args.expectedRevision)))
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'team_save',
    description: 'Save a reusable team template containing existing employee ids. Updates require its current revision from employee_list.',
    parameters: {
      id: { type: 'string', description: 'Existing team id when updating. Omit to create.' },
      expectedRevision: { type: 'integer', required: true, description: 'Zero to create, or current saved revision to update.' },
      name: { type: 'string', required: true, description: 'Team display name.' },
      memberIds: { type: 'array', required: true, items: { type: 'string' }, description: 'Distinct saved employee ids, at least one.' },
    }, output,
    execute: (args) => {
      if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0 || args.expectedRevision >= Number.MAX_SAFE_INTEGER) {
        throw new ToolArgsError(['expectedRevision must be a non-negative safe integer with room for the next revision.'])
      }
      if ((args.id === undefined) !== (args.expectedRevision === 0) || !args.name.trim()
        || args.id?.trim() === '' || args.memberIds.some(id => !id.trim())
        || args.memberIds.length === 0 || new Set(args.memberIds).size !== args.memberIds.length) {
        throw new ToolArgsError(['Provide a team name, distinct members, and the current revision for updates.'])
      }
      return Promise.resolve(JSON.stringify(store.saveTeam({
        id: brandString<ProjectTeamId>(args.id ?? randomUUID()), revision: args.expectedRevision + 1,
        name: args.name, memberIds: args.memberIds.map(id => brandString<EmployeeId>(id)),
      }, args.expectedRevision)))
    },
  })))
}
