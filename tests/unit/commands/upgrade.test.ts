import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';

const {
  projectRoot,
  mockModule,
  canonicalModuleName,
  defaultConfig,
  defaultLatestResult,
  defaultCompatibilityResult,
  existsSyncMock,
  readFileSyncMock,
  writeFileSyncMock,
  discoverModulesMock,
  findModuleMock,
  findProjectRootMock,
  versionManagerGetVersionMock,
  moduleLoaderLoadMock,
  compatibilityCheckerCheckMock
} = vi.hoisted(() => {
  const canonicalModuleName = 'writing-standards/screenplay/genres/action';
  const projectRoot = 'test-project-root';
  const mockModule = {
    fullName: canonicalModuleName,
    path: `${projectRoot}/filmbuff/${canonicalModuleName}`,
    metadata: {
      name: 'screenplay-genre-action',
      version: '1.0.0',
      displayName: 'Action',
      description: 'Action genre guidance',
      type: 'writing-standards'
    },
    rules: ['action.md'],
    examples: []
  };
  const defaultLatestResult = {
    module: mockModule,
    version: '2.0.0',
    metadata: {
      breaking: false,
      deprecated: false
    },
    resolution: {
      version: '2.0.0',
      path: mockModule.path,
      strategy: 'latest',
      available: ['2.0.0']
    }
  };
  const defaultCompatibilityResult = {
    compatible: true,
    errors: [],
    warnings: [],
    deprecations: [],
    details: {}
  };

    return {
      projectRoot,
      canonicalModuleName,
      mockModule,
      defaultConfig: {
        modules: [
          {
            name: mockModule.fullName,
            version: mockModule.metadata.version,
            type: mockModule.metadata.type,
            description: mockModule.metadata.description
          }
      ]
    },
    defaultLatestResult,
    defaultCompatibilityResult,
    existsSyncMock: vi.fn(),
    readFileSyncMock: vi.fn(),
    writeFileSyncMock: vi.fn(),
    discoverModulesMock: vi.fn(() => [mockModule]),
    findModuleMock: vi.fn(() => mockModule),
    findProjectRootMock: vi.fn(() => projectRoot),
    versionManagerGetVersionMock: vi.fn(() => ({ version: '1.0.0' })),
    moduleLoaderLoadMock: vi.fn(() => defaultLatestResult),
    compatibilityCheckerCheckMock: vi.fn(() => defaultCompatibilityResult)
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');

  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock
  };
});

vi.mock('../../../cli/src/utils/module-system', async () => {
  const actual = await vi.importActual<typeof import('../../../cli/src/utils/module-system')>('../../../cli/src/utils/module-system');

  return {
    ...actual,
    discoverModules: discoverModulesMock,
    findModule: findModuleMock,
    findProjectRoot: findProjectRootMock
  };
});

vi.mock('../../../cli/src/core/version-manager', () => ({
  VersionManager: class {
    getVersion = versionManagerGetVersionMock;
  }
}));

vi.mock('../../../cli/src/core/module-loader', () => ({
  ModuleLoader: class {
    load = moduleLoaderLoadMock;
  }
}));

vi.mock('../../../cli/src/core/compatibility-checker', () => ({
  CompatibilityChecker: class {
    checkCompatibility = compatibilityCheckerCheckMock;
  }
}));

import { upgradeCommand } from '../../../cli/src/commands/upgrade';

describe('upgradeCommand', () => {
  const moduleName = 'action';
  const latestVersion = '2.0.0';
  const configPath = path.join(projectRoot, '.augment', 'extensions.json');

  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    existsSyncMock.mockReset().mockReturnValue(true);
    readFileSyncMock.mockReset().mockReturnValue(JSON.stringify(defaultConfig));
    writeFileSyncMock.mockReset().mockImplementation(() => undefined);

    discoverModulesMock.mockReset().mockReturnValue([mockModule]);
    findModuleMock.mockReset().mockReturnValue(mockModule);
    findProjectRootMock.mockReset().mockReturnValue(projectRoot);
    versionManagerGetVersionMock.mockReset().mockReturnValue({ version: '1.0.0' });
    moduleLoaderLoadMock.mockReset().mockReturnValue(defaultLatestResult);
    compatibilityCheckerCheckMock.mockReset().mockReturnValue(defaultCompatibilityResult);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates the config entry and reports success when sync succeeds', async () => {
    await upgradeCommand(moduleName, {});

    expect(findModuleMock).toHaveBeenCalledWith(moduleName);
    expect(discoverModulesMock).not.toHaveBeenCalled();
    expect(existsSyncMock).toHaveBeenCalledWith(configPath);
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      configPath,
      expect.any(String),
      'utf-8'
    );

    const [, writtenConfigText] = writeFileSyncMock.mock.calls[0];
    const writtenConfig = JSON.parse(writtenConfigText as string);
    expect(writtenConfig.modules[0]).toEqual(expect.objectContaining({
      name: canonicalModuleName,
      version: latestVersion
    }));
    expect(writtenConfig.modules[0].upgradedAt).toEqual(expect.any(String));

    expect(consoleLogSpy.mock.calls.flat().join(' ')).toContain('Successfully upgraded action');
    expect(consoleLogSpy.mock.calls.flat().join(' ')).toContain('Config updated');
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('fails with a recovery message when the config JSON is malformed', async () => {
    readFileSyncMock.mockReturnValueOnce('{ malformed json');

    await upgradeCommand(moduleName, {});

    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);

    const consoleErrors = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(consoleErrors).toContain('Upgrade completed, but .augment/extensions.json could not be updated. Fix the config and rerun the command.');
    expect(consoleErrors).toContain('JSON at position');

    const consoleLogs = consoleLogSpy.mock.calls.flat().join(' ');
    expect(consoleLogs).not.toContain('Successfully upgraded');
  });

  it('fails with a recovery message when the parsed config is missing modules', async () => {
    readFileSyncMock.mockReturnValueOnce(JSON.stringify({}));

    await upgradeCommand(moduleName, {});

    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);

    const consoleErrors = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(consoleErrors).toContain('Upgrade completed, but .augment/extensions.json could not be updated. Fix the config and rerun the command.');
    expect(consoleErrors).toContain('Invalid config format');

    const consoleLogs = consoleLogSpy.mock.calls.flat().join(' ');
    expect(consoleLogs).not.toContain('Successfully upgraded');
  });

  it('returns a non-success json payload when the config write is unwritable', async () => {
    writeFileSyncMock.mockImplementation(() => {
      throw new Error('EACCES: permission denied, open test-project-root/.augment/extensions.json');
    });

    await upgradeCommand(moduleName, { json: true });

    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(1);

    const jsonCall = consoleLogSpy.mock.calls.find(([arg]) => typeof arg === 'string' && arg.trim().startsWith('{'));
    expect(jsonCall).toBeDefined();

    const parsed = JSON.parse(jsonCall![0] as string);
    expect(parsed).toMatchObject({
      success: false,
      error: 'Upgrade completed, but .augment/extensions.json could not be updated. Fix the config and rerun the command.',
      details: 'EACCES: permission denied, open test-project-root/.augment/extensions.json',
      module: moduleName,
      previousVersion: '1.0.0',
      newVersion: latestVersion,
      configUpdated: false
    });

    const consoleLogs = consoleLogSpy.mock.calls.flat().join(' ');
    expect(consoleLogs).not.toContain('Successfully upgraded');
  });

  it('keeps dry-run behavior unchanged', async () => {
    await upgradeCommand(moduleName, { dryRun: true });

    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(consoleLogSpy.mock.calls.flat().join(' ')).toContain('[DRY RUN] No changes made');
    expect(consoleLogSpy.mock.calls.flat().join(' ')).not.toContain('Successfully upgraded');
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('preserves the JSON dry-run payload shape for canonical module names', async () => {
    await upgradeCommand(canonicalModuleName, { json: true, dryRun: true });

    expect(findModuleMock).toHaveBeenCalledWith(canonicalModuleName);
    expect(discoverModulesMock).not.toHaveBeenCalled();
    expect(writeFileSyncMock).not.toHaveBeenCalled();

    const jsonCall = consoleLogSpy.mock.calls.find(([arg]) => typeof arg === 'string' && arg.trim().startsWith('{'));
    expect(jsonCall).toBeDefined();

    const parsed = JSON.parse(jsonCall![0] as string);
    expect(parsed).toEqual({
      dryRun: true,
      module: canonicalModuleName,
      currentVersion: '1.0.0',
      latestVersion,
      breaking: false,
      deprecated: false,
      compatibility: defaultCompatibilityResult
    });
  });

  it('reports missing modules with the existing not-found message', async () => {
    findModuleMock.mockReturnValue(null);

    await upgradeCommand('missing-module', {});

    expect(discoverModulesMock).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(1);

    const consoleErrors = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(consoleErrors).toContain('✗ Module not found: missing-module');

    const consoleLogs = consoleLogSpy.mock.calls.flat().join(' ');
    expect(consoleLogs).toContain('Available modules:');
    expect(consoleLogs).toContain(canonicalModuleName);
  });

  it('keeps the already-latest no-op behavior unchanged', async () => {
    moduleLoaderLoadMock.mockReturnValue({
      ...defaultLatestResult,
      version: '1.0.0',
      metadata: {
        breaking: false,
        deprecated: false
      },
      resolution: {
        ...defaultLatestResult.resolution,
        version: '1.0.0',
        available: ['1.0.0']
      }
    });

    await upgradeCommand(moduleName, {});

    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(consoleLogSpy.mock.calls.flat().join(' ')).toContain('already at the latest version');
    expect(processExitSpy).not.toHaveBeenCalled();
  });
});
