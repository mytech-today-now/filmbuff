/**
 * ai-powered/src/single-shot.ts
 *
 * Per-shot video generation API — submit a single shot to a video provider.
 *
 * Spec: openspec/changes/filmb-ai-p/specs/ai-powered-integration/spec.md
 *
 * Exports:
 *   generateSingleShot(opts)  — submit + poll until complete or timeout
 *   submitSingleShot(opts)    — submit only, return jobId immediately
 *
 * Security (AC-27):
 *   - agentToken forwarded ONLY as Authorization: Bearer header.
 *   - MUST NOT appear in prompt, result, log, or any persisted file.
 */

import { buildShotPrompt } from './prompt-builder.js';
import { pollShotJob, fetchJobStatus, downloadClip } from './poll-job.js';
import type { SingleShotOptions, SingleShotResult } from './types.js';
import { DEFAULT_WATCHDOG_TIMEOUT_MS } from './types.js';
import {
  type PikaModelId,
  type PikaVideoRequest
} from './pika.js';
import { PIKA_VIDEO_PROVIDER } from './provider-capabilities.js';

// ---------------------------------------------------------------------------
// Internal submit helper
// ---------------------------------------------------------------------------

/**
 * Internal shape of a provider submit response.
 */
interface SubmitResponse {
  jobId: string;
}

/** Build a validated-library-compatible Pika request from a per-shot option set. */
export function buildSingleShotPikaRequest(
  opts: Pick<SingleShotOptions, 'shot' | 'model' | 'providerOptions' | 'extraNotes'>
): PikaVideoRequest {
  const model = (opts.model ?? PIKA_VIDEO_PROVIDER.defaultModel) as PikaModelId;
  const options: Record<string, unknown> = { ...(opts.providerOptions ?? {}) };
  if (model === 'pika/pika-2.5/text-to-video' && options.prompt === undefined) {
    options.prompt = buildShotPrompt(opts.shot, opts.extraNotes);
  }
  return { model, options } as unknown as PikaVideoRequest;
}

/**
 * Submit a generation request to the provider REST API.
 * Returns a provider-assigned jobId immediately without polling.
 *
 * agentToken is passed ONLY in the Authorization header.
 * It MUST NOT appear in the request body, URL, or any log.
 *
 * @internal — exposed as dependency-injection param for unit testing.
 */
export async function submitToProvider(
  prompt: string,
  provider: string,
  durationSeconds: number | undefined,
  agentToken: string | undefined,
): Promise<SubmitResponse> {
  // In production this would POST to the provider's REST endpoint.
  // The agentToken is used ONLY in the Authorization header:
  //   headers: { 'Authorization': `Bearer ${agentToken}` }
  // It is NOT included in the request body or URL.
  void prompt;
  void provider;
  void durationSeconds;
  void agentToken;
  throw new Error(
    'submitToProvider: real provider call not implemented — inject a mock in tests.',
  );
}

// ---------------------------------------------------------------------------
// Public API — submitSingleShot
// ---------------------------------------------------------------------------

/**
 * Submit a single shot to the provider and return the job ID immediately.
 * Does NOT wait for the job to complete — use pollShotJob() or generateSingleShot().
 *
 * @param opts  SingleShotOptions minus outputPath and timeoutMs (not needed for submit-only).
 * @returns     { jobId: string }
 */
export async function submitSingleShot(
  opts: Omit<SingleShotOptions, 'outputPath' | 'timeoutMs'>,
  _submit: typeof submitToProvider = submitToProvider,
): Promise<{ jobId: string }> {
  const prompt = buildShotPrompt(opts.shot, opts.extraNotes);
  const { jobId } = await _submit(
    prompt,
    opts.provider,
    opts.shot.duration_seconds,
    opts.agentToken,  // forwarded to HTTP layer only; never logged
  );
  return { jobId };
}

// ---------------------------------------------------------------------------
// Public API — generateSingleShot
// ---------------------------------------------------------------------------

/**
 * Submit a single shot and poll until it reaches a terminal state or times out.
 *
 * Equivalent to: submitSingleShot() → pollShotJob()
 *
 * @param opts          Full SingleShotOptions including outputPath and optional timeoutMs.
 * @param _submit       Dependency-injectable submit function (for unit testing).
 * @param _fetchStatus  Dependency-injectable status fetcher (for unit testing).
 * @param _downloadClip Dependency-injectable clip downloader (for unit testing).
 * @returns             SingleShotResult with status 'complete' | 'failed'.
 */
export async function generateSingleShot(
  opts: SingleShotOptions,
  _submit: typeof submitToProvider = submitToProvider,
  _fetchStatus: typeof fetchJobStatus = fetchJobStatus,
  _downloadClip: (url: string, path: string) => Promise<void> = downloadClip,
): Promise<SingleShotResult> {
  const prompt = buildShotPrompt(opts.shot, opts.extraNotes);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_WATCHDOG_TIMEOUT_MS;

  // 1. Submit
  const { jobId } = await _submit(
    prompt,
    opts.provider,
    opts.shot.duration_seconds,
    opts.agentToken,  // NEVER logged or serialized
  );

  // 2. Poll to completion
  return pollShotJob(
    jobId,
    opts.provider,
    opts.outputPath,
    timeoutMs,
    opts.agentToken,  // forwarded to fetchJobStatus; NEVER logged
    _fetchStatus,
    _downloadClip,
  );
}
