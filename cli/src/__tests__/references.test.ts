/**
 * references.test.ts — bd-2bc8 (Phase 8)
 *
 * UT-REF: Unit tests for cli/src/lib/references-manager.ts
 *
 * Tests (UT-REF-1 through UT-REF-6):
 *   [UT-REF-1]  normalizeReferenceKey: spaces → hyphens, lowercase, strip special chars
 *   [UT-REF-2]  resolveReferences: character images take precedence over scene images
 *   [UT-REF-3]  resolveReferences: duplicate character key keeps most-recently assigned URL
 *   [UT-REF-4]  pruneUnusedKeys: removes keys not referenced by any shot
 *   [UT-REF-5]  renderReferencesSection: correct ## References Markdown output
 *   [UT-REF-6]  renderShotReferencesLine: correct **References:** line output
 */

import {
  normalizeReferenceKey,
  resolveReferences,
  pruneUnusedKeys,
  renderReferencesSection,
  renderShotReferencesLine,
  type FilmbuffProject,
  type ReferencesMap,
} from '../lib/references-manager';

// ---------------------------------------------------------------------------
// UT-REF-1 — normalizeReferenceKey
// ---------------------------------------------------------------------------

describe('normalizeReferenceKey()', () => {
  it('[UT-REF-1a] lowercase and replace spaces with hyphens', () => {
    expect(normalizeReferenceKey('Sarah Connor')).toBe('sarah-connor');
  });

  it('[UT-REF-1b] strips special characters (not alphanumeric or hyphen)', () => {
    expect(normalizeReferenceKey('Lake Sunrise!')).toBe('lake-sunrise');
  });

  it('[UT-REF-1c] underscores converted to hyphens', () => {
    expect(normalizeReferenceKey('canyon_ext')).toBe('canyon-ext');
  });

  it('[UT-REF-1d] removes leading hyphens', () => {
    expect(normalizeReferenceKey('  Sarah')).toBe('sarah');
  });

  it('[UT-REF-1e] already normalised key passes through unchanged', () => {
    expect(normalizeReferenceKey('sarah-end')).toBe('sarah-end');
  });

  it('[UT-REF-1f] multi-word scene slug', () => {
    expect(normalizeReferenceKey('Lake Sunrise Drone')).toBe('lake-sunrise-drone');
  });
});

// ---------------------------------------------------------------------------
// UT-REF-2 — resolveReferences: character images have higher precedence
// ---------------------------------------------------------------------------

describe('resolveReferences()', () => {
  it('[UT-REF-2] character image assignment overrides scene image for the same key', () => {
    const project: FilmbuffProject = {
      sceneImages:     [{ name: 'sarah',        url: 'https://cdn.example.com/scene-sarah.jpg' }],
      characterImages: [{ name: 'Sarah Connor', url: 'https://cdn.example.com/char-sarah.jpg' }]
    };
    const map = resolveReferences(project);
    // Character image (higher precedence) wins
    expect(map.get('sarah-connor')).toBe('https://cdn.example.com/char-sarah.jpg');
    expect(map.get('sarah')).toBe('https://cdn.example.com/scene-sarah.jpg');
  });

  it('empty project yields empty map', () => {
    const map = resolveReferences({});
    expect(map.size).toBe(0);
  });

  it('only scene images when no character images', () => {
    const project: FilmbuffProject = {
      sceneImages: [
        { name: 'canyon-ext',  url: 'https://cdn.example.com/canyon.jpg' },
        { name: 'Lake Sunrise', url: 'https://cdn.example.com/lake.jpg' }
      ]
    };
    const map = resolveReferences(project);
    expect(map.get('canyon-ext')).toBe('https://cdn.example.com/canyon.jpg');
    expect(map.get('lake-sunrise')).toBe('https://cdn.example.com/lake.jpg');
  });

  it('[UT-REF-3] duplicate character key keeps most-recently assigned URL', () => {
    const project: FilmbuffProject = {
      characterImages: [
        { name: 'Sarah', url: 'https://cdn.example.com/sarah-v1.jpg' },
        { name: 'Sarah', url: 'https://cdn.example.com/sarah-v2.jpg' } // overrides
      ]
    };
    const map = resolveReferences(project);
    expect(map.get('sarah')).toBe('https://cdn.example.com/sarah-v2.jpg');
    expect(map.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// UT-REF-4 — pruneUnusedKeys
// ---------------------------------------------------------------------------

describe('pruneUnusedKeys()', () => {
  it('[UT-REF-4] removes keys not referenced by any shot', () => {
    const map: ReferencesMap = new Map([
      ['sarah',        'https://cdn.example.com/sarah.jpg'],
      ['lake-sunrise', 'https://cdn.example.com/lake.jpg'],
      ['unused-char',  'https://cdn.example.com/unused.jpg']
    ]);
    const shotRefs = [['sarah', 'lake-sunrise'], ['sarah']];
    pruneUnusedKeys(map, shotRefs);
    expect(map.has('unused-char')).toBe(false);
    expect(map.has('sarah')).toBe(true);
    expect(map.has('lake-sunrise')).toBe(true);
    expect(map.size).toBe(2);
  });

  it('all keys pruned when no shot references any key', () => {
    const map: ReferencesMap = new Map([['sarah', 'https://cdn.example.com/sarah.jpg']]);
    pruneUnusedKeys(map, []);
    expect(map.size).toBe(0);
  });

  it('empty map remains empty after pruning', () => {
    const map: ReferencesMap = new Map();
    pruneUnusedKeys(map, [['sarah']]);
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// UT-REF-5 — renderReferencesSection
// ---------------------------------------------------------------------------

describe('renderReferencesSection()', () => {
  it('[UT-REF-5] renders ## References section with all map entries', () => {
    const map: ReferencesMap = new Map([
      ['sarah', 'https://cdn.example.com/cast/sarah-frame0.jpg'],
      ['lake-sunrise', 'https://cdn.example.com/scenes/lake-dawn.jpg']
    ]);
    const section = renderReferencesSection(map);
    expect(section).toContain('## References');
    expect(section).toContain('- sarah: https://cdn.example.com/cast/sarah-frame0.jpg');
    expect(section).toContain('- lake-sunrise: https://cdn.example.com/scenes/lake-dawn.jpg');
  });

  it('returns empty string when map is empty', () => {
    expect(renderReferencesSection(new Map())).toBe('');
  });
});

// ---------------------------------------------------------------------------
// UT-REF-6 — renderShotReferencesLine
// ---------------------------------------------------------------------------

describe('renderShotReferencesLine()', () => {
  it('[UT-REF-6] renders **References:** line with comma-separated keys', () => {
    const line = renderShotReferencesLine(['sarah', 'sarah-end']);
    expect(line).toBe('**References:** sarah, sarah-end');
  });

  it('returns empty string when shot has no reference keys', () => {
    expect(renderShotReferencesLine([])).toBe('');
  });

  it('single reference key: no trailing comma', () => {
    expect(renderShotReferencesLine(['lake-sunrise'])).toBe('**References:** lake-sunrise');
  });
});
