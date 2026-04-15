/**
 * cli/src/lib/shot-state-machine.ts
 *
 * Pure state-transition functions for the per-shot video generation lifecycle.
 * Contains NO I/O — all reads/writes are handled by StatusFileManager.
 *
 * Spec: openspec/changes/filmb-ai-p/specs/shot-state-machine/spec.md
 * Beads: bd-b3e9 (Phase 3 — WS-2)
 *
 * Six states: pending, generating, complete, approved, rejected, failed
 *
 * Valid transitions:
 *   pending      → generating    (event: SUBMIT)
 *   generating   → complete      (event: COMPLETE)
 *   generating   → failed        (event: FAIL)     → auto-appends pending
 *   complete     → approved      (event: APPROVE)
 *   complete     → rejected      (event: REJECT)   → auto-appends pending
 *   approved     → pending       (event: REOPEN)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShotStatus =
  | 'pending'
  | 'generating'
  | 'complete'
  | 'approved'
  | 'rejected'
  | 'failed';

export type ShotEvent =
  | 'SUBMIT'
  | 'COMPLETE'
  | 'FAIL'
  | 'APPROVE'
  | 'REJECT'
  | 'REOPEN';

/** A single record appended to 08-video-status.jsonl. */
export interface VideoStatusRecord {
  shot_id:          string;
  status:           ShotStatus;
  provider:         string | null;
  provider_job_id:  string | null;
  clip_path:        string | null;
  attempt_count:    number;
  rejection_reason: string | null;
  approved_at:      string | null;
  rejected_at:      string | null;
  generated_at:     string | null;
  failed_at:        string | null;
  credits_spent:    number;
  updated_at:       string;
}

/** Payload supplied alongside a transition event. */
export interface TransitionPayload {
  provider?:        string;
  provider_job_id?: string;
  clip_path?:       string;
  rejection_reason?: string;
  credits_charged?: number;
  now?:             string;   // ISO8601 override for testing; defaults to new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Valid transition table
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Readonly<Record<ShotStatus, ReadonlyArray<ShotEvent>>> = {
  pending:    ['SUBMIT'],
  generating: ['COMPLETE', 'FAIL'],
  complete:   ['APPROVE', 'REJECT'],
  approved:   ['REOPEN'],
  rejected:   [],   // transient — system auto-resets to pending
  failed:     [],   // transient — system auto-resets to pending
};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Thrown when a transition is invalid per the state machine. */
export class StateConflictError extends Error {
  constructor(
    public readonly shotId: string,
    public readonly fromStatus: ShotStatus,
    public readonly event: ShotEvent,
  ) {
    super(
      `State conflict for shot "${shotId}": cannot apply event "${event}" in state "${fromStatus}".`,
    );
    this.name = 'StateConflictError';
  }
}

// ---------------------------------------------------------------------------
// Public API — pure functions (no I/O)
// ---------------------------------------------------------------------------

/**
 * Validate that `event` is legal from `fromStatus`.
 * Throws StateConflictError for invalid transitions (exit code 5 per spec).
 */
export function validateTransition(
  shotId: string,
  fromStatus: ShotStatus,
  event: ShotEvent,
): void {
  const allowed = VALID_TRANSITIONS[fromStatus];
  if (!allowed.includes(event)) {
    throw new StateConflictError(shotId, fromStatus, event);
  }
}

/**
 * Compute the new record(s) to append to 08-video-status.jsonl for a transition.
 *
 * Returns 1 record for most transitions.
 * Returns 2 records for FAIL (failed → pending) and REJECT (rejected → pending)
 * because these are "transient" states that immediately revert to pending.
 *
 * Does NOT write to disk — caller (StatusFileManager) appends the records.
 */
export function transition(
  current: VideoStatusRecord,
  event: ShotEvent,
  payload: TransitionPayload = {},
): VideoStatusRecord[] {
  validateTransition(current.shot_id, current.status, event);

  const now = payload.now ?? new Date().toISOString();
  const base: VideoStatusRecord = {
    ...current,
    provider:         payload.provider         ?? current.provider,
    provider_job_id:  payload.provider_job_id  ?? current.provider_job_id,
    clip_path:        payload.clip_path        ?? current.clip_path,
    rejection_reason: payload.rejection_reason ?? null,
    approved_at:      null,
    rejected_at:      null,
    generated_at:     null,
    failed_at:        null,
    updated_at:       now,
  };

  switch (event) {
    case 'SUBMIT':
      return [{
        ...base,
        status:           'generating',
        provider:         payload.provider ?? null,
        provider_job_id:  payload.provider_job_id ?? null,
        // credits_spent is incremented at SUBMIT time (charge occurs on submission)
        credits_spent:    current.credits_spent + (payload.credits_charged ?? 0),
        attempt_count:    current.attempt_count + 1,
      }];

    case 'COMPLETE':
      return [{
        ...base,
        status:       'complete',
        clip_path:    payload.clip_path ?? current.clip_path,
        generated_at: now,
        credits_spent: current.credits_spent,
      }];

    case 'FAIL': {
      const failedRecord: VideoStatusRecord = {
        ...base,
        status:    'failed',
        failed_at: now,
      };
      const pendingRecord: VideoStatusRecord = {
        ...base,
        status:           'pending',
        provider:         null,
        provider_job_id:  null,
        clip_path:        current.clip_path,  // preserve existing clip
        failed_at:        null,
        updated_at:       now,
      };
      return [failedRecord, pendingRecord];
    }

    case 'APPROVE':
      return [{
        ...base,
        status:      'approved',
        approved_at: now,
      }];

    case 'REJECT': {
      const rejectedRecord: VideoStatusRecord = {
        ...base,
        status:           'rejected',
        rejection_reason: payload.rejection_reason ?? null,
        rejected_at:      now,
      };
      const pendingRecord: VideoStatusRecord = {
        ...base,
        status:           'pending',
        provider:         null,
        provider_job_id:  null,
        clip_path:        null,  // clip_path cleared; archived clip kept by StatusFileManager
        rejection_reason: null,
        rejected_at:      null,
        updated_at:       now,
      };
      return [rejectedRecord, pendingRecord];
    }

    case 'REOPEN':
      return [{
        ...base,
        status:          'pending',
        provider:         null,
        provider_job_id:  null,
        clip_path:        null,  // archived by caller before REOPEN
        approved_at:      null,
        updated_at:       now,
      }];
  }
}
