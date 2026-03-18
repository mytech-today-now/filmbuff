/**
 * FilmBuff Provider JSON-to-DB Migration Shim
 *
 * One-time (idempotent) migration utility that reads the legacy JSON-based
 * custom provider store (.augment/providers/custom-providers.json) and
 * upserts each entry into the `providers` and `provider_profiles` tables.
 *
 * Design decisions:
 *  - Idempotent: uses INSERT OR REPLACE / ON CONFLICT DO UPDATE so it can
 *    be called multiple times without duplicating rows.
 *  - A single default profile row is created per provider (profile_name='default')
 *    because SerializedCustomProvider has no explicit model binding; the model_id
 *    placeholder 'default' can be updated by the user later.
 *  - Built-in providers (anthropic, openai, google) are never touched.
 *  - The source JSON file is left untouched; deletion is the caller's choice.
 *
 * Satisfies: bd-db-a12 buff-core.01.04.01 — Implement provider JSON-to-DB
 *            migration shim
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { translateSQLiteError } from './errors.js';
import type { SerializedCustomProvider } from '../utils/custom-provider-store.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CUSTOM_PROVIDERS_RELATIVE = path.join(
  '.augment', 'providers', 'custom-providers.json'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read and parse the legacy JSON file.  Returns empty array on any error. */
function readLegacyProviders(baseDir: string): SerializedCustomProvider[] {
  const filePath = path.join(baseDir, CUSTOM_PROVIDERS_RELATIVE);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SerializedCustomProvider[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const UPSERT_PROVIDER = `
  INSERT INTO providers
    (id, display_name, provider_type, base_url, capabilities, is_enabled, created_at, updated_at)
  VALUES
    (@id, @display_name, 'custom', @base_url, @capabilities, 1, @created_at, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    display_name = excluded.display_name,
    base_url     = excluded.base_url,
    capabilities = excluded.capabilities,
    updated_at   = excluded.updated_at
`;

const UPSERT_PROFILE = `
  INSERT INTO provider_profiles
    (id, provider_id, profile_name, model_id, api_key_encrypted, is_active, created_at, updated_at)
  VALUES
    (@id, @provider_id, @profile_name, @model_id, 0, 0, @created_at, @updated_at)
  ON CONFLICT(provider_id, profile_name) DO UPDATE SET
    model_id   = excluded.model_id,
    updated_at = excluded.updated_at
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Migrate custom providers from the legacy JSON store into SQLite.
 *
 * @param db      - Open Database instance (must have schema already applied).
 * @param baseDir - Project root directory used to locate the JSON file.
 *                  Defaults to `process.cwd()`.
 * @returns Number of provider rows upserted (0 if nothing to migrate).
 */
export function migrateProvidersFromJson(
  db: Database.Database,
  baseDir: string = process.cwd()
): number {
  const providers = readLegacyProviders(baseDir);
  if (providers.length === 0) return 0;

  const upsertProvider = db.prepare(UPSERT_PROVIDER);
  const upsertProfile  = db.prepare(UPSERT_PROFILE);

  const migrate = db.transaction(() => {
    for (const p of providers) {
      const now = new Date().toISOString();

      upsertProvider.run({
        id:           p.id,
        display_name: p.displayName,
        base_url:     p.baseUrl ?? null,
        capabilities: JSON.stringify(p.capabilities ?? []),
        created_at:   p.createdAt ?? now,
        updated_at:   p.updatedAt ?? now,
      });

      // Create one default profile per provider.
      // model_id defaults to 'default' — the user can update it later.
      upsertProfile.run({
        id:           randomUUID(),
        provider_id:  p.id,
        profile_name: 'default',
        model_id:     'default',
        created_at:   p.createdAt ?? now,
        updated_at:   p.updatedAt ?? now,
      });
    }
  });

  try {
    migrate();
  } catch (err) {
    throw translateSQLiteError(err);
  }

  return providers.length;
}

