/**
 * video-controls.test.ts — bd-f5b3 (Phase 5)
 *
 * UT-VC: Unit tests for cli/src/lib/video-controls.ts
 *
 * Per spec (Phase 5 / bd-f5b3):
 *   - VideoControls.duration is always present and concrete
 *   - aspectRatio, resolution, quality, fps are OPTIONAL — undefined = "Default"
 *   - Only explicitly triggered overrides set non-duration fields
 *   - renderVideoControlsTable emits a 3-column table (Control | Value | Notes)
 *
 * Tests (UT-VC-1 through UT-VC-8):
 *   [UT-VC-1]  Default controls when no hints given — optional fields are undefined
 *   [UT-VC-2]  Explicit aspectRatio override propagates
 *   [UT-VC-3]  Explicit resolution override propagates
 *   [UT-VC-4]  Explicit quality override propagates
 *   [UT-VC-5]  Explicit fps override propagates
 *   [UT-VC-6]  "portrait" framing cue overrides aspectRatio to "9:16"
 *   [UT-VC-7]  "close-up" cue sets quality to "high"
 *   [UT-VC-8]  "hero" cue sets quality to "high"; "animatic" cue sets quality to "draft"
 *
 * Integration:
 *   IT-VC-1  resolveVideoControls + deriveDuration round-trip
 *   IT-VC-2  renderVideoControlsTable produces 3-column Markdown table with "Default"
 */

import {
  resolveVideoControls,
  applyOverrideRules,
  renderVideoControlsTable,
  type ShotFramingHints,
  type VideoControls,
} from '../lib/video-controls';
import { deriveDuration } from '../lib/duration-derivation';

const EMPTY_HINTS: ShotFramingHints = {};

// ---------------------------------------------------------------------------
// UT-VC-1 — default controls (all optional fields are undefined = "Default")
// ---------------------------------------------------------------------------

describe('resolveVideoControls() — defaults (optional fields)', () => {
  it('[UT-VC-1] no hints: duration is set; all other fields are undefined ("Default")', () => {
    const dur = { seconds: 10, source: 'fallback' as const, notes: 'Estimated from action density' };
    const controls = resolveVideoControls(EMPTY_HINTS, dur);
    expect(controls.duration).toBe(10);
    // Per spec: non-duration fields are undefined when no override was triggered
    expect(controls.aspectRatio).toBeUndefined();
    expect(controls.resolution).toBeUndefined();
    expect(controls.quality).toBeUndefined();
    expect(controls.fps).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// UT-VC-2 … UT-VC-5 — explicit overrides propagate
// ---------------------------------------------------------------------------

describe('resolveVideoControls() — explicit overrides', () => {
  const dur = { seconds: 5, source: 'fallback' as const, notes: 'Estimated from action density' };

  it('[UT-VC-2] explicit aspectRatio propagates to controls', () => {
    const controls = resolveVideoControls({ explicitAspectRatio: '1:1' }, dur);
    expect(controls.aspectRatio).toBe('1:1');
  });

  it('[UT-VC-3] explicit resolution propagates to controls', () => {
    const controls = resolveVideoControls({ explicitResolution: '4k' }, dur);
    expect(controls.resolution).toBe('4k');
  });

  it('[UT-VC-4] explicit quality propagates to controls', () => {
    const controls = resolveVideoControls({ explicitQuality: 'draft' }, dur);
    expect(controls.quality).toBe('draft');
  });

  it('[UT-VC-5] explicit fps propagates to controls', () => {
    const controls = resolveVideoControls({ explicitFps: 30 }, dur);
    expect(controls.fps).toBe(30);
  });

  it('null explicit overrides are treated as not set (remain undefined)', () => {
    const controls = resolveVideoControls(
      { explicitAspectRatio: null, explicitQuality: null },
      dur
    );
    expect(controls.aspectRatio).toBeUndefined();
    expect(controls.quality).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// UT-VC-6 … UT-VC-8 — applyOverrideRules keyword cues
// ---------------------------------------------------------------------------

describe('applyOverrideRules() — framing description keyword cues', () => {
  // Base has only duration set; all others undefined (Default)
  const BASE: VideoControls = { duration: 10 };

  it('[UT-VC-6] "portrait" framing description sets aspectRatio to "9:16"', () => {
    const result = applyOverrideRules(BASE, 'Medium portrait shot');
    expect(result.aspectRatio).toBe('9:16');
  });

  it('[UT-VC-6b] "vertical" framing description sets aspectRatio to "9:16"', () => {
    const result = applyOverrideRules(BASE, 'Vertical social-media shot');
    expect(result.aspectRatio).toBe('9:16');
  });

  it('[UT-VC-6c] "widescreen cinematic" cue sets aspectRatio to "21:9"', () => {
    const result = applyOverrideRules(BASE, 'Widescreen cinematic landscape');
    expect(result.aspectRatio).toBe('21:9');
  });

  it('[UT-VC-6d] "square" cue sets aspectRatio to "1:1"', () => {
    const result = applyOverrideRules(BASE, 'Square social format');
    expect(result.aspectRatio).toBe('1:1');
  });

  it('[UT-VC-7] "close-up" description sets quality to "high"', () => {
    const result = applyOverrideRules(BASE, 'Extreme close-up of eyes');
    expect(result.quality).toBe('high');
  });

  it('[UT-VC-8] "hero" shot description sets quality to "high" (DR-4)', () => {
    const result = applyOverrideRules(BASE, 'Hero shot of the protagonist');
    expect(result.quality).toBe('high');
  });

  it('[UT-VC-8b] "animatic" description sets quality to "draft" (DR-4)', () => {
    const result = applyOverrideRules(BASE, 'Animatic rough pass');
    expect(result.quality).toBe('draft');
  });

  it('does NOT override explicitly set aspectRatio via keyword cue', () => {
    const withExplicit: VideoControls = { duration: 10, aspectRatio: '4:3' };
    const result = applyOverrideRules(withExplicit, 'portrait shot');
    // Explicit value is preserved — rule only fires when field is undefined
    expect(result.aspectRatio).toBe('4:3');
  });

  it('does NOT apply portrait rule for a neutral description', () => {
    const result = applyOverrideRules(BASE, 'Wide establishing shot');
    expect(result.aspectRatio).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// IT-VC-1 — integration: deriveDuration feeds resolveVideoControls
// ---------------------------------------------------------------------------

describe('[IT-VC-1] deriveDuration + resolveVideoControls round-trip', () => {
  it('duration from deriveDuration is present in resolved controls', () => {
    const durResult = deriveDuration({ id: '1', shootingScriptDuration: '0:15' });
    const controls = resolveVideoControls({}, durResult);
    expect(controls.duration).toBe(15);
  });

  it('no framing hints → only duration is set (all others undefined)', () => {
    const durResult = deriveDuration({ id: '1', actionLines: ['line 1', 'line 2'] });
    const controls = resolveVideoControls({}, durResult);
    expect(typeof controls.duration).toBe('number');
    expect(controls.aspectRatio).toBeUndefined();
    expect(controls.fps).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// IT-VC-2 — renderVideoControlsTable produces 3-column Markdown table
// ---------------------------------------------------------------------------

describe('[IT-VC-2] renderVideoControlsTable()', () => {
  it('renders "Default" for unset optional fields; duration value is concrete', () => {
    const controls: VideoControls = { duration: 20 };
    const table = renderVideoControlsTable(controls, 'Estimated from action density');
    expect(table).toContain('**Video Controls:**');
    expect(table).toContain('| Control');
    expect(table).toContain('| Value');
    expect(table).toContain('| Notes');
    expect(table).toContain('Default');   // unset optional fields show "Default"
    expect(table).toContain('20');        // duration value is concrete
    expect(table).toContain('Duration (s)');
    expect(table).toContain('Estimated from action density');
    // Verify "Default" string for aspect ratio row
    expect(table).toContain('Aspect Ratio');
    expect(table).toContain('FPS');
  });

  it('renders concrete values for explicitly set fields', () => {
    const controls: VideoControls = {
      duration: 12,
      aspectRatio: '9:16',
      quality: 'high'
    };
    const table = renderVideoControlsTable(controls, 'Derived from shot duration 0:12');
    expect(table).toContain('9:16');
    expect(table).toContain('high');
    expect(table).toContain('12');
    expect(table).toContain('Derived from shot duration 0:12');
    // resolution and fps remain "Default"
    const defaultCount = (table.match(/Default/g) || []).length;
    expect(defaultCount).toBeGreaterThanOrEqual(2); // resolution + fps
  });
});
