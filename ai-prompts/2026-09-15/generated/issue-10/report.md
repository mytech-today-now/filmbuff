# Issue 10 Phase 1 Report

Objective: confirm the failure boundary for Update skips legacy linked modules and hand off the next prompt with no extra assumptions.

## Outcome

The failure reproduces in the current checkout. A linked entry that still stores the legacy slug `screenplay-genre-action` is treated as externally managed even though the local module exists at `filmbuff/writing-standards/screenplay/genres/action`. The update flow never resolves that stale slug to a local module source, so `updateModule()` exits through the no-local-source guard instead of rewriting the manifest entry.

## Root Cause

The defect boundary is `cli/src/commands/update.ts` together with `cli/src/utils/module-system.ts`.

- `resolveLinkedModule()` only asks `findModule(storedName)` to locate the source module.
- `findModule()` understands direct module paths, exact `fullName` suffixes, and filename alias stems from `rules/*.md`, but it does not look at the legacy `module.json.name` value `screenplay-genre-action`.
- The current Action module still advertises that stale slug in `filmbuff/writing-standards/screenplay/genres/action/module.json:2`.
- When the lookup returns `null`, `updateModule()` logs `No local source (externally managed, skipping)` and returns `up-to-date`, so the stale manifest entry never gets rewritten.
- Existing tests cover the shorter alias `action` and the renamed-source path, but not the stale slug stored in the manifest.

Relevant source evidence:

- `cli/src/commands/update.ts:66-69`
- `cli/src/commands/update.ts:176-188`
- `cli/src/commands/update.ts:246-257`
- `cli/src/utils/module-system.ts:929-952`
- `filmbuff/writing-standards/screenplay/genres/action/module.json:1-3`
- `tests/integration/cli/update-command.test.ts:144-221`
- `tests/unit/commands/update.test.ts:200-252`

## Safe Boundary

- Keep the CLI update workflow, config schema, and existing output format intact.
- Fix only the linked-module resolution path for update so stale manifest slugs can map to the local module before the external-managed guard runs.
- Preserve the skip behavior for truly external modules with no local source.
- Preserve the current success path for canonical names like `writing-standards/screenplay/genres/action`.
- Keep the fix localized to update resolution and manifest rewrite behavior. Do not broaden module discovery elsewhere.

## Evidence Captured

Direct resolver probe from the built dist tree:

```text
screenplay-genre-action => null
action => writing-standards/screenplay/genres/action
writing-standards/screenplay/genres/action => writing-standards/screenplay/genres/action
```

Isolated CLI repro with a legacy stored name in `.augment/extensions.json`:

```text
🔄 Updating modules...
○ screenplay-genre-action: No local source (externally managed, skipping)
✨ Update complete!
Updated: 0 Up to date: 1
```

Isolated CLI repro with the canonical current name:

```text
🔄 Updating modules...
✓ writing-standards/screenplay/genres/action: Updated 1.0.0 → 2.0.0
✨ Update complete!
Updated: 1 Up to date: 0
```

## Files Changed

- `ai-prompts/2026-09-15/generated/issue-10/report.md`

## Tests Added or Updated

- None in this phase.

## Verification Results

- Source inspection of `cli/src/commands/update.ts`, `cli/src/utils/module-system.ts`, and `filmbuff/writing-standards/screenplay/genres/action/module.json`.
- Direct `findModule()` probe showed the legacy slug does not resolve even though the canonical alias and full path do.
- Direct CLI runs in isolated temp projects reproduced the skip for `screenplay-genre-action` and the success path for `writing-standards/screenplay/genres/action`.

## Remaining Risks or Follow-ups

- The current update logic still needs a narrow fix that keeps genuine external modules skipped.
- Regression coverage should lock the stale-slug case, the current canonical path, and the all-modules discovery flow together.
- If resolution is widened too far, unrelated module names could start matching incorrectly, so the later fix should stay exact.

## Ordered Task List

1. Add a focused regression fixture that stores `screenplay-genre-action` in `.augment/extensions.json` while the local module stays at `writing-standards/screenplay/genres/action`.
2. Update the update-resolution path so stale manifest slugs resolve to the local module before `updateModule()` applies the external-source guard.
3. Keep the current canonical `writing-standards/screenplay/genres/action` and alias `action` cases passing, and preserve the skip behavior for a truly external record.
4. Cover both the targeted `--module` flow and the discovery flow that updates every linked module from `.augment/extensions.json`.
5. Re-run the narrow unit and CLI regression checks first, then broaden only if a new failure appears.

## Final Report

- Outcome: the current checkout reproduces the failure boundary, and the stale slug `screenplay-genre-action` is skipped even though a local module exists.
- Root cause: update resolution only understands path, suffix, and filename-alias lookups, so it misses the legacy `module.json.name` value used by the current Action module.
- Files changed: `ai-prompts/2026-09-15/generated/issue-10/report.md`
- Tests added or updated: none.
- Verification results: source inspection, a direct resolver probe, and two isolated CLI runs confirmed both the failure and the clean path.
- Remaining risks or follow-ups: keep the eventual fix scoped to update resolution and leave the external-module skip behavior intact.
