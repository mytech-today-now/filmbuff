# [FEAT] Supply Reference Images for I2V Batch Generation in FilmBuff

---

## Context and Purpose

The `ai-powered` backend is receiving a new feature described in full in:

> **`G:\_kyle\temp_documents\GitHub\ai-powered\ai-prompts\accept-uploaded-batch-images-JIRA.md`**

That JIRA ticket adds **image-to-video (I2V)** support to the `POST /batch` endpoint via a `references` asset map, extends `BatchItemSchema` to accept `images?: string[]` per shot, and teaches three video providers (Grok, LumaAI, Venice) to use those images as seed frames.

This prompt instructs the AI agent in the `filmbuff` repository to create a **corresponding PR** so that FilmBuff's CLI output conforms to the new schema and can drive I2V generation end-to-end.

---

## Scope

The `filmbuff` codebase already produces batch payloads for `ai-powered` via `cli/src/lib/batch-serializer.ts`. The `BatchItem` and `ResolvedShot` types in that file do **not** yet include an `images` field. FilmBuff also generates JSONL shot-list output (`cli/src/commands/generate-shot-list/formatter/jsonl-formatter.ts`) that can be uploaded to the `ai-powered` web UI — that output needs to be compatible with the new `references` sentinel format.

No changes are needed to the screenplay parsers (`.fountain`, `.fdx`, `.rtf`) or to the shot-list generator AI prompts. Only the serialization and formatting layers change.

---

## Authoritative Reference

Read the full JIRA ticket at the path above before starting any task. Pay particular attention to:

- **TASK-1** — the `_buildItem()` helper and the three `images` resolution strategies (key array, plain object, literal URL list).
- **TASK-4** — `BatchItemSchema` shape: `images: z.array(z.string().url()).optional()`.
- **TASK-5** — how `POST /batch` uses `options.messages` + `options.images` together.
- **Schema C** — the JSONL `{"_type":"references",…}` sentinel format.

---

## Task Breakdown

Tasks must be completed in order. Each task states its dependencies.

---

### TASK-A · Extend `ResolvedShot` and `BatchItem` with `images` field

**Priority:** P1 · **Blocks:** TASK-B, TASK-C · **Blocked by:** _nothing_

**File:** `cli/src/lib/batch-serializer.ts`

**Changes:**

1. Add an optional `images` field to `ResolvedShot`:

```ts
export interface ResolvedShot {
  id: string;
  heading: string;
  prompt: string;
  controls: VideoControls;
  /**
   * Ordered image URLs to use as I2V seed frames for this shot.
   * Resolved from a project-level references map before serialization.
   * First URL is the primary seed frame sent to the provider.
   */
  images?: string[];
}
```

2. Add `images?: string[]` to `BatchItem`:

```ts
export interface BatchItem {
  id: string;
  modality: 'video';
  name: string;
  prompt: string;
  duration: number;
  aspectRatio: string;
  resolution: string;
  quality: string;
  fps: number;
  /**
   * Ordered image URLs for I2V seed frames.
   * Present only when the shot carries visual reference anchors.
   * Matches the `images` field accepted by ai-powered BatchItemSchema.
   */
  images?: string[];
}
```

3. Update `shotToBatchItem()` to forward `images`:

```ts
export function shotToBatchItem(shot: ResolvedShot): BatchItem {
  return {
    id:          shot.id,
    modality:    'video',
    name:        shot.heading,
    prompt:      shot.prompt,
    duration:    shot.controls.duration,
    aspectRatio: shot.controls.aspectRatio,
    resolution:  shot.controls.resolution,
    quality:     shot.controls.quality,
    fps:         shot.controls.fps,
    ...(shot.images && shot.images.length > 0 ? { images: shot.images } : {}),
  };
}
```

4. Update `validateBatchPayload()` — inside the per-item loop, add:

```ts
if (it.images !== undefined) {
  if (!Array.isArray(it.images)) {
    errors.push(`items[${idx}].images must be an array`);
  } else {
    (it.images as unknown[]).forEach((url, ui) => {
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        errors.push(`items[${idx}].images[${ui}] must be an http(s) URL`);
      }
    });
  }
}
```

**Acceptance checks:**
- `shotToBatchItem({ …, images: ['https://a.jpg'] })` → `BatchItem.images === ['https://a.jpg']`
- `shotToBatchItem({ …, images: [] })` → no `images` key on output (empty array guard)
- `shotToBatchItem({ … })` (no images) → no `images` key on output
- `validateBatchPayload` rejects `images: ['not-a-url']` with an error string
- `validateBatchPayload` accepts `images: ['https://cdn.example.com/hero.jpg']`
- `validateBatchPayload` accepts items with no `images` field (backward compat)

---

### TASK-B · Extend JSONL formatter to emit `references` sentinel

**Priority:** P1 · **Blocks:** TASK-D · **Blocked by:** TASK-A

**File:** `cli/src/commands/generate-shot-list/formatter/jsonl-formatter.ts`

**Why:** When FilmBuff generates a JSONL shot list that is later uploaded to the `ai-powered` web UI, the file must include a `{"_type":"references",…}` sentinel on the first line so `ai-powered`'s `parseJsonFile()` can resolve per-shot key arrays into `images[]`.

**Changes:**

1. Add an optional `references` parameter to the `format()` method signature:

```ts
format(
  shotList: ShotList,
  options?: FormatterOptions & { references?: Record<string, string> }
): string
```

2. When `options.references` is a non-empty plain object, prepend a sentinel line:

```ts
const sentinel = options?.references && Object.keys(options.references).length > 0
  ? JSON.stringify({ _type: 'references', ...options.references }) + '\n'
  : '';
return sentinel + lines.join('\n');
```

3. The per-shot line logic is unchanged except: when a shot carries `images` (passed through from `ResolvedShot` via the generator), include `"references": <keys>` or `"images": <urls>` in the line object, matching the format the `ai-powered` parsers expect.

**Schema C conformance example:**
```jsonl
{"_type":"references","Hero":"https://cdn.example.com/hero.jpg","Lake":"https://cdn.example.com/lake.jpg"}
{"name":"Shot 01","prompt":"Hero stands at the lake.","modality":"video","references":["Hero","Lake"],"duration":5,"aspectRatio":"16:9"}
{"name":"Shot 02","prompt":"Aerial wide. No references.","modality":"video","duration":8,"aspectRatio":"16:9"}
```

**Acceptance checks:**
- `format(shotList, { references: { Hero: 'https://…' } })` → first line is `{"_type":"references","Hero":"https://…"}`
- `format(shotList, {})` → no sentinel line; output unchanged from current behavior
- Shots with no images produce no `references` key in their line

---

### TASK-C · Add `references` loading helper to batch submission path

**Priority:** P2 · **Blocks:** TASK-D · **Blocked by:** TASK-A

**File:** `cli/src/lib/batch-serializer.ts` (new exported function)

Add a helper that resolves a project-level references map onto a list of shots. This is the client-side equivalent of `_buildItem()` in the upstream JIRA spec — it runs inside filmbuff before payload serialization, not inside ai-powered.

```ts
/**
 * Resolve a project-level key→URL references map onto a list of ResolvedShots.
 * For each shot, if shot.images is already set it is left unchanged (escape hatch).
 * Otherwise, if the shot carries a `referenceKeys` property (string[]), those keys
 * are looked up in the global map and the resolved URLs become shot.images.
 *
 * @param shots       - shots as returned by the generator pipeline
 * @param globalRefs  - project-level key→URL map (e.g. loaded from references.json)
 */
export function resolveReferenceImages(
  shots: ResolvedShot[],
  globalRefs: Record<string, string>
): ResolvedShot[] {
  return shots.map(shot => {
    if (shot.images && shot.images.length > 0) return shot; // already resolved
    const keys: string[] = (shot as any).referenceKeys ?? [];
    if (keys.length === 0) return shot;
    const images = keys.map(k => globalRefs[k]).filter((u): u is string => Boolean(u));
    return images.length > 0 ? { ...shot, images } : shot;
  });
}
```

**Note:** `referenceKeys` is an informal escape-hatch field. Full support (parsing it from generator metadata) is out of scope for this PR; the function is wired up and tested so the next phase can use it without another type-layer change.

---

### TASK-D · Write unit tests

**Priority:** P1 · **Blocks:** TASK-E · **Blocked by:** TASK-A, TASK-B, TASK-C

**Files:**
- `cli/src/__tests__/batch-serializer.test.ts` — create if it does not exist; extend if it does
- `cli/src/commands/generate-shot-list/formatter/__tests__/jsonl-formatter.test.ts` — extend if it exists

#### `batch-serializer` test cases

| Test ID | Scenario | Assert |
|---|---|---|
| BS-I2V-01 | `shotToBatchItem` with `images: ['https://a.jpg']` | `BatchItem.images === ['https://a.jpg']` |
| BS-I2V-02 | `shotToBatchItem` with `images: []` | No `images` key on output |
| BS-I2V-03 | `shotToBatchItem` with no `images` field | No `images` key on output |
| BS-I2V-04 | `validateBatchPayload` with valid `images` URL | No errors |
| BS-I2V-05 | `validateBatchPayload` with `images: ['not-a-url']` | Error message about URL |
| BS-I2V-06 | `validateBatchPayload` with item missing `images` | No errors (backward compat) |
| BS-I2V-07 | `resolveReferenceImages` with key array | Correct URLs resolved from globalRefs |
| BS-I2V-08 | `resolveReferenceImages` with unknown key | Unknown dropped; known resolved |
| BS-I2V-09 | `resolveReferenceImages` shot already has `images` | Left unchanged |

#### JSONL formatter test cases

| Test ID | Scenario | Assert |
|---|---|---|
| JF-I2V-01 | `format(…, { references: { Hero: 'https://cdn.example.com/hero.jpg' } })` | First line is sentinel with `_type:"references"` |
| JF-I2V-02 | `format(…, {})` | No sentinel; output identical to current behavior |
| JF-I2V-03 | `format(…, { references: {} })` | No sentinel (empty-object guard) |

---

### TASK-E · Run full test suite and verify zero regressions

**Priority:** P1 · **Blocks:** _nothing_ · **Blocked by:** TASK-D

```powershell
npm test
```

**Pass criteria:** All existing tests pass. All new BS-I2V-* and JF-I2V-* tests pass. Zero regressions.

---

## Data-Flow Overview (FilmBuff → ai-powered)

```
filmbuff generate-shot-list (screenplay input)
        │
        ▼
ResolvedShot[]  (generator pipeline output)
  + optional: resolveReferenceImages(shots, globalRefs)  [TASK-C]
        │
        ├──► CLI direct batch submission
        │      shotToBatchItem()                         [TASK-A]
        │        BatchItem { …, images?: string[] }
        │      → POST /batch
        │          ai-powered BatchItemSchema validates images[]
        │          → options.messages + options.images built
        │          → provider.generateVideo(prompt, { images, messages })
        │             GrokProvider  → _extractImageDataUri(messages) → I2V
        │             LumaAIProvider → generateVideoFromImage(images[0]) → I2V
        │             VeniceProvider → POST /video/queue { image_url } → poll → I2V
        │
        └──► JSONL formatter output                      [TASK-B]
               {"_type":"references",…} sentinel line
               + per-shot lines with "references":[keys]
               → user uploads to ai-powered web UI
               → web parseJsonFile() resolves keys → images[]
               → same POST /batch path as above
```

---

## File Format Schemas (for manual JSONL authoring and test fixtures)

### Schema C — JSONL (required output of TASK-B)

```jsonl
{"_type":"references","Sarah":"https://cdn.example.com/cast/sarah-athletic.jpg","lake-sunrise":"https://cdn.example.com/scenes/alpine-lake-dawn.jpg"}
{"name":"Shot 01","prompt":"Sarah paddles across the glass-still lake at dawn.","modality":"video","references":["Sarah","lake-sunrise"],"duration":5,"aspectRatio":"16:9"}
{"name":"Shot 02","prompt":"Aerial wide pull-back revealing the mountain range.","modality":"video","duration":8,"aspectRatio":"16:9"}
```

Parser rules (from ai-powered JIRA, for reference):
- `_type:"references"` sentinel consumed as global map; `_type` key stripped; not emitted as a shot.
- Subsequent lines parsed as shots; per-shot `references` arrays resolved against accumulated global map.
- Shots without `references` or `images` → text-to-video (no `images` key on the resolved item).

---

## Acceptance Criteria

- [ ] **AC-A1** `BatchItem` interface has `images?: string[]`.
- [ ] **AC-A2** `ResolvedShot` interface has `images?: string[]`.
- [ ] **AC-A3** `shotToBatchItem()` forwards `images` only when the array is non-empty.
- [ ] **AC-A4** `validateBatchPayload()` rejects non-URL strings in `images` with an error.
- [ ] **AC-A5** `validateBatchPayload()` is backward-compatible when `images` is absent.
- [ ] **AC-B1** JSONL formatter emits `{"_type":"references",…}` sentinel when `options.references` is non-empty.
- [ ] **AC-B2** JSONL formatter output is unchanged when no `references` are passed (no regression).
- [ ] **AC-C1** `resolveReferenceImages()` resolves key arrays against a global ref map.
- [ ] **AC-C2** `resolveReferenceImages()` leaves shots that already have `images` unchanged.
- [ ] **AC-D1** All 9 BS-I2V-* batch serializer tests pass.
- [ ] **AC-D2** All 3 JF-I2V-* JSONL formatter tests pass.
- [ ] **AC-E1** `npm test` — all existing tests pass, zero regressions.
- [ ] **AC-E2** `npm run build` — zero TypeScript errors.

---

## Definition of Done

- [ ] All 5 tasks (TASK-A through TASK-E) closed in the issue tracker.
- [ ] All acceptance criteria (AC-A1 through AC-E2) verified by automated tests.
- [ ] PR description references this prompt and the upstream JIRA at `ai-powered/ai-prompts/accept-uploaded-batch-images-JIRA.md`.
- [ ] No existing test deleted or skipped.
- [ ] `completed.jsonl` entry recorded.
