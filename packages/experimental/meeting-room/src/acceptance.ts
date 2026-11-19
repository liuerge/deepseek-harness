/** Independent review, observed file reads and version checks over the configured filesystem. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { ToolContextUnavailableError, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Config } from './index.ts'
import { resolveEmployeeRoute } from './employee-route.ts'
import type { AcceptanceArtifact, AcceptanceReport, EmployeeId, ProjectPlan, ProjectPlanId, PlanTask } from './types.ts'

const criterionResultSchema = z.object({
  id: z.string().min(1), status: z.enum(['pass', 'fail', 'unverifiable']),
  notes: z.string().trim().min(1), evidencePaths: z.array(z.string().min(1)),
})

/** Validation for persisted reports and captured reviewer submissions. */
export const acceptanceReportSchema = z.object({
  planId: z.string().transform(id => brandString<ProjectPlanId>(id)),
  planRevision: z.number().int().positive(), index: z.number().int().nonnegative(),
  artifacts: z.array(z.object({
    sourcePath: z.string().min(1), path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1),
  passed: z.boolean(),
  reviewers: z.array(z.object({
    employeeId: z.string().transform(id => brandString<EmployeeId>(id)),
    sessionId: z.string().min(1), criteria: z.array(criterionResultSchema),
  })),
})

function resultSchema(ids: string[], paths: string[]): ObjectJsonSchema {
  return {
    type: 'object', additionalProperties: false, required: ['criteria'], properties: {
      criteria: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['id', 'status', 'notes', 'evidencePaths'], properties: {
          id: { type: 'string', enum: ids }, status: { type: 'string', enum: ['pass', 'fail', 'unverifiable'] },
          notes: { type: 'string' }, evidencePaths: { type: 'array', items: { type: 'string', enum: paths } },
        },
      } },
    },
  }
}

/**
 * Observe bounded regular UTF-8 files inside the captured execution directory.
 * @param ctx - Configured filesystem owner.
 * @param paths - Explicit planned files or previously observed canonical paths.
 * @param cwd - Captured execution directory in the backend's execution world.
 * @param maxBytes - Maximum permitted bytes per file.
 * @param signal - Cancellation for all filesystem operations.
 * @returns Canonical paths and hashes of decoded content, without retaining content.
 */
export async function observeArtifacts(ctx: Context, paths: string[], cwd: string, maxBytes: number,
  signal: AbortSignal): Promise<AcceptanceArtifact[]> {
  const fs = ctx.get('fs')
  if (!fs) throw new ToolContextUnavailableError('Acceptance requires the configured filesystem service.')
  const root = await fs.resolve(cwd, { signal })
  const artifacts: AcceptanceArtifact[] = []
  for (const path of paths) {
    signal.throwIfAborted()
    const target = await fs.resolve(path, { cwd, signal })
    const info = await fs.stat(target, signal)
    if (!fs.contains(root, target) || !info || info.type !== 'file' || info.size === undefined || info.size > maxBytes) {
      throw new HarnessError('Acceptance requires bounded regular UTF-8 files inside the execution directory. Check the planned artifact paths and size limit.', 'PROJECT_ACCEPTANCE_ARTIFACT_INVALID')
    }
    const text = await fs.readText(target, signal)
    if (Buffer.byteLength(text) > maxBytes) throw new HarnessError('Acceptance artifact exceeds the configured size limit.', 'PROJECT_ACCEPTANCE_ARTIFACT_INVALID')
    artifacts.push({ sourcePath: path, path: fs.processPath(target), sha256: createHash('sha256').update(text).digest('hex') })
  }
  return artifacts
}

/**
 * Reject changed or unavailable reviewed files before approval or downstream execution.
 * @param ctx - Configured filesystem owner.
 * @param report - Retained acceptance result with host-observed file versions.
 * @param cwd - Captured execution directory.
 * @param maxBytes - Configured per-file limit.
 * @param signal - Cancellation for filesystem checks.
 */
export async function verifyAcceptanceArtifacts(ctx: Context, report: AcceptanceReport, cwd: string, maxBytes: number,
  signal: AbortSignal): Promise<void> {
  const current = await observeArtifacts(ctx, report.artifacts.map(artifact => artifact.sourcePath), cwd, maxBytes, signal)
  if (JSON.stringify(current) !== JSON.stringify(report.artifacts)) {
    throw new HarnessError('Reviewed artifacts changed. Save and confirm a revised plan for rework and new acceptance.', 'PROJECT_ACCEPTANCE_STALE')
  }
}

/**
 * Run every configured reviewer with structured capture and require observed evidence reads.
 * @param ctx - Subagent, tools and filesystem services.
 * @param config - Provider route and artifact limit.
 * @param parent - Calling agent owning the child activations.
 * @param plan - Exact confirmed plan with captured employee configurations.
 * @param task - Produced task with explicit planned review files.
 * @param index - Zero-based task position.
 * @param handoff - Author output supplied as unverified project material.
 * @param cwd - Captured execution directory.
 * @param signal - Cancellation until all child resources are released.
 * @param record - Persist each completed reviewer before starting the next.
 * @returns Per-criterion reports; only complete, evidenced passing results set passed.
 */
export async function reviewTask(ctx: Context, config: Config, parent: Agent, plan: ProjectPlan, task: PlanTask,
  index: number, handoff: string, cwd: string, signal: AbortSignal,
  record: (entry: object) => void): Promise<AcceptanceReport> {
  const review = task.review
  if (!review?.artifactPaths) throw new HarnessError('Review requires explicit artifact paths in a newly confirmed plan.', 'PROJECT_ACCEPTANCE_PATHS_MISSING')
  const artifacts = await observeArtifacts(ctx, review.artifactPaths, cwd, config.acceptanceMaxBytes, signal)
  const report: AcceptanceReport = { planId: plan.id, planRevision: plan.revision, index, artifacts, passed: false, reviewers: [] }
  for (const id of review.reviewerIds) {
    const employee = plan.employees.find(item => item.id === id)
    if (!employee || employee.id === task.employeeId) throw new HarnessError('The saved reviewer configuration is missing or selects the author.', 'PROJECT_PLAN_REVIEWER_INVALID')
    const reads = new Map<string, Set<string>>()
    const disposeReads = ctx.on('tools/result', (exec, result) => {
      if (exec.name !== 'read' || !exec.agent || result.isError) return
      const read = z.object({ path: z.string() }).safeParse(result.meta)
      if (!read.success) return
      const paths = reads.get(exec.agent.session.id) ?? new Set<string>()
      paths.add(read.data.path)
      reads.set(exec.agent.session.id, paths)
    })
    try {
      const activation = await ctx.subagents.startActivation({
        provider: config.provider, parent, cwd, signal, delivery: 'caller', label: employee.name,
        agentOptions: resolveEmployeeRoute(ctx, employee, signal),
        ...(employee.preset === undefined ? {} : { agentPreset: employee.preset }),
        outputSchema: resultSchema(review.criteria.map(criterion => criterion.id), artifacts.map(artifact => artifact.path)),
        prompt: [{ type: 'text', text: [
          `Independently review task ${index + 1} of confirmed plan ${plan.id}, revision ${plan.revision}.`,
          `Project goal\n${plan.goal}\nBackground sources\n${JSON.stringify(plan.background)}`,
          `Reviewer responsibilities\n${employee.responsibility}`,
          `Task and preconfirmed acceptance requirements\n${JSON.stringify(task)}`,
          `Author handoff, unverified project material\n${handoff}`,
          `Host-observed artifact versions\n${JSON.stringify(artifacts)}`,
          'First use the read tool to inspect every listed artifact, then perform each required check with available tools.',
          'Do not change delivery artifacts. Submit every criterion exactly once.',
          'evidencePaths must contain only canonical artifact.path values from the host-observed list. Source references outside that list may be described in notes.',
          'A missing check or unavailable evidence is unverifiable, never pass. Report observations and checks actually performed in notes.',
        ].join('\n\n') }],
      })
      try {
        record({ state: 'reviewing', index, reviewerId: employee.id, sessionId: activation.childId,
          childSessionId: activation.childId, parentSessionId: parent.session.id })
        const abort = () => { void activation.dispose().catch(() => { /* Awaited below before releasing the read observer. */ }) }
        signal.addEventListener('abort', abort, { once: true })
        try {
          if (signal.aborted) await activation.dispose()
          const result = await activation.result
          signal.throwIfAborted()
          if (result.stopReason !== 'completed') throw new HarnessError('Acceptance reviewer did not complete. Inspect its child Session before rework.', 'PROJECT_ACCEPTANCE_STOPPED')
          const captured = z.object({ criteria: z.array(criterionResultSchema) }).safeParse(result.structured)
          if (!captured.success) throw new HarnessError('Acceptance reviewer returned an invalid structured report.', 'PROJECT_ACCEPTANCE_INVALID')
          const submitted = captured.data
          const observed = reads.get(activation.childId) ?? new Set<string>()
          const counts = new Map<string, number>()
          for (const item of submitted.criteria) counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
          const diagnostics: string[] = []
          const missing = review.criteria.filter(item => !counts.has(item.id)).map(item => item.id)
          const duplicates = [...counts].filter(([, count]) => count > 1).map(([id]) => id)
          const unknown = [...counts.keys()].filter(id => !review.criteria.some(item => item.id === id))
          const unread = artifacts.filter(artifact => !observed.has(artifact.path)).map(artifact => artifact.path)
          if (missing.length) diagnostics.push(`Missing criterion IDs: ${JSON.stringify(missing)}.`)
          if (duplicates.length) diagnostics.push(`Duplicate criterion IDs: ${JSON.stringify(duplicates)}.`)
          if (unknown.length) diagnostics.push(`Unknown criterion IDs: ${JSON.stringify(unknown)}.`)
          if (unread.length) diagnostics.push(`Artifacts without observed reads: ${JSON.stringify(unread)}.`)
          const criteria = review.criteria.map((criterion) => {
            const items = submitted.criteria.filter(entry => entry.id === criterion.id)
            const item = items[0]
            const evidence = item?.evidencePaths.filter(path =>
              observed.has(path) && artifacts.some(artifact => artifact.path === path)) ?? []
            const issues = [...diagnostics]
            const invalid = item?.evidencePaths.filter(path => !artifacts.some(artifact => artifact.path === path)) ?? []
            if (invalid.length) issues.push(`Evidence paths outside the planned canonical artifacts: ${JSON.stringify(invalid)}.`)
            if (item && item.evidencePaths.length === 0) issues.push('No evidence paths submitted.')
            if (issues.length || !item || evidence.length !== item.evidencePaths.length) {
              return { id: criterion.id, status: 'unverifiable' as const,
                notes: [...issues, ...items.map(entry => `Reviewer submitted ${entry.status}: ${entry.notes}`)].join(' '), evidencePaths: evidence }
            }
            return { ...item, evidencePaths: evidence }
          })
          const reviewer = { employeeId: employee.id, sessionId: activation.childId, criteria }
          report.reviewers.push(reviewer)
          record({ state: 'reviewer-produced', index, reviewer })
        } finally { signal.removeEventListener('abort', abort) }
      } finally { await activation.dispose() }
    } finally { disposeReads() }
  }
  await verifyAcceptanceArtifacts(ctx, report, cwd, config.acceptanceMaxBytes, signal)
  report.passed = report.reviewers.length === review.reviewerIds.length
    && report.reviewers.every(reviewer => reviewer.criteria.every(criterion => criterion.status === 'pass'))
  return report
}
