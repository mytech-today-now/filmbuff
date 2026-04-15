/**
 * cli/src/commands/video/reopen.ts
 *
 * `filmbuff video reopen` — re-open an approved shot for regeneration.
 *
 * Transitions approved → pending.
 * Archives the approved clip with attempt naming convention.
 * Optional --reason <text> is logged in the new pending record.
 *
 * Exit codes:
 *   0  SUCCESS       — shot re-opened
 *   2  NOT_FOUND     — shot_id not found in status file
 *   5  STATE_CONFLICT — shot not in `approved` state
 *   6  INVALID_ARGS  — --shot missing
 *
 * Spec: openspec/changes/filmb-ai-p/specs/video-subcommands/spec.md §video reopen
 * Beads: bd-92c1 (Phase 4 — WS-3)
 */

import * as path from 'path';
import { getLatestState, appendRecords, renameClipForRetry } from '../../lib/status-file-manager.js';
import { transition, StateConflictError } from '../../lib/shot-state-machine.js';
import {
  EXIT, isAgentMode, agentSuccess, agentError, humanLog,
} from '../../lib/agent-mode.js';

export interface VideoReopenOptions {
  project: string;
  shotId:  string;
  reason?: string;
  agent?:  boolean;
}

export async function videoReopenCommand(opts: VideoReopenOptions): Promise<void> {
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

  // ── Archive the approved clip before transitioning ─────────────────────────
  const existingClipPath = record.clip_path
    ? path.resolve(projectPath, record.clip_path)
    : path.join(projectPath, 'video', 'clips', `${opts.shotId}.mp4`);

  const attemptN    = record.attempt_count;
  const archivedTo  = await renameClipForRetry(existingClipPath, attemptN);

  // ── Transition: approved → pending ────────────────────────────────────────
  let reopenRecords: ReturnType<typeof transition>;
  try {
    reopenRecords = transition(record, 'REOPEN', { now });
  } catch (err) {
    if (err instanceof StateConflictError) {
      const msg = `Shot "${opts.shotId}" cannot be re-opened in state "${record.status}". Only approved shots may be re-opened.`;
      if (agentMode) { agentError(EXIT.STATE_CONFLICT, msg, { shotId: opts.shotId }); } else { console.error(`✗ ${msg}`); }
      process.exit(EXIT.STATE_CONFLICT);
    }
    throw err;
  }

  // Add optional reason as a note in the pending record (audit trail)
  if (opts.reason) {
    const [pendingRecord] = reopenRecords;
    if (pendingRecord) {
      // Store reason in rejection_reason field for audit; will be cleared on next SUBMIT
      (pendingRecord as typeof pendingRecord & { reopen_reason?: string }).rejection_reason =
        `Reopened: ${opts.reason}`;
    }
  }

  await appendRecords(projectPath, reopenRecords);

  humanLog(`✓ Shot "${opts.shotId}" re-opened and reverted to pending.`, agentMode);
  if (opts.reason) humanLog(`  Reason: ${opts.reason}`, agentMode);
  humanLog(`  Approved clip archived to: ${archivedTo}`, agentMode);

  if (agentMode) {
    agentSuccess({
      shot_id:       opts.shotId,
      new_status:    'pending',
      archived_clip: archivedTo,
      reason:        opts.reason ?? null,
    }, { shotId: opts.shotId });
  }

  process.exit(EXIT.SUCCESS);
}
