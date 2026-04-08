# FilmBuff Start Wizard — Interactive CLI Prompt

Implement an interactive command-line wizard for `filmbuff start` that steps the user through every project option with validation, sensible defaults, and a rich terminal UI. The wizard fires automatically when `filmbuff start` is invoked with no arguments, or can be launched explicitly with `filmbuff start --wizard`.

---

## Behaviour Overview

- **Non-interactive passthrough**: If `--title` and `--genre` are already supplied as flags, skip the wizard entirely and call `startCommand()` directly (existing behaviour preserved).
- **Wizard mode**: When either required flag is absent and no `--no-wizard` flag is given, launch the guided wizard.
- **Output**: At the end of the wizard, display the fully constructed command, confirm with the user, then execute `startCommand()` with the collected values.

---

## Technology Stack

- **Prompts**: `@inquirer/prompts` v7+ (ESM, already a dependency) — use `input`, `select`, `confirm`, `password`, and `checkbox` prompt types.
- **Colour / styling**: `chalk` (already a dependency).
- **Spinners**: `ora` (already a dependency) — use for provider/profile discovery steps.
- **Commander integration**: Add `--wizard` and `--no-wizard` flags to the existing `start` command registration in `cli/src/cli.ts`. The action handler checks `options.wizard !== false` and whether required options are missing to decide whether to launch the wizard.

---

## Step Sequence

Run the steps **in order**. Each step shows a header banner, the field label, any default or hint, and validates before advancing.

### Step 1 — Project Title *(mandatory)*

```
┌─────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  1/10  │
└─────────────────────────────────────────┘
? Project title:  ›
```

- Prompt type: `input`
- Validation: non-empty string, 3–120 characters.
- After entry: derive a slug preview and display it as a dim hint beneath the title field — e.g. `  slug → my-screenplay`.

### Step 2 — Film Genre *(mandatory)*

```
? Genre:  ›  (e.g. thriller, drama, comedy, horror, sci-fi, documentary)
```

- Prompt type: `input`
- Validation: non-empty, 2–60 characters, letters/spaces/hyphens only.
- Accepted aliases: normalise `sci fi` → `sci-fi`, `rom com` → `romantic-comedy`.

### Step 3 — Slug *(optional, derived)*

```
? Project slug  (URL-safe identifier):  ›  [my-screenplay]
```

- Prompt type: `input`
- Default: slug derived from title (lower-kebab-case, strip non-alphanumeric).
- Validation: `/^[a-z0-9][a-z0-9-]{1,}[a-z0-9]$/` — print a clear error if pattern fails.
- Hint: `Press Enter to accept the auto-generated slug.`

### Step 4 — Tone *(recommended)*

```
? Tone  (e.g. dark, comedic, hopeful, gritty, whimsical):  ›
```

- Prompt type: `input`
- Optional — user may press Enter to skip.
- Max 80 characters.

### Step 5 — Target Audience *(recommended)*

```
? Target audience  (e.g. "adults 18-35 who enjoy thriller dramas"):  ›
```

- Prompt type: `input`
- Optional — user may press Enter to skip.
- Max 120 characters.

### Step 6 — Budget Tier *(recommended)*

```
? Budget tier:
  ❯ micro   — Ultra-low budget, guerrilla production
    low     — Independent / festival film
    mid     — Mid-level studio or streamer
    studio  — Major studio release
    (skip)
```

- Prompt type: `select`
- Choices: `micro`, `low`, `mid`, `studio`, plus a `(skip / not set)` option that maps to `undefined`.
- No default pre-selected.

### Step 7 — Desired Outcome / Logline Intent *(recommended)*

```
? Desired outcome or logline intent:  ›
  (e.g. "A tight thriller that lands a streaming deal in 90 minutes")
```

- Prompt type: `input`
- Optional — user may press Enter to skip.
- Max 200 characters.

### Step 8 — Output Directory *(optional)*

```
? Output directory:  ›  [./output/my-screenplay]
```

- Prompt type: `input`
- Default: `path.join(process.cwd(), 'output', slug)`.
- Validation: must be a valid filesystem path string; warn (but do not block) if the path already exists.

### Step 9 — Output Format & Detail Level *(optional)*

Two sub-prompts shown back-to-back:

**9a — Default output format:**

```
? Default output format:
  ❯ md       — Markdown (recommended)
    json     — JSON
    fountain — Fountain screenplay
    pdf      — PDF
```

- Prompt type: `select`, default `md`.

**9b — Detail level:**

```
? Detail level:
    brief    — Concise summaries
  ❯ standard — Balanced output (default)
    detailed — Comprehensive, verbose output
```

- Prompt type: `select`, default `standard`.

### Step 10 — Style Modules *(optional, repeatable)*

```
? Add a style module path?  (press Enter to skip or add another)  ›
```

- Prompt type: `input`, loop: after each non-empty entry, ask `? Add another style module? (y/N)`.
- Collect into an array; pass as multiple `--style` flags in the final command.

### Step 11 — AI Provider *(optional, auto-detected)*

```
⠋ Discovering configured AI providers…

? Select AI provider for this project:
  ❯ anthropic  — Claude family  (active ★)
    openai     — GPT family
    google     — Gemini family
    xai        — Grok models
    venice     — Privacy-focused
    mock       — No API key required  (testing / offline)
    (use global default)
```

- **Discovery**: run `filmbuff ai status --json` (or call `loadConfig()` directly if implementing inside the CLI process) to retrieve the currently configured provider and its profiles. Show an `ora` spinner while discovering.
- **Filter**: display only **text-generation capable** providers (exclude video-only providers: `lumaai`, `runway`, `stable-diffusion`).
- **Active marker**: flag the currently active provider with `★`.
- **No providers found**: if `ai-powered` is not configured, show a warning and offer to skip or open the setup guide (`filmbuff ai status`).
- **Default choice**: `(use global default)` maps to `undefined` for `--provider`; the runtime resolver will pick the active `ai-powered` setting.

#### Text-generation provider catalogue

| Provider ID  | Display Name        | Supported Models (selectable)                                        |
|--------------|---------------------|-----------------------------------------------------------------------|
| `anthropic`  | Anthropic (Claude)  | `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-3-5`          |
| `openai`     | OpenAI              | `gpt-4o`, `gpt-4o-mini`, `o1-preview`, `o1-mini`                    |
| `google`     | Google (Gemini)     | `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-2.0-flash`            |
| `xai`        | xAI (Grok)          | `grok-2`, `grok-2-vision`                                            |
| `venice`     | Venice AI           | `venice-xl`, `venice-uncensored`                                     |
| `mock`       | Mock (offline)      | `mock-v1`                                                             |

### Step 12 — AI Profile *(optional, shown only if a provider was selected)*

```
⠋ Loading profiles for anthropic…

? Select profile:
  ❯ default     (active ★)
    work
    client-a
    (enter a profile name manually)
    (skip / use provider default)
```

- **Discovery**: query `ai-powered` profile store for all saved profiles scoped to the selected provider.
- **Manual entry**: if the user selects `(enter a profile name manually)`, show an `input` prompt.
- **Skip**: maps `--profile` to `undefined`.

---

## Validation Rules Summary

| Field         | Required | Rule                                                      |
|---------------|----------|-----------------------------------------------------------|
| `title`       | ✅ Yes   | Non-empty, 3–120 chars                                    |
| `genre`       | ✅ Yes   | Non-empty, 2–60 chars, letters/spaces/hyphens             |
| `slug`        | No       | `/^[a-z0-9][a-z0-9-]+[a-z0-9]$/`, unique in project DB   |
| `tone`        | No       | Max 80 chars                                              |
| `audience`    | No       | Max 120 chars                                             |
| `budget`      | No       | One of: `micro`, `low`, `mid`, `studio`                  |
| `outcome`     | No       | Max 200 chars                                             |
| `output-dir`  | No       | Valid path string                                         |
| `format`      | No       | One of: `md`, `json`, `fountain`, `pdf`                  |
| `detail`      | No       | One of: `brief`, `standard`, `detailed`                  |
| `style`       | No       | Repeatable path strings                                   |
| `ai-provider` | No       | Must be a text-generation capable provider ID             |
| `ai-profile`  | No       | Must exist for the selected provider, or manual string    |

---

## Confirmation & Execution

After all steps, display a summary panel and ask for confirmation before running:

```
┌──────────────────────────────────────────────────────────┐
│  📋  Review your project settings                        │
├──────────────────────────────────────────────────────────┤
│  Title:        My Thriller Screenplay                    │
│  Genre:        thriller                                  │
│  Slug:         my-thriller-screenplay                    │
│  Tone:         dark, tense                               │
│  Audience:     Adults 25-45, streaming                   │
│  Budget:       mid                                       │
│  Outcome:      Land a Netflix deal                       │
│  Output dir:   ./output/my-thriller-screenplay           │
│  Format:       md                                        │
│  Detail:       standard                                  │
│  Style mods:   (none)                                    │
│  AI provider:  anthropic  (profile: default)             │
└──────────────────────────────────────────────────────────┘

  Equivalent command:
  filmbuff start \
    --title "My Thriller Screenplay" \
    --genre thriller \
    --tone "dark, tense" \
    --audience "Adults 25-45, streaming" \
    --budget mid \
    --outcome "Land a Netflix deal" \
    --output-dir "./output/my-thriller-screenplay" \
    --format md \
    --detail standard \
    --ai-provider anthropic \
    --ai-profile default

? Proceed?  (Y/n)  ›
```

- If confirmed: call `startCommand(options)` with the collected values.
- If declined: offer `[E]dit  [S]tart over  [Q]uit`.
  - **Edit**: re-enter the wizard from Step 1 with all previously entered values pre-filled as defaults.
  - **Start over**: clear all values and restart from Step 1.
  - **Quit**: exit with code 0 and message `Project creation cancelled.`

---

## Error Handling

- **Ctrl-C / ExitPromptError**: catch at wizard top level, print `\nProject creation cancelled.` and exit 0. Do not print a stack trace.
- **DuplicateSlugError** (thrown by `ProjectRepository.create()`): surface as a friendly inline error and jump back to the Slug step.
- **Provider discovery failure**: catch, show a yellow warning `⚠ Could not load AI provider list — skipping provider selection.`, and continue the wizard without the provider steps.
- **Validation failure**: display the error in red beneath the failing prompt and re-prompt the same field without advancing.

---

## Implementation Location

| File                               | Change                                                                                      |
|------------------------------------|---------------------------------------------------------------------------------------------|
| `cli/src/commands/start-wizard.ts` | New file: `export async function startWizard(): Promise<StartOptions>` — all wizard steps.  |
| `cli/src/commands/start.ts`        | Import `startWizard`; add `wizard?: boolean` to `StartOptions`; call wizard when triggered. |
| `cli/src/cli.ts`                   | Add `.option('--wizard', 'Launch interactive project wizard')` to the `start` command.      |

The wizard **must not** duplicate `startCommand()` logic. It only collects `StartOptions` and delegates execution to the existing `startCommand()`.

---

## Example Usage

```bash
# Launch wizard (no args)
filmbuff start

# Launch wizard explicitly
filmbuff start --wizard

# Bypass wizard (all required fields supplied)
filmbuff start --title "Midnight Run" --genre "thriller"

# Bypass wizard explicitly
filmbuff start --title "Midnight Run" --genre "thriller" --no-wizard
```
