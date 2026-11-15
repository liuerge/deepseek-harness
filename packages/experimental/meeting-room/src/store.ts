/** SQLite index of meeting business state: meetings and their rounds. */
import { DatabaseSync } from 'node:sqlite'

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
 * Meeting business state index. Session logs stay the source of truth for
 * conversation content; this store holds only what the log cannot query:
 * meeting identity, round order, and the child Session each round used.
 */
export class MeetingStore {
  private readonly db: DatabaseSync

  /** @param path - SQLite file path, or `:memory:` for a throwaway store. */
  constructor(path: string) {
    this.db = new DatabaseSync(path)
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
    `)
  }

  /**
   * Record one meeting.
   * @param id - Meeting Session id.
   * @param requirement - Shared goal every role received.
   */
  recordMeeting(id: string, requirement: string): void {
    this.db.prepare('INSERT INTO meetings (id, requirement, created_at) VALUES (?, ?, ?)')
      .run(id, requirement, Date.now())
  }

  /**
   * Record one completed round.
   * @param meetingId - Meeting Session id.
   * @param round - Round data to store.
   */
  recordRound(meetingId: string, round: StoredRound): void {
    this.db.prepare('INSERT INTO rounds (meeting_id, idx, role, child_session_id, stop_reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(meetingId, round.index, round.role, round.childSessionId, round.stopReason, Date.now())
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
