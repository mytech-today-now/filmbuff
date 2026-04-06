# JIRA Ticket: TBD — Delegate All FilmBuff AI Operations to `ai-powered` npm Library (Library Import, Not HTTP Server)

### Summary

Refactor `filmbuff` so that every AI inference call and all AI-driven media generation is delegated to the [`ai-powered`](https://github.com/mytech-today-now/ai-powered) npm package, imported directly as a TypeScript library dependency rather than communicated with over HTTP. The current `AIPoweredClient` HTTP client (which targets a locally-running `ai-powered` server at `http://localhost:3001`) and the embedded `@anthropic-ai/sdk` usages in the shot-list generator extractors are both replaced by `import { getAiClient } from 'ai-powered'`. This in-process integration eliminates the separate server-process requirement, externalizes all API credential management to `ai-powered`'s own config system, exposes every provider `ai-powered` supports (OpenAI, Anthropic, xAI/Grok, Venice.ai, Luma AI, Runway, Ollama/Custom, Mock) without any filmbuff-side adapter layer, and enables AI video generation from `generate-shot-list` shot entries via `ai-powered`'s `video` modality.

### Description

#### Background

`filmbuff` currently contains three parallel and partially overlapping AI integration mechanisms that together impose unnecessary maintenance cost and limit what providers and modalities are available to users:

1. **Direct Anthropic SDK imports in the shot-list generator.** `ai-blocking-extractor.ts` and `ai-entity-extractor.ts` each import `Anthropic` from `@anthropic-ai/sdk`, read `process.env.ANTHROPIC_API_KEY` directly, and call `client.messages.create()` using Claude Sonnet. These files are hard-coded to a single provider. Switching to GPT-4o or any other model requires code changes. The files themselves contain TODO comments (`// TODO (bd-4g4l): Remove this file once AIPoweredClient handles all AI inference`) acknowledging that this code is already marked for replacement.

2. **The `AIPoweredClient` HTTP client (`cli/src/utils/ai-powered-client.ts`).** This class issues `POST http://localhost:3001/v1/chat/completions` requests in OpenAI Chat Completions format. While better than direct SDK usage, it requires a separate `ai-powered` server process to be running at all times. There is no in-process fallback, no mock mode, and no way to switch providers without restarting the server.

3. **The built-in `ProviderRegistry` and adapter layer (`cli/src/providers/`).** This includes `ProviderRegistry.ts`, a `ProviderAdapter` interface, and built-in adapters that exist in parallel with the HTTP client. These are largely vestigial — the HTTP client replaced them — but they still compile and appear in imports, creating confusion about which code path is actually active.

The `ai-powered` npm package (`npm install ai-powered`) resolves all three problems at the library level. Its `getAiClient()` factory runs in-process, supports five modalities (`text`, `image`, `audio`, `video`, `structured`), manages all API keys through its own layered config system (`~/.ai-powered/config.json` → `./.ai-powered/config.json` → named profiles → `AI_*` env vars → runtime overrides), provides per-provider circuit breakers and automatic failover, and includes a `MockProvider` that works in-process without any network calls. A user switching from Anthropic to OpenAI, or adding Runway for video generation, changes only their `~/.ai-powered/config.json` — no `filmbuff` code or config changes are required.

This ticket supersedes the HTTP-client approach described in `ai-prompts/replace-ai-with-ai-powered.md`. That ticket targeted a server-over-HTTP integration; this ticket targets a library-import integration. The two approaches are mutually exclusive. This ticket should be implemented after or instead of that one.

#### Scope of Removal

The following files and systems must be retired. Delete all code, registrations, and test coverage that pertains exclusively to the abstractions being replaced.

**Delete entirely:**

| File | Reason |
|---|---|
| `cli/src/utils/ai-powered-client.ts` | HTTP client to localhost server replaced by `getAiClient()` in-process call |
| `cli/src/providers/ProviderRegistry.ts` | `ai-powered` manages all provider registration internally |
| `cli/src/providers/builtin/` (full directory) | All built-in provider adapters replaced by `ai-powered`'s own providers |
| `cli/src/providers/types.ts` | `ProviderAdapter`, `AdapterEntry`, `GenerateOptions`, `GenerateResult` no longer needed |
| `cli/src/providers/index.ts` | Provider barrel export removed with the directory |

**Replace entirely (rewrite with new purpose):**

| File | New Purpose |
|---|---|
| `cli/src/utils/runtime-resolver.ts` | Thin `resolveAIClient(toolName, overrides?)` wrapper around `getFilmbuffAiClient()` |
| `cli/src/utils/ai-provider-config.ts` | Only `normalizeAIProvider()` and `normalizeAIModel()` normalizer helpers remain; all URL/model constants removed |
| `cli/src/utils/filmbuff-ai-client.ts` | **New file** — `getFilmbuffAiClient()` wrapper with filmbuff-specific defaults |
| `cli/src/types/ai-providers.ts` | Remove `ProviderDefinition`, `ProviderProfile`, registry types; retain `ProviderCapability` only if referenced elsewhere |
| `cli/docs/AI_PROVIDERS.md` | Rewrite to document the `ai-powered` npm library integration |

**Update (targeted changes):**

| File | Change Summary |
|---|---|
| `cli/src/commands/generate-shot-list/generator/ai-blocking-extractor.ts` | Remove `@anthropic-ai/sdk` import; replace `new Anthropic()` with `getFilmbuffAiClient('blocking-extractor')` |
| `cli/src/commands/generate-shot-list/generator/ai-entity-extractor.ts` | Same as `ai-blocking-extractor.ts` |
| `cli/src/utils/config-system.ts` | Replace `ai.provider`/`ai.model` config shape with `aiPowered` block (`plugins`, `debug`) |
| `cli/config/augment-default.json` | Update `ai` block → `aiPowered` block |
| `cli/config/augment-schema.json` | Reflect new `aiPowered` schema |
| `cli/src/commands/provider.ts` | Delete all `provider *` and `configure` command handlers |
| `docs/PROVIDER_SETUP.md` | Remove third-party provider setup; document `~/.ai-powered/config.json` and `AI_*` env vars |
| `docs/CLI_REFERENCE.md` | Remove deleted commands; document `generate-video` and updated `ai status` |

**Add (new files):**

| File | Purpose |
|---|---|
| `cli/src/utils/filmbuff-ai-client.ts` | Central wrapper: `getFilmbuffAiClient(toolName, overrides?)` |
| `cli/src/commands/generate-video.ts` | New command: `filmbuff generate-video --input <shot-list.jsonl>` |
| `cli/src/lib/video-generator.ts` | `FilmbuffVideoGenerator` class using `ai-powered` `video` modality |

#### New Architecture

After this refactor there is **no HTTP server process**. `getAiClient()` runs in the same Node.js process as `filmbuff` and calls provider APIs directly using the appropriate SDK that `ai-powered` bundles. The `http://localhost:3001` dependency is eliminated entirely.

```
filmbuff CLI (in-process)
    │
    ├── generate-shot-list
    │       ├── AIBlockingExtractor  → getFilmbuffAiClient('blocking-extractor')
    │       └── AIEntityExtractor   → getFilmbuffAiClient('entity-extractor')
    │
    ├── generate-video (NEW)
    │       └── FilmbuffVideoGenerator → getFilmbuffAiClient('video-generator')
    │                                    → client.generateVideo(prompt, videoOptions)
    │
    └── ai status
            └── resolveAIClient('ai-status') → client.listModels()

ai-powered (npm library, same process, no HTTP)
    ├── Providers: openai · anthropic · xai · venice · lumaai · runway · custom · mock
    ├── API keys:  ~/.ai-powered/config.json  |  AI_* env vars  (filmbuff never reads keys)
    ├── Modalities: text · image · audio · video · structured
    └── Plugins:   audit-log · rate-limiter · prompt-shield
```

#### `filmbuff-ai-client.ts` — Central Wrapper

All filmbuff modules that need AI inference import from `cli/src/utils/filmbuff-ai-client.ts`. No filmbuff module imports `getAiClient` from `ai-powered` directly.

```typescript
import { getAiClient } from 'ai-powered';
import type { AiClient, AiConfig } from 'ai-powered';

const FILMBUFF_DEFAULTS: Partial<AiConfig> = {
  plugins: ['audit-log'],
};

export async function getFilmbuffAiClient(
  toolName: string,
  overrides?: Partial<AiConfig>,
): Promise<AiClient> {
  return getAiClient(toolName, { ...FILMBUFF_DEFAULTS, ...overrides });
}
```

**Why a wrapper instead of importing `getAiClient` directly everywhere:**
- Centralizes filmbuff's default plugins and config in one place. Adding the `rate-limiter` plugin for all filmbuff calls requires a one-line change in this file only.
- Makes `mock: true` injectable in tests without reaching into every call site: `jest.mock('./filmbuff-ai-client', () => ({ getFilmbuffAiClient: async () => mockClient }))`.
- Gives every `ai-powered` audit log entry a meaningful `toolName` field (e.g., `blocking-extractor`, `entity-extractor`, `video-generator`) that identifies which part of filmbuff made the call.

#### Migrating `AIBlockingExtractor` and `AIEntityExtractor`

Both extractor files currently directly instantiate the Anthropic SDK:

```typescript
// CURRENT — to be removed entirely
import Anthropic from '@anthropic-ai/sdk';
this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const response = await this.client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 2048,
  messages: [{ role: 'user', content: prompt }],
});
const text = response.content[0].text;
```

After the refactor:

```typescript
// AFTER — provider and model resolved by ai-powered from ~/.ai-powered/config.json
import { getFilmbuffAiClient } from '../../../utils/filmbuff-ai-client.js';
import type { AiClient } from 'ai-powered';

export class AIBlockingExtractor {
  private client: AiClient | null = null;

  private async ensureClient(): Promise<AiClient> {
    if (!this.client) {
      this.client = await getFilmbuffAiClient('blocking-extractor');
    }
    return this.client;
  }

  async extractBlocking(sceneText: string): Promise<BlockingExtractionResult> {
    const client = await this.ensureClient();
    const prompt = buildBlockingPrompt(sceneText); // unchanged
    const result = await client.generateText(prompt, { maxTokens: 2048, temperature: 0.3 });
    return parseBlockingResponse(result.content);  // unchanged
  }
}
```

Key differences:
- No `apiKey` parameter — filmbuff passes no credentials to any provider.
- `result.content` is the same string as `response.content[0].text` from the old Anthropic SDK — the prompt builders and response parsers are **unchanged**.
- When `ai-powered` is configured with `AI_MOCK=true`, the extractor runs against the mock provider in-process: zero API cost, zero network calls, deterministic responses. This works without any test-side server stub.
- A user switching to GPT-4o touches only `~/.ai-powered/config.json`. No filmbuff code changes.

Apply the identical migration pattern to `ai-entity-extractor.ts`. The two files have the same structure.

After migrating both files, run:
```bash
grep -r "@anthropic-ai/sdk\|new Anthropic(" cli/src
```
This must return zero matches.

#### `runtime-resolver.ts` — Replace Entirely

The current implementation builds an `AIPoweredClient` HTTP client. Replace the entire file:

```typescript
// BEFORE — HTTP client to localhost:3001
export function resolveAIClient(overrides?: Partial<AIPoweredClientOptions>): AIPoweredClient {
  // reads config, merges env, constructs AIPoweredClient pointing to localhost:3001
}

// AFTER — in-process library call
import { getFilmbuffAiClient } from './filmbuff-ai-client.js';
import type { AiClient, AiConfig } from 'ai-powered';

export async function resolveAIClient(
  toolName: string,
  overrides?: Partial<AiConfig>,
): Promise<AiClient> {
  return getFilmbuffAiClient(toolName, overrides);
}
```

**All command handlers must be updated.** Every command that calls `resolveActiveProvider()`, `resolveProviderByProfile()`, or constructs `AIPoweredClient` directly must be updated to call `resolveAIClient()` instead:

```typescript
// Before:
const provider = await resolveActiveProvider();
const text = await provider.generate(prompt, { model: 'claude-sonnet-4-6' });

// After:
const client = await resolveAIClient('generate-shot-list', {
  model:       flags['ai-model'],    // undefined → ai-powered uses its config default
  temperature: flags.temperature,    // undefined → ai-powered uses its config default
});
const result = await client.generateText(prompt);
console.log(result.content);
```

Run `grep -r "resolveActiveProvider\|resolveProviderByProfile" cli/src/commands` after the migration. This must return zero matches.

#### Config System Changes

**`cli/config/augment-default.json` — before:**
```json
{
  "ai": {
    "provider": "anthropic",
    "model": "claude-3-sonnet-20240229"
  }
}
```

**After:**
```json
{
  "aiPowered": {
    "comment": "filmbuff-specific ai-powered overrides. Provider, model, and API keys live in ~/.ai-powered/config.json",
    "plugins": ["audit-log"],
    "debug": false
  }
}
```

The `aiPowered` block in filmbuff config documents only the small set of `ai-powered` settings that filmbuff owns (plugins and debug flag). All provider/model/credential configuration lives in `~/.ai-powered/config.json`, outside filmbuff's config entirely.

**Config migration notice:** If `ai.provider` is detected in an existing filmbuff config file at startup, emit a one-time deprecation warning and proceed with defaults:

```
Warning: The "ai.provider" config key is no longer supported.
Provider and API key configuration now lives in ~/.ai-powered/config.json.
Run "ai-powered config set provider anthropic" to configure your provider.
See: https://github.com/mytech-today-now/ai-powered#configuration
```

**`cli/src/utils/config-system.ts` `DEFAULT_CONFIG` update:**
```typescript
// Before:
ai: {
  provider: 'anthropic',
  model: 'claude-3-sonnet-20240229',
},

// After:
aiPowered: {
  plugins: ['audit-log'],
  debug: false,
},
```

#### Video Generation Integration

The `generate-shot-list` command already resolves `VideoControls` for each shot:

```typescript
interface VideoControls {
  duration:     number;       // seconds; always present; 3–60
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
  resolution?:  '720p' | '1080p' | '4k';
  quality?:     'draft' | 'standard' | 'high';
  fps?:         24 | 30 | 60;
}
```

**`cli/src/lib/video-generator.ts` — `FilmbuffVideoGenerator`:**

```typescript
import { getFilmbuffAiClient } from '../utils/filmbuff-ai-client.js';
import type { VideoResult } from 'ai-powered';
import type { VideoControls } from './video-controls.js';

export interface ShotEntry {
  shotNumber:            number;
  description:           string;
  action?:               string;
  setDescription?:       string;
  characterDescriptions?: Array<{ character: string; physicalAppearance: string; wardrobe: string }>;
  videoControls:         VideoControls;
}

export interface GeneratedVideoResult {
  shotNumber:      number;
  videoData:       string;   // URL or base64 from ai-powered
  mimeType:        string;
  durationSeconds?: number;
  aspectRatio?:    string;
  provider:        string;
  model:           string;
}

export class FilmbuffVideoGenerator {
  async generateForShot(
    shot: ShotEntry,
    provider: 'runway' | 'lumaai' = 'lumaai',
    model?: string,
  ): Promise<GeneratedVideoResult> {
    const client = await getFilmbuffAiClient('video-generator', {
      provider,
      ...(model ? { model } : {}),
    });

    const result: VideoResult = await client.generateVideo(buildVideoPrompt(shot), {
      aspectRatio:     shot.videoControls.aspectRatio ?? '16:9',
      durationSeconds: shot.videoControls.duration,
    });

    return {
      shotNumber:      shot.shotNumber,
      videoData:       result.data,
      mimeType:        result.mimeType,
      durationSeconds: result.durationSeconds,
      aspectRatio:     result.aspectRatio,
      provider:        result.provider,
      model:           result.model,
    };
  }

  async generateForShotList(
    shots: ShotEntry[],
    provider: 'runway' | 'lumaai' = 'lumaai',
    concurrency = 3,
  ): Promise<GeneratedVideoResult[]> {
    const results: GeneratedVideoResult[] = [];
    for (let i = 0; i < shots.length; i += concurrency) {
      const batch = shots.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(s => this.generateForShot(s, provider)));
      results.push(...batchResults);
    }
    return results;
  }
}
```

**Worked example — roofing commercial shot 3:**

Shot JSONL entry:
```json
{
  "shotNumber": 3,
  "description": "Wide establishing shot of roof crew working at golden hour",
  "action": "Three workers in safety harnesses move shingles into position",
  "setDescription": "Residential rooftop, suburban neighborhood, late afternoon sun, long shadows",
  "characterDescriptions": [
    {
      "character": "Lead Roofer",
      "physicalAppearance": "Male, 40s, weathered tan, muscular build",
      "wardrobe": "Company blue polo, tan work pants, orange safety vest, hard hat"
    }
  ],
  "videoControls": { "duration": 8, "aspectRatio": "16:9", "resolution": "1080p", "quality": "high" }
}
```

Prompt assembled by `buildVideoPrompt()` and sent to `ai-powered`:
```
Setting: Residential rooftop, suburban neighborhood, late afternoon sun, long shadows
Shot: Wide establishing shot of roof crew working at golden hour
Action: Three workers in safety harnesses move shingles into position
Characters: Lead Roofer: Male, 40s, weathered tan, muscular build. Wearing: Company blue polo, tan work pants, orange safety vest, hard hat.
Style: cinematic hero shot quality
```

`ai-powered` routes this to Luma AI (or Runway, per config), handles the API call, retries, and credential masking. `filmbuff` receives a `GeneratedVideoResult` with the video URL.

#### New `filmbuff generate-video` Command

New top-level command: reads a JSONL shot list produced by `generate-shot-list` and generates a video clip per shot.

**CLI usage:**
```bash
# Generate video for all shots using Luma AI (default)
filmbuff generate-video --input roofing-commercial.jsonl --output ./videos/

# Generate using Runway with a specific model, only shots 1, 3, and 5
filmbuff generate-video --input roofing-commercial.jsonl --provider runway --model gen3a_turbo --shots 1,3,5

# Zero-cost development run using ai-powered mock provider
filmbuff generate-video --input roofing-commercial.jsonl --mock

# One-step: generate shot list and immediately generate video
filmbuff generate-shot-list script.fountain --generate-video --provider lumaai --output-format jsonl
```

**Flags:**

| Flag | Description | Default |
|---|---|---|
| `--input <path>` | JSONL shot list from `generate-shot-list` | required |
| `--provider <name>` | `runway` or `lumaai` | `lumaai` |
| `--model <name>` | Provider model (e.g. `gen3a_turbo`, `dream-machine`) | provider default |
| `--shots <list>` | Comma-separated shot numbers (e.g. `1,3,5`); all shots if omitted | all |
| `--output <dir>` | Directory to write video files or manifest | `./generated-videos/` |
| `--concurrency <n>` | Max simultaneous generation requests | `3` |
| `--mock` | Force `ai-powered` mock provider (no API calls) | `false` |

**`--generate-video` flag on `generate-shot-list`:**

```bash
# Before (two-step):
filmbuff generate-shot-list script.fountain --output-format jsonl --output shots.jsonl
filmbuff generate-video --input shots.jsonl --provider lumaai

# After (one-step):
filmbuff generate-shot-list script.fountain --generate-video --provider lumaai
```

#### API Key Management — filmbuff Reads Zero Credentials

After this refactor, filmbuff reads **no** provider-specific environment variables. All of the following are managed exclusively by `ai-powered`:

| Variable currently read by filmbuff | Managed by after refactor |
|---|---|
| `ANTHROPIC_API_KEY` | `ai-powered` (via `AI_API_KEY` or `~/.ai-powered/config.json`) |
| `OPENAI_API_KEY` | same |
| `AI_POWERED_URL` | removed — no local server |
| `AI_POWERED_MODEL` | `ai-powered` (via `AI_MODEL` or config) |

**Three supported credential configuration options (all managed by `ai-powered`, not filmbuff):**

**Option 1 — Global config file** (`~/.ai-powered/config.json`):
```json
{
  "provider": "anthropic",
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-4-6"
}
```

**Option 2 — Environment variables** (`AI_*` prefix, read by `ai-powered` at startup):
```bash
export AI_PROVIDER=anthropic
export AI_API_KEY=sk-ant-...
export AI_MODEL=claude-sonnet-4-6
```

**Option 3 — Named profiles** (`~/.ai-powered/config.json`, for users who switch between providers):
```json
{
  "profiles": {
    "text-work":  { "provider": "anthropic", "apiKey": "sk-ant-...", "model": "claude-opus-4-5" },
    "video-work": { "provider": "lumaai",    "apiKey": "luma-...",   "model": "dream-machine"  },
    "budget":     { "provider": "openai",    "apiKey": "sk-...",     "model": "gpt-4o-mini"    }
  }
}
```

To use the `video-work` profile for a single run: `AI_PROFILE=video-work filmbuff generate-video --input shots.jsonl`

`ai-powered` masks all key values in its logs (e.g., `sk-ant-A1B2***`). If a key is accidentally committed to git, `ai-powered` emits a warning automatically — filmbuff benefits from this protection for free.

#### CLI Provider Commands — Removal

**Delete the following commands and all associated handlers, help text, routing, and tests:**

```
filmbuff provider create
filmbuff provider activate
filmbuff provider list
filmbuff provider show
filmbuff provider validate
filmbuff provider edit
filmbuff provider delete
filmbuff provider status
filmbuff configure
```

Attempting to run any deleted command after the refactor must produce:
```
Error: Unknown command "provider". Provider configuration is now managed by ai-powered.
Run: ai-powered config set provider <name>
     ai-powered config set apiKey <key>
See: filmbuff ai status
```

**`filmbuff ai status` (updated):**
```
ai-powered Library Integration
  Provider:  anthropic           [from ~/.ai-powered/config.json]
  Model:     claude-sonnet-4-6   [from ~/.ai-powered/config.json]
  Mock Mode: false               [default]
  Plugins:   audit-log           [from filmbuff config]

Available Models (anthropic):
  claude-opus-4-5       [text, structured]
  claude-sonnet-4-6     [text, structured] ← active
  claude-haiku-3-5      [text, structured]

Video Providers:
  lumaai   → dream-machine  [video]
  runway   → gen3a_turbo    [video]
```

#### Error Handling Requirements

All errors from `ai-powered` are typed. Catch and surface them with user-actionable messages:

| Error Class (from `ai-powered`) | Condition | filmbuff Output |
|---|---|---|
| `ProviderCapabilityError` | Asked Anthropic to generate video | `Provider "anthropic" does not support "video". Set AI_PROVIDER=lumaai for video generation.` |
| `AllProvidersExhaustedError` | All configured providers failed | List each provider and its failure reason |
| `CircuitOpenError` | Provider circuit breaker is open | `Provider "lumaai" temporarily unavailable. Estimated recovery: <ISO timestamp>` |
| `BudgetExceededError` | Configured spend limit hit | `AI budget exceeded: $0.42 of $0.50 limit. Increase limit in ~/.ai-powered/config.json` |
| `ConfigError` | Bad `ai-powered` config | Print `err.issues` array with actionable guidance |
| `ValidationError` | Structured output schema failed | Print schema issues and raw response; exit code 2 |

#### Testing Requirements

**Rewrite:**

- `cli/src/__tests__/ai-providers.test.ts` — Fully rewrite to target `getFilmbuffAiClient()` behavior:
  - `FILMBUFF_DEFAULTS` are always merged into every call
  - `overrides` take precedence over `FILMBUFF_DEFAULTS`
  - `toolName` is passed through to `getAiClient`
  - `mock: true` can be injected via overrides and produces a `MockProvider` client

**Remove or update:**

Any test that mocks `Anthropic`, `profileStore`, `providerRegistry`, `resolveActiveProvider`, `resolveProviderByProfile`, `AIPoweredClient`, or `fetchWithTimeout` must be deleted or rewritten. These abstractions no longer exist.

**Add:**

- **`AIBlockingExtractor` (refactored)** — mock `getFilmbuffAiClient` to return a client whose `generateText` returns a canned blocking JSON string; verify the parser produces the correct `BlockingExtractionResult`.
- **`AIEntityExtractor` (refactored)** — same pattern.
- **`FilmbuffVideoGenerator`** — mock `getFilmbuffAiClient` to return a client whose `generateVideo` returns a stub `VideoResult`; verify `GeneratedVideoResult` fields map correctly; verify `buildVideoPrompt` output for a shot with all fields populated, a shot with no character descriptions, and a shot with no quality override.
- **`generate-video` command (integration, `AI_MOCK=true`)** — reads a fixture JSONL, generates mock videos for all shots, writes output manifest to a temp directory; verify exit code 0.
- **`generate-video --shots 1,3` flag** — verify only shots 1 and 3 are passed to `FilmbuffVideoGenerator`.
- **`generate-shot-list --generate-video` flag** — integration test verifying the shot list generation step completes before video generation begins, and that both outputs are written.
- **`resolveAIClient`** — verify it delegates to `getFilmbuffAiClient` and that `overrides` from CLI flags are passed through.
- **Error handling** — for each typed error class from `ai-powered`, verify filmbuff prints the expected message and exits non-zero.

**Verification commands (must all return zero output after migration):**
```bash
grep -r "@anthropic-ai/sdk\|new Anthropic("           cli/src
grep -r "resolveActiveProvider\|resolveProviderByProfile" cli/src/commands
grep -r "AIPoweredClient\|localhost:3001"               cli/src
grep -r "ANTHROPIC_API_KEY\|OPENAI_API_KEY"             cli/src
```

All tests must pass under both `npm test` (Jest) and `npm run test:vitest` (Vitest). `npx tsc --noEmit` must exit clean. ESLint must report no errors on changed files.

#### Key Requirements

- **Single import point:** All filmbuff AI calls flow through `getFilmbuffAiClient()`. No module may call `getAiClient` from `ai-powered` directly or import any AI provider SDK.
- **In-process, no server:** No `ai-powered` server process is required. `getAiClient()` runs inside the filmbuff Node.js process.
- **Zero credentials in filmbuff:** filmbuff stores and reads no API keys, tokens, or provider-specific secrets. All credentials live in `~/.ai-powered/config.json` or `AI_*` environment variables managed by `ai-powered`.
- **Zero-configuration default:** A user who installs filmbuff and runs `AI_MOCK=true filmbuff generate-shot-list script.fountain` gets a fully working (mock) integration without creating any config file.
- **Mock-first testing:** All filmbuff tests use `ai-powered`'s in-process `MockProvider` (`mock: true`). No test makes a real network call or requires a running server.
- **No breaking change to generation output:** `filmbuff generate-shot-list`, `filmbuff start`, `filmbuff continue`, and `filmbuff retry` must produce equivalent output after the refactor when `ai-powered` returns the same model responses.
- **Video generation is opt-in:** The `generate-video` command and `--generate-video` flag are new capabilities. Existing workflows that do not use them are unaffected.

### Acceptance Criteria

- `npm install ai-powered` is the only new npm dependency added to filmbuff. `@anthropic-ai/sdk` is removed from `package.json` `dependencies`. `npm ls @anthropic-ai/sdk` shows it only as a transitive dependency of `ai-powered`, not a direct filmbuff dependency.
- `cli/src/utils/filmbuff-ai-client.ts` exists and exports `getFilmbuffAiClient(toolName, overrides?)` which merges `FILMBUFF_DEFAULTS` and delegates to `getAiClient` from `ai-powered`.
- All files in the "Delete entirely" list are removed. Running `git status` after deletion shows them as deleted, not modified.
- `grep -r "@anthropic-ai/sdk\|new Anthropic(" cli/src` returns zero matches.
- `grep -r "resolveActiveProvider\|resolveProviderByProfile" cli/src/commands` returns zero matches.
- `grep -r "AIPoweredClient\|localhost:3001" cli/src` returns zero matches.
- `grep -r "ANTHROPIC_API_KEY\|OPENAI_API_KEY" cli/src` returns zero matches (no credential reads in filmbuff source).
- All `provider *` and `configure` CLI commands are removed. Running `filmbuff provider list` produces the "Unknown command" error with guidance to `ai-powered config` and `filmbuff ai status`.
- `filmbuff ai status` prints the provider, model, mock mode, active plugins, available models for the current provider, and video-capable providers. When `AI_MOCK=true`, it reports `Mock Mode: true` and lists mock-available models.
- `AIBlockingExtractor` and `AIEntityExtractor` call `getFilmbuffAiClient()` and `client.generateText()`. Their prompt builders and response parsers are unchanged. Verified by unit tests with a mocked client.
- `FilmbuffVideoGenerator.generateForShot()` assembles the video prompt from `ShotEntry` fields in the order: setting → shot description → action → characters → style. Verified by unit test with a fully populated shot and a minimal shot (description only, no characters, no quality).
- `filmbuff generate-video --input shots.jsonl --mock` reads all shot entries, calls `FilmbuffVideoGenerator.generateForShotList()` with concurrency 3 (default), and writes a manifest JSON to `./generated-videos/manifest.json`. Exit code 0.
- `filmbuff generate-video --shots 1,3,5 --input shots.jsonl --mock` generates videos only for shots numbered 1, 3, and 5, ignoring all others. Verified by integration test.
- `filmbuff generate-shot-list script.fountain --generate-video --provider lumaai --mock` completes shot list generation, then passes the result through `FilmbuffVideoGenerator` in the same process, without writing an intermediate JSONL file. Exit code 0.
- `cli/config/augment-default.json` contains an `aiPowered` block with `plugins` and `debug` only. No `ai.provider`, `ai.model`, URL, or API key fields remain.
- `cli/config/augment-schema.json` reflects the `aiPowered` block. Running schema validation against `augment-default.json` passes. Running it against the old `ai.provider` shape fails validation.
- When `ai.provider` is detected in an existing filmbuff config at startup, the deprecation warning is printed exactly once per process. The process continues with `ai-powered` defaults; it does not exit.
- Each of the six typed `ai-powered` error classes (`ProviderCapabilityError`, `AllProvidersExhaustedError`, `CircuitOpenError`, `BudgetExceededError`, `ConfigError`, `ValidationError`) is caught by filmbuff command handlers and produces the expected user-facing message. Exit code is non-zero in all cases.
- All existing tests pass after the refactor: `npm test` and `npm run test:vitest` both exit 0.
- `npx tsc --noEmit` exits clean. ESLint reports no errors on any changed file.
- `docs/PROVIDER_SETUP.md` contains no third-party provider setup instructions. It links to the `ai-powered` README and documents the three credential configuration options (config file, env vars, named profiles).
- `cli/docs/AI_PROVIDERS.md` documents the `ai-powered` npm library integration: how it is imported, how credentials are resolved, how to switch providers, and how to enable mock mode for development.

### Estimated Effort

- Add `ai-powered` npm dependency; remove `@anthropic-ai/sdk` dependency: 0.5 hours
- Implement `cli/src/utils/filmbuff-ai-client.ts` wrapper: 1 hour
- Migrate `ai-blocking-extractor.ts` and `ai-entity-extractor.ts` from Anthropic SDK to `getFilmbuffAiClient`: 3 hours
- Replace `runtime-resolver.ts` and update all command-handler call sites: 3 hours
- Update `ai-provider-config.ts` (remove HTTP constants, keep normalizers only): 1 hour
- Update `config-system.ts`, `augment-default.json`, `augment-schema.json` (replace `ai` block with `aiPowered`): 2 hours
- Add config migration warning for legacy `ai.provider` field: 1 hour
- Delete provider registry, built-in adapters, and `ProviderRegistry.ts`: 1 hour
- Remove `provider *` and `configure` CLI commands and all handlers: 3 hours
- Implement updated `filmbuff ai status` command: 2 hours
- Implement `cli/src/lib/video-generator.ts` (`FilmbuffVideoGenerator`): 4 hours
- Implement `cli/src/commands/generate-video.ts` command with all flags: 5 hours
- Add `--generate-video` flag to `generate-shot-list` command: 2 hours
- Rewrite and add unit and integration tests: 8 hours
- Update `docs/PROVIDER_SETUP.md` and `cli/docs/AI_PROVIDERS.md`: 2 hours
- **Total: 38.5 hours**

### Attachments

- Source prompt: `ai-prompts/ai-powered-not-local.md`
- Supersedes (HTTP approach): `ai-prompts/replace-ai-with-ai-powered.md` and `ai-prompts/replace-ai-with-ai-powered-JIRA.md`
- `ai-powered` npm library: `G:\_kyle\temp_documents\GitHub\ai-powered` / https://github.com/mytech-today-now/ai-powered
- `ai-powered` public API entry point: `src/ai-powered/index.ts` → `getAiClient()`, `AiClient`, `VideoResult`, error classes
- `ai-powered` type definitions: `src/ai-powered/types.ts` — `VideoResult`, `TextResult`, `AiPlugin`, all error classes
- Prior provider abstraction ticket (being superseded): `ai-prompts/ai-providers-JIRA.md`
- Files requiring Anthropic SDK removal:
  - `cli/src/commands/generate-shot-list/generator/ai-blocking-extractor.ts`
  - `cli/src/commands/generate-shot-list/generator/ai-entity-extractor.ts`
- Files requiring full replacement:
  - `cli/src/utils/runtime-resolver.ts`
  - `cli/src/utils/ai-provider-config.ts`
- Config files requiring schema update:
  - `cli/config/augment-default.json`
  - `cli/config/augment-schema.json`
  - `cli/src/utils/config-system.ts`
- Video controls specification (maps to video generation inputs): `cli/src/lib/video-controls.ts`
- Shot list output format (input to video generation): `cli/src/commands/generate-shot-list/generator/types.ts`
- Test file to rewrite: `cli/src/__tests__/ai-providers.test.ts`
- Example shot list file for integration testing: `tmp-test/roofing-commercial-shot-list.md` / `tmp-test/roofing-commercial.jsonl`
