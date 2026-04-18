# JIRA Ticket: FB-SLG-1 — Script-Length-Aware Shot Duration Normalization for `filmbuff generate-shot-list`

---

## Summary

Refactor `filmbuff generate-shot-list` so that the **aggregated total duration of all generated shots**, measured in seconds, targets the **screenplay's page count converted to minutes** — enforcing the industry-standard `1 screenplay page = 1 minute of screen time` rule end-to-end. The generator currently derives each shot's duration independently with no awareness of total script length; the accumulated total can diverge by 30–50% from the target runtime implied by the script's page count. This ticket introduces a `deriveScriptPageCount()` helper, a budget-resolution priority chain, a `--script-pages` CLI flag, and a post-generation proportional normalization pass that scales all non-authoritative shot durations to match the computed budget, with clamping and residual-overage warnings.

---

## Issue Type

`Refactor / Feature`

## Priority

`High`

## Story Points

`8`

## Component / Labels

`filmbuff-cli` · `generate-shot-list` · `shot-duration` · `normalization` · `page-count` · `script-length` · `cli-flags` · `generator`

## Epic Link

`[EPIC] filmbuff Shot-List Generator — Duration Accuracy & Runtime Budget Enforcement`

---

## Background & Motivation

### Problem 1 — Per-Shot Duration Heuristics Are Runtime-Blind

The current `deriveDuration()` pipeline in `cli/src/lib/duration-derivation.ts` uses a 4-priority chain that operates **locally on each shot in isolation**:

```
P1 — Shooting-script M:SS annotation   (explicit; highest fidelity)
P2 — Beat-sheet timing cue             (scene-level; rounded to nearest second)
P3 — SceneSegmenter element estimate   (action lines × 3 s + dialogue words × 0.4 s/word)
P4 — Hard fallback: 5 seconds          (when no other signal is available)
```

None of these priorities has any knowledge of the screenplay's total page count. The SceneSegmenter's formula — `(actionLines × 3 s) + (dialogueWords × 0.4 s/word)` — is calibrated for local accuracy per scene element, not for global runtime fidelity across an entire 90-page script. The result is a `derivedTotalDuration` that silently drifts from the intended runtime.

> **Concrete example:** A 95-page feature screenplay (target: 95 minutes = 5,700 s) is processed. The screenplay contains 63 scenes with dense action sequences that each produce many short elements. The SceneSegmenter emits an average of 3 elements per scene at 3 s each → raw total ≈ 567 s (9.45 min). The generator's `derivedTotalDuration` is 567 s — **90% under the intended 5,700-second budget** — yet no warning is issued and the shot list is written to disk.

### Problem 2 — `totalBudgetSeconds` Is Wired for Warnings Only, Not Enforcement

`GeneratorConfig.totalBudgetSeconds` was introduced in a prior ticket and is already propagated from the project database into the generator. However, the generator only **reports** deviations as post-hoc console warnings — it never adjusts shot durations to meet the budget. The warning block:

```typescript
// cli/src/commands/generate-shot-list/generator/index.ts (current behavior)
if (config.totalBudgetSeconds !== undefined) {
  if (totalSeconds > config.totalBudgetSeconds) {
    shotList.warnings.push({ type: 'duration-budget-exceeded', message: '...' });
  }
}
```

...fires only when the total **exceeds** the budget, and even then takes no corrective action. There is no scale-factor adjustment, no under-budget guard at the default 80% threshold (the threshold is defined in spec but not yet enforced in code), and no page-count equivalent reported to the user.

### Problem 3 — No Automatic Page Count Detection From the Screenplay

`filmbuff generate-shot-list` reads the screenplay's parsed `Screenplay` object, which carries metadata populated by the parser (`totalLines`, `pdfPages`, `totalScenes`), but never uses any of it to derive a runtime budget. A PDF screenplay has `metadata.pdfPages` set precisely by the PDF parser; a Fountain or Markdown screenplay has `metadata.totalLines` from which a page count can be approximated using the US Letter standard of 55 lines per page. This data is available but unused.

> **Industry standard:** `1 screenplay page = 1 minute of screen time`. This rule is documented in the project's own style guide at `filmbuff/writing-standards/screenplay/rules/universal-formatting.md`:
>
> ```markdown
> ## Page-to-Screen-Time Ratio
> **Standard**: 1 page = 1 minute of screen time
>
> ### Typical Lengths
> - Feature Film: 90-120 pages
> - TV Drama (1 hour): 50-60 pages
> - TV Comedy (30 min): 22-25 pages
> - Short Film: 5-30 pages
> ```

### Problem 4 — No User Escape Hatch for Inaccurate Auto-Detection

When a screenplay is submitted as a Markdown or plain-text file, `totalLines` may be unreliable because those formats do not follow the strict 55-line-per-page Courier 12pt convention. There is no flag that allows the user to manually supply the page count. Automatic detection that silently produces the wrong budget is worse than no detection at all if there is no override mechanism.

---

## Solution Overview

1. Add `deriveScriptPageCount(screenplay: Screenplay): number | undefined` to `generate-shot-list.ts` — a 3-priority helper that extracts the page count from the parsed screenplay metadata.
2. Implement a **budget-resolution priority chain** in `generate-shot-list.ts` that resolves `totalBudgetSeconds` from (in order): `--target-duration` CLI flag → project DB `target_duration_seconds` → screenplay page count × 60.
3. Add a `--script-pages <n>` CLI flag to `generate-shot-list` as a manual override for automatic page count detection.
4. Propagate the resolved `totalBudgetSeconds` into `generator.generate()` (the field already exists in `GeneratorConfig`; it is currently only partially used).
5. Add a **proportional normalization pass** inside `generator/index.ts` that runs after all shots are derived. The pass computes a scale factor `scalableTarget / scalableDuration` and applies it to all shots whose duration is **not** sourced from a P1 shooting-script annotation. All scaled durations are clamped to `[MIN_DURATION_S, MAX_DURATION_S]`.
6. Update the existing budget warning block to report actual vs. target in both seconds and page-equivalent minutes, and to fire an under-budget warning when the normalized total falls below 80% of the budget.

---

## Detailed Requirements

### DR-1 — `deriveScriptPageCount()` Helper

**File:** `cli/src/commands/generate-shot-list.ts`

Add a new module-level function that extracts the screenplay's page count from the parsed `Screenplay` object using a 3-priority chain. The function must be a **pure function** — no side effects, no I/O — so it is trivially unit-testable.

**Priority chain:**

| Priority | Signal | Formula | Accuracy |
|---|---|---|---|
| P1 | `screenplay.metadata.pdfPages` | Direct value from PDF parser | Exact |
| P2 | `screenplay.metadata.totalLines` | `Math.round(totalLines / 55)` | ±2 pages for standard Fountain/FDX |
| P3 | `screenplay.scenes.length` | `Math.round(scenes.length × 1.5)` | ±15% proxy only |
| — | None | `undefined` | Budget enforcement disabled |

**Implementation:**

```typescript
// cli/src/commands/generate-shot-list.ts

/**
 * Derive the screenplay's page count from parsed metadata.
 *
 * Priority chain:
 *   P1 — screenplay.metadata.pdfPages    (exact; set by the PDF parser)
 *   P2 — screenplay.metadata.totalLines  (approximated at 55 lines/page — US Letter, Courier 12pt)
 *   P3 — screenplay.scenes.length        (proxy: average 1.5 pages per scene)
 *
 * Returns a positive integer page count, or `undefined` when no signal is available.
 * All results are clamped to a minimum of 1.
 */
function deriveScriptPageCount(screenplay: Screenplay): number | undefined {
  // P1 — PDF parser populates metadata.pdfPages with the exact page count.
  if (typeof screenplay.metadata.pdfPages === 'number' && screenplay.metadata.pdfPages > 0) {
    return screenplay.metadata.pdfPages;
  }

  // P2 — Line-count approximation.
  // US Letter screenplay standard: 12pt Courier, 1-inch margins, 55 lines per page.
  // Accurate to within ±2 pages for well-formatted Fountain and Final Draft exports.
  const LINES_PER_PAGE = 55;
  if (typeof screenplay.metadata.totalLines === 'number' && screenplay.metadata.totalLines > 0) {
    return Math.max(1, Math.round(screenplay.metadata.totalLines / LINES_PER_PAGE));
  }

  // P3 — Scene count proxy.
  // Industry average: ~1.5 pages per scene across all genres.
  // Accuracy degrades for action-heavy scripts (short scenes) or dialogue-heavy scripts (long scenes).
  // Used only as a last resort when no line-count metadata is available (e.g., DOCX / RTF inputs).
  const PAGES_PER_SCENE_ESTIMATE = 1.5;
  if (screenplay.scenes.length > 0) {
    return Math.max(1, Math.round(screenplay.scenes.length * PAGES_PER_SCENE_ESTIMATE));
  }

  // No signal available — budget enforcement is disabled for this run.
  return undefined;
}
```

**`deriveScriptPageCount` examples:**

| Screenplay | `pdfPages` | `totalLines` | `scenes.length` | Result |
|---|---|---|---|---|
| 95-page PDF feature | `95` | — | — | `95` |
| 110-page Fountain (5,500 lines) | — | `5500` | — | `100` |
| 44-page Markdown (2,200 lines) | — | `2200` | — | `40` |
| 30-scene DOCX (no line count) | — | — | `30` | `45` |
| Empty screenplay | — | — | `0` | `undefined` |

---

### DR-2 — Budget Resolution Priority Chain

**File:** `cli/src/commands/generate-shot-list.ts`

After calling `deriveScriptPageCount()`, resolve `totalBudgetSeconds` using a 4-level priority chain. Log the derived page count and target runtime to the console at the `chalk.gray` level so the user can verify it is correct before generation begins.

```typescript
// cli/src/commands/generate-shot-list.ts
// Runs after screenplay is parsed, before generator.generate() is called.

/** Industry standard: 1 screenplay page = 1 minute of screen time = 60 seconds. */
const SECONDS_PER_PAGE = 60;

const scriptPageCount = deriveScriptPageCount(screenplay);

/**
 * Budget resolution priority chain:
 *   1. --target-duration CLI flag              (explicit; user-provided; highest authority)
 *   2. project DB target_duration_seconds      (set during `filmbuff start`)
 *   3. screenplay page count × 60 seconds      (derived automatically from the input file)
 *   4. undefined                               (no budget; normalization pass is skipped)
 */
const totalBudgetSeconds: number | undefined =
  options.targetDuration                                               // priority 1
  ?? (loadedProject?.target_duration_seconds ?? undefined)            // priority 2
  ?? (scriptPageCount !== undefined                                    // priority 3
      ? scriptPageCount * SECONDS_PER_PAGE
      : undefined);

// Emit the resolved budget to the console so the user can catch incorrect page count detection.
if (scriptPageCount !== undefined && options.targetDuration === undefined
    && loadedProject?.target_duration_seconds == null) {
  console.log(
    chalk.gray(
      `📄 Script length: ~${scriptPageCount} page(s) → ` +
      `target runtime: ${formatRuntime(scriptPageCount * SECONDS_PER_PAGE)} ` +
      `(auto-derived; override with --script-pages or --target-duration)`
    )
  );
}
```

**Resolution examples:**

| `--target-duration` | DB `target_duration_seconds` | `scriptPageCount` | Resolved `totalBudgetSeconds` | Source |
|---|---|---|---|---|
| `6600` | `5400` | `95` | `6600` | CLI flag |
| _(not set)_ | `5400` | `95` | `5400` | Project DB |
| _(not set)_ | _(null)_ | `95` | `5700` | Page count × 60 |
| _(not set)_ | _(null)_ | `undefined` | `undefined` | None — normalization skipped |

---

### DR-3 — `--script-pages` CLI Override Flag

**File:** `cli/src/commands/generate-shot-list.ts` (flag registration section, alongside `--max-shot-length`)

Add a `--script-pages <n>` option that allows the user to manually specify the screenplay's page count. This takes the **highest priority** in the page count resolution, overriding automatic detection. It is distinct from `--target-duration` in that it accepts pages (the natural unit a writer uses) rather than raw seconds.

```typescript
// cli/src/commands/generate-shot-list.ts — flag registration

.option(
  '--script-pages <n>',
  [
    'Manually specify the screenplay page count for shot duration budget calculation.',
    'Overrides automatic page count detection from PDF metadata and line counting.',
    'Industry standard: 1 page = 1 minute of screen time.',
    '',
    'Use this flag when the input is a Markdown or plain-text screenplay whose line count',
    'does not map accurately to the 55-lines-per-page Courier 12pt standard.',
    '',
    'Examples:',
    '  --script-pages 95    →  targets 95 min total shot duration (5,700 s)',
    '  --script-pages 22    →  targets 22 min total shot duration (1,320 s)',
    '  --script-pages 110   →  targets 110 min total shot duration (6,600 s)',
  ].join('\n'),
  (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n <= 0) {
      throw new Error(
        `--script-pages must be a positive integer representing the screenplay page count. ` +
        `Received: "${v}"`
      );
    }
    return n;
  }
)
```

Apply `--script-pages` in the page count resolution with the **highest priority**, above automatic detection:

```typescript
// cli/src/commands/generate-shot-list.ts

const scriptPageCount: number | undefined =
  options.scriptPages                 // --script-pages flag: highest priority
  ?? deriveScriptPageCount(screenplay); // automatic detection: P1 → P2 → P3 → undefined
```

---

### DR-4 — Propagate `totalBudgetSeconds` into `generator.generate()`

**File:** `cli/src/commands/generate-shot-list.ts`

Pass the fully resolved `totalBudgetSeconds` into the `generator.generate()` call. The `GeneratorConfig.totalBudgetSeconds` field already exists in `types.ts` — no interface changes are required.

```typescript
// cli/src/commands/generate-shot-list.ts

const shotList = await generator.generate(screenplay.scenes, {
  maxCharacters:        maxCharacters,
  maxShotLength:        maxShotLength,
  warningThreshold:     90,
  includeContext:       true,
  includeMetadata:      true,
  muteSfx:              options.muteSfx || false,
  totalBudgetSeconds,           // NEW: resolved by the 4-level priority chain above
  narrativeFormatLabel,         // existing: injected into AI prompt context
});
```

---

### DR-5 — Proportional Normalization Pass in the Generator

**File:** `cli/src/commands/generate-shot-list/generator/index.ts`

Add a normalization pass that runs **after** the `deriveDuration()` loop has populated every `shot.duration` and accumulated `derivedTotalDuration`. The pass must:

1. Skip normalization entirely if `config.totalBudgetSeconds` is `undefined`.
2. Skip normalization if the deviation between `derivedTotalDuration` and `totalBudgetSeconds` is ≤ 5% (the `BUDGET_TOLERANCE` constant) — minor deviations do not justify scaling.
3. Identify **fixed shots** — those whose `durationNotes` begins with `"Derived from shot duration"` (P1 shooting-script annotations). Their durations are authoritative M:SS values and **must not be modified**.
4. Compute `scalableDuration` = `derivedTotalDuration − fixedDuration` and `scalableTarget` = `totalBudgetSeconds − fixedDuration`.
5. Compute `scaleFactor` = `scalableTarget / scalableDuration`.
6. Apply `scaleFactor` to every scalable shot, clamping the result to `[MIN_DURATION_S, MAX_DURATION_S]` to prevent values that would be visually nonsensical (e.g., a 0.3-second shot or a 90-second static wide shot).
7. Recompute `derivedTotalDuration` after scaling for accurate downstream reporting and warning evaluation.
8. Log the scale factor and the before/after totals to the console at the `chalk.gray` level.

```typescript
// cli/src/commands/generate-shot-list/generator/index.ts
// Insert AFTER the deriveDuration() loop and BEFORE the budget warning block.

import { MIN_DURATION_S, MAX_DURATION_S } from '../../lib/duration-derivation';

/**
 * Acceptable deviation from totalBudgetSeconds before normalization is triggered.
 * 5% tolerance avoids unnecessary scaling for minor heuristic imprecision.
 * Example: budget = 5,700 s → normalization triggers if total < 5,415 s or > 5,985 s.
 */
const BUDGET_TOLERANCE = 0.05;

if (config.totalBudgetSeconds !== undefined && derivedTotalDuration > 0) {
  const budget    = config.totalBudgetSeconds;
  const deviation = Math.abs(derivedTotalDuration - budget) / budget;

  if (deviation > BUDGET_TOLERANCE) {
    // Shots sourced from the shooting script (P1) have explicit M:SS annotations.
    // Their durations are authoritative and must not be modified by normalization.
    const isFixed = (s: Shot): boolean =>
      (s.durationNotes ?? '').startsWith('Derived from shot duration');

    const fixedDuration    = shotList.shots
      .filter(isFixed)
      .reduce((sum, s) => sum + s.duration, 0);

    const scalableShots    = shotList.shots.filter(s => !isFixed(s));
    const scalableDuration = derivedTotalDuration - fixedDuration;
    const scalableTarget   = budget - fixedDuration;

    if (scalableShots.length > 0 && scalableDuration > 0 && scalableTarget > 0) {
      const scaleFactor = scalableTarget / scalableDuration;

      for (const shot of scalableShots) {
        const rawScaled = shot.duration * scaleFactor;
        shot.duration = Math.round(
          Math.max(MIN_DURATION_S, Math.min(MAX_DURATION_S, rawScaled))
        );
      }

      // Recompute the total for accurate residual-overage detection.
      derivedTotalDuration = shotList.shots.reduce((sum, s) => sum + s.duration, 0);

      console.log(
        chalk.gray(
          `⏱  Shot durations normalized:\n` +
          `     Raw total  : ${formatRuntime(Math.round(scalableDuration + fixedDuration))}\n` +
          `     Adjusted to: ${formatRuntime(derivedTotalDuration)}\n` +
          `     Scale factor: ${scaleFactor.toFixed(4)}\n` +
          `     Fixed shots : ${shotList.shots.filter(isFixed).length} (shooting-script annotations preserved)\n` +
          `     Scaled shots: ${scalableShots.length}`
        )
      );
    }
  }
}
```

**Normalization worked examples:**

| Scenario | `derivedTotalDuration` | `totalBudgetSeconds` | `deviation` | Action |
|---|---|---|---|---|
| Feature screenplay, 95 pages, dense action | `567 s` | `5,700 s` | `90%` | Scale up (factor ≈ 10.05) |
| TV drama, 44 pages, mixed dialogue | `3,800 s` | `2,640 s` | `44%` | Scale down (factor ≈ 0.695) |
| Short film, 15 pages, dialogue-heavy | `870 s` | `900 s` | `3.3%` | Within tolerance — skip |
| Feature screenplay, 95 pages, 10 P1 shots | `5,800 s` (P1=600 s, scalable=5,200 s) | `5,700 s` | `1.7%` | Within tolerance — skip |

**Clamping guard — example:**

A dialogue-heavy short film where `scaleFactor = 0.15` would reduce a 5-second shot to 0.75 s. The clamp to `MIN_DURATION_S` (typically `3 s`) prevents this:

```typescript
// scaleFactor = 0.15, shot.duration = 5 s
const rawScaled = 5 * 0.15; // → 0.75 s
shot.duration = Math.round(Math.max(3, Math.min(60, 0.75))); // → 3 s (MIN_DURATION_S)
```

When many shots are clamped at `MIN_DURATION_S`, the post-normalization total may still exceed or fall below budget; the residual-overage warning (DR-6) captures this.

---

### DR-6 — Updated Budget Warning Block

**File:** `cli/src/commands/generate-shot-list/generator/index.ts`

Replace the existing over-budget-only warning block with a complete over/under check that reports both seconds and page-equivalent minutes, and that respects the 80% under-budget threshold defined in the existing spec. This block runs **after** the normalization pass (DR-5), so it reports the post-normalization total.

```typescript
// cli/src/commands/generate-shot-list/generator/index.ts
// Runs AFTER the normalization pass.

if (config.totalBudgetSeconds !== undefined) {
  const totalSeconds = shotList.shots.reduce((sum, s) => sum + s.duration, 0);
  const targetPages  = Math.round(config.totalBudgetSeconds / 60);
  const actualMins   = (totalSeconds / 60).toFixed(1);

  if (totalSeconds > config.totalBudgetSeconds) {
    // Residual overage: shots clamped at MAX_DURATION_S prevented full scale-down.
    const overage = totalSeconds - config.totalBudgetSeconds;
    console.warn(chalk.yellow(
      `⚠  Shot list total ${formatRuntime(totalSeconds)} (~${actualMins} min) exceeds ` +
      `target runtime ${formatRuntime(config.totalBudgetSeconds)} (~${targetPages} pages) ` +
      `by ${formatRuntime(overage)}. ` +
      `One or more shots hit MAX_DURATION_S during normalization and could not be scaled further. ` +
      `Consider splitting long scenes or reducing --max-shot-length.`
    ));
    shotList.warnings.push({
      type:    'duration-budget-exceeded',
      message:
        `Total shot duration (${totalSeconds} s / ~${actualMins} min) exceeds ` +
        `target runtime (${config.totalBudgetSeconds} s / ~${targetPages} pages) ` +
        `by ${overage} s. Shots clamped at MAX_DURATION_S prevented full normalization.`,
    });

  } else if (totalSeconds < config.totalBudgetSeconds * 0.80) {
    // Significant under-budget: the screenplay likely has fewer scenes than the runtime implies.
    const shortage  = config.totalBudgetSeconds - totalSeconds;
    console.warn(chalk.yellow(
      `⚠  Shot list total ${formatRuntime(totalSeconds)} (~${actualMins} min) is significantly ` +
      `under target runtime ${formatRuntime(config.totalBudgetSeconds)} (~${targetPages} pages) ` +
      `by ${formatRuntime(shortage)}. ` +
      `The screenplay may have fewer scenes than expected for a ${targetPages}-page script, ` +
      `or many shots were clamped at MIN_DURATION_S during normalization. ` +
      `Consider verifying the page count with --script-pages.`
    ));
  }
}
```

---

## File Impact

| File | Nature of Change |
|---|---|
| `cli/src/commands/generate-shot-list.ts` | **Add** `deriveScriptPageCount()` function; **add** `--script-pages` flag registration and validation; **update** budget resolution chain to include page-count derivation; **update** `generator.generate()` call to pass resolved `totalBudgetSeconds` |
| `cli/src/commands/generate-shot-list/generator/index.ts` | **Add** proportional normalization pass (DR-5) after the `deriveDuration()` loop; **replace** over-budget-only warning with complete over/under warning block (DR-6) importing `MIN_DURATION_S`, `MAX_DURATION_S` |
| `cli/src/lib/duration-derivation.ts` | **No changes** — normalization is a post-generation pass that does not modify the 4-priority chain |
| `cli/src/commands/generate-shot-list/generator/scene-segmenter.ts` | **No changes** — per-element duration estimates are correct; the normalization pass adjusts them globally |
| `cli/src/commands/generate-shot-list/generator/types.ts` | **No changes** — `GeneratorConfig.totalBudgetSeconds` already exists |
| `cli/src/__tests__/generate-shot-list-normalization.test.ts` | **New test file** (see Test Plan) |

---

## Acceptance Criteria

- [ ] **AC-1:** When a 95-page PDF screenplay is processed with no CLI flags, the `deriveScriptPageCount()` return value is `95`, `totalBudgetSeconds` is `5,700`, and `sum(shot.duration)` after normalization is within ±5% of `5,700` s (i.e., between `5,415` s and `5,985` s).
- [ ] **AC-2:** When `--script-pages 95` is supplied, automatic page count detection is bypassed entirely; `totalBudgetSeconds` is `5,700` s regardless of the screenplay's `pdfPages` or `totalLines` metadata.
- [ ] **AC-3:** When `--target-duration 6600` is supplied alongside a 95-page screenplay, `totalBudgetSeconds` is `6,600` s (CLI flag takes priority over page count derivation).
- [ ] **AC-4:** When the project DB `target_duration_seconds = 5400` and the screenplay is 95 pages, `totalBudgetSeconds` is `5,400` s (DB value takes priority over automatic page count derivation).
- [ ] **AC-5:** Shots whose `durationNotes` begins with `"Derived from shot duration"` (P1 shooting-script annotations) are **never modified** by the normalization pass. Their duration is identical before and after normalization.
- [ ] **AC-6:** The scale factor and before/after totals are printed to the console in `chalk.gray` whenever normalization is applied (deviation > 5%).
- [ ] **AC-7:** When deviation is ≤ 5%, the normalization pass is skipped entirely; no scale-factor message is printed.
- [ ] **AC-8:** Scaled shot durations are clamped to `[MIN_DURATION_S, MAX_DURATION_S]`. No shot in the output has a `duration` value outside this range.
- [ ] **AC-9:** When clamped shots prevent full normalization and the post-normalization total exceeds `totalBudgetSeconds`, a `duration-budget-exceeded` entry is added to `shotList.warnings` and a yellow warning is printed.
- [ ] **AC-10:** When the post-normalization total falls below `80%` of `totalBudgetSeconds`, a yellow under-budget warning is printed including the page count equivalent and a suggestion to verify with `--script-pages`.
- [ ] **AC-11:** `deriveScriptPageCount()` returns `undefined` for a screenplay with no `pdfPages`, no `totalLines`, and zero scenes; the normalization pass is skipped for that run.
- [ ] **AC-12:** All existing tests for `deriveDuration()`, `estimateFromActionDensity()`, `clamp()`, and `SceneSegmenter` pass without modification.
- [ ] **AC-13:** `--script-pages 0` and `--script-pages -1` are rejected at the CLI option-parsing layer with a descriptive error message; the process exits before the generator is invoked.

---

## Test Plan

### New test file: `cli/src/__tests__/generate-shot-list-normalization.test.ts`

**Test group 1 — `deriveScriptPageCount()`**

```typescript
describe('deriveScriptPageCount', () => {
  it('[P1] returns pdfPages when set', () => {
    const screenplay = makeScreenplay({ pdfPages: 95 });
    expect(deriveScriptPageCount(screenplay)).toBe(95);
  });

  it('[P2] approximates from totalLines when pdfPages is absent', () => {
    const screenplay = makeScreenplay({ totalLines: 5500 });
    // 5500 / 55 = 100
    expect(deriveScriptPageCount(screenplay)).toBe(100);
  });

  it('[P2] clamps to minimum 1 for very short scripts', () => {
    const screenplay = makeScreenplay({ totalLines: 20 });
    // Math.round(20 / 55) = 0 → clamped to 1
    expect(deriveScriptPageCount(screenplay)).toBe(1);
  });

  it('[P3] falls back to scene count proxy when line count is absent', () => {
    const screenplay = makeScreenplay({ scenes: Array(30).fill(makeScene()) });
    // Math.round(30 * 1.5) = 45
    expect(deriveScriptPageCount(screenplay)).toBe(45);
  });

  it('[P1 > P2] prefers pdfPages over totalLines when both are set', () => {
    const screenplay = makeScreenplay({ pdfPages: 95, totalLines: 5500 });
    expect(deriveScriptPageCount(screenplay)).toBe(95);
  });

  it('returns undefined when no signals are available', () => {
    const screenplay = makeScreenplay({ scenes: [] });
    expect(deriveScriptPageCount(screenplay)).toBeUndefined();
  });
});
```

**Test group 2 — Normalization pass (scale factor and clamping)**

```typescript
describe('shot duration normalization pass', () => {
  it('scales shot durations proportionally to meet totalBudgetSeconds', () => {
    // Fixture: 2 scalable shots totaling 8,000 s; budget = 5,700 s
    // scaleFactor = 5700 / 8000 = 0.7125
    const shots = [
      makeShot({ duration: 4000, durationNotes: 'Estimated from action density' }),
      makeShot({ duration: 4000, durationNotes: 'Estimated from action density' }),
    ];
    const config = makeConfig({ totalBudgetSeconds: 5700 });

    const normalized = applyNormalizationPass(shots, config);

    expect(normalized[0].duration).toBe(Math.round(4000 * 0.7125)); // → 2850
    expect(normalized[1].duration).toBe(Math.round(4000 * 0.7125)); // → 2850
    expect(normalized.reduce((s, sh) => s + sh.duration, 0)).toBe(5700);
  });

  it('preserves P1 shooting-script shots during normalization', () => {
    const p1Shot = makeShot({ duration: 600, durationNotes: 'Derived from shot duration 0:10' });
    const scalableShot = makeShot({ duration: 7400, durationNotes: 'Estimated from action density' });
    const config = makeConfig({ totalBudgetSeconds: 5700 });

    // fixed = 600 s, scalable = 7400 s, scalableTarget = 5700 - 600 = 5100
    // scaleFactor = 5100 / 7400 ≈ 0.6892
    const normalized = applyNormalizationPass([p1Shot, scalableShot], config);

    expect(normalized[0].duration).toBe(600);                       // P1: unchanged
    expect(normalized[1].duration).toBe(Math.round(7400 * (5100 / 7400))); // → 5100
  });

  it('clamps scaled durations to MIN_DURATION_S', () => {
    // scaleFactor = 0.10 → 5 * 0.10 = 0.5 s → clamped to MIN_DURATION_S (3 s)
    const shot = makeShot({ duration: 5, durationNotes: 'Estimated from action density' });
    const config = makeConfig({ totalBudgetSeconds: 30 }); // tiny budget relative to shot

    const normalized = applyNormalizationPass([shot], config);

    expect(normalized[0].duration).toBeGreaterThanOrEqual(MIN_DURATION_S);
  });

  it('skips normalization when deviation is within 5% tolerance', () => {
    // 5,700 s budget; total = 5,800 s → deviation = 1.75% → skip
    const shots = [makeShot({ duration: 5800, durationNotes: 'Estimated from action density' })];
    const config = makeConfig({ totalBudgetSeconds: 5700 });

    const normalized = applyNormalizationPass(shots, config);

    expect(normalized[0].duration).toBe(5800); // unchanged
  });

  it('adds duration-budget-exceeded warning when clamping prevents full normalization', () => {
    // All shots at MAX_DURATION_S; budget is 50% of their total
    const shots = [
      makeShot({ duration: MAX_DURATION_S, durationNotes: 'Estimated from action density' }),
      makeShot({ duration: MAX_DURATION_S, durationNotes: 'Estimated from action density' }),
    ];
    const budget = MAX_DURATION_S; // budget is half of total → would need to scale to 0.5
    const result = runFullGeneratorWithBudget(shots, budget);

    expect(result.warnings.some(w => w.type === 'duration-budget-exceeded')).toBe(true);
  });
});
```

---

## Usage Examples

```bash
# Auto-detect page count from PDF screenplay (most accurate)
filmbuff generate-shot-list \
  --input output/my-thriller/screenplay.pdf

# Console output:
# 📄 Script length: ~110 page(s) → target runtime: 1:50:00 (auto-derived; override with --script-pages or --target-duration)
# ⏱  Shot durations normalized:
#      Raw total  : 0:23:47
#      Adjusted to: 1:50:00
#      Scale factor: 4.6289
#      Fixed shots : 0 (shooting-script annotations preserved)
#      Scaled shots: 47

# Markdown screenplay — auto-detection may be unreliable; supply page count manually
filmbuff generate-shot-list \
  --input output/my-drama/screenplay.md \
  --script-pages 100

# CLI flag --target-duration overrides everything (accepts seconds)
filmbuff generate-shot-list \
  --input output/my-drama/screenplay.md \
  --target-duration 6000

# TV pilot — 44-page network drama, Fountain input
filmbuff generate-shot-list \
  --input output/pilot/episode-1.fountain \
  --script-pages 44

# Console output:
# 📄 Script length: ~44 page(s) → target runtime: 44:00 (--script-pages override)
# ⏱  Shot durations normalized:
#      Raw total  : 1:14:22
#      Adjusted to: 44:00
#      Scale factor: 0.5912
#      Fixed shots : 3 (shooting-script annotations preserved)
#      Scaled shots: 28

# Short commercial — page count irrelevant; use --target-duration directly
filmbuff generate-shot-list \
  --input output/apex-ad/storyboard.fountain \
  --target-duration 30
```

---

## Out of Scope

- Changes to `duration-derivation.ts` — the 4-priority chain is correct for per-shot estimation; the normalization pass is intentionally a separate post-generation concern.
- Changes to `SceneSegmenter` — element-level duration estimates are unmodified.
- Changes to any formatter (`markdown-formatter.ts`, `json-formatter.ts`, etc.) — they consume the already-normalized `shot.duration` value.
- Changes to the AI prompt context injection for `narrativeFormatLabel` — that is handled by the existing `totalBudgetSeconds` / `narrativeFormatLabel` flow introduced in `FB-NAR-1`.
- Automatic page count tracking for Final Draft (`.fdx`) files — the FDX parser does not currently populate `totalLines` or `pdfPages`; this is a separate parser enhancement.
- Changes to the `filmbuff start` wizard or project database schema — `totalBudgetSeconds` is already propagated from the DB by the existing `FB-NAR-1` implementation.

---

## Dependencies / Related

| Ticket / Artifact | Relationship |
|---|---|
| `FB-NAR-1` (Narrative Length Selection) | Prerequisite — introduced `GeneratorConfig.totalBudgetSeconds` and the DB `target_duration_seconds` column that this ticket reads |
| `FB-DUR-1` (Float Duration Fix) | Prerequisite — ensures all `shot.duration` values are integers before the normalization pass multiplies them |
| `ai-prompts/refactor-slg-01.md` | Source implementation prompt for this ticket |
| `cli/src/lib/duration-derivation.ts` | Provides `MIN_DURATION_S`, `MAX_DURATION_S`, and `deriveDuration()` — consumed but not modified |
| `cli/src/commands/generate-shot-list/generator/types.ts` | Provides `GeneratorConfig.totalBudgetSeconds` — consumed but not modified |
| `filmbuff/writing-standards/screenplay/rules/universal-formatting.md` | Industry standard reference: 1 page = 1 minute of screen time |
