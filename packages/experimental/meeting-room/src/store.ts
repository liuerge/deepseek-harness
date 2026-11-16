/** SQLite project and meeting business records associated with durable Sessions. */
import { DatabaseSync } from 'node:sqlite'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { employeeSchema, teamSchema } from './roster.ts'
import type { Employee, EmployeeId, ProjectTeam, ProjectTeamId, ProjectPlan, ProjectPlanId, ProjectExecutionId, MeetingRecord } from './types.ts'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { projectPlanSchema } from './plans.ts'
import { executionCheckpointSchema, type ExecutionCheckpoint } from './checkpoints.ts'

const SCHEMA_VERSION = 4

/** One stored round pointing back at the child Session that produced it. */
export interface StoredRound {
  /** Zero-based round position within the meeting. */
  readonly index: number
  /** Role display name that answered. */
  readonly role: string
  /** Child Session holding the request and answer. */
  readonly childSessionId: string
  /** Terminal reason the child round settled. */
  readonly stopReason: string
}

/**
 * Session logs retain full conversations and tool traces. This store owns project
 * plans, execution checkpoints, meeting associations, captured outputs and conclusions.
 */
export class MeetingStore {
  private readonly db: DatabaseSync

  /** @param path - SQLite file path, or `:memory:` for a throwaway store. */
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.['user_version'])
    if (version > SCHEMA_VERSION) {
      this.db.close()
      throw new HarnessError('The project database requires a newer application version.', 'PROJECT_SCHEMA_UNSUPPORTED')
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        requirement TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rounds (
        meeting_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        role TEXT NOT NULL,
        child_session_id TEXT NOT NULL,
        stop_reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (meeting_id, idx)
      );
      CREATE TABLE IF NOT EXISTS project_records (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        record TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meeting_links (
        meeting_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        origin_session_id TEXT NOT NULL,
        state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meeting_outputs (
        meeting_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        output TEXT NOT NULL,
        PRIMARY KEY (meeting_id, idx)
      );
      CREATE TABLE IF NOT EXISTS meeting_decisions (
        meeting_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        summary TEXT NOT NULL,
        actions TEXT NOT NULL,
        PRIMARY KEY (meeting_id, revision)
      );
      CREATE TABLE IF NOT EXISTS project_roster (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        record TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE TABLE IF NOT EXISTS project_plan_versions (
        id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        record TEXT NOT NULL,
        PRIMARY KEY (id, revision)
      );
      CREATE TABLE IF NOT EXISTS project_plan_confirmations (
        id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        confirmed_at INTEGER NOT NULL,
        PRIMARY KEY (id, revision)
      );
      CREATE TABLE IF NOT EXISTS project_plan_runs (
        id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        PRIMARY KEY (id, revision)
      );
    `)
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }

  /**
   * Read all retained plan versions and their user confirmation state.
   * @returns Plans ordered by insertion, retaining superseded generations.
   */
  plans(): ProjectPlan[] {
    return this.withPlanStorage(() => this.db.prepare(`SELECT v.record, c.confirmed_at, r.project_id FROM project_plan_versions v
      LEFT JOIN project_plan_confirmations c ON c.id = v.id AND c.revision = v.revision
      LEFT JOIN project_plan_runs r ON r.id = v.id AND r.revision = v.revision
      ORDER BY v.rowid`).all().map(row => ({
      ...projectPlanSchema.parse(JSON.parse(String(row['record']))), confirmed: row['confirmed_at'] !== null,
      ...(row['project_id'] === null ? {} : { executionId: brandString<ProjectExecutionId>(String(row['project_id'])) }),
    })))
  }

  /**
   * Append an immutable draft, rejecting concurrent changes to the same plan.
   * @param plan - Complete draft with captured employee and team revisions.
   * @param expectedRevision - Zero for creation or the current content revision.
   * @returns The saved unconfirmed draft.
   */
  savePlan(plan: ProjectPlan, expectedRevision: number): ProjectPlan {
    if (plan.confirmed || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || !Number.isSafeInteger(plan.revision) || plan.revision !== expectedRevision + 1) {
      throw new HarnessError('Save an unconfirmed draft at the next revision.', 'PROJECT_PLAN_REVISION_INVALID')
    }
    const validated = projectPlanSchema.parse(plan)
    const employeeIds = new Set(validated.employees.map(employee => employee.id))
    if (validated.tasks.some(task => !employeeIds.has(task.employeeId) || !validated.team.memberIds.includes(task.employeeId))) {
      throw new HarnessError('Every plan task must select a captured employee in its team.', 'PROJECT_PLAN_EMPLOYEE_MISSING')
    }
    if (validated.tasks.some(task => task.review?.reviewerIds.some(id =>
      id === task.employeeId || !employeeIds.has(id) || !validated.team.memberIds.includes(id)))) {
      throw new HarnessError('Reviewers must be captured team members distinct from the task author.', 'PROJECT_PLAN_REVIEWER_INVALID')
    }
    const result = this.withPlanStorage(() => this.db.prepare(`INSERT INTO project_plan_versions (id, revision, record)
      SELECT ?, ?, ? WHERE COALESCE((SELECT MAX(revision) FROM project_plan_versions WHERE id = ?), 0) = ?`)
      .run(validated.id, validated.revision, JSON.stringify(validated), validated.id, expectedRevision))
    if (result.changes !== 1) throw new HarnessError('Plan changed. Read the current version before saving.', 'PROJECT_PLAN_STALE')
    return validated
  }

  /**
   * Persist a user confirmation only for the latest saved content revision.
   * @param id - Plan shown to the user.
   * @param revision - Exact revision reviewed by the user.
   * @returns Confirmed plan; repeated confirmation of the current revision is idempotent.
   */
  confirmPlan(id: ProjectPlanId, revision: number): ProjectPlan {
    const plan = this.currentPlan(id, revision)
    this.withPlanStorage(() => this.db.prepare(`INSERT OR IGNORE INTO project_plan_confirmations (id, revision, confirmed_at)
      SELECT ?, ?, ? WHERE (SELECT MAX(revision) FROM project_plan_versions WHERE id = ?) = ?`)
      .run(id, revision, Date.now(), id, revision))
    return this.currentPlan(plan.id, plan.revision, true)
  }

  /**
   * Resolve an exact latest plan revision, optionally requiring user confirmation.
   * @param id - Plan identity.
   * @param revision - Expected latest revision.
   * @param requireConfirmed - Require saved confirmation before returning.
   * @returns Exact saved plan with its captured configuration.
   */
  currentPlan(id: ProjectPlanId, revision: number, requireConfirmed = false): ProjectPlan {
    const latest = this.plans().filter(plan => plan.id === id).at(-1)
    if (!latest || latest.revision !== revision) throw new HarnessError('The current plan revision differs or is missing.', 'PROJECT_PLAN_STALE')
    if (requireConfirmed && !latest.confirmed) throw new HarnessError('Confirm this plan revision in the project workspace before running it.', 'PROJECT_PLAN_UNCONFIRMED')
    return latest
  }

  /**
   * Reserve one execution of a confirmed latest plan, atomically rechecking confirmation and revision.
   * @param id - Approved plan identity.
   * @param revision - Approved content revision.
   * @param projectId - Execution identity saved with its checkpoints.
   */
  claimPlanRun(id: ProjectPlanId, revision: number, projectId: ProjectExecutionId): void {
    const result = this.withPlanStorage(() => this.db.prepare(`INSERT OR IGNORE INTO project_plan_runs (id, revision, project_id)
      SELECT ?, ?, ? WHERE (SELECT MAX(revision) FROM project_plan_versions WHERE id = ?) = ?
      AND EXISTS (SELECT 1 FROM project_plan_confirmations WHERE id = ? AND revision = ?)`)
      .run(id, revision, projectId, id, revision, id, revision))
    if (result.changes !== 1) {
      throw new HarnessError('Plan revision was changed, is unconfirmed, or already started. Inspect its execution before retrying.', 'PROJECT_PLAN_NOT_RUNNABLE')
    }
  }

  private withPlanStorage<T>(operation: () => T): T {
    try {
      return operation()
    } catch (cause) {
      if (cause instanceof HarnessError) throw cause
      throw new HarnessError('Plan storage failed. Read the saved plan and execution state before retrying.', 'PROJECT_PLAN_STORAGE_FAILED', { cause })
    }
  }

  /**
   * Read saved employee configurations in creation order.
   * @returns Validated employee records.
   */
  employees(): Employee[] {
    return this.rosterRecords('employee').map(record => employeeSchema.parse(JSON.parse(record)))
  }

  /**
   * Read saved team templates in creation order.
   * @returns Validated team records.
   */
  teams(): ProjectTeam[] {
    return this.rosterRecords('team').map(record => teamSchema.parse(JSON.parse(record)))
  }

  /**
   * Create or replace an employee with optimistic concurrency.
   * @param employee - Complete next record; revision is one above the expected revision.
   * @param expectedRevision - Zero for creation, otherwise the last observed revision.
   * @returns The saved employee.
   */
  saveEmployee(employee: Employee, expectedRevision: number): Employee {
    const validated = employeeSchema.parse(employee)
    this.saveRoster('employee', validated.id, validated.revision, expectedRevision, JSON.stringify(validated))
    return validated
  }

  /**
   * Save a team whose members already exist in this roster.
   * @param team - Complete next record.
   * @param expectedRevision - Zero for creation, otherwise the last observed revision.
   * @returns The saved team.
   */
  saveTeam(team: ProjectTeam, expectedRevision: number): ProjectTeam {
    const validated = teamSchema.parse(team)
    const members = new Set(this.employees().map(employee => employee.id))
    if (validated.memberIds.some(id => !members.has(id))) {
      throw new HarnessError('A team member is missing from the employee roster.', 'PROJECT_EMPLOYEE_MISSING')
    }
    this.saveRoster('team', validated.id, validated.revision, expectedRevision, JSON.stringify(validated))
    return validated
  }

  private rosterRecords(kind: 'employee' | 'team'): string[] {
    return this.db.prepare('SELECT record FROM project_roster WHERE kind = ? ORDER BY rowid').all(kind)
      .map(row => String(row['record']))
  }

  private saveRoster(kind: 'employee' | 'team', id: EmployeeId | ProjectTeamId,
    revision: number, expectedRevision: number, record: string): void {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || revision !== expectedRevision + 1) {
      throw new HarnessError('The roster revision must advance by one.', 'PROJECT_ROSTER_REVISION_INVALID')
    }
    try {
      const result = expectedRevision === 0
        ? this.db.prepare('INSERT OR IGNORE INTO project_roster (kind, id, revision, record) VALUES (?, ?, ?, ?)')
          .run(kind, id, revision, record)
        : this.db.prepare('UPDATE project_roster SET revision = ?, record = ? WHERE kind = ? AND id = ? AND revision = ?')
          .run(revision, record, kind, id, expectedRevision)
      if (result.changes !== 1) throw new HarnessError('Roster changed. Read the latest record before saving again.', 'PROJECT_ROSTER_STALE')
    } catch (cause) {
      if (cause instanceof HarnessError) throw cause
      throw new HarnessError('The roster could not be saved.', 'PROJECT_ROSTER_PERSISTENCE_FAILED', { cause })
    }
  }

  /**
   * Append an execution checkpoint before returning control to its caller.
   * @param sessionId - Owning caller Session.
   * @param record - JSON execution record, including the project id.
   */
  recordProject(sessionId: string, record: string): void {
    try {
      this.db.prepare('INSERT INTO project_records (session_id, record) VALUES (?, ?)').run(sessionId, record)
    } catch (cause) {
      throw new HarnessError('Project checkpoint persistence failed. Inspect the child session before retrying work.', 'PROJECT_PERSISTENCE_FAILED', { cause })
    }
  }

  /**
   * Read one execution across caller Sessions, in durable checkpoint order.
   * @param projectId - Exact local Host execution identity.
   * @returns Parsed checkpoints with sequences used for user approval and continuation.
   */
  execution(projectId: ProjectExecutionId): ExecutionCheckpoint[] {
    return this.withPlanStorage(() => this.db.prepare(`SELECT sequence, session_id, record FROM project_records
      WHERE json_extract(record, '$.projectId') = ? ORDER BY sequence`).all(projectId).map(row => ({
      ...executionCheckpointSchema.parse(JSON.parse(String(row['record']))),
      checkpoint: Number(row['sequence']), sessionId: String(row['session_id']),
    })))
  }

  /**
   * Append a transition only if no other action has advanced this execution.
   * @param projectId - Execution identity.
   * @param checkpoint - Sequence of the exact latest reviewed checkpoint.
   * @param sessionId - Original execution owner.
   * @param entry - New state fields; execution identity is supplied by this method.
   * @param plan - Exact confirmed latest plan required by this transition.
   */
  transitionExecution(projectId: ProjectExecutionId, checkpoint: number, sessionId: string, entry: object,
    plan: Pick<ProjectPlan, 'id' | 'revision'>): void {
    const result = this.withPlanStorage(() => this.db.prepare(`INSERT INTO project_records (session_id, record)
      SELECT ?, ? WHERE (SELECT MAX(sequence) FROM project_records WHERE json_extract(record, '$.projectId') = ?) = ?
      AND (SELECT MAX(revision) FROM project_plan_versions WHERE id = ?) = ?
      AND EXISTS (SELECT 1 FROM project_plan_confirmations WHERE id = ? AND revision = ?)`)
      .run(sessionId, JSON.stringify({ ...entry, projectId }), projectId, checkpoint,
        plan.id, plan.revision, plan.id, plan.revision))
    if (result.changes !== 1) throw new HarnessError('Execution changed. Refresh its checkpoints before approval or continuation.', 'PROJECT_EXECUTION_STALE')
  }

  /**
   * Read recent execution checkpoints for the exact caller Session.
   * @param sessionId - Owning caller Session.
   * @param limit - Maximum number of records to return.
   * @returns JSON records ordered from newest to oldest.
   */
  projectRecords(sessionId: string, limit: number): string[] {
    try {
      return this.db.prepare('SELECT record FROM project_records WHERE session_id = ? ORDER BY sequence DESC LIMIT ?')
        .all(sessionId, limit).map(row => String(row['record']))
    } catch (cause) {
      throw new HarnessError('Project checkpoints could not be read.', 'PROJECT_RECORDS_UNAVAILABLE', { cause })
    }
  }

  /**
   * Read the retained project timeline for the local Host dashboard.
   * @returns Checkpoints in execution order with their owning Session.
   */
  projectTimeline(): { sessionId: string; record: string; checkpoint: number }[] {
    return this.db.prepare('SELECT session_id, record, sequence FROM project_records ORDER BY sequence')
      .all().map(row => ({ sessionId: String(row['session_id']), record: String(row['record']), checkpoint: Number(row['sequence']) }))
  }

  /**
   * Record one meeting.
   * @param id - Meeting process identity; standalone meetings also use it as their root Session id.
   * @param requirement - Shared goal every role received.
   * @param link - Main-conversation association; omitted for historical index-only callers.
   */
  recordMeeting(id: string, requirement: string, link?: { sessionId: string; originSessionId: string }): void {
    this.meetingTransaction(() => {
      this.db.prepare('INSERT INTO meetings (id, requirement, created_at) VALUES (?, ?, ?)').run(id, requirement, Date.now())
      if (link) this.db.prepare('INSERT INTO meeting_links (meeting_id, session_id, origin_session_id, state) VALUES (?, ?, ?, ?)')
        .run(id, link.sessionId, link.originSessionId, 'running')
    })
  }

  /**
   * Record one completed round.
   * @param meetingId - Meeting Session id.
   * @param round - Round data to store.
   * @param output - Participant text for linked meeting views; omitted for historical callers.
   */
  recordRound(meetingId: string, round: StoredRound, output?: string): void {
    this.meetingTransaction(() => {
      this.db.prepare('INSERT INTO rounds (meeting_id, idx, role, child_session_id, stop_reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(meetingId, round.index, round.role, round.childSessionId, round.stopReason, Date.now())
      if (output !== undefined) this.db.prepare('INSERT INTO meeting_outputs (meeting_id, idx, output) VALUES (?, ?, ?)')
        .run(meetingId, round.index, output)
    })
  }

  /**
   * Save the observed meeting outcome without inferring a main-assistant conclusion.
   * @param id - Linked meeting identity.
   * @param state - Settled discussion outcome.
   */
  settleMeeting(id: string, state: 'awaiting-decision' | 'failed' | 'interrupted'): void {
    this.meetingStorage(() => {
      const result = this.db.prepare('UPDATE meeting_links SET state = ? WHERE meeting_id = ?').run(state, id)
      if (result.changes !== 1) throw new HarnessError('Meeting association is missing.', 'MEETING_RECORD_MISSING')
    })
  }

  /**
   * Read actual meetings initiated by one exact conversation, preserving participant and decision records.
   * @param sessionId - Main conversation identity.
   * @returns Linked meetings in creation order; unlinked historical rows are not attributed.
   */
  meetingsForSession(sessionId: string): MeetingRecord[] {
    return this.meetingStorage(() => this.db.prepare(`SELECT m.*, l.session_id, l.origin_session_id, l.state FROM meetings m
      JOIN meeting_links l ON l.meeting_id = m.id WHERE l.origin_session_id = ? ORDER BY m.rowid`).all(sessionId).map((row) => {
      const id = String(row['id'])
      const decisions = this.db.prepare('SELECT revision, summary, actions FROM meeting_decisions WHERE meeting_id = ? ORDER BY revision')
        .all(id)
      return {
        id: brandString<MeetingRecord['id']>(String(row['id'])), sessionId: String(row['session_id']),
        originSessionId: String(row['origin_session_id']), requirement: String(row['requirement']), createdAt: Number(row['created_at']),
        state: z.enum(['running', 'awaiting-decision', 'decided', 'failed', 'interrupted']).parse(row['state']),
        rounds: this.roundsOf(String(row['id'])).map(round => ({ ...round,
          output: String(this.db.prepare('SELECT output FROM meeting_outputs WHERE meeting_id = ? AND idx = ?')
            .get(id, round.index)?.['output'] ?? ''),
        })),
        decisions: decisions.map(decision => ({
          revision: Number(decision['revision']), summary: String(decision['summary']),
          actions: z.array(z.string()).parse(JSON.parse(String(decision['actions']))),
        })),
      }
    }))
  }

  /**
   * Append a conclusion only from the initiating conversation after all discussion rounds complete.
   * @param sessionId - Exact calling main conversation.
   * @param id - Meeting to conclude.
   * @param expectedRevision - Zero for the first conclusion, otherwise its latest revision.
   * @param summary - Main assistant's conclusion, distinct from participant opinions.
   * @param actions - Follow-up actions to translate into confirmed project plans separately.
   * @returns New conclusion revision; prior generations remain retained.
   */
  recordMeetingDecision(sessionId: string, id: string, expectedRevision: number, summary: string, actions: string[]): number {
    return this.meetingTransaction(() => {
      const result = this.db.prepare(`INSERT INTO meeting_decisions (meeting_id, revision, summary, actions)
        SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM meeting_links WHERE meeting_id = ? AND origin_session_id = ?
          AND state IN ('awaiting-decision', 'decided'))
        AND COALESCE((SELECT MAX(revision) FROM meeting_decisions WHERE meeting_id = ?), 0) = ?`)
        .run(id, expectedRevision + 1, summary, JSON.stringify(actions), id, sessionId, id, expectedRevision)
      if (result.changes !== 1) throw new HarnessError('Meeting is unfinished, belongs to another conversation, or its conclusion changed. Read meeting_records first.', 'MEETING_DECISION_STALE')
      this.db.prepare('UPDATE meeting_links SET state = ? WHERE meeting_id = ?').run('decided', id)
      return expectedRevision + 1
    })
  }

  private meetingTransaction<T>(operation: () => T): T {
    return this.meetingStorage(() => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const result = operation()
        this.db.exec('COMMIT')
        return result
      } catch (cause) {
        try { this.db.exec('ROLLBACK') }
        catch (rollbackError) {
          throw new HarnessError('Meeting storage outcome is unknown. Inspect saved records before retrying.', 'MEETING_STORAGE_FAILED', {
            cause: new AggregateError([cause, rollbackError]),
          })
        }
        throw cause
      }
    })
  }

  private meetingStorage<T>(operation: () => T): T {
    try { return operation() }
    catch (cause) {
      if (cause instanceof HarnessError) throw cause
      throw new HarnessError('Meeting storage failed. Inspect saved records before retrying work.', 'MEETING_STORAGE_FAILED', { cause })
    }
  }

  /**
   * Read every stored round of one meeting in order.
   * @param meetingId - Meeting Session id.
   * @returns Stored rounds ordered by index.
   */
  roundsOf(meetingId: string): StoredRound[] {
    return this.db.prepare('SELECT idx, role, child_session_id, stop_reason FROM rounds WHERE meeting_id = ? ORDER BY idx')
      .all(meetingId)
      .map(row => ({
        index: Number(row['idx']),
        role: String(row['role']),
        childSessionId: String(row['child_session_id']),
        stopReason: String(row['stop_reason']),
      }))
  }

  /** Close the underlying database handle. */
  close(): void {
    this.db.close()
  }
}
