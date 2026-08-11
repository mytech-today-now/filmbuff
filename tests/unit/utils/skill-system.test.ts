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

import {
  SKILL_CATEGORIES,
  clearSkillCache,
  discoverSkills,
  findSkill,
  getSkillCacheStats,
  getSkillContentForInjection,
  getSkillPath,
  getSkillsDir,
  loadSkillDynamic,
  loadSkillsBatch,
  parseSkill,
  validateSkillMetadata
} from '@cli/utils/skill-system';

const mockRepoRoot = '/test/repo';
const mockSkillsDir = path.join(mockRepoRoot, 'skills');
const normalize = (value: fs.PathLike) => String(value).replace(/\\/g, '/');
const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);

function makeSkillContent(overrides: Record<string, string | number> = {}, body = '# Test Skill Content') {
  const metadata = {
    id: 'test-skill',
    name: 'Test Skill',
    version: '1.0.0',
    category: 'utility',
    tags: '[test]',
    tokenBudget: 1000,
    priority: 'medium',
    ...overrides
  };

  return `---\nid: ${metadata.id}\nname: ${metadata.name}\nversion: ${metadata.version}\ncategory: ${metadata.category}\ntags: ${metadata.tags}\ntokenBudget: ${metadata.tokenBudget}\npriority: ${metadata.priority}\n---\n\n${body}`;
}

describe('skill-system legacy compatibility', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockReaddirSync.mockReset();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('');
    mockReaddirSync.mockReturnValue([] as any);
    vi.restoreAllMocks();
    vi.spyOn(process, 'cwd').mockReturnValue(mockRepoRoot);
    clearSkillCache();
  });

  afterEach(() => {
    clearSkillCache();
    vi.restoreAllMocks();
  });

  describe('getSkillsDir', () => {
    it('returns the skills directory for an explicit repo root', () => {
      expect(getSkillsDir(mockRepoRoot)).toBe(mockSkillsDir);
    });

    it('falls back to process.cwd() when repoRoot is omitted', () => {
      expect(getSkillsDir()).toBe(path.join(mockRepoRoot, 'skills'));
    });
  });

  describe('getSkillPath', () => {
    it('builds a category-qualified skill path', () => {
      expect(getSkillPath('sdk-query', 'retrieval', mockRepoRoot))
        .toBe(path.join(mockSkillsDir, 'retrieval', 'sdk-query.md'));
    });
  });

  describe('parseSkill', () => {
    it('parses valid frontmatter and body content', () => {
      mockReadFileSync.mockReturnValue(makeSkillContent({ category: 'retrieval' }));

      const result = parseSkill('/test/skill.md');

      expect(result.metadata.id).toBe('test-skill');
      expect(result.metadata.category).toBe('retrieval');
      expect(result.metadata.tokenBudget).toBe(1000);
      expect(result.content).toContain('# Test Skill Content');
    });

    it('throws when frontmatter is missing', () => {
      mockReadFileSync.mockReturnValue('# Invalid Skill\n\nNo frontmatter here.');

      expect(() => parseSkill('/test/invalid.md')).toThrow(/Missing frontmatter/);
    });

    it('preserves structured YAML values in frontmatter', () => {
      mockReadFileSync.mockReturnValue(`---
id: structured-skill
name: Structured Skill
version: 1.2.3+build.5
category: analysis
tags:
  - alpha
  - beta
dependencies:
  - dep-one
  - dep-two
tokenBudget: 2500
priority: high
---

# Structured Skill
`);

      const result = parseSkill('/test/structured.md');

      expect(result.metadata.id).toBe('structured-skill');
      expect(result.metadata.tags).toEqual(['alpha', 'beta']);
      expect(result.metadata.dependencies).toEqual(['dep-one', 'dep-two']);
      expect(result.metadata.version).toBe('1.2.3+build.5');
    });
  });

  describe('validateSkillMetadata', () => {
    it('accepts valid metadata', () => {
      const result = validateSkillMetadata({
        id: 'test-skill',
        name: 'Test Skill',
        version: '1.0.0',
        category: 'retrieval',
        tags: ['test'],
        tokenBudget: 1000,
        priority: 'medium'
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('reports missing required fields', () => {
      const result = validateSkillMetadata({
        id: 'test-skill',
        tags: ['test'],
        tokenBudget: 1000
      } as any);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([
        'Missing required field: name',
        'Missing required field: version',
        'Missing required field: category'
      ]));
    });

    it('rejects invalid categories', () => {
      const result = validateSkillMetadata({
        id: 'test-skill',
        name: 'Test Skill',
        version: '1.0.0',
        category: 'invalid-category' as any,
        tokenBudget: 1000
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid category');
      expect(SKILL_CATEGORIES).toContain('retrieval');
    });

    it('rejects token budgets below the minimum', () => {
      const result = validateSkillMetadata({
        id: 'test-skill',
        name: 'Test Skill',
        version: '1.0.0',
        category: 'retrieval',
        tokenBudget: 100
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Token budget too low: minimum 500 tokens');
    });

    it('rejects invalid semantic versions', () => {
      const result = validateSkillMetadata({
        id: 'test-skill',
        name: 'Test Skill',
        version: 'version-one',
        category: 'retrieval',
        tokenBudget: 1000
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Invalid version format: version-one. Must follow semantic versioning (MAJOR.MINOR.PATCH)'
      );
    });
  });

  describe('discoverSkills', () => {
    it('discovers markdown skills across category directories', () => {
      const filesByCategory: Record<string, string[]> = {
        retrieval: ['sdk-query.md', 'context-retrieval.md'],
        analysis: ['code-analysis.md'],
        generation: ['add-mcp-skill.md']
      };

      mockExistsSync.mockImplementation((target) => {
        const current = normalize(target);
        if (current === normalize(mockSkillsDir)) {
          return true;
        }

        return Object.keys(filesByCategory)
          .some((category) => current === normalize(path.join(mockSkillsDir, category)));
      });

      mockReaddirSync.mockImplementation((target) => {
        const category = path.basename(String(target));
        return (filesByCategory[category] || []) as any;
      });

      mockReadFileSync.mockImplementation((target) => {
        const name = path.basename(String(target), '.md');
        const category = path.basename(path.dirname(String(target)));
        return makeSkillContent({ id: name, name, category });
      });

      const result = discoverSkills(mockRepoRoot);

      expect(result).toHaveLength(4);
      expect(result.map((skill) => skill.metadata.id)).toEqual(expect.arrayContaining([
        'sdk-query',
        'context-retrieval',
        'code-analysis',
        'add-mcp-skill'
      ]));
    });

    it('returns an empty array when the skills directory is missing', () => {
      mockExistsSync.mockReturnValue(false);

      expect(discoverSkills(mockRepoRoot)).toEqual([]);
    });
  });

  describe('findSkill', () => {
    it('finds a skill by ID', () => {
      mockExistsSync.mockImplementation((target) => {
        const current = normalize(target);
        return current === normalize(mockSkillsDir)
          || current === normalize(path.join(mockSkillsDir, 'retrieval'));
      });

      mockReaddirSync.mockReturnValue(['sdk-query.md'] as any);
      mockReadFileSync.mockReturnValue(makeSkillContent({
        id: 'sdk-query',
        name: 'SDK Query',
        category: 'retrieval',
        tokenBudget: 1800,
        priority: 'high',
        tags: '[sdk]'
      }, '# SDK Query Skill'));

      const result = findSkill('sdk-query', mockRepoRoot);

      expect(result).not.toBeNull();
      expect(result?.metadata.id).toBe('sdk-query');
      expect(result?.metadata.name).toBe('SDK Query');
    });

    it('returns null when no skill matches', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([] as any);

      expect(findSkill('non-existent-skill', mockRepoRoot)).toBeNull();
    });
  });

  describe('loadSkillDynamic', () => {
    it('loads a skill without dependencies', () => {
      mockExistsSync.mockImplementation((target) => {
        const current = normalize(target);
        return current === normalize(mockSkillsDir)
          || current === normalize(path.join(mockSkillsDir, 'utility'));
      });

      mockReaddirSync.mockReturnValue(['simple-skill.md'] as any);
      mockReadFileSync.mockReturnValue(makeSkillContent({
        id: 'simple-skill',
        name: 'Simple Skill',
        category: 'utility',
        tokenBudget: 500,
        priority: 'low',
        tags: '[simple]'
      }, '# Simple Skill'));

      const result = loadSkillDynamic('simple-skill', { cache: false });

      expect(result).not.toBeNull();
      expect(result?.skill.metadata.id).toBe('simple-skill');
      expect(result?.totalTokens).toBe(500);
      expect(result?.dependencies).toEqual([]);
    });

    it('returns cached results on subsequent loads', () => {
      mockExistsSync.mockImplementation((target) => {
        const current = normalize(target);
        return current === normalize(mockSkillsDir)
          || current === normalize(path.join(mockSkillsDir, 'utility'));
      });

      mockReaddirSync.mockReturnValue(['cached-skill.md'] as any);
      const readFileSpy = mockReadFileSync.mockReturnValue(makeSkillContent({
        id: 'cached-skill',
        name: 'Cached Skill',
        category: 'utility',
        tokenBudget: 500,
        priority: 'low',
        tags: '[cache]'
      }, '# Cached Skill'));

      const first = loadSkillDynamic('cached-skill', { cache: true });
      expect(first?.skill.metadata.id).toBe('cached-skill');

      readFileSpy.mockClear();

      const second = loadSkillDynamic('cached-skill', { cache: true });
      expect(second?.skill.metadata.id).toBe('cached-skill');
      expect(readFileSpy).not.toHaveBeenCalled();
    });

    it('returns null when the skill cannot be found', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([] as any);

      expect(loadSkillDynamic('non-existent', { cache: false })).toBeNull();
    });
  });

  describe('loadSkillsBatch', () => {
    it('loads multiple distinct skills', () => {
      mockExistsSync.mockImplementation((target) => {
        const current = normalize(target);
        return current === normalize(mockSkillsDir)
          || current === normalize(path.join(mockSkillsDir, 'utility'));
      });

      mockReaddirSync.mockReturnValue(['skill1.md', 'skill2.md'] as any);
      mockReadFileSync.mockImplementation((target) => {
        const id = path.basename(String(target), '.md');
        return makeSkillContent({
          id,
          name: id === 'skill1' ? 'Skill 1' : 'Skill 2',
          category: 'utility',
          tokenBudget: id === 'skill1' ? 500 : 600,
          priority: 'low'
        }, `# ${id === 'skill1' ? 'Skill 1' : 'Skill 2'}`);
      });

      const result = loadSkillsBatch(['skill1', 'skill2'], { cache: false });

      expect(result).toHaveLength(2);
      expect(result.map((entry) => entry.skill.metadata.id)).toEqual(['skill1', 'skill2']);
    });

    it('skips duplicate skill IDs in the same batch', () => {
      mockExistsSync.mockImplementation((target) => {
        const current = normalize(target);
        return current === normalize(mockSkillsDir)
          || current === normalize(path.join(mockSkillsDir, 'utility'));
      });

      mockReaddirSync.mockReturnValue(['duplicate-skill.md'] as any);
      mockReadFileSync.mockReturnValue(makeSkillContent({
        id: 'duplicate-skill',
        name: 'Duplicate Skill',
        category: 'utility',
        tokenBudget: 500,
        priority: 'low'
      }, '# Duplicate Skill'));

      const result = loadSkillsBatch(['duplicate-skill', 'duplicate-skill'], { cache: false });

      expect(result).toHaveLength(1);
      expect(result[0].skill.metadata.id).toBe('duplicate-skill');
    });
  });

  describe('getSkillContentForInjection', () => {
    it('formats skill content with metadata headers', () => {
      const result = getSkillContentForInjection({
        skill: {
          metadata: {
            id: 'test-skill',
            name: 'Test Skill',
            version: '1.0.0',
            category: 'utility',
            tokenBudget: 500,
            priority: 'low'
          },
          content: '# Test Skill Content',
          filePath: '/test/skill.md'
        },
        dependencies: [],
        totalTokens: 500
      });

      expect(result).toContain('# Skill: Test Skill (test-skill)');
      expect(result).toContain('# Test Skill Content');
    });
  });

  describe('cache helpers', () => {
    it('clearSkillCache empties the cache', () => {
      mockExistsSync.mockImplementation((target) => {
        const current = normalize(target);
        return current === normalize(mockSkillsDir)
          || current === normalize(path.join(mockSkillsDir, 'utility'));
      });

      mockReaddirSync.mockReturnValue(['cached-skill.md'] as any);
      mockReadFileSync.mockReturnValue(makeSkillContent({
        id: 'cached-skill',
        name: 'Cached Skill',
        category: 'utility',
        tokenBudget: 500,
        priority: 'low'
      }, '# Cached Skill'));

      loadSkillDynamic('cached-skill', { cache: true });
      clearSkillCache();

      expect(getSkillCacheStats().size).toBe(0);
    });

    it('getSkillCacheStats reports cache size and keys', () => {
      expect(getSkillCacheStats()).toEqual({ size: 0, skills: [] });
    });
  });

  describe('edge cases', () => {
    it('keeps dependency content depth-first when injecting skill content', () => {
      const result = getSkillContentForInjection({
        skill: {
          metadata: {
            id: 'main-skill',
            name: 'Main Skill',
            version: '1.0.0',
            category: 'utility',
            tokenBudget: 500
          },
          content: 'main body',
          filePath: '/test/main.md'
        },
        dependencies: [
          {
            skill: {
              metadata: {
                id: 'dep-skill',
                name: 'Dependency Skill',
                version: '1.0.0',
                category: 'utility',
                tokenBudget: 500
              },
              content: 'dep body',
              filePath: '/test/dep.md'
            },
            dependencies: [],
            totalTokens: 500
          }
        ],
        totalTokens: 1000
      });

      expect(result.indexOf('dep body')).toBeLessThan(result.indexOf('main body'));
    });

    it('handles empty skill content without throwing', () => {
      const result = getSkillContentForInjection({
        skill: {
          metadata: {
            id: 'empty-skill',
            name: 'Empty Skill',
            version: '1.0.0',
            category: 'utility',
            tokenBudget: 500
          },
          content: '',
          filePath: '/test/empty.md'
        },
        dependencies: [],
        totalTokens: 500
      });

      expect(result).toContain('# Skill: Empty Skill (empty-skill)');
      expect(result).toContain('Token Budget: 500');
    });
  });
});

