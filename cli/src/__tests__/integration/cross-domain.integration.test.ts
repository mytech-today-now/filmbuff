/**
 * Cross-domain integration tests — buff-core.04.01.01
 *
 * Exercises interactions that span multiple repository classes in a single
 * SQLite in-memory database, verifying that FK relationships, cascade
 * semantics, and data-consistency guarantees hold across domains.
 *
 * NOTE: The "Provider ↔ Project" cross-domain suite was removed in
 * bd-9uc4 (replace-ai-with-ai-powered Phase 2 Deletion Pass) because
 * cli/src/db/provider-repository.ts was deleted. A replacement suite
 * targeting the ai-powered gateway will be added in Phase 7.
 *
 * Satisfies: bd-int-d1 buff-core.04.01.01 - 01 Cross-domain integration test suite
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectRepository }  from '../../db/project-repository';
import { DocumentRepository } from '../../db/document-repository';
import { SessionRepository }  from '../../db/session-repository';

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

let db: Database.Database;
let projRepo: ProjectRepository;
let docRepo:  DocumentRepository;
let sessRepo: SessionRepository;

beforeEach(() => {
  db       = makeDb();
  projRepo = new ProjectRepository(db);
  docRepo  = new DocumentRepository(db);
  sessRepo = new SessionRepository(db);
});

afterEach(() => { db.close(); });

// ---------------------------------------------------------------------------
// Helper — seed a minimal project and return its first step id
// ---------------------------------------------------------------------------

function seedProject(id = 'proj-x', slug = 'test-film') {
  const project = projRepo.create({
    id,
    slug,
    display_title: 'Test Film',
    genre:         'Drama',
    output_dir:    '/tmp/test',
  });
  const steps = projRepo.getSteps(id);
  return { project, steps };
}

// ---------------------------------------------------------------------------
// Cross-domain: project + document
// ---------------------------------------------------------------------------

describe('Project ↔ Document cross-domain', () => {
  it('generation attempt is linked to the correct project step', () => {
    const { steps } = seedProject();
    const stepId = steps[0].id;

    const attempt = docRepo.recordAttempt({
      id:              'att-xd-1',
      project_step_id: stepId,
      provider_id:     'anthropic',
      profile_name:    'default',
      model_id:        'claude-3',
    });

    expect(attempt.project_step_id).toBe(stepId);
    expect(attempt.attempt_number).toBe(1);
  });

  it('document revision is retrievable via project step id', () => {
    const { steps } = seedProject();
    const stepId = steps[0].id;

    docRepo.saveRevision({ id: 'rev-xd-1', project_step_id: stepId, content: 'A logline.', format: 'md' });
    const rev = docRepo.getCurrentRevision(stepId);

    expect(rev).toBeDefined();
    expect(rev!.content).toBe('A logline.');
  });

  it('step status and document revision stay consistent after accept', () => {
    const { steps } = seedProject();
    const stepId = steps[0].id;

    docRepo.recordAttempt({ id: 'att-xd-2', project_step_id: stepId, provider_id: 'openai', profile_name: 'gpt4', model_id: 'gpt-4o' });
    docRepo.acceptAttempt('att-xd-2');
    docRepo.saveRevision({ id: 'rev-xd-2', project_step_id: stepId, content: 'Accepted logline.', format: 'md' });
    projRepo.updateStep(stepId, { status: 'completed', accepted_at: new Date().toISOString() });

    const updatedStep = projRepo.getSteps('proj-x')[0];
    const revision    = docRepo.getCurrentRevision(stepId);

    expect(updatedStep.status).toBe('completed');
    expect(revision?.content).toBe('Accepted logline.');
  });
});

// ---------------------------------------------------------------------------
// Cross-domain: project + session
// ---------------------------------------------------------------------------

describe('Project ↔ Session cross-domain', () => {
  it('session can be linked to an existing project', () => {
    seedProject();
    const session = sessRepo.recordSession({
      id:         'sess-xd-1',
      project_id: 'proj-x',
      command:    'generate',
    });

    expect(session.project_id).toBe('proj-x');
    expect(session.completed_at).toBeNull();
  });

  it('completing a session does not affect project status', () => {
    seedProject();
    sessRepo.recordSession({ id: 'sess-xd-2', project_id: 'proj-x', command: 'init' });
    sessRepo.completeSession('sess-xd-2', 0);

    const project = projRepo.findById('proj-x');
    expect(project?.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Cross-domain: session + document (context snapshots)
// ---------------------------------------------------------------------------

describe('Session ↔ Document cross-domain (context snapshots)', () => {
  it('context snapshot is linked to a generation attempt', () => {
    const { steps } = seedProject();
    const stepId = steps[0].id;

    docRepo.recordAttempt({ id: 'att-ctx', project_step_id: stepId, provider_id: 'anthropic', profile_name: 'default', model_id: 'claude-3' });
    const snap = sessRepo.recordContextSnapshot({
      id:                    'snap-xd-1',
      generation_attempt_id: 'att-ctx',
      context_type:          'user_brief',
      content:               'A noir thriller set in 1940s LA.',
      sequence_order:        1,
    });

    expect(snap.generation_attempt_id).toBe('att-ctx');
    expect(snap.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('multiple context types can be stored for one attempt', () => {
    const { steps } = seedProject();
    const stepId = steps[0].id;

    docRepo.recordAttempt({ id: 'att-ctx2', project_step_id: stepId, provider_id: 'anthropic', profile_name: 'default', model_id: 'claude-3' });
    sessRepo.recordContextSnapshot({ id: 'snap-2a', generation_attempt_id: 'att-ctx2', context_type: 'project_metadata', content: 'meta',       sequence_order: 1 });
    sessRepo.recordContextSnapshot({ id: 'snap-2b', generation_attempt_id: 'att-ctx2', context_type: 'user_brief',       content: 'user brief', sequence_order: 2 });

    const snaps = sessRepo.listContextSnapshots('att-ctx2');
    expect(snaps).toHaveLength(2);
    expect(snaps[0].context_type).toBe('project_metadata');
    expect(snaps[1].context_type).toBe('user_brief');
  });
});

// Provider ↔ Project cross-domain suite removed: bd-9uc4 deletion pass.
// Will be replaced in Phase 7 with ai-powered gateway cross-domain tests.

