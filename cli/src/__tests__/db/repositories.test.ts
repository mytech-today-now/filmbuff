/**
 * Unit tests for all repository classes.
 * Covers: ProjectRepository, DocumentRepository, SessionRepository
 *
 * NOTE: ProviderRepository tests were removed in the replace-ai-with-ai-powered
 * migration Phase 2 (bd-9uc4). The ProviderRepository source file
 * (cli/src/db/provider-repository.ts) was deleted as part of that pass.
 * A dedicated test suite will be added in Phase 7 if a new repository is
 * introduced by the ai-powered integration.
 *
 * Satisfies: bd-db-a9 buff-core.01.02.05-01 Write unit tests for all repositories
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectRepository } from '../../db/project-repository';
import { DocumentRepository } from '../../db/document-repository';
import { SessionRepository } from '../../db/session-repository';
import { DuplicateSlugError } from '../../db/errors';

// ---------------------------------------------------------------------------
// Helpers
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

beforeEach(() => { db = makeDb(); });
afterEach(() => { db.close(); });

// ---------------------------------------------------------------------------
// ProjectRepository
// ---------------------------------------------------------------------------

describe('ProjectRepository', () => {
  let repo: ProjectRepository;

  beforeEach(() => { repo = new ProjectRepository(db); });

  const BASE_INPUT = {
    id: 'proj-1',
    slug: 'my-film',
    display_title: 'My Film',
    genre: 'Drama',
    output_dir: '/tmp/myfilm',
  };

  it('creates a project and returns the row', () => {
    const p = repo.create(BASE_INPUT);
    expect(p.id).toBe('proj-1');
    expect(p.slug).toBe('my-film');
    expect(p.status).toBe('active');
  });

  it('seeds 10 project_steps on create', () => {
    repo.create(BASE_INPUT);
    const steps = repo.getSteps('proj-1');
    expect(steps).toHaveLength(10);
    expect(steps[0].step_name).toBe('logline');
    expect(steps[9].step_name).toBe('final-screenplay');
    expect(steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('throws DuplicateSlugError on duplicate slug', () => {
    repo.create(BASE_INPUT);
    expect(() => repo.create({ ...BASE_INPUT, id: 'proj-2' })).toThrow(DuplicateSlugError);
  });

  it('findById returns undefined for unknown id', () => {
    expect(repo.findById('no-such')).toBeUndefined();
  });

  it('findBySlug locates the correct project', () => {
    repo.create(BASE_INPUT);
    const found = repo.findBySlug('my-film');
    expect(found?.id).toBe('proj-1');
  });

  it('list returns all projects when no filter given', () => {
    repo.create(BASE_INPUT);
    repo.create({ ...BASE_INPUT, id: 'proj-2', slug: 'film-2' });
    expect(repo.list()).toHaveLength(2);
  });

  it('list filters by status', () => {
    repo.create(BASE_INPUT);
    repo.updateStatus('proj-1', 'archived');
    expect(repo.list('archived')).toHaveLength(1);
    expect(repo.list('active')).toHaveLength(0);
  });

  it('updateStatus changes the status', () => {
    repo.create(BASE_INPUT);
    repo.updateStatus('proj-1', 'completed');
    expect(repo.findById('proj-1')?.status).toBe('completed');
  });

  it('updateStep changes step status', () => {
    repo.create(BASE_INPUT);
    const steps = repo.getSteps('proj-1');
    repo.updateStep(steps[0].id, { status: 'in_progress' });
    const updated = repo.getSteps('proj-1');
    expect(updated[0].status).toBe('in_progress');
  });
});

// ---------------------------------------------------------------------------
// DocumentRepository
// ---------------------------------------------------------------------------

describe('DocumentRepository', () => {
  let projRepo: ProjectRepository;
  let docRepo: DocumentRepository;
  let stepId: string;

  beforeEach(() => {
    projRepo = new ProjectRepository(db);
    docRepo = new DocumentRepository(db);
    projRepo.create({ id: 'proj-d', slug: 'doc-film', display_title: 'Doc Film', genre: 'Drama', output_dir: '/tmp' });
    stepId = projRepo.getSteps('proj-d')[0].id;
  });

  const ATTEMPT_INPUT = {
    id: 'att-1',
    project_step_id: '',
    provider_id: 'anthropic',
    profile_name: 'default',
    model_id: 'claude-sonnet-4-6',
  };

  it('recordAttempt inserts with attempt_number=1', () => {
    const att = docRepo.recordAttempt({ ...ATTEMPT_INPUT, project_step_id: stepId });
    expect(att.attempt_number).toBe(1);
    expect(att.status).toBe('generated');
  });

  it('recordAttempt increments attempt_number', () => {
    docRepo.recordAttempt({ ...ATTEMPT_INPUT, project_step_id: stepId });
    const att2 = docRepo.recordAttempt({ ...ATTEMPT_INPUT, id: 'att-2', project_step_id: stepId });
    expect(att2.attempt_number).toBe(2);
  });

  it('completeAttempt updates status and raw_output', () => {
    docRepo.recordAttempt({ ...ATTEMPT_INPUT, project_step_id: stepId });
    docRepo.completeAttempt('att-1', { status: 'accepted', raw_output: 'The logline.' });
    const att = docRepo.getAttempt('att-1');
    expect(att?.status).toBe('accepted');
    expect(att?.raw_output).toBe('The logline.');
  });

  it('acceptAttempt sets status to accepted', () => {
    docRepo.recordAttempt({ ...ATTEMPT_INPUT, project_step_id: stepId });
    docRepo.acceptAttempt('att-1');
    expect(docRepo.getAttempt('att-1')?.status).toBe('accepted');
  });

  it('rejectAttempt sets status to rejected', () => {
    docRepo.recordAttempt({ ...ATTEMPT_INPUT, project_step_id: stepId });
    docRepo.rejectAttempt('att-1');
    expect(docRepo.getAttempt('att-1')?.status).toBe('rejected');
  });

  it('listAttempts returns all attempts for a step', () => {
    docRepo.recordAttempt({ ...ATTEMPT_INPUT, project_step_id: stepId });
    docRepo.recordAttempt({ ...ATTEMPT_INPUT, id: 'att-2', project_step_id: stepId });
    expect(docRepo.listAttempts(stepId)).toHaveLength(2);
  });

  it('saveRevision inserts and marks it as current', () => {
    const rev = docRepo.saveRevision({ id: 'rev-1', project_step_id: stepId, content: 'Hello.', format: 'md' });
    expect(rev.is_current).toBe(1);
    expect(rev.revision_number).toBe(1);
  });

  it('saveRevision marks previous revision as non-current', () => {
    docRepo.saveRevision({ id: 'rev-1', project_step_id: stepId, content: 'v1', format: 'md' });
    docRepo.saveRevision({ id: 'rev-2', project_step_id: stepId, content: 'v2', format: 'md' });
    const revisions = docRepo.listRevisions(stepId);
    expect(revisions).toHaveLength(2);
    const current = revisions.find((r) => r.is_current === 1);
    expect(current?.id).toBe('rev-2');
  });

  it('getCurrentRevision returns undefined when no revision exists', () => {
    expect(docRepo.getCurrentRevision(stepId)).toBeUndefined();
  });

  it('getCurrentRevision returns the latest revision', () => {
    docRepo.saveRevision({ id: 'rev-1', project_step_id: stepId, content: 'v1', format: 'md' });
    docRepo.saveRevision({ id: 'rev-2', project_step_id: stepId, content: 'v2', format: 'md' });
    expect(docRepo.getCurrentRevision(stepId)?.id).toBe('rev-2');
  });
});

// ProviderRepository tests removed: bd-9uc4 deletion pass removed
// cli/src/db/provider-repository.ts. See openspec/changes/replace-ai-with-ai-powered/

// ---------------------------------------------------------------------------
// SessionRepository
// ---------------------------------------------------------------------------

describe('SessionRepository', () => {
  let repo: SessionRepository;

  beforeEach(() => { repo = new SessionRepository(db); });

  const SESSION_INPUT = {
    id: 'sess-1',
    command: 'generate',
    flags: { '--step': 'logline', '--api-key': 'sk-secret' },
  };

  it('recordSession inserts and returns the row', () => {
    const s = repo.recordSession(SESSION_INPUT);
    expect(s.id).toBe('sess-1');
    expect(s.command).toBe('generate');
    expect(s.completed_at).toBeNull();
  });

  it('recordSession redacts sensitive flags before storage', () => {
    const s = repo.recordSession(SESSION_INPUT);
    const flags = JSON.parse(s.flags as string);
    expect(flags['--api-key']).toBe('[REDACTED]');
    expect(flags['--step']).toBe('logline');
  });

  it('completeSession sets exit_code and completed_at', () => {
    repo.recordSession(SESSION_INPUT);
    repo.completeSession('sess-1', 0);
    const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get('sess-1') as Record<string, unknown>;
    expect(s.exit_code).toBe(0);
    expect(s.completed_at).not.toBeNull();
  });

  it('completeSession stores error_message when provided', () => {
    repo.recordSession(SESSION_INPUT);
    repo.completeSession('sess-1', 1, 'something went wrong');
    const s = db.prepare('SELECT error_message FROM sessions WHERE id = ?').get('sess-1') as Record<string, unknown>;
    expect(s.error_message).toBe('something went wrong');
  });

  it('recordContextSnapshot stores and returns snapshot with content_hash', () => {
    // Need a generation_attempt to satisfy FK: create required project + step first
    new ProjectRepository(db).create({ id: 'proj-s', slug: 'sess-film', display_title: 'SF', genre: 'Sci-Fi', output_dir: '/tmp' });
    const stepId = new ProjectRepository(db).getSteps('proj-s')[0].id;
    new DocumentRepository(db).recordAttempt({ id: 'att-s', project_step_id: stepId, provider_id: 'anthropic', profile_name: 'default', model_id: 'claude-3' });
    const snap = repo.recordContextSnapshot({ id: 'snap-1', generation_attempt_id: 'att-s', context_type: 'user_brief', content: 'A story about time.', sequence_order: 1 });
    expect(snap.id).toBe('snap-1');
    expect(snap.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('listContextSnapshots returns snapshots ordered by sequence_order', () => {
    new ProjectRepository(db).create({ id: 'proj-s2', slug: 'sess2', display_title: 'S2', genre: 'Drama', output_dir: '/tmp' });
    const stepId = new ProjectRepository(db).getSteps('proj-s2')[0].id;
    new DocumentRepository(db).recordAttempt({ id: 'att-s2', project_step_id: stepId, provider_id: 'anthropic', profile_name: 'default', model_id: 'claude-3' });
    repo.recordContextSnapshot({ id: 'snap-2', generation_attempt_id: 'att-s2', context_type: 'project_metadata', content: 'meta', sequence_order: 2 });
    repo.recordContextSnapshot({ id: 'snap-1', generation_attempt_id: 'att-s2', context_type: 'user_brief', content: 'brief', sequence_order: 1 });
    const snaps = repo.listContextSnapshots('att-s2');
    expect(snaps).toHaveLength(2);
    expect(snaps[0].sequence_order).toBe(1);
    expect(snaps[1].sequence_order).toBe(2);
  });
});

