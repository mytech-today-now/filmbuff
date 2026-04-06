# AI Provider Setup — FilmBuff User Guide

> **Phase 9 (bd-99b2):** FilmBuff no longer manages AI providers internally.
> All configuration is delegated to the
> [`ai-powered`](https://www.npmjs.com/package/ai-powered) npm library.

FilmBuff routes AI-powered commands (`generate-shot-list`, `generate-video`)
through the **ai-powered** library. Configure a provider once with the
`ai-powered` CLI and all FilmBuff commands use it automatically.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Supported Providers](#supported-providers)
3. [Environment Variables](#environment-variables)
4. [Mock Mode (No API Key)](#mock-mode-no-api-key)
5. [Video Generation](#video-generation)
6. [Plugin Configuration](#plugin-configuration)
7. [Checking Status](#checking-status)
8. [Troubleshooting](#troubleshooting)
9. [Removed Commands](#removed-commands)

---

## Quick Start

### Step 1 — Install ai-powered

```bash
npm install -g ai-powered
```

### Step 2 — Configure provider and API key

```bash
ai-powered config set provider openai
ai-powered config set apiKey sk-proj-...
```

### Step 3 — Verify

```bash
filmbuff ai status
```

You should see your provider, model, and plugin settings.

### Step 4 — Run a command

```bash
filmbuff generate-shot-list script.fountain --output shots.jsonl
```

---

## Supported Providers

| Provider ID  | Capabilities                        | Notes                     |
|-------------|-------------------------------------|---------------------------|
| `openai`    | text-generation, generate-shot-list | Default; gpt-4o family    |
| `anthropic` | text-generation, generate-shot-list | Claude family             |
| `xai`       | text-generation                     | Grok models               |
| `venice`    | text-generation                     | Privacy-focused           |
| `lumaai`    | **video-generation**, generate-video | Dream Machine / Photon   |
| `mock`      | all (no API call)                   | `AI_MOCK=true`            |

---

## Environment Variables

| Variable   | Purpose                                                      |
|-----------|--------------------------------------------------------------|
| `AI_MOCK`  | Set to `true` to use the mock provider (no API calls)        |
| `AI_POWERED_CONFIG` | Override config file path (default: `~/.ai-powered/config.json`) |

API keys are stored in `~/.ai-powered/config.json` by `ai-powered config set apiKey`.
They are **never** written to project files.

---

## Mock Mode (No API Key Required)

```bash
AI_MOCK=true filmbuff generate-shot-list script.fountain --output shots.jsonl
AI_MOCK=true filmbuff generate-video shots.jsonl --mock
```

`AI_MOCK=true` routes all AI calls to a deterministic mock — useful for CI/CD
and development without incurring API costs.

---

## Video Generation

To generate video clips from a shot list, use the **lumaai** provider:

```bash
ai-powered config set provider lumaai
ai-powered config set apiKey luma-...

filmbuff generate-video shots.jsonl --output-dir ./videos
```

**Options:**

```bash
filmbuff generate-video shots.jsonl \
  --output-dir ./videos \
  --shots 1,3,5 \        # only generate shots 1, 3, 5
  --concurrency 3 \      # parallel generation (default: 3)
  --mock                 # use mock provider (overrides AI_MOCK)
```

---

## Plugin Configuration

FilmBuff enables `audit-log` by default. To customise plugins, edit
`.augment/augment.json`:

```json
{
  "aiPowered": {
    "plugins": ["audit-log"],
    "debug": false
  }
}
```

Setting `debug: true` emits verbose ai-powered library logs to stderr.

---

## Checking Status

```bash
filmbuff ai status
```

Output:
```
ai-powered Library Integration
  Provider:  openai             [from ~/.ai-powered/config.json]
  Model:     (provider default) [from ~/.ai-powered/config.json]
  Mock Mode: false              [AI_MOCK env]
  Plugins:   audit-log          [from filmbuff config]

Available Models: gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo
Video Providers:  lumaai
```

No HTTP request is made; all information comes from the config file and env vars.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Error: No provider configured` | ai-powered config missing | `ai-powered config set provider openai` |
| `Error: API key not found` | API key not set | `ai-powered config set apiKey <key>` |
| `Error: Unknown command "provider ..."` | Using removed FilmBuff command | See [Removed Commands](#removed-commands) |
| `Error: Unknown command "configure"` | Using removed FilmBuff command | `ai-powered config set provider <name>` |
| Network timeout | Slow API, bad key, or rate limit | Try `AI_MOCK=true` to isolate |

---

## Removed Commands

The following FilmBuff commands were removed in **Phase 9 (bd-99b2)**:

| Removed Command | Replacement |
|----------------|-------------|
| `filmbuff configure` | `ai-powered config set provider <name>` |
| `filmbuff provider list` | `filmbuff ai status` |
| `filmbuff provider create` | `ai-powered config set provider <name>` |
| `filmbuff provider activate` | `ai-powered config set provider <name>` |
| `filmbuff provider status` | `filmbuff ai status` |
| `filmbuff provider show` | `filmbuff ai status` |
| `filmbuff provider validate` | `ai-powered config validate` |
| `filmbuff provider edit` | `ai-powered config set <key> <value>` |
| `filmbuff provider delete` | `ai-powered config remove <key>` |

Any removed command prints the migration guidance below and exits non-zero:

```
Error: Unknown command "<cmd>". Provider configuration is now managed by ai-powered.
  Run: ai-powered config set provider <name>
       ai-powered config set apiKey <key>
  See: filmbuff ai status
```

---

*For internal architecture details, see [cli/docs/AI_PROVIDERS.md](../cli/docs/AI_PROVIDERS.md).*

