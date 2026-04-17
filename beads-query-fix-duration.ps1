<#
.SYNOPSIS
    Query beads tasks for the fix-duration change.

.DESCRIPTION
    Wraps .beads/bd-query.ps1 with fix-duration-specific queries and provides
    a diagnostic summary of the created task hierarchy.

    Tasks are discovered by the "fix-duration" label — no hardcoded IDs needed.
    After running .\beads-helpers-fix-duration.ps1, optionally populate $taskIds
    with the printed IDs for faster indexed lookup.

.EXAMPLE
    .\beads-query-fix-duration.ps1            # Show all fix-duration tasks
    .\beads-query-fix-duration.ps1 -Diag      # Diagnostics on issues.jsonl parsing
    .\beads-query-fix-duration.ps1 -Show <id> # Show one task in detail
    .\beads-query-fix-duration.ps1 -Ready     # Show tasks ready to work on

.NOTES
    Source change: openspec/changes/fix-duration/
    JIRA:          FB-DUR-1
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

# ─── helpers ──────────────────────────────────────────────────────────────────

function Get-FixDurationTasks {
    $rawLines = Get-Content $issuesFile -Encoding UTF8
    $parsed   = $rawLines | ForEach-Object { try { $_ | ConvertFrom-Json } catch { } } | Where-Object { $_ }
    $latest   = @{}
    foreach ($p in $parsed) { if ($p.id) { $latest[$p.id] = $p } }

    # Return all tasks that carry the "fix-duration" label (latest state per id)
    $fixDurTasks = $latest.Values | Where-Object {
        $_.labels -and ($_.labels -contains "fix-duration")
    }
    return $fixDurTasks | Sort-Object { $_.title }
}

# ─── diagnostics ──────────────────────────────────────────────────────────────

if ($Diag) {
    Write-Host ""
    Write-Host "Diagnostics: fix-duration tasks in issues.jsonl" -ForegroundColor Cyan

    $rawLines = Get-Content $issuesFile -Encoding UTF8
    Write-Host "  Total lines in file:  $($rawLines.Count)" -ForegroundColor Gray

    $parsed = @()
    $failed = 0
    foreach ($line in $rawLines) {
        try   { $parsed += ($line | ConvertFrom-Json) }
        catch { $failed++ }
    }

    Write-Host "  Successfully parsed:  $($parsed.Count)" -ForegroundColor Gray
    Write-Host "  Failed to parse:      $failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Green' })

    $latest = @{}
    foreach ($p in $parsed) { if ($p.id) { $latest[$p.id] = $p } }
    Write-Host "  Unique issue IDs:     $($latest.Count)" -ForegroundColor Gray

    $fixDurTasks = $latest.Values | Where-Object { $_.labels -and ($_.labels -contains "fix-duration") }
    Write-Host "  fix-duration tasks:   $($fixDurTasks.Count)" -ForegroundColor Cyan

    Write-Host "`n  fix-duration task status:" -ForegroundColor Cyan
    foreach ($t in ($fixDurTasks | Sort-Object { $_.title })) {
        $depCount = if ($t.dependencies) { ($t.dependencies | Where-Object { $_.type -eq 'blocked_by' }).Count } else { 0 }
        Write-Host ("  OK {0,-10} P{1}  {2}  [deps:{3}] {4}" -f $t.id, $t.priority, $t.status, $depCount, $t.title.Substring(0,[Math]::Min(60,$t.title.Length))) -ForegroundColor Green
    }
    Write-Host ""
    return
}

# ─── show one task ────────────────────────────────────────────────────────────

if ($Show) {
    & $queryScript show $Show
    return
}

# ─── ready tasks ──────────────────────────────────────────────────────────────

if ($Ready) {
    Write-Host ""
    Write-Host "fix-duration - Ready Tasks (open, no blockers):" -ForegroundColor Cyan

    $fixDurTasks = Get-FixDurationTasks
    $ready = $fixDurTasks | Where-Object {
        if ($_.status -ne 'open') { return $false }
        $blockers = if ($_.dependencies) {
            $_.dependencies | Where-Object { $_.type -eq 'blocked_by' }
        } else { @() }
        return ($blockers.Count -eq 0)
    }

    if ($ready) {
        $ready | ForEach-Object {
            Write-Host ("  {0,-10} {1}" -f $_.id, $_.title) -ForegroundColor Yellow
        }
    } else {
        Write-Host "  (none - all tasks are either blocked or not open)" -ForegroundColor Gray
    }
    Write-Host ""
    return
}


# ─── default: show all fix-duration tasks ─────────────────────────────────────

Write-Host "`nfix-duration Task Hierarchy" -ForegroundColor Cyan
Write-Host "  Change: openspec/changes/fix-duration/" -ForegroundColor Gray
Write-Host "  JIRA:   FB-DUR-1  |  Companion: FB-DUR-2`n" -ForegroundColor Gray

$fixDurTasks = Get-FixDurationTasks

# Phase label inference from title
function Get-PhaseLabel {
    param([string]$title)
    if ($title -match 'epic|FB-DUR-1\]')  { return 'EPIC   ' }
    if ($title -match 'Phase 1')          { return 'Phase 1' }
    if ($title -match 'Phase 2')          { return 'Phase 2' }
    if ($title -match 'Phase 3')          { return 'Phase 3' }
    if ($title -match 'Phase 4')          { return 'Phase 4' }
    if ($title -match 'Phase 5')          { return 'Phase 5' }
    if ($title -match 'Phase 6')          { return 'Phase 6' }
    if ($title -match 'Phase 7')          { return 'Phase 7' }
    return 'Task   '
}

foreach ($t in ($fixDurTasks | Sort-Object { $_.title })) {
    $depCount   = if ($t.dependencies) { ($t.dependencies | Where-Object { $_.type -eq 'blocked_by' }).Count } else { 0 }
    $phaseLabel = Get-PhaseLabel -title $t.title
    $isEpic     = $phaseLabel -eq 'EPIC   '
    $prefix     = if ($isEpic) { '' } else { '  ' }
    $statusIcon = switch ($t.status) {
        'open'        { 'o' }
        'in_progress' { '~' }
        'closed'      { 'x' }
        default       { '?' }
    }
    $short = $t.title.Substring(0, [Math]::Min(72, $t.title.Length))
    $color = if ($isEpic) { 'Yellow' } else { 'White' }
    Write-Host ("${prefix}${statusIcon} {0}  {1,-10}  blockers:{2}  {3}" -f $phaseLabel, $t.id, $depCount, $short) -ForegroundColor $color
}

if (-not $fixDurTasks) {
    Write-Host "  (no fix-duration tasks found - run .\beads-helpers-fix-duration.ps1 first)" -ForegroundColor Red
}

Write-Host ""
Write-Host "  Spec deltas: DR-1 duration-derivation.ts | DR-2 video-controls.ts |" -ForegroundColor Gray
Write-Host "               DR-3 batch-serializer.ts    | DR-4 json/jsonl-formatter.ts" -ForegroundColor Gray
Write-Host "  Ref spec:    filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2" -ForegroundColor Gray
Write-Host ""
Write-Host "  Tips:" -ForegroundColor DarkGray
Write-Host "    .\beads-query-fix-duration.ps1 -Ready       # Show unblocked tasks" -ForegroundColor DarkGray
Write-Host "    .\beads-query-fix-duration.ps1 -Show <id>   # Show one task in detail" -ForegroundColor DarkGray
Write-Host "    .\beads-query-fix-duration.ps1 -Diag        # Parse diagnostics" -ForegroundColor DarkGray
Write-Host ""
