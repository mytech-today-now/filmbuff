-- =============================================================================
-- Migration: 002_nullable_snapshot_attempt_id
-- Description: Make context_snapshots.generation_attempt_id nullable.
--
-- Rationale: `filmbuff continue` pre-assembles context snapshots before any
-- generation attempt exists.  The original NOT NULL constraint prevented this,
-- causing a FOREIGN KEY / NOT NULL error at runtime.  The column remains an FK
-- to generation_attempts(id) so referential integrity is still enforced when a
-- non-null value is supplied.
--
-- SQLite does not support ALTER COLUMN, so the standard rename-and-rebuild
-- pattern is used.
-- =============================================================================

-- ========================== UP ===============================================

PRAGMA foreign_keys = OFF;

-- 1. Create replacement table with nullable generation_attempt_id
CREATE TABLE IF NOT EXISTS context_snapshots_v2 (
  id                    TEXT    PRIMARY KEY,
  generation_attempt_id TEXT    REFERENCES generation_attempts(id),
  context_type          TEXT    NOT NULL
                                CHECK (context_type IN ('project_metadata','prior_document','style_module','user_brief')),
  source_step_name      TEXT,
  content               TEXT    NOT NULL,
  content_hash          TEXT    NOT NULL,
  sequence_order        INTEGER NOT NULL,
  created_at            TEXT    NOT NULL
);

-- 2. Copy existing rows (generation_attempt_id values carry over unchanged)
INSERT INTO context_snapshots_v2
  SELECT id, generation_attempt_id, context_type, source_step_name,
         content, content_hash, sequence_order, created_at
  FROM context_snapshots;

-- 3. Drop the original table
DROP TABLE context_snapshots;

-- 4. Rename the replacement
ALTER TABLE context_snapshots_v2 RENAME TO context_snapshots;

-- 5. Recreate the index
CREATE INDEX IF NOT EXISTS idx_ctx_snapshots_attempt
  ON context_snapshots(generation_attempt_id, sequence_order);

PRAGMA foreign_keys = ON;
