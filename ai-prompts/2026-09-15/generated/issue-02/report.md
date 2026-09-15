# Issue 02 Report

## Outcome
The hostile HTML injection boundary is the viewer render step in `buildIndexHtml()`, but this checkout already escapes `shotId`, `scene`, and `clipFile` before they enter the HTML document. The current output is therefore safe, and the issue is not reproducible in this snapshot.

## Root Cause
If `buildIndexHtml()` interpolated unescaped shot metadata directly into the `<h3>` content or the `<video src>` attribute, values containing `<`, `>`, quotes, apostrophes, or markup-like text could break the page or inject nodes. The fix boundary is the shared HTML escaping helper inside `cli/src/commands/video/compile.ts`, not the callers that assemble clip metadata.

## Evidence
- `cli/src/commands/video/compile.ts:89-116` defines `escapeHtml()` and applies it to `scene`, `shotId`, and `clipFile` before interpolation.
- `cli/src/__tests__/video-compile.test.ts:558-582` feeds hostile input containing `<script>`, quotes, apostrophes, and ampersands into `buildIndexHtml()` and asserts escaped text, safe `src` output, and zero `<script>` elements.
- Focused verification run: `node node_modules/jest/bin/jest.js cli/src/__tests__/video-compile.test.ts --runInBand` passed, including `[UT-VCOMP-03]`.

## Safe Boundary
- Keep escaping at the render boundary in `buildIndexHtml()`.
- Do not change the viewer layout or compile flow.
- Preserve literal display of user-provided scene names, shot ids, and clip names.
- If a future snapshot lacks `escapeHtml()`, add it only to the shared helper and keep the rest of the compile pipeline untouched.

## Ordered Task List
1. Confirm whether the target snapshot still lacks escaping at `buildIndexHtml()`.
2. If it does, add or restore `escapeHtml()` at that render boundary only.
3. Keep `scene`, `shotId`, and `clipFile` as literal text or safe attribute values.
4. Extend or retain regression coverage for special characters, quotes, apostrophes, and markup-like input.
5. Re-run the focused compile regression suite and verify no `<script>` nodes or broken viewer markup appear.

## Final Report
- Outcome: the current checkout does not reproduce the unsanitized HTML failure.
- Root cause: direct HTML interpolation would be unsafe, but the current source already escapes the untrusted values before rendering.
- Files changed: `ai-prompts/2026-09-15/generated/issue-02/report.md`
- Tests added or updated: none in this phase.
- Verification results: focused compile viewer tests passed, including hostile-input coverage.
- Remaining risks or follow-ups: if another snapshot still lacks escaping, the only safe fix is a minimal render-boundary escape in `buildIndexHtml()`.
