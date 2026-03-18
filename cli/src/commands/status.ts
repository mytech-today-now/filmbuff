/**
 * filmbuff status — Display pipeline step statuses for a project.
 *
 * Reads all step statuses from the database only — no AI call, no filesystem
 * reads. Presents a table with status symbols by default.
 *
 * Options:
 *   --project <slug>   Project slug (or id)                  [required]
 *   --next             Show info about the next pending step
 *   --remaining        Show only pending/in-progress steps
 *   --completed        Show only completed/skipped steps
 *   --all              Show all steps (default behaviour)
 *   --format <fmt>     Output format: table (default) | json
 *
 * Satisfies: bd-pipe-c6 buff-core.03.01.06 - Implement filmbuff status command
 */

import chalk from 'chalk';
import {
  openDatabase,
  runMigrations,
  ProjectRepository,
  ProviderRepository,
  MIGRATIONS_DIR,
} from '../db/index.js';
import type { ProjectStep, StepStatus } from '../db/index.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface StatusOptions {
  project:    string;
  next?:      boolean;
  remaining?: boolean;
  completed?: boolean;
  all?:       boolean;
  format?:    'table' | 'json';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_SYMBOL: Record<StepStatus, string> = {
  pending:     '○',
  in_progress: '➤',
  completed:   '✓',
  failed:      '✗',
  skipped:     '—',
};

const STATUS_COLOUR: Record<StepStatus, (s: string) => string> = {
  pending:     (s) => chalk.gray(s),
  in_progress: (s) => chalk.cyan(s),
  completed:   (s) => chalk.green(s),
  failed:      (s) => chalk.red(s),
  skipped:     (s) => chalk.dim(s),
};

function formatStepRow(step: ProjectStep): string {
  const sym    = STATUS_SYMBOL[step.status] ?? '?';
  const colour = STATUS_COLOUR[step.status] ?? ((s: string) => s);
  const num    = String(step.step_number).padStart(2, ' ');
  const name   = step.step_name.padEnd(20, ' ');
  const status = step.status.padEnd(12, ' ');
  const extra  = step.output_file_path ? chalk.dim(` → ${step.output_file_path}`) : '';
  return colour(`  ${num}. ${sym}  ${name}  ${status}`) + extra;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function statusCommand(options: StatusOptions): Promise<void> {
  const db = openDatabase();
  runMigrations(db, MIGRATIONS_DIR);

  const projectRepo  = new ProjectRepository(db);
  const providerRepo = new ProviderRepository(db);

  // Resolve project
  const project =
    projectRepo.findBySlug(options.project) ??
    projectRepo.findById(options.project);

  if (!project) {
    console.error(chalk.red(`✗ Project not found: "${options.project}"`));
    console.error(chalk.gray('  Use filmbuff start to create a new project.'));
    process.exit(1);
    return;
  }

  const steps = projectRepo.getSteps(project.id);

  // --format json — machine-readable dump
  if (options.format === 'json') {
    const active = providerRepo.getActiveSelection();
    const payload = {
      project: {
        id:           project.id,
        slug:         project.slug,
        display_title: project.display_title,
        genre:        project.genre,
        status:       project.status,
        active_provider_id:  active?.provider_id  ?? project.active_provider_id,
        active_profile_name: active?.profile_name ?? project.active_profile_name,
      },
      steps: steps.map((s) => ({
        step_number:      s.step_number,
        step_name:        s.step_name,
        status:           s.status,
        output_file_path: s.output_file_path,
        output_format:    s.output_format,
        accepted_at:      s.accepted_at,
        failed_at:        s.failed_at,
        failure_reason:   s.failure_reason,
        retry_count:      s.retry_count,
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  // --next — info about the next pending step
  if (options.next) {
    const nextStep = steps.find(
      (s) => s.status === 'pending' || s.status === 'in_progress',
    );
    if (!nextStep) {
      console.log(chalk.green('✓ No pending steps — project pipeline is complete.'));
      return;
    }
    const active = providerRepo.getActiveSelection();
    const providerId  = active?.provider_id  ?? project.active_provider_id  ?? '(none)';
    const profileName = active?.profile_name ?? project.active_profile_name ?? '(none)';
    console.log();
    console.log(chalk.bold('Next pending step:'));
    console.log(`  Step ${nextStep.step_number}: ${chalk.cyan(nextStep.step_name)}`);
    console.log(`  Status:   ${STATUS_COLOUR[nextStep.status](nextStep.status)}`);
    console.log(`  Provider: ${providerId}  Profile: ${profileName}`);
    console.log();
    console.log(chalk.bold('Run:'));
    console.log(`  filmbuff continue --project ${project.slug}`);
    console.log();
    return;
  }

  // Filter steps based on flags
  let filtered = steps;
  if (options.remaining) {
    filtered = steps.filter(
      (s) => s.status === 'pending' || s.status === 'in_progress',
    );
  } else if (options.completed) {
    filtered = steps.filter(
      (s) => s.status === 'completed' || s.status === 'skipped',
    );
  }

  // Default table output
  console.log();
  console.log(
    chalk.bold.blue(`🎬 FilmBuff — ${project.display_title}`) +
    chalk.gray(` [${project.slug}]`) +
    `  ${project.status === 'completed' ? chalk.green('● complete') : chalk.cyan('● active')}`,
  );
  console.log();
  console.log(chalk.dim('  #   sym  step name             status'));
  console.log(chalk.dim('  ─────────────────────────────────────────────'));

  for (const step of filtered) {
    console.log(formatStepRow(step));
  }

  const done    = steps.filter((s) => s.status === 'completed').length;
  const skipped = steps.filter((s) => s.status === 'skipped').length;
  const failed  = steps.filter((s) => s.status === 'failed').length;
  const pending = steps.filter((s) => s.status === 'pending').length;

  console.log();
  console.log(
    chalk.dim(`  Total ${steps.length}  `) +
    chalk.green(`${done} completed  `) +
    (skipped  ? chalk.dim(`${skipped} skipped  `)  : '') +
    (failed   ? chalk.red(`${failed} failed  `)   : '') +
    chalk.gray(`${pending} pending`),
  );

  const nextPending = steps.find(
    (s) => s.status === 'pending' || s.status === 'in_progress',
  );
  if (nextPending) {
    console.log();
    console.log(
      chalk.cyan(`Next: filmbuff continue --project ${project.slug}`) +
      chalk.dim(`  (step ${nextPending.step_number}: ${nextPending.step_name})`),
    );
  }
  console.log();
}

