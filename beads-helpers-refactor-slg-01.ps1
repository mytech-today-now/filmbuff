<#
.SYNOPSIS
    Generate beads tasks for the refactor-slg-01 OpenSpec change.

.DESCRIPTION
    Creates the full task hierarchy for:
      refactor-slg-01 — Script-Length-Aware Shot Duration Normalization
    Source: openspec/changes/refactor-slg-01/
    JIRA:   FB-SLG-1

    Uses .beads/bd-write.ps1 (write) and .beads/bd-query.ps1 (query).

.EXAMPLE
    .\beads-helpers-refactor-slg-01.ps1
    .\beads-helpers-refactor-slg-01.ps1 -DryRun     # Print tasks without writing

.NOTES
    Author: Augment Agent
    Change: refactor-slg-01
#>

param(
    [switch]$DryRun,
    [switch]$Verbose
)

$ErrorActionPreference = 'Stop'
$repoRoot    = $PSScriptRoot
$writeScript  = Join-Path $repoRoot ".beads\bd-write.ps1"
$queryScript  = Join-Path $repoRoot ".beads\bd-query.ps1"   # used by companion query script
$changeDir    = Join-Path $repoRoot "openspec\changes\refactor-slg-01"
$null = $queryScript   # surfaced by beads-query-refactor-slg-01.ps1

Write-Host "`n📋 refactor-slg-01 Task Generator" -ForegroundColor Cyan
Write-Host "   Change dir: $changeDir" -ForegroundColor Gray
Write-Host "   Mode: $(if ($DryRun) { 'DRY-RUN' } else { 'LIVE — writing to issues.jsonl' })" -ForegroundColor Gray

# ─── helpers ──────────────────────────────────────────────────────────────────

function Write-Step { param([string]$msg) Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$msg) Write-Host "  ✅ $msg" -ForegroundColor Green }
function Write-Info { param([string]$msg) Write-Host "  · $msg"  -ForegroundColor Gray  }

function New-BeadTask {
    param(
        [string]$Title,
        [string]$Description,
        [int]   $Priority  = 1,
        [string]$Type      = "task",
        [string[]]$Labels  = @()
    )

    if ($DryRun) {
        Write-Info "[DRY-RUN] Would create: $Title"
        return "bd-DRYRUN"
    }

    $params = @{
        Command        = 'create'
        IssueIdOrTitle = $Title
        Description    = $Description
        Priority       = $Priority
        IssueType      = $Type
        Json           = $true
    }
    if ($Labels.Count -gt 0) {
        $params['Labels'] = $Labels
    }

    $result = & $writeScript @params
    $issue  = $result | ConvertFrom-Json
    Write-Ok "Created $($issue.id): $Title"
    return $issue.id
}

function Add-BeadLink {
    param([string]$BlockedId, [string]$BlockerId)
    if ($DryRun) {
        Write-Info "[DRY-RUN] Would link: $BlockedId blocked-by $BlockerId"
        return
    }
    & $writeScript link $BlockedId -BlockedBy $BlockerId | Out-Null
    Write-Info "Linked: $BlockedId blocked-by $BlockerId"
}

# ─── EPIC ─────────────────────────────────────────────────────────────────────

Write-Step "Creating EPIC"

$epicDesc = @"
Source JIRA: FB-SLG-1 | Change ID: refactor-slg-01 | Priority: High | Story Points: 8
Type: Refactor / Feature / CLI / Shot-List Generator

PROBLEM (from proposal.md):
  Gap 1 — Per-Shot Heuristics Are Runtime-Blind: deriveDuration() in duration-derivation.ts
    operates locally on each shot. A 95-page screenplay can produce derivedTotalDuration of
    ~567 s instead of the target 5,700 s — a 90% undercount — with no warning.
  Gap 2 — totalBudgetSeconds Warns But Never Corrects: GeneratorConfig.totalBudgetSeconds
    emits a post-hoc warning when total exceeds budget but never adjusts shot durations.
    Under-budget situations are never flagged. No scale factor is applied.
  Gap 3 — No Automatic Page Count Detection: generate-shot-list reads parsed Screenplay
    metadata (pdfPages, totalLines, totalScenes) but never derives a runtime budget from it.
  Gap 4 — No User Override for Inaccurate Detection: No flag for users to supply page count.

SOLUTION — five spec domains (from proposal.md and deltas.md):
  1. deriveScriptPageCount() — 3-priority pure function (pdfPages → totalLines/55 → scenes×1.5)
  2. Budget Resolution Priority Chain — 4-level: --target-duration → DB → page×60 → undefined
  3. --script-pages <n> CLI Flag — highest-priority manual page count override; validated
  4. Proportional Normalization Pass — post-generation; 5% tolerance; P1 shot protection; clamped
  5. Updated Budget Warning Block — over/under reporting; page-equivalent minutes; 80% threshold

AFFECTED FILES (from refactor-slg-01.json affectedFiles):
  MODIFIED: cli/src/commands/generate-shot-list.ts
  MODIFIED: cli/src/commands/generate-shot-list/generator/index.ts
  NEW:      cli/src/__tests__/generate-shot-list-normalization.test.ts

UNAFFECTED FILES (explicitly out of scope per deltas.md):
  cli/src/lib/duration-derivation.ts  (4-priority per-shot chain unchanged)
  cli/src/commands/generate-shot-list/generator/scene-segmenter.ts
  cli/src/commands/generate-shot-list/generator/types.ts
  All formatters (markdown-formatter.ts, json-formatter.ts, etc.)

CONSTANTS (from design.md):
  SECONDS_PER_PAGE = 60 | LINES_PER_PAGE = 55 | PAGES_PER_SCENE_ESTIMATE = 1.5
  BUDGET_TOLERANCE = 0.05 | MIN_DURATION_S / MAX_DURATION_S (from duration-derivation.ts)

ACCEPTANCE CRITERIA: AC-1 through AC-13 (see openspec/changes/refactor-slg-01/summary.md)
SPEC REFS: openspec/changes/refactor-slg-01/specs/ (5 spec files)
PREREQUISITES: FB-NAR-1 (film-length) introduced GeneratorConfig.totalBudgetSeconds;
               FB-DUR-1 (fix-duration) ensures shot.duration values are integers
"@

$epicId = New-BeadTask `
    -Title       "[FB-SLG-1] refactor-slg-01: Script-Length-Aware Shot Duration Normalization" `
    -Description $epicDesc `
    -Priority    1 `
    -Type        "epic" `
    -Labels      @("refactor-slg-01","FB-SLG-1","normalization","shot-list","page-count","budget")



# ─── PHASE 2: Workstream 1 — generate-shot-list.ts Changes ───────────────────

Write-Step "Phase 2: Workstream 1 — generate-shot-list.ts Changes"

$ph2Desc = @"
PHASE: Workstream 1 — generate-shot-list.ts Changes (per implementation.md)
BLOCKED BY: Epic (spec approval gate)
BLOCKS: Phase 3 (normalization pass requires totalBudgetSeconds to propagate)

TASKS 2A — deriveScriptPageCount() Helper (from tasks.md):
  • Add LINES_PER_PAGE = 55 and PAGES_PER_SCENE_ESTIMATE = 1.5 constants (module level)
  • Implement deriveScriptPageCount(screenplay: Screenplay): number | undefined
      P1: return screenplay.metadata.pdfPages when a positive number (exact — set by PDF parser)
      P2: return Math.max(1, Math.round(totalLines / 55)) when totalLines > 0
      P3: return Math.max(1, Math.round(scenes.length * 1.5)) when scenes.length > 0
      Fallback: return undefined (normalization disabled when no signal available)
  • All three priorities clamp to minimum of 1
  • Export function for unit testing
  • Verify: pure function — no side effects, no I/O, no module state

TASKS 2B — --script-pages CLI Flag (from tasks.md):
  • Register --script-pages <n> option alongside --max-shot-length in flag section
  • Implement parser: parseInt(v, 10); throw if isNaN(n) || n <= 0
  • Verify: --script-pages 0 rejected with descriptive error before generator invoked
  • Verify: --script-pages -1 rejected with descriptive error before generator invoked
  • Verify: --script-pages abc rejected with descriptive error before generator invoked

TASKS 2C — Budget Resolution Chain (from tasks.md):
  • Add SECONDS_PER_PAGE = 60 constant at module level (industry standard: 1 page = 1 minute)
  • Resolve scriptPageCount: const scriptPageCount = options.scriptPages ?? deriveScriptPageCount(screenplay)
  • Implement 4-level totalBudgetSeconds resolution:
      Level 1: options.targetDuration                                                (CLI flag — highest)
      Level 2: loadedProject?.target_duration_seconds ?? undefined                   (project DB)
      Level 3: scriptPageCount !== undefined ? scriptPageCount * 60 : undefined      (page count)
      Level 4: undefined                                                              (no budget; skip)
  • Emit chalk.gray console log when level 3 is used (auto-derived page count visible to user)
  • Pass resolved totalBudgetSeconds into generator.generate() call (field already exists in GeneratorConfig)

IMPLEMENTATION FILE: cli/src/commands/generate-shot-list.ts
SPEC REFS: specs/derive-page-count/spec.md, specs/script-pages-flag/spec.md, specs/budget-resolution/spec.md
EXAMPLES: examples/01-pdf-auto-detect.md, examples/02-markdown-manual-pages.md

AC LINKS: AC-1 (95-page PDF → 5,700 s), AC-2 (--script-pages 95 bypass auto-detect),
          AC-3 (--target-duration 6600 overrides), AC-4 (DB 5400 overrides page count),
          AC-11 (no signals → undefined → skip), AC-13 (--script-pages 0/-1 rejected at parse time)
"@

$ph2Id = New-BeadTask `
    -Title       "[refactor-slg-01] Phase 2: Workstream 1 — generate-shot-list.ts (deriveScriptPageCount + --script-pages + budget chain)" `
    -Description $ph2Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("refactor-slg-01","phase-2","derive-page-count","script-pages-flag","budget-resolution","AC-1","AC-2","AC-3","AC-4","AC-13")

Add-BeadLink -BlockedId $ph2Id -BlockerId $epicId


# ─── PHASE 3: Workstream 2 — generator/index.ts Changes ──────────────────────

Write-Step "Phase 3: Workstream 2 — generator/index.ts Changes"

$ph3Desc = @"
PHASE: Workstream 2 — generator/index.ts Changes (per implementation.md)
BLOCKED BY: Phase 2 (totalBudgetSeconds must propagate from generate-shot-list.ts first)
BLOCKS: Phase 4 (tests require both files to be implemented)

TASKS 3A — Normalization Pass (from tasks.md):
  • Add import: import { MIN_DURATION_S, MAX_DURATION_S } from '../../lib/duration-derivation'
  • Add BUDGET_TOLERANCE = 0.05 constant at module level (5% deviation threshold)
  • Insert normalization pass AFTER deriveDuration() loop, BEFORE budget warning block
  • Guard: skip if config.totalBudgetSeconds === undefined
  • Guard: skip if derivedTotalDuration === 0
  • Guard: skip if |derivedTotalDuration - budget| / budget <= BUDGET_TOLERANCE (deviation ≤ 5%)
  • Identify fixed shots: durationNotes.startsWith('Derived from shot duration')
      These are P1 shooting-script annotations — NEVER modified, regardless of scale factor
  • Compute scalableDuration = derivedTotalDuration - fixedDuration
  • Compute scalableTarget = totalBudgetSeconds - fixedDuration
  • Compute scaleFactor = scalableTarget / scalableDuration
  • Apply scaleFactor to all scalable shots: Math.round(shot.duration * scaleFactor)
  • Clamp each scaled duration to [MIN_DURATION_S, MAX_DURATION_S]
  • Recompute derivedTotalDuration from shotList.shots.reduce(...)
  • Emit chalk.gray console block with: raw total, adjusted total, scale factor, fixed/scaled counts

NORMALIZATION CONSOLE OUTPUT FORMAT (from README.md):
  ⏱  Shot durations normalized:
       Raw total  : H:MM:SS
       Adjusted to: H:MM:SS
       Scale factor: N.NNNN
       Fixed shots : N (shooting-script annotations preserved)
       Scaled shots: N

TASKS 3B — Updated Budget Warning Block (from tasks.md):
  • Replace existing over-budget-only warning block with complete over/under check
  • Over-budget (totalSeconds > budget):
      Emit yellow console.warn with seconds overage + ~N pages page-equivalent + clamping note
      Push { type: 'duration-budget-exceeded', message } to shotList.warnings
  • Under-budget (totalSeconds < totalBudgetSeconds * 0.80):
      Emit yellow console.warn with seconds shortage + ~N pages + --script-pages suggestion
      Do NOT push to shotList.warnings (console.warn only per DR-6)
  • On-budget ([80%, 100%]): no warning emitted whatsoever
  • Compute targetPages = Math.round(config.totalBudgetSeconds / 60) for both messages
  • Over-budget message notes MAX_DURATION_S clamping when applicable

DESIGN INVARIANTS (from design.md + summary.md):
  Normalization pass is AFTER deriveDuration() loop and BEFORE budget warning block.
  P1 shots (durationNotes starts with 'Derived from shot duration') are INVIOLABLE.
  5% BUDGET_TOLERANCE prevents unnecessary scaling for short films already accurate.
  Budget derivation transparency via chalk.gray log showing detected page count.
  Clamping reported with residual-overage note, not silenced.

EXAMPLES: examples/03-normalization-scale.md, examples/04-clamping-and-warnings.md

IMPLEMENTATION FILE: cli/src/commands/generate-shot-list/generator/index.ts
SPEC REFS: specs/normalization-pass/spec.md, specs/budget-warnings/spec.md

AC LINKS: AC-5 (P1 shots never modified), AC-6 (chalk.gray block when normalization applied),
          AC-7 (≤5% deviation → skip), AC-8 (all scaled durations in [MIN, MAX]),
          AC-9 (clamped → duration-budget-exceeded in shotList.warnings + yellow warning),
          AC-10 (post-norm total < 80% → yellow under-budget warning + --script-pages suggestion)
"@

$ph3Id = New-BeadTask `
    -Title       "[refactor-slg-01] Phase 3: Workstream 2 — generator/index.ts (normalization pass + updated budget warning)" `
    -Description $ph3Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("refactor-slg-01","phase-3","normalization-pass","budget-warnings","AC-5","AC-6","AC-7","AC-8","AC-9","AC-10")

Add-BeadLink -BlockedId $ph3Id -BlockerId $ph2Id



# ─── PHASE 4: Workstream 3 — Tests ───────────────────────────────────────────

Write-Step "Phase 4: Workstream 3 — Tests"

$ph4Desc = @"
PHASE: Workstream 3 — Tests (per implementation.md)
BLOCKED BY: Phase 3 (requires both generate-shot-list.ts and generator/index.ts implemented)
BLOCKS: Phase 5 (CI verification requires all tests to pass)

TEST FILE: cli/src/__tests__/generate-shot-list-normalization.test.ts (NEW)

TASKS 4A — deriveScriptPageCount() Tests (from tasks.md + derive-page-count.test-plan.md):
  Test group: describe('deriveScriptPageCount', ...)  |  Coverage: 100% branch (9 branches)
  • UT-DPC-1: P1 — pdfPages = 95 → returns 95 (AC-1, AC-11)
  • UT-DPC-2: P2 — totalLines = 5500 → returns 100 (5500 / 55)
  • UT-DPC-3: P2 clamp — totalLines = 20 → returns 1 (Math.round(0.36) = 0 → clamped)
  • UT-DPC-4: P3 — scenes.length = 30 → returns 45 (30 × 1.5)
  • UT-DPC-5: P3 — single scene → returns 2 (Math.round(1.5) = 2)
  • UT-DPC-6: P1 > P2 — pdfPages = 95, totalLines = 5500 → returns 95 (priority ordering)
  • UT-DPC-7: returns undefined when pdfPages, totalLines, scenes all absent/empty (AC-11)
  • UT-DPC-8: pdfPages = 0 falls through to P2 (pdfPages > 0 guard)
  • UT-DPC-9: totalLines = 0 falls through to P3 (totalLines > 0 guard)

TASKS 4B — Normalization Pass Tests (from tasks.md + normalization-pass.test-plan.md):
  Test group: describe('shot duration normalization pass', ...)  |  Coverage: ≥95% branch
  • UT-NORM-1: Proportional scale-up — 2 shots totaling 8,000 s; budget = 5,700 s;
      scaleFactor = 0.7125; each shot → 2,850 s; total = 5,700 s (AC-1)
  • UT-NORM-2: P1 shot preservation — fixed shot (600 s) unchanged; scalable (7,400 s) adjusted
      to 5,100 s; total = 5,700 s (AC-5)
  • UT-NORM-3: MIN_DURATION_S clamping — extreme scale-down factor; result clamped to MIN (AC-8)
  • UT-NORM-4: MAX_DURATION_S clamping — extreme scale-up factor; result clamped to MAX (AC-8)
  • UT-NORM-5: Within-tolerance skip — 5,800 s total / 5,700 s budget = 1.75% → skip (AC-7)
  • UT-NORM-6: Budget undefined — pass skipped entirely; shots unchanged (AC-11)
  • UT-NORM-7: duration-budget-exceeded warning when clamping prevents full normalization (AC-9)
  • UT-NORM-8: All shot durations are integers after normalization

TASKS 4C — Budget Resolution Tests (from tasks.md + budget-resolution.test-plan.md):
  Test group: describe('totalBudgetSeconds resolution', ...)  |  Coverage: 100% branch (4 levels)
  • UT-BR-1: Level 1 wins — cliFlag=6600 + projectDb=5400 + scriptPages=95 → 6600 (AC-3)
  • UT-BR-2: Level 2 used — cliFlag=undefined + projectDb=5400 + scriptPages=95 → 5400 (AC-4)
  • UT-BR-3: Level 3 used — cliFlag=undefined + projectDb=null + scriptPages=95 → 5700 (AC-1)
  • UT-BR-4: Level 4 undefined — no signals → undefined → normalization skipped (AC-11)
  • UT-BR-5: DB null falls through to page count (44 pages → 2640 s)
  • UT-BR-6: DB undefined falls through to page count (22 pages → 1320 s)
  • UT-BR-7: --script-pages resolves at level 3 (95 × 60 = 5700) (AC-2)
  • UT-BR-8: --target-duration wins over --script-pages (level 1) (AC-3)

TASKS 4D — CLI Flag Validation Tests (from tasks.md + script-pages-flag.test-plan.md):
  Test group: describe('--script-pages CLI flag', ...)  |  Coverage: 100% branch on parser
  • UT-SPF-1: --script-pages 95 accepted; options.scriptPages = 95
  • UT-SPF-2: --script-pages 0 → throws '--script-pages must be a positive integer' (AC-13)
  • UT-SPF-3: --script-pages -1 → throws '--script-pages must be a positive integer' (AC-13)
  • UT-SPF-4: --script-pages abc → throws '--script-pages must be a positive integer'
  • UT-SPF-5: --script-pages 1 accepted (minimum valid value)
  • UT-SPF-6: --script-pages 95 overrides pdfPages = 110 in page count resolution (AC-2)
  • UT-SPF-7: --script-pages 95 overrides totalLines/55 approximation (AC-2)
  • UT-SPF-8: --target-duration still overrides budget when --script-pages also set (AC-3)
  • UT-SPF-9: --script-pages without --target-duration → level 3 budget (95 × 60 = 5700) (AC-2)
  • UT-SPF-10: chalk.gray console log emitted when level 3 budget via --script-pages (AC-6)

BUDGET WARNINGS TESTS (from budget-warnings.test-plan.md):
  Test group: describe('budget warning block', ...)  |  Coverage: ≥95% branch
  • UT-BW-1: Over-budget → yellow warning + duration-budget-exceeded in shotList.warnings (AC-9)
  • UT-BW-2: Over-budget message includes ~N pages page-equivalent minutes
  • UT-BW-3: Under-budget (< 80%) → yellow warning; NO shotList.warnings entry (AC-10)
  • UT-BW-4: Under-budget message includes --script-pages suggestion (AC-10)
  • UT-BW-5: On-budget [80%, 100%] → no warning emitted at all
  • UT-BW-6: Exactly at 80% boundary → no under-budget warning
  • UT-BW-7: Budget undefined → warning block skipped entirely
  • UT-BW-8: 'duration-budget-exceeded' type string is exact (public contract)

REGRESSION REQUIREMENT (from tasks.md Phase 4 + summary.md AC-12):
  All existing deriveDuration(), clamp(), and SceneSegmenter tests pass without modification.

TEST PLANS (from refactor-slg-01.json tests array):
  tests/derive-page-count.test-plan.md
  tests/normalization-pass.test-plan.md
  tests/budget-resolution.test-plan.md
  tests/script-pages-flag.test-plan.md
  tests/budget-warnings.test-plan.md

AC LINKS: AC-12 (existing tests pass without modification; no regression)
"@

$ph4Id = New-BeadTask `
    -Title       "[refactor-slg-01] Phase 4: Workstream 3 — Tests (generate-shot-list-normalization.test.ts; all test groups)" `
    -Description $ph4Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("refactor-slg-01","phase-4","tests","unit-tests","derive-page-count","normalization-pass","budget-resolution","AC-12")

Add-BeadLink -BlockedId $ph4Id -BlockerId $ph3Id



# ─── PHASE 5: CI and Acceptance Verification ─────────────────────────────────

Write-Step "Phase 5: CI and Acceptance Verification"

$ph5Desc = @"
PHASE: CI and Acceptance Verification (per tasks.md Phase 5 + summary.md)
BLOCKED BY: Phase 4 (all unit tests must pass first)
FINAL GATE before archiving the refactor-slg-01 OpenSpec change

TASK 5A — Jest Test Run (from tasks.md):
  • Run: npx jest --testPathPattern=generate-shot-list-normalization
  • All 27+ test cases must pass (UT-DPC-1..9, UT-NORM-1..8, UT-BR-1..8, UT-SPF-1..10,
    UT-BW-1..8)
  • Coverage report: ≥95% branch coverage on modified files

TASK 5B — Full CLI Regression (from tasks.md):
  • Run: npx jest  (full suite)
  • Existing derive-duration.test.ts, scene-segmenter tests pass without modification (AC-12)
  • Duration formatting, formatter integration tests unaffected (AC-12)

TASK 5C — Acceptance Criteria Spot-Check (from summary.md AC-1..AC-13):
  AC-1: 95-page PDF → auto-derives 5,700 s budget; normalization scales shots proportionally
  AC-2: --script-pages 95 overrides auto-detect (even when pdfPages = 110)
  AC-3: --target-duration 6600 wins over both DB and page-count budget (level 1 priority)
  AC-4: DB target_duration_seconds = 5400 wins over page-count when no CLI flag (level 2)
  AC-5: P1 shots (durationNotes 'Derived from shot duration') NEVER modified
  AC-6: chalk.gray normalization log emitted when pass fires (raw/adjusted/scale/counts)
  AC-7: Within-5% deviation → normalization skipped; derivedTotalDuration unchanged
  AC-8: All scaled shot.duration values remain within [MIN_DURATION_S, MAX_DURATION_S]
  AC-9: Clamping → shotList.warnings receives duration-budget-exceeded entry + yellow warn
  AC-10: Post-norm total < 80% of budget → yellow under-budget warning (no shotList.warnings)
  AC-11: No page signals available → totalBudgetSeconds undefined → normalization pass skipped
  AC-12: All pre-existing tests pass without modification (zero regression)
  AC-13: --script-pages 0 and --script-pages -1 rejected at parse time with descriptive error

TASK 5D — Build (from tasks.md):
  • Run: cd cli && npm run build
  • TypeScript compilation passes with --strict flags
  • No new TS2322/TS2345/TS2349 errors

TASK 5E — OpenSpec Archiving (from tasks.md):
  • Verify all spec deltas merged to openspec/specs/ via openspec-sync-specs skill
  • Move openspec/changes/refactor-slg-01/ → openspec/archive/refactor-slg-01/
  • Update .augment/coordination.json: spec status 'active' → 'archived'
  • Commit: 'Archive refactor-slg-01: Script-Length-Aware Shot Duration Normalization'
  • Push via: git pull --rebase && bd dolt push && git push

OUT-OF-SCOPE (do NOT touch during CI gate):
  cli/src/lib/duration-derivation.ts — per-shot P1/P2/P3/P4 chain unchanged (deltas.md)
  cli/src/commands/generate-shot-list/generator/scene-segmenter.ts
  cli/src/commands/generate-shot-list/generator/types.ts
  All output formatters (markdown-formatter.ts, json-formatter.ts, etc.)

SPEC REFS: openspec/changes/refactor-slg-01/summary.md (definitive AC list)
           openspec/changes/refactor-slg-01/README.md (change overview)
"@

$ph5Id = New-BeadTask `
    -Title       "[refactor-slg-01] Phase 5: CI and Acceptance Verification (all 13 ACs; build; archive)" `
    -Description $ph5Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("refactor-slg-01","phase-5","ci","acceptance","build","archive","AC-12")

Add-BeadLink -BlockedId $ph5Id -BlockerId $ph4Id

# ─── Summary ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " refactor-slg-01 Task Hierarchy Created" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  EPIC  : $epicId" -ForegroundColor White
Write-Host "  Phase2: $ph2Id  (generate-shot-list.ts)" -ForegroundColor White
Write-Host "  Phase3: $ph3Id  (generator/index.ts)" -ForegroundColor White
Write-Host "  Phase4: $ph4Id  (tests)" -ForegroundColor White
Write-Host "  Phase5: $ph5Id  (CI + acceptance + archive)" -ForegroundColor White
Write-Host ""
Write-Host "  Dependency chain:" -ForegroundColor Gray
Write-Host "    EPIC → Phase2 → Phase3 → Phase4 → Phase5" -ForegroundColor Gray
Write-Host ""
Write-Host "  Query tasks:" -ForegroundColor Gray
Write-Host "    .\beads-query-refactor-slg-01.ps1" -ForegroundColor Gray
Write-Host "    .\beads-query-refactor-slg-01.ps1 -Ready" -ForegroundColor Gray
Write-Host "    .\beads-query-refactor-slg-01.ps1 -Show" -ForegroundColor Gray
Write-Host ""

if ($DryRun) {
    Write-Host " ⚠  DRY-RUN mode — no tasks were written to .beads/issues.jsonl" -ForegroundColor Yellow
}

