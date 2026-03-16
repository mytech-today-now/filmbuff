/**
 * Provider Registry
 *
 * Central registry for AI provider definitions. Supports built-in providers
 * (Anthropic, OpenAI, Google AI) and user-registered custom providers through
 * the same ProviderDefinition contract.
 *
 * Satisfies: bd-ai-providers.2 - Phase 2: Define provider registry and adapter contract
 * OpenSpec: openspec/changes/configurable-ai-providers/specs/provider-registry/spec.md
 */

import type {
  ProviderDefinition,
  ProviderCapability,
  ValidationResult,
  ProviderExecutor,
  ProviderRequest,
  ProviderResponse,
  SettingsSchema,
  CredentialSchema,
} from '../types/ai-providers.js';

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

// ---------------------------------------------------------------------------
// Stub Executors (replaced by real SDK adapters in later phases)
// ---------------------------------------------------------------------------

function stubExecutor(providerDisplayName: string): ProviderExecutor {
  return {
    async execute(request: ProviderRequest): Promise<ProviderResponse> {
      throw new Error(
        `${providerDisplayName} executor is not yet implemented. ` +
          `Capability requested: ${request.capability}`
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Built-in Provider Definitions
// ---------------------------------------------------------------------------

const ANTHROPIC_PROVIDER: ProviderDefinition = {
  id: 'anthropic',
  type: 'built-in',
  displayName: 'Anthropic (Claude)',
  description: 'Anthropic Claude models via the Anthropic API.',
  capabilities: ['generate-shot-list', 'ai-summary', 'ai-prompts', 'text-generation'],
  settingsSchema: [
    { key: 'model', label: 'Model', required: false, secret: false, defaultValue: 'claude-sonnet-4-6', description: 'Claude model identifier' },
  ],
  credentialSchema: [
    { key: 'apiKey', label: 'API Key', required: true, secret: true, description: 'Your Anthropic API key (starts with sk-ant-)' },
  ],
  validate(settings, credentials) {
    const errors = requireFields(this.credentialSchema, credentials);
    if (credentials.apiKey && !credentials.apiKey.startsWith('sk-')) {
      errors.push('API Key does not look like a valid Anthropic key (expected sk-ant-… prefix)');
    }
    return makeValidationResult(errors);
  },
  createExecutor(_settings, _credentials) {
    return stubExecutor(this.displayName);
  },
};

const OPENAI_PROVIDER: ProviderDefinition = {
  id: 'openai',
  type: 'built-in',
  displayName: 'OpenAI',
  description: 'OpenAI GPT models via the OpenAI API.',
  capabilities: ['generate-shot-list', 'ai-summary', 'ai-prompts', 'text-generation', 'vision'],
  settingsSchema: [
    { key: 'model', label: 'Model', required: false, secret: false, defaultValue: 'gpt-4o', description: 'OpenAI model identifier' },
    { key: 'organization', label: 'Organization ID', required: false, secret: false, description: 'Optional OpenAI organization ID' },
  ],
  credentialSchema: [
    { key: 'apiKey', label: 'API Key', required: true, secret: true, description: 'Your OpenAI API key (starts with sk-)' },
  ],
  validate(settings, credentials) {
    const errors = requireFields(this.credentialSchema, credentials);
    if (credentials.apiKey && !credentials.apiKey.startsWith('sk-')) {
      errors.push('API Key does not look like a valid OpenAI key (expected sk- prefix)');
    }
    return makeValidationResult(errors);
  },
  createExecutor(_settings, _credentials) {
    return stubExecutor(this.displayName);
  },
};

const GOOGLE_AI_PROVIDER: ProviderDefinition = {
  id: 'google-ai',
  type: 'built-in',
  displayName: 'Google AI (Gemini)',
  description: 'Google Gemini models via the Google AI API.',
  capabilities: ['generate-shot-list', 'ai-summary', 'ai-prompts', 'text-generation', 'vision'],
  settingsSchema: [
    { key: 'model', label: 'Model', required: false, secret: false, defaultValue: 'gemini-2.0-flash', description: 'Google AI model identifier' },
    { key: 'region', label: 'Region', required: false, secret: false, description: 'Optional Vertex AI region' },
  ],
  credentialSchema: [
    { key: 'apiKey', label: 'API Key', required: true, secret: true, description: 'Your Google AI Studio API key' },
  ],
  validate(settings, credentials) {
    const errors = requireFields(this.credentialSchema, credentials);
    return makeValidationResult(errors);
  },
  createExecutor(_settings, _credentials) {
    return stubExecutor(this.displayName);
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

class ProviderRegistry {
  private readonly _providers = new Map<string, ProviderDefinition>();

  constructor() {
    this.register(ANTHROPIC_PROVIDER);
    this.register(OPENAI_PROVIDER);
    this.register(GOOGLE_AI_PROVIDER);
  }

  /** Register a provider definition (built-in or custom). */
  register(provider: ProviderDefinition): void {
    this._providers.set(provider.id, provider);
  }

  /** Look up a provider by ID. Returns undefined if not found. */
  get(providerId: string): ProviderDefinition | undefined {
    return this._providers.get(providerId);
  }

  /** List all registered providers. */
  list(): ProviderDefinition[] {
    return [...this._providers.values()];
  }

  /** List providers that support a given capability. */
  listByCapability(capability: ProviderCapability): ProviderDefinition[] {
    return this.list().filter((p) => p.capabilities.includes(capability));
  }

  /** Check whether a provider ID is registered. */
  has(providerId: string): boolean {
    return this._providers.has(providerId);
  }
}

/** Singleton registry instance pre-loaded with all built-in providers. */
export const providerRegistry = new ProviderRegistry();

export type { ProviderRegistry };
export { ANTHROPIC_PROVIDER, OPENAI_PROVIDER, GOOGLE_AI_PROVIDER };

