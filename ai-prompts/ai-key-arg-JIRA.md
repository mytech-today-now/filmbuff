# JIRA Ticket: TBD - Add `--ai-key` Argument to `filmbuff generate-shot-list`

### Summary
Add a new `--ai-key <api-key>` argument to the `filmbuff generate-shot-list` command that accepts the API key for whichever AI provider is currently selected, allowing users to supply credentials directly on the command line rather than relying solely on environment variables or stored profiles.

### Description

#### Background
`filmbuff generate-shot-list` resolves its AI backend through the provider abstraction (`resolveActiveProvider` / `resolveProviderByProfile`). Today, the API key used at runtime is sourced from two locations only:

1. An environment-variable reference stored in the active profile (e.g., `env:ANTHROPIC_API_KEY`).
2. An AES-256-GCM ciphertext stored in the active profile and decrypted at runtime by `resolveSecrets()`.

Neither path allows a user to supply the key inline at invocation time. This creates friction in CI/CD pipelines, one-off testing scenarios, and multi-tenant or scripted workflows where injecting an environment variable is inconvenient or impossible.

#### Proposed Change
Add `--ai-key <api-key>` as an optional argument to `filmbuff generate-shot-list`. When supplied, its value overrides the API key that would otherwise be resolved from the active profile or from the environment. The key is applied to the resolved provider adapter immediately after normal profile resolution and is never written to disk or logged.

The argument is provider-agnostic: it carries the secret for whichever provider is chosen (via the active profile or `--ai-provider` / `--ai-profile` override flags). The command already knows which provider is active by the time the key needs to be used, so no additional provider-selection logic is required.

#### Integration Points
- **`cli/src/cli.ts`** — register `.option('--ai-key <key>', 'API key for the selected AI provider')` on the `generate-shot-list` command and pass the value through to the command handler.
- **`cli/src/commands/generate-shot-list.ts`** — add `aiKey?: string` to `GenerateShotListOptions`; after provider resolution, if `aiKey` is present, override the resolved key before instantiating the provider client.
- **`cli/src/commands/generate-shot-list/generator/ai-blocking-extractor.ts`** — `AIBlockingExtractor` already accepts an `apiKey` constructor parameter; pass `aiKey` here instead of relying solely on `process.env.ANTHROPIC_API_KEY`.
- **`cli/src/commands/generate-shot-list/generator/ai-entity-extractor.ts`** — `AIEntityExtractor` currently reads `process.env.ANTHROPIC_API_KEY` directly; refactor constructor to accept an optional `apiKey` parameter and prefer it over the environment variable.
- **`cli/src/commands/generate-shot-list/help-text.ts`** — document `--ai-key` in the OPTIONAL ARGUMENTS section with a security note advising users to prefer environment variables in shared environments.
- **`docs/FILM_PIPELINE.md`** — add `[--ai-key <key>]` to the `generate-shot-list` synopsis table.

#### Security Considerations
- The key value must **never** appear in JSONL debug logs, console output, or error messages — redact it to `***` if it must be referenced.
- The key is not persisted. It applies only for the duration of the invocation.
- Help text must include a note advising against use in shell history-visible contexts and recommending the environment-variable or stored-profile approaches for interactive/shared environments.
- The `--logging` flag must not record the raw key value.

#### Key Requirements
- `--ai-key` is optional; its absence preserves existing behavior exactly.
- The value overrides whatever API key would otherwise be resolved from the active profile.
- The override applies to the provider determined by the current resolution chain (`--ai-provider` / `--ai-profile` flags, then active profile, then legacy defaults).
- The argument is documented in help text with a security advisory.
- The raw key is never written to logs or output.

### Acceptance Criteria
- `filmbuff generate-shot-list --input <file> --ai-key <key>` completes successfully using the supplied key for the active provider.
- When `--ai-key` is omitted, existing key-resolution behavior (profile → environment variable) is unchanged.
- Supplying `--ai-key` together with `--ai-provider` / `--ai-profile` uses the named profile for all other settings and the supplied key for authentication.
- The `--ai-key` value does not appear in JSONL debug log files, console output, or any error message (redacted to `***`).
- `filmbuff generate-shot-list --help` includes `--ai-key` in the OPTIONAL ARGUMENTS section with a brief security note.
- `AIBlockingExtractor` and `AIEntityExtractor` both accept and prefer an explicitly passed API key over `process.env.ANTHROPIC_API_KEY`.
- Automated tests cover: key supplied and used, key omitted (fallback behavior), key redacted from logs, and key combined with `--ai-provider` / `--ai-profile`.

### Estimated Effort
- CLI argument registration and handler wiring: 1 hour
- Generator refactor (`AIBlockingExtractor`, `AIEntityExtractor`): 2 hours
- Help text and documentation updates: 1 hour
- Tests: 2 hours
- Total: 6 hours

### Attachments
- Source requirement: `ai-prompts/ai-key-arg.md`
- Provider abstraction reference: `ai-prompts/ai-providers-JIRA.md`
- Primary command handler: `cli/src/commands/generate-shot-list.ts`
- CLI registration: `cli/src/cli.ts`
- Blocking extractor (accepts `apiKey` param): `cli/src/commands/generate-shot-list/generator/ai-blocking-extractor.ts`
- Entity extractor (reads env var directly): `cli/src/commands/generate-shot-list/generator/ai-entity-extractor.ts`
- Help text: `cli/src/commands/generate-shot-list/help-text.ts`
- Pipeline docs: `docs/FILM_PIPELINE.md`

