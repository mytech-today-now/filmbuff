# JIRA Ticket: FB-NAR-1 — Narrative Length Selection: End-to-End Runtime Constraint for `filmbuff`

---

## Summary

Add a **Narrative Length** selection step to the `filmbuff start` wizard, the `filmbuff start` CLI flags, the project database schema, and every downstream content-generation pipeline stage. The user selects a target runtime from an industry-comprehensive, categorized dropdown (6-second web bumper → 5-hour epic) at project creation time. That choice becomes a hard constraint propagated to every AI generation call, every shot-duration budget, every page-count target, and every content-validation warning — so generated content is always the correct length.

**Key principle:** It is useless to produce a screenplay, a shot list, or an AI video batch that runs 45 minutes when the user asked for a 30-second commercial. Length compliance must be enforced end-to-end.

---

## Issue Type
**Epic / Feature**

## Priority
**High**

## Story Points
**21**

## Component / Labels
`filmbuff-cli` · `wizard` · `narrative-length` · `database-migration` · `shot-list-generator` · `ai-prompt-context` · `cli-flags`

## Epic Link
`[EPIC] filmbuff Project Configuration & Content Constraint System`

---

## Background & Motivation

### Problem 1 — No Runtime Budget Exists

The current `filmbuff start` wizard collects title, genre, tone, audience, budget tier, and outcome — but has no concept of **how long** the finished film should be. As a result, AI content-generation calls receive no length constraint whatsoever. A screenplay generated for a 30-second commercial is indistinguishable from one generated for a 90-minute feature; the AI fills whatever length it deems appropriate.

> **Example:** A user creates a project with `--genre commercial --outcome "Broadcast on national TV during Q4"`. Running `filmbuff generate-shot-list` produces a shot list totaling 6 minutes 42 seconds. The user wanted a 30-second spot. Every shot, every dialogue beat, every scene transition must be thrown away and rebuilt from scratch because no runtime constraint was ever communicated to the AI or the generator.

### Problem 2 — Shot-List Generator Has No Duration Budget

`filmbuff generate-shot-list` generates shots with per-shot durations, but has no total-budget guard. Even with a perfect screenplay, the generator can silently produce a shot list that runs 15% over or 30% under the intended runtime. There is no warning, no page-count target, and no act-structure time budget to guide the AI.

> **Example:** A 44-minute network drama episode (`tv-44m`, 2,640 seconds, ~44 pages) is being produced. The generator creates 61 shots totaling 54 minutes. The overage is discovered only during the video compilation step — after 54 minutes of AI video credits have been spent. A `duration-budget-exceeded` warning at generation time would have caught this immediately.

### Problem 3 — AI Prompts Have No Runtime Awareness

Every AI content-generation call — logline, beat sheet, screenplay, shot list — is issued without any runtime metadata. The AI cannot calibrate scene count, dialogue density, or act pacing because it does not know the target runtime. A single injected paragraph in the system prompt would enforce this constraint at zero cost.

> **Example:** An AI-generated beat sheet for a `feature-120m` project (7,200 seconds / ~120 pages) should allocate approximately 30 pages to Act 1, 60 pages to Act 2, and 30 pages to Act 3. Without this instruction in the system prompt, the AI may produce a 17-scene beat sheet appropriate for a 22-minute TV episode, and the generator will dutifully comply.

---

## Solution Overview

1. Create `cli/src/utils/narrative-length-catalog.ts` — a single source-of-truth constant covering 37 industry-standard runtime presets across 7 categories.
2. Insert Step 3A ("Narrative Length") into the `filmbuff start` wizard between Slug and Tone.
3. Add `--target-duration <seconds>` and `--narrative-format <id>` flags to `filmbuff start`.
4. Add a `filmbuff narrative-lengths` discovery command.
5. Persist `target_duration_seconds` and `narrative_format_id` to the project database via migration `002_add_target_duration.sql`.
6. Propagate `totalBudgetSeconds` to the shot-list generator; emit over- and under-budget warnings.
7. Inject runtime metadata (label, page count, three-act budget) into every AI system prompt.

---

## Detailed Requirements

### DR-1 — Narrative Length Catalog (`narrative-length-catalog.ts`)

**New file:** `cli/src/utils/narrative-length-catalog.ts`

The catalog is the single source of truth for all selectable narrative lengths. It must not be derived at runtime — it is a compile-time constant. Every entry carries `id`, `label`, `seconds`, `category`, `pageCountTarget`, and optional `typicalGenres`.

**Interface and type definitions:**

```typescript
// cli/src/utils/narrative-length-catalog.ts

export interface NarrativeLengthEntry {
  readonly id:              string;          // machine-readable slug; stored in DB
  readonly label:           string;          // human-readable display name
  readonly seconds:         number;          // total runtime; always a positive integer
  readonly category:        NarrativeCategory;
  readonly pageCountTarget: number;          // Math.round(seconds / 60)
  readonly typicalGenres?:  string[];        // advisory genre-coherence hints
}

export type NarrativeCategory =
  | 'ads-commercials'
  | 'social-web'
  | 'short-film'
  | 'tv-episode'
  | 'tv-movie'
  | 'feature-film'
  | 'epic-extended';
```

**Validation invariants (enforced at catalog definition time, not at runtime):**
- Every `seconds` value is a positive integer. No floats.
- `pageCountTarget === Math.round(seconds / 60)` for every entry without exception.
- Every `id` is unique across the entire catalog.
- Every `category` value is one of the seven `NarrativeCategory` union members.

**Utility functions exported from the same file:**

```typescript
/** Look up a catalog entry by its `id`. Returns undefined if not found. */
export function findNarrativeLength(id: string): NarrativeLengthEntry | undefined {
  return NARRATIVE_LENGTH_CATALOG.find(e => e.id === id);
}

/**
 * Format total seconds as a human-readable runtime string.
 * Examples: 6 → "0:06", 90 → "1:30", 5400 → "1:30:00", 18000 → "5:00:00"
 */
export function formatRuntime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Compute three-act structure time budgets from total seconds (Syd Field paradigm).
 * Act 1 ≈ 25%, Act 2 ≈ 50%, Act 3 ≈ 25%.
 * The three values sum to exactly totalSeconds (rounding adjustments applied to Act 2).
 */
export function computeThreeActBudget(totalSeconds: number): {
  actOne:   number;  // ~25% of total
  actTwo:   number;  // ~50% of total
  actThree: number;  // ~25% of total
} {
  const actOne   = Math.round(totalSeconds * 0.25);
  const actThree = Math.round(totalSeconds * 0.25);
  const actTwo   = totalSeconds - actOne - actThree;  // absorbs rounding delta
  return { actOne, actTwo, actThree };
}
```

**`formatRuntime` examples:**

| Input (`seconds`) | Output |
|---|---|
| `6` | `"0:06"` |
| `15` | `"0:15"` |
| `30` | `"0:30"` |
| `90` | `"1:30"` |
| `660` | `"11:00"` |
| `3600` | `"1:00:00"` |
| `5400` | `"1:30:00"` |
| `10800` | `"3:00:00"` |
| `18000` | `"5:00:00"` |

**`computeThreeActBudget` examples:**

| Total (`seconds`) | Act 1 | Act 2 | Act 3 |
|---|---|---|---|
| `1800` (30 min) | `450` (7:30) | `900` (15:00) | `450` (7:30) |
| `5400` (90 min) | `1350` (22:30) | `2700` (45:00) | `1350` (22:30) |
| `7200` (120 min) | `1800` (30:00) | `3600` (60:00) | `1800` (30:00) |
| `10800` (180 min) | `2700` (45:00) | `5400` (1:30:00) | `2700` (45:00) |

**Full catalog excerpt (representative entries from each category):**

```typescript
export const NARRATIVE_LENGTH_CATALOG: readonly NarrativeLengthEntry[] = [

  // ── Ads & Commercials (6 entries) ──────────────────────────────────────────
  { id: 'ad-6s',   label: '6-second bumper ad',         seconds:    6, category: 'ads-commercials', pageCountTarget: 1 },
  { id: 'ad-15s',  label: '15-second spot',             seconds:   15, category: 'ads-commercials', pageCountTarget: 1 },
  { id: 'ad-30s',  label: '30-second commercial',       seconds:   30, category: 'ads-commercials', pageCountTarget: 1 },
  { id: 'ad-60s',  label: '60-second commercial',       seconds:   60, category: 'ads-commercials', pageCountTarget: 1 },
  { id: 'ad-90s',  label: '90-second extended spot',    seconds:   90, category: 'ads-commercials', pageCountTarget: 2 },
  { id: 'ad-2m',   label: '2-minute brand film',        seconds:  120, category: 'ads-commercials', pageCountTarget: 2 },

  // ── Social & Web (7 entries) ───────────────────────────────────────────────
  { id: 'web-15s', label: '15-second TikTok / Reel',    seconds:   15, category: 'social-web', pageCountTarget: 1 },
  { id: 'web-30s', label: '30-second social clip',      seconds:   30, category: 'social-web', pageCountTarget: 1 },
  { id: 'web-60s', label: '60-second YouTube short',    seconds:   60, category: 'social-web', pageCountTarget: 1 },
  { id: 'web-3m',  label: '3-minute web series ep.',    seconds:  180, category: 'social-web', pageCountTarget: 3 },
  { id: 'web-5m',  label: '5-minute explainer / vlog',  seconds:  300, category: 'social-web', pageCountTarget: 5 },
  { id: 'web-10m', label: '10-minute YouTube episode',  seconds:  600, category: 'social-web', pageCountTarget: 10 },
  { id: 'web-20m', label: '20-minute web series ep.',   seconds: 1200, category: 'social-web', pageCountTarget: 20 },

  // ── Short Film (6 entries) ─────────────────────────────────────────────────
  { id: 'short-5m',  label: '5-minute short film',          seconds:  300, category: 'short-film', pageCountTarget:  5, typicalGenres: ['drama', 'comedy', 'horror'] },
  { id: 'short-10m', label: '10-minute short film',         seconds:  600, category: 'short-film', pageCountTarget: 10 },
  { id: 'short-15m', label: '15-minute short film',         seconds:  900, category: 'short-film', pageCountTarget: 15 },
  { id: 'short-20m', label: '20-minute short film',         seconds: 1200, category: 'short-film', pageCountTarget: 20 },
  { id: 'short-30m', label: '30-minute short / featurette', seconds: 1800, category: 'short-film', pageCountTarget: 30 },
  { id: 'short-40m', label: '40-minute medium film',        seconds: 2400, category: 'short-film', pageCountTarget: 40 },

  // ── TV Episode (8 entries) ─────────────────────────────────────────────────
  { id: 'tv-11m',  label: '11-minute animated episode',           seconds:  660, category: 'tv-episode', pageCountTarget: 11, typicalGenres: ['animation', 'comedy'] },
  { id: 'tv-22m',  label: '22-minute sitcom / half-hour',         seconds: 1320, category: 'tv-episode', pageCountTarget: 22, typicalGenres: ['comedy', 'animation'] },
  { id: 'tv-30m',  label: '30-minute drama / prestige comedy',    seconds: 1800, category: 'tv-episode', pageCountTarget: 30 },
  { id: 'tv-44m',  label: '44-minute network drama',              seconds: 2640, category: 'tv-episode', pageCountTarget: 44, typicalGenres: ['drama', 'thriller', 'sci-fi'] },
  { id: 'tv-50m',  label: '50-minute streaming drama',            seconds: 3000, category: 'tv-episode', pageCountTarget: 50 },
  { id: 'tv-60m',  label: '60-minute cable drama / prestige',     seconds: 3600, category: 'tv-episode', pageCountTarget: 60 },
  { id: 'tv-75m',  label: '75-minute prestige / limited series ep.', seconds: 4500, category: 'tv-episode', pageCountTarget: 75 },
  { id: 'tv-90m',  label: '90-minute season finale / pilot',      seconds: 5400, category: 'tv-episode', pageCountTarget: 90 },

  // ── TV Movie (3 entries) ───────────────────────────────────────────────────
  { id: 'tv-movie-75m',  label: '75-minute TV movie',  seconds: 4500, category: 'tv-movie', pageCountTarget:  75 },
  { id: 'tv-movie-90m',  label: '90-minute TV movie',  seconds: 5400, category: 'tv-movie', pageCountTarget:  90 },
  { id: 'tv-movie-120m', label: '120-minute TV movie', seconds: 7200, category: 'tv-movie', pageCountTarget: 120 },

  // ── Feature Film (9 entries) ───────────────────────────────────────────────
  { id: 'feature-70m',  label: '70-minute micro-feature',    seconds:  4200, category: 'feature-film', pageCountTarget:  70, typicalGenres: ['horror', 'comedy', 'documentary'] },
  { id: 'feature-80m',  label: '80-minute tight feature',    seconds:  4800, category: 'feature-film', pageCountTarget:  80, typicalGenres: ['horror', 'comedy', 'thriller'] },
  { id: 'feature-90m',  label: '90-minute comedy / horror',  seconds:  5400, category: 'feature-film', pageCountTarget:  90, typicalGenres: ['comedy', 'horror', 'romance'] },
  { id: 'feature-100m', label: '100-minute drama',           seconds:  6000, category: 'feature-film', pageCountTarget: 100, typicalGenres: ['drama', 'thriller'] },
  { id: 'feature-110m', label: '110-minute thriller',        seconds:  6600, category: 'feature-film', pageCountTarget: 110, typicalGenres: ['thriller', 'action', 'sci-fi'] },
  { id: 'feature-120m', label: '120-minute drama / action',  seconds:  7200, category: 'feature-film', pageCountTarget: 120, typicalGenres: ['drama', 'action', 'adventure'] },
  { id: 'feature-130m', label: '130-minute action / sci-fi', seconds:  7800, category: 'feature-film', pageCountTarget: 130, typicalGenres: ['action', 'sci-fi', 'fantasy'] },
  { id: 'feature-150m', label: '150-minute prestige drama',  seconds:  9000, category: 'feature-film', pageCountTarget: 150, typicalGenres: ['drama', 'historical'] },
  { id: 'feature-180m', label: '180-minute epic / war film', seconds: 10800, category: 'feature-film', pageCountTarget: 180, typicalGenres: ['war', 'epic', 'historical'] },

  // ── Epic & Extended (4 entries) ────────────────────────────────────────────
  { id: 'epic-200m', label: '200-minute director\'s cut',              seconds: 12000, category: 'epic-extended', pageCountTarget: 200 },
  { id: 'epic-210m', label: '210-minute roadshow epic',                seconds: 12600, category: 'epic-extended', pageCountTarget: 210 },
  { id: 'epic-240m', label: '240-minute mega-epic',                    seconds: 14400, category: 'epic-extended', pageCountTarget: 240 },
  { id: 'epic-300m', label: '300-minute limited series pilot / epic',  seconds: 18000, category: 'epic-extended', pageCountTarget: 300 },
];
```

---

### DR-2 — Wizard Step 3A: Narrative Length

Insert a new step **between** the existing Step 3 (Slug) and Step 4 (Tone) in `cli/src/commands/start-wizard.ts`. Update `TOTAL_STEPS` from `11` to `12`.

**UI appearance — full wizard prompt:**

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
    60-second YouTube short           (1:00)
    3-minute web series ep.           (3:00)
    5-minute explainer / vlog         (5:00)
    10-minute YouTube episode         (10:00)
    20-minute web series ep.          (20:00)
  ── Short Film ──
    5-minute short film               (5:00)
    ...
  ── TV Episode ──
    22-minute sitcom / half-hour      (22:00)
    44-minute network drama           (44:00)
    ...
  ── Feature Film ──
    90-minute comedy / horror         (1:30:00)
    120-minute drama / action         (2:00:00)
    180-minute epic / war film        (3:00:00)
  ── Epic & Extended ──
    300-minute limited series pilot   (5:00:00)
  ────────────────────────────────────────────
    (skip / not set)
```

**Post-selection confirmation feedback (dim, advisory):**

```
  → Pages target: ~30 pages   Act 1: 0:30 · Act 2: 1:00 · Act 3: 0:30
```

**Genre coherence hint (dim, never blocks advancement):**

```
  ℹ  Note: "150-minute prestige drama" is most common for drama / historical projects.
```

**Step implementation in `start-wizard.ts`:**

```typescript
import {
  NARRATIVE_LENGTH_CATALOG,
  findNarrativeLength,
  formatRuntime,
  computeThreeActBudget,
  NarrativeCategory,
} from '../utils/narrative-length-catalog.js';
import { Separator, select } from '@inquirer/prompts';

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
  prefill?: string,   // re-entry: previously chosen narrativeFormatId
  genre?:   string,   // for genre-coherence hint
): Promise<{ narrativeFormatId: string | undefined; targetDurationSeconds: number | undefined }> {

  type ChoiceItem = { name: string; value: string; short: string };
  const choices: Array<InstanceType<typeof Separator> | ChoiceItem> = [];

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

  choices.push(new Separator(chalk.dim('─'.repeat(44))));
  choices.push({ name: '(skip / not set)', value: '(skip)', short: 'skip' });

  const chosen = await select({
    message:  'Narrative length / target runtime:',
    default:  prefill ?? '(skip)',
    choices,
    pageSize: 20,
  });

  if (chosen === '(skip)') {
    return { narrativeFormatId: undefined, targetDurationSeconds: undefined };
  }

  const entry = findNarrativeLength(chosen)!;

  // Genre coherence hint — advisory only; never blocks
  if (genre && entry.typicalGenres && !entry.typicalGenres.some(g => genre.toLowerCase().includes(g))) {
    console.log(chalk.dim(
      `  ℹ  Note: "${entry.label}" is most common for ${entry.typicalGenres.join(' / ')} projects.\n`
    ));
  }

  // Post-selection confirmation feedback
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

**`stepNarrativeLength` usage examples (in the step sequencer):**

```typescript
// Step 3A — immediately after the slug step, before the tone step:
const { narrativeFormatId, targetDurationSeconds } = await stepNarrativeLength(
  state.narrativeFormatId,  // prefill for edit/re-entry mode
  state.genre,              // for genre coherence hint
);
state.narrativeFormatId      = narrativeFormatId;
state.targetDurationSeconds  = targetDurationSeconds;
```

---

### DR-3 — `WizardState` and Utility Updates (`wizard-utils.ts`)

Add two new optional fields to `WizardState`:

```typescript
// cli/src/utils/wizard-utils.ts

export interface WizardState {
  title:                   string;
  genre:                   string;
  slug:                    string;
  narrativeFormatId?:      string;   // NEW — catalog entry id, e.g. "feature-90m"
  targetDurationSeconds?:  number;   // NEW — total runtime in whole seconds, e.g. 5400
  tone?:                   string;
  audience?:               string;
  budget?:                 BudgetTier;
  outcome?:                string;
  outputDir:               string;
  format?:                 DocumentFormat;
  detail:                  DetailLevel;
  styles:                  string[];
  provider?:               string;
  profile?:                string;
}
```

Update `buildEquivalentCommand()`:

```typescript
// In buildEquivalentCommand(state: WizardState): string
// Insert after the --slug line:

if (state.targetDurationSeconds !== undefined) {
  parts.push(`  --target-duration ${state.targetDurationSeconds}`);
}
if (state.narrativeFormatId !== undefined) {
  parts.push(`  --narrative-format "${state.narrativeFormatId}"`);
}
```

**Full equivalent command output example (90-minute horror feature):**

```
  Equivalent command:
  filmbuff start \
    --title "The Hollow Season" \
    --genre horror \
    --slug "the-hollow-season" \
    --target-duration 5400 \
    --narrative-format "feature-90m" \
    --tone "slow-burn, dread, isolation" \
    --audience "Horror fans, festival circuit" \
    --budget micro \
    --outcome "Sundance short-film competition" \
    --output-dir ./output/the-hollow-season \
    --format md \
    --detail standard \
    --provider anthropic \
    --profile default
```

Update `stateToStartOptions()`:

```typescript
export function stateToStartOptions(state: WizardState): StartOptions {
  return {
    // ... all existing fields unchanged ...
    targetDurationSeconds: state.targetDurationSeconds,   // NEW
    narrativeFormatId:     state.narrativeFormatId,       // NEW
  };
}
```

---

### DR-4 — `StartOptions` Interface Update (`start.ts`)

Add two optional fields:

```typescript
// cli/src/commands/start.ts

export interface StartOptions {
  title:        string;
  genre:        string;
  slug?:        string;
  // ── NEW ──────────────────────────────────────────────────────────────────
  /** Total target runtime in whole seconds. E.g. 5400 for a 90-minute film. */
  targetDurationSeconds?: number;
  /** Catalog entry id from NARRATIVE_LENGTH_CATALOG. E.g. "feature-90m". */
  narrativeFormatId?:     string;
  // ── Existing fields (unchanged) ─────────────────────────────────────────
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
}
```

Update `projectRepo.create()` call inside `startCommand()`:

```typescript
const project = projectRepo.create({
  id:                      projectId,
  slug,
  display_title:           options.title,
  genre:                   options.genre,
  tone:                    options.tone,
  target_audience:         options.audience,
  budget_tier:             options.budget,
  outcome:                 options.outcome,
  output_dir:              outputDir,
  format_override:         options.format,
  detail_level:            options.detail ?? 'standard',
  style_modules:           options.styles,
  active_provider_id:      options.provider,
  active_profile_name:     options.profile,
  // ── NEW ────────────────────────────────────────────────────────────────
  target_duration_seconds: options.targetDurationSeconds,
  narrative_format_id:     options.narrativeFormatId,
});
```

---

### DR-5 — CLI Flag Registration (`cli.ts`)

#### 5.1 — Two New Options on `filmbuff start`

Add after the existing `--outcome` option:

```typescript
// cli/src/cli.ts — start command

program
  .command('start')
  // ... all existing options ...
  .option(
    '--target-duration <seconds>',
    'Target narrative runtime in whole seconds (e.g. 5400 for 90 min). ' +
    'Constrains all downstream content generation to this total runtime.',
    (v: string) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n <= 0) {
        throw new Error('--target-duration must be a positive integer (seconds).');
      }
      return n;
    }
  )
  .option(
    '--narrative-format <id>',
    'Narrative length catalog id (e.g. "feature-90m"). ' +
    'Automatically sets --target-duration if --target-duration is absent. ' +
    'Run `filmbuff narrative-lengths` to see all valid ids.'
  )
```

#### 5.2 — `--narrative-format` → `targetDurationSeconds` Auto-Derivation

Insert this resolution block in the `start` action handler **before** calling `startCommand(options)`:

```typescript
// cli/src/cli.ts — start action handler

if (options.narrativeFormat && options.targetDuration === undefined) {
  const entry = findNarrativeLength(options.narrativeFormat);
  if (!entry) {
    console.error(chalk.red(
      `Error: Unknown --narrative-format "${options.narrativeFormat}". ` +
      `Run \`filmbuff narrative-lengths\` to list all valid ids.`
    ));
    process.exit(1);
  }
  options.targetDuration = entry.seconds;
}

// Duration coherence warning when both flags are supplied with mismatched values
if (options.narrativeFormat && options.targetDuration !== undefined) {
  const entry = findNarrativeLength(options.narrativeFormat);
  if (entry && entry.seconds !== options.targetDuration) {
    console.warn(chalk.yellow(
      `⚠  --target-duration ${options.targetDuration}s does not match ` +
      `--narrative-format "${options.narrativeFormat}" (${entry.seconds}s). ` +
      `Using --target-duration ${options.targetDuration}s as the authoritative value.`
    ));
  }
}
```

**CLI flag resolution examples:**

| Command flags | `targetDurationSeconds` | `narrativeFormatId` | Outcome |
|---|---|---|---|
| *(neither flag)* | `undefined` | `undefined` | No constraint — wizard or no runtime set |
| `--target-duration 5400` | `5400` | `undefined` | 90-minute budget, no catalog label |
| `--narrative-format "feature-90m"` | `5400` (derived) | `"feature-90m"` | Full constraint from catalog |
| `--target-duration 5400 --narrative-format "feature-90m"` | `5400` | `"feature-90m"` | Consistent — no warning |
| `--target-duration 6000 --narrative-format "feature-90m"` | `6000` (authoritative) | `"feature-90m"` | Yellow warning emitted; `6000s` used |

#### 5.3 — New `filmbuff narrative-lengths` Command

```typescript
// cli/src/cli.ts — new command

program
  .command('narrative-lengths')
  .description('List all valid narrative length ids and their runtimes.')
  .option('--json', 'Output as a JSON array instead of a formatted table.')
  .action((opts: { json?: boolean }) => {
    if (opts.json) {
      console.log(JSON.stringify(NARRATIVE_LENGTH_CATALOG, null, 2));
      return;
    }

    console.log(chalk.bold('\nNarrative Length Catalog\n'));
    let lastCat = '';
    for (const e of NARRATIVE_LENGTH_CATALOG) {
      if (e.category !== lastCat) {
        console.log(chalk.cyan(`\n  ${CATEGORY_LABELS[e.category]}`));
        lastCat = e.category;
      }
      console.log(
        `    ${e.id.padEnd(20)} ${e.label.padEnd(44)} ${formatRuntime(e.seconds).padStart(8)}`
      );
    }
    console.log('');
  });
```

**Human-readable table output (excerpt):**

```
Narrative Length Catalog

  Ads & Commercials
    ad-6s                6-second bumper ad                              0:06
    ad-15s               15-second spot                                  0:15
    ad-30s               30-second commercial                            0:30
    ad-60s               60-second commercial                            1:00
    ad-90s               90-second extended spot                         1:30
    ad-2m                2-minute brand film                             2:00

  Social & Web
    web-15s              15-second TikTok / Reel                         0:15
    web-30s              30-second social clip                           0:30
    web-60s              60-second YouTube short                         1:00
    web-3m               3-minute web series ep.                         3:00
    ...

  Feature Film
    feature-90m          90-minute comedy / horror                    1:30:00
    feature-120m         120-minute drama / action                    2:00:00
    feature-180m         180-minute epic / war film                   3:00:00

  Epic & Extended
    epic-300m            300-minute limited series pilot / epic       5:00:00
```

**JSON output (`filmbuff narrative-lengths --json` — truncated to 3 entries):**

```json
[
  {
    "id": "ad-6s",
    "label": "6-second bumper ad",
    "seconds": 6,
    "category": "ads-commercials",
    "pageCountTarget": 1
  },
  {
    "id": "feature-90m",
    "label": "90-minute comedy / horror",
    "seconds": 5400,
    "category": "feature-film",
    "pageCountTarget": 90,
    "typicalGenres": ["comedy", "horror", "romance"]
  },
  {
    "id": "epic-300m",
    "label": "300-minute limited series pilot / epic",
    "seconds": 18000,
    "category": "epic-extended",
    "pageCountTarget": 300
  }
]
```

---

### DR-6 — Database Migration

#### 6.1 — New migration: `cli/src/db/migrations/002_add_target_duration.sql`

```sql
-- Migration 002: Add narrative length fields to the projects table.
-- Designed to be re-runnable on an existing database (uses IF NOT EXISTS semantics via SQLite ALTER TABLE).
-- target_duration_seconds: total runtime in whole seconds (INTEGER, nullable, must be > 0 when set).
-- narrative_format_id:     catalog entry id string (TEXT, nullable, e.g. "feature-90m").

ALTER TABLE projects ADD COLUMN
  target_duration_seconds INTEGER
  CHECK (target_duration_seconds IS NULL OR target_duration_seconds > 0);

ALTER TABLE projects ADD COLUMN
  narrative_format_id TEXT;
```

**Migration idempotency note:** SQLite `ALTER TABLE ADD COLUMN` is not idempotent by default. The migration runner must wrap each `ALTER TABLE` in an existence check (e.g., `PRAGMA table_info(projects)`) or catch `SQLITE_ERROR: duplicate column name` and treat it as a no-op.

#### 6.2 — Type Updates: `cli/src/db/types.ts`

```typescript
// cli/src/db/types.ts

export interface Project {
  // ... all existing fields unchanged ...
  target_duration_seconds: number | null;  // NEW — null when not set
  narrative_format_id:     string | null;  // NEW — null when not set
}

export interface CreateProjectInput {
  // ... all existing fields unchanged ...
  target_duration_seconds?: number;  // NEW — omit or undefined → stored as NULL
  narrative_format_id?:     string;  // NEW — omit or undefined → stored as NULL
}
```

#### 6.3 — Repository Update: `cli/src/db/project-repository.ts`

```typescript
// cli/src/db/project-repository.ts

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

Update the `create()` method to bind the two new nullable parameters:

```typescript
// cli/src/db/project-repository.ts — create() method

this.db.prepare(INSERT_PROJECT).run({
  // ... all existing bindings unchanged ...
  target_duration_seconds: input.target_duration_seconds ?? null,
  narrative_format_id:     input.narrative_format_id     ?? null,
  now,
});
```

**Database row examples:**

| `target_duration_seconds` | `narrative_format_id` | Scenario |
|---|---|---|
| `NULL` | `NULL` | User skipped or did not supply a runtime |
| `5400` | `"feature-90m"` | Selected from wizard catalog |
| `6600` | `NULL` | `--target-duration 6600` only; no format id |
| `6600` | `"feature-110m"` | Both flags supplied; catalog value matches |
| `7200` | `"feature-90m"` | Both flags supplied; mismatch — `7200` authoritative (warning emitted) |

---

### DR-7 — Downstream Duration Propagation

#### 7.1 — `GeneratorConfig` Extension (`generator/types.ts`)

```typescript
// cli/src/commands/generate-shot-list/generator/types.ts

export interface GeneratorConfig {
  maxCharacters:         number;
  maxShotLength:         number;
  warningThreshold:      number;
  includeContext:        boolean;
  includeMetadata:       boolean;
  cinematicStyle?:       string;
  muteSfx?:              boolean;
  // ── NEW ──────────────────────────────────────────────────────────────────
  /**
   * Total narrative runtime budget in whole seconds.
   * When set, the generator validates that the sum of all shot durations
   * does not exceed this value. Emits a warning and appends a
   * 'duration-budget-exceeded' entry to shotList.warnings if exceeded.
   * Also warns if the total falls below 80% of budget (likely missing content).
   */
  totalBudgetSeconds?:    number;
  /**
   * Human-readable narrative format label, injected verbatim into the AI
   * system prompt. E.g. "90-minute comedy / horror".
   * When undefined, the AI prompt omits the runtime constraint section.
   */
  narrativeFormatLabel?:  string;
}
```

#### 7.2 — Budget Resolution in `generate-shot-list.ts`

```typescript
// cli/src/commands/generate-shot-list.ts — inside generateShotListCommand()

// Resolve total budget:
//   1. Explicit --target-duration CLI flag (highest precedence)
//   2. target_duration_seconds from the project database row
//   3. undefined — no budget constraint
const totalBudgetSeconds: number | undefined =
  options.targetDuration ??
  (loadedProject?.target_duration_seconds ?? undefined);

// Resolve format label for AI prompt injection:
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
  muteSfx:             options.muteSfx ?? false,
  totalBudgetSeconds,       // NEW
  narrativeFormatLabel,     // NEW
});
```

#### 7.3 — Generator Budget Enforcement (`generator/index.ts`)

Add the following block **after** all shots are computed and `shotList.totalDuration` is known:

```typescript
// cli/src/commands/generate-shot-list/generator/index.ts
// After: shotList.totalDuration is finalized.

if (config.totalBudgetSeconds !== undefined) {
  const totalSeconds = shotList.totalDuration;
  const budget       = config.totalBudgetSeconds;

  if (totalSeconds > budget) {
    // Over-budget warning
    const overage = totalSeconds - budget;
    const msg =
      `Total shot duration ${formatRuntime(totalSeconds)} exceeds ` +
      `target runtime ${formatRuntime(budget)} ` +
      `by ${formatRuntime(overage)}. Consider reducing scene count or shot lengths.`;

    console.warn(chalk.yellow(`⚠  ${msg}`));
    shotList.warnings.push({ type: 'duration-budget-exceeded', message: `${msg} (${overage}s over)` });

  } else if (totalSeconds < budget * 0.80) {
    // Under-budget warning (> 20% under — likely missing content)
    const shortfall = budget - totalSeconds;
    const msg =
      `Total shot duration ${formatRuntime(totalSeconds)} is significantly under ` +
      `target runtime ${formatRuntime(budget)} ` +
      `(${formatRuntime(shortfall)} short). Consider adding scenes or extending existing shots.`;

    console.warn(chalk.yellow(`⚠  ${msg}`));
    shotList.warnings.push({ type: 'duration-budget-under', message: `${msg} (${shortfall}s short)` });
  }
}
```

**Over-budget warning example (44-minute network drama, shots generated at 54 minutes):**

```
⚠  Total shot duration 54:00 exceeds target runtime 44:00 by 10:00.
   Consider reducing scene count or shot lengths.
```

**Under-budget warning example (90-minute feature, shots generated at only 68 minutes):**

```
⚠  Total shot duration 1:08:00 is significantly under target runtime 1:30:00
   (22:00 short). Consider adding scenes or extending existing shots.
```

#### 7.4 — AI System Prompt Injection

Add this block to every function that constructs an AI content-generation system prompt (logline, beat sheet, screenplay, shot-list prep, etc.):

```typescript
// In any AI system-prompt builder — after the base system prompt is assembled:

if (project.target_duration_seconds !== undefined && project.target_duration_seconds !== null) {
  const entry      = project.narrative_format_id
                       ? findNarrativeLength(project.narrative_format_id)
                       : undefined;
  const label      = entry?.label ?? formatRuntime(project.target_duration_seconds);
  const pageTarget = entry?.pageCountTarget ?? Math.round(project.target_duration_seconds / 60);
  const acts       = computeThreeActBudget(project.target_duration_seconds);

  systemPrompt +=
    `\n\n## Target Runtime Constraint\n` +
    `This project must run exactly **${label}** ` +
    `(${formatRuntime(project.target_duration_seconds)} / ~${pageTarget} pages).\n` +
    `This is a hard constraint. All content — logline, beat sheet, screenplay, ` +
    `and shot list — must be scoped to fit within this runtime.\n\n` +
    `Three-act structure budget (Syd Field paradigm):\n` +
    `- Act 1: ~${formatRuntime(acts.actOne)} (~${Math.round(acts.actOne / 60)} pages)\n` +
    `- Act 2: ~${formatRuntime(acts.actTwo)} (~${Math.round(acts.actTwo / 60)} pages)\n` +
    `- Act 3: ~${formatRuntime(acts.actThree)} (~${Math.round(acts.actThree / 60)} pages)\n`;
}
```

**Injected prompt section example (feature-120m — 120-minute drama):**

```markdown
## Target Runtime Constraint
This project must run exactly **120-minute drama / action** (2:00:00 / ~120 pages).
This is a hard constraint. All content — logline, beat sheet, screenplay, and shot list —
must be scoped to fit within this runtime.

Three-act structure budget (Syd Field paradigm):
- Act 1: ~30:00 (~30 pages)
- Act 2: ~1:00:00 (~60 pages)
- Act 3: ~30:00 (~30 pages)
```

**Injected prompt section example (tv-22m — 22-minute sitcom):**

```markdown
## Target Runtime Constraint
This project must run exactly **22-minute sitcom / half-hour** (22:00 / ~22 pages).
This is a hard constraint. All content — logline, beat sheet, screenplay, and shot list —
must be scoped to fit within this runtime.

Three-act structure budget (Syd Field paradigm):
- Act 1: ~5:30 (~6 pages)
- Act 2: ~11:00 (~11 pages)
- Act 3: ~5:30 (~6 pages)
```

**Injected prompt section example (ad-30s — 30-second commercial):**

```markdown
## Target Runtime Constraint
This project must run exactly **30-second commercial** (0:30 / ~1 pages).
This is a hard constraint. All content — logline, beat sheet, screenplay, and shot list —
must be scoped to fit within this runtime.

Three-act structure budget (Syd Field paradigm):
- Act 1: ~0:08 (~0 pages)
- Act 2: ~0:15 (~0 pages)
- Act 3: ~0:08 (~0 pages)
```

---

### DR-8 — Wizard Summary Panel Update (`renderSummaryTable`)

**Updated confirmation panel (new "Runtime target" row):**

```
┌──────────────────────────────────────────────────────────────┐
│  📋  Review your project settings                            │
├──────────────────────────────────────────────────────────────┤
│  Title:          The Hollow Season                           │
│  Genre:          horror                                      │
│  Slug:           the-hollow-season                           │
│  Runtime target: 90-minute comedy / horror  (1:30:00 / ~90p) │  ← NEW
│  Tone:           slow-burn, dread, isolation                 │
│  Audience:       Horror fans, festival circuit               │
│  Budget:         micro                                       │
│  Outcome:        Sundance short-film competition             │
│  Output dir:     ./output/the-hollow-season                  │
│  Format:         md                                          │
│  Detail:         standard                                    │
│  Style mods:     (none)                                      │
│  AI provider:    anthropic  (profile: default)               │
└──────────────────────────────────────────────────────────────┘
```

**Panel when runtime is set via `--target-duration` only (no format id):**

```
│  Runtime target: 1:50:00                                     │
```

**Panel when runtime is not set:**

```
│  Runtime target: (not set)                                   │
```

**`renderSummaryTable` implementation:**

```typescript
// cli/src/commands/start-wizard.ts — renderSummaryTable(state: WizardState)

if (state.narrativeFormatId && state.targetDurationSeconds !== undefined) {
  const entry   = findNarrativeLength(state.narrativeFormatId);
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

---

### DR-9 — Validation Rules

| Field | Required | Rule |
|---|---|---|
| `targetDurationSeconds` | No | When provided: must be a positive integer (`> 0`). When derived from `narrativeFormatId`, the catalog value is authoritative and known-correct. |
| `narrativeFormatId` | No | When provided: must exactly match an `id` in `NARRATIVE_LENGTH_CATALOG`. Unknown ids cause `process.exit(1)` with a clear error message referencing `filmbuff narrative-lengths`. |
| Duration coherence | Advisory | When both `--target-duration` and `--narrative-format` are provided and their values disagree, emit a yellow warning. Use `--target-duration` as the authoritative value. Never block the command. |
| `pageCountTarget` | Derived | Never supplied by the user. Always derived at display time as `findNarrativeLength(narrativeFormatId)?.pageCountTarget ?? Math.round(targetDurationSeconds / 60)`. |

---

## File Impact Summary

| Layer | File | Nature |
|---|---|---|
| Catalog | `cli/src/utils/narrative-length-catalog.ts` | **New file** |
| Wizard | `cli/src/commands/start-wizard.ts` | Insert Step 3A; update `TOTAL_STEPS`, `renderSummaryTable` |
| Wizard utilities | `cli/src/utils/wizard-utils.ts` | Extend `WizardState`; update `buildEquivalentCommand`, `stateToStartOptions` |
| CLI options | `cli/src/cli.ts` | Add `--target-duration`, `--narrative-format` to `start`; add `narrative-lengths` command |
| Start command | `cli/src/commands/start.ts` | Extend `StartOptions`; forward new fields to `projectRepo.create()` |
| DB migration | `cli/src/db/migrations/002_add_target_duration.sql` | **New file** |
| DB types | `cli/src/db/types.ts` | Extend `Project`, `CreateProjectInput` |
| DB repository | `cli/src/db/project-repository.ts` | Update `INSERT_PROJECT`; bind new params in `create()` |
| Generator types | `cli/src/commands/generate-shot-list/generator/types.ts` | Extend `GeneratorConfig` |
| Shot-list command | `cli/src/commands/generate-shot-list.ts` | Resolve and pass `totalBudgetSeconds`, `narrativeFormatLabel` |
| Generator | `cli/src/commands/generate-shot-list/generator/index.ts` | Budget enforcement; over/under warnings |
| AI prompt builders | All content-gen commands | Inject runtime constraint section into system prompt |

---

## Example CLI Usage

```bash
# ── Wizard mode (interactive) ────────────────────────────────────────────────
# User selects "90-minute comedy / horror" from the Narrative Length step.
filmbuff start


# ── Non-wizard: supply duration in seconds directly ──────────────────────────
# 110-minute psychological thriller (6,600 seconds)
filmbuff start \
  --title "The Midnight Garden" \
  --genre thriller \
  --target-duration 6600 \
  --tone "dark, psychological, claustrophobic"


# ── Non-wizard: supply narrative format id (duration derived automatically) ──
# 22-minute streaming sitcom
filmbuff start \
  --title "Corner Office" \
  --genre comedy \
  --narrative-format "tv-22m" \
  --audience "Adults 25–45, streaming platforms"

# 30-second broadcast commercial
filmbuff start \
  --title "Apex Energy Drink Launch" \
  --genre commercial \
  --narrative-format "ad-30s" \
  --budget micro \
  --outcome "Broadcast on national TV during Q4"

# 44-minute network drama episode
filmbuff start \
  --title "Static" \
  --genre "crime drama" \
  --narrative-format "tv-44m" \
  --audience "Adults 35–55, network broadcast" \
  --tone "procedural, gritty, morally complex"

# 3-hour historical epic
filmbuff start \
  --title "The Last Crusade" \
  --genre "historical epic" \
  --narrative-format "feature-180m" \
  --budget studio \
  --tone "sweeping, operatic, war-torn"

# 200-minute director's cut
filmbuff start \
  --title "Collapse" \
  --genre "sci-fi drama" \
  --narrative-format "epic-200m" \
  --budget indie \
  --tone "cerebral, slow-burn, dystopian"


# ── Both flags with matching values (no warning) ─────────────────────────────
filmbuff start \
  --title "Chasing Light" \
  --genre drama \
  --target-duration 7200 \
  --narrative-format "feature-120m"


# ── Both flags with mismatched values (yellow warning; --target-duration wins) ─
filmbuff start \
  --title "The Cut" \
  --genre thriller \
  --target-duration 7500 \
  --narrative-format "feature-120m"
# ⚠  --target-duration 7500s does not match --narrative-format "feature-120m" (7200s).
#    Using --target-duration 7500s as the authoritative value.


# ── Generate shot list: reads target_duration_seconds from project DB ─────────
filmbuff generate-shot-list \
  --input output/the-midnight-garden/screenplay.fountain


# ── Generate shot list: explicit --target-duration overrides project DB value ──
filmbuff generate-shot-list \
  --input output/the-midnight-garden/screenplay.fountain \
  --target-duration 6000


# ── Discover all valid narrative format ids ───────────────────────────────────
filmbuff narrative-lengths

# As JSON (for CI scripts, test fixtures, etc.)
filmbuff narrative-lengths --json

# Pipe into jq to filter by category
filmbuff narrative-lengths --json | jq '[.[] | select(.category == "feature-film")]'

# Pipe into jq to get seconds for a specific id
filmbuff narrative-lengths --json | jq '.[] | select(.id == "tv-44m") | .seconds'
# → 2640
```

---

## Acceptance Criteria

- [ ] `filmbuff start` wizard presents the Narrative Length dropdown as **Step 4 of 12** (immediately after Slug), with all 37 catalog entries grouped by category using `Separator` headers in the correct display order: Ads & Commercials → Social & Web → Short Film → TV Episode → TV Movie → Feature Film → Epic & Extended.
- [ ] Selecting `"90-minute comedy / horror"` from the wizard sets `state.narrativeFormatId = "feature-90m"` and `state.targetDurationSeconds = 5400`.
- [ ] Selecting `"(skip / not set)"` leaves both `state.narrativeFormatId` and `state.targetDurationSeconds` as `undefined`. No warning or error is emitted.
- [ ] Re-entering the wizard in edit mode pre-selects the previously chosen `narrativeFormatId` as the default.
- [ ] After selection, the act-structure breakdown and page target are printed as dim feedback: `→ Pages target: ~90 pages   Act 1: 22:30 · Act 2: 45:00 · Act 3: 22:30`.
- [ ] Genre coherence hint is printed (dim, advisory) when the chosen entry's `typicalGenres` do not include the project genre. The hint **never blocks** step advancement.
- [ ] The confirmation summary panel displays `Runtime target: 90-minute comedy / horror  (1:30:00 / ~90p)` when `narrativeFormatId = "feature-90m"`.
- [ ] The confirmation summary panel displays `Runtime target: (not set)` (dim) when no runtime is selected.
- [ ] `buildEquivalentCommand()` includes `--target-duration 5400 --narrative-format "feature-90m"` in the displayed command string when both fields are set.
- [ ] `filmbuff start --target-duration 5400 --genre horror --title "My Film"` bypasses the wizard, creates the project, and stores `target_duration_seconds = 5400`, `narrative_format_id = NULL` in the database.
- [ ] `filmbuff start --narrative-format "feature-90m" --genre horror --title "My Film"` derives `targetDurationSeconds = 5400` automatically and stores both columns.
- [ ] Supplying an unknown `--narrative-format "xyz-unknown"` exits with code `1` and prints: `Error: Unknown --narrative-format "xyz-unknown". Run \`filmbuff narrative-lengths\` to list all valid ids.`
- [ ] Supplying `--target-duration 0` or `--target-duration -1` throws a commander validation error before the action handler runs.
- [ ] Supplying mismatched `--target-duration` and `--narrative-format` emits a yellow warning and uses `--target-duration` as authoritative. Exit code is `0` (not an error).
- [ ] `filmbuff narrative-lengths` prints a formatted table of all 37 entries, grouped by category, with id, label, and formatted runtime columns. Exit code `0`.
- [ ] `filmbuff narrative-lengths --json` outputs a valid, parseable JSON array of all 37 entries. Exit code `0`.
- [ ] Database migration `002_add_target_duration.sql` adds both columns to an existing database that has neither column. Running the migration twice (simulating a re-run) does not cause an unhandled error.
- [ ] `project.target_duration_seconds` is stored as a SQLite `INTEGER` (not a float or text). `Number.isInteger(row.target_duration_seconds)` is `true` for every non-null value.
- [ ] `filmbuff generate-shot-list` reads `target_duration_seconds` from the project database row and passes it as `totalBudgetSeconds` to the generator.
- [ ] If total shot duration exceeds `totalBudgetSeconds`, a `duration-budget-exceeded` warning is appended to `shotList.warnings` and a yellow message is printed to stdout.
- [ ] If total shot duration is below `80%` of `totalBudgetSeconds`, a `duration-budget-under` warning is appended to `shotList.warnings` and a yellow message is printed to stdout.
- [ ] If total shot duration is within `[totalBudgetSeconds * 0.80, totalBudgetSeconds]`, no budget warning is emitted.
- [ ] Passing `--target-duration` directly to `filmbuff generate-shot-list` overrides the project database value.
- [ ] Every AI content-generation call (logline, beat sheet, screenplay, shot-list prep) includes the `## Target Runtime Constraint` section in the system prompt when `target_duration_seconds` is non-null. The section includes the label, formatted runtime, page count target, and three-act breakdown.
- [ ] When `target_duration_seconds` is `NULL` in the database, no `## Target Runtime Constraint` section is injected into any AI prompt.
- [ ] `TOTAL_STEPS` in `start-wizard.ts` is updated from `11` to `12`, and all existing step header renderings display the correct total.
- [ ] All existing wizard tests pass without modification (no regression in any existing step).
- [ ] All existing `ProjectRepository` tests pass without modification (no regression from schema changes).
- [ ] New unit tests cover:
  - `findNarrativeLength` — found and not-found cases
  - `formatRuntime` — all edge cases: `< 60s`, `60–3599s`, `≥ 3600s`
  - `computeThreeActBudget` — sum invariant: `actOne + actTwo + actThree === totalSeconds`
  - `stepNarrativeLength` (wizard step) — happy path selection, skip path, genre coherence hint trigger, re-entry pre-fill
  - CLI flag derivation: `--narrative-format "feature-90m"` → `targetDurationSeconds = 5400`
  - CLI flag mismatch warning: `--target-duration 6000 --narrative-format "feature-90m"` → warning emitted, `6000` used
  - DB migration idempotency: running migration twice does not error
  - Generator over-budget: `totalSeconds > budget` → warning in `shotList.warnings`
  - Generator under-budget: `totalSeconds < budget * 0.80` → warning in `shotList.warnings`
  - Generator on-budget: no warning emitted

---

## Out of Scope

- Validation that the supplied `narrativeFormatId` is genre-appropriate (this is advisory hint only; no enforcement).
- Modification of existing `08-shot-list.jsonl` format.
- Per-shot duration overrides in the generator (covered separately).
- Custom/arbitrary runtime values not in the catalog — `--target-duration <seconds>` handles this already without a catalog entry.
- Frontend / web-UI display of the runtime target (separate ticket).
- API endpoint changes to surface `target_duration_seconds` (separate ticket).

---

## Dependencies / Related

| Ticket / Artifact | Relationship |
|---|---|
| `ai-prompts/film-length.md` | Full implementation specification (primary source) |
| `FB-0042` (Per-Shot Video Generation) | Downstream consumer of `targetDurationSeconds` — must not be broken by schema changes |
| `FB-DUR-1` (Float Duration Fix) | Parallel fix; `Math.round()` contract must be respected by the new budget enforcement logic |
| `cli/src/db/migrations/001_*.sql` | Predecessor migration — `002` must run after `001` |
| `@inquirer/prompts` | Required for `select` and `Separator` in the wizard step |
