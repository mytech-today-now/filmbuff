# JIRA Ticket: TBD — Interactive CLI Wizard for `filmbuff start`

### Summary

Introduce an interactive, step-by-step terminal wizard that fires automatically when `filmbuff start` is invoked without `--title` and `--genre`, guiding users through all twelve project fields — title, genre, slug, tone, target audience, budget tier, desired outcome, output directory, output format, detail level, style modules, AI provider, and AI profile — with input validation, live derived-value previews, provider auto-discovery via the `ai-powered` library, and a final confirmation panel that also displays the equivalent one-liner command for scripting. When all required flags are already supplied the wizard is bypassed entirely so automated and scripted invocations are unaffected.

### Description

#### Background

`filmbuff start` is the entry point for every film project pipeline. Its current interface is purely flag-driven:

```bash
filmbuff start \
  --title "The Midnight Run" \
  --genre thriller \
  --tone "dark and tense" \
  --audience "Adults 25–45 who enjoy streamer originals" \
  --budget mid \
  --outcome "Land a Netflix acquisition" \
  --ai-provider anthropic \
  --ai-profile work
```

While expressive, this form requires the user to know every flag name, acceptable value, and correct syntax before running the command. First-time users and creative professionals who are not command-line-native encounter an empty blinking cursor with no guidance about what to type next. This creates three compounding problems:

1. **Discovery friction.** There are twelve configurable fields. Running `filmbuff start --help` dumps the full flag list but provides no context about which fields matter most, what values are acceptable, or what the consequences of skipping optional fields are for AI generation quality.

2. **Silent quality degradation.** Fields like `--tone`, `--audience`, and `--outcome` are technically optional but critically important: without a tone, the AI defaults to a generic register; without an outcome, the shot-list generator cannot tailor visual language to the project's distribution goals. Users who do not know to supply these fields get meaningfully worse output without understanding why.

3. **Provider configuration opacity.** The `--ai-provider` and `--ai-profile` flags require the user to know the exact ID of a provider they configured separately, through a different tool (`ai-powered config set provider …`). There is no in-context way to discover what providers are available or which one is currently active without leaving the current terminal session.

The wizard solves all three problems: it surfaces every configurable field in sequence, provides context for each one, auto-detects the current `ai-powered` configuration and presents selectable providers by name, and lets the user review and confirm before any project row is written to the database.

#### Trigger Logic

The wizard fires in exactly two conditions:

1. `filmbuff start` is called with no arguments (neither `--title` nor `--genre` supplied).
2. `filmbuff start --wizard` is called explicitly, regardless of whether other flags are also present.

The wizard is suppressed in exactly two conditions:

1. Both `--title` and `--genre` are supplied as flags (existing non-interactive behaviour is preserved in full).
2. `filmbuff start --no-wizard` is called (forces non-interactive mode; exits with a descriptive error if `--title` or `--genre` is also missing).

Flag precedence: `--no-wizard` beats `--wizard`. If both are present, non-interactive mode wins and a warning is printed.

```bash
# Fires wizard — no args
filmbuff start

# Fires wizard — explicit flag; other flags are used as pre-filled defaults
filmbuff start --wizard --genre thriller

# Skips wizard — both required flags present
filmbuff start --title "Midnight Run" --genre thriller

# Skips wizard — forced off; --title missing → exits with error
filmbuff start --no-wizard --genre thriller
# Error: --title is required in non-interactive mode. Omit --no-wizard to use the interactive wizard.

# Explicit wizard with pre-filled genre; wizard skips to step 2 pre-answered
filmbuff start --wizard --title "The Long Haul" --genre "documentary"
```

When `--wizard` is combined with pre-supplied flags, each wizard step whose value was already provided on the command line is pre-filled with that value as the default — the user can confirm with Enter or overwrite. No step is silently skipped.

#### Technology Stack

All dependencies are already present in `package.json`. No new npm packages are required.

| Library | Usage |
|---|---|
| `@inquirer/prompts` v7+ (ESM) | `input`, `select`, `confirm`, `password`, `checkbox` prompt types for all wizard steps |
| `chalk` | Colour-coded banners, hints, validation errors, and the confirmation summary panel |
| `ora` | Spinners during the asynchronous `ai-powered` provider and profile discovery sub-steps |
| `Commander.js` | `--wizard` / `--no-wizard` option registration on the existing `start` command |

Use `@inquirer/prompts` named exports exclusively — **not** the legacy `inquirer` default export. All select prompts use `type: 'select'` (not the deprecated `type: 'list'`). Catch `ExitPromptError` (thrown by Ctrl-C) at the wizard's top-level `try/catch`; print `\nProject creation cancelled.` and `process.exit(0)` without a stack trace.

#### Step-by-Step Specification

Each step renders a header banner showing the current step number out of the total, then the prompt. Validation errors appear in red beneath the prompt without advancing to the next step. Steps pre-filled from CLI flags show that value as the default; pressing Enter accepts the pre-fill.

---

**Step 1 — Project Title** *(mandatory)*

```
┌─────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  1/12  │
└─────────────────────────────────────────┘
? Project title:  ›
```

Validation rules:
- Non-empty string.
- Minimum 3 characters, maximum 120 characters.
- After a valid entry is submitted, the derived slug is computed and printed as a dim hint before advancing:

```
  → slug preview: the-midnight-run
```

Worked examples of title → slug derivation:

| Title entered | Derived slug |
|---|---|
| `The Midnight Run` | `the-midnight-run` |
| `2046: A Space Drama` | `2046-a-space-drama` |
| `  Untitled Project  ` | `untitled-project` (trimmed) |
| `Björk's Comeback!!!` | `bjrks-comeback` (non-ASCII and punctuation stripped) |

Validation failure examples:

```
? Project title: › AB
  ✗ Title must be at least 3 characters.

? Project title: › [130-character string]
  ✗ Title must be 120 characters or fewer (currently 130).
```

---

**Step 2 — Film Genre** *(mandatory)*

```
┌─────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  2/12  │
└─────────────────────────────────────────┘
? Genre:  ›
  Hint: e.g. thriller, drama, comedy, horror, sci-fi, documentary, commercial
        Multiple genres accepted comma-separated: "comedy,romance"
```

Validation rules:
- Non-empty string.
- 2–60 characters.
- Allowed characters: letters, spaces, hyphens, commas (for multi-genre).
- Normalise common aliases before storing: `sci fi` → `sci-fi`, `rom com` → `romantic-comedy`, `romcom` → `romantic-comedy`.

Worked multi-genre examples (matching `ai-prompts/film-docs-JIRA.md` genre blending spec):

| Input | Stored | AI interpretation |
|---|---|---|
| `comedy,romance` | `comedy,romance` | Romcom tone (*Knocked Up* register) |
| `comedy,documentary` | `comedy,documentary` | Docu-comedy (*Spinal Tap* register) |
| `thriller,sci-fi` | `thriller,sci-fi` | Tech-paranoia thriller (*Ex Machina* register) |
| `drama` | `drama` | Pure drama, no genre modifier |

---

**Step 3 — Slug** *(optional, auto-derived)*

```
┌─────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  3/12  │
└─────────────────────────────────────────┘
? Project slug  (URL-safe identifier):  ›  the-midnight-run
  Hint: Press Enter to accept the auto-generated slug.
        This identifier is used for output paths and database keys.
```

- Default: slug derived from the title entered in Step 1.
- Validation regex: `/^[a-z0-9][a-z0-9-]{1,}[a-z0-9]$/`.
- The slug must be unique across existing projects in the database. If a duplicate is detected at this step (pre-flight check via `ProjectRepository.findBySlug()`), a yellow warning is displayed and the user is prompted to choose a different slug before advancing. This catches the duplicate early rather than at the final `startCommand()` call.

Collision detection example:

```
? Project slug:  ›  the-midnight-run
  ⚠ A project with slug "the-midnight-run" already exists.
    Choose a different slug to proceed.
? Project slug:  ›  the-midnight-run-2
  ✓
```

---

**Step 4 — Tone** *(recommended)*

```
┌─────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  4/12  │
└─────────────────────────────────────────┘
? Tone  (e.g. dark, comedic, hopeful, gritty, whimsical, satirical):  ›
  Hint: Tone shapes vocabulary, pacing, and visual language across every
        generated document. Leaving it blank produces generic output.
        Press Enter to skip.
```

- Optional. Press Enter to skip (value is `undefined`).
- Maximum 80 characters.
- Tone examples that produce meaningfully different AI output:

| Tone supplied | Effect on generation |
|---|---|
| `dark and claustrophobic` | Interior scenes, low-key lighting cues, terse dialogue beats |
| `sun-drenched and nostalgic` | Wide exterior shots, magic-hour notation, warm colour palette hints |
| `deadpan satirical` | Flat affect stage directions, ironic juxtaposition in beat sheets |
| `kinetic and propulsive` | Short scene lengths, rapid intercutting, action-verb blocking |

---

**Step 5 — Target Audience** *(recommended)*

```
┌─────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  5/12  │
└─────────────────────────────────────────┘
? Target audience:  ›
  Hint: e.g. "Adults 18–35 who enjoy streamer thrillers"
             "Family audiences, G-rated, theme-park sensibility"
             "B2B decision-makers, 3-minute corporate explainer"
        Audience context shapes runtime, MPAA-register, and commercial framing.
        Press Enter to skip.
```

- Optional. Maximum 120 characters.
- When provided, the AI uses this to calibrate MPAA register, runtime targets, and distribution-channel vocabulary in loglines and shot notes.

---

**Step 6 — Budget Tier** *(recommended)*

```
┌─────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  6/12  │
└─────────────────────────────────────────┘
? Budget tier:
  ❯ micro   — Ultra-low budget; single location, minimal crew, no named cast
    low     — Independent / festival; 2–5 locations, small crew
    mid     — Mid-level studio or streamer; multiple locations, union crew
    studio  — Major studio release; unlimited locations, full crew, VFX
    (skip / not set)
```

- Prompt type: `select`.
- No pre-selection — the cursor starts on `micro`.
- Selecting `(skip / not set)` stores `undefined`; the AI uses a generic-budget register.
- Budget tier informs script-breakdown recommendations, shot-list complexity, and cast-size guidance throughout the pipeline.

Budget tier effect examples in shot-list output:

| Tier | Shot-list impact |
|---|---|
| `micro` | Avoids crane/Steadicam notations; favours handheld and available light |
| `low` | Allows one-day location pickups; limits VFX shots |
| `mid` | Full lighting package notation; 1–2 VFX shots acceptable |
| `studio` | No production constraints; full VFX, crowd scenes, multi-camera notation |

---

**Step 7 — Desired Outcome / Logline Intent** *(recommended)*

```
┌─────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  7/12  │
└─────────────────────────────────────────┘
? Desired outcome or logline intent:  ›
  Hint: Describe what you want this project to achieve commercially or creatively.
        e.g. "A 90-minute streamer thriller targeting a Netflix acquisition"
             "Festival-circuit short, Sundance eligible, <15 min runtime"
             "60-second brand commercial for a roofing company, broadcast-safe"
             "Proof-of-concept pilot for an episodic dramedy, 22-min runtime"
        Press Enter to skip.
```

- Optional. Maximum 200 characters.
- This field is the single most impactful optional input for logline quality: it tells the AI exactly what distribution window and runtime the project is targeting, enabling it to calibrate structure, pacing, and commercial language from the very first step.
- It is stored as `outcome` in the project row and surfaced as `outcome` context in the prompt for every pipeline step.

---

**Step 8 — Output Directory** *(optional)*

```
┌─────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  8/12  │
└─────────────────────────────────────────┘
? Output directory:  ›  ./output/the-midnight-run
  Hint: All generated pipeline documents (logline, synopsis, treatment, etc.)
        will be written under this path.
        Press Enter to accept the default.
```

- Default: `path.join(process.cwd(), 'output', slug)`.
- Any non-empty string is accepted as a valid path (validation is limited to ensuring the string is a legal filesystem path on the current OS). If the directory already exists, a yellow advisory is printed — but the user is not blocked:

```
  ⚠ Directory "./output/the-midnight-run" already exists.
    Existing files with matching names will be overwritten when documents are generated.
    Press Enter to continue, or type a new path.
```

---

**Step 9 — Output Format** *(optional)*

```
┌─────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  9/12  │
└─────────────────────────────────────────┘
? Default output format:
  ❯ md       — Markdown  (recommended for editing and version control)
    json     — JSON  (machine-readable; useful for downstream tooling)
    fountain — Fountain  (industry-standard screenplay plain text)
    pdf      — PDF  (fixed layout; requires a Markdown → PDF renderer)
```

- Prompt type: `select`. Default pre-selection: `md`.
- This sets `format_override` in the project row, applying to all pipeline steps unless overridden by a `--format` flag at the step level.
- Followed immediately by the detail-level sub-prompt (Step 9b):

```
? Detail level:
    brief    — Concise summaries; faster generation, lower token cost
  ❯ standard — Balanced output  (default)
    detailed — Comprehensive, verbose; best for full-length screenplays
```

- Default pre-selection: `standard`. Stored as `detail_level`.

---

**Step 10 — Style Modules** *(optional, repeatable)*

```
┌──────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  10/12  │
└──────────────────────────────────────────┘
? Add a cinematic style module path?
  Hint: Style modules load additional writing conventions and visual language rules.
        e.g. writing-standards/screenplay/cinematic-styles/directors/kubrick
             writing-standards/screenplay/cinematic-styles/directors/coen-brothers
             writing-standards/screenplay/cinematic-styles/genres/neo-noir
        Press Enter to skip or to finish adding modules.
? Style module path:  ›
```

- Prompt type: `input`. Pressing Enter on an empty input skips or finishes.
- After each non-empty entry, a follow-up confirm prompt fires:

```
  ✓ Added: writing-standards/screenplay/cinematic-styles/directors/kubrick

? Add another style module? (y/N)  ›
```

- Collected paths are stored as the `style_modules` array in the project row and forwarded to every downstream generation step as `--style` flags.
- Multiple modules compose additively. Example of a three-module composition:

```
  Style modules:
    1. writing-standards/screenplay/cinematic-styles/directors/kubrick
    2. writing-standards/screenplay/cinematic-styles/genres/neo-noir
    3. writing-standards/screenplay/cinematic-styles/formats/commercial-60s
```

---

**Step 11 — AI Provider** *(optional, auto-detected)*

```
┌──────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  11/12  │
└──────────────────────────────────────────┘
⠋ Discovering configured AI providers…
```

The wizard calls `loadConfig()` from `cli/src/utils/filmbuff-ai-client.ts` in-process (or runs `filmbuff ai status --json` as a subprocess fallback) to enumerate the providers known to `ai-powered`. An `ora` spinner runs during this discovery; it stops before the select prompt is rendered.

```
? Select AI provider for this project:
  ❯ anthropic      — Anthropic (Claude)         (active ★)
    openai         — OpenAI (GPT)
    google         — Google (Gemini)
    xai            — xAI (Grok)
    venice         — Venice AI  (privacy-focused)
    mock           — Mock  (no API key — offline / CI testing)
    (use global default — resolved at runtime by ai-powered)
```

Discovery and filtering rules:

- **Text-only filter**: Providers flagged as video-only (`lumaai`, `runway`, `stable-diffusion`) are excluded from this list. Shot-list generation uses the text provider; `generate-video` selects the video provider separately.
- **Active marker**: The provider that `ai-powered` reports as currently active is marked with `★`. If no provider is configured yet, `mock` is pre-selected and a yellow advisory is shown:

```
  ⚠ No AI provider is configured. Selecting "mock" will use deterministic
    in-process responses (no API key required). Run "ai-powered config set
    provider anthropic" after setup to configure a real provider.
```

- **Discovery failure**: If `loadConfig()` throws (e.g., `ai-powered` is not installed or the config directory is inaccessible), the entire provider and profile steps are skipped with a non-fatal warning:

```
  ⚠ Could not load AI provider list (ai-powered may not be configured).
    Skipping provider selection — the global ai-powered default will be used at runtime.
    Run "filmbuff ai status" after project creation to inspect or change your provider.
```

Text-generation provider catalogue (matches `docs/PROVIDER_SETUP.md`):

| Provider ID  | Display Name        | Selectable Models                                                    |
|---|---|---|
| `anthropic`  | Anthropic (Claude)  | `claude-haiku-3-5`, `claude-sonnet-4-5`, `claude-opus-4-5`         |
| `openai`     | OpenAI (GPT)        | `gpt-4o-mini`, `gpt-4o`, `o1-mini`, `o1-preview`                   |
| `google`     | Google (Gemini)     | `gemini-2.0-flash`, `gemini-1.5-flash`, `gemini-1.5-pro`           |
| `xai`        | xAI (Grok)          | `grok-2`, `grok-2-vision`                                           |
| `venice`     | Venice AI           | `venice-xl`, `venice-uncensored`                                    |
| `mock`       | Mock (offline)      | `mock-v1`                                                            |

---

**Step 12 — AI Profile** *(optional, shown only when a provider was selected in Step 11)*

```
┌──────────────────────────────────────────┐
│  🎬  FilmBuff New Project Wizard  12/12  │
└──────────────────────────────────────────┘
⠋ Loading profiles for anthropic…

? Select profile:
  ❯ default        (active ★)
    work
    client-roofing
    (enter a profile name manually)
    (skip / use provider default)
```

- Discovery: query `ai-powered`'s profile store for all saved profiles scoped to the selected provider. If only `default` exists, show it pre-selected and skip straight to confirmation.
- `(enter a profile name manually)` triggers a follow-up `input` prompt — useful for a profile that the user knows exists in `~/.ai-powered/config.json` but was created after the discovery snapshot.
- `(skip / use provider default)` stores `undefined` for `profile`; the runtime resolver uses the provider's active profile at execution time.

Profile selection examples for `anthropic`:

```
# User running separate personal and client projects on the same machine:
profiles discovered: default, personal, client-a, client-b, work-ott

# Selecting "client-a" stores:
#   active_provider_id:  anthropic
#   active_profile_name: client-a

# At runtime, resolveProviderByProfile('anthropic', 'client-a') loads the
# matching API key from ~/.ai-powered/config.json without exposing it.
```

---

#### Confirmation and Review Panel

After all 12 steps, the wizard renders a full summary panel and asks for explicit confirmation before writing any data to the database:

```
┌──────────────────────────────────────────────────────────────────────┐
│  📋  Review your project settings                                    │
├──────────────────────────────────────────────────────────────────────┤
│  Title:        The Midnight Run                                      │
│  Genre:        thriller                                              │
│  Slug:         the-midnight-run                                      │
│  Tone:         dark and claustrophobic                               │
│  Audience:     Adults 25–45, streamer originals                      │
│  Budget:       mid                                                   │
│  Outcome:      90-minute Netflix acquisition target                  │
│  Output dir:   ./output/the-midnight-run                             │
│  Format:       md                                                    │
│  Detail:       standard                                              │
│  Style mods:   writing-standards/screenplay/cinematic-styles/        │
│                  directors/kubrick                                   │
│                writing-standards/screenplay/cinematic-styles/        │
│                  genres/neo-noir                                     │
│  AI provider:  anthropic  (profile: work)                            │
└──────────────────────────────────────────────────────────────────────┘

  Equivalent command:
  filmbuff start \
    --title "The Midnight Run" \
    --genre thriller \
    --tone "dark and claustrophobic" \
    --audience "Adults 25–45, streamer originals" \
    --budget mid \
    --outcome "90-minute Netflix acquisition target" \
    --output-dir "./output/the-midnight-run" \
    --format md \
    --detail standard \
    --style writing-standards/screenplay/cinematic-styles/directors/kubrick \
    --style writing-standards/screenplay/cinematic-styles/genres/neo-noir \
    --ai-provider anthropic \
    --ai-profile work

? Proceed?  (Y/n)  ›
```

If the user types `n` or `N`, a three-option follow-up is shown:

```
? What would you like to do?
  ❯ [E]dit      — Return to Step 1 with all values pre-filled; change any field
    [S]tart over — Clear all values and restart from Step 1
    [Q]uit       — Cancel project creation and exit
```

- **Edit**: Re-enters the wizard from Step 1. Every step presents the value collected in the previous run as the default. The user presses Enter to keep a value or types to replace it. The equivalent command is regenerated from scratch at the end of the re-run.
- **Start over**: Clears all collected values; restarts the wizard from Step 1 with no defaults.
- **Quit**: Prints `Project creation cancelled.` and exits with code 0. No database writes are made.

---

#### Error Handling

All errors are caught at the wizard's top-level boundary. No error causes an unhandled rejection or a raw stack trace in user-facing output.

| Error condition | User-visible message | Recovery |
|---|---|---|
| Ctrl-C / `ExitPromptError` at any step | `\nProject creation cancelled.` | `process.exit(0)` |
| Invalid slug at Step 3 | `✗ Slug must match pattern [a-z0-9][a-z0-9-]+[a-z0-9].` (shown inline) | Re-prompt Step 3 |
| `DuplicateSlugError` from `ProjectRepository.create()` | `✗ A project with slug "the-midnight-run" already exists. Use a different slug.` | Jump back to Step 3 |
| `ai-powered` discovery failure (Step 11) | `⚠ Could not load AI provider list — skipping provider selection.` | Skip Steps 11 and 12; continue |
| Profile discovery failure (Step 12) | `⚠ Could not load profiles for "anthropic" — skipping profile selection.` | Skip Step 12; continue |
| `ProjectRepository.create()` generic failure | `✗ Failed to create project: <error message>. No data was written.` | `process.exit(1)` |
| `--no-wizard` with missing `--title` or `--genre` | `Error: --title and --genre are required in non-interactive mode.` | Printed before any step; `process.exit(1)` |

Step-level validation errors use inline re-prompt (not panel-level errors). The user never loses previously entered values due to a single-step validation failure.

---

#### Implementation Location

Three files are changed. The wizard logic lives entirely in a new file; the two existing files receive small, targeted additions.

| File | Type | Change |
|---|---|---|
| `cli/src/commands/start-wizard.ts` | **New** | Exports `startWizard(): Promise<StartOptions>`. Contains all 12 step prompts, provider discovery, confirmation panel, and edit/retry/quit loop. |
| `cli/src/commands/start.ts` | **Modified** | Adds `wizard?: boolean` to `StartOptions`. Adds six lines at the top of `startCommand()`: if wizard mode is triggered, call `await startWizard()` to collect `options`, then delegate to the existing `projectRepo.create()` path unchanged. |
| `cli/src/cli.ts` | **Modified** | Adds `.option('--wizard', 'Launch interactive project-setup wizard')` and `.option('--no-wizard', 'Force non-interactive mode (requires --title and --genre)')` to the `start` command registration. The action handler passes `options.wizard` and `options.noWizard` to `startCommand()`. |

`startWizard()` returns a fully populated `StartOptions` object. It does **not** call `startCommand()` or `projectRepo.create()` internally. All database writes remain in `startCommand()` so the wizard cannot bypass session recording, error handling, or the `DuplicateSlugError` catch block.

```typescript
// cli/src/commands/start-wizard.ts — public surface
export async function startWizard(prefill?: Partial<StartOptions>): Promise<StartOptions>;

// cli/src/commands/start.ts — modified startCommand() preamble (new lines only)
if (!options.title || !options.genre || options.wizard) {
  if (options.noWizard) {
    console.error(chalk.red('Error: --title and --genre are required in non-interactive mode.'));
    process.exit(1);
  }
  options = await startWizard(options);  // wizard returns fully populated StartOptions
}
// ... existing projectRepo.create() call unchanged
```

---

#### Key Requirements

- **Non-destructive passthrough**: When `--title` and `--genre` are both supplied and `--wizard` is not, the existing `startCommand()` code path runs without modification. No wizard overhead is incurred.
- **Pre-fill from CLI flags**: When `--wizard` is combined with other flags (e.g., `filmbuff start --wizard --genre thriller`), the wizard uses those flags as default values for the corresponding steps. The user can confirm with Enter or overwrite.
- **Single source of truth for project creation**: The wizard collects options and delegates to the existing `startCommand()`. The wizard never calls `projectRepo.create()` directly, never records sessions, and never handles `DuplicateSlugError` itself — those responsibilities remain in `startCommand()`.
- **Text-only provider filter**: Steps 11 and 12 must never present video-only providers (`lumaai`, `runway`, `stable-diffusion`). These providers cannot perform text generation and would cause a `ProviderCapabilityError` if selected for the `start` pipeline.
- **Graceful discovery failure**: If `ai-powered` discovery fails for any reason (not installed, misconfigured, file permission error), Steps 11 and 12 are silently skipped with a non-fatal yellow warning. The wizard does not abort.
- **Equivalent command display**: The confirmation panel must always display the syntactically correct, copy-pasteable equivalent `filmbuff start` command. Fields whose value is `undefined` are omitted from the command string. Style modules are expanded as separate `--style` flags.
- **Ctrl-C safety**: `ExitPromptError` is caught at the wizard boundary. No raw stack trace reaches the terminal. Exit code is 0 (user-initiated cancel, not an error).
- **No new npm dependencies**: All required libraries (`@inquirer/prompts`, `chalk`, `ora`) are already present.

---

### Acceptance Criteria

- `filmbuff start` with no arguments launches the interactive wizard. The wizard banner displays `FilmBuff New Project Wizard  1/12` on the first step.
- `filmbuff start --title "X" --genre drama` skips the wizard entirely and calls `startCommand()` directly with the existing code path. No wizard prompt is rendered. Exit code 0.
- `filmbuff start --wizard --title "X"` launches the wizard with Step 1 pre-filled to `"X"` (pressing Enter accepts it) and all remaining steps behaving normally.
- `filmbuff start --no-wizard --genre drama` (missing `--title`) exits with exit code 1 and prints `Error: --title and --genre are required in non-interactive mode.` No wizard prompt is rendered.
- Step 1 (Title) rejects empty input, input shorter than 3 characters, and input longer than 120 characters with inline red error messages and re-prompts the same step without advancing.
- Step 2 (Genre) normalises `sci fi` → `sci-fi`, `rom com` → `romantic-comedy`, and `romcom` → `romantic-comedy` before storing. Multi-genre input `comedy,drama` is accepted and stored as-is.
- Step 3 (Slug) pre-fills with the title-derived slug. Input that fails `/^[a-z0-9][a-z0-9-]+[a-z0-9]$/` produces an inline red error and re-prompts without advancing. If `ProjectRepository.findBySlug()` returns a match, a yellow warning is shown and the user is re-prompted before any database write.
- Steps 4, 5, 7, and 10 (Tone, Audience, Outcome, Style Modules) accept an empty Enter press as a valid skip, storing `undefined` for the corresponding `StartOptions` field.
- Step 6 (Budget) renders a `select` prompt with exactly five choices: `micro`, `low`, `mid`, `studio`, `(skip / not set)`. Selecting `(skip / not set)` stores `undefined` for `budget`.
- Steps 9a and 9b (Format and Detail) render `select` prompts with `md` pre-selected for format and `standard` pre-selected for detail level.
- Step 10 (Style Modules) collects zero or more module paths in a loop. When at least one path is entered, a follow-up `confirm` prompt asks whether to add another. All entered paths are stored as `style_modules: string[]`.
- Step 11 (AI Provider) shows an `ora` spinner labelled `Discovering configured AI providers…` during `loadConfig()`. The spinner stops before the select prompt renders. Video-only providers (`lumaai`, `runway`, `stable-diffusion`) are **not** present in the select choices under any circumstances.
- When no `ai-powered` provider is configured (fresh install), Step 11 pre-selects `mock` and displays the yellow advisory about configuring a real provider.
- When `loadConfig()` throws, Steps 11 and 12 are skipped entirely; a yellow warning is printed, and the wizard proceeds to the confirmation panel.
- Step 12 (AI Profile) is rendered only when the user selected a named provider in Step 11 (not `(use global default)`). The profile list is scoped to the selected provider.
- The confirmation panel displays all non-`undefined` fields in the tabular layout. `undefined` fields are replaced with `(not set)`.
- The confirmation panel displays the equivalent `filmbuff start` command with correct quoting and one `--style` flag per style module.
- Selecting `[E]dit` after declining re-enters the wizard from Step 1 with all values pre-filled. Pressing Enter on every step without modification produces the same confirmation panel and equivalent command.
- Selecting `[S]tart over` clears all collected values and restarts the wizard from Step 1 with no defaults.
- Selecting `[Q]uit` or pressing Ctrl-C at any step prints `Project creation cancelled.` and exits with code 0. No database row is written.
- `DuplicateSlugError` thrown by `ProjectRepository.create()` (caught in `startCommand()`) surfaces as `✗ A project with slug "<slug>" already exists.` The user is returned to Step 3. No other wizard step data is lost.
- `startWizard()` returns a `StartOptions` object. It does not call `projectRepo.create()`, `sessionRepo.recordSession()`, or `sessionRepo.completeSession()`. Database writes are verified to remain exclusively in `startCommand()`.
- `npx tsc --noEmit` exits clean after the three file changes. ESLint reports no errors on `start-wizard.ts`, `start.ts`, or `cli.ts`.
- Unit tests cover: slug derivation from title (five title inputs → five expected slugs); genre alias normalisation (four alias inputs → four expected normalised strings); wizard trigger logic (wizard fires when args absent; wizard suppressed when both required flags present; `--no-wizard` with missing title exits non-zero); Step 11 filter (video-only providers absent from returned choice list); confirmation panel equivalent-command formatting (two style modules → two `--style` flags; `undefined` fields omitted from command string).
- Integration test (`AI_MOCK=true`): simulate wizard input for all 12 steps via programmatic `@inquirer/prompts` answer injection; verify the resulting project row in the test database matches the supplied inputs; verify exit code 0.

---

### Estimated Effort

| Task | Hours |
|---|---|
| `cli/src/commands/start-wizard.ts` — Steps 1–6 prompts, validation, slug derivation | 4 |
| `cli/src/commands/start-wizard.ts` — Steps 7–10 prompts, style-module loop | 3 |
| `cli/src/commands/start-wizard.ts` — Steps 11–12 provider/profile discovery with `ora`, filter logic | 4 |
| `cli/src/commands/start-wizard.ts` — Confirmation panel, equivalent-command builder, Edit/Start Over/Quit loop | 3 |
| `cli/src/commands/start-wizard.ts` — Top-level `ExitPromptError` catch, discovery-failure fallback | 1 |
| `cli/src/commands/start.ts` — `wizard?: boolean` in `StartOptions`; wizard trigger preamble (6 lines) | 0.5 |
| `cli/src/cli.ts` — `--wizard` / `--no-wizard` option registration and action-handler wiring | 0.5 |
| Unit tests — slug derivation, genre normalisation, trigger logic, provider filter, command-string builder | 4 |
| Integration test — full 12-step wizard run with programmatic answer injection | 3 |
| **Total** | **23 hours** |

---

### Attachments

- Source specification: `ai-prompts/filmbuff-start-wizard.md`
- Primary file modified: `cli/src/commands/start.ts`
- CLI registration file modified: `cli/src/cli.ts`
- New implementation file: `cli/src/commands/start-wizard.ts` *(to be created)*
- Public interface type: `StartOptions` in `cli/src/commands/start.ts`
- Provider setup reference: `docs/PROVIDER_SETUP.md`
- Provider discovery entry point: `cli/src/utils/filmbuff-ai-client.ts` → `loadConfig()`
- AI status command (provider enumeration): `cli/src/commands/ai-status.ts`
- Database project creation: `cli/src/db/index.ts` → `ProjectRepository.create()` and `ProjectRepository.findBySlug()`
- Pipeline downstream consumer of `StartOptions.provider` / `StartOptions.profile`: `cli/src/commands/continue.ts`
- Genre blending spec (multi-genre examples): `ai-prompts/film-docs-JIRA.md § filmbuff start flags table`
- Provider abstraction architecture: `ai-prompts/ai-providers-JIRA.md`
- `ai-powered` credential configuration: `ai-prompts/ai-powered-not-local-JIRA.md § API Key Management`
