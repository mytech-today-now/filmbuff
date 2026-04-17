# Fix: Integer Duration Serialization in `filmbuff generate-shot-list`

**Repository:** `filmbuff` — `G:\_kyle\temp_documents\GitHub\filmbuff-project\filmbuff`
**Companion fix:** `ai-prompts/fb-ap-fix-duration-ai-powered.md` (applied in parallel — do NOT
duplicate changes across repos)

---

## Background

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
estimate with dialogue words → float: `14 words × 0.4 s/word = 5.600000000000001`).

### Root Cause

`duration-derivation.ts` P3a path returns a raw float from `clamp(shot.segmenterEstimateS, ...)`.
The value flows through `resolveVideoControls()` and `shotToBatchItem()` without rounding,
arriving in the JSON payload as a floating-point literal that the xAI API rejects.

### Batch Specification Reference

Read `filmbuff/docs/specs/batch-shot-list-spec.md` (v1.0.0) **before** making any code
changes. All changes must conform to §2 (`duration` integer contract, range `[3, 60]`).
Reference this file path and version in any new code comments touching the `duration` field.

---

## Implementation Order

Apply changes in this exact order.

### Change 1.1 — Round `duration` in `cli/src/lib/duration-derivation.ts`

**File:** `cli/src/lib/duration-derivation.ts`

In `deriveDuration()`, wrap the result of every `clamp()` call with `Math.round()`. Apply
to all four priority branches (P1–P4) for consistency. Do NOT change the `clamp()` helper
itself — it must remain general.

**P1 (shooting-script) — currently line 91:**
```typescript
// Before
const seconds = clamp(parsed, MIN_DURATION_S, MAX_DURATION_S);
// After — spec: filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2
const seconds = Math.round(clamp(parsed, MIN_DURATION_S, MAX_DURATION_S));
```

**P2 (beat-sheet) — currently line 105:**
```typescript
// Before (Math.round already on parsed, but wrap clamp result for consistency)
const seconds = clamp(Math.round(parsed), MIN_DURATION_S, MAX_DURATION_S);
// After
const seconds = Math.round(clamp(parsed, MIN_DURATION_S, MAX_DURATION_S));
```

**P3a (segmenter estimate) — currently line 120 — PRIMARY BUG FIX:**
```typescript
// Before
const seconds = clamp(shot.segmenterEstimateS, MIN_DURATION_S, MAX_DURATION_S);
// After — spec: filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2
const seconds = Math.round(clamp(shot.segmenterEstimateS, MIN_DURATION_S, MAX_DURATION_S));
```

**P3b (action-density) — currently line 135:**
```typescript
// Before
const seconds = clamp(rawEstimate, MIN_DURATION_S, MAX_DURATION_S);
// After
const seconds = Math.round(clamp(rawEstimate, MIN_DURATION_S, MAX_DURATION_S));
```

**P4 (fallback) — currently line 145:**
`FALLBACK_DURATION_S` is already `5` (integer constant). No change needed to the value;
optionally add `Math.round()` for defensive consistency:
```typescript
seconds: Math.round(FALLBACK_DURATION_S),
```

### Change 1.2 — Defensive round in `cli/src/lib/video-controls.ts`

**File:** `cli/src/lib/video-controls.ts`

In `resolveVideoControls()`, change the duration assignment (currently line 92):
```typescript
// Before
duration: durationResult.seconds
// After — secondary defense per filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2
duration: Math.round(durationResult.seconds)
```

### Change 1.3 — Defensive round in `cli/src/lib/batch-serializer.ts`

**File:** `cli/src/lib/batch-serializer.ts`

In `shotToBatchItem()`, change the `duration` assignment (currently line 153):
```typescript
// Before
duration: shot.controls.duration
// After — last-line-of-defense per filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2
duration: Math.round(shot.controls.duration)
```

### Change 1.4 — Round `duration.seconds` in JSON and JSONL formatters

**File:** `cli/src/commands/generate-shot-list/formatter/json-formatter.ts`

In `formatShot()`, change the `duration` object (currently line 101):
```typescript
duration: {
  seconds: Math.round(shot.duration),  // spec: batch-shot-list-spec.md v1.0.0 §2
  formatted: this.formatTime(shot.duration)
},
```

**File:** `cli/src/commands/generate-shot-list/formatter/jsonl-formatter.ts`

In `formatShot()`, change the `duration` object (currently line 81):
```typescript
duration: {
  seconds: Math.round(shot.duration),  // spec: batch-shot-list-spec.md v1.0.0 §2
  formatted: this.formatTime(shot.duration)
},
```

### Change 1.5 — Update tests

**File:** `cli/src/__tests__/duration-derivation.test.ts`

Add a new `describe` block for P3a integer assertions after the existing `deriveDuration()`
tests:

```typescript
describe('deriveDuration() — P3a segmenter estimate always returns integer seconds', () => {
  it('[UT-DD-INT-1] segmenterEstimateS 5.8 → integer (rounds to 6)', () => {
    const result = deriveDuration({ id: '1', segmenterEstimateS: 5.8 });
    expect(Number.isInteger(result.seconds)).toBe(true);
    expect(result.seconds).toBe(6);
  });

  it('[UT-DD-INT-2] segmenterEstimateS 5.800000000000001 → integer (rounds to 6)', () => {
    const result = deriveDuration({ id: '2', segmenterEstimateS: 5.800000000000001 });
    expect(Number.isInteger(result.seconds)).toBe(true);
    expect(result.seconds).toBe(6);
  });

  it('[UT-DD-INT-3] segmenterEstimateS 14.4 (14 words × 0.4/word + 2 action lines × 3s) → integer', () => {
    const result = deriveDuration({ id: '3', segmenterEstimateS: 14.4 });
    expect(Number.isInteger(result.seconds)).toBe(true);
    expect(result.seconds).toBe(14);
  });

  it('[UT-DD-INT-4] all priority branches return integer seconds', () => {
    const cases = [
      deriveDuration({ id: 'a', shootingScriptDuration: '0:30' }),
      deriveDuration({ id: 'b', beatSheetCue: '0:45' }),
      deriveDuration({ id: 'c', segmenterEstimateS: 5.800000000000001 }),
      deriveDuration({ id: 'd', actionLines: ['line 1', 'line 2'] }),
      deriveDuration({ id: 'e' }),
    ];
    for (const result of cases) {
      expect(Number.isInteger(result.seconds)).toBe(true);
    }
  });
});
```

**File:** `cli/src/__tests__/video-controls.test.ts`

Add integer assertions to the existing `[IT-VC-1]` round-trip test and add a new test:

```typescript
it('[IT-VC-1b] duration from segmenterEstimateS is an integer in resolved controls', () => {
  const durResult = deriveDuration({ id: '1', segmenterEstimateS: 5.800000000000001 });
  const controls = resolveVideoControls({}, durResult);
  expect(Number.isInteger(controls.duration)).toBe(true);
  expect(controls.duration).toBe(6);
});
```

**File:** `cli/src/__tests__/batch-serializer.test.ts`

Add a new `describe` block for integer duration assertions after the existing `shotToBatchItem()`
tests:

```typescript
describe('shotToBatchItem() — duration is always an integer (spec §2)', () => {
  it('[BS-DUR-1] duration is integer for dialogue-heavy shot (segmenter float input)', () => {
    const durResult = deriveDuration({ id: '1', segmenterEstimateS: 5.800000000000001 });
    const controls  = resolveVideoControls({}, durResult);
    const shot: ResolvedShot = {
      id: 'shot-1', heading: 'INT. CAFÉ - DAY',
      prompt: 'ANNA reads her script, mouthing lines.', controls
    };
    const item = shotToBatchItem(shot);
    expect(Number.isInteger(item.duration)).toBe(true);
    expect(item.duration).toBe(6);
  });

  it('[BS-DUR-2] serializeBatch — all items have integer duration for mixed shot types', () => {
    const shots: ResolvedShot[] = [
      {
        id: '1', heading: 'EXT. PARK - DAY', prompt: 'Birds scatter.',
        controls: resolveVideoControls({}, deriveDuration({ id: '1', shootingScriptDuration: '0:08' }))
      },
      {
        id: '2', heading: 'INT. BAR - NIGHT', prompt: 'MIKE argues with the bartender.',
        controls: resolveVideoControls({}, deriveDuration({ id: '2', segmenterEstimateS: 5.800000000000001 }))
      },
      {
        id: '3', heading: 'EXT. HILLTOP - DAWN', prompt: 'Wind whips the grass.',
        controls: resolveVideoControls({}, deriveDuration({ id: '3', segmenterEstimateS: 14.4 }))
      }
    ];
    const payload = serializeBatch(shots, 'xai', 'grok-video-beta');
    for (const item of payload.items) {
      expect(Number.isInteger(item.duration)).toBe(true);
    }
  });
});
```

---

## Acceptance Criteria

- [ ] `Number.isInteger(deriveDuration({ id: '1', segmenterEstimateS: 5.8 }).seconds)` → `true`
- [ ] `Number.isInteger(resolveVideoControls({}, { seconds: 5.8, source: 'action-density', notes: '' }).duration)` → `true`
- [ ] `Number.isInteger(shotToBatchItem(shot).duration)` → `true` for all shot fixtures
- [ ] `filmbuff generate-shot-list --input <screenplay> --format jsonl` produces JSONL where
  every `duration.seconds` value is a whole number
- [ ] All existing tests pass without modification (no regression)
- [ ] All new tests added in Change 1.5 pass
