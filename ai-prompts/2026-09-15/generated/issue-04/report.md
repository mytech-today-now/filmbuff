# Issue 04 Phase 1 Report

Objective: confirm the failure boundary for concat list path escaping and hand off the next prompt with no extra assumptions.

## Outcome

The current checkout is already on the safe boundary. In `cli/src/commands/video/compile.ts`, concat entries are not assembled as raw `file 'path'` strings. Instead, `quoteConcatPath()` escapes apostrophes with ffmpeg's single-quote token rules, `formatConcatEntry()` wraps every path through that helper, and `videoCompileCommand()` writes those escaped lines to `concat.txt` before passing the file to ffmpeg. The historical failure boundary would only exist if a future snapshot bypassed that helper and wrote the raw path into the concat manifest.

## Root Cause

- If a concat manifest line is emitted as `file '...'` without escaping internal `'`, ffmpeg will parse the path incorrectly and the compile step can fail for project, output, title-card, or clip paths containing apostrophes.
- Paths with spaces, ampersands, unicode, and nested directories are safe only when the full token is quoted and apostrophes are escaped.
- Source evidence:
  - `cli/src/commands/video/compile.ts:94-101` defines `quoteConcatPath()` and `formatConcatEntry()`.
  - `cli/src/commands/video/compile.ts:218,227,235-250` shows both title-card and clip paths flowing through the formatter, then `concat.txt` being written and consumed by ffmpeg.
- The current checkout already uses the helper, so the raw failure described in the issue summary is not reproduced here.

## Safe Boundary

- Keep the concat manifest builder on the `formatConcatEntry()` boundary.
- Keep `quoteConcatPath()` as the only place that serializes concat-demuxer paths.
- Preserve the existing `combined.mp4` workflow, title-card generation, and archive layout.
- Do not widen the change to HTML rendering, zip packaging, or unrelated command execution paths.

## Evidence Captured

- `cli/src/__tests__/video-compile.test.ts:484-556` adds regression coverage for spaces, apostrophes, unicode, and nested paths.
- That test asserts:
  - `result.concatText` contains the escaped apostrophe marker `'\''`
  - parsed concat entries round-trip back to the expected absolute paths
  - `exec()` is not called
- Focused verification run:
  - `node node_modules/jest/bin/jest.js cli/src/__tests__/video-compile.test.ts --runInBand`
  - Result: `PASS`, 1 suite, 4 tests passed

## Files Changed

- `ai-prompts/2026-09-15/generated/issue-04/report.md`

## Tests Added or Updated

- None in this phase.

## Verification Results

- Source inspection confirmed the concat manifest passes through `quoteConcatPath()` and `formatConcatEntry()`.
- The focused Jest regression passed and exercised the concat manifest boundary with hostile path content.
- No live ffmpeg encode was required to confirm the manifest text boundary in this phase.

## Remaining Risks or Follow-ups

- If a future snapshot removes `quoteConcatPath()` or bypasses `formatConcatEntry()`, paths containing apostrophes will be the first breakage point.
- Keep regression coverage for spaces, apostrophes, ampersands, unicode, nested directories, and other concat-sensitive characters.

## Ordered Task List

1. Re-check `cli/src/commands/video/compile.ts` for any raw concat-line construction that bypasses `formatConcatEntry()`.
2. Preserve or restore `quoteConcatPath()` so apostrophes continue to serialize as escaped ffmpeg tokens.
3. Retain regression coverage for spaces, apostrophes, ampersands, unicode, and nested paths in `cli/src/__tests__/video-compile.test.ts`.
4. Re-run the focused Jest file and confirm `concat.txt` still round-trips to the expected absolute paths.
5. Keep the `combined.mp4` workflow and archive layout unchanged while making any future fix.

## Final Report

- Outcome: the current checkout already avoids the reported concat escaping failure.
- Root cause: raw concat lines would fail on apostrophes, but the present source routes every entry through the escaping helper.
- Files changed: `ai-prompts/2026-09-15/generated/issue-04/report.md`
- Tests added or updated: none in this phase.
- Verification results: focused Jest regression passed.
- Remaining risks or follow-ups: only future refactors that bypass `quoteConcatPath()` or change concat manifest serialization.
