# Refactor FilmBuff to Delegate All AI Operations to `ai-powered` (Library Import)

---

## Project Overview

### `filmbuff` — Screenplay & Shot List CLI
`filmbuff` is a Node.js/TypeScript CLI tool (located at `G:\_kyle\temp_documents\GitHub\filmbuff-project\filmbuff`) that:
- Parses screenplay files in Fountain, Final Draft, DOCX, Markdown, PDF, RTF, and plain-text formats.
- Generates professional shot lists from those screenplays using the `filmbuff generate-shot-list` command.
- Manages scene metadata, character descriptions, blocking positions, sound effects, and video-control parameters (`duration`, `aspectRatio`, `resolution`, `quality`, `fps`) on each generated shot.
- Writes shot list output in Markdown, JSON, JSONL, CSV, HTML, and TXT formats.
- Has an extension module system (`filmbuff link`, `filmbuff show`) and an OpenSpec-driven architecture.

Currently, `filmbuff` embeds its own AI integration logic:
- `cli/src/commands/generate-shot-list/generator/ai-blocking-extractor.ts` — directly imports and instantiates the Anthropic SDK (`@anthropic-ai/sdk`) to extract character blocking positions from screenplay action lines using Claude Sonnet.
- `cli/src/commands/generate-shot-list/generator/ai-entity-extractor.ts` — same pattern; uses Anthropic SDK for entity extraction (characters, props, locations, wardrobe).
- `cli/src/utils/ai-powered-client.ts` — a thin HTTP client (`AIPoweredClient`) that calls a **locally-running** `ai-powered` server at `http://localhost:3001/v1/chat/completions` using the OpenAI Chat Completions format.
- `cli/src/utils/runtime-resolver.ts` — factory that constructs `AIPoweredClient` with layered config.
- `cli/src/utils/ai-provider-config.ts` — constants for URL and model defaults.
- `cli/src/utils/ai-prompts.ts` — prompt-building utilities.
- `cli/src/providers/` — a `ProviderRegistry`, `ProviderAdapter` interface, and built-in adapters (Anthropic, OpenAI, etc.) that exist in parallel with the HTTP client.

### `ai-powered` — Unified Multi-Modal AI Library and Server
`ai-powered` is a separate TypeScript library/server (located at `G:\_kyle\temp_documents\GitHub\ai-powered`) that:
- Is available as an npm package: `npm install ai-powered`.
- Exports a single factory: `getAiClient(toolName?, overrides?) → Promise<AiClient>`.
- The `AiClient` supports **five modalities**: `text`, `image`, `audio`, `video`, and `structured`.
- **Providers built in**: OpenAI (GPT-4o, GPT-4, DALL-E, TTS, Whisper, Sora), Anthropic (Claude Sonnet, Claude Opus, Claude Haiku), xAI/Grok, Venice.ai, Luma AI (video), Runway (video), Custom/Ollama, Mock.
- Handles API key management via its own layered config system: `~/.ai-powered/config.json` → `./.ai-powered/config.json` → named profiles → `AI_*` environment variables → runtime overrides. **filmbuff never touches an API key directly.**
- Provides per-provider circuit breakers, automatic provider fallback, configurable retry, SHA-256 prompt hashing in its audit log, and API key masking in all log output.
- Has a plugin system (`onRequest` / `onResponse` / `onError` hooks).
- Can also run as a standalone HTTP server (`ai-powered serve`), but **this refactor uses it as an imported library, not a server**.

---

## Objective

Refactor `filmbuff` so that **all AI inference and media generation** is delegated to the `ai-powered` npm package, imported directly as a library dependency. This is a library-level integration — not an HTTP integration to a locally-running server. The current `AIPoweredClient` HTTP client and the embedded Anthropic SDK usage are both replaced by `import { getAiClient } from 'ai-powered'`.

**Goals of this refactor:**

1. **Provider breadth** — `filmbuff` gains instant access to every provider `ai-powered` supports (OpenAI, Anthropic, xAI, Venice, Luma AI, Runway, Ollama/Custom, Mock) without maintaining its own SDK dependencies or adapter layer.
2. **API key externalization** — `filmbuff` stores and manages zero API keys. All credentials live in `ai-powered`'s config system. `filmbuff` never reads `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or any provider-specific key directly.
3. **Video generation** — `filmbuff`'s `generate-shot-list` output includes resolved `VideoControls` per shot. This refactor adds a `filmbuff generate-video` command (and a `--generate-video` flag on `generate-shot-list`) that passes those controls to `ai-powered`'s `video` modality, producing AI-generated video clips for each shot.
4. **Simplification** — Remove the custom `ProviderRegistry`, the built-in provider adapters, the local-HTTP `AIPoweredClient`, the standalone `profile-store`, and the embedded Anthropic SDK imports from the extractor files.

---

## Dependency Installation

Add `ai-powered` as a production dependency in `filmbuff`:

```bash
# From the filmbuff project root
npm install ai-powered
```

Remove the direct Anthropic SDK dependency from filmbuff once the extractor files are migrated:

```bash
npm uninstall @anthropic-ai/sdk
```

`ai-powered` already declares `@anthropic-ai/sdk`, `openai`, `@runwayml/sdk`, and `lumaai` as its own dependencies. `filmbuff` gains access to all of them transitively without declaring them itself.

---

## Architecture After Refactor

```
filmbuff CLI
    │
    ├── generate-shot-list command
    │       ├── AIBlockingExtractor          ← calls getAiClient('blocking-extractor')
    │       ├── AIEntityExtractor            ← calls getAiClient('entity-extractor')
    │       └── [outputs shot list with VideoControls per shot]
    │
    ├── generate-video command (NEW)
    │       └── FilmbuffVideoGenerator       ← calls getAiClient('video-generator')
    │               └── client.generateVideo(prompt, { ... })  [ai-powered video modality]
    │
    └── ai status command (updated)
            └── getAiClient('status-check')  ← reports provider, model, mock mode

ai-powered (npm library, in-process)
    ├── Providers: openai | anthropic | xai | venice | lumaai | runway | custom | mock
    ├── API keys: managed by ~/.ai-powered/config.json and AI_* env vars
    ├── Modalities: text | image | audio | video | structured
    └── Plugins: audit-log | rate-limiter | prompt-shield
```

There is **no HTTP server process**. `getAiClient()` runs in the same Node.js process as `filmbuff` and calls provider APIs directly using the appropriate SDK. This eliminates the `http://localhost:3001` dependency entirely.

---

## Scope of Changes in `filmbuff`

### Files to Delete

| File | Reason |
|---|---|
| `cli/src/utils/ai-powered-client.ts` | Replaced by `getAiClient()` import from `ai-powered` |
| `cli/src/providers/ProviderRegistry.ts` | `ai-powered` manages provider registration |
| `cli/src/providers/builtin/` (entire directory) | All built-in adapters replaced by `ai-powered` providers |
| `cli/src/providers/types.ts` | `ProviderAdapter`, `AdapterEntry`, `GenerateOptions`, `GenerateResult` no longer needed |
| `cli/src/providers/index.ts` | Entire provider barrel export removed |

### Files to Replace / Heavily Modify

| File | Change Required |
|---|---|
| `cli/src/commands/generate-shot-list/generator/ai-blocking-extractor.ts` | Remove Anthropic SDK import; replace with `getAiClient()` |
| `cli/src/commands/generate-shot-list/generator/ai-entity-extractor.ts` | Same as above |
| `cli/src/utils/runtime-resolver.ts` | Replace `AIPoweredClient` factory with `getAiClient()` wrapper |
| `cli/src/utils/ai-provider-config.ts` | Remove HTTP URL/model constants; replace with `ai-powered` config helpers |
| `cli/src/utils/ai-prompts.ts` | Remove HTTP-specific request shaping; keep prompt string builders |
| `cli/src/types/ai-providers.ts` | Remove `ProviderDefinition`, registry types; keep `ProviderCapability` if used by other files |
| `cli/src/utils/config-system.ts` | Replace `ai.provider`/`ai.model` config shape with `aiPowered` block |
| `cli/config/augment-default.json` | Update `ai` block → `aiPowered` block |
| `cli/config/augment-schema.json` | Update JSON schema to reflect `aiPowered` block |
| `cli/src/commands/provider.ts` | Delete or gut — provider management commands no longer needed |

### Files to Add

| File | Purpose |
|---|---|
| `cli/src/utils/filmbuff-ai-client.ts` | Thin `getFilmbuffAiClient()` wrapper around `getAiClient()` with filmbuff-specific defaults |
| `cli/src/commands/generate-video.ts` | New command: `filmbuff generate-video <shot-list.jsonl>` |
| `cli/src/lib/video-generator.ts` | `FilmbuffVideoGenerator` class using `ai-powered` `video` modality |

---

## Implementation: `cli/src/utils/filmbuff-ai-client.ts`

Create a thin wrapper that calls `getAiClient()` with filmbuff-specific defaults. This is the **single import point** all filmbuff modules use. No filmbuff module imports `getAiClient` directly — they import `getFilmbuffAiClient` from here.

```typescript
/**
 * filmbuff-ai-client.ts
 *
 * Thin wrapper around `ai-powered`'s getAiClient() factory.
 * All filmbuff modules that need AI inference import from here.
 *
 * API key management, provider selection, circuit breakers, retry,
 * and audit logging are all handled by the ai-powered library.
 * filmbuff never reads ANTHROPIC_API_KEY, OPENAI_API_KEY, or any
 * provider-specific key directly.
 */

import { getAiClient } from 'ai-powered';
import type { AiClient, AiConfig } from 'ai-powered';

/** filmbuff-specific config defaults layered on top of ai-powered's own defaults. */
const FILMBUFF_DEFAULTS: Partial<AiConfig> = {
  // Default to text modality for screenplay analysis.
  // Video modality is enabled per-call in generate-video.
  plugins: ['audit-log'],
};

/**
 * Returns a fully configured AiClient for use by filmbuff internals.
 *
 * @param toolName   Identifies the caller in ai-powered's audit log
 *                   (e.g. 'blocking-extractor', 'entity-extractor', 'video-generator').
 * @param overrides  Optional per-call config overrides layered on top of defaults.
 *                   Example: { provider: 'anthropic', model: 'claude-opus-4-5' }
 */
export async function getFilmbuffAiClient(
  toolName: string,
  overrides?: Partial<AiConfig>,
): Promise<AiClient> {
  return getAiClient(toolName, { ...FILMBUFF_DEFAULTS, ...overrides });
}
```

**Why this wrapper exists:**
- Centralizes filmbuff's default config in one place. If the organization ever changes the default model or adds a plugin, only this file changes.
- Makes it trivial to inject `mock: true` during testing without reaching into every call site.
- Gives every `ai-powered` audit log entry a meaningful `toolName` that identifies which part of filmbuff made the call.

**Example — using in a command handler:**
```typescript
// In any filmbuff command handler:
import { getFilmbuffAiClient } from '../utils/filmbuff-ai-client.js';

const client = await getFilmbuffAiClient('start-command');
const result = await client.generateText(prompt, { maxTokens: 1024 });
console.log(result.content);
```

---

## Implementation: Migrating `AIBlockingExtractor`

The existing `ai-blocking-extractor.ts` directly instantiates `new Anthropic({ apiKey })`. Replace this entirely:

**Before (current code, to be removed):**
```typescript
import Anthropic from '@anthropic-ai/sdk';
// ...
this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const response = await this.client.messages.create({ model: 'claude-sonnet-4-6', ... });
```

**After (refactored):**
```typescript
import { getFilmbuffAiClient } from '../../../utils/filmbuff-ai-client.js';
import type { AiClient } from 'ai-powered';

export class AIBlockingExtractor {
  private client: AiClient | null = null;

  private async ensureClient(): Promise<AiClient> {
    if (!this.client) {
      // Provider, model, and API key all resolved by ai-powered from its own config.
      // filmbuff reads no environment variables for credentials.
      this.client = await getFilmbuffAiClient('blocking-extractor');
    }
    return this.client;
  }

  async extractBlocking(sceneText: string): Promise<BlockingExtractionResult> {
    const client = await this.ensureClient();

    const prompt = buildBlockingPrompt(sceneText); // existing prompt builder, unchanged
    const result = await client.generateText(prompt, {
      maxTokens: 2048,
      temperature: 0.3,
    });

    return parseBlockingResponse(result.content); // existing parser, unchanged
  }
}
```

**Key differences:**
- No `apiKey` parameter — filmbuff passes no credentials to any AI provider.
- The `model` and `provider` are determined by `ai-powered`'s own config at `~/.ai-powered/config.json`. A user can switch from Anthropic to OpenAI just by editing that file — no `filmbuff` code changes needed.
- `result.content` is the same string the old code extracted from `response.content[0].text`. The prompt builders and response parsers are unchanged.
- If `ai-powered` is configured with `AI_MOCK=true` (or `mock: true` in its config), the extractor runs against the mock provider — zero API cost, zero network calls — during development and CI.

**Migrate `ai-entity-extractor.ts` using the exact same pattern.** The two files are structurally identical. Both currently import `Anthropic` directly; both must switch to `getFilmbuffAiClient('entity-extractor')`.

---

## Implementation: `cli/src/utils/runtime-resolver.ts`

The current `runtime-resolver.ts` constructs an `AIPoweredClient` (HTTP client to localhost:3001). Replace the entire file:

```typescript
/**
 * runtime-resolver.ts
 *
 * Resolves the filmbuff AI client for use by command handlers.
 * Previously constructed an HTTP client pointing to a local ai-powered server.
 * Now returns an AiClient from the ai-powered npm library (no HTTP, no server).
 */

import { getFilmbuffAiClient } from './filmbuff-ai-client.js';
import type { AiClient, AiConfig } from 'ai-powered';

/**
 * Returns a ready-to-use AiClient for the calling command.
 *
 * All commands that previously called resolveActiveProvider() or
 * resolveProviderByProfile() now call resolveAIClient() instead.
 *
 * @param toolName   Identifies the command in the audit log.
 * @param overrides  Optional per-invocation overrides (e.g. from CLI flags
 *                   --ai-model, --temperature, --max-tokens).
 */
export async function resolveAIClient(
  toolName: string,
  overrides?: Partial<AiConfig>,
): Promise<AiClient> {
  return getFilmbuffAiClient(toolName, overrides);
}
```

**Update all callers.** Every command handler that currently calls `resolveActiveProvider()` or `resolveProviderByProfile()` must be updated:

```typescript
// Before:
const provider = await resolveActiveProvider();
const text = await provider.generate(prompt, { model: 'claude-sonnet-4-6' });
console.log(text.content);

// After:
const client = await resolveAIClient('generate-shot-list', {
  model: flags['ai-model'],          // undefined if not passed → ai-powered uses its default
  temperature: flags.temperature,
});
const result = await client.generateText(prompt);
console.log(result.content);
```

---

## Implementation: `cli/src/utils/ai-provider-config.ts`

Remove `DEFAULT_AI_PROVIDER`, `DEFAULT_AI_MODEL`, `IMPLEMENTED_AI_PROVIDERS`, `AI_POWERED_DEFAULT_URL`, `AI_POWERED_DEFAULT_MODEL`, and `isImplementedAIProvider`. Replace the entire file with a single re-export of the constants that downstream files still reference, plus a helper to read the `aiPowered` config block:

```typescript
/**
 * ai-provider-config.ts (refactored)
 *
 * filmbuff no longer manages provider configuration directly.
 * Provider, model, and API key selection are all delegated to ai-powered.
 *
 * This file retains only the normalizer functions used by other modules
 * during the transition period.
 */

export interface AIProviderConfig {
  /** Passed to ai-powered as AiConfig.provider override. */
  aiProvider?: string;
  /** Passed to ai-powered as AiConfig.model override. */
  aiModel?: string;
}

/** Normalizes a provider name string for use in ai-powered's AiConfig. */
export function normalizeAIProvider(raw?: string): string | undefined {
  return raw?.trim().toLowerCase() || undefined;
}

/** Normalizes a model name string for use in ai-powered's AiConfig. */
export function normalizeAIModel(raw?: string): string | undefined {
  return raw?.trim() || undefined;
}
```

---

## Implementation: Config System Updates

### `cli/config/augment-default.json`

Replace the old `ai` block with an `aiPowered` block. The new block only documents which `ai-powered` config overrides filmbuff will apply. All other settings (API keys, provider, model) live in `~/.ai-powered/config.json`, not here.

```json
{
  "aiPowered": {
    "comment": "filmbuff-specific ai-powered overrides. Provider, model, and API keys live in ~/.ai-powered/config.json",
    "plugins": ["audit-log"],
    "debug": false
  }
}
```

### `cli/src/utils/config-system.ts`

Replace the `ai.provider` / `ai.model` fields in `DEFAULT_CONFIG` and the Zod schema with:

```typescript
aiPowered: {
  plugins: z.array(z.string()).optional().default(['audit-log']),
  debug:   z.boolean().optional().default(false),
},
```

The `aiPowered` block is passed as `overrides` when calling `getFilmbuffAiClient()`, after merging CLI flags.

---

## Implementation: Video Generation

### Shot List Output Format

The `generate-shot-list` command already resolves `VideoControls` per shot:
```typescript
interface VideoControls {
  duration:     number;       // seconds; always present
  aspectRatio?: AspectRatio;  // '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9'
  resolution?:  Resolution;   // '720p' | '1080p' | '4k'
  quality?:     Quality;      // 'draft' | 'standard' | 'high'
  fps?:         FPS;          // 24 | 30 | 60
}
```

Each shot in the JSONL output includes `videoControls`, `description`, `action`, and `characterDescriptions`. These are the inputs to video generation.

### `cli/src/lib/video-generator.ts` (New File)

```typescript
/**
 * video-generator.ts
 *
 * Generates AI video clips for filmbuff shots using the ai-powered video modality.
 * Supports Runway and Luma AI providers (both available through ai-powered).
 *
 * The caller supplies a shot entry from generate-shot-list JSONL output.
 * This class builds the video prompt from the shot's description and
 * character blocking, then delegates generation to ai-powered.
 */

import { getFilmbuffAiClient } from '../utils/filmbuff-ai-client.js';
import type { VideoResult } from 'ai-powered';
import type { VideoControls } from './video-controls.js';

export interface ShotEntry {
  shotNumber: number;
  description: string;
  action?: string;
  setDescription?: string;
  characterDescriptions?: Array<{ character: string; physicalAppearance: string; wardrobe: string }>;
  videoControls: VideoControls;
}

export interface GeneratedVideoResult {
  shotNumber: number;
  videoData: string;   // URL or base64, as returned by ai-powered
  mimeType: string;
  durationSeconds?: number;
  aspectRatio?: string;
  provider: string;
  model: string;
}

export class FilmbuffVideoGenerator {
  /**
   * Generates a video clip for a single shot.
   *
   * @param shot     Shot entry from generate-shot-list JSONL output.
   * @param provider 'runway' or 'lumaai' — both available through ai-powered.
   * @param model    Model to use (e.g. 'gen3a_turbo' for Runway, 'dream-machine' for Luma).
   */
  async generateForShot(
    shot: ShotEntry,
    provider: 'runway' | 'lumaai' = 'lumaai',
    model?: string,
  ): Promise<GeneratedVideoResult> {
    const client = await getFilmbuffAiClient('video-generator', {
      provider,
      ...(model ? { model } : {}),
    });

    const prompt = buildVideoPrompt(shot);

    const result: VideoResult = await client.generateVideo(prompt, {
      aspectRatio: shot.videoControls.aspectRatio ?? '16:9',
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

  /**
   * Generates video clips for all shots in a shot list in parallel, with a
   * concurrency limit to avoid overwhelming the provider's rate limits.
   *
   * @param shots        Array of shots from generate-shot-list JSONL output.
   * @param concurrency  Maximum number of simultaneous generation requests (default: 3).
   */
  async generateForShotList(
    shots: ShotEntry[],
    provider: 'runway' | 'lumaai' = 'lumaai',
    concurrency = 3,
  ): Promise<GeneratedVideoResult[]> {
    const results: GeneratedVideoResult[] = [];
    for (let i = 0; i < shots.length; i += concurrency) {
      const batch = shots.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(shot => this.generateForShot(shot, provider))
      );
      results.push(...batchResults);
    }
    return results;
  }
}

function buildVideoPrompt(shot: ShotEntry): string {
  const parts: string[] = [];

  if (shot.setDescription) {
    parts.push(`Setting: ${shot.setDescription}`);
  }

  if (shot.description) {
    parts.push(`Shot: ${shot.description}`);
  }

  if (shot.action) {
    parts.push(`Action: ${shot.action}`);
  }

  if (shot.characterDescriptions && shot.characterDescriptions.length > 0) {
    const charDescs = shot.characterDescriptions
      .map(c => `${c.character}: ${c.physicalAppearance}. Wearing: ${c.wardrobe}.`)
      .join(' ');
    parts.push(`Characters: ${charDescs}`);
  }

  if (shot.videoControls.quality) {
    const qualityMap = { draft: 'rough animatic style', standard: 'production quality', high: 'cinematic hero shot quality' };
    parts.push(`Style: ${qualityMap[shot.videoControls.quality]}`);
  }

  return parts.join('\n');
}
```

**Example usage — generating video for a roofing commercial shot list:**

Given a shot list JSONL entry like:
```json
{
  "shotNumber": 3,
  "description": "Wide establishing shot of roof crew working at golden hour",
  "action": "Three workers in safety harnesses move shingles into position",
  "setDescription": "Residential rooftop, suburban neighborhood, late afternoon sun casting long shadows",
  "characterDescriptions": [
    {
      "character": "Lead Roofer",
      "physicalAppearance": "Male, 40s, weathered tan, muscular build",
      "wardrobe": "Company blue polo shirt, tan work pants, orange safety vest, hard hat"
    }
  ],
  "videoControls": { "duration": 8, "aspectRatio": "16:9", "resolution": "1080p", "quality": "high" }
}
```

The generated prompt passed to `ai-powered` would be:
```
Setting: Residential rooftop, suburban neighborhood, late afternoon sun casting long shadows
Shot: Wide establishing shot of roof crew working at golden hour
Action: Three workers in safety harnesses move shingles into position
Characters: Lead Roofer: Male, 40s, weathered tan, muscular build. Wearing: Company blue polo shirt, tan work pants, orange safety vest, hard hat.
Style: cinematic hero shot quality
```

`ai-powered` handles the actual Runway or Luma AI API call, credential management, rate limiting, and error handling. `filmbuff` receives back a `GeneratedVideoResult` with the video URL or base64 data.

---

## Implementation: New `filmbuff generate-video` Command

Add `cli/src/commands/generate-video.ts` — a new top-level command that reads a shot-list JSONL file (produced by `generate-shot-list`) and generates a video clip for each shot:

```typescript
// generate-video --input roofing-commercial.jsonl --provider lumaai --output ./videos/
// generate-video --input roofing-commercial.jsonl --provider runway --model gen3a_turbo --shots 1,3,5
// generate-video --input roofing-commercial.jsonl --mock   (uses ai-powered mock provider, no API cost)
```

**Flags:**

| Flag | Description | Default |
|---|---|---|
| `--input <path>` | Path to JSONL shot list produced by `generate-shot-list` | required |
| `--provider <name>` | `runway` or `lumaai` | `lumaai` |
| `--model <name>` | Provider-specific model (e.g. `gen3a_turbo`, `dream-machine`) | provider default |
| `--shots <list>` | Comma-separated shot numbers to generate (all if omitted) | all |
| `--output <dir>` | Directory to write video files | `./generated-videos/` |
| `--concurrency <n>` | Max simultaneous generation requests | `3` |
| `--mock` | Force `ai-powered` mock provider (no API calls, no cost) | `false` |

**Integration with `generate-shot-list`:**

Add a `--generate-video` flag to `filmbuff generate-shot-list` that, after writing the shot list, immediately passes the output through `FilmbuffVideoGenerator`. This is a convenience shortcut equivalent to piping `generate-shot-list` output into `generate-video`.

```bash
# Two-step workflow:
filmbuff generate-shot-list script.fountain --output-format jsonl --output shots.jsonl
filmbuff generate-video --input shots.jsonl --provider lumaai

# One-step workflow (--generate-video flag):
filmbuff generate-shot-list script.fountain --generate-video --provider lumaai
```

---

## API Key Management — No More filmbuff Credentials

After this refactor, `filmbuff` reads **no** provider-specific environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LUMAAI_API_KEY`, `RUNWAYML_API_KEY`). All credentials are managed by `ai-powered`.

**How users configure credentials (via `ai-powered`, not filmbuff):**

**Option 1 — Global config file** (`~/.ai-powered/config.json`):
```json
{
  "provider": "anthropic",
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-4-6"
}
```

**Option 2 — Environment variables** read by `ai-powered` at startup:
```bash
export AI_PROVIDER=anthropic
export AI_API_KEY=sk-ant-...
export AI_MODEL=claude-sonnet-4-6
# For video generation:
export AI_PROVIDER=lumaai
export AI_API_KEY=luma-...
```

**Option 3 — Named profiles** in `~/.ai-powered/config.json`:
```json
{
  "profiles": {
    "text-work": { "provider": "anthropic", "apiKey": "sk-ant-...", "model": "claude-opus-4-5" },
    "video-work": { "provider": "lumaai", "apiKey": "luma-...", "model": "dream-machine" }
  }
}
```

**filmbuff never sees the key value.** `ai-powered` masks all keys in logs using SHA-256 truncation (e.g. `sk-ant-A1B2***`). If a key is accidentally committed to git, `ai-powered` logs a warning — filmbuff benefits from this for free.

---

## CLI Provider Commands — Removal

The following commands existed to manage filmbuff's internal provider registry. They are deleted because `ai-powered` handles all of this:

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

Replace them with the single diagnostic command:

```
filmbuff ai status
```

Which calls:
```typescript
const client = await resolveAIClient('ai-status');
const models = await client.listModels();
// Display: resolved provider, model, mock mode, available models for current provider
```

---

## Error Handling

`ai-powered` exports typed error classes. Catch them in filmbuff command handlers:

```typescript
import {
  AiPoweredError,
  ProviderCapabilityError,
  AllProvidersExhaustedError,
  BudgetExceededError,
  CircuitOpenError,
  ConfigError,
} from 'ai-powered';

try {
  const result = await client.generateText(prompt);
} catch (err) {
  if (err instanceof ProviderCapabilityError) {
    // e.g. asking Anthropic to generate video
    console.error(`Provider "${err.provider}" does not support "${err.modality}". ` +
      `For video generation, set AI_PROVIDER=lumaai or AI_PROVIDER=runway in your ai-powered config.`);
  } else if (err instanceof AllProvidersExhaustedError) {
    // All configured providers failed
    const summary = err.failures.map(f => `  - ${f.provider}: ${f.reason}`).join('\n');
    console.error(`All AI providers exhausted:\n${summary}`);
  } else if (err instanceof CircuitOpenError) {
    console.error(
      `Provider "${err.provider}" is temporarily unavailable. ` +
      `Estimated recovery: ${err.estimatedRecovery.toISOString()}`
    );
  } else if (err instanceof BudgetExceededError) {
    console.error(`AI budget exceeded: $${err.spentUsd.toFixed(4)} of $${err.budgetUsd.toFixed(4)} limit.`);
  } else if (err instanceof ConfigError) {
    console.error(`ai-powered configuration error: ${err.message}\n${err.issues.join('\n')}`);
  } else {
    throw err; // re-throw unexpected errors
  }
  process.exit(1);
}
```

---

## Testing Requirements

### Using the Mock Provider

`ai-powered` ships a full `MockProvider` that returns deterministic synthetic responses for all modalities. Tests **must not** make real API calls. Configure the mock at the test level:

```typescript
import { getAiClient } from 'ai-powered';

// In test setup (beforeEach / beforeAll):
process.env.AI_MOCK = 'true';

// Or pass directly:
const client = await getAiClient('test', { mock: true });
const result = await client.generateText('Describe the shot.');
// result.content is a deterministic mock string; result.provider === 'mock'
```

### What to Test in filmbuff

1. **`filmbuff-ai-client.ts`** — verify `getFilmbuffAiClient()` always merges `FILMBUFF_DEFAULTS`, verify that `overrides` take precedence over defaults, verify that `toolName` is passed through to `getAiClient`.
2. **`AIBlockingExtractor` (refactored)** — mock `getFilmbuffAiClient` to return a client whose `generateText` returns a canned blocking JSON string; verify the parser produces the correct `BlockingExtractionResult`.
3. **`AIEntityExtractor` (refactored)** — same pattern as blocking extractor.
4. **`FilmbuffVideoGenerator`** — mock `getFilmbuffAiClient` to return a client whose `generateVideo` returns a stub `VideoResult`; verify `GeneratedVideoResult` fields are mapped correctly; verify the video prompt is constructed correctly from shot data.
5. **`resolveAIClient`** — verify it delegates to `getFilmbuffAiClient` and that `overrides` from CLI flags are passed through.
6. **`generate-video` command** — integration test (with `AI_MOCK=true`) that reads a fixture JSONL file, generates mock videos, and writes output to a temp directory.

### Removing Old Tests

Delete or rewrite any test that mocks `Anthropic`, `profileStore`, `providerRegistry`, `resolveActiveProvider`, `resolveProviderByProfile`, or the `AIPoweredClient` HTTP client. These abstractions no longer exist.

All existing passing tests must continue to pass after the refactor. Run:

```bash
npm test              # Jest (existing suite)
npm run test:vitest   # Vitest (existing suite)
```

Both must exit `0` before the refactor is considered complete.

---

## Documentation Updates

Update the following existing documentation files. **Do not create new documentation files** — modify the ones that exist:

- **`docs/PROVIDER_SETUP.md`** — Replace third-party provider setup instructions with instructions for configuring `~/.ai-powered/config.json` and the `AI_*` environment variables. Reference the `ai-powered` README for full provider setup.
- **`docs/CLI_REFERENCE.md`** — Remove removed commands (`provider create`, etc.); add `generate-video` and updated `ai status` command.
- **`cli/docs/AI_PROVIDERS.md`** — Rewrite to document the `ai-powered` npm library integration: how it's imported, how credentials are resolved, how to switch providers, and how to enable the mock provider for development.

---

## Summary of What Changes and Why

| What Changes | Why |
|---|---|
| Anthropic SDK removed from filmbuff | `ai-powered` includes it; filmbuff gains it transitively |
| `AIPoweredClient` HTTP client removed | Replaced by in-process `getAiClient()` library call — no server process required |
| Provider registry and built-in adapters removed | `ai-powered` manages all provider routing |
| API keys removed from filmbuff config | `ai-powered` manages all credentials in its own config system |
| `provider` CLI commands removed | `ai-powered` handles provider management; `filmbuff ai status` provides diagnostics |
| `generate-video` command added | Leverages `ai-powered`'s `video` modality (Runway, Luma AI) against shot list output |
| `--generate-video` flag on `generate-shot-list` added | One-command workflow for shot list + video generation |
| All AI calls now mockable with `AI_MOCK=true` | `ai-powered`'s `MockProvider` works in-process; no server stub needed |
