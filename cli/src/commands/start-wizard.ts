/**
 * start-wizard.ts — Interactive 12-step wizard for `filmbuff start`.
 *
 * Public API:
 *   startWizard(prefill?, deps?) → Promise<StartOptions>
 *
 * Design contract (openspec/changes/start-wizard/design.md):
 *   - Pure option-collector: never calls projectRepo.create() or sessionRepo.*
 *   - Self-suppresses when invoked from non-TTY context (handled in startCommand).
 *   - Provider/profile discovery fails gracefully; steps 11-12 skipped on error.
 *   - ExitPromptError (Ctrl-C) exits process 0 cleanly.
 *
 * Satisfies: bd-049a [start-wizard] Phase 5: Step Prompts 1-10
 *            bd-vlup  [start-wizard] Phase 6: Provider & Profile Discovery
 *            bd-orx4  [start-wizard] Phase 7: Confirmation Panel & Edit Loop
 */

import { input, select, confirm } from '@inquirer/prompts';
import { ExitPromptError }        from '@inquirer/core';
import chalk from 'chalk';
import ora   from 'ora';
import * as path from 'path';
import * as fs   from 'fs';

import { deriveSlug, normaliseGenre, buildEquivalentCommand, WizardState }
  from '../utils/wizard-utils.js';
import { loadConfig } from '../utils/filmbuff-ai-client.js';
import type { StartOptions } from './start.js';

// ---------------------------------------------------------------------------
// Public dependency-injection interface
// ---------------------------------------------------------------------------

/**
 * Optional deps injected from startCommand so the wizard stays testable
 * without a live database.  When findBySlug is absent, the slug collision
 * pre-flight check is skipped (DuplicateSlugError from projectRepo.create()
 * still catches the duplicate).
 */
export interface WizardDeps {
  findBySlug?: (slug: string) => unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 12;

const VIDEO_ONLY_PROVIDERS = new Set(['lumaai', 'runway', 'stable-diffusion']);

const TEXT_PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic (Claude)',
  openai:    'OpenAI (GPT)',
  google:    'Google (Gemini)',
  xai:       'xAI (Grok)',
  venice:    'Venice AI',
  mock:      'Mock  (no API key — offline / CI testing)',
};

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

function printBanner(step: number): void {
  const label  = `  🎬  FilmBuff New Project Wizard  ${step}/${TOTAL_STEPS}  `;
  const border = '─'.repeat(label.length);
  console.log(chalk.cyan(`┌${border}┐`));
  console.log(chalk.cyan('│') + label + chalk.cyan('│'));
  console.log(chalk.cyan(`└${border}┘`));
}

// ---------------------------------------------------------------------------
// Steps 1–3: Title, Genre, Slug
// ---------------------------------------------------------------------------

async function stepTitle(prefill?: string): Promise<string> {
  printBanner(1);
  const title = await input({
    message:  'Project title:',
    default:  prefill,
    validate: (v) => {
      const t = v.trim();
      if (!t)           return chalk.red('✗ Title is required.');
      if (t.length < 3)   return chalk.red('✗ Title must be at least 3 characters.');
      if (t.length > 120) return chalk.red(`✗ Title must be 120 characters or fewer (currently ${t.length}).`);
      return true;
    },
  });
  const slug = deriveSlug(title.trim());
  console.log(chalk.dim(`  → slug preview: ${slug}`));
  return title.trim();
}

async function stepGenre(prefill?: string): Promise<string> {
  printBanner(2);
  const raw = await input({
    message:  'Genre:',
    default:  prefill,
    validate: (v) => {
      const t = v.trim();
      if (!t)           return chalk.red('✗ Genre is required.');
      if (t.length < 2)   return chalk.red('✗ Genre must be at least 2 characters.');
      if (t.length > 60)  return chalk.red('✗ Genre must be 60 characters or fewer.');
      return true;
    },
  });
  return normaliseGenre(raw.trim());
}

async function stepSlug(
  title:       string,
  prefill?:    string,
  findBySlug?: (slug: string) => unknown,
): Promise<string> {
  printBanner(3);
  const derived = deriveSlug(title);

  while (true) {
    const slug = await input({
      message:  'Project slug  (URL-safe identifier):',
      default:  prefill ?? derived,
      validate: (v) =>
        /^[a-z0-9][a-z0-9-]+[a-z0-9]$/.test(v)
          ? true
          : chalk.red('✗ Slug must match pattern [a-z0-9][a-z0-9-]+[a-z0-9].'),
    });

    if (findBySlug && findBySlug(slug)) {
      console.log(chalk.yellow(`  ⚠ A project with slug "${slug}" already exists. Choose a different slug.`));
      prefill = undefined;
      continue;
    }
    return slug;
  }
}


// ---------------------------------------------------------------------------
// Steps 4–7: Tone, Audience, Budget, Outcome
// ---------------------------------------------------------------------------

async function stepTone(prefill?: string): Promise<string | undefined> {
  printBanner(4);
  const v = await input({
    message:  'Tone  (e.g. dark, comedic, hopeful, gritty, whimsical):',
    default:  prefill,
    validate: (v) =>
      v.length > 80 ? chalk.red('✗ Tone must be 80 characters or fewer.') : true,
  });
  return v.trim() || undefined;
}

async function stepAudience(prefill?: string): Promise<string | undefined> {
  printBanner(5);
  const v = await input({
    message:  'Target audience:',
    default:  prefill,
    validate: (v) =>
      v.length > 120 ? chalk.red('✗ Audience must be 120 characters or fewer.') : true,
  });
  return v.trim() || undefined;
}

async function stepBudget(
  prefill?: WizardState['budget'],
): Promise<WizardState['budget']> {
  printBanner(6);
  const choice = await select({
    message: 'Budget tier:',
    default: prefill ?? '(skip)',
    choices: [
      { name: 'micro   — Ultra-low budget; single location, minimal crew, no named cast', value: 'micro'  },
      { name: 'low     — Independent / festival; 2–5 locations, small crew',             value: 'low'    },
      { name: 'mid     — Mid-level studio or streamer; multiple locations, union crew',   value: 'mid'    },
      { name: 'studio  — Major studio release; unlimited locations, full crew, VFX',     value: 'studio' },
      { name: '(skip / not set)',                                                         value: '(skip)' },
    ],
  });
  return choice === '(skip)' ? undefined : (choice as WizardState['budget']);
}

async function stepOutcome(prefill?: string): Promise<string | undefined> {
  printBanner(7);
  const v = await input({
    message:  'Desired outcome or logline intent:',
    default:  prefill,
    validate: (v) =>
      v.length > 200 ? chalk.red('✗ Outcome must be 200 characters or fewer.') : true,
  });
  return v.trim() || undefined;
}

// ---------------------------------------------------------------------------
// Steps 8–10: Output Directory, Format, Detail Level, Style Modules
// ---------------------------------------------------------------------------

async function stepOutputDir(slug: string, prefill?: string): Promise<string> {
  printBanner(8);
  const defaultDir = path.join(process.cwd(), 'output', slug);
  const target     = prefill ?? defaultDir;

  if (fs.existsSync(target)) {
    console.log(chalk.yellow(
      `  ⚠ Directory "${target}" already exists.\n` +
      `    Existing files with matching names will be overwritten.\n` +
      `    Press Enter to continue, or type a new path.`
    ));
  }

  return await input({ message: 'Output directory:', default: target });
}

async function stepFormat(prefill?: WizardState['format']): Promise<WizardState['format']> {
  printBanner(9);  // 9a
  return await select({
    message: 'Default output format:',
    default: prefill ?? 'md',
    choices: [
      { name: 'md       — Markdown  (recommended for editing and version control)', value: 'md'       },
      { name: 'json     — JSON  (machine-readable; useful for downstream tooling)',  value: 'json'     },
      { name: 'fountain — Fountain  (industry-standard screenplay plain text)',      value: 'fountain' },
      { name: 'pdf      — PDF  (fixed layout; requires a Markdown → PDF renderer)',  value: 'pdf'      },
    ],
  }) as WizardState['format'];
}

async function stepDetail(prefill?: WizardState['detail']): Promise<WizardState['detail']> {
  // 9b — no separate banner; runs immediately after 9a in the same step slot
  return await select({
    message: 'Detail level:',
    default: prefill ?? 'standard',
    choices: [
      { name: 'brief    — Concise summaries; faster generation, lower token cost',   value: 'brief'    },
      { name: 'standard — Balanced output  (default)',                               value: 'standard' },
      { name: 'detailed — Comprehensive, verbose; best for full-length screenplays', value: 'detailed' },
    ],
  }) as WizardState['detail'];
}

async function stepStyles(prefill?: string[]): Promise<string[]> {
  printBanner(10);
  const styles: string[] = [...(prefill ?? [])];

  if (styles.length > 0) {
    console.log(chalk.dim('  Current style modules:'));
    styles.forEach((s, i) => console.log(chalk.dim(`    ${i + 1}. ${s}`)));
  }

  while (true) {
    const entry = await input({
      message: styles.length === 0
        ? 'Add a cinematic style module path? (Press Enter to skip)'
        : 'Add another style module path? (Press Enter to finish)',
    });

    if (!entry.trim()) break;
    styles.push(entry.trim());
    console.log(chalk.green(`  ✓ Added: ${entry.trim()}`));

    const addMore = await confirm({ message: 'Add another style module?', default: false });
    if (!addMore) break;
  }

  return styles;
}


// ---------------------------------------------------------------------------
// Steps 11–12: AI Provider & Profile Discovery
// ---------------------------------------------------------------------------

/** Profile cache — keyed by provider ID; persists across Edit loop iterations. */
const profileCache = new Map<string, Array<{ name: string; isActive: boolean }> | null>();

async function stepProvider(prefill?: string): Promise<string | undefined> {
  printBanner(11);
  const spinner = ora('Discovering configured AI providers…').start();

  let providers: Array<{ id: string; isActive: boolean }> | null = null;
  try {
    const config = await loadConfig();
    spinner.succeed('AI providers loaded.');
    providers = ((config as any).providers ?? []).filter(
      (p: { id: string }) => !VIDEO_ONLY_PROVIDERS.has(p.id)
    );
  } catch {
    spinner.stop();
  }

  if (providers === null) {
    console.log(chalk.yellow(
      '  ⚠ Could not load AI provider list (ai-powered may not be configured).\n' +
      '    Skipping provider selection — the global ai-powered default will be used.\n' +
      '    Run "filmbuff ai status" after project creation to inspect your provider.'
    ));
    return undefined;
  }

  const isFreshInstall = providers.length === 0;
  if (isFreshInstall) {
    console.log(chalk.yellow(
      '  ⚠ No AI provider is configured. "mock" uses in-process responses (no API key).\n' +
      '    Run: ai-powered config set provider anthropic  after setup.'
    ));
  }

  const providerChoices = isFreshInstall
    ? Object.entries(TEXT_PROVIDER_DISPLAY_NAMES).map(([id, name]) => ({
        name: `${id.padEnd(14)} — ${name}`,
        value: id, short: id,
      }))
    : providers.map((p) => ({
        name:  `${p.id.padEnd(14)} — ${TEXT_PROVIDER_DISPLAY_NAMES[p.id] ?? p.id}${p.isActive ? '  (active ★)' : ''}`,
        value: p.id, short: p.id,
      }));

  const choices = [
    ...providerChoices,
    { name: '(use global default — resolved at runtime by ai-powered)', value: '(global default)', short: 'global default' },
  ];

  const activeId = providers.find(p => p.isActive)?.id;
  const chosen = await select({
    message: 'Select AI provider for this project:',
    default: prefill ?? (isFreshInstall ? 'mock' : activeId ?? '(global default)'),
    choices,
  });

  return chosen === '(global default)' ? undefined : chosen;
}

async function stepProfile(providerId: string, prefill?: string): Promise<string | undefined> {
  printBanner(12);

  if (!profileCache.has(providerId)) {
    const spinner = ora(`Loading profiles for ${providerId}…`).start();
    try {
      const config   = await loadConfig();
      const all      = ((config as any).profiles ?? []) as Array<{ name: string; providerId: string; isActive: boolean }>;
      const filtered = all.filter(p => p.providerId === providerId)
        .map(p => ({ name: p.name, isActive: p.isActive }));
      spinner.succeed(`Profiles loaded for ${providerId}.`);
      profileCache.set(providerId, filtered);
    } catch {
      spinner.stop();
      profileCache.set(providerId, null);
    }
  }

  const profiles = profileCache.get(providerId)!;

  if (profiles === null) {
    console.log(chalk.yellow(
      `  ⚠ Could not load profiles for "${providerId}" — skipping profile selection.\n` +
      `    The provider's default profile will be used at runtime.`
    ));
    return undefined;
  }

  const choices = [
    ...profiles.map(p => ({ name: `${p.name}${p.isActive ? '  (active ★)' : ''}`, value: p.name, short: p.name })),
    { name: '(enter a profile name manually)', value: '(manual)', short: 'manual' },
    { name: '(skip / use provider default)',   value: '(skip)',   short: 'skip'   },
  ];

  const chosen = await select({
    message: 'Select profile:',
    default: prefill ?? (profiles.find(p => p.isActive)?.name ?? '(skip)'),
    choices,
  });

  if (chosen === '(skip)') return undefined;
  if (chosen === '(manual)') {
    const manual = await input({
      message:  'Profile name:',
      validate: (v) => v.trim() ? true : chalk.red('✗ Profile name cannot be empty.'),
    });
    return manual.trim();
  }
  return chosen;
}


// ---------------------------------------------------------------------------
// Orchestrators — run all steps in sequence
// ---------------------------------------------------------------------------

/** Partial WizardState returned after steps 1–10 (provider/profile not yet collected). */
type Steps1to10Result = Omit<WizardState, 'provider' | 'profile'>;

async function runSteps1to10(
  prefill: Partial<WizardState> = {},
  deps: WizardDeps = {},
): Promise<Steps1to10Result> {
  const title     = await stepTitle(prefill.title);
  const genre     = await stepGenre(prefill.genre);
  const slug      = await stepSlug(title, prefill.slug, deps.findBySlug);
  const tone      = await stepTone(prefill.tone);
  const audience  = await stepAudience(prefill.audience);
  const budget    = await stepBudget(prefill.budget);
  const outcome   = await stepOutcome(prefill.outcome);
  const outputDir = await stepOutputDir(slug, prefill.outputDir);
  const format    = await stepFormat(prefill.format);
  const detail    = await stepDetail(prefill.detail);
  const styles    = await stepStyles(prefill.styles);
  return { title, genre, slug, tone, audience, budget, outcome, outputDir, format, detail, styles };
}

async function runAllSteps(
  prefill: Partial<WizardState> = {},
  deps: WizardDeps = {},
): Promise<WizardState> {
  const partial  = await runSteps1to10(prefill, deps);
  const provider = await stepProvider(prefill.provider);
  const profile  = provider
    ? await stepProfile(provider, prefill.profile)
    : undefined;
  return { ...partial, provider, profile };
}

// ---------------------------------------------------------------------------
// Confirmation Panel
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 70;

function renderSummaryTable(state: WizardState): void {
  const border = '─'.repeat(PANEL_WIDTH);
  const row = (label: string, value: string | undefined): string => {
    const displayValue = value ?? chalk.dim('(not set)');
    const padded = `  ${label.padEnd(14)} ${displayValue}`;
    return chalk.cyan('│') + padded.padEnd(PANEL_WIDTH) + chalk.cyan('│');
  };

  console.log(chalk.cyan(`┌${border}┐`));
  console.log(chalk.cyan('│') + chalk.bold('  📋  Review your project settings').padEnd(PANEL_WIDTH) + chalk.cyan('│'));
  console.log(chalk.cyan(`├${border}┤`));
  console.log(row('Title:',      state.title));
  console.log(row('Genre:',      state.genre));
  console.log(row('Slug:',       state.slug));
  console.log(row('Tone:',       state.tone));
  console.log(row('Audience:',   state.audience));
  console.log(row('Budget:',     state.budget));
  console.log(row('Outcome:',    state.outcome));
  console.log(row('Output dir:', state.outputDir));
  console.log(row('Format:',     state.format));
  console.log(row('Detail:',     state.detail));

  if (state.styles.length === 0) {
    console.log(row('Style mods:', chalk.dim('(none)')));
  } else {
    state.styles.forEach((s, i) => console.log(row(i === 0 ? 'Style mods:' : '', s)));
  }

  const providerValue = state.provider
    ? `${state.provider}${state.profile ? `  (profile: ${state.profile})` : ''}`
    : undefined;
  console.log(row('AI provider:', providerValue));
  console.log(chalk.cyan(`└${border}┘`));
}

async function confirmationPanel(state: WizardState): Promise<boolean> {
  renderSummaryTable(state);
  console.log('');
  console.log(chalk.dim('  Equivalent command:'));
  console.log(chalk.gray(
    buildEquivalentCommand(state).split('\n').map(l => `  ${l}`).join('\n')
  ));
  console.log('');
  return await confirm({ message: 'Proceed?', default: true });
}

// ---------------------------------------------------------------------------
// Edit / Start Over / Quit prompt
// ---------------------------------------------------------------------------

type PostDeclineAction = 'edit' | 'start-over' | 'quit';

async function promptEditOrQuit(): Promise<PostDeclineAction> {
  return await select<PostDeclineAction>({
    message: 'What would you like to do?',
    choices: [
      { name: '[E]dit       — Return to Step 1 with all values pre-filled; change any field', value: 'edit',       short: 'Edit'       },
      { name: '[S]tart over — Clear all values and restart from Step 1',                      value: 'start-over', short: 'Start Over' },
      { name: '[Q]uit       — Cancel project creation and exit',                              value: 'quit',       short: 'Quit'       },
    ],
  });
}


// ---------------------------------------------------------------------------
// State ↔ StartOptions mapping
// ---------------------------------------------------------------------------

/**
 * Map WizardState → StartOptions.
 * Always returns a new object; never mutates state.
 * The wizard, noWizard, and AI override fields are intentionally excluded —
 * they are cli.ts flags that the wizard does not control.
 */
export function stateToStartOptions(state: WizardState): StartOptions {
  return {
    title:     state.title,
    genre:     state.genre,
    slug:      state.slug,
    tone:      state.tone,
    audience:  state.audience,
    budget:    state.budget,
    outcome:   state.outcome,
    outputDir: state.outputDir,
    format:    state.format,
    detail:    state.detail,
    styles:    [...state.styles],
    provider:  state.provider,
    profile:   state.profile,
  };
}

// ---------------------------------------------------------------------------
// Outer wizard loop
// ---------------------------------------------------------------------------

/**
 * Outer loop: run all 12 steps → confirmation panel → edit/start-over/quit.
 *
 * Edit:       re-enter from Step 1 with current state as defaults.
 * Start Over: clear all values; restart from Step 1 with no defaults.
 * Quit:       exit 0 — no database write.
 */
async function runWizardLoop(
  prefill: Partial<WizardState> = {},
  deps: WizardDeps = {},
): Promise<StartOptions> {
  while (true) {
    const state     = await runAllSteps(prefill, deps);
    const confirmed = await confirmationPanel(state);

    if (confirmed) return stateToStartOptions(state);

    const action = await promptEditOrQuit();

    if (action === 'quit') {
      console.log('\nProject creation cancelled.');
      process.exit(0);
    }
    if (action === 'start-over') {
      prefill = {};
      continue;
    }
    // action === 'edit': re-enter with current state as defaults
    prefill = stateToStartOptions(state) as Partial<WizardState>;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Launch the interactive 12-step project-setup wizard.
 *
 * @param prefill  Optional partial options from CLI flags — used as step defaults.
 * @param deps     Optional dependency overrides (e.g. findBySlug for slug collision
 *                 pre-flight without coupling wizard to the DB layer directly).
 * @returns        Fully populated StartOptions ready for projectRepo.create().
 *
 * Never calls projectRepo.create() or sessionRepo.* — it is a pure option-collector.
 * ExitPromptError (Ctrl-C) is caught here; process exits 0 cleanly.
 */
export async function startWizard(
  prefill: Partial<StartOptions> = {},
  deps: WizardDeps = {},
): Promise<StartOptions> {
  try {
    return await runWizardLoop(prefill as Partial<WizardState>, deps);
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === 'ExitPromptError') {
      console.log('\nProject creation cancelled.');
      process.exit(0);
    }
    throw err;  // re-throw unexpected errors
  }
}
