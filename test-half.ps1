<#
.SYNOPSIS
    Generate beads tasks for the filmb-ai-p OpenSpec change.

.DESCRIPTION
    Creates the full task hierarchy for:
      filmb-ai-p — Per-Shot Video Generation Control for filmbuff CLI
    Source: openspec/changes/filmb-ai-p/
    JIRA:   FB-0042

    Uses .beads/bd-write.ps1 (write) and .beads/bd-query.ps1 (query).

.EXAMPLE
    .\beads-helpers-filmb-ai-p.ps1
    .\beads-helpers-filmb-ai-p.ps1 -DryRun     # Print tasks without writing

.NOTES
    Author: Augment Agent
    Change: filmb-ai-p
#>

param(
    [switch]$DryRun,
    [switch]$Verbose
)

$ErrorActionPreference = 'Stop'
$repoRoot    = $PSScriptRoot
$writeScript = Join-Path $repoRoot ".beads\bd-write.ps1"
$queryScript = Join-Path $repoRoot ".beads\bd-query.ps1"
$changeDir   = Join-Path $repoRoot "openspec\changes\filmb-ai-p"

Write-Host "`n📋 filmb-ai-p Task Generator" -ForegroundColor Cyan
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
Source JIRA: FB-0042 | Change ID: filmb-ai-p | Priority: High | Story Points: 21

PROBLEM: filmbuff generate-video submits the entire 08-shot-list.jsonl as a single monolithic
batch job. Three production-blocking gaps exist:
  1. No Individual Shot Control — a single bad shot forces a full re-run, wasting all credits
  2. No Incremental Review — entire batch must reach 100% before any clip is viewable
  3. No Approval Gate Before Compilation — combined.mp4 assembled unconditionally

SOLUTION — five spec deltas:
  1. Shot State Machine — six states: pending, generating, complete, approved, rejected, failed
  2. 08-video-status.jsonl — append-only log; clip naming; credits_spent accumulation
  3. filmbuff video sub-commands — 10 commands covering the full per-shot lifecycle
  4. Agent Mode & MCP — JSON-only I/O, 7 stable exit codes, MCP tool server (stdio + HTTP)
  5. ai-powered Integration — generateSingleShot, submitSingleShot, pollShotJob TS interfaces

EXIT CODES: 0=SUCCESS 1=GENERAL_ERROR 2=NOT_FOUND 3=INSUFFICIENT_CREDITS 4=PROVIDER_ERROR 5=STATE_CONFLICT 6=INVALID_ARGS
VIDEO PROVIDERS: runway-gen3 (5 cred/5s poll), pika-2 (4 cred/5s poll), kling-1.6 (6 cred/10s poll)
WATCHDOG DEFAULT: FILMBUFF_WATCHDOG_TIMEOUT_MS = 600,000 ms
MCP SPEC: 2025-11-25 (stdio JSON-RPC 2.0 + Streamable HTTP)

ACCEPTANCE CRITERIA: AC-01 through AC-27 — see openspec/changes/filmb-ai-p/summary.md
AFFECTED REPOS: filmbuff CLI + ai-powered library (must land in same merge window)
SPEC REFS: openspec/changes/filmb-ai-p/specs/ (5 spec files)
WORKSTREAMS: WS-1 (ai-powered) → WS-2 (state machine) → WS-3 (CLI + agent) → WS-4 (MCP)
NON-GOALS: pre-production command changes, web UI changes, new AI providers, streaming NDJSON
"@

$epicId = New-BeadTask `
    -Title       "[FB-0042] filmb-ai-p: Per-Shot Video Generation Control for filmbuff CLI" `
    -Description $epicDesc `
    -Priority    1 `
    -Type        "epic" `
    -Labels      @("filmb-ai-p","FB-0042","video-generation","shot-state-machine","mcp","agent-mode")


# ─── PHASE 2: ai-powered Library — Per-Shot API ───────────────────────────────

Write-Step "Phase 2: ai-powered Library - Per-Shot API"

$ph2Desc = @"
PHASE: ai-powered Library — Per-Shot API (WS-1 per implementation.md)
BLOCKED BY: EPIC (spec approval gate)
BLOCKS: Phase 3 (Shot State Machine depends on ai-powered interfaces)

TASKS (from tasks.md Phase 2):
  • Define SingleShotOptions and SingleShotResult TypeScript interfaces in ai-powered/src/types.ts
  • Implement generateSingleShot(opts) — submit + poll until complete or timeout
  • Implement submitSingleShot(opts) — submit only, return jobId immediately
  • Implement pollShotJob(jobId, provider, outputPath, timeoutMs?) — poll to completion or timeout
  • Implement prompt construction template from ShotListEntry fields:
    scene, shot_type, camera, movement, subject, duration_seconds, mood, dialogue, sfx, notes
  • Implement extraNotes appending to Director notes: field ONLY; NEVER persisted to shot list
  • Implement agentToken forwarding as Authorization: Bearer header; enforce no-log constraint
  • Implement creditsCharged discovery: extract from provider response; fall back to static map
  • Write unit tests UT-API-01 through UT-API-10 and UT-PROMPT-01 through UT-PROMPT-05
  • Write credit discovery tests UT-CRED-01 through UT-CRED-04
  • Achieve >= 90% branch coverage on per-shot API functions

IMPLEMENTATION FILES (implementation.md WS-1):
  ai-powered/src/types.ts          — SingleShotOptions, SingleShotResult interfaces
  ai-powered/src/single-shot.ts    — generateSingleShot(), submitSingleShot()
  ai-powered/src/poll-job.ts       — pollShotJob(); runway-gen3: 5s poll, kling-1.6: 10s poll
  ai-powered/src/prompt-builder.ts — prompt construction template
  ai-powered/src/__tests__/single-shot.test.ts — unit tests

PROVIDER POLLING (filmb-ai-p.json videoProviders):
  runway-gen3: 5s interval | pika-2: 5s interval | kling-1.6: 10s interval
  On timeout: return status: "failed", errorMessage: "api_timeout"

CROSS-REPO CONSTRAINT (implementation.md): ai-powered PR must merge in same window as filmbuff PR
SPEC REF: openspec/changes/filmb-ai-p/specs/ai-powered-integration/spec.md
AC LINKS: AC-11 (credits_spent discovery), AC-27 (agentToken never logged or serialized)
"@

$ph2Id = New-BeadTask `
    -Title       "[filmb-ai-p] Phase 2: ai-powered Library - Per-Shot API" `
    -Description $ph2Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmb-ai-p","phase-2","ai-powered","WS-1","single-shot","prompt-builder")

Add-BeadLink -BlockedId $ph2Id -BlockerId $epicId


# ─── PHASE 3: Shot State Machine & Status File ────────────────────────────────

Write-Step "Phase 3: Shot State Machine & Status File"

$ph3Desc = @"
PHASE: Shot State Machine & Status File (WS-2 per implementation.md)
BLOCKED BY: Phase 2 (ai-powered library interfaces must exist before integration)
BLOCKS: Phase 4 (filmbuff video sub-commands build on state machine)

TASKS (from tasks.md Phase 3):
  • Implement readShotStatus(projectPath) — O(n) scan, returns Map<shotId, lastRecord>
  • Implement appendStatusRecord(projectPath, record) — file-locked append to JSONL
  • Implement all 6 state transitions:
    pending→generating, generating→complete, generating→failed→pending,
    complete→approved, complete→rejected→pending, approved→pending (reopen)
  • Implement watchdog: scan generating shots, compare elapsed vs FILMBUFF_WATCHDOG_TIMEOUT_MS
    (default: 600,000 ms); transition timed-out shots via failed→pending (two records appended)
  • Implement credits_spent accumulation — cumulative per shot across all attempts; never decremented
  • Implement rejected-clip rename: video/clips/s{id}.mp4 → video/clips/s{id}_attempt{N}.mp4
    Must be atomic (rename, not copy+delete) to avoid data loss on failure
  • Write unit tests UT-SM-01 through UT-SM-15
  • Write integration tests IT-SM-01 and IT-SM-02
  • Achieve >= 90% branch coverage on state machine module

IMPLEMENTATION FILES (implementation.md WS-2):
  cli/src/lib/shot-state-machine.ts   — transition(), validateTransition(); pure functions (no I/O)
  cli/src/lib/status-file-manager.ts  — readAllRecords(), getLatestState(), appendRecord() w/lock
  cli/src/lib/shot-list-reader.ts     — readAll(), findById(), findNextPending()
  cli/src/lib/watchdog.ts             — runWatchdog(); configurable via FILMBUFF_WATCHDOG_TIMEOUT_MS

STATE DIAGRAM (deltas.md Domain A):
  pending ──► generating ──► complete ──► approved ──► (compiled)
                  │                           │
                  ▼                           ▼
                failed                    rejected
                  │                           │
                  └───────────────────────► pending

STATUS FILE SCHEMA (deltas.md Domain B):
  shot_id, status, provider, provider_job_id, clip_path, attempt_count,
  rejection_reason, approved_at, rejected_at, generated_at, failed_at,
  credits_spent, updated_at

TEST FILES: cli/src/__tests__/shot-state-machine.test.ts, status-file-manager.test.ts
SPEC REF: openspec/changes/filmb-ai-p/specs/shot-state-machine/ + video-status-file/
AC LINKS: AC-11 (credits_spent), AC-12 (watchdog transitions), AC-15 (legacy clip init)
"@

$ph3Id = New-BeadTask `
    -Title       "[filmb-ai-p] Phase 3: Shot State Machine & Status File" `
    -Description $ph3Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmb-ai-p","phase-3","WS-2","state-machine","status-file","watchdog")

Add-BeadLink -BlockedId $ph3Id -BlockerId $ph2Id



# ─── PHASE 4: filmbuff video Sub-Commands ─────────────────────────────────────

Write-Step "Phase 4: filmbuff video Sub-Commands (10 commands)"

$ph4Desc = @"
PHASE: filmbuff video Sub-Commands (WS-3 per implementation.md)
BLOCKED BY: Phase 3 (state machine and status file must be complete)
BLOCKS: Phase 5 (agent mode builds on the sub-command implementations)

TASKS (from tasks.md Phase 4):
  • Implement filmbuff video init — create 08-video-status.jsonl with one pending record per shot;
    legacy clip detection initializes existing clips as complete; double-init without --overwrite exits 5
  • Implement filmbuff video next — JSONL-order shot selection; watchdog pre-run; exits 0
  • Implement filmbuff video generate — --shot <id>, --notes <text>, --force, --provider flags
  • Implement filmbuff video retry — alias for generate with implicit --force
  • Implement filmbuff video approve — --shot <id> (repeatable) and --all-complete flag
  • Implement filmbuff video reject — --reason <text>; clip rename to attempt{N}; append pending record
  • Implement filmbuff video status — --filter <state>, --json output; watchdog pre-run
  • Implement filmbuff video compile — ffmpeg concat in original JSONL order; title cards at scene
    boundaries ONLY (not between every shot); --include, --title-cards, --output-dir flags;
    index.html (self-contained HTML5 viewer); project.zip includes 08-video-status.jsonl;
    exits 5 with explicit error if zero approved shots
  • Implement filmbuff video reopen — re-open approved shot; preserve existing clip
  • Implement filmbuff video generate-all — loop next until no pending shots; --concurrency flag
  • Wire --project <path> flag to all 10 sub-commands; default to CWD
  • Write unit and integration tests UT-INIT-01 through UT-PROJ-02
  • Verify AC-01 through AC-15

IMPLEMENTATION FILES (implementation.md WS-3):
  cli/src/commands/video/init.ts, next.ts, generate.ts, retry.ts, approve.ts,
  reject.ts, status.ts, compile.ts, reopen.ts, generate-all.ts
  cli/src/lib/compile/title-cards.ts   — scene boundary detection (uses scene field from JSONL)
  cli/src/lib/compile/zip-packager.ts  — project.zip contents (must include 08-video-status.jsonl)
  cli/src/lib/compile/index-html.ts    — self-contained HTML5 viewer

FILE SYSTEM LAYOUT (deltas.md Domain C):
  video/clips/              — generated clip files (created by filmbuff video init)
  video/output/             — compile artifacts (created by filmbuff video compile)
  video/output/combined.mp4, video/output/index.html, video/output/project.zip

IMMUTABILITY RULE (summary.md + deltas.md):
  NO filmbuff video command may write to, append to, or modify 08-shot-list.jsonl.
  --notes appends to AI provider prompt for that attempt ONLY; NOT persisted.

TEST FILE: cli/src/__tests__/video-subcommands.test.ts
SPEC REF: openspec/changes/filmb-ai-p/specs/video-subcommands/spec.md
AC LINKS: AC-01 (init creates pending records), AC-02 (next generates one shot), AC-03 (JSONL order),
          AC-04 (--notes not persisted), AC-05 (reject renames clip), AC-06 (approve --all-complete),
          AC-07 (compile JSONL order), AC-08 (zero approved exits 5), AC-09 (title cards boundaries),
          AC-10 (project.zip includes status), AC-13 (deprecation wrapper), AC-14 (--project flag),
          AC-15 (legacy clip detection)
"@

$ph4Id = New-BeadTask `
    -Title       "[filmb-ai-p] Phase 4: filmbuff video Sub-Commands (10 commands)" `
    -Description $ph4Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmb-ai-p","phase-4","WS-3","video-subcommands","compile","AC-01","AC-15")

Add-BeadLink -BlockedId $ph4Id -BlockerId $ph3Id


# ─── PHASE 5: Agent Mode & Exit Codes ────────────────────────────────────────

Write-Step "Phase 5: Agent Mode & Exit Codes"

$ph5Desc = @"
PHASE: Agent Mode & Exit Codes (WS-3 continued per implementation.md)
BLOCKED BY: Phase 4 (sub-commands must be implemented before adding output modes)
BLOCKS: Phase 6 (MCP server delegates to CLI command implementations)

TASKS (from tasks.md Phase 5):
  • Implement agent mode detection via three triggers:
    — --no-interactive / --agent flag
    — FILMBUFF_AGENT_MODE=1 environment variable
    — Auto-detection: !process.stdin.isTTY
  • Strip ALL ANSI escape codes and spinner characters from stdout and stderr in agent mode
  • Implement JSON stdout envelope for all sub-commands in agent mode
    (exactly ONE JSON object to stdout per invocation)
  • Implement JSON stderr error object on non-zero exit in agent mode
    (exactly ONE JSON error object to stderr; no plain text)
  • Implement all 7 exit codes with symbolic names; enforce no-renumber rule:
    0=SUCCESS 1=GENERAL_ERROR 2=NOT_FOUND 3=INSUFFICIENT_CREDITS
    4=PROVIDER_ERROR 5=STATE_CONFLICT 6=INVALID_ARGS
  • Implement filmbuff generate-video deprecation wrapper:
    Human mode: 3-second countdown + deprecation warning, then full pipeline
    Agent mode: zero delay, no pause, no countdown — delegates immediately
  • Write agent mode unit tests UT-AGENT-01 through UT-CRED-04
  • Verify AC-16 through AC-22

IMPLEMENTATION FILES (implementation.md WS-3):
  cli/src/lib/renderer-human.ts   — HumanRenderer: ANSI colors, spinners, formatted tables
  cli/src/lib/renderer-agent.ts   — AgentRenderer: JSON envelope only; no ANSI; no extra whitespace
  cli/src/commands/generate-video.ts — deprecation wrapper (3s delay human / 0s agent)

AGENT MODE CONTRACT (implementation.md WS-3 § Agent Mode Contract):
  All commands in agent mode MUST:
  — NEVER write ANSI escape codes to stdout or stderr
  — Write exactly ONE JSON object to stdout per invocation
  — Write exactly ONE JSON error object to stderr on non-zero exit
  — NEVER block on stdin for any reason

TEST FILE: cli/src/__tests__/agent-mode.test.ts
SPEC REF: openspec/changes/filmb-ai-p/specs/agent-mode/spec.md § Activation + Exit Codes
AC LINKS: AC-16 (FILMBUFF_AGENT_MODE=1 JSON only), AC-17 (init --overwrite --agent no pause),
          AC-18 (generate-video --agent skips 3s delay), AC-19 (exit 3 credit exhaustion),
          AC-20 (exit 4 provider error/content policy), AC-21 (stderr JSON only in agent mode),
          AC-22 (status --json parseable by /api/projects/:id/video-status)
"@

$ph5Id = New-BeadTask `
    -Title       "[filmb-ai-p] Phase 5: Agent Mode & Exit Codes (AC-16 through AC-22)" `
    -Description $ph5Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmb-ai-p","phase-5","WS-3","agent-mode","exit-codes","AC-16","AC-22")

Add-BeadLink -BlockedId $ph5Id -BlockerId $ph4Id


# ─── PHASE 6: MCP Tool Server ────────────────────────────────────────────────

Write-Step "Phase 6: MCP Tool Server (stdio + HTTP, 10 tools)"

$ph6Desc = @"
PHASE: MCP Tool Server (WS-4 per implementation.md)
BLOCKED BY: Phase 5 (agent mode and CLI command implementations must be complete)
BLOCKS: Phase 7 (credential security audit spans MCP server output paths)

TASKS (from tasks.md Phase 6):
  • Implement filmbuff mcp-server entry point — parse --transport, --port, --project flags
  • Implement stdio transport: JSON-RPC 2.0 framing over stdin/stdout; no authentication required
  • Implement HTTP transport: Streamable HTTP per MCP spec 2025-11-25;
    Bearer token auth via FILMBUFF_MCP_TOKEN; return HTTP 401 on missing or invalid token
  • Expose all 10 MCP tools (each delegates to the corresponding CLI command implementation):
    video_init, video_next, video_generate, video_retry, video_approve, video_reject,
    video_status, video_compile, video_reopen, video_generate_all
    (NO duplicated logic — thin wrappers only)
  • Implement video://status MCP resource — calls StatusFileManager.getLatestState() and serializes
  • Map CLI exit codes to MCP error responses
  • Write MCP unit tests UT-MCP-01 through UT-MCP-06
  • Verify AC-23 through AC-26

IMPLEMENTATION FILES (implementation.md WS-4):
  cli/src/mcp/server.ts    — entry point, transport selection, startup
  cli/src/mcp/tools.ts     — 10 tool definitions + handlers (thin wrappers only)
  cli/src/mcp/resources.ts — video://status resource implementation

SDK REQUIREMENT (implementation.md WS-4):
  Use official MCP TypeScript SDK compatible with specification 2025-11-25.
  Do NOT implement JSON-RPC framing manually.

SPEC REF: openspec/changes/filmb-ai-p/specs/agent-mode/spec.md § MCP Tool Server
EXAMPLE: openspec/changes/filmb-ai-p/examples/03-mcp-integration.md
AC LINKS: AC-23 (tools/list returns all 10 tools), AC-24 (video_status matches JSON schema),
          AC-25 (video_approve allComplete:true returns correct count),
          AC-26 (HTTP transport conforms to MCP spec 2025-11-25)
"@

$ph6Id = New-BeadTask `
    -Title       "[filmb-ai-p] Phase 6: MCP Tool Server (stdio + HTTP, 10 tools)" `
    -Description $ph6Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmb-ai-p","phase-6","WS-4","mcp","stdio","http","AC-23","AC-26")
