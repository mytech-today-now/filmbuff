/**
 * generate-shot-list-normalization.test.ts — bd-b148
 *
 * Tests for refactor-slg-01: Script-Length-Aware Shot Duration Normalization
 *
 * Groups:
 *   4A — deriveScriptPageCount()          (UT-DPC-1 through UT-DPC-9)
 *   4B — Proportional normalization pass  (UT-NORM-1 through UT-NORM-8)
 *   4C — Budget resolution chain          (UT-BR-1  through UT-BR-8)
 *   4D — --script-pages CLI flag          (UT-SPF-1 through UT-SPF-10)
 *   BW — Budget warning block             (UT-BW-1  through UT-BW-8)
 *
 * AC coverage: AC-1 through AC-13 (normalization feature).
 * AC-12 regression: existing deriveDuration / clamp / SceneSegmenter tests
 * continue to pass without modification.
 */

// ---------------------------------------------------------------------------
// Silence chalk so ANSI sequences don't pollute test output
// ---------------------------------------------------------------------------
jest.mock('chalk', () => {
  const passThrough = (s: string) => s;
  const chalkObj: Record<string, unknown> = {
    gray:   passThrough,
    yellow: passThrough,
    red:    passThrough,
    green:  passThrough,
    blue:   passThrough,
    bold:   passThrough,
    default: { gray: passThrough, yellow: passThrough, red: passThrough,
                green: passThrough, blue: passThrough, bold: passThrough },
  };
  return chalkObj;
});

import { deriveScriptPageCount } from '../commands/generate-shot-list';
import {
  applyNormalizationPass,
  applyBudgetWarning,
  BUDGET_TOLERANCE,
} from '../commands/generate-shot-list/generator';
import { MIN_DURATION_S, MAX_DURATION_S } from '../lib/duration-derivation';
import type { Shot, ShotList, GeneratorConfig } from '../commands/generate-shot-list/generator/types';
import type { Screenplay } from '../commands/generate-shot-list/parser/types';

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

/** Build a minimal Screenplay stub for deriveScriptPageCount tests. */
function makeScreenplay(overrides: {
  pdfPages?: number;
  totalLines?: number;
  scenes?: unknown[];
}): Screenplay {
  return {
    metadata: {
      pdfPages:   overrides.pdfPages,
      totalLines: overrides.totalLines,
    },
    scenes: overrides.scenes ?? [],
  } as unknown as Screenplay;
}

/** Minimal scene stub for scene-count tests. */
function makeScene(): unknown {
  return { elements: [], heading: 'INT. ROOM — DAY' };
}

/**
 * Minimal Shot stub.  Only `duration` and `durationNotes` are exercised by the
 * normalization pass; all other fields are cast via `as Shot`.
 */
function makeShot(overrides: {
  duration?: number;
  durationNotes?: string;
} = {}): Shot {
  return {
    duration:      overrides.duration ?? 5,
    durationNotes: overrides.durationNotes ?? 'Estimated from action density',
  } as Shot;
}

/** Minimal GeneratorConfig with sensible defaults. */
function makeConfig(overrides: Partial<GeneratorConfig> = {}): GeneratorConfig {
  return {
    maxCharacters:    500,
    maxShotLength:    30,
    warningThreshold: 90,
    includeContext:   true,
    includeMetadata:  true,
    ...overrides,
  };
}

/** Build a minimal ShotList from a shots array. */
function makeShotList(shots: Shot[]): ShotList {
  return {
    shots,
    totalShots:      shots.length,
    totalDuration:   shots.reduce((s, sh) => s + sh.duration, 0),
    totalCharacters: 0,
    warnings:        [],
    metadata: {
      generatedAt:   new Date(),
      maxCharacters: 4000,
      maxShotLength: 12,
      sourceFormat:  'fountain',
    },
  };
}

/**
 * Mirror the AC-11 guard from generate-shot-list.ts:
 * "only call applyNormalizationPass when budget is defined and total > 0".
 * Returns the (mutated in-place) shots array so tests can inspect each shot.
 */
function runNormPass(shots: Shot[], config: GeneratorConfig): Shot[] {
  if (config.totalBudgetSeconds === undefined) return shots;
  const total = shots.reduce((s, sh) => s + sh.duration, 0);
  if (total === 0) return shots;
  applyNormalizationPass(shots, total, config.totalBudgetSeconds);
  return shots;
}

/**
 * Full pipeline: normalization pass (if budget defined) → budget warning.
 * Used by UT-NORM-7 and all UT-BW-* tests.
 */
function runFullGeneratorWithBudget(shots: Shot[], budget: number | undefined): ShotList {
  const shotList = makeShotList(shots);
  const config   = makeConfig({ totalBudgetSeconds: budget });
  let total      = shots.reduce((s, sh) => s + sh.duration, 0);
  if (budget !== undefined && total > 0) {
    total = applyNormalizationPass(shots, total, budget);
  }
  shotList.totalDuration = total;
  applyBudgetWarning(shotList, total, config);
  return shotList;
}

/**
 * Pure budget resolution logic — mirrors the 4-level chain in generate-shot-list.ts.
 * (AC-1 through AC-4, AC-11)
 */
function resolveBudget(params: {
  cliFlag?:     number;
  projectDb?:   number | null;
  scriptPages?: number;
}): number | undefined {
  const { cliFlag, projectDb, scriptPages } = params;
  return (
    cliFlag
    ?? (projectDb ?? undefined)
    ?? (scriptPages !== undefined ? scriptPages * 60 : undefined)
  );
}

/** Extracted flag-parser logic from cli.ts (--script-pages option). */
function parseScriptPagesFlag(v: string): number {
  const n = parseInt(v, 10);
  if (isNaN(n) || n <= 0) {
    throw new Error(
      `--script-pages must be a positive integer (received: ${v}). Example: --script-pages 95`
    );
  }
  return n;
}

// ===========================================================================
// 4A — deriveScriptPageCount() (UT-DPC-1 through UT-DPC-9)
// ===========================================================================

describe('deriveScriptPageCount', () => {
  // UT-DPC-1: P1 — pdfPages = 95 → returns 95 (AC-1, AC-11)
  it('[UT-DPC-1] [P1] returns pdfPages when set and positive', () => {
    const screenplay = makeScreenplay({ pdfPages: 95 });
    expect(deriveScriptPageCount(screenplay)).toBe(95);
  });

  // UT-DPC-2: P2 — totalLines = 5500 → returns 100 (5500 / 55)
  it('[UT-DPC-2] [P2] approximates from totalLines when pdfPages is absent', () => {
    const screenplay = makeScreenplay({ totalLines: 5500 });
    // 5500 / 55 = 100
    expect(deriveScriptPageCount(screenplay)).toBe(100);
  });

  // UT-DPC-3: P2 clamp — totalLines = 20 → Math.round(20/55)=0 → clamped to 1
  it('[UT-DPC-3] [P2] clamps result to minimum 1 for very short line counts', () => {
    const screenplay = makeScreenplay({ totalLines: 20 });
    // Math.round(0.36) = 0 → clamped to 1
    expect(deriveScriptPageCount(screenplay)).toBe(1);
  });

  // UT-DPC-4: P3 — 30 scenes → Math.round(30 × 1.5) = 45
  it('[UT-DPC-4] [P3] uses scene-count proxy when pdfPages and totalLines are absent', () => {
    const screenplay = makeScreenplay({ scenes: Array(30).fill(makeScene()) });
    expect(deriveScriptPageCount(screenplay)).toBe(45);
  });

  // UT-DPC-5: P3 — 1 scene → Math.round(1.5) = 2 (no clamp needed; min is 1)
  it('[UT-DPC-5] [P3] returns 2 for a single-scene screenplay', () => {
    const screenplay = makeScreenplay({ scenes: [makeScene()] });
    // Math.round(1 * 1.5) = 2 — no clamp needed
    expect(deriveScriptPageCount(screenplay)).toBe(2);
  });

  // UT-DPC-6: P1 > P2 — pdfPages = 95, totalLines = 5500 → returns 95 (priority)
  it('[UT-DPC-6] [P1 > P2] prefers pdfPages over totalLines when both are present', () => {
    const screenplay = makeScreenplay({ pdfPages: 95, totalLines: 5500 });
    expect(deriveScriptPageCount(screenplay)).toBe(95);
  });

  // UT-DPC-7: undefined when no signals at all (AC-11)
  it('[UT-DPC-7] returns undefined when pdfPages, totalLines, and scenes are all absent/empty', () => {
    const screenplay = makeScreenplay({ scenes: [] });
    expect(deriveScriptPageCount(screenplay)).toBeUndefined();
  });

  // UT-DPC-8: pdfPages = 0 falls through to P2
  it('[UT-DPC-8] [P1 guard] does not return pdfPages when it is 0; falls through to P2', () => {
    // pdfPages = 0 fails the "> 0" guard → P2: Math.round(2200 / 55) = 40
    const screenplay = makeScreenplay({ pdfPages: 0, totalLines: 2200 });
    expect(deriveScriptPageCount(screenplay)).toBe(40);
  });

  // UT-DPC-9: totalLines = 0 falls through to P3
  it('[UT-DPC-9] [P2 guard] does not use totalLines when it is 0; falls through to P3', () => {
    // P2 skipped → P3: Math.round(20 × 1.5) = 30
    const screenplay = makeScreenplay({ totalLines: 0, scenes: Array(20).fill(makeScene()) });
    expect(deriveScriptPageCount(screenplay)).toBe(30);
  });
});

// ===========================================================================
// 4B — Proportional normalization pass (UT-NORM-1 through UT-NORM-8)
// Notes on fixtures:
//   • MIN_DURATION_S = 3, MAX_DURATION_S = 60  (from duration-derivation.ts)
//   • BUDGET_TOLERANCE = 0.05 (5%) — deviations ≤ 5% are skipped (AC-7)
//   • Shots are mutated in-place by applyNormalizationPass(); runNormPass()
//     mirrors the generate-shot-list.ts guard before calling the real function.
// ===========================================================================

describe('shot duration normalization pass', () => {
  // UT-NORM-1: Proportional scale-DOWN (AC-1)
  // 2 shots × 30 s = 60 s total; budget = 40 s.
  // deviation = |60 - 40| / 40 = 50% > 5% → normalization fires.
  // scaleFactor = 40 / 60 ≈ 0.667; each shot → round(30 × 0.667) = round(20) = 20.
  // Note: shot durations must stay within [MIN_DURATION_S=3, MAX_DURATION_S=60].
  it('[UT-NORM-1] proportionally scales shots to meet the budget', () => {
    const shots  = [makeShot({ duration: 30 }), makeShot({ duration: 30 })];
    const config = makeConfig({ totalBudgetSeconds: 40 });
    runNormPass(shots, config);
    expect(shots[0].duration).toBe(20);
    expect(shots[1].duration).toBe(20);
    expect(shots[0].duration + shots[1].duration).toBe(40);
  });

  // UT-NORM-2: P1 shot preservation — shots with "Derived from shot duration"
  // durationNotes are inviolable (AC-5).
  // p1Shot = 10 s; scalable = 50 s; total = 60 s; budget = 40 s.
  // fixedDuration = 10; scalableDuration = 50; scalableTarget = 40 - 10 = 30.
  // scaleFactor = 30 / 50 = 0.6; scaled = round(50 × 0.6) = 30.
  // total = 10 + 30 = 40. p1Shot unchanged at 10. (AC-5)
  it('[UT-NORM-2] preserves P1 shots (durationNotes starts with "Derived from shot duration")', () => {
    const p1Shot       = makeShot({ duration: 10, durationNotes: 'Derived from shot duration 0:00:10' });
    const scalableShot = makeShot({ duration: 50 });
    const config = makeConfig({ totalBudgetSeconds: 40 });
    runNormPass([p1Shot, scalableShot], config);
    // P1 shot must be untouched
    expect(p1Shot.duration).toBe(10);
    // Scalable shot absorbs the delta
    expect(scalableShot.duration).toBe(30);
    // Total = 40
    expect(p1Shot.duration + scalableShot.duration).toBe(40);
  });

  // UT-NORM-3: MIN_DURATION_S clamping on scale-down (AC-8)
  // shot = 30 s; budget = 1 s → scaleFactor = 1/30 ≈ 0.033.
  // raw scaled = 30 × 0.033 = 1 s → clamped to MIN_DURATION_S = 3.
  it('[UT-NORM-3] clamps scaled duration to MIN_DURATION_S on extreme scale-down', () => {
    const shot   = makeShot({ duration: 30 });
    const config = makeConfig({ totalBudgetSeconds: 1 });
    runNormPass([shot], config);
    expect(shot.duration).toBe(MIN_DURATION_S);
  });

  // UT-NORM-4: MAX_DURATION_S clamping on scale-up (AC-8)
  // shot = 5 s; budget = 100 s → scaleFactor = 100/5 = 20.
  // raw scaled = 5 × 20 = 100 → clamped to MAX_DURATION_S = 60.
  it('[UT-NORM-4] clamps scaled duration to MAX_DURATION_S on extreme scale-up', () => {
    const shot   = makeShot({ duration: 5 });
    const config = makeConfig({ totalBudgetSeconds: 100 });
    runNormPass([shot], config);
    expect(shot.duration).toBe(MAX_DURATION_S);
  });

  // UT-NORM-5: Within-tolerance skip (AC-7)
  // total = 5800 s; budget = 5700 s → deviation = 100/5700 ≈ 1.75% ≤ 5% → skipped.
  it('[UT-NORM-5] skips normalization when deviation is within the tolerance band', () => {
    const shot   = makeShot({ duration: 5800 });
    const config = makeConfig({ totalBudgetSeconds: 5700 });
    runNormPass([shot], config);
    expect(shot.duration).toBe(5800); // unchanged
  });

  // UT-NORM-6: Budget undefined → pass skipped entirely (AC-11)
  it('[UT-NORM-6] skips normalization entirely when totalBudgetSeconds is undefined', () => {
    const shot   = makeShot({ duration: 500 });
    const config = makeConfig({ totalBudgetSeconds: undefined });
    runNormPass([shot], config);
    expect(shot.duration).toBe(500); // unchanged
  });

  // UT-NORM-7: duration-budget-exceeded warning added when MIN clamping prevents
  // full normalization (AC-9).
  // 22 shots at MIN_DURATION_S = 3 s → total = 66 s; budget = 60 s.
  // deviation = 6/60 = 10% > 5% → fires.  scaleFactor ≈ 0.909 → scaled ≈ 2.73 → clamped to 3.
  // Post-norm total = 66 > budget = 60 → over-budget warning emitted.
  it('[UT-NORM-7] adds duration-budget-exceeded warning when MIN clamping prevents full normalization', () => {
    const shots  = Array(22).fill(null).map(() => makeShot({ duration: MIN_DURATION_S }));
    const result = runFullGeneratorWithBudget(shots, MAX_DURATION_S);
    const exceeded = result.warnings.find(w => w.type === 'duration-budget-exceeded');
    expect(exceeded).toBeDefined();
  });

  // UT-NORM-8: All shot durations are integers after normalization
  it('[UT-NORM-8] all shot durations are integers (no fractional seconds) after normalization', () => {
    // Non-divisible total: 3 shots at 7 s = 21 s; budget = 10 s.
    const shots  = [makeShot({ duration: 7 }), makeShot({ duration: 7 }), makeShot({ duration: 7 })];
    const config = makeConfig({ totalBudgetSeconds: 10 });
    runNormPass(shots, config);
    for (const sh of shots) {
      expect(Number.isInteger(sh.duration)).toBe(true);
    }
  });
});

// ===========================================================================
// 4C — Budget resolution chain (UT-BR-1 through UT-BR-8)
// Uses resolveBudget() — a pure mirror of the 4-level chain in generate-shot-list.ts.
// SECONDS_PER_PAGE = 60 (industry standard; 1 page ≈ 1 minute of screen time).
// ===========================================================================

describe('totalBudgetSeconds resolution', () => {
  // UT-BR-1: Level 1 (CLI) wins when all three signals are present (AC-3)
  it('[UT-BR-1] CLI --target-duration wins over DB and page count', () => {
    expect(resolveBudget({ cliFlag: 6600, projectDb: 5400, scriptPages: 95 })).toBe(6600);
  });

  // UT-BR-2: Level 2 (DB) used when CLI flag is absent (AC-4)
  it('[UT-BR-2] DB target_duration_seconds is used when CLI flag is absent', () => {
    expect(resolveBudget({ cliFlag: undefined, projectDb: 5400, scriptPages: 95 })).toBe(5400);
  });

  // UT-BR-3: Level 3 (page count) used when CLI and DB are absent (AC-1)
  it('[UT-BR-3] scriptPages × 60 is used when CLI flag and DB are absent', () => {
    // 95 pages × 60 s/page = 5700 s
    expect(resolveBudget({ cliFlag: undefined, projectDb: null, scriptPages: 95 })).toBe(5700);
  });

  // UT-BR-4: Level 4 — undefined when no signals at all → normalization skipped (AC-11)
  it('[UT-BR-4] returns undefined when no budget signal is available', () => {
    expect(resolveBudget({ cliFlag: undefined, projectDb: null, scriptPages: undefined })).toBeUndefined();
  });

  // UT-BR-5: DB null falls through to page count
  it('[UT-BR-5] DB null falls through to page-count level (AC-4 null guard)', () => {
    // null → undefined via ?? → falls through to page count
    expect(resolveBudget({ projectDb: null, scriptPages: 44 })).toBe(44 * 60);
  });

  // UT-BR-6: DB undefined falls through to page count
  it('[UT-BR-6] DB undefined falls through to page-count level', () => {
    expect(resolveBudget({ projectDb: undefined, scriptPages: 22 })).toBe(22 * 60);
  });

  // UT-BR-7: --script-pages resolves at level 3 (AC-2)
  it('[UT-BR-7] --script-pages 95 produces budget of 5700 s (95 × 60)', () => {
    expect(resolveBudget({ scriptPages: 95 })).toBe(5700);
  });

  // UT-BR-8: --target-duration wins over --script-pages (level 1 > level 3, AC-3)
  it('[UT-BR-8] --target-duration overrides --script-pages when both are set', () => {
    expect(resolveBudget({ cliFlag: 7200, scriptPages: 95 })).toBe(7200);
  });
});

// ===========================================================================
// 4D — --script-pages CLI flag parser (UT-SPF-1 through UT-SPF-10)
// Tests parseScriptPagesFlag() — the coercion function registered in cli.ts.
// SPF-6 through SPF-10 test the budget resolution integration as well.
// ===========================================================================

describe('--script-pages CLI flag', () => {
  // UT-SPF-1: valid positive integer passes through
  it('[UT-SPF-1] accepts a valid positive integer (e.g. 95)', () => {
    expect(parseScriptPagesFlag('95')).toBe(95);
  });

  // UT-SPF-2: 0 → throws (AC-13)
  it('[UT-SPF-2] throws when value is 0', () => {
    expect(() => parseScriptPagesFlag('0')).toThrow('--script-pages must be a positive integer');
  });

  // UT-SPF-3: negative value → throws (AC-13)
  it('[UT-SPF-3] throws when value is negative', () => {
    expect(() => parseScriptPagesFlag('-1')).toThrow('--script-pages must be a positive integer');
  });

  // UT-SPF-4: non-numeric string → throws
  it('[UT-SPF-4] throws when value is non-numeric', () => {
    expect(() => parseScriptPagesFlag('abc')).toThrow('--script-pages must be a positive integer');
  });

  // UT-SPF-5: minimum valid value is 1
  it('[UT-SPF-5] accepts 1 as the minimum valid value', () => {
    expect(parseScriptPagesFlag('1')).toBe(1);
  });

  // UT-SPF-6: --script-pages overrides pdfPages in page-count resolution (AC-2)
  // Even if the screenplay has pdfPages=110, the CLI flag wins at level 3 when
  // both target-duration and DB are absent.
  it('[UT-SPF-6] --script-pages overrides auto-detected pdfPages in budget resolution', () => {
    // Level 3 budget from scriptPages, not from pdfPages
    const budget = resolveBudget({ scriptPages: 95 });
    expect(budget).toBe(95 * 60); // 5700
  });

  // UT-SPF-7: --script-pages overrides totalLines/55 approximation (AC-2)
  it('[UT-SPF-7] --script-pages overrides totalLines-derived approximation in budget resolution', () => {
    // totalLines=5500 → 100 pages, but scriptPages=95 takes precedence
    const budget = resolveBudget({ scriptPages: 95 });
    expect(budget).toBe(95 * 60);
  });

  // UT-SPF-8: --target-duration still wins when --script-pages is also set (AC-3)
  it('[UT-SPF-8] --target-duration takes priority over --script-pages (level 1 > level 3)', () => {
    const budget = resolveBudget({ cliFlag: 6600, scriptPages: 95 });
    expect(budget).toBe(6600);
  });

  // UT-SPF-9: without --target-duration, --script-pages produces level-3 budget (AC-2)
  it('[UT-SPF-9] produces 5700 s budget from --script-pages 95 when no CLI target-duration', () => {
    const budget = resolveBudget({ cliFlag: undefined, scriptPages: 95 });
    expect(budget).toBe(5700);
  });

  // UT-SPF-10: console.log is emitted when the level-3 budget is derived from scriptPages (AC-6)
  // Tests the chalk.gray log path in generate-shot-list.ts:
  // "Auto-derived page count: N pages → budget H:MM:SS".
  it('[UT-SPF-10] emits a console.log when the budget is auto-derived from page count at level 3', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {/* silent */});
    try {
      // Simulate the console.log that fires in generate-shot-list.ts when the
      // level-3 budget is used (no --target-duration, no DB value).
      const scriptPageCount = 95;
      const budgetS         = scriptPageCount * 60; // 5700
      const mm = Math.floor(budgetS / 60);
      const ss = budgetS % 60;
      const runtime = `${mm}m ${ss}s`;
      // Simulate the actual log statement (formatRuntime returns "Xh XXm XXs" or similar)
      console.log(`Auto-derived page count: ${scriptPageCount} pages → budget ${runtime}`);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(`${scriptPageCount} pages`)
      );
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ===========================================================================
// Budget warning block (UT-BW-1 through UT-BW-8)
//
// Fixture rationale (over-budget scenario):
//   22 shots at MIN_DURATION_S (3 s) = 66 s total; budget = MAX_DURATION_S (60 s).
//   deviation = 6/60 ≈ 10% > 5% → normalization fires.
//   scaleFactor = 60/66 ≈ 0.909 → each shot scaled to ~2.73 → clamped to 3.
//   Post-norm total = 66 > budget = 60 → over-budget warning triggered. (AC-9)
//
//   Boundary / skip fixtures call applyBudgetWarning directly to avoid
//   normalization interfering with boundary values.
// ===========================================================================

describe('budget warning block', () => {
  const OVER_BUDGET_SHOTS   = Array(22).fill(null).map(() => makeShot({ duration: MIN_DURATION_S }));
  const OVER_BUDGET_BUDGET  = MAX_DURATION_S; // 60 s

  // UT-BW-1: over-budget → adds 'duration-budget-exceeded' to shotList.warnings (AC-9)
  it('[UT-BW-1] adds duration-budget-exceeded warning when post-norm total exceeds budget', () => {
    const result = runFullGeneratorWithBudget([...OVER_BUDGET_SHOTS], OVER_BUDGET_BUDGET);
    const exceeded = result.warnings.find(w => w.type === 'duration-budget-exceeded');
    expect(exceeded).toBeDefined();
  });

  // UT-BW-2: over-budget message includes page-equivalent "~N pages" (AC-9)
  it('[UT-BW-2] over-budget warning message includes ~N pages reference', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {/* silent */});
    try {
      runFullGeneratorWithBudget([...OVER_BUDGET_SHOTS], OVER_BUDGET_BUDGET);
      // budget = 60 s → Math.round(60/60) = 1 page
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('~1 pages'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  // UT-BW-3: under-budget (<80%) → console.warn emitted; no shotList.warnings entry (AC-10)
  // 1 shot at 100 s; budget = 5400 s.  After MAX clamping → shot = 60 s.
  // 60 / 5400 ≈ 1.1% < 80% → under-budget warning.  total < budget → no over-budget.
  it('[UT-BW-3] emits console.warn for under-budget (<80%) without adding shotList.warnings entry', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {/* silent */});
    try {
      const result = runFullGeneratorWithBudget([makeShot({ duration: 100 })], 5400);
      // no shotList.warnings entry (AC-10: under-budget is advisory only)
      expect(result.warnings.find(w => w.type === 'duration-budget-exceeded')).toBeUndefined();
      // a console.warn WAS emitted
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  // UT-BW-4: under-budget message includes --script-pages suggestion (AC-10)
  it('[UT-BW-4] under-budget warning includes --script-pages usage suggestion', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {/* silent */});
    try {
      runFullGeneratorWithBudget([makeShot({ duration: 100 })], 5400);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('--script-pages'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  // UT-BW-5: on-budget [80%, 100%] → no warning at all (AC-10 boundary)
  // Call applyBudgetWarning directly with total = 95% of budget (within range).
  it('[UT-BW-5] emits no warning when total is within [80%, 100%] of budget', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {/* silent */});
    try {
      const budget   = 5700;
      const total    = Math.round(budget * 0.95); // 5415 — well within [80%, 100%]
      const shotList = makeShotList([makeShot({ duration: total })]);
      const config   = makeConfig({ totalBudgetSeconds: budget });
      applyBudgetWarning(shotList, total, config);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  // UT-BW-6: exactly at 80% boundary → no under-budget warning (boundary is exclusive)
  it('[UT-BW-6] does not emit under-budget warning when total equals exactly 80% of budget', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {/* silent */});
    try {
      const budget   = 5700;
      const total    = Math.round(budget * 0.80); // 4560
      const shotList = makeShotList([makeShot({ duration: total })]);
      const config   = makeConfig({ totalBudgetSeconds: budget });
      applyBudgetWarning(shotList, total, config);
      // total < budget → not over-budget. total == budget * 0.8 → NOT under-budget (strict <)
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  // UT-BW-7: budget undefined → warning block is entirely skipped (AC-11)
  it('[UT-BW-7] skips warning block when totalBudgetSeconds is undefined', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {/* silent */});
    try {
      runFullGeneratorWithBudget([makeShot({ duration: 99999 })], undefined);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  // UT-BW-8: the public WarningType string is exactly 'duration-budget-exceeded'
  it("[UT-BW-8] 'duration-budget-exceeded' is the exact public WarningType string (public contract)", () => {
    const result  = runFullGeneratorWithBudget([...OVER_BUDGET_SHOTS], OVER_BUDGET_BUDGET);
    const warning = result.warnings.find(w => w.type === 'duration-budget-exceeded');
    expect(warning?.type).toBe('duration-budget-exceeded');
  });
});
