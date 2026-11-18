/** Session-associated plan exports and files observed during independent review. */
import type { ProjectPlan, AcceptanceReport } from '@deepseek-ai/dsh-meeting-room/types'
import type { ProjectCheckpoint } from './ProjectPage.tsx'

/** One task's latest independently observed artifact version. */
export interface SessionArtifact {
  readonly projectId: string
  readonly checkpoint: number
  readonly path: string
  readonly sha256: string
  readonly role: string | undefined
  readonly state: string
}

/**
 * Select this main conversation's latest content revision for each plan.
 * @param sessionId - Exact displayed conversation.
 * @param plans - Host-owned plan versions.
 * @param records - Host-owned execution associations for legacy plans.
 * @returns Latest revisions belonging to this conversation only.
 */
export function sessionPlans(sessionId: string, plans: readonly ProjectPlan[], records: readonly ProjectCheckpoint[]): ProjectPlan[] {
  const latest = new Map<string, ProjectPlan>()
  for (const plan of plans) {
    const owner = plan.originSessionId ?? records.find(record => record.projectId === plan.executionId)?.sessionId
    if (owner !== sessionId) continue
    const previous = latest.get(plan.id)
    if (!previous || previous.revision < plan.revision) latest.set(plan.id, plan)
  }
  return [...latest.values()]
}

/**
 * List observed files from the latest report for each executed task, without inferring paths from prose.
 * @param sessionId - Exact displayed main conversation.
 * @param records - Persisted execution checkpoints, including artifact reports.
 * @returns Observed paths and hashes; these observations do not verify current disk contents.
 */
export function sessionArtifacts(sessionId: string, records: readonly ProjectCheckpoint[]): SessionArtifact[] {
  const latest = new Map<string, ProjectCheckpoint & { report: AcceptanceReport; index: number }>()
  for (const record of records) {
    if (record.sessionId !== sessionId || !record.report || record.index === undefined) continue
    const key = `${record.projectId}:${record.index}`
    if ((latest.get(key)?.checkpoint ?? -1) < record.checkpoint) latest.set(key, { ...record, report: record.report, index: record.index })
  }
  return [...latest.values()].flatMap(record => record.report.artifacts.map(artifact => ({
    projectId: record.projectId, checkpoint: record.checkpoint, path: artifact.path, sha256: artifact.sha256,
    role: record.role ?? records.find(item => item.projectId === record.projectId && item.tasks)?.tasks?.[record.index]?.role,
    state: record.state,
  })))
}

/**
 * Read the filename of an associated disk document without inventing a file for legacy plans.
 * @param plan - Exact saved plan snapshot.
 * @returns Existing document filename, or undefined when no file is associated.
 */
export function planFileName(plan: ProjectPlan): string | undefined {
  return plan.document?.path.replaceAll('\\', '/').split('/').at(-1)
}
