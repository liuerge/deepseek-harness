/** Validation of durable roster JSON and model-supplied roster changes. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { EmployeeId, ProjectTeamId } from './types.ts'

/** Saved employee JSON validation, including its model, effort, backups and optional preset. */
export const modelRouteSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
})

export const employeeSchema = z.object({
  id: z.string().min(1).transform(id => brandString<EmployeeId>(id)),
  revision: z.number().int().positive(),
  name: z.string().trim().min(1),
  responsibility: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  reasoningEffort: z.string().trim().min(1).optional(),
  fallbacks: z.array(modelRouteSchema).optional(),
  preset: z.string().trim().min(1).optional(),
})

/** Saved team JSON validation; membership cannot be empty or duplicated. */
export const teamSchema = z.object({
  id: z.string().min(1).transform(id => brandString<ProjectTeamId>(id)),
  revision: z.number().int().positive(),
  name: z.string().trim().min(1),
  memberIds: z.array(z.string().min(1).transform(id => brandString<EmployeeId>(id))).min(1)
    .refine(ids => new Set(ids).size === ids.length, 'Each employee appears once.'),
})

/** Durable conversation planning defaults, including an explicit cleared preference. */
export const sessionTeamSelectionSchema = z.object({
  revision: z.number().int().positive(), team: teamSchema.nullable(), employees: z.array(employeeSchema),
}).superRefine((value, context) => {
  const members = value.team?.memberIds ?? []
  if (members.length !== value.employees.length
    || members.some((id, index) => value.employees[index]?.id !== id)) {
    context.addIssue({ code: 'custom', message: 'The selected team must capture its exact ordered membership.' })
  }
})
