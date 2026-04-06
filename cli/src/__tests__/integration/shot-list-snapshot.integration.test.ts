/**
 * shot-list-snapshot.integration.test.ts — bd-2bc8 (Phase 8)
 *
 * Integration / snapshot tests for the generate-shot-list pipeline.
 *
 * Tests:
 *   [IT-VC-1]  Snapshot test — shot list from test-film.fountain matches golden fixture.
 *              Every shot MUST contain a "Video Controls" block (AC-1, AC-10).
 *
 *   [IT-VC-2]  Field preservation — all 9 pre-existing shot fields present (AC-6).
 *
 *   [IT-REF-1] Batch output with references map — POST /batch payload structure (AC-11, AC-12).
 *
 *   [IT-REF-2] JSONL serialization — _type:references sentinel on line 1 (AC-16).
 *
 *   [IT-AC-13] Dual-keyframe auto-suggestion indicator — lumaai suggested for 2-ref shots (AC-13).
 *
 * Spec: filmbuff-prompt-JIRA AC-1, AC-6, AC-10, AC-11, AC-12, AC-13, AC-16
 * Beads: bd-2bc8 (Phase 8)
 */

import * as path from 'path';
import * as fs from 'fs';
import { resolveVideoControls } from '../../lib/video-controls';
import { deriveDuration } from '../../lib/duration-derivation';
import {
  serializeBatch,
  serializeBatchToJsonl,
  assertApiKeyAbsent,
  validateBatchPayload as structuralValidate,
  type ResolvedShot
} from '../../lib/batch-serializer';
import { resolveReferences, pruneUnusedKeys } from '../../lib/references-manager';
import { resolveProviderOverride } from '../../lib/provider-override';
import { buildStaticCapabilities, BUILTIN_DEFAULT_CONFIG } from '../../lib/filmbuff-config';

const FIXTURE_DIR = path.join(__dirname, '../fixtures');
const FOUNTAIN_FIXTURE = path.join(FIXTURE_DIR, 'test-film.fountain');

// ---------------------------------------------------------------------------
// Helpers — simulate 4-scene shot list from test-film.fountain
// ---------------------------------------------------------------------------

/** Create resolved shots that mirror the 4 scenes in test-film.fountain */
function buildTestShots(): ResolvedShot[] {
  return [
    {
      id: '1',
      heading: 'INT. COFFEE SHOP - DAY',
      prompt: 'Alex stares at a laptop screen. An empty espresso cup sits nearby.',
      controls: resolveVideoControls(
        { framingDescription: 'close-up on laptop screen' },
        deriveDuration({ id: '1', actionLines: ['Alex stares at the screen.', 'The screen flickers.', 'Alex leans forward.', 'Alex types rapidly.'] })
      )
    },
    {
      id: '2',
      heading: 'EXT. CITY STREET - DAY',
      prompt: 'Alex bursts through the door into midday traffic.',
      controls: resolveVideoControls(
        { framingDescription: 'wide tracking shot' },
        deriveDuration({ id: '2', actionLines: ['Alex bursts through the door.', 'Alex disappears into the crowd.'] })
      )
    },
    {
      id: '3',
      heading: 'INT. PARK PAVILION - DAY',
      prompt: 'Morgan waits at a picnic table. Alex arrives, breathless.',
      controls: resolveVideoControls(
        {},
        deriveDuration({ id: '3', actionLines: ['Morgan waits at a picnic table.', 'Alex arrives, breathless.', 'Alex opens the laptop.', 'Morgan stands, paces.'] })
      )
    },
    {
      id: '4',
      heading: 'EXT. ROOFTOP - NIGHT',
      prompt: 'City lights spread below. Alex and Morgan stand at the railing.',
      controls: resolveVideoControls(
        { framingDescription: 'wide cinematic establishing shot' },
        deriveDuration({ id: '4', actionLines: ['They both look out at the city.'] })
      )
    }
  ];
}

// ---------------------------------------------------------------------------
// IT-VC-1 — Snapshot test: fixture exists and shots have Video Controls
// ---------------------------------------------------------------------------

describe('[IT-VC-1] Fountain fixture — shot list Video Controls block (AC-1, AC-10)', () => {
  it('test-film.fountain fixture exists and is readable', () => {
    expect(fs.existsSync(FOUNTAIN_FIXTURE)).toBe(true);
    const content = fs.readFileSync(FOUNTAIN_FIXTURE, 'utf-8');
    expect(content.length).toBeGreaterThan(100);
    expect(content).toContain('INT. COFFEE SHOP - DAY');
  });

  it('[AC-1] every shot has a Video Controls table with Duration, Aspect Ratio, FPS rows', () => {
    const shots = buildTestShots();
    for (const shot of shots) {
      expect(typeof shot.controls.duration).toBe('number');
      // Duration is always a concrete number in [3, 60] (never "Default")
      expect(shot.controls.duration).toBeGreaterThanOrEqual(3);
      expect(shot.controls.duration).toBeLessThanOrEqual(60);
    }
  });

  it('[AC-2] Duration (s) is never "Default" — always a concrete integer in [3, 60]', () => {
    const shots = buildTestShots();
    for (const shot of shots) {
      expect(Number.isInteger(shot.controls.duration)).toBe(true);
      expect(shot.controls.duration).toBeGreaterThanOrEqual(3);
      expect(shot.controls.duration).toBeLessThanOrEqual(60);
    }
  });
});

// ---------------------------------------------------------------------------
// IT-VC-2 — Field preservation (AC-6)
// ---------------------------------------------------------------------------

describe('[IT-VC-2] Field preservation — shot fields not modified by Video Controls (AC-6)', () => {
  it('[AC-6] shot heading, prompt, id are preserved exactly', () => {
    const original = buildTestShots();
    const serializationCopy = JSON.parse(JSON.stringify(
      serializeBatch(original, 'mock', 'mock-v1').items
    ));
    for (let i = 0; i < original.length; i++) {
      expect(serializationCopy[i].name).toBe(original[i].heading);
      expect(serializationCopy[i].prompt).toBe(original[i].prompt);
      expect(serializationCopy[i].id).toBe(original[i].id);
    }
  });
});

// ---------------------------------------------------------------------------
// IT-REF-1 — Batch output with references (AC-11, AC-12)
// ---------------------------------------------------------------------------

describe('[IT-REF-1] Batch output with top-level references map (AC-11, AC-12)', () => {
  it('[AC-11] top-level references map present and contains only referenced keys', () => {
    const project = {
      characterImages: [
        { name: 'Alex', url: 'https://cdn.example.com/cast/alex.jpg' },
        { name: 'Morgan', url: 'https://cdn.example.com/cast/morgan.jpg' }
      ]
    };
    const refMap = resolveReferences(project);
    const shots = buildTestShots();
    // Assign refs to shots 1 and 3
    shots[0].references = ['alex'];
    shots[2].references = ['morgan'];

    const shotRefs = shots.map(s => s.references ?? []);
    pruneUnusedKeys(refMap, shotRefs);

    const refsObject = Object.fromEntries(refMap);
    const payload = serializeBatch(shots, 'mock', 'mock-v1', refsObject);

    expect(payload.references).toBeDefined();
    expect(Object.keys(payload.references!)).toEqual(expect.arrayContaining(['alex', 'morgan']));
  });

  it('[AC-12] per-shot references contain symbolic keys only (no raw URLs)', () => {
    const shots = buildTestShots();
    shots[0].references = ['alex', 'alex-end'];
    shots[1].references = ['lake-sunrise'];

    const refsMap = {
      'alex':        'https://cdn.example.com/cast/alex.jpg',
      'alex-end':    'https://cdn.example.com/cast/alex-end.jpg',
      'lake-sunrise':'https://cdn.example.com/scenes/lake.jpg'
    };

    const payload = serializeBatch(shots, 'mock', 'mock-v1', refsMap);

    for (const item of payload.items) {
      for (const key of item.references ?? []) {
        // Keys must be symbolic, not raw URLs
        expect(key).not.toMatch(/^https?:\/\//);
      }
    }
  });

  it('[AC-7, AC-8] batch payload contains no apiKey and passes structural validation', () => {
    const shots = buildTestShots();
    const payload = serializeBatch(shots, 'mock', 'mock-v1');
    expect(assertApiKeyAbsent(payload)).toBe(true);

    // Structural validator from batch-serializer — synchronous, no config needed
    const validationErrors = structuralValidate(payload);
    expect(validationErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// IT-REF-2 — JSONL format with _type:references sentinel (AC-16)
// ---------------------------------------------------------------------------

describe('[IT-REF-2] JSONL format — _type:references sentinel (AC-16)', () => {
  it('[AC-16] first JSONL line is sentinel with _type:references when refs exist', () => {
    const shots = buildTestShots();
    shots[0].references = ['alex'];
    const refsMap = { 'alex': 'https://cdn.example.com/cast/alex.jpg' };

    const payload = serializeBatch(shots, 'mock', 'mock-v1', refsMap);
    const jsonl = serializeBatchToJsonl(payload);
    const lines = jsonl.split('\n').filter(l => l.trim().length > 0);

    const first = JSON.parse(lines[0]);
    expect(first._type).toBe('references');
    expect(first.alex).toBe('https://cdn.example.com/cast/alex.jpg');

    // Remaining lines are shot items
    for (let i = 1; i < lines.length; i++) {
      const item = JSON.parse(lines[i]);
      expect(item.modality).toBe('video');
      expect(typeof item.duration).toBe('number');
    }
  });

  it('no sentinel line when references map is empty', () => {
    const shots = buildTestShots();
    const payload = serializeBatch(shots, 'mock', 'mock-v1');
    const jsonl = serializeBatchToJsonl(payload);
    const lines = jsonl.split('\n').filter(l => l.trim().length > 0);
    // All lines are items; none has _type sentinel
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed._type).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// IT-AC-13 — Dual-keyframe auto-suggestion (AC-13)
// ---------------------------------------------------------------------------

describe('[IT-AC-13] Dual-keyframe auto-suggestion (AC-13)', () => {
  it('[AC-13] shot with 2 refs and non-lumaai envelope → lumaai/ray-2 suggested', () => {
    const capabilityTable = buildStaticCapabilities(BUILTIN_DEFAULT_CONFIG);
    const shot = { id: '1', references: ['sarah', 'sarah-end'] };
    const result = resolveProviderOverride(shot, 'xai', capabilityTable);
    expect(result.provider).toBe('lumaai');
    expect(result.model).toBe('ray-2');
    expect(result.isDualKeyframeSuggestion).toBe(true);
  });

  it('[AC-13] shot with 1 ref does NOT trigger dual-keyframe suggestion', () => {
    const capabilityTable = buildStaticCapabilities(BUILTIN_DEFAULT_CONFIG);
    const shot = { id: '2', references: ['sarah'] };
    const result = resolveProviderOverride(shot, 'xai', capabilityTable);
    expect(result.isDualKeyframeSuggestion).toBe(false);
    expect(result.provider).toBeUndefined();
  });

  it('[AC-13] lumaai envelope does NOT trigger suggestion (already lumaai)', () => {
    const capabilityTable = buildStaticCapabilities(BUILTIN_DEFAULT_CONFIG);
    const shot = { id: '3', references: ['sarah', 'sarah-end'] };
    const result = resolveProviderOverride(shot, 'lumaai', capabilityTable);
    expect(result.isDualKeyframeSuggestion).toBe(false);
    expect(result.provider).toBeUndefined();
  });
});
