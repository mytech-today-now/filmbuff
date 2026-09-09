/**
 * pre-export-validator.ts
 *
 * Pre-export validation for the POST /batch payload (Phase 6 / bd-b4ce).
 *
 * Runs validation rules V-1 through V-6 in order before generate-shot-list
 * writes or emits any batch payload.  BLOCKING errors halt export; NON-BLOCKING
 * warnings are surfaced to the user but do not halt export.
 *
 * Rules (filmbuff-prompt-JIRA DR-10):
 *   V-1 | Every per-shot references[] key exists in document references map | BLOCKING
 *   V-2 | Every URL in references map is a valid absolute HTTPS URL or data URI | BLOCKING
 *   V-3 | URL reachability — HTTP HEAD, 5s timeout | BLOCKING (skipped offline/CI; warning with mock)
 *   V-4 | Every per-shot provider override is valid in filmbuff.config.json | BLOCKING
 *   V-5 | Every per-shot model override belongs to the specified provider | BLOCKING
 *   V-6 | WARN when shot has >1 reference and provider supports only 1 image | NON-BLOCKING
 *
 * Spec: filmbuff-prompt-JIRA DR-10, AC-14, AC-15, AC-8
 * Beads: bd-b4ce (Phase 6)
 */

import * as https from 'https';
import * as http from 'http';
import type { FilmbuffConfig, VideoProvider } from './filmbuff-config';
import { getSharedVideoModel, type VideoModelCapability } from './provider-capabilities.js';
import { validatePikaOptions, validatePikaReferenceCount } from './pika-validation.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single item in the batch payload (minimal shape needed for validation). */
export interface ValidatableItem {
  name: string;
  references?: string[];
  provider?: string;
  model?: string;
  providerOptions?: Record<string, unknown>;
}

/** The batch payload shape expected by the validator. */
export interface ValidatablePayload {
  provider: string;
  model: string;
  references?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  items: ValidatableItem[];
}

/** A blocking validation error. */
export interface ValidationError {
  rule: 'V-1' | 'V-2' | 'V-3' | 'V-4' | 'V-5' | 'V-7';
  shotName?: string;
  message: string;
}

/** A non-blocking validation warning. */
export interface ValidationWarning {
  rule: 'V-6';
  shotName: string;
  message: string;
}

export interface ValidationResult {
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/** Options for validateBatchPayload. */
export interface ValidatorOptions {
  /**
   * Skip URL reachability checks (V-3).
   * Automatically true when CI=true env var is set.
   */
  offline?: boolean;
  /**
   * When the envelope provider is "mock", V-3 failures become non-blocking warnings.
   * AC-8: mock provider never requires API access.
   */
  isMockProvider?: boolean;
  /** Timeout in milliseconds for V-3 HTTP HEAD requests (default: 5000). */
  reachabilityTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// URL validation helpers
// ---------------------------------------------------------------------------

const HTTPS_URL_RE = /^https:\/\/.+/i;
const DATA_URI_RE  = /^data:image\//i;

/** Returns true if the URL is a valid absolute HTTPS URL or data URI (V-2). */
export function isValidReferenceUrl(url: string): boolean {
  return HTTPS_URL_RE.test(url) || DATA_URI_RE.test(url);
}

/** Returns true if the URL is a data URI (skip reachability check for these). */
export function isDataUri(url: string): boolean {
  return DATA_URI_RE.test(url);
}

// ---------------------------------------------------------------------------
// V-3 reachability check
// ---------------------------------------------------------------------------

/**
 * Check URL reachability via HTTP HEAD with timeout.
 * Resolves to { reachable: true } on 2xx / 206.
 * Resolves to { reachable: false, status } on non-2xx.
 * Rejects on network error or timeout.
 */
export function checkUrlReachability(
  url: string,
  timeoutMs: number
): Promise<{ reachable: boolean; status?: number }> {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https') ? https : http;
    const req = transport.request(url, { method: 'HEAD' }, (res) => {
      const status = res.statusCode ?? 0;
      res.resume(); // drain response
      if (status >= 200 && status < 300 || status === 206) {
        resolve({ reachable: true, status });
      } else {
        resolve({ reachable: false, status });
      }
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`HEAD ${url} timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}


// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

/**
 * Run V-1 through V-6 validation against the batch payload.
 *
 * @param payload   - The payload to validate.
 * @param config    - filmbuff.config.json (for provider/model validation).
 * @param options   - Offline mode, mock-provider mode, timeout.
 * @returns         - { errors, warnings }. Export MUST be halted if errors.length > 0.
 */
export async function validateBatchPayload(
  payload: ValidatablePayload,
  config: FilmbuffConfig,
  options: ValidatorOptions = {}
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const refsMap  = payload.references ?? {};
  const refKeys  = new Set(Object.keys(refsMap));
  const timeoutMs = options.reachabilityTimeoutMs ?? 5000;
  const offline   = options.offline ?? (process.env['CI'] === 'true');
  const isMock    = options.isMockProvider ?? (payload.provider === 'mock');

  // Build a lookup of provider id → models array from config
  const providerModels = new Map<string, string[]>();
  for (const p of config.videoProviders) {
    providerModels.set(p.id, p.supportedModels ?? []);
  }

  // V-1: Every per-shot references[] key must exist in the document-level map
  for (const item of payload.items) {
    for (const key of item.references ?? []) {
      if (!refKeys.has(key)) {
        errors.push({
          rule: 'V-1',
          shotName: item.name,
          message: `Shot "${item.name}": reference key "${key}" not found in document references map.`
        });
      }
    }
  }

  // V-2: Every URL in the references map must be a valid HTTPS URL or data URI
  for (const [key, url] of Object.entries(refsMap)) {
    if (!isValidReferenceUrl(url)) {
      errors.push({
        rule: 'V-2',
        message: `Reference "${key}": invalid URL "${url}".`
      });
    }
  }

  // V-3: URL reachability — skipped when offline=true or CI=true
  // Non-blocking warning when provider is mock (AC-8)
  if (!offline) {
    const reachabilityChecks = Object.entries(refsMap)
      .filter(([, url]) => !isDataUri(url) && isValidReferenceUrl(url))
      .map(async ([key, url]) => {
        try {
          const result = await checkUrlReachability(url, timeoutMs);
          if (!result.reachable) {
            const msg = `Reference "${key}": URL "${url}" returned HTTP ${result.status ?? 'error'}. Ensure the asset is publicly accessible.`;
            if (isMock) {
              warnings.push({ rule: 'V-6', shotName: '', message: msg });
            } else {
              errors.push({ rule: 'V-3', message: msg });
            }
          }
        } catch (err: unknown) {
          const detail = err instanceof Error ? err.message : String(err);
          const msg = `Reference "${key}": URL "${url}" is not reachable (${detail}).`;
          if (isMock) {
            warnings.push({ rule: 'V-6', shotName: '', message: msg });
          } else {
            errors.push({ rule: 'V-3', message: msg });
          }
        }
      });
    await Promise.all(reachabilityChecks);
  }

  // V-4: Every per-shot provider override must be a valid id in config
  for (const item of payload.items) {
    if (item.provider != null && !providerModels.has(item.provider)) {
      errors.push({
        rule: 'V-4',
        shotName: item.name,
        message: `Shot "${item.name}": unknown provider "${item.provider}".`
      });
    }
  }

  // V-5: Every per-shot model override must belong to the specified provider
  for (const item of payload.items) {
    if (item.model != null) {
      const effectiveProvider = item.provider ?? payload.provider;
      const models = providerModels.get(effectiveProvider) ?? [];
      if (models.length > 0 && !models.includes(item.model)) {
        errors.push({
          rule: 'V-5',
          shotName: item.name,
          message: `Shot "${item.name}": model "${item.model}" is not available for provider "${effectiveProvider}".`
        });
      }
    }
  }

  // V-7: Pika model options and model-specific reference limits are blocking.
  for (const item of payload.items) {
    const effectiveProvider = item.provider ?? payload.provider;
    if (effectiveProvider !== 'pika') continue;

    const effectiveModel = item.model ?? payload.model;
    const providerConfig = config.videoProviders.find(p => p.id === effectiveProvider);
    const modelCapability = findModelCapability(providerConfig, effectiveModel);
    if (!modelCapability) continue;

    const refCount = item.references?.length ?? 0;
    const optionRecord = item.providerOptions ?? payload.providerOptions;
    const hasMediaOption = Boolean(
      optionRecord &&
      modelCapability.requiredOptions.some(field => Object.prototype.hasOwnProperty.call(optionRecord, field))
    );
    if (refCount > 0 || !hasMediaOption) {
      for (const message of validatePikaReferenceCount(modelCapability, refCount)) {
        errors.push({ rule: 'V-7', shotName: item.name, message: `Shot "${item.name}": ${message}` });
      }
    }

    if (optionRecord !== undefined) {
      for (const message of validatePikaOptions(modelCapability, optionRecord)) {
        errors.push({ rule: 'V-7', shotName: item.name, message: `Shot "${item.name}": ${message}` });
      }
    } else if (modelCapability.requiredOptions.some(field => field !== 'prompt')) {
      errors.push({
        rule: 'V-7',
        shotName: item.name,
        message: `Shot "${item.name}": Pika model "${effectiveModel}" requires providerOptions.`
      });
    }
  }

  // V-6: WARN (non-blocking) when shot has >1 reference and provider supports only 1 image
  const capabilityTable = new Map(
    config.videoProviders.map(p => [p.id, p.maxI2VImages ?? 0])
  );
  for (const item of payload.items) {
    const refCount = item.references?.length ?? 0;
    if (refCount > 1) {
      const effectiveProvider = item.provider ?? payload.provider;
      const maxImages = capabilityTable.get(effectiveProvider) ?? 0;
      // maxI2VImages = -1 means unlimited (mock provider)
      if (maxImages >= 0 && maxImages < refCount) {
        warnings.push({
          rule: 'V-6',
          shotName: item.name,
          message: `Shot "${item.name}": ${refCount} references supplied; ${effectiveProvider} supports at most ${maxImages} image. Extra references will be ignored by ai-powered.`
        });
      }
    }
  }

  return { errors, warnings };
}

function findModelCapability(
  providerConfig: VideoProvider | undefined,
  modelId: string
): VideoModelCapability | undefined {
  const configured = providerConfig?.modelCapabilities?.find(model => model.id === modelId);
  return configured ?? getSharedVideoModel(providerConfig?.id ?? 'pika', modelId);
}
