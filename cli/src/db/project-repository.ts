/**
 * ProjectRepository
 *
 * All database access for the `projects` and `project_steps` tables.
 * Command handlers MUST use this class and never write raw SQL directly.
 *
 * Methods:
 *   create(input)              — Insert a new project row + 10 project_steps rows
 *   findById(id)               — Fetch a project by primary key
 *   findBySlug(slug)           — Fetch a project by slug
 *   list(status?)              — List projects, optionally filtered by status
 *   updateStatus(id, status)   — Set projects.status
 *   setActiveProvider(id, ...) — Update active_provider_id / active_profile_name
 *   getSteps(projectId)        — Fetch all project_steps for a project
 *   updateStep(id, patch)      — Patch a project_step row
 *
 * Satisfies: bd-db-a5 buff-core.01.02.01 - Implement ProjectRepository
 */

import Database from 'better-sqlite3';
import {
  Project,
  ProjectStatus,
  ProjectStep,
  StepStatus,
  CreateProjectInput,
  PipelineStepName,
  DocumentFormat,
} from './types.js';
import { translateSQLiteError, DuplicateSlugError } from './errors.js';

// ---------------------------------------------------------------------------
// SQL constants
// ---------------------------------------------------------------------------

const INSERT_PROJECT = `
  INSERT INTO projects
    (id, slug, display_title, genre, tone, target_audience, budget_tier, outcome,
     output_dir, format_override, detail_level, style_modules,
     active_provider_id, active_profile_name, narrative_format_id,
     status, created_at, updated_at)
  VALUES
    (@id, @slug, @display_title, @genre, @tone, @target_audience, @budget_tier, @outcome,
     @output_dir, @format_override, @detail_level, @style_modules,
     @active_provider_id, @active_profile_name, @narrative_format_id,
     'active', @now, @now)
`;

const INSERT_PROJECT_STEP = `
  INSERT INTO project_steps
    (id, project_id, step_number, step_name, status, retry_count, created_at, updated_at)
  VALUES
    (@id, @project_id, @step_number, @step_name, 'pending', 0, @now, @now)
`;

const SELECT_PROJECT_BY_ID   = `SELECT * FROM projects WHERE id = ?`;
const SELECT_PROJECT_BY_SLUG = `SELECT * FROM projects WHERE slug = ?`;
const SELECT_PROJECTS_ALL    = `SELECT * FROM projects ORDER BY created_at DESC`;
const SELECT_PROJECTS_STATUS = `SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC`;
const SELECT_PIPELINE_STEPS  = `SELECT * FROM pipeline_steps ORDER BY step_number ASC`;
const SELECT_PROJECT_STEPS   = `SELECT * FROM project_steps WHERE project_id = ? ORDER BY step_number ASC`;

const UPDATE_PROJECT_STATUS = `
  UPDATE projects SET status = @status, updated_at = @now
  WHERE id = @id
`;

const UPDATE_PROJECT_COMPLETED = `
  UPDATE projects SET status = @status, updated_at = @now, completed_at = @now
  WHERE id = @id
`;

const UPDATE_ACTIVE_PROVIDER = `
  UPDATE projects
  SET active_provider_id = @active_provider_id,
      active_profile_name = @active_profile_name,
      updated_at = @now
  WHERE id = @id
`;

const UPDATE_PROJECT_STEP = `
  UPDATE project_steps
  SET status           = COALESCE(@status, status),
      output_file_path = COALESCE(@output_file_path, output_file_path),
      output_format    = COALESCE(@output_format, output_format),
      accepted_at      = COALESCE(@accepted_at, accepted_at),
      skipped_at       = COALESCE(@skipped_at, skipped_at),
      failed_at        = COALESCE(@failed_at, failed_at),
      failure_reason   = COALESCE(@failure_reason, failure_reason),
      retry_count      = COALESCE(@retry_count, retry_count),
      updated_at       = @now
  WHERE id = @id
`;

// ---------------------------------------------------------------------------
// Step patch shape
// ---------------------------------------------------------------------------

export interface ProjectStepPatch {
  status?:           StepStatus;
  output_file_path?: string;
  output_format?:    DocumentFormat;
  accepted_at?:      string;
  skipped_at?:       string;
  failed_at?:        string;
  failure_reason?:   string;
  retry_count?:      number;
}

// ---------------------------------------------------------------------------
// Repository class
// ---------------------------------------------------------------------------

export class ProjectRepository {
  constructor(private readonly db: Database.Database) {}

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  /**
   * Insert a new project and initialise all 10 project_steps in a transaction.
   * Throws DuplicateSlugError if the slug is already taken.
   */
  create(input: CreateProjectInput): Project {
    const now = new Date().toISOString();

    try {
      this.db.transaction(() => {
        this.db.prepare(INSERT_PROJECT).run({
          ...input,
          tone:                input.tone               ?? null,
          target_audience:     input.target_audience    ?? null,
          budget_tier:         input.budget_tier        ?? null,
          outcome:             input.outcome            ?? null,
          format_override:     input.format_override    ?? null,
          detail_level:        input.detail_level       ?? 'standard',
          style_modules:       input.style_modules
                                 ? JSON.stringify(input.style_modules)
                                 : null,
          active_provider_id:  input.active_provider_id  ?? null,
          active_profile_name: input.active_profile_name ?? null,
          narrative_format_id: input.narrative_format_id ?? null,
          now,
        });

        // Seed one project_step per pipeline step
        const steps = this.db.prepare(SELECT_PIPELINE_STEPS).all() as Array<{
          step_number: number;
          step_name:   PipelineStepName;
        }>;

        const insertStep = this.db.prepare(INSERT_PROJECT_STEP);
        for (const ps of steps) {
          insertStep.run({
            id:          `${input.id}-step-${ps.step_number}`,
            project_id:  input.id,
            step_number: ps.step_number,
            step_name:   ps.step_name,
            now,
          });
        }
      })();
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (
        e?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        (e?.message ?? '').includes('UNIQUE constraint failed: projects.slug')
      ) {
        throw new DuplicateSlugError(input.slug);
      }
      throw translateSQLiteError(err);
    }

    return this.db.prepare(SELECT_PROJECT_BY_ID).get(input.id) as Project;
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  findById(id: string): Project | undefined {
    return this.db.prepare(SELECT_PROJECT_BY_ID).get(id) as Project | undefined;
  }

  findBySlug(slug: string): Project | undefined {
    return this.db.prepare(SELECT_PROJECT_BY_SLUG).get(slug) as Project | undefined;
  }

  list(status?: ProjectStatus): Project[] {
    if (status) {
      return this.db.prepare(SELECT_PROJECTS_STATUS).all(status) as Project[];
    }
    return this.db.prepare(SELECT_PROJECTS_ALL).all() as Project[];
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  updateStatus(id: string, status: ProjectStatus): void {
    const now = new Date().toISOString();
    if (status === 'completed') {
      try {
        this.db.prepare(UPDATE_PROJECT_COMPLETED).run({ id, status, now });
      } catch (err) { throw translateSQLiteError(err); }
    } else {
      try {
        this.db.prepare(UPDATE_PROJECT_STATUS).run({ id, status, now });
      } catch (err) { throw translateSQLiteError(err); }
    }
  }

  setActiveProvider(
    id: string,
    providerId: string | null,
    profileName: string | null,
  ): void {
    const now = new Date().toISOString();
    try {
      this.db.prepare(UPDATE_ACTIVE_PROVIDER).run({
        id,
        active_provider_id:  providerId,
        active_profile_name: profileName,
        now,
      });
    } catch (err) { throw translateSQLiteError(err); }
  }

  // -------------------------------------------------------------------------
  // Project steps
  // -------------------------------------------------------------------------

  getSteps(projectId: string): ProjectStep[] {
    return this.db.prepare(SELECT_PROJECT_STEPS).all(projectId) as ProjectStep[];
  }

  updateStep(stepId: string, patch: ProjectStepPatch): void {
    const now = new Date().toISOString();
    try {
      this.db.prepare(UPDATE_PROJECT_STEP).run({
        id:               stepId,
        status:           patch.status           ?? null,
        output_file_path: patch.output_file_path ?? null,
        output_format:    patch.output_format    ?? null,
        accepted_at:      patch.accepted_at      ?? null,
        skipped_at:       patch.skipped_at       ?? null,
        failed_at:        patch.failed_at        ?? null,
        failure_reason:   patch.failure_reason   ?? null,
        retry_count:      patch.retry_count      ?? null,
        now,
      });
    } catch (err) { throw translateSQLiteError(err); }
  }
}

