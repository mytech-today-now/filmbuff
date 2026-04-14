/**
 * FilmBuff Database Domain Types
 *
 * TypeScript interfaces and literal types that map 1-to-1 to the database
 * schema defined in migrations/001_initial_schema.sql.  These types are the
 * canonical source of truth for the repository layer; command handlers import
 * them from `cli/src/db/index.ts` and never construct raw SQL objects.
 *
 * Satisfies: bd-db-a11 buff-core.01.03.02 - Export public DB API
 */

// =============================================================================
// Enumerations
// =============================================================================

export type ProjectStatus   = 'active' | 'completed' | 'archived' | 'error';
export type StepStatus      = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
export type AttemptStatus   = 'generated' | 'accepted' | 'rejected' | 'error';
export type DocumentFormat  = 'md' | 'json' | 'fountain' | 'pdf';
export type DetailLevel     = 'brief' | 'standard' | 'detailed';
export type BudgetTier      = 'micro' | 'low' | 'mid' | 'studio';
export type ProviderType    = 'builtin' | 'custom';
export type ContextType     =
  | 'project_metadata'
  | 'prior_document'
  | 'style_module'
  | 'user_brief';

/** The 10 canonical FilmBuff pipeline step names. */
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
  | 'final-screenplay';

// =============================================================================
// Row types (mirror database columns exactly)
// =============================================================================

export interface Project {
  id:                  string;
  slug:                string;
  display_title:       string;
  genre:               string;
  tone:                string | null;
  target_audience:     string | null;
  budget_tier:         BudgetTier | null;
  outcome:             string | null;
  output_dir:          string;
  format_override:     DocumentFormat | null;
  detail_level:        DetailLevel;
  /** JSON-serialised string[]. Deserialise before use. */
  style_modules:       string | null;
  active_provider_id:  string | null;
  active_profile_name: string | null;
  status:              ProjectStatus;
  created_at:          string;
  updated_at:          string;
  completed_at:        string | null;
}

export interface PipelineStep {
  step_number:      number;
  step_name:        PipelineStepName;
  default_filename: string;
  default_format:   DocumentFormat;
  description:      string | null;
}

export interface ProjectStep {
  id:               string;
  project_id:       string;
  step_number:      number;
  step_name:        PipelineStepName;
  status:           StepStatus;
  output_file_path: string | null;
  output_format:    DocumentFormat | null;
  accepted_at:      string | null;
  skipped_at:       string | null;
  failed_at:        string | null;
  failure_reason:   string | null;
  retry_count:      number;
  created_at:       string;
  updated_at:       string;
}

export interface GenerationAttempt {
  id:                    string;
  project_step_id:       string;
  attempt_number:        number;
  provider_id:           string;
  profile_name:          string;
  model_id:              string;
  prompt_tokens:         number | null;
  completion_tokens:     number | null;
  total_tokens:          number | null;
  prompt_hash:           string | null;
  raw_output:            string | null;
  instructions_override: string | null;
  detail_level:          DetailLevel | null;
  /** JSON-serialised string[]. Deserialise before use. */
  style_modules:         string | null;
  /** JSON-serialised string[]. Deserialise before use. */
  context_document_ids:  string | null;
  status:                AttemptStatus;
  error_message:         string | null;
  started_at:            string;
  completed_at:          string | null;
  accepted_at:           string | null;
  deleted_at:            string | null;
}

export interface DocumentRevision {
  id:                    string;
  project_step_id:       string;
  generation_attempt_id: string | null;
  revision_number:       number;
  content:               string;
  content_hash:          string;
  content_size_bytes:    number;
  format:                DocumentFormat;
  /** SQLite stores booleans as INTEGER 0/1. */
  is_current:            number;
  accepted_by:           string | null;
  accepted_at:           string;
  notes:                 string | null;
}

export interface DbProvider {
  id:           string;
  display_name: string;
  provider_type: ProviderType;
  base_url:     string | null;
  /** JSON-serialised string[]. Deserialise before use. */
  capabilities: string;
  metadata:     string | null;
  /** SQLite stores booleans as INTEGER 0/1. */
  is_enabled:   number;
  created_at:   string;
  updated_at:   string;
}

export interface DbProviderProfile {
  id:                string;
  provider_id:       string;
  profile_name:      string;
  model_id:          string;
  api_key_ref:       string | null;
  /** SQLite stores booleans as INTEGER 0/1. */
  api_key_encrypted: number;
  max_tokens:        number | null;
  temperature:       number | null;
  extra_settings:    string | null;
  /** SQLite stores booleans as INTEGER 0/1. */
  is_active:         number;
  created_at:        string;
  updated_at:        string;
}

export interface DbSession {
  id:           string;
  project_id:   string | null;
  command:      string;
  /** JSON-serialised Record<string,unknown> with secrets redacted. */
  flags:        string | null;
  provider_id:  string | null;
  profile_name: string | null;
  started_at:   string;
  completed_at: string | null;
  exit_code:    number | null;
  error_message: string | null;
}

export interface ContextSnapshot {
  id:                    string;
  /** Null when the snapshot was assembled before a generation attempt was created. */
  generation_attempt_id: string | null;
  context_type:          ContextType;
  source_step_name:      string | null;
  content:               string;
  content_hash:          string;
  sequence_order:        number;
  created_at:            string;
}

export interface DbMigration {
  id:         number;
  version:    string;
  applied_at: string;
  checksum:   string;
}

// =============================================================================
// Input types (for repository create/update methods)
// =============================================================================

export interface CreateProjectInput {
  id:                  string;
  slug:                string;
  display_title:       string;
  genre:               string;
  tone?:               string;
  target_audience?:    string;
  budget_tier?:        BudgetTier;
  outcome?:            string;
  output_dir:          string;
  format_override?:    DocumentFormat;
  detail_level?:       DetailLevel;
  style_modules?:      string[];
  active_provider_id?: string;
  active_profile_name?:string;
}

export interface RecordAttemptInput {
  id:                    string;
  project_step_id:       string;
  provider_id:           string;
  profile_name:          string;
  model_id:              string;
  instructions_override?: string;
  detail_level?:         DetailLevel;
  style_modules?:        string[];
  context_document_ids?: string[];
}

export interface UpsertProviderInput {
  id:           string;
  display_name: string;
  provider_type: ProviderType;
  base_url?:    string;
  capabilities: string[];
  metadata?:    Record<string, unknown>;
}

export interface UpsertProfileInput {
  profile_name:      string;
  model_id:          string;
  api_key_ref?:      string;
  api_key_encrypted?: boolean;
  max_tokens?:       number;
  temperature?:      number;
  extra_settings?:   Record<string, unknown>;
}

export interface StartSessionInput {
  id:          string;
  project_id?: string;
  command:     string;
  flags?:      Record<string, unknown>;
  provider_id?: string;
  profile_name?: string;
}

export interface ContextSnapshotInput {
  id:                    string;
  /** Pass null when no generation attempt exists yet (e.g. context pre-assembled by `continue`). */
  generation_attempt_id: string | null;
  context_type:          ContextType;
  source_step_name?:     string;
  content:               string;
  sequence_order:        number;
}

/** Returned by ProviderRepository.getActiveSelection(). */
export interface ActiveProviderSelection {
  provider_id:  string;
  profile_name: string;
}

