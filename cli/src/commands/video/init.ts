/**
 * cli/src/commands/video/init.ts
 *
 * `filmbuff video init`
 *
 * Reads 08-shot-list.jsonl, creates 08-video-status.jsonl with one `pending`
 * record per shot, and creates video/clips/.
 * Detects existing clips in video/clips/ and initializes them as `complete`.
 *
 * Exit codes:
 *   0  SUCCESS       — initialized successfully
 *   2  NOT_FOUND     — 08-shot-list.jsonl not found
 *   5  STATE_CONFLICT — already initialized (without --overwrite)
 *   6  INVALID_ARGS  — project directory not accessible
 *
 * Spec: openspec/changes/filmb-ai-p/specs/video-subcommands/spec.md §video init
 * Beads: bd-92c1 (Phase 4 — WS-3)
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { readAll } from '../../lib/shot-list-reader.js';
import { appendRecords, getStatusFilePath, STATUS_FILE_NAME } from '../../lib/status-file-manager.js';
import type { VideoStatusRecord } from '../../lib/shot-state-machine.js';
import {
  EXIT, isAgentMode, agentSuccess, agentError, humanLog, resolveAgentToken,
} from '../../lib/agent-mode.js';

export interface VideoInitOptions {
  project:     string;
  overwrite?:  boolean;
  agent?:      boolean;
}

export async function videoInitCommand(opts: VideoInitOptions): Promise<void> {
  const projectPath = path.resolve(opts.project);
  const agentMode   = isAgentMode(opts.agent);
  const statusPath  = getStatusFilePath(projectPath);
  const clipsDir    = path.join(projectPath, 'video', 'clips');
  const now         = new Date().toISOString();

  // ── Validate project directory ────────────────────────────────────────────
  if (!fs.existsSync(projectPath)) {
    const msg = `Project directory not found: ${projectPath}`;
    if (agentMode) { agentError(EXIT.INVALID_ARGS, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.INVALID_ARGS);
  }

  // ── Check 08-shot-list.jsonl ──────────────────────────────────────────────
  const shotListPath = path.join(projectPath, '08-shot-list.jsonl');
  if (!fs.existsSync(shotListPath)) {
    const msg = `Shot list not found: ${shotListPath}`;
    if (agentMode) { agentError(EXIT.NOT_FOUND, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.NOT_FOUND);
  }

  // ── Already initialized? ──────────────────────────────────────────────────
  if (fs.existsSync(statusPath) && !opts.overwrite) {
    const msg = `${STATUS_FILE_NAME} already exists. Use --overwrite to reinitialize.`;
    if (agentMode) { agentError(EXIT.STATE_CONFLICT, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.STATE_CONFLICT);
  }

  // ── In human mode with --overwrite: prompt for confirmation ──────────────
  if (opts.overwrite && !agentMode && fs.existsSync(statusPath)) {
    // Non-interactive overwrite: proceed (agent mode skips; human can add --agent to bypass)
    humanLog('⚠  Overwriting existing 08-video-status.jsonl…', agentMode);
  }

  // ── Read shot list ────────────────────────────────────────────────────────
  let shots: Awaited<ReturnType<typeof readAll>>;
  try {
    shots = await readAll(projectPath);
  } catch (err) {
    const msg = `Failed to read shot list: ${(err as Error).message}`;
    if (agentMode) { agentError(EXIT.GENERAL_ERROR, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.GENERAL_ERROR);
  }

  if (shots.length === 0) {
    const msg = '08-shot-list.jsonl is empty — nothing to initialize.';
    if (agentMode) { agentError(EXIT.NOT_FOUND, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.NOT_FOUND);
  }

  // ── Create video/clips/ ───────────────────────────────────────────────────
  await fsPromises.mkdir(clipsDir, { recursive: true });

  // ── Detect existing clips ─────────────────────────────────────────────────
  const existingClips = new Set<string>(
    fs.readdirSync(clipsDir)
      .filter(f => f.endsWith('.mp4') && !f.includes('_attempt'))
      .map(f => path.basename(f, '.mp4')),  // e.g. "s001" from "s001.mp4"
  );

  // ── Build status records ──────────────────────────────────────────────────
  if (opts.overwrite && fs.existsSync(statusPath)) {
    await fsPromises.writeFile(statusPath, '', 'utf-8');
  }

  const records: VideoStatusRecord[] = shots.map(shot => {
    const clipName = shot.shot_id;
    const hasClip  = existingClips.has(clipName);
    return {
      shot_id:          shot.shot_id,
      status:           hasClip ? 'complete' : 'pending',
      provider:         null,
      provider_job_id:  null,
      clip_path:        hasClip ? path.join('video', 'clips', `${clipName}.mp4`) : null,
      attempt_count:    hasClip ? 1 : 0,
      rejection_reason: null,
      approved_at:      null,
      rejected_at:      null,
      generated_at:     hasClip ? now : null,
      failed_at:        null,
      credits_spent:    0,
      updated_at:       now,
    } satisfies VideoStatusRecord;
  });

  await appendRecords(projectPath, records);

  const pendingCount  = records.filter(r => r.status === 'pending').length;
  const completeCount = records.filter(r => r.status === 'complete').length;

  if (agentMode) {
    agentSuccess({
      initialized:   true,
      total_shots:   shots.length,
      pending_shots: pendingCount,
      detected_clips: completeCount,
      status_file:   statusPath,
      clips_dir:     clipsDir,
    });
  } else {
    console.log(`✓ Initialized ${shots.length} shot(s) in ${STATUS_FILE_NAME}`);
    if (completeCount > 0) {
      console.log(`  ↳ ${completeCount} shot(s) initialized as complete (existing clips detected)`);
    }
    console.log(`  ↳ ${pendingCount} shot(s) pending generation`);
    console.log(`  ↳ Clips directory: ${clipsDir}`);
  }

  process.exit(EXIT.SUCCESS);
}
