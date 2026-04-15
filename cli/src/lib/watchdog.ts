/**
 * cli/src/lib/watchdog.ts
 *
 * Watchdog: scan all "generating" shots and transition timed-out ones
 * via failed → pending.
 *
 * Spec: openspec/changes/filmb-ai-p/specs/shot-state-machine/spec.md
 *       §Watchdog Timeout
 * Beads: bd-b3e9 (Phase 3 — WS-2)
 *
 * The watchdog runs at the START of every `filmbuff video next` and
 * `filmbuff video status` invocation (per spec).
 *
 * Algorithm (spec §Watchdog Algorithm):
 *   1. Read all shots whose current status is "generating".
 *   2. For each, compute elapsed = now - updated_at (of the generating record).
 *   3. If elapsed > watchdogTimeoutMs:
 *      a. Append a "failed" record (failed_at = now).
 *      b. Append a "pending" record immediately after.
 *      c. Emit a warning identifying the shot and elapsed time.
 *   4. Return a summary of timed-out shots.
 *
 * Configuration:
 *   FILMBUFF_WATCHDOG_TIMEOUT_MS env var overrides default 600_000 ms.
 */

import { transition, type VideoStatusRecord } from './shot-state-machine.js';
import { getLatestState, appendRecords } from './status-file-manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WatchdogResult {
  /** Number of shots that were timed out and reset to pending. */
  timedOutCount: number;
  /** shot_id values for timed-out shots. */
  timedOutShots: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the watchdog timeout from env var, falling back to 600_000 ms.
 */
export function getWatchdogTimeoutMs(): number {
  const envVal = process.env['FILMBUFF_WATCHDOG_TIMEOUT_MS'];
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 600_000;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the watchdog sweep for all shots in "generating" state.
 *
 * Emits warnings to the provided `warn` function (defaults to console.warn).
 * Appends failed + pending records for timed-out shots via appendRecords().
 *
 * @param projectPath       Absolute path to the project directory.
 * @param watchdogTimeoutMs Timeout in ms. Reads from env if not supplied.
 * @param nowMs             Current timestamp in ms (injectable for tests).
 * @param warn              Warning output function (injectable for tests).
 */
export async function runWatchdog(
  projectPath: string,
  watchdogTimeoutMs: number = getWatchdogTimeoutMs(),
  nowMs: number = Date.now(),
  warn: (msg: string) => void = (msg) => console.warn(msg),
): Promise<WatchdogResult> {
  const statusMap = await getLatestState(projectPath);
  const nowIso = new Date(nowMs).toISOString();

  const timedOutShots: string[] = [];

  for (const [shotId, record] of statusMap) {
    if (record.status !== 'generating') continue;

    const updatedAtMs = new Date(record.updated_at).getTime();
    const elapsed     = nowMs - updatedAtMs;

    if (elapsed > watchdogTimeoutMs) {
      // Transition: generating → failed → pending (two records)
      const records = transition(record, 'FAIL', { now: nowIso });

      await appendRecords(projectPath, records);
      timedOutShots.push(shotId);

      const elapsedSec = (elapsed / 1_000).toFixed(0);
      warn(
        `[watchdog] Shot "${shotId}" timed out after ${elapsedSec}s ` +
        `(limit: ${(watchdogTimeoutMs / 1_000).toFixed(0)}s). Reset to pending.`,
      );
    }
  }

  return { timedOutCount: timedOutShots.length, timedOutShots };
}
