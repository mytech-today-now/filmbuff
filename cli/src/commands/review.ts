/**
 * Per-step review loop — interactive accept / reject / skip flow.
 *
 * After a pipeline step generates output, this module presents the content
 * to the user and captures their decision:
 *
 *   [a] Accept  — save DocumentRevision, mark step 'completed'
 *   [r] Reject  — mark attempt 'rejected', keep step 'in_progress'
 *   [s] Skip    — mark step 'skipped', advance to next step
 *   [q] Quit    — exit without changing state
 *
 * Callers supply the pre-loaded project step and latest attempt id so that
 * this module stays pure (no DB look-ups beyond what it's handed).
 *
 * Satisfies: bd-pipe-c3 buff-core.03.01.03 - Implement per-step review loop
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as crypto from 'crypto';
import chalk from 'chalk';
import {
  ProjectRepository,
  DocumentRepository,
} from '../db/index.js';
import type { ProjectStep, DocumentFormat } from '../db/index.js';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewDecision = 'accepted' | 'rejected' | 'skipped' | 'quit';

export interface ReviewStepOptions {
  db:              Database.Database;
  step:            ProjectStep;
  /** UUID of the latest generation_attempt to accept or reject. */
  attemptId:       string;
  /** Path to the file containing the generated content. */
  outputFilePath:  string;
  /** Format of the generated document. */
  outputFormat:    DocumentFormat;
  /** Username/email to record in accepted_by. Optional. */
  acceptedBy?:     string;
  /** When true, skip the interactive prompt and auto-accept. */
  autoAccept?:     boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function showPreview(filePath: string, maxLines = 40): void {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines   = content.split('\n');
    const preview = lines.slice(0, maxLines).join('\n');
    console.log(chalk.dim('─'.repeat(60)));
    console.log(preview);
    if (lines.length > maxLines) {
      console.log(chalk.dim(`\n… (${lines.length - maxLines} more lines — open ${filePath} for full content)`));
    }
    console.log(chalk.dim('─'.repeat(60)));
  } catch {
    console.log(chalk.yellow(`  (Could not read output file: ${filePath})`));
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Interactive review loop for a single pipeline step.
 * Returns the decision the user made (or 'accepted' when autoAccept=true).
 */
export async function reviewStep(opts: ReviewStepOptions): Promise<ReviewDecision> {
  const projectRepo  = new ProjectRepository(opts.db);
  const documentRepo = new DocumentRepository(opts.db);
  const now          = new Date().toISOString();

  console.log();
  console.log(chalk.bold.blue(`📄  Step [${opts.step.step_number}] ${opts.step.step_name} — Review`));
  console.log(chalk.gray(`    Output: ${opts.outputFilePath}`));
  console.log();

  showPreview(opts.outputFilePath);

  // Auto-accept path (e.g. non-interactive CI mode)
  const decision = opts.autoAccept ? 'a' : await prompt(
    chalk.cyan('\n[a]ccept  [r]eject  [s]kip  [q]uit  > '),
  );

  if (decision === 'a' || decision === 'accept') {
    // 1. Accept the attempt
    documentRepo.acceptAttempt(opts.attemptId);

    // 2. Save a document revision
    const content = fs.readFileSync(opts.outputFilePath, 'utf-8');
    documentRepo.saveRevision({
      id:                     crypto.randomUUID(),
      project_step_id:        opts.step.id,
      generation_attempt_id:  opts.attemptId,
      content,
      format:                 opts.outputFormat,
      accepted_by:            opts.acceptedBy,
    });

    // 3. Mark project_step as completed
    projectRepo.updateStep(opts.step.id, {
      status:           'completed',
      output_file_path: opts.outputFilePath,
      output_format:    opts.outputFormat,
      accepted_at:      now,
    });

    console.log(chalk.green(`\n✓ Step "${opts.step.step_name}" accepted.\n`));
    return 'accepted';
  }

  if (decision === 'r' || decision === 'reject') {
    documentRepo.rejectAttempt(opts.attemptId);
    projectRepo.updateStep(opts.step.id, { status: 'in_progress' });
    console.log(chalk.yellow(`\n✗ Step "${opts.step.step_name}" rejected. Use 'filmbuff retry' to regenerate.\n`));
    return 'rejected';
  }

  if (decision === 's' || decision === 'skip') {
    projectRepo.updateStep(opts.step.id, {
      status:     'skipped',
      skipped_at: now,
    });
    console.log(chalk.yellow(`\n⏭  Step "${opts.step.step_name}" skipped.\n`));
    return 'skipped';
  }

  // quit or anything else
  console.log(chalk.gray('\nReview cancelled — no changes made.\n'));
  return 'quit';
}

