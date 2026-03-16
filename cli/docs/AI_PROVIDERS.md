# AI Providers — Setup, Switching & Troubleshooting

FilmBuff routes all AI-powered commands (e.g. `generate-shot-list`) through a
configurable provider system. You choose the provider and keep API keys out of
your project files by storing them as environment-variable references.

---

## Built-in Providers

| Provider ID  | Display Name           | Capabilities                        |
|-------------|------------------------|-------------------------------------|
| `anthropic` | Anthropic (Claude)     | text-generation, generate-shot-list |
| `openai`    | OpenAI                 | text-generation, vision, generate-shot-list |
| `google-ai` | Google AI (Gemini)     | text-generation, vision, generate-shot-list |

---

## Quick Start

### 1 — Run the guided setup

```bash
filmbuff configure
```

The wizard walks you through choosing a provider, naming a profile, and entering
your API key (stored as an `env:` reference — never in plain text).

### 2 — Or create a profile manually

```bash
filmbuff provider create
```

You will be prompted for a provider ID, a profile name, a model, and your API
key variable name (e.g. `ANTHROPIC_API_KEY`).

### 3 — Activate a profile

```bash
filmbuff provider activate <providerId> <profileName>
```

Example:

```bash
filmbuff provider activate anthropic production
```

The active selection is written to `.augment/providers/active.json`. Every
AI-powered command resolves this selection at runtime.

---

## Managing Profiles

```bash
# List all available providers and saved profiles
filmbuff provider list

# Show a specific profile (secrets are redacted)
filmbuff provider show <providerId> <profileName>

# Validate a profile against its provider schema
filmbuff provider validate <providerId> <profileName>

# Edit an existing profile interactively
filmbuff provider edit <providerId> <profileName>

# Delete a profile
filmbuff provider delete <providerId> <profileName>

# Show the currently active provider/profile
filmbuff provider status
```

---

## Storing API Keys Safely

FilmBuff **never** stores API key values in profile files. Instead, it stores a
reference like `env:ANTHROPIC_API_KEY` and resolves the real value from your
environment at runtime.

**Recommended setup:**

```bash
# Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GOOGLE_AI_API_KEY="AIza..."
```

When you create a profile, enter the variable *name* (e.g. `ANTHROPIC_API_KEY`)
and FilmBuff stores `env:ANTHROPIC_API_KEY`. The key is resolved only when a
command runs.

---

## Switching Providers

To use a different provider for a single command, pass `--provider` and
`--profile` flags:

```bash
filmbuff generate-shot-list --provider openai --profile my-gpt4-profile
```

To change the default for all commands:

```bash
filmbuff provider activate openai my-gpt4-profile
```

---

## Custom Providers

Register a self-hosted or community provider that implements the
`ProviderDefinition` contract:

```bash
filmbuff provider create
# Select "custom" when prompted for provider type
```

Custom provider metadata is stored in `.augment/providers/custom-providers.json`
and loaded automatically alongside built-in providers.

The `ProviderDefinition` interface (TypeScript) requires:

```ts
interface ProviderDefinition {
  id: string;
  displayName: string;
  capabilities: ProviderCapability[];
  credentialSchema: CredentialField[];
  settingsSchema:   SettingField[];
  validate(settings, credentials): ValidationResult;
  createExecutor(settings, credentials): ProviderExecutor;
}
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `No active AI provider is configured` | No active selection set | Run `filmbuff configure` or `filmbuff provider activate` |
| `Missing required credential: API Key` | Env var not set or misspelled | Verify `echo $YOUR_VAR` in your shell |
| `does not support capability "vision"` | Wrong provider selected | Switch to `openai` or `google-ai` |
| `Provider "X" is not registered` | Custom provider file missing | Re-run `filmbuff provider create` |

---

## File Locations

| File | Purpose |
|------|---------|
| `.augment/providers/active.json` | Active provider/profile selection |
| `.augment/providers/profiles/<providerId>/<profileName>.json` | Named profiles |
| `.augment/providers/custom-providers.json` | Custom provider registrations |

> These files are written to the project root. Add them to `.gitignore` if your
> API key env-var names are sensitive.

