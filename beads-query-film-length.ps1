<#
.SYNOPSIS
    Query beads tasks for the film-length change.

.DESCRIPTION
    Wraps .beads/bd-query.ps1 with film-length-specific queries and provides
    a diagnostic summary of the created task hierarchy.

    Tasks are discovered by the "film-length" label — no hardcoded IDs needed.
    After running .\beads-helpers-film-length.ps1, the script auto-discovers all
    film-length tasks from issues.jsonl by label.

.EXAMPLE
    .\beads-query-film-length.ps1            # Show all film-length tasks
    .\beads-query-film-length.ps1 -Diag      # Diagnostics on issues.jsonl parsing
    .\beads-query-film-length.ps1 -Show <id> # Show one task in detail
    .\beads-query-film-length.ps1 -Ready     # Show tasks ready to work on (open, no blockers)

.NOTES
    Source change: openspec/changes/film-length/
    JIRA:          FB-NAR-1
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

# Phase display order (matches tasks.md and implementation.md workstream order)
$phaseOrder = @('EPIC', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5', 'Phase 6', 'Phase 7')

# ─── helpers ──────────────────────────────────────────────────────────────────

function Get-FilmLengthTasks {
    $rawLines = Get-Content $issuesFile -Encoding UTF8
    $parsed   = $rawLines | ForEach-Object { try { $_ | ConvertFrom-Json } catch { } } | Where-Object { $_ }
    $latest   = @{}
    foreach ($p in $parsed) { if ($p.id) { $latest[$p.id] = $p } }

    # Filter to film-length label; return latest state of each task
    return $latest.Values | Where-Object {
        $_.labels -and ($_.labels -contains 'film-length')
    }
}

function Get-PhaseLabel {
    param([object]$task)
    $labels = @($task.labels)
    if ($labels -contains 'phase-7') { return 'Phase 7' }
    if ($labels -contains 'phase-6') { return 'Phase 6' }
    if ($labels -contains 'phase-5') { return 'Phase 5' }
    if ($labels -contains 'phase-4') { return 'Phase 4' }
    if ($labels -contains 'phase-3') { return 'Phase 3' }
    if ($labels -contains 'phase-2') { return 'Phase 2' }
    if ($task.type -eq 'epic')       { return 'EPIC'    }
    return 'other'
}

# ─── diagnostics ─────────────────────────────────────────────────────────────

if ($Diag) {
    Write-Host ""
    Write-Host "Diagnostics: issues.jsonl parsing" -ForegroundColor Cyan

    $rawLines = Get-Content $issuesFile -Encoding UTF8
    Write-Host "  Total lines in file:  $($rawLines.Count)" -ForegroundColor Gray

    $parsed = @()
    $failed = 0
    foreach ($line in $rawLines) {
        try   { $obj = $line | ConvertFrom-Json; $parsed += $obj }
        catch { $failed++ }
    }

    Write-Host "  Successfully parsed:  $($parsed.Count)" -ForegroundColor Gray
    Write-Host "  Failed to parse:      $failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Green' })

    $latest = @{}
    foreach ($p in $parsed) { if ($p.id) { $latest[$p.id] = $p } }
    Write-Host "  Unique issue IDs:     $($latest.Count)" -ForegroundColor Gray

    $filmTasks = $latest.Values | Where-Object { $_.labels -and ($_.labels -contains 'film-length') }
    Write-Host "  film-length tasks:    $($filmTasks.Count)" -ForegroundColor Cyan

    Write-Host "`n  film-length task status:" -ForegroundColor Cyan
    foreach ($t in ($filmTasks | Sort-Object { Get-PhaseLabel $_ })) {
        $phase    = Get-PhaseLabel $t
        $depCount = if ($t.dependencies) { ($t.dependencies | Where-Object { $_.type -eq 'blocked_by' }).Count } else { 0 }
        $color    = if ($phase -eq 'EPIC') { 'Yellow' } else { 'Green' }
        Write-Host ("  OK {0,-10} P{1}  {2,-11}  [deps:{3}]  {4}" -f $t.id, $t.priority, $t.status, $depCount, $t.title.Substring(0, [Math]::Min(60, $t.title.Length))) -ForegroundColor $color
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
    Write-Host "film-length — Ready Tasks (open, no blockers):" -ForegroundColor Cyan

    $filmTasks = Get-FilmLengthTasks
    $latest    = @{}
    foreach ($t in $filmTasks) { $latest[$t.id] = $t }

    $ready = $filmTasks | Where-Object {
        $_.status -eq 'open' -and (
            -not $_.dependencies -or
            (($_.dependencies | Where-Object {
                $_.type -eq 'blocked_by' -and
                $latest[$_.id] -and $latest[$_.id].status -ne 'closed'
            }).Count -eq 0)
        )
    }

    if ($ready) {
        $ready | ForEach-Object {
            Write-Host ("  {0,-10}  [{1}]  {2}" -f $_.id, (Get-PhaseLabel $_), $_.title) -ForegroundColor Yellow
        }
    } else {
        Write-Host "  No ready tasks found (all are blocked or closed)." -ForegroundColor Gray
    }
    Write-Host ""
    return
}


# ─── default: show all film-length tasks ─────────────────────────────────────

Write-Host "`nfilm-length Task Hierarchy" -ForegroundColor Cyan
Write-Host "  Change: openspec/changes/film-length/" -ForegroundColor Gray
Write-Host "  JIRA:   FB-NAR-1" -ForegroundColor Gray
Write-Host "  Story:  21 points | Priority: High`n" -ForegroundColor Gray

$filmTasks = Get-FilmLengthTasks

if (-not $filmTasks -or @($filmTasks).Count -eq 0) {
    Write-Host "  No film-length tasks found in issues.jsonl." -ForegroundColor Red
    Write-Host "  Run .\beads-helpers-film-length.ps1 to create them." -ForegroundColor Yellow
    Write-Host ""
    exit 0
}

# Sort by phase label for display
$sorted = $filmTasks | Sort-Object {
    $ph = Get-PhaseLabel $_
    switch ($ph) {
        'EPIC'    { 0 } 'Phase 2' { 1 } 'Phase 3' { 2 }
        'Phase 4' { 3 } 'Phase 5' { 4 } 'Phase 6' { 5 }
        'Phase 7' { 6 } default   { 9 }
    }
}

foreach ($t in $sorted) {
    $phase    = Get-PhaseLabel $t
    $isEpic   = ($phase -eq 'EPIC')
    $prefix   = if ($isEpic) { '' } else { '  ' }
    $depCount = if ($t.dependencies) { ($t.dependencies | Where-Object { $_.type -eq 'blocked_by' }).Count } else { 0 }
    $statusIcon = switch ($t.status) {
        'open'        { 'o' }
        'in_progress' { '~' }
        'closed'      { 'x' }
        default       { '?' }
    }
    $short = $t.title.Substring(0, [Math]::Min(70, $t.title.Length))
    $color = if ($isEpic) { 'Yellow' } elseif ($t.status -eq 'closed') { 'DarkGray' } else { 'White' }
    Write-Host ("${prefix}${statusIcon} {0,-7}  {1,-10}  blockers:{2}  {3}" -f $phase, $t.id, $depCount, $short) -ForegroundColor $color
}
Write-Host ""

# Dependency summary
Write-Host "  Dependency graph (from implementation.md Recommended Order):" -ForegroundColor Gray
Write-Host "    Phase 2 (Catalog)      ← Epic                   [unblocks all others]" -ForegroundColor Gray
Write-Host "    Phase 3 (Database)     ← Phase 2" -ForegroundColor Gray
Write-Host "    Phase 4 (Wizard)       ← Phase 2    [parallel with Phase 5]" -ForegroundColor Gray
Write-Host "    Phase 5 (CLI Flags)    ← Phase 2, 3 [parallel with Phase 4]" -ForegroundColor Gray
Write-Host "    Phase 6 (Generator+AI) ← Phase 2, 3" -ForegroundColor Gray
Write-Host "    Phase 7 (CI+Accept.)   ← Phase 4, 5, 6" -ForegroundColor Gray
Write-Host ""

# Status counts
$open   = @($filmTasks | Where-Object { $_.status -eq 'open' }).Count
$inProg = @($filmTasks | Where-Object { $_.status -eq 'in_progress' }).Count
$closed = @($filmTasks | Where-Object { $_.status -eq 'closed' }).Count
$total  = @($filmTasks).Count
Write-Host ("  Status: {0} total  |  {1} open  |  {2} in-progress  |  {3} closed" -f $total, $open, $inProg, $closed) -ForegroundColor Cyan
Write-Host ""
