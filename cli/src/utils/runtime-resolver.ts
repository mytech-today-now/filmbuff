/**
 * Runtime Resolver
 *
 * Resolves the active AI provider/profile at command execution time.
 * Command handlers call resolveActiveProvider() instead of importing SDKs.
 * The resolver loads the active selection, loads the profile, validates
 * required settings and capabilities, and returns a ready ProviderExecutor.
 *
 * Satisfies: bd-ai-providers.6 – Phase 4: Route AI-powered commands through
 *            active provider resolution
 * OpenSpec: openspec/changes/configurable-ai-providers/specs/provider-routing/spec.md
 */

import type { ProviderCapability, ProviderExecutor, ProviderProfile } from '../types/ai-providers.js';
import { profileStore } from './profile-store.js';
import { providerRegistry } from './provider-registry.js';
import { customProviderStore } from './custom-provider-store.js';
import { validateAndResolve } from './provider-validator.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NoActiveProviderError extends Error {
  constructor() {
    super(
      'No active AI provider is configured. ' +
        "Run 'filmbuff provider activate <providerId> <profileName>' or " +
        "'filmbuff configure' to set one up."
    );
    this.name = 'NoActiveProviderError';
  }
}

export class ProfileNotFoundError extends Error {
  constructor(providerId: string, profileName: string) {
    super(
      `Profile "${profileName}" for provider "${providerId}" not found. ` +
        "Run 'filmbuff provider list' to see available profiles."
    );
    this.name = 'ProfileNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Resolution Result
// ---------------------------------------------------------------------------

export interface ResolvedProvider {
  executor: ProviderExecutor;
  profile: ProviderProfile;
  providerId: string;
  profileName: string;
}

// ---------------------------------------------------------------------------
// resolveActiveProvider
// ---------------------------------------------------------------------------

/**
 * Resolve the currently active provider/profile into an executable adapter.
 *
 * Steps:
 *  1. Load custom providers into registry (idempotent).
 *  2. Read the active selection from .augment/providers/active.json.
 *  3. Load the referenced profile from .augment/providers/profiles/.
 *  4. Optionally check the requested capability.
 *  5. Validate the profile and return a ProviderExecutor.
 *
 * Throws NoActiveProviderError, ProfileNotFoundError, or
 * ProviderValidationError on any failure so command handlers surface
 * a clear, secret-free error message.
 */
export function resolveActiveProvider(
  requiredCapability?: ProviderCapability
): ResolvedProvider {
  // Ensure custom providers are registered before lookup.
  customProviderStore.loadIntoRegistry();

  const active = profileStore.getActive();
  if (!active) {
    throw new NoActiveProviderError();
  }

  const { providerId, profileName } = active;

  // Verify the provider is registered (built-in or custom).
  if (!providerRegistry.has(providerId)) {
    throw new Error(
      `Provider "${providerId}" is not registered. ` +
        "Run 'filmbuff provider list' to see available providers."
    );
  }

  const profile = profileStore.load(providerId, profileName);
  if (!profile) {
    throw new ProfileNotFoundError(providerId, profileName);
  }

  const executor = validateAndResolve(profile, requiredCapability);

  return { executor, profile, providerId, profileName };
}

// ---------------------------------------------------------------------------
// resolveProviderByProfile  (manual selection override)
// ---------------------------------------------------------------------------

/**
 * Resolve a specific named profile rather than the active selection.
 * Used by CLI commands that accept --provider / --profile flags.
 */
export function resolveProviderByProfile(
  providerId: string,
  profileName: string,
  requiredCapability?: ProviderCapability
): ResolvedProvider {
  customProviderStore.loadIntoRegistry();

  if (!providerRegistry.has(providerId)) {
    throw new Error(
      `Provider "${providerId}" is not registered. ` +
        "Run 'filmbuff provider list' to see available providers."
    );
  }

  const profile = profileStore.load(providerId, profileName);
  if (!profile) {
    throw new ProfileNotFoundError(providerId, profileName);
  }

  const executor = validateAndResolve(profile, requiredCapability);

  return { executor, profile, providerId, profileName };
}

