/**
 * duration-derivation.test.ts — bd-74fy / bd-bae9
 *
 * UT-DD: Unit tests for cli/src/lib/duration-derivation.ts
 * UT-PI: Unit tests for cli/src/lib/pipeline-inputs.ts parsers (Phase 3 / bd-bae9)
 *
 * Tests (UT-DD-1 through UT-DD-13):
 *
 * parseMMSS:
 *   [UT-DD-1]  "0:30" → 30
 *   [UT-DD-2]  "1:00" → 60
 *   [UT-DD-3]  "2:15" → 135
 *   [UT-DD-4]  "0:00" → 0
 *   [UT-DD-5]  malformed "" → null
 *   [UT-DD-6]  malformed "90" → null
 *   [UT-DD-7]  seconds > 59 ("1:60") → null
 *
 * estimateFromActionDensity:
 *   [UT-DD-8]  1 non-blank line → 5s
 *   [UT-DD-9]  3 lines → 5+(3-1)*2 = 9s
 *   [UT-DD-10] 14 lines → capped at 30s (formula gives 31)
 *   [UT-DD-11] blank-only lines → fallback 5s
 *
 * deriveDuration (4-priority chain):
 *   [UT-DD-12] shooting-script annotation wins over beat-sheet and density
 *   [UT-DD-13] falls back through chain: no script → beat-sheet → density → fallback
 *
 * parseShootingScript (UT-PI-SS):
 *   [UT-PI-SS-1]  "Duration | M:SS" table row (Format A — spec canonical)
 *   [UT-PI-SS-2]  "Duration | M:SS" inline annotation (Format B)
 *   [UT-PI-SS-3]  "SHOT <id>: M:SS" legacy header (Format C — backward compat)
 *   [UT-PI-SS-4]  Shot section heading ("## Shot 3") associates subsequent Duration row
 *   [UT-PI-SS-5]  Malformed M:SS rejected; valid shots still parsed
 *   [UT-PI-SS-6]  Empty text → empty map (graceful degradation)
 *
 * parseBeatSheet (UT-PI-BS):
 *   [UT-PI-BS-1]  "BEAT <id>: M:SS" inline format
 *   [UT-PI-BS-2]  "Scene <id>: M:SS" inline format
 *   [UT-PI-BS-3]  "## Beat <id>" heading + "Timing: M:SS" section
 *   [UT-PI-BS-4]  Markdown table row "| Timing | M:SS |"
 *   [UT-PI-BS-5]  Empty text → empty map
 */

import {
  parseMMSS,
  estimateFromActionDensity,
  clamp,
  deriveDuration,
  MIN_DURATION_S,
  MAX_DURATION_S,
  FALLBACK_DURATION_S,
} from '../lib/duration-derivation';

import {
  parseShootingScript,
  parseBeatSheet,
} from '../lib/pipeline-inputs';

// ---------------------------------------------------------------------------
// parseMMSS
// ---------------------------------------------------------------------------

describe('parseMMSS()', () => {
  it('[UT-DD-1] "0:30" → 30 seconds', () => {
    expect(parseMMSS('0:30')).toBe(30);
  });

  it('[UT-DD-2] "1:00" → 60 seconds', () => {
    expect(parseMMSS('1:00')).toBe(60);
  });

  it('[UT-DD-3] "2:15" → 135 seconds', () => {
    expect(parseMMSS('2:15')).toBe(135);
  });

  it('[UT-DD-4] "0:00" → 0 seconds', () => {
    expect(parseMMSS('0:00')).toBe(0);
  });

  it('[UT-DD-5] empty string → null', () => {
    expect(parseMMSS('')).toBeNull();
  });

  it('[UT-DD-6] "90" (no colon) → null', () => {
    expect(parseMMSS('90')).toBeNull();
  });

  it('[UT-DD-7] "1:60" (seconds out of range) → null', () => {
    expect(parseMMSS('1:60')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// estimateFromActionDensity
// ---------------------------------------------------------------------------

describe('estimateFromActionDensity()', () => {
  it('[UT-DD-8] 1 non-blank line → base 5s', () => {
    expect(estimateFromActionDensity(['JOHN stands at the window.'])).toBe(5);
  });

  it('[UT-DD-9] 3 non-blank lines → 5 + (3-1)*2 = 9s', () => {
    const lines = ['JOHN enters.', 'He looks around.', 'MARY watches.'];
    expect(estimateFromActionDensity(lines)).toBe(9);
  });

  it('[UT-DD-10] 14 non-blank lines → capped at 30s (formula gives 31)', () => {
    const lines = Array.from({ length: 14 }, (_, i) => `Action line ${i + 1}.`);
    // formula: 5 + (14-1)*2 = 31, capped at 30
    expect(estimateFromActionDensity(lines)).toBe(30);
  });

  it('[UT-DD-11] only blank lines → fallback 5s', () => {
    expect(estimateFromActionDensity(['', '   ', '\t'])).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------

describe('clamp()', () => {
  it('clamps below minimum to MIN_DURATION_S', () => {
    expect(clamp(0, MIN_DURATION_S, MAX_DURATION_S)).toBe(MIN_DURATION_S);
  });

  it('clamps above maximum to MAX_DURATION_S', () => {
    expect(clamp(999, MIN_DURATION_S, MAX_DURATION_S)).toBe(MAX_DURATION_S);
  });

  it('passes through a value within range unchanged', () => {
    expect(clamp(15, MIN_DURATION_S, MAX_DURATION_S)).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// deriveDuration — 4-priority chain
// ---------------------------------------------------------------------------

describe('deriveDuration()', () => {
  it('[UT-DD-12] P1: shooting-script annotation used when present (wins over beat-sheet and density)', () => {
    const result = deriveDuration({
      id: '1',
      shootingScriptDuration: '0:20',
      beatSheetCue: '0:45',
      actionLines: ['line 1', 'line 2', 'line 3']
    });
    expect(result.seconds).toBe(20);
    expect(result.source).toBe('shooting-script');
  });

  it('[UT-DD-13a] P2: beat-sheet cue used when shooting script absent', () => {
    const result = deriveDuration({
      id: '2',
      beatSheetCue: '0:45',
      actionLines: ['line 1']
    });
    expect(result.seconds).toBe(45);
    expect(result.source).toBe('beat-sheet');
  });

  it('[UT-DD-13b] P3: action density used when script and beat-sheet absent', () => {
    const result = deriveDuration({
      id: '3',
      actionLines: ['line 1', 'line 2', 'line 3']
    });
    expect(result.seconds).toBe(9); // 5+(3-1)*2
    expect(result.source).toBe('action-density');
  });

  it('[UT-DD-13c] P4: fallback when no signal available', () => {
    const result = deriveDuration({ id: '4' });
    expect(result.seconds).toBe(FALLBACK_DURATION_S);
    expect(result.source).toBe('fallback');
  });

  it('clamps shooting-script duration above MAX to 60s', () => {
    const result = deriveDuration({ id: '5', shootingScriptDuration: '2:00' }); // 120s
    expect(result.seconds).toBe(MAX_DURATION_S);
    expect(result.source).toBe('shooting-script');
  });

  it('clamps shooting-script duration below MIN to 3s', () => {
    const result = deriveDuration({ id: '6', shootingScriptDuration: '0:01' }); // 1s
    expect(result.seconds).toBe(MIN_DURATION_S);
    expect(result.source).toBe('shooting-script');
  });

  it('skips malformed shooting-script annotation and falls through to P2', () => {
    const result = deriveDuration({
      id: '7',
      shootingScriptDuration: 'not-a-time',
      beatSheetCue: '0:10'
    });
    expect(result.source).toBe('beat-sheet');
    expect(result.seconds).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Notes column values (AC-3, AC-4, UT-DD-13)
// ---------------------------------------------------------------------------

describe('deriveDuration() — notes column values per spec', () => {
  it('[AC-3] shooting-script source: notes reads "Derived from shot duration M:SS"', () => {
    const result = deriveDuration({ id: '1', shootingScriptDuration: '0:12' });
    expect(result.notes).toBe('Derived from shot duration 0:12');
  });

  it('[AC-3] shooting-script source: M:SS placeholder is substituted with actual annotation', () => {
    const result = deriveDuration({ id: '2', shootingScriptDuration: '1:05' });
    expect(result.notes).toBe('Derived from shot duration 1:05');
  });

  it('[AC-4] action-density source: notes reads exactly "Estimated from action density"', () => {
    const result = deriveDuration({ id: '3', actionLines: ['line 1', 'line 2'] });
    expect(result.notes).toBe('Estimated from action density');
  });

  it('[UT-DD-13] notes never contains the word "Default" for any derivation path', () => {
    const cases = [
      deriveDuration({ id: 'a', shootingScriptDuration: '0:30' }),
      deriveDuration({ id: 'b', beatSheetCue: '0:45' }),
      deriveDuration({ id: 'c', actionLines: ['action line'] }),
      deriveDuration({ id: 'd' }), // fallback
    ];
    for (const result of cases) {
      expect(result.notes).not.toContain('Default');
    }
  });

  it('[UT-DD-13] Duration seconds value is never equal to the string "Default"', () => {
    const cases = [
      deriveDuration({ id: 'a', shootingScriptDuration: '0:30' }),
      deriveDuration({ id: 'b', beatSheetCue: '0:45' }),
      deriveDuration({ id: 'c', actionLines: ['action line'] }),
      deriveDuration({ id: 'd' }),
    ];
    for (const result of cases) {
      expect(typeof result.seconds).toBe('number');
      expect(result.seconds).toBeGreaterThanOrEqual(3);
      expect(result.seconds).toBeLessThanOrEqual(60);
    }
  });

  it('fallback source also uses "Estimated from action density" notes (consistent with density path)', () => {
    const result = deriveDuration({ id: 'fallback' });
    expect(result.source).toBe('fallback');
    expect(result.notes).toBe('Estimated from action density');
  });
});


// ---------------------------------------------------------------------------
// parseShootingScript — UT-PI-SS (Phase 3 / bd-bae9)
// ---------------------------------------------------------------------------

describe('parseShootingScript()', () => {
  it('[UT-PI-SS-1] Format A: markdown table row "| Duration | 0:45 |"', () => {
    const text = [
      '## Shot 1',
      '| Control  | Value |',
      '|----------|-------|',
      '| Duration | 0:45  |'
    ].join('\n');
    const map = parseShootingScript(text);
    expect(map.get('1')).toBe('0:45');
  });

  it('[UT-PI-SS-2] Format B: "Duration | M:SS" inline annotation', () => {
    const text = [
      '## Shot 2',
      'Duration | 1:30'
    ].join('\n');
    const map = parseShootingScript(text);
    expect(map.get('2')).toBe('1:30');
  });

  it('[UT-PI-SS-3] Format C: "SHOT <id>: M:SS" legacy header', () => {
    const text = 'SHOT 5: 0:20\nSome scene description.';
    const map = parseShootingScript(text);
    expect(map.get('5')).toBe('0:20');
  });

  it('[UT-PI-SS-4] Section heading associates subsequent Duration row with that shot', () => {
    const text = [
      '## Shot 3',
      'INT. COFFEE SHOP - DAY',
      '| Duration | 0:12 |',
      '## Shot 4',
      '| Duration | 0:30 |'
    ].join('\n');
    const map = parseShootingScript(text);
    expect(map.get('3')).toBe('0:12');
    expect(map.get('4')).toBe('0:30');
  });

  it('[UT-PI-SS-5] Malformed M:SS rejected; valid shots still parsed', () => {
    const text = [
      '## Shot 6',
      'Duration | not-a-time',
      '## Shot 7',
      '| Duration | 0:25 |'
    ].join('\n');
    const map = parseShootingScript(text);
    expect(map.has('6')).toBe(false);
    expect(map.get('7')).toBe('0:25');
  });

  it('[UT-PI-SS-6] Empty text → empty map (graceful degradation)', () => {
    expect(parseShootingScript('').size).toBe(0);
    expect(parseShootingScript('   \n\n  ').size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseBeatSheet — UT-PI-BS (Phase 3 / bd-bae9)
// ---------------------------------------------------------------------------

describe('parseBeatSheet()', () => {
  it('[UT-PI-BS-1] "BEAT <id>: M:SS" inline format', () => {
    const map = parseBeatSheet('BEAT 1: 0:45\nBEAT 2: 1:10');
    expect(map.get('1')).toBe('0:45');
    expect(map.get('2')).toBe('1:10');
  });

  it('[UT-PI-BS-2] "Scene <id>: M:SS" inline format', () => {
    const map = parseBeatSheet('Scene 3: 0:30');
    expect(map.get('3')).toBe('0:30');
  });

  it('[UT-PI-BS-3] "## Beat <id>" heading + "Timing: M:SS" section', () => {
    const text = [
      '## Beat 4',
      'Some beat description.',
      'Timing: 0:55'
    ].join('\n');
    const map = parseBeatSheet(text);
    expect(map.get('4')).toBe('0:55');
  });

  it('[UT-PI-BS-4] Markdown table row "| Timing | M:SS |" in beat section', () => {
    const text = [
      '## Beat 5',
      '| Field  | Value |',
      '| Timing | 1:00  |'
    ].join('\n');
    const map = parseBeatSheet(text);
    expect(map.get('5')).toBe('1:00');
  });

  it('[UT-PI-BS-5] Empty text → empty map', () => {
    expect(parseBeatSheet('').size).toBe(0);
  });
});
