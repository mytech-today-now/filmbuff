/**
 * SessionRepository
 *
 * All database access for the `sessions` and `context_snapshots` tables.
 * Command handlers MUST use this class and never write raw SQL directly.
 *
 * Methods — sessions:
 *   recordSession(input)           — Insert a new session row (started_at = now)
 *   completeSession(id, exit, err) — Mark a session complete with exit code
 *
 * Methods — context_snapshots:
 *   recordContextSnapshot(input)   — Insert one context_snapshot row
 *   listContextSnapshots(attemptId)— Fetch all snapshots for a generation attempt
 *
 * Satisfies: bd-db-a8 buff-core.01.02.04 - Implement SessionRepository
 */

import Database from 'better-sqlite3';
import {
  DbSession,
  ContextSnapshot,
  StartSessionInput,
  ContextSnapshotInput,
} from './types.js';
import { translateSQLiteError, redactSessionFlags } from './errors.js';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// SQL — sessions
// ---------------------------------------------------------------------------

const INSERT_SESSION = `
  INSERT INTO sessions
    (id, project_id, command, flags, provider_id, profile_name, started_at)
  VALUES
    (@id, @project_id, @command, @flags, @provider_id, @profile_name, @started_at)
`;

const COMPLETE_SESSION = `
  UPDATE sessions
  SET completed_at  = @completed_at,
      exit_code     = @exit_code,
      error_message = @error_message
  WHERE id = @id
`;

const SELECT_SESSION_BY_ID = `SELECT * FROM sessions WHERE id = ?`;

// ---------------------------------------------------------------------------
// SQL — context_snapshots
// ---------------------------------------------------------------------------

const INSERT_CONTEXT_SNAPSHOT = `
  INSERT INTO context_snapshots
    (id, generation_attempt_id, context_type, source_step_name,
     content, content_hash, sequence_order, created_at)
  VALUES
    (@id, @generation_attempt_id, @context_type, @source_step_name,
     @content, @content_hash, @sequence_order, @created_at)
`;

const SELECT_SNAPSHOTS_BY_ATTEMPT = `
  SELECT * FROM context_snapshots
  WHERE generation_attempt_id = ?
  ORDER BY sequence_order ASC
`;

// ---------------------------------------------------------------------------
// Repository class
// ---------------------------------------------------------------------------

export class SessionRepository {
  constructor(private readonly db: Database.Database) {}

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /**
   * Insert a new session row. Sensitive flags are redacted before storage.
   * Returns the inserted session row.
   */
  recordSession(input: StartSessionInput): DbSession {
    const now = new Date().toISOString();
    const redactedFlags = input.flags
      ? JSON.stringify(redactSessionFlags(input.flags))
      : null;

    try {
      this.db.prepare(INSERT_SESSION).run({
        id:           input.id,
        project_id:   input.project_id   ?? null,
        command:      input.command,
        flags:        redactedFlags,
        provider_id:  input.provider_id  ?? null,
        profile_name: input.profile_name ?? null,
        started_at:   now,
      });
    } catch (err) {
      throw translateSQLiteError(err, 'sessions');
    }

    return this.db.prepare(SELECT_SESSION_BY_ID).get(input.id) as DbSession;
  }

  /**
   * Mark a session as completed, recording exit code and optional error message.
   */
  completeSession(
    id: string,
    exitCode: number,
    errorMessage?: string,
  ): void {
    const now = new Date().toISOString();
    try {
      this.db.prepare(COMPLETE_SESSION).run({
        id,
        completed_at:  now,
        exit_code:     exitCode,
        error_message: errorMessage ?? null,
      });
    } catch (err) {
      throw translateSQLiteError(err, 'sessions');
    }
  }

  // -------------------------------------------------------------------------
  // Context snapshots
  // -------------------------------------------------------------------------

  /**
   * Insert one context snapshot.  Computes content_hash from SHA-256 of content.
   * Returns the inserted ContextSnapshot row.
   */
  recordContextSnapshot(input: ContextSnapshotInput): ContextSnapshot {
    const now         = new Date().toISOString();
    const contentHash = crypto
      .createHash('sha256')
      .update(input.content)
      .digest('hex');

    try {
      this.db.prepare(INSERT_CONTEXT_SNAPSHOT).run({
        id:                    input.id,
        generation_attempt_id: input.generation_attempt_id,
        context_type:          input.context_type,
        source_step_name:      input.source_step_name ?? null,
        content:               input.content,
        content_hash:          contentHash,
        sequence_order:        input.sequence_order,
        created_at:            now,
      });
    } catch (err) {
      throw translateSQLiteError(err, 'context_snapshots');
    }

    return this.db
      .prepare('SELECT * FROM context_snapshots WHERE id = ?')
      .get(input.id) as ContextSnapshot;
  }

  /**
   * Return all context snapshots for a generation attempt, ordered by sequence.
   */
  listContextSnapshots(generationAttemptId: string): ContextSnapshot[] {
    return this.db
      .prepare(SELECT_SNAPSHOTS_BY_ATTEMPT)
      .all(generationAttemptId) as ContextSnapshot[];
  }
}

