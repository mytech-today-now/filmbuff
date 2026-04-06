# Shot List Enhancement — AI Code Generation Prompt

## Purpose

This prompt instructs Augment Code AI to implement a set of related enhancements to the `filmbuff`
CLI. The changes extend the `generate-shot-list` command (pipeline step 9), add a new pipeline step
10 (`cast-and-casting`), and update the `filmbuff continue` and `filmbuff start` commands to
support cast and location management. Implement all changes described below across every affected
file. Do not implement partial changes.

---

## Codebase Context

Before making any edits, read the following key files to understand the existing structure:

| File | Purpose |
|------|---------|
| `cli/src/commands/generate-shot-list.ts` | Main command handler for `filmbuff generate-shot-list` |
| `cli/src/commands/generate-shot-list/generator/types.ts` | `Shot`, `ShotList`, `CharacterState`, `ShotMetadata` interfaces |
| `cli/src/commands/generate-shot-list/generator/index.ts` | `ShotListGenerator` class — produces the `ShotList` object |
| `cli/src/commands/generate-shot-list/formatter/markdown-formatter.ts` | Markdown output formatter |
| `cli/src/commands/generate-shot-list/formatter/json-formatter.ts` | JSON output formatter |
| `cli/src/commands/generate-shot-list/formatter/jsonl-formatter.ts` | JSONL output formatter |
| `cli/src/commands/generate-shot-list/formatter/csv-formatter.ts` | CSV output formatter |
| `cli/src/commands/generate-shot-list/schema/shot-list.schema.json` | Internal JSON Schema for shot list validation |
| `evals/schemas/shot-list.schema.json` | Promptfoo eval JSON Schema |
| `cli/src/db/types.ts` | `PipelineStepName` union type and all DB row interfaces |
| `cli/src/commands/continue.ts` | `filmbuff continue` command handler |
| `cli/src/cli.ts` | CLI entry point — all command registrations |
| `evals/steps/09-shot-list.yaml` | Promptfoo eval for step 9 |
| `evals/promptfooconfig.yaml` | Promptfoo master config — imports all step evals |

The existing 10-step pipeline is: `logline → synopsis → treatment → beat-sheet → screenplay →
shooting-script → script-breakdown → storyboards → shot-list → final-screenplay`. After this change
the pipeline will have **11 steps**, with `cast-and-casting` inserted as step 10 and
`final-screenplay` becoming step 11.

---

## Requirement 1 — Add `CharacterRegistry` and `LocationRegistry` to `ShotList`

### 1.1 New Types (add to `cli/src/commands/generate-shot-list/generator/types.ts`)

```typescript
/** A single entry in the document-level character registry. */
export interface CharacterRegistryEntry {
  name: string;           // Character name as it appears in the screenplay (uppercase)
  description: string;    // AI-extracted description aggregated from all shots
  age: number;            // Default: 0. User-populated.
  actor: string;          // Default: "". User-populated.
  photoUrl: string;       // Default: "". User-populated URL to actor photo.
  links: string[];        // Default: []. User-populated reference URLs.
}

/** A single entry in the document-level location registry. */
export interface LocationRegistryEntry {
  name: string;           // Location name as extracted from scene headings (e.g. "MEMORY FORENSICS LAB")
  intExt: 'INT' | 'EXT' | 'INT/EXT';  // Interior/Exterior classification
  description: string;    // AI-extracted description aggregated from all shots in that location
  links: string[];        // Default: []. User-populated reference URLs (e.g., location scout photos).
}
```

### 1.2 Extend `ShotList` (in `cli/src/commands/generate-shot-list/generator/types.ts`)

Add two new optional fields to the existing `ShotList` interface:

```typescript
characterRegistry?: CharacterRegistryEntry[];
locationRegistry?: LocationRegistryEntry[];
```

### 1.3 Extend `CharacterState` (in `cli/src/commands/generate-shot-list/generator/types.ts`)

Add two new optional fields to the existing `CharacterState` interface:

```typescript
age?: number;    // Mirrors the value from the CharacterRegistry; default 0
actor?: string;  // Mirrors the value from the CharacterRegistry; default ""
```

---

## Requirement 2 — Populate Registries in the Generator

In `cli/src/commands/generate-shot-list/generator/index.ts`, after the shot list is fully
assembled (at the end of the `generate()` method), build both registries by scanning all shots:

**Character Registry construction:**
- Collect every unique `CharacterState.name` across all shots (case-insensitive deduplication,
  store in the canonical uppercase form used in the screenplay).
- For each unique character, concatenate and deduplicate all `physicalAppearance`, `wardrobe`, and
  `emotion` fragments observed across shots to form the `description`.
- Set `age: 0`, `actor: ""`, `photoUrl: ""`, `links: []` as defaults.
- Sort the registry alphabetically by `name`.

**Location Registry construction:**
- Collect every unique `heading.location` from all shots (case-insensitive deduplication).
- For each unique location, collect the first non-empty `context.atmosphere` or `context.set`
  description seen across all shots for that location.
- Preserve the `intExt` value from the first occurrence of the heading.
- Set `links: []` as default.
- Sort the registry alphabetically by `name`.

Attach the completed registries to the returned `ShotList` object.

---

## Requirement 3 — Update the Markdown Formatter

In `cli/src/commands/generate-shot-list/formatter/markdown-formatter.ts`, update the `format()`
method to emit two new sections immediately after the `## Summary` block and before `## Shot List`.

### 3.1 Character Registry Table

Emit a `## Characters` section containing a standard GFM markdown table:

```markdown
## Characters

| Name | Description | Age | Actor | Photo URL | Links |
|------|-------------|-----|-------|-----------|-------|
| MARA VOSS | Detective with sharp eyes, mid-30s build | 0 |  |  |  |
| DIRECTOR | AI overseer entity, no physical form | 0 |  |  |  |
```

- The `Age` column defaults to `0` when unknown.
- The `Actor`, `Photo URL`, and `Links` columns default to empty strings.
- The table must use pipe-delimited GFM format so it is directly editable with any markdown
  table editor (e.g., the `Markdown Table` or `md-table-editor` VS Code extensions).

### 3.2 Location Registry Table

Emit a `## Locations` section:

```markdown
## Locations

| Location | INT/EXT | Description | Links |
|----------|---------|-------------|-------|
| MEMORY FORENSICS LAB | INT | Holographic displays, flickering lights | |
| MEGACORP HEADQUARTERS | EXT | Glass tower, urban street level | |
```

### 3.3 Per-Shot Character Table

In `formatShot()`, replace the current freeform character output block with a GFM table per shot
that includes the `Age` and `Actor` columns alongside the existing fields:

```markdown
| Character | Age | Actor | Position | Appearance | Wardrobe | Emotion | Action |
|-----------|-----|-------|----------|------------|----------|---------|--------|
| MARA VOSS | 0   |       | Center frame | Sharp eyes, weathered jacket | Trench coat | Determined | Studies holographic display |
```


---

## Requirement 4 — Update JSON, JSONL, and CSV Formatters

### 4.1 JSON and JSONL Formatters

In `json-formatter.ts` and `jsonl-formatter.ts`, add `age` and `actor` to each character object in
the `characters` array of each shot:

```json
{
  "name": "MARA VOSS",
  "age": 0,
  "actor": "",
  "position": "...",
  "appearance": "..."
}
```

Also include `characterRegistry` and `locationRegistry` as top-level arrays on the output object,
mirroring the structure of `CharacterRegistryEntry` and `LocationRegistryEntry`.

### 4.2 CSV Formatter

In `csv-formatter.ts`, add `characterAge` and `characterActor` columns to the per-shot character
output. Because CSV cannot represent nested arrays, serialize each character's registry entry as
separate columns named `characterAge_<name>` and `characterActor_<name>`, or — more simply — emit
a separate CSV section header row for the character registry above the shot rows.

---

## Requirement 5 — Update JSON Schemas

Update both schema files to reflect the new fields:

**`cli/src/commands/generate-shot-list/schema/shot-list.schema.json`** and
**`evals/schemas/shot-list.schema.json`**:

- Add `age` (`integer`, minimum 0, default 0) and `actor` (`string`, default `""`) to the
  `characterState` definition.
- Add `characterRegistry` (`array` of `characterRegistryEntry` objects) as an optional top-level
  property on the root schema.
- Add `locationRegistry` (`array` of `locationRegistryEntry` objects) as an optional top-level
  property on the root schema.
- Define `characterRegistryEntry` and `locationRegistryEntry` in the `definitions` section.

---

## Requirement 6 — New Pipeline Step 10: `cast-and-casting`

### 6.1 Update `PipelineStepName` in `cli/src/db/types.ts`

Change the union type from 10 values to 11 values:

```typescript
export type PipelineStepName =
  | 'logline'
  | 'synopsis'
  | 'treatment'
  | 'beat-sheet'
  | 'screenplay'
  | 'shooting-script'
  | 'script-breakdown'
  | 'storyboards'
  | 'shot-list'
  | 'cast-and-casting'   // NEW — step 10
  | 'final-screenplay';  // Previously step 10, now step 11
```

Update any database migration SQL files, seed data, or `PipelineStep` row definitions that
enumerate the 10 canonical steps — they must now enumerate 11 steps.

### 6.2 New Command: `filmbuff cast-and-casting`

Create a new command handler at `cli/src/commands/cast-and-casting.ts`. This command:

1. Accepts `--input <shot-list-file>` (path to the `.md` or `.json` shot list produced in step 9).
2. Parses the `## Characters` table (markdown) or `characterRegistry` array (JSON) from the input.
3. Generates a `cast-and-casting.md` report saved in the same directory as the input screenplay file.
4. The report format:

```markdown
# Cast & Casting Report
**Project:** <title>
**Generated:** <date>

## Cast

| Character | Description | Age | Actor | Photo |
|-----------|-------------|-----|-------|-------|
| MARA VOSS | Detective, sharp eyes, mid-30s | 0 |  |  |
| DIRECTOR  | AI overseer, no physical form  | 0 |  |  |

## Locations

| Location | INT/EXT | Description | Reference |
|----------|---------|-------------|-----------|
| MEMORY FORENSICS LAB | INT | Holographic lab | |
```

5. Fields `Actor`, `Photo`, and `Reference` are intentionally blank — they are user-populated
   after generation.
6. Register the command in `cli/src/cli.ts` under `filmbuff cast-and-casting` with options:
   - `--input <file>` (required) — path to the step-9 shot list output
   - `--output <file>` (optional) — defaults to `<screenplay-dir>/cast-and-casting.md`
   - `--project <slug>` (optional) — if provided, read the shot list from the project database

---

## Requirement 7 — Update `filmbuff start` (Narrative Creation)

In the `filmbuff start` command (located in `cli/src/cli.ts` and its handler), after prompting the
user for `title`, `genre`, `tone`, `target audience`, `budget tier`, and `outcome`, add an optional
interactive cast-entry flow:

1. Prompt: `"Would you like to enter cast information for main characters now? [y/N]"`
2. If the user answers `y` or `yes` (case-insensitive):
   - Enter a loop: prompt for `Character name` → `Age (number, default 0)` → `Actor name
     (optional)` → `Photo URL (optional)`.
   - After each character, ask `"Add another character? [y/N]"`. Repeat until the user answers no.
   - Store the entered cast data on the project record (as a JSON string in a new optional column
     `initial_cast_json` on the `projects` table, or in project metadata).
3. If the user answers `n` or skips (default):
   - Print an informational message: `"Cast information can be added later using 'filmbuff continue
     --project <slug>' after step 9 (shot-list) is completed."`
   - Continue without prompting for cast data.

---

## Requirement 8 — Update `filmbuff continue` to Support Cast and Location Editing

In `cli/src/commands/continue.ts`, enhance the command to detect when the next pending step is
`cast-and-casting` (step 10) and offer cast-editing prompts:

1. When the next pending step is `cast-and-casting`, read the completed step-9 shot list output.
2. Parse the character registry from the shot list (markdown table or JSON).
3. Display the current character registry table and prompt the user interactively:
   - `"Enter actor name for <CHARACTER NAME> (leave blank to skip):"`
   - `"Enter age for <CHARACTER NAME> (default 0):"`
   - `"Enter photo URL for <CHARACTER NAME> (leave blank to skip):"`
4. Repeat for each character in the registry.
5. After cast editing, prompt for locations: `"Enter a reference URL for <LOCATION NAME> (leave blank to skip):"`.
6. Allow the user to add new characters or locations not extracted from the screenplay by prompting:
   `"Add a new character? [y/N]"` and `"Add a new location? [y/N]"` after the loop.
7. Persist the updated registry back to the shot list file and store the data as the input context
   for the `cast-and-casting` step.
8. If the user runs `filmbuff continue` when the next pending step is NOT `cast-and-casting`, the
   command must behave exactly as before (no regression).

---

## Requirement 9 — Update Eval Step Files

### 9.1 Update `evals/steps/09-shot-list.yaml`

Add a new assertion to validate that the generated shot list contains a `characterRegistry` array
and a `locationRegistry` array at the top level of the JSON output:

```yaml
- type: json-schema
  value:
    required: [shots, characterRegistry, locationRegistry]
```

Update the `llm-rubric` assertion to also evaluate whether the character and location registries
are populated with at least one entry derived from the input screenplay excerpt.

### 9.2 Create `evals/steps/10-cast-and-casting.yaml`

Create a new Promptfoo eval file for the cast-and-casting step with tests that verify:
- The cast report contains a markdown table with at least the columns: `Character`, `Description`,
  `Age`, `Actor`, `Photo`.
- The location table contains at least the columns: `Location`, `INT/EXT`, `Description`,
  `Reference`.
- All characters from the shot list input appear in the cast report.
- The report is saved with the filename `cast-and-casting.md`.

### 9.3 Update `evals/promptfooconfig.yaml`

Add an import for the new step file:

```yaml
- steps/10-cast-and-casting.yaml
- steps/11-final-screenplay.yaml  # renamed from 10-final-screenplay.yaml
```

Rename `evals/steps/10-final-screenplay.yaml` to `evals/steps/11-final-screenplay.yaml` and update
its internal description to reflect step 11.

---

## Requirement 10 — Update Help Text

In `cli/src/commands/generate-shot-list/help-text.ts`, update the `DESCRIPTION` section to mention
that the output now includes:
- A `## Characters` registry table at the top of the markdown output
- A `## Locations` registry table at the top of the markdown output
- `Age` and `Actor` columns in per-shot character tables

Add documentation for the new `filmbuff cast-and-casting` command to `docs/CLI_REFERENCE.md` and
`docs/FILM_PIPELINE.md`, documenting it as pipeline step 10 with `final-screenplay` as step 11.

---

## Acceptance Criteria

All of the following must be true for this implementation to be considered complete:

- [ ] `filmbuff generate-shot-list --input script.fountain --format md` produces a markdown file
  that begins with `## Characters` and `## Locations` tables populated from the screenplay, before
  the `## Shot List` section.
- [ ] Every shot's character section in the markdown output is a GFM table with `Age` and `Actor`
  columns, defaulting to `0` and `""` respectively.
- [ ] `filmbuff generate-shot-list --format json` includes `characterRegistry` and
  `locationRegistry` arrays at the top level of the JSON output.
- [ ] `filmbuff cast-and-casting --input <shot-list.md>` generates `cast-and-casting.md` in the
  screenplay's directory, containing a cast table and a locations table in GFM format.
- [ ] `filmbuff continue --project <slug>` — when the next pending step is `cast-and-casting` —
  interactively prompts the user to populate `Actor`, `Age`, and `Photo URL` for each character
  extracted from the step-9 output.
- [ ] `filmbuff start` prompts `"Would you like to enter cast information now? [y/N]"` after
  collecting project metadata and handles both `y` and `n` responses correctly.
- [ ] `PipelineStepName` in `cli/src/db/types.ts` includes `'cast-and-casting'` and
  `'final-screenplay'` is now step 11.
- [ ] Both JSON schema files validate the new `characterRegistry` and `locationRegistry` fields.
- [ ] All existing tests pass without modification (no regression).
- [ ] Markdown tables in all generated output files conform to standard GFM pipe-table syntax,
  making them directly editable with any markdown table editor.

---

## Implementation Order

Implement the changes in this order to minimize merge conflicts and allow incremental testing:

1. `cli/src/commands/generate-shot-list/generator/types.ts` — add new types and extend interfaces
2. `cli/src/commands/generate-shot-list/generator/index.ts` — build registries in `generate()`
3. `cli/src/commands/generate-shot-list/formatter/markdown-formatter.ts` — emit registry tables
4. `cli/src/commands/generate-shot-list/formatter/json-formatter.ts` — include registry in output
5. `cli/src/commands/generate-shot-list/formatter/jsonl-formatter.ts` — include registry in output
6. `cli/src/commands/generate-shot-list/formatter/csv-formatter.ts` — add age/actor columns
7. Both `shot-list.schema.json` files — add new definitions
8. `cli/src/db/types.ts` — add `cast-and-casting` to `PipelineStepName`, renumber to 11 steps
9. `cli/src/commands/cast-and-casting.ts` — new command handler
10. `cli/src/commands/continue.ts` — add cast/location editing flow for step 10
11. `cli/src/cli.ts` — register `cast-and-casting` command
12. `cli/src/commands/generate-shot-list/help-text.ts` — update help text
13. Eval files — update step 9, create step 10, rename step 10→11, update master config
14. `docs/CLI_REFERENCE.md` and `docs/FILM_PIPELINE.md` — document new step and command

---

## Future Integration Note

A planned future integration will combine `filmbuff` with an AI video generation service, enabling
the shot list to drive automated video creation. The character and location registries introduced
by this change are a prerequisite for that integration — the `photoUrl` field on
`CharacterRegistryEntry` and the `links` field on `LocationRegistryEntry` will serve as reference
inputs for the video generator. A candidate open-source AI video generation library for this
integration is available at `https://github.com/mytech-today-now/ai-powered`. No code for this
integration is required now; the registry data structures defined in Requirement 1 are sufficient
to support it when the time comes.
