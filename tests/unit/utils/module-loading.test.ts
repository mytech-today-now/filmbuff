import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn()
  };
});

import { discoverCollections, discoverModules, loadModule } from '@cli/utils/module-system';

const normalize = (value: fs.PathLike) => String(value).replace(/\\/g, '/');
const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);

function mockModuleFilesystem(modulePath: string, ruleFiles: string[], exampleFiles: string[]) {
  const moduleJsonPath = path.join(modulePath, 'module.json');
  const rulesDir = path.join(modulePath, 'rules');
  const examplesDir = path.join(modulePath, 'examples');
  const metadata = {
    name: 'html-standards',
    version: '1.0.0',
    displayName: 'HTML Standards',
    description: 'HTML coding standards',
    type: 'coding-standards',
    augment: { subModules: [] }
  };

  mockExistsSync.mockImplementation((target) => {
    const current = normalize(target);
    return current === normalize(moduleJsonPath)
      || current === normalize(rulesDir)
      || current === normalize(examplesDir);
  });

  mockReadFileSync.mockImplementation((target) => {
    if (normalize(target) === normalize(moduleJsonPath)) {
      return JSON.stringify(metadata);
    }

    return '';
  });

  mockReaddirSync.mockImplementation((target, options?: any) => {
    const current = normalize(target);

    if (current === normalize(rulesDir)) {
      return ruleFiles as any;
    }

    if (current === normalize(examplesDir)) {
      return exampleFiles as any;
    }

    if (current === normalize(modulePath) && options?.withFileTypes) {
      return [] as any;
    }

    return [] as any;
  });
}

describe('module-system legacy compatibility', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockReaddirSync.mockReset();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('');
    mockReaddirSync.mockReturnValue([] as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('loadModule', () => {
    it('loads rules and examples from a valid module', () => {
      const modulePath = '/virtual/coding-standards/html';
      mockModuleFilesystem(modulePath, ['html-standards.md'], ['html-examples.html']);

      const module = loadModule(modulePath);

      expect(module).not.toBeNull();
      expect(module?.metadata.name).toBe('html-standards');
      expect(module?.metadata.type).toBe('coding-standards');
      expect(module?.rules).toEqual(['html-standards.md']);
      expect(module?.examples).toEqual(['html-examples.html']);
      expect(module?.subModules).toEqual([]);
    });

    it('returns null when module.json is missing', () => {
      mockExistsSync.mockReturnValue(false);

      expect(loadModule('/virtual/missing/module')).toBeNull();
    });

    it('falls back to empty rules and examples when optional directories are absent', () => {
      const modulePath = '/virtual/coding-standards/minimal';
      const moduleJsonPath = path.join(modulePath, 'module.json');

      mockExistsSync.mockImplementation((target) =>
        normalize(target) === normalize(moduleJsonPath));

      mockReadFileSync.mockImplementation((target) => {
        if (normalize(target) === normalize(moduleJsonPath)) {
          return JSON.stringify({
            name: 'minimal-module',
            version: '1.0.0',
            displayName: 'Minimal Module',
            description: 'A minimal module',
            type: 'coding-standards',
            augment: { subModules: [] }
          });
        }

        return '';
      });

      mockReaddirSync.mockImplementation(() => [] as any);

      const module = loadModule(modulePath);

      expect(module).not.toBeNull();
      expect(module?.rules).toEqual([]);
      expect(module?.examples).toEqual([]);
    });
  });

  describe('discoverCollections', () => {
    it('discovers collections from the collections directory', () => {
      mockExistsSync.mockImplementation((target) => {
        const current = normalize(target);
        return current.endsWith('/collections')
          || current.endsWith('/collections/html-css-js/collection.json');
      });

      mockReaddirSync.mockImplementation((target, options?: any) => {
        const current = normalize(target);
        if (current.endsWith('/collections') && options?.withFileTypes) {
          return [{ name: 'html-css-js', isDirectory: () => true }] as any;
        }

        return [] as any;
      });

      mockReadFileSync.mockImplementation((target) => {
        if (normalize(target).endsWith('/collections/html-css-js/collection.json')) {
          return JSON.stringify({
            name: 'html-css-js',
            version: '1.0.0',
            displayName: 'HTML, CSS, and JavaScript',
            description: 'Complete web development standards',
            type: 'collection',
            modules: [
              { id: 'coding-standards/html', version: '1.0.0', required: true },
              { id: 'coding-standards/css', version: '1.0.0', required: true },
              { id: 'coding-standards/js', version: '1.0.0', required: true }
            ]
          });
        }

        return '';
      });

      const collections = discoverCollections();

      expect(collections).toHaveLength(1);
      expect(collections[0].metadata.name).toBe('html-css-js');
      expect(collections[0].metadata.modules).toHaveLength(3);
      expect(collections[0].fullName).toBe('collections/html-css-js');
    });

    it('returns an empty array when no collections directory exists', () => {
      mockExistsSync.mockReturnValue(false);

      expect(discoverCollections()).toEqual([]);
    });
  });

  describe('discoverModules', () => {
    it('discovers modules and filters out collection directories', () => {
      mockExistsSync.mockImplementation((target) => {
        const current = normalize(target);
        return current.includes('filmbuff');
      });

      mockReadFileSync.mockImplementation((target) => {
        if (normalize(target).endsWith('/coding-standards/html/module.json')) {
          return JSON.stringify({
            name: 'html-standards',
            version: '1.0.0',
            displayName: 'HTML Standards',
            description: 'HTML coding standards',
            type: 'coding-standards',
            augment: { subModules: [] }
          });
        }

        return '';
      });

      mockReaddirSync.mockImplementation((target, options?: any) => {
        const current = normalize(target);
        if (!options?.withFileTypes) {
          return [] as any;
        }

        if (current.endsWith('/filmbuff')) {
          return [
            { name: 'coding-standards', isDirectory: () => true, isFile: () => false },
            { name: 'collections', isDirectory: () => true, isFile: () => false }
          ] as any;
        }

        if (current.endsWith('/filmbuff/coding-standards')) {
          return [{ name: 'html', isDirectory: () => true, isFile: () => false }] as any;
        }

        if (current.endsWith('/filmbuff/coding-standards/html')) {
          return [{ name: 'module.json', isDirectory: () => false, isFile: () => true }] as any;
        }

        if (current.endsWith('/filmbuff/collections')) {
          return [{ name: 'starter-kit', isDirectory: () => true, isFile: () => false }] as any;
        }

        if (current.endsWith('/filmbuff/collections/starter-kit')) {
          return [{ name: 'module.json', isDirectory: () => false, isFile: () => true }] as any;
        }

        return [] as any;
      });

      const modules = discoverModules();

      expect(modules).toHaveLength(1);
      expect(modules[0].metadata.name).toBe('html-standards');
      expect(modules[0].metadata.type).toBe('coding-standards');
    });
  });
});

