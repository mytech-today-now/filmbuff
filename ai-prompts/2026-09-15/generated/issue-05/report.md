# Issue 05 Phase 1 Report

Objective: confirm the failure boundary for project-agnostic validation missing source files and hand off the next prompt with no extra assumptions.

## Outcome

The current checkout is already on the safe boundary. The historical failure boundary lives in `validateProjectAgnostic()` inside `cli/src/utils/module-system.ts`: if the directory walk only admits `.md` and `.json`, TypeScript module files under `utils/`, `scripts/`, and similar source folders are skipped, so hardcoded paths and URLs inside those files never surface as warnings. The present branch has already widened the whitelist to include `.ts`, `.tsx`, `.mts`, and `.cts`, so the exact blind spot described in the issue summary is not reproducible here.

## Root Cause

- The validator is file-selection driven, not regex-driven.
- Anything outside the scan whitelist is invisible to `scanDirectory()`, so the defect is in source discovery, not in the path or URL detection rules themselves.
- Source evidence:
  - `cli/src/commands/validate.ts:69-71` routes module validation into `validateProjectAgnostic(module.path)`.
  - `cli/src/utils/module-system.ts:1235-1297` defines the project-agnostic file whitelist and recursive scan.
  - `tests/unit/config/validation.test.ts:397-470` asserts that TypeScript source is scanned while `notes.txt` stays ignored.
  - `tests/integration/cli/validate-command.test.ts:78-182` drives the CLI and checks for the `file-organization.ts` warnings.
- The current source already includes source-file extensions in the whitelist, which closes the original missing-source-file boundary.

## Safe Boundary

- Keep the `validateCommand` to `validateProjectAgnostic()` flow unchanged.
- Keep the validation categories and console output format intact.
- Keep the scan limited to authored text and source files.
- Do not broaden the pass to generated artifacts, binary files, or unrelated command behavior.
- Preserve the current exclusion of `notes.txt` and other non-target files.

## Evidence Captured

- Source inspection confirmed the current file-selection gate in `cli/src/utils/module-system.ts`.
- The focused regression suite passed:

```text
> @mytechtoday/filmbuff@2.5.5 test:vitest
> node scripts/run-vitest.js run tests/unit/config/validation.test.ts tests/integration/cli/validate-command.test.ts

Test Files  2 passed (2)
Tests       34 passed (34)
Duration    13.42s
```

- The integration test asserts the CLI output contains:
  - `Potential hardcoded path in file-organization.ts`
  - `Potential project-specific URL in file-organization.ts`
- The same fixture also confirms `notes.txt` is ignored.

## Files Changed

- `ai-prompts/2026-09-15/generated/issue-05/report.md`

## Tests Added or Updated

- None in this phase.

## Verification Results

- `npm run test:vitest -- tests/unit/config/validation.test.ts tests/integration/cli/validate-command.test.ts`
- Result: passed, with 2 test files and 34 tests passing.
- No code change was required to confirm the current boundary.

## Remaining Risks or Follow-ups

- If future module trees add other authored source extensions such as `.js`, `.jsx`, `.mjs`, or `.cjs`, the whitelist will need an explicit decision.
- If the validator output format changes, the integration assertions around `file-organization.ts` should be updated in lockstep.
- A future refactor that bypasses the whitelist in `validateProjectAgnostic()` would reintroduce the original blind spot.

## Ordered Task List

1. Keep `cli/src/commands/validate.ts` invoking `validateProjectAgnostic()` as the project-agnostic gate.
2. Preserve the file-selection whitelist in `cli/src/utils/module-system.ts` so authored source files remain in scope and non-source artifacts stay out.
3. Retain regression coverage for `file-organization.ts` and the ignored `notes.txt` path in the unit and integration tests.
4. Re-run the focused Vitest suite after any future change to `cli/src/utils/module-system.ts` or `cli/src/commands/validate.ts`.

## Final Report

- Outcome: the current checkout is already on the safe boundary, and the original source-file blind spot is not reproducible here.
- Root cause: the defect would come from an extension-based file-selection gate that excludes source files from `validateProjectAgnostic()`.
- Files changed: `ai-prompts/2026-09-15/generated/issue-05/report.md`
- Tests added or updated: none.
- Verification results: focused Vitest suite passed, 2 files and 34 tests.
- Remaining risks or follow-ups: keep the whitelist and CLI assertions aligned if new source extensions or output formatting are introduced.
