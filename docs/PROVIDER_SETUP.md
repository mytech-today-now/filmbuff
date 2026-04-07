# AI Provider Setup — FilmBuff User Guide

FilmBuff integrates AI through the **ai-powered** npm library, loaded
in-process. There is **no local server to start**. FilmBuff stores zero
credentials — all provider and API key management is handled entirely by
`ai-powered`.

---

## Table of Contents

1. [Credential Options](#credential-options)
2. [Supported Providers](#supported-providers)
3. [Mock Mode (No Credentials)](#mock-mode-no-credentials)
4. [Video Generation](#video-generation)
5. [Plugin Configuration](#plugin-configuration)
6. [Checking Status](#checking-status)
7. [Troubleshooting](#troubleshooting)
8. [Removed Commands](#removed-commands)

---

## Credential Options

Choose **one** of the three options below. All three are supported
simultaneously — environment variables override the config file.

### Option 1 — Config file (recommended for development)

```bash
# Set provider and API key once — saved to ~/.ai-powered/config.json
ai-powered config set provider openai
ai-powered config set apiKey sk-proj-...

# Verify
filmbuff ai status
```

FilmBuff reads `~/.ai-powered/config.json` automatically on every run.
You never need to edit this file by hand.

### Option 2 — Environment variables (recommended for CI/CD)

```bash
export AI_PROVIDER=openai
export AI_API_KEY=sk-proj-...
filmbuff generate-shot-list script.fountain --output shots.jsonl
```

Environment variables override the config file for the current session.

### Option 3 — Mock mode (no credentials required)

```bash
# All AI calls return deterministic in-process responses
AI_MOCK=true filmbuff generate-shot-list script.fountain --output shots.jsonl
AI_MOCK=true filmbuff generate-video --input shots.jsonl
```

Mock mode is ideal for local development, CI pipelines, and demos.
No API key, no network, no cost.

---

## Supported Providers

`ai-powered` handles all provider communication. FilmBuff supports any
provider that `ai-powered` recognises.

| Provider ID       | Text generation | Video generation | Notes                  |
|-------------------|:--------------:|:----------------:|------------------------|
| `anthropic`       | ✓              |                  | Claude family          |
| `openai`          | ✓              |                  | GPT family             |
| `google`          | ✓              |                  | Gemini family          |
| `xai`             | ✓              |                  | Grok models            |
| `venice`          | ✓              |                  | Privacy-focused        |
| `lumaai`          |                | ✓                | Dream Machine          |
| `runway`          |                | ✓                | Gen-3 family           |
| `stable-diffusion`|                | ✓                | Open-source            |
| `mock`            | ✓              | ✓                | No key, no network     |

---

## Mock Mode (No Credentials)

```bash
AI_MOCK=true filmbuff generate-shot-list script.fountain --output shots.jsonl
AI_MOCK=true filmbuff generate-video --input shots.jsonl
```

When mock mode is active, all AI calls return deterministic in-process
responses. No network, no key, no cost.

---

## Video Generation

To generate video clips from a shot list, configure a video-capable
provider (e.g. **lumaai** or **runway**):

```bash
ai-powered config set provider lumaai
ai-powered config set apiKey luma-...

filmbuff generate-video --input shots.jsonl --output ./videos
```

**All generate-video flags:**

```bash
filmbuff generate-video \
  --input shots.jsonl \     # (required) JSONL shot list
  --provider lumaai \       # video provider (default: lumaai)
  --model dream-machine-v2 \# model override (optional)
  --shots 1,3,5 \           # only generate shots 1, 3, 5
  --output ./videos \       # output directory (default: ./generated-videos)
  --concurrency 3 \         # parallel calls (default: 3)
  --mock                    # use mock provider
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

The command makes **no network requests** and always exits 0.

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

