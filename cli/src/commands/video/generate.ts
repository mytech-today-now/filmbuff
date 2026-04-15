/**
 * cli/src/commands/video/generate.ts
 *
 * `filmbuff video generate` — generate a specific shot by ID.
 * `filmbuff video retry`    — alias with implicit --force.
 *
 * Exit codes:
 *   0  SUCCESS       — clip generated
 *   2  NOT_FOUND     — shot_id not in shot list or status not initialized
 *   3  INSUFFICIENT_CREDITS — credit exhaustion
 *   4  PROVIDER_ERROR — AI provider error
 *   5  STATE_CONFLICT — shot in non-pending state without --force
 *   6  INVALID_ARGS  — --shot missing
 *
 * Spec: openspec/changes/filmb-ai-p/specs/video-subcommands/spec.md §video generate
 * Beads: bd-92c1 (Phase 4 — WS-3)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLatestState, appendRecords } from '../../lib/status-file-manager.js';
import { findById } from '../../lib/shot-list-reader.js';
import { transition, StateConflictError } from '../../lib/shot-state-machine.js';
import type { VideoStatusRecord, ShotStatus } from '../../lib/shot-state-machine.js';
import {
  EXIT, isAgentMode, agentSuccess, agentError, humanLog, resolveAgentToken,
} from '../../lib/agent-mode.js';
import { generateSingleShot } from '../../lib/per-shot-api.js';

export interface VideoGenerateOptions {
  project:   string;
  shotId:    string;
  notes?:    string;
  force?:    boolean;
  provider?: string;
  noWait?:   boolean;
  agent?:    boolean;
}

/** States from which generation is allowed. With --force, 'generating' is also allowed. */
const GENERATABLE_STATUSES: ReadonlySet<ShotStatus> = new Set(['pending']);

export async function videoGenerateCommand(opts: VideoGenerateOptions): Promise<void> {
  const projectPath = path.resolve(opts.project);
  const agentMode   = isAgentMode(opts.agent);
  const provider    = opts.provider ?? process.env['FILMBUFF_DEFAULT_PROVIDER'] ?? 'runway-gen3';
  const clipsDir    = path.join(projectPath, 'video', 'clips');
  const now         = new Date().toISOString();

  // ── Validate required args ────────────────────────────────────────────────
  if (!opts.shotId) {
    const msg = '--shot <shot_id> is required';
    if (agentMode) { agentError(EXIT.INVALID_ARGS, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.INVALID_ARGS);
  }

  // ── Validate project + get shot ───────────────────────────────────────────
  const shot = await findById(projectPath, opts.shotId);
  if (!shot) {
    const msg = `Shot "${opts.shotId}" not found in 08-shot-list.jsonl`;
    if (agentMode) { agentError(EXIT.NOT_FOUND, msg, { shotId: opts.shotId }); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.NOT_FOUND);
  }

  // ── Check current state ───────────────────────────────────────────────────
  const statusMap     = await getLatestState(projectPath);
  const currentRecord = statusMap.get(opts.shotId);

  if (!currentRecord) {
    const msg = `Shot "${opts.shotId}" not in status file. Run \`filmbuff video init\` first.`;
    if (agentMode) { agentError(EXIT.NOT_FOUND, msg, { shotId: opts.shotId }); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.NOT_FOUND);
  }

  const allowedStatuses: ReadonlySet<ShotStatus> = opts.force
    ? new Set(['pending', 'generating', 'complete', 'failed', 'rejected'])
    : GENERATABLE_STATUSES;

  if (!allowedStatuses.has(currentRecord.status)) {
    const hint = currentRecord.status === 'approved'
      ? ' Use `filmbuff video reopen` first.'
      : currentRecord.status === 'generating'
      ? ' Use --force to cancel and restart.'
      : '';
    const msg = `Shot "${opts.shotId}" is in state "${currentRecord.status}".${hint}`;
    if (agentMode) { agentError(EXIT.STATE_CONFLICT, msg, { shotId: opts.shotId }); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.STATE_CONFLICT);
  }

  // ── If force and currently generating, log warning ────────────────────────
  if (opts.force && currentRecord.status === 'generating') {
    humanLog(`⚠  Cancelling in-flight job for ${opts.shotId} (--force)`, agentMode);
    // Append a failed record to close the generating state before re-submitting
    const failRecords = transition(currentRecord, 'FAIL', { now });
    await appendRecords(projectPath, failRecords);
    // Use the pending record as current
    Object.assign(currentRecord, failRecords[failRecords.length - 1]);
  }

  // If force on non-pending state (complete/failed/rejected), reset to pending
  if (opts.force && currentRecord.status !== 'pending') {
    humanLog(`⚠  Force-resetting shot ${opts.shotId} to pending state`, agentMode);
    const pendingRecord: VideoStatusRecord = {
      ...currentRecord,
      status: 'pending', provider: null, provider_job_id: null,
      clip_path: null, rejection_reason: null, updated_at: now,
    };
    await appendRecords(projectPath, [pendingRecord]);
    Object.assign(currentRecord, pendingRecord);
  }

  humanLog(`→ Generating shot ${opts.shotId} with provider ${provider}…`, agentMode);

  // ── Transition: pending → generating ─────────────────────────────────────
  const generatingRecords = transition(currentRecord, 'SUBMIT', { provider, now });
  await appendRecords(projectPath, generatingRecords);
  const generatingRecord = generatingRecords[0] as VideoStatusRecord;

  // ── Generate clip ─────────────────────────────────────────────────────────
  await fs.promises.mkdir(clipsDir, { recursive: true });
  const clipPath   = path.join(clipsDir, `${opts.shotId}.mp4`);
  const agentToken = resolveAgentToken();

  let result: Awaited<ReturnType<typeof generateSingleShot>>;
  try {
    result = await generateSingleShot({
      shot:       { ...shot, shot_id: shot.shot_id },
      provider,
      extraNotes: opts.notes,  // NEVER written to 08-shot-list.jsonl
      outputPath: clipPath,
      agentToken,              // NEVER logged; AC-27
    });
  } catch (err) {
    const failRecords = transition(generatingRecord, 'FAIL', { now: new Date().toISOString() });
    await appendRecords(projectPath, failRecords);
    const msg = `Provider error for shot ${opts.shotId}: ${(err as Error).message}`;
    if (agentMode) { agentError(EXIT.PROVIDER_ERROR, msg, { shotId: opts.shotId }); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.PROVIDER_ERROR);
  }

  const finalNow = new Date().toISOString();

  if (result.status === 'complete') {
    const completeRecords = transition(generatingRecord, 'COMPLETE', { clip_path: clipPath, now: finalNow });
    await appendRecords(projectPath, completeRecords);
    humanLog(`✓ Shot ${opts.shotId} generated: ${clipPath}`, agentMode);
    if (agentMode) {
      agentSuccess({ shot_id: opts.shotId, clip_path: clipPath, provider, job_id: result.jobId },
        { creditsSpent: result.creditsCharged, shotId: opts.shotId });
    }
    process.exit(EXIT.SUCCESS);
  } else {
    const failRecords = transition(generatingRecord, 'FAIL', { now: finalNow });
    await appendRecords(projectPath, failRecords);
    const errorMsg = result.errorMessage ?? 'unknown_provider_error';
    const exitCode = errorMsg === 'credit_exhaustion' ? EXIT.INSUFFICIENT_CREDITS : EXIT.PROVIDER_ERROR;
    const msg = `Provider ${provider} returned ${errorMsg} for shot ${opts.shotId}. Job ID: ${result.jobId}.`;
    if (agentMode) { agentError(exitCode, msg, { shotId: opts.shotId, creditsSpent: result.creditsCharged }); } else { console.error(`✗ ${msg}`); }
    process.exit(exitCode);
  }
}

/** `filmbuff video retry` — identical to generate with implicit --force. */
export async function videoRetryCommand(
  opts: Omit<VideoGenerateOptions, 'force'>,
): Promise<void> {
  return videoGenerateCommand({ ...opts, force: true });
}
