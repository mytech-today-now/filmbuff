import {
  getSharedVideoModel,
  PIKA_API_BASE_URL,
  PIKA_PROVIDER_ID,
  PIKA_IMAGE_EFFECTS,
  PIKA_VIDEO_EFFECTS,
  type NumericConstraint,
  type VideoModelCapability
} from './provider-capabilities.js';

export type PikaModelId =
  | 'pika/pika-2.5/text-to-video'
  | 'pika/pika-2.5/image-to-video'
  | 'pika/pikaframes/image-to-video'
  | 'pika/pikadditions/video-to-video'
  | 'pika/pikaswaps/video-to-video'
  | 'pika/pikaffects/image-to-video'
  | 'pika/pikaffects/video-to-video';

export type PikaResolution = '720p' | '1080p';

export interface PikaTextToVideoOptions {
  prompt: string;
  resolution?: PikaResolution;
  duration_s?: 5;
  negative_prompt?: string;
  seed?: number;
}

export interface PikaImageToVideoOptions {
  image: string;
  prompt?: string;
  resolution?: PikaResolution;
  duration_s?: 5 | 10;
  negative_prompt?: string;
  seed?: number;
}

export interface PikaKeyframeOptions {
  images: string[];
  prompt?: string;
  resolution?: PikaResolution;
  transition_duration_s?: number;
  negative_prompt?: string;
  seed?: number;
}

export interface PikaAdditionsOptions {
  video: string;
  prompt: string;
  resolution?: PikaResolution;
  duration_s?: 5 | 10;
  negative_prompt?: string;
  seed?: number;
  image?: string;
}

export interface PikaSwapsOptions {
  video: string;
  prompt: string;
  resolution?: PikaResolution;
  duration_s?: 5 | 10;
  negative_prompt?: string;
  seed?: number;
  modify_region_roi?: string;
  modify_region_mask?: string;
  image?: string;
}

export type PikaImageEffect = typeof PIKA_IMAGE_EFFECTS[number];
export type PikaVideoEffect = typeof PIKA_VIDEO_EFFECTS[number];

export interface PikaImageEffectsOptions {
  pikaffect: PikaImageEffect;
  image: string;
  seed?: number;
}

export interface PikaVideoEffectsOptions {
  pikaffect: PikaVideoEffect;
  video: string;
  seed?: number;
}

export type PikaVideoOptions =
  | PikaTextToVideoOptions
  | PikaImageToVideoOptions
  | PikaKeyframeOptions
  | PikaAdditionsOptions
  | PikaSwapsOptions
  | PikaImageEffectsOptions
  | PikaVideoEffectsOptions;

export type PikaVideoRequest =
  | { model: 'pika/pika-2.5/text-to-video'; options: PikaTextToVideoOptions }
  | { model: 'pika/pika-2.5/image-to-video'; options: PikaImageToVideoOptions }
  | { model: 'pika/pikaframes/image-to-video'; options: PikaKeyframeOptions }
  | { model: 'pika/pikadditions/video-to-video'; options: PikaAdditionsOptions }
  | { model: 'pika/pikaswaps/video-to-video'; options: PikaSwapsOptions }
  | { model: 'pika/pikaffects/image-to-video'; options: PikaImageEffectsOptions }
  | { model: 'pika/pikaffects/video-to-video'; options: PikaVideoEffectsOptions };

export interface PikaValidationResult {
  valid: boolean;
  errors: string[];
}

export class PikaValidationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(errors.join(' '));
    this.name = 'PikaValidationError';
    this.errors = [...errors];
  }
}

export class PikaApiError extends Error {
  readonly status?: number;
  readonly operation: string;

  constructor(operation: string, status?: number) {
    super(status ? `Pika ${operation} failed with HTTP ${status}.` : `Pika ${operation} failed.`);
    this.name = 'PikaApiError';
    this.status = status;
    this.operation = operation;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/[^\s]+$/i.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isEqualToAllowedValue(value: unknown, allowed: readonly (string | number)[]): boolean {
  return allowed.some(candidate => candidate === value);
}

function validateConstraint(
  modelId: string,
  field: string,
  value: unknown,
  constraint: NumericConstraint
): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `Pika model "${modelId}" option "${field}" must be a finite number.`;
  }
  if (constraint.integer && !Number.isInteger(value)) {
    return `Pika model "${modelId}" option "${field}" must be an integer.`;
  }
  if (constraint.min !== undefined && value < constraint.min) {
    return `Pika model "${modelId}" option "${field}" must be at least ${constraint.min}.`;
  }
  if (constraint.max !== undefined && value > constraint.max) {
    return `Pika model "${modelId}" option "${field}" must be at most ${constraint.max}.`;
  }
  if (constraint.values && !constraint.values.includes(value)) {
    return `Pika model "${modelId}" option "${field}" must be one of ${constraint.values.join(', ')}.`;
  }
  return undefined;
}

function validateMediaOption(modelId: string, field: string, value: unknown): string | undefined {
  if (field === 'images') {
    if (!Array.isArray(value) || value.some(image => !isHttpsUrl(image))) {
      return `Pika model "${modelId}" option "images" must be an array of absolute HTTPS URLs.`;
    }
    return undefined;
  }
  if (field === 'image' || field === 'video' || field === 'modify_region_mask') {
    if (!isHttpsUrl(value)) {
      return `Pika model "${modelId}" option "${field}" must be an absolute HTTPS URL.`;
    }
  }
  return undefined;
}

function validatePikaOptions(
  modelCapability: VideoModelCapability,
  options: unknown
): string[] {
  const errors: string[] = [];
  const modelId = modelCapability.id;

  if (!isRecord(options)) {
    return [`Pika model "${modelId}" options must be an object.`];
  }

  const allowed = new Set(modelCapability.supportedOptions);
  for (const key of Object.keys(options).sort()) {
    if (!allowed.has(key)) {
      errors.push(`Pika model "${modelId}" does not support option "${key}".`);
    }
  }

  for (const field of modelCapability.requiredOptions) {
    if (!(field in options)) {
      errors.push(`Pika model "${modelId}" requires option "${field}".`);
    }
  }

  for (const field of modelCapability.supportedOptions) {
    if (!(field in options)) continue;
    const value = options[field];
    const mediaError = validateMediaOption(modelId, field, value);
    if (mediaError) errors.push(mediaError);

    if (field === 'prompt' || field === 'negative_prompt' || field === 'modify_region_roi') {
      if (!isNonEmptyString(value)) {
        errors.push(`Pika model "${modelId}" option "${field}" must be a non-empty string.`);
      }
    }

    const enumValues = modelCapability.enumOptions?.[field];
    if (enumValues && !isEqualToAllowedValue(value, enumValues)) {
      errors.push(`Pika model "${modelId}" option "${field}" must be one of ${enumValues.join(', ')}.`);
    }

    const constraint = modelCapability.numericConstraints?.[field];
    if (constraint) {
      const constraintError = validateConstraint(modelId, field, value, constraint);
      if (constraintError) errors.push(constraintError);
    }

    if (field === 'images' && Array.isArray(value)) {
      const imageCount = value.length;
      if (modelCapability.minReferenceImages !== undefined && imageCount < modelCapability.minReferenceImages) {
        errors.push(`Pika model "${modelId}" requires at least ${modelCapability.minReferenceImages} reference images; received ${imageCount}.`);
      }
      if (modelCapability.maxReferenceImages !== undefined && imageCount > modelCapability.maxReferenceImages) {
        errors.push(`Pika model "${modelId}" accepts at most ${modelCapability.maxReferenceImages} reference images; received ${imageCount}.`);
      }
    }
  }

  if (modelId === 'pika/pikaswaps/video-to-video') {
    const hasRoi = 'modify_region_roi' in options;
    const hasMask = 'modify_region_mask' in options;
    if (!hasRoi && !hasMask) {
      errors.push(`Pika model "${modelId}" requires either "modify_region_roi" or "modify_region_mask".`);
    }
    if (hasRoi && hasMask) {
      errors.push(`Pika model "${modelId}" accepts only one of "modify_region_roi" or "modify_region_mask".`);
    }
  }

  return errors;
}

export function validatePikaReferenceCount(modelId: string, count: number): string[] {
  const capability = getSharedVideoModel(PIKA_PROVIDER_ID, modelId);
  if (!capability) return [`Pika model "${modelId}" is not supported.`];
  if (!Number.isInteger(count) || count < 0) {
    return [`Pika model "${modelId}" reference count must be a non-negative integer.`];
  }
  const errors: string[] = [];
  if (capability.minReferenceImages !== undefined && count < capability.minReferenceImages) {
    errors.push(`Pika model "${modelId}" requires at least ${capability.minReferenceImages} reference images; received ${count}.`);
  }
  if (capability.maxReferenceImages !== undefined && count > capability.maxReferenceImages) {
    errors.push(`Pika model "${modelId}" accepts at most ${capability.maxReferenceImages} reference images; received ${count}.`);
  }
  return errors;
}

export function validatePikaVideoRequest(request: unknown): PikaValidationResult {
  if (!isRecord(request) || typeof request.model !== 'string') {
    return { valid: false, errors: ['Pika request must include a model string and an options object.'] };
  }
  const capability = getSharedVideoModel(PIKA_PROVIDER_ID, request.model);
  if (!capability) {
    return { valid: false, errors: [`Pika model "${request.model}" is not supported.`] };
  }
  const errors = validatePikaOptions(capability, request.options);
  return { valid: errors.length === 0, errors };
}

export function buildPikaRequestPayload(request: PikaVideoRequest): Record<string, unknown> {
  const validation = validatePikaVideoRequest(request);
  if (!validation.valid) throw new PikaValidationError(validation.errors);
  return { ...(request.options as unknown as Record<string, unknown>) };
}

export interface PikaResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type PikaFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<PikaResponse>;

export interface PikaClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: PikaFetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export interface PikaJobSubmission {
  requestId: string;
}

export interface PikaCompletedVideo {
  requestId: string;
  contentUrl: string;
}

const defaultFetch: PikaFetch = async (url, init) => {
  const response = await fetch(url, init);
  return response;
};

function responseId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  for (const key of ['request_id', 'requestId', 'id']) {
    if (typeof payload[key] === 'string' && payload[key]) return payload[key];
  }
  return undefined;
}

function contentUrl(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const candidates = [payload.content_url, payload.video_url, payload.url];
  for (const candidate of candidates) {
    if (isHttpsUrl(candidate)) return candidate;
  }
  for (const key of ['result', 'video', 'content']) {
    if (isRecord(payload[key])) {
      const nested = contentUrl(payload[key]);
      if (nested) return nested;
    }
  }
  return undefined;
}

async function parseJsonResponse(response: PikaResponse, operation: string): Promise<unknown> {
  if (!response.ok) throw new PikaApiError(operation, response.status);
  try {
    return await response.json();
  } catch {
    throw new PikaApiError(`${operation} response parsing`);
  }
}

function assertApiKey(apiKey: string): void {
  if (!isNonEmptyString(apiKey)) throw new Error('Pika API key is required. Set PIKA_API_KEY.');
}

export async function submitPikaVideo(
  request: PikaVideoRequest,
  options: PikaClientOptions
): Promise<PikaJobSubmission> {
  assertApiKey(options.apiKey);
  const payload = buildPikaRequestPayload(request);
  const capability = getSharedVideoModel(PIKA_PROVIDER_ID, request.model);
  if (!capability) throw new PikaValidationError([`Pika model "${request.model}" is not supported.`]);
  const fetcher = options.fetch ?? defaultFetch;
  const baseUrl = (options.baseUrl ?? PIKA_API_BASE_URL).replace(/\/$/, '');
  const response = await fetcher(`${baseUrl}${capability.endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': options.apiKey
    },
    body: JSON.stringify(payload)
  });
  const parsed = await parseJsonResponse(response, 'submission');
  const requestId = responseId(parsed);
  if (!requestId) throw new PikaApiError('submission response');
  return { requestId };
}

export async function pollPikaVideo(
  requestId: string,
  options: PikaClientOptions
): Promise<PikaCompletedVideo> {
  assertApiKey(options.apiKey);
  if (!isNonEmptyString(requestId)) throw new Error('Pika request ID is required.');
  const fetcher = options.fetch ?? defaultFetch;
  const baseUrl = (options.baseUrl ?? PIKA_API_BASE_URL).replace(/\/$/, '');
  const intervalMs = Math.max(0, options.pollIntervalMs ?? 5_000);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 600_000);
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs)));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const response = await fetcher(`${baseUrl}/v1/media/jobs/${encodeURIComponent(requestId)}`, {
      method: 'GET',
      headers: { 'X-API-Key': options.apiKey }
    });
    const parsed = await parseJsonResponse(response, 'polling');
    const status = isRecord(parsed) && typeof parsed.status === 'string' ? parsed.status.toLowerCase() : '';
    if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      throw new PikaApiError('job processing');
    }
    if (['completed', 'complete', 'succeeded', 'success'].includes(status)) {
      const url = contentUrl(parsed);
      if (!url) throw new PikaApiError('completed content response');
      return { requestId, contentUrl: url };
    }
    await sleep(intervalMs);
  }

  throw new PikaApiError('polling timeout');
}

export async function generatePikaVideo(
  request: PikaVideoRequest,
  options: PikaClientOptions
): Promise<PikaCompletedVideo> {
  const submission = await submitPikaVideo(request, options);
  return pollPikaVideo(submission.requestId, options);
}
