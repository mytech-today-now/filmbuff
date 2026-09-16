# Issue 14 Phase 1 Report

Objective: confirm the transactional failure boundary for reject and reopen around clip archiving, then hand off the next prompt with no extra assumptions.

## Outcome

The current checkout is already safe on the failed-rename boundary. Both commands call `renameClipForRetry()` before `appendRecords()`, and the existing archive regression tests confirm that an `EACCES` rename failure leaves the status file unchanged and the source clip in place. The remaining defect boundary is later in the flow: if `appendRecords()` throws after a successful rename, the filesystem has already moved the clip but the status history is still stale.

## Root Cause

The root cause is the split between filesystem mutation and history persistence in `cli/src/commands/video/reject.ts` and `cli/src/commands/video/reopen.ts`.

- `reject` builds the transition, renames the clip, and only then appends the status records.
- `reopen` does the same for the approved clip archive.
- `appendRecords()` is a separate write under a file lock, so a write failure after a successful rename has no compensating rollback.
- The current commands do not catch that post-rename write failure, so the raw filesystem error bubbles out and the clip remains archived while `08-video-status.jsonl` still reflects the pre-transition state.

## Safe Boundary

- Keep the current order of operations that protects the failed-rename path: build the transition, attempt the rename, and only append history after the rename succeeds.
- Keep the existing `moved`, `missing`, and `failed` outcomes from `renameClipForRetry()` unchanged.
- Keep the command intent and status transitions unchanged.
- Add rollback or another compensating boundary only for the post-rename append failure.
- Do not broaden the fix into unrelated state-machine or archive naming changes.

## Evidence Captured

- `cli/src/commands/video/reject.ts:73-81` renames the clip before appending `rejectRecords`.
- `cli/src/commands/video/reopen.ts:83-91` renames the clip before appending `reopenRecords`.
- `cli/src/lib/status-file-manager.ts:274-309` shows `appendRecords()` and `renameClipForRetry()` are separate filesystem operations, with the rename being atomic but the history append being a later write.
- `cli/src/__tests__/video-subcommands.test.ts:841-934` already covers failed `fs.promises.rename()` for both commands and confirms the status file and source clip stay untouched.
- Focused Jest verification passed: `node_modules\.bin\jest.cmd --runInBand --runTestsByPath cli/src/__tests__/video-subcommands.test.ts -t UT-ARC`
- Targeted append-failure repro for `reject` threw `disk full` with `ENOSPC`, left `08-video-status.jsonl` at 1 record, moved the clip to `video/clips/s001_attempt1.mp4`, and removed `video/clips/s001.mp4`.
- Targeted append-failure repro for `reopen` threw `disk full` with `ENOSPC`, left `08-video-status.jsonl` at 1 record, moved the clip to `video/clips/s001_attempt1_attempt2.mp4`, and removed `video/clips/s001_attempt1.mp4`.

## Files Changed

- `ai-prompts/2026-09-15/generated/issue-14/report.md`

## Tests Added or Updated

- None in this phase.

## Verification Results

- Focused Jest archive regression slice passed with 8 tests.
- The synthetic append-failure repros were run directly with `tsx` and confirmed the non-transactional boundary after a successful rename.
- The current checkout does not reproduce the stale history-after-failed-rename defect described in the pre-mortem snapshot. That path is already covered and passes.

## Remaining Risks or Follow-ups

- The post-rename append failure still leaves filesystem state and history out of sync.
- Preserve the current failed-rename behavior when implementing the rollback fix.
- Keep regression coverage for failed rename, successful archive, and post-rename append failure on both commands.

## Ordered Task List

1. Add a compensating rollback for `reject` and `reopen` when `appendRecords()` fails after `renameClipForRetry()` has already moved the clip.
2. Keep the existing failed-rename behavior unchanged so a move error still leaves the status file and source clip untouched.
3. Add regression coverage for successful archive, failed rename, and post-rename append failure on both commands.

## Final Report

- Outcome: the failed-rename path is already safe, but `reject` and `reopen` are still not fully transactional because a later status append failure leaves the moved clip without matching history.
- Root cause: the commands split the rename and append into separate filesystem operations with no compensating rollback for the append phase.
- Files changed: `ai-prompts/2026-09-15/generated/issue-14/report.md`
- Tests added or updated: none.
- Verification results: focused Jest regression coverage passed, and targeted append-failure repros confirmed the remaining out-of-sync boundary.
- Remaining risks or follow-ups: add rollback for the append phase and keep the failed-rename path unchanged.
