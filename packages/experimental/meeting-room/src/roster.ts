/** Validation of durable roster JSON and model-supplied roster changes. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { EmployeeId, ProjectTeamId } from './types.ts'

/** Saved employee JSON validation, including its model and optional preset. */
export const employeeSchema = z.object({
  id: z.string().min(1).transform(id => brandString<EmployeeId>(id)),
  revision: z.number().int().positive(),
  name: z.string().trim().min(1),
  responsibility: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
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
