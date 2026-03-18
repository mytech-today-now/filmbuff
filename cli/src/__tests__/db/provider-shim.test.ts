/**
 * Integration tests for cli/src/db/provider-shim.ts
 * Satisfies: bd-db-a13 buff-core.01.04.02-01 Write integration tests for provider JSON migration shim
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { migrateProvidersFromJson } from '../../db/provider-shim';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/001_initial_schema.sql'),
  'utf8'
);

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filmbuff-shim-'));
}

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Open an in-memory SQLite DB with the full production schema applied. */
function makeSchemaDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

/** Write providers array to baseDir/.augment/providers/custom-providers.json */
function writeProviders(baseDir: string, providers: object[]): void {
  const dir = path.join(baseDir, '.augment', 'providers');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'custom-providers.json'), JSON.stringify(providers), 'utf8');
}

function makeProvider(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: 'test-provider-1',
    displayName: 'Test Provider',
    description: 'A test custom provider',
    capabilities: ['text-generation'],
    settingsSchema: {},
    credentialSchema: {},
    baseUrl: 'https://api.example.com',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migrateProvidersFromJson', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = makeTempDir();
    db = makeSchemaDb();
  });

  afterEach(() => {
    db.close();
    rmrf(tmpDir);
  });

  it('returns 0 when custom-providers.json does not exist', () => {
    expect(migrateProvidersFromJson(db, tmpDir)).toBe(0);
  });

  it('returns 0 when custom-providers.json is an empty array', () => {
    writeProviders(tmpDir, []);
    expect(migrateProvidersFromJson(db, tmpDir)).toBe(0);
  });

  it('returns 0 when custom-providers.json contains malformed JSON', () => {
    const dir = path.join(tmpDir, '.augment', 'providers');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'custom-providers.json'), 'not-valid-json', 'utf8');
    expect(migrateProvidersFromJson(db, tmpDir)).toBe(0);
  });

  it('migrates a single provider and returns 1', () => {
    const p = makeProvider();
    writeProviders(tmpDir, [p]);
    expect(migrateProvidersFromJson(db, tmpDir)).toBe(1);
    const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(p.id as string) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.display_name).toBe(p.displayName);
    expect(row.provider_type).toBe('custom');
    expect(row.base_url).toBe(p.baseUrl);
  });

  it('creates a default profile for each migrated provider', () => {
    const p = makeProvider();
    writeProviders(tmpDir, [p]);
    migrateProvidersFromJson(db, tmpDir);
    const profiles = db.prepare('SELECT * FROM provider_profiles WHERE provider_id = ?').all(p.id as string) as Array<Record<string, unknown>>;
    expect(profiles).toHaveLength(1);
    expect(profiles[0].profile_name).toBe('default');
    expect(profiles[0].model_id).toBe('default');
  });

  it('migrates multiple providers and returns correct count', () => {
    const now = new Date().toISOString();
    writeProviders(tmpDir, [
      makeProvider({ id: 'p1', displayName: 'P1', createdAt: now, updatedAt: now }),
      makeProvider({ id: 'p2', displayName: 'P2', createdAt: now, updatedAt: now }),
      makeProvider({ id: 'p3', displayName: 'P3', createdAt: now, updatedAt: now }),
    ]);
    expect(migrateProvidersFromJson(db, tmpDir)).toBe(3);
    const rows = db.prepare("SELECT id FROM providers WHERE provider_type = 'custom'").all();
    expect(rows).toHaveLength(3);
  });

  it('is idempotent — calling twice does not duplicate rows', () => {
    const p = makeProvider();
    writeProviders(tmpDir, [p]);
    migrateProvidersFromJson(db, tmpDir);
    migrateProvidersFromJson(db, tmpDir);
    expect(db.prepare('SELECT * FROM providers WHERE id = ?').all(p.id as string)).toHaveLength(1);
    expect(db.prepare('SELECT * FROM provider_profiles WHERE provider_id = ?').all(p.id as string)).toHaveLength(1);
  });

  it('updates display_name and base_url on re-migration', () => {
    const p = makeProvider({ baseUrl: 'https://old.example.com' });
    writeProviders(tmpDir, [p]);
    migrateProvidersFromJson(db, tmpDir);
    writeProviders(tmpDir, [{ ...p, displayName: 'Updated', baseUrl: 'https://new.example.com' }]);
    migrateProvidersFromJson(db, tmpDir);
    const row = db.prepare('SELECT display_name, base_url FROM providers WHERE id = ?').get(p.id as string) as Record<string, unknown>;
    expect(row.display_name).toBe('Updated');
    expect(row.base_url).toBe('https://new.example.com');
  });

  it('does not remove built-in providers (anthropic, openai, google)', () => {
    writeProviders(tmpDir, [makeProvider({ id: 'my-custom' })]);
    migrateProvidersFromJson(db, tmpDir);
    const builtins = (db.prepare("SELECT id FROM providers WHERE provider_type = 'builtin'").all() as Array<{ id: string }>).map((r) => r.id);
    expect(builtins).toContain('anthropic');
    expect(builtins).toContain('openai');
    expect(builtins).toContain('google');
  });

  it('stores capabilities as a JSON string', () => {
    const p = makeProvider({ capabilities: ['text-generation', 'vision'] });
    writeProviders(tmpDir, [p]);
    migrateProvidersFromJson(db, tmpDir);
    const row = db.prepare('SELECT capabilities FROM providers WHERE id = ?').get(p.id as string) as Record<string, unknown>;
    expect(JSON.parse(row.capabilities as string)).toEqual(['text-generation', 'vision']);
  });

  it('stores null base_url when provider has no baseUrl', () => {
    const p = makeProvider({ baseUrl: undefined });
    delete (p as Record<string, unknown>).baseUrl;
    writeProviders(tmpDir, [p]);
    migrateProvidersFromJson(db, tmpDir);
    const row = db.prepare('SELECT base_url FROM providers WHERE id = ?').get(p.id as string) as Record<string, unknown>;
    expect(row.base_url).toBeNull();
  });
});

