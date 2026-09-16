# Issue 07 Phase 1 Report

Objective: confirm the failure boundary for completed task lists silently truncating on bad JSON and hand off the next prompt with no extra assumptions.

## Outcome

The current checkout is already on the safe boundary. The historical silent-truncation failure would only happen if a caller consumed recovered tasks from `getCompletedTaskHistory()` and ignored its `corruption` signal. In this branch, the strict lookup helpers in `cli/src/utils/beadsCompletedChecker.ts` still throw `CompletedHistoryCorruptionError` on malformed lines, and the user-facing `show completed` command in `cli/src/commands/showCompleted.ts` warns before rendering any recovered records. Clean files still render normally.

Captured direct output from the user-facing command matches that boundary.

Mixed valid and invalid lines:

```text
⚠ Completed history in scripts\completed.jsonl is corrupted at line 1. Showing recovered records only.

Completed Tasks (1)
────────────────────────────────────────────────────────────

bd-1001  Valid completed record
  ✓ closed
  Closed: 9/11/2026, 7:00:00 AM
  Reason: Completed

────────────────────────────────────────────────────────────
Total: 1 completed task
```

Clean file:

```text
Completed Tasks (1)
────────────────────────────────────────────────────────────

bd-2001  Clean completed record
  ✓ closed
  Closed: 9/11/2026, 7:00:00 AM
  Reason: Completed

────────────────────────────────────────────────────────────
Total: 1 completed task
```

## Root Cause

The defect boundary is the completed-history scan in `cli/src/utils/beadsCompletedChecker.ts`.

- `scanCompletedTasks()` parses `completed.jsonl` line by line and records the first malformed line as `CompletedHistoryCorruptionError`.
- `getCompletedTaskHistory()` uses the lenient scan mode so it can recover valid records while preserving the corruption signal.
- `getAllCompletedTasks()` rethrows that corruption signal instead of hiding it.
- `showCompletedCommand()` consumes `getCompletedTaskHistory()`, prints the warning, and then renders the recovered tasks.

Relevant source evidence:

- `cli/src/utils/beadsCompletedChecker.ts:168-205`
- `cli/src/utils/beadsCompletedChecker.ts:249-274`
- `cli/src/commands/showCompleted.ts:134-205`
- `tests/unit/utils/beads-completed-checker.test.ts:63-180`
- `tests/integration/cli/command-execution.test.ts:781-795`

The issue summary described a silent truncation path, but the current source already closes that boundary for the user-facing list command. The only remaining way to reintroduce the bug would be for a future caller to use `history.tasks` without checking `history.corruption`.

## Safe Boundary

- Keep `isTaskCompleted()` and `getCompletedTask()` strict so malformed history cannot become a false negative.
- Keep `getCompletedTaskHistory()` lenient only for recovery, but always preserve `corruption`.
- Keep `showCompletedCommand()` warning on corruption before rendering recovered tasks.
- Preserve the current map-based de-duplication and sort behavior for clean data.
- Do not add any new caller that treats `history.tasks` as complete truth without checking `history.corruption`.

## Evidence Captured

- Source inspection confirmed the current strict and lenient scan split in `cli/src/utils/beadsCompletedChecker.ts`.
- The focused helper tests passed for empty files, clean files, duplicate ids, and malformed JSON.
- The CLI integration path passed for corrupted history recovery and the visible warning.
- Two direct command runs verified the visible output on mixed and clean histories.

## Files Changed

- `ai-prompts/2026-09-15/generated/issue-07/report.md`

## Tests Added Or Updated

- None in this phase.

## Verification Results

- `node scripts/run-vitest.js run tests/unit/utils/beads-completed-checker.test.ts`
- Result: passed, 1 file, 9 tests.
- `node scripts/run-vitest.js run tests/integration/cli/command-execution.test.ts -t "warns about corrupted completed history while still showing recovered records|keeps the missing completed-file guidance when scripts/completed.jsonl is absent|finds the same completed tasks from the repository root and a nested directory"`
- Result: passed, 1 file, 3 tests passed, 44 skipped.
- Direct CLI run with a mixed valid and invalid `scripts/completed.jsonl` fixture produced the corruption warning and a one-item recovered list.
- Direct CLI run with a clean `scripts/completed.jsonl` fixture produced the normal one-item listing with no corruption warning.

## Remaining Risks Or Follow-Ups

- Any future consumer that reads `history.tasks` without checking `history.corruption` could silently hide a damaged history again.
- If the completed-task list format changes, the integration assertions around the warning and recovered-record output should be updated in lockstep.

## Ordered Task List

1. Keep the completed-history scanner strict for lookup helpers and corruption-aware for history recovery.
2. Keep the `show completed` command warning visible before rendering recovered records.
3. Preserve regression coverage for empty files, clean files, mixed valid and invalid lines, and the user-facing listing command.

## Final Report

- Outcome: the current checkout is already on the safe boundary, and the historical silent-truncation path is not reproducible here.
- Root cause: the only dangerous boundary is a caller that consumes recovered completed-task history without checking `corruption`.
- Files changed: `ai-prompts/2026-09-15/generated/issue-07/report.md`
- Tests added or updated: none.
- Verification results: focused Vitest helper and CLI integration checks passed, and direct CLI runs confirmed the mixed-history warning and the clean-history normal listing.
- Remaining risks or follow-ups: keep every completed-task consumer corruption-aware so the silent truncation bug does not return.
