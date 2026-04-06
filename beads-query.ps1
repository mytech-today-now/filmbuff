<#
.SYNOPSIS
    Query beads tasks for the filmbuff-prompt-JIRA change.

.DESCRIPTION
    Wraps .beads/bd-query.ps1 with filmbuff-prompt-JIRA-specific queries
    and provides a diagnostic summary of the created task hierarchy.

.EXAMPLE
    .\beads-query.ps1            # Show all filmbuff-prompt-JIRA tasks
    .\beads-query.ps1 -Diag      # Run diagnostics on issues.jsonl parsing
    .\beads-query.ps1 -Show <id> # Show one task in detail
    .\beads-query.ps1 -Ready     # Show tasks ready to work on

.NOTES
    Source change: openspec/changes/filmbuff-prompt-JIRA/
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

$jiraIds = @(
    'bd-f548',  # Epic
    'bd-fefd',  # Phase 2
    'bd-bae9',  # Phase 3
    'bd-be70',  # Phase 4
    'bd-f5b3',  # Phase 5
    'bd-b4ce',  # Phase 6
    'bd-05fa',  # Phase 7
    'bd-2bc8',  # Phase 8
    'bd-e4d2'   # Phase 9
)

# ─── diagnostics ─────────────────────────────────────────────────────────────

if ($Diag) {
    Write-Host ""
    Write-Host "Diagnostics: issues.jsonl parsing" -ForegroundColor Cyan

    $rawLines = Get-Content $issuesFile -Encoding UTF8
    Write-Host "  Total lines in file:  $($rawLines.Count)" -ForegroundColor Gray

    $parsed = @()
    $failed = 0
    foreach ($line in $rawLines) {
        try {
            $obj = $line | ConvertFrom-Json
            $parsed += $obj
        } catch {
            $failed++
        }
    }

    Write-Host "  Successfully parsed:  $($parsed.Count)" -ForegroundColor Gray
    Write-Host "  Failed to parse:      $failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Green' })

    $latest = @{}
    foreach ($p in $parsed) {
        if ($p.id) { $latest[$p.id] = $p }
    }
    Write-Host "  Unique issue IDs:     $($latest.Count)" -ForegroundColor Gray

    Write-Host "`n  filmbuff-prompt-JIRA task status:" -ForegroundColor Cyan
    foreach ($id in $jiraIds) {
        if ($latest.ContainsKey($id)) {
            $t = $latest[$id]
            $depCount = if ($t.dependencies) { ($t.dependencies | Where-Object { $_.type -eq 'blocked_by' }).Count } else { 0 }
            Write-Host ("  OK {0,-10} P{1}  {2}  [deps:{3}] {4}" -f $id, $t.priority, $t.status, $depCount, $t.title.Substring(0,[Math]::Min(60,$t.title.Length))) -ForegroundColor Green
        } else {
            Write-Host "  MISSING: $id -- NOT FOUND" -ForegroundColor Red
        }
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
    Write-Host "filmbuff-prompt-JIRA -- Ready Tasks (open, no blockers):" -ForegroundColor Cyan

    $rawLines = Get-Content $issuesFile -Encoding UTF8
    $parsed   = $rawLines | ForEach-Object { try { $_ | ConvertFrom-Json } catch { } } | Where-Object { $_ }
    $latest   = @{}
    foreach ($p in $parsed) { if ($p.id) { $latest[$p.id] = $p } }

    $ready = $jiraIds | ForEach-Object {
        $t = $latest[$_]
        if ($t -and $t.status -eq 'open') {
            $blockers = if ($t.dependencies) {
                $t.dependencies | Where-Object { $_.type -eq 'blocked_by' }
            } else { @() }
            if ($blockers.Count -eq 0) { $t }
        }
    }

    $ready | ForEach-Object {
        Write-Host ("  {0,-10} {1}" -f $_.id, $_.title) -ForegroundColor Yellow
    }
    Write-Host ""
    return
}

# ─── default: show all filmbuff-prompt-JIRA tasks ────────────────────────────

Write-Host "`nfilmbuff-prompt-JIRA Task Hierarchy" -ForegroundColor Cyan
Write-Host "  Change: openspec/changes/filmbuff-prompt-JIRA/" -ForegroundColor Gray
Write-Host "  JIRA:   FB-SHOT-9`n" -ForegroundColor Gray

$rawLines = Get-Content $issuesFile -Encoding UTF8
$parsed   = $rawLines | ForEach-Object { try { $_ | ConvertFrom-Json } catch { } } | Where-Object { $_ }
$latest   = @{}
foreach ($p in $parsed) { if ($p.id) { $latest[$p.id] = $p } }

$phaseLabels = @{
    'bd-f548' = 'EPIC   '
    'bd-fefd' = 'Phase 2'
    'bd-bae9' = 'Phase 3'
    'bd-be70' = 'Phase 4'
    'bd-f5b3' = 'Phase 5'
    'bd-b4ce' = 'Phase 6'
    'bd-05fa' = 'Phase 7'
    'bd-2bc8' = 'Phase 8'
    'bd-e4d2' = 'Phase 9'
}

foreach ($id in $jiraIds) {
    $t = $latest[$id]
    if ($t) {
        $depCount = if ($t.dependencies) { ($t.dependencies | Where-Object { $_.type -eq 'blocked_by' }).Count } else { 0 }
        $prefix   = if ($phaseLabels[$id] -eq 'EPIC   ') { '' } else { '  ' }
        $statusIcon = switch ($t.status) {
            'open'        { 'o' }
            'in_progress' { '~' }
            'closed'      { 'x' }
            default       { '?' }
        }
        $short = $t.title.Substring(0, [Math]::Min(72, $t.title.Length))
        Write-Host ("${prefix}${statusIcon} {0}  {1,-10}  blockers:{2}  {3}" -f $phaseLabels[$id], $id, $depCount, $short) -ForegroundColor $(if ($phaseLabels[$id] -eq 'EPIC   ') { 'Yellow' } else { 'White' })
    } else {
        Write-Host ("  ? {0}  {1} -- not found" -f $phaseLabels[$id], $id) -ForegroundColor Red
    }
}
Write-Host ""
