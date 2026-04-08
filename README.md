# FilmBuff

**AI-powered writing and screenplay tools — Creative Writing Edition**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/mytech-today-now/filmbuff)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![npm](https://img.shields.io/badge/npm-%40mytechtoday%2Ffilmbuff-red.svg)](https://www.npmjs.com/package/@mytechtoday/filmbuff)

FilmBuff provides comprehensive writing standards, screenplay tools, and AI-powered shot list generation for screenwriters and creative professionals.

## 🎯 Purpose

FilmBuff extends Augment Code AI with **1M+ characters** of writing guidelines, 60+ cinematic style guides, 18+ genre modules, and AI-powered production tools.

## 📦 Modules

### writing-standards/screenplay/

- **Core** — Universal formatting, narrative structures, character development, dialogue, continuity
- **13 Narrative Styles** — Linear, non-linear, ensemble, minimalist, epic, satirical, poetic, realistic, surreal, experimental, voice-over, flashback, dialogue-centric
- **60+ Cinematic Styles** — Director guides, franchise guides, comedy formats, narrative theory
- **18+ Genres** — Action, comedy, drama, fantasy, horror, mystery, romance, sci-fi, thriller, and more
- **Commercials** — Commercial writing rules with FTC compliance validation
- **Schemas** — Character profiles, beat sheets, plot outlines, trope inventories
- **Templates** — Genre, style, and theme templates

### writing-standards/literature/

- **Shakespeare** — Literary analysis module

### workflows/

- **Beads** — Task tracking workflow
- **Beads Integration** — Beads configuration and rules

## 🚀 Quick Start

```bash
npm install -g @mytechtoday/filmbuff
filmbuff --version
filmbuff init
filmbuff link writing-standards/screenplay
filmbuff generate-shot-list script.fountain
```

## 📥 Installation

Install FilmBuff globally with npm so the `filmbuff` command is added to your shell path:

```bash
npm install -g @mytechtoday/filmbuff
filmbuff --help
```

If your shell still does not recognize `filmbuff` immediately after install, open a new terminal so it reloads the global npm bin path.

## 🔧 CLI Commands

| Command | Description |
|---------|-------------|
| `filmbuff init` | Initialize in a project |
| `filmbuff link <module>` | Link writing modules |
| `filmbuff list` | List available modules |
| `filmbuff show <module>` | Display module content |
| `filmbuff search <term>` | Search for modules |
| `filmbuff start` | Start a new project (interactive wizard or flags) |
| `filmbuff start --wizard` | Force the interactive 12-step setup wizard |
| `filmbuff continue --project <slug>` | Resume a project at its next pending step |
| `filmbuff retry --project <slug>` | Re-queue the last failed pipeline step |
| `filmbuff status --project <slug>` | Show pipeline step statuses |
| `filmbuff generate-shot-list` | AI-powered shot list generation |
| `filmbuff generate-treatment` | AI-powered treatment generation |
| `filmbuff validate` | Validate module structure |
| `filmbuff upgrade` | Upgrade to latest version |
| `filmbuff inspect <module>` | Inspect module source files |
| `filmbuff inspect --format json` | JSON inspection report |
| `filmbuff inspect --format text` | Plain-text inspection report |
| `filmbuff inspect --format markdown` | Markdown inspection report |

---

## 🎬 Starting a New Project

`filmbuff start` initialises a new FilmBuff film project and seeds all pipeline steps. It can be driven entirely by CLI flags (for scripts and CI) or through an **interactive 12-step wizard** (for interactive terminals).

### Interactive Wizard

When run in a TTY without `--title` and `--genre`, the wizard launches automatically:

```bash
filmbuff start
```

You can also force the wizard even when flags are supplied:

```bash
filmbuff start --wizard
```

The wizard walks you through 12 steps and displays a confirmation panel before creating the project:

| Step | Field | Notes |
|------|-------|-------|
| 1 | **Title** | Display name; 3–120 characters |
| 2 | **Genre** | e.g. `thriller`, `sci-fi`, `romantic-comedy`; aliases normalised automatically |
| 3 | **Slug** | URL-safe identifier derived from the title; collision check against existing projects |
| 4 | **Tone** | Optional — e.g. `dark`, `comedic`, `hopeful`, `gritty` |
| 5 | **Audience** | Optional — target audience description |
| 6 | **Budget tier** | Optional — `micro` · `low` · `mid` · `studio` |
| 7 | **Outcome** | Optional — logline intent or desired result |
| 8 | **Output directory** | Default: `./output/<slug>` |
| 9 | **Format + Detail** | Format: `md` · `json` · `fountain` · `pdf`; Detail: `brief` · `standard` · `detailed` |
| 10 | **Style modules** | Zero or more cinematic style module paths |
| 11 | **AI provider** | Discovered from `ai-powered` config; video-only providers excluded |
| 12 | **AI profile** | Profiles for the chosen provider |

After all steps, a summary panel shows your choices and the equivalent one-liner command. You can then **Proceed**, **Edit** (return to Step 1 with values pre-filled), **Start Over**, or **Quit**.

Press `Ctrl-C` at any prompt to cancel cleanly without writing to the database.

### Non-Interactive / CI Mode

Supply `--title` and `--genre` to skip the wizard entirely:

```bash
filmbuff start --title "The Midnight Run" --genre thriller
```

Use `--no-wizard` to explicitly suppress the wizard and enforce non-interactive behaviour (exits with an error if either required flag is missing):

```bash
filmbuff start --no-wizard --title "My Screenplay" --genre drama
```

In non-TTY environments (pipes, CI) the wizard is suppressed automatically. Set `CI=true` to be explicit:

```bash
CI=true filmbuff start --title "Pipeline Film" --genre drama --format md
```

### All Flags

```bash
filmbuff start [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--title <title>` | Project display title | *(wizard)* |
| `--genre <genre>` | Film genre | *(wizard)* |
| `--wizard` | Force the interactive wizard | auto when title/genre missing |
| `--no-wizard` | Suppress wizard; require `--title` and `--genre` | — |
| `--slug <slug>` | URL-safe identifier | derived from `--title` |
| `--tone <tone>` | Tone description | — |
| `--audience <audience>` | Target audience | — |
| `--budget <tier>` | `micro` · `low` · `mid` · `studio` | — |
| `--outcome <outcome>` | Desired outcome or logline intent | — |
| `--output-dir <dir>` | Output directory | `./output/<slug>` |
| `--format <fmt>` | `md` · `json` · `fountain` · `pdf` | `md` |
| `--detail <level>` | `brief` · `standard` · `detailed` | `standard` |
| `--style <module>` | Style module path (repeatable) | — |
| `--ai-provider <id>` | AI provider for this project | global default |
| `--ai-profile <name>` | AI provider profile | provider default |

### Examples

```bash
# Fully interactive — wizard launches automatically
filmbuff start

# Wizard with a pre-filled title (shown as default in Step 1)
filmbuff start --title "Neon Requiem" --wizard

# Non-interactive with all options
filmbuff start \
  --title "The Midnight Run" \
  --genre thriller \
  --tone dark \
  --budget low \
  --output-dir ./projects/midnight-run \
  --format fountain \
  --detail detailed \
  --style filmbuff/writing-standards/screenplay/styles/neo-noir \
  --ai-provider anthropic

# CI pipeline (no wizard, exits 1 if --title or --genre missing)
CI=true filmbuff start --no-wizard --title "CI Film" --genre drama
```

---

## 🔍 Module Inspection

The `filmbuff inspect` command performs **language-aware source inspection** of modules, extracting structured metadata from JavaScript/TypeScript, Python, and PHP source files.

### Quick Start

```bash
# Inspect a linked module
filmbuff inspect my-module

# JSON output (pipe-friendly)
filmbuff inspect my-module --format json

# Only show functions and classes
filmbuff inspect my-module --filter functions,classes

# Inspect a directory directly
filmbuff inspect ./src --format markdown
```

### Language Support

| Language | Extensions | Extracted Elements |
|----------|------------|-------------------|
| **TypeScript** | `.ts`, `.tsx`, `.mts` | imports, exports, functions (regular + arrow + async), classes (with methods), interfaces, type aliases, constants |
| **JavaScript** | `.js`, `.jsx`, `.mjs`, `.cjs` | imports (ES6 + CJS), exports, functions, classes, variables |
| **Python 3** | `.py`, `.pyw` | imports, functions (sync + async), classes (with methods), decorators, docstrings, type annotations |
| **PHP** | `.php`, `.php8` | namespaces, use-statements, functions, classes, interfaces, traits, constants |

### Element Filtering

Use `--filter` to restrict output to specific element kinds:

```bash
filmbuff inspect ./src --filter functions
filmbuff inspect ./src --filter classes,interfaces
filmbuff inspect ./src --filter imports,exports
filmbuff inspect ./src --filter variables,constants
filmbuff inspect ./src --filter methods
```

Supported filter kinds: `function`, `class`, `method`, `import`, `export`, `variable`, `constant`, `interface`, `type`, `namespace`

### Output Formats

#### JSON (`--format json`)

Follows the `InspectionResult` schema (version 1.0):

```json
{
  "schema": "1.0",
  "generatedAt": "2026-04-07T10:00:00Z",
  "module": { "name": "...", "version": "...", "type": "...", "tags": [] },
  "metadata": { "totalFiles": 6, "rules": 3, "examples": 2 },
  "files": [ { "relativePath": "src/app.ts", "type": "javascript", "size": 4096 } ],
  "recommendations": [ { "id": "rec-001", "priority": "high", "title": "..." } ],
  "optimizations": [ { "id": "opt-001", "category": "performance", "impact": "medium" } ]
}
```

Stream large results to a file:

```bash
filmbuff inspect ./src --format json > report.json
```

#### Plain Text (`--format text`)

Human-readable output suitable for terminals and VS Code output channels.
Severity levels are colour-coded when outputting to a TTY:
- 🔴 **High** — red
- 🟡 **Medium** — yellow
- 🟢 **Low** — green

Disable colour for plain-text logs:

```bash
filmbuff inspect ./src --format text --no-color
```

#### Markdown (`--format markdown`)

Formatted tables suitable for GitHub, README files, and documentation:

```bash
filmbuff inspect ./src --format markdown > INSPECTION.md
```

### Configuration

Add inspection settings to your `filmbuff.config.json` (or `package.json` under `"filmbuff"`):

```json
{
  "inspect": {
    "defaultFormat": "text",
    "defaultFilter": ["function", "class"],
    "maxFiles": 200,
    "cache": {
      "enabled": true,
      "ttlSeconds": 300
    },
    "skipDirs": ["node_modules", ".git", "dist", "build"],
    "languages": ["typescript", "javascript", "python", "php"]
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultFormat` | `"json"` \| `"text"` \| `"markdown"` | `"text"` | Output format when `--format` is not supplied |
| `defaultFilter` | `string[]` | `[]` (all) | Element kinds included by default |
| `maxFiles` | `number` | `500` | Maximum files scanned per invocation |
| `cache.enabled` | `boolean` | `true` | Cache parsed ASTs between runs |
| `cache.ttlSeconds` | `number` | `300` | AST cache time-to-live in seconds |
| `skipDirs` | `string[]` | `["node_modules",".git","dist","build"]` | Directory names to skip when scanning |
| `languages` | `string[]` | all | Restrict inspection to specific languages |

### Dependency Analysis

The inspection engine also extracts **dependency graphs** from source imports:

```bash
filmbuff inspect ./src --deps             # Show dependency summary
filmbuff inspect ./src --deps --format json > deps.json
```

Dependency analysis:
- Reads `package.json`, `requirements.txt`, or `composer.json` for declared versions
- Classifies every import as `stdlib | npm | pip | composer | internal | url`
- Resolves declared version constraints from manifests
- Validates URL imports for syntactic correctness
- Flags undeclared (not-in-manifest) third-party packages

### Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `Unsupported file type: .coffee` | Extension not in supported list | Only `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.py`, `.php` are analysed |
| `Read error: ENOENT` | File not found | Verify the path; inspection resolves relative to CWD |
| `Parse error: ...` | Parser hit a syntax edge case | The parser is regex-based; complex macros or JSX transforms may not be fully parsed. Open an issue with a minimal repro |
| JSON output appears minified | `indent` default changed | Pass `--indent 2` or configure `inspect.defaultFormat` |
| Cache returning stale results | File changed but cache still warm | Run with `--no-cache` to bypass, or wait for the TTL to expire |
| VS Code output shows `←[31m` sequences | ANSI codes in non-TTY context | Set `colorize: false` in config or use `--no-color` flag |
| Missing packages in dependency report | `package.json` not found | Pass `--project-root <dir>` pointing to the directory containing your manifest |

### Architecture Notes

The inspection pipeline has three layers:

```
Source files
     │
     ▼
┌─────────────────────────────────────────────────┐
│  Language Parsers  (cli/src/parsers/)           │
│  js-ts-parser.ts  python-parser.ts  php-parser.ts│
└────────────────────┬────────────────────────────┘
                     │ ContentElement[]
                     ▼
┌─────────────────────────────────────────────────┐
│  Content Inspector  (cli/src/utils/)            │
│  content-inspector.ts                           │
│  • ElementFilter (kinds, namePattern, exported) │
│  • InspectionCache (LRU, 5-min TTL)             │
│  • inspectFile / inspectFiles / inspectDirectory│
└────────────────────┬────────────────────────────┘
                     │ ContentInspectionResult
                     ▼
┌─────────────────────────────────────────────────┐
│  Formatters  (cli/src/utils/formatters/)        │
│  inspection-json-formatter.ts                   │
│  inspection-text-formatter.ts                   │
│  inspection-report.ts  (Markdown)               │
└─────────────────────────────────────────────────┘
```

---

## 📄 License

MIT — see [LICENSE](./LICENSE)
