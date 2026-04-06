/**
 * video-generator.ts — FilmbuffVideoGenerator
 *
 * Generates video clips from ShotEntry objects using the ai-powered library's
 * video modality via getFilmbuffAiClient('video-generator').
 *
 * Phase 8 of ai-powered-not-local change (bd-6c4f).
 * Spec: openspec/changes/ai-powered-not-local/specs/video-generation/spec.md
 * Reference: openspec/changes/ai-powered-not-local/examples/video-generator-usage.ts
 */

import { getFilmbuffAiClient } from '../utils/filmbuff-ai-client.js';
import type { VideoControls } from './video-controls.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * Input descriptor for a single shot to be rendered as video.
 * Maps to a row in the JSONL shot list produced by generate-shot-list.
 */
export interface ShotEntry {
  shotNumber:             number;
  description:            string;
  action?:                string;
  setDescription?:        string;
  characterDescriptions?: Array<{
    character:          string;
    physicalAppearance: string;
    wardrobe:           string;
  }>;
  videoControls: VideoControls;
}

/**
 * Output descriptor returned after a shot is generated.
 * Matches the manifest.json entries written by the generate-video command.
 */
export interface GeneratedVideoResult {
  shotNumber:       number;
  videoData:        string;   // URL or base64 payload from ai-powered
  mimeType:         string;
  durationSeconds?: number;
  aspectRatio?:     string;
  provider:         string;
  model:            string;
  generatedAt:      string;   // ISO-8601 timestamp
  durationMs:       number;   // wall-clock ms taken to generate
}

// ---------------------------------------------------------------------------
// buildVideoPrompt — exported for unit testing (design.md Open Questions #3)
// ---------------------------------------------------------------------------

/**
 * Assemble a natural-language video generation prompt from a ShotEntry.
 *
 * Prompt assembly order (per spec):
 *   1. Setting:    <setDescription>      (if present)
 *   2. Shot:       <description>         (always)
 *   3. Action:     <action>              (if present)
 *   4. Characters: <name>: <appearance>. Wearing: <wardrobe>.  (one line per character)
 *   5. Style:      cinematic hero shot quality  (always last)
 */
export function buildVideoPrompt(shot: ShotEntry): string {
  const lines: string[] = [];

  if (shot.setDescription) {
    lines.push(`Setting: ${shot.setDescription}`);
  }

  lines.push(`Shot: ${shot.description}`);

  if (shot.action) {
    lines.push(`Action: ${shot.action}`);
  }

  if (shot.characterDescriptions?.length) {
    for (const char of shot.characterDescriptions) {
      lines.push(
        `Characters: ${char.character}: ${char.physicalAppearance}. Wearing: ${char.wardrobe}.`,
      );
    }
  }

  lines.push('Style: cinematic hero shot quality');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// FilmbuffVideoGenerator
// ---------------------------------------------------------------------------

/**
 * Options forwarded to getFilmbuffAiClient as overrides for a generation call.
 */
export interface VideoGenerationOptions {
  /** Video provider id (e.g. 'lumaai', 'runway'). Default: 'lumaai'. */
  provider?: string;
  /** Model override for the selected provider. */
  model?: string;
  /**
   * When true, activates ai-powered MockProvider — no real API calls are made.
   * Forwards `{ mock: true }` in the overrides object (spec §generate-video --mock).
   */
  mock?: boolean;
}

/**
 * Generates video clips from ShotEntry objects using ai-powered's video modality.
 *
 * Usage:
 *   const gen = new FilmbuffVideoGenerator();
 *   const result = await gen.generateForShot(shot, { provider: 'lumaai' });
 *   const results = await gen.generateForShotList(shots, { provider: 'runway' }, 3);
 */
export class FilmbuffVideoGenerator {
  /**
   * Generate a single video clip for one shot.
   *
   * @param shot    ShotEntry with description, controls, and optional metadata.
   * @param options VideoGenerationOptions — provider, model, and/or mock flag.
   */
  async generateForShot(
    shot:    ShotEntry,
    options: VideoGenerationOptions = {},
  ): Promise<GeneratedVideoResult> {
    const startMs = Date.now();
    const { provider = 'lumaai', model, mock = false } = options;

    const overrides: Record<string, unknown> = { provider };
    if (model)  overrides['model'] = model;
    if (mock)   overrides['mock']  = true;

    const client = await getFilmbuffAiClient('video-generator', overrides as any);

    const result = await (client as any).generateVideo(
      buildVideoPrompt(shot),
      {
        aspectRatio:     shot.videoControls.aspectRatio ?? '16:9',
        durationSeconds: shot.videoControls.duration,
      },
    );

    return {
      shotNumber:      shot.shotNumber,
      videoData:       result.data,
      mimeType:        result.mimeType,
      durationSeconds: result.durationSeconds,
      aspectRatio:     result.aspectRatio,
      provider:        result.provider,
      model:           result.model,
      generatedAt:     new Date().toISOString(),
      durationMs:      Date.now() - startMs,
    };
  }


  /**
   * Generate video clips for a list of shots, processing them in concurrent batches.
   *
   * Shots are processed in batches of `concurrency` size via Promise.all.
   * The result array preserves the original shot-number order.
   *
   * @param shots       Array of ShotEntry objects to generate.
   * @param options     VideoGenerationOptions — provider, model, mock flag.
   * @param concurrency Batch size for concurrent generation. Default: 3.
   */
  async generateForShotList(
    shots:       ShotEntry[],
    options:     VideoGenerationOptions = {},
    concurrency = 3,
  ): Promise<GeneratedVideoResult[]> {
    const results: GeneratedVideoResult[] = [];

    for (let i = 0; i < shots.length; i += concurrency) {
      const batch = shots.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(shot => this.generateForShot(shot, options)),
      );
      results.push(...batchResults);
    }

    return results;
  }
}
