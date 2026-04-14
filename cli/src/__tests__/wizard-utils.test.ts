/**
 * wizard-utils.test.ts — Unit tests for wizard-utils.ts
 *
 * All three exported functions are pure and side-effect-free.
 * No mocks required — these tests exercise only in-memory logic.
 *
 * Satisfies: bd-lt43 [start-wizard] Phase 8: Unit Tests
 * Spec:      openspec/changes/start-wizard/tests/plan.md §deriveSlug, §normaliseGenre, §buildEquivalentCommand
 */

import { deriveSlug, normaliseGenre, buildEquivalentCommand } from '../utils/wizard-utils';
import type { WizardState } from '../utils/wizard-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal WizardState with required fields; override any fields needed. */
function makeState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    title:     'The Midnight Run',
    genre:     'thriller',
    slug:      'the-midnight-run',
    outputDir: '/output/the-midnight-run',
    format:    ['md'],
    detail:    'standard',
    styles:    [],
    ...overrides,
  };
}

// ===========================================================================
// deriveSlug()
// ===========================================================================

describe('deriveSlug()', () => {
  it('lowercases and hyphenates a normal title', () => {
    expect(deriveSlug('The Midnight Run')).toBe('the-midnight-run');
  });

  it('handles a title starting with a number', () => {
    expect(deriveSlug('2046: A Space Drama')).toBe('2046-a-space-drama');
  });

  it('trims leading and trailing whitespace', () => {
    expect(deriveSlug('  Untitled Project  ')).toBe('untitled-project');
  });

  it('strips diacritics (NFD normalisation)', () => {
    expect(deriveSlug("Björk's Comeback!!!")).toBe('bjorks-comeback');
  });

  it('removes ampersand and collapses spaces', () => {
    expect(deriveSlug('ROMANCe & Action')).toBe('romance-action');
  });

  it('is a no-op for a valid slug', () => {
    expect(deriveSlug('already-a-valid-slug')).toBe('already-a-valid-slug');
  });

  it('lowercases ALLCAPS input', () => {
    expect(deriveSlug('ALLCAPS')).toBe('allcaps');
  });

  it('strips trailing hyphen', () => {
    expect(deriveSlug('trailing-hyphen-')).toBe('trailing-hyphen');
  });

  it('collapses multiple hyphens', () => {
    expect(deriveSlug('foo---bar')).toBe('foo-bar');
  });

  it('strips punctuation (colons, exclamation marks)', () => {
    expect(deriveSlug('Hello: World!')).toBe('hello-world');
  });
});

// ===========================================================================
// normaliseGenre()
// ===========================================================================

describe('normaliseGenre()', () => {
  const cases: Array<[string, string]> = [
    ['sci fi',   'sci-fi'],
    ['scifi',    'sci-fi'],
    ['rom com',  'romantic-comedy'],
    ['romcom',   'romantic-comedy'],
    ['rom-com',  'romantic-comedy'],
    ['thriller', 'thriller'],
    ['  Drama  ', 'Drama'],
  ];

  test.each(cases)('normaliseGenre(%j) → %j', (input, expected) => {
    expect(normaliseGenre(input)).toBe(expected);
  });

  it('normalises comma-separated multi-genre input', () => {
    expect(normaliseGenre('sci fi, rom com')).toBe('sci-fi, romantic-comedy');
  });

  it('handles three-part comma-separated input', () => {
    expect(normaliseGenre('scifi, thriller, rom com')).toBe('sci-fi, thriller, romantic-comedy');
  });

  it('preserves case for unknown genres', () => {
    expect(normaliseGenre('Western')).toBe('Western');
  });
});

// ===========================================================================
// buildEquivalentCommand()
// ===========================================================================

describe('buildEquivalentCommand()', () => {
  it('includes required flags (title, genre, format, detail) and omits --output-dir', () => {
    const cmd = buildEquivalentCommand(makeState());
    expect(cmd).toContain('filmbuff start');
    expect(cmd).toContain('--title');
    expect(cmd).toContain('--genre');
    // --output-dir is intentionally omitted: it is auto-derived from slug
    // (see buildEquivalentCommand comment in wizard-utils.ts line 140)
    expect(cmd).not.toContain('--output-dir');
    expect(cmd).toContain('--format');
    expect(cmd).toContain('--detail');
  });

  it('double-quotes values that contain spaces', () => {
    const cmd = buildEquivalentCommand(makeState({ title: 'The Midnight Run' }));
    expect(cmd).toContain('--title "The Midnight Run"');
  });

  it('does NOT quote values without spaces', () => {
    const cmd = buildEquivalentCommand(makeState({ genre: 'thriller' }));
    expect(cmd).toContain('--genre thriller');
    expect(cmd).not.toContain('--genre "thriller"');
  });

  it('omits optional undefined fields (tone, audience, budget, outcome, provider, profile)', () => {
    const cmd = buildEquivalentCommand(makeState({
      tone: undefined, audience: undefined, budget: undefined,
      outcome: undefined, provider: undefined, profile: undefined,
    }));
    expect(cmd).not.toContain('--tone');
    expect(cmd).not.toContain('--audience');
    expect(cmd).not.toContain('--budget');
    expect(cmd).not.toContain('--outcome');
    expect(cmd).not.toContain('--ai-provider');
    expect(cmd).not.toContain('--ai-profile');
  });

  it('omits --style when styles array is empty', () => {
    const cmd = buildEquivalentCommand(makeState({ styles: [] }));
    expect(cmd).not.toContain('--style');
  });

  it('emits two --style flags in order when two styles provided', () => {
    const cmd = buildEquivalentCommand(makeState({ styles: ['a/kubrick', 'b/noir'] }));
    expect(cmd).toContain('--style a/kubrick');
    expect(cmd).toContain('--style b/noir');
    const kubrickPos = cmd.indexOf('a/kubrick');
    const noirPos    = cmd.indexOf('b/noir');
    expect(kubrickPos).toBeLessThan(noirPos);
  });

  it('emits --ai-provider when provider is set; omits --ai-profile when profile is undefined', () => {
    const cmd = buildEquivalentCommand(makeState({ provider: 'anthropic', profile: undefined }));
    expect(cmd).toContain('--ai-provider anthropic');
    expect(cmd).not.toContain('--ai-profile');
  });

  it('emits both --ai-provider and --ai-profile when both are set', () => {
    const cmd = buildEquivalentCommand(makeState({ provider: 'anthropic', profile: 'work' }));
    expect(cmd).toContain('--ai-provider anthropic');
    expect(cmd).toContain('--ai-profile work');
  });

  it('joins lines with " \\\n" (shell continuation)', () => {
    const cmd = buildEquivalentCommand(makeState());
    expect(cmd).toContain(' \\\n');
  });
});
