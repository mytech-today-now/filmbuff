/**
 * generate-video — Batch video generation from a JSONL shot list.
 *
 * Reads shot entries from --input (JSONL), optionally filters to --shots,
 * calls FilmbuffVideoGenerator.generateForShotList(), and writes a manifest
 * JSON to <--output>/manifest.json (default: ./generated-videos/).
 *
 * All six ai-powered typed errors are caught and translated to actionable
 * user messages. Exit code 0 on success, non-zero on any error.
 *
 * Flags:
 *   --input       <file>     JSONL shot list to read (required)
 *   --provider    <id>       Video provider (default: lumaai)
 *   --model       <id>       Model override for the selected provider
 *   --provider-options <json> JSON object with provider-specific options
 *   --shots       <list>     Comma-separated shot numbers to process
 *   --output      <dir>      Output directory (default: ./generated-videos/)
 *   --concurrency <n>        Batch size for concurrent generation (default: 3)
 *   --mock                   Activate ai-powered MockProvider (no network calls)
 *
 * Phase 8 of ai-powered-not-local change (bd-6c4f).
 * Spec: openspec/changes/ai-powered-not-local/specs/video-generation/spec.md
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import {
  FilmbuffVideoGenerator,
  type ShotEntry,
  type VideoGenerationOptions,
} from '../lib/video-generator.js';

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

export interface GenerateVideoOptions {
  input:        string;
  provider?:    string;
  model?:       string;
  shots?:       string;   // comma-separated shot numbers
  output?:      string;
  concurrency?: number;
  mock?:        boolean;
  providerOptions?: string | Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a JSONL file and return all non-empty JSON lines as ShotEntry objects. */
async function readShotList(filePath: string): Promise<ShotEntry[]> {
  const entries: ShotEntry[] = [];
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as ShotEntry);
    } catch {
      console.warn(chalk.yellow(`  Warning: skipped invalid JSON line: ${trimmed.slice(0, 80)}`));
    }
  }

  return entries;
}

/** Parse the --shots flag into a Set<number>. */
function parseShotFilter(shotsFlag?: string): Set<number> | null {
  if (!shotsFlag) return null;
  const nums = shotsFlag.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  return nums.length > 0 ? new Set(nums) : null;
}

export function parseProviderOptions(value?: string | Record<string, unknown>): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return { ...value };
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'invalid JSON';
    throw new Error(`--provider-options must be a JSON object: ${detail}.`);
  }
}

/** Translate ai-powered typed errors to user-actionable messages. */
function handleAiPoweredError(err: unknown): void {
  const name = (err as any)?.name ?? '';
  const msg  = (err as any)?.message ?? String(err);

  if (name === 'ProviderCapabilityError') {
    console.error(chalk.red('✗ Provider does not support the requested modality. Set the correct provider with --provider.'));
  } else if (name === 'AllProvidersExhaustedError') {
    console.error(chalk.red('✗ All providers exhausted:'));
    const reasons = (err as any).reasons ?? [];
    for (const { provider, reason } of reasons) {
      console.error(chalk.red(`  • ${provider}: ${reason}`));
    }
  } else if (name === 'CircuitOpenError') {
    const recovery = (err as any).estimatedRecovery ?? 'unknown';
    console.error(chalk.red(`✗ Provider temporarily unavailable. Estimated recovery: ${recovery}`));
  } else if (name === 'BudgetExceededError') {
    const { spent, limit, configPath } = err as any;
    console.error(chalk.red(`✗ Budget exceeded: spent ${spent}, limit ${limit}. Update your budget in ${configPath ?? 'ai-powered config'}.`));
  } else if (name === 'ConfigError') {
    console.error(chalk.red('✗ Configuration error:'));
    const issues = (err as any).issues ?? [msg];
    for (const issue of issues) console.error(chalk.red(`  • ${issue}`));
  } else if (name === 'ValidationError') {
    console.error(chalk.red('✗ Validation error (schema issues):'));
    const issues = (err as any).issues ?? [msg];
    for (const issue of issues) console.error(chalk.red(`  • ${issue}`));
    const raw = (err as any).rawResponse;
    if (raw) console.error(chalk.gray(`  Raw response: ${JSON.stringify(raw).slice(0, 200)}`));
    process.exit(2);
  } else {
    console.error(chalk.red(`✗ Video generation failed: ${msg}`));
  }
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function generateVideoCommand(options: GenerateVideoOptions): Promise<void> {
  console.log(chalk.bold.blue('\n🎬 FilmBuff — Generate Video\n'));

  // Validate --input
  if (!fs.existsSync(options.input)) {
    console.error(chalk.red(`✗ Input file not found: ${options.input}`));
    process.exit(1);
  }

  const provider    = options.provider    ?? 'lumaai';
  const concurrency = options.concurrency ?? 3;
  const outputDir   = options.output      ?? './generated-videos';
  const mock        = options.mock        ?? false;

  // Resolve effective provider for display (mock overrides)
  const effectiveProvider = mock ? 'mock' : provider;

  console.log(chalk.gray(`Input:       ${options.input}`));
  console.log(chalk.gray(`Provider:    ${effectiveProvider}${mock ? ' (mock mode — no network calls)' : ''}`));
  if (options.model) console.log(chalk.gray(`Model:       ${options.model}`));
  console.log(chalk.gray(`Concurrency: ${concurrency}`));
  console.log(chalk.gray(`Output dir:  ${outputDir}\n`));


  try {
    const providerOptions = parseProviderOptions(options.providerOptions);
    // 1. Read shot list
    console.log(chalk.gray('📖 Reading shot list...'));
    let shots = await readShotList(options.input);
    console.log(chalk.green(`✓ Loaded ${shots.length} shot(s)`));

    // 2. Filter to --shots subset
    const shotFilter = parseShotFilter(options.shots);
    if (shotFilter) {
      shots = shots.filter(s => shotFilter.has(s.shotNumber));
      console.log(chalk.gray(`   Filtered to ${shots.length} shot(s) matching: ${options.shots}`));
    }

    if (shots.length === 0) {
      console.warn(chalk.yellow('⚠ No shots to process.'));
      process.exit(0);
    }

    // 3. Generate videos
    console.log(chalk.gray('\n🎬 Generating videos...'));
    const gen = new FilmbuffVideoGenerator();
    const genOptions: VideoGenerationOptions = {
      provider: mock ? 'mock' : provider,
      model:    options.model,
      mock,
      providerOptions,
    };
    const results = await gen.generateForShotList(shots, genOptions, concurrency);

    console.log(chalk.green(`✓ Generated ${results.length} video(s)`));

    // 4. Write manifest
    fs.mkdirSync(outputDir, { recursive: true });
    const manifestPath = path.join(outputDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(results, null, 2) + '\n', 'utf-8');

    console.log(chalk.green(`✓ Manifest written to: ${manifestPath}`));
    console.log(chalk.green('\n✅ Video generation complete!\n'));
    process.exit(0);

  } catch (err) {
    handleAiPoweredError(err);
    process.exit(1);
  }
}
