# AI Integration — Setup & Troubleshooting

FilmBuff routes all AI-powered commands (`generate-shot-list`) through the
**ai-powered** HTTP gateway. The gateway runs locally and connects to your
chosen provider (OpenAI, Anthropic, etc.) on your behalf.

---

## Quick Start

### 1 — Install ai-powered

```bash
npm install -g ai-powered
```

### 2 — Start the ai-powered gateway

```bash
ai-powered start
```

The gateway listens on `http://localhost:3001` by default.

### 3 — Configure your provider (in ai-powered)

```bash
ai-powered config set provider openai
ai-powered config set apiKey sk-proj-...
```

### 4 — Verify with FilmBuff

```bash
filmbuff ai status
```

Expected output:
```
FilmBuff AI Configuration
  URL:           http://localhost:3001   [from default]
  Model:         gpt-4                  [from default]
  System Prompt: (FilmBuff default)     [from default]
  Temperature:   0.7                    [from default]
  Max Tokens:    2048                   [from default]
  Timeout (ms):  30000                  [from default]

Gateway health: ✓ ONLINE
```

---

## Configuration Keys

FilmBuff reads AI configuration from three sources (highest wins):

1. **CLI flags** — per-invocation overrides
2. **Environment variables** — session-wide overrides
3. **Config file** — persistent settings via `filmbuff ai set`
4. **Built-in defaults** — safe fallbacks

The six configurable keys:

| Key | Type | Default | Env Var | CLI Flag |
|-----|------|---------|---------|----------|
| `url` | `string` | `http://localhost:3001` | `AI_POWERED_URL` | `--ai-powered-url` |
| `model` | `string` | `gpt-4` | `AI_MODEL` | `--ai-model` |
| `systemPrompt` | `string` | *(FilmBuff default)* | `AI_SYSTEM_PROMPT` | `--system-prompt` |
| `temperature` | `number` (0–2) | `0.7` | `AI_TEMPERATURE` | `--temperature` |
| `maxTokens` | `number` (>0) | `2048` | `AI_MAX_TOKENS` | `--max-tokens` |
| `timeoutMs` | `number` (>0) | `30000` | `AI_TIMEOUT_MS` | `--timeout` |

### Persist a setting permanently

```bash
filmbuff ai set url http://my-gateway:8080
filmbuff ai set model gpt-4o
filmbuff ai set temperature 0.5
```

Settings are saved to `.augment/augment.json` under the `aiPowered` block:

```json
{
  "aiPowered": {
    "url": "http://my-gateway:8080",
    "model": "gpt-4o",
    "temperature": 0.5
  }
}
```

### Per-command override via CLI flag

```bash
filmbuff generate-shot-list script.fountain --ai-model gpt-4o --temperature 0.2
```

### Session-wide override via environment variable

```bash
AI_MODEL=gpt-4o-mini AI_TEMPERATURE=0.3 filmbuff generate-shot-list script.fountain
```

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

