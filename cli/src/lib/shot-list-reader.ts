/**
 * cli/src/lib/shot-list-reader.ts
 *
 * Read 08-shot-list.jsonl and provide ordered, indexed access to shots.
 *
 * Spec: openspec/changes/filmb-ai-p/specs/shot-state-machine/spec.md
 *       §Ordering Guarantee
 * Beads: bd-b3e9 (Phase 3 — WS-2)
 *
 * Key invariant (AC-03, AC-07):
 *   Shot ORDER is always determined by position in 08-shot-list.jsonl.
 *   08-video-status.jsonl is only used for state lookup.
 *
 * File is NEVER written to — only read. (08-shot-list.jsonl immutability — AC-04)
 */

import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { VideoStatusRecord } from './shot-state-machine.js';

export const SHOT_LIST_FILE_NAME = '08-shot-list.jsonl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single entry in 08-shot-list.jsonl.
 * Only shot_id is required; all other fields are optional.
 */
export interface ShotEntry {
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
  [key: string]: unknown;  // allow provider-specific extension fields
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getShotListPath(projectPath: string): string {
  return path.join(projectPath, SHOT_LIST_FILE_NAME);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read all shots from 08-shot-list.jsonl in canonical file order.
 *
 * @param projectPath  Absolute path to the project directory.
 * @returns            Array of ShotEntry in JSONL file order.
 * @throws             If the file does not exist or contains invalid JSON.
 */
export async function readAll(projectPath: string): Promise<ShotEntry[]> {
  const filePath = getShotListPath(projectPath);
  const raw = await fsPromises.readFile(filePath, 'utf-8');
  return raw
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as ShotEntry);
}

/**
 * Find a shot by its shot_id within the ordered shot list.
 *
 * @param projectPath  Absolute path to the project directory.
 * @param shotId       The shot_id to look up (e.g. "s001").
 * @returns            The matching ShotEntry, or undefined if not found.
 */
export async function findById(
  projectPath: string,
  shotId: string,
): Promise<ShotEntry | undefined> {
  const shots = await readAll(projectPath);
  return shots.find(s => s.shot_id === shotId);
}

/**
 * Find the next pending shot, respecting canonical JSONL file order.
 *
 * Cross-references `statusMap` (from StatusFileManager.getLatestState()) to
 * determine which shots are pending. A shot is "pending" if:
 *   - It has no entry in statusMap (never initialized), OR
 *   - Its latest status record is "pending".
 *
 * Shots with status other than "pending" are skipped.
 *
 * @param projectPath  Absolute path to the project directory.
 * @param statusMap    Map<shotId, lastRecord> from StatusFileManager.getLatestState().
 * @returns            The first pending ShotEntry in file order, or undefined if none.
 */
export async function findNextPending(
  projectPath: string,
  statusMap: Map<string, VideoStatusRecord>,
): Promise<ShotEntry | undefined> {
  const shots = await readAll(projectPath);
  return shots.find(shot => {
    const record = statusMap.get(shot.shot_id);
    // No record → shot was never initialized; treat as pending only if init ran
    // (video init creates pending records for all shots)
    return record?.status === 'pending';
  });
}

/**
 * Return all shots whose current status matches the given value.
 *
 * @param projectPath  Absolute path to the project directory.
 * @param statusMap    Map<shotId, lastRecord>.
 * @param status       Status to filter by.
 * @returns            Array of matching ShotEntry objects in JSONL file order.
 */
export async function findByStatus(
  projectPath: string,
  statusMap: Map<string, VideoStatusRecord>,
  status: VideoStatusRecord['status'],
): Promise<ShotEntry[]> {
  const shots = await readAll(projectPath);
  return shots.filter(shot => statusMap.get(shot.shot_id)?.status === status);
}
