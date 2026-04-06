/**
 * pre-export-validator.test.ts — bd-2bc8 (Phase 8)
 *
 * UT-VAL: Unit tests for cli/src/lib/pre-export-validator.ts
 *
 * Covers validation rules V-1 through V-6 (DR-10 / AC-14, AC-15):
 *   [UT-VAL-1]  V-1: unknown reference key in shot → blocking error
 *   [UT-VAL-2]  V-1: all reference keys exist → no V-1 errors
 *   [UT-VAL-3]  V-2: invalid URL format → blocking error
 *   [UT-VAL-4]  V-2: valid HTTPS URL → no V-2 error
 *   [UT-VAL-5]  V-2: data URI accepted → no V-2 error
 *   [UT-VAL-6]  V-3: skipped in offline mode (AC-15)
 *   [UT-VAL-7]  V-3: skipped when CI=true env var set (AC-15)
 *   [UT-VAL-8]  V-4: unknown provider override → blocking error
 *   [UT-VAL-9]  V-4: valid provider override → no V-4 error
 *   [UT-VAL-10] V-5: model not in provider's models list → blocking error
 *   [UT-VAL-11] V-5: valid model override → no V-5 error
 *   [UT-VAL-12] V-6: warn (non-blocking) when shot has >1 ref and provider supports 1 image
 *
 * Helpers:
 *   isValidReferenceUrl — tested for HTTPS / data URI / relative paths
 *   isDataUri           — data URI detection
 */

import {
  validateBatchPayload,
  isValidReferenceUrl,
  isDataUri,
  type ValidatablePayload,
} from '../lib/pre-export-validator';
import type { FilmbuffConfig } from '../lib/filmbuff-config';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockConfig: FilmbuffConfig = {
  defaultProvider: 'lumaai',
  defaultModel: 'ray-2',
  videoProviders: [
    { id: 'lumaai', supportedModels: ['ray-2', 'ray-2-turbo'], videoSupport: true, maxI2VImages: 2 },
    { id: 'xai',    supportedModels: ['grok-2-vision'],        videoSupport: true, maxI2VImages: 1 },
    { id: 'mock',   supportedModels: ['mock-v1'],              videoSupport: true, maxI2VImages: -1 },
  ]
};

function makePayload(overrides: Partial<ValidatablePayload> = {}): ValidatablePayload {
  return {
    provider: 'lumaai',
    model: 'ray-2',
    references: {},
    items: [],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// isValidReferenceUrl / isDataUri helpers
// ---------------------------------------------------------------------------

describe('isValidReferenceUrl()', () => {
  it('accepts https:// URL', () => {
    expect(isValidReferenceUrl('https://cdn.example.com/img.jpg')).toBe(true);
  });
  it('accepts data:image/ URI', () => {
    expect(isValidReferenceUrl('data:image/png;base64,abc123')).toBe(true);
  });
  it('rejects relative paths', () => {
    expect(isValidReferenceUrl('./local-file.jpg')).toBe(false);
  });
  it('rejects http:// (non-https)', () => {
    expect(isValidReferenceUrl('http://insecure.com/img.jpg')).toBe(false);
  });
  it('rejects empty string', () => {
    expect(isValidReferenceUrl('')).toBe(false);
  });
});

describe('isDataUri()', () => {
  it('returns true for data:image/ URI', () => {
    expect(isDataUri('data:image/jpeg;base64,abc')).toBe(true);
  });
  it('returns false for https URL', () => {
    expect(isDataUri('https://cdn.example.com/img.jpg')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// V-1: Unknown reference key
// ---------------------------------------------------------------------------

describe('[V-1] reference key not in document map', () => {
  it('[UT-VAL-1] produces blocking error when shot references unknown key', async () => {
    const payload = makePayload({
      references: { 'sarah': 'https://cdn.example.com/sarah.jpg' },
      items: [{ name: 'shot-01', references: ['sarah', 'unknown-key'] }]
    });
    const { errors } = await validateBatchPayload(payload, mockConfig, { offline: true });
    expect(errors.some(e => e.rule === 'V-1' && e.message.includes('unknown-key'))).toBe(true);
  });

  it('[UT-VAL-2] no V-1 errors when all reference keys exist', async () => {
    const payload = makePayload({
      references: { 'sarah': 'https://cdn.example.com/sarah.jpg' },
      items: [{ name: 'shot-01', references: ['sarah'] }]
    });
    const { errors } = await validateBatchPayload(payload, mockConfig, { offline: true });
    expect(errors.filter(e => e.rule === 'V-1')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// V-2: Invalid URL format
// ---------------------------------------------------------------------------

describe('[V-2] invalid URL format in references map', () => {
  it('[UT-VAL-3] produces blocking error for non-https relative URL', async () => {
    const payload = makePayload({
      references: { 'sarah': './local-file.jpg' },
      items: []
    });
    const { errors } = await validateBatchPayload(payload, mockConfig, { offline: true });
    expect(errors.some(e => e.rule === 'V-2' && e.message.includes('sarah'))).toBe(true);
  });

  it('[UT-VAL-4] no V-2 error for valid https URL', async () => {
    const payload = makePayload({
      references: { 'sarah': 'https://cdn.example.com/sarah.jpg' },
      items: []
    });
    const { errors } = await validateBatchPayload(payload, mockConfig, { offline: true });
    expect(errors.filter(e => e.rule === 'V-2')).toHaveLength(0);
  });

  it('[UT-VAL-5] data URI accepted as valid URL (no V-2 error)', async () => {
    const payload = makePayload({
      references: { 'avatar': 'data:image/png;base64,abc123' },
      items: []
    });
    const { errors } = await validateBatchPayload(payload, mockConfig, { offline: true });
    expect(errors.filter(e => e.rule === 'V-2')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// V-3: URL reachability — skipped in offline / CI mode (AC-15)
// ---------------------------------------------------------------------------

describe('[V-3] URL reachability — offline / CI mode (AC-15)', () => {
  it('[UT-VAL-6] V-3 skipped when offline=true; other rules still apply', async () => {
    const payload = makePayload({
      references: { 'sarah': 'https://unreachable.invalid/sarah.jpg' },
      items: [{ name: 'shot-01', references: ['sarah'] }]
    });
    const { errors } = await validateBatchPayload(payload, mockConfig, { offline: true });
    // No V-3 errors in offline mode (URL unreachability skipped)
    expect(errors.filter(e => e.rule === 'V-3')).toHaveLength(0);
    // V-1 not triggered because key exists in map
    expect(errors.filter(e => e.rule === 'V-1')).toHaveLength(0);
  });

  it('[UT-VAL-7] V-3 skipped when CI=true env var is set', async () => {
    const original = process.env['CI'];
    process.env['CI'] = 'true';
    try {
      const payload = makePayload({
        references: { 'sarah': 'https://unreachable.invalid/sarah.jpg' },
        items: []
      });
      const { errors } = await validateBatchPayload(payload, mockConfig);
      expect(errors.filter(e => e.rule === 'V-3')).toHaveLength(0);
    } finally {
      if (original === undefined) delete process.env['CI'];
      else process.env['CI'] = original;
    }
  });
});

// ---------------------------------------------------------------------------
// V-4: Unknown provider override
// ---------------------------------------------------------------------------

describe('[V-4] unknown provider override', () => {
  it('[UT-VAL-8] produces blocking error for unknown provider id', async () => {
    const payload = makePayload({
      items: [{ name: 'shot-01', provider: 'unknownprovider' }]
    });
    const { errors } = await validateBatchPayload(payload, mockConfig, { offline: true });
    expect(errors.some(e => e.rule === 'V-4' && e.message.includes('unknownprovider'))).toBe(true);
  });

  it('[UT-VAL-9] no V-4 error for valid provider id', async () => {
    const payload = makePayload({
      items: [{ name: 'shot-01', provider: 'xai' }]
    });
    const { errors } = await validateBatchPayload(payload, mockConfig, { offline: true });
    expect(errors.filter(e => e.rule === 'V-4')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// V-5: Model not in provider's models list
// ---------------------------------------------------------------------------

describe('[V-5] invalid model override', () => {
  it('[UT-VAL-10] produces blocking error when model not in provider models list', async () => {
    const payload = makePayload({
      items: [{ name: 'shot-01', provider: 'lumaai', model: 'gpt-4o' }]
    });
    const { errors } = await validateBatchPayload(payload, mockConfig, { offline: true });
    expect(errors.some(e => e.rule === 'V-5' && e.message.includes('gpt-4o'))).toBe(true);
  });

  it('[UT-VAL-11] no V-5 error when model belongs to provider', async () => {
    const payload = makePayload({
      items: [{ name: 'shot-01', provider: 'lumaai', model: 'ray-2-turbo' }]
    });
    const { errors } = await validateBatchPayload(payload, mockConfig, { offline: true });
    expect(errors.filter(e => e.rule === 'V-5')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// V-6: Non-blocking warning — too many references for single-frame provider
// ---------------------------------------------------------------------------

describe('[V-6] non-blocking warning for multi-ref + single-frame provider', () => {
  it('[UT-VAL-12] emits V-6 warning when shot has 2 refs and provider supports only 1 image', async () => {
    const payload = makePayload({
      references: {
        'sarah': 'https://cdn.example.com/sarah.jpg',
        'morgan': 'https://cdn.example.com/morgan.jpg'
      },
      items: [{
        name: 'shot-01',
        provider: 'xai',                          // maxI2VImages = 1
        references: ['sarah', 'morgan']           // 2 refs > 1 supported
      }]
    });
    const { errors, warnings } = await validateBatchPayload(payload, mockConfig, { offline: true });
    // V-6 is non-blocking — no blocking errors for this rule
    expect(errors.filter(e => (e as unknown as { rule: string }).rule === 'V-6')).toHaveLength(0);
    expect(warnings.some(w => w.rule === 'V-6' && w.message.includes('shot-01'))).toBe(true);
  });

  it('no V-6 warning when provider supports unlimited images (mock)', async () => {
    const payload = makePayload({
      provider: 'mock',
      references: {
        'sarah': 'https://cdn.example.com/sarah.jpg',
        'morgan': 'https://cdn.example.com/morgan.jpg'
      },
      items: [{ name: 'shot-01', references: ['sarah', 'morgan'] }]
    });
    const { warnings } = await validateBatchPayload(payload, mockConfig, { offline: true });
    expect(warnings.filter(w => w.rule === 'V-6')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: clean payload passes all V-1 through V-6 (AC-14, AC-15)
// ---------------------------------------------------------------------------

describe('[IT-VAL] clean payload passes all validation rules', () => {
  it('empty payload with no references and no items has no errors or warnings', async () => {
    const payload = makePayload({ items: [], references: {} });
    const { errors, warnings } = await validateBatchPayload(payload, mockConfig, { offline: true });
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('valid payload with references and lumaai dual-keyframe shot passes all rules', async () => {
    const payload = makePayload({
      provider: 'lumaai',
      model: 'ray-2',
      references: {
        'sarah':     'https://cdn.example.com/cast/sarah-frame0.jpg',
        'sarah-end': 'https://cdn.example.com/cast/sarah-frame1.jpg'
      },
      items: [{
        name: 'shot-01',
        provider: 'lumaai',
        model: 'ray-2',
        references: ['sarah', 'sarah-end']
      }]
    });
    const { errors, warnings } = await validateBatchPayload(payload, mockConfig, { offline: true });
    expect(errors).toHaveLength(0);
    // lumaai supports 2 I2V images so no V-6 warning
    expect(warnings.filter(w => w.rule === 'V-6')).toHaveLength(0);
  });
});
