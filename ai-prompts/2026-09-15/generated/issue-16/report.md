# Issue 16 Phase 1 Report

Objective: confirm the failure boundary for Version info JSON emits the requested alias instead of the canonical id and hand off the next prompt with no extra assumptions.

## Outcome

The current checkout does not reproduce the alias leak. `cli/src/commands/version-info.ts` already writes `module.fullName` into the JSON payload, the focused Vitest slice passes for canonical input, alias input, human-readable output, and not-found cases, and the built CLI never reaches the payload on this tree because the module directories do not contain `VERSION` files. Both canonical and alias runtime probes stop at `Unable to determine version information`, while the not-found path still returns the expected JSON error.

## Root Cause

The historical defect boundary is the JSON serialization branch in `cli/src/commands/version-info.ts`. In the pre-mortem snapshot, that branch used the raw `moduleName` after `findModule()` resolved the module, so alias callers could get unstable machine-readable output. The safe boundary is to keep the JSON `module` field tied to the resolved module object and keep the human-readable header on the request string.

## Safe Boundary

- Keep JSON `module` set from `module.fullName`.
- Keep the human-readable banner and module heading on the requested `moduleName`.
- Preserve the existing not-found JSON error and the version metadata guard.
- Do not change module discovery or compatibility checks.

## Evidence Captured

- `cli/src/commands/version-info.ts:18-23` resolves the module and emits the not-found JSON error.
- `cli/src/commands/version-info.ts:60-76` writes the JSON payload with `module: module.fullName`.
- `cli/src/utils/module-system.ts:929-952` shows `findModule()` resolving canonical names and aliases before the command runs.
- `cli/dist/commands/version-info.js:47-90` matches the same JSON behavior in the built artifact that `bin/filmbuff.js` loads.
- `tests/unit/commands/version-info.test.ts:143-220` already covers canonical input, alias input, human-readable output, and not-found handling.
- `node scripts/run-vitest.js run tests/unit/commands/version-info.test.ts` passed with 1 file and 4 tests.
- `node bin/filmbuff.js version-info not-a-module --json` returned `{"error":"Module not found: not-a-module"}`.
- `node bin/filmbuff.js version-info action --json` and `node bin/filmbuff.js version-info writing-standards/screenplay/genres/action --json` both returned `{"error":"Unable to determine version information"}` because there are no `VERSION` files under `filmbuff/` in this checkout.

## Ordered Task List

1. Keep the JSON payload on the resolved canonical module id if any future snapshot still serializes the raw request string.
2. Keep the human-readable output tied to the caller's original module string.
3. Preserve the not-found and missing-version error paths exactly as they are now.
4. Maintain or add focused regression coverage for canonical lookups, alias lookups, human-readable output, and not-found JSON mode.
5. Re-run the focused version-info Vitest slice and the three CLI probes after any future change.

## Final Report

- Outcome: the current checkout does not reproduce the alias leak, and the live CLI stops earlier at the missing-version guard.
- Root cause: the historical bug would have been raw request-string serialization in the JSON `module` field after alias resolution.
- Files changed: `ai-prompts/2026-09-15/generated/issue-16/report.md`
- Tests added or updated: none.
- Verification results: source inspection, built-artifact inspection, focused Vitest, and runtime probes all completed as above.
- Remaining risks or follow-ups: if a future snapshot still uses `moduleName` in the JSON payload, keep the fix limited to that serialization branch and leave the text output and version guards alone.
