# CLI Reference

Complete reference for the `augx` CLI tool.

## Global Options

```bash
augx --version    # Show version
augx --help       # Show help
```

## Commands

### `augx init`

Initialize Augment Extensions in the current project.

```bash
augx init [options]
```

**Options:**
- `--from-submodule` - Initialize from existing git submodule

**Examples:**
```bash
augx init
augx init --from-submodule
```

---

### `augx list`

List available or linked extension modules.

```bash
augx list [options]
```

**Options:**
- `--linked` - Show only linked modules
- `--json` - Output as JSON

**Examples:**
```bash
augx list                  # All available modules
augx list --linked         # Only linked modules
augx list --json           # JSON output
```

---

### `augx show <module>`

Display detailed information about a module.

```bash
augx show <module> [options]
```

**Arguments:**
- `<module>` - Module name (e.g., `coding-standards/typescript`)

**Options:**
- `--json` - Output as JSON

**Examples:**
```bash
augx show coding-standards/typescript
augx show domain-rules/api-design --json
```

---

### `augx show linked`

Show all linked modules in the current project.

```bash
augx show linked [options]
```

**Options:**
- `--json` - Output as JSON

**Examples:**
```bash
augx show linked
augx show linked --json
```

---

### `augx show all`

Show all available modules (both linked and unlinked).

```bash
augx show all [options]
```

**Options:**
- `--json` - Output as JSON

**Examples:**
```bash
augx show all
augx show all --json
```

---

### `augx link <module>`

Link an extension module to the current project.

```bash
augx link <module> [options]
```

**Arguments:**
- `<module>` - Module name to link

**Options:**
- `--version <version>` - Specific version to link

**Examples:**
```bash
augx link coding-standards/typescript
augx link coding-standards/python --version 2.1.0
```

---

### `augx unlink <module>`

Unlink an extension module from the current project.

```bash
augx unlink <module>
```

**Arguments:**
- `<module>` - Module name to unlink

**Examples:**
```bash
augx unlink coding-standards/typescript
```

---

### `augx update`

Update linked modules to latest versions.

```bash
augx update [options]
```

**Options:**
- `--module <name>` - Update specific module only

**Examples:**
```bash
augx update                                    # Update all
augx update --module coding-standards/typescript  # Update one
```

---

### `augx search <keyword>`

Search for extension modules.

```bash
augx search <keyword> [options]
```

**Arguments:**
- `<keyword>` - Search term

**Options:**
- `--type <type>` - Filter by module type

**Examples:**
```bash
augx search typescript
augx search api --type domain-rules
```

---

### `augx create <name>`

Create a new extension module.

```bash
augx create <name> [options]
```

**Arguments:**
- `<name>` - Module name

**Options:**
- `--type <type>` - Module type (coding-standards, domain-rules, examples)

**Examples:**
```bash
augx create my-standards --type coding-standards
```

---

### `augx validate <module>`

Validate module structure and metadata.

```bash
augx validate <module>
```

**Arguments:**
- `<module>` - Module name to validate

**Examples:**
```bash
augx validate coding-standards/typescript
```

---

### `augx pin <module> <version>`

Pin module to specific version.

```bash
augx pin <module> <version>
```

**Arguments:**
- `<module>` - Module name
- `<version>` - Version to pin

**Examples:**
```bash
augx pin coding-standards/typescript 1.2.0
```

---

### `augx check-updates`

Check for available module updates.

```bash
augx check-updates
```

**Examples:**
```bash
augx check-updates
```

---

### `augx diff <module>`

Show differences between current and latest version.

```bash
augx diff <module>
```

**Arguments:**
- `<module>` - Module name

**Examples:**
```bash
augx diff coding-standards/typescript
```

---

## JSON Output Format

When using `--json` flag, output follows this structure:

```json
{
  "modules": [
    {
      "name": "coding-standards/typescript",
      "version": "1.0.0",
      "description": "TypeScript coding standards",
      "type": "coding-standards",
      "linked": true
    }
  ]
}
```

## Exit Codes

- `0` - Success
- `1` - General error
- `2` - Invalid arguments
- `3` - Module not found
- `4` - Not initialized

## Environment Variables

- `AUGX_REPO` - Custom module repository URL
- `AUGX_NO_COLOR` - Disable colored output
- `AUGX_DEBUG` - Enable debug logging

---

## FilmBuff CLI — Project Commands

### `filmbuff start`

Initialise a new FilmBuff film project and seed all pipeline steps. Runs an
**interactive 12-step wizard** when called from an interactive terminal without
the two required fields, or accepts all settings as CLI flags for scripts and CI.

```bash
filmbuff start [options]
```

**Auto-trigger rule**
The wizard launches automatically when:
- Running in a TTY (`process.stdout.isTTY === true`), AND
- `--title` or `--genre` is missing, AND
- `--no-wizard` is not set, AND
- `CI` environment variable is not `"true"`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--title <title>` | Project display title | *(wizard)* |
| `--genre <genre>` | Film genre | *(wizard)* |
| `--wizard` | Force interactive wizard even when flags are supplied | auto |
| `--no-wizard` | Suppress wizard; requires `--title` and `--genre` | — |
| `--slug <slug>` | URL-safe identifier | derived from `--title` |
| `--tone <tone>` | Tone description (e.g. `dark`, `hopeful`) | — |
| `--audience <audience>` | Target audience description | — |
| `--budget <tier>` | `micro` · `low` · `mid` · `studio` | — |
| `--outcome <outcome>` | Desired outcome or logline intent | — |
| `--output-dir <dir>` | Output directory for generated files | `./output/<slug>` |
| `--format <fmt>` | `md` · `json` · `fountain` · `pdf` | `md` |
| `--detail <level>` | `brief` · `standard` · `detailed` | `standard` |
| `--style <module>` | Style module path (repeatable) | — |
| `--ai-provider <id>` | AI provider id (alias: `--provider`) | global default |
| `--ai-profile <name>` | AI provider profile (alias: `--profile`) | provider default |

**Wizard steps:**

| Step | Field | Notes |
|------|-------|-------|
| 1 | **Title** | 3–120 characters |
| 2 | **Genre** | Aliases normalised (e.g. `sci fi` → `sci-fi`) |
| 3 | **Slug** | Derived from title; collision-checked |
| 4 | **Tone** | Optional |
| 5 | **Audience** | Optional |
| 6 | **Budget tier** | Optional — `micro` · `low` · `mid` · `studio` |
| 7 | **Outcome** | Optional |
| 8 | **Output directory** | Default: `./output/<slug>` |
| 9 | **Format + Detail** | Two selects in one step |
| 10 | **Style modules** | Zero or more paths |
| 11 | **AI provider** | Discovered from `ai-powered` config; video-only providers excluded |
| 12 | **AI profile** | Profiles for the chosen provider |

After Step 12 a confirmation panel shows all values and the equivalent
one-liner command. Options: **Proceed** · **Edit** (re-enter Step 1 with values
pre-filled) · **Start Over** · **Quit**. Press `Ctrl-C` at any prompt to cancel
cleanly (exit 0, no database write).

**Examples:**

```bash
# Interactive — wizard launches automatically
filmbuff start

# Force wizard with pre-filled title
filmbuff start --title "Neon Requiem" --wizard

# Non-interactive
filmbuff start --title "The Midnight Run" --genre thriller --tone dark

# CI pipeline (wizard suppressed automatically; exits 1 if --title/--genre missing)
CI=true filmbuff start --no-wizard --title "CI Film" --genre drama
```

---

### `filmbuff continue`

Resume a FilmBuff project at its next pending pipeline step.

```bash
filmbuff continue --project <slug> [options]
```

**Required:** `--project <slug>`
**Options:** `--ai-provider <id>`, `--ai-profile <name>` (aliases: `--provider`, `--profile`)

---

### `filmbuff retry`

Re-queue the last failed or rejected pipeline step.

```bash
filmbuff retry --project <slug> [options]
```

**Required:** `--project <slug>`
**Options:** `--step <name>`, `--ai-provider <id>`, `--ai-profile <name>`

---

### `filmbuff status`

Display pipeline step statuses for a project.

```bash
filmbuff status --project <slug> [options]
```

**Required:** `--project <slug>`
**Options:** `--next`, `--pending`, `--all`, `--format <table|json>`

---

## FilmBuff CLI — AI Commands (Phase 9)

These commands replaced the removed `filmbuff provider *` and `filmbuff configure`
family in Phase 9 (bd-99b2).

### `filmbuff ai status`

Display the current ai-powered library integration status. No HTTP request is
made — always exits 0, works with no server running.

```bash
filmbuff ai status
```

**Output:**
```
ai-powered Library Integration
  Provider:   openai                  [from ~/.ai-powered/config.json]
  Model:      gpt-4o                  [from ~/.ai-powered/config.json]
  Mock Mode:  false                   [default]
  Plugins:    audit-log               [from filmbuff config]

  Available Models:
    • gpt-4o
    • gpt-4-turbo
    • gpt-3.5-turbo

  Video Providers:
    • lumaai: dream-machine-v2, dream-machine-v1
    • runway: gen-3-alpha, gen-3-turbo
```

**Environment:**
- `AI_MOCK=true` — reports `Mock Mode: true`; provider shown as `mock`

---

### `filmbuff generate-video`

Generate video clips for a JSONL shot list using the ai-powered video provider.

```bash
filmbuff generate-video --input <shots-jsonl> [options]
```

**Required:**
- `--input <file>` — Path to JSONL shot list produced by `filmbuff generate-shot-list`

**Options:**
- `--provider <id>` — Video provider id (default: `lumaai`; also: `runway`, `mock`)
- `--model <id>` — Model override for the selected provider (optional)
- `--shots <list>` — Comma-separated shot numbers to generate (e.g. `1,3,5`)
- `--output <dir>` — Directory where `manifest.json` is written (default: `./generated-videos`)
- `--concurrency <n>` — Number of parallel generation calls (default: `3`)
- `--mock` — Activate ai-powered MockProvider; no network calls made

**Examples:**
```bash
# Generate all shots with default provider (lumaai)
filmbuff generate-video --input shots.jsonl --output ./videos

# Generate only shots 2 and 4 in mock mode
filmbuff generate-video --input shots.jsonl --shots 2,4 --mock

# Use Runway with limited concurrency
filmbuff generate-video --input shots.jsonl --provider runway --concurrency 1

# One-step pipeline: shot list then video
filmbuff generate-shot-list script.fountain --output shots.jsonl
filmbuff generate-video --input shots.jsonl --output ./videos

# One-step pipeline via --generate-video flag
filmbuff generate-shot-list script.fountain --generate-video --video-output ./videos --mock
```

**Exit codes:**
- `0` — All shots generated successfully
- `1` — One or more shots failed (typed ai-powered error; details on stderr)
- `2` — `ValidationError` — unexpected API response schema

For provider credential setup, see [docs/PROVIDER_SETUP.md](PROVIDER_SETUP.md).

---

### Removed Commands (Phase 9)

The following commands were removed and print migration guidance + exit `1`:

| Removed | Replacement |
|---------|-------------|
| `filmbuff configure` | `ai-powered config set provider <name>` |
| `filmbuff provider list` | `filmbuff ai status` |
| `filmbuff provider create` | `ai-powered config set provider <name>` |
| `filmbuff provider activate` | `ai-powered config set provider <name>` |
| `filmbuff provider status` | `filmbuff ai status` |
| `filmbuff provider show` | `filmbuff ai status` |
| `filmbuff provider validate` | `ai-powered config validate` |
| `filmbuff provider edit` | `ai-powered config set <key> <value>` |
| `filmbuff provider delete` | `ai-powered config remove <key>` |

