# JIRA Ticket: TBD — FilmBuff Persistent Database Layer

## Summary

Design and implement a production-grade, multi-tier database layer for the FilmBuff CLI application. This layer persists every artifact that the AI-powered narrative document pipeline (`filmbuff start` / `continue` / `retry` / `complete` / `status`) generates, stores all AI provider configurations, all project state, all generated document history, all user session context, and all cinematic style preferences. The database layer must be robust enough to survive crashes mid-generation, support resumable workflows across machines and sessions, scale from a solo creative writer running a single project to a studio team managing hundreds of concurrent projects, and serve as the backing store for the database-backed provider resolution system defined in `ai-prompts/provider-resolution-JIRAt.md`, which replaces the legacy `resolveActiveProvider` / `profileStore` JSON file abstraction currently used by `filmbuff generate-shot-list`.

---

## Description

### Background

FilmBuff's AI-powered narrative pipeline (described in `ai-prompts/film-docs-JIRA.md`) generates up to ten sequential documents per project — logline, synopsis, treatment, beat sheet, screenplay, shooting script, script breakdown, storyboards, shot list, and final screenplay. Each document takes seconds to minutes of AI compute time to produce, so losing the output of any completed step to a crash, accidental terminal exit, or machine restart is unacceptable. Similarly, the configurable AI provider system (described in `ai-prompts/ai-providers-JIRA.md`) stores multiple named profiles per provider, each containing sensitive API keys and capability metadata, and must survive application restarts with full fidelity.

Currently no unified database layer exists. Project state is described as living in `.filmbuff/project.json` — a single flat JSON file per project that is overwritten in place. Provider profiles live as individual JSON files under `.augment/providers/profiles/`. Both approaches break down under concurrent access, partial writes, migration, auditing, search, and cross-project analytics. The solution must replace and supersede these ad-hoc stores. The implementation plan for retiring `cli/src/utils/profile-store.ts` and refactoring `cli/src/utils/runtime-resolver.ts` to use `ProviderRepository` is defined in `ai-prompts/provider-resolution-JIRAt.md`; `cli/src/utils/config-system.ts` is updated as part of that same ticket.

### Goals

1. **Durability** — No generated document or accepted pipeline step is ever lost, even if the process is killed mid-write.
2. **Resumability** — Any command (`filmbuff continue`, `filmbuff retry`, `filmbuff status`) can reconstruct the complete project state from the database alone, without scanning the filesystem.
3. **Auditability** — Every AI generation attempt, every user override, every provider switch, and every document acceptance is timestamped and stored so users can understand exactly how a document was produced.
4. **Security** — API keys and other secrets are never stored in plaintext; they reference environment variables or are encrypted at rest using an application-managed key.
5. **Developer ergonomics** — The TypeScript data-access layer exposes a small, typed, repository-pattern API so command handlers never write raw SQL or manipulate JSON files directly.
6. **Portability** — The primary storage engine is embedded (no external server process required) so the CLI works out of the box for individual users. Optional upgrade paths to a hosted backend exist for team/studio use.
7. **Extensibility** — Adding new pipeline steps, new provider types, or new document types requires only schema migrations; no architectural rewrites.
8. **CLI Provider Management** — The database layer must support all CRUD operations required by provider management CLI commands (`filmbuff provider add`, `filmbuff provider list`, `filmbuff provider set`, `filmbuff provider delete`, `filmbuff provider validate`), including atomic profile creation, referential-integrity-checked deletion, and safe rename operations.
9. **GUI Configuration Support** — The `filmbuff configure` GUI flow and the provider management panel in `filmbuff gui` read and write provider and profile state exclusively through `ProviderRepository` so the GUI and CLI share an identical, consistent view of configuration at all times.

---

## Architecture Overview

The database layer is organized into four logical tiers that each have distinct responsibilities:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  CLI Command Handlers  (filmbuff start / continue / retry / complete / status)   │
└────────────────────────────────┬─────────────────────────────────────────────────┘
                                 │ calls
┌────────────────────────────────▼─────────────────────────────────────────────────┐
│  Repository Layer  (TypeScript classes, one per domain aggregate)                │
│  ProjectRepository · DocumentRepository · ProviderRepository · SessionRepository│
└────────────────────────────────┬─────────────────────────────────────────────────┘
                                 │ uses
┌────────────────────────────────▼─────────────────────────────────────────────────┐
│  Query / ORM Abstraction  (Kysely query builder + migration runner)              │
│  Typed table interfaces · transaction helpers · migration registry               │
└────────────────────────────────┬─────────────────────────────────────────────────┘
                                 │ wraps
┌────────────────────────────────▼─────────────────────────────────────────────────┐
│  Storage Engine Adapters                                                         │
│  Primary: better-sqlite3 (embedded, synchronous, ACID)                          │
│  Optional: libsql/Turso (embedded + cloud sync), PostgreSQL (studio tier)       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Why SQLite (better-sqlite3) as the Primary Engine

SQLite is the correct default engine for a CLI tool for the following reasons:

- **Zero-infrastructure**: No server process, no port, no Docker container. The CLI works on any developer laptop immediately after `npm install`.
- **ACID transactions**: All ten pipeline documents can be committed atomically so a crash between steps never leaves the database in a partial state.
- **Write-Ahead Logging (WAL mode)**: WAL mode allows concurrent reads during a write, which matters when `filmbuff status` is polling while `filmbuff continue` is generating.
- **Proven at scale**: SQLite databases routinely hold millions of rows. A creative writer managing hundreds of projects will never exceed SQLite's limits.
- **`better-sqlite3`**: The synchronous Node.js binding is significantly simpler than asynchronous drivers when used inside a synchronous CLI. No `await` chains needed in repository methods, which eliminates entire classes of async error.

The optional upgrade path to **libsql/Turso** allows teams to sync a local SQLite database to a cloud replica without any code changes in the repository layer — only the engine adapter is swapped. For large studios requiring multi-user concurrent writes, the same repository API can be backed by **PostgreSQL** through an optional adapter module.

---

## Schema Design

All tables use `snake_case` column names and store timestamps as ISO-8601 strings (TEXT in SQLite, TIMESTAMPTZ in PostgreSQL) for portability and readability. Every table has a surrogate primary key (`TEXT` UUID) generated by the application rather than a database sequence, so records can be created in memory before being flushed to disk.

### Core Tables

#### `projects`

Stores one row per FilmBuff project initiated by `filmbuff start`.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | UUID v4 |
| `slug` | TEXT | UNIQUE NOT NULL | URL-safe project name used in filenames and CLI references |
| `display_title` | TEXT | NOT NULL | Human-readable film title |
| `genre` | TEXT | NOT NULL | One of: `action`, `adventure`, `animation`, `biographical`, `comedy`, `commercial`, `documentary`, `drama`, `episodic`, `fantasy`, `historical`, `horror`, `musical`, `mystery`, `noir`, `romance`, `sci-fi`, `social`, `superhero`, `thriller`, `western` |
| `tone` | TEXT | | Freeform tone description (e.g. "dark and gritty") |
| `target_audience` | TEXT | | Freeform audience description |
| `budget_tier` | TEXT | | One of: `micro`, `low`, `mid`, `studio` |
| `outcome` | TEXT | | Desired creative or commercial outcome |
| `output_dir` | TEXT | NOT NULL | Absolute path to the project output directory |
| `format_override` | TEXT | | Global format override: `md`, `json`, `fountain`, `pdf` |
| `detail_level` | TEXT | NOT NULL DEFAULT `standard` | `brief`, `standard`, or `detailed` |
| `style_modules` | TEXT | | JSON array of cinematic style module paths |
| `active_provider_id` | TEXT | FK → `providers.id` | Provider active at project creation time |
| `active_profile_name`| TEXT | | Profile name active at project creation time |
| `status` | TEXT | NOT NULL DEFAULT `active` | `active`, `completed`, `archived`, `error` |
| `created_at` | TEXT | NOT NULL | ISO-8601 timestamp |
| `updated_at` | TEXT | NOT NULL | ISO-8601 timestamp |
| `completed_at` | TEXT | | ISO-8601 timestamp, set when all steps accepted |

**Indexes**: `slug` (UNIQUE), `status`, `created_at DESC`

---

#### `pipeline_steps`

Stores one row per pipeline step definition. This table is pre-seeded with the canonical ten-step pipeline on database initialization and never changes unless a migration adds new step types. It acts as a reference table for foreign-key constraints and for populating `filmbuff status` output without querying generated documents.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `step_number` | INTEGER | PK | 1–10 |
| `step_name` | TEXT | UNIQUE NOT NULL | `logline`, `synopsis`, `treatment`, `beat-sheet`, `screenplay`, `shooting-script`, `script-breakdown`, `storyboards`, `shot-list`, `final-screenplay` |
| `default_filename` | TEXT | NOT NULL | e.g. `logline.md` |
| `default_format` | TEXT | NOT NULL | `md`, `json`, `fountain`, `pdf` |
| `description` | TEXT | | Human-readable step purpose |

---

#### `project_steps`

One row per (project, step) pair. This is the primary state machine for the pipeline. Its `status` column drives `filmbuff status` output and determines which step `filmbuff continue` resumes from.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | UUID v4 |
| `project_id` | TEXT | FK → `projects.id` NOT NULL | Owning project |
| `step_number` | INTEGER | FK → `pipeline_steps.step_number` NOT NULL | Step ordinal |
| `step_name` | TEXT | NOT NULL | Denormalized for query convenience |
| `status` | TEXT | NOT NULL DEFAULT `pending` | `pending`, `in_progress`, `completed`, `failed`, `skipped` |
| `output_file_path` | TEXT | | Absolute path to the accepted output file on disk |
| `output_format` | TEXT | | Actual format used for this step's output file |
| `accepted_at` | TEXT | | ISO-8601 timestamp of user acceptance |
| `skipped_at` | TEXT | | ISO-8601 timestamp if explicitly skipped |
| `failed_at` | TEXT | | ISO-8601 timestamp of last failure |
| `failure_reason` | TEXT | | Error message or stack trace from last failure |
| `retry_count` | INTEGER | NOT NULL DEFAULT 0 | Number of times this step has been retried |
| `created_at` | TEXT | NOT NULL | ISO-8601 timestamp |
| `updated_at` | TEXT | NOT NULL | ISO-8601 timestamp |

**Indexes**: `(project_id, step_number)` UNIQUE, `project_id + status`, `status`

**Constraint**: `(project_id, step_number)` must be UNIQUE — a project can only have one state record per step.

---

#### `generation_attempts`

An immutable audit log. Every call to the AI provider for a given step produces one row. This table is append-only: rows are never updated or deleted (soft-delete only). This gives users a complete provenance trail for any document.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | UUID v4 |
| `project_step_id` | TEXT | FK → `project_steps.id` NOT NULL | Step this attempt belongs to |
| `attempt_number` | INTEGER | NOT NULL | 1-based ordinal within the step |
| `provider_id` | TEXT | NOT NULL | Provider used (e.g. `anthropic`) |
| `profile_name` | TEXT | NOT NULL | Profile name used |
| `model_id` | TEXT | NOT NULL | Model identifier (e.g. `claude-opus-4-5`) |
| `prompt_tokens` | INTEGER | | Token count of the input prompt |
| `completion_tokens`| INTEGER | | Token count of the generated completion |
| `total_tokens` | INTEGER | | Sum of prompt + completion tokens |
| `prompt_hash` | TEXT | | SHA-256 of the full prompt for deduplication |
| `raw_output` | TEXT | | Full AI-generated text before any user edits |
| `instructions_override` | TEXT | | Additional instructions passed via `--instructions` |
| `detail_level` | TEXT | | `brief`, `standard`, or `detailed` |
| `style_modules` | TEXT | | JSON array of style module paths applied |
| `context_document_ids` | TEXT | | JSON array of `generation_attempt.id` values used as context |
| `status` | TEXT | NOT NULL DEFAULT `generated` | `generated`, `accepted`, `rejected`, `error` |
| `error_message` | TEXT | | Error string if `status = error` |
| `started_at` | TEXT | NOT NULL | ISO-8601 timestamp when AI call was initiated |
| `completed_at` | TEXT | | ISO-8601 timestamp when AI call returned |
| `accepted_at` | TEXT | | ISO-8601 timestamp when user accepted this output |
| `deleted_at` | TEXT | | Soft-delete timestamp |

**Indexes**: `project_step_id + attempt_number`, `status`, `provider_id + model_id`, `started_at DESC`

**Rationale for storing `raw_output`**: The raw generation output must be stored so `filmbuff retry` can show users exactly what was generated in prior attempts without re-querying the AI provider. It also enables analytics on prompt quality and cost over time.

---

#### `document_revisions`

Stores the content of every accepted document revision. When a user edits a generated document before accepting it, both the raw AI output (stored in `generation_attempts.raw_output`) and the edited final version (stored here) are preserved separately.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | UUID v4 |
| `project_step_id` | TEXT | FK → `project_steps.id` NOT NULL | |
| `generation_attempt_id` | TEXT | FK → `generation_attempts.id` | The attempt this revision is based on (nullable for manual imports) |
| `revision_number` | INTEGER | NOT NULL | 1-based ordinal within the step |
| `content` | TEXT | NOT NULL | Full document content at time of acceptance |
| `content_hash` | TEXT | NOT NULL | SHA-256 of `content` for integrity verification |
| `content_size_bytes` | INTEGER | NOT NULL | Length in bytes |
| `format` | TEXT | NOT NULL | `md`, `json`, `fountain`, `pdf` |
| `is_current` | INTEGER | NOT NULL DEFAULT 1 | Boolean (1 = current accepted version) |
| `accepted_by` | TEXT | | Username or `interactive` / `--no-interactive` |
| `accepted_at` | TEXT | NOT NULL | ISO-8601 timestamp |
| `notes` | TEXT | | Optional user notes about why this revision was accepted |

**Indexes**: `project_step_id + is_current`, `generation_attempt_id`, `content_hash`

---

#### `providers`

Mirrors the profile files currently stored under `.augment/providers/profiles/` but in a structured, queryable form. Each provider has a single row; each named profile for that provider has one row in `provider_profiles`.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | Provider identifier: `anthropic`, `openai`, `google`, or a user-defined slug |
| `display_name` | TEXT | NOT NULL | Human-readable name |
| `provider_type` | TEXT | NOT NULL | `builtin` or `custom` |
| `base_url` | TEXT | | API base URL (required for custom providers) |
| `capabilities` | TEXT | NOT NULL | JSON array of `ProviderCapability` strings |
| `metadata` | TEXT | | JSON object for provider-specific configuration |
| `is_enabled` | INTEGER | NOT NULL DEFAULT 1 | Boolean |
| `created_at` | TEXT | NOT NULL | |
| `updated_at` | TEXT | NOT NULL | |

---

#### `provider_profiles`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | UUID v4 |
| `provider_id` | TEXT | FK → `providers.id` NOT NULL | |
| `profile_name` | TEXT | NOT NULL | User-chosen name (e.g. `personal`, `work-client`) |
| `model_id` | TEXT | NOT NULL | Model identifier within this provider |
| `api_key_ref` | TEXT | | `env:ANTHROPIC_API_KEY` or encrypted ciphertext |
| `api_key_encrypted` | INTEGER | NOT NULL DEFAULT 0 | Whether `api_key_ref` is encrypted at rest |
| `max_tokens` | INTEGER | | Provider-specific token limit override |
| `temperature` | REAL | | Sampling temperature override |
| `extra_settings` | TEXT | | JSON object for provider-specific settings |
| `is_active` | INTEGER | NOT NULL DEFAULT 0 | Whether this is the currently active profile |
| `created_at` | TEXT | NOT NULL | |
| `updated_at` | TEXT | NOT NULL | |

**Constraint**: Only one row in `provider_profiles` can have `is_active = 1` at any time (enforced by a partial index and application logic).

---

#### `sessions`

Tracks CLI invocation sessions for audit and debugging. One row per `filmbuff` command invocation that touches the database.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | UUID v4 |
| `project_id` | TEXT | FK → `projects.id` | Null if the command is not project-scoped |
| `command` | TEXT | NOT NULL | e.g. `start`, `continue`, `retry`, `complete`, `status` |
| `flags` | TEXT | | JSON object of all flags passed (secrets redacted) |
| `provider_id` | TEXT | | Provider resolved for this session |
| `profile_name` | TEXT | | Profile resolved for this session |
| `started_at` | TEXT | NOT NULL | |
| `completed_at` | TEXT | | |
| `exit_code` | INTEGER | | 0 = success |
| `error_message` | TEXT | | Top-level error if `exit_code != 0` |

---

#### `context_snapshots`

When a generation step begins, the full context assembled from all prior accepted documents is captured here. This allows exact reproduction of any generation attempt without re-reading from disk, which is critical if output files are deleted or moved.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | UUID v4 |
| `generation_attempt_id` | TEXT | FK → `generation_attempts.id` NOT NULL | |
| `context_type` | TEXT | NOT NULL | `project_metadata`, `prior_document`, `style_module`, `user_brief` |
| `source_step_name` | TEXT | | Which step's document this context came from |
| `content` | TEXT | NOT NULL | The exact text included in the AI prompt for this context item |
| `content_hash` | TEXT | NOT NULL | SHA-256 for integrity |
| `sequence_order` | INTEGER | NOT NULL | Order in which this context item appeared in the assembled prompt |
| `created_at` | TEXT | NOT NULL | |

---

#### `migrations`

Internal table managed by the migration runner. Never touched by application code directly.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `version` | TEXT | UNIQUE NOT NULL | Migration version string (e.g. `001_initial_schema`) |
| `applied_at` | TEXT | NOT NULL | ISO-8601 timestamp |
| `checksum` | TEXT | NOT NULL | SHA-256 of the migration SQL to detect tampering |

---

### Full Entity Relationship Diagram

```
projects ──────────────────────────────────── project_steps ─────────── generation_attempts
  │ 1                                             │ 1                         │ 1
  │                                               │ *                         │ *
  │                          context_snapshots ───┘               document_revisions
  │
  ├── provider_profiles (active_provider_id FK)
  │
sessions ──── projects (optional FK)

pipeline_steps ──── project_steps (step_number FK)

providers ──── provider_profiles (provider_id FK)
```

---

## Repository Layer (TypeScript)

All database access flows through four repository classes. Command handlers import repositories from a single `db/index.ts` barrel; they never import `better-sqlite3` or write SQL directly.

### `ProjectRepository`

```typescript
interface ProjectRepository {
  create(input: CreateProjectInput): Project;
  findBySlug(slug: string): Project | undefined;
  findById(id: string): Project | undefined;
  listAll(filter?: { status?: ProjectStatus }): Project[];
  update(id: string, patch: Partial<Project>): Project;
  markCompleted(id: string): Project;
  archive(id: string): Project;
}
```

### `DocumentRepository`

```typescript
interface DocumentRepository {
  // Project step state machine
  initializeSteps(projectId: string): void; // seeds all 10 project_steps rows
  getStep(projectId: string, stepName: PipelineStepName): ProjectStep;
  updateStepStatus(id: string, status: StepStatus, patch?: Partial<ProjectStep>): ProjectStep;

  // Generation attempts (append-only)
  recordAttempt(input: RecordAttemptInput): GenerationAttempt;
  acceptAttempt(attemptId: string, editedContent?: string): DocumentRevision;
  rejectAttempt(attemptId: string, reason?: string): void;
  listAttempts(projectStepId: string): GenerationAttempt[];

  // Revisions
  getCurrentRevision(projectStepId: string): DocumentRevision | undefined;
  listRevisions(projectStepId: string): DocumentRevision[];

  // Context assembly
  recordContextSnapshot(snapshot: ContextSnapshotInput): ContextSnapshot;
  getContextForStep(projectId: string, upToStepName: PipelineStepName): ContextSnapshot[];
}
```

### `ProviderRepository`

```typescript
interface ProviderRepository {
  upsertProvider(input: UpsertProviderInput): Provider;
  listProviders(): Provider[];
  findProvider(id: string): Provider | undefined;

  upsertProfile(providerId: string, input: UpsertProfileInput): ProviderProfile;
  listProfiles(providerId: string): ProviderProfile[];
  findProfile(providerId: string, profileName: string): ProviderProfile | undefined;
  deleteProfile(providerId: string, profileName: string): void;

  getActiveSelection(): ActiveProviderSelection | undefined;
  setActiveSelection(providerId: string, profileName: string): void;
  clearActiveSelection(): void;
}
```

### `SessionRepository`

```typescript
interface SessionRepository {
  startSession(input: StartSessionInput): Session;
  completeSession(id: string, exitCode: number, errorMessage?: string): Session;
  listSessions(projectId?: string, limit?: number): Session[];
}
```

---

## Migration System

Migrations are numbered SQL files stored under `cli/src/db/migrations/`. The migration runner is invoked automatically on every database open, before any repository method is called. It is idempotent: already-applied migrations are skipped based on the `migrations` table.

**Migration file naming convention**: `NNN_descriptive_name.sql` where `NNN` is a zero-padded three-digit integer (e.g. `001_initial_schema.sql`, `002_add_context_snapshots.sql`).

**Safety rules for migrations**:
- Migrations are immutable once committed. Amending a migration file after it has been applied to any database is forbidden; create a new migration instead.
- All schema changes in a migration run inside a single SQLite transaction. If any statement fails, the entire migration is rolled back.
- Destructive migrations (DROP TABLE, DROP COLUMN) are preceded by a data-preservation migration in the prior version.
- Every migration includes both an `up` function and a `down` function. The down function is used exclusively in test fixtures and developer rollback scenarios; it is never called in production without explicit operator intervention.

**Initial migration `001_initial_schema.sql` seeds**:
- All tables described in the Schema Design section above.
- All indexes.
- The ten canonical rows in `pipeline_steps`.
- WAL mode pragma (`PRAGMA journal_mode=WAL`).
- Foreign key enforcement pragma (`PRAGMA foreign_keys=ON`).
- Busy timeout (`PRAGMA busy_timeout=5000`) to prevent lock contention errors.

---

## Database Initialization and Connection Management

### Database Location

The database file lives at `<project-output-dir>/.filmbuff/filmbuff.db` for project-scoped data. Global data (provider profiles, active selection) lives at `~/.filmbuff/global.db` (or `%APPDATA%\filmbuff\global.db` on Windows). This separation allows:

- Project databases to be committed to git for team sharing (optional).
- Global databases to persist provider credentials independently of any project.
- Projects to be archived or deleted without affecting provider configuration.

### Connection Factory

```typescript
// cli/src/db/connection.ts
export function openProjectDatabase(projectDir: string): Database;
export function openGlobalDatabase(): Database;
export function withTransaction<T>(db: Database, fn: () => T): T;
```

The connection factory:
1. Resolves the database file path.
2. Creates the parent directory if it does not exist.
3. Opens the database with `better-sqlite3` in WAL mode.
4. Runs the migration runner.
5. Returns the connection, which is kept open for the lifetime of the CLI process (not opened and closed per query).

A single `DatabaseContext` singleton is used per process. The context is initialized lazily on the first repository method call and closed via a `process.on('exit')` handler.

### Error Handling

All repository methods wrap their operations in try/catch. SQLite-specific error codes are translated into typed FilmBuff errors:

| SQLite error | FilmBuff error class | Description |
|---|---|---|
| `SQLITE_CONSTRAINT_UNIQUE` | `DuplicateSlugError` | Project slug already exists |
| `SQLITE_BUSY` | `DatabaseBusyError` | Another process holds a write lock |
| `SQLITE_CORRUPT` | `DatabaseCorruptError` | WAL or database file is corrupted |
| `SQLITE_READONLY` | `DatabaseReadonlyError` | Database is on a read-only filesystem |

Each error class extends a base `FilmBuffDatabaseError` with `code`, `message`, and optional `context` fields, enabling command handlers to surface actionable messages to users (e.g., "Another filmbuff process is running. Wait for it to finish and retry.").

---

## Integration with Existing Codebase

### Provider Profile Migration

At startup, if `~/.filmbuff/global.db` does not exist but `.augment/providers/profiles/` does, the database layer runs a one-time migration that:
1. Reads all JSON profile files from `.augment/providers/profiles/`.
2. Reads `.augment/providers/active.json`.
3. Inserts all providers and profiles into `global.db` using `ProviderRepository.upsertProfile`.
4. Writes a `.augment/providers/.migrated` sentinel file so the migration is never run twice.
5. Leaves the original JSON files in place for one release cycle, then removes them in the next migration.

The concrete refactoring of `profileStore.ts` (retired) and `runtime-resolver.ts` (updated) to call `ProviderRepository` methods is specified in `ai-prompts/provider-resolution-JIRAt.md`. That ticket preserves the public API of `resolveActiveProvider()` and `resolveProviderByProfile()` so no command handler requires changes. The existing TypeScript interfaces (`ProviderProfile`, `ActiveProviderSelection`) are preserved as the canonical types; the database columns map directly to those interface fields.

### `resolveActiveProvider` Integration

After the database layer is implemented, `resolveActiveProvider()` in `runtime-resolver.ts` is updated to:
1. Call `ProviderRepository.getActiveSelection()` instead of reading `active.json` from disk.
2. Call `ProviderRepository.findProfile(providerId, profileName)` instead of reading a profile JSON file.
3. Resolve secrets through the existing `resolveSecrets()` helper, which is unchanged.

No changes are required to command handlers that call `resolveActiveProvider()`.

### Project State for the Document Pipeline

`filmbuff start` calls:
```
ProjectRepository.create(...)
DocumentRepository.initializeSteps(projectId)
SessionRepository.startSession(...)
```

`filmbuff continue` calls:
```
ProjectRepository.findBySlug(slug)
DocumentRepository.getStep(projectId, stepName)
DocumentRepository.recordAttempt(...)
DocumentRepository.recordContextSnapshot(...)
// ... AI call ...
DocumentRepository.acceptAttempt(attemptId)
DocumentRepository.updateStepStatus(...)
```

`filmbuff status` calls:
```
ProjectRepository.findBySlug(slug)
DocumentRepository.getStep(projectId, *) for each of the 10 steps
// No AI provider access required
```

`filmbuff retry` calls:
```
DocumentRepository.getStep(projectId, stepName)
DocumentRepository.rejectAttempt(lastAttemptId)
DocumentRepository.recordAttempt(...)  // new attempt
```

`filmbuff complete` calls:
```
DocumentRepository.getStep(projectId, stepName)
DocumentRepository.updateStepStatus(id, 'completed', { accepted_at: now })
```

---

## Security and Secret Handling

### API Key Storage Strategy

API keys must never be stored in plaintext in the database. Two approved storage strategies are supported, selected by the user at profile creation time:

**Strategy 1: Environment Variable Reference (Recommended)**
The `api_key_ref` column stores a string in the form `env:ANTHROPIC_API_KEY`. At runtime, `resolveSecrets()` substitutes the actual value from the process environment. The database contains no secret material.

**Strategy 2: Application-Level Encryption (Advanced)**
For users who cannot or will not use environment variables, the API key is encrypted with AES-256-GCM before storage. The encryption key is derived from a machine-specific secret (combining the machine UUID and a user-supplied passphrase) using PBKDF2. The `api_key_encrypted` column is set to `1`. Decryption happens in memory only during `resolveSecrets()`. The encryption key is never written to disk.

### Database File Permissions

On Unix-like systems, the global database file is created with mode `0600` (owner read/write only). On Windows, the file ACL is set to deny access to accounts other than the current user. The CLI emits a warning at startup if it detects that the global database is world-readable.

### Redaction in Logs and Output

The `sessions.flags` column stores CLI flags as JSON. Any flag whose name matches the pattern `*key*`, `*token*`, `*secret*`, or `*password*` is redacted to `[REDACTED]` before insertion, using the existing `redaction.ts` utility.

---

## CLI Provider Management Integration

The database layer directly enables the provider management CLI commands described in `ai-prompts/ai-providers-JIRA.md`. Each command maps to one or more `ProviderRepository` methods:

| CLI Command | Repository Method(s) |
|---|---|
| `filmbuff provider add <id> <profile>` | `upsertProvider` + `upsertProfile` |
| `filmbuff provider list` | `listProviders` + `listProfiles` |
| `filmbuff provider set <id> <profile>` | `setActiveSelection` |
| `filmbuff provider delete <id> <profile>` | `deleteProfile` |
| `filmbuff provider validate <id> <profile>` | `findProfile` + live API connectivity check |
| `filmbuff configure` (GUI flow) | Full read/write cycle through all `ProviderRepository` methods |
| `filmbuff gui` → Provider tab | `listProviders` + `listProfiles` + `getActiveSelection` |

### Custom Provider Extensibility

The `providers.provider_type` column (`builtin` or `custom`) supports the user-added provider model from `ai-prompts/ai-providers-JIRA.md`. Custom provider registration stores:

- A user-defined `id` slug as the primary key (e.g. `ollama-local`, `vllm-prod`).
- A `base_url` pointing to the provider's API endpoint (required for custom; optional for built-in).
- A `capabilities` JSON array from `ProviderCapability`: `text-generation`, `vision`, `embeddings`, etc.
- An optional `metadata` JSON object for provider-specific fields not covered by the standard schema.

Built-in providers (`anthropic`, `openai`, `google`) are seeded by the initial migration. Application logic prevents deleting the last profile for any built-in provider, preserving a minimum viable configuration. Community and open-source adapters (e.g. Ollama, LocalAI, vLLM) are registered using the same custom-provider path, with `base_url` pointing to the self-hosted endpoint.

### Per-Command Override Flag Tracking

When `--ai-provider` or `--ai-profile` override flags are supplied on any command, the resolved provider and profile are stored in `sessions.provider_id` and `sessions.profile_name`. This ensures the audit trail captures exactly which provider was used for each invocation, even when the per-command override differs from the globally active selection. `SessionRepository.startSession` accepts these as optional parameters populated from the runtime-resolved values.

### GUI Configuration Database Support

`filmbuff configure` presents a step-by-step GUI for provider setup. Its data flow against the database is:

1. **Select provider type**: `ProviderRepository.listProviders()` populates the provider picker (built-in and custom).
2. **Name the profile**: validated for uniqueness via `ProviderRepository.findProfile(providerId, profileName)`.
3. **Enter credentials**: stored as `env:<VAR>` reference or AES-256-GCM ciphertext per the Secret Handling strategy.
4. **Validate connectivity**: the repository retrieves the profile; the live API ping is performed outside the repository layer; the result is recorded in `sessions` as a validation event.
5. **Activate profile**: `ProviderRepository.setActiveSelection(providerId, profileName)` atomically clears the previous active flag and sets the new one.

`filmbuff gui` → Provider tab performs the same reads and writes through `ProviderRepository`, ensuring the GUI and CLI always reflect the same database state.

---

## Performance Considerations

### Query Performance

- All foreign key columns are indexed.
- The most frequent query pattern — loading all ten `project_steps` rows for a given project — is covered by the `(project_id, step_number)` index and returns in microseconds even with thousands of projects in the database.
- `generation_attempts` is the only table expected to grow unboundedly. The `started_at DESC` index supports efficient pagination for the `filmbuff status --all` command without a full table scan.
- `document_revisions.content` can be large (a full screenplay may be 100KB+). SQLite stores TEXT values inline up to 1MB before spilling to overflow pages. For content over 512KB, the repository layer optionally stores the content to disk at `output_file_path` and stores only the content hash and a `stored_on_disk` flag in the database, retrieving from disk on read.

### WAL Mode and Concurrency

WAL mode (`PRAGMA journal_mode=WAL`) is set on every database open. This allows `filmbuff status` (read) to run concurrently with `filmbuff continue` (write) without blocking. The busy timeout (`PRAGMA busy_timeout=5000`) gives writers up to five seconds to acquire the write lock before throwing `SQLITE_BUSY`, which is translated to a user-friendly `DatabaseBusyError`.

### Connection Lifetime

The database connection is opened once per process and reused. This amortizes the cost of WAL checkpoint negotiation, pragma application, and migration checking across the lifetime of the CLI command. Connections are never pooled (a CLI process is single-user) but are properly closed on process exit via `process.on('beforeExit', db.close)`.

---

## Testing Strategy

### Unit Tests

Unit tests for the database layer live under `cli/src/db/__tests__/`. Each repository class has a dedicated test file. Tests use an in-memory SQLite database (`:memory:`) opened fresh for each `it()` block so tests are fully isolated and fast.

Key unit test scenarios:
- Creating a project and verifying all ten `project_steps` rows are seeded correctly.
- Advancing a step through `pending → in_progress → completed` and verifying `project_steps.updated_at` is updated.
- Recording multiple generation attempts for the same step and verifying `attempt_number` increments correctly.
- Accepting an attempt with and without user edits, verifying `document_revisions.is_current` is set correctly.
- Setting the active provider and verifying the `provider_profiles.is_active` uniqueness constraint prevents two active profiles.
- Migration runner: verifying that a second open of the same database does not re-apply migrations.
- Verifying `DatabaseBusyError`, `DuplicateSlugError`, and `DatabaseCorruptError` are thrown for the correct SQLite error codes.

### Integration Tests

Integration tests live under `tests/integration/db/`. They use a real SQLite file in a temporary directory cleaned up after each test suite. They simulate the full command flow end-to-end:
- `filmbuff start` → database seeded with project and steps.
- `filmbuff continue` × 3 → three attempts recorded, third accepted.
- `filmbuff retry` → new attempt created, previous marked rejected.
- `filmbuff status` → reads from database only, no filesystem reads.
- Provider profile migration from JSON files to database.

### Migration Tests

A dedicated test file verifies:
- The `001_initial_schema` migration produces the exact expected table list.
- Applying the same migration twice is idempotent.
- A checksum mismatch on a previously applied migration throws a `MigrationTamperedError`.

---

## Implementation Plan and Estimated Effort

| Phase | Deliverable | Estimated Hours |
|---|---|---|
| 1 | Schema design, ERD, ADR for engine selection | 6 |
| 2 | `001_initial_schema.sql` migration + migration runner | 8 |
| 3 | `ProjectRepository` + unit tests | 8 |
| 4 | `DocumentRepository` (steps, attempts, revisions, context) + unit tests | 16 |
| 5 | `ProviderRepository` + secret handling + unit tests | 10 |
| 6 | `SessionRepository` + unit tests | 4 |
| 7 | Connection factory, `DatabaseContext` singleton, error translation | 6 |
| 8 | Profile JSON → database migration shim | 6 |
| 9 | Integration with `runtime-resolver.ts` (refactored) and `profile-store.ts` (retired) — see `ai-prompts/provider-resolution-JIRAt.md` | 8 |
| 10 | Integration tests (full pipeline simulation) | 10 |
| 11 | Performance profiling, WAL tuning, large-content handling | 4 |
| 12 | Documentation: API reference, schema diagram, migration guide | 6 |
| **Total** | | **92 hours** |

---

## Acceptance Criteria

- All ten `project_steps` rows are created atomically when `filmbuff start` creates a new project; no step row can exist without an owning project row.
- `filmbuff continue` persists the full text of every generated document in `generation_attempts.raw_output` before the user is prompted for acceptance.
- `filmbuff status` reads all step statuses exclusively from the database and does not read from the filesystem.
- `filmbuff retry` records a new `generation_attempts` row with `attempt_number` incremented and marks the previous attempt as `rejected`; no prior attempt row is deleted or mutated.
- Accepted documents are stored in `document_revisions` with `is_current = 1`; prior revisions have `is_current = 0`; both are retained indefinitely.
- The active provider selection enforces uniqueness: setting a new active profile automatically clears the previous `is_active` flag.
- API keys stored as environment-variable references are never written to disk as plaintext; API keys encrypted at rest use AES-256-GCM with a PBKDF2-derived key.
- The migration runner applies each migration exactly once; a second process opening the same database finds migrations already applied and skips them.
- A `SQLITE_BUSY` error is surfaced as a `DatabaseBusyError` with a human-readable message and a suggested recovery action.
- The global database file is created with restrictive permissions (mode `0600` on Unix); the CLI warns if the file is world-readable.
- The existing `resolveActiveProvider()` function continues to work without modification by command handlers after the database layer is integrated.
- Existing provider JSON profile files under `.augment/providers/profiles/` are migrated automatically to the database on first run; subsequent runs skip the migration.
- `ProviderRepository.deleteProfile` refuses to remove the last profile for a built-in provider (`anthropic`, `openai`, `google`) and throws a typed `BuiltinProviderProtectedError` instead.
- Custom providers can be registered with a user-defined slug, a required `base_url`, and a `capabilities` JSON array; the resulting rows are queryable through the same `ProviderRepository` methods used for built-in providers.
- `filmbuff configure` and `filmbuff gui` read and write provider and profile state exclusively through `ProviderRepository`; no GUI code path reads or writes JSON provider files directly.
- When `--ai-provider` or `--ai-profile` override flags are supplied on any command, the resolved values are recorded in `sessions.provider_id` and `sessions.profile_name` before any AI generation begins.
- Unit tests run against an in-memory SQLite database and complete in under five seconds total.
- Integration tests run against a temporary file-backed SQLite database and simulate the full ten-step pipeline flow from creation to completion.
- The database layer passes TypeScript strict-mode type checking with zero `any` usages in repository classes.

---

## Attachments and References

- Film document pipeline specification: `ai-prompts/film-docs-JIRA.md`
- AI provider configuration specification: `ai-prompts/ai-providers-JIRA.md`
- Provider resolution migration ticket (retires `profile-store.ts`, refactors `runtime-resolver.ts`): `ai-prompts/provider-resolution-JIRAt.md`
- Profile store (deprecated — retired by `provider-resolution-JIRAt.md`): `cli/src/utils/profile-store.ts`
- Runtime resolver (refactored by `provider-resolution-JIRAt.md`): `cli/src/utils/runtime-resolver.ts`
- Config system (updated by `provider-resolution-JIRAt.md`): `cli/src/utils/config-system.ts`
- AI provider types: `cli/src/types/ai-providers.ts`
- Database design guidelines module: `augment-extensions/domain-rules/database/`
- Project context: `openspec/project-context.md`
- `better-sqlite3` documentation: https://github.com/WiseLibs/better-sqlite3
- Kysely query builder documentation: https://kysely.dev/docs/intro
- libsql/Turso SQLite cloud sync: https://docs.turso.tech/libsql
