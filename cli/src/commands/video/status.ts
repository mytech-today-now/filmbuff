/**
 * cli/src/commands/video/status.ts
 *
 * `filmbuff video status` — display per-shot status.
 *
 * Human mode: formatted table (shot_id, status, provider, attempt, credits, updated_at)
 * Agent/JSON mode: structured JSON envelope (consumed by GET /api/projects/:id/video-status).
 *
 * Runs watchdog sweep before displaying status.
 *
 * --filter <state> shows only shots in specified state.
 * --json   forces JSON output even in human mode.
 *
 * Exit codes:
 *   0  SUCCESS — status displayed
 *   2  NOT_FOUND — status file not found (not initialized)
 *
 * Spec: openspec/changes/filmb-ai-p/specs/video-subcommands/spec.md §video status
 * Beads: bd-92c1 (Phase 4 — WS-3)
 */

import * as fs from 'fs';
import * as path from 'path';
import { runWatchdog } from '../../lib/watchdog.js';
import { readAll } from '../../lib/shot-list-reader.js';
import { getLatestState, getStatusFilePath } from '../../lib/status-file-manager.js';
import type { ShotStatus, VideoStatusRecord } from '../../lib/shot-state-machine.js';
import {
  EXIT, isAgentMode, agentSuccess, agentError, humanLog, warnLog,
} from '../../lib/agent-mode.js';

export interface VideoStatusOptions {
  project: string;
  filter?: string;
  json?:   boolean;
  agent?:  boolean;
}

const STATUS_SYMBOL: Record<ShotStatus, string> = {
  pending:    '○',
  generating: '⟳',
  complete:   '●',
  approved:   '✓',
  rejected:   '✗',
  failed:     '!',
};

export async function videoStatusCommand(opts: VideoStatusOptions): Promise<void> {
  const projectPath = path.resolve(opts.project);
  const agentMode   = isAgentMode(opts.agent) || (opts.json === true);
  const warnFn      = (msg: string) => warnLog(msg, agentMode);

  // ── Check status file exists ──────────────────────────────────────────────
  const statusFilePath = getStatusFilePath(projectPath);
  if (!fs.existsSync(statusFilePath)) {
    const msg = `Status file not found at ${statusFilePath}. Run \`filmbuff video init\` first.`;
    if (agentMode) { agentError(EXIT.NOT_FOUND, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.NOT_FOUND);
  }

  // ── 1. Watchdog sweep ─────────────────────────────────────────────────────
  await runWatchdog(projectPath, undefined, undefined, warnFn);

  // ── 2. Load data ──────────────────────────────────────────────────────────
  let shots: Awaited<ReturnType<typeof readAll>>;
  try { shots = await readAll(projectPath); } catch { shots = []; }
  const statusMap = await getLatestState(projectPath);

  // ── 3. Apply filter ───────────────────────────────────────────────────────
  const filterStatus = opts.filter as ShotStatus | undefined;
  const records: VideoStatusRecord[] = shots
    .map(s => statusMap.get(s.shot_id))
    .filter((r): r is VideoStatusRecord => r !== undefined)
    .filter(r => !filterStatus || r.status === filterStatus);

  // ── 4. Build counts ───────────────────────────────────────────────────────
  const counts: Record<string, number> = {
    pending: 0, generating: 0, complete: 0, approved: 0, rejected: 0, failed: 0,
  };
  for (const [, rec] of statusMap) {
    counts[rec.status] = (counts[rec.status] ?? 0) + 1;
  }

  // ── 5. Output ─────────────────────────────────────────────────────────────
  if (agentMode) {
    agentSuccess({
      total_shots: shots.length,
      counts,
      filter:      filterStatus ?? null,
      shots: records.map(r => ({
        shot_id:         r.shot_id,
        status:          r.status,
        provider:        r.provider,
        attempt_count:   r.attempt_count,
        credits_spent:   r.credits_spent,
        clip_path:       r.clip_path,
        updated_at:      r.updated_at,
      })),
    });
    process.exit(EXIT.SUCCESS);
  }

  // Human-readable table
  console.log('\n📽  FilmBuff — Video Status\n');
  if (filterStatus) {
    console.log(`Filter: ${filterStatus}\n`);
  }

  // Header
  const COLS = ['Shot', 'Status', 'Provider', 'Attempts', 'Credits', 'Updated'];
  const widths = [8, 12, 14, 9, 8, 22];
  const header = COLS.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const r of records) {
    const sym = STATUS_SYMBOL[r.status] ?? '?';
    const row = [
      r.shot_id.padEnd(widths[0]!),
      `${sym} ${r.status}`.padEnd(widths[1]!),
      (r.provider ?? '—').padEnd(widths[2]!),
      String(r.attempt_count).padEnd(widths[3]!),
      String(r.credits_spent).padEnd(widths[4]!),
      r.updated_at.slice(0, 19).replace('T', ' '),
    ].join('  ');
    console.log(row);
  }

  console.log('\nSummary:');
  for (const [state, count] of Object.entries(counts)) {
    if (count > 0) console.log(`  ${STATUS_SYMBOL[state as ShotStatus] ?? '?'} ${state}: ${count}`);
  }
  console.log('');

  process.exit(EXIT.SUCCESS);
}
