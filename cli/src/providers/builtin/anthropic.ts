/**
 * Anthropic (Claude) Provider Adapter
 *
 * Implements ProviderAdapter for the Anthropic Messages API.
 * Uses fetch() directly to avoid a hard dependency on the @anthropic-ai/sdk
 * package at runtime; the SDK may be used in a future iteration.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  — Required. API key (starts with sk-ant-).
 *
 * Satisfies: bd-prov-b2 buff-core.02.01.02 - Implement built-in provider adapters
 */

import type { ProviderAdapter, GenerateOptions, GenerateResult } from '../types.js';
import { defaultRegistry } from '../ProviderRegistry.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_MODEL    = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class AnthropicAdapter implements ProviderAdapter {
  constructor(
    private readonly apiKey: string = process.env['ANTHROPIC_API_KEY'] ?? '',
  ) {}

  async generate(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<GenerateResult> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new Error(
        'Anthropic API key not found. Set the ANTHROPIC_API_KEY environment variable.',
      );
    }

    const baseUrl  = options.baseUrl ?? DEFAULT_BASE_URL;
    const model    = options.model   ?? DEFAULT_MODEL;
    const messages: Array<{ role: string; content: string }> = [
      { role: 'user', content: prompt },
    ];

    const body: Record<string, unknown> = {
      model,
      max_tokens: options.maxTokens ?? 4096,
      messages,
    };

    if (options.systemPrompt) {
      body['system'] = options.systemPrompt;
    }
    if (options.temperature !== undefined) {
      body['temperature'] = options.temperature;
    }

    const response = await fetch(`${baseUrl}/messages`, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Anthropic API error ${response.status}: ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text: string }>;
      model?:   string;
      usage?:   { input_tokens?: number; output_tokens?: number };
    };

    const content = data.content
      ?.filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('') ?? '';

    return {
      content,
      model:  data.model,
      usage: {
        inputTokens:  data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
      },
      raw: data,
    };
  }
}

// ---------------------------------------------------------------------------
// Self-register in the default registry
// ---------------------------------------------------------------------------

defaultRegistry.register({
  id:          'anthropic',
  displayName: 'Anthropic (Claude)',
  builtin:     true,
  adapter:     new AnthropicAdapter(),
});

