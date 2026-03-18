# Provider Setup & Management — FilmBuff User Guide

> **Satisfies:** bd-int-d4 buff-core.04.02.01 — Write user documentation: provider setup and management

FilmBuff routes AI-powered commands (e.g. `generate-shot-list`) through a
configurable **provider system**. You choose a provider (Anthropic, OpenAI,
Google AI, or a custom endpoint), create a named profile, and activate it.
API keys are **never stored in project files** — they are referenced by
environment-variable name and resolved at runtime.

---

## Table of Contents

1. [Built-in Providers](#built-in-providers)
2. [Quick Start (Interactive Wizard)](#quick-start-interactive-wizard)
3. [Manual Provider Setup](#manual-provider-setup)
4. [Environment Variable Reference](#environment-variable-reference)
5. [Managing Profiles](#managing-profiles)
6. [Switching Providers](#switching-providers)
7. [Custom Providers](#custom-providers)
8. [File Locations](#file-locations)
9. [Troubleshooting](#troubleshooting)

---

## Built-in Providers

| Provider ID  | Display Name           | Required Env Var         | Default Model          |
|-------------|------------------------|--------------------------|------------------------|
| `anthropic` | Anthropic (Claude)     | `ANTHROPIC_API_KEY`      | `claude-sonnet-4-6`    |
| `openai`    | OpenAI                 | `OPENAI_API_KEY`         | `gpt-4o`               |
| `google-ai` | Google AI (Gemini)     | `GOOGLE_AI_API_KEY`      | `gemini-1.5-pro`       |

All built-in providers use **raw HTTPS** calls (no SDK installed on the
consumer side). A custom `baseUrl` override is supported by all three so you
can point them at local proxies or OpenAI-compatible servers.

---

## Quick Start (Interactive Wizard)

The fastest path to a working AI command:

```bash
filmbuff configure
```

The wizard will:
1. Ask which provider you want to use.
2. Prompt for a profile name (e.g. `production`, `staging`).
3. Ask for your API key **environment variable name** (not the key value).
4. Optionally let you override the model and base URL.
5. Optionally activate the profile immediately.

---

## Manual Provider Setup

### Step 1 — Export your API key

Add to your shell profile (`~/.zshrc`, `~/.bashrc`, PowerShell `$PROFILE`):

```bash
# Bash / Zsh
export ANTHROPIC_API_KEY="sk-ant-api03-..."
export OPENAI_API_KEY="sk-proj-..."
export GOOGLE_AI_API_KEY="AIzaSy..."
```

```powershell
# PowerShell
$env:ANTHROPIC_API_KEY = "sk-ant-api03-..."
```

> Restart your terminal (or run `source ~/.zshrc`) for the variable to take effect.

### Step 2 — Create a profile

```bash
filmbuff provider create
```

You will be prompted for:
- **Provider ID** — e.g. `anthropic`
- **Profile name** — e.g. `production`
- **API key env var name** — e.g. `ANTHROPIC_API_KEY`
- **Model** (optional) — overrides the provider default
- **Base URL** (optional) — use for local proxies or OpenAI-compatible servers

The profile is saved to:
`.augment/providers/profiles/<providerId>/<profileName>.json`

### Step 3 — Activate the profile

```bash
filmbuff provider activate anthropic production
```

The active selection is written to `.augment/providers/active.json`. Every
AI-powered command reads this file automatically.

### Step 4 — Verify

```bash
filmbuff provider status
```

Expected output:
```
Active provider : anthropic
Profile         : production
Model           : claude-sonnet-4-6
API key source  : env:ANTHROPIC_API_KEY  [resolved ✓]
```

---

## Environment Variable Reference

| Variable            | Provider   | Notes                                              |
|--------------------|------------|----------------------------------------------------|
| `ANTHROPIC_API_KEY` | anthropic  | Starts with `sk-ant-`                              |
| `OPENAI_API_KEY`    | openai     | Starts with `sk-proj-` or `sk-`. Use `"none"` for unauthenticated local endpoints. |
| `OPENAI_BASE_URL`   | openai     | Optional; overrides `https://api.openai.com/v1`    |
| `GOOGLE_AI_API_KEY` | google-ai  | Starts with `AIzaSy`                               |

FilmBuff stores `env:<VAR_NAME>` in profile files. The real value is resolved
from your shell environment at the moment each command runs.

---

## Managing Profiles

```bash
# List all providers and saved profiles
filmbuff provider list

# Show a specific profile (secrets are always redacted)
filmbuff provider show anthropic production

# Validate a profile against its provider schema
filmbuff provider validate anthropic production

# Edit an existing profile interactively
filmbuff provider edit anthropic production

# Delete a profile
filmbuff provider delete anthropic production

# Show the currently active provider/profile
filmbuff provider status
```

---

## Switching Providers

### Per-command override

Pass `--provider` and `--profile` to any AI command:

```bash
filmbuff generate-shot-list input.fountain \
  --provider openai \
  --profile my-gpt4-profile
```

### Change the global default

```bash
filmbuff provider activate openai my-gpt4-profile
```

This updates `.augment/providers/active.json` and applies to all subsequent
commands until you activate a different profile.

---

## Custom Providers

Register any OpenAI-compatible self-hosted endpoint as a custom provider:

```bash
filmbuff provider create
# Select "custom" when prompted for provider type
```

Custom provider metadata is stored in `.augment/providers/custom-providers.json`
and loaded automatically alongside built-in providers.

**Required contract** (`ProviderDefinition` interface):

```typescript
interface ProviderDefinition {
  id: string;                                // unique identifier
  displayName: string;
  capabilities: ProviderCapability[];        // e.g. ['text-generation']
  credentialSchema: CredentialField[];       // fields for API key, etc.
  settingsSchema:   SettingField[];          // model, base URL, etc.
  validate(settings, credentials): ValidationResult;
  createExecutor(settings, credentials): ProviderExecutor;
}
```

### Example: Ollama (local LLM)

```bash
# 1. Create a profile pointing at local Ollama
filmbuff provider create
# Provider type: openai  (Ollama is OpenAI-compatible)
# Profile name: ollama-local
# API key env var: OPENAI_API_KEY  (set to "none")
# Base URL: http://localhost:11434/v1
# Model: llama3.2

# 2. Activate
filmbuff provider activate openai ollama-local
```

---

## File Locations

| File | Purpose |
|------|---------|
| `.augment/providers/active.json` | Currently active provider and profile |
| `.augment/providers/profiles/<id>/<name>.json` | Named profiles (one per provider) |
| `.augment/providers/custom-providers.json` | Custom provider registrations |

> **Security note:** Profile files never contain raw API key values, only
> `env:VARIABLE_NAME` references. You may safely commit profiles to version
> control. Add `active.json` to `.gitignore` if you want each developer to
> maintain their own active selection.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `No active AI provider is configured` | No active selection set | Run `filmbuff configure` or `filmbuff provider activate <id> <profile>` |
| `Missing required credential: API Key` | Env var not set or misspelled | Run `echo $ANTHROPIC_API_KEY` in your terminal to verify |
| `API key not found` in runtime | Shell env var not exported | Add `export VAR=...` to your shell profile and restart the terminal |
| `does not support capability "vision"` | Wrong provider selected | Switch to `openai` or `google-ai` |
| `Provider "X" is not registered` | Custom provider file missing | Re-run `filmbuff provider create` |
| `Anthropic API error 401` | Invalid or expired API key | Regenerate key at console.anthropic.com |
| `OpenAI API error 429` | Rate limit exceeded | Reduce concurrency or upgrade plan |
| `fetch failed` / `ECONNREFUSED` | Local proxy / Ollama not running | Start the local server and verify the base URL |

### Debug mode

```bash
# Print the resolved configuration without running a command
filmbuff provider status --verbose
```

---

*For advanced configuration, see [cli/docs/AI_PROVIDERS.md](../cli/docs/AI_PROVIDERS.md).*

