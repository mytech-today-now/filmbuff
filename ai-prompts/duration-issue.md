# Duration Bug Fix — AI Code Generation Prompt

## Overview

Two repositories must be fixed to resolve a `422` deserialization error that occurs when the xAI
Grok video API receives a floating-point `duration` value. The fix requires changes in both
`filmbuff` (the CLI that produces shot-list files) and `ai-powered` (the web UI that consumes them).
Both repos must also converge on a shared batch specification document that defines the canonical
`.jsonl`, `.json`, and `.md` shot-list interchange formats so that future developers have a
single source of truth.

**Do not implement partial changes.** All three deliverables — the `filmbuff` fix, the `ai-powered`
fix, and the batch specification document — must be produced together.

This prompt generates two implementation prompts:

| Output File | Target Repo | Subject |
|---|---|---|
| `ai-prompts/fb-ap-fix-duration-filmbuff.md` | `filmbuff` | Fix duration serialization in `generate-shot-list` |
| `ai-prompts/fb-ap-fix-duration-ai-powered.md` | `ai-powered` | Fix duration deserialization in Batch Video UI |

Both prompts must reference the shared batch specification that is created as part of this work.

---

## Observed Error

The following `422` error was returned by the xAI Grok video API when processing Shot 2 of 18 in
the **Batch Video Generation** UI (ai-powered web demo v0.1.0):

```
Error: All providers exhausted. Failures — xai: [xai] Video submit failed (422):
Failed to deserialize the JSON body into the target type:
  duration: PickFirst could not deserialize any variant:
    First:  invalid type: floating point `5.800000000000001`, expected i32
    Second: invalid type: floating point `5.800000000000001`, expected a string
at line 1 column 890
```

Shot 1 succeeded; Shot 2 failed. The batch stopped at 2 of 18 shots processed.

---

## Root Cause Analysis

### Why the value is a float

`filmbuff generate-shot-list` derives shot duration through a four-priority chain in
`cli/src/lib/duration-derivation.ts`:

| Priority | Source | Formula |
|---|---|---|
| P1 | Shooting-script M:SS annotation | `parseInt(minutes)*60 + parseInt(seconds)` → integer |
| P2 | Beat-sheet timing cue | Parsed M:SS → integer |
| P3a | SceneSegmenter estimate | `action_lines × 3 s + dialogue_words × 0.4 s/word` → **float** |
| P3b | Action-density formula | `5 + (n-1) × 2` → integer |
| P4 | Hard fallback | `5` → integer |

**P3a is the source of the bug.** When dialogue is present, the word-count formula multiplies by
`0.4`, producing irrational floating-point values (e.g., `14 words × 0.4 = 5.600000000000001`
due to IEEE 754 binary representation). That raw float flows through `resolveVideoControls()` and
`shotToBatchItem()` without rounding, arriving in the JSON payload as
`"duration": 5.800000000000001`.

### Why the API rejects it

The xAI Grok video API's `duration` field expects either:
- **`i32`** — a 32-bit signed integer (whole seconds), or
- **`string`** — a string representation of an integer (e.g., `"6"`)

A JSON floating-point literal satisfies neither branch of the `PickFirst` deserializer and
returns `422`.

### Why Shot 1 succeeded

Shot 1's duration was derived from a P1 shooting-script annotation, which always produces an
integer. Shot 2's duration came from the P3a segmenter estimate (dialogue-heavy shot), producing
the float.

---

## Repositories and Key Files

### `filmbuff` — `G:\_kyle\temp_documents\GitHub\filmbuff-project\filmbuff`

| File | Role in the Bug |
|---|---|
| `cli/src/lib/duration-derivation.ts` | Computes `DurationResult.seconds` — may return float |
| `cli/src/lib/video-controls.ts` | `resolveVideoControls()` — assigns `duration: durationResult.seconds` verbatim |
| `cli/src/lib/batch-serializer.ts` | `shotToBatchItem()` — writes `duration: shot.controls.duration` verbatim to JSON |
| `cli/src/commands/generate-shot-list.ts` | Orchestrates the pipeline; calls `deriveDuration` and `serializeBatch` |
| `cli/src/commands/generate-shot-list/formatter/jsonl-formatter.ts` | Emits `duration.seconds` in JSONL output |
| `cli/src/commands/generate-shot-list/formatter/json-formatter.ts` | Emits `duration.seconds` in JSON output |
| `cli/src/__tests__/batch-serializer.test.ts` | Must be updated to assert integer duration |
| `cli/src/__tests__/duration-derivation.test.ts` | Must be updated to assert integer clamping |
| `cli/src/__tests__/video-controls.test.ts` | Must be updated to assert integer duration on controls |

### `ai-powered` — `G:\_kyle\temp_documents\GitHub\ai-powered`

| File | Role in the Bug |
|---|---|
| Batch video submit handler | Constructs the JSON body sent to xAI; must coerce/round `duration` |
| Batch file parser (`.jsonl` / `.json` / `.md`) | Reads `duration` from uploaded shot-list files; must round on ingest |
| UI — Default constraints panel | `Duration (s)` input; must validate integer-only input |

---

## Shared Batch Specification

### Location

Create the specification file at:

```
filmbuff/docs/specs/batch-shot-list-spec.md
```

This file is the canonical contract between `filmbuff generate-shot-list` output and
`ai-powered` batch input. It must be version-controlled in the `filmbuff` repository and
cross-referenced from `ai-powered`'s README or contributing guide.

### Required Specification Content

The specification must define:

1. **Format overview** — description of the three supported interchange formats (`.jsonl`, `.json`,
   `.md`) and when each is appropriate.
2. **`duration` field contract** — explicitly states that `duration` MUST be a non-negative integer
   (whole seconds, range `[3, 60]`). Floating-point values are forbidden. Rational for this
   constraint: the xAI Grok API deserializes `duration` as `i32` or string integer only.
3. **Canonical JSONL schema** — annotated example of a single shot-list line with all required and
   optional fields, matching the shape produced by `filmbuff generate-shot-list --format jsonl`.
4. **Canonical JSON schema** — top-level wrapper with `metadata`, `summary`, and `shots` array,
   matching `filmbuff generate-shot-list --format json`.
5. **Canonical Markdown schema** — section structure matching `filmbuff generate-shot-list --format
   md`, including the `Video Controls:` table format and column definitions.
6. **Default constraints** — define the meaning of `"Default"` for `aspectRatio`, `resolution`,
   `quality`, and `fps`: the field is omitted from the JSON payload entirely, deferring to the
   provider's default. Contrast with `duration`, which is always present and always an integer.
7. **Version** — semantic version field (`1.0.0`) so that `ai-powered` can detect format
   compatibility.
8. **Consumer responsibilities** — states that `ai-powered` must treat any non-integer `duration`
   value as a parse error and round to the nearest integer before submission, as a defensive
   measure against future producer regressions.

---

## Fix 1 — `filmbuff generate-shot-list` (`fb-ap-fix-duration-filmbuff.md`)

The generated prompt file must instruct an AI agent to make the following changes to the
`filmbuff` repository.

### Change 1.1 — Round `duration` in `duration-derivation.ts`

In `deriveDuration()`, apply `Math.round()` to every returned `seconds` value **before** the
`clamp()` call, or wrap the result of `clamp()` with `Math.round()`. Either approach is acceptable
so long as `DurationResult.seconds` is always a safe integer after the function returns.

**Constraint:** Do not change the `clamp()` helper itself — it operates on arbitrary numbers and
must remain general.

**Example correction (illustrative):**

```typescript
// Before
const seconds = clamp(shot.segmenterEstimateS, MIN_DURATION_S, MAX_DURATION_S);

// After
const seconds = Math.round(clamp(shot.segmenterEstimateS, MIN_DURATION_S, MAX_DURATION_S));
```

Apply this pattern to all four priority branches (P1–P4) for consistency.

### Change 1.2 — Add defensive round in `batch-serializer.ts`

In `shotToBatchItem()`, change the `duration` assignment to:

```typescript
duration: Math.round(shot.controls.duration)
```

This is a secondary defense. The primary fix is in `duration-derivation.ts`; this catch ensures
future refactors do not silently reintroduce floats.

### Change 1.3 — Add defensive round in `video-controls.ts`

In `resolveVideoControls()`, round the duration when assigning it to `controls`:

```typescript
duration: Math.round(durationResult.seconds)
```

### Change 1.4 — Update JSON and JSONL formatters

In `json-formatter.ts` and `jsonl-formatter.ts`, the `duration.seconds` field emitted in the
output file must use `Math.round(shot.duration)` to guarantee the stored value is an integer. This
ensures that shot-list files on disk (which `ai-powered` ingests) are always spec-compliant.

### Change 1.5 — Update tests

Update the following test files to assert that `duration` is always a safe integer:

- **`cli/src/__tests__/duration-derivation.test.ts`** — add assertions that `result.seconds` is an
  integer (`Number.isInteger(result.seconds)`) for all P3a (segmenter) test cases that involve
  dialogue word counts.
- **`cli/src/__tests__/video-controls.test.ts`** — add assertions that `controls.duration` is an
  integer for the round-trip tests.
- **`cli/src/__tests__/batch-serializer.test.ts`** — add assertions that `item.duration` is an
  integer in all `shotToBatchItem()` and `serializeBatch()` tests. The existing test `[BS-4]`
  already asserts `expect(item.duration).toBe(20)` — add equivalent assertions for dialogue-heavy
  shots where float input is possible.

### Acceptance Criteria for Fix 1

- [ ] `Number.isInteger(deriveDuration({ id: '1', segmenterEstimateS: 5.8 }).seconds)` returns
  `true`.
- [ ] `Number.isInteger(resolveVideoControls({}, { seconds: 5.8, source: 'action-density',
  notes: '' }).duration)` returns `true`.
- [ ] `Number.isInteger(shotToBatchItem(shot).duration)` returns `true` for all shot fixtures.
- [ ] Running `filmbuff generate-shot-list --input <screenplay> --format jsonl` produces a JSONL
  file where every `duration` value (in `VideoControls` entries) is a whole number.
- [ ] All existing tests pass without modification (no regression).
- [ ] All new tests added in Change 1.5 pass.

---

## Fix 2 — `ai-powered` Batch Video UI (`fb-ap-fix-duration-ai-powered.md`)

The generated prompt file must instruct an AI agent to make the following changes to the
`ai-powered` repository.

### Change 2.1 — Round `duration` on batch file ingest

In the batch file parser that processes uploaded `.jsonl`, `.json`, and `.md` shot-list files,
apply `Math.round()` (or equivalent integer coercion) to any `duration` value read from the file
before it is stored in the in-memory batch state. This prevents malformed producer output from
reaching the xAI API.

Specifically: wherever a `duration` field is read from parsed JSON, replace the raw assignment
with a guarded integer coercion:

```typescript
duration: Number.isInteger(raw.duration) ? raw.duration : Math.round(raw.duration)
```

### Change 2.2 — Round `duration` in the xAI submit handler

Immediately before constructing the JSON body sent to the xAI video API, apply `Math.round()` to
the `duration` field of every batch item. This is the last-line-of-defense guard.

### Change 2.3 — Validate `Duration (s)` UI input

In the "Default constraints" panel, the `Duration (s)` text input currently accepts arbitrary
numeric input (e.g., `5` typed by the user). Add client-side validation to:

- Accept only positive integer values (`/^[1-9][0-9]*$/`).
- Display an inline error (`"Duration must be a whole number (e.g., 5)"`) if a float or
  non-numeric value is entered.
- Block batch submission if the duration field contains a non-integer.

### Change 2.4 — Improve the error message for `422` duration failures

In the error-handling path that processes the `422` response from the xAI API, add a detection
heuristic: if the error body contains `"expected i32"` or `"expected a string"` and the field name
is `"duration"`, surface a human-readable message:

```
Shot <N> failed: Duration must be a whole number of seconds. The value "<X>" is not
a valid integer. Re-generate the shot list with a corrected duration, or manually
edit the shot-list file to use an integer value.
```

### Acceptance Criteria for Fix 2

- [ ] Uploading a `.jsonl` file containing `"duration": 5.800000000000001` does not produce a
  `422` error; the value is silently rounded to `6` before submission.
- [ ] The UI `Duration (s)` input rejects `5.5` with an inline validation error.
- [ ] A `422` error caused by a float duration displays the human-readable message defined in
  Change 2.4 instead of the raw API error.
- [ ] Shot 1 still succeeds after this change (no regression for integer durations).
- [ ] All existing unit and integration tests for the batch video submit path pass.

---

## Batch Specification Placement — Both Prompts Must Reference It

Both generated prompt files must include a section instructing the implementing agent to:

1. Read `filmbuff/docs/specs/batch-shot-list-spec.md` before beginning any code changes.
2. Verify that their changes conform to the specification's `duration` contract (integer, `[3, 60]`
   seconds).
3. Reference the specification by file path and version in any new code comments that touch the
   `duration` field.

---

## Implementation Order

When generating the two prompt files, structure each one to implement changes in this order:

**For `fb-ap-fix-duration-filmbuff.md`:**
1. Create `filmbuff/docs/specs/batch-shot-list-spec.md` (the shared specification)
2. `cli/src/lib/duration-derivation.ts` — round all returned `seconds` values
3. `cli/src/lib/video-controls.ts` — round `duration` assignment
4. `cli/src/lib/batch-serializer.ts` — round `duration` in `shotToBatchItem()`
5. `cli/src/commands/generate-shot-list/formatter/json-formatter.ts` — round `duration.seconds`
6. `cli/src/commands/generate-shot-list/formatter/jsonl-formatter.ts` — round `duration.seconds`
7. `cli/src/__tests__/duration-derivation.test.ts` — add integer assertions for P3a cases
8. `cli/src/__tests__/video-controls.test.ts` — add integer assertions
9. `cli/src/__tests__/batch-serializer.test.ts` — add integer assertions

**For `fb-ap-fix-duration-ai-powered.md`:**
1. Read `filmbuff/docs/specs/batch-shot-list-spec.md` (reference only; do not modify)
2. Batch file parser — round `duration` on ingest (Change 2.1)
3. xAI submit handler — round `duration` immediately before API call (Change 2.2)
4. UI `Duration (s)` input — integer validation (Change 2.3)
5. Error handler — detect and surface float-duration `422` with human-readable message (Change 2.4)
6. Update or add tests for the ingest and submit paths

---

## Context for the Generated Prompts

Each generated prompt must include the following context block so the implementing agent has
sufficient background without needing to re-read this meta-prompt.

Include in both:
- The full error message from the **Observed Error** section above.
- A concise summary of the root cause (P3a float from dialogue word-count formula).
- The path and version of the batch specification document.
- The acceptance criteria for that prompt's fix.
- A note that the other repository's fix is being applied in parallel and the agent must not
  duplicate changes across repos.