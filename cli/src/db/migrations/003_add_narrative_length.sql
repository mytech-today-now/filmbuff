-- =============================================================================
-- Migration: 003_add_narrative_length
-- Description: Add narrative_format_id column to projects table.
--
-- narrative_format_id: industry-standard format identifier string selected by
--   the user in the start wizard (e.g. 'feature-std', 'tv-half-hour', 'short-film').
--   Nullable — existing and scripted projects that omit the field remain valid.
-- =============================================================================

ALTER TABLE projects ADD COLUMN
  narrative_format_id TEXT;
