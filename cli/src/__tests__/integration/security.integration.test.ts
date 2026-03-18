/**
 * Security integration tests — buff-core.04.01.02
 *
 * Verifies that the FilmBuff core correctly handles sensitive data:
 *   1. Session flag redaction (redactSessionFlags)
 *   2. Free-form string secret masking (redactString)
 *   3. SQL-injection defense via parameterised queries
 *   4. Content stored / retrieved without server-side mutation (XSS vectors)
 *   5. Content-hash uniqueness (nonce-like guarantee)
 *
 * Satisfies: bd-int-d2 buff-core.04.01.02 - 01 Security test suite
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { redactSessionFlags } from '../../db/errors';
import { redactString, REDACTED } from '../../utils/redaction';
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
// 1. Session flag redaction
// ---------------------------------------------------------------------------

describe('redactSessionFlags', () => {
  it('redacts --api-key flag', () => {
    const result = redactSessionFlags({ '--api-key': 'sk-ant-abc123', '--verbose': 'true' });
    expect(result['--api-key']).toBe(REDACTED);
    expect(result['--verbose']).toBe('true');
  });

  it('redacts flags whose key contains "token" (case-insensitive)', () => {
    const result = redactSessionFlags({ '--access-token': 'tok-xyz', '--model': 'gpt-4' });
    expect(result['--access-token']).toBe(REDACTED);
    expect(result['--model']).toBe('gpt-4');
  });

  it('redacts flags whose key contains "secret"', () => {
    const result = redactSessionFlags({ '--client-secret': 'very-secret', '--output': 'md' });
    expect(result['--client-secret']).toBe(REDACTED);
    expect(result['--output']).toBe('md');
  });

  it('redacts flags whose key contains "password"', () => {
    const result = redactSessionFlags({ '--password': 'hunter2', '--step': 'logline' });
    expect(result['--password']).toBe(REDACTED);
    expect(result['--step']).toBe('logline');
  });

  it('passes through an empty flags map without error', () => {
    expect(redactSessionFlags({})).toEqual({});
  });

  it('does not mutate the original flags object', () => {
    const original = { '--api-key': 'sk-openai-123', '--step': 'synopsis' };
    redactSessionFlags(original);
    expect(original['--api-key']).toBe('sk-openai-123');
  });

  it('persists redaction when stored and retrieved from DB', () => {
    const session = sessRepo.recordSession({
      id:      'sec-sess-1',
      command: 'generate',
      flags:   { '--api-key': 'sk-ant-SuperSecret', '--step': 'logline' },
    });
    const stored = JSON.parse(session.flags as string);
    expect(stored['--api-key']).toBe(REDACTED);
    expect(stored['--step']).toBe('logline');
  });
});

// ---------------------------------------------------------------------------
// 2. Free-form string masking
// ---------------------------------------------------------------------------

describe('redactString', () => {
  it('masks Anthropic API keys', () => {
    const out = redactString('Using key sk-ant-api03-ABCDEFGHIJ1234567890');
    expect(out).not.toContain('sk-ant-');
    expect(out).toContain(REDACTED);
  });

  it('masks OpenAI API keys', () => {
    const out = redactString('key=sk-ABCDEFGHIJ1234567890AAAA');
    expect(out).not.toContain('sk-ABCDEF');
    expect(out).toContain(REDACTED);
  });

  it('masks Google AI keys', () => {
    const out = redactString('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890');
    expect(out).toContain(REDACTED);
  });

  it('masks Bearer tokens', () => {
    const out = redactString('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc');
    expect(out).toContain(REDACTED);
  });

  it('leaves plain text untouched', () => {
    const plain = 'A logline about two friends on a road trip.';
    expect(redactString(plain)).toBe(plain);
  });
});

// ---------------------------------------------------------------------------
// 3. SQL-injection defense
// ---------------------------------------------------------------------------

describe('SQL-injection defense', () => {
  it('treats SQL-injection payload in slug as plain text, not SQL', () => {
    // If parameterised binding works correctly, this should throw DuplicateSlugError
    // on the second call but NEVER execute the injected SQL.
    const maliciousSlug = "'; DROP TABLE projects; --";
    projRepo.create({ id: 'inj-1', slug: maliciousSlug, display_title: 'Injected', genre: 'Horror', output_dir: '/tmp' });

    // projects table still exists and the row is retrievable
    const found = projRepo.findBySlug(maliciousSlug);
    expect(found?.id).toBe('inj-1');
  });

  it('treats SQL-injection payload in content as plain text', () => {
    projRepo.create({ id: 'inj-p', slug: 'inj-film', display_title: 'InjFilm', genre: 'Thriller', output_dir: '/tmp' });
    const stepId = projRepo.getSteps('inj-p')[0].id;
    const payload = "'; DELETE FROM document_revisions; --";
    docRepo.saveRevision({ id: 'inj-rev', project_step_id: stepId, content: payload, format: 'md' });

    const rev = docRepo.getCurrentRevision(stepId);
    expect(rev?.content).toBe(payload);           // stored verbatim
    expect(docRepo.listRevisions(stepId)).toHaveLength(1); // table untouched
  });
});

// ---------------------------------------------------------------------------
// 4. XSS / special-character passthrough
// ---------------------------------------------------------------------------

describe('XSS-vector content passthrough', () => {
  it('stores and retrieves HTML/script tags verbatim (no server-side mutation)', () => {
    projRepo.create({ id: 'xss-p', slug: 'xss-film', display_title: 'XSS Film', genre: 'Comedy', output_dir: '/tmp' });
    const stepId  = projRepo.getSteps('xss-p')[0].id;
    const xssBody = '<script>alert("xss")</script>';
    docRepo.saveRevision({ id: 'xss-rev', project_step_id: stepId, content: xssBody, format: 'md' });

    expect(docRepo.getCurrentRevision(stepId)?.content).toBe(xssBody);
  });
});

// ---------------------------------------------------------------------------
// 5. Content-hash uniqueness (nonce-like guarantee)
// ---------------------------------------------------------------------------

describe('Content-hash uniqueness', () => {
  it('two different contents produce different hashes', () => {
    projRepo.create({ id: 'hash-p', slug: 'hash-film', display_title: 'Hash Film', genre: 'Drama', output_dir: '/tmp' });
    const steps  = projRepo.getSteps('hash-p');
    docRepo.saveRevision({ id: 'rev-h1', project_step_id: steps[0].id, content: 'Content A', format: 'md' });
    docRepo.saveRevision({ id: 'rev-h2', project_step_id: steps[1].id, content: 'Content B', format: 'md' });

    const h1 = docRepo.getCurrentRevision(steps[0].id)?.content_hash;
    const h2 = docRepo.getCurrentRevision(steps[1].id)?.content_hash;
    expect(h1).not.toBe(h2);
  });

  it('same content always produces the same hash (deterministic)', () => {
    projRepo.create({ id: 'hash-p2', slug: 'hash-film-2', display_title: 'Hash Film 2', genre: 'Drama', output_dir: '/tmp' });
    const steps = projRepo.getSteps('hash-p2');
    docRepo.saveRevision({ id: 'rev-d1', project_step_id: steps[0].id, content: 'Same content', format: 'md' });
    docRepo.saveRevision({ id: 'rev-d2', project_step_id: steps[1].id, content: 'Same content', format: 'md' });

    const h1 = docRepo.getCurrentRevision(steps[0].id)?.content_hash;
    const h2 = docRepo.getCurrentRevision(steps[1].id)?.content_hash;
    expect(h1).toBe(h2);
  });

  it('context snapshot content_hash is a 64-char hex string', () => {
    projRepo.create({ id: 'hash-p3', slug: 'hash-film-3', display_title: 'Hash Film 3', genre: 'Drama', output_dir: '/tmp' });
    const stepId = projRepo.getSteps('hash-p3')[0].id;
    docRepo.recordAttempt({ id: 'att-hash', project_step_id: stepId, provider_id: 'anthropic', profile_name: 'default', model_id: 'claude-3' });
    const snap = sessRepo.recordContextSnapshot({ id: 'snap-hash', generation_attempt_id: 'att-hash', context_type: 'user_brief', content: 'nonce test', sequence_order: 1 });
    expect(snap.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

