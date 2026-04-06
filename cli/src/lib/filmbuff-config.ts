/**
 * filmbuff-config.ts
 *
 * Config loader and provider resolver for filmbuff-prompt (bd-9fu6).
 *
 * Public API:
 *   loadFilmbuffConfig(configPath?)  — reads filmbuff.config.json; never throws;
 *                                      returns built-in defaults on any error.
 *   resolveProvider(config, flags)   — applies the precedence rule:
 *                                      CLI flag > config.defaultProvider/Model > built-in default.
 *
 * Spec: openspec/archive/filmbuff-prompt/specs/batch-payload/spec.md § Provider Config
 * Epic: bd-8n2o
 */

import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VideoProvider {
  id: string;
  displayName?: string;
  apiKeyEnvVar?: string | null;
  defaultModel?: string;
  supportedModels?: string[];
  videoSupport?: boolean;
  /** Max reference images for I2V; -1 = unlimited; 0 = no video support. */
  maxI2VImages?: number;
  baseUrl?: string | null;
  [key: string]: unknown;
}

/** Capability record returned by GET /providers or constructed from the static table. */
export interface ProviderCapability {
  id: string;
  videoSupport: boolean;
  maxI2VImages: number;
  models: string[];
}

export interface FilmbuffConfig {
  defaultProvider: string;
  defaultModel: string;
  videoProviders: VideoProvider[];
}

export interface ProviderFlags {
  provider?: string;
  model?: string;
}

export interface ResolvedProvider {
  providerId: string;
  model: string;
  providerConfig: VideoProvider | undefined;
}

// ---------------------------------------------------------------------------
// Built-in defaults (used when config file is absent or unreadable)
// ---------------------------------------------------------------------------

export const DEFAULT_PROVIDER_ID = 'lumaai';
export const DEFAULT_MODEL = 'ray-2';

export const BUILTIN_DEFAULT_CONFIG: FilmbuffConfig = {
  defaultProvider: DEFAULT_PROVIDER_ID,
  defaultModel: DEFAULT_MODEL,
  videoProviders: [
    {
      id: 'lumaai',
      displayName: 'Luma AI',
      apiKeyEnvVar: 'LUMAAI_API_KEY',
      defaultModel: 'ray-2',
      supportedModels: ['ray-2', 'ray-2-turbo'],
      videoSupport: true,
      maxI2VImages: 2,
      baseUrl: 'https://api.lumalabs.ai'
    },
    {
      id: 'xai',
      displayName: 'xAI (Grok)',
      apiKeyEnvVar: 'XAI_API_KEY',
      defaultModel: 'grok-2-vision',
      supportedModels: ['grok-2-vision'],
      videoSupport: true,
      maxI2VImages: 1,
      baseUrl: 'https://api.x.ai'
    },
    {
      id: 'venice',
      displayName: 'Venice AI',
      apiKeyEnvVar: 'VENICE_API_KEY',
      defaultModel: 'wan-2.5-preview-image-to-video',
      supportedModels: ['wan-2.5-preview-image-to-video'],
      videoSupport: true,
      maxI2VImages: 1,
      baseUrl: 'https://api.venice.ai'
    },
    {
      id: 'openai',
      displayName: 'OpenAI',
      // apiKeyEnvVar intentionally omitted: key management delegated to ai-powered (Phase 9, bd-99b2)
      defaultModel: 'gpt-4o',
      supportedModels: ['gpt-4o', 'gpt-4o-mini', 'dall-e-3'],
      videoSupport: false,
      maxI2VImages: 0,
      baseUrl: 'https://api.openai.com'
    },
    {
      id: 'anthropic',
      displayName: 'Anthropic (Claude)',
      // apiKeyEnvVar intentionally omitted: key management delegated to ai-powered (Phase 9, bd-99b2)
      defaultModel: 'claude-sonnet-4-5',
      supportedModels: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-3-5'],
      videoSupport: false,
      maxI2VImages: 0,
      baseUrl: 'https://api.anthropic.com'
    },
    {
      id: 'mock',
      displayName: 'Mock (CI/local testing – no API calls)',
      apiKeyEnvVar: null,
      defaultModel: 'mock-v1',
      supportedModels: ['mock-v1'],
      videoSupport: true,
      maxI2VImages: -1,
      baseUrl: null
    }
  ]
};

// ---------------------------------------------------------------------------
// loadFilmbuffConfig
// ---------------------------------------------------------------------------

/**
 * Read and parse filmbuff.config.json at the given path (or from the repo root
 * by default).  Never throws — returns BUILTIN_DEFAULT_CONFIG on any error so
 * the caller always gets a usable object.
 */
export function loadFilmbuffConfig(configPath?: string): FilmbuffConfig {
  const resolvedPath =
    configPath ?? path.resolve(process.cwd(), 'filmbuff.config.json');

  if (!fs.existsSync(resolvedPath)) {
    return { ...BUILTIN_DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<FilmbuffConfig>;

    return {
      defaultProvider: parsed.defaultProvider ?? DEFAULT_PROVIDER_ID,
      defaultModel:    parsed.defaultModel    ?? DEFAULT_MODEL,
      videoProviders:  Array.isArray(parsed.videoProviders)
        ? parsed.videoProviders
        : BUILTIN_DEFAULT_CONFIG.videoProviders
    };
  } catch {
    return { ...BUILTIN_DEFAULT_CONFIG };
  }
}

// ---------------------------------------------------------------------------
// resolveProvider
// ---------------------------------------------------------------------------

/**
 * Resolve the active video provider and model.
 *
 * Precedence (highest → lowest):
 *   1. CLI flags  (--provider / --model)
 *   2. config.defaultProvider / config.defaultModel
 *   3. Built-in default  (lumaai / ray-2)
 */
export function resolveProvider(
  config: FilmbuffConfig,
  flags: ProviderFlags = {}
): ResolvedProvider {
  // Use || (not ??) so that empty strings also fall through to the next level
  const providerId = flags.provider || config.defaultProvider || DEFAULT_PROVIDER_ID;
  const model      = flags.model    || config.defaultModel    || DEFAULT_MODEL;

  const providerConfig = config.videoProviders.find(p => p.id === providerId);

  return { providerId, model, providerConfig };
}

// ---------------------------------------------------------------------------
// fetchProviderCapabilities
// ---------------------------------------------------------------------------

/**
 * Options for fetchProviderCapabilities.
 */
export interface FetchCapabilitiesOptions {
  /** Timeout in milliseconds (default: 5000). */
  timeoutMs?: number;
  /** If true, skip the network call and return the static fallback immediately. */
  offline?: boolean;
}

/**
 * Attempt to retrieve live provider capability data from the ai-powered proxy
 * via `GET <baseUrl>/providers`.  On any failure (network error, timeout,
 * non-2xx response, parse error, or offline mode) the function returns a
 * capability map built from the static `filmbuff.config.json` table instead.
 *
 * The returned Map is keyed by provider id.
 */
export async function fetchProviderCapabilities(
  baseUrl: string,
  config: FilmbuffConfig,
  options: FetchCapabilitiesOptions = {}
): Promise<Map<string, ProviderCapability>> {
  const staticFallback = buildStaticCapabilities(config);

  if (options.offline) {
    return staticFallback;
  }

  const timeoutMs = options.timeoutMs ?? 5000;
  const url = `${baseUrl.replace(/\/$/, '')}/providers`;

  try {
    const raw = await httpGet(url, timeoutMs);
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) return staticFallback;

    const result = new Map<string, ProviderCapability>();
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).id === 'string'
      ) {
        const e = entry as Record<string, unknown>;
        result.set(e.id as string, {
          id: e.id as string,
          videoSupport: Boolean(e.videoSupport ?? e.video_support),
          maxI2VImages: typeof e.maxI2VImages === 'number' ? e.maxI2VImages : 0,
          models: Array.isArray(e.models) ? (e.models as string[]) : []
        });
      }
    }
    return result.size > 0 ? result : staticFallback;
  } catch {
    return staticFallback;
  }
}

/**
 * Build a ProviderCapability map from the static provider table in config.
 */
export function buildStaticCapabilities(config: FilmbuffConfig): Map<string, ProviderCapability> {
  const map = new Map<string, ProviderCapability>();
  for (const p of config.videoProviders) {
    map.set(p.id, {
      id: p.id,
      videoSupport: p.videoSupport ?? false,
      maxI2VImages: p.maxI2VImages ?? 0,
      models: p.supportedModels ?? []
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Perform a GET request with a timeout; resolves with response body as string. */
function httpGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https') ? https : http;
    const req = transport.get(url, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}
