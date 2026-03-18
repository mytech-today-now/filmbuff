-- =============================================================================
-- Migration: 001_initial_schema
-- Description: Initial FilmBuff database schema
-- Creates all core tables, indexes, and seeds the pipeline_steps reference table.
-- Pragmas are applied by the connection factory before this migration runs.
-- =============================================================================

-- ========================== UP ===============================================

-- Runtime pragmas (applied by connection factory, repeated here for clarity)
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;

-- ---------------------------------------------------------------------------
-- providers  (must come before projects and provider_profiles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS providers (
  id            TEXT    PRIMARY KEY,
  display_name  TEXT    NOT NULL,
  provider_type TEXT    NOT NULL CHECK (provider_type IN ('builtin','custom')),
  base_url      TEXT,
  capabilities  TEXT    NOT NULL DEFAULT '[]',
  metadata      TEXT,
  is_enabled    INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_providers_type ON providers(provider_type);

-- ---------------------------------------------------------------------------
-- provider_profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_profiles (
  id              TEXT    PRIMARY KEY,
  provider_id     TEXT    NOT NULL REFERENCES providers(id),
  profile_name    TEXT    NOT NULL,
  model_id        TEXT    NOT NULL,
  api_key_ref     TEXT,
  api_key_encrypted INTEGER NOT NULL DEFAULT 0,
  max_tokens      INTEGER,
  temperature     REAL,
  extra_settings  TEXT,
  is_active       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  UNIQUE(provider_id, profile_name)
);

CREATE INDEX IF NOT EXISTS idx_provider_profiles_provider ON provider_profiles(provider_id);
-- Partial unique index: only one active profile per provider
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_profiles_active
  ON provider_profiles(provider_id) WHERE is_active = 1;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id                   TEXT PRIMARY KEY,
  slug                 TEXT NOT NULL,
  display_title        TEXT NOT NULL,
  genre                TEXT NOT NULL,
  tone                 TEXT,
  target_audience      TEXT,
  budget_tier          TEXT CHECK (budget_tier IN ('micro','low','mid','studio')),
  outcome              TEXT,
  output_dir           TEXT NOT NULL,
  format_override      TEXT CHECK (format_override IN ('md','json','fountain','pdf')),
  detail_level         TEXT NOT NULL DEFAULT 'standard'
                            CHECK (detail_level IN ('brief','standard','detailed')),
  style_modules        TEXT,
  active_provider_id   TEXT REFERENCES providers(id),
  active_profile_name  TEXT,
  status               TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','completed','archived','error')),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  completed_at         TEXT,
  UNIQUE(slug)
);

CREATE INDEX IF NOT EXISTS idx_projects_status     ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);

-- ---------------------------------------------------------------------------
-- pipeline_steps  (reference table — pre-seeded, never modified by app code)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_steps (
  step_number      INTEGER PRIMARY KEY,
  step_name        TEXT    NOT NULL UNIQUE,
  default_filename TEXT    NOT NULL,
  default_format   TEXT    NOT NULL CHECK (default_format IN ('md','json','fountain','pdf')),
  description      TEXT
);

-- ---------------------------------------------------------------------------
-- project_steps  (state machine: one row per project × pipeline step)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_steps (
  id              TEXT    PRIMARY KEY,
  project_id      TEXT    NOT NULL REFERENCES projects(id),
  step_number     INTEGER NOT NULL REFERENCES pipeline_steps(step_number),
  step_name       TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','in_progress','completed','failed','skipped')),
  output_file_path TEXT,
  output_format   TEXT    CHECK (output_format IN ('md','json','fountain','pdf')),
  accepted_at     TEXT,
  skipped_at      TEXT,
  failed_at       TEXT,
  failure_reason  TEXT,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  UNIQUE(project_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_project_steps_project_status ON project_steps(project_id, status);
CREATE INDEX IF NOT EXISTS idx_project_steps_status         ON project_steps(status);

-- ---------------------------------------------------------------------------
-- generation_attempts  (append-only audit log — rows are never updated/deleted)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generation_attempts (
  id                   TEXT    PRIMARY KEY,
  project_step_id      TEXT    NOT NULL REFERENCES project_steps(id),
  attempt_number       INTEGER NOT NULL,
  provider_id          TEXT    NOT NULL,
  profile_name         TEXT    NOT NULL,
  model_id             TEXT    NOT NULL,
  prompt_tokens        INTEGER,
  completion_tokens    INTEGER,
  total_tokens         INTEGER,
  prompt_hash          TEXT,
  raw_output           TEXT,
  instructions_override TEXT,
  detail_level         TEXT    CHECK (detail_level IN ('brief','standard','detailed')),
  style_modules        TEXT,
  context_document_ids TEXT,
  status               TEXT    NOT NULL DEFAULT 'generated'
                               CHECK (status IN ('generated','accepted','rejected','error')),
  error_message        TEXT,
  started_at           TEXT    NOT NULL,
  completed_at         TEXT,
  accepted_at          TEXT,
  deleted_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_gen_attempts_step      ON generation_attempts(project_step_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_gen_attempts_status    ON generation_attempts(status);
CREATE INDEX IF NOT EXISTS idx_gen_attempts_provider  ON generation_attempts(provider_id, model_id);
CREATE INDEX IF NOT EXISTS idx_gen_attempts_started   ON generation_attempts(started_at DESC);

-- ---------------------------------------------------------------------------
-- document_revisions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_revisions (
  id                    TEXT    PRIMARY KEY,
  project_step_id       TEXT    NOT NULL REFERENCES project_steps(id),
  generation_attempt_id TEXT    REFERENCES generation_attempts(id),
  revision_number       INTEGER NOT NULL,
  content               TEXT    NOT NULL,
  content_hash          TEXT    NOT NULL,
  content_size_bytes    INTEGER NOT NULL,
  format                TEXT    NOT NULL CHECK (format IN ('md','json','fountain','pdf')),
  is_current            INTEGER NOT NULL DEFAULT 1,
  accepted_by           TEXT,
  accepted_at           TEXT    NOT NULL,
  notes                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_doc_revisions_step_current ON document_revisions(project_step_id, is_current);
CREATE INDEX IF NOT EXISTS idx_doc_revisions_attempt      ON document_revisions(generation_attempt_id);
CREATE INDEX IF NOT EXISTS idx_doc_revisions_hash         ON document_revisions(content_hash);

-- ---------------------------------------------------------------------------
-- sessions  (one row per CLI invocation that touches the DB)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT    PRIMARY KEY,
  project_id   TEXT    REFERENCES projects(id),
  command      TEXT    NOT NULL,
  flags        TEXT,
  provider_id  TEXT,
  profile_name TEXT,
  started_at   TEXT    NOT NULL,
  completed_at TEXT,
  exit_code    INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_project   ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started   ON sessions(started_at DESC);

-- ---------------------------------------------------------------------------
-- context_snapshots  (full context captured at generation time)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS context_snapshots (
  id                   TEXT    PRIMARY KEY,
  generation_attempt_id TEXT   NOT NULL REFERENCES generation_attempts(id),
  context_type         TEXT    NOT NULL
                               CHECK (context_type IN ('project_metadata','prior_document','style_module','user_brief')),
  source_step_name     TEXT,
  content              TEXT    NOT NULL,
  content_hash         TEXT    NOT NULL,
  sequence_order       INTEGER NOT NULL,
  created_at           TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ctx_snapshots_attempt ON context_snapshots(generation_attempt_id, sequence_order);

-- ---------------------------------------------------------------------------
-- migrations  (managed exclusively by the migration runner)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  version    TEXT    NOT NULL UNIQUE,
  applied_at TEXT    NOT NULL,
  checksum   TEXT    NOT NULL
);

-- =============================================================================
-- SEED DATA: pipeline_steps (canonical 10-step FilmBuff pipeline)
-- =============================================================================
INSERT OR IGNORE INTO pipeline_steps (step_number, step_name, default_filename, default_format, description) VALUES
  (1,  'logline',          'logline.md',                 'md',       'One-to-two sentence film premise'),
  (2,  'synopsis',         'synopsis.md',                'md',       'Short narrative summary (1–2 pages)'),
  (3,  'treatment',        'treatment.md',               'md',       'Scene-by-scene narrative outline'),
  (4,  'beat-sheet',       'beat-sheet.md',              'md',       'Story beats mapped to structure'),
  (5,  'screenplay',       'screenplay.fountain',        'fountain', 'Full feature-length screenplay'),
  (6,  'shooting-script',  'shooting-script.fountain',   'fountain', 'Locked shooting draft with scene numbers'),
  (7,  'script-breakdown', 'script-breakdown.json',      'json',     'Breakdown of every scene element'),
  (8,  'storyboards',      'storyboards.md',             'md',       'Visual panel descriptions per scene'),
  (9,  'shot-list',        'shot-list.json',             'json',     'Detailed shot list for production'),
  (10, 'final-screenplay', 'final-screenplay.fountain',  'fountain', 'Distribution-ready final screenplay');

-- =============================================================================
-- SEED DATA: built-in providers
-- =============================================================================
INSERT OR IGNORE INTO providers (id, display_name, provider_type, capabilities, is_enabled, created_at, updated_at) VALUES
  ('anthropic', 'Anthropic Claude', 'builtin', '["text-generation","generate-shot-list","ai-summary","ai-prompts"]', 1, datetime('now'), datetime('now')),
  ('openai',    'OpenAI',           'builtin', '["text-generation","generate-shot-list","ai-summary","ai-prompts","vision"]', 1, datetime('now'), datetime('now')),
  ('google',    'Google Gemini',    'builtin', '["text-generation","generate-shot-list","ai-summary","ai-prompts","vision"]', 1, datetime('now'), datetime('now'));

-- =============================================================================
-- DOWN (for test fixtures and developer rollback only — never run in production)
-- =============================================================================
-- DROP TABLE IF EXISTS context_snapshots;
-- DROP TABLE IF EXISTS document_revisions;
-- DROP TABLE IF EXISTS generation_attempts;
-- DROP TABLE IF EXISTS sessions;
-- DROP TABLE IF EXISTS project_steps;
-- DROP TABLE IF EXISTS projects;
-- DROP TABLE IF EXISTS pipeline_steps;
-- DROP TABLE IF EXISTS provider_profiles;
-- DROP TABLE IF EXISTS providers;
-- DROP TABLE IF EXISTS migrations;

