import { describe, expect, test, vi } from 'vitest';
import {
  buildPikaRequestPayload,
  generatePikaVideo,
  validatePikaVideoRequest,
  type PikaFetch,
  type PikaVideoRequest
} from '../pika.js';
import { buildSingleShotPikaRequest } from '../single-shot.js';

const textModel = 'pika/pika-2.5/text-to-video' as const;
const keyframeModel = 'pika/pikaframes/image-to-video' as const;

describe('public Pika adapter', () => {
  test('validates the official text-to-video shape', () => {
    const request: PikaVideoRequest = {
      model: textModel,
      options: { prompt: 'A practical miniature city', resolution: '1080p', duration_s: 5, seed: 7 }
    };
    expect(validatePikaVideoRequest(request)).toEqual({ valid: true, errors: [] });
    expect(buildPikaRequestPayload(request)).toEqual(request.options);
  });

  test.each([0, 1, 6])('rejects keyframe image count %i', count => {
    const result = validatePikaVideoRequest({
      model: keyframeModel,
      options: { images: Array.from({ length: count }, (_, index) => `https://assets.example/${index}.png`) }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.includes('reference images'))).toBe(true);
  });

  test('rejects unsupported options and never includes the key in validation output', () => {
    const result = validatePikaVideoRequest({
      model: textModel,
      options: { prompt: 'A shot', apiKey: 'do-not-return-this' }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).not.toContain('do-not-return-this');
  });

  test('submits and polls through injected HTTPS transport', async () => {
    const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> = [];
    const responses = [
      { ok: true, status: 202, json: async () => ({ request_id: 'job-123' }), text: async () => '' },
      { ok: true, status: 200, json: async () => ({ status: 'completed', content_url: 'https://cdn.example/job-123.mp4' }), text: async () => '' }
    ];
    const fetcher: PikaFetch = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return responses.shift()!;
    });
    const result = await generatePikaVideo({
      model: textModel,
      options: { prompt: 'A shot' }
    }, {
      apiKey: 'secret-value-used-only-in-header',
      fetch: fetcher,
      pollIntervalMs: 0,
      timeoutMs: 1000,
      sleep: async () => undefined
    });
    expect(result).toEqual({ requestId: 'job-123', contentUrl: 'https://cdn.example/job-123.mp4' });
    expect(calls[0].url).toBe('https://api.dev.pika.art/v1/media/pika/pika-2.5/text-to-video');
    expect(calls[0].init?.headers).toEqual({ 'Content-Type': 'application/json', 'X-API-Key': 'secret-value-used-only-in-header' });
    expect(calls[0].init?.body).not.toContain('secret-value-used-only-in-header');
    expect(calls[1].url).toBe('https://api.dev.pika.art/v1/media/jobs/job-123');
  });

  test('maps a generic single-shot prompt into the typed Pika request', () => {
    const request = buildSingleShotPikaRequest({
      shot: { shot_id: 's001', subject: 'A cyclist', duration_seconds: 5 },
      extraNotes: 'Keep the camera low'
    });
    expect(request.model).toBe(textModel);
    expect(request.options).toEqual(expect.objectContaining({ prompt: expect.stringContaining('A cyclist') }));
  });
});
