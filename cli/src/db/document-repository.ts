/**
 * DocumentRepository
 *
 * All database access for `document_revisions` and `generation_attempts`.
 * Command handlers MUST use this class and never write raw SQL directly.
 *
 * Methods — generation_attempts:
 *   recordAttempt(input)          — Insert a new attempt row (status='generated')
 *   completeAttempt(id, patch)    — Mark attempt completed/error + token counts
 *   acceptAttempt(id)             — Set status='accepted', accepted_at=now
 *   rejectAttempt(id)             — Set status='rejected'
 *   getAttempt(id)                — Fetch single attempt
 *   listAttempts(projectStepId)   — List all attempts for a step
 *
 * Methods — document_revisions:
 *   saveRevision(input)           — Insert new revision, mark others non-current
 *   getCurrentRevision(stepId)    — Fetch current revision for a step
 *   listRevisions(stepId)         — All revisions for a step, newest first
 *
 * Satisfies: bd-db-a6 buff-core.01.02.02 - Implement DocumentRepository
 */

import Database from 'better-sqlite3';
import {
  GenerationAttempt,
  DocumentRevision,
  RecordAttemptInput,
  AttemptStatus,
  DocumentFormat,
} from './types.js';
import { translateSQLiteError } from './errors.js';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// SQL — generation_attempts
// ---------------------------------------------------------------------------

const INSERT_ATTEMPT = `
  INSERT INTO generation_attempts
    (id, project_step_id, attempt_number, provider_id, profile_name, model_id,
     instructions_override, detail_level, style_modules, context_document_ids,
     status, started_at)
  VALUES
    (@id, @project_step_id, @attempt_number, @provider_id, @profile_name, @model_id,
     @instructions_override, @detail_level, @style_modules, @context_document_ids,
     'generated', @now)
`;

const NEXT_ATTEMPT_NUMBER = `
  SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_num
  FROM generation_attempts
  WHERE project_step_id = ?
`;

const SELECT_ATTEMPT_BY_ID  = `SELECT * FROM generation_attempts WHERE id = ?`;
const SELECT_ATTEMPTS_STEP  = `
  SELECT * FROM generation_attempts
  WHERE project_step_id = ?
  ORDER BY attempt_number ASC
`;

const COMPLETE_ATTEMPT = `
  UPDATE generation_attempts
  SET status            = @status,
      raw_output        = COALESCE(@raw_output, raw_output),
      prompt_tokens     = COALESCE(@prompt_tokens, prompt_tokens),
      completion_tokens = COALESCE(@completion_tokens, completion_tokens),
      total_tokens      = COALESCE(@total_tokens, total_tokens),
      prompt_hash       = COALESCE(@prompt_hash, prompt_hash),
      error_message     = COALESCE(@error_message, error_message),
      completed_at      = @now
  WHERE id = @id
`;

const ACCEPT_ATTEMPT = `
  UPDATE generation_attempts SET status = 'accepted', accepted_at = @now WHERE id = @id
`;
const REJECT_ATTEMPT = `
  UPDATE generation_attempts SET status = 'rejected' WHERE id = @id
`;

// ---------------------------------------------------------------------------
// SQL — document_revisions
// ---------------------------------------------------------------------------

const MARK_ALL_NON_CURRENT = `
  UPDATE document_revisions SET is_current = 0 WHERE project_step_id = ?
`;

const NEXT_REVISION_NUMBER = `
  SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_num
  FROM document_revisions
  WHERE project_step_id = ?
`;

const INSERT_REVISION = `
  INSERT INTO document_revisions
    (id, project_step_id, generation_attempt_id, revision_number,
     content, content_hash, content_size_bytes, format,
     is_current, accepted_by, accepted_at, notes)
  VALUES
    (@id, @project_step_id, @generation_attempt_id, @revision_number,
     @content, @content_hash, @content_size_bytes, @format,
     1, @accepted_by, @now, @notes)
`;

const SELECT_CURRENT_REVISION = `
  SELECT * FROM document_revisions
  WHERE project_step_id = ? AND is_current = 1
  LIMIT 1
`;

const SELECT_REVISIONS_STEP = `
  SELECT * FROM document_revisions
  WHERE project_step_id = ?
  ORDER BY revision_number DESC
`;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CompleteAttemptPatch {
  status:              AttemptStatus;
  raw_output?:         string;
  prompt_tokens?:      number;
  completion_tokens?:  number;
  total_tokens?:       number;
  prompt_hash?:        string;
  error_message?:      string;
}

export interface SaveRevisionInput {
  id:                      string;
  project_step_id:         string;
  generation_attempt_id?:  string;
  content:                 string;
  format:                  DocumentFormat;
  accepted_by?:            string;
  notes?:                  string;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class DocumentRepository {
  constructor(private readonly db: Database.Database) {}

  // -------------------------------------------------------------------------
  // generation_attempts
  // -------------------------------------------------------------------------

  /**
   * Insert a new generation attempt for the given project step.
   * Automatically derives the next attempt_number.
   */
  recordAttempt(input: RecordAttemptInput): GenerationAttempt {
    const now = new Date().toISOString();
    const { next_num } = this.db
      .prepare(NEXT_ATTEMPT_NUMBER)
      .get(input.project_step_id) as { next_num: number };

    try {
      this.db.prepare(INSERT_ATTEMPT).run({
        ...input,
        attempt_number:       next_num,
        instructions_override: input.instructions_override ?? null,
        detail_level:          input.detail_level          ?? null,
        style_modules:         input.style_modules
                                 ? JSON.stringify(input.style_modules)
                                 : null,
        context_document_ids:  input.context_document_ids
                                 ? JSON.stringify(input.context_document_ids)
                                 : null,
        now,
      });
    } catch (err) { throw translateSQLiteError(err); }

    return this.db.prepare(SELECT_ATTEMPT_BY_ID).get(input.id) as GenerationAttempt;
  }

  completeAttempt(id: string, patch: CompleteAttemptPatch): void {
    const now = new Date().toISOString();
    try {
      this.db.prepare(COMPLETE_ATTEMPT).run({
        id,
        status:            patch.status,
        raw_output:        patch.raw_output        ?? null,
        prompt_tokens:     patch.prompt_tokens     ?? null,
        completion_tokens: patch.completion_tokens ?? null,
        total_tokens:      patch.total_tokens      ?? null,
        prompt_hash:       patch.prompt_hash       ?? null,
        error_message:     patch.error_message     ?? null,
        now,
      });
    } catch (err) { throw translateSQLiteError(err); }
  }

  acceptAttempt(id: string): void {
    const now = new Date().toISOString();
    try { this.db.prepare(ACCEPT_ATTEMPT).run({ id, now }); }
    catch (err) { throw translateSQLiteError(err); }
  }

  rejectAttempt(id: string): void {
    try { this.db.prepare(REJECT_ATTEMPT).run({ id }); }
    catch (err) { throw translateSQLiteError(err); }
  }

  getAttempt(id: string): GenerationAttempt | undefined {
    return this.db.prepare(SELECT_ATTEMPT_BY_ID).get(id) as GenerationAttempt | undefined;
  }

  listAttempts(projectStepId: string): GenerationAttempt[] {
    return this.db.prepare(SELECT_ATTEMPTS_STEP).all(projectStepId) as GenerationAttempt[];
  }

  // -------------------------------------------------------------------------
  // document_revisions
  // -------------------------------------------------------------------------

  /**
   * Save a new document revision. Marks all prior revisions for the step as
   * non-current before inserting the new row (all inside one transaction).
   */
  saveRevision(input: SaveRevisionInput): DocumentRevision {
    const now          = new Date().toISOString();
    const contentHash  = crypto.createHash('sha256').update(input.content).digest('hex');
    const sizeBytes    = Buffer.byteLength(input.content, 'utf8');

    const { next_num } = this.db
      .prepare(NEXT_REVISION_NUMBER)
      .get(input.project_step_id) as { next_num: number };

    try {
      this.db.transaction(() => {
        this.db.prepare(MARK_ALL_NON_CURRENT).run(input.project_step_id);
        this.db.prepare(INSERT_REVISION).run({
          id:                      input.id,
          project_step_id:         input.project_step_id,
          generation_attempt_id:   input.generation_attempt_id ?? null,
          revision_number:         next_num,
          content:                 input.content,
          content_hash:            contentHash,
          content_size_bytes:      sizeBytes,
          format:                  input.format,
          accepted_by:             input.accepted_by ?? null,
          notes:                   input.notes       ?? null,
          now,
        });
      })();
    } catch (err) { throw translateSQLiteError(err); }

    return this.db
      .prepare(SELECT_CURRENT_REVISION)
      .get(input.project_step_id) as DocumentRevision;
  }

  getCurrentRevision(projectStepId: string): DocumentRevision | undefined {
    return this.db
      .prepare(SELECT_CURRENT_REVISION)
      .get(projectStepId) as DocumentRevision | undefined;
  }

  listRevisions(projectStepId: string): DocumentRevision[] {
    return this.db.prepare(SELECT_REVISIONS_STEP).all(projectStepId) as DocumentRevision[];
  }
}

