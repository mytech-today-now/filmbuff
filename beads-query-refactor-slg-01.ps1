<#
.SYNOPSIS
    Query beads tasks for the refactor-slg-01 OpenSpec change.

.DESCRIPTION
    Displays the task hierarchy for:
      refactor-slg-01 — Script-Length-Aware Shot Duration Normalization
    Tasks are discovered by the "refactor-slg-01" label.

.EXAMPLE
    .\beads-query-refactor-slg-01.ps1             # Full hierarchy display
    .\beads-query-refactor-slg-01.ps1 -Ready      # Show unblocked tasks
    .\beads-query-refactor-slg-01.ps1 -Show       # Detailed JSON dump
    .\beads-query-refactor-slg-01.ps1 -Diag       # Diagnostics (label counts, links)

.NOTES
    Author: Augment Agent
    Change: refactor-slg-01
#>

param(
    [switch]$Ready,
    [switch]$Show,
    [switch]$Diag
)

$ErrorActionPreference = 'Stop'
$repoRoot    = $PSScriptRoot
$queryScript = Join-Path $repoRoot ".beads\bd-query.ps1"
$CHANGE_LABEL = "refactor-slg-01"

# ─── helpers ──────────────────────────────────────────────────────────────────

function Get-SlgTasks {
    $raw = & $queryScript list --label $CHANGE_LABEL --json 2>$null
    if (-not $raw) { return @() }
    $parsed = $raw | ConvertFrom-Json
    if ($parsed -is [array]) { return $parsed }
    if ($parsed.issues) { return $parsed.issues }
    return @($parsed)
}

function Get-PhaseLabel {
    param([object]$task)
    $labels = @($task.labels)
    if ($labels -contains "phase-2") { return "Phase2" }
    if ($labels -contains "phase-3") { return "Phase3" }
    if ($labels -contains "phase-4") { return "Phase4" }
    if ($labels -contains "phase-5") { return "Phase5" }
    if ($task.type -eq "epic")        { return "EPIC  " }
    return "      "
}

function Format-Status {
    param([string]$status)
    switch ($status) {
        "open"        { return "⬜ open       " }
        "in_progress" { return "🔵 in_progress" }
        "blocked"     { return "🔴 blocked    " }
        "closed"      { return "✅ closed     " }
        default       { return "❓ $status" }
    }
}

function Format-Duration {
    param([string]$date)
    if (-not $date) { return "" }
    $d = [datetime]::Parse($date)
    $age = (Get-Date) - $d
    if ($age.TotalDays -ge 1) { return "$([int]$age.TotalDays)d ago" }
    if ($age.TotalHours -ge 1) { return "$([int]$age.TotalHours)h ago" }
    return "$([int]$age.TotalMinutes)m ago"
}

# ─── DIAGNOSTICS mode ─────────────────────────────────────────────────────────

if ($Diag) {
    Write-Host "`n🔍 Diagnostics — refactor-slg-01" -ForegroundColor Cyan

    $all = Get-SlgTasks
    Write-Host "  Total tasks with label '$CHANGE_LABEL': $($all.Count)" -ForegroundColor White

    $grouped = $all | Group-Object { $_.type }
    foreach ($g in $grouped) {
        Write-Host "    $($g.Name.PadRight(10)): $($g.Count)" -ForegroundColor Gray
    }

    Write-Host "`n  Phase breakdown:" -ForegroundColor White
    foreach ($t in $all) {
        $pl    = Get-PhaseLabel $t
        $blk   = if ($t.blocked_by) { "blocked-by: $($t.blocked_by -join ', ')" } else { "no blockers" }
        $blocks = if ($t.blocks) { "blocks: $($t.blocks -join ', ')" } else { "blocks nothing" }
        Write-Host "    [$pl] $($t.id)  status=$($t.status)  $blk  $blocks" -ForegroundColor Gray
    }

    Write-Host ""
    return
}

# ─── SHOW mode ────────────────────────────────────────────────────────────────

if ($Show) {
    Write-Host "`n📋 All refactor-slg-01 Tasks (JSON)" -ForegroundColor Cyan
    $all = Get-SlgTasks
    if ($all.Count -eq 0) {
        Write-Host "  No tasks found. Run: .\beads-helpers-refactor-slg-01.ps1" -ForegroundColor Yellow
        return
    }
    $all | ConvertTo-Json -Depth 5
    return
}

# ─── READY mode ───────────────────────────────────────────────────────────────

if ($Ready) {
    Write-Host "`n✅ Ready Tasks — refactor-slg-01" -ForegroundColor Cyan
    Write-Host "   (open, no unresolved blockers)" -ForegroundColor Gray

    $all   = Get-SlgTasks
    $open  = $all | Where-Object { $_.status -eq "open" }
    $ready = @()

    foreach ($t in $open) {
        $blockers = @($t.blocked_by)
        if ($blockers.Count -eq 0) {
            $ready += $t
            continue
        }
        $hasOpenBlocker = $false
        foreach ($bid in $blockers) {
            $blocker = $all | Where-Object { $_.id -eq $bid }
            if ($blocker -and $blocker.status -ne "closed") {
                $hasOpenBlocker = $true
                break
            }
        }
        if (-not $hasOpenBlocker) { $ready += $t }
    }

    if ($ready.Count -eq 0) {
        Write-Host "  No ready tasks — all open tasks have open blockers." -ForegroundColor Yellow
        return
    }

    foreach ($t in $ready) {
        $pl = Get-PhaseLabel $t
        Write-Host "`n  [$pl] $($t.id)  p=$($t.priority)" -ForegroundColor Green
        Write-Host "         $($t.title)" -ForegroundColor White
    }
    Write-Host ""
    return
}

# ─── DEFAULT: full hierarchy display ──────────────────────────────────────────

$all = Get-SlgTasks

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " refactor-slg-01: Script-Length-Aware Shot Duration Normalization" -ForegroundColor White
Write-Host " JIRA: FB-SLG-1 | Label: $CHANGE_LABEL" -ForegroundColor Gray
Write-Host "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan

if ($all.Count -eq 0) {
    Write-Host ""
    Write-Host "  ⚠  No tasks found with label '$CHANGE_LABEL'." -ForegroundColor Yellow
    Write-Host "     Run: .\beads-helpers-refactor-slg-01.ps1   to create them." -ForegroundColor Gray
    Write-Host ""
    return
}

# Display order: epic first, then phase-2..phase-5
$sorted = $all | Sort-Object {
    $labels = @($_.labels)
    if ($_.type -eq "epic") { return 0 }
    for ($i = 1; $i -le 5; $i++) {
        if ($labels -contains "phase-$i") { return $i }
    }
    return 99
}

$phaseNames = @{
    "EPIC  " = "Overall epic — Script-Length-Aware Shot Duration Normalization"
    "Phase2" = "Workstream 1 — generate-shot-list.ts (deriveScriptPageCount + --script-pages + budget chain)"
    "Phase3" = "Workstream 2 — generator/index.ts (normalization pass + updated budget warning)"
    "Phase4" = "Workstream 3 — Tests (generate-shot-list-normalization.test.ts)"
    "Phase5" = "CI and Acceptance Verification (all 13 ACs + build + archive)"
}

foreach ($t in $sorted) {
    $pl     = Get-PhaseLabel $t
    $status = Format-Status $t.status
    $age    = Format-Duration $t.created_at

    $indent = if ($pl -eq "EPIC  ") { "" } else { "  " }

    Write-Host ""
    Write-Host "${indent}┌─ [$pl] $(Format-Status $t.status)" -ForegroundColor $(
        switch ($t.status) {
            "closed"      { "Green"  }
            "in_progress" { "Cyan"   }
            "blocked"     { "Red"    }
            default       { "White"  }
        }
    )
    Write-Host "${indent}│  ID   : $($t.id)   priority=$($t.priority)   created $age" -ForegroundColor Gray
    Write-Host "${indent}│  Title: $($t.title)" -ForegroundColor White

    if ($phaseNames.ContainsKey($pl)) {
        Write-Host "${indent}│  Scope: $($phaseNames[$pl])" -ForegroundColor Gray
    }

    $blockers = @($t.blocked_by)
    if ($blockers.Count -gt 0) {
        Write-Host "${indent}│  Blocked-by: $($blockers -join ', ')" -ForegroundColor DarkYellow
    }
    $blocks = @($t.blocks)
    if ($blocks.Count -gt 0) {
        Write-Host "${indent}│  Blocks: $($blocks -join ', ')" -ForegroundColor Gray
    }
    Write-Host "${indent}└─────────────────────────────────────────────────────────" -ForegroundColor DarkGray
}

# Summary counts
$total     = $all.Count
$closed    = ($all | Where-Object { $_.status -eq "closed" }).Count
$inProg    = ($all | Where-Object { $_.status -eq "in_progress" }).Count
$blocked   = ($all | Where-Object { $_.status -eq "blocked" }).Count
$openCount = ($all | Where-Object { $_.status -eq "open" }).Count

Write-Host ""
Write-Host "  Summary: $total tasks  |  ✅ closed=$closed  🔵 in_progress=$inProg  🔴 blocked=$blocked  ⬜ open=$openCount" -ForegroundColor White
Write-Host ""
Write-Host "  Dependency chain: EPIC → Phase2 → Phase3 → Phase4 → Phase5" -ForegroundColor Gray
Write-Host "  Source:           openspec/changes/refactor-slg-01/" -ForegroundColor Gray
Write-Host ""
Write-Host "  Options: -Ready (show unblocked tasks)  -Show (JSON)  -Diag (diagnostics)" -ForegroundColor DarkGray
Write-Host ""
