# FilmBuff CLI — Hybrid Git/SQLite Storage Migration Prompt

## Purpose

This prompt instructs Augment Code AI to refactor the FilmBuff CLI to implement the **Recommended Hybrid Storage Model**: Git owns document content on disk; SQLite owns metadata, state, and the audit trail. This eliminates the redundant `document_revisions.content` TEXT blob, reduces database bloat, and leverages Git's native diffing and history for all prose artifacts.

**Context prerequisite:** Read `ai-prompts/write-docs-prompt.md` first. It contains the full architecture reference, DDL, repository signatures, and data-flow walkthrough that this prompt builds on.

---

## Goal Summary

> "Let git own the documents. Let SQLite own the metadata and audit trail."

| Store | Owns |
|---|---|
| **Git** (`output/<slug>/`) | Document content — `.md`, `.fountain`, `.json` |
| **SQLite** (`filmbuff.db`) | Project state, step status, generation attempt audit, token counts, session log |

The `document_revisions.content` TEXT column is the only thing being removed. Every other table, column, and behavior stays the same.

---

## Exact Changes Required

### Change 1 — New SQL Migration: `002_hybrid_storage.sql`

**File to create:** `cli/src/db/migrations/002_hybrid_storage.sql`

This migration drops the `content` column from `document_revisions` and adds an `output_file_path` column to point to the file on disk. SQLite does not support `DROP COLUMN` in versions prior to 3.35.0, so use a table-rebuild pattern.

```sql
-- Migration: 002_hybrid_storage
-- Description: Remove document_revisions.content blob; add output_file_path pointer.
-- SQLite <3.35 does not support DROP COLUMN — use table-rebuild pattern.

-- Step 1: Create replacement table (no `content` column, adds `output_file_path`)
CREATE TABLE IF NOT EXISTS document_revisions_new (
  id                    TEXT    PRIMARY KEY,
  project_step_id       TEXT    NOT NULL REFERENCES project_steps(id),
  generation_attempt_id TEXT    REFERENCES generation_attempts(id),
  revision_number       INTEGER NOT NULL,
  output_file_path      TEXT    NOT NULL,   -- NEW: canonical path to file on disk
  content_hash          TEXT    NOT NULL,
  content_size_bytes    INTEGER NOT NULL,
  format                TEXT    NOT NULL CHECK (format IN ('md','json','fountain','pdf')),
  is_current            INTEGER NOT NULL DEFAULT 1,
  accepted_by           TEXT,
  accepted_at           TEXT    NOT NULL,
  notes                 TEXT
);

-- Step 2: Copy existing rows (map output_file_path from project_steps.output_file_path)
INSERT INTO document_revisions_new
  (id, project_step_id, generation_attempt_id, revision_number,
   output_file_path, content_hash, content_size_bytes, format,
   is_current, accepted_by, accepted_at, notes)
SELECT
  dr.id,
  dr.project_step_id,
  dr.generation_attempt_id,
  dr.revision_number,
  COALESCE(ps.output_file_path, ''),   -- best-effort backfill from project_steps
  dr.content_hash,
  dr.content_size_bytes,
  dr.format,
  dr.is_current,
  dr.accepted_by,
  dr.accepted_at,
  dr.notes
FROM document_revisions dr
LEFT JOIN project_steps ps ON ps.id = dr.project_step_id;

-- Step 3: Swap tables
DROP TABLE document_revisions;
ALTER TABLE document_revisions_new RENAME TO document_revisions;

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_doc_revisions_step_current ON document_revisions(project_step_id, is_current);
CREATE INDEX IF NOT EXISTS idx_doc_revisions_attempt      ON document_revisions(generation_attempt_id);
CREATE INDEX IF NOT EXISTS idx_doc_revisions_hash         ON document_revisions(content_hash);
```

**Important:** Do NOT modify `001_initial_schema.sql`. The migration runner verifies checksums and will throw `MigrationTamperedError` if it is changed.

---

### Change 2 — Update `DocumentRevision` type in `cli/src/db/types.ts`

**File:** `cli/src/db/types.ts`  
**Interface to modify:** `DocumentRevision` (lines 119–133)

Remove the `content: string` field. Add `output_file_path: string`.

**Before:**
```typescript
export interface DocumentRevision {
  id:                    string;
  project_step_id:       string;
  generation_attempt_id: string | null;
  revision_number:       number;
  content:               string;        // <-- REMOVE THIS
  content_hash:          string;
  content_size_bytes:    number;
  format:                DocumentFormat;
  is_current:            number;
  accepted_by:           string | null;
  accepted_at:           string;
  notes:                 string | null;
}
```

**After:**
```typescript
export interface DocumentRevision {
  id:                    string;
  project_step_id:       string;
  generation_attempt_id: string | null;
  revision_number:       number;
  output_file_path:      string;        // <-- ADDED: path to file on disk
  content_hash:          string;
  content_size_bytes:    number;
  format:                DocumentFormat;
  is_current:            number;
  accepted_by:           string | null;
  accepted_at:           string;
  notes:                 string | null;
}
```

---

### Change 3 — Refactor `DocumentRepository` in `cli/src/db/document-repository.ts`

**File:** `cli/src/db/document-repository.ts`

#### 3a — Update `SaveRevisionInput`

Remove `content: string`. Add `output_file_path: string`. The repository no longer receives or stores prose content.

**Before:**
```typescript
export interface SaveRevisionInput {
  id:                      string;
  project_step_id:         string;
  generation_attempt_id?:  string;
  content:                 string;      // <-- REMOVE
  format:                  DocumentFormat;
  accepted_by?:            string;
  notes?:                  string;
}
```

**After:**
```typescript
export interface SaveRevisionInput {
  id:                      string;
  project_step_id:         string;
  generation_attempt_id?:  string;
  output_file_path:        string;      // <-- ADDED: absolute path to accepted file
  format:                  DocumentFormat;
  accepted_by?:            string;
  notes?:                  string;
}
```

#### 3b — Update `INSERT_REVISION` SQL constant

**Before:**
```typescript
const INSERT_REVISION = `
  INSERT INTO document_revisions
    (id, project_step_id, generation_attempt_id, revision_number,
     content, content_hash, content_size_bytes, format,
     is_current, accepted_by, accepted_at, notes)
  VALUES
    (@id, @project_step_id, @generation_attempt_id, @revision_number,
     @content, @content_hash, @content_size_bytes, @format,
     1, @accepted_by, @now, @notes)
`;
```

**After:**
```typescript
const INSERT_REVISION = `
  INSERT INTO document_revisions
    (id, project_step_id, generation_attempt_id, revision_number,
     output_file_path, content_hash, content_size_bytes, format,
     is_current, accepted_by, accepted_at, notes)
  VALUES
    (@id, @project_step_id, @generation_attempt_id, @revision_number,
     @output_file_path, @content_hash, @content_size_bytes, @format,
     1, @accepted_by, @now, @notes)
`;
```

#### 3c — Refactor `saveRevision()` method

The method must read file content from disk (to compute the hash and size) but must NOT store it in the database.

**Before (existing method body):**
```typescript
saveRevision(input: SaveRevisionInput): DocumentRevision {
  const now          = new Date().toISOString();
  const contentHash  = crypto.createHash('sha256').update(input.content).digest('hex');
  const sizeBytes    = Buffer.byteLength(input.content, 'utf8');
  // ... inserts @content into DB
}
```

**After (new method body):**
```typescript
import * as fs from 'fs';  // ensure this import exists at top of file

saveRevision(input: SaveRevisionInput): DocumentRevision {
  const now      = new Date().toISOString();
  // Read file from disk to compute hash/size; do NOT store prose in DB
  const content  = fs.readFileSync(input.output_file_path, 'utf-8');
  const contentHash  = crypto.createHash('sha256').update(content).digest('hex');
  const sizeBytes    = Buffer.byteLength(content, 'utf8');

  const { next_num } = this.db
    .prepare(NEXT_REVISION_NUMBER)
    .get(input.project_step_id) as { next_num: number };

  try {
    this.db.transaction(() => {
      this.db.prepare(MARK_ALL_NON_CURRENT).run(input.project_step_id);
      this.db.prepare(INSERT_REVISION).run({
        id:                      input.id,
        project_step_id:         input.project_step_id,
        generation_attempt_id:   input.generation_attempt_id ?? null,
        revision_number:         next_num,
        output_file_path:        input.output_file_path,   // <-- pointer, not blob
        content_hash:            contentHash,
        content_size_bytes:      sizeBytes,
        format:                  input.format,
        accepted_by:             input.accepted_by ?? null,
        notes:                   input.notes       ?? null,
        now,
      });
    })();
  } catch (err) { throw translateSQLiteError(err); }

  return this.db
    .prepare(SELECT_CURRENT_REVISION)
    .get(input.project_step_id) as DocumentRevision;
}
```

---

### Change 4 — Update `filmbuff complete` in `cli/src/commands/complete.ts`

**File:** `cli/src/commands/complete.ts`

#### 4a — Remove content read from `saveRevision` call

The `completeCommand` currently reads the file into `content` and passes it to `saveRevision`. With the new signature, pass `output_file_path` instead.

**Before (lines ~111–124):**
```typescript
const now    = new Date().toISOString();
const format = options.format ?? 'md';
const absPath = fs.realpathSync(options.file);
const content = fs.readFileSync(absPath, 'utf-8');  // <-- REMOVE THIS LINE

// Save document revision
documentRepo.saveRevision({
  id:              crypto.randomUUID(),
  project_step_id: targetStep.id,
  content,                              // <-- REMOVE (was passing blob)
  format,
  accepted_by:     options.provider ?? undefined,
  notes:           options.notes,
});
```

**After:**
```typescript
const now     = new Date().toISOString();
const format  = options.format ?? 'md';
const absPath = fs.realpathSync(options.file);

// Save document revision — file stays on disk; DB only stores the pointer
documentRepo.saveRevision({
  id:               crypto.randomUUID(),
  project_step_id:  targetStep.id,
  output_file_path: absPath,            // <-- pointer to file
  format,
  accepted_by:      options.provider ?? undefined,
  notes:            options.notes,
});
```

#### 4b — Add git commit step (after `projectRepo.updateStep`)

After `saveRevision` and `projectRepo.updateStep`, commit the output file to git. Add this block **before** `sessionRepo.completeSession(sessionId, 0)`:

```typescript
import { execSync } from 'child_process';  // add to imports at top of file

// Git-commit the accepted output file (Hybrid Storage Model).
// The file is already on disk; this records it in git history.
// Falls back gracefully if git is not available or output_dir is not a git repo.
try {
  const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  const relPath  = path.relative(repoRoot, absPath);
  execSync(`git add "${relPath}"`, { cwd: repoRoot });
  const stepNum  = targetStep.step_number;
  const slug     = project.slug;
  const rev      = `revision ${/* computed by saveRevision */ 1}`;  // see note below
  execSync(
    `git commit -m "feat(${options.step}): accept ${rev} for ${slug} [step ${stepNum}]"`,
    { cwd: repoRoot }
  );
  console.log(chalk.gray(`  Git commit: feat(${options.step}): accept for ${slug}`));
} catch (gitErr) {
  // Non-fatal: log warning but do not fail the command
  console.warn(chalk.yellow(`⚠ git commit skipped: ${gitErr instanceof Error ? gitErr.message : gitErr}`));
}
```

**Note on revision number:** To include the revision number in the commit message, capture the return value of `documentRepo.saveRevision(...)` into a variable (e.g., `const revision = documentRepo.saveRevision(...)`), then use `revision.revision_number` in the commit message string.

---

### Change 5 — Update existing tests in `cli/src/__tests__/db/repositories.test.ts`

**File:** `cli/src/__tests__/db/repositories.test.ts`

The `DocumentRepository` tests that call `saveRevision` pass `content: string`. These must be updated to pass `output_file_path: string` instead. The test file uses an in-memory SQLite database, so mock the file path with a real temp file or mock `fs.readFileSync`.

**Strategy:** Before each `saveRevision` test, write a small temp file and pass its path:

```typescript
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// In the DocumentRepository describe block, add a helper:
function writeTempFile(content: string): string {
  const filePath = path.join(os.tmpdir(), `filmbuff-test-${Date.now()}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// Replace existing saveRevision calls:

// BEFORE:
docRepo.saveRevision({ id: 'rev-1', project_step_id: stepId, content: 'Hello.', format: 'md' });

// AFTER:
const tmpPath = writeTempFile('Hello.');
docRepo.saveRevision({ id: 'rev-1', project_step_id: stepId, output_file_path: tmpPath, format: 'md' });
```

Apply this pattern to **all** `saveRevision` call sites in the test file (lines 175, 181, 182, 194, 195).

Also update any assertion that checks `rev.content` — the `DocumentRevision` no longer has a `content` field. Replace with `rev.output_file_path` or `rev.content_hash`.

---

## What Does NOT Change

The following files and behaviors are **unchanged** by this migration:

| File / Behavior | Reason |
|---|---|
| `cli/src/commands/continue.ts` | Already reads content from `fs.readFileSync(step.output_file_path)` — no change needed |
| `cli/src/db/migrations/001_initial_schema.sql` | Must not be modified — checksum guard will reject any edit |
| `generation_attempts` table and `DocumentRepository` attempt methods | Unaffected — audit trail stays in DB |
| `context_snapshots` table | Unaffected — context assembly already reads from disk files |
| `sessions` table | Unaffected |
| `projects` / `project_steps` tables | Unaffected — state machine stays in DB |
| `generate-shot-list` command | Already writes to disk only; no DB change needed |

---

## The One Complication: External Output Directories

If a user runs `filmbuff start --output-dir /some/external/path`, that directory may not be inside a git repository. In that case, `git rev-parse --show-toplevel` will fail.

**Required fallback behavior (already handled by the try/catch in Change 4b):**
- If `git rev-parse` fails → log `⚠ git commit skipped` and continue without error.
- The file is still accepted and the SQLite pointer is still saved.
- The `content_hash` in `document_revisions` provides integrity verification even without git.

**Optional enhancement (do not implement unless explicitly requested):**
- Detect non-git output dirs on `filmbuff start` and warn the user.
- Offer `--no-git-commit` flag to suppress the git step entirely.

---

## Build and Test Commands

After implementing all changes, verify with:

```bash
# From repo root
cd cli

# Type-check
npx tsc --noEmit

# Run repository unit tests (covers saveRevision changes)
npx jest src/__tests__/db/repositories.test.ts --no-coverage

# Run integration tests
npx jest src/__tests__/db/pipeline.integration.test.ts --no-coverage

# Full test suite
npx jest --no-coverage

# Build
npm run build
```

All tests must pass before the migration is considered complete.

---

## Acceptance Criteria

- [ ] `002_hybrid_storage.sql` migration exists and runs cleanly via the migration runner.
- [ ] `document_revisions` table has `output_file_path TEXT NOT NULL` and **no** `content` column.
- [ ] `DocumentRevision` TypeScript interface has `output_file_path` and **no** `content`.
- [ ] `SaveRevisionInput` has `output_file_path` and **no** `content`.
- [ ] `saveRevision()` reads the file from disk to compute hash/size but does not store prose.
- [ ] `filmbuff complete` passes `output_file_path` to `saveRevision` (not `content`).
- [ ] `filmbuff complete` runs a `git add` + `git commit` after accepting a step.
- [ ] git commit is non-fatal — failure logs a warning and the command still succeeds.
- [ ] All existing tests updated to use `output_file_path` instead of `content`.
- [ ] `npx tsc --noEmit` reports zero errors.
- [ ] `npx jest` passes all tests.

