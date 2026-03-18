/**
 * Full 10-step pipeline integration tests — buff-core.03.03.02
 *
 * Exercises the complete FilmBuff pipeline from logline through final-screenplay,
 * using an in-memory SQLite database.  Each step is advanced through its full
 * lifecycle: pending → in_progress → (attempt) → completed, with a document
 * revision saved and the project ultimately marked completed.
 *
 * Satisfies: bd-pipe-c10 buff-core.03.03.02 - 01 Write integration tests for
 *            full 10-step pipeline
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectRepository }  from '../../db/project-repository';
import { DocumentRepository } from '../../db/document-repository';
import { PipelineStepName }   from '../../db/types';

// ---------------------------------------------------------------------------
// Shared DB setup
// ---------------------------------------------------------------------------

const SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/001_initial_schema.sql'),
  'utf8'
);

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

const EXPECTED_STEP_ORDER: PipelineStepName[] = [
  'logline',
  'synopsis',
  'treatment',
  'beat-sheet',
  'screenplay',
  'shooting-script',
  'script-breakdown',
  'storyboards',
  'shot-list',
  'final-screenplay',
];

let db: Database.Database;
let projRepo: ProjectRepository;
let docRepo:  DocumentRepository;

beforeEach(() => {
  db       = makeDb();
  projRepo = new ProjectRepository(db);
  docRepo  = new DocumentRepository(db);
});

afterEach(() => { db.close(); });

// ---------------------------------------------------------------------------
// Pipeline structure
// ---------------------------------------------------------------------------

describe('Pipeline structure', () => {
  it('creates exactly 10 project steps in the canonical order', () => {
    projRepo.create({ id: 'pipe-1', slug: 'pipe-film', display_title: 'Pipe Film', genre: 'Drama', output_dir: '/tmp' });
    const steps = projRepo.getSteps('pipe-1');

    expect(steps).toHaveLength(10);
    steps.forEach((step, idx) => {
      expect(step.step_name).toBe(EXPECTED_STEP_ORDER[idx]);
      expect(step.step_number).toBe(idx + 1);
      expect(step.status).toBe('pending');
    });
  });

  it('each step has a unique id derived from the project id', () => {
    projRepo.create({ id: 'pipe-2', slug: 'pipe-film-2', display_title: 'Pipe Film 2', genre: 'Drama', output_dir: '/tmp' });
    const steps = projRepo.getSteps('pipe-2');
    const ids   = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(10); // all unique
  });
});

// ---------------------------------------------------------------------------
// Full pipeline walkthrough
// ---------------------------------------------------------------------------

describe('Full 10-step pipeline walkthrough', () => {
  it('can advance all 10 steps through the complete lifecycle', () => {
    projRepo.create({ id: 'pipe-full', slug: 'pipe-full-film', display_title: 'Full Pipeline', genre: 'Thriller', output_dir: '/tmp' });
    const steps = projRepo.getSteps('pipe-full');

    steps.forEach((step, idx) => {
      const stepName = EXPECTED_STEP_ORDER[idx];
      const attId    = `att-${stepName}`;
      const revId    = `rev-${stepName}`;

      // Transition: pending → in_progress
      projRepo.updateStep(step.id, { status: 'in_progress' });
      expect(projRepo.getSteps('pipe-full')[idx].status).toBe('in_progress');

      // Record and accept a generation attempt
      docRepo.recordAttempt({ id: attId, project_step_id: step.id, provider_id: 'anthropic', profile_name: 'default', model_id: 'claude-3' });
      docRepo.completeAttempt(attId, { status: 'accepted', raw_output: `Output for ${stepName}.` });
      docRepo.acceptAttempt(attId);

      // Save document revision
      docRepo.saveRevision({ id: revId, project_step_id: step.id, generation_attempt_id: attId, content: `Content for ${stepName}.`, format: 'md' });

      // Transition: in_progress → completed
      projRepo.updateStep(step.id, { status: 'completed', output_file_path: `/tmp/${stepName}.md`, output_format: 'md', accepted_at: new Date().toISOString() });

      const updatedStep = projRepo.getSteps('pipe-full')[idx];
      expect(updatedStep.status).toBe('completed');
      expect(updatedStep.output_file_path).toBe(`/tmp/${stepName}.md`);

      const revision = docRepo.getCurrentRevision(step.id);
      expect(revision).toBeDefined();
      expect(revision!.content).toBe(`Content for ${stepName}.`);
    });

    // All steps completed — mark project as completed
    projRepo.updateStatus('pipe-full', 'completed');
    const finalProject = projRepo.findById('pipe-full');
    expect(finalProject?.status).toBe('completed');
    expect(finalProject?.completed_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Step skipping
// ---------------------------------------------------------------------------

describe('Step skipping', () => {
  it('a step can be skipped without blocking subsequent steps', () => {
    projRepo.create({ id: 'pipe-skip', slug: 'pipe-skip-film', display_title: 'Skip Film', genre: 'Comedy', output_dir: '/tmp' });
    const steps = projRepo.getSteps('pipe-skip');

    // Skip step 1 (logline)
    projRepo.updateStep(steps[0].id, { status: 'skipped', skipped_at: new Date().toISOString() });
    expect(projRepo.getSteps('pipe-skip')[0].status).toBe('skipped');

    // Advance step 2 normally
    projRepo.updateStep(steps[1].id, { status: 'in_progress' });
    projRepo.updateStep(steps[1].id, { status: 'completed', accepted_at: new Date().toISOString() });
    expect(projRepo.getSteps('pipe-skip')[1].status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// Step failure and retry
// ---------------------------------------------------------------------------

describe('Step failure and retry', () => {
  it('a failed step can be retried and eventually completed', () => {
    projRepo.create({ id: 'pipe-retry', slug: 'pipe-retry-film', display_title: 'Retry Film', genre: 'Horror', output_dir: '/tmp' });
    const steps = projRepo.getSteps('pipe-retry');
    const step  = steps[0];

    // First attempt — failure
    projRepo.updateStep(step.id, { status: 'in_progress' });
    docRepo.recordAttempt({ id: 'att-fail', project_step_id: step.id, provider_id: 'openai', profile_name: 'gpt4', model_id: 'gpt-4o' });
    docRepo.completeAttempt('att-fail', { status: 'error', error_message: 'Timeout.' });
    projRepo.updateStep(step.id, { status: 'failed', failed_at: new Date().toISOString(), failure_reason: 'Timeout.', retry_count: 1 });

    expect(projRepo.getSteps('pipe-retry')[0].status).toBe('failed');

    // Retry — success
    projRepo.updateStep(step.id, { status: 'in_progress' });
    docRepo.recordAttempt({ id: 'att-retry', project_step_id: step.id, provider_id: 'anthropic', profile_name: 'default', model_id: 'claude-3' });
    docRepo.acceptAttempt('att-retry');
    docRepo.saveRevision({ id: 'rev-retry', project_step_id: step.id, generation_attempt_id: 'att-retry', content: 'Retry logline.', format: 'md' });
    projRepo.updateStep(step.id, { status: 'completed', accepted_at: new Date().toISOString() });

    const retried = projRepo.getSteps('pipe-retry')[0];
    expect(retried.status).toBe('completed');
    expect(retried.retry_count).toBe(1);
    expect(docRepo.listAttempts(step.id)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Multiple revisions per step
// ---------------------------------------------------------------------------

describe('Multiple revisions per step', () => {
  it('only the latest revision is marked as current', () => {
    projRepo.create({ id: 'pipe-rev', slug: 'pipe-rev-film', display_title: 'Rev Film', genre: 'Sci-Fi', output_dir: '/tmp' });
    const stepId = projRepo.getSteps('pipe-rev')[0].id;

    docRepo.saveRevision({ id: 'rv-1', project_step_id: stepId, content: 'Draft 1', format: 'md' });
    docRepo.saveRevision({ id: 'rv-2', project_step_id: stepId, content: 'Draft 2', format: 'md' });
    docRepo.saveRevision({ id: 'rv-3', project_step_id: stepId, content: 'Draft 3', format: 'md' });

    const current   = docRepo.getCurrentRevision(stepId);
    const allRevs   = docRepo.listRevisions(stepId);
    const currCount = allRevs.filter((r) => r.is_current === 1).length;

    expect(current?.content).toBe('Draft 3');
    expect(allRevs).toHaveLength(3);
    expect(currCount).toBe(1);
  });
});

