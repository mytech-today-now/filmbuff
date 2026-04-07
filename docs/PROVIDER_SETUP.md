# AI Provider Setup — FilmBuff User Guide

FilmBuff routes AI-powered commands (`generate-shot-list`) through the
**ai-powered** HTTP gateway. The gateway connects to your chosen provider
and FilmBuff connects to the gateway.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [FilmBuff Configuration Keys](#filmbuff-configuration-keys)
3. [Supported Providers](#supported-providers)
4. [Environment Variables](#environment-variables)
5. [Mock Mode (No API Key)](#mock-mode-no-api-key)
6. [Video Generation](#video-generation)
7. [Plugin Configuration](#plugin-configuration)
8. [Checking Status](#checking-status)
9. [Troubleshooting](#troubleshooting)
10. [Removed Commands](#removed-commands)

---

## Quick Start

### Step 1 — Install ai-powered

```bash
npm install -g ai-powered
```

### Step 2 — Start the ai-powered gateway

```bash
ai-powered start
```

The gateway starts on `http://localhost:3001` by default.

### Step 3 — Configure provider and API key (in ai-powered)

```bash
ai-powered config set provider openai
ai-powered config set apiKey sk-proj-...
```

### Step 4 — Verify

```bash
filmbuff ai status
```

You should see gateway URL, model, and all resolved config values.

### Step 5 — Run a command

```bash
filmbuff generate-shot-list script.fountain --output shots.jsonl
```

---

## FilmBuff Configuration Keys

FilmBuff has six AI configuration keys resolved in priority order:

| Key | Type | Default | Env Var | CLI Flag |
|-----|------|---------|---------|----------|
| `url` | `string` | `http://localhost:3001` | `AI_POWERED_URL` | `--ai-powered-url` |
| `model` | `string` | `gpt-4` | `AI_MODEL` | `--ai-model` |
| `systemPrompt` | `string` | *(FilmBuff default)* | `AI_SYSTEM_PROMPT` | `--system-prompt` |
| `temperature` | `number` (0–2) | `0.7` | `AI_TEMPERATURE` | `--temperature` |
| `maxTokens` | `number` (>0) | `2048` | `AI_MAX_TOKENS` | `--max-tokens` |
| `timeoutMs` | `number` (>0) | `30000` | `AI_TIMEOUT_MS` | `--timeout` |

**Resolution order (highest precedence first):**
1. CLI flag (`--ai-model gpt-4o`)
2. Environment variable (`AI_MODEL=gpt-4o`)
3. Config file (`filmbuff ai set model gpt-4o`)
4. Built-in default

**Persist a setting permanently:**

```bash
filmbuff ai set url http://my-gateway:8080
filmbuff ai set model gpt-4o
filmbuff ai set temperature 0.5
filmbuff ai set maxTokens 4096
filmbuff ai set timeoutMs 60000
```

**Per-command CLI override:**

```bash
filmbuff generate-shot-list script.fountain \
  --ai-model gpt-4o \
  --temperature 0.2 \
  --max-tokens 4096
```

**Session-wide env override:**

```bash
AI_MODEL=gpt-4o-mini AI_TEMPERATURE=0.3 filmbuff generate-shot-list script.fountain
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

| Variable | Purpose |
|----------|---------|
| `AI_POWERED_URL` | Gateway URL (default: `http://localhost:3001`) |
| `AI_MODEL` | Model identifier (default: `gpt-4`) |
| `AI_SYSTEM_PROMPT` | System prompt override |
| `AI_TEMPERATURE` | Sampling temperature (0–2, default: `0.7`) |
| `AI_MAX_TOKENS` | Max response tokens (default: `2048`) |
| `AI_TIMEOUT_MS` | Request timeout in ms (default: `30000`) |
| `AI_MOCK` | Set to `true` to use the mock provider (no API calls) |

API keys are managed by the `ai-powered` gateway and are **never** written to
project files.

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

