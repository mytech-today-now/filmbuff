/**
 * filmbuff retry — Re-queue the last failed or rejected pipeline step.
 *
 * Finds the most recent step that is 'in_progress' or 'failed' for the given
 * project, rejects the latest generation attempt (if any), resets the step
 * status back to 'pending', increments retry_count, and records the session.
 *
 * Options:
 *   --project <slug>   Project slug (or id)                  [required]
 *   --step    <name>   Step name to retry (defaults to last  [optional]
 *                      failed/in-progress step)
 *   --provider <id>    Override AI provider for this session [optional]
 *   --profile  <name>  Override AI provider profile          [optional]
 *
 * Satisfies: bd-pipe-c4 buff-core.03.01.04 - Implement filmbuff retry command
 */

import chalk from 'chalk';
import * as crypto from 'crypto';
import {
  openDatabase,
  runMigrations,
  ProjectRepository,
  DocumentRepository,
  SessionRepository,
  MIGRATIONS_DIR,
} from '../db/index.js';
import type { PipelineStepName } from '../db/index.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RetryOptions {
  project:   string;
  step?:     PipelineStepName;
  provider?: string;
  profile?:  string;
  // -------------------------------------------------------------------------
  // bd-jnbf (Phase 6.4): AIPoweredClientOptions override flags.
  // -------------------------------------------------------------------------
  /** --ai-powered-url: gateway base URL override. */
  aiPoweredUrl?: string;
  /** --ai-model: model identifier override. */
  aiModel?: string;
  /** --system-prompt: system prompt override. */
  systemPrompt?: string;
  /** --temperature: sampling temperature override (0–2). */
  temperature?: number;
  /** --max-tokens: maximum tokens per response override. */
  maxTokens?: number;
  /** --timeout: request timeout in milliseconds override. */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function retryCommand(options: RetryOptions): Promise<void> {
  console.log(chalk.bold.blue('\n🎬 FilmBuff — Retrying pipeline step\n'));

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
    command:      'retry',
    flags:        options as unknown as Record<string, unknown>,
    provider_id:  options.provider ?? project.active_provider_id ?? undefined,
    profile_name: options.profile  ?? project.active_profile_name ?? undefined,
  });

  try {
    const steps = projectRepo.getSteps(project.id);

    // Identify the target step
    let targetStep = options.step
      ? steps.find(s => s.step_name === options.step)
      : steps
          .slice()
          .reverse()
          .find(s => s.status === 'in_progress' || s.status === 'failed');

    if (!targetStep) {
      console.log(chalk.yellow('⚠ No retryable step found for this project.'));
      console.log(chalk.gray('  A step must be in_progress or failed to retry.'));
      sessionRepo.completeSession(sessionId, 0);
      return;
    }

    // If caller specified a step by name, validate that it can be retried
    if (
      options.step &&
      targetStep.status !== 'in_progress' &&
      targetStep.status !== 'failed'
    ) {
      console.error(
        chalk.red(
          `✗ Step "${targetStep.step_name}" has status "${targetStep.status}" and cannot be retried.`,
        ),
      );
      console.error(chalk.gray('  Only steps with status in_progress or failed can be retried.'));
      sessionRepo.completeSession(sessionId, 1, 'Step not retryable');
      process.exit(1);
    }

    // Reject the latest generation attempt for this step (if any)
    const attempts = documentRepo.listAttempts(targetStep.id);
    const lastAttempt = attempts
      .slice()
      .reverse()
      .find(a => a.status === 'generated' || a.status === 'accepted');

    if (lastAttempt) {
      documentRepo.rejectAttempt(lastAttempt.id);
    }

    // Reset step to pending with incremented retry_count
    projectRepo.updateStep(targetStep.id, {
      status:      'pending',
      retry_count: targetStep.retry_count + 1,
    });

    sessionRepo.completeSession(sessionId, 0);

    console.log(chalk.green(`✓ Step "${targetStep.step_name}" reset to pending.`));
    console.log(chalk.gray(`  Retry count: ${targetStep.retry_count + 1}`));
    if (lastAttempt) {
      console.log(chalk.gray(`  Previous attempt ${lastAttempt.id} marked rejected.`));
    }
    console.log();
    console.log(chalk.cyan(`Run 'filmbuff continue --project ${project.slug}' to regenerate.`));
    console.log();

  } catch (err) {
    sessionRepo.completeSession(sessionId, 1,
      err instanceof Error ? err.message : String(err));
    console.error(chalk.red('✗ Retry failed:'),
      err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

