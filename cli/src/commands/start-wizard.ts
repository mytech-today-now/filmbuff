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

import { input, select, confirm, checkbox, Separator } from '@inquirer/prompts';
import { ExitPromptError }                              from '@inquirer/core';
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

const VIDEO_ONLY_PROVIDERS = new Set(['lumaai', 'runway', 'stable-diffusion', 'pika']);

// ---------------------------------------------------------------------------
// Style module catalogue — grouped by category for the checkbox prompt
// ---------------------------------------------------------------------------

const _SP = 'writing-standards/screenplay/cinematic-styles';

const STYLE_MODULE_CHOICES: Array<InstanceType<typeof Separator> | { name: string; value: string }> = [
  new Separator(chalk.cyan('── Directors ──')),
  { name: 'Alfred Hitchcock',          value: `${_SP}/directors/alfred-hitchcock` },
  { name: 'Ari Aster',                 value: `${_SP}/directors/ari-aster` },
  { name: 'Brad Bird',                 value: `${_SP}/directors/brad-bird` },
  { name: 'Brian De Palma',            value: `${_SP}/directors/brian-de-palma` },
  { name: 'Buster Keaton',             value: `${_SP}/directors/buster-keaton` },
  { name: 'Christopher Nolan',         value: `${_SP}/directors/christopher-nolan` },
  { name: 'Clint Eastwood',            value: `${_SP}/directors/clint-eastwood` },
  { name: 'Coen Brothers',             value: `${_SP}/directors/coen-brothers` },
  { name: 'Darren Aronofsky',          value: `${_SP}/directors/darren-aronofsky` },
  { name: 'David Fincher',             value: `${_SP}/directors/david-fincher` },
  { name: 'David Lynch',               value: `${_SP}/directors/david-lynch` },
  { name: 'Denis Villeneuve',          value: `${_SP}/directors/denis-villeneuve` },
  { name: 'Francis Ford Coppola',      value: `${_SP}/directors/francis-ford-coppola` },
  { name: 'Gary Marshall',             value: `${_SP}/directors/gary-marshall` },
  { name: 'George A. Romero',          value: `${_SP}/directors/george-a-romero` },
  { name: 'George Lucas',              value: `${_SP}/directors/george-lucas` },
  { name: 'Guillermo Del Toro',        value: `${_SP}/directors/guillermo-del-toro` },
  { name: 'Gus Van Sant',              value: `${_SP}/directors/gus-van-sant` },
  { name: 'James Ivory / I. Merchant', value: `${_SP}/directors/james-ivory-ismail-merchant` },
  { name: 'Jim Jarmusch',              value: `${_SP}/directors/jim-jarmusch` },
  { name: 'John Carpenter',            value: `${_SP}/directors/john-carpenter` },
  { name: 'John Ford',                 value: `${_SP}/directors/john-ford` },
  { name: 'John Huston',               value: `${_SP}/directors/john-huston` },
  { name: 'John Landis',               value: `${_SP}/directors/john-landis` },
  { name: 'Jonathan Demme',            value: `${_SP}/directors/jonathan-demme` },
  { name: 'Joseph L. Mankiewicz',      value: `${_SP}/directors/joseph-l-mankiewicz` },
  { name: 'Kathryn Bigelow',           value: `${_SP}/directors/kathryn-bigelow` },
  { name: 'Kelly Reichardt',           value: `${_SP}/directors/kelly-reichardt` },
  { name: 'Kevin Smith',               value: `${_SP}/directors/kevin-smith` },
  { name: 'Linda Shayne',              value: `${_SP}/directors/linda-shayne` },
  { name: 'Martin Scorsese',           value: `${_SP}/directors/martin-scorsese` },
  { name: 'Mel Brooks',                value: `${_SP}/directors/mel-brooks` },
  { name: 'Michael Curtiz',            value: `${_SP}/directors/michael-curtiz` },
  { name: 'Michael Mann',              value: `${_SP}/directors/michael-mann` },
  { name: 'Mike Nichols',              value: `${_SP}/directors/mike-nichols` },
  { name: 'Orson Welles',              value: `${_SP}/directors/orson-welles` },
  { name: 'Park Chan-wook',            value: `${_SP}/directors/park-chan-wook` },
  { name: 'Paul Thomas Anderson',      value: `${_SP}/directors/paul-thomas-anderson` },
  { name: 'Penny Marshall',            value: `${_SP}/directors/penny-marshall` },
  { name: 'Peter Bogdanovich',         value: `${_SP}/directors/peter-bogdanovich` },
  { name: 'Quentin Tarantino',         value: `${_SP}/directors/quentin-tarantino` },
  { name: 'Richard Linklater',         value: `${_SP}/directors/richard-linklater` },
  { name: 'Rob Reiner',                value: `${_SP}/directors/rob-reiner` },
  { name: 'Robert Altman',             value: `${_SP}/directors/robert-altman` },
  { name: 'Robert Eggers',             value: `${_SP}/directors/robert-eggers` },
  { name: 'Robert Zemeckis',           value: `${_SP}/directors/robert-zemeckis` },
  { name: 'Sam Peckinpah',             value: `${_SP}/directors/sam-peckinpah` },
  { name: 'Sidney Lumet',              value: `${_SP}/directors/sidney-lumet` },
  { name: 'Spike Lee',                 value: `${_SP}/directors/spike-lee` },
  { name: 'Stanley Donen / Gene Kelly',value: `${_SP}/directors/stanley-donen-gene-kelly` },
  { name: 'Stanley Kubrick',           value: `${_SP}/directors/stanley-kubrick` },
  { name: 'Steve Martin',              value: `${_SP}/directors/steve-martin` },
  { name: 'Steven Spielberg',          value: `${_SP}/directors/steven-spielberg` },
  { name: 'Sydney Pollack',            value: `${_SP}/directors/sydney-pollack` },
  { name: 'Terry Gilliam',             value: `${_SP}/directors/terry-gilliam` },
  { name: 'Tim Burton',                value: `${_SP}/directors/tim-burton` },
  { name: 'Tobe Hooper',               value: `${_SP}/directors/tobe-hooper` },
  { name: 'Wes Anderson',              value: `${_SP}/directors/wes-anderson` },
  { name: 'William Friedkin',          value: `${_SP}/directors/william-friedkin` },
  new Separator(chalk.cyan('── Franchises ──')),
  { name: 'Marvel Cinematic Universe', value: `${_SP}/franchises/mcu` },
  { name: 'Star Trek',                 value: `${_SP}/franchises/star-trek` },
  { name: 'Star Wars',                 value: `${_SP}/franchises/star-wars` },
  { name: 'Harry Potter',              value: `${_SP}/franchises/harry-potter` },
  { name: 'John Wick',                 value: `${_SP}/franchises/john-wick` },
  { name: 'James Bond',                value: `${_SP}/franchises/james-bond` },
  { name: 'Lord of the Rings',         value: `${_SP}/franchises/lord-of-the-rings` },
  { name: 'Fast & Furious',            value: `${_SP}/franchises/fast-and-furious` },
  new Separator(chalk.cyan('── Films ──')),
  { name: 'Blue Ruin',                 value: `${_SP}/films/blue-ruin` },
  new Separator(chalk.cyan('── Comedy Formats ──')),
  { name: 'Monty Python',              value: `${_SP}/comedy-formats/monty-python` },
  { name: 'Saturday Night Live',       value: `${_SP}/comedy-formats/saturday-night-live` },
  new Separator(chalk.cyan('── Narrative Theory ──')),
  { name: 'Joseph Campbell',           value: `${_SP}/narrative-theory/joseph-campbell` },
  new Separator(chalk.cyan('── Producers ──')),
  { name: 'Bruckheimer & Simpson',     value: `${_SP}/producers/bruckheimer-and-simpson` },
];

const TEXT_PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic (Claude)',
  openai:    'OpenAI (GPT)',
  google:    'Google (Gemini)',
  xai:       'xAI (Grok)',
  venice:    'Venice AI',
  custom:    'Custom / Ollama (local)',
  mock:      'Mock  (no API key — offline / CI testing)',
};

/**
 * Maps environment variable names to their provider id.
 * Used to detect which providers are configured via .env without needing a
 * ~/.ai-powered/config.json.  Any provider whose key is present and non-empty
 * is treated as "available" and shown in the wizard.
 */
const ENV_KEY_TO_PROVIDER: ReadonlyArray<{ envKey: string; provider: string }> = [
  { envKey: 'OPENAI_API_KEY',      provider: 'openai'    },
  { envKey: 'ANTHROPIC_API_KEY',   provider: 'anthropic' },
  { envKey: 'XAI_API_KEY',         provider: 'xai'       },
  { envKey: 'VENICE_API_KEY',      provider: 'venice'    },
  { envKey: 'LUMAAI_API_KEY',      provider: 'lumaai'    },
  { envKey: 'PIKA_API_KEY',        provider: 'pika'      },
  { envKey: 'RUNWAYML_API_SECRET', provider: 'runway'    },
  { envKey: 'AI_CUSTOM_API_KEY',   provider: 'custom'    },
  { envKey: 'AI_CUSTOM_BASE_URL',  provider: 'custom'    },
];

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
// Step 8: Narrative Length
// ---------------------------------------------------------------------------

/**
 * Industry-standard narrative format catalogue.
 * Value strings are stored as narrative_format_id in the database.
 */
const NARRATIVE_LENGTH_CHOICES: Array<InstanceType<typeof Separator> | { name: string; value: string }> = [
  new Separator(chalk.cyan('── Short Content ──')),
  { name: 'micro-short      — Micro-short / flash (1–5 min, ~1–5 pages)',              value: 'micro-short'     },
  { name: 'short-film       — Short film (10–40 min, ~10–40 pages)',                    value: 'short-film'      },
  new Separator(chalk.cyan('── Television ──')),
  { name: 'tv-sketch        — TV sketch / short-form (5–15 min, ~5–15 pages)',          value: 'tv-sketch'       },
  { name: 'tv-half-hour     — TV half-hour comedy (22–30 min, ~22–30 pages)',           value: 'tv-half-hour'    },
  { name: 'tv-one-hour      — TV drama / procedural (42–60 min, ~42–60 pages)',         value: 'tv-one-hour'     },
  { name: 'miniseries-ep    — Mini-series episode (60–90 min, ~60–90 pages)',           value: 'miniseries-ep'   },
  { name: 'tv-movie         — TV movie / MOW (90 min, ~90 pages)',                      value: 'tv-movie'        },
  { name: 'streaming-pilot  — Streaming pilot (25–60 min, ~25–60 pages)',               value: 'streaming-pilot' },
  new Separator(chalk.cyan('── Feature Film ──')),
  { name: 'feature-short    — Short feature (70–89 min, ~70–89 pages)',                 value: 'feature-short'   },
  { name: 'feature-std      — Feature film, standard (90–110 min, ~90–110 pages)',      value: 'feature-std'     },
  { name: 'feature-drama    — Feature drama / action (110–130 min, ~110–130 pages)',    value: 'feature-drama'   },
  { name: 'feature-epic     — Epic / blockbuster (130–180 min, ~130–180 pages)',        value: 'feature-epic'    },
  new Separator(chalk.cyan('── Web / Streaming Series ──')),
  { name: 'web-series-ep    — Web series episode (3–15 min, ~3–15 pages)',              value: 'web-series-ep'   },
  new Separator(chalk.cyan('── Stage & Live Performance ──')),
  { name: 'one-act          — One-act play (~20–45 min)',                               value: 'one-act'         },
  { name: 'stage-full       — Full-length stage play (~90–120 min)',                    value: 'stage-full'      },
  { name: 'stage-musical    — Stage musical (~90–150 min)',                             value: 'stage-musical'   },
  new Separator(chalk.cyan('── Documentary ──')),
  { name: 'doc-short        — Short documentary (15–40 min)',                           value: 'doc-short'       },
  { name: 'doc-feature      — Feature documentary (75–120 min)',                        value: 'doc-feature'     },
  new Separator(chalk.cyan('── Other ──')),
  { name: '(skip / not set) — Determine later',                                         value: '(skip)'          },
];

async function stepNarrativeLength(prefill?: string): Promise<string | undefined> {
  printBanner(8);
  const choice = await select({
    message:  'Narrative length  (industry-standard format):',
    default:  prefill ?? '(skip)',
    pageSize: 16,
    choices:  NARRATIVE_LENGTH_CHOICES,
  });
  return choice === '(skip)' ? undefined : choice;
}

// ---------------------------------------------------------------------------
// Steps 9–11: Format, Detail Level, Style Modules
// ---------------------------------------------------------------------------

async function stepFormat(prefill?: WizardState['format']): Promise<WizardState['format']> {
  printBanner(9);  // 9a
  const preChecked = new Set<string>(prefill ?? ['md']);

  let selected: WizardState['format'] = [];
  while (selected.length === 0) {
    selected = await checkbox({
      message: 'Default output format(s)  (↑/↓ move  Space select  Enter confirm):',
      choices: [
        { name: 'md       — Markdown  (recommended for editing and version control)', value: 'md'       as const, checked: preChecked.has('md')       },
        { name: 'json     — JSON  (machine-readable; useful for downstream tooling)',  value: 'json'     as const, checked: preChecked.has('json')     },
        { name: 'fountain — Fountain  (industry-standard screenplay plain text)',      value: 'fountain' as const, checked: preChecked.has('fountain') },
        { name: 'pdf      — PDF  (fixed layout; requires a Markdown → PDF renderer)',  value: 'pdf'      as const, checked: preChecked.has('pdf')      },
      ],
    }) as WizardState['format'];
    if (selected.length === 0) {
      console.log(chalk.yellow('  ⚠ Please select at least one output format.'));
    }
  }

  if (selected.length > 1) {
    console.log(chalk.dim(`  → Primary format: ${selected[0]}  (${selected.length} formats selected; first = default)`));
  }
  return selected;
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
  const preChecked = new Set<string>(prefill ?? []);

  console.log(chalk.dim('  Select cinematic style modules in priority order (top = highest priority).'));
  console.log(chalk.dim('  Use Space to select, Enter to confirm. Press Enter with nothing selected to skip.\n'));

  const selected = await checkbox({
    message: 'Select cinematic style modules:',
    pageSize: 18,
    choices: STYLE_MODULE_CHOICES.map((c) => {
      if (c instanceof Separator) return c;
      return { ...c, checked: preChecked.has(c.value) };
    }),
  });

  if (selected.length > 0) {
    console.log(chalk.green('\n  ✓ Selected style modules (priority order):'));
    selected.forEach((s, i) => console.log(chalk.green(`    ${i + 1}. ${s}`)));
  }

  return selected;
}


// ---------------------------------------------------------------------------
// Steps 11–12: AI Provider & Profile Discovery
// ---------------------------------------------------------------------------

/** Profile cache — keyed by provider ID; persists across Edit loop iterations. */
const profileCache = new Map<string, Array<{ name: string; isActive: boolean }> | null>();

/**
 * Scan process.env for known API key variable names and return a deduplicated
 * list of provider ids that have a non-empty key configured.
 */
function _detectEnvProviders(): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  for (const { envKey, provider } of ENV_KEY_TO_PROVIDER) {
    if (process.env[envKey]?.trim() && !seen.has(provider)) {
      seen.add(provider);
      found.push(provider);
    }
  }
  return found;
}

async function stepProvider(prefill?: string): Promise<string | undefined> {
  printBanner(11);

  // AI_PROVIDER env var sets the default selection.
  const envProvider = process.env['AI_PROVIDER'];

  // Detect ALL providers that have API keys in the environment.
  const envDetectedProviders = _detectEnvProviders();

  const spinner = ora('Discovering configured AI providers…').start();

  // providers === null  → loadConfig threw AND no env vars found
  // providers === []    → fresh-install (no config + no env keys found)
  // providers.length>0  → providers from config or env discovery
  let providers: Array<{ id: string; isActive: boolean }> | null = null;
  try {
    const config = await loadConfig();
    spinner.succeed('AI providers loaded.');
    const raw: Array<{ id: string; isActive?: boolean }> =
      ((config as any).providers ?? []);
    providers = raw
      .filter((p) => !VIDEO_ONLY_PROVIDERS.has(p.id))
      .map((p) => ({ id: p.id, isActive: p.isActive ?? false }));
  } catch {
    spinner.stop();
    providers = [];
  }

  // Merge env-detected providers into the list.
  // Any provider with an API key in .env should appear, even if the
  // ~/.ai-powered/config.json hasn't registered it yet.
  for (const id of envDetectedProviders) {
    if (!VIDEO_ONLY_PROVIDERS.has(id) && !providers.some(p => p.id === id)) {
      providers.push({ id, isActive: false });
    }
  }

  // Apply AI_PROVIDER env var: mark it active or inject it if missing.
  if (envProvider && !VIDEO_ONLY_PROVIDERS.has(envProvider)) {
    const exists = providers.some(p => p.id === envProvider);
    if (exists) {
      providers = providers.map(p => ({ ...p, isActive: p.id === envProvider }));
    } else {
      providers = [{ id: envProvider, isActive: true }, ...providers];
    }
  }

  // Show info about where providers were discovered from.
  if (providers.length === 0) {
    console.log(chalk.yellow(
      '  ⚠ No providers found in ~/.ai-powered/config.json or .env API keys.\n' +
      '    Add API keys to your .env file (e.g. OPENAI_API_KEY=sk-...).'
    ));
    providers = [];
  } else if (envDetectedProviders.length > 0) {
    console.log(chalk.blue(
      `  ℹ Providers discovered from .env: ${envDetectedProviders.filter(p => !VIDEO_ONLY_PROVIDERS.has(p)).join(', ')}`
    ));
  }

  // providers is never null at this point; empty means no keys found.
  const isFreshInstall = providers.length === 0;

  const providerChoices = (isFreshInstall
    ? Object.entries(TEXT_PROVIDER_DISPLAY_NAMES).map(([id, name]) => ({
        name: `${id.padEnd(14)} — ${name}`,
        value: id, short: id,
      }))
    : providers.map((p) => ({
        name:  `${p.id.padEnd(14)} — ${TEXT_PROVIDER_DISPLAY_NAMES[p.id] ?? p.id}${p.isActive ? '  (active ★)' : ''}`,
        value: p.id, short: p.id,
      }))
  );

  const choices = [
    ...providerChoices,
    { name: '(use global default — resolved at runtime by ai-powered)', value: '(global default)', short: 'global default' },
  ];

  const activeId = providers.find(p => p.isActive)?.id;
  // Precedence: explicit prefill > active from config > AI_PROVIDER env > 'mock' (fresh) / global default
  const defaultChoice =
    prefill ??
    activeId ??
    envProvider ??
    (isFreshInstall ? 'mock' : '(global default)');

  const chosen = await select({
    message: 'Select AI provider for this project:',
    default: defaultChoice,
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
  const title           = await stepTitle(prefill.title);
  const genre           = await stepGenre(prefill.genre);
  const slug            = await stepSlug(title, prefill.slug, deps.findBySlug);
  const tone            = await stepTone(prefill.tone);
  const audience        = await stepAudience(prefill.audience);
  const budget          = await stepBudget(prefill.budget);
  const outcome         = await stepOutcome(prefill.outcome);
  const narrativeLength = await stepNarrativeLength(prefill.narrativeLength);
  // Output directory is auto-derived from slug — no user prompt needed.
  const outputDir       = path.join(process.cwd(), 'output', slug);
  const format          = await stepFormat(prefill.format);
  const detail          = await stepDetail(prefill.detail);
  const styles          = await stepStyles(prefill.styles);
  return { title, genre, slug, tone, audience, budget, outcome, narrativeLength, outputDir, format, detail, styles };
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
  console.log(row('Length:',     state.narrativeLength));
  console.log(row('Output dir:', state.outputDir));
  console.log(row('Format:',     state.format.length > 1
    ? state.format.map((f, i) => `${i + 1}. ${f}`).join('  ')
    : state.format[0]));
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
    title:           state.title,
    genre:           state.genre,
    slug:            state.slug,
    tone:            state.tone,
    audience:        state.audience,
    budget:          state.budget,
    outcome:         state.outcome,
    narrativeLength: state.narrativeLength,
    outputDir:       state.outputDir,
    format:          state.format[0],   // primary format stored in DB; full list preserved in wizard state
    detail:          state.detail,
    styles:          [...state.styles],
    provider:        state.provider,
    profile:         state.profile,
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
