# JIRA Ticket: TBD - AI-Powered Narrative Document Pipeline for FilmBuff (`filmbuff start`)

### Summary
Introduce a sequential, AI-powered document generation pipeline to FilmBuff that takes a user's creative brief and produces every development artifact a commercial or narrative film project needs — from a one-sentence logline through a production-ready shot list — using the same configurable AI provider abstraction already powering `filmbuff generate-shot-list`. New commands `filmbuff start`, `filmbuff continue`, `filmbuff complete`, `filmbuff retry`, and `filmbuff status` drive the workflow so users can generate, review, override, resume, and inspect progress at any step without restarting from scratch.

### Description

#### Background
FilmBuff can already produce an AI-optimised shot list from a finished screenplay. What is missing is the pipeline that gets a project from the user's initial idea to that finished screenplay. Writers, directors, and commercial producers typically work through a structured sequence of documents — logline, synopsis, treatment, beat sheet, screenplay, shooting script, script breakdown, storyboards, shot list — each one building on the last. Generating those documents by hand is slow and expensive; generating them without continuity or creative context produces generic output that does not serve the project.

This ticket introduces an AI-powered pipeline that preserves creative context across every step, routes all generation through the user's already-configured provider/profile (Anthropic, OpenAI, Google AI, or any custom provider), and lets users guide, correct, and resume the workflow at any stage. The result should work equally well for narrative features, short films, episodic content, branded commercials, and social video.

#### Key Requirements

**Workflow Commands and CLI Arguments**

`filmbuff start` — begin a new project pipeline. Prompts the user interactively for any required inputs not supplied via flags, then generates all documents in sequence.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--name <title>` | string | interactive | Project/film slug name used for state files and default output folder |
| `--title <title>` | string | same as `--name` | Display title of the film; may differ from the slug name |
| `--genre <genre>` | string | interactive | Genre of the film: `drama`, `thriller`, `comedy`, `sci-fi`, `horror`, `documentary`, `commercial`, `social`, `episodic` |
| `--tone <description>` | string | interactive | Tone and stylistic direction (e.g. `"dark and gritty"`, `"light-hearted comedy"`) |
| `--audience <description>` | string | interactive | Target audience (e.g. `"adults 18-35"`, `"family-friendly"`) |
| `--budget <tier>` | string | interactive | Budget tier: `micro`, `low`, `mid`, `studio` — influences script breakdown and shot list recommendations |
| `--outcome <description>` | string | interactive | Desired creative or commercial outcome (e.g. `"festival submission"`, `"brand awareness campaign"`) |
| `--logline <text>` | string | _(generated)_ | Pre-supply the logline text; skips step 1 generation |
| `--synopsis <file>` | path | _(generated)_ | Path to a pre-written synopsis file; skips step 2 generation |
| `--treatment <file>` | path | _(generated)_ | Path to a pre-written treatment file; skips step 3 generation |
| `--input <file>` | path | — | Pre-written creative brief (`.md` or `.txt`); populates project fields and skips all interactive prompts |
| `--output <dir>` | path | `./output/<name>/` | Output directory for all generated files |
| `--format <format>` | string | per-document default | Global output format override: `md`, `json`, `fountain`, `pdf` |
| `--detail <level>` | string | `standard` | Generation detail level: `brief`, `standard`, `detailed` — applies to all documents |
| `--style <module-path>` | string | — | Cinematic style module path (repeatable); e.g. `writing-standards/screenplay/cinematic-styles/directors/kubrick` |
| `--steps <list>` | string | all | Comma-separated list of step names or numbers to run; all others are skipped (e.g. `logline,synopsis,beat-sheet`) |
| `--skip <step>` | string | — | Skip one named step (repeatable); e.g. `--skip storyboards` |
| `--from <step>` | string/int | `1` | Begin pipeline at a named step or step number `1`–`10` |
| `--no-interactive` | flag | false | Suppress per-step review prompts; auto-accept all generated output |
| `--ai-provider <id>` | string | active provider | Override the active AI provider (`anthropic`, `openai`, `google`, or a registered custom provider ID) |
| `--ai-profile <name>` | string | active profile | Override the active AI profile name |

---

`filmbuff continue` — resume the pipeline from the last successfully completed document, feeding accepted documents as context for subsequent steps.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--from <step>` | string/int | last completed | Resume from a specific named step or step number instead of the last completed one |
| `--output <dir>` | path | original value | Override the output directory for remaining steps |
| `--no-interactive` | flag | false | Auto-accept all remaining generated output without per-step review |
| `--ai-provider <id>` | string | active provider | Override the active AI provider for remaining steps |
| `--ai-profile <name>` | string | active profile | Override the active AI profile for remaining steps |

---

`filmbuff complete` — mark the current (or a specified) step as accepted and advance to the next step without regenerating.

| Flag / Arg | Type | Default | Description |
|------------|------|---------|-------------|
| `[step]` | string/int | current step | Positional: name or number (`1`–`10`) of the step to mark complete |
| `--step <step>` | string/int | current step | Alternative flag form; equivalent to the positional argument |

---

`filmbuff retry` — discard the last (or a specified) generated document and regenerate it, optionally with new instructions or a different provider.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--step <step>` | string/int | last step | Name or number of the step to retry (defaults to the most recently generated step) |
| `--instructions <text>` | string | — | Additional or replacement guidance passed to the AI for this retry attempt |
| `--ai-provider <id>` | string | active provider | Override the active AI provider for this retry |
| `--ai-profile <name>` | string | active profile | Override the active AI profile for this retry |

---

`filmbuff status` — display the current state of the pipeline: all steps with their completion status, the active step, remaining steps, and all context and inputs required to run the next step. Reads from the project state file (`.filmbuff/project.json`) and requires no AI provider access.

| Flag / Arg | Type | Default | Description |
|------------|------|---------|-------------|
| `[step]` | string/int | — | Positional: show full details for a specific step by name or number (`1`–`10`) |
| `--step <step>` | string/int | — | Alternative flag form; equivalent to the positional argument |
| `--next` | flag | false | Show only the next incomplete step — its name, required inputs, context documents needed, AI provider in use, and the exact `filmbuff continue` command to run it |
| `--remaining` | flag | false | List only the steps that have not yet been completed, in order |
| `--completed` | flag | false | List only the steps that have been marked complete, with their output file paths and accepted-at timestamps |
| `--all` | flag | false | Show full details for every step: status, output file path, accepted-at timestamp, and the context it contributes to downstream steps |
| `--project <dir>` | path | CWD | Path to the project directory containing `.filmbuff/project.json`; useful when running from outside the project folder |
| `--format <format>` | string | `table` | Output format: `table` (default terminal view), `json` (machine-readable state dump), `md` (markdown report) |

**Step status indicators shown in `table` output:**

| Symbol | Meaning |
|--------|---------|
| `✓` | Completed — output file accepted and written |
| `➤` | In progress — generation started but not yet accepted |
| `✗` | Failed — last generation attempt errored |
| `○` | Pending — not yet started |
| `—` | Skipped — explicitly skipped via `--skip` |

**`--next` output includes:**
- Step number, name, and output filename
- Required project-level inputs (e.g. genre, tone, budget) with their current values
- List of prior documents used as AI context for this step, with their file paths
- Active AI provider ID and profile name
- The exact command to run the step: e.g. `filmbuff continue --from screenplay`

**Document Pipeline — Sequential Steps**
1. `logline.md` — one-sentence premise, conflict, and hook
2. `synopsis.md` — 1-to-2 page plot and character summary
3. `treatment.md` — 5-to-20 page narrative prose with tone, arc, and character detail; no dialogue
4. `beat-sheet.json` — structured act/scene/beat breakdown used as the scripting roadmap
5. `screenplay.fountain` — full scripted document with dialogue, action, and scene headings
6. `shooting-script.fountain` — production-ready screenplay with scene numbers, technical notes, and revision marks
7. `script-breakdown.md` — element inventory: locations, props, cast, costumes, VFX, practical effects
8. `storyboards.pdf` — ordered visual frame sequence for each key shot
9. `shot-list.md` / `shot-list.json` — detailed shot inventory produced via the existing `generate-shot-list` subsystem
10. `final-screenplay.md` — clean final draft consolidated from all revisions

**AI Provider Integration**
- All generation steps resolve the active provider/profile through the same `resolveActiveProvider` / `resolveProviderByProfile` runtime resolver used by `generate-shot-list`.
- Each command must support `--ai-provider` and `--ai-profile` flags to override the active selection per run.
- No step should hard-code a provider; the abstraction must remain clean so future providers plug in without changes to the pipeline.

**Context Preservation**
- Each generation step receives the full content of all previously accepted documents as context so the AI can maintain character names, tone, genre conventions, and plot consistency automatically.
- Context is stored in a project state file (e.g. `.filmbuff/project.json`) so `filmbuff continue` can restore it reliably after a break.

**User Control and Overrides**
- After each generation step the user is shown the output and offered the options: accept, edit, retry with new instructions, or skip.
- The user may override any generated value — project name, logline text, character names — before the pipeline advances.
- Output directory, file names, and per-document format (`.md`, `.json`, `.fountain`, `.pdf`) must be configurable, with sensible defaults.
- `filmbuff start --input <brief.md>` accepts a pre-written creative brief file to skip interactive setup prompts. All project fields (`--name`, `--genre`, `--tone`, `--audience`, `--budget`, `--outcome`) can be supplied as flags or entered interactively.

**Commercial and Narrative Support**
- Genre support must include narrative (drama, thriller, comedy, sci-fi, horror), documentary, branded commercial, social/short-form video, and episodic/series formats.
- Tone and style options should map to the cinematic-style modules already in the FilmBuff extension system so directors and franchise styles can be applied to generation prompts.
- Budget-tier input (micro, low, mid, studio) should influence what the script breakdown and shot list recommend as practical versus ambitious.

**Output Formats**
- Each document must be exportable in the format appropriate to its type: `.md` for prose documents, `.json` for structured data, `.fountain` for scripts, `.pdf` for storyboards and final deliverables.
- `filmbuff start --format pdf` converts all compatible documents to PDF at the end of the pipeline. Per-document format defaults remain in effect when no global `--format` is supplied.

**Testing and Documentation**
- Unit tests for project state persistence, context assembly, provider resolution per step, and retry/resume logic.
- Integration tests that walk the pipeline end-to-end with a mock AI adapter.
- User documentation covering setup, creative inputs, per-step review, provider selection, format options, and resume behavior.

### Acceptance Criteria
- `filmbuff start` prompts for creative inputs and generates all ten pipeline documents in sequence using the active AI provider.
- `filmbuff continue` resumes from the last accepted document without losing creative context.
- `filmbuff complete` and `filmbuff retry` advance or regenerate individual steps reliably.
- All generation steps use the shared provider abstraction (`resolveActiveProvider`) and respect `--ai-provider` / `--ai-profile` overrides on every command.
- Creative context (tone, genre, characters, prior documents) is preserved automatically across all steps.
- Users can override any generated document before the pipeline advances; `--no-interactive` auto-accepts all output.
- Output formats `.md`, `.json`, `.fountain`, and `.pdf` are supported per document type; `--format` overrides the default globally.
- `--detail` controls generation verbosity (`brief`, `standard`, `detailed`) for all documents in a run.
- `--steps`, `--skip`, and `--from` allow partial pipeline execution and targeted reruns.
- `--style` applies cinematic-style modules from the FilmBuff extension system to all generation prompts in a run.
- Genre modes cover narrative, documentary, branded commercial, social/short-form, and episodic content.
- Budget tier (`--budget`) influences shot list and script breakdown recommendations.
- Project state survives a restart so `filmbuff continue --from <step>` works reliably across sessions.
- `filmbuff retry --instructions <text>` allows refined AI guidance without restarting from step 1.
- `filmbuff status` reads the project state file without requiring an AI provider and exits cleanly if no project is initialised.
- `filmbuff status` (default) prints a table of all 10 steps with their status symbol (✓ ➤ ✗ ○ —), output file path, and accepted-at timestamp.
- `filmbuff status --next` prints the step name, required inputs with current values, list of context documents, active provider/profile, and the exact `filmbuff continue` command needed to proceed.
- `filmbuff status --remaining` lists only incomplete steps in pipeline order.
- `filmbuff status --completed` lists only accepted steps with their output file paths and timestamps.
- `filmbuff status --all` shows full details for every step regardless of status.
- `filmbuff status --format json` outputs the raw project state suitable for scripting or CI integration.
- `filmbuff status [step]` / `--step <step>` shows step-level detail for any named or numbered step.
- All five commands expose `--help` for argument discovery.
- Documentation and automated tests cover pipeline sequencing, context assembly, provider routing, argument validation, status reporting, override behavior, and retry/resume logic.

### Estimated Effort
- Design and Planning: 8 hours
- Pipeline State and Context Engine: 10 hours
- Per-Step AI Generation and Prompt Engineering: 20 hours
- User Override and Review UX: 8 hours
- Status and Inspection Commands (`filmbuff status`): 6 hours
- Format Export (fountain, PDF, JSON): 8 hours
- Testing and Documentation: 10 hours
- Total: 70 hours

### Attachments
- Source prompt: `ai-prompts/film-docs-prompt.md`
- Provider integration reference: `ai-prompts/ai-providers-JIRA.md`
- AI provider runtime: `cli/src/utils/runtime-resolver.ts`
- Existing shot-list pipeline: `cli/src/commands/generate-shot-list.ts`
- Style system: `cli/src/commands/generate-shot-list/style/`

