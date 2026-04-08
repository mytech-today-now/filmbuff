/**
 * filmbuff start — Initialise a new FilmBuff project.
 *
 * Creates a project row in the database (via ProjectRepository), seeds the
 * 10 pipeline steps, and records the CLI invocation as a session row
 * (via SessionRepository).
 *
 * Satisfies: bd-pipe-c1 buff-core.03.01.01 - Implement filmbuff start command
 */

import chalk from 'chalk';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  openDatabase,
  runMigrations,
  ProjectRepository,
  SessionRepository,
  DuplicateSlugError,
  MIGRATIONS_DIR,
} from '../db/index.js';
import { startWizard } from './start-wizard.js';
import type {
  BudgetTier,
  DocumentFormat,
  DetailLevel,
} from '../db/index.js';

// ---------------------------------------------------------------------------
// Public options interface (matches Commander option names after camelCase)
// ---------------------------------------------------------------------------

export interface StartOptions {
  title:        string;
  genre:        string;
  slug?:        string;
  tone?:        string;
  audience?:    string;
  budget?:      BudgetTier;
  outcome?:     string;
  outputDir?:   string;
  format?:      DocumentFormat;
  detail?:      DetailLevel;
  styles?:      string[];
  provider?:    string;
  profile?:     string;
  // -------------------------------------------------------------------------
  // bd-jnbf (Phase 6.4): AIPoweredClientOptions override flags.
  // Stored here for forwarding to resolveAIClient() when any AI call is made
  // during or after the start workflow.
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
  // -------------------------------------------------------------------------
  // bd-ama1: Wizard control flags — populated by --wizard / --no-wizard in cli.ts
  // -------------------------------------------------------------------------
  /** --wizard: force-launch the interactive wizard regardless of other flags. */
  wizard?: boolean;
  /** --no-wizard: suppress the wizard; exit 1 if --title or --genre is missing. */
  noWizard?: boolean;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function startCommand(options: StartOptions): Promise<void> {
  console.log(chalk.bold.blue('\n🎬 FilmBuff — Starting new project\n'));

  // Initialise DB first so findBySlug is available for slug collision pre-flight
  const db = openDatabase();
  runMigrations(db, MIGRATIONS_DIR);

  const projectRepo = new ProjectRepository(db);
  const sessionRepo = new SessionRepository(db);

  // ── bd-ama1: Wizard trigger preamble ─────────────────────────────────────
  // When both --wizard and --no-wizard are given, --no-wizard takes precedence.
  if (options.wizard && options.noWizard) {
    console.warn(chalk.yellow('Warning: --no-wizard takes precedence over --wizard.'));
  }
  if (!options.title || !options.genre || options.wizard) {
    if (options.noWizard || !process.stdout.isTTY || process.env['CI'] === 'true') {
      if (!options.title || !options.genre) {
        console.error(chalk.red('Error: --title and --genre are required in non-interactive mode.'));
        process.exit(1);
      }
    } else {
      options = await startWizard(options, {
        findBySlug: (s) => projectRepo.findBySlug(s),
      });
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Derive slug from title if not provided
  const slug = options.slug
    ?? options.title
         .toLowerCase()
         .replace(/[^a-z0-9]+/g, '-')
         .replace(/^-+|-+$/g, '');

  const projectId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const outputDir = options.outputDir
    ?? path.join(process.cwd(), 'output', slug);

  // Record session start
  sessionRepo.recordSession({
    id:          sessionId,
    project_id:  projectId,
    command:     'start',
    flags:       options as unknown as Record<string, unknown>,
    provider_id: options.provider,
    profile_name: options.profile,
  });

  try {
    const project = projectRepo.create({
      id:                  projectId,
      slug,
      display_title:       options.title,
      genre:               options.genre,
      tone:                options.tone,
      target_audience:     options.audience,
      budget_tier:         options.budget,
      outcome:             options.outcome,
      output_dir:          outputDir,
      format_override:     options.format,
      detail_level:        options.detail ?? 'standard',
      style_modules:       options.styles,
      active_provider_id:  options.provider,
      active_profile_name: options.profile,
    });

    sessionRepo.completeSession(sessionId, 0);

    console.log(chalk.green('✓ Project created successfully\n'));
    console.log(chalk.bold('Project details:'));
    console.log(chalk.gray(`  ID:         ${project.id}`));
    console.log(chalk.gray(`  Slug:       ${project.slug}`));
    console.log(chalk.gray(`  Title:      ${project.display_title}`));
    console.log(chalk.gray(`  Genre:      ${project.genre}`));
    console.log(chalk.gray(`  Output dir: ${project.output_dir}`));
    console.log(chalk.gray(`  Status:     ${project.status}`));
    console.log();
    console.log(chalk.cyan('Next step: filmbuff continue --project ' + project.slug));
    console.log();

  } catch (err) {
    sessionRepo.completeSession(sessionId, 1,
      err instanceof Error ? err.message : String(err));

    if (err instanceof DuplicateSlugError) {
      console.error(chalk.red('✗ ' + err.message));
      console.error(chalk.gray('  Use --slug <name> to choose a different slug.'));
    } else {
      console.error(chalk.red('✗ Failed to create project:'),
        err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
}

