/**
 * FilmBuff Public Database API
 *
 * Single barrel entry point for all database access.  Command handlers and
 * other consumers MUST import from this file only.  They must never import
 * `better-sqlite3` directly or write raw SQL outside of repository classes.
 *
 * Current exports (Batch 1 — buff-core.01.03.02):
 *   • Error taxonomy  — typed error classes + translateSQLiteError()
 *   • Redaction       — redactSessionFlags()
 *   • Domain types    — row types, input types, status unions
 *
 * Current exports (Batch 2):
 *   • connection      — openDatabase(), closeDatabase(), withTransaction() [bd-db-a3]
 *   • migration-runner — runMigrations()                                  [bd-db-a2]
 *   • provider-shim   — migrateProvidersFromJson()                        [bd-db-a12]
 *
 * Current exports (Batch 3):
 *   • ProjectRepository   (+ ProjectStepPatch)     [bd-db-a5]
 *   • DocumentRepository  (+ CompleteAttemptPatch, SaveRevisionInput) [bd-db-a6]
 *   • ProviderRepository                           [bd-db-a7]
 *
 * Current exports (Batch 4):
 *   • SessionRepository                            [bd-db-a8]
 *
 * Current exports (Batch 5 — bd-int-d3):
 *   • performance — measure(), measureAsync(), walStats(), pragmaReport()
 *
 * Satisfies: bd-db-a11  buff-core.01.03.02 - Export public DB API from
 *            cli/src/db/index.ts
 *            bd-int-d3  buff-core.04.01.03 - Performance profiling and WAL tuning
 */

// ---------------------------------------------------------------------------
// Error taxonomy + session-flag redaction
// ---------------------------------------------------------------------------
export {
  // Base
  FilmBuffDatabaseError,
  // Typed errors
  DuplicateSlugError,
  DatabaseBusyError,
  DatabaseCorruptError,
  DatabaseReadonlyError,
  MigrationTamperedError,
  BuiltinProviderProtectedError,
  // Helpers
  translateSQLiteError,
  redactSessionFlags,
} from './errors.js';

export type { DatabaseErrorContext } from './errors.js';

// ---------------------------------------------------------------------------
// Domain types — row types
// ---------------------------------------------------------------------------
export type {
  Project,
  PipelineStep,
  ProjectStep,
  GenerationAttempt,
  DocumentRevision,
  DbProvider,
  DbProviderProfile,
  DbSession,
  ContextSnapshot,
  DbMigration,
} from './types.js';

// ---------------------------------------------------------------------------
// Domain types — status unions and enumerations
// ---------------------------------------------------------------------------
export type {
  ProjectStatus,
  StepStatus,
  AttemptStatus,
  DocumentFormat,
  DetailLevel,
  BudgetTier,
  ProviderType,
  ContextType,
  PipelineStepName,
} from './types.js';

// ---------------------------------------------------------------------------
// Domain types — input types
// ---------------------------------------------------------------------------
export type {
  CreateProjectInput,
  RecordAttemptInput,
  UpsertProviderInput,
  UpsertProfileInput,
  StartSessionInput,
  ContextSnapshotInput,
  ActiveProviderSelection,
} from './types.js';

// ---------------------------------------------------------------------------
// Connection factory (bd-db-a3)
// ---------------------------------------------------------------------------
export {
  openDatabase,
  closeDatabase,
  withTransaction,
} from './connection.js';

// ---------------------------------------------------------------------------
// Migration runner (bd-db-a2)
// ---------------------------------------------------------------------------
export { runMigrations } from './migration-runner.js';

// ---------------------------------------------------------------------------
// Provider JSON-to-DB migration shim (bd-db-a12)
// ---------------------------------------------------------------------------
export { migrateProvidersFromJson } from './provider-shim.js';

// ---------------------------------------------------------------------------
// Repository classes (Batch 3)
// ---------------------------------------------------------------------------
export { ProjectRepository }    from './project-repository.js';
export type { ProjectStepPatch } from './project-repository.js';

export { DocumentRepository }    from './document-repository.js';
export type { CompleteAttemptPatch, SaveRevisionInput } from './document-repository.js';

export { ProviderRepository }    from './provider-repository.js';

export { SessionRepository }     from './session-repository.js';

// ---------------------------------------------------------------------------
// Performance profiling (bd-int-d3)
// ---------------------------------------------------------------------------
export {
  measure,
  measureAsync,
  walStats,
  pragmaReport,
} from './performance.js';

export type { ProfileResult, WalStats, PragmaReport } from './performance.js';

// ---------------------------------------------------------------------------
// Migration path constant
// ---------------------------------------------------------------------------
import * as path from 'path';

/** Absolute path to the directory containing SQL migration files. */
export const MIGRATIONS_DIR: string = path.join(__dirname, 'migrations');

