# Film Pipeline Guide — FilmBuff

> **Satisfies:** bd-int-d5 buff-core.04.02.02 — Write user documentation: film pipeline guide

FilmBuff converts a screenplay file into an AI-optimised shot list through a
**six-stage pipeline**. This guide explains every stage, the options that
control it, and how to troubleshoot common problems.

---

## Table of Contents

1. [Pipeline Overview](#pipeline-overview)
2. [Stage 1 — Provider Resolution](#stage-1--provider-resolution)
3. [Stage 2 — Input & Validation](#stage-2--input--validation)
4. [Stage 3 — Parsing](#stage-3--parsing)
5. [Stage 4 — Style Loading](#stage-4--style-loading)
6. [Stage 5 — Shot Generation](#stage-5--shot-generation)
7. [Stage 6 — Formatting & Output](#stage-6--formatting--output)
8. [Full Command Reference](#full-command-reference)
9. [Output Formats](#output-formats)
10. [Warnings & Exit Codes](#warnings--exit-codes)
11. [Troubleshooting](#troubleshooting)

---

## Pipeline Overview

```
Screenplay File
      │
      ▼
┌─────────────────────┐
│ 1. Provider         │  Resolve AI provider / model
│    Resolution       │  (Anthropic · OpenAI · Google AI)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 2. Input &          │  Read file, validate size / format
│    Validation       │  (.fountain · .md · .txt · .pdf …)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 3. Parsing          │  Format-specific parser →
│                     │  Screenplay { scenes[] }
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 4. Style Loading    │  Load & merge cinematic-style
│    (optional)       │  guidelines (director / franchise)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 5. Shot Generation  │  Scene segmentation → shot metadata
│                     │  → duration / character validation
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 6. Formatting &     │  Render output (md/json/csv/html…)
│    Output           │  → write file
└─────────────────────┘
```

---

## Stage 1 — Provider Resolution

FilmBuff uses an AI provider to enrich each shot with contextual metadata
(lighting, camera framing, blocking notes, etc.).

**Resolution order** (first match wins):

| Priority | Source |
|----------|--------|
| 1 | `--ai-provider` + `--ai-profile` CLI flags |
| 2 | Active provider set via `filmbuff provider set-active` |
| 3 | Legacy `filmbuff.config.json` → `ai.provider` / `ai.model` |
| 4 | Built-in defaults (`anthropic` / `claude-sonnet-4-6`) |

**Quick setup:**

```bash
# Interactive wizard
filmbuff provider setup

# Set active profile for all future runs
filmbuff provider set-active anthropic default

# Override per run
filmbuff generate-shot-list --input script.fountain \
  --ai-provider openai --ai-profile gpt4o-prod
```

See **[Provider Setup & Management](PROVIDER_SETUP.md)** for full provider
configuration details.

---

## Stage 2 — Input & Validation

FilmBuff validates the input file before any processing begins.

**Supported input formats:**

| Extension | Format | Parser |
|-----------|--------|--------|
| `.fountain` | Fountain screenplay | `FountainParser` |
| `.md` | Markdown (headings = scenes) | `MarkdownParser` |
| `.txt` | Plain text (INT/EXT headings) | `PlainTextParser` |
| `.pdf` | PDF screenplay | `PdfParser` |
| `.fdx` | Final Draft XML | `FinalDraftParser` |
| `.docx` | Word document | `DocxParser` |
| `.rtf` | Rich Text Format | `RtfParser` |

**Validation checks:**

- File exists and is readable
- File size ≤ 50 MB
- `--max-characters` between 100 – 10 000 (default **4 000**)
- `--max-shot-length` between 1 – 60 seconds (default **12 s**)
- `--format` is one of: `md`, `json`, `jsonl`, `csv`, `txt`, `html`

---

## Stage 3 — Parsing

The correct parser is selected automatically from the file extension and a
content sniff (Fountain scene-heading regex vs. Markdown heading regex).

**What the parser produces:**

```
Screenplay
├── title
├── author
├── metadata  { format, totalLines, totalScenes, parsedAt }
└── scenes[]
    ├── heading  { location, interior/exterior, timeOfDay }
    └── elements[]
        ├── Action lines
        ├── Character / Dialogue pairs
        └── Transitions
```

**Fountain scene-heading format recognised:**

```fountain
INT. POLICE PRECINCT - NIGHT
EXT. ROOFTOP - DAY
INT./EXT. MOVING CAR - DAWN
```

---

## Stage 4 — Style Loading

Cinematic-style guidelines shape how shot metadata is generated (composition
rules, pacing, lens choices, colour palette notes).

```bash
# Single director style
filmbuff generate-shot-list --input script.fountain \
  --style writing-standards/screenplay/cinematic-styles/directors/christopher-nolan

# Multiple styles (priority-based merge; first listed wins conflicts)
filmbuff generate-shot-list --input script.fountain \
  --style writing-standards/screenplay/cinematic-styles/directors/alfred-hitchcock \
  --style writing-standards/screenplay/cinematic-styles/franchises/star-wars
```

**Available style categories:**

| Category path | Contents |
|---------------|----------|
| `…/directors/<name>` | Individual director style guides |
| `…/franchises/<name>` | Franchise-specific visual language |
| `…/producers/<name>` | Producer aesthetic guidelines |
| `…/commercials` | Broadcast / web commercial formats |

Style conflicts (same guideline claimed by two loaded styles) are resolved by
load order and reported as warnings when `--logging` is enabled.

---

## Stage 5 — Shot Generation

Each scene is segmented into one or more shots based on duration thresholds
and natural break-points (dialogue exchanges, action beats).

**Segmentation rules:**

| Rule | Default | CLI flag |
|------|---------|----------|
| Maximum shot duration | 12 s | `--max-shot-length <sec>` |
| Sub-shot ID format | `3a`, `3b`, `3c` | — |
| Character-count limit per shot | 4 000 | `--max-characters <n>` |
| Warning threshold | 90% of limit | — |

**Each generated shot includes:**

- Shot number & sub-shot ID (when split)
- Scene context (set, lighting, time of day, atmosphere)
- Character states (position, appearance, emotion, action)
- Camera framing & movement suggestion
- Estimated duration (seconds)
- Character count of the shot description
- Technical notes / blocking summary
- Warnings (if limits exceeded)

**Muting sound design output:**

```bash
# Remove all MUSIC and SOUND EFFECT content from shot descriptions
filmbuff generate-shot-list --input script.fountain --mute-sfx
```

---

## Stage 6 — Formatting & Output

The shot list is rendered into the requested format and written to disk.

**Default output path** (when `--output` is omitted):

```
<input-basename>-ai-shot-list.<ext>
```

Example: `my-script.fountain` → `my-script-ai-shot-list.md`

**Output formats:**

| Flag | Extension | Description |
|------|-----------|-------------|
| `--format md` *(default)* | `.md` | Markdown with tables |
| `--format json` | `.json` | Full JSON object |
| `--format jsonl` | `.jsonl` | One shot per line (streaming) |
| `--format csv` | `.csv` | Spreadsheet-compatible |
| `--format txt` | `.txt` | Plain-text readable |
| `--format html` | `.html` | Styled HTML page |

---

## Full Command Reference

```bash
filmbuff generate-shot-list \
  --input <screenplay-file>       # Required: path to screenplay
  [--output <file>]               # Default: <input>-ai-shot-list.<ext>
  [--format md|json|jsonl|csv|txt|html]  # Default: md
  [--max-characters <n>]          # Default: 4000  (100–10000)
  [--max-shot-length <sec>]       # Default: 12    (1–60)
  [--style <module-path>]         # Cinematic style (repeatable)
  [--mute-sfx]                    # Strip music/SFX from output
  [--ai-provider <id>]            # anthropic | openai | google-ai
  [--ai-profile <name>]           # Named provider profile
  [--ai-model <model-id>]         # Model override
  [--logging]                     # Write JSONL debug log
  [--verbose]                     # Extra console output
  [--help | -h]                   # Show help
```

---

## Output Formats

### Markdown (default)

Structured tables with one row per shot. Ideal for human review and version
control via Git.

### JSON

Complete shot-list object including `totalShots`, `totalDuration`,
`totalCharacters`, `warnings[]`, and `shots[]`. Best for programmatic
post-processing or feeding into video-generation APIs.

### JSONL

One JSON object per line, one shot per line. Suitable for streaming ingestion
(e.g. piping into Runway, Pika, or Stable Video Diffusion scripts).

### CSV

Headers: `shotNumber`, `scene`, `description`, `duration`, `characters`,
`cameraFraming`, `cameraMovement`. Opens directly in Excel / Google Sheets.

### HTML

Self-contained styled HTML page. Suitable for sharing with non-technical
collaborators or printing to PDF.

---

## Warnings & Exit Codes

**Warning severities displayed during generation:**

| Severity | Trigger | Symbol |
|----------|---------|--------|
| `warning` | Shot description ≥ 90% of `--max-characters` | ⚠️ |
| `error` | Shot description exceeds `--max-characters` | ❌ |

Up to 5 warnings are printed to the terminal; the rest are counted. All
warnings appear in the full shot list output and in the debug log when
`--logging` is enabled.

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Invalid arguments |
| `3` | Input file error |

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| `Error: Missing required argument: --input` | No screenplay path given | Add `--input script.fountain` |
| `Error: Input file not found` | Wrong path or typo | Check path with `ls`/`dir` |
| `Error: File size exceeds 50MB limit` | Screenplay file too large | Split screenplay into acts |
| `Error: Invalid format: <x>` | Unsupported `--format` value | Use one of: `md json jsonl csv txt html` |
| `Error: Character limit must be between 100 and 10000` | Out-of-range `--max-characters` | Use a value in 100–10 000 |
| `Error: Shot length must be between 1 and 60 seconds` | Out-of-range `--max-shot-length` | Use a value in 1–60 |
| `Error: Invalid style module path` | Style path not found | Run `filmbuff list` to see available styles |
| `Provider error: …` | API key missing or profile mis-configured | Run `filmbuff provider setup` |
| 0 scenes parsed | Unrecognised screenplay format | Verify file has `INT.`/`EXT.` headings |
| Shot descriptions too long | `--max-characters` too low | Increase to `6000` or add `--mute-sfx` |

**Enable debug logging for deeper diagnostics:**

```bash
filmbuff generate-shot-list --input script.fountain --logging
# Writes: script-ai-shot-list-debug.jsonl
```

**Related guides:**

- [Provider Setup & Management](PROVIDER_SETUP.md)
- [Quick Start](QUICK_START.md)
- [CLI Reference](CLI_REFERENCE.md)

