# Issue 08 Phase 1 Report

Objective: confirm the failure boundary for date filters accepting invalid or timezone-shifted input and hand off the next prompt with no extra assumptions.

## Outcome

The current checkout is already on the safe boundary. The historical failure described in the issue would have come from parsing `--since` and `--until` directly with `new Date()`, which can silently accept invalid strings and interpret bare dates in local time. The current source now validates each boundary first, rejects malformed values with `InvalidCompletedDateFilterError`, and normalizes bare dates to UTC day start and end before `filterTasksByDateRange()` applies them.

The user-facing `show completed` command also validates before it touches task data, so invalid input fails closed instead of behaving like no filter.

## Root Cause

The defect boundary is in `cli/src/utils/beadsCompletedChecker.ts`.

- `parseCompletedDateBoundary()` rejects empty or malformed values, accepts date-only input only when it matches `YYYY-MM-DD`, and expands it to UTC start or end of day.
- `parseCompletedDateRange()` converts the raw `since` and `until` strings into validated `Date` objects before filtering.
- `filterTasksByDateRange()` uses that parsed range, so the command no longer compares task timestamps against raw user strings.
- `cli/src/commands/showCompleted.ts` calls `parseCompletedDateRange()` in a try/catch and exits with an error message when the filter is invalid.

Relevant source evidence:

- `cli/src/utils/beadsCompletedChecker.ts:94-164`
- `cli/src/utils/beadsCompletedChecker.ts:283-296`
- `cli/src/commands/showCompleted.ts:142-148`
- `tests/unit/utils/beads-completed-checker.test.ts:200-248`
- `tests/integration/cli/command-execution.test.ts:809-898`

## Safe Boundary

Keep the following unchanged:

- Invalid `--since` and `--until` values must continue to fail closed with `InvalidCompletedDateFilterError`.
- Bare `YYYY-MM-DD` inputs must continue to mean a UTC calendar day, not a local-time day.
- Timezone-bearing timestamps must continue to work without shifting the filter window.
- `show completed` must keep the current valid-filter behavior for normal completed-task listings.
- Midnight-edge tasks must continue to stay in the correct UTC day regardless of the local timezone.

## Evidence Captured

Current output from the CLI:

Invalid date input:

```text
Invalid --since value "2026-02-30". Use YYYY-MM-DD for a UTC calendar day or an ISO 8601 timestamp with timezone, such as 2026-09-12T00:00:00Z.
```

UTC date-only window on a fixture containing tasks at the start and end of the day:

```json
[
  {
    "id": "bd-3001",
    "title": "UTC day start",
    "status": "closed",
    "closed_at": "2026-09-11T00:00:00.000Z",
    "close_reason": "Finished at UTC day start"
  },
  {
    "id": "bd-3002",
    "title": "UTC day end",
    "status": "closed",
    "closed_at": "2026-09-11T23:59:59.999Z",
    "close_reason": "Finished at UTC day end"
  }
]
```

The same fixture returned the same task ids when `TZ=America/Los_Angeles`, which confirms the date-only range is stable across timezone changes.

## Files Changed

- `ai-prompts/2026-09-15/generated/issue-08/report.md`

## Tests Added or Updated

- None in this phase.

## Verification Results

- `node scripts/run-vitest.js run tests/unit/utils/beads-completed-checker.test.ts`
- Result: passed, 1 file, 9 tests.
- `node scripts/run-vitest.js run tests/integration/cli/command-execution.test.ts -t "keeps date-only filters aligned with UTC day boundaries|keeps date-only filters stable across timezones|rejects invalid date filters before applying the range"`
- Result: passed, 1 file, 2 tests passed, 45 skipped.
- Direct CLI run: `node .\bin\filmbuff.js show completed --since 2026-02-30`
- Result: exited 1 with the invalid-date error above.
- Direct CLI run against a temp fixture with tasks at UTC day start and end, plus the next UTC day, returned only the two tasks that belong to `2026-09-11`.
- Direct CLI run against the same style of fixture with `TZ=America/Los_Angeles` returned the same two task ids.

## Remaining Risks or Follow-ups

- The bug stays fixed only as long as new code does not reintroduce raw `new Date()` parsing for user-supplied date boundaries.
- Any future filter format expansion should add tests for invalid input, date-only UTC windows, and midnight-edge tasks across at least one non-UTC timezone.

## Ordered Task List

1. Keep `parseCompletedDateBoundary()` as the only parser for `--since` and `--until` values.
2. Keep bare dates normalized to UTC start and end boundaries.
3. Keep `showCompletedCommand()` failing closed on invalid date filters before it loads or filters tasks.
4. Keep regression coverage for invalid dates, UTC date-only ranges, and timezone-stable midnight-edge tasks.

## Final Report

- Outcome: the current checkout is already on the safe boundary, and the original invalid-date and timezone-shift failure is not reproducible here.
- Root cause: raw date-boundary parsing would have allowed invalid or local-time-interpreted values, but the current source now validates and normalizes the filter boundaries.
- Files changed: `ai-prompts/2026-09-15/generated/issue-08/report.md`
- Tests added or updated: none.
- Verification results: focused Vitest helper and CLI integration checks passed, and direct CLI runs confirmed the invalid-date error and timezone-stable UTC day window.
- Remaining risks or follow-ups: do not reintroduce raw `new Date()` parsing for user input, and keep timezone regression tests in place for future filter work.
