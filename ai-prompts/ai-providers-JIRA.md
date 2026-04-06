# JIRA Ticket: TBD - Add Configurable AI Providers to FilmBuff CLI and GUI

### Summary
Refactor FilmBuff AI-powered workflows so commands such as `filmbuff generate-shot-list` and the broader sequential document pipeline (`filmbuff start`, `filmbuff continue`, `filmbuff retry`) use a selectable AI provider instead of relying on a single Augment Code AI integration through the VS Code chatbot. Add CLI and GUI support for configuring providers, initially supporting Anthropic (`anthropic`), OpenAI (`openai`), and Google AI (`google`), while also allowing users to add their own custom providers, store multiple named profiles per provider, switch the active provider, and route all supported FilmBuff commands through the currently selected AI backend via two shared runtime resolver functions — `resolveActiveProvider` and `resolveProviderByProfile`.

### Description

#### Background
FilmBuff currently depends on a tightly coupled AI integration model that makes it difficult for users to choose different providers, manage separate credentials, or switch between environments such as personal, client, and testing setups. This creates friction for both technical and non-technical users and makes future provider expansion more expensive than necessary.

This work should introduce a provider abstraction layer that separates FilmBuff features from any single backend. Users should be able to configure multiple AI providers — with initial support for Anthropic (`anthropic`), OpenAI (`openai`), and Google AI (`google`) — add custom or community-supported providers, maintain multiple named profiles for each provider, select an active provider/profile combination, and run AI-powered FilmBuff commands against that active configuration without changing the user-facing workflow.

The abstraction must serve both existing commands (`filmbuff generate-shot-list`) and the planned sequential document pipeline (`filmbuff start`, `filmbuff continue`, `filmbuff complete`, `filmbuff retry`). Every AI-powered command must resolve its backend through two shared runtime functions — `resolveActiveProvider` (returns the globally active provider/profile) and `resolveProviderByProfile` (returns a named profile, used when `--ai-provider` / `--ai-profile` override flags are supplied). No command should call a provider-specific implementation directly.

FilmBuff should also provide a clear configuration experience through both CLI and GUI entry points. `filmbuff configure` should guide users through provider setup, while `filmbuff gui` should allow users to manage linked modules, search modules, and administer AI provider settings in a unified interface.

#### Database Layer Integration

Provider configuration, profiles, and active-selection state are persisted in the FilmBuff database layer described in `ai-prompts/db-layer-prompt.md`. The relevant tables are `providers` and `provider_profiles` stored in `~/.filmbuff/global.db` (or `%APPDATA%\filmbuff\global.db` on Windows). The TypeScript access point is `ProviderRepository`, exposed through the `cli/src/db/` barrel. No command handler may read or write provider state through JSON files directly; all reads and writes flow through `ProviderRepository`.

**Key `ProviderRepository` methods used by provider management commands:**

| Method | CLI Usage |
|---|---|
| `upsertProvider(input)` | Register or update a provider |
| `listProviders()` | Populate provider picker in CLI and GUI |
| `upsertProfile(providerId, input)` | Create or update a named profile |
| `listProfiles(providerId)` | List profiles for a provider |
| `findProfile(providerId, profileName)` | Look up a specific profile for validation or runtime resolution |
| `deleteProfile(providerId, profileName)` | Remove a profile |
| `getActiveSelection()` | Return the globally active provider/profile (used by `resolveActiveProvider`) |
| `setActiveSelection(providerId, profileName)` | Atomically set the active provider/profile |
| `clearActiveSelection()` | Clear the active selection |

**Secret handling** follows the two-strategy model in `ai-prompts/db-layer-prompt.md § Security and Secret Handling`: API keys are stored either as environment-variable references (`env:VAR_NAME`) or as AES-256-GCM ciphertext; plaintext keys are never written to the database. The `api_key_encrypted` flag in `provider_profiles` signals which strategy applies to each profile.

At first run, if legacy JSON profile files exist under `.augment/providers/profiles/`, the database layer runs a one-time migration that imports them into `global.db` and writes a sentinel file so the migration is skipped on subsequent runs. The existing TypeScript interfaces (`ProviderProfile`, `ActiveProviderSelection`) are preserved as the canonical types; database columns map directly to those fields.

#### Film Document Pipeline Integration

The provider abstraction implemented by this ticket is the AI backbone for the sequential document pipeline described in `ai-prompts/film-docs-JIRA.md`. That pipeline generates up to ten documents per project — logline, synopsis, treatment, beat sheet, screenplay, shooting script, script breakdown, storyboards, shot list, and final screenplay — and every generation step resolves its backend exclusively through `resolveActiveProvider` or `resolveProviderByProfile`.

**Pipeline commands and provider resolution:**

| Command | Provider Resolution |
|---|---|
| `filmbuff start` | `resolveActiveProvider()` unless `--ai-provider`/`--ai-profile` supplied |
| `filmbuff continue` | Same; each resumed step re-resolves from the database to pick up any global selection change |
| `filmbuff retry` | Same; `--ai-provider`/`--ai-profile` allows switching provider mid-pipeline for a single retry without altering the global selection |
| `filmbuff complete` | No AI call; no provider resolution required |
| `filmbuff status` | No AI call; reads `sessions.provider_id` for audit display only |

Every generation attempt records `provider_id`, `profile_name`, and `model_id` in the `generation_attempts` table (see `ai-prompts/db-layer-prompt.md § Schema Design`), creating a complete audit trail of which provider and model produced each pipeline document. This enables per-document cost analysis, prompt quality comparison across providers, and reproducible reruns.

#### Key Requirements
- **Provider Abstraction**: Refactor AI-dependent functionality so all commands use a shared provider interface rather than directly calling a single hard-coded AI backend. No command handler may contain provider-specific logic.
- **Shared Runtime Resolver**: Implement two canonical resolver functions that every AI-powered command must use:
  - `resolveActiveProvider()` — returns the globally active provider and profile from persistent configuration.
  - `resolveProviderByProfile(providerId, profileName)` — returns a specific named profile; used when per-command override flags are supplied.
- **Per-Command Provider Override Flags**: Every AI-powered command (`generate-shot-list`, `start`, `continue`, `retry`, and any future commands) must expose:
  - `--ai-provider <id>` — override the active AI provider for this invocation (`anthropic`, `openai`, `google`, or a registered custom provider ID).
  - `--ai-profile <name>` — override the active AI profile name for this invocation.
  - When either flag is supplied the command calls `resolveProviderByProfile`; otherwise it calls `resolveActiveProvider`.
- **Selectable Provider Execution**: Ensure commands such as `filmbuff generate-shot-list` and all pipeline commands resolve and use the currently active provider/profile automatically via the runtime resolver.
- **Multiple Provider Support**:
  - Initially support configuration for Anthropic (`anthropic`), OpenAI (`openai`), and Google AI (`google`).
  - Allow the architecture to expand cleanly to additional providers in future releases.
- **User-Added Provider Support**:
  - Allow users to register and configure their own AI providers in addition to the built-in providers.
  - Support extension points or a plugin-style registration mechanism for custom/community providers.
  - Ensure the design can accommodate open-source or self-hosted providers and adapters such as `https://github.com/whitead/paLM-api`, `https://github.com/ollama/ollama`, `https://github.com/mudler/LocalAI`, `https://github.com/vllm-project/vllm`, and `https://github.com/oobabooga/text-generation-webui`.
- **Multiple Named Profiles**:
  - Allow users to save multiple named configurations for the same provider.
  - Support use cases such as personal, work, client, and testing profiles.
- **CLI Provider Management**:
  - Add CLI commands to create, edit, list, validate, delete, and switch AI provider configurations.
  - Make provider/profile selection explicit, persistent, and easy to inspect.
- **CLI Help and Version Support**:
  - Ensure new and refactored CLI commands support `-h` and `--help` for usage guidance.
  - Ensure new and refactored CLI commands support `-v` and `--version` where appropriate so users can inspect the active CLI version consistently.
  - Keep help output clear, discoverable, and aligned with existing FilmBuff CLI conventions.
- **Persistent Configuration Storage**:
  - Store provider settings in a durable user-facing configuration system.
  - Persist the active provider/profile selection across runs.
  - Handle API keys and related secrets securely.
- **GUI Configuration Workflow**:
  - Implement `filmbuff configure` to open a GUI flow for selecting a provider and entering required settings.
  - Allow users to create, edit, validate, save, and activate provider profiles from the GUI.
- **Unified GUI Management Experience**:
  - Implement or extend `filmbuff gui` so users can manage AI provider settings alongside linked-module management and module search.
  - Ensure the GUI reflects the current active provider/profile consistently.
- **Validation and Error Handling**:
  - Validate provider settings before activation or runtime use.
  - Surface clear errors for missing credentials, invalid models, unsupported providers, or failed connectivity.
  - Provide actionable recovery guidance in both CLI and GUI experiences.
- **Security and Professionalism**:
  - Never expose secrets in normal output.
  - Keep command flows intuitive and appropriate for both developers and creative users.
  - Preserve a seamless workflow where users configure once and then use FilmBuff commands normally.
- **Testing and Documentation**:
  - Add tests for provider selection, profile persistence, command routing, validation behavior, and failure paths.
  - Document provider setup, switching workflows, GUI behavior, and security expectations.

This ticket should be suitable for follow-on conversion into an OpenSpec change and subsequent decomposition into Beads tasks.

### Acceptance Criteria
- `filmbuff generate-shot-list` and other supported AI-powered commands use the currently active configured provider/profile resolved via `resolveActiveProvider`.
- Initial provider configuration support includes Anthropic (`anthropic`), OpenAI (`openai`), and Google AI (`google`).
- `resolveActiveProvider()` and `resolveProviderByProfile(providerId, profileName)` are implemented as shared runtime resolver functions used by every AI-powered command.
- Every AI-powered command (`generate-shot-list`, `start`, `continue`, `retry`, and any future commands) exposes `--ai-provider <id>` and `--ai-profile <name>` override flags that invoke `resolveProviderByProfile` for that invocation only, without altering the globally active selection.
- Provider override flags accept `anthropic`, `openai`, `google`, or any registered custom provider ID; an unrecognised value exits with a clear error before any generation begins.
- The sequential document pipeline (`filmbuff start`, `filmbuff continue`, `filmbuff complete`, `filmbuff retry`) routes every generation step through the shared runtime resolver, never through provider-specific code.
- Users can register and use custom AI providers in addition to the built-in providers.
- Users can add, store, list, edit, validate, delete, and switch multiple provider configurations via the CLI.
- Users can maintain multiple named profiles for the same provider.
- New and refactored CLI commands support `-h` / `--help` and `-v` / `--version` consistently.
- `filmbuff configure` provides a GUI-based provider setup and activation flow.
- `filmbuff gui` includes AI provider management alongside existing module-related workflows.
- Provider/profile selection persists across restarts and stays consistent between CLI and GUI.
- Sensitive credentials are handled securely and are not exposed in standard output.
- Adding a new provider requires minimal changes because the implementation uses a reusable provider abstraction.
- The provider model supports community, open-source, or self-hosted integrations through documented extension points.
- Documentation and automated tests cover the core configuration, switching, validation, command-routing, resolver function contracts, and per-command override behaviors.
- Provider and profile state is persisted in `~/.filmbuff/global.db` through `ProviderRepository`; no command handler reads or writes JSON profile files directly after the database layer is integrated.
- `resolveActiveProvider()` queries `ProviderRepository.getActiveSelection()` and `ProviderRepository.findProfile()`; no filesystem reads are required at runtime.
- Legacy JSON profile files under `.augment/providers/profiles/` are automatically migrated to `global.db` on first run; subsequent runs detect the sentinel file and skip the migration.
- Every generation attempt in the film document pipeline records the resolved `provider_id`, `profile_name`, and `model_id` in the `generation_attempts` database table, creating a complete per-document audit trail.
- Custom providers are stored with `provider_type = 'custom'` and a required `base_url`; they are registered, validated, listed, set active, and deleted through the same CLI commands and `ProviderRepository` methods used for built-in providers.
- Built-in providers (`anthropic`, `openai`, `google`) cannot have their last profile deleted; `ProviderRepository.deleteProfile` throws a typed `BuiltinProviderProtectedError` in that case.

### Estimated Effort
- Design and Planning: 10 hours
- Provider Abstraction, Runtime Resolver, and CLI Refactor: 20 hours
- Per-Command Override Flags (`--ai-provider` / `--ai-profile`): 4 hours
- Database Layer Integration (`ProviderRepository`, migration shim, secret handling): 8 hours
- GUI Configuration and Management Flows: 20 hours
- Testing and Documentation: 12 hours
- Total: 74 hours

### Attachments
- Source prompt: `ai-prompts/ai-providers-prompt.md`
- Format reference: `ai-prompts/powershell-prompt.md`
- Downstream consumer: `ai-prompts/film-docs-JIRA.md`
- Database layer specification: `ai-prompts/db-layer-prompt.md`
- Provider resolution migration ticket (replaces `profile-store.ts`, refactors `runtime-resolver.ts`): `ai-prompts/provider-resolution-JIRAt.md`
- AI provider runtime resolver (refactored by `provider-resolution-JIRAt.md`): `cli/src/utils/runtime-resolver.ts`
- Existing shot-list pipeline (primary consumer): `cli/src/commands/generate-shot-list.ts`
- Example implementation themes to guide OpenSpec and Beads breakdown:
  - Provider abstraction layer
    Goal: route all supported AI-powered commands through a shared provider interface
    Key rule: "Command handlers must resolve the active backend through the provider abstraction rather than direct integration-specific logic."
  - Runtime resolver functions
    Goal: implement `resolveActiveProvider` and `resolveProviderByProfile` as the single entry points for all provider resolution at runtime
    Key rule: "Every AI-powered command must call one of these two functions; no command may reference a provider implementation directly."
  - Per-command provider override
    Goal: expose `--ai-provider <id>` and `--ai-profile <name>` on every AI-powered command so users can target a specific backend for a single invocation without changing the global active selection
    Key rule: "When override flags are supplied, the command calls `resolveProviderByProfile(providerId, profileName)`; otherwise it calls `resolveActiveProvider()`. The global selection must not be mutated."
  - Provider configuration model
    Goal: support multiple providers and multiple named profiles per provider, with initial support for Anthropic (`anthropic`), OpenAI (`openai`), and Google AI (`google`)
    Key rule: "Separate provider metadata, credentials, and active-profile state so runtime resolution is deterministic."
  - Custom provider extensibility
    Goal: allow users to add their own providers, including community or open-source adapters
    Key rule: "Built-in providers should use the same extension model exposed to user-defined providers wherever practical."
  - CLI management workflow
    Goal: create, inspect, update, validate, delete, and switch provider profiles from the command line
    Key rule: "Provider management commands must be explicit, discoverable, and consistent with FilmBuff CLI conventions."
  - CLI help and version behavior
    Goal: make command discovery easy for all users
    Key rule: "All new and refactored commands must expose `-h`/`--help` and `-v`/`--version` behavior consistently."
  - Secure credential handling
    Goal: protect API keys, tokens, and related settings
    Key rule: "Never print secrets in normal output; validate required credentials before activation or runtime use."
  - GUI provider setup
    Goal: guide users through provider selection, configuration, validation, and activation
    Key rule: "The configuration flow should be clear enough for non-technical users while still supporting advanced provider settings."
  - Unified GUI management
    Goal: manage providers and linked modules in one place
    Key rule: "The main GUI should reflect the active provider/profile and keep provider-management actions easy to find."
  - Open-source provider compatibility
    Goal: support user-added integrations for alternative backends and community projects such as `https://github.com/whitead/paLM-api`
    Key rule: "Provider registration and configuration should not assume a closed list of vendor-owned backends."