/**
 * Profile Store
 *
 * Persists named provider profiles and the active-provider selection.
 * Profiles are stored as individual JSON files under .augment/providers/profiles/.
 * The active selection is stored at .augment/providers/active.json.
 *
 * Secret handling strategy:
 *   - Secrets may be stored as an environment-variable reference: "env:MY_ENV_VAR"
 *   - The resolveSecrets() helper substitutes env refs at runtime.
 *   - Plain-text secrets are supported for dev/test but are never displayed.
 *   - Secrets are NEVER echoed in normal output (redacted via redaction.ts).
 *
 * Satisfies: bd-ai-providers.3 - Phase 2: Define profile storage, active selection,
 *            and secret handling
 * OpenSpec: openspec/changes/configurable-ai-providers/specs/provider-registry/spec.md
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ProviderProfile, ActiveProviderSelection } from '../types/ai-providers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDERS_DIR = '.augment/providers';
const PROFILES_DIR = path.join(PROVIDERS_DIR, 'profiles');
const ACTIVE_FILE = path.join(PROVIDERS_DIR, 'active.json');

/** Prefix used to mark environment-variable secret references. */
export const ENV_REF_PREFIX = 'env:';

/** Prefix used to mark AES-256-GCM encrypted secret references. */
export const ENC_REF_PREFIX = 'enc:';

/** Environment variable used as the master passphrase for secret encryption. */
export const MASTER_KEY_ENV = 'FILMBUFF_MASTER_KEY';

/** PBKDF2 parameters for key derivation. */
const KDF_SALT = 'filmbuff-secret-kdf-salt-v1';
const KDF_ITERATIONS = 100_000;
const KDF_KEY_LEN = 32; // 256 bits
const KDF_DIGEST = 'sha256';

// ---------------------------------------------------------------------------
// Secret Handling
// ---------------------------------------------------------------------------

/**
 * Derive a 256-bit AES key from the master passphrase using PBKDF2.
 * Throws if FILMBUFF_MASTER_KEY is not set in environment.
 */
function deriveMasterKey(): Buffer {
  const passphrase = process.env[MASTER_KEY_ENV];
  if (!passphrase) {
    throw new Error(
      `${MASTER_KEY_ENV} environment variable is required for encrypted secrets. ` +
        'Set it before running filmbuff with encrypted provider profiles.'
    );
  }
  return crypto.pbkdf2Sync(
    passphrase,
    KDF_SALT,
    KDF_ITERATIONS,
    KDF_KEY_LEN,
    KDF_DIGEST
  );
}

/**
 * Encrypt a plaintext secret value with AES-256-GCM.
 * Returns an "enc:<iv_b64>:<tag_b64>:<ciphertext_b64>" reference string.
 * Requires FILMBUFF_MASTER_KEY to be set in the environment.
 */
export function encryptSecret(plaintext: string): string {
  const key = deriveMasterKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const encoded =
    iv.toString('base64') +
    ':' +
    tag.toString('base64') +
    ':' +
    ciphertext.toString('base64');
  return `${ENC_REF_PREFIX}${encoded}`;
}

/**
 * Decrypt an "enc:<iv_b64>:<tag_b64>:<ciphertext_b64>" reference string.
 * Returns the plaintext, or undefined if the master key is missing or decryption fails.
 */
function decryptSecret(encRef: string): string | undefined {
  const encoded = encRef.slice(ENC_REF_PREFIX.length);
  const parts = encoded.split(':');
  if (parts.length !== 3) return undefined;
  try {
    const key = deriveMasterKey();
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const ciphertext = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Resolve secret references in a secretRefs map.
 *   "env:<VAR>"              → process.env[VAR] (returns undefined if not set)
 *   "enc:<iv>:<tag>:<data>"  → AES-256-GCM decrypt using FILMBUFF_MASTER_KEY
 *   plain text               → passed through as-is (dev/test only)
 */
export function resolveSecrets(
  secretRefs: Record<string, string>
): Record<string, string | undefined> {
  const resolved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(secretRefs)) {
    if (value.startsWith(ENV_REF_PREFIX)) {
      const envVar = value.slice(ENV_REF_PREFIX.length);
      resolved[key] = process.env[envVar];
    } else if (value.startsWith(ENC_REF_PREFIX)) {
      resolved[key] = decryptSecret(value);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * Return true if a secret ref value is an env reference (preferred for storage).
 */
export function isEnvRef(value: string): boolean {
  return value.startsWith(ENV_REF_PREFIX);
}

/**
 * Return true if a secret ref value is an AES-256-GCM encrypted reference.
 */
export function isEncRef(value: string): boolean {
  return value.startsWith(ENC_REF_PREFIX);
}

// ---------------------------------------------------------------------------
// Profile Key
// ---------------------------------------------------------------------------

function profileKey(providerId: string, profileName: string): string {
  // Sanitise to safe filename characters.
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return `${safe(providerId)}__${safe(profileName)}`;
}

function profileFilePath(providerId: string, profileName: string): string {
  return path.join(PROFILES_DIR, `${profileKey(providerId, profileName)}.json`);
}

// ---------------------------------------------------------------------------
// ProfileStore
// ---------------------------------------------------------------------------

export class ProfileStore {
  private readonly profilesDir: string;
  private readonly activeFile: string;

  constructor(baseDir: string = '.') {
    this.profilesDir = path.join(baseDir, PROFILES_DIR);
    this.activeFile = path.join(baseDir, ACTIVE_FILE);
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.profilesDir, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // Profile CRUD
  // -------------------------------------------------------------------------

  /** Save (create or update) a named profile. */
  save(profile: ProviderProfile): void {
    this.ensureDirs();
    const filePath = path.join(
      this.profilesDir,
      `${profileKey(profile.providerId, profile.profileName)}.json`
    );
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf-8');
  }

  /** Load a named profile. Returns undefined if not found. */
  load(providerId: string, profileName: string): ProviderProfile | undefined {
    const filePath = path.join(
      this.profilesDir,
      `${profileKey(providerId, profileName)}.json`
    );
    if (!fs.existsSync(filePath)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ProviderProfile;
    } catch {
      return undefined;
    }
  }

  /** Delete a named profile. Returns true if it existed. */
  delete(providerId: string, profileName: string): boolean {
    const filePath = path.join(
      this.profilesDir,
      `${profileKey(providerId, profileName)}.json`
    );
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  /** List all saved profiles (all providers). */
  listAll(): ProviderProfile[] {
    if (!fs.existsSync(this.profilesDir)) return [];
    return fs
      .readdirSync(this.profilesDir)
      .filter((f) => f.endsWith('.json'))
      .flatMap((f) => {
        try {
          return [JSON.parse(fs.readFileSync(path.join(this.profilesDir, f), 'utf-8')) as ProviderProfile];
        } catch {
          return [];
        }
      });
  }

  /** List profiles for a specific provider. */
  listByProvider(providerId: string): ProviderProfile[] {
    return this.listAll().filter((p) => p.providerId === providerId);
  }

  // -------------------------------------------------------------------------
  // Active Selection
  // -------------------------------------------------------------------------

  /** Persist the active provider/profile selection. */
  setActive(selection: ActiveProviderSelection): void {
    this.ensureDirs();
    fs.writeFileSync(this.activeFile, JSON.stringify(selection, null, 2), 'utf-8');
  }

  /** Load the active provider/profile selection. Returns undefined if none set. */
  getActive(): ActiveProviderSelection | undefined {
    if (!fs.existsSync(this.activeFile)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(this.activeFile, 'utf-8')) as ActiveProviderSelection;
    } catch {
      return undefined;
    }
  }

  /** Clear the active selection. */
  clearActive(): void {
    if (fs.existsSync(this.activeFile)) fs.unlinkSync(this.activeFile);
  }
}

/** Singleton profile store instance. */
export const profileStore = new ProfileStore();

