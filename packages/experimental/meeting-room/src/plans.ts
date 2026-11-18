/** Plan validation shared by model input parsing and durable-record decoding. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { employeeSchema, teamSchema } from './roster.ts'
import type { EmployeeId, ProjectPlanId } from './types.ts'

/** Structured requirements retained with the exact reviewed plan generation. */
export const taskAcceptanceSchema = z.object({
  rework: z.object({ maxAttempts: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).optional(),
  reviewerIds: z.array(z.string().min(1).transform(id => brandString<EmployeeId>(id))).min(1),
  release: z.enum(['automatic', 'human']),
  artifactPaths: z.array(z.string().trim().min(1)).min(1).optional(),
  downstream: z.array(z.string().trim().min(1)),
  criteria: z.array(z.object({
    id: z.string().trim().min(1),
    description: z.string().trim().min(1),
    method: z.string().trim().min(1),
    expected: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
  })).min(1),
}).refine(review => new Set(review.reviewerIds).size === review.reviewerIds.length
  && new Set(review.criteria.map(criterion => criterion.id)).size === review.criteria.length,
'Reviewer identities and criterion references must be distinct.')

/** Ordered work item parsed from model JSON. */
export const planTaskSchema = z.object({
  role: z.string().trim().min(1),
  employeeId: z.string().min(1).transform(id => brandString<EmployeeId>(id)),
  instruction: z.string().trim().min(1),
  acceptance: z.string().trim().min(1),
  review: taskAcceptanceSchema.optional(),
})

/** Sourced background delivered as part of the logged worker request. */
export const planBackgroundSchema = z.object({
  title: z.string().trim().min(1),
  source: z.string().trim().min(1),
  content: z.string().trim().min(1),
})

/** Saved plan generation, including employee and team configuration snapshots. */
export const projectPlanSchema = z.object({
  document: z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), cwd: z.string().min(1) }).optional(),
  originSessionId: z.string().min(1).optional(),
  id: z.string().min(1).transform(id => brandString<ProjectPlanId>(id)),
  revision: z.number().int().positive(),
  goal: z.string().trim().min(1),
  background: z.array(planBackgroundSchema),
  tasks: z.array(planTaskSchema).min(1),
  team: teamSchema,
  employees: z.array(employeeSchema).min(1),
  confirmed: z.boolean(),
})
