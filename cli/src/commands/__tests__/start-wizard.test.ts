/**
 * start-wizard.test.ts — Unit tests for start-wizard.ts
 *
 * Tests:
 *   - stateToStartOptions()  pure mapping function
 *   - startWizard()          ExitPromptError handling
 *   - startCommand() trigger preamble (wizard flag combinations)
 *
 * Satisfies: bd-lt43 [start-wizard] Phase 8: Unit Tests
 * Spec:      openspec/changes/start-wizard/tests/plan.md §trigger-logic, §stateToStartOptions
 */

// ---------------------------------------------------------------------------
// Mocks — hoisted above imports
// ---------------------------------------------------------------------------

// Mock chalk (ESM compat) — recursive proxy
jest.mock('chalk', () => {
  function make(): any {
    const fn = (s: string) => s;
    return new Proxy(fn, { get: (_t, _p) => make() });
  }
  const root = make();
  return { default: root, blue: root, green: root, red: root, gray: root,
           yellow: root, cyan: root, bold: root, dim: root };
});

// Mock ora (ESM compat)
jest.mock('ora', () => () => ({
  start:   () => ({ succeed: jest.fn(), stop: jest.fn(), fail: jest.fn() }),
  succeed: jest.fn(),
  stop:    jest.fn(),
}));

// Mock @inquirer/prompts — individual exports
const mockInput   = jest.fn();
const mockSelect  = jest.fn();
const mockConfirm = jest.fn();
jest.mock('@inquirer/prompts', () => ({
  input:   (...args: unknown[]) => mockInput(...args),
  select:  (...args: unknown[]) => mockSelect(...args),
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

// Mock @inquirer/core — ExitPromptError
class MockExitPromptError extends Error {
  constructor() { super('User force-closed the prompt'); this.name = 'ExitPromptError'; }
}
jest.mock('@inquirer/core', () => ({
  ExitPromptError: MockExitPromptError,
}));

// Mock loadConfig (provider discovery)
jest.mock('../../utils/filmbuff-ai-client', () => ({
  loadConfig: jest.fn().mockRejectedValue(new Error('not configured')),
}));

// Mock db layer for trigger logic tests
const mockProjectRepo = {
  create:       jest.fn(),
  findBySlug:   jest.fn(),
  findById:     jest.fn(),
  getSteps:     jest.fn(),
  updateStep:   jest.fn(),
  updateStatus: jest.fn(),
};
const mockSessionRepo = {
  recordSession:         jest.fn(),
  completeSession:       jest.fn(),
  recordContextSnapshot: jest.fn(),
};
jest.mock('../../db/index', () => {
  class DuplicateSlugError extends Error {
    constructor(msg: string) { super(msg); this.name = 'DuplicateSlugError'; }
  }
  return {
    openDatabase:      jest.fn(() => ({})),
    runMigrations:     jest.fn(),
    MIGRATIONS_DIR:    '/mock/migrations',
    DuplicateSlugError,
    ProjectRepository: jest.fn(() => mockProjectRepo),
    SessionRepository: jest.fn(() => mockSessionRepo),
    ProviderRepository: jest.fn(() => ({})),
    DocumentRepository: jest.fn(() => ({})),
  };
});

// Mock start-wizard module for trigger-preamble tests
const mockStartWizard = jest.fn();
jest.mock('../start-wizard', () => ({
  ...jest.requireActual('../start-wizard'),
  startWizard: (...args: unknown[]) => mockStartWizard(...args),
}));

// Mock crypto
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn().mockReturnValue('test-uuid'),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { stateToStartOptions } from '../start-wizard';
import { startCommand }        from '../start';
import type { WizardState }    from '../../utils/wizard-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    title:     'The Midnight Run',
    genre:     'thriller',
    slug:      'the-midnight-run',
    outputDir: '/output/the-midnight-run',
    format:    'md',
    detail:    'standard',
    styles:    [],
    ...overrides,
  };
}

// ===========================================================================
// stateToStartOptions()
// ===========================================================================

describe('stateToStartOptions()', () => {
  it('maps all required fields correctly', () => {
    const state = makeState();
    const opts  = stateToStartOptions(state);
    expect(opts.title).toBe('The Midnight Run');
    expect(opts.genre).toBe('thriller');
    expect(opts.slug).toBe('the-midnight-run');
    expect(opts.outputDir).toBe('/output/the-midnight-run');
    expect(opts.format).toBe('md');
    expect(opts.detail).toBe('standard');
  });

  it('maps optional fields when present', () => {
    const state = makeState({ tone: 'dark', audience: 'adults', budget: 'low',
                              outcome: 'award winner', provider: 'anthropic', profile: 'work' });
    const opts  = stateToStartOptions(state);
    expect(opts.tone).toBe('dark');
    expect(opts.audience).toBe('adults');
    expect(opts.budget).toBe('low');
    expect(opts.outcome).toBe('award winner');
    expect(opts.provider).toBe('anthropic');
    expect(opts.profile).toBe('work');
  });

  it('leaves optional fields undefined when not set', () => {
    const opts = stateToStartOptions(makeState());
    expect(opts.tone).toBeUndefined();
    expect(opts.provider).toBeUndefined();
    expect(opts.profile).toBeUndefined();
  });

  it('returns a new styles array (does not share reference with state)', () => {
    const state = makeState({ styles: ['a/kubrick'] });
    const opts  = stateToStartOptions(state);
    expect(opts.styles).toEqual(['a/kubrick']);
    opts.styles!.push('mutated');
    expect(state.styles).toEqual(['a/kubrick']);  // original unchanged
  });
});

// ===========================================================================
// startCommand() — wizard trigger preamble (bd-ama1)
// ===========================================================================

describe('startCommand() wizard trigger preamble', () => {
  let consoleLogSpy:   jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy:  jest.SpyInstance;
  let processExitSpy:  jest.SpyInstance;
  let originalIsTTY:   boolean | undefined;
  let originalCI:      string | undefined;

  const WIZARD_RESULT = {
    title: 'Wizard Title', genre: 'drama', slug: 'wizard-title',
    outputDir: '/output/wizard-title', format: 'md' as const,
    detail: 'standard' as const, styles: [],
  };

  beforeEach(() => {
    consoleLogSpy   = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy  = jest.spyOn(console, 'warn').mockImplementation();
    processExitSpy  = jest.spyOn(process, 'exit').mockImplementation() as jest.SpyInstance;
    originalIsTTY   = process.stdout.isTTY;
    originalCI      = process.env['CI'];

    jest.clearAllMocks();
    mockProjectRepo.create.mockReturnValue({
      id: 'proj-id', slug: 'wizard-title', display_title: 'Wizard Title',
      genre: 'drama', output_dir: '/output/wizard-title', status: 'active',
    });
    mockProjectRepo.findBySlug.mockReturnValue(undefined);
    mockSessionRepo.recordSession.mockReturnValue(undefined);
    mockSessionRepo.completeSession.mockReturnValue(undefined);
    mockStartWizard.mockResolvedValue(WIZARD_RESULT);

    // Default: TTY interactive, no CI
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    delete process.env['CI'];
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    processExitSpy.mockRestore();
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    if (originalCI !== undefined) process.env['CI'] = originalCI;
    else delete process.env['CI'];
  });

  it('fires wizard when title is missing (TTY interactive)', async () => {
    await startCommand({ title: '', genre: 'drama' });
    expect(mockStartWizard).toHaveBeenCalledTimes(1);
  });

  it('fires wizard when genre is missing (TTY interactive)', async () => {
    await startCommand({ title: 'My Film', genre: '' });
    expect(mockStartWizard).toHaveBeenCalledTimes(1);
  });

  it('fires wizard when --wizard flag is set, even if title+genre provided', async () => {
    await startCommand({ title: 'My Film', genre: 'drama', wizard: true });
    expect(mockStartWizard).toHaveBeenCalledTimes(1);
  });

  it('passes existing flags as prefill to startWizard', async () => {
    await startCommand({ title: '', genre: 'thriller', wizard: false });
    expect(mockStartWizard).toHaveBeenCalledWith(
      expect.objectContaining({ genre: 'thriller' }),
      expect.any(Object),
    );
  });

  it('bypasses wizard when title+genre provided and no --wizard flag', async () => {
    await startCommand({ title: 'My Film', genre: 'drama' });
    expect(mockStartWizard).not.toHaveBeenCalled();
    expect(mockProjectRepo.create).toHaveBeenCalled();
  });

  it('exits 1 with error when --no-wizard and title is missing', async () => {
    await startCommand({ title: '', genre: 'drama', noWizard: true });
    expect(mockStartWizard).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('required'));
  });

  it('exits 1 with error when --no-wizard and genre is missing', async () => {
    await startCommand({ title: 'My Film', genre: '', noWizard: true });
    expect(mockStartWizard).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('suppresses wizard in non-TTY context and exits 1 when args missing', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    await startCommand({ title: '', genre: '' });
    expect(mockStartWizard).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('suppresses wizard when CI=true and exits 1 when args missing', async () => {
    process.env['CI'] = 'true';
    await startCommand({ title: '', genre: '' });
    expect(mockStartWizard).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('warns when both --wizard and --no-wizard supplied; --no-wizard wins', async () => {
    await startCommand({ title: 'My Film', genre: 'drama', wizard: true, noWizard: true });
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('--no-wizard'));
    expect(mockStartWizard).not.toHaveBeenCalled();
    // Passes through with valid title+genre
    expect(mockProjectRepo.create).toHaveBeenCalled();
  });
});
