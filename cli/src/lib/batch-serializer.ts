/**
 * batch-serializer.ts
 *
 * Serialize a list of resolved shots into the POST /batch JSON payload
 * expected by the ai-powered gateway and the Luma AI batch endpoint.
 *
 * Spec: openspec/archive/filmbuff-prompt/
 * Beads: bd-vinw (Phase 6), bd-05fa (Phase 7 — batch payload serialization with
 *        references map, per-shot overrides, JSONL sentinel, security invariants)
 *
 * Security invariant: apiKey MUST NEVER appear in any batch output (AC-7).
 */

import type { VideoControls } from './video-controls';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedShot {
  id: string;
  /** Shot heading / title (e.g. "EXT. DINER - DAY"). */
  heading: string;
  /** Visual description / action paragraph for the AI generator. */
  prompt: string;
  controls: VideoControls;
  /**
   * Per-shot symbolic reference keys (from the document-level references map).
   * DR-8: keys resolve to image URLs server-side; raw URLs must never appear here.
   */
  references?: string[];
  /**
   * Per-shot provider override (DR-9).
   * Omitted when the shot uses the envelope-level default provider.
   */
  provider?: string;
  /**
   * Per-shot model override (DR-9).
   * Omitted when the shot uses the envelope-level default model.
   */
  model?: string;
}

export interface BatchItem {
  /** Shot identifier. */
  id: string;
  /** Modality identifier: always "video" for filmbuff-prompt. */
  modality: 'video';
  /** Shot heading used as a human-readable name. */
  name: string;
  /** Prompt text sent to the AI generator. */
  prompt: string;
  /** Shot duration in seconds (always present; never "Default"). */
  duration: number;
  /**
   * Aspect ratio string. Omitted when VideoControls.aspectRatio is undefined (= "Default").
   * Per DR-6: "Fields whose Video Controls value is 'Default' MUST be omitted entirely."
   */
  aspectRatio?: string;
  /** Resolution string. Omitted when undefined (= "Default"). */
  resolution?: string;
  /** Quality level. Omitted when undefined (= "Default"). */
  quality?: string;
  /** Frames per second. Omitted when undefined (= "Default"). */
  fps?: number;
  /**
   * Per-shot symbolic reference keys (from the document-level references map).
   * Phase 5 / DR-8: keys resolve to image URLs in the ai-powered proxy.
   */
  references?: string[];
  /**
   * Per-shot provider override (Phase 5 / DR-9).
   * Omitted when shot uses the envelope-level default provider.
   */
  provider?: string;
  /**
   * Per-shot model override (Phase 5 / DR-9).
   * Omitted when shot uses the envelope-level default model.
   */
  model?: string;
}

export interface BatchPayload {
  /** Video provider identifier (e.g. "lumaai", "mock"). */
  provider: string;
  /** Video model identifier (e.g. "ray-2"). */
  model: string;
  /** ISO-8601 timestamp of payload creation. */
  createdAt: string;
  /**
   * Document-level references map (Phase 5 / DR-8).
   * Key → absolute HTTPS URL or data URI. Omitted when no shots reference images.
   */
  references?: Record<string, string>;
  /** Serialized shot items. */
  items: BatchItem[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize a list of resolved shots into the batch POST payload.
 *
 * @param shots         — resolved shots with VideoControls
 * @param provider      — envelope video provider id (from resolveProvider)
 * @param model         — envelope video model id (from resolveProvider)
 * @param referencesMap — optional document-level references map (key → URL).
 *                        When provided and non-empty, emitted as top-level
 *                        `references` object per DR-6/DR-8.
 *
 * Security invariant: apiKey MUST NEVER appear in the output (AC-7).
 */
export function serializeBatch(
  shots: ResolvedShot[],
  provider: string,
  model: string,
  referencesMap?: Record<string, string>
): BatchPayload {
  const payload: BatchPayload = {
    provider,
    model,
    createdAt: new Date().toISOString(),
    items: shots.map(s => shotToBatchItem(s))
  };

  // DR-8: include top-level references map only when non-empty
  if (referencesMap && Object.keys(referencesMap).length > 0) {
    payload.references = referencesMap;
  }

  return payload;
}

/**
 * Serialize a single resolved shot to a BatchItem.
 *
 * Per DR-6: only include optional fields when they are set (non-Default).
 * Undefined fields are omitted entirely — do NOT emit null or "Default".
 *
 * Per DR-8/DR-9: include per-shot references (symbolic keys) and
 * provider/model overrides only when explicitly set.
 *
 * Exported for fine-grained unit testing.
 */
export function shotToBatchItem(shot: ResolvedShot): BatchItem {
  const item: BatchItem = {
    id:       shot.id,
    modality: 'video',
    name:     shot.heading,
    prompt:   shot.prompt,
    duration: shot.controls.duration
  };

  // Include optional video control fields only when they are explicitly set
  if (shot.controls.aspectRatio !== undefined) item.aspectRatio = shot.controls.aspectRatio;
  if (shot.controls.resolution  !== undefined) item.resolution  = shot.controls.resolution;
  if (shot.controls.quality     !== undefined) item.quality     = shot.controls.quality;
  if (shot.controls.fps         !== undefined) item.fps         = shot.controls.fps;

  // DR-8: include per-shot references array of symbolic keys (not raw URLs)
  if (shot.references && shot.references.length > 0) {
    item.references = shot.references;
  }

  // DR-9: include per-shot provider/model overrides only when non-default
  if (shot.provider !== undefined) item.provider = shot.provider;
  if (shot.model    !== undefined) item.model    = shot.model;

  return item;
}

/**
 * Serialize a batch payload to JSONL format per DR-8 JSONL Placement spec.
 *
 * Format:
 *   Line 1 (when references exist): {"_type":"references","<key>":"<url>",...}
 *   Remaining lines: one JSON object per shot item.
 *
 * @param payload — already serialized BatchPayload (from serializeBatch)
 * @returns JSONL string (newline-delimited JSON)
 */
export function serializeBatchToJsonl(payload: BatchPayload): string {
  const lines: string[] = [];

  // First line: references sentinel (DR-8 — only when references exist)
  if (payload.references && Object.keys(payload.references).length > 0) {
    const refLine = { _type: 'references', ...payload.references };
    lines.push(JSON.stringify(refLine));
  }

  // One line per shot item
  for (const item of payload.items) {
    lines.push(JSON.stringify(item));
  }

  return lines.join('\n');
}

/**
 * Assert that the serialized batch payload does NOT contain an API key.
 *
 * Security invariant from DR-6 / AC-7:
 *   "apiKey MUST never appear anywhere in the JSON payload."
 *
 * Checks both the object structure and the raw JSON string for any apiKey-related
 * fields (case-insensitive).
 *
 * @returns true when the payload is safe to emit; false when a violation is detected.
 */
export function assertApiKeyAbsent(payload: unknown): boolean {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
  // Reject any occurrence of "apikey", "api_key", "apiKey", "api-key" (case-insensitive)
  return !/api[_\-]?key/i.test(json);
}

/**
 * Validate a raw BatchPayload-shaped object.
 * Returns an array of validation error strings (empty = valid).
 */
export function validateBatchPayload(payload: unknown): string[] {
  const errors: string[] = [];
  if (!payload || typeof payload !== 'object') {
    errors.push('Payload must be a non-null object');
    return errors;
  }
  const p = payload as Record<string, unknown>;

  if (typeof p.provider !== 'string' || p.provider.trim() === '') {
    errors.push('provider must be a non-empty string');
  }
  if (typeof p.model !== 'string' || p.model.trim() === '') {
    errors.push('model must be a non-empty string');
  }
  if (typeof p.createdAt !== 'string') {
    errors.push('createdAt must be an ISO-8601 string');
  }
  if (!Array.isArray(p.items)) {
    errors.push('items must be an array');
    return errors;
  }
  (p.items as unknown[]).forEach((item, idx) => {
    if (!item || typeof item !== 'object') {
      errors.push(`items[${idx}] must be an object`);
      return;
    }
    const it = item as Record<string, unknown>;
    if (typeof it.id !== 'string')       errors.push(`items[${idx}].id must be a string`);
    if (it.modality !== 'video')         errors.push(`items[${idx}].modality must be "video"`);
    if (typeof it.prompt !== 'string')   errors.push(`items[${idx}].prompt must be a string`);
    if (typeof it.duration !== 'number') errors.push(`items[${idx}].duration must be a number`);
  });
  return errors;
}
