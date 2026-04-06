/**
 * Runtime Resolver — Phase 2 Deletion Pass
 *
 * The provider/profile resolver functions (resolveActiveProvider,
 * resolveProviderByProfile) and the profile-store re-exports have been
 * removed as part of replacing the legacy AI provider system with the
 * ai-powered integration.
 *
 * The error classes and ResolvedProvider interface are kept here so that
 * Phase 4 can build the new resolveAIClient() function in this same file
 * without changing downstream imports.
 *
 * OpenSpec: openspec/changes/replace-ai-with-ai-powered/
 */

import type { ProviderExecutor, ProviderProfile } from '../types/ai-providers.js';

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


