/**
 * Custom Provider Store
 *
 * Persists user-defined (custom) provider definitions to disk and rehydrates
 * them into the provider registry at runtime.  Custom providers share the
 * same ProviderDefinition contract as built-in providers (Anthropic, OpenAI,
 * Google AI) so command handlers and the validation layer need no changes.
 *
 * Storage: .augment/providers/custom-providers.json  (array of SerializedCustomProvider)
 *
 * Satisfies: bd-ai-providers.4 - Phase 2/3: Add built-in providers and custom
 *            provider registration
 * OpenSpec: openspec/changes/configurable-ai-providers/specs/provider-registry/spec.md
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  ProviderDefinition,
  ProviderCapability,
  SettingsSchema,
  CredentialSchema,
  ValidationResult,
  ProviderExecutor,
  ProviderRequest,
  ProviderResponse,
} from '../types/ai-providers.js';
import { providerRegistry } from './provider-registry.js';

// ---------------------------------------------------------------------------
// Serialised shape (no functions – functions are reconstructed on load)
// ---------------------------------------------------------------------------

export interface SerializedCustomProvider {
  id: string;
  displayName: string;
  description: string;
  capabilities: ProviderCapability[];
  settingsSchema: SettingsSchema;
  credentialSchema: CredentialSchema;
  /** Optional base URL for self-hosted or proxy endpoints. */
  baseUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CUSTOM_PROVIDERS_FILE = path.join('.augment', 'providers', 'custom-providers.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidationResult(errors: string[]): ValidationResult {
  return { valid: errors.length === 0, errors };
}

function requireFields(
  schema: CredentialSchema | SettingsSchema,
  values: Record<string, string>
): string[] {
  return schema
    .filter((f) => f.required && !values[f.key])
    .map((f) => `Missing required field: ${f.label}`);
}

function stubExecutor(displayName: string): ProviderExecutor {
  return {
    async execute(request: ProviderRequest): Promise<ProviderResponse> {
      throw new Error(
        `Custom provider "${displayName}" executor is not yet wired. ` +
          `Capability requested: ${request.capability}`
      );
    },
  };
}

/** Reconstruct a live ProviderDefinition from a serialised record. */
function rehydrate(s: SerializedCustomProvider): ProviderDefinition {
  return {
    id: s.id,
    type: 'custom',
    displayName: s.displayName,
    description: s.description,
    capabilities: s.capabilities,
    settingsSchema: s.settingsSchema,
    credentialSchema: s.credentialSchema,
    validate(_settings: Record<string, string>, credentials: Record<string, string>): ValidationResult {
      const errors = [
        ...requireFields(s.settingsSchema, _settings),
        ...requireFields(s.credentialSchema, credentials),
      ];
      return makeValidationResult(errors);
    },
    createExecutor(_settings: Record<string, string>, _credentials: Record<string, string>): ProviderExecutor {
      return stubExecutor(s.displayName);
    },
  };
}

// ---------------------------------------------------------------------------
// CustomProviderStore
// ---------------------------------------------------------------------------

export class CustomProviderStore {
  private readonly filePath: string;

  constructor(baseDir: string = '.') {
    this.filePath = path.join(baseDir, CUSTOM_PROVIDERS_FILE);
  }

  private ensureDir(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  private readAll(): SerializedCustomProvider[] {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as SerializedCustomProvider[];
    } catch {
      return [];
    }
  }

  private writeAll(providers: SerializedCustomProvider[]): void {
    this.ensureDir();
    fs.writeFileSync(this.filePath, JSON.stringify(providers, null, 2), 'utf-8');
  }

  /** Register (create or replace) a custom provider and persist it. */
  register(provider: SerializedCustomProvider): void {
    const all = this.readAll().filter((p) => p.id !== provider.id);
    all.push(provider);
    this.writeAll(all);
    providerRegistry.register(rehydrate(provider));
  }

  /** Remove a custom provider by ID. Returns true if it existed. */
  unregister(providerId: string): boolean {
    const all = this.readAll();
    const filtered = all.filter((p) => p.id !== providerId);
    if (filtered.length === all.length) return false;
    this.writeAll(filtered);
    return true;
  }

  /** Return the serialised record for a provider, or undefined. */
  get(providerId: string): SerializedCustomProvider | undefined {
    return this.readAll().find((p) => p.id === providerId);
  }

  /** List all persisted custom providers. */
  listAll(): SerializedCustomProvider[] {
    return this.readAll();
  }

  /**
   * Load all persisted custom providers into the provider registry.
   * Call this once at startup before any registry lookups.
   */
  loadIntoRegistry(): void {
    for (const serialized of this.readAll()) {
      providerRegistry.register(rehydrate(serialized));
    }
  }
}

/** Singleton custom-provider store instance. */
export const customProviderStore = new CustomProviderStore();

