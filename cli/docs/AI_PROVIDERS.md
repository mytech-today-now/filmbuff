# AI Integration — Developer Reference

FilmBuff integrates AI through the **ai-powered** npm library, loaded directly
in-process. There is **no HTTP gateway** and **no local server to start**.
FilmBuff stores zero API credentials — all credential management is delegated
to `ai-powered`.

---

## Quick Start

### 1 — Install ai-powered

```bash
npm install ai-powered
```

### 2 — Configure your provider (one-time)

```bash
ai-powered config set provider openai
ai-powered config set apiKey sk-proj-...
```

Credentials are written to `~/.ai-powered/config.json` and are read
automatically by every FilmBuff command. FilmBuff never touches them.

### 3 — Verify

```bash
filmbuff ai status
```

Expected output:

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
    • pika: pika/pika-2.5/text-to-video, pika/pika-2.5/image-to-video, pika/pikaframes/image-to-video, pika/pikadditions/video-to-video, pika/pikaswaps/video-to-video, pika/pikaffects/image-to-video, pika/pikaffects/video-to-video
```

### 4 — Run a command

```bash
filmbuff generate-shot-list script.fountain --output shots.jsonl
filmbuff generate-video --input shots.jsonl --output ./videos
```

---

## How FilmBuff Uses ai-powered

Every AI feature in FilmBuff calls `getFilmbuffAiClient(toolName)`, the single
integration point declared in `cli/src/utils/filmbuff-ai-client.ts`.

Pika video generation is the documented exception because the installed
ai-powered package does not expose the current Pika REST fields. The CLI uses
the local typed HTTPS adapter and the same shared capability source.

```typescript
// Only file allowed to import from 'ai-powered'
import { getFilmbuffAiClient } from '../utils/filmbuff-ai-client.js';

const client = await getFilmbuffAiClient('blocking-extractor');
const result = await client.complete(prompt);
```

### toolName convention

Each caller supplies a stable `toolName` string that appears in audit-log
records and in `ai-powered` diagnostics:

| toolName              | Feature                             |
|-----------------------|-------------------------------------|
| `blocking-extractor`  | `generate-shot-list` blocking pass  |
| `entity-extractor`    | `generate-shot-list` entity pass    |
| `video-generator`     | `generate-video`                    |
| `ai-status`           | `filmbuff ai status`                |

### FILMBUFF_DEFAULTS

A `FILMBUFF_DEFAULTS` object in `filmbuff-ai-client.ts` is spread into every
`getAiClient()` call so FilmBuff-wide options (e.g. the `audit-log` plugin)
are applied consistently without callers repeating them.

---

## Supported Providers

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
| `mock`            | ✓              | ✓                | No API key, no network |
| `pika`            |                | ✓                | Current Pika REST API; set `PIKA_API_KEY` |

Pika model choices and option constraints come from the shared capability
source. The current model IDs are the seven IDs printed by `filmbuff ai
status`. FilmBuff does not use the deprecated `pika.me/dev` Developer API.

---

## Mock Mode (No Credentials Required)

```bash
# Via environment variable (all commands)
AI_MOCK=true filmbuff generate-shot-list script.fountain --output shots.jsonl
AI_MOCK=true filmbuff generate-video --input shots.jsonl --output ./videos

# Via flag (generate-video only)
filmbuff generate-video --input shots.jsonl --mock
```

When mock mode is active:
- All AI calls return deterministic in-process responses
- No network requests are made
- No API key is required
- `filmbuff ai status` reports `Mock Mode: true`

---

## Video Generation

```bash
# Generate from a shot list
filmbuff generate-video --input shots.jsonl --output ./videos --provider lumaai

# Generate with the current Pika text-to-video model
PIKA_API_KEY=your-key filmbuff generate-video \
  --input shots.jsonl \
  --provider pika \
  --model pika/pika-2.5/text-to-video \
  --provider-options '{"resolution":"1080p","duration_s":5,"seed":42}'

# One-step pipeline (shot list + video in a single command)
filmbuff generate-shot-list script.fountain --output shots.jsonl --generate-video \
  --video-output ./videos --mock
```

See [docs/CLI_REFERENCE.md](../../docs/CLI_REFERENCE.md) for all flags.

---

## Plugins

FilmBuff enables the `audit-log` plugin by default via `FILMBUFF_DEFAULTS`.
To add plugins, edit the `FILMBUFF_DEFAULTS` constant in
`cli/src/utils/filmbuff-ai-client.ts`:

```typescript
export const FILMBUFF_DEFAULTS = {
  plugins: ['audit-log', 'my-plugin'],
  debug: false,
};
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `ConfigError: No provider configured` | Config file missing | `ai-powered config set provider <name>` |
| `ConfigError: API key not found` | API key not set | `ai-powered config set apiKey <key>` |
| `ProviderCapabilityError` | Provider can't do text/video | Check supported providers table above |
| `BudgetExceededError` | Spend limit reached | Check `~/.ai-powered/config.json` budget settings |
| `ValidationError` (exit 2) | Unexpected API response schema | Report at GitHub Issues |
| `filmbuff provider *` not found | Removed command | Use `filmbuff ai status` + `ai-powered config set` |
| Unexpected output | Wrong provider/model | Check `filmbuff ai status` |

```bash
# Inspect resolved config at any time — no network call
filmbuff ai status

# Test the full pipeline with no credentials
AI_MOCK=true filmbuff generate-shot-list script.fountain --output shots.jsonl
AI_MOCK=true filmbuff generate-video --input shots.jsonl
```

---

## Removed Commands

The following commands were removed and now print migration guidance + exit 1:

| Removed Command          | Replacement                               |
|--------------------------|-------------------------------------------|
| `filmbuff configure`     | `ai-powered config set provider <name>`   |
| `filmbuff provider list` | `filmbuff ai status`                      |
| `filmbuff provider create` | `ai-powered config set provider <name>` |
| `filmbuff provider activate` | `ai-powered config set provider <name>`|
| `filmbuff provider status` | `filmbuff ai status`                    |
| `filmbuff provider show` | `filmbuff ai status`                      |
| `filmbuff provider validate` | `ai-powered config validate`          |
| `filmbuff provider edit` | `ai-powered config set <key> <value>`     |
| `filmbuff provider delete` | `ai-powered config remove <key>`        |

---

*For the complete CLI reference, see [docs/CLI_REFERENCE.md](../../docs/CLI_REFERENCE.md).*
*For provider credential setup, see [docs/PROVIDER_SETUP.md](../../docs/PROVIDER_SETUP.md).*

