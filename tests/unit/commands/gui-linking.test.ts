import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  promptMock,
  existsSyncMock,
  readFileSyncMock,
  readdirSyncMock,
  discoverModulesMock,
  discoverCollectionsMock,
  findProjectRootMock,
  getModulesDirMock,
  linkCommandMock,
  unlinkCommandMock,
  aiStatusCommandMock,
} = vi.hoisted(() => {
  const promptMock = vi.fn();
  const existsSyncMock = vi.fn();
  const readFileSyncMock = vi.fn();
  const readdirSyncMock = vi.fn();
  const discoverModulesMock = vi.fn();
  const discoverCollectionsMock = vi.fn();
  const findProjectRootMock = vi.fn();
  const getModulesDirMock = vi.fn();
  const linkCommandMock = vi.fn();
  const unlinkCommandMock = vi.fn();
  const aiStatusCommandMock = vi.fn();

  return {
    promptMock,
    existsSyncMock,
    readFileSyncMock,
    readdirSyncMock,
    discoverModulesMock,
    discoverCollectionsMock,
    findProjectRootMock,
    getModulesDirMock,
    linkCommandMock,
    unlinkCommandMock,
    aiStatusCommandMock,
  };
});

vi.mock('chalk', () => {
  function make(): any {
    const fn = (value: string) => String(value);
    return new Proxy(fn, { get: () => make() });
  }

  const r = make();
  return { default: r, blue: r, green: r, red: r, gray: r, yellow: r, cyan: r, bold: r, dim: r, white: r };
});

vi.mock('inquirer', () => {
  class SeparatorMock {
    separator?: string;

    constructor(separator?: string) {
      this.separator = separator;
    }
  }

  return {
    default: {
      prompt: promptMock,
      Separator: SeparatorMock,
    },
    prompt: promptMock,
    Separator: SeparatorMock,
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');

  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    readdirSync: readdirSyncMock,
  };
});

vi.mock('../../../cli/src/utils/module-system.js', async () => {
  const actual = await vi.importActual<typeof import('../../../cli/src/utils/module-system.js')>(
    '../../../cli/src/utils/module-system.js',
  );

  return {
    ...actual,
    discoverModules: discoverModulesMock,
    discoverCollections: discoverCollectionsMock,
    findProjectRoot: findProjectRootMock,
    getModulesDir: getModulesDirMock,
  };
});

vi.mock('../../../cli/src/commands/link.js', () => ({
  linkCommand: linkCommandMock,
}));

vi.mock('../../../cli/src/commands/unlink.js', () => ({
  unlinkCommand: unlinkCommandMock,
}));

vi.mock('../../../cli/src/commands/ai-status.js', () => ({
  aiStatusCommand: aiStatusCommandMock,
}));

import { guiCommand } from '../../../cli/src/commands/gui';

type ModuleFixture = {
  fullName: string;
  path: string;
  metadata: {
    name: string;
    version: string;
    displayName: string;
    description: string;
    type: string;
  };
  rules: string[];
  examples: string[];
};

const projectRoot = '/virtual/project';
const modulesDir = path.join(projectRoot, 'filmbuff');
const configPath = path.join(projectRoot, '.augment', 'extensions.json');

const screenplayModule: ModuleFixture = {
  fullName: 'writing-standards/screenplay',
  path: path.join(modulesDir, 'writing-standards/screenplay'),
  metadata: {
    name: 'screenplay',
    version: '1.0.0',
    displayName: 'Screenplay',
    description: 'Screenplay standards',
    type: 'writing-standards',
  },
  rules: ['screenplay.md'],
  examples: [],
};

const actionModule: ModuleFixture = {
  fullName: 'writing-standards/screenplay/genres/action',
  path: path.join(modulesDir, 'writing-standards/screenplay/genres/action'),
  metadata: {
    name: 'action',
    version: '1.0.0',
    displayName: 'Action',
    description: 'Action genre guidance',
    type: 'writing-standards',
  },
  rules: ['action.md'],
  examples: [],
};

const dramaModule: ModuleFixture = {
  fullName: 'writing-standards/screenplay/genres/drama',
  path: path.join(modulesDir, 'writing-standards/screenplay/genres/drama'),
  metadata: {
    name: 'drama',
    version: '1.0.0',
    displayName: 'Drama',
    description: 'Drama genre guidance',
    type: 'writing-standards',
  },
  rules: ['drama.md'],
  examples: [],
};

const workflowModule: ModuleFixture = {
  fullName: 'workflows/beads',
  path: path.join(modulesDir, 'workflows/beads'),
  metadata: {
    name: 'beads',
    version: '1.0.0',
    displayName: 'Beads',
    description: 'Beads workflow',
    type: 'workflows',
  },
  rules: ['beads.md'],
  examples: [],
};

function dirent(name: string): { name: string; isDirectory: () => boolean } {
  return {
    name,
    isDirectory: () => true,
  };
}

function getCheckboxPrompt(callIndex = 1): any {
  const promptCall = promptMock.mock.calls[callIndex]?.[0];
  expect(promptCall).toBeDefined();

  const checkboxPrompt = (promptCall as Array<{ type?: string }>).find(question => question.type === 'checkbox');
  expect(checkboxPrompt).toBeDefined();
  return checkboxPrompt;
}

describe('guiCommand link state normalization', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    promptMock.mockReset();
    existsSyncMock.mockReset().mockReturnValue(true);
    readFileSyncMock.mockReset();
    readdirSyncMock.mockReset().mockReturnValue([]);
    discoverModulesMock.mockReset().mockReturnValue([screenplayModule, actionModule, dramaModule, workflowModule]);
    discoverCollectionsMock.mockReset().mockReturnValue([]);
    findProjectRootMock.mockReset().mockReturnValue(projectRoot);
    getModulesDirMock.mockReset().mockReturnValue(modulesDir);
    linkCommandMock.mockReset().mockResolvedValue(undefined);
    unlinkCommandMock.mockReset().mockResolvedValue(undefined);
    aiStatusCommandMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('keeps legacy links checked in the top-level picker and leaves unresolved entries read-only', async () => {
    const config = {
      modules: [
        {
          name: 'screenplay',
          version: '0.9.0',
          type: 'writing-standards',
          description: 'Legacy screenplay link',
        },
        {
          name: 'legacy-ghost-module',
          version: '0.1.0',
          type: 'writing-standards',
          description: 'Unresolved legacy link',
        },
      ],
    };

    readFileSyncMock.mockImplementation((filePath: fs.PathLike) => {
      const file = String(filePath);

      if (file === configPath) {
        return JSON.stringify(config);
      }

      throw new Error(`Unexpected read: ${file}`);
    });

    promptMock
      .mockResolvedValueOnce({ action: 'link-modules' })
      .mockResolvedValueOnce({ selected: ['writing-standards/screenplay'] });

    await guiCommand();

    const checkboxPrompt = getCheckboxPrompt(1);
    const screenplayChoice = checkboxPrompt.choices.find((choice: any) => choice.value === 'writing-standards/screenplay');
    const ghostChoice = checkboxPrompt.choices.find((choice: any) => choice.value === 'legacy-ghost-module');

    expect(screenplayChoice?.checked).toBe(true);
    expect(ghostChoice?.disabled).toBe('left unchanged');
    expect(linkCommandMock).not.toHaveBeenCalled();
    expect(unlinkCommandMock).not.toHaveBeenCalled();
    expect(consoleLogSpy.mock.calls.flat().join(' ')).toContain('Some linked entries could not be normalized. They were left unchanged.');
    expect(consoleLogSpy.mock.calls.flat().join(' ')).toContain('No changes made.');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('keeps genre links checked in the submenu and unlinks the raw alias when deselected', async () => {
    const config = {
      modules: [
        {
          name: 'action',
          version: '0.9.0',
          type: 'writing-standards',
          description: 'Legacy action link',
        },
        {
          name: 'legacy-ghost-module',
          version: '0.1.0',
          type: 'writing-standards',
          description: 'Unresolved legacy link',
        },
      ],
    };
    const containerPath = path.join(modulesDir, 'writing-standards/screenplay/genres');
    const actionModuleJsonPath = path.join(containerPath, 'action', 'module.json');
    const dramaModuleJsonPath = path.join(containerPath, 'drama', 'module.json');

    readdirSyncMock.mockImplementation((dirPath: fs.PathLike) => {
      if (String(dirPath) === containerPath) {
        return [dirent('action'), dirent('drama')] as unknown as fs.Dirent[];
      }

      return [];
    });

    readFileSyncMock.mockImplementation((filePath: fs.PathLike) => {
      const file = String(filePath);

      if (file === configPath) {
        return JSON.stringify(config);
      }

      if (file === actionModuleJsonPath) {
        return JSON.stringify({
          description: actionModule.metadata.description,
          displayName: actionModule.metadata.displayName,
        });
      }

      if (file === dramaModuleJsonPath) {
        return JSON.stringify({
          description: dramaModule.metadata.description,
          displayName: dramaModule.metadata.displayName,
        });
      }

      throw new Error(`Unexpected read: ${file}`);
    });

    promptMock
      .mockResolvedValueOnce({ action: 'genres' })
      .mockResolvedValueOnce({ selected: [] });

    await guiCommand();

    const checkboxPrompt = getCheckboxPrompt(1);
    const actionChoice = checkboxPrompt.choices.find((choice: any) => choice.value === 'writing-standards/screenplay/genres/action');
    const ghostChoice = checkboxPrompt.choices.find((choice: any) => choice.value === 'legacy-ghost-module');

    expect(actionChoice?.checked).toBe(true);
    expect(ghostChoice?.disabled).toBe('left unchanged');
    expect(linkCommandMock).not.toHaveBeenCalled();
    expect(unlinkCommandMock).toHaveBeenCalledWith('action', {});
    expect(unlinkCommandMock).not.toHaveBeenCalledWith('legacy-ghost-module', {});
    expect(consoleLogSpy.mock.calls.flat().join(' ')).toContain('Some linked entries could not be normalized. They were left unchanged.');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });
});
