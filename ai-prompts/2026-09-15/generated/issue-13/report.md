# Issue 13 Phase 1 Report

Objective: confirm the failure boundary for reject and reopen reporting archive success on missing clips, then hand off the next prompt with no extra assumptions.

## Outcome

The current checkout is already on the safe boundary. `renameClipForRetry()` returns a structured `missing` outcome when the source clip is absent, and both `videoRejectCommand()` and `videoReopenCommand()` branch on that outcome to print explicit missing-source text instead of claiming archive success. The historical false-success wording from the pre-mortem snapshot is not reproducible in this tree.

## Root Cause

The historical defect boundary is command-level interpretation of `RenameClipForRetryOutcome` in `cli/src/commands/video/reject.ts` and `cli/src/commands/video/reopen.ts`. If either command ignored the `kind` discriminant and unconditionally logged `archiveOutcome.destinationPath`, a missing file would look like a successful archive. The current source avoids that by keeping the `moved`, `missing`, and `failed` outcomes distinct.

## Safe Boundary

- Keep `renameClipForRetry()` returning `moved`, `missing`, and `failed` exactly as defined in `cli/src/lib/status-file-manager.ts`.
- Keep reject and reopen preserving the state transition semantics and the current audit trail shape.
- Keep the structured agent envelope aligned with the filesystem outcome, including `archived_clip` and `archive_result.kind`.
- Do not change the overall success exit code for the missing-clip case, because the state transition still completes.
- Do not broaden the fix into unrelated status-file, state-machine, or archive naming changes.

## Evidence Captured

- `cli/src/lib/status-file-manager.ts:300-329` returns `kind: 'missing'` for `ENOENT` and only returns `kind: 'failed'` for other filesystem errors.
- `cli/src/commands/video/reject.ts:73-103` logs `Clip missing at source: ... (no archive created).` when the outcome is not `moved`.
- `cli/src/commands/video/reopen.ts:83-112` logs `Approved clip missing at source: ... (no archive created).` when the outcome is not `moved`.
- `cli/src/commands/video/reject.ts:92-103` and `cli/src/commands/video/reopen.ts:101-112` keep the agent JSON honest by reporting `archived_clip: null` for missing clips and carrying the real `archive_result.kind`.
- `cli/src/__tests__/video-subcommands.test.ts:598-760` already covers missing-source, successful move, and rename-failure paths for both commands.
- Verification command: `node_modules\.bin\jest.cmd --runInBand --runTestsByPath cli/src/__tests__/video-subcommands.test.ts -t UT-ARC`
- Verification result: `PASS cli/src/__tests__/video-subcommands.test.ts`

## Files Changed

- `ai-prompts/2026-09-15/generated/issue-13/report.md`

## Tests Added or Updated

- None in this phase.

## Verification Results

- Focused Jest coverage passed for the reject and reopen archive outcomes.
- The missing-source cases assert explicit missing messages and no archive-success text.
- The successful move cases still report the archive destination.
- The structured agent envelope still distinguishes missing clips from real moves through `archive_result.kind`.
- The rename-failure cases still return a general error and leave state untouched.
- A Vitest attempt was not applicable to `cli/src/__tests__` because the local Vitest config only includes `tests/**/*.test.ts` and `ai-powered/src/**/*.test.ts`.

## Remaining Risks or Follow-ups

- The current tree is already safe, but this boundary should stay covered so a later refactor does not reintroduce a false archive-success message.
- Preserve the missing-source branch and the structured `archive_result.kind` field if future work touches these commands.

## Ordered Task List

1. Keep `renameClipForRetry()` returning a discriminated outcome so missing source clips stay separate from real moves and filesystem failures.
2. Keep `videoRejectCommand()` and `videoReopenCommand()` using `archiveOutcome.kind` to decide between archive-success text and explicit missing-source text.
3. Keep the UT-ARC regression coverage in `cli/src/__tests__/video-subcommands.test.ts` for missing-source, successful move, and rename-failure cases.

## Final Report

- Outcome: the current checkout already reports missing clips explicitly and does not claim archive success for the missing-source path.
- Root cause: the only failure boundary is a future regression that would drop the `archiveOutcome.kind` branch and log the archive destination unconditionally.
- Files changed: `ai-prompts/2026-09-15/generated/issue-13/report.md`
- Tests added or updated: none.
- Verification results: source inspection plus the focused Jest slice both passed.
- Remaining risks or follow-ups: keep the missing-source branch, the structured archive result, and the UT-ARC coverage intact.
