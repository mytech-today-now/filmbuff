/**
 * cli/src/lib/per-shot-api.ts
 *
 * Bridge module for per-shot video generation used by the filmbuff CLI.
 *
 * Mock mode remains available for local and integration tests. Production
 * requests use the repository's real provider adapters.
 *
 * Spec: openspec/changes/filmb-ai-p/specs/ai-powered-integration/spec.md
 * Beads: bd-92c1 (Phase 4 - WS-3 bridge)
 *
 * Security (AC-27): agentToken is never logged, serialized, or included in
 * the generated prompt. Provider credentials stay in provider-owned config.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { generatePikaVideoForCli } from './pika-video-client.js';
import { PIKA_VIDEO_PROVIDER } from './provider-capabilities.js';
import { getFilmbuffAiClient, type AiConfig } from '../utils/filmbuff-ai-client.js';

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
  provider?: string;
  model?: string;
  providerOptions?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Options for a single-shot generation request.
 * AC-27: agentToken forwarded ONLY as Authorization: Bearer header.
 */
export interface SingleShotOptions {
  shot:         ShotListEntry;
  provider:     string;
  model?:       string;
  providerOptions?: Record<string, unknown>;
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
  pika:          4,
  'kling-1.6':   6,
};

export const PROVIDER_POLL_INTERVAL_MS: Record<string, number> = {
  'runway-gen3': 5_000,
  'pika-2':      5_000,
  pika:          5_000,
  'kling-1.6':  10_000,
};

export const DEFAULT_WATCHDOG_TIMEOUT_MS = 600_000;

// ---------------------------------------------------------------------------
// Prompt and output helpers
// ---------------------------------------------------------------------------

function buildShotPrompt(shot: ShotListEntry, extraNotes?: string): string {
  const lines: string[] = [];

  if (shot.scene) lines.push(`Scene: ${shot.scene}`);
  if (shot.shot_type) lines.push(`Shot type: ${shot.shot_type}`);
  if (shot.camera) lines.push(`Camera angle: ${shot.camera}`);
  if (shot.movement) lines.push(`Camera movement: ${shot.movement}`);
  if (shot.subject) lines.push(`Subject: ${shot.subject}`);
  if (shot.duration_seconds != null) lines.push(`Duration: ${shot.duration_seconds} seconds`);
  if (shot.mood) lines.push(`Mood/tone: ${shot.mood}`);

  lines.push(shot.dialogue ? `Dialogue: "${shot.dialogue}"` : '(no dialogue)');
  if (shot.sfx) lines.push(`Sound design reference: ${shot.sfx}`);

  const baseNotes = shot.notes ?? '';
  if (extraNotes && extraNotes.trim()) {
    const extra = extraNotes.trim();
    lines.push(baseNotes
      ? `Director notes: ${baseNotes}. Additional guidance: ${extra}`
      : `Director notes: Additional guidance: ${extra}`);
  } else if (baseNotes) {
    lines.push(`Director notes: ${baseNotes}`);
  }

  return lines.join('\n');
}

function providerOptionsFor(opts: SingleShotOptions): Record<string, unknown> {
  return {
    ...(opts.shot.providerOptions ?? {}),
    ...(opts.providerOptions ?? {}),
  };
}

function isPikaProvider(provider: string): boolean {
  return provider === 'pika' || provider === 'pika-2';
}

function effectiveModel(opts: SingleShotOptions): string | undefined {
  return opts.model ?? opts.shot.model ?? (isPikaProvider(opts.provider)
    ? PIKA_VIDEO_PROVIDER.defaultModel
    : undefined);
}

/** Persist a provider URL or data URL as the requested local clip file. */
async function writeVideoData(data: string, outputPath: string): Promise<void> {
  if (!path.isAbsolute(outputPath)) {
    throw new Error('Per-shot outputPath must be an absolute path.');
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  if (data.startsWith('data:')) {
    const separator = data.indexOf(',');
    if (separator < 0) throw new Error('Provider returned an invalid data URL.');
    const metadata = data.slice(0, separator);
    const payload = data.slice(separator + 1);
    const content = metadata.endsWith(';base64')
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    await fs.writeFile(outputPath, content);
    return;
  }

  if (
    data.length > 0 &&
    data.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(data)
  ) {
    await fs.writeFile(outputPath, Buffer.from(data, 'base64'));
    return;
  }

  if (!/^https:\/\/[^\s]+$/i.test(data)) {
    throw new Error('Provider returned an unsupported video data format.');
  }

  const response = await fetch(data);
  if (!response.ok) {
    throw new Error(`Video download failed with HTTP ${response.status}.`);
  }
  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

function generatedJobId(provider: string, shotId: string): string {
  return `${provider}_shot_${shotId}_${Date.now()}`;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Submit a single shot and poll until the provider returns its video.
 *
 * Pika uses the repository's typed REST adapter. Other configured providers
 * use the existing ai-powered client integration. This keeps the bridge
 * functional even when the installed ai-powered package does not yet expose
 * the newer per-shot exports.
 */
export async function generateSingleShot(
  opts: SingleShotOptions,
): Promise<SingleShotResult> {
  if (process.env['FILMBUFF_MOCK_PROVIDER'] === '1') {
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

  const prompt = buildShotPrompt(opts.shot, opts.extraNotes);
  const model = effectiveModel(opts);
  const providerOptions = providerOptionsFor(opts);

  if (isPikaProvider(opts.provider)) {
    const pikaResult = await generatePikaVideoForCli(
      prompt,
      model ?? PIKA_VIDEO_PROVIDER.defaultModel,
      providerOptions,
      { timeoutMs: opts.timeoutMs },
    );
    await writeVideoData(pikaResult.contentUrl, opts.outputPath);
    return {
      jobId:           pikaResult.requestId,
      status:          'complete',
      clipPath:        opts.outputPath,
      durationSeconds: opts.shot.duration_seconds,
      creditsCharged:  PROVIDER_DEFAULT_CREDITS[opts.provider] ?? 4,
    };
  }

  const overrides: Partial<Omit<AiConfig, 'apiKey'>> = {
    provider: opts.provider as AiConfig['provider'],
    ...(model ? { model } : {}),
  };
  const client = await getFilmbuffAiClient('video-generator', overrides);
  const result = await client.generateVideo(prompt, {
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
  } as Parameters<typeof client.generateVideo>[1]);

  await writeVideoData(result.data, opts.outputPath);
  return {
    jobId:           generatedJobId(opts.provider, opts.shot.shot_id),
    status:          'complete',
    clipPath:        opts.outputPath,
    durationSeconds: result.durationSeconds ?? opts.shot.duration_seconds,
    creditsCharged:  PROVIDER_DEFAULT_CREDITS[opts.provider],
  };
}

/** Submit a single shot without waiting for completion. */
export async function submitSingleShot(
  opts: Omit<SingleShotOptions, 'outputPath' | 'timeoutMs'>,
): Promise<{ jobId: string }> {
  if (process.env['FILMBUFF_MOCK_PROVIDER'] === '1') {
    return { jobId: `mock_job_${opts.shot.shot_id}_${Date.now()}` };
  }

  throw new Error(
    'submitSingleShot is not available through the provider adapters yet. ' +
    'Use generateSingleShot for per-shot generation.',
  );
}
