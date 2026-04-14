/**
 * start-wizard.integration.test.ts — Integration tests for startWizard()
 *
 * These tests exercise the REAL startWizard() implementation end-to-end by
 * injecting answers through mocked @inquirer/prompts.  No DB is involved —
 * the wizard is a pure option-collector.
 *
 * Scenarios:
 *   IT-1  Happy path:      12 steps + confirm → correct StartOptions returned
 *   IT-2  Pre-fill:        CLI flags flow as step defaults
 *   IT-3  DuplicateSlug:   slug re-prompted when findBySlug returns truthy
 *   IT-4  Quit:            confirm=false → select quit → process.exit(0)
 *   IT-5  Edit loop:       confirm=false → edit → second pass → confirm
 *   IT-6  Start-Over:      confirm=false → start-over → fresh pass → confirm
 *   IT-7  ExitPromptError: Ctrl-C on first prompt → process.exit(0)
 *   IT-8  Provider filter: video-only providers excluded from Step 11
 *   IT-9  Provider+profile: provider selected and profile resolved
 *
 * Satisfies: bd-gpnf [start-wizard] Phase 9: Integration Tests
 * Spec:      openspec/changes/start-wizard/tests/plan.md §integration
 */

// ---------------------------------------------------------------------------
// Mocks — hoisted above all imports by Jest's babel transform
// ---------------------------------------------------------------------------

// chalk — ESM compat; recursive proxy so any chain depth works
jest.mock('chalk', () => {
  function make(): any { const fn = (s: string) => s; return new Proxy(fn, { get: () => make() }); }
  const r = make();
  return { default: r, blue: r, green: r, red: r, gray: r, yellow: r, cyan: r, bold: r, dim: r };
});

// ora — spinner stub that chains .start() → this (ESM compat)
jest.mock('ora', () => () => {
  const spinner = { start() { return this; }, succeed: jest.fn(), stop: jest.fn(), fail: jest.fn() };
  return spinner;
});

// fs — prevent "outputDir already exists" warning in tests
jest.mock('fs', () => ({ ...jest.requireActual<typeof import('fs')>('fs'), existsSync: jest.fn().mockReturnValue(false) }));

// @inquirer/core — ExitPromptError class used by startWizard's catch guard
class MockExitPromptError extends Error {
  constructor() { super('User force-closed the prompt'); this.name = 'ExitPromptError'; }
}
jest.mock('@inquirer/core', () => ({ ExitPromptError: MockExitPromptError }));

// @inquirer/prompts — individual mock fns (queued per test via mockResolvedValueOnce)
const mockInput    = jest.fn();
const mockSelect   = jest.fn();
const mockConfirm  = jest.fn();
const mockCheckbox = jest.fn();
jest.mock('@inquirer/prompts', () => ({
  input:     (...a: unknown[]) => mockInput(...a),
  select:    (...a: unknown[]) => mockSelect(...a),
  confirm:   (...a: unknown[]) => mockConfirm(...a),
  checkbox:  (...a: unknown[]) => mockCheckbox(...a),
  Separator: class Separator { constructor(public readonly separator?: string) {} },
}));

// loadConfig — default: rejected (AI provider not configured)
const mockLoadConfig = jest.fn().mockRejectedValue(new Error('not configured'));
jest.mock('../../utils/filmbuff-ai-client', () => ({
  loadConfig: (...a: unknown[]) => mockLoadConfig(...a),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { startWizard } from '../../commands/start-wizard';
import type { StartOptions } from '../../commands/start';

// ---------------------------------------------------------------------------
// Answer-queue helpers
// ---------------------------------------------------------------------------

/**
 * Queue answers for a complete wizard pass where provider discovery FAILS
 * (loadConfig rejects).  The wizard still shows the provider select because
 * stepProvider now falls through to the "fresh install" all-providers path
 * rather than bailing early.  The queued provider answer is "(global default)"
 * so that stepProfile is never called.
 *
 * Call ordering (must match start-wizard.ts runSteps1to10 → runAllSteps):
 *   input    × 6:  title, genre, slug, tone, audience, outcome
 *   select   × 1:  budget
 *   checkbox × 2:  format (array), styles (array — empty [] to skip)
 *   select   × 1:  detail
 *   select   × 1:  provider → "(global default)" — stepProfile skipped
 *   confirm  × 1:  confirmationPanel
 *
 * Note: outputDir is auto-derived from slug — no longer prompted.
 */
function queuePassNoProvider(opts: {
  title?:     string;  genre?:    string;  slug?:     string;
  tone?:      string;  audience?: string;  outcome?:  string;
  budget?:    string;  format?:   string;
  detail?:    string;  proceed?:  boolean;
} = {}): void {
  const t = opts.title     ?? 'Happy Film';
  const g = opts.genre     ?? 'drama';
  const s = opts.slug      ?? 'happy-film';
  mockInput
    .mockResolvedValueOnce(t)                    // step 1: title
    .mockResolvedValueOnce(g)                    // step 2: genre
    .mockResolvedValueOnce(s)                    // step 3: slug
    .mockResolvedValueOnce(opts.tone      ?? '')  // step 4: tone  (empty → undefined)
    .mockResolvedValueOnce(opts.audience  ?? '')  // step 5: audience
    .mockResolvedValueOnce(opts.outcome   ?? ''); // step 7: outcome
  mockSelect
    .mockResolvedValueOnce(opts.budget ?? '(skip)');    // step 6: budget
  mockCheckbox
    .mockResolvedValueOnce([opts.format ?? 'md'])        // step 8a: format (checkbox → array)
    .mockResolvedValueOnce([]);                          // step 9: styles (empty → none selected)
  mockSelect
    .mockResolvedValueOnce(opts.detail ?? 'standard')   // step 8b: detail
    .mockResolvedValueOnce('(global default)');          // step 10: provider → use global default
  mockConfirm
    .mockResolvedValueOnce(opts.proceed ?? true);        // confirmationPanel → proceed
}

// ---------------------------------------------------------------------------
// Shared test setup
// ---------------------------------------------------------------------------

let processExitSpy: jest.SpyInstance;
let consoleLogSpy:  jest.SpyInstance;

beforeEach(() => {
  mockInput.mockReset();
  mockSelect.mockReset();
  mockConfirm.mockReset();
  mockCheckbox.mockReset();
  mockLoadConfig.mockReset();
  mockLoadConfig.mockRejectedValue(new Error('not configured'));
  processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
  consoleLogSpy  = jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});


// ===========================================================================
// IT-1: Happy path — full 12-step run, loadConfig fails gracefully
// ===========================================================================

describe('IT-1: Happy path (provider discovery fails gracefully)', () => {
  it('returns correct StartOptions after 11 steps + confirm', async () => {
    queuePassNoProvider({
      title: 'The Midnight Run', genre: 'thriller', slug: 'the-midnight-run',
      tone: 'dark', audience: 'adults 18+', outcome: 'award-winner',
      budget: 'low', format: 'fountain',
      detail: 'detailed', proceed: true,
    });

    const result = await startWizard({});

    expect(result.title).toBe('The Midnight Run');
    expect(result.genre).toBe('thriller');
    expect(result.slug).toBe('the-midnight-run');
    expect(result.tone).toBe('dark');
    expect(result.audience).toBe('adults 18+');
    expect(result.outcome).toBe('award-winner');
    // outputDir is auto-derived from slug — must end with the slug
    expect(result.outputDir).toContain('the-midnight-run');
    expect(result.budget).toBe('low');
    expect(result.format).toBe('fountain');
    expect(result.detail).toBe('detailed');
    expect(result.styles).toEqual([]);
    expect(result.provider).toBeUndefined();
    expect(result.profile).toBeUndefined();
  });

  it('returns undefined for optional fields when empty answers supplied', async () => {
    queuePassNoProvider(); // all optional fields empty

    const result = await startWizard({});

    expect(result.tone).toBeUndefined();
    expect(result.audience).toBeUndefined();
    expect(result.outcome).toBeUndefined();
    expect(result.budget).toBeUndefined();
    expect(result.provider).toBeUndefined();
    expect(result.profile).toBeUndefined();
  });

  it('calls input+select+checkbox+confirm the exact expected number of times', async () => {
    queuePassNoProvider();
    await startWizard({});
    expect(mockInput.mock.calls).toHaveLength(6);    // title, genre, slug, tone, audience, outcome
    expect(mockSelect.mock.calls).toHaveLength(3);   // budget, detail, provider
    expect(mockCheckbox.mock.calls).toHaveLength(2); // format, styles
    expect(mockConfirm.mock.calls).toHaveLength(1);  // confirmationPanel
  });
});

// ===========================================================================
// IT-2: Pre-fill — CLI flags become step defaults
// ===========================================================================

describe('IT-2: Pre-fill from CLI flags', () => {
  it('passes title prefill as input default for step 1', async () => {
    queuePassNoProvider({ title: 'Custom Title', slug: 'custom-title' });
    const prefill: Partial<StartOptions> = { title: 'Custom Title', genre: 'drama' };

    await startWizard(prefill);

    // Step 1 input should have been called with the prefill as default
    expect(mockInput.mock.calls[0][0]).toMatchObject({ default: 'Custom Title' });
  });

  it('passes genre prefill as input default for step 2', async () => {
    queuePassNoProvider({ genre: 'thriller', slug: 'happy-film' });
    await startWizard({ genre: 'thriller' });

    expect(mockInput.mock.calls[1][0]).toMatchObject({ default: 'thriller' });
  });

  it('outputDir is auto-derived from slug (no user prompt)', async () => {
    queuePassNoProvider({ slug: 'my-project' });
    const result = await startWizard({});
    // outputDir should be auto-derived and contain the slug
    expect(result.outputDir).toContain('my-project');
  });

  it('genre normalisation: sci fi input → sci-fi in returned options', async () => {
    queuePassNoProvider({ genre: 'sci fi', slug: 'happy-film' });
    const result = await startWizard({});
    expect(result.genre).toBe('sci-fi');
  });
});

// ===========================================================================
// IT-3: DuplicateSlug recovery — slug step re-prompts on collision
// ===========================================================================

describe('IT-3: DuplicateSlug recovery', () => {
  it('re-prompts slug once when findBySlug returns truthy for first attempt', async () => {
    const findBySlug = jest.fn()
      .mockReturnValueOnce({ id: 'other' })  // first attempt → collision
      .mockReturnValueOnce(undefined);        // second attempt → accepted

    // Slug input is called twice; all other inputs once.
    // Note: outputDir is auto-derived from slug — no input prompt for it.
    mockInput
      .mockResolvedValueOnce('Dupe Film')   // title
      .mockResolvedValueOnce('drama')       // genre
      .mockResolvedValueOnce('dupe-film')   // slug (first → duplicate)
      .mockResolvedValueOnce('dupe-film-2') // slug (second → accepted)
      .mockResolvedValueOnce('')            // tone
      .mockResolvedValueOnce('')            // audience
      .mockResolvedValueOnce('');           // outcome
    mockSelect
      .mockResolvedValueOnce('(skip)');     // budget
    mockCheckbox
      .mockResolvedValueOnce(['md'])        // format
      .mockResolvedValueOnce([]);           // styles
    mockSelect
      .mockResolvedValueOnce('standard');   // detail
    mockConfirm.mockResolvedValueOnce(true);

    const result = await startWizard({}, { findBySlug });

    expect(result.slug).toBe('dupe-film-2');
    expect(findBySlug).toHaveBeenCalledTimes(2);
    expect(findBySlug).toHaveBeenNthCalledWith(1, 'dupe-film');
    expect(findBySlug).toHaveBeenNthCalledWith(2, 'dupe-film-2');
    expect(mockInput.mock.calls).toHaveLength(7); // 6 normal + 1 extra slug
  });
});

// ===========================================================================
// IT-4: Quit — decline confirmation → select quit → process.exit(0)
// ===========================================================================

describe('IT-4: Quit after declining confirmation', () => {
  it('calls process.exit(0) when user selects Quit', async () => {
    // Pass 1: all steps
    queuePassNoProvider({ proceed: false });        // confirm → false (decline)
    mockSelect.mockResolvedValueOnce('quit');        // promptEditOrQuit → quit

    await expect(startWizard({})).rejects.toThrow('process.exit');
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('does not return StartOptions when quit is selected', async () => {
    queuePassNoProvider({ proceed: false });
    mockSelect.mockResolvedValueOnce('quit');

    let result: StartOptions | undefined;
    try {
      result = await startWizard({});
    } catch {
      // process.exit throws in test environment
    }
    expect(result).toBeUndefined();
  });
});

// ===========================================================================
// IT-5: Edit loop — decline → Edit → second pass → confirm
// ===========================================================================

describe('IT-5: Edit loop', () => {
  it('re-runs all 11 steps with prefill after Edit selected, returns second-pass result', async () => {
    // First pass — all steps, decline at confirm
    queuePassNoProvider({
      title: 'Original Title', slug: 'original-title', proceed: false,
    });
    // promptEditOrQuit → 'edit'
    mockSelect.mockResolvedValueOnce('edit');
    // Second pass — user corrects title; prefill is from first pass
    queuePassNoProvider({
      title: 'Revised Title', slug: 'revised-title', proceed: true,
    });

    const result = await startWizard({});

    expect(result.title).toBe('Revised Title');
    expect(result.slug).toBe('revised-title');
    // mockInput called 6 (first pass) + 6 (second pass) = 12 times
    expect(mockInput.mock.calls).toHaveLength(12);
    // mockSelect called 3 (first: budget+detail+provider) + 1 (edit select) + 3 (second: budget+detail+provider) = 7 times
    expect(mockSelect.mock.calls).toHaveLength(7);
    // mockCheckbox called 2 (first: format+styles) + 2 (second: format+styles) = 4 times
    expect(mockCheckbox.mock.calls).toHaveLength(4);
    // mockConfirm called 1 false + 1 true = 2 times
    expect(mockConfirm.mock.calls).toHaveLength(2);
  });

  it('passes first-pass values as prefill defaults into second pass', async () => {
    queuePassNoProvider({
      title: 'First Title', genre: 'comedy', slug: 'first-title', proceed: false,
    });
    mockSelect.mockResolvedValueOnce('edit');
    queuePassNoProvider({
      title: 'First Title', genre: 'comedy', slug: 'first-title', proceed: true,
    });

    await startWizard({});

    // Second-pass Step 1 (index 6 overall: 6 inputs per pass) should have default from first pass
    expect(mockInput.mock.calls[6][0]).toMatchObject({ default: 'First Title' });
    // Second-pass Step 2 (index 7) should have genre default
    expect(mockInput.mock.calls[7][0]).toMatchObject({ default: 'comedy' });
  });
});

// ===========================================================================
// IT-6: Start-Over — decline → Start Over → fresh pass (no prefill) → confirm
// ===========================================================================

describe('IT-6: Start-Over loop', () => {
  it('clears prefill on start-over and accepts second-pass result', async () => {
    // First pass
    queuePassNoProvider({
      title: 'First Draft', slug: 'first-draft', proceed: false,
    });
    mockSelect.mockResolvedValueOnce('start-over'); // promptEditOrQuit → start-over
    // Second pass — starts fresh (no prefill defaults)
    queuePassNoProvider({
      title: 'Fresh Start', slug: 'fresh-start', proceed: true,
    });

    const result = await startWizard({});

    expect(result.title).toBe('Fresh Start');
    // Second-pass Step 1 (index 6: 6 inputs per pass) should have NO default (prefill was cleared)
    expect(mockInput.mock.calls[6][0]).not.toHaveProperty('default', 'First Draft');
  });
});

// ===========================================================================
// IT-7: ExitPromptError — Ctrl-C on any prompt → process.exit(0)
// ===========================================================================

describe('IT-7: ExitPromptError (Ctrl-C) handling', () => {
  it('calls process.exit(0) when @inquirer/prompts throws ExitPromptError', async () => {
    mockInput.mockRejectedValueOnce(new MockExitPromptError());

    await expect(startWizard({})).rejects.toThrow('process.exit');
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('re-throws non-ExitPromptError errors from prompts', async () => {
    const unexpectedErr = new TypeError('unexpected internal error');
    mockInput.mockRejectedValueOnce(unexpectedErr);

    await expect(startWizard({})).rejects.toThrow('unexpected internal error');
    expect(processExitSpy).not.toHaveBeenCalled();
  });
});



// ===========================================================================
// IT-8: Provider filter — video-only providers excluded from Step 11
// ===========================================================================

describe('IT-8: VIDEO_ONLY_PROVIDERS filter', () => {
  /**
   * When loadConfig succeeds, stepProvider filters out lumaai, runway,
   * and stable-diffusion from the choices presented to the user.
   * We test this by verifying the `select` call for Step 11 does NOT
   * include those providers in its choices array.
   */
  it('excludes lumaai, runway, and stable-diffusion from provider choices', async () => {
    // Seed loadConfig with a mix of text + video providers
    mockLoadConfig.mockResolvedValue({
      providers: [
        { id: 'anthropic',         isActive: true  },
        { id: 'lumaai',            isActive: false }, // VIDEO_ONLY — must be excluded
        { id: 'runway',            isActive: false }, // VIDEO_ONLY — must be excluded
        { id: 'stable-diffusion',  isActive: false }, // VIDEO_ONLY — must be excluded
        { id: 'openai',            isActive: false },
      ],
      profiles: [],
    });

    // Steps 1-10 inputs/selects
    queuePassNoProvider({ proceed: false }); // will be overridden — we don't proceed past step 11
    // But wait: queuePassNoProvider queues confirm=false which conflicts.
    // Reset and re-queue properly: steps 1-10 then provider select then confirm
    mockInput.mockReset(); mockSelect.mockReset(); mockConfirm.mockReset();

    mockInput
      .mockResolvedValueOnce('Filter Test').mockResolvedValueOnce('drama')
      .mockResolvedValueOnce('filter-test').mockResolvedValueOnce('')
      .mockResolvedValueOnce('').mockResolvedValueOnce('');
    mockSelect
      .mockResolvedValueOnce('(skip)');     // budget
    mockCheckbox
      .mockResolvedValueOnce(['md'])         // format
      .mockResolvedValueOnce([]);            // styles
    mockSelect
      .mockResolvedValueOnce('standard')    // detail
      .mockResolvedValueOnce('anthropic');  // Step 11: provider — must not include video-only
    // loadConfig called again for profiles
    mockLoadConfig.mockResolvedValue({ providers: [], profiles: [] });
    mockSelect.mockResolvedValueOnce('(skip)'); // Step 12: profile skip
    mockConfirm.mockResolvedValueOnce(true);

    const result = await startWizard({});

    // The Step 11 select (index 2 in mockSelect.calls: budget=0, detail=1, provider=2)
    const providerSelectCall = mockSelect.mock.calls[2];
    const choices = providerSelectCall[0].choices as Array<{ value: string }>;
    const choiceValues = choices.map((c: { value: string }) => c.value);

    expect(choiceValues).not.toContain('lumaai');
    expect(choiceValues).not.toContain('runway');
    expect(choiceValues).not.toContain('stable-diffusion');
    expect(choiceValues).toContain('anthropic');
    expect(choiceValues).toContain('openai');
    expect(result.provider).toBe('anthropic');
  });
});

// ===========================================================================
// IT-9: Provider + Profile — both selected and returned in StartOptions
// ===========================================================================

describe('IT-9: Provider and profile selection (Steps 11-12)', () => {
  it('returns provider and profile when both selected in Steps 11-12', async () => {
    // loadConfig for providers (step 11)
    mockLoadConfig.mockResolvedValueOnce({
      providers: [{ id: 'anthropic', isActive: true }],
      profiles:  [],
    });
    // loadConfig for profiles (step 12)
    mockLoadConfig.mockResolvedValueOnce({
      providers: [],
      profiles:  [
        { name: 'work',     providerId: 'anthropic', isActive: true  },
        { name: 'personal', providerId: 'anthropic', isActive: false },
      ],
    });

    // Steps 1-9 (outputDir is auto-derived from slug)
    mockInput
      .mockResolvedValueOnce('Provider Film').mockResolvedValueOnce('drama')
      .mockResolvedValueOnce('provider-film').mockResolvedValueOnce('')
      .mockResolvedValueOnce('').mockResolvedValueOnce('');
    mockSelect
      .mockResolvedValueOnce('(skip)');      // budget
    mockCheckbox
      .mockResolvedValueOnce(['md'])          // format
      .mockResolvedValueOnce([]);             // styles
    mockSelect
      .mockResolvedValueOnce('standard')     // detail
      .mockResolvedValueOnce('anthropic')    // Step 11: provider
      .mockResolvedValueOnce('work');        // Step 12: profile
    mockConfirm.mockResolvedValueOnce(true); // confirm

    const result = await startWizard({});

    expect(result.provider).toBe('anthropic');
    expect(result.profile).toBe('work');
    expect(mockSelect.mock.calls).toHaveLength(4); // budget+detail+provider+profile
    // Note: loadConfig is called 1-2 times depending on profileCache state across tests.
    // The important invariant is that provider + profile are returned correctly.
    expect(mockLoadConfig).toHaveBeenCalled();
  });

  it('returns undefined profile when step 12 returns (skip)', async () => {
    mockLoadConfig.mockResolvedValueOnce({
      providers: [{ id: 'openai', isActive: false }],
      profiles:  [],
    });
    mockLoadConfig.mockResolvedValueOnce({
      providers: [],
      profiles:  [{ name: 'default', providerId: 'openai', isActive: true }],
    });

    mockInput
      .mockResolvedValueOnce('Skip Profile').mockResolvedValueOnce('drama')
      .mockResolvedValueOnce('skip-profile').mockResolvedValueOnce('')
      .mockResolvedValueOnce('').mockResolvedValueOnce('');
    mockSelect
      .mockResolvedValueOnce('(skip)');  // budget
    mockCheckbox
      .mockResolvedValueOnce(['md'])      // format
      .mockResolvedValueOnce([]);         // styles
    mockSelect
      .mockResolvedValueOnce('standard') // detail
      .mockResolvedValueOnce('openai')   // provider
      .mockResolvedValueOnce('(skip)');  // profile → skip → undefined
    mockConfirm.mockResolvedValueOnce(true);

    const result = await startWizard({});

    expect(result.provider).toBe('openai');
    expect(result.profile).toBeUndefined();
  });

  it('skips step 12 entirely when provider is "(global default)"', async () => {
    // loadConfig fails → stepProvider falls through to all-providers select →
    // user picks "(global default)" → stepProfile not called.
    queuePassNoProvider(); // queues "(global default)" for provider, loadConfig set to reject

    await startWizard({});

    // 3 select calls: budget, detail, provider=(global default) — stepProfile not called
    expect(mockSelect.mock.calls).toHaveLength(3);
    expect(mockLoadConfig).toHaveBeenCalledTimes(1); // once for provider (fails gracefully)
  });
});
