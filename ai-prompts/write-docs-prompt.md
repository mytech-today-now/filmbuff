# FilmBuff CLI — Architecture & Development Prompt

## Purpose

This prompt describes the complete architecture of the FilmBuff CLI pipeline system and serves as the authoritative reference for AI agents building on, extending, or debugging it. Every detail is made explicit so that no inference is required when implementing changes.

---

## 1. High-Level Concept

FilmBuff is a Node.js CLI tool (TypeScript, compiled to `dist/`) that orchestrates AI-driven screenplay production through a **10-step linear pipeline**. Each step produces one document (e.g., a logline, synopsis, treatment). The output of each step is stored in a SQLite database (`filmbuff.db`) and fed as context into the next step.

The pipeline is a **state machine**. The state lives entirely in `filmbuff.db`. Three primary commands drive it:

| Command | Role |
|---|---|
| `filmbuff start` | Creates a project and seeds 10 empty `project_steps` rows |
| `filmbuff continue` | Identifies the next pending step and assembles prior outputs as context |
| `filmbuff complete` | Accepts the output file for a step, saves it as a `document_revision`, and advances the state |

Additionally, the standalone command `filmbuff generate-shot-list` generates a shot list from a screenplay file. **It currently bypasses the database** — its output is written directly to disk. Wiring it (and `generate-treatment`) into the pipeline lifecycle is a planned extension.

---

## 2. Repository Layout

```
filmbuff/
├── cli/
│   ├── src/
│   │   ├── cli.ts                  # Commander.js root — registers all subcommands
│   │   ├── commands/
│   │   │   ├── start.ts            # filmbuff start
│   │   │   ├── continue.ts         # filmbuff continue
│   │   │   ├── complete.ts         # filmbuff complete
│   │   │   ├── review.ts           # filmbuff review (accept/reject an attempt)
│   │   │   ├── retry.ts            # filmbuff retry (re-generate a step)
│   │   │   ├── status.ts           # filmbuff status (show project state)
│   │   │   └── generate-shot-list/ # Standalone shot-list generator (no DB)
│   │   ├── db/
│   │   │   ├── connection.ts       # openDatabase() — opens filmbuff.db with WAL+FK
│   │   │   ├── migration-runner.ts # runMigrations() — applies SQL files in order
│   │   │   ├── migrations/
│   │   │   │   └── 001_initial_schema.sql  # Creates all tables + seeds pipeline_steps
│   │   │   ├── types.ts            # TypeScript interfaces mirroring every DB table
│   │   │   ├── project-repository.ts    # CRUD for projects + project_steps
│   │   │   ├── document-repository.ts   # saveRevision(), getCurrentRevision()
│   │   │   ├── session-repository.ts    # recordSession(), completeSession(), recordContextSnapshot()
│   │   │   ├── provider-repository.ts   # upsertProvider(), upsertProfile(), getActiveSelection()
│   │   │   └── index.ts            # Barrel: re-exports all repositories and types
│   │   └── providers/              # AI provider adapters (Anthropic, OpenAI, Google)
│   └── dist/                       # Compiled output (git-tracked for npm publish)
├── ai-prompts/                     # Step-specific AI instruction prompts
└── filmbuff.db                     # SQLite database (gitignored; created on first run)
```

---

## 3. Database: `filmbuff.db`

The database is opened via `openDatabase()` in `cli/src/db/connection.ts`. It uses `better-sqlite3` (synchronous SQLite) with three pragmas applied at connection time:

```sql
PRAGMA journal_mode = WAL;   -- Concurrent readers; single writer
PRAGMA foreign_keys = ON;    -- Enforce referential integrity
PRAGMA busy_timeout = 5000;  -- 5-second retry on lock
```

The database file is named `filmbuff.db` and is placed in the process working directory (typically the project root). It is gitignored.

### 3.1 Table: `pipeline_steps` (Reference / Seed Data)

Pre-seeded at migration time. **Never modified by application code.** Defines the 10 canonical steps.

```sql
CREATE TABLE pipeline_steps (
  step_number      INTEGER PRIMARY KEY,   -- 1–10
  step_name        TEXT    NOT NULL UNIQUE,
  default_filename TEXT    NOT NULL,
  default_format   TEXT    NOT NULL,      -- 'md' | 'json' | 'fountain' | 'pdf'
  description      TEXT
);
```

**Seed rows (exactly 10, in order):**

| # | step_name | default_filename | format | description |
|---|---|---|---|---|
| 1 | `logline` | `logline.md` | md | One-to-two sentence film premise |
| 2 | `synopsis` | `synopsis.md` | md | Short narrative summary (1–2 pages) |
| 3 | `treatment` | `treatment.md` | md | Scene-by-scene narrative outline |
| 4 | `beat-sheet` | `beat-sheet.md` | md | Story beats mapped to structure |
| 5 | `screenplay` | `screenplay.fountain` | fountain | Full feature-length screenplay |
| 6 | `shooting-script` | `shooting-script.fountain` | fountain | Locked shooting draft with scene numbers |
| 7 | `script-breakdown` | `script-breakdown.json` | json | Breakdown of every scene element |
| 8 | `storyboards` | `storyboards.md` | md | Visual panel descriptions per scene |
| 9 | `shot-list` | `shot-list.json` | json | Detailed shot list for production |
| 10 | `final-screenplay` | `final-screenplay.fountain` | fountain | Distribution-ready final screenplay |

### 3.2 Table: `projects`

One row per FilmBuff project. Created by `filmbuff start`.

```sql
CREATE TABLE projects (
  id                   TEXT PRIMARY KEY,         -- UUID v4
  slug                 TEXT NOT NULL UNIQUE,      -- URL-safe identifier, e.g. "roofing-commercial"
  display_title        TEXT NOT NULL,
  genre                TEXT NOT NULL,
  tone                 TEXT,                      -- e.g. "gritty", "whimsical"
  target_audience      TEXT,
  budget_tier          TEXT,                      -- 'micro' | 'low' | 'mid' | 'studio'
  outcome              TEXT,                      -- e.g. "secure funding"
  output_dir           TEXT NOT NULL,             -- absolute path to output folder
  format_override      TEXT,                      -- overrides per-step default format
  detail_level         TEXT NOT NULL DEFAULT 'standard', -- 'brief' | 'standard' | 'detailed'
  style_modules        TEXT,                      -- JSON array of module paths
  active_provider_id   TEXT REFERENCES providers(id),
  active_profile_name  TEXT,
  status               TEXT NOT NULL DEFAULT 'active', -- 'active' | 'completed' | 'archived' | 'error'
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  completed_at         TEXT
);
```

**Example row** (after `filmbuff start --title "Roofing Commercial" --genre "B2B Commercial"`):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "slug": "roofing-commercial",
  "display_title": "Roofing Commercial",
  "genre": "B2B Commercial",
  "detail_level": "standard",
  "status": "active",
  "output_dir": "/projects/output/roofing-commercial"
}
```

### 3.3 Table: `project_steps`

One row per project × pipeline step (10 rows created when `filmbuff start` runs). Acts as the state machine.

```sql
CREATE TABLE project_steps (
  id               TEXT    PRIMARY KEY,    -- UUID v4
  project_id       TEXT    NOT NULL REFERENCES projects(id),
  step_number      INTEGER NOT NULL REFERENCES pipeline_steps(step_number),
  step_name        TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'pending',
                           -- 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
  output_file_path TEXT,   -- absolute path to the accepted output file
  output_format    TEXT,   -- 'md' | 'json' | 'fountain' | 'pdf'
  accepted_at      TEXT,   -- ISO 8601 timestamp when step was accepted
  skipped_at       TEXT,
  failed_at        TEXT,
  failure_reason   TEXT,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  UNIQUE(project_id, step_number)
);
```

**State transitions:**
- `pending` → `in_progress` (when `filmbuff continue` starts the step)
- `in_progress` → `completed` (when `filmbuff complete` or `filmbuff review --accept` runs)
- `in_progress` → `failed` (on error; `failure_reason` is set)
- `pending` → `skipped` (manual skip via `filmbuff review --skip`)

### 3.4 Table: `generation_attempts`

Append-only audit log. One row per AI generation call for a step. **Rows are never updated or deleted** (soft-delete via `deleted_at`).

```sql
CREATE TABLE generation_attempts (
  id                    TEXT PRIMARY KEY,      -- UUID v4
  project_step_id       TEXT NOT NULL REFERENCES project_steps(id),
  attempt_number        INTEGER NOT NULL,       -- 1, 2, 3 … (monotonically increasing per step)
  provider_id           TEXT NOT NULL,          -- e.g. "anthropic"
  profile_name          TEXT NOT NULL,          -- e.g. "claude-3-7-sonnet"
  model_id              TEXT NOT NULL,          -- e.g. "claude-3-7-sonnet-20250219"
  prompt_tokens         INTEGER,
  completion_tokens     INTEGER,
  total_tokens          INTEGER,
  prompt_hash           TEXT,                   -- SHA-256 of the assembled prompt
  raw_output            TEXT,                   -- Full AI response text
  instructions_override TEXT,                   -- Custom instructions used for this attempt
  detail_level          TEXT,
  style_modules         TEXT,                   -- JSON array
  context_document_ids  TEXT,                   -- JSON array of context_snapshot IDs used
  status                TEXT NOT NULL DEFAULT 'generated',
                        -- 'generated' | 'accepted' | 'rejected' | 'error'
  error_message         TEXT,
  started_at            TEXT NOT NULL,
  completed_at          TEXT,
  accepted_at           TEXT,
  deleted_at            TEXT                    -- Soft-delete; NULL means active
);
```

### 3.5 Table: `document_revisions`

The accepted output for each step. Multiple revisions are allowed (e.g., if the user edits and re-accepts). `is_current = 1` marks the revision that `filmbuff continue` will read as prior context.

```sql
CREATE TABLE document_revisions (
  id                    TEXT    PRIMARY KEY,
  project_step_id       TEXT    NOT NULL REFERENCES project_steps(id),
  generation_attempt_id TEXT    REFERENCES generation_attempts(id),  -- NULL if manually created
  revision_number       INTEGER NOT NULL,      -- 1, 2, 3 … per step
  content               TEXT    NOT NULL,      -- Full document text
  content_hash          TEXT    NOT NULL,      -- SHA-256 for deduplication
  content_size_bytes    INTEGER NOT NULL,
  format                TEXT    NOT NULL,      -- 'md' | 'json' | 'fountain' | 'pdf'
  is_current            INTEGER NOT NULL DEFAULT 1,  -- 1 = active; 0 = superseded
  accepted_by           TEXT,                  -- provider_id or user identifier
  accepted_at           TEXT    NOT NULL,
  notes                 TEXT
);
```

**Example**: after `filmbuff complete --project roofing-commercial --step logline --file output/logline.md`:
```json
{
  "id": "abc123",
  "project_step_id": "step-uuid-for-logline",
  "revision_number": 1,
  "content": "A suburban homeowner discovers...",
  "format": "md",
  "is_current": 1
}
```

### 3.6 Table: `sessions`

One row per CLI invocation that touches the database. Every command (`start`, `continue`, `complete`, `review`, `retry`) opens a session at the start and closes it (with exit code) at the end. Provides a full audit trail.

```sql
CREATE TABLE sessions (
  id            TEXT    PRIMARY KEY,
  project_id    TEXT    REFERENCES projects(id),  -- NULL for non-project commands
  command       TEXT    NOT NULL,     -- e.g. "start", "continue", "complete"
  flags         TEXT,                 -- JSON object of CLI flags (secrets redacted)
  provider_id   TEXT,
  profile_name  TEXT,
  started_at    TEXT    NOT NULL,
  completed_at  TEXT,
  exit_code     INTEGER,              -- 0 = success; non-zero = failure
  error_message TEXT
);
```

**Example**: session created at start of `filmbuff continue --project roofing-commercial`:
```json
{
  "id": "session-uuid",
  "project_id": "project-uuid",
  "command": "continue",
  "flags": "{\"project\":\"roofing-commercial\",\"dryRun\":false}",
  "started_at": "2026-03-19T12:00:00Z",
  "exit_code": null
}
```

### 3.7 Table: `context_snapshots`

A snapshot of every piece of context assembled at the time of generation. Linked to a `generation_attempt`. Allows exact replay of what the AI "saw" for any attempt.

```sql
CREATE TABLE context_snapshots (
  id                    TEXT    PRIMARY KEY,
  generation_attempt_id TEXT    NOT NULL REFERENCES generation_attempts(id),
  context_type          TEXT    NOT NULL,
                        -- 'project_metadata' | 'prior_document' | 'style_module' | 'user_brief'
  source_step_name      TEXT,   -- populated when context_type = 'prior_document'
  content               TEXT    NOT NULL,
  content_hash          TEXT    NOT NULL,
  sequence_order        INTEGER NOT NULL,   -- 0, 1, 2 … defines prompt assembly order
  created_at            TEXT    NOT NULL
);
```

**Context assembly order** (enforced by `filmbuff continue`):
1. `sequence_order = 0` → `project_metadata` — the project row serialized as JSON
2. `sequence_order = 1..N` → one `prior_document` per previously completed step, ordered by `step_number ASC`

**Example**: for a `treatment` generation, the context would include:
```
sequence_order=0  context_type='project_metadata'  content={"slug":"roofing-commercial","genre":"B2B Commercial",...}
sequence_order=1  context_type='prior_document'  source_step_name='logline'     content="A suburban homeowner..."
sequence_order=2  context_type='prior_document'  source_step_name='synopsis'    content="ACT ONE: ..."
```

---

## 4. Command Reference

### 4.1 `filmbuff start`

**File:** `cli/src/commands/start.ts`
**Handler:** `startCommand(options: StartOptions)`

**What it does:**
1. Opens `filmbuff.db` and runs migrations (idempotent).
2. Opens a `session` row with `command = 'start'`.
3. Calls `ProjectRepository.create()` which in a single SQLite transaction:
   - Inserts one `projects` row.
   - Inserts 10 `project_steps` rows (one per `pipeline_steps` entry), all with `status = 'pending'`.
4. Closes the session with `exit_code = 0`.

**CLI syntax:**
```bash
filmbuff start \
  --title "Roofing Commercial"     # Required: human-readable title
  --genre "B2B Commercial"         # Required: genre string
  [--slug "roofing-commercial"]    # Optional: auto-derived from title if omitted
  [--tone "professional"]          # Optional
  [--audience "homeowners"]        # Optional
  [--budget micro|low|mid|studio]  # Optional
  [--outcome "secure investor funding"]  # Optional
  [--output-dir "./output/roofing"]  # Optional: defaults to ./output/<slug>
  [--format md|json|fountain|pdf]  # Optional: overrides step default formats
  [--detail brief|standard|detailed]  # Optional: default = standard
  [--styles "writing-standards/screenplay/cinematic-styles/directors/nolan"]  # Repeatable
  [--provider anthropic]           # Optional: AI provider to use
  [--profile claude-sonnet]        # Optional: named provider profile
```

**On success:** Prints project details and instructs: `Next step: filmbuff continue --project <slug>`

**On slug collision:** Throws `DuplicateSlugError` → exit code 1 with message: `Use --slug <name> to choose a different slug.`

### 4.2 `filmbuff continue`

**File:** `cli/src/commands/continue.ts`
**Handler:** `continueCommand(options: ContinueOptions)`

**What it does:**
1. Opens the database and runs migrations.
2. Resolves the project by slug or UUID (tries `findBySlug` first, then `findById`).
3. Opens a `session` row.
4. Calls `ProjectRepository.getSteps()` to find the first step where `status = 'pending'` or `status = 'in_progress'`.
5. Assembles context: builds one `project_metadata` snapshot + one `prior_document` snapshot per completed step (reads the actual file from disk via `output_file_path`).
6. Persists all snapshots to `context_snapshots` (unless `--dry-run`).
7. Closes the session.

**CLI syntax:**
```bash
filmbuff continue \
  --project roofing-commercial    # Required: project slug or UUID
  [--provider anthropic]          # Optional: override project's active provider
  [--profile claude-sonnet]       # Optional: override project's active profile
  [--dry-run]                     # Optional: assemble context but do not persist snapshots
```

**Output example:**
```
✓ Project: Roofing Commercial (roofing-commercial)
✓ Next step: [3] treatment
✓ Context assembled: 3 snapshot(s)
Run the pipeline for step "treatment" to generate output.
```

### 4.3 `filmbuff complete`

**File:** `cli/src/commands/complete.ts`
**Handler:** `completeCommand(options: CompleteOptions)`

**What it does:**
1. Validates that `--file` exists on disk before touching the database.
2. Opens the database and runs migrations.
3. Opens a `session` row.
4. Reads the file content and calls `DocumentRepository.saveRevision()` which:
   - Computes SHA-256 `content_hash` and byte size.
   - Sets `is_current = 0` on all prior revisions for this `project_step_id`.
   - Inserts a new revision with `is_current = 1` and `revision_number = prior_max + 1`.
5. Calls `ProjectRepository.updateStep()` to set `status = 'completed'`, `output_file_path`, `output_format`, `accepted_at`.
6. Re-fetches all steps; if every step is `completed` or `skipped`, sets `projects.status = 'completed'`.
7. Closes the session.

**CLI syntax:**
```bash
filmbuff complete \
  --project roofing-commercial    # Required: project slug or UUID
  --step logline                  # Required: one of the 10 pipeline step names
  --file ./output/logline.md      # Required: path to the accepted output file
  [--format md|json|fountain|pdf] # Optional: default = md
  [--notes "Edited for tone"]     # Optional: stored in document_revisions.notes
  [--provider anthropic]          # Optional: recorded in session
  [--profile claude-sonnet]       # Optional: recorded in session
```

**When all steps complete:**
```
🎉 All pipeline steps complete — project marked as completed!
```

### 4.4 `filmbuff generate-shot-list` (Standalone — Not Yet Wired to DB)

**File:** `cli/src/commands/generate-shot-list.ts` + `generate-shot-list/` folder
**Current behavior:** Parses a Fountain/Markdown screenplay, calls the AI provider, formats the output, and writes it to a file. **Does not read from or write to `filmbuff.db`.**

**CLI syntax:**
```bash
filmbuff generate-shot-list \
  --input script.fountain         # Required: screenplay file path
  [--output my-shots.md]          # Optional: default = <input>-ai-shot-list.<ext>
  [--format md|json|jsonl|csv|txt|html]  # Optional: default = md
  [--max-characters 4000]         # Optional: max chars per shot description (100–10000)
  [--max-shot-length 12]          # Optional: max seconds per shot (1–60)
  [--style <module-path>]         # Optional: cinematic style module (repeatable)
  [--mute-sfx]                    # Optional: strip music/SFX from output
  [--ai-provider anthropic]       # Optional
  [--ai-profile claude-sonnet]    # Optional
  [--logging]                     # Optional: write debug JSONL log
  [--verbose]                     # Optional: extra console output
```

**Planned extension:** Wire this command into the pipeline so that when `step_name = 'shot-list'` (step 9), `filmbuff continue` triggers `generate-shot-list` automatically, and its output is saved via `DocumentRepository.saveRevision()`.

---

## 5. Repository Layer

All database access goes through repository classes — no raw SQL outside `cli/src/db/`.

### `ProjectRepository` (`cli/src/db/project-repository.ts`)
- `create(input: CreateProjectInput): Project` — inserts project + 10 project_steps in a transaction; throws `DuplicateSlugError` on slug collision
- `findById(id: string): Project | null`
- `findBySlug(slug: string): Project | null`
- `list(status?: ProjectStatus): Project[]`
- `updateStatus(id: string, status: ProjectStatus): void`
- `setActiveProvider(id: string, providerId: string, profileName: string): void`
- `getSteps(projectId: string): ProjectStep[]` — ordered by `step_number ASC`
- `updateStep(stepId: string, patch: Partial<ProjectStep>): void`

### `DocumentRepository` (`cli/src/db/document-repository.ts`)
- `saveRevision(input: SaveRevisionInput): DocumentRevision` — demotes prior `is_current` revisions, inserts new one
- `getCurrentRevision(projectStepId: string): DocumentRevision | null`
- `listRevisions(projectStepId: string): DocumentRevision[]`

### `SessionRepository` (`cli/src/db/session-repository.ts`)
- `recordSession(input: StartSessionInput): void`
- `completeSession(id: string, exitCode: number, errorMessage?: string): void`
- `recordContextSnapshot(input: ContextSnapshotInput): void`

### `ProviderRepository` (`cli/src/db/provider-repository.ts`)
- `upsertProvider(input: UpsertProviderInput): void`
- `upsertProfile(providerId: string, input: UpsertProfileInput): void`
- `getActiveSelection(providerId: string): ActiveProviderSelection | null`

---

## 6. TypeScript Types

All DB row types are defined in `cli/src/db/types.ts`. Import exclusively from the barrel `cli/src/db/index.ts`:

```typescript
import {
  openDatabase, runMigrations, MIGRATIONS_DIR,
  ProjectRepository, DocumentRepository, SessionRepository,
  DuplicateSlugError,
} from '../db/index.js';
import type {
  Project, ProjectStep, GenerationAttempt, DocumentRevision,
  ContextSnapshot, DbSession,
  PipelineStepName, StepStatus, AttemptStatus, DocumentFormat,
  DetailLevel, BudgetTier, ContextType,
  CreateProjectInput, RecordAttemptInput, ContextSnapshotInput,
} from '../db/index.js';
```

**Key literal union types:**
- `PipelineStepName` — `'logline' | 'synopsis' | 'treatment' | 'beat-sheet' | 'screenplay' | 'shooting-script' | 'script-breakdown' | 'storyboards' | 'shot-list' | 'final-screenplay'`
- `StepStatus` — `'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'`
- `AttemptStatus` — `'generated' | 'accepted' | 'rejected' | 'error'`
- `DocumentFormat` — `'md' | 'json' | 'fountain' | 'pdf'`
- `ContextType` — `'project_metadata' | 'prior_document' | 'style_module' | 'user_brief'`

---

## 7. Data Flow: End-to-End Example

```
1. filmbuff start --title "Roofing Commercial" --genre "B2B Commercial"
   → Creates: projects row (id=P1, slug="roofing-commercial", status="active")
   → Creates: 10 project_steps rows (all status="pending")
   → Creates: sessions row (command="start", exit_code=0)

2. filmbuff continue --project roofing-commercial
   → Finds: project_steps[step_number=1, step_name="logline", status="pending"]
   → Assembles: context_snapshots[type="project_metadata", order=0]
   → (No prior_document snapshots yet — no completed steps)
   → Prints: "Next step: [1] logline"

3. [User runs AI or manually writes logline.md]

4. filmbuff complete --project roofing-commercial --step logline --file ./output/logline.md
   → Reads: logline.md content
   → Creates: document_revisions row (revision_number=1, is_current=1, format="md")
   → Updates: project_steps[step_name="logline"] → status="completed", accepted_at=now

5. filmbuff continue --project roofing-commercial
   → Finds: project_steps[step_number=2, step_name="synopsis", status="pending"]
   → Assembles: context_snapshots[type="project_metadata", order=0]
                context_snapshots[type="prior_document", source="logline", order=1]
   → Prints: "Next step: [2] synopsis"

... repeat through step 10 ...

10. After filmbuff complete --step final-screenplay ...
    → All 10 steps completed/skipped
    → projects.status updated to "completed"
    → Prints: "🎉 All pipeline steps complete — project marked as completed!"
```

---

## 8. Extension: Wiring `generate-shot-list` into the Pipeline

To integrate `generate-shot-list` as the pipeline runner for step 9 (`shot-list`), the following changes are required:

1. **In `filmbuff continue`:** When `nextStep.step_name === 'shot-list'`, automatically invoke the shot-list generator with the screenplay content from the `screenplay` step's `document_revision` as input (instead of requiring `--input` from the user).

2. **After generation:** Call `DocumentRepository.saveRevision()` with the generated output and `ProjectRepository.updateStep()` to mark `shot-list` as `completed`.

3. **In `generation_attempts`:** Record the AI call details (provider, model, tokens) before saving the revision.

4. **Backfill `generate-treatment`:** Step 3 (`treatment`) should similarly be driven automatically by reading step 2's (`synopsis`) accepted `document_revision` content as input context.

The pattern to follow is:
```typescript
const db = openDatabase();
runMigrations(db, MIGRATIONS_DIR);
const projectRepo  = new ProjectRepository(db);
const documentRepo = new DocumentRepository(db);
const sessionRepo  = new SessionRepository(db);

// 1. Get prior step's accepted content
const synopsisStep = steps.find(s => s.step_name === 'synopsis');
const synopsisRev  = documentRepo.getCurrentRevision(synopsisStep.id);

// 2. Run AI generation with synopsisRev.content as context

// 3. Save result
documentRepo.saveRevision({ id, project_step_id, content, format, ... });
projectRepo.updateStep(targetStep.id, { status: 'completed', output_file_path, accepted_at });
```

