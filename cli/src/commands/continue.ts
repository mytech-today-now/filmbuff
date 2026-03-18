/**
 * filmbuff continue — Resume a FilmBuff project at its next pending step.
 *
 * Looks up the project, identifies the first pending pipeline step, assembles
 * context from all prior completed steps (project metadata + prior documents),
 * and records the CLI invocation as a session.
 *
 * Context assembly order (per buff-core spec):
 *   1. project_metadata  — core project fields as JSON
 *   2. prior_document    — one snapshot per previously accepted step output,
 *                          ordered by step_number ASC
 *
 * Satisfies: bd-pipe-c2 buff-core.03.01.02 - Implement filmbuff continue
 *            command with context assembly
 */

import chalk from 'chalk';
import * as crypto from 'crypto';
import * as fs from 'fs';
import {
  openDatabase,
  runMigrations,
  ProjectRepository,
  DocumentRepository,
  SessionRepository,
  MIGRATIONS_DIR,
} from '../db/index.js';
import type { Project, ProjectStep, ContextSnapshotInput } from '../db/index.js';

// ---------------------------------------------------------------------------
// Public options interface
// ---------------------------------------------------------------------------

export interface ContinueOptions {
  project:   string;   // slug or id
  provider?: string;
  profile?:  string;
  dryRun?:   boolean;
}

// ---------------------------------------------------------------------------
// Context assembly helpers
// ---------------------------------------------------------------------------

/**
 * Build a project_metadata context snapshot from the project row.
 */
function buildMetadataSnapshot(
  project: Project,
  attemptId: string,
  order: number,
): ContextSnapshotInput {
  const content = JSON.stringify({
    id:             project.id,
    slug:           project.slug,
    display_title:  project.display_title,
    genre:          project.genre,
    tone:           project.tone,
    target_audience:project.target_audience,
    budget_tier:    project.budget_tier,
    outcome:        project.outcome,
    detail_level:   project.detail_level,
  }, null, 2);

  return {
    id:                    crypto.randomUUID(),
    generation_attempt_id: attemptId,
    context_type:          'project_metadata',
    content,
    sequence_order:        order,
  };
}

/**
 * Build prior_document snapshots from files written by completed steps.
 */
function buildPriorDocumentSnapshots(
  steps: ProjectStep[],
  attemptId: string,
  startOrder: number,
): ContextSnapshotInput[] {
  const snapshots: ContextSnapshotInput[] = [];
  let order = startOrder;

  for (const step of steps) {
    if (step.status !== 'completed' || !step.output_file_path) continue;
    let content: string;
    try {
      content = fs.readFileSync(step.output_file_path, 'utf-8');
    } catch {
      // File may not exist in dry-run or test scenarios — skip gracefully
      continue;
    }
    snapshots.push({
      id:                    crypto.randomUUID(),
      generation_attempt_id: attemptId,
      context_type:          'prior_document',
      source_step_name:      step.step_name,
      content,
      sequence_order:        order++,
    });
  }
  return snapshots;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function continueCommand(options: ContinueOptions): Promise<void> {
  console.log(chalk.bold.blue('\n🎬 FilmBuff — Continuing project\n'));

  const db = openDatabase();
  runMigrations(db, MIGRATIONS_DIR);

  const projectRepo  = new ProjectRepository(db);
  const sessionRepo  = new SessionRepository(db);

  // Resolve project by slug or id
  const project =
    projectRepo.findBySlug(options.project) ??
    projectRepo.findById(options.project);

  if (!project) {
    console.error(chalk.red(`✗ Project not found: "${options.project}"`));
    console.error(chalk.gray('  Use filmbuff start to create a new project.'));
    process.exit(1);
    return;
  }

  const sessionId = crypto.randomUUID();
  sessionRepo.recordSession({
    id:          sessionId,
    project_id:  project.id,
    command:     'continue',
    flags:       options as unknown as Record<string, unknown>,
    provider_id: options.provider ?? project.active_provider_id ?? undefined,
    profile_name: options.profile ?? project.active_profile_name ?? undefined,
  });

  try {
    const steps = projectRepo.getSteps(project.id);
    const nextStep = steps.find(s => s.status === 'pending' || s.status === 'in_progress');

    if (!nextStep) {
      console.log(chalk.yellow('⚠ All pipeline steps are completed for this project.'));
      console.log(chalk.gray('  Use filmbuff status --project ' + project.slug + ' to review.'));
      sessionRepo.completeSession(sessionId, 0);
      return;
    }

    // Assemble context
    const completedSteps = steps.filter(
      s => s.step_number < nextStep.step_number,
    );

    // Use a placeholder attempt ID for snapshot grouping (will be replaced when
    // the actual generation_attempt row is created by the pipeline runner).
    const placeholderAttemptId = crypto.randomUUID();
    const metaSnapshot  = buildMetadataSnapshot(project, placeholderAttemptId, 0);
    const priorDocSnaps = buildPriorDocumentSnapshots(completedSteps, placeholderAttemptId, 1);
    const allSnapshots  = [metaSnapshot, ...priorDocSnaps];

    // Persist snapshots unless dry-run
    if (!options.dryRun) {
      for (const snap of allSnapshots) {
        sessionRepo.recordContextSnapshot(snap);
      }
    }

    sessionRepo.completeSession(sessionId, 0);

    console.log(chalk.green(`✓ Project: ${project.display_title} (${project.slug})`));
    console.log(chalk.green(`✓ Next step: [${nextStep.step_number}] ${nextStep.step_name}`));
    console.log(chalk.green(`✓ Context assembled: ${allSnapshots.length} snapshot(s)`));
    if (options.dryRun) {
      console.log(chalk.yellow('  (dry-run — snapshots not persisted)'));
    }
    console.log();
    console.log(chalk.cyan(`Run the pipeline for step "${nextStep.step_name}" to generate output.`));
    console.log();

  } catch (err) {
    sessionRepo.completeSession(sessionId, 1,
      err instanceof Error ? err.message : String(err));
    console.error(chalk.red('✗ Failed to continue project:'),
      err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

