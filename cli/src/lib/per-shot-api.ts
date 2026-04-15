/**
 * cli/src/lib/per-shot-api.ts
 *
 * Bridge module: re-exports per-shot video generation API for the filmbuff CLI.
 *
 * In production: delegates to `ai-powered` npm package once it exports
 * generateSingleShot / submitSingleShot / pollShotJob (cross-repo PR).
 *
 * During development (before ai-powered package is updated): provides
 * the TypeScript interface types and throws NotImplemented for actual calls.
 * The implementations in ai-powered/src/ are the source of truth.
 *
 * Spec: openspec/changes/filmb-ai-p/specs/ai-powered-integration/spec.md
 * Beads: bd-92c1 (Phase 4 — WS-3 bridge)
 *
 * Security (AC-27): agentToken MUST NOT be logged, serialized, or included
 * in any output envelope. It is forwarded ONLY as Authorization: Bearer.
 */

// ---------------------------------------------------------------------------
// Types (mirrors ai-powered/src/types.ts)
// ---------------------------------------------------------------------------

export interface ShotListEntry {
  shot_id: string;
  scene?: string;
  shot_type?: string;
  camera?: string;
  movement?: string;
  subject?: string;
  duration_seconds?: number;
  mood?: string;
  dialogue?: string;
  sfx?: string;
  notes?: string;
  [key: string]: unknown;
}

/**
 * Options for a single-shot generation request.
 * AC-27: agentToken forwarded ONLY as Authorization: Bearer header.
 */
export interface SingleShotOptions {
  shot:         ShotListEntry;
  provider:     string;
  extraNotes?:  string;
  outputPath:   string;
  timeoutMs?:   number;
  /** MUST NOT be logged, printed, or serialized anywhere. */
  agentToken?:  string;
}

export interface SingleShotResult {
  jobId:             string;
  status:            'complete' | 'failed';
  clipPath?:         string;
  durationSeconds?:  number;
  resolution?:       string;
  creditsCharged?:   number;
  errorMessage?:     string;
}

export const PROVIDER_DEFAULT_CREDITS: Record<string, number> = {
  'runway-gen3': 5,
  'pika-2':      4,
  'kling-1.6':   6,
};

export const PROVIDER_POLL_INTERVAL_MS: Record<string, number> = {
  'runway-gen3': 5_000,
  'pika-2':      5_000,
  'kling-1.6':  10_000,
};

export const DEFAULT_WATCHDOG_TIMEOUT_MS = 600_000;

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Submit a single shot to the provider and poll until complete.
 *
 * In production: delegates to `ai-powered` package.
 * During development: stubbed — throws NotImplementedError.
 * Override via FILMBUFF_MOCK_PROVIDER=1 for integration testing.
 */
export async function generateSingleShot(
  opts: SingleShotOptions,
): Promise<SingleShotResult> {
  if (process.env['FILMBUFF_MOCK_PROVIDER'] === '1') {
    // Mock mode for integration tests / demo
    const mockJobId = `mock_job_${opts.shot.shot_id}_${Date.now()}`;
    return {
      jobId:            mockJobId,
      status:           'complete',
      clipPath:         opts.outputPath,
      durationSeconds:  opts.shot.duration_seconds ?? 5,
      resolution:       '1920x1080',
      creditsCharged:   PROVIDER_DEFAULT_CREDITS[opts.provider] ?? 5,
    };
  }

  // Production: requires ai-powered package to export generateSingleShot.
  // Once the cross-repo PR (ai-powered library) merges, replace this with:
  //   const { generateSingleShot: _generate } = require('ai-powered');
  //   return _generate(opts);
  throw new Error(
    'generateSingleShot: ai-powered package has not yet been updated to export ' +
    'per-shot API. Set FILMBUFF_MOCK_PROVIDER=1 to use mock mode, or wait for ' +
    'the ai-powered library cross-repo PR to merge.',
  );
}

/**
 * Submit a single shot without polling.
 * Returns the provider-assigned job ID immediately.
 */
export async function submitSingleShot(
  opts: Omit<SingleShotOptions, 'outputPath' | 'timeoutMs'>,
): Promise<{ jobId: string }> {
  if (process.env['FILMBUFF_MOCK_PROVIDER'] === '1') {
    return { jobId: `mock_job_${opts.shot.shot_id}_${Date.now()}` };
  }
  throw new Error('submitSingleShot: ai-powered package not yet updated. Use mock mode.');
}
