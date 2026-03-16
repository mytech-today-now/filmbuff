/**
 * Redaction Utilities
 *
 * Redact secrets from objects, strings, logs, and CLI output so that API keys
 * and other credentials are never echoed to the user or written to diagnostics.
 *
 * Rules:
 *  - Secret fields (FieldDescriptor.secret === true) are replaced with REDACTED.
 *  - Known credential patterns in free-form strings are masked.
 *  - Exported profile metadata omits secretRefs entirely.
 *
 * Satisfies: bd-ai-providers.5 - Phase 3: Implement validation, capability
 *            checks, and redaction
 * OpenSpec: openspec/changes/configurable-ai-providers/specs/provider-registry/spec.md
 */

import type { CredentialSchema, FieldDescriptor, ProviderProfile } from '../types/ai-providers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REDACTED = '[REDACTED]';

/**
 * Patterns that look like API keys or tokens in free-form strings.
 * Each entry is a regex that will be replaced with REDACTED in output strings.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_\-]{10,}/g,   // Anthropic keys
  /sk-[A-Za-z0-9_\-]{20,}/g,        // OpenAI keys
  /AIza[A-Za-z0-9_\-]{30,}/g,       // Google AI keys
  /Bearer\s+[A-Za-z0-9._\-]{10,}/g, // Bearer tokens
];

// ---------------------------------------------------------------------------
// Object-level redaction
// ---------------------------------------------------------------------------

/**
 * Given a credentials map and its schema, return a copy with secret values
 * replaced by REDACTED.  Non-secret fields are passed through unchanged.
 */
export function redactCredentials(
  credentials: Record<string, string>,
  schema: CredentialSchema
): Record<string, string> {
  const redacted: Record<string, string> = { ...credentials };
  for (const field of schema) {
    if (field.secret && Object.prototype.hasOwnProperty.call(redacted, field.key)) {
      redacted[field.key] = REDACTED;
    }
  }
  return redacted;
}

/**
 * Return a copy of the given key-value map with all keys matching secret field
 * names replaced by REDACTED, regardless of schema (defensive overload).
 */
export function redactByFieldNames(
  values: Record<string, string>,
  secretFields: FieldDescriptor[]
): Record<string, string> {
  const secretKeys = new Set(secretFields.filter((f) => f.secret).map((f) => f.key));
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    result[k] = secretKeys.has(k) ? REDACTED : v;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Profile-level redaction (for export / display)
// ---------------------------------------------------------------------------

/**
 * Return a safe copy of a ProviderProfile with secretRefs stripped.
 * Use this whenever a profile is printed to the console or exported.
 */
export function redactProfile(profile: ProviderProfile): Omit<ProviderProfile, 'secretRefs'> & { secretRefs: Record<string, string> } {
  const safeRefs: Record<string, string> = {};
  for (const key of Object.keys(profile.secretRefs)) {
    safeRefs[key] = REDACTED;
  }
  return { ...profile, secretRefs: safeRefs };
}

// ---------------------------------------------------------------------------
// String-level redaction
// ---------------------------------------------------------------------------

/**
 * Scan a free-form string and mask any sub-strings that look like secrets.
 * Safe to apply to log lines, error messages, and diagnostic output.
 */
export function redactString(input: string): string {
  let output = input;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, REDACTED);
  }
  return output;
}

/**
 * Recursively redact an unknown value (object, array, or primitive).
 * Suitable for sanitising arbitrary JSON before logging.
 */
export function redactValue(value: unknown, secretKeys: Set<string> = new Set()): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secretKeys));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = secretKeys.has(k) ? REDACTED : redactValue(v, secretKeys);
    }
    return result;
  }
  return value;
}

