# JIRA Ticket: TBD - AI-Powered Narrative Document Pipeline for FilmBuff (`filmbuff start`)

### Summary
Introduce a sequential, AI-powered document generation pipeline to FilmBuff that takes a user's creative brief — or a single freeform `--prompt` seed — and produces every development artifact a commercial or narrative film project needs, from a one-sentence logline through a production-ready shot list, using the same configurable AI provider abstraction already powering `filmbuff generate-shot-list`. New commands `filmbuff start`, `filmbuff continue`, `filmbuff complete`, `filmbuff retry`, and `filmbuff status` drive the workflow. At every generation step the user is shown the new content in full and offered three choices — **accept**, **edit**, or **reject and retry** — so the pipeline never advances without explicit approval. Users can generate, review, override, resume, and inspect progress at any step without restarting from scratch.

### Description

#### Background
FilmBuff can already produce an AI-optimised shot list from a finished screenplay. What is missing is the pipeline that gets a project from the user's initial idea to that finished screenplay. Writers, directors, and commercial producers typically work through a structured sequence of documents — logline, synopsis, treatment, beat sheet, screenplay, shooting script, script breakdown, storyboards, shot list — each one building on the last. Generating those documents by hand is slow and expensive; generating them without continuity or creative context produces generic output that does not serve the project.

This ticket introduces an AI-powered pipeline that preserves creative context across every step, routes all generation through the user's already-configured provider/profile (Anthropic, OpenAI, Google AI, or any custom provider), and lets users guide, correct, and resume the workflow at any stage. The result should work equally well for narrative features, short films, episodic content, branded commercials, and social video.

Project state, generated document history, and generation attempt audit trails are persisted in the FilmBuff database layer (described in `ai-prompts/db-layer-prompt.md`) rather than in a single flat JSON file, so the pipeline survives crashes mid-generation, supports resumption across machines and sessions, and provides a complete provenance record for every accepted document. Provider configuration and active-selection state are managed by the configurable AI provider system described in `ai-prompts/ai-providers-JIRA.md`.

#### Key Requirements

**Workflow Commands and CLI Arguments**

`filmbuff start` — begin a new project pipeline. Prompts the user interactively for any required inputs not supplied via flags, then generates all documents in sequence.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--name <title>` | string | interactive | Project/film slug name used for state files and default output folder |
| `--title <title>` | string | same as `--name` | Display title of the film; may differ from the slug name |
| `--genre <genre[,genre...]>` | string | interactive | Primary genre of the film, or a comma-separated list of genres to blend. Valid values: `action`, `adventure`, `animation`, `biographical`, `comedy`, `commercial`, `documentary`, `drama`, `episodic`, `fantasy`, `historical`, `horror`, `musical`, `mystery`, `noir`, `romance`, `sci-fi`, `social`, `superhero`, `thriller`, `western`. When multiple genres are supplied the AI prioritises the **first genre** for tone, structure, and conventions, and layers subsequent genres as modifying influences. Examples: `"comedy,romance"` → romcom (*Knocked Up*); `"comedy,documentary"` → docu-comedy (*This Is Spinal Tap*); `"comedy,romance,drama"` → tragic romcom (*When Harry Met Sally*). |
| `--tone <description>` | string | interactive | Tone and stylistic direction (e.g. `"dark and gritty"`, `"light-hearted comedy"`) |
| `--audience <description>` | string | interactive | Target audience (e.g. `"adults 18-35"`, `"family-friendly"`) |
| `--budget <tier>` | string | interactive | Budget tier: `micro`, `low`, `mid`, `studio` — influences script breakdown and shot list recommendations |
| `--outcome <description>` | string | interactive | Desired creative or commercial outcome (e.g. `"festival submission"`, `"brand awareness campaign"`) |
| `--prompt <text>` | string | — | Freeform creative seed (a sentence or paragraph describing the story idea). When supplied, the AI generates the logline from this text rather than prompting the user interactively for it; the prompt is stored as foundational context for every downstream step. Cannot be combined with `--logline`. |
| `--logline <text>` | string | _(generated)_ | Pre-supply the logline text verbatim; skips step 1 generation entirely. Cannot be combined with `--prompt`. |
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

**Prompt-Seeded Entry Point**

`--prompt <text>` is an optional alternative starting point for the pipeline. It accepts a freeform sentence or paragraph — any natural-language description of the story idea, without requiring the user to have already formulated a logline. When supplied:

1. The prompt text is stored in project state (`.filmbuff/project.json` / database) as the foundational creative seed and is included as context in every subsequent AI generation call throughout the pipeline.
2. Step 1 (`logline.md`) is generated by the AI from the prompt text rather than being provided by the user interactively. The interactive logline prompt is suppressed entirely.
3. After the AI generates the logline, the standard per-step review flow begins: the generated logline is displayed in full, and the user is offered the accept / edit / reject-and-retry choice before the pipeline advances to step 2.
4. All subsequent steps proceed identically to a non-prompted run; the prompt text supplements (but does not replace) the logline and other accepted documents in the context window.

**Mutual exclusion rules for entry-point flags:**

| Combination | Behaviour |
|---|---|
| Neither `--prompt` nor `--logline` | Interactive: user is prompted to type or paste a logline; AI generates step 1 from it |
| `--prompt <text>` only | AI generates logline from prompt; per-step review begins at step 1 |
| `--logline <text>` only | Logline is accepted verbatim; step 1 is marked complete; per-step review begins at step 2 |
| `--input <file>` | Creative brief file populates all project fields; prompt/logline fields in the file follow the same rules as above |
| `--prompt` and `--logline` together | Error: "Cannot use --prompt and --logline together. Supply one or the other." |

**AI Provider Integration**
- All generation steps resolve the active provider/profile through `resolveActiveProvider()` (global active selection) or `resolveProviderByProfile(providerId, profileName)` (when `--ai-provider`/`--ai-profile` override flags are supplied). Both functions are implemented in `cli/src/utils/runtime-resolver.ts` and backed by `ProviderRepository` queries against `~/.filmbuff/global.db`. See `ai-prompts/ai-providers-JIRA.md` for the full provider abstraction specification.
- Each command must support `--ai-provider <id>` and `--ai-profile <name>` flags to override the active selection for that invocation only. When override flags are supplied the command calls `resolveProviderByProfile`; otherwise it calls `resolveActiveProvider`. The global active selection must not be mutated.
- An unrecognised provider ID or profile name causes the command to exit with a clear error before any generation begins.
- No pipeline step may hard-code a provider-specific implementation; all generation calls flow through the provider abstraction so future providers plug in without changes to pipeline command code.
- Every generation attempt records `provider_id`, `profile_name`, and `model_id` in `generation_attempts` so the audit trail captures exactly which AI backend produced each document.

**Context Preservation**
- Each generation step receives the full content of all previously accepted documents as context so the AI can maintain character names, tone, genre conventions, and plot consistency automatically.
- Context is stored in the FilmBuff database (`generation_attempts.context_document_ids` and the `context_snapshots` table) so `filmbuff continue` can restore it reliably after a break without reading from the filesystem. The database layer described in `ai-prompts/db-layer-prompt.md` replaces the earlier `.filmbuff/project.json` flat file for all project state storage.
- `filmbuff status` reconstructs the complete pipeline state from the database alone, without scanning the filesystem or requiring AI provider access.

**Database Persistence Requirements**

Project state, document history, and generation audit trails are persisted in the FilmBuff database layer (see `ai-prompts/db-layer-prompt.md`). Command handlers interact with the database exclusively through repository classes; no command may write raw `.filmbuff/project.json` files for project state.

`filmbuff start` calls:
```
ProjectRepository.create(input)
DocumentRepository.initializeSteps(projectId)     // seeds all 10 project_steps rows
SessionRepository.startSession(input)
```

`filmbuff continue` calls:
```
ProjectRepository.findBySlug(slug)
DocumentRepository.getStep(projectId, stepName)
DocumentRepository.recordAttempt(input)            // before AI call — output never lost on crash
DocumentRepository.recordContextSnapshot(input)    // captures assembled prompt context
// ... AI generation ...
DocumentRepository.acceptAttempt(attemptId, editedContent?)
DocumentRepository.updateStepStatus(id, 'completed', patch)
```

`filmbuff retry` calls:
```
DocumentRepository.getStep(projectId, stepName)
DocumentRepository.rejectAttempt(lastAttemptId)    // marks previous attempt rejected; never deleted
DocumentRepository.recordAttempt(input)            // new attempt; attempt_number incremented
```

`filmbuff status` calls:
```
ProjectRepository.findBySlug(slug)
DocumentRepository.getStep(projectId, '*')         // all 10 steps; no AI provider access
```

`filmbuff complete` calls:
```
DocumentRepository.getStep(projectId, stepName)
DocumentRepository.updateStepStatus(id, 'completed', { accepted_at: now() })
```

**Durability and resumability guarantees:**
- Every AI generation attempt is recorded in `generation_attempts` before the user review prompt, so a crash between generation and acceptance never loses the generated content.
- Every accepted document is stored in `document_revisions` with `is_current = 1`; all prior revisions and rejected attempts are retained indefinitely.
- `filmbuff continue` reconstructs the complete pipeline context from the database; no filesystem scan is required.
- The `context_snapshots` table captures the exact prompt context used for each generation attempt, enabling reproducible reruns and per-step cost analysis.

**User Control and Overrides — Per-Step Review Flow**

After every generation step, the full content of the newly generated document is printed to the terminal (or opened in a pager for long documents such as the screenplay). The user is then presented with an interactive prompt offering exactly three choices:

```
─────────────────────────────────────────────
  Step 1 of 10 — logline.md
─────────────────────────────────────────────
  [generated content displayed above]

  What would you like to do?
  ❯ (a) Accept — save this document and continue to the next step
    (e) Edit  — open in $EDITOR, then re-present for acceptance
    (r) Retry — discard and regenerate (optionally with new instructions)
─────────────────────────────────────────────
```

**Accept (`a`)**: The document is written to disk at the configured output path, its content is stored in project state as context for all downstream steps, and the pipeline immediately advances to the next step.

**Edit (`e`)**: The document is written to a temporary file and opened in the user's `$EDITOR` (falling back to `nano` on Unix and `notepad` on Windows if `$EDITOR` is not set). When the editor exits, the edited content is displayed in full and the three-choice prompt is re-presented. The user can accept the edited version, re-edit, or discard edits and retry with the AI. Edits are stored alongside the original AI output in project state so both versions are preserved.

**Retry (`r`)**: The generated document is discarded (marked `rejected` in project state; never deleted from history). The user is optionally prompted for additional instructions to guide the next attempt:

```
  Enter additional instructions for the AI (or press Enter to retry with the same prompt):
  > [user types here]
```

The AI regenerates the document — including any instructions — and the three-choice prompt is re-presented with the new output. Retry count for the step is incremented in project state. There is no hard limit on retries per step.

**`--no-interactive` mode**: Suppresses the per-step review prompt entirely. All generated documents are auto-accepted without display. This is intended for CI pipelines, batch generation, and scripted use cases where user review is not required.

**Additional override capabilities:**
- The user may override any generated value — project name, logline text, character names — before the pipeline advances, by accepting an edited version of the document.
- Output directory, file names, and per-document format (`.md`, `.json`, `.fountain`, `.pdf`) must be configurable, with sensible defaults.
- `filmbuff start --input <brief.md>` accepts a pre-written creative brief file to skip interactive setup prompts. All project fields (`--name`, `--genre`, `--tone`, `--audience`, `--budget`, `--outcome`) can be supplied as flags or entered interactively.

**Commercial and Narrative Support**
- Genre support must include all 21 supported genres: `action`, `adventure`, `animation`, `biographical`, `comedy`, `commercial`, `documentary`, `drama`, `episodic`, `fantasy`, `historical`, `horror`, `musical`, `mystery`, `noir`, `romance`, `sci-fi`, `social`, `superhero`, `thriller`, and `western`. Every genre maps to a dedicated rules file under `augment-extensions/writing-standards/screenplay/genres/rules/`, including the three production-format genres (`commercial`, `social`, `episodic`) which have their own primary rules files alongside the 18 narrative genres.
- Genres may be blended by supplying a comma-separated list to `--genre`. The AI loads the rules file for each genre in the list and applies them in priority order: the first genre governs primary structure, tone, and conventions; each additional genre is layered in as a modifying influence. There is no hard limit on the number of genres in a blend, but two or three is the practical maximum for coherent output. Examples: `comedy,romance` for a romcom, `comedy,documentary` for a docu-comedy, `comedy,romance,drama` for a tragic romcom with emotional depth.
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
- Creative context (tone, genre, characters, prior documents, and `--prompt` seed text) is preserved automatically across all steps.
- `--prompt <text>` is accepted as an optional flag on `filmbuff start`; when supplied, the AI generates the logline from the prompt text and the interactive logline prompt is not shown.
- The `--prompt` seed text is stored in project state and included as foundational context for every downstream generation step.
- Supplying both `--prompt` and `--logline` on the same command exits with a clear error message before any generation begins.
- When neither `--prompt` nor `--logline` is supplied, `filmbuff start` prompts the user interactively for a logline or creative brief before generating step 1.
- After every generation step (including the logline when generated from `--prompt`), the full generated content is displayed in the terminal and the user is presented with an interactive **accept / edit / retry** prompt before the pipeline advances.
- **Accept**: writes the document to disk, records it in project state as context, and advances to the next step.
- **Edit**: opens the document in `$EDITOR` (falling back to `nano` / `notepad`), re-displays the result, and re-presents the accept / edit / retry prompt.
- **Retry**: discards the current generation (records it as `rejected` in project state; never hard-deletes it), optionally collects new instructions from the user, regenerates, and re-presents the accept / edit / retry prompt.
- There is no hard limit on the number of retries per step; every rejected attempt is retained in project state for auditing.
- `--no-interactive` suppresses the per-step review prompt and auto-accepts all generated output; it does not suppress the `--prompt`-to-logline generation step.
- Users can override any generated document before the pipeline advances; edited content is stored alongside the original AI output.
- Output formats `.md`, `.json`, `.fountain`, and `.pdf` are supported per document type; `--format` overrides the default globally.
- `--detail` controls generation verbosity (`brief`, `standard`, `detailed`) for all documents in a run.
- `--steps`, `--skip`, and `--from` allow partial pipeline execution and targeted reruns.
- `--style` applies cinematic-style modules from the FilmBuff extension system to all generation prompts in a run.
- Genre modes cover all 21 supported values (`action`, `adventure`, `animation`, `biographical`, `comedy`, `commercial`, `documentary`, `drama`, `episodic`, `fantasy`, `historical`, `horror`, `musical`, `mystery`, `noir`, `romance`, `sci-fi`, `social`, `superhero`, `thriller`, `western`); the CLI rejects any unrecognised genre value with a clear error listing valid options.
- `--genre` accepts a comma-separated list of two or more genres to produce a hybrid genre; the first genre in the list is treated as the primary and drives document structure, tone, and conventions while subsequent genres add modifying influence. A single unrecognised value in a blended list causes the command to exit with an error before any generation begins.
- Budget tier (`--budget`) influences shot list and script breakdown recommendations.
- Project state is persisted in the FilmBuff database via `ProjectRepository`, `DocumentRepository`, and `SessionRepository`; no pipeline command writes raw `.filmbuff/project.json` files directly.
- Every AI generation attempt is written to `generation_attempts` before the user review prompt is shown; a crash between generation and acceptance does not lose the generated content.
- Accepted documents are stored in `document_revisions` with `is_current = 1`; all prior revisions and rejected attempts are retained indefinitely in the database.
- `filmbuff continue` reconstructs the complete pipeline context from the database alone, without reading from the filesystem.
- `resolveActiveProvider()` and `resolveProviderByProfile(providerId, profileName)` are the only provider-resolution entry points used by pipeline commands; no command contains provider-specific logic.
- Project state survives a restart so `filmbuff continue --from <step>` works reliably across sessions.
- `filmbuff retry --instructions <text>` allows refined AI guidance without restarting from step 1.
- `filmbuff status` reads project state exclusively from the database without requiring an AI provider and exits cleanly if no project is initialised.
- `filmbuff status` (default) prints a table of all 10 steps with their status symbol (✓ ➤ ✗ ○ —), output file path, and accepted-at timestamp.
- `filmbuff status --next` prints the step name, required inputs with current values, list of context documents, active provider/profile, and the exact `filmbuff continue` command needed to proceed.
- `filmbuff status --remaining` lists only incomplete steps in pipeline order.
- `filmbuff status --completed` lists only accepted steps with their output file paths and timestamps.
- `filmbuff status --all` shows full details for every step regardless of status.
- `filmbuff status --format json` outputs the raw project state suitable for scripting or CI integration.
- `filmbuff status [step]` / `--step <step>` shows step-level detail for any named or numbered step.
- All five commands expose `--help` for argument discovery.
- Documentation and automated tests cover `--prompt` entry-point behavior, per-step accept/edit/retry review flow, pipeline sequencing, context assembly, provider routing, argument validation, status reporting, override behavior, and retry/resume logic.

### Estimated Effort
- Design and Planning: 8 hours
- Pipeline State and Context Engine (database-backed): 12 hours
- Per-Step AI Generation and Prompt Engineering: 20 hours
- `--prompt` Entry Point and Logline Generation from Seed: 4 hours
- Per-Step Accept / Edit / Retry Review UX (including `$EDITOR` integration and inline instructions): 10 hours
- Status and Inspection Commands (`filmbuff status`): 6 hours
- Format Export (fountain, PDF, JSON): 8 hours
- Testing and Documentation: 12 hours
- Total: 80 hours

### Attachments
- Source prompt: `ai-prompts/film-docs-prompt.md`
- Provider integration reference: `ai-prompts/ai-providers-JIRA.md`
- Database layer specification: `ai-prompts/db-layer-prompt.md`
- Provider resolution migration ticket (replaces `profile-store.ts`, refactors `runtime-resolver.ts`): `ai-prompts/provider-resolution-JIRAt.md`
- AI provider runtime (refactored by `provider-resolution-JIRAt.md`): `cli/src/utils/runtime-resolver.ts`
- Existing shot-list pipeline: `cli/src/commands/generate-shot-list.ts`
- Style system: `cli/src/commands/generate-shot-list/style/`

