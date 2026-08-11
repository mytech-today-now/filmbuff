import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractFrontmatter } from '@cli/utils/openspec-sync';
import { parseSkill } from '@cli/utils/skill-system';

describe('frontmatter parsing boundaries', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filmbuff-frontmatter-'));
  });

  afterEach(async () => {
    if (tempDir && fsSync.existsSync(tempDir)) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('parses structured YAML content from both skill and OpenSpec files', async () => {
    const skillPath = path.join(tempDir, 'skill.md');
    const specPath = path.join(tempDir, 'spec.md');

    await fs.writeFile(skillPath, `---\nid: boundary-skill\nname: Boundary Skill\nversion: 1.2.3+build.4\ncategory: utility\ntags:\n  - alpha\n  - beta\ntokenBudget: 1500\npriority: medium\n---\n\n# Boundary Skill\n`, 'utf-8');
    await fs.writeFile(specPath, `---\nid: boundary/spec\nstatus: active\nrelatedTasks:\n  - bd-123\nrelatedRules:\n  - rules/frontmatter.md\naffectedFiles:\n  - src/index.ts\n  - src/utils.ts\ndependencies:\n  - dep/a\n---\n\n# Boundary Spec\n`, 'utf-8');

    const skill = parseSkill(skillPath);
    const frontmatter = extractFrontmatter(specPath);

    expect(skill.metadata.id).toBe('boundary-skill');
    expect(skill.metadata.tags).toEqual(['alpha', 'beta']);
    expect(skill.metadata.version).toBe('1.2.3+build.4');
    expect(frontmatter).not.toBeNull();
    expect(frontmatter?.relatedTasks).toEqual(['bd-123']);
    expect(frontmatter?.affectedFiles).toEqual(['src/index.ts', 'src/utils.ts']);
  });

  it('returns null when frontmatter is missing or malformed', async () => {
    const missingPath = path.join(tempDir, 'missing.md');
    const malformedPath = path.join(tempDir, 'malformed.md');

    await fs.writeFile(missingPath, '# Missing frontmatter\n', 'utf-8');
    await fs.writeFile(malformedPath, `---\nid: broken\nname: Broken\nversion: 1.0.0\ncategory: utility\n# missing closing delimiter`, 'utf-8');

    expect(extractFrontmatter(missingPath)).toBeNull();
    expect(extractFrontmatter(malformedPath)).toBeNull();
    expect(() => parseSkill(missingPath)).toThrow(/Missing frontmatter/);
  });
});
