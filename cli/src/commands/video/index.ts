/**
 * cli/src/commands/video/index.ts
 *
 * `filmbuff video` sub-command group router.
 *
 * Registers all 10 video sub-commands onto the Commander `videoCmd` group.
 * All sub-commands share:
 *   -p, --project <path>  Project directory (default: CWD)
 *   --agent               Enable agent mode (JSON output, no prompts, no ANSI)
 *   --no-interactive      Alias for --agent
 *
 * Spec: openspec/changes/filmb-ai-p/specs/video-subcommands/spec.md
 * Beads: bd-92c1 (Phase 4 — WS-3) + bd-7767 (Phase 5)
 */

import { Command } from 'commander';
import { videoInitCommand }        from './init.js';
import { videoNextCommand }        from './next.js';
import { videoGenerateCommand,
         videoRetryCommand }       from './generate.js';
import { videoApproveCommand }     from './approve.js';
import { videoRejectCommand }      from './reject.js';
import { videoStatusCommand }      from './status.js';
import { videoCompileCommand }     from './compile.js';
import { videoReopenCommand }      from './reopen.js';
import { videoGenerateAllCommand } from './generate-all.js';

/** Shared project + agent flags applied to every sub-command. */
function addSharedFlags(cmd: Command): Command {
  return cmd
    .option('-p, --project <path>', 'Project directory', process.cwd())
    .option('--agent',            'Agent mode: JSON output, no prompts, no ANSI')
    .option('--no-interactive',   'Alias for --agent (enables agent mode)');
}

/**
 * Register the `filmbuff video` sub-command group onto the given program.
 * Returns the Commander Command object for the group (for testing or nesting).
 */
export function registerVideoCommands(program: Command): Command {
  const videoCmd = program
    .command('video')
    .description('Per-shot AI video generation commands');

  // ── video init ──────────────────────────────────────────────────────────
  addSharedFlags(
    videoCmd.command('init')
      .description('Create 08-video-status.jsonl; detect legacy clips; create video/clips/')
      .option('--overwrite', 'Reinitialize even if already initialized')
  ).action((options) =>
    videoInitCommand({
      project:   options.project,
      overwrite: options.overwrite ?? false,
      agent:     options.agent || options.noInteractive || false,
    })
  );

  // ── video next ──────────────────────────────────────────────────────────
  addSharedFlags(
    videoCmd.command('next')
      .description('Generate the next pending shot in original shot-list order')
      .option('--provider <id>',  'Video provider (default: runway-gen3)')
      .option('--no-wait',        'Submit only; do not poll for completion')
      .option('--timeout <secs>', 'Polling timeout in seconds', '600')
  ).action((options) =>
    videoNextCommand({
      project:   options.project,
      provider:  options.provider,
      noWait:    options.noWait ?? false,
      timeout:   parseInt(options.timeout ?? '600', 10),
      agent:     options.agent || options.noInteractive || false,
    })
  );

  // ── video generate ──────────────────────────────────────────────────────
  addSharedFlags(
    videoCmd.command('generate')
      .description('Generate a specific shot by ID')
      .requiredOption('--shot <shot_id>', 'Shot ID to generate (e.g. s001)')
      .option('--notes <text>',  'Additional notes appended to AI prompt (not persisted)')
      .option('--force',         'Cancel any in-flight job and start fresh')
      .option('--provider <id>', 'Video provider')
      .option('--no-wait',       'Submit only; do not poll for completion')
  ).action((options) =>
    videoGenerateCommand({
      project:  options.project,
      shotId:   options.shot,
      notes:    options.notes,
      force:    options.force ?? false,
      provider: options.provider,
      noWait:   options.noWait ?? false,
      agent:    options.agent || options.noInteractive || false,
    })
  );

  // ── video retry ─────────────────────────────────────────────────────────
  addSharedFlags(
    videoCmd.command('retry')
      .description('Retry a failed/rejected shot (alias for generate --force)')
      .requiredOption('--shot <shot_id>', 'Shot ID to retry')
      .option('--notes <text>',  'Additional notes for this attempt only')
      .option('--provider <id>', 'Video provider')
  ).action((options) =>
    videoRetryCommand({
      project:  options.project,
      shotId:   options.shot,
      notes:    options.notes,
      provider: options.provider,
      agent:    options.agent || options.noInteractive || false,
    })
  );

  // ── video approve ───────────────────────────────────────────────────────
  addSharedFlags(
    videoCmd.command('approve')
      .description('Mark shot(s) as approved')
      .option('--shot <shot_id>',  'Shot ID to approve (repeatable)',
        (val: string, prev: string[] = []) => [...prev, val])
      .option('--all-complete',    'Approve all shots currently in complete state')
  ).action((options) =>
    videoApproveCommand({
      project:     options.project,
      shots:       options.shot,
      allComplete: options.allComplete ?? false,
      agent:       options.agent || options.noInteractive || false,
    })
  );

  // ── video reject ────────────────────────────────────────────────────────
  addSharedFlags(
    videoCmd.command('reject')
      .description('Reject a shot; archive clip; revert to pending')
      .requiredOption('--shot <shot_id>', 'Shot ID to reject')
      .option('--reason <text>',          'Rejection reason (stored in status record)')
  ).action((options) =>
    videoRejectCommand({
      project: options.project,
      shotId:  options.shot,
      reason:  options.reason,
      agent:   options.agent || options.noInteractive || false,
    })
  );

  // ── video status ────────────────────────────────────────────────────────
  addSharedFlags(
    videoCmd.command('status')
      .description('Display per-shot status table (human) or JSON (agent/--json)')
      .option('--filter <state>', 'Show only shots in this state')
      .option('--json',           'Force JSON output')
  ).action((options) =>
    videoStatusCommand({
      project: options.project,
      filter:  options.filter,
      json:    options.json ?? false,
      agent:   options.agent || options.noInteractive || false,
    })
  );

  // ── video compile ───────────────────────────────────────────────────────
  addSharedFlags(
    videoCmd.command('compile')
      .description('Assemble approved shots into combined.mp4, index.html, project.zip')
      .option('--include <mode>',    'approved (default) | all-complete | all')
      .option('--title-cards',       'Insert 2-second scene title cards (default: true)')
      .option('--no-title-cards',    'Disable scene title cards')
      .option('--output-dir <path>', 'Output directory (default: video/output/)')
  ).action((options) =>
    videoCompileCommand({
      project:    options.project,
      include:    options.include,
      titleCards: options.titleCards !== false,
      outputDir:  options.outputDir,
      agent:      options.agent || options.noInteractive || false,
    })
  );

  // ── video reopen ────────────────────────────────────────────────────────
  addSharedFlags(
    videoCmd.command('reopen')
      .description('Re-open an approved shot for regeneration')
      .requiredOption('--shot <shot_id>', 'Shot ID to reopen')
      .option('--reason <text>',          'Reason for reopening (audit log)')
  ).action((options) =>
    videoReopenCommand({
      project: options.project,
      shotId:  options.shot,
      reason:  options.reason,
      agent:   options.agent || options.noInteractive || false,
    })
  );

  // ── video generate-all ──────────────────────────────────────────────────
  addSharedFlags(
    videoCmd.command('generate-all')
      .description('Batch-generate all pending shots until none remain')
      .option('--provider <id>',      'Video provider for all shots')
      .option('--concurrency <n>',    'Batch size limit (default: 1)', '1')
  ).action((options) =>
    videoGenerateAllCommand({
      project:     options.project,
      provider:    options.provider,
      concurrency: parseInt(options.concurrency ?? '1', 10),
      agent:       options.agent || options.noInteractive || false,
    })
  );

  return videoCmd;
}
