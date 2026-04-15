/**
 * cli/src/__tests__/shot-state-machine.test.ts
 *
 * Unit tests for the shot state machine (WS-2).
 * Tests: UT-SM-01 through UT-SM-15
 *
 * Spec: openspec/changes/filmb-ai-p/specs/shot-state-machine/spec.md
 * Beads: bd-b3e9 (Phase 3 — WS-2)
 */

import {
  transition,
  validateTransition,
  StateConflictError,
  type VideoStatusRecord,
  type ShotStatus,
  type ShotEvent,
} from '../lib/shot-state-machine';

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<VideoStatusRecord> = {}): VideoStatusRecord {
  return {
    shot_id:          's001',
    status:           'pending',
    provider:         null,
    provider_job_id:  null,
    clip_path:        null,
    attempt_count:    0,
    rejection_reason: null,
    approved_at:      null,
    rejected_at:      null,
    generated_at:     null,
    failed_at:        null,
    credits_spent:    0,
    updated_at:       '2026-04-15T10:00:00Z',
    ...overrides,
  };
}

const NOW = '2026-04-15T11:00:00Z';

// ---------------------------------------------------------------------------
// UT-SM-01 — pending → generating
// ---------------------------------------------------------------------------

describe('[UT-SM-01] SUBMIT: pending → generating', () => {
  it('returns one generating record with incremented attempt_count and credits_spent', () => {
    const rec = makeRecord({ status: 'pending' });
    const result = transition(rec, 'SUBMIT', {
      provider: 'runway-gen3', provider_job_id: 'rw_job_abc', credits_charged: 5, now: NOW,
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('generating');
    expect(result[0].attempt_count).toBe(1);
    expect(result[0].credits_spent).toBe(5);
    expect(result[0].provider).toBe('runway-gen3');
    expect(result[0].provider_job_id).toBe('rw_job_abc');
    expect(result[0].updated_at).toBe(NOW);
  });
});

// ---------------------------------------------------------------------------
// UT-SM-02 — generating → complete
// ---------------------------------------------------------------------------

describe('[UT-SM-02] COMPLETE: generating → complete', () => {
  it('returns one complete record with generated_at and clip_path', () => {
    const rec = makeRecord({ status: 'generating', attempt_count: 1, credits_spent: 5 });
    const result = transition(rec, 'COMPLETE', { clip_path: 'video/clips/s001.mp4', now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('complete');
    expect(result[0].generated_at).toBe(NOW);
    expect(result[0].clip_path).toBe('video/clips/s001.mp4');
  });
});

// ---------------------------------------------------------------------------
// UT-SM-03 — generating → failed → pending (two records)
// ---------------------------------------------------------------------------

describe('[UT-SM-03] FAIL: generating → failed → pending', () => {
  it('returns two records: failed then pending', () => {
    const rec = makeRecord({ status: 'generating', attempt_count: 1, credits_spent: 5 });
    const result = transition(rec, 'FAIL', { now: NOW });
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('failed');
    expect(result[0].failed_at).toBe(NOW);
    expect(result[1].status).toBe('pending');
    expect(result[1].provider).toBeNull();
    expect(result[1].provider_job_id).toBeNull();
  });

  it('credits_spent preserved after FAIL (not decremented)', () => {
    const rec = makeRecord({ status: 'generating', credits_spent: 5 });
    const result = transition(rec, 'FAIL', { now: NOW });
    expect(result[1].credits_spent).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// UT-SM-04 — complete → approved
// ---------------------------------------------------------------------------

describe('[UT-SM-04] APPROVE: complete → approved', () => {
  it('returns one approved record with approved_at', () => {
    const rec = makeRecord({ status: 'complete', clip_path: 'video/clips/s001.mp4' });
    const result = transition(rec, 'APPROVE', { now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('approved');
    expect(result[0].approved_at).toBe(NOW);
  });
});

// ---------------------------------------------------------------------------
// UT-SM-05 — complete → rejected → pending (two records)
// ---------------------------------------------------------------------------

describe('[UT-SM-05] REJECT: complete → rejected → pending', () => {
  it('returns two records: rejected then pending', () => {
    const rec = makeRecord({ status: 'complete', clip_path: 'video/clips/s001.mp4' });
    const result = transition(rec, 'REJECT', { rejection_reason: 'Too shaky.', now: NOW });
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('rejected');
    expect(result[0].rejection_reason).toBe('Too shaky.');
    expect(result[0].rejected_at).toBe(NOW);
    expect(result[1].status).toBe('pending');
    expect(result[1].clip_path).toBeNull();
    expect(result[1].rejection_reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// UT-SM-06 — approved → pending (REOPEN)
// ---------------------------------------------------------------------------

describe('[UT-SM-06] REOPEN: approved → pending', () => {
  it('returns one pending record with clip_path cleared', () => {
    const rec = makeRecord({ status: 'approved', clip_path: 'video/clips/s001.mp4', approved_at: NOW });
    const result = transition(rec, 'REOPEN', { now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('pending');
    expect(result[0].clip_path).toBeNull();
    expect(result[0].approved_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// UT-SM-07 through UT-SM-10 — invalid transitions throw StateConflictError
// ---------------------------------------------------------------------------

describe('[UT-SM-07] Invalid transitions throw StateConflictError', () => {
  const invalidCases: [ShotStatus, ShotEvent][] = [
    ['pending',    'COMPLETE'],
    ['pending',    'APPROVE'],
    ['pending',    'REJECT'],
    ['pending',    'REOPEN'],
    ['generating', 'APPROVE'],
    ['generating', 'REJECT'],
    ['generating', 'REOPEN'],
    ['generating', 'SUBMIT'],
    ['complete',   'SUBMIT'],
    ['complete',   'FAIL'],
    ['complete',   'REOPEN'],
    ['approved',   'SUBMIT'],
    ['approved',   'COMPLETE'],
    ['approved',   'FAIL'],
    ['approved',   'APPROVE'],
    ['approved',   'REJECT'],
    ['rejected',   'SUBMIT'],
    ['failed',     'SUBMIT'],
  ];

  for (const [fromStatus, event] of invalidCases) {
    it(`${fromStatus} + ${event} throws StateConflictError`, () => {
      const rec = makeRecord({ status: fromStatus });
      expect(() => transition(rec, event, { now: NOW })).toThrow(StateConflictError);
    });
  }
});

// ---------------------------------------------------------------------------
// UT-SM-11 — validateTransition() directly
// ---------------------------------------------------------------------------

describe('[UT-SM-11] validateTransition()', () => {
  it('does not throw for valid pending → SUBMIT', () => {
    expect(() => validateTransition('s001', 'pending', 'SUBMIT')).not.toThrow();
  });

  it('throws StateConflictError for pending → APPROVE', () => {
    expect(() => validateTransition('s001', 'pending', 'APPROVE')).toThrow(StateConflictError);
  });

  it('includes shot_id, fromStatus, event in error', () => {
    try {
      validateTransition('s042', 'approved', 'SUBMIT');
    } catch (e) {
      expect(e).toBeInstanceOf(StateConflictError);
      const err = e as StateConflictError;
      expect(err.shotId).toBe('s042');
      expect(err.fromStatus).toBe('approved');
      expect(err.event).toBe('SUBMIT');
    }
  });
});

// ---------------------------------------------------------------------------
// UT-SM-12 — credits accumulate correctly across retries
// ---------------------------------------------------------------------------

describe('[UT-SM-12] credits_spent accumulates across attempts (AC-11)', () => {
  it('accumulates credits across multiple SUBMIT attempts', () => {
    let rec = makeRecord({ status: 'pending' });

    // Attempt 1: submit (5 credits), complete, reject
    [rec] = transition(rec, 'SUBMIT', { credits_charged: 5, now: NOW });
    [rec] = transition(rec, 'COMPLETE', { clip_path: 'video/clips/s001.mp4', now: NOW });
    [, rec] = transition(rec, 'REJECT', { rejection_reason: 'Bad.', now: NOW });

    // Attempt 2: submit (5 more credits)
    [rec] = transition(rec, 'SUBMIT', { credits_charged: 5, now: NOW });
    expect(rec.credits_spent).toBe(10);
    expect(rec.attempt_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// UT-SM-13 — shot_id preserved across all transitions
// ---------------------------------------------------------------------------

describe('[UT-SM-13] shot_id preserved across transitions', () => {
  it('shot_id is unchanged in all output records', () => {
    const rec = makeRecord({ shot_id: 's042', status: 'pending' });
    const results = transition(rec, 'SUBMIT', { credits_charged: 5, now: NOW });
    expect(results[0].shot_id).toBe('s042');
  });
});

// ---------------------------------------------------------------------------
// UT-SM-14 — updated_at uses injected now
// ---------------------------------------------------------------------------

describe('[UT-SM-14] updated_at uses injected now timestamp', () => {
  it('sets updated_at to the injected now value', () => {
    const rec = makeRecord({ status: 'pending' });
    const results = transition(rec, 'SUBMIT', { now: '2026-01-01T00:00:00Z' });
    expect(results[0].updated_at).toBe('2026-01-01T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// UT-SM-15 — FAIL transition preserves existing clip_path in pending record
// ---------------------------------------------------------------------------

describe('[UT-SM-15] FAIL preserves existing clip_path in pending record', () => {
  it('pending record after FAIL retains the previous clip_path', () => {
    const rec = makeRecord({
      status: 'generating',
      clip_path: 'video/clips/s001_attempt1.mp4',
    });
    const [, pendingRec] = transition(rec, 'FAIL', { now: NOW });
    expect(pendingRec.clip_path).toBe('video/clips/s001_attempt1.mp4');
  });
});
