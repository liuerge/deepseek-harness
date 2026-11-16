/** Durable execution fields consumed by continuation and the authenticated dashboard. */
import { z } from 'zod'
import { acceptanceReportSchema } from './acceptance.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ProjectExecutionId, ProjectPlanId } from './types.ts'

/** Older records omit resume fields and remain readable but cannot resume. */
export const executionCheckpointSchema = z.object({
  projectId: z.string().transform(id => brandString<ProjectExecutionId>(id)), state: z.string(),
  goal: z.string().optional(), handoff: z.string().optional(), index: z.number().int().nonnegative().optional(),
  role: z.string().optional(), cwd: z.string().optional(),
  rework: z.object({ attempt: z.number().int().nonnegative(), maxAttempts: z.number().int().positive(),
    sourceCheckpoint: z.number().int().positive().optional() }).optional(),
  childSessionId: z.string().optional(), parentSessionId: z.string().optional(),
  planId: z.string().transform(id => brandString<ProjectPlanId>(id)).optional(),
  planRevision: z.number().int().positive().optional(), report: acceptanceReportSchema.optional(),
  tasks: z.array(z.object({ role: z.string(), instruction: z.string(), acceptance: z.string() })).optional(),
})

/** Parsed execution checkpoint with its compare-and-swap sequence. */
export type ExecutionCheckpoint = z.infer<typeof executionCheckpointSchema> & { checkpoint: number; sessionId: string }
