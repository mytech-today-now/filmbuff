import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { displayHelp } from './generate-shot-list/help-text';
import { ExitCode, exitWithCode } from './generate-shot-list/exit-codes';
import { createParserAuto } from './generate-shot-list/parser';
import { createGenerator } from './generate-shot-list/generator';
import { createFormatter } from './generate-shot-list/formatter';
import { createLogger } from './generate-shot-list/logger';
import { createStyleSystem } from './generate-shot-list/style';
import { ConfigManager } from '../utils/config-system';
import {
  normalizeAIModel,
  normalizeAIProvider
} from '../utils/ai-provider-config';
import {
  AI_POWERED_DEFAULT_MODEL,
  AI_POWERED_DEFAULT_URL
} from '../utils/ai-powered-client';
// resolveActiveProvider / resolveProviderByProfile removed in bd-9uc4 Phase 2.
// Phase 4 (bd-tcey) will introduce resolveAIClient() from runtime-resolver.
import { loadFilmbuffConfig, resolveProvider } from '../lib/filmbuff-config';
import { loadPipelineInputs } from '../lib/pipeline-inputs';
import { validateBatchPayload } from '../lib/pre-export-validator';
import type { ValidatablePayload } from '../lib/pre-export-validator';
import { serializeBatchToJsonl } from '../lib/batch-serializer';
import type { OutputFormat } from './generate-shot-list/formatter/types';
import type { MergedStyleGuidelines } from './generate-shot-list/style/types';

interface GenerateShotListOptions {
  input?: string;
  format?: string;
  output?: string;
  maxCharacters?: number;
  maxShotLength?: number;
  logging?: boolean;
  style?: string | string[];  // Can be single string or array of strings
  muteSfx?: boolean;  // Remove all MUSIC and SOUND EFFECT content from output
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
  help?: boolean;
  h?: boolean;
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
    const appConfig = new ConfigManager().load();

    // Phase 2 (bd-9uc4): AI provider resolution (legacy CLI flags kept for backward-compat).
    // Phase 5 (bd-08b4): DEFAULT_AI_PROVIDER / DEFAULT_AI_MODEL removed from ai-provider-config.
    //   ai.provider/model from config are deprecated and ignored (deprecation warning emitted
    //   by ConfigManager.load()); we fall back to ai-powered defaults.
    const explicitProvider = normalizeAIProvider(options.aiProvider);
    const aiProvider: string =
      explicitProvider
      || AI_POWERED_DEFAULT_URL;   // legacy "provider" concept replaced by URL
    const aiModel: string =
      normalizeAIModel(options.aiModel)
      || AI_POWERED_DEFAULT_MODEL;
    console.log(chalk.gray(`Using AI provider: ${aiProvider}, model: ${aiModel}`));

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

    console.log(chalk.blue(`\n🎬 Generating AI Shot List...\n`));
    console.log(chalk.gray(`Processing: ${inputPath}`));
    console.log(chalk.gray(`Format: ${format}`));
    console.log(chalk.gray(`Max characters: ${maxCharacters}`));
    console.log(chalk.gray(`Max shot length: ${maxShotLength}s`));
    console.log(chalk.gray(`AI provider: ${aiProvider}`));
    console.log(chalk.gray(`AI model: ${aiModel}\n`));

    // Initialize logger if requested
    let logger;
    if (logging) {
      logger = await createLogger();
      await logger.logInfo('Shot list generation started', {
        inputFile: inputPath,
        format,
        maxCharacters,
        maxShotLength,
        aiProvider,
        aiModel
      });
    }

    // Load cinematic styles if requested
    let styleGuidelines: MergedStyleGuidelines | null = null;
    if (options.style) {
      const stylePaths = Array.isArray(options.style) ? options.style : [options.style];
      console.log(chalk.gray(`🎨 Loading cinematic styles...`));

      // Extensions root is the filmbuff directory in the parent of the CLI
      const extensionsRoot = path.join(__dirname, '../../../filmbuff');
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

      // Step 3: Generate shot list
      const generationStartMs = Date.now();
      console.log(chalk.gray('🎬 Generating shots...'));
      const generator = createGenerator(styleGuidelines, { aiProvider, aiModel });
      const shotList = await generator.generate(screenplay.scenes, {
        maxCharacters,
        maxShotLength,
        warningThreshold: 90, // 90% threshold for warnings
        includeContext: true,
        includeMetadata: true,
        muteSfx: options.muteSfx || false,
        aiProvider,
        aiModel
      });
      console.log(chalk.green(`✓ Generated ${shotList.totalShots} shots`));
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

        // Write batch payload (AFTER successful validation)
        // AC-16: --jsonl flag writes JSONL format with _type:references sentinel
        let batchContent: string;
        if (options.jsonl) {
          batchContent = serializeBatchToJsonl({
            provider: batchPayload.provider,
            model:    batchPayload.model,
            createdAt: new Date().toISOString(),
            references: batchPayload.references,
            items: batchPayload.items.map(i => ({
              id:       i.name,
              modality: 'video' as const,
              name:     i.name,
              prompt:   '',
              duration: 5,
              ...(i.references && { references: i.references }),
              ...(i.provider   && { provider:   i.provider }),
              ...(i.model      && { model:       i.model })
            }))
          });
        } else {
          batchContent = JSON.stringify(batchPayload, null, 2);
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

