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
import * as path from 'path';
import {
  openDatabase,
  runMigrations,
  ProjectRepository,
  DocumentRepository,
  SessionRepository,
  MIGRATIONS_DIR,
} from '../db/index.js';
import type { Project, ProjectStep, ContextSnapshotInput } from '../db/index.js';
import type { DocumentFormat } from '../db/index.js';
import { loadPrompt, promptExists } from '../utils/prompt-loader.js';
import { getFilmbuffAiClient } from '../utils/filmbuff-ai-client.js';
import type { AiConfig } from '../utils/filmbuff-ai-client.js';

// ---------------------------------------------------------------------------
// Public options interface
// ---------------------------------------------------------------------------

export interface ContinueOptions {
  project:   string;   // slug or id
  provider?: string;
  profile?:  string;
  dryRun?:   boolean;
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
// Pipeline step metadata — description and default output filename per step
// (mirrors the seed data in 001_initial_schema.sql pipeline_steps table)
// ---------------------------------------------------------------------------

const STEP_META: Record<string, { description: string; defaultFile: string; format: string }> = {
  'logline':          { description: 'One-to-two sentence film premise',              defaultFile: 'logline.md',               format: 'md'       },
  'synopsis':         { description: 'Short narrative summary (1–2 pages)',           defaultFile: 'synopsis.md',              format: 'md'       },
  'treatment':        { description: 'Scene-by-scene narrative outline',              defaultFile: 'treatment.md',             format: 'md'       },
  'beat-sheet':       { description: 'Story beats mapped to structure',               defaultFile: 'beat-sheet.md',            format: 'md'       },
  'screenplay':       { description: 'Full feature-length screenplay',                defaultFile: 'screenplay.fountain',      format: 'fountain' },
  'shooting-script':  { description: 'Locked shooting draft with scene numbers',      defaultFile: 'shooting-script.fountain', format: 'fountain' },
  'script-breakdown': { description: 'Breakdown of every scene element',              defaultFile: 'script-breakdown.json',    format: 'json'     },
  'storyboards':      { description: 'Visual panel descriptions per scene',           defaultFile: 'storyboards.md',           format: 'md'       },
  'shot-list':        { description: 'Detailed shot list for production',             defaultFile: 'shot-list.json',           format: 'json'     },
  'final-screenplay': { description: 'Distribution-ready final screenplay',           defaultFile: 'final-screenplay.fountain',format: 'fountain' },
};

// ---------------------------------------------------------------------------
// Context assembly helpers
// ---------------------------------------------------------------------------

/**
 * Build a project_metadata context snapshot from the project row.
 */
function buildMetadataSnapshot(
  project: Project,
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
    // No generation attempt exists yet; null is valid per the schema FK (nullable column).
    generation_attempt_id: null,
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
      // No generation attempt exists yet at context-assembly time.
      generation_attempt_id: null,
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

// ---------------------------------------------------------------------------
// Step file helpers
// ---------------------------------------------------------------------------

/** Return a starter template for the given step name and format. */
function buildTemplateContent(stepName: string, meta: { description: string }, format: string): string {
  if (format === 'fountain') {
    return `Title: ${stepName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n\nDraft\n\n<!-- FilmBuff placeholder — replace with your ${stepName} content -->\n`;
  }
  if (format === 'json') {
    return JSON.stringify({ step: stepName, status: 'draft', content: [] }, null, 2) + '\n';
  }
  // Default: Markdown
  return `# ${stepName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n\n` +
    `<!-- FilmBuff — Goal: ${meta.description} -->\n\n` +
    `> Replace this text with your ${stepName} content, then run:\n` +
    `> \`filmbuff complete --project <slug> --step ${stepName} --file <this-file> --format ${format}\`\n`;
}

/** Build an AI prompt from the assembled context snapshots. */
function buildAiPrompt(snapshots: ContextSnapshotInput[], stepName: string, meta: { description: string; format: string }, detailLevel: string): string {
  const parts: string[] = [];

  for (const snap of snapshots) {
    if (snap.context_type === 'project_metadata') {
      parts.push(`=== PROJECT METADATA ===\n${snap.content}`);
    } else if (snap.context_type === 'prior_document') {
      parts.push(`=== PRIOR STEP: ${snap.source_step_name} ===\n${snap.content}`);
    } else if (snap.context_type === 'user_brief') {
      parts.push(`=== TASK BRIEF ===\n${snap.content}`);
    }
  }

  parts.push(
    `\n=== YOUR TASK ===\n` +
    `Write the "${stepName}" for this project.\n` +
    `Goal: ${meta.description}\n` +
    `Output format: ${meta.format}\n` +
    `Detail level: ${detailLevel}\n\n` +
    `Output ONLY the ${stepName} content. Do not include explanations or meta-commentary.`
  );

  return parts.join('\n\n');
}

export async function continueCommand(options: ContinueOptions): Promise<void> {
  console.log(chalk.bold.blue('\n🎬 FilmBuff — Continuing project\n'));

  const db = openDatabase();
  runMigrations(db, MIGRATIONS_DIR);

  const projectRepo  = new ProjectRepository(db);
  const documentRepo = new DocumentRepository(db);
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

    // Context snapshots are assembled before a generation attempt exists.
    // generation_attempt_id is null here; the pipeline runner links them
    // to a real attempt row when it creates one.
    const metaSnapshot  = buildMetadataSnapshot(project, 0);
    const priorDocSnaps = buildPriorDocumentSnapshots(completedSteps, 1);
    const allSnapshots: ContextSnapshotInput[] = [metaSnapshot, ...priorDocSnaps];

    // Load the step-specific prompt and append it as a user_brief snapshot.
    if (promptExists(nextStep.step_name)) {
      try {
        const promptText = loadPrompt(nextStep.step_name, {
          title:        project.display_title,
          genre:        project.genre,
          tone:         project.tone         ?? 'not specified',
          audience:     project.target_audience ?? 'general audience',
          budget:       project.budget_tier  ?? 'not specified',
          outcome:      project.outcome      ?? 'not specified',
          detail_level: project.detail_level,
        });
        allSnapshots.push({
          id:                    crypto.randomUUID(),
          generation_attempt_id: null,
          context_type:          'user_brief',
          source_step_name:      nextStep.step_name,
          content:               promptText,
          sequence_order:        allSnapshots.length,
        });
      } catch {
        // Prompt loading is best-effort; a missing or unreadable file is
        // non-fatal — the pipeline can still proceed without it.
      }
    }

    // Persist snapshots unless dry-run
    if (!options.dryRun) {
      for (const snap of allSnapshots) {
        sessionRepo.recordContextSnapshot(snap);
      }
    }

    const meta       = STEP_META[nextStep.step_name];
    const outputDir  = project.output_dir;
    const outputFile = meta ? path.join(outputDir, meta.defaultFile) : path.join(outputDir, `${nextStep.step_name}.md`);
    const fmt        = (meta?.format ?? 'md') as DocumentFormat;

    console.log(chalk.green(`✓ Project: ${project.display_title} (${project.slug})`));
    console.log(chalk.green(`✓ Next step: [${nextStep.step_number}/10] ${nextStep.step_name}`));
    if (meta) {
      console.log(chalk.green(`✓ Step goal: ${meta.description}`));
    }
    console.log(chalk.green(`✓ Context assembled: ${allSnapshots.length} snapshot(s)`));

    if (options.dryRun) {
      console.log(chalk.yellow('  (dry-run — no files written, no step completed)'));
      sessionRepo.completeSession(sessionId, 0);
      return;
    }

    // Ensure the output directory exists
    fs.mkdirSync(outputDir, { recursive: true });

    // ── AI generation ────────────────────────────────────────────────────────
    let fileWritten  = false;
    let aiGenerated  = false;

    if (!options.dryRun) {
      try {
        // Resolve provider: CLI flag > project setting > env var AI_PROVIDER > library default
        const providerId = (options.provider ?? project.active_provider_id ?? undefined) as AiConfig['provider'] | undefined;
        const aiClient = await getFilmbuffAiClient('pipeline-generator', {
          ...(providerId            ? { provider:    providerId            } : {}),
          ...(options.aiModel       ? { model:        options.aiModel       } : {}),
          ...(options.temperature   !== undefined ? { temperature: options.temperature   } : {}),
          ...(options.maxTokens     !== undefined ? { maxTokens:   options.maxTokens     } : {}),
        });
        const prompt  = buildAiPrompt(allSnapshots, nextStep.step_name, meta ?? { description: nextStep.step_name, format: fmt }, project.detail_level);
        const result  = await aiClient.generateText(prompt);

        fs.writeFileSync(outputFile, result.content, 'utf-8');
        fileWritten = true;
        aiGenerated = true;
        console.log(chalk.green(`✓ AI generated ${nextStep.step_name} → ${outputFile}`));
      } catch (err) {
        // AI unavailable or misconfigured — fall through to template
        console.log(chalk.yellow(`  ℹ AI generation skipped: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    // ── Template fallback ────────────────────────────────────────────────────
    if (!fileWritten) {
      const template = buildTemplateContent(nextStep.step_name, meta ?? { description: nextStep.step_name }, fmt);
      fs.writeFileSync(outputFile, template, 'utf-8');
      fileWritten = true;
      console.log(chalk.yellow(`⚠ AI unavailable — template written to ${outputFile}`));
      console.log(chalk.dim('  Edit the file, then run continue again to mark the step complete.'));
    }

    // ── Auto-complete the step when content is AI-generated ──────────────────
    if (aiGenerated && fileWritten) {
      const absPath = fs.realpathSync(outputFile);
      const content = fs.readFileSync(absPath, 'utf-8');
      const now     = new Date().toISOString();

      documentRepo.saveRevision({
        id:              crypto.randomUUID(),
        project_step_id: nextStep.id,
        content,
        format:          fmt,
      });

      projectRepo.updateStep(nextStep.id, {
        status:           'completed',
        output_file_path: absPath,
        output_format:    fmt,
        accepted_at:      now,
      });

      const refreshed = projectRepo.getSteps(project.id);
      const allDone   = refreshed.every(s => s.status === 'completed' || s.status === 'skipped');

      if (allDone) {
        projectRepo.updateStatus(project.id, 'completed');
        console.log(chalk.green.bold('\n🎉 All pipeline steps complete — project marked as completed!'));
      } else {
        const nextPending = refreshed.find(s => s.status === 'pending');
        if (nextPending) {
          console.log(chalk.dim(`\n  ─── Step [${nextPending.step_number}/10]: ${nextPending.step_name} ───`));
          console.log(chalk.bold.white(`  filmbuff continue --project ${project.slug}`));
        }
      }
    } else if (!aiGenerated && fileWritten) {
      // Template written — instruct user to edit then run complete + continue
      console.log();
      console.log(chalk.bold('── Next steps ───────────────────────────────────────────────'));
      console.log();
      console.log(chalk.white(`  1. Edit the file: ${outputFile}`));
      console.log(chalk.white('  2. Mark complete:'));
      console.log(chalk.cyan(`       filmbuff complete \\`));
      console.log(chalk.cyan(`         --project ${project.slug} \\`));
      console.log(chalk.cyan(`         --step ${nextStep.step_name} \\`));
      console.log(chalk.cyan(`         --file "${outputFile}" \\`));
      console.log(chalk.cyan(`         --format ${fmt}`));
      console.log(chalk.white('  3. Advance to the next step:'));
      console.log(chalk.bold.white(`       filmbuff continue --project ${project.slug}`));
    }

    sessionRepo.completeSession(sessionId, 0);

  } catch (err) {
    sessionRepo.completeSession(sessionId, 1,
      err instanceof Error ? err.message : String(err));
    console.error(chalk.red('✗ Failed to continue project:'),
      err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

