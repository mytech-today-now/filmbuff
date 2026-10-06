/**
 * cli/src/commands/video/reject.ts
 *
 * `filmbuff video reject` — mark a shot rejected; rename clip; revert to pending.
 *
 * Archives video/clips/{id}.mp4 as video/clips/{id}_attempt{N}.mp4.
 * Appends a durable intent, then complete→rejected (with reason) and rejected→pending.
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
import {
  archiveClipAndAppendLifecycleTransition,
  getLatestState,
  LifecycleTransitionError,
} from '../../lib/status-file-manager.js';
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

  let statusMap: Awaited<ReturnType<typeof getLatestState>>;
  try {
    statusMap = await getLatestState(projectPath);
  } catch (err: unknown) {
    if (!(err instanceof LifecycleTransitionError)) throw err;
    if (agentMode) { agentError(EXIT.GENERAL_ERROR, err.message, { shotId: err.shotId }); }
    else { console.error(`✗ ${err.message}`); }
    process.exit(EXIT.GENERAL_ERROR);
  }
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

  let archiveOutcome: Awaited<ReturnType<typeof archiveClipAndAppendLifecycleTransition>>['archiveOutcome'];
  try {
    ({ archiveOutcome } = await archiveClipAndAppendLifecycleTransition(
      projectPath,
      record,
      'reject',
      rejectRecords,
    ));
  } catch (err) {
    const msg = err instanceof Error
      ? err.message
      : `Failed to record reject transition for shot "${opts.shotId}": ${String(err)}`;
    if (agentMode) { agentError(EXIT.GENERAL_ERROR, msg, { shotId: opts.shotId }); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.GENERAL_ERROR);
  }

  humanLog(`✓ Shot "${opts.shotId}" rejected.`, agentMode);
  humanLog(`  Reason: ${rejectionReason}`, agentMode);
  if (archiveOutcome.kind === 'moved') {
    humanLog(`  Clip archived to: ${archiveOutcome.destinationPath}`, agentMode);
  } else {
    humanLog(`  Clip missing at source: ${archiveOutcome.sourcePath} (no archive created).`, agentMode);
  }
  humanLog(`  Shot reverted to pending.`, agentMode);

  if (agentMode) {
    agentSuccess({
      shot_id:          opts.shotId,
      rejection_reason: rejectionReason,
      archived_clip:    archiveOutcome.kind === 'moved' ? archiveOutcome.destinationPath : null,
      archive_result: {
        kind: archiveOutcome.kind,
        source_path: archiveOutcome.sourcePath,
        destination_path: archiveOutcome.destinationPath,
      },
      new_status:       'pending',
    }, { shotId: opts.shotId });
  }

  process.exit(EXIT.SUCCESS);
}
