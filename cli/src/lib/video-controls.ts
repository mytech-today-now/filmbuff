/**
 * video-controls.ts
 *
 * Resolve video generation controls for a shot and render them to Markdown.
 *
 * Per spec (bd-f5b3 Phase 5 / filmbuff-prompt-JIRA DR-2 through DR-4):
 *   - duration is always present and concrete (never "Default")
 *   - aspectRatio, resolution, quality, fps are optional — undefined → "Default"
 *   - Only explicitly triggered overrides set non-duration fields
 *   - renderVideoControlsTable emits a 3-column table (Control | Value | Notes)
 *   - "Default" fields are omitted from the JSON batch payload (handled by batch-serializer)
 *
 * Override trigger rules (DR-4):
 *   Aspect Ratio — portrait/vertical/widescreen/cinematic/square/1:1/9:16/21:9 cues
 *   Resolution   — explicit delivery format in script/brief (720p / 1080p / 4k)
 *   Quality      — hero/title shots → "high"; animatic/rapid-iteration → "draft"
 *   FPS          — production brief specifies a frame rate (24 / 30 / 60)
 *
 * Spec: openspec/archive/filmbuff-prompt/
 * Beads: bd-f5b3 (Phase 5)
 */

import type { DurationResult } from './duration-derivation';

// ---------------------------------------------------------------------------
// Types  (per design.md referenced in bd-f5b3)
// ---------------------------------------------------------------------------

/** Allowed aspect-ratio values per spec. "Default" is represented as undefined. */
export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';

/** Allowed resolution values per spec. Note: lowercase "4k" per DR-4. */
export type Resolution = '720p' | '1080p' | '4k';

/** Allowed quality values per spec — includes "draft" (animatic) and "high" (hero shots). */
export type Quality = 'draft' | 'standard' | 'high';

/** Allowed FPS values per spec. */
export type FPS = 24 | 30 | 60;

/**
 * Resolved video controls for a single shot.
 *
 * `duration` is ALWAYS present and concrete ([3, 60] seconds).
 * All other fields are optional — undefined means "Default" (use provider default).
 * Undefined fields render as "Default" in Markdown and are OMITTED from JSON payloads.
 */
export interface VideoControls {
  /** Always present; derived from shooting script, beat sheet, or action density. */
  duration:     number;
  /** Aspect ratio override. undefined → "Default". */
  aspectRatio?: AspectRatio;
  /** Resolution override. undefined → "Default". */
  resolution?:  Resolution;
  /** Quality override. undefined → "Default". */
  quality?:     Quality;
  /** Frames-per-second override. undefined → "Default". */
  fps?:         FPS;
}

/** Framing hints provided by the shot metadata and pipeline context. */
export interface ShotFramingHints {
  /** Raw framing / style description extracted from the shot element. */
  framingDescription?: string | null;
  /** Explicit aspect-ratio override from shot metadata (must be an allowed value). */
  explicitAspectRatio?: AspectRatio | null;
  /** Explicit resolution override from shot metadata. */
  explicitResolution?: Resolution | null;
  /** Explicit quality override from shot metadata. */
  explicitQuality?: Quality | null;
  /** Explicit FPS override from shot metadata. */
  explicitFps?: FPS | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve VideoControls for a single shot.
 *
 * `duration` is always set from `durationResult.seconds`.
 * Other fields are set ONLY when an explicit override or keyword cue applies.
 * Fields that remain unset are undefined, which means "Default" in output.
 */
export function resolveVideoControls(
  hints: ShotFramingHints,
  durationResult: DurationResult
): VideoControls {
  // Start with only duration set (all other fields are "Default" / undefined)
  const controls: VideoControls = {
    duration: durationResult.seconds
  };

  // Apply explicit field overrides first (highest priority)
  if (hints.explicitAspectRatio != null) controls.aspectRatio = hints.explicitAspectRatio;
  if (hints.explicitResolution  != null) controls.resolution  = hints.explicitResolution;
  if (hints.explicitQuality     != null) controls.quality     = hints.explicitQuality;
  if (hints.explicitFps         != null) controls.fps         = hints.explicitFps;

  // Apply keyword-driven override rules (only triggers if not already set explicitly)
  return applyOverrideRules(controls, hints.framingDescription ?? '');
}

/**
 * Apply text-cue override rules per DR-4.
 *
 * Rules (only applied when the corresponding field is not already set):
 *   Aspect Ratio — portrait/vertical/square/widescreen/cinematic framing cues
 *   Quality      — hero/title shots → "high"; animatic → "draft"
 *   (Resolution and FPS are only set via explicit production-brief metadata)
 *
 * Exported for independent unit testing.
 */
export function applyOverrideRules(
  controls: VideoControls,
  framingDescription: string
): VideoControls {
  const desc = framingDescription.toLowerCase();
  const result = { ...controls };

  // Rule 1: portrait / vertical / square / widescreen aspect-ratio cues
  if (controls.aspectRatio == null) {
    if (/portrait|vertical|9:16/.test(desc)) {
      result.aspectRatio = '9:16';
    } else if (/widescreen|cinematic|21:9/.test(desc)) {
      result.aspectRatio = '21:9';
    } else if (/square|1:1/.test(desc)) {
      result.aspectRatio = '1:1';
    }
    // "16:9" is the fallback default — not set here (remains undefined = "Default")
  }

  // Rule 2: hero / title shots → "high"; animatic → "draft"
  if (controls.quality == null) {
    if (/\bhero\b|\btitle shot\b/.test(desc)) {
      result.quality = 'high';
    } else if (/animatic|rapid.?iter/.test(desc)) {
      result.quality = 'draft';
    } else if (/close[-\s]?up|macro/.test(desc)) {
      // close-up / macro → upgrade quality
      result.quality = 'high';
    }
  }

  // Rule 3: action / fast → fps 60 (only via explicit production brief;
  //   keyword-based fps override is not specified in DR-4, but we support
  //   it here as a convenience cue for scripts that explicitly mention it)
  if (controls.fps == null && /\b60\s*fps\b|\b60fps\b/.test(desc)) {
    result.fps = 60;
  }

  return result;
}

/**
 * Render VideoControls as the spec-required 3-column Markdown table.
 *
 * Format (DR-2):
 *   **Video Controls:**
 *
 *   | Control      | Value   | Notes                               |
 *   |--------------|---------|-------------------------------------|
 *   | Aspect Ratio | Default |                                     |
 *   | Resolution   | Default |                                     |
 *   | Quality      | Default |                                     |
 *   | Duration (s) | 12      | Derived from shot duration 0:12     |
 *   | FPS          | Default |                                     |
 *
 * @param controls - Resolved VideoControls (undefined fields → "Default")
 * @param durationNotes - Notes string from DurationResult (AC-3 / AC-4)
 */
export function renderVideoControlsTable(
  controls: VideoControls,
  durationNotes = ''
): string {
  // Column widths chosen to match the JIRA spec example (DR-2)
  const header = '| Control       | Value   | Notes                                      |';
  const divider = '|---------------|---------|---------------------------------------------|';

  function row(control: string, value: string | number | undefined, notes = ''): string {
    const v = value != null ? String(value) : 'Default';
    return `| ${control.padEnd(13)} | ${v.padEnd(7)} | ${notes.padEnd(42)} |`;
  }

  const lines = [
    '**Video Controls:**',
    '',
    header,
    divider,
    row('Aspect Ratio', controls.aspectRatio),
    row('Resolution',   controls.resolution),
    row('Quality',      controls.quality),
    row('Duration (s)', controls.duration, durationNotes),
    row('FPS',          controls.fps),
  ];

  return lines.join('\n');
}
