/**
 * ProviderRepository
 *
 * All database access for the `providers` and `provider_profiles` tables.
 * Command handlers MUST use this class and never write raw SQL directly.
 *
 * Methods — providers:
 *   upsertProvider(input)          — Insert or update a provider row
 *   findProvider(id)               — Fetch provider by id
 *   listProviders(enabledOnly?)    — List all (or only enabled) providers
 *   setProviderEnabled(id, flag)   — Enable / disable a provider
 *
 * Methods — provider_profiles:
 *   upsertProfile(providerId, input) — Insert or update a named profile
 *   findProfile(providerId, name)    — Fetch a profile by provider + name
 *   listProfiles(providerId)         — All profiles for a provider
 *   activateProfile(providerId, name)— Set is_active=1 (deactivates others)
 *   deleteProfile(providerId, name)  — Remove a non-active profile
 *   getActiveSelection()             — Return active provider_id + profile_name
 *
 * Satisfies: bd-db-a7 buff-core.01.02.03 - Implement ProviderRepository
 */

import Database from 'better-sqlite3';
import {
  DbProvider,
  DbProviderProfile,
  UpsertProviderInput,
  UpsertProfileInput,
  ActiveProviderSelection,
} from './types.js';
import {
  translateSQLiteError,
  BuiltinProviderProtectedError,
} from './errors.js';

// ---------------------------------------------------------------------------
// SQL — providers
// ---------------------------------------------------------------------------

const UPSERT_PROVIDER = `
  INSERT INTO providers
    (id, display_name, provider_type, base_url, capabilities, metadata, is_enabled,
     created_at, updated_at)
  VALUES
    (@id, @display_name, @provider_type, @base_url, @capabilities, @metadata, 1,
     @now, @now)
  ON CONFLICT(id) DO UPDATE SET
    display_name  = excluded.display_name,
    base_url      = excluded.base_url,
    capabilities  = excluded.capabilities,
    metadata      = excluded.metadata,
    updated_at    = excluded.updated_at
`;

const SELECT_PROVIDER_BY_ID  = `SELECT * FROM providers WHERE id = ?`;
const SELECT_PROVIDERS_ALL   = `SELECT * FROM providers ORDER BY display_name ASC`;
const SELECT_PROVIDERS_ENABLED = `SELECT * FROM providers WHERE is_enabled = 1 ORDER BY display_name ASC`;

const SET_PROVIDER_ENABLED = `
  UPDATE providers SET is_enabled = @flag, updated_at = @now WHERE id = @id
`;

// ---------------------------------------------------------------------------
// SQL — provider_profiles
// ---------------------------------------------------------------------------

const UPSERT_PROFILE = `
  INSERT INTO provider_profiles
    (id, provider_id, profile_name, model_id, api_key_ref, api_key_encrypted,
     max_tokens, temperature, extra_settings, is_active, created_at, updated_at)
  VALUES
    (@id, @provider_id, @profile_name, @model_id, @api_key_ref, @api_key_encrypted,
     @max_tokens, @temperature, @extra_settings, 0, @now, @now)
  ON CONFLICT(provider_id, profile_name) DO UPDATE SET
    model_id        = excluded.model_id,
    api_key_ref     = excluded.api_key_ref,
    api_key_encrypted = excluded.api_key_encrypted,
    max_tokens      = excluded.max_tokens,
    temperature     = excluded.temperature,
    extra_settings  = excluded.extra_settings,
    updated_at      = excluded.updated_at
`;

const SELECT_PROFILE = `
  SELECT * FROM provider_profiles WHERE provider_id = ? AND profile_name = ?
`;

const SELECT_PROFILES_BY_PROVIDER = `
  SELECT * FROM provider_profiles WHERE provider_id = ? ORDER BY profile_name ASC
`;

const DEACTIVATE_ALL_PROFILES = `
  UPDATE provider_profiles SET is_active = 0, updated_at = @now
  WHERE provider_id = @provider_id
`;

const ACTIVATE_PROFILE = `
  UPDATE provider_profiles SET is_active = 1, updated_at = @now
  WHERE provider_id = @provider_id AND profile_name = @profile_name
`;

const DELETE_PROFILE = `
  DELETE FROM provider_profiles
  WHERE provider_id = @provider_id AND profile_name = @profile_name AND is_active = 0
`;

const SELECT_ACTIVE_PROFILE = `
  SELECT pp.provider_id, pp.profile_name
  FROM provider_profiles pp
  WHERE pp.is_active = 1
  LIMIT 1
`;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class ProviderRepository {
  constructor(private readonly db: Database.Database) {}

  // -------------------------------------------------------------------------
  // Providers
  // -------------------------------------------------------------------------

  upsertProvider(input: UpsertProviderInput): DbProvider {
    const now = new Date().toISOString();
    try {
      this.db.prepare(UPSERT_PROVIDER).run({
        id:            input.id,
        display_name:  input.display_name,
        provider_type: input.provider_type,
        base_url:      input.base_url   ?? null,
        capabilities:  JSON.stringify(input.capabilities),
        metadata:      input.metadata   ? JSON.stringify(input.metadata) : null,
        now,
      });
    } catch (err) { throw translateSQLiteError(err); }

    return this.db.prepare(SELECT_PROVIDER_BY_ID).get(input.id) as DbProvider;
  }

  findProvider(id: string): DbProvider | undefined {
    return this.db.prepare(SELECT_PROVIDER_BY_ID).get(id) as DbProvider | undefined;
  }

  listProviders(enabledOnly = false): DbProvider[] {
    const sql = enabledOnly ? SELECT_PROVIDERS_ENABLED : SELECT_PROVIDERS_ALL;
    return this.db.prepare(sql).all() as DbProvider[];
  }

  /**
   * Enable or disable a provider.  Built-in providers (type='builtin') cannot
   * be permanently deleted, but can be disabled.
   */
  setProviderEnabled(id: string, enabled: boolean): void {
    const now = new Date().toISOString();
    try {
      this.db.prepare(SET_PROVIDER_ENABLED).run({ id, flag: enabled ? 1 : 0, now });
    } catch (err) { throw translateSQLiteError(err); }
  }

  // -------------------------------------------------------------------------
  // Provider profiles
  // -------------------------------------------------------------------------

  upsertProfile(providerId: string, input: UpsertProfileInput): DbProviderProfile {
    const now = new Date().toISOString();
    const id  = `${providerId}::${input.profile_name}`;
    try {
      this.db.prepare(UPSERT_PROFILE).run({
        id,
        provider_id:       providerId,
        profile_name:      input.profile_name,
        model_id:          input.model_id,
        api_key_ref:       input.api_key_ref        ?? null,
        api_key_encrypted: input.api_key_encrypted  ? 1 : 0,
        max_tokens:        input.max_tokens         ?? null,
        temperature:       input.temperature        ?? null,
        extra_settings:    input.extra_settings
                             ? JSON.stringify(input.extra_settings)
                             : null,
        now,
      });
    } catch (err) { throw translateSQLiteError(err); }

    return this.db
      .prepare(SELECT_PROFILE)
      .get(providerId, input.profile_name) as DbProviderProfile;
  }

  findProfile(providerId: string, profileName: string): DbProviderProfile | undefined {
    return this.db
      .prepare(SELECT_PROFILE)
      .get(providerId, profileName) as DbProviderProfile | undefined;
  }

  listProfiles(providerId: string): DbProviderProfile[] {
    return this.db
      .prepare(SELECT_PROFILES_BY_PROVIDER)
      .all(providerId) as DbProviderProfile[];
  }

  /**
   * Activate a named profile, deactivating all other profiles for the same
   * provider.  Uses a transaction to keep the partial unique index consistent.
   * Throws BuiltinProviderProtectedError if provider is builtin and the
   * operation would violate business rules.
   */
  activateProfile(providerId: string, profileName: string): void {
    const now = new Date().toISOString();
    try {
      this.db.transaction(() => {
        this.db.prepare(DEACTIVATE_ALL_PROFILES).run({ provider_id: providerId, now });
        this.db.prepare(ACTIVATE_PROFILE).run({ provider_id: providerId, profile_name: profileName, now });
      })();
    } catch (err) { throw translateSQLiteError(err); }
  }

  /**
   * Delete a non-active profile.  Active profiles must be deactivated first.
   * Built-in provider profiles that are currently active are protected.
   */
  deleteProfile(providerId: string, profileName: string): void {
    const existing = this.findProfile(providerId, profileName);
    if (!existing) return; // idempotent

    const provider = this.findProvider(providerId);
    if (provider?.provider_type === 'builtin' && existing.is_active) {
      throw new BuiltinProviderProtectedError(providerId, profileName);
    }

    try {
      this.db.prepare(DELETE_PROFILE).run({ provider_id: providerId, profile_name: profileName });
    } catch (err) { throw translateSQLiteError(err); }
  }

  /**
   * Return the globally active provider + profile, or undefined if none is set.
   */
  getActiveSelection(): ActiveProviderSelection | undefined {
    return this.db.prepare(SELECT_ACTIVE_PROFILE).get() as ActiveProviderSelection | undefined;
  }
}

