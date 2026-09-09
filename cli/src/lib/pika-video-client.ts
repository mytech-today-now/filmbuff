import {
  getSharedVideoModel,
  PIKA_API_BASE_URL,
  type VideoModelCapability
} from './provider-capabilities.js';
import { validatePikaOptions } from './pika-validation.js';

interface PikaHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface PikaCliClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<PikaHttpResponse>;
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export interface PikaCliVideoResult {
  requestId: string;
  contentUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractString(payload: unknown, keys: string[]): string | undefined {
  if (!isRecord(payload)) return undefined;
  for (const key of keys) {
    if (typeof payload[key] === 'string' && payload[key]) return payload[key];
  }
  return undefined;
}

function extractContentUrl(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const direct = extractString(payload, ['content_url', 'video_url', 'url']);
  if (direct && /^https:\/\/[^\s]+$/i.test(direct)) return direct;
  for (const key of ['result', 'video', 'content']) {
    const nested = extractContentUrl(payload[key]);
    if (nested) return nested;
  }
  return undefined;
}

function getCapability(modelId: string): VideoModelCapability {
  const capability = getSharedVideoModel('pika', modelId);
  if (!capability) throw new Error(`Pika model "${modelId}" is not supported.`);
  return capability;
}

async function parseResponse(response: PikaHttpResponse, operation: string): Promise<unknown> {
  if (!response.ok) throw new Error(`Pika ${operation} failed with HTTP ${response.status}.`);
  return response.json();
}

export async function generatePikaVideoForCli(
  prompt: string,
  modelId: string,
  providerOptions: Record<string, unknown> = {},
  options: PikaCliClientOptions = {}
): Promise<PikaCliVideoResult> {
  const apiKey = options.apiKey ?? process.env['PIKA_API_KEY'];
  if (!apiKey || apiKey.trim() === '') throw new Error('Pika API key is required. Set PIKA_API_KEY.');
  const capability = getCapability(modelId);
  const requestOptions: Record<string, unknown> = { ...providerOptions };
  if (modelId === 'pika/pika-2.5/text-to-video' && requestOptions.prompt === undefined) {
    requestOptions.prompt = prompt;
  }
  const validationErrors = validatePikaOptions(capability, requestOptions);
  if (validationErrors.length > 0) throw new Error(validationErrors.join(' '));

  const fetcher = options.fetch ?? (async (url, init) => fetch(url, init));
  const baseUrl = (options.baseUrl ?? PIKA_API_BASE_URL).replace(/\/$/, '');
  const response = await fetcher(`${baseUrl}${capability.endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify(requestOptions)
  });
  const submitted = await parseResponse(response, 'submission');
  const requestId = extractString(submitted, ['request_id', 'requestId', 'id']);
  if (!requestId) throw new Error('Pika submission response did not include a request ID.');

  const intervalMs = Math.max(0, options.pollIntervalMs ?? 5_000);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 600_000);
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs)));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const statusResponse = await fetcher(`${baseUrl}/v1/media/jobs/${encodeURIComponent(requestId)}`, {
      method: 'GET', headers: { 'X-API-Key': apiKey }
    });
    const statusPayload = await parseResponse(statusResponse, 'polling');
    const status = extractString(statusPayload, ['status'])?.toLowerCase();
    if (status && ['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      throw new Error('Pika job failed.');
    }
    if (status && ['completed', 'complete', 'succeeded', 'success'].includes(status)) {
      const contentUrl = extractContentUrl(statusPayload);
      if (!contentUrl) throw new Error('Pika completed response did not include a content URL.');
      return { requestId, contentUrl };
    }
    await sleep(intervalMs);
  }
  throw new Error('Pika polling timed out.');
}
