# Issue 09 Phase 1 Report

Objective: confirm the failure boundary for hyphenated subcommands omitted from help and hand off the next prompt with no extra assumptions.

## Outcome

The current checkout is already on the safe boundary. The source now accepts hyphenated subcommand names in all help-discovery paths, so the historical `\w+` omission is not reproducible in this tree. `detectSubcommands()` returns `check-updates`, `generate-video`, and `mcp-server`, and `generateMarkdown()` renders those names into the help headings.

## Root Cause

The defect boundary is `cli/src/utils/extractCommandHelp.ts`.

- `SUBCOMMAND_PATTERNS` must accept hyphenated names in `Commands:`, `Available commands:`, and `Usage: { ... }` blocks.
- `extractCommandNames()` must preserve hyphenated command tokens when reading each command line.
- If any of those three matchers fall back to `\w+`, commands like `generate-video` and `mcp-server` are omitted from generated docs or truncated during nested discovery.

Relevant source evidence:

- `cli/src/utils/extractCommandHelp.ts:46-49`
- `cli/src/utils/extractCommandHelp.ts:113-126`
- `tests/unit/utils/extractCommandHelp.test.ts:95-143`

## Safe Boundary

- Keep the help format, tool ordering, deduplication, and recursion limit unchanged.
- Keep hyphenated names visible in both recursive discovery and rendered Markdown.
- If a future snapshot still shows `\w+`, change only the three help-pattern matchers and the per-line command matcher.
- Do not expand the scope to unrelated CLI help formatting or command execution behavior.

## Evidence Captured

Current runtime probe for the discovery path:

```text
["check-updates","generate-video","mcp-server"]
```

Current runtime probe for the renderer path:

```text
## filmbuff Commands (filmbuff)
### filmbuff --help
#### filmbuff generate-video --help
#### filmbuff mcp-server --help
```

Focused verification run:

```text
RUN  v4.1.10 C:/GitHub/filmbuff-project/filmbuff
Test Files  2 passed (2)
Tests  27 passed (27)
Duration  3.70s
```

## Files Changed

- `ai-prompts/2026-09-15/generated/issue-09/report.md`

## Tests Added or Updated

- None in this phase.

## Verification Results

- `npm run test:vitest -- tests/unit/utils/extractCommandHelp.test.ts tests/unit/utils/extractCommandHelp.integration.test.ts`
- The parser tests already cover hyphenated `Commands:` and `Usage:` forms.
- The renderer probe shows hyphenated commands remain present in generated help headings.

## Remaining Risks or Follow-ups

- The current checkout does not reproduce the historical omission.
- If another snapshot still contains `\w+`, the smallest safe fix is to widen only the three discovery regexes and the line matcher, then keep the existing nested help format intact.

## Ordered Task List

1. Re-check `cli/src/utils/extractCommandHelp.ts` in the target snapshot for any remaining `\w+`-only command matcher.
2. If present, widen only the `Commands:`, `Available commands:`, `Usage: { ... }`, and per-line command patterns to preserve hyphenated names.
3. Keep recursion depth, deduplication, and Markdown heading structure unchanged.
4. Preserve the current output order for `check-updates`, `generate-video`, and `mcp-server`.
5. Re-run the focused Vitest suite and confirm the rendered help still includes hyphenated names.

## Final Report

- Outcome: the current checkout already includes the hyphen-aware behavior, so the historical failure is not reproducible here.
- Root cause: a `\w+`-only matcher would drop hyphenated subcommands during help discovery, but this tree already uses hyphen-aware patterns.
- Files changed: `ai-prompts/2026-09-15/generated/issue-09/report.md`
- Tests added or updated: none.
- Verification results: source inspection, runtime probes, and the focused Vitest run all confirm hyphenated names are discovered and rendered.
- Remaining risks or follow-ups: if a different snapshot still has the old matcher, keep the fix narrowly scoped to the help parser.
