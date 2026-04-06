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

## FilmBuff CLI — AI Commands (Phase 9)

These commands replaced the removed `filmbuff provider *` and `filmbuff configure`
family in Phase 9 (bd-99b2).

### `filmbuff ai status`

Display the current ai-powered library integration status. No HTTP request is made.

```bash
filmbuff ai status
```

**Output:**
```
ai-powered Library Integration
  Provider:  openai             [from ~/.ai-powered/config.json]
  Model:     (provider default) [from ~/.ai-powered/config.json]
  Mock Mode: false              [AI_MOCK env]
  Plugins:   audit-log          [from filmbuff config]

Available Models: gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo
Video Providers:  lumaai
```

**Environment:**
- `AI_MOCK=true` — reports `Mock Mode: true`; provider shown as `mock`

---

### `filmbuff generate-video`

Generate video clips for a JSONL shot list using the ai-powered video provider.

```bash
filmbuff generate-video <shots-jsonl> [options]
```

**Arguments:**
- `<shots-jsonl>` — Path to JSONL shot list produced by `filmbuff generate-shot-list`

**Options:**
- `--output-dir <dir>` — Directory where video manifests are written (default: `./video-output`)
- `--shots <list>` — Comma-separated shot numbers to generate (e.g. `1,3,5`)
- `--concurrency <n>` — Number of parallel generation calls (default: `3`)
- `--mock` — Use the mock provider regardless of ai-powered config

**Examples:**
```bash
# Generate all shots
filmbuff generate-video shots.jsonl --output-dir ./videos

# Generate only shots 2 and 4 in mock mode
filmbuff generate-video shots.jsonl --shots 2,4 --mock

# Limit to 1 concurrent call (useful for rate-limited providers)
filmbuff generate-video shots.jsonl --concurrency 1

# Pipe from generate-shot-list
filmbuff generate-shot-list script.fountain --output shots.jsonl && \
filmbuff generate-video shots.jsonl --output-dir ./videos
```

**Exit codes:**
- `0` — All shots generated successfully
- `1` — One or more shots failed (details printed to stderr)

For provider setup, see [docs/PROVIDER_SETUP.md](PROVIDER_SETUP.md).

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

