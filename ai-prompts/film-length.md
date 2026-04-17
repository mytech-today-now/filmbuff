# FilmBuff — Narrative Length Selection Feature

## Overview

Add a **Narrative Length** step to the `filmbuff start` wizard, the `filmbuff start` CLI flags, the project database schema, and every downstream content-generation pipeline stage. The user selects a target runtime from an industry-comprehensive, categorized dropdown (15-second web ad → 3-hour epic) at project creation time. That choice becomes a hard constraint propagated to every AI generation call, every shot-duration budget, every page-count target, and every content validation warning — so generated content is always the correct length.

**Key principle:** It is useless to produce a screenplay, a shot list, or an AI video batch that runs 45 minutes when the user asked for a 30-second commercial. Length compliance must be enforced end-to-end.

---

## Scope of Changes

| Layer | Files | Nature |
|---|---|---|
| Catalog constant | `cli/src/utils/narrative-length-catalog.ts` | **New file** |
| Wizard utilities | `cli/src/utils/wizard-utils.ts` | **Update** `WizardState`, `buildEquivalentCommand`, `stateToStartOptions` |
| Wizard step | `cli/src/commands/start-wizard.ts` | **Insert** new Step 3A; update `TOTAL_STEPS`, `renderSummaryTable` |
| CLI options | `cli/src/cli.ts` | **Add** `--target-duration`, `--narrative-format` flags to `start` command |
| Start command | `cli/src/commands/start.ts` | **Update** `StartOptions`; forward new fields to `projectRepo.create()` |
| DB migration | `cli/src/db/migrations/002_add_target_duration.sql` | **New file** |
| DB types | `cli/src/db/types.ts` | **Update** `Project`, `CreateProjectInput` |
| DB repository | `cli/src/db/project-repository.ts` | **Update** `INSERT_PROJECT` SQL constant |
| Shot-list generator | `cli/src/commands/generate-shot-list.ts` | **Propagate** duration budget to generator config |
| Generator config | `cli/src/commands/generate-shot-list/generator/index.ts` | **Accept** `totalBudgetSeconds` constraint |
| Generator types | `cli/src/commands/generate-shot-list/generator/types.ts` | **Extend** `GeneratorConfig` |
| AI prompt context | All content-gen commands that call AI | **Inject** duration metadata into every prompt |

---

## 1. Narrative Length Catalog

### 1.1 — New file: `cli/src/utils/narrative-length-catalog.ts`

Create an exported constant `NARRATIVE_LENGTH_CATALOG` that is the single source of truth for all selectable narrative lengths. The catalog is grouped into **categories** for multi-column display in the wizard.

Each entry carries:
- `id` — machine-readable slug used as the stored value in the database
- `label` — human-readable display name shown in the wizard dropdown
- `seconds` — canonical total runtime in whole seconds (integer, no floats)
- `category` — grouping category for visual separators
- `pageCountTarget` — derived from `Math.round(seconds / 60)` (1 page ≈ 1 minute of screen time)
- `typicalGenres` — optional advisory list; used for genre-coherence warnings

```typescript
// cli/src/utils/narrative-length-catalog.ts

export interface NarrativeLengthEntry {
  readonly id:              string;
  readonly label:           string;
  readonly seconds:         number;   // always a positive integer
  readonly category:        NarrativeCategory;
  readonly pageCountTarget: number;   // Math.round(seconds / 60)
  readonly typicalGenres?:  string[];
}

export type NarrativeCategory =
  | 'ads-commercials'
  | 'social-web'
  | 'short-film'
  | 'tv-episode'
  | 'tv-movie'
  | 'feature-film'
  | 'epic-extended';

export const NARRATIVE_LENGTH_CATALOG: readonly NarrativeLengthEntry[] = [

  // ── Ads & Commercials ──────────────────────────────────────────────────────
  { id: 'ad-6s',   label: '6-second bumper ad',         seconds:    6, category: 'ads-commercials', pageCountTarget: 1 },
  { id: 'ad-15s',  label: '15-second spot',             seconds:   15, category: 'ads-commercials', pageCountTarget: 1 },
  { id: 'ad-30s',  label: '30-second commercial',       seconds:   30, category: 'ads-commercials', pageCountTarget: 1 },
  { id: 'ad-60s',  label: '60-second commercial',       seconds:   60, category: 'ads-commercials', pageCountTarget: 1 },
  { id: 'ad-90s',  label: '90-second extended spot',    seconds:   90, category: 'ads-commercials', pageCountTarget: 2 },
  { id: 'ad-2m',   label: '2-minute brand film',        seconds:  120, category: 'ads-commercials', pageCountTarget: 2 },

  // ── Social & Web ───────────────────────────────────────────────────────────
  { id: 'web-15s', label: '15-second TikTok / Reel',    seconds:   15, category: 'social-web', pageCountTarget: 1 },
  { id: 'web-30s', label: '30-second social clip',      seconds:   30, category: 'social-web', pageCountTarget: 1 },
  { id: 'web-60s', label: '60-second YouTube short',    seconds:   60, category: 'social-web', pageCountTarget: 1 },
  { id: 'web-3m',  label: '3-minute web series ep.',    seconds:  180, category: 'social-web', pageCountTarget: 3 },
  { id: 'web-5m',  label: '5-minute explainer / vlog',  seconds:  300, category: 'social-web', pageCountTarget: 5 },
  { id: 'web-10m', label: '10-minute YouTube episode',  seconds:  600, category: 'social-web', pageCountTarget: 10 },
  { id: 'web-20m', label: '20-minute web series ep.',   seconds: 1200, category: 'social-web', pageCountTarget: 20 },

  // ── Short Film ─────────────────────────────────────────────────────────────
  { id: 'short-5m',  label: '5-minute short film',      seconds:  300, category: 'short-film', pageCountTarget:  5, typicalGenres: ['drama', 'comedy', 'horror'] },
  { id: 'short-10m', label: '10-minute short film',     seconds:  600, category: 'short-film', pageCountTarget: 10 },
  { id: 'short-15m', label: '15-minute short film',     seconds:  900, category: 'short-film', pageCountTarget: 15 },
  { id: 'short-20m', label: '20-minute short film',     seconds: 1200, category: 'short-film', pageCountTarget: 20 },
  { id: 'short-30m', label: '30-minute short / featurette', seconds: 1800, category: 'short-film', pageCountTarget: 30 },
  { id: 'short-40m', label: '40-minute medium film',    seconds: 2400, category: 'short-film', pageCountTarget: 40 },

  // ── TV Episode ─────────────────────────────────────────────────────────────
  { id: 'tv-11m',  label: '11-minute animated episode', seconds:  660, category: 'tv-episode', pageCountTarget: 11, typicalGenres: ['animation', 'comedy'] },
  { id: 'tv-22m',  label: '22-minute sitcom / half-hour', seconds: 1320, category: 'tv-episode', pageCountTarget: 22, typicalGenres: ['comedy', 'animation'] },
  { id: 'tv-30m',  label: '30-minute drama / prestige comedy', seconds: 1800, category: 'tv-episode', pageCountTarget: 30 },
  { id: 'tv-44m',  label: '44-minute network drama',    seconds: 2640, category: 'tv-episode', pageCountTarget: 44, typicalGenres: ['drama', 'thriller', 'sci-fi'] },
  { id: 'tv-50m',  label: '50-minute streaming drama',  seconds: 3000, category: 'tv-episode', pageCountTarget: 50 },
  { id: 'tv-60m',  label: '60-minute cable drama / prestige', seconds: 3600, category: 'tv-episode', pageCountTarget: 60 },
  { id: 'tv-75m',  label: '75-minute prestige / limited series ep.', seconds: 4500, category: 'tv-episode', pageCountTarget: 75 },
  { id: 'tv-90m',  label: '90-minute season finale / pilot', seconds: 5400, category: 'tv-episode', pageCountTarget: 90 },

  // ── TV Movie ───────────────────────────────────────────────────────────────
  { id: 'tv-movie-75m',  label: '75-minute TV movie',   seconds: 4500, category: 'tv-movie', pageCountTarget:  75 },
  { id: 'tv-movie-90m',  label: '90-minute TV movie',   seconds: 5400, category: 'tv-movie', pageCountTarget:  90 },
  { id: 'tv-movie-120m', label: '120-minute TV movie',  seconds: 7200, category: 'tv-movie', pageCountTarget: 120 },

  // ── Feature Film ───────────────────────────────────────────────────────────
  { id: 'feature-70m',  label: '70-minute micro-feature',   seconds:  4200, category: 'feature-film', pageCountTarget:  70, typicalGenres: ['horror', 'comedy', 'documentary'] },
  { id: 'feature-80m',  label: '80-minute tight feature',   seconds:  4800, category: 'feature-film', pageCountTarget:  80, typicalGenres: ['horror', 'comedy', 'thriller'] },
  { id: 'feature-90m',  label: '90-minute comedy / horror', seconds:  5400, category: 'feature-film', pageCountTarget:  90, typicalGenres: ['comedy', 'horror', 'romance'] },
  { id: 'feature-100m', label: '100-minute drama',          seconds:  6000, category: 'feature-film', pageCountTarget: 100, typicalGenres: ['drama', 'thriller'] },
  { id: 'feature-110m', label: '110-minute thriller',       seconds:  6600, category: 'feature-film', pageCountTarget: 110, typicalGenres: ['thriller', 'action', 'sci-fi'] },
  { id: 'feature-120m', label: '120-minute drama / action', seconds:  7200, category: 'feature-film', pageCountTarget: 120, typicalGenres: ['drama', 'action', 'adventure'] },
  { id: 'feature-130m', label: '130-minute action / sci-fi',seconds:  7800, category: 'feature-film', pageCountTarget: 130, typicalGenres: ['action', 'sci-fi', 'fantasy'] },
  { id: 'feature-150m', label: '150-minute prestige drama', seconds:  9000, category: 'feature-film', pageCountTarget: 150, typicalGenres: ['drama', 'historical'] },
  { id: 'feature-180m', label: '180-minute epic / war film',seconds: 10800, category: 'feature-film', pageCountTarget: 180, typicalGenres: ['war', 'epic', 'historical'] },

  // ── Epic & Extended ────────────────────────────────────────────────────────
  { id: 'epic-200m', label: '200-minute director\'s cut',   seconds: 12000, category: 'epic-extended', pageCountTarget: 200 },
  { id: 'epic-210m', label: '210-minute roadshow epic',     seconds: 12600, category: 'epic-extended', pageCountTarget: 210 },
  { id: 'epic-240m', label: '240-minute mega-epic',         seconds: 14400, category: 'epic-extended', pageCountTarget: 240 },
  { id: 'epic-300m', label: '300-minute limited series pilot / epic', seconds: 18000, category: 'epic-extended', pageCountTarget: 300 },
];

/** Lookup a catalog entry by its `id`. Returns undefined if not found. */
export function findNarrativeLength(id: string): NarrativeLengthEntry | undefined {
  return NARRATIVE_LENGTH_CATALOG.find(e => e.id === id);
}

/** Format total seconds as a human-readable runtime string, e.g. "1:30:00" or "0:30". */
export function formatRuntime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Compute three-act structure time budgets from total seconds (Syd Field paradigm). */
export function computeThreeActBudget(totalSeconds: number): {
  actOne:   number;  // ~25% of total
  actTwo:   number;  // ~50% of total
  actThree: number;  // ~25% of total
} {
  return {
    actOne:   Math.round(totalSeconds * 0.25),
    actTwo:   Math.round(totalSeconds * 0.50),
    actThree: Math.round(totalSeconds * 0.25),
  };
}
```

**Validation invariants (enforced at catalog definition time):**
- Every `seconds` value is a positive integer.
- `pageCountTarget === Math.round(seconds / 60)` for all entries.
- Every `id` is unique across the catalog.

---

## 2. Wizard Step 3A — Narrative Length

Insert this step **between** the existing Step 3 (Slug) and Step 4 (Tone) in `start-wizard.ts`. Update `TOTAL_STEPS` from `11` to `12`.

### 2.1 — UI Appearance

```
┌─────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  4/12  │
└─────────────────────────────────────────┘

? Narrative length / target runtime:
  ── Ads & Commercials ──
    6-second bumper ad                (0:06)
    15-second spot                    (0:15)
  ❯ 30-second commercial              (0:30)
    60-second commercial              (1:00)
    90-second extended spot           (1:30)
    2-minute brand film               (2:00)
  ── Social & Web ──
    15-second TikTok / Reel           (0:15)
    30-second social clip             (0:30)
    ...
  ── Short Film ──
    ...
  ── TV Episode ──
    ...
  ── Feature Film ──
    90-minute comedy / horror         (1:30:00)
    ...
  ── Epic & Extended ──
    ...
    300-minute limited series pilot   (5:00:00)
  ── (skip / not set) ──
```

- **Prompt type:** `select` from `@inquirer/prompts`
- **Choices:** Generated dynamically from `NARRATIVE_LENGTH_CATALOG`, grouped by `category` using `new Separator(chalk.cyan('── <Category Label> ──'))` between groups.
- **Choice format:** Each item displays `label` left-aligned and `(formatRuntime(seconds))` dim right-aligned. Use padding to align the runtime column.
- **Optional skip:** A `(skip / not set)` option at the end maps to `undefined` for `targetDurationSeconds` and `narrativeFormatId`.
- **Pre-fill:** If the wizard is re-entered (Edit mode), restore the previously chosen `narrativeFormatId` as the default.
- **Genre coherence hint:** After selection, if the project genre was already set and the chosen entry has `typicalGenres` that do not include it, print a dim advisory hint (never an error):
  ```
    ℹ  Note: "150-minute prestige drama" is most common for drama / historical genres.
  ```

### 2.2 — Implementation in `start-wizard.ts`

```typescript
// In start-wizard.ts — new step function

import {
  NARRATIVE_LENGTH_CATALOG,
  findNarrativeLength,
  formatRuntime,
  NarrativeCategory,
} from '../utils/narrative-length-catalog.js';

const CATEGORY_LABELS: Record<NarrativeCategory, string> = {
  'ads-commercials': 'Ads & Commercials',
  'social-web':      'Social & Web',
  'short-film':      'Short Film',
  'tv-episode':      'TV Episode',
  'tv-movie':        'TV Movie',
  'feature-film':    'Feature Film',
  'epic-extended':   'Epic & Extended',
};

async function stepNarrativeLength(
  prefill?: string,
  genre?: string,
): Promise<{ narrativeFormatId: string | undefined; targetDurationSeconds: number | undefined }> {

  // Build choices with Separator headers between categories
  type Choice = { name: string; value: string; short: string };
  const choices: Array<InstanceType<typeof Separator> | Choice> = [];

  let lastCategory: NarrativeCategory | null = null;
  for (const entry of NARRATIVE_LENGTH_CATALOG) {
    if (entry.category !== lastCategory) {
      choices.push(new Separator(chalk.cyan(`── ${CATEGORY_LABELS[entry.category]} ──`)));
      lastCategory = entry.category;
    }
    const runtimeLabel = chalk.dim(`(${formatRuntime(entry.seconds)})`);
    const paddedLabel  = entry.label.padEnd(42, ' ');
    choices.push({
      name:  `${paddedLabel}${runtimeLabel}`,
      value: entry.id,
      short: entry.label,
    });
  }

  // Add separator + skip option
  choices.push(new Separator(chalk.dim('────────────────────────────────────────────')));
  choices.push({ name: '(skip / not set)', value: '(skip)', short: 'skip' });

  const chosen = await select({
    message: 'Narrative length / target runtime:',
    default: prefill ?? '(skip)',
    choices,
    pageSize: 20,
  });

  if (chosen === '(skip)') {
    return { narrativeFormatId: undefined, targetDurationSeconds: undefined };
  }

  const entry = findNarrativeLength(chosen)!;

  // Genre coherence hint (advisory only — never blocks)
  if (
    genre &&
    entry.typicalGenres &&
    !entry.typicalGenres.some(g => genre.toLowerCase().includes(g))
  ) {
    console.log(
      chalk.dim(
        `  ℹ  Note: "${entry.label}" is most common for ` +
        `${entry.typicalGenres.join(' / ')} projects.\n`
      )
    );
  }

  // Print derived budget info as confirmation feedback
  const acts = computeThreeActBudget(entry.seconds);
  console.log(chalk.dim(
    `  → Pages target: ~${entry.pageCountTarget} pages   ` +
    `Act 1: ${formatRuntime(acts.actOne)} · ` +
    `Act 2: ${formatRuntime(acts.actTwo)} · ` +
    `Act 3: ${formatRuntime(acts.actThree)}\n`
  ));

  return { narrativeFormatId: chosen, targetDurationSeconds: entry.seconds };
}
```

---

## 3. `WizardState` and Utility Updates

### 3.1 — `cli/src/utils/wizard-utils.ts`

Add two new fields to `WizardState`:

```typescript
export interface WizardState {
  title:                 string;
  genre:                 string;
  slug:                  string;
  narrativeFormatId?:    string;        // NEW — catalog entry id, e.g. "feature-90m"
  targetDurationSeconds?: number;       // NEW — total runtime in whole seconds
  tone?:                 string;
  audience?:             string;
  budget?:               BudgetTier;
  outcome?:              string;
  outputDir:             string;
  format?:               DocumentFormat;
  detail:                DetailLevel;
  styles:                string[];
  provider?:             string;
  profile?:              string;
}
```

Update `buildEquivalentCommand()` to include `--target-duration` when set:

```typescript
// In buildEquivalentCommand(state: WizardState): string

if (state.targetDurationSeconds !== undefined) {
  parts.push(`  --target-duration ${state.targetDurationSeconds}`);
}
if (state.narrativeFormatId !== undefined) {
  parts.push(`  --narrative-format "${state.narrativeFormatId}"`);
}
```

Update `stateToStartOptions()` to map new fields:

```typescript
export function stateToStartOptions(state: WizardState): StartOptions {
  return {
    // ... existing fields ...
    targetDurationSeconds: state.targetDurationSeconds,
    narrativeFormatId:     state.narrativeFormatId,
  };
}
```

---

## 4. `StartOptions` Updates

### 4.1 — `cli/src/commands/start.ts`

Add two new optional fields to the `StartOptions` interface:

```typescript
export interface StartOptions {
  title:        string;
  genre:        string;
  slug?:        string;
  // ── NEW ────────────────────────────────────────────────────────────────────
  /** Total target runtime in whole seconds. E.g. 5400 for a 90-minute film. */
  targetDurationSeconds?: number;
  /** Catalog entry id from NARRATIVE_LENGTH_CATALOG. E.g. "feature-90m". */
  narrativeFormatId?:     string;
  // ── Existing fields (unchanged) ───────────────────────────────────────────
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
  // ... (all existing ai-powered override fields) ...
}
```

Update the `projectRepo.create()` call inside `startCommand()` to forward the new fields:

```typescript
const project = projectRepo.create({
  id:                    projectId,
  slug,
  display_title:         options.title,
  genre:                 options.genre,
  tone:                  options.tone,
  target_audience:       options.audience,
  budget_tier:           options.budget,
  outcome:               options.outcome,
  output_dir:            outputDir,
  format_override:       options.format,
  detail_level:          options.detail ?? 'standard',
  style_modules:         options.styles,
  active_provider_id:    options.provider,
  active_profile_name:   options.profile,
  // ── NEW ──────────────────────────────────────────────────────────────────
  target_duration_seconds: options.targetDurationSeconds,
  narrative_format_id:     options.narrativeFormatId,
});
```

---

## 5. CLI Flag Registration

### 5.1 — `cli/src/cli.ts`

Add the following options to the `start` command definition (after the existing `--outcome` option):

```typescript
program
  .command('start')
  // ... existing options ...
  .option(
    '--target-duration <seconds>',
    'Target narrative runtime in whole seconds (e.g. 5400 for 90 min). ' +
    'Constrains all downstream content generation to this total runtime.',
    (v: string) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n <= 0) throw new Error('--target-duration must be a positive integer (seconds).');
      return n;
    }
  )
  .option(
    '--narrative-format <id>',
    'Narrative length catalog id (e.g. "feature-90m"). ' +
    'Automatically sets --target-duration if provided and --target-duration is absent. ' +
    'Run `filmbuff narrative-lengths` to see all valid ids.'
  )
```

**Resolution logic in the `start` action handler** — when `--narrative-format` is provided but `--target-duration` is absent, derive `targetDurationSeconds` from the catalog:

```typescript
// Before calling startCommand(options):
if (options.narrativeFormat && options.targetDuration === undefined) {
  const entry = findNarrativeLength(options.narrativeFormat);
  if (!entry) {
    console.error(chalk.red(
      `Error: Unknown --narrative-format "${options.narrativeFormat}". ` +
      `Run \`filmbuff narrative-lengths\` to list valid ids.`
    ));
    process.exit(1);
  }
  options.targetDuration = entry.seconds;
}
```

### 5.2 — New `narrative-lengths` subcommand

Add a helper command so users (and CI scripts) can discover valid ids without launching the wizard:

```typescript
program
  .command('narrative-lengths')
  .description('List all valid narrative length ids and their runtimes')
  .option('--json', 'Output as JSON array instead of a table')
  .action((opts) => {
    if (opts.json) {
      console.log(JSON.stringify(NARRATIVE_LENGTH_CATALOG, null, 2));
    } else {
      console.log(chalk.bold('\nNarrative Length Catalog\n'));
      let lastCat = '';
      for (const e of NARRATIVE_LENGTH_CATALOG) {
        if (e.category !== lastCat) {
          console.log(chalk.cyan(`\n  ${CATEGORY_LABELS[e.category]}`));
          lastCat = e.category;
        }
        console.log(`    ${e.id.padEnd(20)} ${e.label.padEnd(42)} ${formatRuntime(e.seconds)}`);
      }
      console.log('');
    }
  });
```

---

## 6. Database Migration

### 6.1 — New migration: `cli/src/db/migrations/002_add_target_duration.sql`

```sql
-- Migration 002: Add narrative length fields to projects table.
-- target_duration_seconds: total runtime in whole seconds (INTEGER, nullable).
-- narrative_format_id:     catalog entry id string (TEXT, nullable).

ALTER TABLE projects ADD COLUMN
  target_duration_seconds INTEGER
  CHECK (target_duration_seconds IS NULL OR target_duration_seconds > 0);

ALTER TABLE projects ADD COLUMN
  narrative_format_id TEXT;
```

### 6.2 — `cli/src/db/types.ts` — Update `Project` and `CreateProjectInput`

```typescript
export interface Project {
  // ... existing fields ...
  target_duration_seconds: number | null;  // NEW
  narrative_format_id:     string | null;  // NEW
}

export interface CreateProjectInput {
  // ... existing fields ...
  target_duration_seconds?: number;  // NEW
  narrative_format_id?:     string;  // NEW
}
```

### 6.3 — `cli/src/db/project-repository.ts` — Update `INSERT_PROJECT`

```typescript
const INSERT_PROJECT = `
  INSERT INTO projects
    (id, slug, display_title, genre, tone, target_audience, budget_tier, outcome,
     output_dir, format_override, detail_level, style_modules,
     active_provider_id, active_profile_name,
     target_duration_seconds, narrative_format_id,
     status, created_at, updated_at)
  VALUES
    (@id, @slug, @display_title, @genre, @tone, @target_audience, @budget_tier, @outcome,
     @output_dir, @format_override, @detail_level, @style_modules,
     @active_provider_id, @active_profile_name,
     @target_duration_seconds, @narrative_format_id,
     'active', @now, @now)
`;
```

Update the `create()` method to pass the new nullable fields:

```typescript
this.db.prepare(INSERT_PROJECT).run({
  // ... existing fields ...
  target_duration_seconds: input.target_duration_seconds ?? null,
  narrative_format_id:     input.narrative_format_id     ?? null,
  now,
});
```

---

## 7. Downstream Duration Propagation

### 7.1 — `GeneratorConfig` extension (`cli/src/commands/generate-shot-list/generator/types.ts`)

```typescript
export interface GeneratorConfig {
  maxCharacters:       number;
  maxShotLength:       number;
  warningThreshold:    number;
  includeContext:      boolean;
  includeMetadata:     boolean;
  cinematicStyle?:     string;
  muteSfx?:            boolean;
  // ── NEW ────────────────────────────────────────────────────────────────────
  /**
   * Total narrative runtime budget in whole seconds.
   * When set, the generator enforces that the sum of all shot durations
   * does not exceed this value, and logs a warning if it does.
   */
  totalBudgetSeconds?: number;
  /**
   * Human-readable narrative format label, injected into AI prompt context.
   * E.g. "90-minute comedy / horror".
   */
  narrativeFormatLabel?: string;
}
```

### 7.2 — `generate-shot-list.ts` — Load and propagate budget

When `filmbuff generate-shot-list` is invoked, attempt to read `target_duration_seconds` from the project database row (if a project database is present in the output directory). Merge it with any `--target-duration` flag passed directly on the command line.

```typescript
// In generateShotListCommand(), after loading the project config:

// Resolve total budget: CLI flag takes precedence over project DB value.
const totalBudgetSeconds: number | undefined =
  options.targetDuration ??
  (loadedProject?.target_duration_seconds ?? undefined);

const narrativeFormatLabel: string | undefined =
  loadedProject?.narrative_format_id
    ? findNarrativeLength(loadedProject.narrative_format_id)?.label
    : undefined;

// Pass to generator
const shotList = await generator.generate(screenplay.scenes, {
  maxCharacters:       maxCharacters,
  maxShotLength:       maxShotLength,
  warningThreshold:    90,
  includeContext:      true,
  includeMetadata:     true,
  muteSfx:             options.muteSfx || false,
  totalBudgetSeconds,          // NEW
  narrativeFormatLabel,        // NEW
});
```

### 7.3 — Generator enforcement: total duration budget

In `cli/src/commands/generate-shot-list/generator/index.ts`, after all shots are computed, validate the total duration against the budget:

```typescript
// After generating all shots:
if (config.totalBudgetSeconds !== undefined) {
  const totalSeconds = shotList.totalDuration;
  if (totalSeconds > config.totalBudgetSeconds) {
    const overage = totalSeconds - config.totalBudgetSeconds;
    console.warn(chalk.yellow(
      `⚠  Shot list total duration ${formatRuntime(totalSeconds)} exceeds ` +
      `target runtime ${formatRuntime(config.totalBudgetSeconds)} ` +
      `by ${formatRuntime(overage)}. Consider reducing scene count or shot lengths.`
    ));
    shotList.warnings.push({
      type:    'duration-budget-exceeded',
      message: `Total shot duration (${totalSeconds}s) exceeds target runtime ` +
               `(${config.totalBudgetSeconds}s) by ${overage}s.`,
    });
  } else if (totalSeconds < config.totalBudgetSeconds * 0.80) {
    // Warn if more than 20% under budget — likely missing content
    console.warn(chalk.yellow(
      `⚠  Shot list total duration ${formatRuntime(totalSeconds)} is ` +
      `significantly under target runtime ${formatRuntime(config.totalBudgetSeconds)}. ` +
      `Consider adding more scenes or extending existing shots.`
    ));
  }
}
```

### 7.4 — AI prompt context injection

Every AI generation call (screenplay, logline, beat sheet, etc.) must include the target runtime in the system/context prompt. Add this to the shared prompt context builder:

```typescript
// In any function that builds an AI content-generation system prompt:

if (project.target_duration_seconds !== undefined) {
  const entry       = findNarrativeLength(project.narrative_format_id ?? '');
  const label       = entry?.label ?? formatRuntime(project.target_duration_seconds);
  const pageTarget  = entry?.pageCountTarget ?? Math.round(project.target_duration_seconds / 60);
  const acts        = computeThreeActBudget(project.target_duration_seconds);

  systemPrompt += `\n\n## Target Runtime Constraint\n` +
    `This project must run exactly **${label}** ` +
    `(${formatRuntime(project.target_duration_seconds)} / ~${pageTarget} pages).\n` +
    `This is a hard constraint. All content — logline, beat sheet, screenplay, ` +
    `and shot list — must be scoped to fit within this runtime.\n\n` +
    `Three-act structure budget (Syd Field paradigm):\n` +
    `- Act 1: ~${formatRuntime(acts.actOne)} (~${Math.round(acts.actOne/60)} pages)\n` +
    `- Act 2: ~${formatRuntime(acts.actTwo)} (~${Math.round(acts.actTwo/60)} pages)\n` +
    `- Act 3: ~${formatRuntime(acts.actThree)} (~${Math.round(acts.actThree/60)} pages)\n`;
}
```

---

## 8. Wizard Summary Panel Update

### 8.1 — `renderSummaryTable()` in `start-wizard.ts`

Add the new field to the confirmation panel displayed before project creation:

```
┌──────────────────────────────────────────────────────────┐
│  📋  Review your project settings                        │
├──────────────────────────────────────────────────────────┤
│  Title:          My Horror Short                         │
│  Genre:          horror                                  │
│  Slug:           my-horror-short                         │
│  Runtime target: 15-minute short film  (0:15:00 / ~15p) │  ← NEW
│  Tone:           dark, claustrophobic                    │
│  Audience:       Horror fans, festival circuit           │
│  Budget:         micro                                   │
│  Outcome:        Sundance submission                     │
│  Output dir:     ./output/my-horror-short                │
│  Format:         md                                      │
│  Detail:         standard                                │
│  Style mods:     (none)                                  │
│  AI provider:    anthropic  (profile: default)           │
└──────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
// In renderSummaryTable(state: WizardState):

if (state.narrativeFormatId && state.targetDurationSeconds !== undefined) {
  const entry = findNarrativeLength(state.narrativeFormatId);
  const display = entry
    ? `${entry.label}  (${formatRuntime(entry.seconds)} / ~${entry.pageCountTarget}p)`
    : formatRuntime(state.targetDurationSeconds);
  console.log(row('Runtime target:', display));
} else if (state.targetDurationSeconds !== undefined) {
  console.log(row('Runtime target:', formatRuntime(state.targetDurationSeconds)));
} else {
  console.log(row('Runtime target:', chalk.dim('(not set)')));
}
```

And in `buildEquivalentCommand()`:

```
  Equivalent command:
  filmbuff start \
    --title "My Horror Short" \
    --genre horror \
    --target-duration 900 \
    --narrative-format "short-15m" \
    --tone "dark, claustrophobic" \
    ...
```

---

## 9. Validation Rules

| Field | Required | Rule |
|---|---|---|
| `targetDurationSeconds` | No | When provided: positive integer, `> 0`. When derived from `narrativeFormatId`, the catalog value is authoritative. |
| `narrativeFormatId` | No | When provided: must be a valid `id` in `NARRATIVE_LENGTH_CATALOG`. |
| Duration coherence | Advisory | If both `--target-duration` and `--narrative-format` are provided and `seconds` from the catalog does not match `--target-duration`, emit a yellow warning and use `--target-duration` as the authoritative value. |

---

## 10. Acceptance Criteria

- [ ] `filmbuff start` wizard presents the Narrative Length dropdown as Step 4 (after Slug), with all catalog entries grouped by category using `Separator` headers.
- [ ] Selecting "90-minute comedy / horror" sets `targetDurationSeconds = 5400` and `narrativeFormatId = "feature-90m"` in the wizard state.
- [ ] Selecting "(skip / not set)" leaves both fields `undefined`.
- [ ] Genre coherence hint is printed (dim, advisory only) when the chosen narrative length's typical genres do not include the project genre. Hint never blocks advancement.
- [ ] After selection, the act-structure breakdown and page target are printed as dim feedback.
- [ ] The confirmation summary panel displays the narrative length label, formatted runtime, and page count target.
- [ ] The equivalent command includes `--target-duration 5400 --narrative-format "feature-90m"`.
- [ ] `filmbuff start --target-duration 5400 --genre horror --title "My Film"` bypasses the wizard and creates the project with the correct DB fields.
- [ ] `filmbuff start --narrative-format "feature-90m" --genre horror --title "My Film"` derives `targetDurationSeconds = 5400` automatically.
- [ ] `filmbuff narrative-lengths` prints the full catalog in table form; `filmbuff narrative-lengths --json` prints valid JSON.
- [ ] Database migration `002_add_target_duration.sql` runs without error on an existing database that has no `target_duration_seconds` column.
- [ ] `project.target_duration_seconds` is stored as an integer in the database.
- [ ] `filmbuff generate-shot-list` reads `target_duration_seconds` from the project DB row and passes it as `totalBudgetSeconds` to the generator.
- [ ] If total shot duration exceeds `totalBudgetSeconds`, a `duration-budget-exceeded` warning is added to `shotList.warnings` and a yellow message is printed.
- [ ] If total shot duration is below 80% of `totalBudgetSeconds`, an under-budget warning is printed.
- [ ] Every AI content-generation call includes the runtime constraint, act structure breakdown, and page target in the system/context prompt when `target_duration_seconds` is set.
- [ ] All existing wizard tests pass without modification (no regression).
- [ ] All existing `ProjectRepository` tests pass without modification (no regression).
- [ ] New unit tests cover: `findNarrativeLength`, `formatRuntime`, `computeThreeActBudget`, wizard step 3A happy path, wizard step 3A skip, CLI flag derivation (`--narrative-format` → `targetDurationSeconds`), DB migration idempotency.

---

## 11. Example Usage

```bash
# Launch wizard — user selects narrative length interactively
filmbuff start

# Non-wizard: supply duration in seconds directly
filmbuff start \
  --title "The Midnight Garden" \
  --genre thriller \
  --target-duration 6600 \
  --tone "dark, psychological"

# Non-wizard: supply narrative format id (duration derived automatically)
filmbuff start \
  --title "Corner Office" \
  --genre comedy \
  --narrative-format "tv-22m" \
  --audience "Adults 25-45, streaming"

# Non-wizard: 30-second commercial
filmbuff start \
  --title "Apex Energy Drink Launch" \
  --genre commercial \
  --narrative-format "ad-30s" \
  --budget micro \
  --outcome "Broadcast on national TV during Q4"

# Non-wizard: 3-hour epic
filmbuff start \
  --title "The Last Crusade" \
  --genre "historical epic" \
  --narrative-format "feature-180m" \
  --budget studio \
  --tone "sweeping, operatic"

# Generate shot list constrained to project duration
filmbuff generate-shot-list \
  --input output/my-thriller/screenplay.fountain

# Generate shot list with explicit duration override (ignores project DB value)
filmbuff generate-shot-list \
  --input output/my-thriller/screenplay.fountain \
  --target-duration 6600

# List all valid narrative format ids
filmbuff narrative-lengths

# List as JSON (for scripting)
filmbuff narrative-lengths --json
```
