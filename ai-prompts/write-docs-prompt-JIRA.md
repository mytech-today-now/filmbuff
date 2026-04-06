# JIRA Ticket: FB-0042

---

## Summary

Refactor `document_revisions` storage: remove `content` TEXT blob from SQLite; use Git as the canonical document store with file-path pointer.

---

## Type
`Story`

## Priority
`High`

## Component
`cli / database / storage`

## Labels
`architecture`, `refactor`, `sqlite`, `git-integration`, `hybrid-storage`

## Fix Version
`v2.7.0`

## Assignee
`Unassigned`

## Reporter
`Kyle Rode`

## Epic Link
`FilmBuff Pipeline — Storage Architecture`

---

## Description

### Background

The FilmBuff CLI orchestrates a 10-step screenplay production pipeline (`filmbuff start → continue → complete`). Each pipeline step produces a document artifact — a `.md`, `.fountain`, or `.json` file — written to disk under `output/<slug>/`. When a user runs `filmbuff complete`, the command currently:

1. Reads the accepted file from disk into a `content` string variable.
2. Passes that string to `DocumentRepository.saveRevision()`.
3. `saveRevision()` stores the full prose text in the `document_revisions.content TEXT NOT NULL` column in `filmbuff.db`.

This means the document content is stored **twice**: once as a file on disk (which Git can track, diff, and version), and once as an opaque TEXT blob in SQLite (which cannot be diffed, browsed, or version-controlled natively). This duplication:

- Bloats `filmbuff.db` with large text blobs (a feature screenplay alone can exceed 100,000 tokens).
- Prevents Git's native `git diff`, `git log -p`, and GitHub PR review from working on screenplay content.
- Is architecturally inconsistent with how the `filmbuff continue` command already works — it reads prior step content directly from `fs.readFileSync(step.output_file_path)`, bypassing the DB's `content` column entirely.

### Proposed Solution — Hybrid Storage Model

> **Git owns the documents. SQLite owns the metadata and audit trail.**

The `document_revisions.content` column is removed. In its place, a new `output_file_path TEXT NOT NULL` column stores the absolute path to the accepted file on disk. The file is then committed to Git automatically by `filmbuff complete`, making every accepted pipeline step a discrete, reviewable git commit.

**SQLite retains ownership of:**
- Project state machine (`projects`, `project_steps`)
- Generation attempt audit log (`generation_attempts`) — token counts, model IDs, prompt hashes, cost data
- Context assembly snapshots (`context_snapshots`)
- CLI invocation session log (`sessions`)
- Document revision metadata — `content_hash`, `content_size_bytes`, `revision_number`, `is_current`, `accepted_at`, format

**Git gains ownership of:**
- The actual document prose: `output/roofing-commercial/logline.md`, `output/roofing-commercial/synopsis.md`, etc.

### Storage Model Comparison

| | Before (DB-heavy) | After (Hybrid) |
|---|---|---|
| Document prose | SQLite `content` TEXT blob | File on disk, committed to Git |
| Integrity verification | Implicit (DB transaction) | `content_hash` in SQLite + Git commit SHA |
| Diff / review | Not possible | `git diff`, `git log -p`, GitHub PR |
| DB size | Grows with each accepted step | Stable — only metadata rows |
| Context assembly (`continue`) | Unused — already reads from disk | No change needed |

---

## Scope of Work

This story covers **5 discrete, ordered changes** across the database layer, TypeScript types, repository class, command handler, and test suite. No other tables, commands, or files are affected.

### Subtask 1 — Create SQL migration `002_hybrid_storage.sql`

**File:** `cli/src/db/migrations/002_hybrid_storage.sql`

SQLite versions prior to 3.35.0 do not support `ALTER TABLE … DROP COLUMN`. The migration must use the standard SQLite table-rebuild pattern:

1. `CREATE TABLE document_revisions_new` — identical schema minus `content`, plus `output_file_path TEXT NOT NULL`.
2. `INSERT INTO document_revisions_new … SELECT … FROM document_revisions LEFT JOIN project_steps` — backfill `output_file_path` from `project_steps.output_file_path` using `COALESCE(ps.output_file_path, '')`.
3. `DROP TABLE document_revisions`.
4. `ALTER TABLE document_revisions_new RENAME TO document_revisions`.
5. Recreate three indexes: `idx_doc_revisions_step_current`, `idx_doc_revisions_attempt`, `idx_doc_revisions_hash`.

**Constraint:** `001_initial_schema.sql` MUST NOT be modified. The migration runner (`cli/src/db/migration-runner.ts`) computes a SHA-256 checksum of every applied migration file on startup and throws `MigrationTamperedError` if a checksum mismatch is detected. Any edit to `001_initial_schema.sql` will break all existing databases.

### Subtask 2 — Update `DocumentRevision` TypeScript interface

**File:** `cli/src/db/types.ts` — `DocumentRevision` interface (currently lines 119–133)

- **Remove:** `content: string`
- **Add:** `output_file_path: string` (positioned between `revision_number` and `content_hash` to match the new DDL column order)

This interface is the TypeScript mirror of the database row. It is imported by `document-repository.ts`, `complete.ts`, and any consumer that calls `getCurrentRevision()` or `listRevisions()`. TypeScript will surface compile errors at every downstream usage site after this change, making the full impact immediately visible via `npx tsc --noEmit`.

### Subtask 3 — Refactor `DocumentRepository` class

**File:** `cli/src/db/document-repository.ts`

Three co-located changes are required:

**3a — `SaveRevisionInput` interface:**
- Remove `content: string`
- Add `output_file_path: string` (absolute path to the accepted file; the repository reads the file itself to compute hash and size)

**3b — `INSERT_REVISION` SQL constant:**
Replace the `content` bind parameter with `output_file_path` in both the column list and the `VALUES` clause.

**3c — `saveRevision()` method body:**
The method currently accepts `input.content` directly and computes hash/size from it. After this change it must:
1. Call `fs.readFileSync(input.output_file_path, 'utf-8')` to load the file.
2. Compute `contentHash` and `sizeBytes` from the file content as before.
3. Pass `output_file_path` (not `content`) to the `INSERT_REVISION` prepared statement.
4. Never store the prose string in the database.

The `fs` module is already imported in the file (`import * as fs from 'fs'`). No new dependencies are required.

The three `generation_attempts` methods (`recordAttempt`, `completeAttempt`, `acceptAttempt`, `rejectAttempt`, `getAttempt`, `listAttempts`) are **not changed**.

### Subtask 4 — Update `filmbuff complete` command handler

**File:** `cli/src/commands/complete.ts`

**4a — Remove redundant file read:**
The command currently reads the file into a `content` variable and passes it to `saveRevision`. Remove `const content = fs.readFileSync(absPath, 'utf-8')` and update the `saveRevision` call to pass `output_file_path: absPath` instead of `content`.

**4b — Add non-fatal git commit step:**
After `projectRepo.updateStep(...)` succeeds, add a try/catch block that:
1. Calls `execSync('git rev-parse --show-toplevel')` to locate the git root.
2. Computes the relative path from the git root to `absPath` using `path.relative()`.
3. Calls `git add "<relPath>"` then `git commit -m "feat(<step>): accept revision <N> for <slug> [step <stepNum>]"`.
4. Logs `chalk.gray('  Git commit: ...')` on success.
5. On any error (non-git directory, no changes to commit, git not installed), catches the exception, logs `chalk.yellow('⚠ git commit skipped: <reason>')`, and continues without throwing. The command must still exit with code 0.

**Revision number in commit message:** Capture the return value of `documentRepo.saveRevision(...)` into a `const revision` variable and use `revision.revision_number` in the commit message template.

**New import required:** `import { execSync } from 'child_process';` at the top of the file. The `path` module is already imported.

### Subtask 5 — Update unit tests

**File:** `cli/src/__tests__/db/repositories.test.ts`

The `DocumentRepository` describe block contains five `saveRevision` call sites (approximately lines 175, 181, 182, 194, 195) that pass `content: string`. These must be updated to pass `output_file_path: string` pointing to a real temporary file, because `saveRevision` now calls `fs.readFileSync` internally.

**Pattern to apply at each call site:**

```typescript
// Add helper inside describe block (or beforeEach):
function writeTempFile(content: string): string {
  const filePath = path.join(os.tmpdir(), `filmbuff-test-${Date.now()}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// Replace: content: 'Hello.'
// With:    output_file_path: writeTempFile('Hello.')
```

Add `import * as os from 'os'` at the top of the test file if not already present.

Update any assertion that reads `rev.content` — the field no longer exists on `DocumentRevision`. Substitute `rev.output_file_path` (to verify the pointer) or `rev.content_hash` (to verify integrity).

---

## Files Changed

| File | Action | Reason |
|---|---|---|
| `cli/src/db/migrations/002_hybrid_storage.sql` | **Create** | New migration to rebuild `document_revisions` table |
| `cli/src/db/types.ts` | **Modify** | Remove `content`, add `output_file_path` on `DocumentRevision` |
| `cli/src/db/document-repository.ts` | **Modify** | Update `SaveRevisionInput`, SQL, and `saveRevision()` method |
| `cli/src/commands/complete.ts` | **Modify** | Update `saveRevision` call + add git commit step |
| `cli/src/__tests__/db/repositories.test.ts` | **Modify** | Update `saveRevision` test call sites to use temp file paths |

## Files Explicitly NOT Changed

| File | Reason |
|---|---|
| `cli/src/db/migrations/001_initial_schema.sql` | Checksum-guarded — any edit throws `MigrationTamperedError` |
| `cli/src/commands/continue.ts` | Already reads content from disk via `fs.readFileSync(step.output_file_path)` |
| `cli/src/commands/start.ts` | No interaction with `document_revisions` |
| `cli/src/db/index.ts` | No new exports required |
| `cli/src/commands/generate-shot-list/` | Standalone tool; already writes to disk only |
| All `generation_attempts` methods | Audit trail behavior is unchanged |
| `context_snapshots` table | Context assembly already reads files from disk |

---

## Edge Cases and Risk Notes

### External Output Directories
If a user initializes a project with `filmbuff start --output-dir /external/path`, that directory may not be inside a Git repository. `git rev-parse --show-toplevel` will fail with a non-zero exit code. This is handled by the try/catch in Subtask 4b — the command logs a yellow warning and completes successfully. The `content_hash` stored in `document_revisions` provides integrity verification even when Git is unavailable.

### Empty `output_file_path` After Migration Backfill
The `002_hybrid_storage.sql` migration backfills `output_file_path` using `COALESCE(ps.output_file_path, '')`. For any existing `document_revisions` rows where the associated `project_steps` row has a NULL `output_file_path`, the backfilled value will be an empty string. This is a best-effort migration for existing data; new rows written after this migration will always have a valid absolute path because `filmbuff complete` validates file existence before touching the database (`fs.existsSync` check at line ~60 of `complete.ts`).

### SQLite Version Compatibility
The table-rebuild pattern in `002_hybrid_storage.sql` is compatible with all SQLite versions ≥ 3.25.0 (which introduced `ALTER TABLE … RENAME TO`). The `better-sqlite3` package requires Node.js ≥ 14.21.1 and ships with SQLite 3.43+, so this is a non-issue in practice. The explicit comment in the migration SQL documents the reasoning for future maintainers.

### Git Not Installed
If the `git` binary is not in `PATH`, `execSync('git rev-parse ...')` will throw `ENOENT`. The try/catch in Subtask 4b handles this identically to the non-git-repo case — warning and continue.

---

## Verification / Definition of Done

All of the following must be true before this story is marked `Done`:

- [ ] `cli/src/db/migrations/002_hybrid_storage.sql` exists and applies cleanly on a fresh database via `runMigrations()`.
- [ ] `cli/src/db/migrations/002_hybrid_storage.sql` applies cleanly on a database that already has `001_initial_schema.sql` applied (upgrade path verified).
- [ ] The `document_revisions` table has `output_file_path TEXT NOT NULL` and does **not** have a `content` column.
- [ ] `DocumentRevision` TypeScript interface has `output_file_path: string` and does **not** have `content`.
- [ ] `SaveRevisionInput` has `output_file_path: string` and does **not** have `content`.
- [ ] `saveRevision()` reads the file from disk (via `fs.readFileSync`) to compute `content_hash` and `content_size_bytes` but does not insert prose into the database.
- [ ] `filmbuff complete` calls `saveRevision({ output_file_path: absPath, ... })` — not `content`.
- [ ] `filmbuff complete` performs `git add` + `git commit` after a successful step acceptance.
- [ ] A git commit failure (non-git dir, git not installed) logs a `⚠` warning and exits with code `0`.
- [ ] All five `saveRevision` call sites in `repositories.test.ts` use `output_file_path` pointing to a temp file.
- [ ] No `rev.content` assertions remain in any test file.
- [ ] `npx tsc --noEmit` from `cli/` reports **zero** errors.
- [ ] `npx jest --no-coverage` from `cli/` passes **all** tests.
- [ ] `npm run build` from `cli/` compiles without error.

---

## Test Commands

```bash
cd cli

# 1. TypeScript type check — must be zero errors
npx tsc --noEmit

# 2. Repository unit tests — covers saveRevision changes
npx jest src/__tests__/db/repositories.test.ts --no-coverage

# 3. Integration tests — end-to-end pipeline flow
npx jest src/__tests__/db/pipeline.integration.test.ts --no-coverage

# 4. Full test suite
npx jest --no-coverage

# 5. Compile to dist/
npm run build
```

---

## Related Files for Context

| File | Purpose |
|---|---|
| `ai-prompts/write-docs-prompt.md` | Full architecture reference — DDL, repository signatures, data flow |
| `ai-prompts/write-docs-prompt-updated.md` | Implementation prompt with exact before/after code for all 5 changes |
| `cli/src/db/migrations/001_initial_schema.sql` | Current schema source of truth |
| `cli/src/db/document-repository.ts` | Repository class being refactored |
| `cli/src/db/types.ts` | TypeScript domain types being updated |
| `cli/src/commands/complete.ts` | Command handler being updated |
| `cli/src/__tests__/db/repositories.test.ts` | Test file being updated |

