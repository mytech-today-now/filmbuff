# Issue 12 Phase 1 Report

Objective: confirm the failure boundary for Upgrade only rewrites exact canonical names and hand off the next prompt with no extra assumptions.

## Outcome

The current checkout is already on the safe boundary. `cli/src/commands/upgrade.ts` resolves stored config names through `findModule()` before matching, so legacy alias records are rewritten to the canonical `module.fullName` and the stale exact-match failure described in the pre-mortem is not reproducible in this tree.

## Root Cause

The historical defect boundary is `cli/src/commands/upgrade.ts:145-160` plus `cli/src/commands/upgrade.ts:222-228`.

- The manifest sync path reads `.augment/extensions.json`, finds a matching entry, and rewrites that entry in place.
- `resolveConfiguredModuleName()` extracts `name` or `id`, resolves it through `findModule(storedName)`, and compares the resolved canonical `fullName` against `module.fullName`.
- `findModule()` in `cli/src/utils/module-system.ts:927-953` already supports canonical paths, suffix matches, and alias resolution, so upgrade reuses the shared module lookup instead of comparing raw strings.
- The rewrite branch preserves existing object fields and forces the canonical `name`, latest `version`, and `upgradedAt`.
- `tests/unit/commands/upgrade.test.ts:189-233` already covers a legacy alias record and asserts that the JSON report still returns `module: canonicalModuleName` with `configUpdated: true`.

The failure would only reappear if the manifest lookup fell back to a raw `entry.name === module.fullName` comparison or if future code stopped resolving stored aliases through `findModule()`.

## Safe Boundary

- Keep upgrade detection, compatibility checks, and reporting unchanged.
- Preserve the alias-aware manifest lookup and canonical rewrite.
- Keep the success path for already-canonical entries unchanged.
- Keep the recovery behavior for malformed or unwritable config unchanged.
- Do not broaden the fix into discovery or unrelated manifest commands.

## Evidence Captured

- Source inspection of `cli/src/commands/upgrade.ts:145-160, 222-228` confirmed the alias-aware canonical rewrite path is present.
- Source inspection of `cli/src/utils/module-system.ts:927-953` confirmed the shared module lookup resolves aliases before the upgrade rewrite runs.
- Source inspection of `tests/unit/commands/upgrade.test.ts:189-233` confirmed the legacy-alias regression case is already covered.
- Verification command: `node scripts/run-vitest.js run tests/unit/commands/upgrade.test.ts`
- Result: `Test Files 1 passed (1)` and `Tests 9 passed (9)`.

## Files Changed

- `ai-prompts/2026-09-15/generated/issue-12/report.md`

## Tests Added or Updated

- None in this phase.

## Verification Results

- Focused Vitest suite passed through the repo-local runner.
- A direct `pnpm test:vitest -- tests/unit/commands/upgrade.test.ts` attempt was blocked by Corepack EPERM on `C:\Users\kyle_\AppData\Local\node\corepack\lastKnownGood.json`, so the repository-local runner was used instead.
- The current checkout already reflects the canonical rewrite behavior, so there is no live stale-alias failure to reproduce here.

## Remaining Risks or Follow-ups

- If a future snapshot reintroduces a raw exact-match lookup, the regression boundary should stay limited to manifest entry resolution and rewrite only.
- Keep the alias-aware `findModule()` reuse intact so upgrade does not drift from the shared module resolution rules.

## Ordered Task List

1. Keep the manifest sync path in `cli/src/commands/upgrade.ts` using `findModule()`-backed alias resolution before comparing against `module.fullName`.
2. Keep the rewrite branch normalizing the matched entry to the canonical `name`, latest `version`, and fresh `upgradedAt`.
3. Keep the current JSON and text success/error reporting unchanged.
4. Keep the regression coverage for canonical input, alias-backed records, malformed config, missing `modules`, unwritable config, and dry-run behavior.
5. Re-run the focused upgrade Vitest suite after any future edit to confirm alias-backed records still rewrite canonically.

## Final Report

- Outcome: the current checkout is already on the safe boundary, and the alias-backed stale-name failure is not reproducible here.
- Root cause: the historical defect would have been a raw exact-match manifest lookup, but this tree already canonicalizes stored aliases through `findModule()` before rewriting.
- Files changed: `ai-prompts/2026-09-15/generated/issue-12/report.md`
- Tests added or updated: none.
- Verification results: source inspection and the focused Vitest suite both passed.
- Remaining risks or follow-ups: keep the fix scoped to manifest resolution and rewrite only if a future snapshot regresses.
