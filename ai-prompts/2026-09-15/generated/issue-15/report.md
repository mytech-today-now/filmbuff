# Issue 15 Phase 1 Report

Objective: confirm the failure boundary for the VS Code helper, then hand off the next prompt with no extra assumptions.

## Outcome

The live checkout is already on the safe side of the boundary. `cli/src/utils/vscode-editor.ts` now uses `execFileSync('code', args, ...)` for availability, open, focus, and version checks, so the shell-string failure described in the pre-mortem snapshot is not present in this tree. The focused regression slice passes and confirms exact argv forwarding for paths with spaces and shell metacharacters.

## Root Cause

The historical bug was shell-string composition around the VS Code CLI arguments instead of stable argv passing.

- The pre-mortem failure boundary was the helper building one shell command from `code` plus all arguments.
- That pattern is fragile for paths with spaces, apostrophes, ampersands, and other shell metacharacters because the shell can reinterpret the text before `code` sees it.
- The safe boundary is to keep the helper on `execFileSync('code', args, ...)` so each argument stays a single argv entry.
- Preview mode, reuse-window mode, focus, and version checks must keep their current behavior while remaining process-safe.

## Safe Boundary

- Preserve exact argv passing in `openInVSCode()`, `focusVSCode()`, `getVSCodeVersion()`, and `isVSCodeAvailable()`.
- Keep preview mode, reuse-window handling, line and column suffixes, and version parsing unchanged.
- Do not rebuild a shell command string from the argument list.
- Keep file paths with spaces, apostrophes, ampersands, and other metacharacters as a single argv entry.

## Evidence Captured

- `cli/src/utils/vscode-editor.ts:22-28` shows the availability check using `execFileSync('code', ['--version'], ...)`.
- `cli/src/utils/vscode-editor.ts:34-76` shows `openInVSCode()` resolving the file path, building an argv array, and calling `execFileSync('code', args, ...)`.
- `cli/src/utils/vscode-editor.ts:101-129` shows the focus and version helpers using the same process-safe invocation pattern.
- `tests/unit/utils/vscode-editor.test.ts:57-172` covers exact argv forwarding, preview mode, reuse behavior, editor mode, focus, version parsing, and availability.
- Focused verification passed: `npm run test:vitest -- tests/unit/utils/vscode-editor.test.ts` reported 1 file and 6 tests passing.
- A repo search found no alternate VS Code launcher path outside `cli/src/utils/vscode-editor.ts`.

## Files Changed

- `ai-prompts/2026-09-15/generated/issue-15/report.md`

## Tests Added or Updated

- None in this phase.

## Verification Results

- The focused Vitest regression slice passed.
- The current checkout does not reproduce the original shell-string failure boundary because the helper already uses argv execution.
- The existing regression coverage is enough to confirm the safe boundary for paths with spaces and metacharacters.

## Remaining Risks or Follow-ups

- Keep a regression test that fails if a future edit reintroduces `execSync` or shell-string composition.
- If a later prompt expects implementation work, it should be limited to preserving the current argv-based contract and its test coverage.

## Ordered Task List

1. Keep `openInVSCode()`, `focusVSCode()`, and `getVSCodeVersion()` on `execFileSync('code', args, ...)` and do not rebuild shell strings.
2. Preserve the current behavior for preview mode, reuse-window mode, line and column suffixes, and version reporting.
3. Retain or extend focused regression coverage for exact path passing, spaces, apostrophes, ampersands, and other metacharacters.

## Final Report

- Outcome: the live checkout already uses safe argv execution, so the historical shell-string failure boundary is not present in the current tree.
- Root cause: the pre-mortem bug was shell-string construction around the VS Code CLI arguments instead of stable argv passing.
- Files changed: `ai-prompts/2026-09-15/generated/issue-15/report.md`
- Tests added or updated: none.
- Verification results: the focused Vitest slice passed with 6 tests, confirming the current safe boundary.
- Remaining risks or follow-ups: keep regression coverage that would catch any future return to shell-string execution.
