/** Real project plan files observed through the configured filesystem. */
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import { observeArtifacts } from './acceptance.ts'
import type { ProjectPlan } from './types.ts'

/**
 * Read a plan file within a Git project without creating files or commits.
 * @param ctx - Configured filesystem owner.
 * @param path - Existing UTF-8 plan document.
 * @param cwd - Main conversation project directory, containing a .git directory or worktree file.
 * @param maxBytes - Maximum document bytes.
 * @param signal - Filesystem cancellation.
 * @returns Canonical document reference and decoded-content SHA-256.
 */
export async function observePlanDocument(ctx: Context, path: string, cwd: string, maxBytes: number,
  signal: AbortSignal): Promise<NonNullable<ProjectPlan['document']>> {
  const root = await requireGitProject(ctx, cwd, signal)
  const [artifact] = await observeArtifacts(ctx, [path], cwd, maxBytes, signal)
  if (!artifact) throw new HarnessError('The plan document is unavailable.', 'PROJECT_PLAN_DOCUMENT_MISSING')
  return { path: artifact.path, sha256: artifact.sha256, cwd: root }
}

/**
 * Reject missing, changed or relocated plan documents before confirmation and dispatch.
 * @param ctx - Configured filesystem owner.
 * @param plan - Retained exact revision.
 * @param maxBytes - Maximum document bytes.
 * @param signal - Filesystem cancellation.
 * @param cwd - Execution directory, when dispatching workers.
 */
export async function verifyPlanDocument(ctx: Context, plan: ProjectPlan, maxBytes: number,
  signal: AbortSignal, cwd?: string): Promise<void> {
  if (!plan.document) throw new HarnessError('This retained plan has no real document. Save a revised plan linked to an existing project file before confirmation or execution.', 'PROJECT_PLAN_DOCUMENT_MISSING')
  const current = await observePlanDocument(ctx, plan.document.path, cwd ?? plan.document.cwd, maxBytes, signal)
  if (current.path !== plan.document.path || current.sha256 !== plan.document.sha256 || current.cwd !== plan.document.cwd) {
    throw new HarnessError('The plan file or project directory changed. Save and confirm a revised plan before execution.', 'PROJECT_PLAN_DOCUMENT_STALE')
  }
}

/**
 * Require a project root recognized by its Git directory or worktree marker.
 * @param ctx - Configured filesystem owner.
 * @param cwd - Selected project root.
 * @param signal - Filesystem cancellation.
 * @returns Canonical project directory.
 */
export async function requireGitProject(ctx: Context, cwd: string, signal: AbortSignal): Promise<string> {
  const fs = ctx.get('fs')
  if (!fs) throw new ToolContextUnavailableError('Project planning requires the configured filesystem service.')
  const root = await fs.resolve(cwd, { signal })
  const marker = await fs.resolve('.git', { cwd, signal })
  const info = await fs.stat(marker, signal)
  if (!info || (info.type !== 'directory' && info.type !== 'file')) {
    throw new HarnessError('Use a real Git project directory before saving or confirming the plan.', 'PROJECT_PLAN_GIT_REQUIRED')
  }
  return fs.processPath(root)
}
