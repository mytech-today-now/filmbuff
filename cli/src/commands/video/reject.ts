/**
 * cli/src/commands/video/reject.ts
 *
 * `filmbuff video reject` — mark a shot rejected; rename clip; revert to pending.
 *
 * Renames video/clips/{id}.mp4 → video/clips/{id}_attempt{N}.mp4 (atomic rename).
 * Appends: complete→rejected (with reason) and rejected→pending.
 *
 * Exit codes:
 *   0  SUCCESS       — shot rejected and reverted to pending
 *   2  NOT_FOUND     — shot_id not found
 *   5  STATE_CONFLICT — shot not in `complete` state
 *   6  INVALID_ARGS  — --shot missing
 *
 * Spec: openspec/changes/filmb-ai-p/specs/video-subcommands/spec.md §video reject
 * Beads: bd-92c1 (Phase 4 — WS-3)
 */

import * as path from 'path';
import { getLatestState, appendRecords, renameClipForRetry } from '../../lib/status-file-manager.js';
import { transition, StateConflictError } from '../../lib/shot-state-machine.js';
import {
  EXIT, isAgentMode, agentSuccess, agentError, humanLog,
} from '../../lib/agent-mode.js';

export interface VideoRejectOptions {
  project: string;
  shotId:  string;
  reason?: string;
  agent?:  boolean;
}

export async function videoRejectCommand(opts: VideoRejectOptions): Promise<void> {
  const projectPath = path.resolve(opts.project);
  const agentMode   = isAgentMode(opts.agent);
  const now         = new Date().toISOString();

  if (!opts.shotId) {
    const msg = '--shot <shot_id> is required';
    if (agentMode) { agentError(EXIT.INVALID_ARGS, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.INVALID_ARGS);
  }

  const statusMap = await getLatestState(projectPath);
  const record    = statusMap.get(opts.shotId);

  if (!record) {
    const msg = `Shot "${opts.shotId}" not found in status file.`;
    if (agentMode) { agentError(EXIT.NOT_FOUND, msg, { shotId: opts.shotId }); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.NOT_FOUND);
  }

  // ── Transition: complete → rejected → pending ─────────────────────────────
  const rejectionReason = opts.reason?.trim() || 'no reason provided';
  let rejectRecords: ReturnType<typeof transition>;
  try {
    rejectRecords = transition(record, 'REJECT', { rejection_reason: rejectionReason, now });
  } catch (err) {
    if (err instanceof StateConflictError) {
      const msg = `Shot "${opts.shotId}" cannot be rejected in state "${record.status}". Only complete shots may be rejected.`;
      if (agentMode) { agentError(EXIT.STATE_CONFLICT, msg, { shotId: opts.shotId }); } else { console.error(`✗ ${msg}`); }
      process.exit(EXIT.STATE_CONFLICT);
    }
    throw err;
  }

  await appendRecords(projectPath, rejectRecords);

  // ── Rename existing clip (atomic rename; never copy+delete) ───────────────
  const clipPath = record.clip_path
    ? path.resolve(projectPath, record.clip_path)
    : path.join(projectPath, 'video', 'clips', `${opts.shotId}.mp4`);

  const attemptN   = record.attempt_count;
  const archivedTo = await renameClipForRetry(clipPath, attemptN);

  humanLog(`✓ Shot "${opts.shotId}" rejected.`, agentMode);
  humanLog(`  Reason: ${rejectionReason}`, agentMode);
  humanLog(`  Clip archived to: ${archivedTo}`, agentMode);
  humanLog(`  Shot reverted to pending.`, agentMode);

  if (agentMode) {
    agentSuccess({
      shot_id:          opts.shotId,
      rejection_reason: rejectionReason,
      archived_clip:    archivedTo,
      new_status:       'pending',
    }, { shotId: opts.shotId });
  }

  process.exit(EXIT.SUCCESS);
}
