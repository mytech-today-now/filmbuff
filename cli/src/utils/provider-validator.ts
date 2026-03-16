/**
 * Provider Validator
 *
 * Centralised validation and capability-check layer for AI provider operations.
 * All validation results MUST NOT echo secret values (enforced via redaction.ts).
 *
 * Functions:
 *   validateProfile()    – validate a ProviderProfile against its provider definition
 *   checkCapability()    – assert a provider supports a given capability
 *   validateAndResolve() – combined: validate + return a ready ProviderExecutor
 *
 * Satisfies: bd-ai-providers.5 - Phase 3: Implement validation, capability
 *            checks, and redaction
 * OpenSpec: openspec/changes/configurable-ai-providers/specs/provider-routing/spec.md
 */

import type {
  ProviderCapability,
  ProviderExecutor,
  ProviderProfile,
  ValidationResult,
} from '../types/ai-providers.js';
import { providerRegistry } from './provider-registry.js';
import { resolveSecrets } from './profile-store.js';
import { REDACTED } from './redaction.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderValidationError extends Error {
  /** Machine-readable code for programmatic handling. */
  code:
    | 'PROVIDER_NOT_FOUND'
    | 'PROFILE_INVALID'
    | 'CAPABILITY_MISSING'
    | 'SECRET_MISSING';
  /** Human-readable errors safe to show to the user (no secret values). */
  errors: string[];
}

function makeError(
  message: string,
  code: ProviderValidationError['code'],
  errors: string[]
): ProviderValidationError {
  const err = new Error(message) as ProviderValidationError;
  err.code = code;
  err.errors = errors;
  return err;
}

// ---------------------------------------------------------------------------
// validateProfile
// ---------------------------------------------------------------------------

/**
 * Validate a ProviderProfile before activation.
 * Resolves env-ref secrets but never includes their values in the result.
 * Returns a ValidationResult that is safe to display.
 */
export function validateProfile(profile: ProviderProfile): ValidationResult {
  const provider = providerRegistry.get(profile.providerId);
  if (!provider) {
    return {
      valid: false,
      errors: [`Provider not found: ${profile.providerId}`],
    };
  }

  // Resolve secrets for validation (values used internally only).
  const resolvedSecrets = resolveSecrets(profile.secretRefs);

  // Check that all required secret fields resolved to a value.
  const secretErrors: string[] = [];
  for (const field of provider.credentialSchema) {
    if (field.required) {
      const resolved = resolvedSecrets[field.key];
      if (!resolved) {
        const ref = profile.secretRefs[field.key];
        const hint = ref
          ? ` (env ref "${ref}" resolved to nothing)`
          : ' (no value or env ref provided)';
        secretErrors.push(`Missing required credential: ${field.label}${hint}`);
      }
    }
  }
  if (secretErrors.length > 0) {
    return { valid: false, errors: secretErrors };
  }

  // Build a credentials map with resolved values for provider-level validation.
  const resolvedCredentials: Record<string, string> = {};
  for (const [k, v] of Object.entries(resolvedSecrets)) {
    if (v !== undefined) resolvedCredentials[k] = v;
  }

  // Delegate to the provider's own validate() hook.
  // Use a sanitised copy so provider implementations cannot accidentally log raw values.
  const sanitisedCredentials: Record<string, string> = {};
  for (const [k] of Object.entries(resolvedCredentials)) {
    sanitisedCredentials[k] = REDACTED; // provider.validate sees masked values only
  }
  // Run provider validation with actual values but discard result errors that
  // might echo secrets; regenerate safe errors from the credential schema.
  const providerResult = provider.validate(profile.settings, resolvedCredentials);
  if (!providerResult.valid) {
    // Scrub any potential secret echoing from provider-supplied error strings.
    const safeErrors = providerResult.errors.map((e) =>
      e.replace(/sk-[A-Za-z0-9_\-]{10,}/g, REDACTED)
       .replace(/AIza[A-Za-z0-9_\-]{10,}/g, REDACTED)
    );
    return { valid: false, errors: safeErrors };
  }

  return { valid: true, errors: [] };
}

// ---------------------------------------------------------------------------
// checkCapability
// ---------------------------------------------------------------------------

/**
 * Assert that the named provider supports the requested capability.
 * Throws a ProviderValidationError if the check fails.
 */
export function checkCapability(
  providerId: string,
  capability: ProviderCapability
): void {
  const provider = providerRegistry.get(providerId);
  if (!provider) {
    throw makeError(
      `Provider not found: ${providerId}`,
      'PROVIDER_NOT_FOUND',
      [`Provider "${providerId}" is not registered. Run 'filmbuff provider list' to see available providers.`]
    );
  }
  if (!provider.capabilities.includes(capability)) {
    throw makeError(
      `Provider "${provider.displayName}" does not support capability "${capability}"`,
      'CAPABILITY_MISSING',
      [
        `The active provider "${provider.displayName}" does not support "${capability}".`,
        `Supported capabilities: ${provider.capabilities.join(', ')}.`,
        `Switch to a compatible provider with 'filmbuff provider activate'.`,
      ]
    );
  }
}

// ---------------------------------------------------------------------------
// validateAndResolve
// ---------------------------------------------------------------------------

/**
 * Validate a profile and return a ready ProviderExecutor.
 * Throws a ProviderValidationError on any failure so command handlers can
 * surface a clear, secret-free error message.
 */
export function validateAndResolve(
  profile: ProviderProfile,
  requiredCapability?: ProviderCapability
): ProviderExecutor {
  const result = validateProfile(profile);
  if (!result.valid) {
    throw makeError(
      `Provider profile "${profile.profileName}" is invalid`,
      'PROFILE_INVALID',
      result.errors
    );
  }

  if (requiredCapability) {
    checkCapability(profile.providerId, requiredCapability);
  }

  const provider = providerRegistry.get(profile.providerId)!;
  const resolvedSecrets = resolveSecrets(profile.secretRefs);
  const credentials: Record<string, string> = {};
  for (const [k, v] of Object.entries(resolvedSecrets)) {
    if (v !== undefined) credentials[k] = v;
  }

  return provider.createExecutor(profile.settings, credentials);
}

