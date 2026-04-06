/**
 * provider-override.ts
 *
 * Smart-default provider override logic for multi-image I2V shots.
 *
 * Per filmbuff-prompt-JIRA DR-9 and AC-13 (Phase 5 / bd-f5b3):
 *   - When a shot has 2+ reference images AND the envelope provider is not "lumaai",
 *     auto-suggest lumaai/ray-2 as the provider override for that shot.
 *   - This is surfaced as an amber indicator in the UI (non-blocking suggestion).
 *   - The user may override the auto-suggestion before finalising export.
 *
 * Public API:
 *   resolveProviderOverride(shot, envelopeProvider, capabilityTable)
 *     → { provider?, model?, isDualKeyframeSuggestion: boolean }
 *
 * Spec: filmbuff-prompt-JIRA DR-9 / AC-13
 * Beads: bd-f5b3 (Phase 5)
 */

import type { ProviderCapability } from './filmbuff-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal shot data needed for provider override resolution. */
export interface ShotProviderInput {
  /** Shot identifier (used in error messages). */
  id: string;
  /** Symbolic reference keys assigned to this shot (e.g. ["sarah", "sarah-end"]). */
  references?: string[];
  /** Explicit provider override already set by the user (skips auto-suggestion). */
  explicitProvider?: string | null;
  /** Explicit model override already set by the user. */
  explicitModel?: string | null;
}

/** Result of resolveProviderOverride. */
export interface ProviderOverrideResult {
  /**
   * Resolved per-shot provider override.
   * undefined → use the envelope-level default (no per-shot override in JSON).
   */
  provider?: string;
  /**
   * Resolved per-shot model override.
   * undefined → use the envelope-level default (no per-shot model in JSON).
   */
  model?: string;
  /**
   * True when the provider/model were auto-suggested (dual-keyframe rule).
   * The UI should surface an amber indicator when this is true.
   */
  isDualKeyframeSuggestion: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Provider id that supports 2-keyframe I2V (lumaai Ray-2 per DR-9). */
export const DUAL_KEYFRAME_PROVIDER = 'lumaai';
/** Model for dual-keyframe shots (lumaai Ray-2). */
export const DUAL_KEYFRAME_MODEL    = 'ray-2';
/** Minimum reference count to trigger dual-keyframe auto-suggestion. */
export const DUAL_KEYFRAME_MIN_REFS = 2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the per-shot provider and model override.
 *
 * Priority:
 *   1. Explicit user selection (explicitProvider / explicitModel) — always honoured.
 *   2. Dual-keyframe auto-suggestion: shot has 2+ references AND envelope ≠ lumaai
 *      → suggest lumaai/ray-2 (isDualKeyframeSuggestion = true).
 *   3. No override — returns all undefined (shot uses envelope defaults).
 *
 * @param shot              - Shot data including reference keys.
 * @param envelopeProvider  - Envelope-level provider id (from filmbuff.config.json).
 * @param capabilityTable   - Provider capability map (from filmbuff.config.json or GET /providers).
 */
export function resolveProviderOverride(
  shot: ShotProviderInput,
  envelopeProvider: string,
  capabilityTable: Map<string, ProviderCapability>
): ProviderOverrideResult {
  const refCount = shot.references?.length ?? 0;

  // 1. Explicit user selection always wins
  if (shot.explicitProvider != null) {
    return {
      provider: shot.explicitProvider,
      model:    shot.explicitModel ?? undefined,
      isDualKeyframeSuggestion: false
    };
  }

  // 2. Dual-keyframe auto-suggestion (AC-13)
  //    Condition: shot has 2+ refs AND the envelope provider is not already lumaai
  const envelopeIsLumaai = envelopeProvider === DUAL_KEYFRAME_PROVIDER;
  if (refCount >= DUAL_KEYFRAME_MIN_REFS && !envelopeIsLumaai) {
    // Verify lumaai is in the capability table and supports multi-image I2V
    const lumaaiCap = capabilityTable.get(DUAL_KEYFRAME_PROVIDER);
    if (lumaaiCap && lumaaiCap.videoSupport && lumaaiCap.maxI2VImages >= DUAL_KEYFRAME_MIN_REFS) {
      return {
        provider: DUAL_KEYFRAME_PROVIDER,
        model:    DUAL_KEYFRAME_MODEL,
        isDualKeyframeSuggestion: true
      };
    }
  }

  // 3. No override needed — shot uses envelope defaults
  return { isDualKeyframeSuggestion: false };
}
