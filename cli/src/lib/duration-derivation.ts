/**
 * duration-derivation.ts
 *
 * Derive shot duration using a 4-priority resolution chain:
 *
 *   P1 — Shooting-script M:SS annotation  (explicit; highest fidelity)
 *   P2 — Beat-sheet timing cue            (scene-level; rounded to nearest second)
 *   P3 — Segmenter estimate (preferred) or action-density formula (fallback)
 *          The SceneSegmenter pre-computes duration from raw scene elements
 *          (action lines at 3 s each + dialogue words at 0.4 s/word).  When
 *          `segmenterEstimateS` is supplied it is used directly; otherwise the
 *          coarse action-density formula runs over `actionLines`.
 *   P4 — Hard fallback 5 s when no signal is available at all.
 *   All results are clamped to [MIN_DURATION_S, MAX_DURATION_S].
 *
 * Spec: openspec/archive/filmbuff-prompt/
 * Beads: bd-eu39 (Phase 4), bd-74fy (Phase 7 — tests)
 */

import { parseMMSS } from './pipeline-inputs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShotData {
  /** Numeric shot ID as a string (matches shooting-script / beat-sheet keys). */
  id: string;
  /** Raw M:SS annotation from the shooting script, if present. */
  shootingScriptDuration?: string | null;
  /** Raw timing cue from the beat sheet, if present (e.g. "0:45"). */
  beatSheetCue?: string | null;
  /**
   * Duration pre-computed by the SceneSegmenter from raw scene elements
   * (action elements at 3 s each + dialogue word-count at 0.4 s/word).
   * When provided this is used as the P3 signal in preference to the coarse
   * `actionLines` formula, which operates on the post-processed `shot.actions`
   * string (always a single joined line) and therefore always yields 5 s.
   */
  segmenterEstimateS?: number | null;
  /**
   * Lines of action text for density estimation.
   * Used as P3 only when `segmenterEstimateS` is absent (e.g. in unit tests
   * that supply raw action lines directly).
   */
  actionLines?: string[];
}

export interface DurationResult {
  /** Derived duration in seconds (always within [3, 60]). */
  seconds: number;
  /**
   * Source key describing how the duration was derived:
   *   'shooting-script' | 'beat-sheet' | 'action-density' | 'fallback'
   */
  source: 'shooting-script' | 'beat-sheet' | 'action-density' | 'fallback';
  /** Human-readable explanation for logging and debugging. */
  notes: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum clamped duration in seconds. */
export const MIN_DURATION_S = 3;
/** Maximum clamped duration in seconds. */
export const MAX_DURATION_S = 60;
/** Base duration for a single action line (density estimate). */
export const DENSITY_BASE_S = 5;
/** Additional seconds per extra action line beyond the first. */
export const DENSITY_PER_EXTRA_LINE_S = 2;
/** Maximum duration the density estimator may return before clamping. */
export const DENSITY_CAP_S = 30;
/** Fallback duration used when no signal is available at all. */
export const FALLBACK_DURATION_S = 5;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive the duration for a single shot using the 4-priority chain.
 * Always returns a DurationResult whose `seconds` is within [MIN, MAX].
 */
export function deriveDuration(shot: ShotData): DurationResult {
  // P1 — Shooting-script annotation
  if (shot.shootingScriptDuration) {
    const parsed = parseMMSS(shot.shootingScriptDuration);
    if (parsed !== null) {
      const seconds = clamp(parsed, MIN_DURATION_S, MAX_DURATION_S);
      return {
        seconds,
        source: 'shooting-script',
        // AC-3: Notes column reads "Derived from shot duration M:SS"
        notes: `Derived from shot duration ${shot.shootingScriptDuration}`
      };
    }
  }

  // P2 — Beat-sheet timing cue
  if (shot.beatSheetCue) {
    const parsed = parseMMSS(shot.beatSheetCue);
    if (parsed !== null) {
      const seconds = clamp(Math.round(parsed), MIN_DURATION_S, MAX_DURATION_S);
      return {
        seconds,
        source: 'beat-sheet',
        notes: `Derived from beat-sheet timing cue ${shot.beatSheetCue}`
      };
    }
  }

  // P3a — Segmenter estimate (preferred).
  // The SceneSegmenter iterates raw SceneElements and totals:
  //   action elements × 3 s  +  dialogue words × 0.4 s/word
  // This is far more accurate than the coarse formula below, which receives a
  // post-processed single-line `shot.actions` string and always returns 5 s.
  if (shot.segmenterEstimateS != null && shot.segmenterEstimateS > 0) {
    const seconds = clamp(shot.segmenterEstimateS, MIN_DURATION_S, MAX_DURATION_S);
    return {
      seconds,
      source: 'action-density',
      // AC-4: Notes column reads "Estimated from action density"
      notes: 'Estimated from action density'
    };
  }

  // P3b — Action-density formula.
  // Used when segmenterEstimateS is absent (e.g. direct unit tests that pass
  // raw action lines).  If the caller provides both, P3a wins above.
  const lines = shot.actionLines ?? [];
  if (lines.length > 0) {
    const rawEstimate = estimateFromActionDensity(lines);
    const seconds = clamp(rawEstimate, MIN_DURATION_S, MAX_DURATION_S);
    return {
      seconds,
      source: 'action-density',
      // AC-4: Notes column reads "Estimated from action density"
      notes: 'Estimated from action density'
    };
  }

  // P4 — Absolute fallback (no signal available; uses same density-fallback value)
  return {
    seconds: FALLBACK_DURATION_S,
    source: 'fallback',
    // Per spec: estimation fallback uses the same notes string as action density
    notes: 'Estimated from action density'
  };
}

// ---------------------------------------------------------------------------
// Sub-functions (exported for fine-grained unit tests)
// ---------------------------------------------------------------------------

/**
 * Estimate duration from the number of non-blank action lines:
 *   duration = 5 + (n - 1) * 2,  capped at DENSITY_CAP_S.
 */
export function estimateFromActionDensity(lines: string[]): number {
  const nonBlank = lines.filter(l => l.trim().length > 0);
  const n = nonBlank.length;
  if (n === 0) return FALLBACK_DURATION_S;
  const estimate = DENSITY_BASE_S + (n - 1) * DENSITY_PER_EXTRA_LINE_S;
  return Math.min(estimate, DENSITY_CAP_S);
}

/**
 * Clamp a value to [min, max] (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Re-export parseMMSS so consumers can import from a single module.
export { parseMMSS };
