/**
 * Google AI (Gemini) Provider Adapter
 *
 * Implements ProviderAdapter for the Google Generative Language REST API.
 * Uses the generateContent endpoint so no SDK dependency is required.
 *
 * Environment variables:
 *   GOOGLE_AI_API_KEY  — Required. Google AI Studio API key.
 *
 * Satisfies: bd-prov-b2 buff-core.02.01.02 - Implement built-in provider adapters
 */

import type { ProviderAdapter, GenerateOptions, GenerateResult } from '../types.js';
import { defaultRegistry } from '../ProviderRegistry.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL    = 'gemini-2.0-flash';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeminiContent {
  role: string;
  parts: Array<{ text: string }>;
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?:     number;
    candidatesTokenCount?: number;
  };
  modelVersion?: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class GoogleAIAdapter implements ProviderAdapter {
  constructor(
    private readonly apiKey: string = process.env['GOOGLE_AI_API_KEY'] ?? '',
    private readonly defaultBaseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async generate(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<GenerateResult> {
    const apiKey  = this.apiKey;
    if (!apiKey) {
      throw new Error(
        'Google AI API key not found. Set the GOOGLE_AI_API_KEY environment variable.',
      );
    }

    // Google AI does not support base_url overrides in the same way as OpenAI,
    // but we honour the field to remain consistent with the interface.
    const baseUrl = options.baseUrl ?? this.defaultBaseUrl;
    const model   = options.model   ?? DEFAULT_MODEL;

    const contents: GeminiContent[] = [];

    // Gemini uses a system_instruction separate from contents
    const body: Record<string, unknown> = { contents };

    if (options.systemPrompt) {
      body['system_instruction'] = {
        parts: [{ text: options.systemPrompt }],
      };
    }

    contents.push({ role: 'user', parts: [{ text: prompt }] });

    const generationConfig: Record<string, unknown> = {};
    if (options.maxTokens !== undefined) {
      generationConfig['maxOutputTokens'] = options.maxTokens;
    }
    if (options.temperature !== undefined) {
      generationConfig['temperature'] = options.temperature;
    }
    if (Object.keys(generationConfig).length > 0) {
      body['generationConfig'] = generationConfig;
    }

    const url = `${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Google AI API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as GeminiGenerateResponse;

    const content = data.candidates
      ?.flatMap((c) => c.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('') ?? '';

    return {
      content,
      model: data.modelVersion ?? model,
      usage: {
        inputTokens:  data.usageMetadata?.promptTokenCount,
        outputTokens: data.usageMetadata?.candidatesTokenCount,
      },
      raw: data,
    };
  }
}

// ---------------------------------------------------------------------------
// Self-register in the default registry
// ---------------------------------------------------------------------------

defaultRegistry.register({
  id:          'google-ai',
  displayName: 'Google AI (Gemini)',
  builtin:     true,
  adapter:     new GoogleAIAdapter(),
});

