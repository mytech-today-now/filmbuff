<#
.SYNOPSIS
    Generate beads tasks for the filmbuff-prompt-JIRA OpenSpec change.

.DESCRIPTION
    Creates the full task hierarchy for:
      filmbuff-prompt-JIRA — Video Controls + Multi-Image I2V for generate-shot-list (Step 9)
    Source: openspec/changes/filmbuff-prompt-JIRA/
    JIRA:   FB-SHOT-9

    Uses .beads/bd-write.ps1 (write) and .beads/bd-query.ps1 (query).

.EXAMPLE
    .\beads-helpers.ps1
    .\beads-helpers.ps1 -DryRun     # Print tasks without writing

.NOTES
    Author: Augment Agent
    Change: filmbuff-prompt-JIRA
#>

param(
    [switch]$DryRun,
    [switch]$Verbose
)

$ErrorActionPreference = 'Stop'
$repoRoot   = $PSScriptRoot
$writeScript = Join-Path $repoRoot ".beads\bd-write.ps1"
$queryScript = Join-Path $repoRoot ".beads\bd-query.ps1"
$changeDir   = Join-Path $repoRoot "openspec\changes\filmbuff-prompt-JIRA"

Write-Host "`n📋 filmbuff-prompt-JIRA Task Generator" -ForegroundColor Cyan
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

    # Build splatted argument hashtable to avoid array expansion issues
    $params = @{
        Command          = 'create'
        IssueIdOrTitle   = $Title
        Description      = $Description
        Priority         = $Priority
        IssueType        = $Type
        Json             = $true
    }
    if ($Labels.Count -gt 0) {
        $params['Labels'] = $Labels
    }

    $result = & $writeScript @params
    $issue = $result | ConvertFrom-Json
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
Source JIRA: FB-SHOT-9 | Change ID: filmbuff-prompt-JIRA | Priority: High | Story Points: 13

PROBLEM: generate-shot-list (Step 9) produces shot entries with no machine-readable video-control
parameters. Downstream POST /batch calls require five structured fields per shot: duration,
aspectRatio, resolution, quality, fps. Without them, every video-generation call must be manually
configured. Additionally, multi-image I2V references cannot be seeded without a symbolic references layer.

SOLUTION — five spec deltas:
  1. Video Controls Block — table immediately after shot heading, before Scene
  2. Duration Derivation — 4-priority chain: shooting-script M:SS, beat-sheet cue, action-density, hard clamp [3,60]
  3. Batch Payload — POST /batch JSON with filmbuff.config.json provider registry; --batch-output flag
  4. References and I2V — top-level references map, per-shot references[] arrays, per-shot provider overrides
  5. Pre-Export Validation — V-1 through V-6; blocking errors halt export; V-3 skipped in CI/offline

ACCEPTANCE CRITERIA (AC-1 through AC-16): see openspec/changes/filmbuff-prompt-JIRA/summary.md
AFFECTED FILES: cli/src/commands/generate-shot-list.ts, cli/src/lib/{video-controls,duration-derivation,
batch-serializer,filmbuff-config,pipeline-inputs,references-manager,provider-override,pre-export-validator}.ts,
cli/src/lib/parsers/{shooting-script,beat-sheet}.ts, filmbuff.config.json, tests/fixtures/*
SPEC REFS: openspec/changes/filmbuff-prompt-JIRA/specs/ (5 spec files)
NON-GOALS: ai-powered internals, UI dropdown wiring, non-video providers in Video Controls output
"@

$epicId = New-BeadTask `
    -Title       "[FB-SHOT-9] filmbuff-prompt-JIRA: Video Controls + Multi-Image I2V for generate-shot-list" `
    -Description $epicDesc `
    -Priority    1 `
    -Type        "epic" `
    -Labels      @("filmbuff-prompt-JIRA","FB-SHOT-9","video-controls","i2v","shot-list")

# ─── PHASE 2: Config and Input Foundation ─────────────────────────────────────

Write-Step "Phase 2: Config and Input Foundation"

$ph2Desc = @"
PHASE: Config and Input Foundation (Workstream 1 per implementation.md)
BLOCKS: Phase 3 (multi-document input ingestion)

TASKS (from tasks.md Phase 2):
  • Create filmbuff.config.json in repo root — entries for lumaai, xai, venice, mock, openai, anthropic
  • Add config loader to generate-shot-list startup: read videoProviders, defaultProvider, defaultModel
  • Implement fetchProviderCapabilities() to call GET /providers; fall back to static table on failure
  • Implement graceful fallback when filmbuff.config.json is absent (returns default lumaai/ray-2)
  • Add --provider <id>, --model <id>, --offline CLI flags (CLI precedence over config file)

IMPLEMENTATION FILES (implementation.md Workstream 1):
  cli/src/lib/filmbuff-config.ts — loadFilmbuffConfig(), resolveProvider(), fetchProviderCapabilities()
  cli/src/commands/generate-shot-list.ts — add flag parser entries

PROVIDER TABLE (deltas.md Domain C):
  lumaai=LUMAAI_API_KEY, video, maxI2V=2 | xai=XAI_API_KEY, video, maxI2V=1
  venice=VENICE_API_KEY, video, maxI2V=1  | mock=(none), video, maxI2V=-1(unlimited)
  openai=OPENAI_API_KEY, video=NO         | anthropic=ANTHROPIC_API_KEY, video=NO

AC LINKS: AC-8 (--provider mock), AC-16 (provider table marks xai/venice as video-capable)
"@

$ph2Id = New-BeadTask `
    -Title       "[filmbuff-prompt-JIRA] Phase 2: Config and Input Foundation" `
    -Description $ph2Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmbuff-prompt-JIRA","phase-2","config","provider")

Add-BeadLink -BlockedId $ph2Id -BlockerId $epicId


# ─── PHASE 3: Multi-Document Input Ingestion ──────────────────────────────────

Write-Step "Phase 3: Multi-Document Input Ingestion"

$ph3Desc = @"
PHASE: Multi-Document Input Ingestion (Workstream 2 per implementation.md)
BLOCKED BY: Phase 2 (config and provider foundation)
BLOCKS: Phase 4 (duration derivation logic)

TASKS (from tasks.md Phase 3):
  • Extend generate-shot-list to accept optional pipeline artifact files alongside --input
  • Implement graceful degradation when optional documents are absent (null, not error)
  • Parse Duration | M:SS rows from shooting-script.txt using /^(\d+):(\d{2})$/
  • Parse timing annotations from beat-sheet.txt for parent scene fallback

IMPLEMENTATION FILES (implementation.md Workstream 2):
  cli/src/lib/pipeline-inputs.ts
    loadPipelineInputs(projectDir, fountainPath) — returns PipelineInputs (null for absent docs)
  cli/src/lib/parsers/shooting-script.ts
    parseShootingScript(text) — builds Map<shotId, DurationSeconds>
  cli/src/lib/parsers/beat-sheet.ts
    parseBeatSheet(text) — builds Map<sceneId, TimingCue>

ARTIFACT TABLE (deltas.md Domain B):
  <project>.fountain  | Step 4 | Primary shot structure (REQUIRED)
  shooting-script.txt | Step 8 | Per-shot scripted durations  — M:SS parsing
  beat-sheet.txt      | Step 2 | Scene-level pacing cues
  treatment.txt       | Step 3 | Tone and framing intent
  script-breakdown.txt| Step 5 | Character descriptions
  logline.txt         | Step 1 | Project context

All documents except fountain are optional — absent docs produce null, never an error.
UNIT TESTS: parser present/absent/malformed input coverage
"@

$ph3Id = New-BeadTask `
    -Title       "[filmbuff-prompt-JIRA] Phase 3: Multi-Document Input Ingestion" `
    -Description $ph3Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmbuff-prompt-JIRA","phase-3","input-ingestion","parsers")

Add-BeadLink -BlockedId $ph3Id -BlockerId $ph2Id

# ─── PHASE 4: Duration Derivation Logic ───────────────────────────────────────

Write-Step "Phase 4: Duration Derivation Logic"

$ph4Desc = @"
PHASE: Duration Derivation Logic (Workstream 3 per implementation.md)
BLOCKED BY: Phase 3 (multi-document input ingestion)
BLOCKS: Phase 5 (video controls output + references)

TASKS (from tasks.md Phase 4):
  • Implement deriveDuration(shot, inputs) with four-priority chain
  • Priority 1: shooting-script explicit duration — parse M:SS, convert to seconds
  • Priority 2: beat-sheet timing cue fallback
  • Priority 3: action-density estimation — 5s base + 2s per additional line, cap at 30s
  • Priority 4: hard clamp to [3, 60], round to nearest whole second (always applied last)
  • Populate Notes column with correct derivation source string
  • Achieve >= 90% branch coverage in unit tests (UT-DD-1 through UT-DD-13)

IMPLEMENTATION FILE: cli/src/lib/duration-derivation.ts
  deriveDuration(shot, inputs)         — runs four-priority chain; returns { seconds, notes }
  parseMMSS(str)                       — returns seconds | null for valid M:SS; null for malformed
  estimateFromActionDensity(lines)     — 5 + (n-1)*2, capped at 30
  clamp(value, min, max)               — always applied after all derivation methods

DESIGN INVARIANT (from design.md + summary.md):
  Duration is NEVER "Default". The four-priority chain guarantees a concrete value.
  If scripted timing unavailable, estimation fires. Out-of-range results are clamped.
  "Default" MUST NEVER appear in the Duration (s) row.

NOTES COLUMN VALUES (from deltas.md Domain B):
  "Derived from shot duration M:SS"  — when shooting-script source
  "Estimated from action density"    — when estimation fallback

TEST PLAN: tests/duration-derivation.test-plan.md
  UT-DD-1: 0:12 → 12s | UT-DD-2: 1:05 → 60s (clamped) | UT-DD-3: 1:00 → 60s
  UT-DD-4: 0:02 → 3s (clamped min) | UT-DD-5: 1:5 (invalid) → fallthrough
  UT-DD-6: abc (invalid) → fallthrough | UT-DD-7: beat-sheet fallback
  UT-DD-8: 1 action line → 5s | UT-DD-9: 3 lines → 9s | UT-DD-10: 14 lines → 30s (cap)
  UT-DD-11: >60 → 60 | UT-DD-12: <3 → 3 | UT-DD-13: never "Default"

AC LINKS: AC-2 (duration always integer [3,60]), AC-3 (M:SS converted), AC-4 (estimation), AC-9 (>=90% coverage)
"@

$ph4Id = New-BeadTask `
    -Title       "[filmbuff-prompt-JIRA] Phase 4: Duration Derivation Logic" `
    -Description $ph4Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmbuff-prompt-JIRA","phase-4","duration-derivation","AC-2","AC-3","AC-4")

Add-BeadLink -BlockedId $ph4Id -BlockerId $ph3Id

# ─── PHASE 5: Video Controls Block Output + References Section ─────────────────

Write-Step "Phase 5: Video Controls Block Output + References Section"

$ph5Desc = @"
PHASE: Video Controls Block Output + References Section (Workstream 4 per implementation.md)
BLOCKED BY: Phase 4 (duration derivation logic)
BLOCKS: Phase 6 (pre-export validation), Phase 7 (batch payload)

TASKS (from tasks.md Phase 5):
  • Implement resolveVideoControls(shot, pipelineContext) — returns typed VideoControls object
  • Render Video Controls Markdown table IMMEDIATELY AFTER the shot heading (before Scene)
  • Apply non-Default override rules for Aspect Ratio, Resolution, Quality, FPS
  • Implement resolveReferences(project) — build document-level references map from character + scene images
  • Implement pruneUnusedKeys(map, shots) — remove keys not referenced by any shot
  • Emit ## References section at top of shot-list.md when reference images exist
  • Emit **References:** key1, key2 per shot (after shot heading, before Video Controls table)
  • Verify all nine pre-existing shot fields are preserved unmodified in their original order
  • Implement resolveProviderOverride(shot, envelopeProvider, capabilityTable) — smart-default logic
  • Surface amber auto-suggestion indicator for dual-keyframe shots (2 references, non-lumaai envelope)

IMPLEMENTATION FILES (implementation.md Workstream 4):
  cli/src/lib/video-controls.ts         — resolveVideoControls(), renderVideoControlsTable(), applyOverrideRules()
  cli/src/lib/references-manager.ts     — resolveReferences(), pruneUnusedKeys(), renderReferencesSection()
  cli/src/lib/provider-override.ts      — resolveProviderOverride()
  cli/src/commands/generate-shot-list.ts — output renderer (emit References section + per-shot blocks)

VIDEO CONTROLS INTERFACE (from design.md):
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9"
  resolution?:  "720p" | "1080p" | "4k"
  quality?:     "draft" | "standard" | "high"
  duration:     number (always present, concrete, [3,60])
  fps?:         24 | 30 | 60
  undefined fields → "Default" in Markdown; omitted from JSON payload

NON-DEFAULT OVERRIDE TRIGGERS (deltas.md Domain A):
  Aspect Ratio: portrait/widescreen/square framing in script description
  Resolution: production brief specifies delivery format
  Quality: hero/title shots → "high"; animatic → "draft"
  FPS: production brief specifies frame rate

FIELD PRESERVATION (9 existing fields, unmodified, in order):
  Scene, Set, Description, Characters, Actions, Dialogue, Blocking, SFX, Technical Details

DUAL-KEYFRAME SMART DEFAULT:
  If shot has 2+ references AND envelope provider != lumaai → suggest lumaai/ray-2; amber UI indicator

TEST PLANS: tests/video-controls.test-plan.md + tests/references-i2v.test-plan.md
  UT-VC-1 through UT-VC-8 | UT-REF-1 through UT-REF-6

AC LINKS: AC-1 (Video Controls table placement), AC-5 (non-duration defaults), AC-6 (field preservation),
          AC-11 (references map in batch), AC-12 (symbolic keys), AC-13 (dual-keyframe lumaai override)
"@

$ph5Id = New-BeadTask `
    -Title       "[filmbuff-prompt-JIRA] Phase 5: Video Controls Block Output + References Section" `
    -Description $ph5Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmbuff-prompt-JIRA","phase-5","video-controls","references","i2v")

Add-BeadLink -BlockedId $ph5Id -BlockerId $ph4Id


# ─── PHASE 6: Pre-Export Validation ──────────────────────────────────────────

Write-Step "Phase 6: Pre-Export Validation"

$ph6Desc = @"
PHASE: Pre-Export Validation (Workstream 5 per implementation.md)
BLOCKED BY: Phase 5 (video controls output + references section)
BLOCKS: Phase 7 (batch payload serialization), Phase 8 (testing)

TASKS (from tasks.md Phase 6):
  • Implement validateBatchPayload(payload, config, options) running V-1 through V-6
  • V-1: Every per-shot references[] key exists in the document-level references map (BLOCKING)
  • V-2: Every URL in references map is a valid absolute HTTPS URL or data URI (BLOCKING)
  • V-3: URL reachability — HTTP HEAD, 5s timeout; SKIP when --offline or CI=true; NON-BLOCKING with mock
  • V-4: Every per-shot provider override is in filmbuff.config.json (BLOCKING)
  • V-5: Every per-shot model override belongs to the specified provider's models array (BLOCKING)
  • V-6: WARN (non-blocking) when shot has >1 reference and provider supports only 1 image
  • Wire validator into generate-shot-list immediately BEFORE payload write
  • Achieve >= 90% branch coverage in validator unit tests

IMPLEMENTATION FILE: cli/src/lib/pre-export-validator.ts
  validateBatchPayload(payload, config, options) — runs V-1 through V-6 in order
  Returns: { errors: ValidationError[], warnings: ValidationWarning[] }
  Export HALTED if errors.length > 0. Warnings shown but do not halt export.
  V-3 timeout: 5s per URL; parallelized; skipped when options.offline or CI=true
  V-3 non-blocking when options.provider === "mock"

VALIDATION RULES SUMMARY (deltas.md Domain E):
  V-1 | Ref key exists in document map       | BLOCKING
  V-2 | URL format valid (HTTPS or data:)    | BLOCKING
  V-3 | URL reachable (HTTP HEAD, 5s)        | BLOCKING (skipped offline/CI; warning with mock)
  V-4 | Provider override in config          | BLOCKING
  V-5 | Model override valid for provider    | BLOCKING
  V-6 | Multi-ref shot on single-frame provider | NON-BLOCKING warning

TEST PLAN: tests/pre-export-validation.test-plan.md
  UT-VAL-1 through UT-VAL-12; IT-VAL-1 through IT-VAL-3

AC LINKS: AC-14 (validation halts V1-V5), AC-15 (--offline skips V-3), AC-8 (mock makes V-3 non-blocking)
"@

$ph6Id = New-BeadTask `
    -Title       "[filmbuff-prompt-JIRA] Phase 6: Pre-Export Validation (V-1 through V-6)" `
    -Description $ph6Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmbuff-prompt-JIRA","phase-6","validation","AC-14","AC-15")

Add-BeadLink -BlockedId $ph6Id -BlockerId $ph5Id

# ─── PHASE 7: Batch Payload Serialization ─────────────────────────────────────

Write-Step "Phase 7: Batch Payload Serialization"

$ph7Desc = @"
PHASE: Batch Payload Serialization (Workstream 6 per implementation.md)
BLOCKED BY: Phase 6 (pre-export validation must be implemented before wiring serializer)
BLOCKS: Phase 8 (testing)

TASKS (from tasks.md Phase 7):
  • Implement serializeBatchPayload(shots, envelope, referencesMap) function
  • Set provider and model once at envelope level (top-level POST /batch fields)
  • Include top-level references map when non-empty; OMIT ENTIRELY when no shots reference images
  • Include per-shot references arrays (symbolic keys, NOT raw URLs)
  • Include per-shot provider and model overrides ONLY when non-default
  • Omit all "Default" fields from item objects (no nulls, no "Default" strings in JSON)
  • Assert apiKey is NEVER serialized into the output (security invariant)
  • Add --batch-output <file> flag to generate-shot-list
  • JSONL format: emit references map on first line with _type: "references" sentinel field

IMPLEMENTATION FILE: cli/src/lib/batch-serializer.ts
COMMAND FILE: cli/src/commands/generate-shot-list.ts (add --batch-output, --offline flags)

EXPECTED BATCH JSON STRUCTURE (from deltas.md Domain C):
  {
    "provider": "<user-selected id>",
    "model":    "<user-selected model id>",
    "references": {
      "sarah":        "https://cdn.example.com/cast/sarah-frame0.jpg",
      "lake-sunrise": "https://cdn.example.com/scenes/lake-dawn.jpg"
    },
    "items": [
      {
        "modality": "video",
        "name":     "shot-01",
        "prompt":   "<shot description>",
        "duration": 12,
        "references": ["sarah"],
        "provider": "lumaai"   // only when non-default
      }
    ]
  }

SECURITY INVARIANT: apiKey MUST NEVER appear in batch.json or any output file.
DEFAULT FIELD RULE: Fields with "Default" value are OMITTED entirely — never emitted as null.
SYMBOLIC KEYS RULE: Per-shot references[] carry symbolic keys (e.g., "sarah"), NOT raw URLs.

TEST PLAN: integration tests IT-VC-3, IT-VC-4, IT-REF-1, IT-REF-2
CI STEP: generate-shot-list --provider mock --offline --batch-output batch.json; assert exit 0

AC LINKS: AC-7 (valid POST /batch; apiKey absent; Default fields omitted), AC-8 (mock provider CI),
          AC-11 (top-level references map), AC-12 (symbolic keys in items[].references)
"@

$ph7Id = New-BeadTask `
    -Title       "[filmbuff-prompt-JIRA] Phase 7: Batch Payload Serialization (POST /batch)" `
    -Description $ph7Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmbuff-prompt-JIRA","phase-7","batch-payload","serializer","AC-7","AC-11")

Add-BeadLink -BlockedId $ph7Id -BlockerId $ph6Id


# ─── PHASE 8: Testing ─────────────────────────────────────────────────────────

Write-Step "Phase 8: Testing"

$ph8Desc = @"
PHASE: Testing (from tasks.md Phase 8)
BLOCKED BY: Phase 5 (video controls + references), Phase 6 (validation), Phase 7 (batch serializer)
BLOCKS: Phase 9 (CI and documentation)

TASKS (from tasks.md Phase 8):
  • Write unit tests for all duration derivation branches (UT-DD-1 through UT-DD-13)
      File: cli/src/__tests__/duration-derivation.test.ts
      Coverage: >= 90% branch coverage on duration-derivation.ts
  • Write unit tests for all Video Controls scenarios (UT-VC-1 through UT-VC-8)
      File: cli/src/__tests__/video-controls.test.ts
  • Write unit tests for all references/I2V scenarios (UT-REF-1 through UT-REF-6)
      File: cli/src/__tests__/references.test.ts
  • Write unit tests for all pre-export validation scenarios (UT-VAL-1 through UT-VAL-12)
      File: cli/src/__tests__/pre-export-validator.test.ts
      Coverage: >= 90% branch coverage on pre-export-validator.ts
  • Commit golden Fountain fixture to cli/src/__tests__/fixtures/test-film.fountain
  • Integration/snapshot test IT-VC-1 — assert clean diff against golden fixture
  • Integration test IT-VC-2 — field preservation (all 9 fields present, unmodified, in order)
  • Integration test IT-VC-3 + IT-REF-1 — batch output with top-level references map
  • Integration test IT-REF-2 — JSONL format with _type:references sentinel on line 1
  • Verify >= 90% branch coverage on duration-derivation.ts and pre-export-validator.ts
  • Verify amber auto-suggestion for dual-keyframe shots (E2E or integration test)

TEST PLANS (from tests/ directory):
  tests/video-controls.test-plan.md        — UT-VC-1..8, IT-VC-1..4
  tests/duration-derivation.test-plan.md   — UT-DD-1..13, IT-DD-1..3
  tests/references-i2v.test-plan.md        — UT-REF-1..6, IT-REF-1..2
  tests/pre-export-validation.test-plan.md — UT-VAL-1..12, IT-VAL-1..3

FIXTURES:
  cli/src/__tests__/fixtures/test-film.fountain         (golden Fountain fixture — COMMIT to repo)
  cli/src/__tests__/fixtures/test-film-shot-list.md.snap (snapshot for IT-VC-1)

AC LINKS: AC-9 (duration >= 90% coverage), AC-10 (snapshot test), AC-13 (dual-keyframe amber)
"@

$ph8Id = New-BeadTask `
    -Title       "[filmbuff-prompt-JIRA] Phase 8: Testing (Unit + Integration + Snapshot)" `
    -Description $ph8Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmbuff-prompt-JIRA","phase-8","testing","unit-tests","integration-tests","AC-9","AC-10")

Add-BeadLink -BlockedId $ph8Id -BlockerId $ph5Id
Add-BeadLink -BlockedId $ph8Id -BlockerId $ph6Id
Add-BeadLink -BlockedId $ph8Id -BlockerId $ph7Id

# ─── PHASE 9: CI and Documentation ────────────────────────────────────────────

Write-Step "Phase 9: CI and Documentation"

$ph9Desc = @"
PHASE: CI and Documentation (from tasks.md Phase 9)
BLOCKED BY: Phase 8 (all tests pass)

TASKS (from tasks.md Phase 9):
  • Add CI step: run generate-shot-list --provider mock against Fountain fixture; assert exit 0
  • Assert Video Controls present in CI output and ## References section when applicable
  • Verify filmbuff.config.json committed to repo with all provider entries (lumaai, xai, venice, mock, openai, anthropic)
  • Confirm all AC-1 through AC-16 pass (from openspec/changes/filmbuff-prompt-JIRA/summary.md)
  • Confirm ai-powered PR is linked and ready to land in same merge window
  • PR reviewed and approved; CI green

CI COMMAND (from implementation.md Workstream 6):
  filmbuff generate-shot-list --input test-film.fountain --provider mock --offline --batch-output batch.json
  Assert: exit code 0; Video Controls in every shot; ## References section present; batch.json valid JSON

CROSS-REPO REQUIREMENT (from proposal.md Risks):
  ai-powered PR and filmbuff PR MUST land together in the same merge window.
  Neither merges without the other passing CI.

ACCEPTANCE CHECKLIST (from summary.md — ALL must pass before PR merge):
  AC-1:  Every shot has Video Controls table immediately after shot heading, before Scene
  AC-2:  Duration (s) always a whole integer in [3, 60]; never "Default"
  AC-3:  Shooting-script M:SS correctly converted; Notes reads: Derived from shot duration M:SS
  AC-4:  Action-density estimation fires as fallback; Notes reads: Estimated from action density
  AC-5:  Non-duration fields default to "Default" unless script explicitly justifies override
  AC-6:  All nine pre-existing shot fields preserved, unmodified, in original order
  AC-7:  --batch-output emits valid POST /batch payload; apiKey absent; Default fields omitted
  AC-8:  --provider mock produces valid batch payload without API key; exit code 0
  AC-9:  Unit tests cover all duration derivation branches with >= 90% branch coverage
  AC-10: Integration/snapshot test asserts correct output against committed Fountain fixture
  AC-11: --batch-output payload includes top-level references map with only referenced keys
  AC-12: Each shot item carries references array of symbolic keys, not raw URLs
  AC-13: Dual-keyframe shots (2 references) with non-lumaai envelope emit lumaai/ray-2 overrides + amber indicator
  AC-14: Pre-export validation halts export for V-1 through V-5 violations with human-readable errors
  AC-15: --offline (or CI=true) skips V-3; all other rules (V-1, V-2, V-4, V-5) still apply
  AC-16: Provider table marks xai and venice as video-capable (Max I2V=1); openai/anthropic unsupported
"@

$ph9Id = New-BeadTask `
    -Title       "[filmbuff-prompt-JIRA] Phase 9: CI and Documentation (AC-1 through AC-16)" `
    -Description $ph9Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmbuff-prompt-JIRA","phase-9","ci","documentation","acceptance-criteria")

Add-BeadLink -BlockedId $ph9Id -BlockerId $ph8Id

# ─── SUMMARY ──────────────────────────────────────────────────────────────────

Write-Step "Task creation complete"
Write-Host ""
Write-Host "  Epic:    $epicId" -ForegroundColor Yellow
Write-Host "  Phase 2: $ph2Id" -ForegroundColor White
Write-Host "  Phase 3: $ph3Id" -ForegroundColor White
Write-Host "  Phase 4: $ph4Id" -ForegroundColor White
Write-Host "  Phase 5: $ph5Id" -ForegroundColor White
Write-Host "  Phase 6: $ph6Id" -ForegroundColor White
Write-Host "  Phase 7: $ph7Id" -ForegroundColor White
Write-Host "  Phase 8: $ph8Id" -ForegroundColor White
Write-Host "  Phase 9: $ph9Id" -ForegroundColor White
Write-Host ""

if (-not $DryRun) {
    Write-Host "Querying created tasks..." -ForegroundColor Cyan
    & $queryScript list -Status open -Limit 20
}

Write-Host "`n✅ Done. Run '& `"$queryScript`" search filmbuff-prompt-JIRA' to verify." -ForegroundColor Green
