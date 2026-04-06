/**
 * pipeline-inputs.ts
 *
 * Discovers and loads optional screenplay pipeline artefacts for filmbuff-prompt.
 *
 * PipelineInputs carries pre-parsed lookup maps that downstream modules
 * (duration-derivation, video-controls) consume.
 *
 * Spec: openspec/changes/filmbuff-prompt-JIRA/specs/duration-derivation/spec.md
 * Beads: bd-bae9 (Phase 3)
 *
 * Supported pipeline artefacts (all except .fountain are optional):
 *   <project>.fountain      - primary screenplay (REQUIRED by generate-shot-list --input)
 *   shooting-script.txt     - per-shot scripted durations; "Duration | M:SS" table rows
 *   beat-sheet.txt          - scene-level timing cues; "BEAT <id>: M:SS" or table rows
 *   treatment.txt           - tone and framing intent (loaded as raw text)
 *   script-breakdown.txt    - character descriptions (loaded as raw text)
 *   logline.txt             - project context (loaded as raw text)
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Raw M:SS string extracted from a shooting-script annotation (e.g. "0:45", "1:30").
 * Stored raw so that duration-derivation.ts can apply its own parsing and clamping.
 */
export type RawMMSS = string;

/** A raw timing cue string extracted from a beat sheet (e.g. "0:45", "1:30"). */
export type TimingCue = string;

/** @deprecated Use RawMMSS — kept for backward compatibility. */
export type DurationSeconds = number;

export interface PipelineInputs {
  /**
   * Shooting-script duration map: shotId (e.g. "1") → raw M:SS string (e.g. "0:45").
   * Populated when a `shooting-script.txt` file is found and parsed.
   * Keys are matched against the shot number string from the screenplay.
   */
  shootingScript: Map<string, RawMMSS>;

  /**
   * Beat-sheet timing map: sceneId (e.g. "1") → raw M:SS cue string.
   * Populated when a `beat-sheet.txt` / `.md` file is found.
   */
  beatSheet: Map<string, TimingCue>;

  /** Raw action-line text per scene, keyed by shotId, for density estimation. */
  actionLines: Map<string, string[]>;

  /** Raw text of treatment.txt (tone and framing intent), or null if absent. */
  treatmentText: string | null;

  /** Raw text of script-breakdown.txt (character descriptions), or null if absent. */
  scriptBreakdownText: string | null;

  /** Raw text of logline.txt (project context), or null if absent. */
  loglineText: string | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function emptyPipelineInputs(): PipelineInputs {
  return {
    shootingScript: new Map(),
    beatSheet: new Map(),
    actionLines: new Map(),
    treatmentText: null,
    scriptBreakdownText: null,
    loglineText: null
  };
}

/**
 * Discover and load optional pipeline artefacts from the project directory.
 * Never throws — returns an empty PipelineInputs if files are absent or unreadable.
 *
 * Supports all six DR-1 artifacts (fountain required externally; others optional):
 *   shooting-script.txt, beat-sheet.txt, treatment.txt,
 *   script-breakdown.txt, logline.txt
 */
export function loadPipelineInputs(projectDir: string): PipelineInputs {
  const inputs = emptyPipelineInputs();

  // --- Shooting script ---
  const shootingScriptPath = findFile(projectDir, [
    'shooting-script.txt',
    'shooting-script.fountain',
    'shooting_script.txt'
  ]);
  if (shootingScriptPath) {
    try {
      const text = fs.readFileSync(shootingScriptPath, 'utf-8');
      inputs.shootingScript = parseShootingScript(text);
    } catch { /* ignore — graceful degradation */ }
  }

  // --- Beat sheet ---
  const beatSheetPath = findFile(projectDir, [
    'beat-sheet.txt',
    'beat-sheet.md',
    'beat_sheet.txt'
  ]);
  if (beatSheetPath) {
    try {
      const text = fs.readFileSync(beatSheetPath, 'utf-8');
      inputs.beatSheet = parseBeatSheet(text);
    } catch { /* ignore — graceful degradation */ }
  }

  // --- Treatment ---
  const treatmentPath = findFile(projectDir, ['treatment.txt', 'treatment.md']);
  if (treatmentPath) {
    try {
      inputs.treatmentText = fs.readFileSync(treatmentPath, 'utf-8');
    } catch { /* ignore */ }
  }

  // --- Script breakdown ---
  const breakdownPath = findFile(projectDir, [
    'script-breakdown.txt',
    'script-breakdown.md',
    'script_breakdown.txt'
  ]);
  if (breakdownPath) {
    try {
      inputs.scriptBreakdownText = fs.readFileSync(breakdownPath, 'utf-8');
    } catch { /* ignore */ }
  }

  // --- Logline ---
  const loglinePath = findFile(projectDir, ['logline.txt', 'logline.md']);
  if (loglinePath) {
    try {
      inputs.loglineText = fs.readFileSync(loglinePath, 'utf-8');
    } catch { /* ignore */ }
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// Parsers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Parse a shooting-script text file and extract per-shot duration annotations.
 *
 * Returns a Map<shotId, rawMMSS> where the value is the raw "M:SS" string.
 * The raw string is stored (not pre-converted to seconds) so that the
 * duration-derivation module can apply its own parsing and clamping logic.
 *
 * Supported formats (tried in order for each line/section):
 *
 *   Format A — Markdown table row with "Duration" column (spec canonical format):
 *     | Duration | 0:45 |          (inside a shot's table block)
 *     | Duration   | 1:30 | notes  (with extra columns)
 *
 *   Format B — "Duration | M:SS" inline annotation:
 *     Duration | 0:45
 *
 *   Format C — "SHOT <id>: M:SS" header line (legacy / backward-compatible):
 *     SHOT 3: 0:45
 *     Shot 12: 1:30
 *
 * Shot ID association (for formats A and B):
 *   The parser tracks the most recently seen shot-number heading (e.g. "## Shot 3",
 *   "SHOT 3 —", or a line beginning with the shot number: "3  INT. ..."). When a
 *   Duration row is found, it is associated with that shot ID.
 */
export function parseShootingScript(text: string): Map<string, RawMMSS> {
  const result = new Map<string, RawMMSS>();
  const lines = text.split('\n');

  let currentShotId: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // --- Track current shot heading ---
    // "## Shot 3" / "# Shot 12" / "### SHOT 1" markdown headings
    const headingMatch = trimmed.match(/^#{1,4}\s+(?:SHOT\s+)?(\d+)(?:\s|$)/i);
    if (headingMatch) {
      currentShotId = headingMatch[1];
      continue;
    }

    // "SHOT 3 —", "SHOT 3:", "SHOT 3 " (legacy inline heading)
    // These update currentShotId AND may have an inline duration (Format C)
    const legacyHeader = trimmed.match(/^SHOT\s+(\d+)\s*[:\-–—]?\s*(\d+:\d{2})?/i);
    if (legacyHeader) {
      currentShotId = legacyHeader[1];
      if (legacyHeader[2]) {
        // Duration embedded in the SHOT header line (Format C)
        const raw = legacyHeader[2];
        if (isValidMMSS(raw)) result.set(currentShotId, raw);
      }
      continue;
    }

    // Fountain scene-number prefix: "3  INT. COFFEE SHOP - DAY  3"
    const fountainScene = trimmed.match(/^(\d+)\s+(?:INT|EXT|INT\/EXT|EXT\/INT)\b/i);
    if (fountainScene) {
      currentShotId = fountainScene[1];
      continue;
    }

    // --- Extract Duration value ---
    // Format A: markdown table row  "| Duration | 0:45 |" or "| Duration   | 1:30 | ..."
    const tableRow = trimmed.match(/^\|\s*Duration(?:\s*\([^)]*\))?\s*\|\s*(\d+:\d{2})\s*\|/i);
    if (tableRow) {
      const raw = tableRow[1];
      if (isValidMMSS(raw) && currentShotId !== null) {
        result.set(currentShotId, raw);
      }
      continue;
    }

    // Format B: "Duration | 0:45" inline (no leading pipe)
    const inlineAnnotation = trimmed.match(/^Duration\s*\|\s*(\d+:\d{2})\b/i);
    if (inlineAnnotation) {
      const raw = inlineAnnotation[1];
      if (isValidMMSS(raw) && currentShotId !== null) {
        result.set(currentShotId, raw);
      }
      continue;
    }
  }

  return result;
}

/**
 * Parse a beat-sheet text / markdown file containing scene-level timing cues.
 *
 * Returns a Map<sceneId, rawCueString> where the value is the raw M:SS string.
 *
 * Supported formats:
 *   "BEAT <id>: <M:SS>"           — e.g. "BEAT 2: 0:45"
 *   "Scene <id>: <M:SS>"          — e.g. "Scene 3: 1:00"
 *   "## Beat <id>" + "Timing: M:SS" — markdown table/section format
 *   "| Timing | M:SS |"           — markdown table row in a beat section
 */
export function parseBeatSheet(text: string): Map<string, TimingCue> {
  const result = new Map<string, TimingCue>();
  const lines = text.split('\n');

  let currentBeatId: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Markdown heading: "## Beat 3" / "# Scene 2" etc.
    const headingMatch = trimmed.match(/^#{1,4}\s+(?:BEAT|SCENE)\s+(\d+)(?:\s|$)/i);
    if (headingMatch) {
      currentBeatId = headingMatch[1];
      continue;
    }

    // "BEAT <id>: M:SS" or "Scene <id>: M:SS" inline annotation
    const inlineMatch = trimmed.match(/^(?:BEAT|SCENE)\s+(\d+)\s*:\s*(\d+:\d{2})\b/i);
    if (inlineMatch) {
      const [, id, cue] = inlineMatch;
      if (isValidMMSS(cue)) result.set(id, cue);
      currentBeatId = id;
      continue;
    }

    // "Timing: M:SS" or "Timing | M:SS" within a beat section
    const timingLine = trimmed.match(/^(?:Timing|Duration)\s*[:|]\s*(\d+:\d{2})\b/i);
    if (timingLine && currentBeatId !== null) {
      const cue = timingLine[1];
      if (isValidMMSS(cue)) result.set(currentBeatId, cue);
      continue;
    }

    // Markdown table row: "| Timing | M:SS |"
    const tableRow = trimmed.match(/^\|\s*(?:Timing|Duration)\s*\|\s*(\d+:\d{2})\s*\|/i);
    if (tableRow && currentBeatId !== null) {
      const cue = tableRow[1];
      if (isValidMMSS(cue)) result.set(currentBeatId, cue);
      continue;
    }
  }

  return result;
}

/**
 * Parse "M:SS" into total seconds. Returns null for malformed input.
 * Accepts any non-negative integer for minutes; seconds must be 0–59.
 * Regex: /^(\d+):(\d{2})$/ per spec (bd-bae9).
 */
export function parseMMSS(raw: string): number | null {
  const m = raw.match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  const mins = parseInt(m[1], 10);
  const secs = parseInt(m[2], 10);
  if (secs > 59) return null;
  return mins * 60 + secs;
}

/**
 * Returns true if the raw string is a syntactically valid M:SS annotation.
 * Used by parsers to reject malformed strings before storing them.
 */
export function isValidMMSS(raw: string): boolean {
  return parseMMSS(raw) !== null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findFile(dir: string, candidates: string[]): string | null {
  for (const name of candidates) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}
