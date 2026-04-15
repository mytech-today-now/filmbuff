/**
 * cli/src/commands/video/next.ts
 *
 * `filmbuff video next`
 *
 * Finds the first `pending` shot in original 08-shot-list.jsonl order,
 * submits to the AI provider, polls for completion, and downloads the MP4.
 * Runs the watchdog sweep before processing.
 *
 * Exit codes:
 *   0  SUCCESS       — clip generated (or no pending shots remain)
 *   2  NOT_FOUND     — 08-shot-list.jsonl not found
 *   3  INSUFFICIENT_CREDITS — credit exhaustion reported by provider
 *   4  PROVIDER_ERROR — AI provider API error / timeout
 *   5  STATE_CONFLICT — unexpected state (should not occur normally)
 *   6  INVALID_ARGS  — project directory not accessible
 *
 * Spec: openspec/changes/filmb-ai-p/specs/video-subcommands/spec.md §video next
 * Beads: bd-92c1 (Phase 4 — WS-3)
 */

import * as fs from 'fs';
import * as path from 'path';
import { runWatchdog } from '../../lib/watchdog.js';
import { getLatestState } from '../../lib/status-file-manager.js';
import { findNextPending } from '../../lib/shot-list-reader.js';
import { appendRecords } from '../../lib/status-file-manager.js';
import { transition } from '../../lib/shot-state-machine.js';
import type { VideoStatusRecord } from '../../lib/shot-state-machine.js';
import {
  EXIT, isAgentMode, agentSuccess, agentError, humanLog, warnLog, resolveAgentToken,
} from '../../lib/agent-mode.js';
import { generateSingleShot } from '../../lib/per-shot-api.js';

export interface VideoNextOptions {
  project:   string;
  provider?: string;
  noWait?:   boolean;
  timeout?:  number;
  agent?:    boolean;
}

export async function videoNextCommand(opts: VideoNextOptions): Promise<void> {
  const projectPath = path.resolve(opts.project);
  const agentMode   = isAgentMode(opts.agent);
  const provider    = opts.provider ?? process.env['FILMBUFF_DEFAULT_PROVIDER'] ?? 'runway-gen3';
  const timeoutMs   = (opts.timeout ?? 600) * 1_000;
  const clipsDir    = path.join(projectPath, 'video', 'clips');
  const now         = new Date().toISOString();

  if (!fs.existsSync(projectPath)) {
    const msg = `Project directory not found: ${projectPath}`;
    if (agentMode) { agentError(EXIT.INVALID_ARGS, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.INVALID_ARGS);
  }

  // ── 1. Watchdog sweep ─────────────────────────────────────────────────────
  const warnFn = (msg: string) => warnLog(msg, agentMode);
  await runWatchdog(projectPath, undefined, undefined, warnFn);

  // ── 2. Find next pending shot ─────────────────────────────────────────────
  const statusMap = await getLatestState(projectPath);
  const shot      = await findNextPending(projectPath, statusMap);

  if (!shot) {
    humanLog('✓ All shots have been generated.', agentMode);
    if (agentMode) {
      agentSuccess({ all_generated: true, pending_count: 0 });
    }
    process.exit(EXIT.SUCCESS);
  }

  humanLog(`→ Generating shot ${shot.shot_id} with provider ${provider}…`, agentMode);

  // ── 3. Transition pending → generating ───────────────────────────────────
  const currentRecord = statusMap.get(shot.shot_id)!;
  const generatingRecords = transition(currentRecord, 'SUBMIT', { provider, now });
  await appendRecords(projectPath, generatingRecords);
  const generatingRecord = generatingRecords[0] as VideoStatusRecord;

  // ── 4. Generate clip ──────────────────────────────────────────────────────
  const clipPath   = path.join(clipsDir, `${shot.shot_id}.mp4`);
  const agentToken = resolveAgentToken();

  let result: Awaited<ReturnType<typeof generateSingleShot>>;
  try {
    result = await generateSingleShot({
      shot: { ...shot, shot_id: shot.shot_id },
      provider,
      outputPath: clipPath,
      timeoutMs,
      agentToken,  // NEVER logged; AC-27
    });
  } catch (err) {
    // Transition: generating → failed → pending
    const failRecords = transition(generatingRecord, 'FAIL', { now: new Date().toISOString() });
    await appendRecords(projectPath, failRecords);
    const msg = `Provider error for shot ${shot.shot_id}: ${(err as Error).message}`;
    if (agentMode) { agentError(EXIT.PROVIDER_ERROR, msg, { shotId: shot.shot_id }); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.PROVIDER_ERROR);
  }

  const finalNow = new Date().toISOString();

  if (result.status === 'complete') {
    const completeRecords = transition(generatingRecord, 'COMPLETE', {
      clip_path: clipPath, now: finalNow,
    });
    await appendRecords(projectPath, completeRecords);
    humanLog(`✓ Shot ${shot.shot_id} generated: ${clipPath}`, agentMode);
    if (agentMode) {
      agentSuccess({
        shot_id:   shot.shot_id,
        clip_path: clipPath,
        provider,
        job_id:    result.jobId,
        duration_seconds: result.durationSeconds,
        resolution:       result.resolution,
      }, { creditsSpent: result.creditsCharged, shotId: shot.shot_id });
    }
    process.exit(EXIT.SUCCESS);
  } else {
    // Provider returned failed
    const failRecords = transition(generatingRecord, 'FAIL', { now: finalNow });
    await appendRecords(projectPath, failRecords);
    const errorMsg   = result.errorMessage ?? 'unknown_provider_error';
    const exitCode   = errorMsg === 'credit_exhaustion' ? EXIT.INSUFFICIENT_CREDITS : EXIT.PROVIDER_ERROR;
    const msg        = `Provider ${provider} returned ${errorMsg} for shot ${shot.shot_id}. Job ID: ${result.jobId}.`;
    if (agentMode) { agentError(exitCode, msg, { shotId: shot.shot_id, creditsSpent: result.creditsCharged }); } else { console.error(`✗ ${msg}`); }
    process.exit(exitCode);
  }
}
