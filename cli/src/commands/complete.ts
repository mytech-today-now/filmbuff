/**
 * filmbuff complete — Mark a pipeline step (or the whole project) as complete.
 *
 * Use this command when you have already reviewed the AI-generated output and
 * want to accept it without going through the interactive review prompt, or to
 * manually supply an edited file as the accepted output.
 *
 * Behaviour:
 *   1. Saves the file at --file as a new DocumentRevision (current=1).
 *   2. Marks the project_step as 'completed' with accepted_at timestamp.
 *   3. If all steps are now completed/skipped, marks the project 'completed'.
 *
 * Options:
 *   --project <slug>   Project slug (or id)                  [required]
 *   --step    <name>   Pipeline step to complete             [required]
 *   --file    <path>   Path to the accepted output file      [required]
 *   --format  <fmt>    Document format (md|json|fountain|pdf)[optional, default: md]
 *   --notes   <text>   Revision notes                        [optional]
 *   --provider <id>    AI provider used (for session record)  [optional]
 *   --profile  <name>  AI provider profile (for session)     [optional]
 *
 * Satisfies: bd-pipe-c5 buff-core.03.01.05 - Implement filmbuff complete command
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
import type { DocumentFormat, PipelineStepName } from '../db/index.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CompleteOptions {
  project:   string;
  step:      PipelineStepName;
  file:      string;
  format?:   DocumentFormat;
  notes?:    string;
  provider?: string;
  profile?:  string;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function completeCommand(options: CompleteOptions): Promise<void> {
  console.log(chalk.bold.blue('\n🎬 FilmBuff — Completing pipeline step\n'));

  // Validate file exists before touching the database
  if (!fs.existsSync(options.file)) {
    console.error(chalk.red(`✗ Output file not found: "${options.file}"`));
    process.exit(1);
    return;
  }

  const db = openDatabase();
  runMigrations(db, MIGRATIONS_DIR);

  const projectRepo  = new ProjectRepository(db);
  const documentRepo = new DocumentRepository(db);
  const sessionRepo  = new SessionRepository(db);

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

  const sessionId = crypto.randomUUID();
  sessionRepo.recordSession({
    id:           sessionId,
    project_id:   project.id,
    command:      'complete',
    flags:        options as unknown as Record<string, unknown>,
    provider_id:  options.provider ?? project.active_provider_id ?? undefined,
    profile_name: options.profile  ?? project.active_profile_name ?? undefined,
  });

  try {
    const steps = projectRepo.getSteps(project.id);
    const targetStep = steps.find(s => s.step_name === options.step);

    if (!targetStep) {
      console.error(chalk.red(`✗ Step "${options.step}" not found in project "${project.slug}".`));
      sessionRepo.completeSession(sessionId, 1, 'Step not found');
      process.exit(1);
    }

    if (targetStep.status === 'completed') {
      console.log(chalk.yellow(`⚠ Step "${options.step}" is already completed.`));
      sessionRepo.completeSession(sessionId, 0);
      return;
    }

    const now    = new Date().toISOString();
    const format = options.format ?? 'md';
    const absPath = fs.realpathSync(options.file);
    const content = fs.readFileSync(absPath, 'utf-8');

    // Save document revision
    documentRepo.saveRevision({
      id:              crypto.randomUUID(),
      project_step_id: targetStep.id,
      content,
      format,
      accepted_by:     options.provider ?? undefined,
      notes:           options.notes,
    });

    // Mark project_step completed
    projectRepo.updateStep(targetStep.id, {
      status:           'completed',
      output_file_path: absPath,
      output_format:    format,
      accepted_at:      now,
    });

    // Refresh steps and check if all are done
    const refreshed = projectRepo.getSteps(project.id);
    const allDone   = refreshed.every(
      s => s.status === 'completed' || s.status === 'skipped',
    );

    if (allDone) {
      projectRepo.updateStatus(project.id, 'completed');
      console.log(chalk.green.bold('🎉 All pipeline steps complete — project marked as completed!'));
    }

    sessionRepo.completeSession(sessionId, 0);

    console.log(chalk.green(`✓ Step "${options.step}" marked as completed.`));
    console.log(chalk.gray(`  File:   ${absPath}`));
    console.log(chalk.gray(`  Format: ${format}`));
    if (!allDone) {
      const nextPending = refreshed.find(s => s.status === 'pending');
      if (nextPending) {
        console.log();
        console.log(chalk.cyan(`Next step: filmbuff continue --project ${project.slug}`));
      }
    }
    console.log();

  } catch (err) {
    sessionRepo.completeSession(sessionId, 1,
      err instanceof Error ? err.message : String(err));
    console.error(chalk.red('✗ Failed to complete step:'),
      err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

