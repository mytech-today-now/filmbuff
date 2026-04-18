# Refactor: `filmbuff generate-shot-list` — Script-Length-Aware Shot Duration Normalization

## Goal

Refactor the `filmbuff generate-shot-list` command so that the **aggregated total duration of all generated shots**, measured in minutes, is as close as possible to the **screenplay's page count**, measured in pages — leveraging the industry-standard rule that **1 screenplay page ≈ 1 minute of screen time**.

In practical terms: if the input screenplay is 95 pages long, the sum of all individual shot durations across the entire generated shot list must target **95 minutes (5,700 seconds)**, not whatever the raw, unconstrained heuristics happen to produce.

---

## Background and Motivation

### The Industry Standard

The `1 page = 1 minute` rule is a well-established industry convention, already documented in the project's own style guide:

```markdown
<!-- filmbuff/writing-standards/screenplay/rules/universal-formatting.md -->

## Page-to-Screen-Time Ratio

**Standard**: 1 page = 1 minute of screen time

### Typical Lengths

- **Feature Film**: 90-120 pages
- **TV Drama (1 hour)**: 50-60 pages
- **TV Comedy (30 min)**: 22-25 pages
- **Short Film**: 5-30 pages
```

### The Current Problem

The current shot-list generator derives each shot's duration independently through a 4-priority chain
(`duration-derivation.ts`):

```
P1 — Shooting-script M:SS annotation   (highest fidelity; explicit)
P2 — Beat-sheet timing cue             (scene-level; rounded to nearest second)
P3 — SceneSegmenter element estimate   (action lines × 3 s + dialogue words × 0.4 s/word)
P4 — Hard fallback: 5 seconds          (when no other signal exists)
```

These heuristics operate **locally**, one shot at a time, with no awareness of the screenplay's total page
count. The result is that the accumulated `derivedTotalDuration` across all shots frequently diverges
significantly — often by 30–50% — from the target runtime implied by the script's page count.

The `totalBudgetSeconds` field already exists in `GeneratorConfig` and the warning mechanism is partially
wired, but the generator does **not yet scale or normalize shot durations to meet the budget**. It only
emits a post-hoc warning after the fact.

---

## Required Changes

### 1. Compute the Script's Page Count

**File:** `cli/src/commands/generate-shot-list.ts`

After parsing the screenplay, compute the page count from the parsed `Screenplay` object. Use the
following priority order:

1. **`screenplay.metadata.pdfPages`** — exact page count from the PDF parser (most accurate).
2. **Line-count approximation** — divide `screenplay.metadata.totalLines` by `55` (standard page height
   for a US Letter screenplay at 12pt Courier).
3. **Scene count proxy** — if neither is available, use `screenplay.scenes.length` and assume an average
   of 1.5 pages per scene.

```typescript
// cli/src/commands/generate-shot-list.ts

/**
 * Derive the screenplay page count using the best available signal.
 * Priority: explicit PDF page count → line-count estimate → scene-count proxy.
 *
 * Returns the page count as a positive number, or `undefined` if no signal exists.
 */
function deriveScriptPageCount(screenplay: Screenplay): number | undefined {
  // P1 — PDF parser sets this directly
  if (typeof screenplay.metadata.pdfPages === 'number' && screenplay.metadata.pdfPages > 0) {
    return screenplay.metadata.pdfPages;
  }

  // P2 — Line count approximation (55 lines per page is the US Letter screenplay standard)
  const LINES_PER_PAGE = 55;
  if (typeof screenplay.metadata.totalLines === 'number' && screenplay.metadata.totalLines > 0) {
    return Math.max(1, Math.round(screenplay.metadata.totalLines / LINES_PER_PAGE));
  }

  // P3 — Scene count proxy (average 1.5 pages per scene)
  const PAGES_PER_SCENE_ESTIMATE = 1.5;
  if (screenplay.scenes.length > 0) {
    return Math.max(1, Math.round(screenplay.scenes.length * PAGES_PER_SCENE_ESTIMATE));
  }

  return undefined;
}
```

Convert the page count to a `targetDurationSeconds` budget:

```typescript
// cli/src/commands/generate-shot-list.ts

const SECONDS_PER_PAGE = 60; // industry standard: 1 page = 1 minute

const scriptPageCount = deriveScriptPageCount(screenplay);

// CLI --target-duration flag takes highest precedence.
// Next: project DB target_duration_seconds.
// Next: derived from screenplay page count.
// Last: undefined (no budget enforcement).
const totalBudgetSeconds: number | undefined =
  options.targetDuration ??
  (loadedProject?.target_duration_seconds ?? undefined) ??
  (scriptPageCount !== undefined ? scriptPageCount * SECONDS_PER_PAGE : undefined);

if (scriptPageCount !== undefined) {
  console.log(
    chalk.gray(
      `📄 Script length: ~${scriptPageCount} page(s) → ` +
      `target runtime: ${formatRuntime(scriptPageCount * SECONDS_PER_PAGE)}`
    )
  );
}
```

---

### 2. Propagate `totalBudgetSeconds` into the Generator

**File:** `cli/src/commands/generate-shot-list.ts`

Pass the resolved budget into `generator.generate()` — this field already exists in `GeneratorConfig`:

```typescript
const shotList = await generator.generate(screenplay.scenes, {
  maxCharacters:      maxCharacters,
  maxShotLength:      maxShotLength,
  warningThreshold:   90,
  includeContext:     true,
  includeMetadata:    true,
  muteSfx:            options.muteSfx || false,
  totalBudgetSeconds,           // resolved above from page count / DB / CLI flag
  narrativeFormatLabel,
});
```

---

### 3. Apply a Proportional Normalization Pass in the Generator

**File:** `cli/src/commands/generate-shot-list/generator/index.ts`

After all shots are finalized and `derivedTotalDuration` is accumulated, compute a **scale factor** and
apply it proportionally to every shot's duration so the sum equals `totalBudgetSeconds`. Shots whose
duration was sourced from P1 (explicit shooting-script annotations) **must not be scaled** — their
timing is authoritative and must be preserved.

```typescript
// cli/src/commands/generate-shot-list/generator/index.ts
// Normalization pass — runs AFTER deriveDuration() has been called for every shot.

import { MIN_DURATION_S, MAX_DURATION_S } from '../../lib/duration-derivation';

const BUDGET_TOLERANCE = 0.05; // 5% deviation is acceptable without normalization

if (config.totalBudgetSeconds !== undefined && derivedTotalDuration > 0) {
  const budget = config.totalBudgetSeconds;
  const deviation = Math.abs(derivedTotalDuration - budget) / budget;

  if (deviation > BUDGET_TOLERANCE) {
    // Separate shots that can be scaled from those that must not be touched.
    // Shots sourced from the shooting script (P1) carry explicit M:SS annotations —
    // their durations are authoritative and must not be modified.
    const fixedDuration = shotList.shots
      .filter(s => s.durationNotes?.startsWith('Derived from shot duration'))
      .reduce((sum, s) => sum + s.duration, 0);

    const scalableShots = shotList.shots.filter(
      s => !s.durationNotes?.startsWith('Derived from shot duration')
    );
    const scalableDuration = derivedTotalDuration - fixedDuration;
    const scalableTarget   = budget - fixedDuration;

    if (scalableShots.length > 0 && scalableDuration > 0 && scalableTarget > 0) {
      const scaleFactor = scalableTarget / scalableDuration;

      for (const shot of scalableShots) {
        const rawScaled = shot.duration * scaleFactor;
        // Clamp to [MIN_DURATION_S, MAX_DURATION_S] to prevent absurd values.
        shot.duration = Math.round(
          Math.max(MIN_DURATION_S, Math.min(MAX_DURATION_S, rawScaled))
        );
      }

      // Recompute the total after scaling for accurate reporting.
      derivedTotalDuration = shotList.shots.reduce((sum, s) => sum + s.duration, 0);

      console.log(
        chalk.gray(
          `⏱  Shot durations normalized: raw total was ` +
          `${formatRuntime(Math.round(scalableDuration + fixedDuration))} → ` +
          `adjusted to ${formatRuntime(derivedTotalDuration)} ` +
          `(scale factor: ${scaleFactor.toFixed(3)})`
        )
      );
    }
  }
}
```

---

### 4. Update Budget Warnings to Reference the Derived Page Count

**File:** `cli/src/commands/generate-shot-list/generator/index.ts`

The existing over/under-budget warning block should be updated to include the page count in its message
so the user can diagnose discrepancies:

```typescript
if (config.totalBudgetSeconds !== undefined) {
  const totalSeconds = shotList.shots.reduce((sum, s) => sum + s.duration, 0);
  const targetPages  = Math.round(config.totalBudgetSeconds / 60);
  const actualPages  = (totalSeconds / 60).toFixed(1);

  if (totalSeconds > config.totalBudgetSeconds) {
    const overage = totalSeconds - config.totalBudgetSeconds;
    console.warn(chalk.yellow(
      `⚠  Shot list total ${formatRuntime(totalSeconds)} (~${actualPages} min) exceeds ` +
      `target runtime ${formatRuntime(config.totalBudgetSeconds)} (~${targetPages} pages) ` +
      `by ${formatRuntime(overage)}. ` +
      `Some shots are clamped at MAX_DURATION_S and could not be scaled further.`
    ));
    shotList.warnings.push({
      type:    'duration-budget-exceeded',
      message: `Total shot duration (${totalSeconds}s / ~${actualPages} min) exceeds ` +
               `target runtime (${config.totalBudgetSeconds}s / ~${targetPages} pages) by ${overage}s. ` +
               `Shots clamped at MAX_DURATION_S prevented full normalization.`,
    });
  } else if (totalSeconds < config.totalBudgetSeconds * 0.80) {
    const shortage = config.totalBudgetSeconds - totalSeconds;
    console.warn(chalk.yellow(
      `⚠  Shot list total ${formatRuntime(totalSeconds)} (~${actualPages} min) is ` +
      `significantly under target runtime ${formatRuntime(config.totalBudgetSeconds)} ` +
      `(~${targetPages} pages) by ${formatRuntime(shortage)}. ` +
      `The screenplay may have fewer scenes than expected for this runtime.`
    ));
  }
}
```

---

### 5. Expose `--script-pages` CLI Override Flag

**File:** `cli/src/commands/generate-shot-list.ts` (flag registration section)

Allow the user to manually supply the screenplay's page count when automatic detection fails or gives an
inaccurate result (e.g., when parsing a Markdown or plain-text screenplay where `totalLines` is
unreliable):

```typescript
// In the generate-shot-list command option definitions:

.option(
  '--script-pages <n>',
  'Manually specify screenplay page count for shot duration budget calculation. ' +
  'Overrides automatic page count detection. ' +
  'Industry standard: 1 page = 1 minute of screen time. ' +
  'Example: --script-pages 95 targets a total shot duration of 95 minutes (5,700 s).',
  (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n <= 0) throw new Error('--script-pages must be a positive integer.');
    return n;
  }
)
```

Apply it with highest precedence in the page count resolution:

```typescript
const scriptPageCount: number | undefined =
  options.scriptPages ??        // CLI override: highest priority
  deriveScriptPageCount(screenplay);  // automatic detection
```

---

## Acceptance Criteria

- [ ] When a 95-page screenplay is processed, `sum(shot.duration)` after normalization is within ±5%
      of `95 × 60 = 5,700` seconds (i.e., between 5,415 s and 5,985 s).
- [ ] Shots whose `durationNotes` begins with `"Derived from shot duration"` (P1 shooting-script
      sources) are **never scaled** — their M:SS annotations are authoritative.
- [ ] The scale factor and adjusted totals are printed to the console in gray (`chalk.gray`).
- [ ] `--script-pages <n>` CLI flag overrides automatic page count detection.
- [ ] `--target-duration <seconds>` still takes highest precedence over page-count derivation.
- [ ] A `duration-budget-exceeded` warning is added to `shotList.warnings` when clamped shots prevent
      full normalization and the total remains over budget.
- [ ] An under-budget warning is printed when the normalized total is below 80% of the target
      (indicating the screenplay may have fewer scenes than expected for its runtime).
- [ ] All existing tests for `deriveDuration`, `estimateFromActionDensity`, and `SceneSegmenter` pass
      without modification (normalization is a post-generation pass that does not touch those functions).
- [ ] A new unit test verifies the scale-factor computation for a known fixture screenplay:
      given `derivedTotalDuration = 8,000 s` and `budget = 5,700 s`, the scale factor is
      `5,700 / 8,000 = 0.7125` and all scalable shots are multiplied accordingly before clamping.

---

## Reference: Key Files

| File | Role |
|---|---|
| `cli/src/commands/generate-shot-list.ts` | Add `deriveScriptPageCount()`, resolve `totalBudgetSeconds` from page count, add `--script-pages` flag |
| `cli/src/commands/generate-shot-list/generator/index.ts` | Add proportional normalization pass after all shots are derived; update budget warning messages |
| `cli/src/lib/duration-derivation.ts` | No changes — normalization is a post-generation pass only |
| `cli/src/commands/generate-shot-list/generator/scene-segmenter.ts` | No changes |
| `cli/src/commands/generate-shot-list/generator/types.ts` | `GeneratorConfig.totalBudgetSeconds` already exists; no changes required |
| `filmbuff/writing-standards/screenplay/rules/universal-formatting.md` | Source of the `1 page = 1 minute` standard; no changes |
