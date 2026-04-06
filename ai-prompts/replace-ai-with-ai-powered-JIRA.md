# JIRA Ticket: TBD — Replace FilmBuff Multi-Provider AI Abstraction with `ai-powered` Integration

### Summary

Retire FilmBuff's existing multi-provider AI abstraction — including the provider registry, profile store, custom provider serialization layer, provider validator, and all third-party AI SDK dependencies — and replace them with a single lightweight HTTP client (`AIPoweredClient`) that communicates exclusively with the user-managed [`ai-powered`](https://github.com/mytech-today-now/ai-powered) local AI gateway. The `ai-powered` server is installed and operated by the user; FilmBuff is only responsible for sending HTTP requests to it.

### Description

#### Background

FilmBuff currently maintains a multi-provider AI abstraction: a provider registry pre-populated with Anthropic, OpenAI, and Google AI entries; a JSON-file-based profile store for credentials and settings; a custom provider serialization layer for user-added providers; a capability validator; and a database-backed repository (`ProviderRepository`). Each of these layers imposes ongoing maintenance cost:

- Adding or updating an upstream model requires changes across the registry, schema, validator, and documentation.
- Third-party SDK versions (e.g., `@anthropic-ai/sdk`) must be independently tracked and kept current.
- The `filmbuff provider *` command family and `filmbuff configure` present a complex surface area that most users interact with only once during initial setup.
- Secrets managed through the custom profile store introduce unnecessary security surface area.

The [`ai-powered`](https://github.com/mytech-today-now/ai-powered) local AI gateway resolves these problems at the infrastructure level. It accepts OpenAI-compatible `POST /v1/chat/completions` requests and proxies them to whichever upstream model the user has configured — model selection, API keys, and provider routing are entirely the user's concern within `ai-powered`. FilmBuff's role is reduced to: configure a URL, send an HTTP request, and parse the response. This change removes all provider-management complexity from FilmBuff and narrows its AI integration to a single class and six configuration keys.

#### Scope of Removal

The following files and systems must be retired in their entirety. Remove all code, registrations, CLI commands, and test coverage that pertains exclusively to the abstraction being replaced.

**Delete entirely:**

| File | Reason |
|---|---|
| `cli/src/utils/provider-registry.ts` | Built-in provider registry (Anthropic, OpenAI, Google AI) |
| `cli/src/utils/profile-store.ts` | JSON-file-based profile and secret storage |
| `cli/src/utils/custom-provider-store.ts` | Custom provider serialization and rehydration |
| `cli/src/utils/provider-validator.ts` | Capability checks and profile validation |
| `cli/src/db/provider-repository.ts` | Database-backed provider storage |

**Replace entirely (rewrite with new purpose):**

| File | New Purpose |
|---|---|
| `cli/src/utils/runtime-resolver.ts` | Thin factory returning `AIPoweredClient` via `resolveAIClient()` |
| `cli/src/utils/ai-provider-config.ts` | `ai-powered` URL and model constants only |
| `cli/src/types/ai-providers.ts` | Remove registry types; retain `ProviderCapability` only if referenced elsewhere |
| `cli/docs/AI_PROVIDERS.md` | Document the `ai-powered` integration exclusively |

**Update (targeted changes):**

| File | Change Summary |
|---|---|
| `cli/config/augment-default.json` | Replace `ai.provider`/`ai.model` with `aiPowered` block |
| `cli/src/utils/config-system.ts` | Replace provider abstraction config shape with `aiPowered` config shape |
| `cli/config/augment-schema.json` | Reflect the new `aiPowered` schema |
| `docs/PROVIDER_SETUP.md` | Remove third-party provider setup; document `ai-powered` setup |
| `cli/src/commands/generate-shot-list/generator/ai-blocking-extractor.ts` | Replace Anthropic SDK calls with `AIPoweredClient.complete()` |
| `cli/src/commands/generate-shot-list/generator/ai-entity-extractor.ts` | Same as above |

**Create new:**

| File | Purpose |
|---|---|
| `cli/src/utils/ai-powered-client.ts` | `AIPoweredClient` class — the sole AI integration point in FilmBuff |

#### New Architecture — `AIPoweredClient`

Create `cli/src/utils/ai-powered-client.ts` as the sole AI integration point. It encapsulates all HTTP communication with the `ai-powered` server and exposes two public methods: `checkHealth()` and `complete(prompt, options?)`.

**Parameter resolution — four-level priority chain**

All six configurable parameters are resolved at construction time. The **first defined value** in the following order wins:

1. CLI flag (passed as `overrides` to `resolveAIClient()` at invocation time)
2. Environment variable
3. Config file value (from the `aiPowered` block in `filmbuff.config.json` or `.augment/augment-config.json`)
4. Built-in default

| Parameter | CLI Flag | Environment Variable | Config Key | Default |
|---|---|---|---|---|
| Server URL | `--ai-powered-url` | `AI_POWERED_URL` | `aiPowered.url` | `http://localhost:3001` |
| Model | `--ai-model` | `AI_POWERED_MODEL` | `aiPowered.model` | `gpt-4` |
| System prompt | `--system-prompt` | `AI_POWERED_SYSTEM_PROMPT` | `aiPowered.systemPrompt` | *(see below)* |
| Temperature | `--temperature` | `AI_POWERED_TEMPERATURE` | `aiPowered.temperature` | `0.7` |
| Max tokens | `--max-tokens` | `AI_POWERED_MAX_TOKENS` | `aiPowered.maxTokens` | `2048` |
| Timeout (ms) | `--timeout` | `AI_POWERED_TIMEOUT_MS` | `aiPowered.timeoutMs` | `30000` |

**Resolution example:** A user runs `filmbuff generate-shot-list --ai-model claude-3-opus` while `AI_POWERED_MODEL=gpt-4-turbo` is set in the environment and `aiPowered.model: "gpt-3.5-turbo"` appears in the config file. The CLI flag takes precedence — `claude-3-opus` is used for that invocation.

**Default system prompt (when no prompt is defined at any resolution level):**

> You are an AI assistant integrated into FilmBuff, a professional screenplay and shot list tool. You help users with filmmaking tasks including shot list generation, scene analysis, and screenplay formatting. Respond in Markdown format unless instructed otherwise.

**Config file schema — `aiPowered` block:**

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

All keys in the `aiPowered` block are optional; missing keys fall through to environment variables and built-in defaults.

**Health check**

Before the first `complete()` call in any process, `AIPoweredClient` issues `GET {url}/health`. A `200` response means the server is healthy.

- Retry policy: up to 3 total attempts; wait 1 s before attempt 2, 2 s before attempt 3.
- Cache the healthy state: subsequent `complete()` calls within the same process skip the check.
- On permanent failure: throw `AIPoweredConnectionError` with a message that includes the attempted URL and instructions to start the server. Example message:

```
Cannot connect to ai-powered server at http://localhost:3001.
Please verify that ai-powered is running and accessible.
If using a non-loopback address, check firewall settings.
```

**Completion requests — `POST /v1/chat/completions`**

`AIPoweredClient.complete(prompt, options?)` sends the following request body in OpenAI Chat Completions format:

```json
{
  "model": "gpt-4",
  "temperature": 0.7,
  "max_tokens": 2048,
  "messages": [
    { "role": "system", "content": "<system prompt>" },
    { "role": "user", "content": "<user prompt>" }
  ]
}
```

Parse `choices[0].message.content` from the response. Return a typed `CompletionResult`:

```typescript
interface CompletionResult {
  content: string;
  model?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}
```

Do **not** implement client-side retry logic on completions — `ai-powered` manages upstream retries internally.

#### Updated `resolveAIClient()` Factory

Replace `cli/src/utils/runtime-resolver.ts` entirely. New public interface:

```typescript
export function resolveAIClient(overrides?: Partial<AIPoweredClientOptions>): AIPoweredClient;
```

This factory reads the config file, merges environment variables, applies `overrides`, and returns a configured `AIPoweredClient`. Every command handler that currently calls `resolveActiveProvider()` or `resolveProviderByProfile()` must be updated to call `resolveAIClient()` instead.

**Affected call sites requiring update:**

- `cli/src/commands/generate-shot-list/generator/ai-blocking-extractor.ts` — Remove the `Anthropic` SDK import and all SDK-specific initialization. Pass `aiModel` and `systemPrompt` as overrides to `resolveAIClient()`, then call `client.complete(prompt)`.
- `cli/src/commands/generate-shot-list/generator/ai-entity-extractor.ts` — Apply the same replacement as `ai-blocking-extractor.ts`.
- Any other command handler that calls `resolveActiveProvider()` or `resolveProviderByProfile()` directly.

After the replacement, run `grep -r "resolveActiveProvider\|resolveProviderByProfile\|Anthropic\|@anthropic-ai" cli/src/commands` and resolve every remaining reference.

#### Config Schema Changes

Replace the `ai` block with an `aiPowered` block in all config files. Remove all provider ID literals (`'anthropic'`, `'openai'`, `'google-ai'`) from the codebase.

**Before:**
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
    "url": "http://localhost:3001",
    "model": "gpt-4",
    "systemPrompt": "...",
    "temperature": 0.7,
    "maxTokens": 2048,
    "timeoutMs": 30000
  }
}
```

Update `DEFAULT_CONFIG` in `config-system.ts`, `augment-default.json`, and `augment-schema.json` to reflect this shape. Remove `DEFAULT_AI_PROVIDER`, `DEFAULT_AI_MODEL`, `IMPLEMENTED_AI_PROVIDERS`, and `isImplementedAIProvider` from `ai-provider-config.ts` and replace with `AI_POWERED_DEFAULT_URL` and `AI_POWERED_DEFAULT_MODEL` constants aligned with the defaults table above.

**Config migration notice:** If the old `ai.provider` field is detected in an existing config file at startup, emit a one-time deprecation warning:

```
Warning: The "ai.provider" config key is no longer supported. FilmBuff now uses ai-powered.
Run "filmbuff ai set url <url>" to configure your ai-powered server, or use the defaults.
```

#### CLI Changes

**Commands to remove** — delete handlers, routing, registration, help text, and all associated tests:

`filmbuff provider create`, `filmbuff provider activate`, `filmbuff provider list`, `filmbuff provider show`, `filmbuff provider validate`, `filmbuff provider edit`, `filmbuff provider delete`, `filmbuff provider status`, `filmbuff configure`

Attempting to run any of these after the refactor should produce: `Unknown command: "provider". Did you mean "filmbuff ai status"?`

**Commands to add:**

| Command | Behavior |
|---|---|
| `filmbuff ai status` | Print the fully resolved configuration (URL, model, temperature, maxTokens, timeoutMs), the resolution source of each parameter (`[from CLI flag]`, `[from env]`, `[from config]`, `[default]`), and the result of a live health check against the configured server. |
| `filmbuff ai set <key> <value>` | Write the key/value pair to the `aiPowered` block in the local config file. Valid keys: `url`, `model`, `systemPrompt`, `temperature`, `maxTokens`, `timeoutMs`. Reject unknown keys with a clear error listing all valid keys. |

**Example `filmbuff ai status` output:**

```
ai-powered Configuration
  URL:         http://localhost:3001   [default]
  Model:       claude-3-opus           [from env]
  Temperature: 0.7                     [from config]
  Max Tokens:  2048                    [default]
  Timeout:     30000ms                 [default]

Health Check: ✓ Server is reachable at http://localhost:3001
```

**Per-command override flags** — every AI-powered command (`generate-shot-list`, `start`, `continue`, `retry`) gains these optional one-time flags, applied for that invocation only and never persisted:

`--ai-powered-url`, `--ai-model`, `--system-prompt`, `--temperature`, `--max-tokens`, `--timeout`

#### Error Handling Requirements

All errors must be user-actionable. No error message may expose internal secret values or raw stack traces in normal output.

| Condition | Behavior |
|---|---|
| Server unreachable after 3 retries | Exit non-zero; include the attempted URL and instructions to start `ai-powered` |
| `4xx` from `/v1/chat/completions` | Surface HTTP status and response body; do not retry |
| `5xx` from `/v1/chat/completions` | Surface HTTP status and response body; do not retry (server handles upstream retries) |
| Request timeout | Report the configured `timeoutMs` value; suggest increasing it via `--timeout` or `filmbuff ai set timeoutMs <value>` |
| Malformed response (missing `choices[0].message.content`) | Throw `AIPoweredParseError` with the raw response body for diagnostics |

#### Testing Requirements

**Rewrite:**

- `cli/src/__tests__/ai-providers.test.ts` — Fully rewrite to target `AIPoweredClient` behavior:
  - Construction with each combination of overrides
  - Full parameter resolution hierarchy (CLI flag → env → config → default) verified **individually for each of the six parameters** — for example, confirm that an env variable for `model` is overridden by a CLI flag but not by a config value
  - Health check: success on first attempt; recovery after one transient failure (mock the first attempt to fail, second to succeed); `AIPoweredConnectionError` thrown after three consecutive failures
  - `CompletionResult` parsing: valid response with all optional fields, response missing `choices[0]`, malformed JSON body

**Remove or update:**

- Any test that mocks `Anthropic`, `profileStore`, `providerRegistry`, `resolveActiveProvider`, or `resolveProviderByProfile`
- Tests for deleted commands (`provider create`, `provider list`, `configure`, etc.)

**Add:**

- Unit tests for `resolveAIClient()` verifying correct resolution at each priority level for each parameter independently
- Unit tests for `filmbuff ai status`: resolved config is printed correctly, source labels are accurate, health check failure is surfaced
- Unit tests for `filmbuff ai set`: valid key persists, unknown key exits non-zero with valid-key list, numeric values are coerced correctly
- Integration smoke test: `AIPoweredClient.complete()` against a mock HTTP server (using `nock` or `msw`) covering the happy path and the five error conditions in the error-handling table

All tests must pass under both `npm test` (Jest) and `npm run test:vitest` (Vitest).

#### Key Requirements

- **Single integration point:** All AI generation in FilmBuff routes through `AIPoweredClient`. No command handler may import an AI SDK directly or reference provider-specific types.
- **No SDK dependencies:** Remove all `@anthropic-ai/sdk`, `openai`, and `@google/generative-ai` npm packages and every `require` / `import` referencing them.
- **No secrets in FilmBuff:** The `ai-powered` server manages all upstream API keys. FilmBuff stores and transmits no credentials other than the server URL.
- **Zero-configuration default:** A user who installs FilmBuff and runs `ai-powered` locally on port 3001 will get a working integration without touching any config file.
- **No breaking change to generation workflows:** `filmbuff generate-shot-list`, `filmbuff start`, `filmbuff continue`, and `filmbuff retry` must produce equivalent output after the refactor, assuming the `ai-powered` server returns the same model responses.

### Acceptance Criteria

- All files in the "Delete entirely" list are deleted. Running `grep -r "provider-registry\|profile-store\|custom-provider-store\|provider-validator\|provider-repository" cli/src` returns no matches.
- `cli/src/utils/ai-powered-client.ts` exists and exports `AIPoweredClient` with `checkHealth()` and `complete()` methods typed per the specification above.
- `resolveAIClient()` in `runtime-resolver.ts` applies the four-level priority chain correctly for all six parameters, verified by automated tests that isolate each parameter and each priority level.
- All command handlers that previously called `resolveActiveProvider()` or `resolveProviderByProfile()` now call `resolveAIClient()`. Running `grep -r "resolveActiveProvider\|resolveProviderByProfile" cli/src/commands` returns no matches.
- Direct `Anthropic` SDK instantiations in `ai-blocking-extractor.ts` and `ai-entity-extractor.ts` are replaced with `AIPoweredClient` calls. Running `grep -r "@anthropic-ai/sdk\|new Anthropic(" cli/src` returns no matches.
- All `provider *` and `configure` CLI commands are removed. Running any of them produces a "command not found" error with a suggestion to use `filmbuff ai status` or `filmbuff ai set`.
- `filmbuff ai status` prints the fully resolved configuration, the resolution source of each parameter, and a live health check result. When the server is unreachable, the command exits non-zero and prints the connection error message including the attempted URL.
- `filmbuff ai set model claude-3-opus` persists `aiPowered.model: "claude-3-opus"` to the config file. A subsequent `filmbuff ai status` reports `Model: claude-3-opus [from config]`.
- `filmbuff ai set unknownKey value` exits non-zero with a message listing the six valid keys.
- Every AI-powered command (`generate-shot-list`, `start`, `continue`, `retry`) accepts all six override flags and applies them for that invocation only without modifying the config file.
- When `ai-powered` is unreachable after 3 attempts, FilmBuff exits non-zero with a message containing the attempted URL and instructions to start the server.
- `cli/config/augment-default.json`, `cli/config/augment-schema.json`, and `cli/src/utils/config-system.ts` reflect the `aiPowered` config shape. Running `grep -r '"provider"\|"anthropic"\|"openai"\|"google-ai"' cli/config` returns no matches.
- All tests pass under `npm test` (Jest) and `npm run test:vitest` (Vitest). No test file references `Anthropic`, `profileStore`, `providerRegistry`, `resolveActiveProvider`, or `resolveProviderByProfile`.
- `cli/docs/AI_PROVIDERS.md` and `docs/PROVIDER_SETUP.md` document the `ai-powered` integration exclusively. No third-party provider setup instructions remain.
- `npx tsc --noEmit` exits clean. ESLint reports no errors on changed files.

### Estimated Effort

- Delete removed files and purge all import references: 2 hours
- Implement `AIPoweredClient` (health check, completion request, error types): 6 hours
- Implement `resolveAIClient()` factory and update all call sites: 4 hours
- Update `ai-provider-config.ts` with `ai-powered` defaults only: 1 hour
- Update config system, schema, and default config files: 3 hours
- Update `ai-blocking-extractor.ts` and `ai-entity-extractor.ts`: 2 hours
- Remove `provider *` and `configure` commands and all associated handlers: 4 hours
- Implement `filmbuff ai status` command: 2 hours
- Implement `filmbuff ai set` command: 2 hours
- Add per-command override flags to all AI-powered commands: 3 hours
- Rewrite and update tests: 6 hours
- Update documentation (`AI_PROVIDERS.md`, `PROVIDER_SETUP.md`): 2 hours
- **Total: 37 hours**

### Attachments

- Source prompt: `ai-prompts/replace-ai-with-ai-powered.md`
- `ai-powered` project: https://github.com/mytech-today-now/ai-powered
- Prior provider abstraction ticket (being superseded): `ai-prompts/ai-providers-JIRA.md`
- Runtime resolver to be replaced: `cli/src/utils/runtime-resolver.ts`
- Primary call sites for SDK replacement:
  - `cli/src/commands/generate-shot-list/generator/ai-blocking-extractor.ts`
  - `cli/src/commands/generate-shot-list/generator/ai-entity-extractor.ts`
- Config files requiring schema update:
  - `cli/config/augment-default.json`
  - `cli/config/augment-schema.json`
  - `cli/src/utils/config-system.ts`
- Test file to rewrite: `cli/src/__tests__/ai-providers.test.ts`

