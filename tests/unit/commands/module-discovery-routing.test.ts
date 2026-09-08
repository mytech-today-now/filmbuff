import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockModules, discoverModulesMock } = vi.hoisted(() => {
  const mockModules = [
    {
      fullName: 'writing-standards/screenplay/genres/action',
      path: '/virtual/filmbuff/writing-standards/screenplay/genres/action',
      metadata: {
        name: 'action',
        version: '1.0.0',
        displayName: 'Action',
        description: 'Action genre guidance',
        type: 'writing-standards'
      },
      rules: ['action.md'],
      examples: []
    }
  ];

  return {
    mockModules,
    discoverModulesMock: vi.fn(() => mockModules)
  };
});

vi.mock('@cli/utils/module-system', async () => {
  const actual = await vi.importActual<typeof import('@cli/utils/module-system')>('@cli/utils/module-system');

  return {
    ...actual,
    discoverModules: discoverModulesMock
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
    readdirSync: vi.fn()
  };
});

import { discoverModules } from '@cli/utils/module-system';
import { listCommand } from '../../../cli/src/commands/list';
import { searchCommand } from '../../../cli/src/commands/search';
import { showAllCommand } from '../../../cli/src/commands/show';

describe('module discovery routing', () => {
  beforeEach(() => {
    discoverModulesMock.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes list, show, and search through the shared discovery utility', async () => {
    await listCommand({ json: true });
    await showAllCommand({ json: true });
    await searchCommand('action', {});

    expect(discoverModules).toHaveBeenCalledTimes(3);
  });
});
