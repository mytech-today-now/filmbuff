
Write-Step "Phase 8: Testing & Quality Gates (AC-01 through AC-27)"

$ph8Desc = @"
PHASE: Testing & Quality Gates (from tasks.md Phase 8)
BLOCKED BY: Phase 3, Phase 4, Phase 5, Phase 6, Phase 7 (all implementation complete)

TASKS (from tasks.md Phase 8):
  • Commit fixture projects (tests/fixtures/) for state machine and compile integration tests:
    cli/src/__tests__/fixtures/test-project/08-shot-list.jsonl — 5+ shots across 2+ scenes
    cli/src/__tests__/fixtures/test-project/08-video-status.jsonl — pre-populated for regressions
  • Run full test suite; assert >= 90% branch coverage on state machine and ai-powered API modules
  • CI step: filmbuff video init && filmbuff video next --provider mock; assert exit 0
  • CI step: run agent mode tests against mock provider; validate JSON output is parseable
  • Confirm all AC-01 through AC-27 pass (see openspec/changes/filmb-ai-p/summary.md)
  • Confirm ai-powered PR and filmbuff PR are linked and ready to land in same merge window
  • PR reviewed and approved; CI green

TEST PLANS (from tests/ directory):
  tests/shot-state-machine.test-plan.md      — UT-SM-01..15, IT-SM-01..02
  tests/video-subcommands.test-plan.md       — UT-INIT-01..UT-PROJ-02
  tests/agent-mode.test-plan.md             — UT-AGENT-01..UT-CRED-04
  tests/ai-powered-integration.test-plan.md  — UT-API-01..10, UT-PROMPT-01..05, UT-CRED-01..04

ACCEPTANCE CHECKLIST (from summary.md — ALL must pass before PR merge):
  AC-01..AC-10: init, next (JSONL order), generate (--notes not persisted), reject (clip rename),
                approve --all-complete, compile (JSONL order), zero-approved exits 5, title cards,
                project.zip includes status file
  AC-11..AC-15: credits_spent accumulation, watchdog, generate-video deprecation, --project flag, legacy init
  AC-16..AC-22: agent mode JSON output, no ANSI, no pauses, 7 exit codes, status --json parseable
  AC-23..AC-26: MCP tools/list (10 tools), video_status schema, video_approve count, HTTP transport
  AC-27:        agentToken never logged, printed, or written to any file

CROSS-REPO REQUIREMENT (proposal.md Risks):
  ai-powered PR and filmbuff PR MUST land in the same merge window.
  Neither merges without the other passing CI.

CHANGE DIR: openspec/changes/filmb-ai-p/
SPEC REFS: openspec/changes/filmb-ai-p/specs/ (5 spec files — all must pass)
"@

$ph8Id = New-BeadTask `
    -Title       "[filmb-ai-p] Phase 8: Testing & Quality Gates (AC-01 through AC-27)" `
    -Description $ph8Desc `
    -Priority    1 `
    -Type        "task" `
    -Labels      @("filmb-ai-p","phase-8","testing","ci","quality-gates","AC-27")

Add-BeadLink -BlockedId $ph8Id -BlockerId $ph3Id
Add-BeadLink -BlockedId $ph8Id -BlockerId $ph4Id
Add-BeadLink -BlockedId $ph8Id -BlockerId $ph5Id
Add-BeadLink -BlockedId $ph8Id -BlockerId $ph6Id
Add-BeadLink -BlockedId $ph8Id -BlockerId $ph7Id

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
Write-Host ""
Write-Host "  Dependency chain:" -ForegroundColor Gray
Write-Host "  EPIC → Ph2 → Ph3 → Ph4 → Ph5 → Ph6 → Ph7 ─┐" -ForegroundColor Gray
Write-Host "                      Ph3 ──────────────────────┤→ Ph8" -ForegroundColor Gray