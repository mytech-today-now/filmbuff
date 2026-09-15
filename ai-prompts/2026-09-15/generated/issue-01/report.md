# Issue 01 Report

## Outcome
The suspected failure boundary is the viewer clip path construction layer, but this checkout already routes both the HTML viewer and the zip archive through the same archive-relative helper. The reported mismatch is therefore not reproducible in the current source, and no code change was made in this phase.

## Root Cause
The failure would exist if `index.html` used only `path.basename(record.clip_path)` while `project.zip` stored clips under `clips/`. That would produce a review page whose `<video src>` values no longer match the extracted archive layout.

In the current source, `cli/src/commands/video/compile.ts` avoids that mismatch by using `packagedClipPath()` for both outputs. The helper returns `clips/<basename>`, and the viewer plus archive packaging both consume that same value.

## Evidence
- `cli/src/commands/video/compile.ts` defines `packagedClipPath(clipPath)` as `clips/<basename>`.
- `cli/src/commands/video/compile.ts` passes `clipFile: packagedClipPath(record!.clip_path!)` into `buildIndexHtml()`.
- `cli/src/commands/video/compile.ts` writes archive entries with `instance.file(absClip, { name: packagedClipPath(absClip) })`.
- `cli/src/__tests__/video-compile.test.ts` has `[UT-VCOMP-01]` asserting that extracted `index.html` src values resolve inside the zip and that the zip contains `clips/lead.mp4` and `clips/final.mp4`.
- `cli/src/__tests__/video-compile.test.ts` has `[UT-VCOMP-02]` asserting the same contract still holds for spaces, apostrophes, unicode, and nested clip source paths.
- Focused verification run: `npm run test:jest -- --runInBand cli/src/__tests__/video-compile.test.ts` passed, with all 4 tests green.

## Safe Boundary
- Keep the archive layout under `clips/` unchanged.
- Keep title-card generation, concat manifest generation, and non-video behavior untouched.
- If a future snapshot still shows bare basenames in the viewer, change only the shared clip-path helper so HTML and zip stay aligned.

## Ordered Task List
1. Re-check the viewer `src` construction against the archive entry names in the target snapshot.
2. Keep or introduce a single shared helper for archive-relative clip paths.
3. Preserve `clips/<basename>` for both `index.html` and `project.zip`.
4. Add or retain regression coverage for plain names, spaced names, nested directories, apostrophes, and unicode.
5. Re-run the focused compile regression suite and confirm the extracted viewer resolves every clip URL.

## Final Report
- Outcome: the current checkout does not reproduce the path mismatch.
- Root cause: the only plausible bug boundary is divergent viewer and zip path generation, but the current code already shares the same helper.
- Files changed: `ai-prompts/2026-09-15/generated/issue-01/report.md`
- Tests added or updated: none in this phase.
- Verification results: `cli/src/__tests__/video-compile.test.ts` passed, including archive extraction and nested path coverage.
- Remaining risks or follow-ups: if the issue exists in another snapshot, keep the fix isolated to the shared path helper and the regression tests.
