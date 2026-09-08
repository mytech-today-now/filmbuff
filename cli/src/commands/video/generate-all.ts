/**
 * cli/src/commands/video/generate-all.ts
 *
 * `filmbuff video generate-all`
 *
 * Loops `filmbuff video next` until no pending shots remain.
 * Equivalent to the old batch behavior using the per-shot state machine.
 *
 * --provider <id>       Provider to use for all shots.
 * --concurrency <n>     Batch size limit (default: 1).
 *
 * Exit codes:
 *   0  SUCCESS           — all shots generated (or were already generated)
 *   3  INSUFFICIENT_CREDITS — credit exhaustion; stops loop
 *   4  PROVIDER_ERROR    — provider error on a shot; continues with next
 *   6  INVALID_ARGS      — project not accessible
 *
 * Spec: openspec/changes/filmb-ai-p/specs/video-subcommands/spec.md §video generate-all
 * Beads: bd-92c1 (Phase 4 — WS-3)
 */

import * as path from 'path';
import { runWatchdog } from '../../lib/watchdog.js';
import { getLatestState, appendRecords } from '../../lib/status-file-manager.js';
import { findByStatus } from '../../lib/shot-list-reader.js';
import { transition } from '../../lib/shot-state-machine.js';
import type { VideoStatusRecord } from '../../lib/shot-state-machine.js';
import {
  EXIT, isAgentMode, agentSuccess, agentError, humanLog, warnLog, resolveAgentToken,
} from '../../lib/agent-mode.js';
import { generateSingleShot } from '../../lib/per-shot-api.js';
import * as fsPromises from 'fs/promises';

export interface VideoGenerateAllOptions {
  project:      string;
  provider?:    string;
  concurrency?: number;
  agent?:       boolean;
}

export async function videoGenerateAllCommand(opts: VideoGenerateAllOptions): Promise<void> {
  const projectPath   = path.resolve(opts.project);
  const agentMode     = isAgentMode(opts.agent);
  const provider      = opts.provider ?? process.env['FILMBUFF_DEFAULT_PROVIDER'] ?? 'runway-gen3';
  const concurrency   = Math.max(1, opts.concurrency ?? 1);
  const clipsDir      = path.join(projectPath, 'video', 'clips');
  const warnFn        = (msg: string) => warnLog(msg, agentMode);
  const agentToken    = resolveAgentToken();

  await fsPromises.mkdir(clipsDir, { recursive: true });

  humanLog(`→ generate-all: provider=${provider}, concurrency=${concurrency}`, agentMode);

  let totalGenerated  = 0;
  let totalFailed     = 0;
  let totalCredits    = 0;
  let creditExhausted = false;
  let statusMap       = new Map<string, VideoStatusRecord>();

  async function processShot(shot: Awaited<ReturnType<typeof findByStatus>>[number]): Promise<boolean> {
    const currentRecord = statusMap.get(shot.shot_id)!;
    const clipPath      = path.join(clipsDir, `${shot.shot_id}.mp4`);
    const submitNow     = new Date().toISOString();

    // Transition: pending → generating
    const generatingRecords = transition(currentRecord, 'SUBMIT', { provider, now: submitNow });
    await appendRecords(projectPath, generatingRecords);
    const generatingRecord = generatingRecords[0] as VideoStatusRecord;

    let result: Awaited<ReturnType<typeof generateSingleShot>>;
    try {
      result = await generateSingleShot({
        shot:       { ...shot, shot_id: shot.shot_id },
        provider,
        outputPath: clipPath,
        agentToken,  // NEVER logged; AC-27
      });
    } catch (err) {
      const failRecords = transition(generatingRecord, 'FAIL', { now: new Date().toISOString() });
      await appendRecords(projectPath, failRecords);
      totalFailed++;
      warnFn(`⚠ Shot ${shot.shot_id} error: ${(err as Error).message}`);
      return false;
    }

    const finalNow = new Date().toISOString();
    if (result.status === 'complete') {
      const completeRecs = transition(generatingRecord, 'COMPLETE', { clip_path: clipPath, now: finalNow });
      await appendRecords(projectPath, completeRecs);
      totalGenerated++;
      totalCredits += result.creditsCharged ?? 0;
      humanLog(`✓ ${shot.shot_id} complete`, agentMode);
      return false;
    }

    const failRecords = transition(generatingRecord, 'FAIL', { now: finalNow });
    await appendRecords(projectPath, failRecords);
    totalFailed++;
    const errorMsg = result.errorMessage ?? 'unknown';
    warnFn(`⚠ Shot ${shot.shot_id} failed: ${errorMsg}`);
    return errorMsg === 'credit_exhaustion' || errorMsg === 'quota_exceeded';
  }

  // Main loop: keep going until no pending shots remain.
  // Shots within a batch are processed sequentially so credit exhaustion can
  // stop the remaining pending work before it submits.
  while (!creditExhausted) {
    // Run watchdog before each batch
    await runWatchdog(projectPath, undefined, undefined, warnFn);

    statusMap = await getLatestState(projectPath);
    const pendingShots = await findByStatus(projectPath, statusMap, 'pending');

    if (pendingShots.length === 0) break;

    // Take up to `concurrency` shots per iteration
    const batch = pendingShots.slice(0, concurrency);
    for (const shot of batch) {
      if (creditExhausted) break;
      creditExhausted = await processShot(shot);
      if (creditExhausted) break;
    }
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  const finalStatusMap = await getLatestState(projectPath);
  const pendingRemaining = [...finalStatusMap.values()].filter(r => r.status === 'pending').length;
  const totalShots       = finalStatusMap.size;

  if (creditExhausted) {
    const msg = `Credit exhaustion detected. ${pendingRemaining} shots still pending.`;
    if (agentMode) {
      agentError(EXIT.INSUFFICIENT_CREDITS, msg, { creditsSpent: totalCredits });
    } else {
      console.error(`✗ ${msg}`);
    }
    process.exit(EXIT.INSUFFICIENT_CREDITS);
  }

  humanLog(`✓ generate-all complete: ${totalGenerated} generated, ${totalFailed} failed.`, agentMode);

  if (agentMode) {
    agentSuccess({
      total_shots:       totalShots,
      generated:         totalGenerated,
      failed:            totalFailed,
      pending_remaining: pendingRemaining,
      provider,
    }, { creditsSpent: totalCredits });
  }

  process.exit(EXIT.SUCCESS);
}
