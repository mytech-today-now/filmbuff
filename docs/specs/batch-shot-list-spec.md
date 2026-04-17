# Batch Shot-List Interchange Specification

**Version:** 1.0.0
**Location:** `filmbuff/docs/specs/batch-shot-list-spec.md`
**Status:** Active

This document is the canonical contract between `filmbuff generate-shot-list` output and
`ai-powered` batch video input. It must be version-controlled in the `filmbuff` repository
and cross-referenced from `ai-powered`'s README or contributing guide.

---

## 1. Format Overview

`filmbuff generate-shot-list` supports three interchange formats:

| Format | Flag | Use When |
|--------|------|----------|
| `.jsonl` | `--format jsonl` | Streaming ingestion; one shot per line; preferred for large batches |
| `.json`  | `--format json`  | Full-document consumption with top-level metadata and summary |
| `.md`    | `--format md`    | Human review; also parseable by `ai-powered` via Markdown table extraction |

---

## 2. `duration` Field Contract

**`duration` MUST be a non-negative integer (whole seconds).**

- **Type:** `i32` (32-bit signed integer) or equivalent JSON integer literal
- **Range:** `[3, 60]` seconds (inclusive)
- **Forbidden:** Floating-point values (e.g., `5.800000000000001`) are strictly prohibited
- **Always present:** Unlike `aspectRatio`, `resolution`, `quality`, and `fps`, `duration`
  is NEVER omitted or set to `"Default"`

**Rationale:** The xAI Grok video API deserializes `duration` using a `PickFirst` strategy
that accepts only `i32` or a string representation of an integer. A JSON floating-point
literal satisfies neither branch and causes a `422` deserialization error.

**Consumer responsibility (see §8):** `ai-powered` must treat any non-integer `duration`
value as a parse error and round to the nearest integer before submission, as a defensive
measure against future producer regressions.

---

## 3. Canonical JSONL Schema

One JSON object per line. Each line is a self-contained shot record.

```jsonl
{"number":1,"sceneNumber":"1","heading":{"raw":"EXT. DINER - DAY","intExt":"EXT","location":"DINER","timeOfDay":"DAY"},"context":{"set":"Diner exterior","lighting":"Natural daylight","timeOfDay":"DAY","atmosphere":null,"weather":null},"characters":[{"name":"JOHN","position":"foreground","appearance":"Tall, weathered","wardrobe":null,"physicalAppearance":null,"emotion":"determined","action":"steps out"}],"set":"Diner exterior","description":"A lone figure steps out into the morning light.","actions":"JOHN steps out of the diner.","dialogue":"","blocking":"","sfx":"","techDetails":"","metadata":{"shotType":"wide","cameraMovement":"static","framing":"establishing","visualStyle":"naturalistic","cinematicStyle":null,"technicalNotes":[]},"duration":{"seconds":6,"formatted":"0:06"},"characterCount":{"count":312,"limit":500,"percentage":62},"warnings":[]}
```

**Required fields for `ai-powered` batch ingest:**

| Field | Type | Notes |
|-------|------|-------|
| `number` | integer | Shot sequence number |
| `heading.raw` | string | Scene heading used as shot name |
| `description` | string | Visual prompt for AI generator |
| `duration.seconds` | **integer** | Must be `[3, 60]`; NEVER a float |

---

## 4. Canonical JSON Schema

Top-level wrapper with metadata, summary, and shots array.

```json
{
  "metadata": {
    "title": "My Film",
    "author": "Jane Smith",
    "generatedAt": "2026-04-17T12:00:00.000Z",
    "sourceFormat": "fountain",
    "maxCharacters": 500,
    "maxShotLength": 120
  },
  "summary": {
    "totalShots": 18,
    "totalDuration": 108,
    "totalDurationFormatted": "1:48",
    "totalCharacters": 8142,
    "averageShotLength": 6.0,
    "averageCharacters": 452,
    "maxCharacters": 500
  },
  "warnings": [],
  "shots": [
    {
      "number": 1,
      "duration": { "seconds": 6, "formatted": "0:06" }
    }
  ]
}
```

> **Note:** `shots[n].duration.seconds` MUST be an integer. The `summary.totalDuration`
> field is also an integer (sum of all shot durations).

---

## 5. Canonical Markdown Schema

The Markdown format uses a standard section structure per shot, including a
`Video Controls:` table.

```markdown
## Shot 1: EXT. DINER - DAY

**Description:** A lone figure steps out into the morning light.

**Video Controls:**

| Control       | Value   | Notes                                      |
|---------------|---------|---------------------------------------------|
| Aspect Ratio  | Default |                                             |
| Resolution    | Default |                                             |
| Quality       | Default |                                             |
| Duration (s)  | 6       | Estimated from action density               |
| FPS           | Default |                                             |
```

**Video Controls table column definitions:**

| Column | Description |
|--------|-------------|
| Control | Control name (always one of: Aspect Ratio, Resolution, Quality, Duration (s), FPS) |
| Value | Concrete value, or `"Default"` when the field defers to the provider |
| Notes | Human-readable derivation note (empty for non-duration rows with Default) |

> **Note:** The `Duration (s)` row Value MUST be a whole number. Parsers reading this
> format must extract the integer value and reject or round any float.

---

## 6. Default Constraints

"Default" means the field is **omitted from the JSON batch payload entirely**, deferring
to the provider's default behavior.

| Field | Default Meaning | Always Present? |
|-------|----------------|-----------------|
| `duration` | N/A — always a concrete integer in `[3, 60]` | **Yes** |
| `aspectRatio` | Omitted from payload; provider chooses | No |
| `resolution` | Omitted from payload; provider chooses | No |
| `quality` | Omitted from payload; provider chooses | No |
| `fps` | Omitted from payload; provider chooses | No |

---

## 7. Version

**Specification version:** `1.0.0`

Consumers (`ai-powered`) should check for a `specVersion` field in future JSON format
envelopes to detect format compatibility. The current `1.0.0` envelope does not include
this field; its absence implies `1.0.0`.

---

## 8. Consumer Responsibilities

`ai-powered` MUST:

1. **Validate `duration` on ingest** — when reading any shot-list file (`.jsonl`, `.json`,
   or `.md`), check that `duration.seconds` (or the `Duration (s)` Markdown cell) is an
   integer in `[3, 60]`. If the value is a float, round to the nearest integer using
   `Math.round()` and log a warning. Do NOT reject the file; silently correct it.

2. **Coerce `duration` immediately before API submission** — apply `Math.round()` to the
   `duration` field of every batch item immediately before constructing the JSON body sent
   to the xAI (or other) video API. This is the last-line-of-defense guard.

3. **Validate UI input** — the `Duration (s)` field in the Default Constraints panel must
   accept only positive integer values. Display an inline error if a float or non-numeric
   value is entered, and block batch submission.

4. **Surface meaningful errors** — if a `422` response body contains `"expected i32"` or
   `"expected a string"` combined with the field name `"duration"`, display a human-readable
   message describing that duration must be a whole number.

---

## 9. Change History

| Version | Date | Change |
|---------|------|--------|
| 1.0.0 | 2026-04-17 | Initial specification — duration integer contract, format schemas |
