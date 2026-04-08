/**
 * Unit tests for pipeline commands
 * Tests: startCommand, continueCommand, retryCommand, completeCommand, statusCommand
 *
 * Satisfies: bd-pipe-c9 buff-core.03.03.01 - Write unit tests for pipeline commands
 */

import * as fs from 'fs';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted above imports of modules under test
// ---------------------------------------------------------------------------

// Mock chalk (ESM compat) — uses a recursive proxy so any chain depth works,
// e.g. chalk.green.bold('x'), chalk.bold.blue('x'), chalk.dim.red.bold('x').
jest.mock('chalk', () => {
  function make(): any {
    const fn = (s: string) => s;
    return new Proxy(fn, { get: (_t, _p) => make() });
  }
  const root = make();
  return { default: root, blue: root, green: root, red: root, gray: root,
           yellow: root, cyan: root, bold: root, dim: root };
});

// Mock fs
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock crypto.randomUUID
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn(),
}));
const mockCrypto = crypto as jest.Mocked<typeof crypto>;

// Mock db layer
const mockProjectRepo = {
  create:       jest.fn(),
  findBySlug:   jest.fn(),
  findById:     jest.fn(),
  getSteps:     jest.fn(),
  updateStep:   jest.fn(),
  updateStatus: jest.fn(),
};
const mockDocumentRepo = {
  listAttempts:  jest.fn(),
  rejectAttempt: jest.fn(),
  saveRevision:  jest.fn(),
};
const mockSessionRepo = {
  recordSession:         jest.fn(),
  completeSession:       jest.fn(),
  recordContextSnapshot: jest.fn(),
};
const mockProviderRepo = {
  getActiveSelection: jest.fn(),
};

// Mock start-wizard so ESM-only @inquirer/prompts is never loaded in pipeline tests.
// startCommand() has title+genre in all pipeline tests, so the wizard never fires.
jest.mock('../start-wizard', () => ({
  startWizard: jest.fn().mockImplementation((opts: unknown) => Promise.resolve(opts)),
  stateToStartOptions: jest.fn().mockImplementation((state: unknown) => state),
}));

jest.mock('../../db/index', () => {
  class DuplicateSlugError extends Error {
    constructor(msg: string) { super(msg); this.name = 'DuplicateSlugError'; }
  }
  return {
    openDatabase:        jest.fn(() => ({})),
    runMigrations:       jest.fn(),
    MIGRATIONS_DIR:      '/mock/migrations',
    DuplicateSlugError,
    ProjectRepository:   jest.fn(() => mockProjectRepo),
    DocumentRepository:  jest.fn(() => mockDocumentRepo),
    SessionRepository:   jest.fn(() => mockSessionRepo),
    ProviderRepository:  jest.fn(() => mockProviderRepo),
  };
});

import type { PipelineStepName, StepStatus } from '../../db/index';
import { DuplicateSlugError } from '../../db/index';
import { startCommand }    from '../start';
import { continueCommand } from '../continue';
import { retryCommand }    from '../retry';
import { completeCommand } from '../complete';
import { statusCommand }   from '../status';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const PROJECT_ID  = 'proj-uuid-0001';
const SESSION_ID  = 'sess-uuid-0001';
const ATTEMPT_ID  = 'att-uuid-0001';

/** Valid pipeline step name used across tests. */
const STEP_NAME: PipelineStepName = 'logline';

const MOCK_PROJECT = {
  id:                  PROJECT_ID,
  slug:                'test-film',
  display_title:       'Test Film',
  genre:               'drama',
  tone:                'serious',
  target_audience:     'adults',
  budget_tier:         'medium',
  outcome:             '90-min feature',
  output_dir:          '/output/test-film',
  detail_level:        'standard',
  style_modules:       [],
  active_provider_id:  null,
  active_profile_name: null,
  status:              'active',
};

interface MockStep {
  id:               string;
  project_id:       string;
  step_number:      number;
  step_name:        PipelineStepName;
  status:           StepStatus;
  output_file_path: string | null;
  output_format:    string | null;
  accepted_at:      string | null;
  failed_at:        string | null;
  failure_reason:   string | null;
  retry_count:      number;
}

/** Build a mock pipeline step with sensible defaults. */
function makeStep(overrides: Partial<MockStep> = {}): MockStep {
  return {
    id:               'step-uuid',
    project_id:       PROJECT_ID,
    step_number:      1,
    step_name:        STEP_NAME,
    status:           'pending',
    output_file_path: null,
    output_format:    null,
    accepted_at:      null,
    failed_at:        null,
    failure_reason:   null,
    retry_count:      0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Common setup
// ---------------------------------------------------------------------------

let consoleLogSpy:   jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;
let processExitSpy:  jest.SpyInstance;

beforeEach(() => {
  consoleLogSpy   = jest.spyOn(console, 'log').mockImplementation();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  processExitSpy  = jest.spyOn(process, 'exit').mockImplementation() as jest.SpyInstance;
  jest.clearAllMocks();
  (mockCrypto.randomUUID as jest.Mock)
    .mockReturnValueOnce(PROJECT_ID)
    .mockReturnValueOnce(SESSION_ID)
    .mockReturnValue(ATTEMPT_ID);
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  processExitSpy.mockRestore();
});

// ===========================================================================
// startCommand
// ===========================================================================

describe('startCommand', () => {
  it('creates a project and prints success', async () => {
    mockSessionRepo.recordSession.mockReturnValue(undefined);
    mockProjectRepo.create.mockReturnValue(MOCK_PROJECT);
    mockSessionRepo.completeSession.mockReturnValue(undefined);

    await startCommand({ title: 'Test Film', genre: 'drama' });

    expect(mockProjectRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ display_title: 'Test Film', genre: 'drama', slug: 'test-film' }),
    );
    expect(mockSessionRepo.completeSession).toHaveBeenCalledWith(SESSION_ID, 0);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('created'));
  });

  it('uses custom slug when provided', async () => {
    mockProjectRepo.create.mockReturnValue({ ...MOCK_PROJECT, slug: 'my-slug' });

    await startCommand({ title: 'Test Film', genre: 'drama', slug: 'my-slug' });

    expect(mockProjectRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'my-slug' }),
    );
  });

  it('handles DuplicateSlugError and exits 1', async () => {
    mockProjectRepo.create.mockImplementation(() => {
      throw new DuplicateSlugError('slug already exists');
    });

    await startCommand({ title: 'Test Film', genre: 'drama' });

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('slug already exists'));
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('handles unknown errors and exits 1', async () => {
    mockProjectRepo.create.mockImplementation(() => { throw new Error('db error'); });

    await startCommand({ title: 'Test Film', genre: 'drama' });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.anything(), expect.stringContaining('db error'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});

// ===========================================================================
// continueCommand
// ===========================================================================

describe('continueCommand', () => {
  it('finds next pending step and assembles context', async () => {
    mockProjectRepo.findBySlug.mockReturnValue(MOCK_PROJECT);
    mockProjectRepo.getSteps.mockReturnValue([makeStep({ status: 'pending' })]);

    await continueCommand({ project: 'test-film' });

    expect(mockSessionRepo.recordContextSnapshot).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Next step'));
  });

  it('prints warning when all steps are complete', async () => {
    mockProjectRepo.findBySlug.mockReturnValue(MOCK_PROJECT);
    mockProjectRepo.getSteps.mockReturnValue([makeStep({ status: 'completed' })]);

    await continueCommand({ project: 'test-film' });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('completed'));
    expect(mockSessionRepo.recordContextSnapshot).not.toHaveBeenCalled();
  });

  it('exits 1 when project not found', async () => {
    mockProjectRepo.findBySlug.mockReturnValue(null);
    mockProjectRepo.findById.mockReturnValue(null);

    await continueCommand({ project: 'missing' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('skips persisting snapshots in dry-run mode', async () => {
    mockProjectRepo.findBySlug.mockReturnValue(MOCK_PROJECT);
    mockProjectRepo.getSteps.mockReturnValue([makeStep({ status: 'pending' })]);

    await continueCommand({ project: 'test-film', dryRun: true });

    expect(mockSessionRepo.recordContextSnapshot).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('dry-run'));
  });
});

// ===========================================================================
// retryCommand
// ===========================================================================

describe('retryCommand', () => {
  it('resets a failed step to pending', async () => {
    const failedStep = makeStep({ status: 'failed', retry_count: 1 });
    mockProjectRepo.findBySlug.mockReturnValue(MOCK_PROJECT);
    mockProjectRepo.getSteps.mockReturnValue([failedStep]);
    mockDocumentRepo.listAttempts.mockReturnValue([]);

    await retryCommand({ project: 'test-film' });

    expect(mockProjectRepo.updateStep).toHaveBeenCalledWith(
      failedStep.id,
      expect.objectContaining({ status: 'pending', retry_count: 2 }),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('reset to pending'));
  });

  it('rejects last accepted attempt before resetting step', async () => {
    const inProgressStep = makeStep({ status: 'in_progress' });
    const mockAttempt = { id: 'att-1', status: 'accepted' };
    mockProjectRepo.findBySlug.mockReturnValue(MOCK_PROJECT);
    mockProjectRepo.getSteps.mockReturnValue([inProgressStep]);
    mockDocumentRepo.listAttempts.mockReturnValue([mockAttempt]);

    await retryCommand({ project: 'test-film' });

    expect(mockDocumentRepo.rejectAttempt).toHaveBeenCalledWith('att-1');
  });

  it('prints warning when no retryable step found', async () => {
    mockProjectRepo.findBySlug.mockReturnValue(MOCK_PROJECT);
    mockProjectRepo.getSteps.mockReturnValue([makeStep({ status: 'pending' })]);

    await retryCommand({ project: 'test-film' });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No retryable'));
  });

  it('exits 1 when project not found', async () => {
    mockProjectRepo.findBySlug.mockReturnValue(null);
    mockProjectRepo.findById.mockReturnValue(null);

    await retryCommand({ project: 'missing' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 when named step is not retryable', async () => {
    const completedStep = makeStep({ status: 'completed', step_name: STEP_NAME });
    mockProjectRepo.findBySlug.mockReturnValue(MOCK_PROJECT);
    mockProjectRepo.getSteps.mockReturnValue([completedStep]);

    await retryCommand({ project: 'test-film', step: STEP_NAME });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});

// ===========================================================================
// completeCommand
// ===========================================================================

describe('completeCommand', () => {
  const FILE_PATH = '/tmp/logline.md';

  beforeEach(() => {
    mockFs.existsSync.mockReturnValue(true);
    (mockFs.realpathSync as unknown as jest.Mock).mockReturnValue(FILE_PATH);
    (mockFs.readFileSync as unknown as jest.Mock).mockReturnValue('# Logline\n\nSome content.');
    mockProjectRepo.findBySlug.mockReturnValue(MOCK_PROJECT);
  });

  it('marks step as completed and saves revision', async () => {
    const pendingStep = makeStep({ status: 'pending', step_name: STEP_NAME });
    mockProjectRepo.getSteps
      .mockReturnValueOnce([pendingStep])
      .mockReturnValueOnce([{ ...pendingStep, status: 'completed' }]);

    await completeCommand({ project: 'test-film', step: STEP_NAME, file: FILE_PATH });

    expect(mockDocumentRepo.saveRevision).toHaveBeenCalled();
    expect(mockProjectRepo.updateStep).toHaveBeenCalledWith(
      pendingStep.id,
      expect.objectContaining({ status: 'completed' }),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('marked as completed'));
  });

  it('marks project completed when all steps done', async () => {
    const pendingStep = makeStep({ status: 'pending', step_name: STEP_NAME });
    mockProjectRepo.getSteps
      .mockReturnValueOnce([pendingStep])
      .mockReturnValueOnce([{ ...pendingStep, status: 'completed' }]);

    await completeCommand({ project: 'test-film', step: STEP_NAME, file: FILE_PATH });

    expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith(PROJECT_ID, 'completed');
  });

  it('exits 1 when file not found', async () => {
    mockFs.existsSync.mockReturnValue(false);

    await completeCommand({ project: 'test-film', step: STEP_NAME, file: '/bad/path.md' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 when project not found', async () => {
    mockProjectRepo.findBySlug.mockReturnValue(null);
    mockProjectRepo.findById.mockReturnValue(null);

    await completeCommand({ project: 'missing', step: STEP_NAME, file: FILE_PATH });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 when step not found in project', async () => {
    mockProjectRepo.getSteps.mockReturnValue([makeStep({ step_name: 'treatment' })]);

    await completeCommand({ project: 'test-film', step: STEP_NAME, file: FILE_PATH });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('returns early when step is already completed', async () => {
    const doneStep = makeStep({ status: 'completed', step_name: STEP_NAME });
    mockProjectRepo.getSteps.mockReturnValue([doneStep]);

    await completeCommand({ project: 'test-film', step: STEP_NAME, file: FILE_PATH });

    expect(mockDocumentRepo.saveRevision).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// statusCommand
// ===========================================================================

describe('statusCommand', () => {
  beforeEach(() => {
    mockProjectRepo.findBySlug.mockReturnValue(MOCK_PROJECT);
    mockProviderRepo.getActiveSelection.mockReturnValue(null);
  });

  it('prints step table by default', async () => {
    const steps = [
      makeStep({ step_name: 'logline',   status: 'completed', step_number: 1 }),
      makeStep({ step_name: 'treatment', status: 'pending',   step_number: 2, id: 'step-2' }),
    ];
    mockProjectRepo.getSteps.mockReturnValue(steps);

    await statusCommand({ project: 'test-film' });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('logline'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('treatment'));
  });

  it('outputs JSON when --format json', async () => {
    const steps = [makeStep({ step_name: 'logline', status: 'pending' })];
    mockProjectRepo.getSteps.mockReturnValue(steps);

    await statusCommand({ project: 'test-film', format: 'json' });

    const jsonCall = consoleLogSpy.mock.calls.find(
      ([arg]) => typeof arg === 'string' && arg.trim().startsWith('{'),
    );
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall![0]);
    expect(parsed).toHaveProperty('project');
    expect(parsed).toHaveProperty('steps');
  });

  it('prints next pending step info with --next', async () => {
    mockProjectRepo.getSteps.mockReturnValue([
      makeStep({ step_name: 'logline', status: 'pending' }),
    ]);

    await statusCommand({ project: 'test-film', next: true });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('logline'));
  });

  it('shows only remaining steps with --remaining', async () => {
    mockProjectRepo.getSteps.mockReturnValue([
      makeStep({ step_name: 'logline',   status: 'completed', step_number: 1 }),
      makeStep({ step_name: 'treatment', status: 'pending',   step_number: 2, id: 'step-2' }),
    ]);

    await statusCommand({ project: 'test-film', remaining: true });

    const allArgs = consoleLogSpy.mock.calls.flat().join(' ');
    expect(allArgs).toContain('treatment');
  });

  it('exits 1 when project not found', async () => {
    mockProjectRepo.findBySlug.mockReturnValue(null);
    mockProjectRepo.findById.mockReturnValue(null);

    await statusCommand({ project: 'missing' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('shows complete message when no pending steps with --next', async () => {
    mockProjectRepo.getSteps.mockReturnValue([
      makeStep({ step_name: 'logline', status: 'completed' }),
    ]);

    await statusCommand({ project: 'test-film', next: true });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('complete'));
  });
});

