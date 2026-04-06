# JIRA Ticket: TBD - Shot List Enhancement: Character & Location Registries, Cast Report, Manual Step Workflow, and Pipeline Restructure

### Summary
Insert a new `cast-and-casting` pipeline step immediately after `treatment` (new step 4) that extracts character and location registries directly from the treatment document. Introduce a **manual-by-default** step-transition workflow where `filmbuff continue` pauses after each step so the user can review, edit, and approve output before proceeding. Extend `filmbuff generate-shot-list` (now pipeline step 10) to consume the registries established in `cast-and-casting` and emit them in its output with `age` and `actor` fields. Update `filmbuff start` and `filmbuff continue` accordingly. The fully automated pipeline mode is preserved behind an `--auto` flag.

### Description

#### Background
The existing pipeline advances from step to step without pausing, giving users no structured opportunity to review or fine-tune the generated content before downstream steps consume it. Additionally, character and location data has no dedicated extraction point early in the pipeline — users who want to populate a cast breakdown must either manually compile data from individual shot entries or wait until the very end of the process.

This work restructures the pipeline to be **manual by default**: after each step completes, `filmbuff continue` stops and waits for the user to review, edit, and explicitly approve the generated file before moving on. It also inserts `cast-and-casting` as step 4 (immediately after `treatment`), where character names and location names are extracted from the treatment narrative. The user can refine this data by editing the treatment and re-running extraction, or by directly editing the `cast-and-casting` report. Once satisfied, they advance to `beat-sheet`. The shot-list step (now step 10) consumes the pre-established registry data rather than building it from scratch. The `final-screenplay` step becomes step 11.

#### New 11-Step Pipeline

| Step | Name | Source Input |
|------|------|-------------|
| 1 | `logline` | Project metadata |
| 2 | `synopsis` | Logline |
| 3 | `treatment` | Synopsis |
| **4** | **`cast-and-casting`** | **Treatment** ← NEW |
| 5 | `beat-sheet` | Treatment + cast-and-casting |
| 6 | `screenplay` | Beat-sheet |
| 7 | `shooting-script` | Screenplay |
| 8 | `script-breakdown` | Shooting script |
| 9 | `storyboards` | Script breakdown |
| 10 | `shot-list` | Storyboards + cast-and-casting registry |
| 11 | `final-screenplay` | Shot list |

#### Manual-by-Default Workflow

By default, `filmbuff continue` executes **one step at a time** and then stops with a prompt:

```
✔ Step 4 complete: cast-and-casting
  Output: screenplay/my-project/cast-and-casting.md

Review and edit the output file, then run:
  filmbuff continue --project my-project

To run all remaining steps without pausing, use:
  filmbuff continue --project my-project --auto
```

The user edits the file as needed, then reruns `filmbuff continue` to advance to step 5. Running with `--auto` restores the original fully automated behavior.

#### Proposed Changes

**1. New TypeScript Types (`cli/src/commands/generate-shot-list/generator/types.ts`)**

Add `CharacterRegistryEntry` and `LocationRegistryEntry` interfaces and extend `ShotList` with optional `characterRegistry` and `locationRegistry` arrays. Extend `CharacterState` with optional `age` (number, default `0`) and `actor` (string, default `""`) fields.

**2. New Pipeline Step 4: `cast-and-casting` (extracts from treatment)**

- Add `'cast-and-casting'` to `PipelineStepName` in `cli/src/db/types.ts` as step 4, shifting `beat-sheet` through `final-screenplay` to steps 5–11.
- Update all database migration SQL files and seed data to enumerate 11 steps in the new order.
- Create `cli/src/commands/cast-and-casting.ts`. This command:
  - Accepts `--input <treatment-file>` (path to the `.md` treatment produced in step 3) **or** `--project <slug>` to read from the project database.
  - Sends the treatment text to the AI to extract all named characters and location headings, producing structured JSON for both registries.
  - Generates `cast-and-casting.md` in the project's screenplay directory. The report contains a `## Cast` GFM table (`Character`, `Description`, `Age`, `Actor`, `Photo`) and a `## Locations` GFM table (`Location`, `INT/EXT`, `Description`, `Reference`), with user-populated columns left intentionally blank.
  - Also writes `cast-and-casting.json` containing the `characterRegistry` and `locationRegistry` arrays for consumption by downstream steps.
- Register the command in `cli/src/cli.ts` with `--input` (mutually exclusive with `--project`), `--output` (optional), and `--project` (optional) options.

**User editing options at step 4:** The user may refine the cast-and-casting output in two ways — both are valid:
- Edit the **treatment** (step 3 output) and rerun `filmbuff cast-and-casting --project <slug>` to regenerate the report.
- Directly edit the **`cast-and-casting.md`** or **`cast-and-casting.json`** report to add, remove, or correct entries.

**3. Manual-by-Default Step Workflow (`cli/src/commands/continue.ts`)**

`filmbuff continue` currently runs all remaining steps in sequence. Change the default behavior to **run one step at a time** and stop after each step completes:

1. Execute the next pending step.
2. Print the step completion summary and the path to the generated output file.
3. Print instructions for reviewing the file and rerunning `filmbuff continue` to advance.
4. Exit (do not run the following step automatically).

Add an `--auto` flag that restores the original fully automated behavior (run all remaining steps without pausing).

At the `cast-and-casting` step specifically, after generating the report, also display:

```
Review and edit cast-and-casting.md as needed.
  - To regenerate from an edited treatment: filmbuff cast-and-casting --project <slug>
  - To edit the report directly: open cast-and-casting.md in your editor
When satisfied, run: filmbuff continue --project <slug>
```

**4. Registry Consumption in the Shot List Generator (`cli/src/commands/generate-shot-list/generator/index.ts`)**

At the start of `generate()`, check whether a `cast-and-casting.json` file exists in the project directory. If it does, load its `characterRegistry` and `locationRegistry` arrays and use them to pre-populate the registries (including any user-entered `age`, `actor`, and `photoUrl` values) rather than building them from scratch. Supplement with any characters or locations found in the shot list that are not already in the registry.

**5. Markdown Formatter Updates (`cli/src/commands/generate-shot-list/formatter/markdown-formatter.ts`)**

Insert `## Characters` and `## Locations` GFM pipe-table sections between `## Summary` and `## Shot List`. Replace the current freeform per-shot character block with a GFM table that includes `Age` and `Actor` columns. All tables must conform to standard GFM pipe-table syntax for compatibility with markdown table editors (e.g., the `Markdown Table` or `md-table-editor` VS Code extensions).

**6. JSON, JSONL, and CSV Formatter Updates**

Add `age` and `actor` to each character object in per-shot output. Include `characterRegistry` and `locationRegistry` as top-level arrays in JSON and JSONL output. Add `characterAge` and `characterActor` columns to CSV output.

**7. JSON Schema Updates (both schema files)**

Add `age` and `actor` to the `characterState` definition. Add `characterRegistry` and `locationRegistry` as optional top-level properties with corresponding `definitions` entries.

**8. `filmbuff start` Updates**

After collecting `title`, `genre`, `tone`, `target audience`, `budget tier`, and `outcome`, prompt: `"Would you like to enter cast information for main characters now? [y/N]"`. If yes, loop through character name → age → actor name → photo URL entry until the user declines to add more. Store initial cast data on the project record as `initial_cast_json`. If no, print: `"Cast information can be added later using 'filmbuff continue --project <slug>' after step 3 (treatment) is completed."`.

**9. Eval and Documentation Updates**

- Create `evals/steps/04-cast-and-casting.yaml` with tests verifying: the cast report contains `Character`, `Description`, `Age`, `Actor`, `Photo` columns; the locations table contains `Location`, `INT/EXT`, `Description`, `Reference` columns; all named characters from the treatment appear in the report; `cast-and-casting.json` is produced alongside the markdown.
- Renumber existing eval files: `04-beat-sheet.yaml` → `05`, `05-screenplay.yaml` → `06`, and so on through `10-final-screenplay.yaml` → `11`.
- Update `evals/steps/10-shot-list.yaml` (formerly `09`) to assert `characterRegistry` and `locationRegistry` are present and that user-entered `age`/`actor` values from `cast-and-casting.json` are reflected.
- Update `evals/promptfooconfig.yaml` imports to match the new numbering.
- Update `cli/src/commands/generate-shot-list/help-text.ts`, `docs/CLI_REFERENCE.md`, and `docs/FILM_PIPELINE.md` to document the new registries, the `filmbuff cast-and-casting` command, the manual-by-default workflow, and the updated 11-step pipeline.

#### Integration Points

| File | Change |
|------|--------|
| `cli/src/commands/generate-shot-list/generator/types.ts` | Add `CharacterRegistryEntry`, `LocationRegistryEntry`; extend `ShotList` and `CharacterState` |
| `cli/src/commands/generate-shot-list/generator/index.ts` | Load registry from `cast-and-casting.json` if present; supplement from shot data |
| `cli/src/commands/generate-shot-list/formatter/markdown-formatter.ts` | Emit registry tables; convert per-shot character blocks to GFM tables |
| `cli/src/commands/generate-shot-list/formatter/json-formatter.ts` | Add `age`, `actor`, `characterRegistry`, `locationRegistry` |
| `cli/src/commands/generate-shot-list/formatter/jsonl-formatter.ts` | Same as JSON formatter |
| `cli/src/commands/generate-shot-list/formatter/csv-formatter.ts` | Add `characterAge`, `characterActor` columns |
| `cli/src/commands/generate-shot-list/schema/shot-list.schema.json` | Add new types and fields |
| `evals/schemas/shot-list.schema.json` | Same as internal schema |
| `cli/src/db/types.ts` | Add `cast-and-casting` as step 4; renumber `beat-sheet`–`final-screenplay` to steps 5–11 |
| `cli/src/commands/cast-and-casting.ts` | New command: extracts registries from treatment, writes `.md` + `.json` (create file) |
| `cli/src/commands/continue.ts` | Add manual-by-default single-step workflow; add `--auto` flag |
| `cli/src/cli.ts` | Register `cast-and-casting` command; update `start` cast prompt message |
| `cli/src/commands/generate-shot-list/help-text.ts` | Document new output sections and registry source |
| `evals/steps/04-cast-and-casting.yaml` | New eval file (create) |
| `evals/steps/05-beat-sheet.yaml` – `evals/steps/11-final-screenplay.yaml` | Renumber from 04–10 |
| `evals/steps/10-shot-list.yaml` | Add registry assertions; assert user-entered values carry through |
| `evals/promptfooconfig.yaml` | Update step imports to new numbering |
| `docs/CLI_REFERENCE.md` | Document `filmbuff cast-and-casting`; document `--auto` flag on `continue` |
| `docs/FILM_PIPELINE.md` | Document 11-step pipeline, step 4 placement, and manual workflow |

#### Future Integration Note
The `photoUrl` field on `CharacterRegistryEntry` and the `links` field on `LocationRegistryEntry` are forward-compatible inputs for a planned integration with an AI video generation service. A candidate library is available at `https://github.com/mytech-today-now/ai-powered`. No video generation code is in scope for this ticket; the registry data structures introduced here are the only prerequisite.

### Acceptance Criteria
- `filmbuff cast-and-casting --project <slug>` (or `--input <treatment.md>`) reads the treatment, extracts named characters and scene locations via AI, and generates both `cast-and-casting.md` (GFM tables) and `cast-and-casting.json` (structured registries) in the project directory.
- The `cast-and-casting.md` `## Cast` table contains columns `Character`, `Description`, `Age`, `Actor`, `Photo`; `## Locations` contains `Location`, `INT/EXT`, `Description`, `Reference`. User-populated columns are blank.
- Editing the treatment and rerunning `filmbuff cast-and-casting` updates the report; directly editing the report file is also supported and preserved by downstream steps.
- `filmbuff continue --project <slug>` (default, no flags) runs exactly one pending step, then stops and prints review instructions. It does not run the following step.
- `filmbuff continue --project <slug> --auto` runs all remaining steps in sequence without pausing (original behavior).
- `filmbuff generate-shot-list` (step 10) loads `cast-and-casting.json` when present and pre-populates the character and location registries, including any user-entered `age`, `actor`, and `photoUrl` values.
- `filmbuff generate-shot-list --format md` emits `## Characters` and `## Locations` GFM tables between `## Summary` and `## Shot List`; per-shot character tables include `Age` and `Actor` columns.
- `filmbuff generate-shot-list --format json` includes `characterRegistry` and `locationRegistry` at the top level.
- `filmbuff start` prompts `"Would you like to enter cast information for main characters now? [y/N]"` after project metadata collection; if no, prints guidance pointing to step 3 (treatment).
- `PipelineStepName` in `cli/src/db/types.ts` includes `'cast-and-casting'` as step 4; `final-screenplay` is step 11 in all code and migrations.
- Both JSON schema files validate `characterRegistry` and `locationRegistry`.
- All generated markdown tables conform to GFM pipe-table syntax and are editable with standard markdown table editor extensions.
- All existing tests pass without modification (no regression).

### Estimated Effort
- Type definitions and schema updates: 2 hours
- `cast-and-casting` command (AI extraction from treatment, `.md` + `.json` output, CLI registration): 5 hours
- Registry consumption in shot-list generator: 2 hours
- Markdown formatter (registry tables + per-shot character tables): 3 hours
- JSON, JSONL, and CSV formatter updates: 2 hours
- Manual-by-default `filmbuff continue` + `--auto` flag: 3 hours
- `filmbuff start` cast prompt flow: 1 hour
- Database migration update (11 steps, new ordering): 2 hours
- Eval file updates, renumbering, and new step-4 eval: 3 hours
- Help text and documentation: 2 hours
- Tests: 4 hours
- **Total: 29 hours**

### Attachments
- Source prompt: `ai-prompts/shot-list-update.md`
- Generator types: `cli/src/commands/generate-shot-list/generator/types.ts`
- Generator entry point: `cli/src/commands/generate-shot-list/generator/index.ts`
- Markdown formatter: `cli/src/commands/generate-shot-list/formatter/markdown-formatter.ts`
- JSON formatter: `cli/src/commands/generate-shot-list/formatter/json-formatter.ts`
- JSONL formatter: `cli/src/commands/generate-shot-list/formatter/jsonl-formatter.ts`
- CSV formatter: `cli/src/commands/generate-shot-list/formatter/csv-formatter.ts`
- Internal schema: `cli/src/commands/generate-shot-list/schema/shot-list.schema.json`
- Eval schema: `evals/schemas/shot-list.schema.json`
- DB types: `cli/src/db/types.ts`
- Continue command: `cli/src/commands/continue.ts`
- CLI entry point: `cli/src/cli.ts`
- Step 10 eval (shot-list, formerly step 9): `evals/steps/10-shot-list.yaml`
- Promptfoo master config: `evals/promptfooconfig.yaml`
- Pipeline documentation: `docs/FILM_PIPELINE.md`
- CLI reference: `docs/CLI_REFERENCE.md`

