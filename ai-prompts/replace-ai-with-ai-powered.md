# Refactor FilmBuff AI Integration to Use `ai-powered`

## Objective

Replace FilmBuff's existing multi-provider AI abstraction with a single, focused integration against the **`ai-powered`** local AI server ([https://github.com/mytech-today-now/ai-powered](https://github.com/mytech-today-now/ai-powered)). This refactor eliminates the provider registry, profile store, custom provider system, and all third-party AI SDK dependencies in favor of a lightweight HTTP client that communicates directly with a user-managed `ai-powered` instance.

`ai-powered` is a locally-run AI gateway that proxies requests to multiple upstream models and providers. FilmBuff does not install, manage, or start this server — that responsibility belongs entirely to the user. FilmBuff only communicates with it over HTTP.

---

## Scope of Removal

The following files and systems must be retired. Remove all code, registrations, and test coverage that pertains exclusively to the abstraction being replaced:

| File | Action |
|---|---|
| `cli/src/utils/provider-registry.ts` | **Delete** — built-in provider registry (Anthropic, OpenAI, Google AI) |
| `cli/src/utils/profile-store.ts` | **Delete** — JSON-file-based profile and secret storage |
| `cli/src/utils/custom-provider-store.ts` | **Delete** — custom provider serialization and rehydration |
| `cli/src/utils/provider-validator.ts` | **Delete** — capability checks and profile validation |
| `cli/src/utils/runtime-resolver.ts` | **Replace** — re-implement as a thin factory that returns `AIPoweredClient` |
| `cli/src/utils/ai-provider-config.ts` | **Replace** — remove multi-provider constants; define `ai-powered` defaults |
| `cli/src/types/ai-providers.ts` | **Replace** — remove `ProviderDefinition`, `ProviderProfile`, registry types; retain `ProviderCapability` only if referenced elsewhere |
| `cli/src/db/provider-repository.ts` | **Delete** — database-backed provider storage |
| `cli/config/augment-default.json` (`ai` block) | **Update** — replace `provider`/`model` fields with `aiPowered` equivalents |
| `cli/src/utils/config-system.ts` (`ai` block) | **Update** — replace provider abstraction config shape with `aiPowered` config shape |
| `cli/config/augment-schema.json` | **Update** — reflect new `aiPowered` config schema |
| `cli/docs/AI_PROVIDERS.md` | **Replace** — rewrite to document the `ai-powered` integration |
| `docs/PROVIDER_SETUP.md` | **Update** — remove third-party provider setup; document `ai-powered` setup |

All callers of `resolveActiveProvider()` and `resolveProviderByProfile()` in command handlers must be updated to use the new `resolveAIClient()` factory. Direct `Anthropic` SDK instantiations in `ai-blocking-extractor.ts` and `ai-entity-extractor.ts` must be replaced with `AIPoweredClient` calls.

---

## New Architecture

### `AIPoweredClient` — `cli/src/utils/ai-powered-client.ts`

Implement a new `AIPoweredClient` class as the sole AI integration point in FilmBuff. It encapsulates all HTTP communication with the `ai-powered` server.

#### Configuration and Parameter Resolution

All request parameters are resolved using a strict four-level priority chain. The **first defined value** in the following order wins:

1. **CLI flag** (passed as `overrides` to `resolveAIClient()` at invocation time)
2. **Environment variable**
3. **Config file value** (read from the `aiPowered` block in `filmbuff.config.json` or `.augment/augment-config.json`)
4. **Built-in default**

| Parameter | CLI Flag | Environment Variable | Config Key | Built-in Default |
|---|---|---|---|---|
| Server URL | `--ai-powered-url` | `AI_POWERED_URL` | `aiPowered.url` | `http://localhost:3001` |
| Model | `--ai-model` | `AI_POWERED_MODEL` | `aiPowered.model` | `gpt-4` |
| System prompt | `--system-prompt` | `AI_POWERED_SYSTEM_PROMPT` | `aiPowered.systemPrompt` | *(see Default System Prompt)* |
| Temperature | `--temperature` | `AI_POWERED_TEMPERATURE` | `aiPowered.temperature` | `0.7` |
| Max tokens | `--max-tokens` | `AI_POWERED_MAX_TOKENS` | `aiPowered.maxTokens` | `2048` |
| Request timeout (ms) | `--timeout` | `AI_POWERED_TIMEOUT_MS` | `aiPowered.timeoutMs` | `30000` |

#### Default System Prompt

When no system prompt is supplied at any level of the resolution chain, use:

> You are an AI assistant integrated into FilmBuff, a professional screenplay and shot list tool. You help users with filmmaking tasks including shot list generation, scene analysis, and screenplay formatting. Respond in Markdown format unless instructed otherwise.

#### Config File Schema

The `aiPowered` block is persisted in the existing FilmBuff config file. All keys are optional; missing keys fall through to the next resolution level.

```json
{
  "aiPowered": {
    "url": "http://localhost:3001",
    "model": "gpt-4",
    "systemPrompt": "...",
    "temperature": 0.7,
    "maxTokens": 2048,
    "timeoutMs": 30000
  }
}
```

---

### Health Check

Before executing any completion request, `AIPoweredClient` verifies the server is reachable by issuing a `GET {url}/health` request. The server returns `200` when healthy. Any non-`200` response or network error is treated as a failure.

**Retry policy:** Up to **3 total attempts**, with exponential backoff: wait 1 s before attempt 2, 2 s before attempt 3. Cache the healthy state so subsequent calls within the same process skip the check.

**On permanent failure**, throw `AIPoweredConnectionError` with a message that includes the attempted URL and instructs the user to verify that `ai-powered` is running and accessible, and to check firewall settings if using a non-loopback address.

---

### Completion Requests — `POST /v1/chat/completions`

`AIPoweredClient` sends all generation requests to `{url}/v1/chat/completions` using the OpenAI Chat Completions format. Implementation requirements:

- Construct a `messages` array: the system prompt (if present) as `role: "system"` first, followed by the user prompt as `role: "user"`.
- Include `model`, `temperature`, and `max_tokens` in the request body.
- Apply the configured `timeoutMs` to the HTTP request.
- Parse `choices[0].message.content` from the response as the generated text.
- Return a typed `CompletionResult`:

```typescript
interface CompletionResult {
  content: string;
  model?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}
```

Do **not** implement client-side retry logic on the completion endpoint — the `ai-powered` server manages upstream retries internally.

---

## Updated Command Integration Points

### `cli/src/utils/runtime-resolver.ts`

Replace the current implementation entirely. The new public interface is:

```typescript
export function resolveAIClient(overrides?: Partial<AIPoweredClientOptions>): AIPoweredClient;
```

The factory reads the config file, merges environment variables, applies `overrides`, and returns a configured `AIPoweredClient` instance. All command handlers that currently call `resolveActiveProvider()` or `resolveProviderByProfile()` must be updated to call `resolveAIClient()` instead.

### `cli/src/commands/generate-shot-list/generator/ai-blocking-extractor.ts`

Remove the `Anthropic` SDK import and all SDK-specific initialization. Replace the completion call with `AIPoweredClient.complete(prompt, options)`, passing `aiModel` and `systemPrompt` as overrides to `resolveAIClient()`.

### `cli/src/commands/generate-shot-list/generator/ai-entity-extractor.ts`

Apply the same replacement as `ai-blocking-extractor.ts`.

### `cli/src/utils/ai-provider-config.ts`

Remove `DEFAULT_AI_PROVIDER`, `DEFAULT_AI_MODEL`, `IMPLEMENTED_AI_PROVIDERS`, and `isImplementedAIProvider`. Replace with `AI_POWERED_DEFAULT_URL` and `AI_POWERED_DEFAULT_MODEL` constants aligned with the defaults table above.

### `cli/src/utils/config-system.ts` and `cli/config/augment-default.json`

Replace the `ai.provider` / `ai.model` fields with an `aiPowered` block matching the config schema above. Update `DEFAULT_CONFIG` and `augment-schema.json` accordingly. Remove all provider ID literals (`'anthropic'`, `'openai'`, `'google-ai'`).

---

## CLI Changes

### Commands to Remove

The following commands existed solely to manage the multi-provider abstraction and must be deleted along with their handlers and tests:

`filmbuff provider create`, `filmbuff provider activate`, `filmbuff provider list`, `filmbuff provider show`, `filmbuff provider validate`, `filmbuff provider edit`, `filmbuff provider delete`, `filmbuff provider status`, `filmbuff configure`

### Commands to Add

| Command | Description |
|---|---|
| `filmbuff ai status` | Display the fully resolved `ai-powered` configuration (URL, model, timeout) and the result of a live health check against the configured server. |
| `filmbuff ai set <key> <value>` | Write a key/value pair to the `aiPowered` block in the local config file. Valid keys: `url`, `model`, `systemPrompt`, `temperature`, `maxTokens`, `timeoutMs`. |

### Per-Command Override Flags

Every AI-powered command (`generate-shot-list`, `start`, `continue`, `retry`) gains these optional flags, applied only for that invocation and never persisted:

`--ai-powered-url`, `--ai-model`, `--system-prompt`, `--temperature`, `--max-tokens`, `--timeout`

---

## Error Handling Requirements

All errors must be user-actionable. No error message may expose internal secret values or raw stack traces in normal output.

| Condition | Behavior |
|---|---|
| Server unreachable after 3 retries | Exit non-zero; include the attempted URL and instructions to start `ai-powered` |
| `4xx` from `/v1/chat/completions` | Surface HTTP status and response body; do not retry |
| `5xx` from `/v1/chat/completions` | Surface HTTP status and response body; do not retry (server handles upstream retries) |
| Request timeout | Report the configured `timeoutMs` value and suggest increasing it via config or `--timeout` flag |
| Malformed response (missing `choices[0].message.content`) | Throw `AIPoweredParseError` with the raw response body |

---

## Testing Requirements

Update all existing tests that exercise the old provider abstraction to target `AIPoweredClient` behavior. Specifically:

- **Rewrite `cli/src/__tests__/ai-providers.test.ts`** to cover `AIPoweredClient` construction, the full parameter resolution hierarchy (flag → env → config → default) for each configurable parameter, health check retry logic, and `CompletionResult` parsing.
- Remove or update any test that mocks `Anthropic`, `profileStore`, `providerRegistry`, `resolveActiveProvider`, or `resolveProviderByProfile`.
- Add unit tests for `checkHealth` covering: successful check on first attempt, a transient failure with successful retry, and three consecutive failures producing `AIPoweredConnectionError`.
- Add unit tests for `resolveAIClient` verifying that each parameter resolves correctly at every level of the priority chain.

All tests must pass under both `npm test` (Jest) and `npm run test:vitest` (Vitest) before this refactor is considered complete.

