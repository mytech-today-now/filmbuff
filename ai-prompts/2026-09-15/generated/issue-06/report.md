# Issue 06 Phase 1 Report

Objective: confirm the failure boundary for malformed `completed.jsonl` and hand off the next prompt with no extra assumptions.

## Outcome

The current checkout is already on the safe boundary. The historical failure described in the issue was a silent parse-failure path in the single-task lookup helpers, but this branch now routes `isTaskCompleted()` and `getCompletedTask()` through `scanCompletedTasks(..., 'strict')`, which raises `CompletedHistoryCorruptionError` on malformed JSON instead of returning a false negative. The aggregate history reader remains lenient by design so it can recover valid records and expose corruption through `history.corruption`.

## Root Cause

The defect boundary is the per-line history scan in `cli/src/utils/beadsCompletedChecker.ts`. If malformed JSON were allowed to be swallowed in the strict lookup path, the helpers could return `false` or `null` even though a task was present later in the file. The current source has already tightened that boundary:

- `cli/src/utils/beadsCompletedChecker.ts:168-246` shows `scanCompletedTasks()`, the strict lookup mode, and the `CompletedHistoryCorruptionError` path.
- `cli/src/utils/beadsCompletedChecker.ts:249-271` shows the lenient history reader that keeps recovered records while preserving a corruption signal.
- `cli/src/commands/showCompleted.ts:183-205` shows the command warning on corruption and either showing recovered records or a no-recoverable-records message.
- `tests/unit/utils/beads-completed-checker.test.ts:56-179` covers empty files, valid records, duplicate task ids, and malformed JSON.
- `tests/integration/cli/command-execution.test.ts:781-795` covers the CLI corruption warning and recovered-record output.

Direct current output confirms the boundary:

```text
Mixed malformed + valid fixture
STDOUT:
Completed Tasks (1)
bd-1001  Valid task
...
STDERR:
⚠ Completed history in scripts\completed.jsonl is corrupted at line 1. Showing recovered records only.
```

```text
Malformed-only fixture
STDOUT:
No valid completed tasks could be recovered from the corrupted history.
STDERR:
⚠ Completed history in scripts\completed.jsonl is corrupted at line 1. Showing recovered records only.
```

## Safe Boundary

Keep the following unchanged:

- Strict single-task lookups must continue to surface corruption instead of hiding it.
- `getCompletedTaskHistory()` may stay lenient, but it must keep the corruption signal.
- Valid completed records must continue to resolve normally.
- Empty files must still behave like clean negatives.
- Duplicate task ids must keep the last record as the winner.
- `showCompletedCommand()` must keep warning on corruption while still presenting recoverable records.

## Files Changed

- `ai-prompts/2026-09-15/generated/issue-06/report.md`

## Tests Added or Updated

- None in this phase.

## Verification Results

- `node scripts/run-vitest.js run tests/unit/utils/beads-completed-checker.test.ts`
- Result: passed, 1 test file, 8 tests.
- `node scripts/run-vitest.js run tests/integration/cli/command-execution.test.ts -t "warns about corrupted completed history while still showing recovered records"`
- Result: passed, 1 test file, 1 test passed, 46 skipped.

## Remaining Risks or Follow-ups

- The lenient history path still drops malformed lines from `history.tasks` by design, so future changes should keep the warning visible whenever corruption is encountered.
- If any caller reintroduces a silent catch around `CompletedHistoryCorruptionError`, the original false-negative bug would come back.
- If new callers need a machine-readable corruption indicator, they should consume `history.corruption` instead of re-reading the file.

## Ordered Task List

1. Keep `scanCompletedTasks()` strict for `isTaskCompleted()` and `getCompletedTask()` so malformed JSON cannot become a silent miss.
2. Keep `getCompletedTaskHistory()` and `showCompletedCommand()` corruption-aware so valid records can be recovered while the warning stays visible.
3. Preserve regression coverage for malformed JSON lines, valid records, empty files, and duplicate task ids.

## Final Report

- Outcome: the current checkout is already on the safe boundary, and the original silent false-negative path is not reproducible here.
- Root cause: the historical bug was a swallowed parse failure in the completed-history lookup path, but the current source already routes strict lookups through the corruption error path.
- Files changed: `ai-prompts/2026-09-15/generated/issue-06/report.md`
- Tests added or updated: none.
- Verification results: focused Vitest helper and CLI corruption tests passed.
- Remaining risks or follow-ups: keep the corruption warning visible and avoid reintroducing a silent catch around completed-history parsing.
