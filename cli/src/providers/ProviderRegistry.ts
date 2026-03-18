/**
 * ProviderRegistry
 *
 * Central registry for AI provider adapters. Supports built-in providers
 * (Anthropic, OpenAI, Google AI) and user-registered custom adapters through
 * the same ProviderAdapter contract.
 *
 * Satisfies: bd-prov-b1 buff-core.02.01.01 - Implement ProviderRegistry
 */

import type { AdapterEntry, ProviderAdapter } from './types.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when register() is called with an ID already present in the registry.
 * Prevents accidental shadowing of built-in providers.
 */
export class DuplicateProviderError extends Error {
  constructor(public readonly providerId: string) {
    super(
      `Provider "${providerId}" is already registered. ` +
        `Use registry.replace() if you intend to override it.`,
    );
    this.name = 'DuplicateProviderError';
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ProviderRegistry {
  private readonly _entries = new Map<string, AdapterEntry>();

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register an adapter. Throws DuplicateProviderError if the id is already
   * taken. Use replace() to intentionally override an existing entry.
   */
  register(entry: Omit<AdapterEntry, never>): void {
    if (this._entries.has(entry.id)) {
      throw new DuplicateProviderError(entry.id);
    }
    this._entries.set(entry.id, entry);
  }

  /**
   * Register or overwrite an adapter without throwing.
   * Prefer register() unless you explicitly need override semantics.
   */
  replace(entry: AdapterEntry): void {
    this._entries.set(entry.id, entry);
  }

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------

  /**
   * Return the adapter for a given provider ID.
   * Returns undefined if the provider is not registered.
   */
  get(providerId: string): ProviderAdapter | undefined {
    return this._entries.get(providerId)?.adapter;
  }

  /**
   * Return the full entry (including metadata) for a given provider ID.
   * Returns undefined if the provider is not registered.
   */
  getEntry(providerId: string): AdapterEntry | undefined {
    return this._entries.get(providerId);
  }

  /** Return all registered adapters as a flat list of entries. */
  list(): AdapterEntry[] {
    return [...this._entries.values()];
  }

  /**
   * Return true if the given provider ID is registered AND is a built-in
   * provider (i.e. shipped with filmbuff, not user-added).
   */
  isBuiltin(providerId: string): boolean {
    return this._entries.get(providerId)?.builtin === true;
  }

  /** Return true if any provider with the given ID is registered. */
  has(providerId: string): boolean {
    return this._entries.has(providerId);
  }

  /** Return the number of registered providers. */
  get size(): number {
    return this._entries.size;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Default registry instance shared across the filmbuff process.
 * Built-in provider modules register themselves on import.
 */
export const defaultRegistry = new ProviderRegistry();

