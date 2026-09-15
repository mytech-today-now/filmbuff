# Issue 03 Phase 1 Report

Objective: confirm the failure boundary for the title-card ffmpeg command and hand off the next prompt with no extra assumptions.

## Outcome

The current checkout is already on the safe boundary. The historical failure boundary is the point where user-controlled scene text is assembled into a shell command string and executed with `exec()`. In `cli/src/commands/video/compile.ts`, that boundary is no longer present: title text is written to `title_0000.txt`, ffmpeg is invoked with `child_process.execFile(...)`, and `shell: false` is forced.

## Root Cause

- Shell metacharacters in scene titles become dangerous only if they are concatenated into a shell string.
- The unsafe pattern is command construction through `exec()` or any shell-interpreted string.
- The safe pattern is argv-based `execFile` plus file-backed title text passed through `drawtext=textfile=...`.
- Source evidence:
  - `cli/src/commands/video/compile.ts:54-78` defines `runFfmpeg()` with `execFile` and `shell: false`.
  - `cli/src/commands/video/compile.ts:193-223` writes the scene title to `title_0000.txt` and passes only the filename to ffmpeg.
- There is no `titleCmd` or shell-string title-card path in the current file.

## Safe Boundary

- Treat scene titles and clip paths as literal data.
- Keep them out of shell command strings.
- Pass only argv entries and a file-backed `textfile=` reference to ffmpeg.
- Preserve the title-card feature and ffmpeg output, but do not reintroduce shell parsing.

## Evidence Captured

- Source inspection showed only `child_process.execFile` in the title-card path.
- Regression test `cli/src/__tests__/video-compile.test.ts` already asserts hostile scene text stays literal and `exec()` is not called.
- Focused test run output:

```text
PASS cli/src/__tests__/video-compile.test.ts (12.709 s)
Test Suites: 1 passed, 1 total
Tests: 4 passed, 4 total
```

## Files Changed

- `ai-prompts/2026-09-15/generated/issue-03/report.md`

## Tests Added or Updated

- None in this phase. Existing regression coverage was used for verification.

## Verification Results

- `npm run test:jest -- cli/src/__tests__/video-compile.test.ts --runInBand` passed.
- The hostile-scene regression `[UT-VCOMP-04]` confirmed:
  - `shell === false`
  - `textFileContents` equals the hostile scene text
  - `drawtextFilter` does not contain the hostile scene text
  - `exec()` was not called

## Remaining Risks or Follow-ups

- If any future refactor touches title-card construction, keep the argument boundary explicit and add coverage for titles and paths containing `;`, `&`, `|`, `$`, backticks, quotes, and `$(...)`.
- Keep the current shell-free ffmpeg boundary intact.

## Ordered Task List

1. Confirm the title-card path remains argv-based and shell-free in `cli/src/commands/video/compile.ts`.
2. Add or update regression coverage for command construction, argument boundaries, and paths or titles containing shell metacharacters.
3. Verify hostile title text stays in the temp text file and never appears in a shell command string.
4. Re-run the focused Jest file and lint before any code change is considered complete.
