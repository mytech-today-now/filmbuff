/**
 * AI Provider Domain Model
 *
 * Defines the provider registry adapter contract so command handlers stay thin
 * and deterministic. Built-in and custom providers share the same abstraction.
 *
 * Satisfies: bd-ai-providers.2 - Phase 2: Define provider registry and adapter contract
 * OpenSpec: openspec/changes/configurable-ai-providers/specs/provider-registry/spec.md
 */

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/** Commands / feature areas a provider may support. */
export type ProviderCapability =
  | 'generate-shot-list'
  | 'ai-summary'
  | 'ai-prompts'
  | 'text-generation'
  | 'vision';

// ---------------------------------------------------------------------------
// Settings and Credential Schemas
// ---------------------------------------------------------------------------

/** A single field descriptor used in settings or credential schemas. */
export interface FieldDescriptor {
  /** Machine-readable field key. */
  key: string;
  /** Human-readable label shown in CLI / GUI. */
  label: string;
  /** Whether this field is required for the provider to be usable. */
  required: boolean;
  /** Whether this field contains a secret (API key, token, etc.). */
  secret: boolean;
  /** Optional default value (only for non-secret fields). */
  defaultValue?: string;
  /** Optional description shown during guided setup. */
  description?: string;
}

/** Schema describing the non-secret settings for a provider. */
export type SettingsSchema = FieldDescriptor[];

/** Schema describing the credential fields (secrets) for a provider. */
export type CredentialSchema = FieldDescriptor[];

// ---------------------------------------------------------------------------
// Provider Executor (Adapter Interface)
// ---------------------------------------------------------------------------

/** A generic AI request forwarded to a provider adapter. */
export interface ProviderRequest {
  capability: ProviderCapability;
  model?: string;
  prompt: string;
  options?: Record<string, unknown>;
}

/** A generic AI response returned by a provider adapter. */
export interface ProviderResponse {
  content: string;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  raw?: unknown;
}

/**
 * Executor returned by the registry for a resolved provider/profile.
 * Command handlers call execute() and never import provider SDKs directly.
 */
export interface ProviderExecutor {
  execute(request: ProviderRequest): Promise<ProviderResponse>;
}

// ---------------------------------------------------------------------------
// Provider Definition
// ---------------------------------------------------------------------------

/** Validation result from a provider or profile validation hook. */
export interface ValidationResult {
  valid: boolean;
  /** Error messages (must NOT include secret values). */
  errors: string[];
}

/** Type discriminator for built-in vs user-defined providers. */
export type ProviderType = 'built-in' | 'custom';

/**
 * Core provider definition registered in the ProviderRegistry.
 * Both built-in providers (Anthropic, OpenAI, Google AI) and user-added
 * custom providers implement this shape.
 */
export interface ProviderDefinition {
  /** Unique provider identifier, e.g. "anthropic", "openai", "google-ai". */
  id: string;
  type: ProviderType;
  displayName: string;
  /** Short description shown in CLI lists and GUI cards. */
  description: string;
  /** Capabilities this provider supports. */
  capabilities: ProviderCapability[];
  /** Non-secret settings schema (base URL, org ID, etc.). */
  settingsSchema: SettingsSchema;
  /** Secret credential schema (API key, token, etc.). */
  credentialSchema: CredentialSchema;
  /**
   * Validate a settings + credentials map before a profile is activated.
   * Implementations MUST NOT echo secret values in error strings.
   */
  validate(
    settings: Record<string, string>,
    credentials: Record<string, string>
  ): ValidationResult;
  /**
   * Return an executor for the given resolved profile.
   * Called by the runtime resolver after validation passes.
   */
  createExecutor(
    settings: Record<string, string>,
    credentials: Record<string, string>
  ): ProviderExecutor;
}

// ---------------------------------------------------------------------------
// Provider Profile
// ---------------------------------------------------------------------------

/**
 * A named configuration profile binding a provider to a set of settings
 * and secret references. Multiple profiles can exist per provider.
 */
export interface ProviderProfile {
  providerId: string;
  profileName: string;
  /** Non-secret settings (model overrides, base URL, org, etc.). */
  settings: Record<string, string>;
  /**
   * Secret references — keys match credentialSchema field keys.
   * Values are either plaintext (dev/test) or keychain references.
   */
  secretRefs: Record<string, string>;
  /** Optional model override for this profile. */
  model?: string;
  /** Optional endpoint override for this profile. */
  endpoint?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Active Selection
// ---------------------------------------------------------------------------

/**
 * Persisted active-provider selection. Stored separately from profiles so
 * switching is a lightweight write and runtime resolution is deterministic.
 */
export interface ActiveProviderSelection {
  providerId: string;
  profileName: string;
}

