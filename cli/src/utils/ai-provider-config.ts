export type AIProviderConfig = {
  aiProvider?: string;
  aiModel?: string;
};

export const DEFAULT_AI_PROVIDER = 'anthropic';
export const DEFAULT_AI_MODEL = 'claude-sonnet-4-6';
export const IMPLEMENTED_AI_PROVIDERS = [DEFAULT_AI_PROVIDER] as const;

export type ImplementedAIProvider = typeof IMPLEMENTED_AI_PROVIDERS[number];

export function normalizeAIProvider(provider?: string | null): string | undefined {
  if (typeof provider !== 'string') {
    return undefined;
  }

  const normalized = provider.trim().toLowerCase();
  return normalized === '' ? undefined : normalized;
}

export function normalizeAIModel(model?: string | null): string | undefined {
  if (typeof model !== 'string') {
    return undefined;
  }

  const normalized = model.trim();
  return normalized === '' ? undefined : normalized;
}

export function isImplementedAIProvider(provider?: string): provider is ImplementedAIProvider {
  return !!provider && (IMPLEMENTED_AI_PROVIDERS as readonly string[]).includes(provider);
}