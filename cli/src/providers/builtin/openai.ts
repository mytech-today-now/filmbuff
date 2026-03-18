/**
 * OpenAI Provider Adapter
 *
 * Implements ProviderAdapter for the OpenAI Chat Completions API.
 * Supports base_url override so the same adapter works with any
 * OpenAI-compatible endpoint (Ollama, LocalAI, Azure OpenAI, etc.).
 *
 * Environment variables:
 *   OPENAI_API_KEY     — Required for openai.com. May be set to any value
 *                        for local endpoints that don't require auth.
 *   OPENAI_BASE_URL    — Optional base URL override (env fallback).
 *
 * Satisfies: bd-prov-b2 buff-core.02.01.02 - Implement built-in provider adapters
 */

import type { ProviderAdapter, GenerateOptions, GenerateResult } from '../types.js';
import { defaultRegistry } from '../ProviderRegistry.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL    = 'gpt-4o';

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenAIAdapter implements ProviderAdapter {
  constructor(
    private readonly apiKey: string = process.env['OPENAI_API_KEY'] ?? '',
    private readonly defaultBaseUrl: string = process.env['OPENAI_BASE_URL'] ?? DEFAULT_BASE_URL,
  ) {}

  async generate(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<GenerateResult> {
    const apiKey  = this.apiKey;
    const baseUrl = options.baseUrl ?? this.defaultBaseUrl;
    const model   = options.model   ?? DEFAULT_MODEL;

    // For local/custom endpoints the key may legitimately be absent or 'none'
    if (!apiKey) {
      throw new Error(
        'OpenAI API key not found. Set the OPENAI_API_KEY environment variable ' +
          '(or set it to "none" for unauthenticated local endpoints).',
      );
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = { model, messages };
    if (options.maxTokens !== undefined) {
      body['max_tokens'] = options.maxTokens;
    }
    if (options.temperature !== undefined) {
      body['temperature'] = options.temperature;
    }
    // Forward any provider-specific extras
    if (options.extra) {
      Object.assign(body, options.extra);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey !== 'none') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?:   string;
      usage?:   { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content ?? '';

    return {
      content,
      model:  data.model,
      usage: {
        inputTokens:  data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
      raw: data,
    };
  }
}

// ---------------------------------------------------------------------------
// Self-register in the default registry
// ---------------------------------------------------------------------------

defaultRegistry.register({
  id:          'openai',
  displayName: 'OpenAI',
  builtin:     true,
  adapter:     new OpenAIAdapter(),
});

