# AI Integration — Setup & Troubleshooting

> **Phase 9 (bd-99b2):** FilmBuff no longer manages AI providers internally.
> All provider configuration is delegated to the
> [`ai-powered`](https://www.npmjs.com/package/ai-powered) npm library.

FilmBuff routes all AI-powered commands (`generate-shot-list`, `generate-video`)
through the **ai-powered** library. You configure the provider once via the
`ai-powered` CLI and FilmBuff picks it up automatically at runtime.

---

## Quick Start

### 1 — Install ai-powered

```bash
npm install -g ai-powered
```

### 2 — Configure your provider

```bash
ai-powered config set provider openai
ai-powered config set apiKey sk-proj-...
```

Repeat for any other providers you want to use (e.g. `anthropic`, `xai`, `lumaai`).

### 3 — Verify with FilmBuff

```bash
filmbuff ai status
```

Expected output:
```
ai-powered Library Integration
  Provider:  openai           [from ~/.ai-powered/config.json]
  Model:     (provider default) [from ~/.ai-powered/config.json]
  Mock Mode: false             [AI_MOCK env]
  Plugins:   audit-log         [from filmbuff config]

Available Models: gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo
Video Providers:  lumaai
```

---

## Supported Providers

| Provider ID  | Capabilities                           | Notes                        |
|-------------|----------------------------------------|------------------------------|
| `openai`    | text-generation, generate-shot-list    | Default provider             |
| `anthropic` | text-generation, generate-shot-list    |                              |
| `xai`       | text-generation                        | Grok models                  |
| `venice`    | text-generation                        | Privacy-focused               |
| `lumaai`    | video-generation, generate-video       | Video clips via Dream Machine |
| `mock`      | all (no API call made)                 | Set `AI_MOCK=true`           |

---

## Mock Mode (No API Key Required)

```bash
AI_MOCK=true filmbuff generate-shot-list script.fountain --output shots.jsonl
AI_MOCK=true filmbuff generate-video shots.jsonl
```

When `AI_MOCK=true` is set, all AI calls return deterministic mock responses.
`filmbuff ai status` will report `Mock Mode: true`.

---

## Video Generation Providers

To generate video clips with `filmbuff generate-video`, you need a **lumaai**
account and API key:

```bash
ai-powered config set provider lumaai
ai-powered config set apiKey luma-...
```

Then run:

```bash
filmbuff generate-video shots.jsonl --output-dir ./videos
```

See `filmbuff generate-video --help` for all options.

---

## Plugins

FilmBuff enables the `audit-log` plugin by default. Configure plugins in your
`.augment/augment.json`:

```json
{
  "aiPowered": {
    "plugins": ["audit-log"],
    "debug": false
  }
}
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Error: No provider configured` | ai-powered config missing | Run `ai-powered config set provider <name>` |
| `Error: API key not found` | API key not set | Run `ai-powered config set apiKey <key>` |
| `Error: Unknown command "provider ..."` | Using removed command | Run `filmbuff ai status` instead |
| `Error: Unknown command "configure"` | Using removed command | Run `ai-powered config set provider <name>` |
| Unexpected AI output | Wrong provider/model | Check `filmbuff ai status` output |
| Network timeout | Slow API response | Use `--mock` flag to test without network |

### Debug mode

```bash
# Show ai-powered config without running a command
filmbuff ai status

# Run with mock provider to test pipeline without AI calls
AI_MOCK=true filmbuff generate-shot-list script.fountain --output shots.jsonl
```

---

## Removed Commands

The following commands were removed in **Phase 9 (bd-99b2)**:

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

Any of the above commands will print migration guidance and exit non-zero.

---

*For complete CLI reference, see [docs/CLI_REFERENCE.md](../../docs/CLI_REFERENCE.md).*

