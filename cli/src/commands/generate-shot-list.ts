import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { displayHelp } from './generate-shot-list/help-text';
import { ExitCode, exitWithCode } from './generate-shot-list/exit-codes';
import { createParserAuto } from './generate-shot-list/parser';
import type { Screenplay } from './generate-shot-list/parser/types';
import {
  createGenerator,
  applyNormalizationPass,
  applyBudgetWarning,
  formatRuntime,
} from './generate-shot-list/generator';
import { FilmbuffVideoGenerator, type VideoGenerationOptions } from '../lib/video-generator';
import { createFormatter } from './generate-shot-list/formatter';
import { createLogger } from './generate-shot-list/logger';
import { createStyleSystem } from './generate-shot-list/style';
import { ConfigManager } from '../utils/config-system';
import { getModulesDir } from '../utils/module-system';
import { RunLogger, computeRunLogPath } from '../utils/run-logger';
// Phase 6 (bd-cfa7): AI provider resolution now handled entirely by the
// ai-powered library via getFilmbuffAiClient() inside the extractors.
// normalizeAIProvider / normalizeAIModel retained only for flag-validation
// backward-compat; they are not used for actual inference.
import { loadFilmbuffConfig, resolveProvider } from '../lib/filmbuff-config';
import { loadPipelineInputs } from '../lib/pipeline-inputs';
import { deriveDuration } from '../lib/duration-derivation';
import type { ShotData } from '../lib/duration-derivation';
import { resolveVideoControls } from '../lib/video-controls';
import type { ShotFramingHints } from '../lib/video-controls';
import { validateBatchPayload } from '../lib/pre-export-validator';
import type { ValidatablePayload } from '../lib/pre-export-validator';
import { serializeBatch, serializeBatchToJsonl, assertApiKeyAbsent } from '../lib/batch-serializer';
import type { ResolvedShot } from '../lib/batch-serializer';
import type { OutputFormat } from './generate-shot-list/formatter/types';
import type { MergedStyleGuidelines } from './generate-shot-list/style/types';

// ---------------------------------------------------------------------------
// Constants (refactor-slg-01 — Script-Length-Aware Shot Duration Normalization)
// ---------------------------------------------------------------------------

/** Industry standard: 1 screenplay page ≈ 1 minute of screen time. */
const SECONDS_PER_PAGE = 60;

/** US Letter, Courier 12pt, 1-inch margins → ~55 typed lines per page. */
const LINES_PER_PAGE = 55;

/** Average screenplay pages per scene (proxy when no line count available). */
const PAGES_PER_SCENE_ESTIMATE = 1.5;

// ---------------------------------------------------------------------------
// deriveScriptPageCount — pure helper (no side effects, no I/O)
// ---------------------------------------------------------------------------

/**
 * Derive the screenplay's page count from already-parsed metadata.
 *
 * Priority chain:
 *   P1 → screenplay.metadata.pdfPages         (exact; set by PDF parser)
 *   P2 → Math.round(totalLines / 55)          (US Letter, Courier 12pt standard)
 *   P3 → Math.round(scenes.length × 1.5)      (proxy; last resort for DOCX/RTF)
 *   →  undefined                               (no signal; normalization disabled)
 *
 * All three priorities clamp to a minimum of 1.
 * Exported for unit testing.
 */
export function deriveScriptPageCount(screenplay: Screenplay): number | undefined {
  const { metadata, scenes } = screenplay;

  // P1: pdfPages — set by the PDF parser; authoritative when positive.
  if (typeof metadata.pdfPages === 'number' && metadata.pdfPages > 0) {
    return metadata.pdfPages;
  }

  // P2: totalLines / LINES_PER_PAGE approximation.
  if (typeof metadata.totalLines === 'number' && metadata.totalLines > 0) {
    return Math.max(1, Math.round(metadata.totalLines / LINES_PER_PAGE));
  }

  // P3: scene count × PAGES_PER_SCENE_ESTIMATE proxy.
  if (scenes.length > 0) {
    return Math.max(1, Math.round(scenes.length * PAGES_PER_SCENE_ESTIMATE));
  }

  // Fallback: no signal available; normalization disabled (AC-11).
  return undefined;
}

interface GenerateShotListOptions {
  input?: string;
  format?: string;
  output?: string;
  maxCharacters?: number;
  maxShotLength?: number;
  logging?: boolean;
  style?: string | string[];  // Can be single string or array of strings
  muteSfx?: boolean;  // Remove all MUSIC and SOUND EFFECT content from output
  /**
   * Manual screenplay page count override (--script-pages).
   * When set, bypasses automatic pdfPages / totalLines / scene-count detection.
   * Validated as a positive integer at CLI parse time (AC-13).
   */
  scriptPages?: number;
  /**
   * Explicit target runtime in seconds (--target-duration).
   * Level-1 budget priority — overrides DB and page-count derivation (AC-3).
   */
  targetDuration?: number;
  aiProvider?: string;
  aiProfile?: string;
  aiModel?: string;
  /** Video provider id from filmbuff.config.json (e.g. 'lumaai', 'mock') */
  provider?: string;
  /** Video model id override for the selected video provider */
  model?: string;
  /**
   * Skip URL reachability checks (V-3) and provider capability fetch.
   * Auto-enabled when CI=true env var is set.
   */
  offline?: boolean;
  /** Path to write POST /batch JSON payload file (--batch-output). */
  batchOutput?: string;
  /**
   * When true, write batch-output in JSONL format with _type:references sentinel (AC-16).
   * Only used when batchOutput is also set.
   */
  jsonl?: boolean;
  /**
   * When true, trigger FilmbuffVideoGenerator in-process after shot list generation
   * completes (Phase 8 — bd-6c4f). No intermediate JSONL file is written.
   */
  generateVideo?: boolean;
  /** Output directory for the video manifest.json. Default: ./generated-videos */
  videoOutput?: string;
  /** When true, pass mock: true to video generator (no real API calls). */
  mock?: boolean;
  help?: boolean;
  h?: boolean;
  // -------------------------------------------------------------------------
  // bd-jnbf (Phase 6.4) — AIPoweredClientOptions override flags.
  // When supplied these are passed as the `overrides` arg to resolveAIClient()
  // inside the AI extractors, winning over env vars and config file values.
  // -------------------------------------------------------------------------
  /** --ai-powered-url: gateway base URL override (AIPoweredClientOptions.url). */
  aiPoweredUrl?: string;
  /** --system-prompt: system prompt override. */
  systemPrompt?: string;
  /** --temperature: sampling temperature override (0–2). */
  temperature?: number;
  /** --max-tokens: maximum tokens per response override. */
  maxTokens?: number;
  /** --timeout: request timeout in milliseconds override. */
  timeout?: number;
}

export async function generateShotListCommand(options: GenerateShotListOptions): Promise<void> {
  try {
    // Handle help flags
    if (options.help || options.h) {
      displayHelp();
      exitWithCode(ExitCode.SUCCESS);
    }

    // Validate required arguments
    if (!options.input) {
      console.error(chalk.red('Error: Missing required argument: --input'));
      console.log(chalk.gray('Usage: filmbuff generate-shot-list --input <screenplay-file> [options]'));
      console.log(chalk.gray("Run 'filmbuff generate-shot-list --help' for more information."));
      exitWithCode(ExitCode.INVALID_ARGUMENTS);
    }

    const inputPath = options.input;

    // Set defaults
    const format = options.format || 'md';
    const maxCharacters = options.maxCharacters || 4000;
    const maxShotLength = options.maxShotLength || 12;
    const logging = options.logging || false;
    // Load config for deprecation-warning side-effect; appConfig not used for AI resolution.
    // Phase 6 (bd-cfa7): AI inference is handled by getFilmbuffAiClient() inside the
    // extractors. The --ai-provider / --ai-model CLI flags are accepted for backward
    // compatibility but are no-ops; ai-powered manages provider/model via its own config.
    new ConfigManager().load();

    // Phase 2 (bd-fefd): video provider resolution via filmbuff.config.json.
    // CLI flags (--provider / --model) take precedence over config defaults.
    // --offline (or CI=true env) disables URL reachability checks and capability fetch.
    const isOffline = options.offline ?? (process.env['CI'] === 'true');
    const filmbuffConfig = loadFilmbuffConfig();
    const resolvedVideoProvider = resolveProvider(filmbuffConfig, {
      provider: options.provider,
      model:    options.model
    });
    console.log(chalk.gray(`Using video provider: ${resolvedVideoProvider.providerId}, model: ${resolvedVideoProvider.model}`));
    if (isOffline) {
      console.log(chalk.gray('Offline mode: URL reachability checks and provider capability fetch skipped.'));
    }

    // Phase 3 (bd-bae9): load optional pipeline artifacts from the project directory.
    // Gracefully degrades when files are absent (null maps, no error).
    const projectDir = path.dirname(path.resolve(options.input || '.'));
    const pipelineInputs = loadPipelineInputs(projectDir);
    if (pipelineInputs.shootingScript.size > 0) {
      console.log(chalk.gray(`Loaded shooting-script: ${pipelineInputs.shootingScript.size} shot duration(s)`));
    }
    if (pipelineInputs.beatSheet.size > 0) {
      console.log(chalk.gray(`Loaded beat-sheet: ${pipelineInputs.beatSheet.size} timing cue(s)`));
    }

    // Validate format
    const validFormats = ['md', 'json', 'jsonl', 'csv', 'txt', 'html'];
    if (!validFormats.includes(format)) {
      console.error(chalk.red(`Error: Invalid format: ${format}`));
      console.log(chalk.gray(`Supported formats: ${validFormats.join(', ')}`));
      exitWithCode(ExitCode.INVALID_ARGUMENTS);
    }

    // Validate character limit
    if (maxCharacters < 100 || maxCharacters > 10000) {
      console.error(chalk.red('Error: Character limit must be between 100 and 10000'));
      exitWithCode(ExitCode.INVALID_ARGUMENTS);
    }

    // Validate shot length
    if (maxShotLength < 1 || maxShotLength > 60) {
      console.error(chalk.red('Error: Shot length must be between 1 and 60 seconds'));
      exitWithCode(ExitCode.INVALID_ARGUMENTS);
    }

    // Validate input file
    if (!fs.existsSync(inputPath)) {
      console.error(chalk.red(`Error: Input file not found: ${inputPath}`));
      exitWithCode(ExitCode.INPUT_FILE_ERROR);
    }

    // Check file is readable
    try {
      fs.accessSync(inputPath, fs.constants.R_OK);
    } catch (error) {
      console.error(chalk.red(`Error: Permission denied: ${inputPath}`));
      exitWithCode(ExitCode.INPUT_FILE_ERROR);
    }

    // Check file size (< 50MB)
    const stats = fs.statSync(inputPath);
    if (stats.size > 50 * 1024 * 1024) {
      console.error(chalk.red('Error: File size exceeds 50MB limit'));
      exitWithCode(ExitCode.INPUT_FILE_ERROR);
    }

    // -------------------------------------------------------------------------
    // Run Logger — tees all stdout/stderr to a per-run plain-text log file.
    // Starts here (after input validation) so every subsequent line of output,
    // including ai-powered library logs and AI cost/token info, is captured.
    // The log file sits next to the output file (or input file when no --output
    // is given) and is named: <basename>-<ISO-timestamp>.log
    // -------------------------------------------------------------------------
    const runLogPath = computeRunLogPath(inputPath, options.output);
    const runLogger  = new RunLogger(runLogPath);

    const sep = '='.repeat(80);
    const runHeader = [
      sep,
      'filmbuff generate-shot-list — Run Log',
      `Started:  ${new Date().toISOString()}`,
      `Input:    ${path.resolve(inputPath)}`,
      `Output:   ${options.output ? path.resolve(options.output) : '(default — next to input)'}`,
      `Format:   ${format}`,
      `Log:      ${runLogPath}`,
      sep,
    ].join('\n');

    runLogger.start(runHeader);

    // ── Register cleanup handlers ─────────────────────────────────────────
    // 'exit' fires on process.exit() and natural loop-drain.
    process.once('exit', (code: number) => {
      runLogger.writeDirectly(
        `\n${sep}\nCompleted: ${new Date().toISOString()}  Exit code: ${code}\n${sep}\n`,
      );
      runLogger.stop();
    });

    // 'uncaughtException' fires on unhandled throws (Node 15+ exits with 1
    // without calling 'exit').  Write footer + re-throw so Node still exits.
    process.once('uncaughtException', (err: Error) => {
      runLogger.writeDirectly(
        `\n${sep}\nCRASH (uncaughtException): ${err.message}\n${sep}\n`,
      );
      runLogger.stop();
      throw err; // re-throw so Node.js default handler still terminates
    });

    // 'unhandledRejection' fires on unhandled promise rejections.
    process.once('unhandledRejection', (reason: unknown) => {
      const msg = reason instanceof Error ? reason.message : String(reason);
      runLogger.writeDirectly(
        `\n${sep}\nCRASH (unhandledRejection): ${msg}\n${sep}\n`,
      );
      runLogger.stop();
    });

    // Print path so the user can see it (and so it's captured in the log too).
    console.log(chalk.gray(`📋 Run log: ${runLogPath}`));

    console.log(chalk.blue(`\n🎬 Generating AI Shot List...\n`));
    console.log(chalk.gray(`Processing: ${inputPath}`));
    console.log(chalk.gray(`Format: ${format}`));
    console.log(chalk.gray(`Max characters: ${maxCharacters}`));
    console.log(chalk.gray(`Max shot length: ${maxShotLength}s`));
    console.log(chalk.gray('AI inference: managed by ai-powered library\n'));

    // Initialize logger if requested
    let logger;
    if (logging) {
      logger = await createLogger();
      await logger.logInfo('Shot list generation started', {
        inputFile: inputPath,
        format,
        maxCharacters,
        maxShotLength,
      });
    }

    // Load cinematic styles if requested
    let styleGuidelines: MergedStyleGuidelines | null = null;
    if (options.style) {
      const stylePaths = Array.isArray(options.style) ? options.style : [options.style];
      console.log(chalk.gray(`🎨 Loading cinematic styles...`));

      // Extensions root is the filmbuff directory in the parent of the CLI
      const extensionsRoot = getModulesDir();
      const styleSystem = createStyleSystem(extensionsRoot);

      // Validate all style paths
      for (const stylePath of stylePaths) {
        const isValid = await styleSystem.validateStylePath(stylePath);
        if (!isValid) {
          console.error(chalk.red(`Error: Invalid style module path: ${stylePath}`));
          console.log(chalk.gray('Expected format: writing-standards/screenplay/cinematic-styles/[category]/[style-name]'));
          console.log(chalk.gray('Categories: directors, franchises, films, comedy-formats'));
          exitWithCode(ExitCode.INVALID_ARGUMENTS);
        }
      }

      // Load and merge styles
      try {
        styleGuidelines = await styleSystem.loadStyles(stylePaths);
        if (styleGuidelines) {
          console.log(chalk.green(`✓ Loaded styles: ${styleSystem.formatStylesForDisplay(styleGuidelines)}`));

          if (logging && logger) {
            await logger.logInfo('Cinematic styles loaded', {
              styles: styleGuidelines.appliedStyles,
              conflicts: styleGuidelines.conflicts.length
            });

            // Log conflicts if any
            for (const conflict of styleGuidelines.conflicts) {
              await logger.logWarning('STYLE_CONFLICT', `Style conflict resolved: ${conflict.guideline}`, {
                styles: conflict.styles,
                resolution: conflict.resolution,
                resolvedBy: conflict.resolvedBy
              });
            }
          }
        }
      } catch (error) {
        console.error(chalk.red(`Error loading styles: ${error}`));
        exitWithCode(ExitCode.GENERAL_ERROR);
      }
    }

    try {
      // Step 1: Read input file
      console.log(chalk.gray('📖 Reading screenplay file...'));
      const content = fs.readFileSync(inputPath, 'utf-8');

      // Step 2: Parse screenplay
      console.log(chalk.gray('🔍 Parsing screenplay...'));
      const parser = createParserAuto(inputPath, content);
      const screenplay = await Promise.resolve(parser.parse(content));
      console.log(chalk.green(`✓ Parsed ${screenplay.scenes.length} scenes`));

      if (logging && logger) {
        await logger.logInfo('Screenplay parsed successfully', {
          sceneCount: screenplay.scenes.length,
          format: screenplay.metadata.format,
          totalLines: screenplay.metadata.totalLines
        });
      }

      // ---------------------------------------------------------------
      // Budget resolution chain (refactor-slg-01 — Task 2C, AC-1..AC-4, AC-11)
      // ---------------------------------------------------------------

      // Resolve the screenplay page count (--script-pages overrides auto-detect, AC-2).
      const scriptPageCount: number | undefined =
        options.scriptPages ?? deriveScriptPageCount(screenplay as Screenplay);

      // NOTE: Level-2 (DB project target_duration_seconds) is implemented by FB-NAR-1.
      // Until that epic is complete, loadedProject is undefined and budget resolution
      // falls through to level 3 (page count × SECONDS_PER_PAGE).
      // Type assertion prevents const-narrowing to `undefined` literal (TS strict).
      const loadedProject = undefined as ({ target_duration_seconds?: number | null } | undefined);

      // 4-level priority chain:
      //   Level 1: --target-duration (CLI flag — highest priority, AC-3)
      //   Level 2: DB target_duration_seconds             (AC-4)
      //   Level 3: scriptPageCount × 60                  (AC-1 / AC-2)
      //   Level 4: undefined                             (AC-11 — skip normalization)
      const totalBudgetSeconds: number | undefined =
        options.targetDuration                                              // Level 1
        ?? (loadedProject?.target_duration_seconds ?? undefined)           // Level 2
        ?? (scriptPageCount !== undefined
              ? scriptPageCount * SECONDS_PER_PAGE                        // Level 3
              : undefined);                                                // Level 4

      if (scriptPageCount !== undefined && options.targetDuration === undefined &&
          (loadedProject?.target_duration_seconds ?? undefined) === undefined) {
        // AC-1 / AC-6: emit auto-derived page count so the user can see what drove the budget.
        console.log(chalk.gray(
          `📄 Auto-derived page count: ${scriptPageCount} pages → budget ${formatRuntime(scriptPageCount * SECONDS_PER_PAGE)}`
        ));
      }

      // Step 3: Generate shot list
      const generationStartMs = Date.now();
      console.log(chalk.gray('🎬 Generating shots...'));

      const generatorConfig = {
        maxCharacters,
        maxShotLength,
        warningThreshold: 90, // 90% threshold for warnings
        includeContext: true,
        includeMetadata: true,
        muteSfx: options.muteSfx || false,
        totalBudgetSeconds,  // propagate resolved budget (refactor-slg-01 Task 2C)
      };
      const generator = createGenerator(styleGuidelines);
      const shotList = await generator.generate(screenplay.scenes, generatorConfig);
      console.log(chalk.green(`✓ Generated ${shotList.totalShots} shots`));

      // Phase 4 (bd-eu39) + Phase 5 (bd-kt6j): Derive duration and resolve video controls
      // for every shot using the 4-priority chain (shooting-script → beat-sheet →
      // segmenter-estimate → fallback).  Also attaches VideoControls for the
      // markdown formatter's "Video Controls:" block.
      let derivedTotalDuration = 0;
      for (const shot of shotList.shots) {
        const shotData: ShotData = {
          id: String(shot.number),
          shootingScriptDuration: pipelineInputs.shootingScript.get(String(shot.number)) ?? null,
          beatSheetCue:           pipelineInputs.beatSheet.get(String(shot.sceneNumber)) ?? null,
          // Pass the SceneSegmenter's element-level estimate as the P3 signal.
          // The segmenter totals raw SceneElements (action lines × 3 s +
          // dialogue words × 0.4 s/word) so it correctly varies by scene content.
          // The former approach — splitting shot.actions by '\n' — always
          // produced a single line (actions are joined with '. ') and therefore
          // always returned 5 s regardless of scene length or dialogue content.
          segmenterEstimateS: shot.duration,
          actionLines: shot.actions ? shot.actions.split('\n') : [],
        };
        const durationResult = deriveDuration(shotData);
        // Overwrite generator's rough estimate with the deterministic derived value
        shot.duration      = durationResult.seconds;
        shot.durationNotes = durationResult.notes;

        const hints: ShotFramingHints = {
          // Combine shot description and framing metadata as keyword sources
          framingDescription: [shot.description, shot.metadata.framing].filter(Boolean).join(' '),
        };
        shot.videoControls = resolveVideoControls(hints, durationResult);
        derivedTotalDuration += durationResult.seconds;
      }
      // ---------------------------------------------------------------
      // Normalization pass (refactor-slg-01 — Task 3A, AC-5..AC-9)
      // Runs AFTER deriveDuration() sets shot.duration and shot.durationNotes,
      // so P1-shot detection ("Derived from shot duration" prefix) is correct.
      // ---------------------------------------------------------------
      if (totalBudgetSeconds !== undefined && derivedTotalDuration > 0) {
        derivedTotalDuration = applyNormalizationPass(
          shotList.shots,
          derivedTotalDuration,
          totalBudgetSeconds
        );
      }

      // Recalculate aggregate after per-shot duration update (and post-normalization).
      shotList.totalDuration = derivedTotalDuration;

      // ---------------------------------------------------------------
      // Budget warning block (refactor-slg-01 — Task 3B, AC-9 / AC-10)
      // Reads post-normalization total; runs AFTER normalization pass.
      // ---------------------------------------------------------------
      applyBudgetWarning(shotList, derivedTotalDuration, generatorConfig);

      console.log(chalk.gray(`   Total duration: ${Math.floor(shotList.totalDuration / 60)}m ${Math.floor(shotList.totalDuration % 60)}s`));
      console.log(chalk.gray(`   Total characters: ${shotList.totalCharacters}`));

      if (logging && logger) {
        const inputStats = fs.statSync(inputPath);
        await logger.logSuccess(
          'Shot list generated successfully',
          {
            shotCount: shotList.totalShots,
            duration: shotList.totalDuration,
            characterCount: shotList.totalCharacters,
            processingTime: Date.now() - generationStartMs,
            warningCount: shotList.warnings.length,
            inputFileSize: inputStats.size,
            outputFileSize: 0 // Will be updated when file is written
          },
          inputPath,
          options.output || 'console',
          format
        );
      }

      // Display warnings if any (Requirement 4: Terminal Feedback Severity)
      if (shotList.warnings.length > 0) {
        const errorCount = shotList.warnings.filter(w => w.severity === 'error').length;
        const warningCount = shotList.warnings.filter(w => w.severity === 'warning').length;

        if (errorCount > 0) {
          console.log(chalk.red(`\n❌ ${errorCount} error(s):`));
        }
        if (warningCount > 0) {
          console.log(chalk.yellow(`\n⚠️  ${warningCount} warning(s):`));
        }

        for (const warning of shotList.warnings.slice(0, 5)) {
          const color = warning.severity === 'error' ? chalk.red : chalk.yellow;
          const icon = warning.severity === 'error' ? '❌' : '⚠️';
          console.log(color(`   ${icon} Shot ${warning.shotNumber}: ${warning.message}`));
        }
        if (shotList.warnings.length > 5) {
          console.log(chalk.gray(`   ... and ${shotList.warnings.length - 5} more`));
        }
        console.log();
      }

      // Step 4: Format output
      console.log(chalk.gray('📝 Formatting output...'));
      const formatter = createFormatter(format as OutputFormat);
      const output = formatter.format(shotList);

      // Step 4b: Pre-export validation (Phase 6 / bd-b4ce — V-1 through V-6)
      // Only runs when --batch-output is specified; halts export on blocking errors.
      if (options.batchOutput) {
        const batchPayload: ValidatablePayload = {
          provider: resolvedVideoProvider.providerId,
          model:    resolvedVideoProvider.model,
          items:    shotList.shots.map(shot => ({
            name: shot.heading.raw
          }))
        };

        const validation = await validateBatchPayload(batchPayload, filmbuffConfig, {
          offline: isOffline
        });

        // Blocking errors — halt export
        if (validation.errors.length > 0) {
          console.error(chalk.red('\n❌ Pre-export validation failed:'));
          for (const err of validation.errors) {
            console.error(chalk.red(`   [${err.rule}]${err.shotName ? ` Shot "${err.shotName}":` : ''} ${err.message}`));
          }
          exitWithCode(ExitCode.GENERAL_ERROR);
        }

        // Non-blocking warnings (V-6)
        if (validation.warnings.length > 0) {
          console.warn(chalk.yellow('\n⚠️  Pre-export warnings:'));
          for (const warn of validation.warnings) {
            console.warn(chalk.yellow(`   [${warn.rule}]${warn.shotName ? ` Shot "${warn.shotName}":` : ''} ${warn.message}`));
          }
        }

        // Write batch payload (AFTER successful validation).
        // Build ResolvedShot[] from fully-resolved shots — Phase 4 (deriveDuration)
        // and Phase 5 (resolveVideoControls) already populated shot.videoControls.
        // Per-shot references and provider overrides are added in Phase 7 (bd-74fy)
        // when the references manager is integrated; omitted here to use envelope defaults.
        const resolvedShots: ResolvedShot[] = shotList.shots.map(shot => {
          if (!shot.videoControls) {
            throw new Error(
              `Shot ${shot.number} is missing videoControls — ` +
              `deriveDuration/resolveVideoControls must run before batch serialization`
            );
          }
          return {
            id:      String(shot.number),
            heading: shot.heading.raw,
            prompt:  shot.description,
            controls: shot.videoControls
            // references, provider, model: populated in Phase 7 (bd-74fy)
          };
        });

        const serializedPayload = serializeBatch(
          resolvedShots,
          resolvedVideoProvider.providerId,
          resolvedVideoProvider.model
          // referencesMap (4th arg): passed in Phase 7 (bd-74fy)
        );

        // Security invariant (DR-6 / AC-7): apiKey MUST NEVER appear in batch output.
        if (!assertApiKeyAbsent(serializedPayload)) {
          console.error(chalk.red('❌ Security violation: API key detected in batch payload. Aborting export.'));
          exitWithCode(ExitCode.GENERAL_ERROR);
        }

        // AC-16: --jsonl flag writes JSONL format with _type:references sentinel
        let batchContent: string;
        if (options.jsonl) {
          batchContent = serializeBatchToJsonl(serializedPayload);
        } else {
          batchContent = JSON.stringify(serializedPayload, null, 2);
        }
        fs.writeFileSync(options.batchOutput, batchContent, 'utf-8');
        console.log(chalk.green(`✓ Batch payload saved to: ${options.batchOutput}${options.jsonl ? ' (JSONL)' : ''}\n`));
      }

      // Step 5: Write output
      // Determine output path (Requirement 1: Default Output Behavior)
      let outputPath = options.output;
      if (!outputPath) {
        // Generate default output filename: <input>-ai-shot-list.<extension>
        const inputBasename = path.basename(inputPath, path.extname(inputPath));
        const outputExtension = formatter.getExtension();
        outputPath = path.join(path.dirname(inputPath), `${inputBasename}-ai-shot-list.${outputExtension}`);
      }

      // Write output file
      fs.writeFileSync(outputPath, output, 'utf-8');
      console.log(chalk.green(`✓ Shot list saved to: ${outputPath}\n`));

      if (logging && logger) {
        const inputStats = fs.statSync(inputPath);
        const outputStats = fs.statSync(outputPath);
        await logger.logSuccess(
          'Output file written',
          {
            shotCount: shotList.totalShots,
            duration: shotList.totalDuration,
            characterCount: shotList.totalCharacters,
            processingTime: Date.now() - generationStartMs,
            warningCount: shotList.warnings.length,
            inputFileSize: inputStats.size,
            outputFileSize: outputStats.size
          },
          inputPath,
          outputPath,
          format
        );
      }

      console.log(chalk.green('✅ Shot list generation complete!\n'));

      // Phase 8 (bd-6c4f): Optional in-process video generation.
      // Only entered when --generate-video flag is set; shot entries are
      // passed in-memory — no intermediate JSONL file is written.
      if (options.generateVideo) {
        console.log(chalk.bold.blue('🎬 Starting in-process video generation...\n'));
        const videoGen = new FilmbuffVideoGenerator();
        const videoOptions: VideoGenerationOptions = {
          provider: options.provider ?? 'lumaai',
          model:    options.model,
          mock:     options.mock ?? false,
        };
        const videoOutputDir = options.videoOutput ?? './generated-videos';
        // Map Shot (generator domain) → ShotEntry (video-generator domain).
        // Shot.number  → shotNumber (coerced to number; sub-shots use scene number as fallback)
        // Shot.actions → action (video gen needs a single string)
        // Shot.set     → setDescription
        // Shot.characters → characterDescriptions (mapped to video-gen shape)
        // videoControls built from shot.duration; aspectRatio uses provider default
        const shotEntries = shotList.shots.map((shot, idx) => ({
          shotNumber:    typeof shot.number === 'number' ? shot.number : idx + 1,
          description:   shot.description,
          action:        shot.actions ?? undefined,
          setDescription: shot.set ?? undefined,
          characterDescriptions: shot.characters.map(ch => ({
            character:          ch.name,
            physicalAppearance: ch.physicalAppearance ?? ch.appearance,
            wardrobe:           ch.wardrobe ?? '',
          })),
          videoControls: { duration: shot.duration },
        }));

        const videoResults = await videoGen.generateForShotList(shotEntries, videoOptions);

        fs.mkdirSync(videoOutputDir, { recursive: true });
        const manifestPath = path.join(videoOutputDir, 'manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify(videoResults, null, 2) + '\n', 'utf-8');

        console.log(chalk.green(`✓ Video manifest written to: ${manifestPath}`));
        console.log(chalk.green(`✅ Video generation complete! (${videoResults.length} clip(s))\n`));
      }

      exitWithCode(ExitCode.SUCCESS);

    } catch (parseError: any) {
      console.error(chalk.red(`\n❌ Error during generation: ${parseError.message}\n`));

      if (logging && logger) {
        // Create error definition from the caught error
        const errorDef = {
          code: 'GE001',
          name: 'Generation Error',
          description: parseError.message,
          severity: 'error' as const,
          exitCode: ExitCode.GENERAL_ERROR,
          recovery: 'Check input file and try again',
          message: () => parseError.message,
          fix: () => 'Verify the screenplay file is valid and try again',
          autoFixable: false,
          relatedDocs: []
        };

        await logger.logError(errorDef, {
          inputFile: inputPath,
          stage: 'generation'
        }, parseError.stack);
      }

      exitWithCode(ExitCode.GENERAL_ERROR);
    }

  } catch (error) {
    console.error(chalk.red('Error generating shot list:'), error);
    exitWithCode(ExitCode.GENERAL_ERROR);
  }
}

