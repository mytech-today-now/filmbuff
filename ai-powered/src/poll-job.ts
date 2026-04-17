/**
 * ai-powered/src/poll-job.ts
 *
 * Poll a submitted provider video job until it reaches a terminal state
 * or a configurable timeout elapses.
 *
 * Spec: openspec/changes/filmb-ai-p/specs/ai-powered-integration/spec.md
 *       §Exported Functions — pollShotJob
 *       §Provider Behavior Contract
 *
 * Provider polling intervals:
 *   runway-gen3 → 5 000 ms
 *   pika-2      → 5 000 ms
 *   kling-1.6   → 10 000 ms
 *
 * On timeout: { status: 'failed', errorMessage: 'api_timeout' }
 *
 * Security (AC-27): agentToken is passed only as Authorization: Bearer header.
 * It MUST NOT appear in any log, prompt string, or serialized result.
 */

import * as fs from 'fs/promises';
import * as https from 'https';
import type { SingleShotResult } from './types.js';
import {
  DEFAULT_WATCHDOG_TIMEOUT_MS,
  PROVIDER_DEFAULT_CREDITS,
  PROVIDER_POLL_INTERVAL_MS,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract credits charged from a provider job-status response.
 * Falls back to the static per-provider default map.
 */
export function extractCreditsCharged(
  providerResponse: Record<string, unknown>,
  provider: string,
): number {
  // Try well-known provider response fields
  const candidates = [
    providerResponse['credits_charged'],
    providerResponse['credits'],
    providerResponse['creditsCharged'],
    providerResponse['cost'],
  ];
  for (const v of candidates) {
    if (typeof v === 'number' && v >= 0) return v;
  }
  // Static fallback
  return PROVIDER_DEFAULT_CREDITS[provider] ?? 0;
}

// ---------------------------------------------------------------------------
// Mock provider responses (used when agentToken is sentinel or mock mode)
// ---------------------------------------------------------------------------

/** Internal provider job-status shape (provider-agnostic). */
interface ProviderJobStatus {
  done: boolean;
  success: boolean;
  clipUrl?: string;
  durationSeconds?: number;
  resolution?: string;
  creditsCharged?: number;
  errorMessage?: string;
  rawResponse: Record<string, unknown>;
}

/**
 * Fetch the current status of a provider job.
 * In production this would call the actual provider REST API.
 * Abstracted here for testability.
 *
 * @internal — not exported; use pollShotJob() externally.
 */
export async function fetchJobStatus(
  jobId: string,
  provider: string,
  agentToken: string | undefined,
): Promise<ProviderJobStatus> {
  // In a real implementation this calls the provider REST API.
  // The agentToken is passed ONLY as Authorization: Bearer header and
  // MUST NOT appear in logs, URLs, or response bodies.
  void agentToken; // token is handled at the HTTP layer; referenced to prevent lint warning
  void jobId;
  void provider;
  // Placeholder: real implementation would make an authenticated HTTP request.
  // For testability, the real HTTP call is swappable via dependency injection.
  throw new Error(
    'fetchJobStatus: real provider call not implemented — inject a mock via dependency injection in tests.',
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Poll a previously submitted provider job until it completes or times out.
 *
 * @param jobId         Provider-assigned job identifier from submitSingleShot().
 * @param provider      Provider string: 'runway-gen3' | 'pika-2' | 'kling-1.6'
 * @param outputPath    Absolute path to write the downloaded MP4 when complete.
 * @param timeoutMs     Max polling duration in ms. Default: DEFAULT_WATCHDOG_TIMEOUT_MS.
 * @param agentToken    Bearer token forwarded to provider API. NEVER logged.
 * @param _fetchStatus  Dependency-injectable status fetcher (for unit testing).
 * @param _downloadClip Dependency-injectable clip downloader (for unit testing).
 */
export async function pollShotJob(
  jobId: string,
  provider: string,
  outputPath: string,
  timeoutMs: number = DEFAULT_WATCHDOG_TIMEOUT_MS,
  agentToken?: string,
  _fetchStatus: typeof fetchJobStatus = fetchJobStatus,
  _downloadClip: (url: string, path: string) => Promise<void> = downloadClip,
): Promise<SingleShotResult> {
  const intervalMs = PROVIDER_POLL_INTERVAL_MS[provider] ?? 5_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await _fetchStatus(jobId, provider, agentToken);

    if (status.done) {
      if (status.success && status.clipUrl) {
        // Download the clip to outputPath
        await _downloadClip(status.clipUrl, outputPath);
        return {
          jobId,
          status: 'complete',
          clipPath: outputPath,
          durationSeconds: status.durationSeconds,
          resolution: status.resolution,
          creditsCharged: extractCreditsCharged(status.rawResponse, provider),
        };
      } else {
        return {
          jobId,
          status: 'failed',
          creditsCharged: extractCreditsCharged(status.rawResponse, provider),
          errorMessage: status.errorMessage ?? 'provider_error',
        };
      }
    }

    // Not done yet — wait and try again
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }

  // Timeout exceeded
  return {
    jobId,
    status: 'failed',
    errorMessage: 'api_timeout',
    creditsCharged: PROVIDER_DEFAULT_CREDITS[provider] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Clip download helper
// ---------------------------------------------------------------------------

/**
 * Download a video clip from a URL and write it to outputPath.
 * Abstracted for testability; real implementation uses streaming HTTP GET.
 * Exported so it can be used as a default argument in generateSingleShot tests.
 */
export async function downloadClip(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = require('fs').createWriteStream(outputPath);
    https.get(url, response => {
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err: Error) => { file.close(); reject(err); });
    }).on('error', reject);
  });
}
