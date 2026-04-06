# JIRA Ticket — FB-SHOT-9: Add Video Controls Block to `generate-shot-list` (Step 9)

---

## Summary

Extend the `filmbuff generate-shot-list` command (pipeline Step 9) to append a
structured **Video Controls** metadata block to every shot entry in the output
shot list, and to emit a valid `POST /batch` JSON payload when forwarding the
shot list to the `ai-powered` proxy for video generation.

---

## Issue Type

`Story`

## Priority

`High`

## Story Points

`13`

## Component / Labels

`filmbuff-cli` · `generate-shot-list` · `ai-powered-integration` · `video-generation` · `step-9` · `multi-image-i2v` · `references-export` · `smart-default`

## Epic Link

`[EPIC] filmbuff × ai-powered Video Generation Integration`

---

## Background & Motivation

The `filmbuff` pipeline produces a Fountain screenplay (Step 4) and a shooting
script (Step 8). Step 9 — `generate-shot-list` — is the final AI writing step
before video generation begins. Currently, Step 9 emits shot entries that
contain scene, description, and technical metadata but **no machine-readable
video-control parameters**. Downstream video generation via `ai-powered`
(`POST /video` or `POST /batch`) requires five structured fields per shot:
`duration`, `aspectRatio`, `resolution`, `quality`, and `fps`.

Without this block, every video-generation call must be manually configured,
making automated batch execution of a full shot list impossible. This story
closes that gap by making Step 9 emit all required video-control data
automatically.

This story also incorporates the **multi-image I2V integration requirements**
from the `multi-img-to-img-video` spec (§10). That spec extends the shared
`ai-powered` / filmbuff data contract with:

- A top-level **`references` asset map** in every exported shot-list file,
  mapping symbolic keys (character names, location labels) to image URLs.
- **Per-shot `references[]` arrays** listing which keys from the document-level
  map apply to that shot; resolved by the `ai-powered` batch pipeline into
  `images[]` URL arrays for I2V / I2I seeding.
- **Per-shot `provider` and `model` overrides**, allowing a single shot list to
  mix providers (e.g., Luma AI Ray-2 for dual-keyframe shots, xAI for
  single-frame shots) without changing the envelope-level defaults.
- **Pre-export validation** of every image URL before the batch payload leaves
  filmbuff, surfacing unreachable assets to the user before a costly API call.

These additions require filmbuff to update its `POST /batch` payload
serialization (DR-6), its provider configuration table (DR-7), and add three
new detailed requirements (DR-8, DR-9, DR-10).

Reference spec: `ai-prompts/filmbuff-prompt.md` · `ai-prompts/common-vid-cntrl.md` · `ai-prompts/multi-img-to-img-video.md`

---

## Detailed Requirements

### DR-1 — Multi-Document Input Ingestion

`generate-shot-list` already accepts `--input <project>.fountain`. It MUST
additionally ingest the following pipeline artifacts when present in the project
directory, using them to derive accurate per-shot duration and framing data:

| Artifact | Source Step | Primary Use |
|---|---|---|
| `<project>.fountain` | Step 4 – screenplay | Primary shot structure |
| `shooting-script.txt` | Step 8 – shooting-script | Scripted per-shot durations |
| `beat-sheet.txt` | Step 2 – beat-sheet | Scene-level pacing |
| `treatment.txt` | Step 3 – treatment | Tone and framing intent |
| `script-breakdown.txt` | Step 5 – script-breakdown | Character descriptions |
| `logline.txt` | Step 1 – logline | Project context |

All documents are **optional except the Fountain file** (primary `--input`).
When additional documents are absent, the command degrades gracefully and falls
back to estimation rules defined in DR-3.

---

### DR-2 — Video Controls Block Format

Every shot section in the output Markdown MUST contain the following block
**immediately after the shot heading**, before `Scene` and all other shot
content, with no intervening blank lines between the heading and the table:

```markdown
**Video Controls:**

| Control       | Value   | Notes                                      |
|---------------|---------|--------------------------------------------|
| Aspect Ratio  | Default |                                            |
| Resolution    | Default |                                            |
| Quality       | Default |                                            |
| Duration (s)  | <N>     | Derived from shot duration in script       |
| FPS           | Default |                                            |
```

- The block must never be omitted from any shot, regardless of input quality.
- The column order (`Control`, `Value`, `Notes`) must be preserved exactly.
- `<N>` is a positive integer representing whole seconds (see DR-3).

---

### DR-3 — Duration Derivation Rules

`Duration (s)` is the **only field that must never be `Default`**. The
following precedence chain governs how it is resolved:

1. **Shooting-script explicit duration** — parse `Duration | M:SS` from
   `shooting-script.txt` for the matching shot. Convert `M:SS` → total seconds
   (e.g., `0:12` → `12`, `1:05` → `65`).
2. **Beat-sheet timing cue** — if the shooting script lacks a duration for a
   given shot, look for a timing annotation in `beat-sheet.txt` for the parent
   scene.
3. **Action-density estimation** — if no scripted timing exists: count
   action lines in the shot description. Use **5 s** as the base for a single
   action line; add **2 s** per additional action line, capping at **30 s**
   for complex multi-action shots. Minimum value: **3 s**. Maximum value: **60 s**.
4. **Hard clamp** — regardless of derivation method, clamp the final value to
   the range `[3, 60]` inclusive and round to the nearest whole second.

The `Notes` column of the `Duration (s)` row MUST describe the derivation
source (e.g., `"Derived from shot duration 0:12"` or
`"Estimated from action density"`).

---

### DR-4 — Non-Default Field Override Rules

All fields other than `Duration (s)` default to `"Default"` and must only
be overridden when the script or production brief **explicitly** justifies it:

| Field | Type | Override Trigger |
|---|---|---|
| `Aspect Ratio` | string | Script describes portrait/widescreen/square framing (e.g., `"portrait social-media shot"` → `"9:16"`; `"widescreen cinematic"` → `"16:9"`). Allowed values: `"16:9"`, `"9:16"`, `"1:1"`, `"4:3"`, `"3:4"`, `"21:9"`. |
| `Resolution` | string | Production brief specifies a delivery format. Allowed values: `"720p"`, `"1080p"`, `"4k"`. |
| `Quality` | enum | Hero/title shots → `"high"`. Animatic/rapid-iteration pass → `"draft"`. Allowed values: `"draft"`, `"standard"`, `"high"`. |
| `FPS` | integer | Production brief specifies a frame rate. Allowed values: `24`, `30`, `60`. |

When a field is `"Default"`, it is **omitted entirely** from the `ai-powered`
API request body — the video provider uses its own default.

---

### DR-5 — Preservation of Existing Shot Fields

`generate-shot-list` MUST NOT remove, reorder, or modify the following existing
shot fields when appending Video Controls:

`Scene` · `Set` · `Description` · `Characters` · `Actions` · `Dialogue` ·
`Blocking` · `SFX` · `Technical Details`

The `Video Controls` block is placed **immediately after the shot heading**,
before `Scene` and all other shot fields.

---

### DR-6 — JSON Batch Payload for `POST /batch`

When the user requests batch video generation (via `--batch-output` or a
downstream `ai-powered` integration), `generate-shot-list` MUST emit a valid
`POST /batch` JSON payload structured as follows:

```json
{
  "provider": "<user-selected provider id>",
  "model":    "<user-selected model id>",
  "references": {
    "sarah":       "https://cdn.example.com/cast/sarah-frame0.jpg",
    "sarah-end":   "https://cdn.example.com/cast/sarah-frame1.jpg",
    "lake-sunrise": "https://cdn.example.com/scenes/lake-dawn.jpg"
  },
  "items": [
    {
      "modality":   "video",
      "name":       "shot-01",
      "prompt":     "<shot description text>",
      "duration":   12,
      "references": ["sarah", "sarah-end"],
      "provider":   "lumaai"
    },
    {
      "modality":   "video",
      "name":       "shot-02",
      "prompt":     "<shot description text>",
      "duration":   6,
      "references": ["lake-sunrise"]
    }
  ]
}
```

Serialization rules:

- `provider` and `model` at the **envelope level** are set from the filmbuff
  user's global selection (read from `filmbuff.config.json` or CLI flags).
- The top-level `references` map is emitted whenever the project has any
  reference images associated with shots. If no shots reference images, the
  `references` key is omitted entirely.
- Individual items carry a `references` array of keys from the document-level
  map, **not** raw URLs. The `ai-powered` proxy resolves keys → URLs server-side.
- Individual items MAY carry `provider` and/or `model` overrides. A per-shot
  `provider` override signals that the smart-default selection has already been
  made in the filmbuff UI; `ai-powered` will honour it directly.
- Fields whose Video Controls value is `"Default"` MUST be **omitted** from
  the item object entirely (do not emit `null` or `"Default"` as a value).
- `apiKey` MUST never appear anywhere in the JSON payload. The `ai-powered`
  proxy resolves the key from server-side environment variables.
- When a shot has `references` but no matching entries exist in the document
  map, filmbuff MUST fail the pre-export validation step (DR-10) and surface
  an error to the user before emitting any payload.

---

### DR-7 — Provider & Model Configuration

filmbuff MUST maintain a `filmbuff.config.json` (in the filmbuff repo root, not
inside `ai-powered`) that declares available video providers:

```json
{
  "videoProviders": [
    { "id": "lumaai", "label": "Luma AI",            "models": ["ray-2", "ray-2-turbo"] },
    { "id": "mock",   "label": "Mock (no API calls)", "models": [] }
  ],
  "defaultProvider": "lumaai",
  "defaultModel":    "ray-2"
}
```

- `lumaai` is the only production video provider. `mock` is used for local
  development and CI (no API key required).
- The filmbuff UI renders `videoProviders` as a `<select>` dropdown.
- `ai-powered` never reads `filmbuff.config.json` directly; filmbuff forwards
  `provider` and `model` at request time.

Supported provider API keys (server env vars, never in transit):

| Provider | Env Var | Video Support | Max I2V Images | Notes |
|---|---|---|---|---|
| `lumaai` | `LUMAAI_API_KEY` | ✅ | **2** | Ray-2: `keyframes.frame0` + optional `keyframes.frame1` (start + end keyframes) |
| `openai` | `OPENAI_API_KEY` | ❌ | — | Text/vision only; DALL-E does not accept image-to-video |
| `anthropic` | `ANTHROPIC_API_KEY` | ❌ | — | Vision/text only; no video generation endpoint |
| `xai` | `XAI_API_KEY` | ✅ | 1 | Grok I2V via first `image_url` block in multimodal messages |
| `venice` | `VENICE_API_KEY` | ✅ | 1 | `wan-2.5-preview-image-to-video`; single seed frame via `image_url` field |
| `mock` | *(none)* | ✅ | unlimited | Test/CI provider; accepts any payload shape, returns synthetic output |

> **Design note:** xAI and Venice have been corrected from ❌ to ✅ for video support. The
> authoritative capability table lives in `ai-powered` (see `accept-uploaded-batch-images-JIRA.md`
> §Provider × Image-Input Capability Matrix). filmbuff reads provider capability at runtime via
> `GET /providers` from the `ai-powered` proxy, not from this static table.

---

### DR-8 — `references` Section in Exported Shot Lists

When `generate-shot-list` emits a JSON or JSONL batch payload (DR-6), it MUST
include a top-level `references` map whenever **any** shot in the list is
associated with one or more reference images in the filmbuff project.

#### Reference Image Association

The filmbuff pipeline builds the `references` map from two sources, merged in
this precedence order (higher wins):

1. **Per-character image assignments** — images the user has attached to a
   character entry in the filmbuff project UI (e.g., actor headshots for Sarah,
   Marcus). The symbolic key is the character name as it appears in the
   screenplay (normalised: lowercase, hyphens for spaces).
2. **Per-scene image assignments** — images the user has attached to a scene or
   location entry (e.g., a drone photograph of the canyon exterior). The
   symbolic key is the scene slug (e.g., `canyon-ext`, `lake-sunrise`).

Duplicate keys (same character referenced twice) MUST be resolved by keeping
the most recently assigned URL.

#### Map Format Requirements

```json
`references`: {
  `<key>`: `<absolute https:// URL or data:image/... URI>`,
  ...
}
```

- Keys MUST match `^[a-z0-9][a-z0-9-]*$` (lowercase alphanumeric with hyphens,
  no leading hyphens). Filmbuff normalises character and scene names to this
  format on export.
- Values MUST be absolute HTTPS URLs or `data:image/...;base64,...` data URIs.
  Relative file paths MUST be resolved and converted to HTTPS CDN URLs (or
  data URIs if offline) before export.
- The map must only contain keys that are actually referenced by at least one
  shot in `items`. Unused keys MUST be omitted.

#### JSONL Placement

In JSONL format, the references map MUST appear on the **first line** with
a `_type: references` sentinel field:

```jsonl
{"_type":"references","sarah":"https://cdn.example.com/cast/sarah-frame0.jpg","sarah-end":"https://cdn.example.com/cast/sarah-frame1.jpg"}
{"name":"shot-01","modality":"video","prompt":"...","references":["sarah","sarah-end"],"provider":"lumaai","duration":5}
```

#### Markdown Shot Lists

The Markdown shot-list format (DR-2) MUST emit a `## References` section at
the top of the document when reference images exist:

```markdown
## References

- sarah: https://cdn.example.com/cast/sarah-frame0.jpg
- sarah-end: https://cdn.example.com/cast/sarah-frame1.jpg
- lake-sunrise: https://cdn.example.com/scenes/lake-dawn.jpg
```

Each shot carries a `**References:** sarah, sarah-end` line immediately after
the shot heading and before the `**Video Controls:**` table.

---

### DR-9 — Per-Shot `provider` and `model` Fields

The filmbuff shot-list UI (Step 9 output review screen) MUST allow the user to
assign a **provider** and **model** override to individual shots via a dropdown,
defaulting to the envelope-level selection from `filmbuff.config.json`.

#### When to Emit Per-Shot Overrides

| Condition | Emit `provider` in item? | Emit `model` in item? |
|---|---|---|
| Shot uses envelope defaults | No | No |
| User explicitly selected a non-default provider for this shot | Yes | Only if also non-default |
| Shot has 2 reference images and envelope provider ≠ `lumaai` | Yes (`lumaai`) | Yes (`ray-2`) — auto-suggested |

The auto-suggestion for dual-keyframe shots (2 references → Luma AI) is
surfaced as a UI hint with an amber indicator before the user finalises the
export. The user may override the auto-suggestion.

#### Serialisation

```json
{
  "modality":   "video",
  "name":       "shot-01",
  "prompt":     "...",
  "references": ["sarah", "sarah-end"],
  "provider":   "lumaai",
  "model":      "ray-2",
  "duration":   5
}
```

`provider` MUST be a valid `id` from `filmbuff.config.json → videoProviders`.,
`model` MUST be a valid entry in that provider's `models` array. Emitting an
invalid combination is a pre-export validation error (DR-10).

---

### DR-10 — Pre-Export Validation

Before `generate-shot-list` writes or emits any batch payload, it MUST run the
following validation steps in order. Any failure MUST halt export and surface a
human-readable error to the user (CLI: `stderr` + exit code 1; UI: blocking
error dialog with per-shot detail).

| Step | Rule | Error Message Template |
|---|---|---|
| V-1 | Every key in every shot's `references[]` array exists in the document-level `references` map. | `Shot \"<name>\": reference key \"<key>\" not found in document references map.` |
| V-2 | Every URL value in the `references` map is a valid absolute HTTPS URL or data URI. | `Reference \"<key>\": invalid URL \"<value>\".` |
| V-3 | Every URL in the `references` map is reachable (HTTP HEAD returns 2xx or 206). Skip for data URIs. | `Reference \"<key>\": URL \"<value>\" returned HTTP <status>. Ensure the asset is publicly accessible.` |
| V-4 | Every shot's `provider` override (if present) is a valid `id` in `filmbuff.config.json → videoProviders`. | `Shot \"<name>\": unknown provider \"<value>\".` |
| V-5 | Every shot's `model` override (if present) belongs to the `models` array of the specified (or envelope) provider. | `Shot \"<name>\": model \"<value>\" is not available for provider \"<provider>\".` |
| V-6 | Shots with > 1 reference and a single-frame provider emit a warning (non-blocking). | `Shot \"<name>\": <N> references supplied; <provider> supports at most 1 image. Extra references will be ignored by ai-powered.` |

V-3 (URL reachability) has a **5-second per-URL timeout** and is skipped in
offline / CI mode (`--offline` flag or `CI=true` env var). V-3 failures are
non-blocking warnings when running with `--provider mock`.

---

## Acceptance Criteria

**AC-1** — Running `filmbuff generate-shot-list --input <file>.fountain`
produces a `shot-list.md` where every shot entry contains a `Video Controls`
table placed immediately after the shot heading, before all other shot content.

**AC-2** — The `Duration (s)` row in every `Video Controls` table contains a
concrete whole-number value in the range `[3, 60]`. The value `Default` never
appears in the `Duration (s)` row.

**AC-3** — When `shooting-script.txt` is present and contains a `Duration |
M:SS` row for a shot, that duration is correctly converted to seconds and used
as the `Duration (s)` value. The `Notes` column reads
`"Derived from shot duration M:SS"`.

**AC-4** — When no scripted duration exists, duration is estimated from action
density (5 s base + 2 s per additional action line), clamped to `[3, 60]`. The
`Notes` column reads `"Estimated from action density"`.

**AC-5** — All other Video Controls fields default to `"Default"` unless the
script or production brief explicitly specifies a framing, resolution, quality,
or frame rate that maps to an allowed override value.

**AC-6** — All pre-existing shot fields (`Scene`, `Set`, `Description`,
`Characters`, `Actions`, `Dialogue`, `Blocking`, `SFX`, `Technical Details`)
are preserved, unmodified, in every shot entry.

**AC-7** — The `--batch-output` flag (or equivalent) emits a valid
`POST /batch` JSON payload: `provider` and `model` at envelope level, each shot
as an item with `modality: "video"`, `name`, `prompt`, and concrete `duration`.
`Default` fields are omitted. `apiKey` is absent.

**AC-8** — Running with `--provider mock` (or `"defaultProvider": "mock"` in
config) produces a valid batch payload without requiring any API key, suitable
for CI execution.

**AC-9** — A unit test covers duration derivation: explicit scripted duration,
beat-sheet fallback, and action-density estimation, including clamp enforcement.

**AC-10** — An integration/snapshot test generates a shot list from a known
Fountain fixture and asserts that every shot contains a correctly formatted
`Video Controls` block and that no existing fields are missing or reordered.

### Multi-Image I2V Extension (AC-11 through AC-16)

**AC-11** — When a filmbuff project has reference images associated with
characters or scenes, running `generate-shot-list --batch-output` emits a
`POST /batch` JSON payload that includes a top-level `references` map
containing only the keys actually referenced by shots in `items`.

**AC-12** — Each shot item in the emitted payload carries a `references` array
of symbolic keys (not raw URLs). Keys resolve to URLs via the document-level
map; raw URLs never appear inside shot items.

**AC-13** — When a shot has 2 reference images and the envelope provider is
not `lumaai`, the filmbuff UI displays an amber auto-suggestion indicator
recommending `lumaai` / `ray-2`, and the emitted payload includes
`"provider": "lumaai"` and `"model": "ray-2"` in the shot item.

**AC-14** — Pre-export validation (DR-10) halts export with a human-readable
error message for each of the following violations: unknown reference key
(V-1), invalid URL format (V-2), unreachable URL (V-3), unknown provider
override (V-4), invalid model override (V-5). The batch payload is never
written when any V-1 through V-5 violation is present.

**AC-15** — Running with `--offline` (or `CI=true`) skips URL reachability
checks (V-3). All other validation rules (V-1, V-2, V-4, V-5) still apply.

**AC-16** — The updated provider table (DR-7) correctly marks `xai` and
`venice` as video-capable with Max I2V Images = 1. `openai` and `anthropic`
remain video-unsupported. The JSONL snapshot fixture (AC-10) is updated to
include a `_type: references` line and at least one shot with a per-shot
`provider` field.
---

## Out of Scope

- Changes to `ai-powered` internals, proxy routing logic, or its `POST /video`
  / `POST /batch` API contract — this story touches only the filmbuff side.
- UI changes to the filmbuff web frontend (a separate story will wire the
  provider/model dropdowns to `filmbuff.config.json`).
- Support for non-video providers (`openai`, `anthropic`, `xai`, `venice`) in
  the Video Controls output — those providers do not support video and are
  listed only for completeness in the provider table.
- Streaming NDJSON response handling from `POST /batch` — that is a consumer
  responsibility handled by the filmbuff batch runner, not by
  `generate-shot-list`.

---

## Technical Notes

- Parse `M:SS` duration strings with a regex, e.g. `/^(\d+):(\d{2})$/`, and
  convert via `minutes * 60 + seconds`. Reject malformed strings and fall
  through to the estimation rule.
- The Markdown table column widths in the `Video Controls` block should align
  with the existing `Scene` table style for visual consistency in the rendered
  output.
- `filmbuff.config.json` should be loaded at command startup; if absent, fall
  back to `defaultProvider: "lumaai"` and `defaultModel: "ray-2"`.
- CI pipeline: run `filmbuff generate-shot-list` with `--provider mock` against
  the Fountain fixture in `cli/src/__tests__/fixtures/` and assert exit code 0
  and the presence of `Video Controls` in the output.

---

## Definition of Done

- [ ] All Acceptance Criteria (AC-1 through AC-16) pass.
- [ ] Unit tests cover duration derivation logic with ≥ 90 % branch coverage.
- [ ] Integration/snapshot test produces a clean diff against a committed
      golden fixture for at least one Fountain screenplay.
- [ ] `filmbuff.config.json` is committed to the filmbuff repo with `lumaai`
      and `mock` as the documented default entries.
- [ ] Pre-export validation (DR-10) unit tests cover all six rules (V-1 through
      V-6) with >= 90 % branch coverage; offline/CI mode skips V-3 correctly.
- [ ] A snapshot test verifies that a project with reference images emits the
      correct top-level `references` map and per-shot `references` arrays in
      both JSON and JSONL formats.
- [ ] The filmbuff UI amber auto-suggestion indicator for dual-keyframe shots
      is verified by an E2E or integration test.
- [ ] The `ai-powered` and `filmbuff` PRs are linked and land together; neither
      merges without the other passing CI (cross-repo dependency check).
- [ ] PR reviewed and approved; CI green.
