<#
.SYNOPSIS
    Generate beads tasks for the fix-duration OpenSpec change.

.DESCRIPTION
    Creates the full task hierarchy for:
      fix-duration — Fix Floating-Point `duration` Serialization in generate-shot-list
    Source: openspec/changes/fix-duration/
    JIRA:   FB-DUR-1

    Uses .beads/bd-write.ps1 (write) and .beads/bd-query.ps1 (query).

.EXAMPLE
    .\beads-helpers-fix-duration.ps1
    .\beads-helpers-fix-duration.ps1 -DryRun     # Print tasks without writing

.NOTES
    Author: Augment Agent
    Change: fix-duration
#>

param(
    [switch]$DryRun,
    [switch]$Verbose
)

$ErrorActionPreference = 'Stop'
$repoRoot    = $PSScriptRoot
$writeScript = Join-Path $repoRoot ".beads\bd-write.ps1"
$queryScript = Join-Path $repoRoot ".beads\bd-query.ps1"
$changeDir   = Join-Path $repoRoot "openspec\changes\fix-duration"

Write-Host "`n📋 fix-duration Task Generator" -ForegroundColor Cyan
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
Source JIRA: FB-DUR-1 | Companion: FB-DUR-2 | Change ID: fix-duration | Priority: High | Story Points: 5

PROBLEM: filmbuff generate-shot-list emits IEEE 754 floating-point duration values (e.g.,
5.800000000000001) in shot-list JSON/JSONL output and POST /batch payloads when the P3a
SceneSegmenter uses the dialogue word-count formula (words x 0.4 s/word). The xAI Grok
video API rejects these payloads with HTTP 422 — duration PickFirst could not deserialize:
  First:  invalid type: floating point 5.800000000000001, expected i32
  Second: invalid type: floating point 5.800000000000001, expected a string
Batch stops at Shot 2 of 18. Shot 1 (shooting-script annotation -> integer) succeeds;
Shot 2 (P3a segmenter -> float) causes the entire batch to abort.

ROOT CAUSE: deriveDuration() P3a branch returns clamp(shot.segmenterEstimateS, MIN, MAX)
without Math.round(). 0.4 has no exact IEEE 754 binary representation:
  14 words x 0.4 s/word = 5.600000000000001
The raw float propagates verbatim through resolveVideoControls() -> shotToBatchItem()
-> json/jsonl formatters -> xAI API payload.

SOLUTION (defense-in-depth per design.md): Math.round() at four independent layers:
  DR-1 Primary:   Math.round(clamp(...))           in duration-derivation.ts (all P1-P4)
  DR-2 Secondary: Math.round(durationResult.seconds) in video-controls.ts resolveVideoControls()
  DR-3 Terminal:  Math.round(shot.controls.duration) in batch-serializer.ts shotToBatchItem()
  DR-4 File:      Math.round(shot.duration)          in json-formatter.ts + jsonl-formatter.ts

AFFECTED FILES (5 production, 3 test):
  cli/src/lib/duration-derivation.ts
  cli/src/lib/video-controls.ts
  cli/src/lib/batch-serializer.ts
  cli/src/commands/generate-shot-list/formatter/json-formatter.ts
  cli/src/commands/generate-shot-list/formatter/jsonl-formatter.ts
  cli/src/__tests__/duration-derivation.test.ts
  cli/src/__tests__/video-controls.test.ts
  cli/src/__tests__/batch-serializer.test.ts

OUT OF SCOPE: ai-powered repository (FB-DUR-2); clamp() signature; formatTime(); markdown-formatter.ts
SPEC REF: filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2
OPENSPEC: openspec/changes/fix-duration/ (proposal.md, design.md, deltas.md, implementation.md, tasks.md)
"@

$epicId = New-BeadTask `
    -Title       "[FB-DUR-1] fix-duration: Fix Floating-Point duration Serialization in generate-shot-list" `
    -Description $epicDesc `
    -Priority    1 `
    -Type        "epic" `
    -Labels      @("fix-duration","FB-DUR-1","duration-derivation","batch-serializer","422-fix","xai-api","generate-shot-list")



# ─── PHASE 1: Specification Review ────────────────────────────────────────────

Write-Step "Phase 1: Specification Review"

$ph1Desc = @"
PHASE: Specification Review (tasks.md Phase 1)
BLOCKS: Phase 2 (primary fix — duration-derivation.ts)

TASKS (from tasks.md Phase 1):
  • Read filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2 before touching any code.
      Canonical rule: duration MUST be a non-negative integer (whole seconds), range [3, 60].
      Floating-point values are strictly prohibited.
  • Review proposal.md, design.md, and deltas.md with stakeholders.
  • Confirm change boundaries: 5 production files, 3 test files; no other changes.
  • Confirm out-of-scope: no clamp() changes, no formatTime() changes, no markdown-formatter.ts changes.
  • Approve all four spec deltas:
      specs/duration-integer-contract/spec.md   (DR-1)
      specs/video-controls-guard/spec.md        (DR-2)
      specs/batch-serializer-guard/spec.md      (DR-3)
      specs/formatter-integer-contract/spec.md  (DR-4)

PRE-CONDITIONS (from implementation.md):
  1. Read batch-shot-list-spec.md v1.0.0 §2 — canonical duration contract.
  2. Confirm clamp() and formatTime() are NOT modified in this change.
  3. Confirm markdown-formatter.ts is NOT modified in this change.

DESIGN ARCHITECTURE (from design.md):
  Each layer has a distinct responsibility and failure mode:
  DR-1: Future formula changes (new s/word coefficient) could introduce new float paths.
  DR-2: resolveVideoControls() is a public API; callers can pass arbitrary DurationResult.
  DR-3: shotToBatchItem() is the serialization boundary; must be correct regardless of input.
  DR-4: Files written to disk persist; a float written once can be re-ingested months later.
  Math.round() on an integer is a strict no-op: Math.round(6) === 6. All existing tests pass unchanged.

SPEC REFS: openspec/changes/fix-duration/specs/ (4 spec files)
"@

$ph1Id = New-BeadTask `
    -Title       "[fix-duration] Phase 1: Specification Review and Change Boundary Confirmation" `
    -Description $ph1Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("fix-duration","phase-1","spec-review","FB-DUR-1")

Add-BeadLink -BlockedId $ph1Id -BlockerId $epicId



# ─── PHASE 2: Primary Fix — duration-derivation.ts (DR-1) ─────────────────────

Write-Step "Phase 2: Primary Fix - duration-derivation.ts (DR-1)"

$ph2Desc = @"
PHASE: Primary Fix — duration-derivation.ts (DR-1) (Workstream 1 per implementation.md)
BLOCKED BY: Phase 1 (specification review)
BLOCKS: Phase 3, Phase 4, Phase 5 (all defensive guards), Phase 6 (tests)

FILE: cli/src/lib/duration-derivation.ts
SPEC: specs/duration-integer-contract/spec.md
RISK: Low — single-line change per branch; Math.round(integer) === integer for existing tests.

TASKS (from tasks.md Phase 2 + deltas.md Domain A):
  • P1 (shooting-script) — wrap clamp() result:
      Before: const seconds = clamp(parsed, MIN_DURATION_S, MAX_DURATION_S);
      After:  const seconds = Math.round(clamp(parsed, MIN_DURATION_S, MAX_DURATION_S));
  • P2 (beat-sheet) — wrap clamp() result (drops redundant inner Math.round):
      Before: const seconds = clamp(Math.round(parsed), MIN_DURATION_S, MAX_DURATION_S);
      After:  const seconds = Math.round(clamp(parsed, MIN_DURATION_S, MAX_DURATION_S));
  • P3a (segmenter estimate) — PRIMARY BUG FIX:
      Before: const seconds = clamp(shot.segmenterEstimateS, MIN_DURATION_S, MAX_DURATION_S);
      After:  const seconds = Math.round(clamp(shot.segmenterEstimateS, MIN_DURATION_S, MAX_DURATION_S));
      // spec: filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2
  • P3b (action-density) — wrap clamp() result:
      Before: const seconds = clamp(rawEstimate, MIN_DURATION_S, MAX_DURATION_S);
      After:  const seconds = Math.round(clamp(rawEstimate, MIN_DURATION_S, MAX_DURATION_S));
  • P4 (fallback constant) — defensive consistency: Math.round(FALLBACK_DURATION_S)
  • Add spec reference comment to each changed line.
  • Verify clamp() helper is UNCHANGED (no signature or behavior changes).

INVARIANT (deltas.md Domain A):
  DurationResult.seconds MUST satisfy Number.isInteger(result.seconds) === true for any input,
  including IEEE 754 floating-point segmenter estimates.
  clamp() MUST NOT be modified — it remains general-purpose.

BRANCH TABLE (examples/01-duration-derivation-rounding.md):
  P1 shooting-script | parsed int   -> Math.round(clamp(int,3,60))   = int  (no-op)
  P2 beat-sheet      | parsed int   -> Math.round(clamp(int,3,60))   = int  (no-op)
  P3a segmenter      | 5.800000...  -> Math.round(clamp(5.8,3,60))   = 6    (FIX)
  P3b action-density | rawEstimate  -> Math.round(clamp(est,3,60))   = int  (defense)
  P4 fallback        | constant 5   -> Math.round(5) = 5              (no-op)

EXIT CONDITION (implementation.md Workstream 1):
  Number.isInteger(deriveDuration({ id:'1', segmenterEstimateS: 5.8 }).seconds) === true

AC LINKS: AC-1 (segmenterEstimateS 5.8 -> integer 6), AC-2 (5.800000000000001 -> integer 6)
"@

$ph2Id = New-BeadTask `
    -Title       "[fix-duration] Phase 2: Primary Fix - duration-derivation.ts Math.round(clamp()) DR-1" `
    -Description $ph2Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("fix-duration","phase-2","duration-derivation","DR-1","primary-fix","AC-1","AC-2")

Add-BeadLink -BlockedId $ph2Id -BlockerId $ph1Id



# ─── PHASE 3: Defensive Guard — video-controls.ts (DR-2) ──────────────────────

Write-Step "Phase 3: Defensive Guard - video-controls.ts (DR-2)"

$ph3Desc = @"
PHASE: Defensive Guard — video-controls.ts (DR-2) (Workstream 2 per implementation.md)
BLOCKED BY: Phase 2 (primary fix — duration-derivation.ts)
BLOCKS: Phase 6 (tests)

FILE: cli/src/lib/video-controls.ts
SPEC: specs/video-controls-guard/spec.md
RISK: Low — no-op for integer inputs already produced by Workstream 1 (Phase 2).

TASKS (from tasks.md Phase 3 + deltas.md Domain B):
  • In resolveVideoControls(), change duration field assignment:
      Before: duration: durationResult.seconds
      After:  duration: Math.round(durationResult.seconds)
      // secondary defense per filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2

RATIONALE (from design.md):
  VideoControls.duration is consumed by both the Markdown renderer and the batch serializer.
  Ensuring it is an integer here prevents any float from reaching downstream layers even if
  the derivation layer (DR-1) is bypassed in a future refactor.
  resolveVideoControls() is a public API; callers can pass arbitrary DurationResult objects.

INVARIANT (deltas.md Domain B):
  VideoControls.duration MUST always be a safe integer after resolveVideoControls() returns.

LAYER FLOW (examples/02-defense-in-depth-pipeline.md):
  duration-derivation.ts [DR-1] -> DurationResult.seconds = 6 (integer)
  video-controls.ts [DR-2]      -> VideoControls.duration = 6 (integer via Math.round)
  -> consumed by batch-serializer.ts [DR-3] and markdown-formatter.ts (display only)

EXIT CONDITION (implementation.md Workstream 2):
  Number.isInteger(resolveVideoControls({}, { seconds: 5.8, source:'action-density', notes:'' }).duration) === true

AC LINKS: AC-3 (resolveVideoControls float input -> integer controls.duration)
"@

$ph3Id = New-BeadTask `
    -Title       "[fix-duration] Phase 3: Defensive Guard - video-controls.ts Math.round() DR-2" `
    -Description $ph3Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("fix-duration","phase-3","video-controls","DR-2","defensive-guard","AC-3")

Add-BeadLink -BlockedId $ph3Id -BlockerId $ph2Id


# ─── PHASE 4: Serialization Guard — batch-serializer.ts (DR-3) ────────────────

Write-Step "Phase 4: Serialization Guard - batch-serializer.ts (DR-3)"

$ph4Desc = @"
PHASE: Serialization Guard — batch-serializer.ts (DR-3) (Workstream 3 per implementation.md)
BLOCKED BY: Phase 2 (primary fix — duration-derivation.ts)
BLOCKS: Phase 6 (tests)

FILE: cli/src/lib/batch-serializer.ts
SPEC: specs/batch-serializer-guard/spec.md
RISK: Low — no-op for integer inputs; prevents 422 even if upstream floats return.

TASKS (from tasks.md Phase 4 + deltas.md Domain C):
  • In shotToBatchItem(), change duration field in BatchItem:
      Before: duration: shot.controls.duration
      After:  duration: Math.round(shot.controls.duration)
      // last-line-of-defense per filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2

INVARIANT (deltas.md Domain C):
  The xAI POST /batch API MUST never receive a floating-point duration value.
  A float in this position produces a 422 deserialization error and aborts the entire batch.
  BatchItem.duration MUST be a safe integer at the serialization boundary.

ISOLATION TEST (tests/batch-serializer.test-plan.md [BS-DUR-3]):
  DR-3 must catch and round a float even if upstream layers (DR-1, DR-2) return a float directly.
  Simulate: controls: { duration: 5.800000000000001 }  // float bypasses DR-1 and DR-2
  Expected: shotToBatchItem(shot).duration === 6  AND  Number.isInteger === true

LAYER FLOW (examples/02-defense-in-depth-pipeline.md):
  video-controls.ts [DR-2] -> VideoControls.duration = 6 (integer)
  batch-serializer.ts [DR-3] -> BatchItem.duration = 6 (Math.round — last-line-of-defense)
  -> POST /batch payload -> xAI Grok API (expects i32 or string integer)

EXIT CONDITION (implementation.md Workstream 3):
  Number.isInteger(shotToBatchItem(shot).duration) === true for all shot fixtures

AC LINKS: AC-4 (shotToBatchItem integer for all fixtures including dialogue-heavy shots)
"@

$ph4Id = New-BeadTask `
    -Title       "[fix-duration] Phase 4: Serialization Guard - batch-serializer.ts Math.round() DR-3" `
    -Description $ph4Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("fix-duration","phase-4","batch-serializer","DR-3","last-line-of-defense","AC-4")

Add-BeadLink -BlockedId $ph4Id -BlockerId $ph2Id



# ─── PHASE 5: Formatter Guards — json-formatter.ts + jsonl-formatter.ts (DR-4) ─

Write-Step "Phase 5: Formatter Guards - json-formatter.ts + jsonl-formatter.ts (DR-4)"

$ph5Desc = @"
PHASE: Formatter Guards — json-formatter.ts + jsonl-formatter.ts (DR-4) (Workstream 4)
BLOCKED BY: Phase 2 (primary fix — duration-derivation.ts)
BLOCKS: Phase 6 (tests)

FILES: cli/src/commands/generate-shot-list/formatter/json-formatter.ts
       cli/src/commands/generate-shot-list/formatter/jsonl-formatter.ts
SPEC: specs/formatter-integer-contract/spec.md
RISK: Low — no-op for integer inputs; only changes duration.seconds, not duration.formatted.

TASKS (from tasks.md Phase 5 + deltas.md Domain D):
  • In json-formatter.ts formatShot(): change duration.seconds field:
      Before: seconds: shot.duration,
      After:  seconds: Math.round(shot.duration),  // spec: batch-shot-list-spec.md v1.0.0 §2
  • In jsonl-formatter.ts formatShot(): identical change:
      Before: seconds: shot.duration,
      After:  seconds: Math.round(shot.duration),  // spec: batch-shot-list-spec.md v1.0.0 §2
  • Verify in BOTH files: duration.formatted line is UNCHANGED:
      formatted: this.formatTime(shot.duration)  // pre-round value — human display only; NOT API-facing
  • Verify markdown-formatter.ts is NOT modified (emits duration as display string; not API-facing).

INVARIANT (deltas.md Domain D):
  duration.formatted uses the original (pre-round) value from formatTime() — intentional.
  The formatted string (e.g., "0:06") is human-readable display only, NOT sent to the xAI API.
  Only duration.seconds is API-facing via ai-powered ingest.

JSONL COMPARISON (examples/02-defense-in-depth-pipeline.md):
  Before: {"duration":{"seconds":5.800000000000001,"formatted":"0:05"},...}  <- float bug
  After:  {"duration":{"seconds":6,"formatted":"0:05"},...}                  <- integer fixed

EXIT CONDITION (implementation.md Workstream 4):
  JSONL and JSON output files contain integer duration.seconds values for all shots.

AC LINKS: AC-5 (--format jsonl every duration.seconds is whole number),
          AC-6 (--format json every shots[n].duration.seconds is whole number)
"@

$ph5Id = New-BeadTask `
    -Title       "[fix-duration] Phase 5: Formatter Guards - json-formatter + jsonl-formatter Math.round() DR-4" `
    -Description $ph5Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("fix-duration","phase-5","json-formatter","jsonl-formatter","DR-4","formatter-guard","AC-5","AC-6")

Add-BeadLink -BlockedId $ph5Id -BlockerId $ph2Id


# ─── PHASE 6: Tests ───────────────────────────────────────────────────────────

Write-Step "Phase 6: Tests"

$ph6Desc = @"
PHASE: Tests (Workstream 5 per implementation.md)
BLOCKED BY: Phase 2 (DR-1), Phase 3 (DR-2), Phase 4 (DR-3), Phase 5 (DR-4)
BLOCKS: Phase 7 (acceptance verification)

FILES: cli/src/__tests__/duration-derivation.test.ts
       cli/src/__tests__/video-controls.test.ts
       cli/src/__tests__/batch-serializer.test.ts
SPEC REFS: tests/duration-derivation.test-plan.md, tests/video-controls.test-plan.md,
           tests/batch-serializer.test-plan.md

TASKS — duration-derivation.test.ts (from tasks.md Phase 6 + test-plan):
  • [UT-DD-INT-1] segmenterEstimateS: 5.8 -> seconds === 6, Number.isInteger === true
      describe block: 'deriveDuration() — P3a segmenter estimate always returns integer seconds'
  • [UT-DD-INT-2] segmenterEstimateS: 5.800000000000001 -> seconds === 6, integer
      This is the EXACT bug scenario from the xAI 422 error.
  • [UT-DD-INT-3] segmenterEstimateS: 14.4 (36 words x 0.4) -> seconds === 14, integer
  • [UT-DD-INT-4] all five priority branches (P1-P4 + fallback) return integer seconds:
      P1: deriveDuration({ id:'a', shootingScriptDuration: '0:30' })
      P2: deriveDuration({ id:'b', beatSheetCue: '0:45' })
      P3a: deriveDuration({ id:'c', segmenterEstimateS: 5.800000000000001 })
      P3b: deriveDuration({ id:'d', actionLines: ['line 1', 'line 2'] })
      P4: deriveDuration({ id:'e' })  // fallback

TASKS — video-controls.test.ts (from tasks.md Phase 6 + test-plan):
  • [IT-VC-1b] DR-2 isolation test: DurationResult.seconds = 5.800000000000001 (raw float,
      simulating pre-fix DR-1) -> controls.duration === 6, Number.isInteger === true
  • [IT-VC-2b] full round-trip: segmenter float -> deriveDuration -> resolveVideoControls -> 6 (integer)

TASKS — batch-serializer.test.ts (from tasks.md Phase 6 + test-plan):
  • [BS-DUR-1] dialogue-heavy shot via full pipeline -> item.duration === 6, integer
  • [BS-DUR-2] serializeBatch with mixed shot types (P1, P3a, P3b) -> all item.duration integers
  • [BS-DUR-3] DR-3 isolation: controls.duration = 5.800000000000001 (bypasses DR-1+DR-2) -> 6, integer

REGRESSION REQUIREMENT:
  Run all existing tests; confirm zero regressions. Math.round(integer) === integer is a no-op
  for all existing fixtures which use integer-valued durations.

TEST ORDER (implementation.md Workstream 5):
  1. duration-derivation.test.ts (UT-DD-INT-1..4)
  2. video-controls.test.ts (IT-VC-1b, IT-VC-2b)
  3. batch-serializer.test.ts (BS-DUR-1..3)
  4. Run npm test — verify all new AND existing tests pass.

AC LINKS: AC-7 (all existing tests pass without modification), AC-8 (all new tests pass)
"@

$ph6Id = New-BeadTask `
    -Title       "[fix-duration] Phase 6: Tests - UT-DD-INT-1..4, IT-VC-1b, BS-DUR-1..3" `
    -Description $ph6Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("fix-duration","phase-6","tests","unit-tests","regression","AC-7","AC-8")

Add-BeadLink -BlockedId $ph6Id -BlockerId $ph2Id
Add-BeadLink -BlockedId $ph6Id -BlockerId $ph3Id
Add-BeadLink -BlockedId $ph6Id -BlockerId $ph4Id
Add-BeadLink -BlockedId $ph6Id -BlockerId $ph5Id



# ─── PHASE 7: Acceptance Verification ─────────────────────────────────────────

Write-Step "Phase 7: Acceptance Verification"

$ph7Desc = @"
PHASE: Acceptance Verification (tasks.md Phase 7)
BLOCKED BY: Phase 6 (all tests pass)

TASKS — verify all 8 acceptance criteria from proposal.md + summary.md:
  • AC-1: Number.isInteger(deriveDuration({ id:'1', segmenterEstimateS: 5.8 }).seconds) -> true
  • AC-2: Number.isInteger(deriveDuration({ id:'2', segmenterEstimateS: 5.800000000000001 }).seconds) -> true, value === 6
  • AC-3: Number.isInteger(resolveVideoControls({}, { seconds: 5.8, source:'action-density', notes:'' }).duration) -> true
  • AC-4: Number.isInteger(shotToBatchItem(shot).duration) -> true for all fixtures (including dialogue-heavy)
  • AC-5: filmbuff generate-shot-list --format jsonl -> every duration.seconds is a whole number
  • AC-6: filmbuff generate-shot-list --format json -> every shots[n].duration.seconds is a whole number
  • AC-7: All existing tests pass without modification (no regression)
  • AC-8: All new tests [UT-DD-INT-1..4], [IT-VC-1b], [BS-DUR-1..3] pass

FINAL CHECKS (from implementation.md exit conditions):
  • PR reviewed and approved; CI green
  • Reference 'batch-shot-list-spec.md v1.0.0 §2' in all new code comments
  • Confirm ai-powered companion PR (FB-DUR-2) is linked and ready in same merge window
  • Confirm filmbuff PR and ai-powered PR land together — neither merges without the other passing CI

PIPELINE VERIFICATION (summary.md Key Outcomes):
  deriveDuration({ id:'1', segmenterEstimateS: 5.8 }).seconds === 6 (integer)
  resolveVideoControls({}, { seconds: 5.8, ... }).duration === 6 (integer)
  shotToBatchItem(shot).duration === 6 (integer) for all dialogue-heavy shots
  generate-shot-list --format jsonl: every duration.seconds is integer
  generate-shot-list --format json: every shots[n].duration.seconds is integer
  All 18 shots in a batch succeed — no more 422 on Shot 2

BEFORE/AFTER PAYLOAD (examples/02-defense-in-depth-pipeline.md):
  BEFORE (bug): { "duration": 5.800000000000001 }  -> 422 from xAI
  AFTER (fix):  { "duration": 6 }                  -> accepted by xAI Grok API
"@

$ph7Id = New-BeadTask `
    -Title       "[fix-duration] Phase 7: Acceptance Verification - AC-1 through AC-8" `
    -Description $ph7Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("fix-duration","phase-7","acceptance-verification","AC-1","AC-2","AC-3","AC-4","AC-5","AC-6","AC-7","AC-8")

Add-BeadLink -BlockedId $ph7Id -BlockerId $ph6Id


# ─── SUMMARY ──────────────────────────────────────────────────────────────────

Write-Step "Task creation complete"
Write-Host ""
Write-Host "  Epic:    $epicId" -ForegroundColor Yellow
Write-Host "  Phase 1: $ph1Id" -ForegroundColor White
Write-Host "  Phase 2: $ph2Id" -ForegroundColor White
Write-Host "  Phase 3: $ph3Id" -ForegroundColor White
Write-Host "  Phase 4: $ph4Id" -ForegroundColor White
Write-Host "  Phase 5: $ph5Id" -ForegroundColor White
Write-Host "  Phase 6: $ph6Id" -ForegroundColor White
Write-Host "  Phase 7: $ph7Id" -ForegroundColor White
Write-Host ""

if (-not $DryRun) {
    Write-Host "Querying created tasks..." -ForegroundColor Cyan
    & $queryScript list -Status open -Limit 20
}

Write-Host "`n✅ Done. Run '.\beads-query-fix-duration.ps1' to verify." -ForegroundColor Green
