import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'fs/promises';
import { TestEnvironment } from '../../helpers/test-env';
import { linkCommand } from '../../../cli/src/commands/link';

vi.mock('chalk', () => {
  const passthrough = (value: string) => value;

  return {
    default: {
      blue: passthrough,
      green: passthrough,
      red: passthrough,
      gray: passthrough,
      yellow: passthrough,
      cyan: passthrough,
      bold: passthrough
    },
    blue: passthrough,
    green: passthrough,
    red: passthrough,
    gray: passthrough,
    yellow: passthrough,
    cyan: passthrough,
    bold: passthrough
  };
});

type Manifest = {
  version: string;
  modules: Array<{
    name: string;
    version: string;
    type: string;
    description: string;
  }>;
};

async function readManifest(configPath: string): Promise<{ raw: string; data: Manifest }> {
  const raw = await readFile(configPath, 'utf-8');
  return {
    raw,
    data: JSON.parse(raw) as Manifest
  };
}

describe('linkCommand canonical id handling', () => {
  let testEnv: TestEnvironment;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testEnv.cleanup();
  });

  it('keeps alias links idempotent and preserves existing metadata', async () => {
    const project = await testEnv.createProject({ name: 'alias-link-project' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as any);
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(project.path);

    await linkCommand('screenplay', { version: '9.9.9' });

    const initialManifest = await readManifest(project.configPath);

    expect(initialManifest.data.modules).toHaveLength(1);
    expect(initialManifest.data.modules[0].name).toBe('writing-standards/screenplay');
    expect(initialManifest.data.modules[0].version).toBe('9.9.9');
    expect(initialManifest.data.modules[0].description).toBeTruthy();

    await linkCommand('screenplay', {});

    const finalManifest = await readManifest(project.configPath);

    expect(finalManifest.raw).toBe(initialManifest.raw);
    expect(finalManifest.data.modules).toEqual(initialManifest.data.modules);
    expect(finalManifest.data.modules[0].version).toBe('9.9.9');
    expect(finalManifest.data.modules[0].description).toBe(initialManifest.data.modules[0].description);
    expect(logSpy.mock.calls.some(([message]) => String(message).includes('Module already linked: writing-standards/screenplay'))).toBe(true);
    expect(logSpy.mock.calls.some(([message]) => String(message).includes('Use "filmbuff update" to update to latest version'))).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(cwdSpy).toHaveBeenCalled();
  });

  it('keeps the manifest at one record when linked again by canonical name', async () => {
    const project = await testEnv.createProject({ name: 'canonical-link-project' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as any);
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(project.path);

    await linkCommand('screenplay', {});

    const initialManifest = await readManifest(project.configPath);

    await linkCommand('writing-standards/screenplay', {});

    const finalManifest = await readManifest(project.configPath);

    expect(initialManifest.data.modules).toHaveLength(1);
    expect(finalManifest.data.modules).toHaveLength(1);
    expect(finalManifest.raw).toBe(initialManifest.raw);
    expect(finalManifest.data.modules[0]).toEqual(initialManifest.data.modules[0]);
    expect(logSpy.mock.calls.some(([message]) => String(message).includes('Module already linked: writing-standards/screenplay'))).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(cwdSpy).toHaveBeenCalled();
  });

  it('appends an unrelated module without disturbing existing linked records', async () => {
    const project = await testEnv.createProject({ name: 'unrelated-link-project' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as any);
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(project.path);

    await linkCommand('screenplay', {});

    const initialManifest = await readManifest(project.configPath);

    await linkCommand('workflows/beads', {});

    const finalManifest = await readManifest(project.configPath);

    expect(initialManifest.data.modules).toHaveLength(1);
    expect(finalManifest.data.modules).toHaveLength(2);
    expect(finalManifest.data.modules[0]).toEqual(initialManifest.data.modules[0]);
    expect(finalManifest.data.modules[0].name).toBe('writing-standards/screenplay');
    expect(finalManifest.data.modules[1].name).toBe('workflows/beads');
    expect(logSpy.mock.calls.some(([message]) => String(message).includes('Linked workflows/beads'))).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(cwdSpy).toHaveBeenCalled();
  });
});
