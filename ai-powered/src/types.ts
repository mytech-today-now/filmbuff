/**
 * ai-powered/src/types.ts
 *
 * Per-shot video generation TypeScript interfaces for the ai-powered library.
 *
 * Added by filmb-ai-p (FB-0042) — WS-1: Per-Shot API.
 * Spec: openspec/changes/filmb-ai-p/specs/ai-powered-integration/spec.md
 *
 * SECURITY (AC-27): agentToken MUST NOT appear in any serialized output,
 * log file, or diagnostic stream. It is passed only as Authorization: Bearer.
 */

// ---------------------------------------------------------------------------
// ShotListEntry — matches a row in 08-shot-list.jsonl
// ---------------------------------------------------------------------------

/**
 * A single shot entry from 08-shot-list.jsonl.
 * All fields optional except shot_id; absent fields are omitted from the prompt.
 */
export interface ShotListEntry {
  /** Unique identifier, e.g. "s001". */
  shot_id: string;
  /** Scene identifier or description, e.g. "EXT. ROOFTOP - DAY". */
  scene?: string;
  /** Shot type, e.g. "Wide", "Close-Up", "Medium". */
  shot_type?: string;
  /** Camera angle, e.g. "Eye level", "High angle". */
  camera?: string;
  /** Camera movement, e.g. "Static", "Dolly in". */
  movement?: string;
  /** Primary subject of the shot. */
  subject?: string;
  /** Target clip duration in seconds. */
  duration_seconds?: number;
  /** Emotional tone or visual mood. */
  mood?: string;
  /** Dialogue spoken during this shot. */
  dialogue?: string;
  /** Sound design or SFX reference. */
  sfx?: string;
  /** Director notes for this shot. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// SingleShotOptions — input to generateSingleShot / submitSingleShot
// ---------------------------------------------------------------------------

/**
 * Input options for a single-shot video generation request.
 *
 * AC-27: agentToken is forwarded ONLY as Authorization: Bearer header.
 * It MUST NOT appear in the prompt, result, log, or any file.
 */
export interface SingleShotOptions {
  /** Single parsed JSONL line from 08-shot-list.jsonl. */
  shot: ShotListEntry;
  /** Provider identifier: 'runway-gen3' | 'pika-2' | 'kling-1.6' */
  provider: string;
  /**
   * Appended to Director notes field for this attempt only.
   * NEVER persisted to 08-shot-list.jsonl or any other file.
   */
  extraNotes?: string;
  /** Absolute path to write the downloaded MP4 clip. */
  outputPath: string;
  /** Polling timeout in milliseconds. Default: 600_000 (10 minutes). */
  timeoutMs?: number;
  /**
   * Bearer token forwarded to provider API as Authorization header.
   * MUST NOT be logged, printed, or serialized anywhere.
   */
  agentToken?: string;
}

// ---------------------------------------------------------------------------
// SingleShotResult — output of generateSingleShot / pollShotJob
// ---------------------------------------------------------------------------

/**
 * Result returned after a shot generation attempt completes or fails.
 *
 * AC-27: agentToken is NOT included in this type.
 */
export interface SingleShotResult {
  /** Provider-assigned job identifier. */
  jobId: string;
  /** Terminal status of this generation attempt. */
  status: 'complete' | 'failed';
  /** Absolute path to the MP4 clip if status === 'complete'. */
  clipPath?: string;
  /** Actual clip duration returned by the provider. */
  durationSeconds?: number;
  /** Video resolution returned by the provider, e.g. '1920x1080'. */
  resolution?: string;
  /**
   * Credits consumed for this attempt.
   * Sourced from provider response; falls back to static default map.
   */
  creditsCharged?: number;
  /**
   * Error message key when status === 'failed'.
   * One of: 'api_timeout' | 'content_policy_violation' | 'quota_exceeded' | 'credit_exhaustion'
   */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// ProviderCreditMap — static fallback credit costs per provider
// ---------------------------------------------------------------------------

/** Static fallback credits-per-attempt map (spec §Provider Behavior Contract). */
export const PROVIDER_DEFAULT_CREDITS: Record<string, number> = {
  'runway-gen3': 5,
  'pika-2':      4,
  'kling-1.6':   6,
};

/** Static polling intervals (ms) per provider. */
export const PROVIDER_POLL_INTERVAL_MS: Record<string, number> = {
  'runway-gen3': 5_000,
  'pika-2':      5_000,
  'kling-1.6':  10_000,
};

/** Default watchdog timeout if FILMBUFF_WATCHDOG_TIMEOUT_MS is not set. */
export const DEFAULT_WATCHDOG_TIMEOUT_MS = 600_000;
