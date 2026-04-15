<#
.SYNOPSIS
    Query beads tasks for the filmb-ai-p change.

.DESCRIPTION
    Wraps .beads/bd-query.ps1 with filmb-ai-p-specific queries and provides
    a diagnostic summary of the created task hierarchy.

    Tasks are discovered by the "filmb-ai-p" label — no hardcoded IDs needed.
    After running .\beads-helpers-filmb-ai-p.ps1, optionally populate $taskIds
    with the printed IDs for faster indexed lookup.

.EXAMPLE
    .\beads-query-filmb-ai-p.ps1            # Show all filmb-ai-p tasks
    .\beads-query-filmb-ai-p.ps1 -Diag      # Diagnostics on issues.jsonl parsing
    .\beads-query-filmb-ai-p.ps1 -Show <id> # Show one task in detail
    .\beads-query-filmb-ai-p.ps1 -Ready     # Show tasks ready to work on

.NOTES
    Source change: openspec/changes/filmb-ai-p/
    Run .\beads-helpers-filmb-ai-p.ps1 first to create tasks, then
    update $taskIds below with the IDs printed in the creation summary.
#>
param(
    [switch]$Diag,
    [switch]$Ready,
    [string]$Show
)

$ErrorActionPreference = 'Stop'
$repoRoot    = $PSScriptRoot
$queryScript = Join-Path $repoRoot ".beads\bd-query.ps1"
$issuesFile  = Join-Path $repoRoot ".beads\issues.jsonl"

# ─── Task IDs (populate after running beads-helpers-filmb-ai-p.ps1) ───────────
# Replace the empty strings with the bd-xxxx IDs printed by the helpers script.
$taskIds = @(
    'bd-114f',  # Epic    — [FB-0042] filmb-ai-p: Per-Shot Video Generation Control
    'bd-5fde',  # Phase 2 — ai-powered Library: Per-Shot API
    'bd-b3e9',  # Phase 3 — Shot State Machine & Status File
    'bd-92c1',  # Phase 4 — filmbuff video Sub-Commands (10 commands)
    'bd-7767',  # Phase 5 — Agent Mode & Exit Codes
    'bd-ea74',  # Phase 6 — MCP Tool Server (stdio + HTTP, 10 tools)
    'bd-aafe',  # Phase 7 — Credential Security (agentToken audit)
    'bd-1751'   # Phase 8 — Testing & Quality Gates (AC-01 through AC-27)
) | Where-Object { $_ -ne '' }

$phaseLabels = @{
    'epic' = 'EPIC   '
    'task' = 'Phase  '
}

# ─── helpers ──────────────────────────────────────────────────────────────────

function Get-FilmbAipTasks {
    $rawLines = Get-Content $issuesFile -Encoding UTF8
    $parsed   = @()
    foreach ($line in $rawLines) {
        try { $parsed += ($line | ConvertFrom-Json) } catch { }
    }
    # Build latest-state map (last record per id wins)
    $latest = @{}
    foreach ($p in $parsed) { if ($p.id) { $latest[$p.id] = $p } }
    # Filter by label — works immediately after helpers script runs
    return @($latest.Values | Where-Object {
        $_.labels -and ($_.labels -contains 'filmb-ai-p')
    })
}

function Format-TaskLine {
    param($t)
    $depCount   = if ($t.dependencies) {
        @($t.dependencies | Where-Object { $_.type -eq 'blocked_by' }).Count
    } else { 0 }
    $isEpic     = $t.type -eq 'epic'
    $prefix     = if ($isEpic) { '' } else { '  ' }
    $statusIcon = switch ($t.status) {
        'open'        { 'o' }
        'in_progress' { '~' }
        'closed'      { 'x' }
        default       { '?' }
    }
    $typeTag = if ($isEpic) { 'EPIC   ' } else { 'Phase  ' }
    $short   = $t.title.Substring(0, [Math]::Min(68, $t.title.Length))
    $color   = if ($isEpic) { 'Yellow' } else { 'White' }
    $idPad = "{0,-10}" -f $t.id
    Write-Host ("${prefix}${statusIcon} ${typeTag}  ${idPad}  blockers:${depCount}  ${short}") -ForegroundColor $color
}

# ─── diagnostics ─────────────────────────────────────────────────────────────

if ($Diag) {
    Write-Host ""
    Write-Host "Diagnostics: issues.jsonl parsing" -ForegroundColor Cyan

    $rawLines = Get-Content $issuesFile -Encoding UTF8
    Write-Host "  Total lines in file:  $($rawLines.Count)" -ForegroundColor Gray

    $parsed = @(); $failed = 0
    foreach ($line in $rawLines) {
        try   { $parsed += ($line | ConvertFrom-Json) }
        catch { $failed++ }
    }
    Write-Host "  Successfully parsed:  $($parsed.Count)" -ForegroundColor Gray
    Write-Host "  Failed to parse:      $failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Green' })

    $latest = @{}
    foreach ($p in $parsed) { if ($p.id) { $latest[$p.id] = $p } }
    Write-Host "  Unique issue IDs:     $($latest.Count)" -ForegroundColor Gray

    $aiTasks = Get-FilmbAipTasks
    Write-Host "`n  filmb-ai-p task status ($($aiTasks.Count) tasks found):" -ForegroundColor Cyan
    foreach ($t in ($aiTasks | Sort-Object { $_.created_at })) {
        $depCount = if ($t.dependencies) {
            ($t.dependencies | Where-Object { $_.type -eq 'blocked_by' }).Count
        } else { 0 }
        Write-Host ("  {0,-10} P{1}  {2,-12}  [deps:{3}]  {4}" -f `
            $t.id, $t.priority, $t.status, $depCount,
            $t.title.Substring(0, [Math]::Min(55, $t.title.Length))) -ForegroundColor Green
    }
    Write-Host ""
    return
}

# ─── show one task ────────────────────────────────────────────────────────────

if ($Show) {
    & $queryScript show $Show
    return
}

# ─── ready tasks ─────────────────────────────────────────────────────────────

if ($Ready) {
    Write-Host ""
    Write-Host "filmb-ai-p -- Ready Tasks (open, no open blockers):" -ForegroundColor Cyan

    $aiTasks = Get-FilmbAipTasks
    $readyTasks = @()
    foreach ($task in $aiTasks) {
        if ($task.status -ne 'open') { continue }
        $blockerCount = 0
        foreach ($dep in @($task.dependencies)) {
            if ($dep -and $dep.type -eq 'blocked_by') { $blockerCount++ }
        }
        if ($blockerCount -eq 0) { $readyTasks += $task }
    }

    if ($readyTasks.Count -eq 0) {
        Write-Host "  (none -- all open tasks are currently blocked)" -ForegroundColor Gray
    } else {
        foreach ($t in $readyTasks) {
            $idPad = "{0,-10}" -f $t.id
            Write-Host ("  ${idPad}  $($t.title)") -ForegroundColor Yellow
        }
    }
    Write-Host ""
    return
}

# ─── default: show all filmb-ai-p tasks ──────────────────────────────────────

Write-Host "`nfilmb-ai-p Task Hierarchy" -ForegroundColor Cyan
Write-Host "  Change: openspec/changes/filmb-ai-p/" -ForegroundColor Gray
Write-Host "  JIRA:   FB-0042`n" -ForegroundColor Gray

$aiTasks = Get-FilmbAipTasks

if ($aiTasks.Count -eq 0) {
    Write-Host "  No filmb-ai-p tasks found." -ForegroundColor Red
    Write-Host "  Run .\beads-helpers-filmb-ai-p.ps1 to create them." -ForegroundColor Red
    Write-Host ""
    return
}

foreach ($t in ($aiTasks | Sort-Object { $_.created_at })) {
    Format-TaskLine $t
}

Write-Host ""
Write-Host "  Total tasks: $($aiTasks.Count)" -ForegroundColor Gray
$openCount   = ($aiTasks | Where-Object { $_.status -eq 'open' }).Count
$inProgCount = ($aiTasks | Where-Object { $_.status -eq 'in_progress' }).Count
$doneCount   = ($aiTasks | Where-Object { $_.status -eq 'closed' }).Count
Write-Host "  open: $openCount  in_progress: $inProgCount  closed: $doneCount" -ForegroundColor Gray
Write-Host ""
Write-Host "  Options:" -ForegroundColor Gray
Write-Host "  -Diag          diagnostics on issues.jsonl parsing + filmb-ai-p task status" -ForegroundColor Gray
Write-Host "  -Ready         tasks that are open with no open blockers" -ForegroundColor Gray
Write-Host "  -Show <id>     full detail for a single task" -ForegroundColor Gray
Write-Host ""


