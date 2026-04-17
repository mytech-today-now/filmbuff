<#
.SYNOPSIS
    Generate beads tasks for the film-length OpenSpec change.

.DESCRIPTION
    Creates the full task hierarchy for:
      film-length — Narrative Length Selection & End-to-End Runtime Constraint
    Source: openspec/changes/film-length/
    JIRA:   FB-NAR-1

    Uses .beads/bd-write.ps1 (write) and .beads/bd-query.ps1 (query).

.EXAMPLE
    .\beads-helpers-film-length.ps1
    .\beads-helpers-film-length.ps1 -DryRun     # Print tasks without writing

.NOTES
    Author: Augment Agent
    Change: film-length
#>

param(
    [switch]$DryRun,
    [switch]$Verbose
)

$ErrorActionPreference = 'Stop'
$repoRoot    = $PSScriptRoot
$writeScript = Join-Path $repoRoot ".beads\bd-write.ps1"
$queryScript = Join-Path $repoRoot ".beads\bd-query.ps1"
$changeDir   = Join-Path $repoRoot "openspec\changes\film-length"

Write-Host "`n📋 film-length Task Generator" -ForegroundColor Cyan
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
Source JIRA: FB-NAR-1 | Change ID: film-length | Priority: High | Story Points: 21

PROBLEM (from proposal.md):
  Gap 1 — No Runtime Budget: AI content-generation calls receive no length constraint.
    A 30-second commercial is indistinguishable from a 90-minute feature to the AI.
  Gap 2 — Shot-List Generator Has No Duration Budget: generate-shot-list produces shots
    with no total-budget guard. A 44-minute drama can silently produce a 54-minute shot list.
  Gap 3 — AI Prompts Have No Runtime Awareness: Every AI call (logline, beat sheet,
    screenplay, shot list) is issued without runtime metadata.

SOLUTION — six spec domains (from proposal.md and deltas.md):
  1. Narrative Length Catalog   — 37 compile-time presets across 7 categories (6s → 18000s)
  2. Wizard Step 3A             — select dropdown between Slug and Tone; TOTAL_STEPS 11→12
  3. CLI Flags                  — --target-duration, --narrative-format, narrative-lengths cmd
  4. Database Migration         — 002_add_target_duration.sql; idempotent runner; type extensions
  5. Duration Propagation       — GeneratorConfig.totalBudgetSeconds; over/under budget warnings
  6. AI Prompt Injection        — ## Target Runtime Constraint in every AI system prompt

AFFECTED FILES (from film-length.json affectedFiles):
  NEW:      cli/src/utils/narrative-length-catalog.ts
  NEW:      cli/src/db/migrations/002_add_target_duration.sql
  NEW:      cli/src/lib/runtime-constraint.ts
  MODIFIED: cli/src/commands/start-wizard.ts, cli/src/utils/wizard-utils.ts
  MODIFIED: cli/src/cli.ts, cli/src/commands/start.ts
  MODIFIED: cli/src/db/types.ts, cli/src/db/project-repository.ts
  MODIFIED: cli/src/commands/generate-shot-list/generator/types.ts
  MODIFIED: cli/src/commands/generate-shot-list.ts
  MODIFIED: cli/src/commands/generate-shot-list/generator/index.ts

ACCEPTANCE CRITERIA: AC-1 through AC-24 (see openspec/changes/film-length/summary.md)
SPEC REFS: openspec/changes/film-length/specs/ (6 spec files)
NON-GOALS: genre-appropriateness validation, shot-list.jsonl format changes,
  per-shot duration overrides, custom arbitrary runtime values, frontend UI, API endpoints
DEPENDENCIES: @inquirer/prompts (select+Separator), 001_*.sql predecessor migration,
  FB-0042 (downstream consumer), FB-DUR-1 (parallel float-duration fix)
"@

$epicId = New-BeadTask `
    -Title       "[FB-NAR-1] film-length: Narrative Length Selection & End-to-End Runtime Constraint" `
    -Description $epicDesc `
    -Priority    1 `
    -Type        "epic" `
    -Labels      @("film-length","FB-NAR-1","narrative-length","runtime-constraint","wizard","shot-list")


# ─── PHASE 2: Catalog Module ───────────────────────────────────────────────────

Write-Step "Phase 2: Catalog Module (Workstream 1)"

$ph2Desc = @"
PHASE: Catalog Module — Workstream 1 (per implementation.md)
BLOCKS: All other phases (catalog is the single source of truth; every workstream imports it)

TASKS (from tasks.md Phase 2):
  • Create cli/src/utils/narrative-length-catalog.ts
  • Define NarrativeLengthEntry interface and NarrativeCategory union type (7 categories)
  • Export NARRATIVE_LENGTH_CATALOG — all 37 entries in category order (compile-time constant)
  • Verify: every id unique; every seconds is a positive integer;
      every pageCountTarget === Math.round(seconds / 60)
  • Export findNarrativeLength(id: string) — O(n) lookup; returns undefined for unknown ids
  • Export formatRuntime(seconds: number) — M:SS for < 3600s; H:MM:SS for >= 3600s
  • Export computeThreeActBudget(totalSeconds: number) — Syd Field 25/50/25 split;
      rounding absorbed into Act 2; sum === totalSeconds invariant
  • Write unit tests: findNarrativeLength (found+not-found), formatRuntime (< 60s, 60-3599s,
      >= 3600s edge cases), computeThreeActBudget (sum invariant for all 37 entries)
  • Achieve >= 95% branch coverage on catalog module

INTERFACE (from deltas.md Domain A):
  NarrativeLengthEntry { id, label, seconds, category, pageCountTarget, typicalGenres? }
  NarrativeCategory: 'ads-commercials'|'social-web'|'short-film'|'tv-episode'|
                     'tv-movie'|'feature-film'|'epic-extended'
  Catalog counts (from film-length.json): Ads 6, Social/Web 7, Short Film 6, TV Episode 8,
    TV Movie 3, Feature Film 9, Epic/Extended 4 = 37 total; range 6s → 18000s

DESIGN INVARIANTS (from design.md + summary.md):
  Compile-time constant only — never derived at runtime. Zero dependencies on other modules.
  pageCountTarget NEVER stored in DB or payloads — always derived at display time.
  All consumers (wizard, CLI, generator, AI builders) import from this single module.

QUICK REFERENCE (from README.md):
  findNarrativeLength('feature-90m') → { id:'feature-90m', seconds:5400, ... }
  formatRuntime(5400) → "1:30:00"  |  formatRuntime(90) → "1:30"  |  formatRuntime(30) → "0:30"
  computeThreeActBudget(5400) → { actOne:1350, actTwo:2700, actThree:1350 }

IMPLEMENTATION FILE: cli/src/utils/narrative-length-catalog.ts
TEST FILE:           cli/src/__tests__/narrative-length-catalog.test.ts
TEST PLAN:           openspec/changes/film-length/tests/narrative-length-catalog.test-plan.md
SPEC REF:            openspec/changes/film-length/specs/narrative-length-catalog/spec.md
EXAMPLE:             openspec/changes/film-length/examples/01-wizard-narrative-length.md

AC LINKS: AC-2 (all 37 entries grouped by category in correct order),
          AC-15 (filmbuff narrative-lengths formatted table; exit 0),
          AC-16 (filmbuff narrative-lengths --json parseable JSON array; exit 0)
"@

$ph2Id = New-BeadTask `
    -Title       "[film-length] Phase 2: Catalog Module (narrative-length-catalog.ts)" `
    -Description $ph2Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("film-length","phase-2","catalog","narrative-length-catalog","AC-2","AC-15","AC-16")

Add-BeadLink -BlockedId $ph2Id -BlockerId $epicId

# ─── PHASE 3: Database Migration ──────────────────────────────────────────────

Write-Step "Phase 3: Database Migration (Workstream 2)"

$ph3Desc = @"
PHASE: Database Migration — Workstream 2 (per implementation.md)
BLOCKED BY: Phase 2 (NarrativeCategory type reference from catalog module)
BLOCKS: Phase 5 (CLI flags write to these columns), Phase 6 (generator reads from them)

TASKS (from tasks.md Phase 3):
  • Create cli/src/db/migrations/002_add_target_duration.sql:
      ALTER TABLE projects ADD COLUMN target_duration_seconds INTEGER
        CHECK (target_duration_seconds IS NULL OR target_duration_seconds > 0);
      ALTER TABLE projects ADD COLUMN narrative_format_id TEXT;
  • Update migration runner: wrap each ALTER TABLE in column-existence check
      (PRAGMA table_info or catch 'duplicate column name') for idempotency
  • Extend Project interface (cli/src/db/types.ts):
      target_duration_seconds: number | null
      narrative_format_id:     string | null
  • Extend CreateProjectInput interface (cli/src/db/types.ts):
      target_duration_seconds?: number
      narrative_format_id?:     string
  • Update INSERT_PROJECT SQL string in project-repository.ts to include both new columns
  • Update create() binding: input.target_duration_seconds ?? null, input.narrative_format_id ?? null
  • Write migration idempotency test (run migration twice; assert no error on second run)
  • Verify Number.isInteger(row.target_duration_seconds) for all non-null DB values
  • Confirm all existing ProjectRepository tests pass without modification

MIGRATION SQL (from deltas.md Domain D):
  target_duration_seconds: SQLite INTEGER + CHECK (> 0); floats truncated by integer affinity
  narrative_format_id: TEXT — stores catalog id slug (e.g. "feature-90m")

RISK (from proposal.md): SQLite lacks IF NOT EXISTS for ADD COLUMN — runner MUST treat
  'SQLITE_ERROR: duplicate column name' as no-op for idempotency.

IMPLEMENTATION FILES: cli/src/db/migrations/002_add_target_duration.sql,
  cli/src/db/types.ts, cli/src/db/project-repository.ts
TEST FILE: cli/src/__tests__/database-migration.test.ts
TEST PLAN: openspec/changes/film-length/tests/database-migration.test-plan.md
SPEC REF:  openspec/changes/film-length/specs/database-migration/spec.md

AC LINKS: AC-17 (002_add_target_duration.sql; running twice does not error),
          AC-18 (target_duration_seconds stored as INTEGER; Number.isInteger true)
"@

$ph3Id = New-BeadTask `
    -Title       "[film-length] Phase 3: Database Migration (002_add_target_duration.sql)" `
    -Description $ph3Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("film-length","phase-3","database","migration","AC-17","AC-18")

Add-BeadLink -BlockedId $ph3Id -BlockerId $ph2Id


# ─── PHASE 4: Wizard Step 3A ──────────────────────────────────────────────────

Write-Step "Phase 4: Wizard Step 3A (Workstream 3)"

$ph4Desc = @"
PHASE: Wizard Step 3A — Workstream 3 (per implementation.md)
BLOCKED BY: Phase 2 (catalog module for building choices + post-selection feedback)
BLOCKS: Phase 7 (CI verification)
CAN RUN IN PARALLEL WITH: Phase 5 (CLI Flags)

TASKS (from tasks.md Phase 4):
  • Extend WizardState (wizard-utils.ts):
      narrativeFormatId?:     string  (catalog entry id, e.g. "feature-90m")
      targetDurationSeconds?: number  (total runtime in whole seconds, e.g. 5400)
  • Update buildEquivalentCommand() — append --target-duration and --narrative-format when set
  • Update stateToStartOptions() — forward both new fields to StartOptions
  • Implement stepNarrativeLength(prefill?, genre?) in start-wizard.ts:
      Build choices array with Separator headers in catalog category order:
        Ads & Commercials → Social & Web → Short Film → TV Episode →
        TV Movie → Feature Film → Epic & Extended → (skip / not set)
      Call select({ choices, pageSize: 20 }) from @inquirer/prompts
      Print dim post-selection feedback: pages target + three-act breakdown
        → Pages target: ~90 pages   Act 1: 22:30 · Act 2: 45:00 · Act 3: 22:30
      Print dim genre-coherence hint when typicalGenres exists and does not include project genre
        ℹ  Note: "90-minute comedy / horror" is most common for comedy / horror projects.
      Genre-coherence hint NEVER blocks step advancement (advisory only)
      Return { narrativeFormatId, targetDurationSeconds } or both undefined on skip
      Re-entry mode pre-fills prefill as the default selection
  • Insert stepNarrativeLength between slug step and tone step in wizard sequencer
  • Update TOTAL_STEPS from 11 to 12 (constant change — all step-number display strings update)
  • Update renderSummaryTable — three display cases for 'Runtime target' row:
      Format id + duration: Runtime target: 90-minute comedy / horror  (1:30:00 / ~90p)
      Duration only:        Runtime target: 1:50:00
      Neither (dim):        Runtime target: (not set)
  • Write wizard step unit tests UT-WIZ-1 through UT-WIZ-6
  • Confirm all existing wizard tests pass without modification (no regression)

RISK (from proposal.md): TOTAL_STEPS and ALL step-number display strings MUST be updated
  atomically — partial update causes display regressions.

IMPLEMENTATION FILES: cli/src/utils/wizard-utils.ts, cli/src/commands/start-wizard.ts
TEST FILE: cli/src/__tests__/wizard-step.test.ts
TEST PLAN: openspec/changes/film-length/tests/wizard-step.test-plan.md
SPEC REF:  openspec/changes/film-length/specs/wizard-step/spec.md
EXAMPLE:   openspec/changes/film-length/examples/01-wizard-narrative-length.md

AC LINKS: AC-1 (Wizard presents Step 4/12 after Slug before Tone),
          AC-2 (37 entries grouped by category in correct order),
          AC-3 ((skip / not set) leaves both fields undefined),
          AC-4 (re-entry mode pre-fills previously chosen narrativeFormatId),
          AC-5 (post-selection dim feedback: pages target + three-act breakdown),
          AC-6 (genre-coherence hint fires when typicalGenres excludes project genre; never blocks),
          AC-7 (summary panel: Runtime target label + runtime + pages when set from catalog),
          AC-8 (summary panel: Runtime target: (not set) (dim) when no runtime selected),
          AC-9 (buildEquivalentCommand includes --target-duration + --narrative-format when set)
"@

$ph4Id = New-BeadTask `
    -Title       "[film-length] Phase 4: Wizard Step 3A (stepNarrativeLength; TOTAL_STEPS 11→12)" `
    -Description $ph4Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("film-length","phase-4","wizard","step-3a","AC-1","AC-3","AC-4","AC-5","AC-6","AC-7","AC-8","AC-9")

Add-BeadLink -BlockedId $ph4Id -BlockerId $ph2Id

# ─── PHASE 5: CLI Flags and Discovery Command ──────────────────────────────────

Write-Step "Phase 5: CLI Flags and Discovery Command (Workstream 4)"

$ph5Desc = @"
PHASE: CLI Flags and Discovery Command — Workstream 4 (per implementation.md)
BLOCKED BY: Phase 2 (catalog for flag resolution), Phase 3 (DB columns ready to receive values)
BLOCKS: Phase 7 (CI verification)
CAN RUN IN PARALLEL WITH: Phase 4 (Wizard Step 3A)

TASKS (from tasks.md Phase 5):
  • Extend StartOptions (cli/src/commands/start.ts):
      targetDurationSeconds?: number
      narrativeFormatId?:     string
  • Update startCommand() — forward both new fields to projectRepo.create()
  • Register --target-duration <seconds> on filmbuff start (cli/src/cli.ts):
      Parser: parseInt(v, 10); throw commander error if isNaN(n) || n <= 0
      --target-duration 0 and --target-duration -1 MUST throw before action handler
  • Register --narrative-format <id> on filmbuff start (cli/src/cli.ts)
  • Add flag resolution block in start action handler:
      If --narrative-format supplied and --target-duration absent:
        look up catalog → set targetDuration = entry.seconds
        error + exit 1 on unknown format id (message references filmbuff narrative-lengths)
      If both supplied with mismatched values:
        yellow warning; --target-duration wins (authoritative); exit 0
      If both supplied with matching values: no warning; exit 0
  • Implement filmbuff narrative-lengths command — formatted table (id, label, runtime)
      grouped by category; exit 0
  • Implement --json flag for filmbuff narrative-lengths — full JSON array; exit 0
  • Write CLI flag resolution unit tests UT-CLI-1 through UT-CLI-8

FLAG PRECEDENCE (from design.md):
  narrativeFormat only → derive targetDuration from catalog (or exit 1 unknown)
  both agree → no warning
  both disagree → yellow warning; targetDuration wins

EXAMPLES (from examples/02-cli-flags-usage.md):
  filmbuff start --title "My Film" --genre horror --narrative-format "feature-90m"
  filmbuff start --title "My Film" --genre thriller --target-duration 6600
  filmbuff narrative-lengths
  filmbuff narrative-lengths --json | jq '.[] | select(.category == "feature-film")'

IMPLEMENTATION FILES: cli/src/commands/start.ts, cli/src/cli.ts
TEST FILE: cli/src/__tests__/cli-flags.test.ts
TEST PLAN: openspec/changes/film-length/tests/cli-flags.test-plan.md
SPEC REF:  openspec/changes/film-length/specs/cli-flags/spec.md
EXAMPLE:   openspec/changes/film-length/examples/02-cli-flags-usage.md

AC LINKS: AC-9 (buildEquivalentCommand includes both flags when set),
          AC-10 (--target-duration 5400 stores 5400, narrative_format_id=NULL),
          AC-11 (--narrative-format feature-90m derives 5400, stores both),
          AC-12 (unknown --narrative-format exits 1 with clear error),
          AC-13 (--target-duration 0 or negative throws commander validation error),
          AC-14 (mismatch: yellow warning; --target-duration wins; exit 0),
          AC-15 (filmbuff narrative-lengths formatted table; exit 0),
          AC-16 (filmbuff narrative-lengths --json parseable; exit 0)
"@

$ph5Id = New-BeadTask `
    -Title       "[film-length] Phase 5: CLI Flags (--target-duration, --narrative-format, narrative-lengths)" `
    -Description $ph5Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("film-length","phase-5","cli","flags","AC-10","AC-11","AC-12","AC-13","AC-14")

Add-BeadLink -BlockedId $ph5Id -BlockerId $ph2Id
Add-BeadLink -BlockedId $ph5Id -BlockerId $ph3Id


# ─── PHASE 6: Duration Propagation and AI Prompt Injection ────────────────────

Write-Step "Phase 6: Duration Propagation and AI Prompt Injection (Workstream 5)"

$ph6Desc = @"
PHASE: Duration Propagation and AI Prompt Injection — Workstream 5 (per implementation.md)
BLOCKED BY: Phase 2 (catalog lookups), Phase 3 (DB columns with target_duration_seconds)
BLOCKS: Phase 7 (CI verification)

TASKS (from tasks.md Phase 6):
  • Extend GeneratorConfig (generator/types.ts):
      totalBudgetSeconds?:   number  (validates total shot duration against target runtime)
      narrativeFormatLabel?: string  (injected into AI system prompt)
  • Update generate-shot-list.ts — resolve totalBudgetSeconds:
      (1) explicit --target-duration CLI flag → (2) project DB target_duration_seconds → (3) undefined
  • Update generate-shot-list.ts — resolve narrativeFormatLabel:
      findNarrativeLength(project.narrative_format_id)?.label
  • Add budget enforcement block in generator/index.ts AFTER shotList.totalDuration is finalized:
      Over-budget (totalSeconds > budget):
        append { type: 'duration-budget-exceeded', message } to shotList.warnings
        emit yellow console.warn
      Under-budget (totalSeconds < budget * 0.80):
        append { type: 'duration-budget-under', message } to shotList.warnings
        emit yellow console.warn
      On-budget ([budget * 0.80, budget]): NO warning emitted
  • Implement injectRuntimeConstraint(systemPrompt, project) helper (runtime-constraint.ts):
      When target_duration_seconds is non-null: append ## Target Runtime Constraint block:
        label, formatted runtime, page count, three-act breakdown (Syd Field paradigm)
      When target_duration_seconds is NULL: return systemPrompt unchanged; no section injected
  • Call injectRuntimeConstraint in ALL AI system-prompt builders:
      Logline generator, Beat-sheet generator, Screenplay generator, Shot-list prep
  • Write generator budget enforcement tests UT-GEN-1 through UT-GEN-8
  • Write AI prompt injection tests UT-AI-1 through UT-AI-12
  • Achieve >= 90% branch coverage on generator budget enforcement module
  • Achieve >= 95% branch coverage on injectRuntimeConstraint helper

BUDGET WARNING FORMAT (from README.md):
  Over:  ⚠  Total shot duration 54:00 exceeds target runtime 44:00 by 10:00.
              Consider reducing scene count or shot lengths.
  Under: ⚠  Total shot duration 1:08:00 is significantly under target runtime 1:30:00
              (22:00 short). Consider adding scenes or extending existing shots.

AI PROMPT BLOCK (from deltas.md Domain F):
  ## Target Runtime Constraint
  This project must run exactly **<label>** (<formatted-runtime> / ~<pageTarget> pages).
  This is a hard constraint. All content must be scoped to fit within this runtime.
  Three-act structure budget (Syd Field paradigm):
  - Act 1: ~<actOne-formatted> (~<actOne-pages> pages)
  - Act 2: ~<actTwo-formatted> (~<actTwo-pages> pages)
  - Act 3: ~<actThree-formatted> (~<actThree-pages> pages)

DESIGN INVARIANTS (from design.md):
  Budget enforcement is GENERATOR-LEVEL only — CLI never blocks project creation on duration.
  AI prompt injection is as close to the API call as possible (system-prompt builder, not CLI).
  injectRuntimeConstraint is pure and stateless — no side effects.

IMPLEMENTATION FILES: cli/src/commands/generate-shot-list/generator/types.ts,
  cli/src/commands/generate-shot-list.ts,
  cli/src/commands/generate-shot-list/generator/index.ts,
  cli/src/lib/runtime-constraint.ts, all AI prompt builder files
TEST FILES: cli/src/__tests__/generator-budget.test.ts, cli/src/__tests__/ai-prompt-injection.test.ts,
            cli/src/__tests__/runtime-constraint.test.ts
TEST PLANS: openspec/changes/film-length/tests/duration-propagation.test-plan.md,
            openspec/changes/film-length/tests/ai-prompt-injection.test-plan.md
SPEC REFS:  openspec/changes/film-length/specs/duration-propagation/spec.md,
            openspec/changes/film-length/specs/ai-prompt-injection/spec.md
EXAMPLES:   openspec/changes/film-length/examples/03-budget-enforcement.md,
            openspec/changes/film-length/examples/04-ai-prompt-injection.md

AC LINKS: AC-19 (generate-shot-list reads target_duration_seconds from DB → totalBudgetSeconds),
          AC-20 (over-budget: duration-budget-exceeded in shotList.warnings; yellow warn),
          AC-21 (under-budget < 80%: duration-budget-under in shotList.warnings; yellow warn),
          AC-22 (on-budget [80%-100%]: no budget warning emitted),
          AC-23 (every AI prompt includes ## Target Runtime Constraint when non-null),
          AC-24 (null target_duration_seconds → no section injected; no error)
"@

$ph6Id = New-BeadTask `
    -Title       "[film-length] Phase 6: Duration Propagation & AI Prompt Injection (Workstream 5)" `
    -Description $ph6Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("film-length","phase-6","generator","budget","ai-prompt","runtime-constraint","AC-19","AC-20","AC-21","AC-22","AC-23","AC-24")

Add-BeadLink -BlockedId $ph6Id -BlockerId $ph2Id
Add-BeadLink -BlockedId $ph6Id -BlockerId $ph3Id


# ─── PHASE 7: CI and Acceptance Verification ─────────────────────────────────

Write-Step "Phase 7: CI and Acceptance Verification"

$ph7Desc = @"
PHASE: CI and Acceptance Verification (from tasks.md Phase 7)
BLOCKED BY: Phase 4 (Wizard Step 3A), Phase 5 (CLI Flags), Phase 6 (Duration Propagation + AI)

TASKS (from tasks.md Phase 7):
  • Confirm all 24 acceptance criteria (AC-1 through AC-24) pass
  • Confirm all existing wizard tests pass (no regression)
  • Confirm all existing ProjectRepository tests pass (no regression)
  • CI pipeline green with no regressions
  • PR reviewed and approved; merge

ACCEPTANCE CHECKLIST — ALL must pass (from summary.md):
  AC-1:  Wizard presents Narrative Length as Step 4/12 immediately after Slug, before Tone
  AC-2:  All 37 entries displayed, grouped by category, in correct display order
  AC-3:  (skip / not set) leaves narrativeFormatId and targetDurationSeconds as undefined
  AC-4:  Re-entry mode pre-fills previously chosen narrativeFormatId
  AC-5:  Post-selection dim feedback shows pages target and three-act breakdown
  AC-6:  Genre-coherence hint fires when typicalGenres does not include project genre; never blocks
  AC-7:  Summary panel shows Runtime target: <label>  (<runtime> / ~<pages>p) when set from catalog
  AC-8:  Summary panel shows Runtime target: (not set) (dim) when no runtime selected
  AC-9:  buildEquivalentCommand() includes --target-duration and --narrative-format when set
  AC-10: filmbuff start --target-duration 5400 stores 5400; narrative_format_id=NULL
  AC-11: filmbuff start --narrative-format "feature-90m" derives targetDurationSeconds=5400; stores both
  AC-12: Unknown --narrative-format exits 1 with clear error referencing filmbuff narrative-lengths
  AC-13: --target-duration 0 or negative throws commander validation error before action handler
  AC-14: Mismatched --target-duration + --narrative-format: yellow warning; --target-duration wins; exit 0
  AC-15: filmbuff narrative-lengths prints formatted table of 37 entries; exit 0
  AC-16: filmbuff narrative-lengths --json emits parseable JSON array of 37 entries; exit 0
  AC-17: 002_add_target_duration.sql adds both columns; running twice does not error
  AC-18: target_duration_seconds stored as INTEGER; Number.isInteger(row.target_duration_seconds) true
  AC-19: generate-shot-list reads target_duration_seconds from DB → totalBudgetSeconds
  AC-20: Over-budget: duration-budget-exceeded entry in shotList.warnings; yellow console.warn
  AC-21: Under-budget (< 80%): duration-budget-under entry in shotList.warnings; yellow console.warn
  AC-22: On-budget ([80%, 100%]): no budget warning emitted
  AC-23: Every AI prompt includes ## Target Runtime Constraint when target_duration_seconds non-null
  AC-24: Null target_duration_seconds → no ## Target Runtime Constraint injected; no error

EXIT CONDITIONS (from implementation.md):
  Catalog unit tests: findNarrativeLength, formatRuntime, computeThreeActBudget — >= 95% branch coverage
  Generator budget enforcement: >= 90% branch coverage
  DB migration idempotency test passes (second run is no-op)
  All existing wizard and ProjectRepository tests pass without modification
  filmbuff narrative-lengths and filmbuff narrative-lengths --json exit 0
  CI pipeline passes with no regressions

SPEC REF:  openspec/changes/film-length/summary.md (acceptance checklist)
JIRA REF:  openspec/changes/film-length/jira/FB-NAR-1.md (AC-1 through AC-24 original source)
"@

$ph7Id = New-BeadTask `
    -Title       "[film-length] Phase 7: CI and Acceptance Verification (AC-1 through AC-24)" `
    -Description $ph7Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("film-length","phase-7","ci","acceptance-criteria","regression-check")

Add-BeadLink -BlockedId $ph7Id -BlockerId $ph4Id
Add-BeadLink -BlockedId $ph7Id -BlockerId $ph5Id
Add-BeadLink -BlockedId $ph7Id -BlockerId $ph6Id

# ─── SUMMARY ──────────────────────────────────────────────────────────────────

Write-Step "Task creation complete"
Write-Host ""
Write-Host "  Epic:    $epicId" -ForegroundColor Yellow
Write-Host "  Phase 2: $ph2Id  (Catalog Module)" -ForegroundColor White
Write-Host "  Phase 3: $ph3Id  (Database Migration)" -ForegroundColor White
Write-Host "  Phase 4: $ph4Id  (Wizard Step 3A)" -ForegroundColor White
Write-Host "  Phase 5: $ph5Id  (CLI Flags + Discovery)" -ForegroundColor White
Write-Host "  Phase 6: $ph6Id  (Duration Propagation + AI Prompt)" -ForegroundColor White
Write-Host "  Phase 7: $ph7Id  (CI + Acceptance)" -ForegroundColor White
Write-Host ""
Write-Host "  Dependencies:" -ForegroundColor Gray
Write-Host "    Phase 2 ← Epic" -ForegroundColor Gray
Write-Host "    Phase 3 ← Phase 2" -ForegroundColor Gray
Write-Host "    Phase 4 ← Phase 2  (parallel with Phase 5)" -ForegroundColor Gray
Write-Host "    Phase 5 ← Phase 2, Phase 3  (parallel with Phase 4)" -ForegroundColor Gray
Write-Host "    Phase 6 ← Phase 2, Phase 3" -ForegroundColor Gray
Write-Host "    Phase 7 ← Phase 4, Phase 5, Phase 6" -ForegroundColor Gray
Write-Host ""

if (-not $DryRun) {
    Write-Host "Querying created tasks..." -ForegroundColor Cyan
    & $queryScript -Label "film-length" -Limit 20 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  (run .\beads-query-film-length.ps1 to see the task hierarchy)" -ForegroundColor Gray
    }
}

Write-Host "`n✅ Done. Run '.\beads-query-film-length.ps1' to verify the task hierarchy." -ForegroundColor Green
