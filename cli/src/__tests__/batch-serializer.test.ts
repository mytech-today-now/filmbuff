/**
 * batch-serializer.test.ts — bd-74fy, bd-05fa (Phase 7)
 *
 * UT / IT tests for cli/src/lib/batch-serializer.ts
 *
 * Tests:
 *   serializeBatch():
 *     [BS-1]  Returns a BatchPayload with correct provider, model, items array
 *     [BS-2]  createdAt is a valid ISO-8601 string
 *     [BS-3]  Each item has modality "video"
 *     [BS-4]  Items reflect shot controls (duration, aspectRatio, fps, etc.)
 *     [BS-5]  Empty shots array → empty items array
 *     [BS-10] Top-level references map included when non-empty (DR-8 / AC-11)
 *     [BS-11] Top-level references map OMITTED when empty (DR-8 / AC-11)
 *     [BS-12] Per-shot references array of symbolic keys included (DR-8 / AC-12)
 *     [BS-13] Per-shot provider/model override included (DR-9 / AC-13)
 *     [BS-SEC] apiKey MUST NOT appear in serialized output (DR-6 / AC-7)
 *
 *   shotToBatchItem():
 *     [BS-6]  Maps id, heading→name, prompt, and all controls correctly
 *
 *   validateBatchPayload():
 *     [BS-7]  Valid payload → no errors
 *     [BS-8]  Missing provider → error list contains provider message
 *     [BS-9]  items not array → error list contains items message
 *
 *   serializeBatchToJsonl() — BD-05fa Phase 7 / DR-8 JSONL placement:
 *     [IT-REF-2a] References sentinel line is first when map is non-empty
 *     [IT-REF-2b] Each item is on its own line
 *     [IT-REF-2c] No sentinel line when references map is empty/absent
 *
 *   assertApiKeyAbsent() — security invariant:
 *     [BS-SEC-1] Returns true when payload has no apiKey
 *     [BS-SEC-2] Returns false when payload contains apiKey (any casing)
 *
 * Integration (IT-VC-3 per bd-74fy spec):
 *   [IT-VC-3] Full pipeline: deriveDuration → resolveVideoControls → serializeBatch
 *             → validateBatchPayload returns no errors (valid batch.json structure)
 *
 * Integration (IT-REF-1 per bd-2bc8 spec):
 *   [IT-REF-1] serializeBatch with references map → top-level map in payload
 */

import {
  serializeBatch,
  serializeBatchToJsonl,
  assertApiKeyAbsent,
  shotToBatchItem,
  validateBatchPayload,
  type ResolvedShot,
  type BatchPayload,
} from '../lib/batch-serializer';
import { deriveDuration } from '../lib/duration-derivation';
import { resolveVideoControls } from '../lib/video-controls';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeShot(overrides: Partial<ResolvedShot> = {}): ResolvedShot {
  const durResult = deriveDuration({ id: '1', shootingScriptDuration: '0:12' });
  const controls  = resolveVideoControls({}, durResult);
  return {
    id:      '1',
    heading: 'EXT. DINER - DAY',
    prompt:  'A lone figure steps out into the morning light.',
    controls,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// serializeBatch
// ---------------------------------------------------------------------------

describe('serializeBatch()', () => {
  it('[BS-1] returns BatchPayload with correct provider, model, and items', () => {
    const shots = [makeShot({ id: '1' }), makeShot({ id: '2', heading: 'INT. BAR - NIGHT' })];
    const payload = serializeBatch(shots, 'lumaai', 'ray-2');
    expect(payload.provider).toBe('lumaai');
    expect(payload.model).toBe('ray-2');
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items).toHaveLength(2);
  });

  it('[BS-2] createdAt is a valid ISO-8601 string', () => {
    const payload = serializeBatch([makeShot()], 'mock', 'mock-v1');
    const date = new Date(payload.createdAt);
    expect(isNaN(date.getTime())).toBe(false);
  });

  it('[BS-3] all items have modality "video"', () => {
    const shots = [makeShot({ id: '1' }), makeShot({ id: '2' })];
    const payload = serializeBatch(shots, 'lumaai', 'ray-2');
    for (const item of payload.items) {
      expect(item.modality).toBe('video');
    }
  });

  it('[BS-4] items carry explicitly-set controls; Default fields are omitted', () => {
    const durResult = deriveDuration({ id: '1', shootingScriptDuration: '0:20' });
    // Only fps is explicitly set — aspectRatio, resolution, quality remain undefined (Default)
    const controls  = resolveVideoControls({ explicitFps: 30 }, durResult);
    const shot: ResolvedShot = {
      id: '1', heading: 'EXT. BEACH - DUSK', prompt: 'Waves crash.', controls
    };
    const payload = serializeBatch([shot], 'lumaai', 'ray-2');
    const item = payload.items[0];
    expect(item.duration).toBe(20);
    expect(item.fps).toBe(30);
    // aspectRatio was NOT set → must be omitted per DR-6 ("Default" fields omitted)
    expect(item.aspectRatio).toBeUndefined();
  });

  it('[BS-5] empty shots array yields empty items', () => {
    const payload = serializeBatch([], 'mock', 'mock-v1');
    expect(payload.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// shotToBatchItem
// ---------------------------------------------------------------------------

describe('shotToBatchItem()', () => {
  it('[BS-6] maps required fields; omits optional Default fields per DR-6', () => {
    // makeShot uses resolveVideoControls({}, ...) — no overrides → all optional fields undefined
    const shot = makeShot({ id: 'shot-7', heading: 'INT. OFFICE - NIGHT', prompt: 'Silence.' });
    const item = shotToBatchItem(shot);
    expect(item.id).toBe('shot-7');
    expect(item.name).toBe('INT. OFFICE - NIGHT');
    expect(item.prompt).toBe('Silence.');
    expect(item.modality).toBe('video');
    expect(typeof item.duration).toBe('number');
    // Default (unset) fields must be omitted from the batch item
    expect(item.fps).toBeUndefined();
    expect(item.aspectRatio).toBeUndefined();
    expect(item.resolution).toBeUndefined();
    expect(item.quality).toBeUndefined();
  });

  it('[BS-6b] maps explicitly set override fields into the batch item', () => {
    const durResult = deriveDuration({ id: '1', shootingScriptDuration: '0:12' });
    const controls = resolveVideoControls({
      framingDescription: 'portrait vertical shot',
      explicitFps: 60
    }, durResult);
    const shot: ResolvedShot = {
      id: 'shot-p', heading: 'Portrait Shot', prompt: 'Close portrait.',
      controls
    };
    const item = shotToBatchItem(shot);
    expect(item.aspectRatio).toBe('9:16');  // set by portrait cue
    expect(item.fps).toBe(60);              // set by explicit fps
    expect(item.duration).toBe(12);
    // resolution and quality still undefined → omitted
    expect(item.resolution).toBeUndefined();
    expect(item.quality).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateBatchPayload
// ---------------------------------------------------------------------------

describe('validateBatchPayload()', () => {
  it('[BS-7] valid payload returns empty error array', () => {
    const payload = serializeBatch([makeShot()], 'lumaai', 'ray-2');
    const errors = validateBatchPayload(payload);
    expect(errors).toHaveLength(0);
  });

  it('[BS-8] missing provider yields validation error', () => {
    const payload = serializeBatch([makeShot()], 'lumaai', 'ray-2');
    const bad = { ...payload, provider: '' };
    const errors = validateBatchPayload(bad);
    expect(errors.some(e => e.includes('provider'))).toBe(true);
  });

  it('[BS-9] items not an array yields validation error', () => {
    const bad = { provider: 'lumaai', model: 'ray-2', createdAt: new Date().toISOString(), items: 'wrong' };
    const errors = validateBatchPayload(bad);
    expect(errors.some(e => e.includes('items'))).toBe(true);
  });

  it('null payload yields early error', () => {
    const errors = validateBatchPayload(null);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// IT-VC-3 — full pipeline integration test
// ---------------------------------------------------------------------------

describe('[IT-VC-3] Full pipeline: deriveDuration → resolveVideoControls → serializeBatch → validateBatchPayload', () => {
  it('produces a structurally valid batch payload (no validation errors)', () => {
    const shots: ResolvedShot[] = [
      { id: '1', heading: 'EXT. VILLAGE - DAWN', prompt: 'Mist clings to cobblestones.',
        controls: resolveVideoControls({ framingDescription: 'wide establishing shot' },
                    deriveDuration({ id: '1', shootingScriptDuration: '0:08' })) },
      { id: '2', heading: 'INT. TAVERN - NIGHT', prompt: 'Firelight dances on faces.',
        controls: resolveVideoControls({ framingDescription: 'close-up warm lighting' },
                    deriveDuration({ id: '2', actionLines: ['Innkeeper wipes the bar.', 'A hound sleeps by the hearth.'] })) },
      { id: '3', heading: 'EXT. HILLTOP - DAY', prompt: 'Wind whips through tall grass.',
        controls: resolveVideoControls({ framingDescription: 'action wide shot, vertical' },
                    deriveDuration({ id: '3', beatSheetCue: '0:30' })) }
    ];

    const payload: BatchPayload = serializeBatch(shots, 'lumaai', 'ray-2');
    const errors = validateBatchPayload(payload);

    expect(errors).toHaveLength(0);
    expect(payload.items).toHaveLength(3);
    // Shot 3 has "vertical" cue → aspectRatio set to "9:16"
    expect(payload.items[2].aspectRatio).toBe('9:16');
    // Shot 2 has "close-up" cue → quality set to "high"
    expect(payload.items[1].quality).toBe('high');
    // Shot 1 duration from shooting script: 8s
    expect(payload.items[0].duration).toBe(8);
    // Shot 1 has no framing cues → aspectRatio is omitted (Default)
    expect(payload.items[0].aspectRatio).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// [BS-10, BS-11] References map at envelope level — DR-8 / AC-11
// ---------------------------------------------------------------------------

describe('serializeBatch() — top-level references map (DR-8 / AC-11)', () => {
  it('[BS-10] includes top-level references when map is non-empty', () => {
    const refsMap = {
      'sarah':       'https://cdn.example.com/cast/sarah.jpg',
      'lake-sunrise':'https://cdn.example.com/scenes/lake.jpg'
    };
    const payload = serializeBatch([makeShot()], 'lumaai', 'ray-2', refsMap);
    expect(payload.references).toBeDefined();
    expect(payload.references?.['sarah']).toBe('https://cdn.example.com/cast/sarah.jpg');
    expect(payload.references?.['lake-sunrise']).toBe('https://cdn.example.com/scenes/lake.jpg');
  });

  it('[BS-11] OMITS top-level references when map is empty', () => {
    const payload = serializeBatch([makeShot()], 'lumaai', 'ray-2', {});
    expect(payload.references).toBeUndefined();
  });

  it('[BS-11b] OMITS top-level references when map is not provided', () => {
    const payload = serializeBatch([makeShot()], 'lumaai', 'ray-2');
    expect(payload.references).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// [BS-12] Per-shot references array — DR-8 / AC-12
// ---------------------------------------------------------------------------

describe('shotToBatchItem() — per-shot references (DR-8 / AC-12)', () => {
  it('[BS-12] per-shot references array contains symbolic keys (not URLs)', () => {
    const shot = makeShot({ references: ['sarah', 'sarah-end'] });
    const item = shotToBatchItem(shot);
    expect(item.references).toEqual(['sarah', 'sarah-end']);
    // Keys must be symbolic strings, not URLs
    for (const key of item.references!) {
      expect(key).not.toMatch(/^https?:\/\//);
    }
  });

  it('[BS-12b] per-shot references omitted when shot has no references', () => {
    const shot = makeShot();
    const item = shotToBatchItem(shot);
    expect(item.references).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// [BS-13] Per-shot provider/model overrides — DR-9 / AC-13
// ---------------------------------------------------------------------------

describe('shotToBatchItem() — per-shot provider/model overrides (DR-9 / AC-13)', () => {
  it('[BS-13] per-shot provider override included when set', () => {
    const shot = makeShot({ provider: 'lumaai', model: 'ray-2' });
    const item = shotToBatchItem(shot);
    expect(item.provider).toBe('lumaai');
    expect(item.model).toBe('ray-2');
  });

  it('[BS-13b] per-shot provider/model omitted when not set', () => {
    const shot = makeShot();
    const item = shotToBatchItem(shot);
    expect(item.provider).toBeUndefined();
    expect(item.model).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// [IT-REF-1] Integration: serializeBatch with references
// ---------------------------------------------------------------------------

describe('[IT-REF-1] serializeBatch with references map and per-shot keys', () => {
  it('produces correct AC-11 + AC-12 compliant payload', () => {
    const durResult = deriveDuration({ id: '1', shootingScriptDuration: '0:05' });
    const controls  = resolveVideoControls({}, durResult);
    const shots: ResolvedShot[] = [
      {
        id: 'shot-01', heading: 'EXT. LAKE - DAWN', prompt: 'Sarah approaches the lake.',
        controls, references: ['sarah', 'lake-sunrise'], provider: 'lumaai'
      },
      {
        id: 'shot-02', heading: 'INT. CABIN - NIGHT', prompt: 'Morgan reads by candlelight.',
        controls
        // no references, no provider override
      }
    ];
    const refsMap = {
      'sarah':        'https://cdn.example.com/cast/sarah-frame0.jpg',
      'lake-sunrise': 'https://cdn.example.com/scenes/lake-dawn.jpg'
    };

    const payload = serializeBatch(shots, 'lumaai', 'ray-2', refsMap);

    // AC-11: top-level references map present with correct keys
    expect(payload.references).toBeDefined();
    expect(Object.keys(payload.references!)).toEqual(expect.arrayContaining(['sarah', 'lake-sunrise']));

    // AC-12: shot-01 carries symbolic keys (not raw URLs)
    expect(payload.items[0].references).toEqual(['sarah', 'lake-sunrise']);
    expect(payload.items[0].provider).toBe('lumaai');

    // shot-02 has no references or provider override
    expect(payload.items[1].references).toBeUndefined();
    expect(payload.items[1].provider).toBeUndefined();

    // Security: no apiKey anywhere in the output
    expect(assertApiKeyAbsent(payload)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// [IT-REF-2] JSONL serialization — DR-8 JSONL placement
// ---------------------------------------------------------------------------

describe('[IT-REF-2] serializeBatchToJsonl() — JSONL format with _type:references sentinel', () => {
  it('[IT-REF-2a] first line is _type:references sentinel when map is non-empty', () => {
    const payload = serializeBatch([makeShot({ id: 'shot-1' })], 'mock', 'mock-v1', {
      sarah: 'https://cdn.example.com/cast/sarah.jpg'
    });
    const jsonl = serializeBatchToJsonl(payload);
    const lines = jsonl.split('\n').filter(l => l.trim().length > 0);
    const firstLine = JSON.parse(lines[0]);
    expect(firstLine._type).toBe('references');
    expect(firstLine.sarah).toBe('https://cdn.example.com/cast/sarah.jpg');
  });

  it('[IT-REF-2b] each shot item is on its own line after the sentinel', () => {
    const payload = serializeBatch(
      [makeShot({ id: '1' }), makeShot({ id: '2', heading: 'INT. BAR' })],
      'mock', 'mock-v1',
      { hero: 'https://cdn.example.com/hero.jpg' }
    );
    const jsonl = serializeBatchToJsonl(payload);
    const lines = jsonl.split('\n').filter(l => l.trim().length > 0);
    // Line 0: sentinel; Lines 1..N: items
    expect(lines).toHaveLength(3); // 1 sentinel + 2 items
    const itemLine = JSON.parse(lines[1]);
    expect(itemLine.modality).toBe('video');
  });

  it('[IT-REF-2c] no sentinel line when references map is absent', () => {
    const payload = serializeBatch([makeShot()], 'mock', 'mock-v1');
    const jsonl = serializeBatchToJsonl(payload);
    const lines = jsonl.split('\n').filter(l => l.trim().length > 0);
    // Only item lines; no sentinel
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed._type).toBeUndefined();
    expect(parsed.modality).toBe('video');
  });
});

// ---------------------------------------------------------------------------
// [BS-SEC] Security invariant — apiKey must NEVER appear in output (AC-7)
// ---------------------------------------------------------------------------

describe('assertApiKeyAbsent() — security invariant (DR-6 / AC-7)', () => {
  it('[BS-SEC-1] returns true when no apiKey in payload', () => {
    const payload = serializeBatch([makeShot()], 'lumaai', 'ray-2');
    expect(assertApiKeyAbsent(payload)).toBe(true);
    expect(assertApiKeyAbsent(JSON.stringify(payload))).toBe(true);
  });

  it('[BS-SEC-2] returns false when payload contains "apiKey"', () => {
    const dangerous = { provider: 'lumaai', apiKey: 'sk-secret-key', items: [] };
    expect(assertApiKeyAbsent(dangerous)).toBe(false);
  });

  it('[BS-SEC-2b] returns false when payload contains "api_key" (snake_case)', () => {
    expect(assertApiKeyAbsent({ api_key: 'secret' })).toBe(false);
  });

  it('[BS-SEC-2c] returns false when payload contains "api-key" (kebab-case)', () => {
    expect(assertApiKeyAbsent({ 'api-key': 'secret' })).toBe(false);
  });

  it('[BS-SEC] serializeBatch never includes apiKey in output', () => {
    const shots = [makeShot({ id: '1' })];
    const payload = serializeBatch(shots, 'lumaai', 'ray-2');
    // The serialized JSON must not contain any API key field
    const json = JSON.stringify(payload);
    expect(/api[_\-]?key/i.test(json)).toBe(false);
  });
});
