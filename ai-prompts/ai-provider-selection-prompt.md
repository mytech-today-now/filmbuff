# AI Provider Selection — configure + gui Pattern

Refactor the `configure` command and the interactive `gui` command in this CLI to support a complete, user-friendly AI provider selection workflow. The result should work for any Node.js / Commander.js CLI that already has a provider registry, a profile store, and individual provider management functions (`providerListCommand`, `providerCreateCommand`, `providerEditCommand`, `providerDeleteCommand`, `providerActivateCommand`, `providerStatusCommand`).

---

## 1. `configure` — guided wizard + direct CLI flags

The `configure` command must serve two modes:

**Mode A — direct flags (non-interactive):**

```
<cli> configure --list-providers
<cli> configure --list-profiles
<cli> configure --list-profiles-for-provider <providerId>
<cli> configure --create-profile <providerId>/<profileName>
<cli> configure --edit-profile   <providerId>/<profileName>
<cli> configure --delete-profile <providerId>/<profileName>
<cli> configure --activate-profile <providerId>/<profileName>
```

When any flag is present, execute only that operation and return immediately. Do not launch the interactive wizard. Profile-targeting flags accept a single slash-separated value (`providerId/profileName`). Parse this with a helper that splits on the first `/` and exits with a clear error if the separator is missing.

Flag behaviour:
- `--list-providers` → delegate to `providerListCommand({ profiles: false })`
- `--list-profiles` → delegate to `providerListCommand({ profiles: true })`
- `--list-profiles-for-provider <id>` → filter `profileStore.listAll()` by `providerId`, print each profile name, mark the active one with ★
- `--create-profile <id/name>` → delegate to `providerCreateCommand(providerId, profileName, {})`
- `--edit-profile <id/name>` → delegate to `providerEditCommand(providerId, profileName, {})`
- `--delete-profile <id/name>` → delegate to `providerDeleteCommand(providerId, profileName)`
- `--activate-profile <id/name>` → delegate to `providerActivateCommand(providerId, profileName)`

**Mode B — interactive guided wizard (no flags):**

When called with no flags, run the existing step-by-step setup:
1. Print numbered list of all registered providers
2. Prompt for provider selection by number
3. Prompt for profile name (default: `"default"`)
4. Call `providerCreateCommand` interactively
5. Offer to activate the new profile immediately (`Y/n`)

**Interface:**

Export a `ConfigureOptions` interface with all flag fields typed as optional strings or booleans. The `configureCommand(options: ConfigureOptions = {})` function checks each field in order and returns early after the first match. Register all options in the CLI framework with descriptive help text.

---

## 2. `gui` — AI Providers menu item

Add an **🤖 AI Providers** entry to the main interactive `gui` menu alongside any existing items (module linking, search, etc.).

When selected, the provider menu must:
1. Print a rich status panel via `providerStatusCommand()` showing the active provider/profile, all registered providers, and all saved profiles
2. Present an inquirer `select` prompt with these choices:
   - ⚙️  Run guided setup (`configure` with no flags — triggers the interactive wizard)
   - ↩  Back to main menu
3. If the user picks guided setup, call `configureCommand()` and then return to the gui loop
4. If the user picks Back, return to the main menu loop

Handle `ExitPromptError` (Ctrl+C) gracefully at the top of the gui loop without a stack trace.

---

## 3. Implementation notes

- Use `chalk` for colour-coded output; use `inquirer` v13+ (ESM-only) with `type: 'select'` — not `type: 'list'`.
- All provider mutations (`create`, `edit`, `delete`, `activate`) must call `ensureProviders()` before accessing the registry or store.
- The slash-separated `providerId/profileName` convention mirrors the subcommand syntax used by `provider create <providerId> <profileName>` and keeps each flag self-contained without requiring additional `--provider` / `--profile` companion flags.
- Register the `configure` command's new options with Commander.js using `.option()` on the existing command registration; the action handler simply passes `options` to `configureCommand(options)`.
- The gui provider menu function should be a plain `async function providerMenuInteractive()` kept in the same file as the rest of the gui helpers.

