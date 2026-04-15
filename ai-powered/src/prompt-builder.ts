/**
 * ai-powered/src/prompt-builder.ts
 *
 * Constructs a video-generation prompt string from a ShotListEntry.
 *
 * Spec: openspec/changes/filmb-ai-p/specs/ai-powered-integration/spec.md
 *       §Prompt Construction Template
 *
 * Template order (fields absent from shot entry are OMITTED — no empty lines):
 *   Scene:              {scene}
 *   Shot type:          {shot_type}
 *   Camera angle:       {camera}
 *   Camera movement:    {movement}
 *   Subject:            {subject}
 *   Duration:           {duration_seconds} seconds
 *   Mood/tone:          {mood}
 *   Dialogue:           "{dialogue}"    (or "(no dialogue)" when absent)
 *   Sound design ref:   {sfx}           (omitted when absent)
 *   Director notes:     {notes}[. Additional guidance: {extraNotes}]
 *
 * Security (AC-27):
 *   - agentToken MUST NOT appear in the returned prompt string.
 *   - extraNotes is appended to the Director notes line and NEVER persisted.
 */

import type { ShotListEntry } from './types.js';

/**
 * Build a natural-language prompt for a single video shot.
 *
 * @param shot       Parsed entry from 08-shot-list.jsonl.
 * @param extraNotes Optional per-attempt notes appended to Director notes field.
 *                   NEVER written to any file. MUST NOT contain agentToken.
 * @returns          Multi-line prompt string ready for the provider API.
 */
export function buildShotPrompt(shot: ShotListEntry, extraNotes?: string): string {
  const lines: string[] = [];

  // --- ordered template fields ---
  if (shot.scene)            lines.push(`Scene: ${shot.scene}`);
  if (shot.shot_type)        lines.push(`Shot type: ${shot.shot_type}`);
  if (shot.camera)           lines.push(`Camera angle: ${shot.camera}`);
  if (shot.movement)         lines.push(`Camera movement: ${shot.movement}`);
  if (shot.subject)          lines.push(`Subject: ${shot.subject}`);
  if (shot.duration_seconds != null)
                             lines.push(`Duration: ${shot.duration_seconds} seconds`);
  if (shot.mood)             lines.push(`Mood/tone: ${shot.mood}`);

  // Dialogue: always present — use "(no dialogue)" placeholder when absent
  if (shot.dialogue) {
    lines.push(`Dialogue: "${shot.dialogue}"`);
  } else {
    lines.push('(no dialogue)');
  }

  // SFX: omitted entirely when absent
  if (shot.sfx) lines.push(`Sound design reference: ${shot.sfx}`);

  // Director notes: base notes + optional extra guidance
  const baseNotes = shot.notes ?? '';
  if (extraNotes && extraNotes.trim()) {
    const extra = extraNotes.trim();
    if (baseNotes) {
      lines.push(`Director notes: ${baseNotes}. Additional guidance: ${extra}`);
    } else {
      lines.push(`Director notes: Additional guidance: ${extra}`);
    }
  } else if (baseNotes) {
    lines.push(`Director notes: ${baseNotes}`);
  }

  return lines.join('\n');
}
