Write-Host "  Dependency chain:" -ForegroundColor Gray
Write-Host "  EPIC → Ph2 → Ph3 → Ph4 → Ph5 → Ph6 → Ph7 ─┐" -ForegroundColor Gray
Write-Host "                      Ph3 ──────────────────────┤→ Ph8" -ForegroundColor Gray
Write-Host "                           Ph4, Ph5, Ph6, Ph7 ──┘" -ForegroundColor Gray
Write-Host ""

if (-not $DryRun) {
    Write-Host "Querying created tasks..." -ForegroundColor Cyan
    & $queryScript list -Status open -Limit 20
}

Write-Host "`n✅ Done. Run '& `"$queryScript`" search filmb-ai-p' to verify." -ForegroundColor Green