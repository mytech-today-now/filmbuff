/**
 * cli/src/commands/video/approve.ts
 *
 * `filmbuff video approve` — mark shot(s) as approved.
 *
 * Only shots in `complete` status may be approved.
 * --shot <id> is repeatable (multiple shots in one call).
 * --all-complete approves all shots currently in `complete` status.
 *
 * Exit codes:
 *   0  SUCCESS       — all specified shots approved
 *   2  NOT_FOUND     — shot_id not found in status file
 *   5  STATE_CONFLICT — shot not in `complete` state
 *   6  INVALID_ARGS  — neither --shot nor --all-complete provided
 *
 * Spec: openspec/changes/filmb-ai-p/specs/video-subcommands/spec.md §video approve
 * Beads: bd-92c1 (Phase 4 — WS-3)
 */

import * as path from 'path';
import { getLatestState, appendRecords } from '../../lib/status-file-manager.js';
import { transition, StateConflictError } from '../../lib/shot-state-machine.js';
import type { VideoStatusRecord } from '../../lib/shot-state-machine.js';
import {
  EXIT, isAgentMode, agentSuccess, agentError, humanLog,
} from '../../lib/agent-mode.js';

export interface VideoApproveOptions {
  project:      string;
  shots?:       string[];    // --shot is repeatable
  allComplete?: boolean;
  agent?:       boolean;
}

export async function videoApproveCommand(opts: VideoApproveOptions): Promise<void> {
  const projectPath = path.resolve(opts.project);
  const agentMode   = isAgentMode(opts.agent);
  const now         = new Date().toISOString();

  // ── Validate args ─────────────────────────────────────────────────────────
  const hasShots      = opts.shots && opts.shots.length > 0;
  const hasAllComplete = opts.allComplete === true;

  if (!hasShots && !hasAllComplete) {
    const msg = 'Provide at least one --shot <id> or use --all-complete';
    if (agentMode) { agentError(EXIT.INVALID_ARGS, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.INVALID_ARGS);
  }

  // ── Load status map ───────────────────────────────────────────────────────
  const statusMap = await getLatestState(projectPath);

  // ── Determine target shots ────────────────────────────────────────────────
  let targetShotIds: string[];

  if (hasAllComplete) {
    targetShotIds = [...statusMap.entries()]
      .filter(([, rec]) => rec.status === 'complete')
      .map(([id]) => id);

    if (targetShotIds.length === 0) {
      const msg = 'No shots are in `complete` state.';
      if (agentMode) {
        agentSuccess({ approved_this_call: 0, message: msg });
      } else {
        console.log(`ℹ  ${msg}`);
      }
      process.exit(EXIT.SUCCESS);
    }
  } else {
    targetShotIds = opts.shots!;
  }

  // ── Approve each shot ─────────────────────────────────────────────────────
  const approved: string[]  = [];
  const failures: Array<{ shotId: string; reason: string }> = [];

  for (const shotId of targetShotIds) {
    const record = statusMap.get(shotId);
    if (!record) {
      failures.push({ shotId, reason: `not found in status file` });
      continue;
    }
    try {
      const approvedRecords = transition(record, 'APPROVE', { now });
      await appendRecords(projectPath, approvedRecords);
      approved.push(shotId);
      humanLog(`✓ Approved: ${shotId}`, agentMode);
    } catch (err) {
      if (err instanceof StateConflictError) {
        failures.push({ shotId, reason: `state conflict — current status: ${record.status}` });
      } else {
        failures.push({ shotId, reason: (err as Error).message });
      }
    }
  }

  // ── Handle failures ───────────────────────────────────────────────────────
  if (failures.length > 0 && approved.length === 0) {
    // All failed
    const firstFailure = failures[0];
    const code = statusMap.get(firstFailure.shotId) ? EXIT.STATE_CONFLICT : EXIT.NOT_FOUND;
    const msg  = failures.map(f => `${f.shotId}: ${f.reason}`).join('; ');
    if (agentMode) { agentError(code, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(code);
  }

  if (failures.length > 0) {
    for (const f of failures) {
      if (agentMode) {
        process.stderr.write(`Warning: ${f.shotId}: ${f.reason}\n`);
      } else {
        console.warn(`⚠  ${f.shotId}: ${f.reason}`);
      }
    }
  }

  // Compute total approved count from latest state
  const updatedMap  = await getLatestState(projectPath);
  const totalApproved = [...updatedMap.values()].filter(r => r.status === 'approved').length;
  const totalShots    = updatedMap.size;

  if (agentMode) {
    agentSuccess({
      approved_this_call: approved.length,
      total_approved:     totalApproved,
      total_shots:        totalShots,
    });
  } else {
    console.log(`✓ Approved ${approved.length} shot(s). Total approved: ${totalApproved}/${totalShots}.`);
  }

  process.exit(EXIT.SUCCESS);
}
