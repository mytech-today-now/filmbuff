# JIRA Ticket: FB-DUR-1 — Fix Floating-Point `duration` Serialization in `generate-shot-list`

---

## Summary

`filmbuff generate-shot-list` emits floating-point `duration` values (e.g., `5.800000000000001`)
in shot-list output files when the P3a SceneSegmenter estimate uses the dialogue word-count
formula (`words × 0.4 s/word`). The xAI Grok video API rejects these values with a `422`
deserialization error because its `duration` field expects either an `i32` integer or a string
integer, not a JSON floating-point literal. This ticket applies `Math.round()` at every point
in the `filmbuff` pipeline where `duration` is computed, assigned, or serialized to disk.

---

## Issue Type

`Bug`

## Priority

`High`

## Story Points

`5`

## Component / Labels

`filmbuff-cli` · `generate-shot-list` · `duration-derivation` · `batch-serializer` · `xai-api` · `422-fix` · `ai-powered-integration`

## Epic Link

`[EPIC] filmbuff × ai-powered Video Generation Integration`

---

## Background & Motivation

### Observed Error

The following `422` error was returned by the xAI Grok video API when processing Shot 2 of 18
in the Batch Video Generation UI (ai-powered web demo v0.1.0):

```
Error: All providers exhausted. Failures — xai: [xai] Video submit failed (422):
Failed to deserialize the JSON body into the target type:
  duration: PickFirst could not deserialize any variant:
    First:  invalid type: floating point `5.800000000000001`, expected i32
    Second: invalid type: floating point `5.800000000000001`, expected a string
at line 1 column 890
```

Shot 1 succeeded (P1 shooting-script annotation → integer). Shot 2 failed (P3a segmenter
estimate with dialogue words → `14 words × 0.4 s/word = 5.600000000000001` due to IEEE 754).

### Root Cause

`duration-derivation.ts` P3a path returns the result of `clamp(shot.segmenterEstimateS, ...)` 
without rounding. When `segmenterEstimateS` is a product of the `0.4 s/word` dialogue formula, 
the value is an irrational IEEE 754 float. That raw float flows verbatim through 
`resolveVideoControls()` → `shotToBatchItem()` → the shot-list output files and the 
`POST /batch` payload, arriving at the xAI API as a floating-point JSON literal.

### Specification

The shared batch interchange specification at `filmbuff/docs/specs/batch-shot-list-spec.md`
(v1.0.0, §2) defines the canonical `duration` contract:

> `duration` MUST be a non-negative integer (whole seconds), range `[3, 60]`. 
> Floating-point values are strictly prohibited.

Reference: `ai-prompts/fb-ap-fix-duration-filmbuff.md`

---

## Detailed Requirements

### DR-1 — Round `duration` in `duration-derivation.ts`

Wrap every `clamp()` result in `deriveDuration()` with `Math.round()` across all four
priority branches (P1–P4). The `clamp()` helper must NOT be modified — it must remain
general-purpose. The `DurationResult.seconds` field must always be a safe integer
(`Number.isInteger(result.seconds) === true`) after `deriveDuration()` returns.

**P3a (primary fix):**
```typescript
// Before
const seconds = clamp(shot.segmenterEstimateS, MIN_DURATION_S, MAX_DURATION_S);
// After — spec: filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2
const seconds = Math.round(clamp(shot.segmenterEstimateS, MIN_DURATION_S, MAX_DURATION_S));
```

Apply the same `Math.round(clamp(...))` pattern to P1, P2, and P3b for consistency.

### DR-2 — Defensive round in `video-controls.ts`

In `resolveVideoControls()`, change the `duration` assignment from `durationResult.seconds`
to `Math.round(durationResult.seconds)`. This is a secondary defense to prevent future
refactors from silently reintroducing floats at this layer.

### DR-3 — Defensive round in `batch-serializer.ts`

In `shotToBatchItem()`, change the `duration` field from `shot.controls.duration` to
`Math.round(shot.controls.duration)`. This is the last-line-of-defense guard at the
serialization boundary.

### DR-4 — Round `duration.seconds` in formatters

In both `json-formatter.ts` and `jsonl-formatter.ts`, change the `duration.seconds` emission:

```typescript
// Before
duration: { seconds: shot.duration, formatted: this.formatTime(shot.duration) }
// After — spec: filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2
duration: { seconds: Math.round(shot.duration), formatted: this.formatTime(shot.duration) }
```

This ensures shot-list files written to disk are always spec-compliant before `ai-powered`
ingests them.

---

## File Impact

| File | Change |
|------|--------|
| `cli/src/lib/duration-derivation.ts` | Wrap all `clamp()` calls in `deriveDuration()` with `Math.round()` (P1–P4) |
| `cli/src/lib/video-controls.ts` | `Math.round(durationResult.seconds)` in `resolveVideoControls()` |
| `cli/src/lib/batch-serializer.ts` | `Math.round(shot.controls.duration)` in `shotToBatchItem()` |
| `cli/src/commands/generate-shot-list/formatter/json-formatter.ts` | `Math.round(shot.duration)` for `duration.seconds` |
| `cli/src/commands/generate-shot-list/formatter/jsonl-formatter.ts` | `Math.round(shot.duration)` for `duration.seconds` |
| `cli/src/__tests__/duration-derivation.test.ts` | Add `[UT-DD-INT-1..4]` — `Number.isInteger()` assertions for all P3a segmenter cases |
| `cli/src/__tests__/video-controls.test.ts` | Add `[IT-VC-1b]` — integer assertion for segmenter float round-trip |
| `cli/src/__tests__/batch-serializer.test.ts` | Add `[BS-DUR-1..2]` — integer assertions for dialogue-heavy shots |

---

## Acceptance Criteria

- [ ] `Number.isInteger(deriveDuration({ id: '1', segmenterEstimateS: 5.8 }).seconds)` → `true`
- [ ] `Number.isInteger(deriveDuration({ id: '2', segmenterEstimateS: 5.800000000000001 }).seconds)` → `true` with value `6`
- [ ] `Number.isInteger(resolveVideoControls({}, { seconds: 5.8, source: 'action-density', notes: '' }).duration)` → `true`
- [ ] `Number.isInteger(shotToBatchItem(shot).duration)` → `true` for all shot fixtures including dialogue-heavy shots
- [ ] `filmbuff generate-shot-list --input <screenplay> --format jsonl` produces JSONL where every `duration.seconds` value is a whole number
- [ ] `filmbuff generate-shot-list --input <screenplay> --format json` produces JSON where every `shots[n].duration.seconds` is a whole number
- [ ] All existing tests pass without modification (no regression)
- [ ] All new tests `[UT-DD-INT-1..4]`, `[IT-VC-1b]`, `[BS-DUR-1..2]` pass

---

## Out of Scope

- Changes to the `ai-powered` repository (covered by companion ticket `FB-DUR-2`)
- Changes to `clamp()` helper signature or behavior
- Changes to the `formatTime()` helper or `duration.formatted` display strings
- Any modification to the Markdown formatter (`markdown-formatter.ts`) — the Video Controls table already emits the duration as a string that `renderVideoControlsTable` receives as a number and formats correctly

---

## Dependencies / Related

| Ticket / Artifact | Relationship |
|-------------------|-------------|
| `FB-DUR-2` (ai-powered companion) | Parallel fix — defensive ingest rounding + xAI submit guard + UI validation |
| `filmbuff/docs/specs/batch-shot-list-spec.md` v1.0.0 | Canonical `duration` integer contract (§2) |
| `ai-prompts/fb-ap-fix-duration-filmbuff.md` | Full implementation prompt with code examples |
| `ai-prompts/duration-issue.md` | Root-cause analysis and meta-prompt |
| `FB-SHOT-9` | Original ticket that introduced the Video Controls block and batch serialization |
