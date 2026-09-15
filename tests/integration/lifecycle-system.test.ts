import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { registerLifecycleCommands } from '../../cli/src/commands/lifecycle';
import {
  createLifecycleArtifactSeed,
  loadLifecycleArtifact,
  saveLifecycleArtifact,
  validateLifecycleArtifact,
  LIFECYCLE_APPLICATION_IDENTIFIER
} from '../../cli/src/lib/lifecycle-artifact';
import {
  createZipArchiveFromDirectory,
  extractZipArchiveSafely,
  verifyArchiveChecksum
} from '../../cli/src/lib/lifecycle-archive';
import {
  createWorkspaceBackup,
  runLifecycleDiagnostics,
  runLifecycleRollback,
  runLifecycleUninstall,
  runWorkspaceInstallWithBackup
} from '../../cli/src/lib/lifecycle-manager';

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filmbuff-lifecycle-'));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

describe('lifecycle system', () => {
  it('registers the lifecycle command family', () => {
    const program = new Command();
    const lifecycleCmd = registerLifecycleCommands(program);
    const names = lifecycleCmd.commands.map((command) => command.name());

    expect(names).toEqual(
      expect.arrayContaining([
        'status',
        'install',
        'reinstall',
        'upgrade',
        'diagnose',
        'recover',
        'repair',
        'rollback',
        'uninstall'
      ])
    );
  });

  it('round-trips lifecycle artifacts and detects identity mismatches', () => {
    const cwd = createTempWorkspace();

    try {
      const seed = createLifecycleArtifactSeed({ cwd });
      const saved = saveLifecycleArtifact(
        {
          ...seed,
          state: {
            ...seed.state,
            current: 'installation-completed',
            detected: true,
            installed: true,
            rollbackAvailable: false,
            diagnosticAvailable: true,
            recoveryRequired: false,
            lastOperation: 'install'
          },
          result: {
            status: 'success',
            summary: 'Workspace installed successfully.'
          }
        },
        cwd
      );

      const loaded = loadLifecycleArtifact(cwd);
      expect(loaded).not.toBeNull();
      expect(loaded?.application.identifier).toBe(LIFECYCLE_APPLICATION_IDENTIFIER);
      expect(loaded?.state.current).toBe('installation-completed');
      expect(validateLifecycleArtifact(loaded).valid).toBe(true);
      expect(fs.existsSync(path.join(cwd, '.augment', 'lifecycle', 'lifecycle-artifact.json'))).toBe(true);

      const invalid = validateLifecycleArtifact({
        ...saved,
        application: {
          ...saved.application,
          identifier: 'other-application'
        }
      });

      expect(invalid.valid).toBe(false);
      expect(invalid.errors.some((error) => error.includes('Artifact identity mismatch'))).toBe(true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('creates zip archives and rejects path traversal on extraction', async () => {
    const cwd = createTempWorkspace();

    try {
      const sourceDir = path.join(cwd, 'source');
      fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'nested', 'hello.txt'), 'hello world', 'utf-8');
      fs.writeFileSync(path.join(sourceDir, 'root.txt'), 'root file', 'utf-8');

      const archivePath = path.join(cwd, 'backup.zip');
      const buildResult = await createZipArchiveFromDirectory(sourceDir, archivePath);

      expect(buildResult.entryCount).toBe(2);
      expect(await verifyArchiveChecksum(archivePath, buildResult.checksum)).toBe(true);

      const restoreDir = path.join(cwd, 'restore');
      const extractionResult = await extractZipArchiveSafely(archivePath, restoreDir);

      expect(extractionResult.entryCount).toBe(2);
      expect(fs.readFileSync(path.join(restoreDir, 'nested', 'hello.txt'), 'utf-8')).toBe('hello world');
      expect(fs.readFileSync(path.join(restoreDir, 'root.txt'), 'utf-8')).toBe('root file');

      const JSZip = require('jszip') as any;
      const maliciousZip = new JSZip();
      maliciousZip.file('C:/evil.txt', 'oops');

      const maliciousPath = path.join(cwd, 'malicious.zip');
      fs.writeFileSync(
        maliciousPath,
        await maliciousZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
      );

      await expect(
        extractZipArchiveSafely(maliciousPath, path.join(cwd, 'malicious-out'))
      ).rejects.toThrow(/outside the destination root|unsafe archive path rejected/i);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('keeps install and uninstall dry-runs side-effect free', async () => {
    const cwd = createTempWorkspace();

    try {
      fs.mkdirSync(path.join(cwd, '.augment'), { recursive: true });
      writeJson(path.join(cwd, '.augment', 'extensions.json'), {
        version: '0.1.0',
        modules: [],
        settings: {
          autoUpdate: false,
          checkUpdatesOnInit: true
        }
      });
      fs.writeFileSync(path.join(cwd, 'AGENTS.md'), '# Existing guidance\n', 'utf-8');
      fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules\n', 'utf-8');
      fs.mkdirSync(path.join(cwd, 'ai-prompts'), { recursive: true });
      fs.writeFileSync(path.join(cwd, 'ai-prompts', 'sample.txt'), 'sample prompt', 'utf-8');

      const installResult = await runWorkspaceInstallWithBackup({
        cwd,
        dryRun: true,
        mode: 'fresh'
      });

      expect(installResult.status).toBe('dry-run');
      expect(fs.existsSync(path.join(cwd, '.augment', 'lifecycle', 'lifecycle-artifact.json'))).toBe(false);
      expect(fs.existsSync(path.join(cwd, '.augment', 'lifecycle', 'backups'))).toBe(false);

      const uninstallResult = await runLifecycleUninstall({
        cwd,
        dryRun: true,
        confirm: false,
        removeData: true
      });

      expect(uninstallResult.status).toBe('dry-run');
      expect(fs.existsSync(path.join(cwd, '.augment', 'extensions.json'))).toBe(true);
      expect(fs.existsSync(path.join(cwd, 'AGENTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(true);
      expect(fs.existsSync(path.join(cwd, 'ai-prompts', 'sample.txt'))).toBe(true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('reports diagnostics for a workspace missing its lifecycle artifact', async () => {
    const cwd = createTempWorkspace();

    try {
      fs.mkdirSync(path.join(cwd, '.augment'), { recursive: true });
      writeJson(path.join(cwd, '.augment', 'extensions.json'), {
        version: '0.1.0',
        modules: []
      });

      const result = await runLifecycleDiagnostics({ cwd });

      expect(result.status).toBe('partial');
      expect(result.snapshot.hasExtensionsConfig).toBe(true);
      expect(result.findings.some((finding) => finding.id === 'invalid-lifecycle-artifact')).toBe(true);
      expect(result.findings.some((finding) => finding.id === 'rollback-unavailable')).toBe(true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('restores a deleted workspace file from the latest verified backup', async () => {
    const cwd = createTempWorkspace();

    try {
      fs.mkdirSync(path.join(cwd, '.augment'), { recursive: true });
      writeJson(path.join(cwd, '.augment', 'extensions.json'), {
        version: '0.1.0',
        modules: []
      });
      fs.writeFileSync(path.join(cwd, 'AGENTS.md'), '# Existing guidance\n', 'utf-8');
      fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules\n', 'utf-8');

      const backup = await createWorkspaceBackup({ cwd, kind: 'manual' });
      const seed = createLifecycleArtifactSeed({
        cwd,
        state: 'installation-completed',
        detected: true,
        installed: true,
        rollbackAvailable: true,
        diagnosticAvailable: true,
        recoveryRequired: false
      });

      saveLifecycleArtifact(
        {
          ...seed,
          state: {
            ...seed.state,
            current: 'installation-completed',
            detected: true,
            installed: true,
            rollbackAvailable: true,
            diagnosticAvailable: true,
            recoveryRequired: false,
            lastOperation: 'install'
          },
          result: {
            status: 'success',
            summary: 'Workspace ready for rollback.'
          },
          backups: [backup.backup]
        },
        cwd
      );

      fs.unlinkSync(path.join(cwd, 'AGENTS.md'));
      expect(fs.existsSync(path.join(cwd, 'AGENTS.md'))).toBe(false);

      const rollbackResult = await runLifecycleRollback({ cwd });

      expect(rollbackResult.status).toBe('success');
      expect(fs.existsSync(path.join(cwd, 'AGENTS.md'))).toBe(true);
      expect(fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf-8')).toContain('Existing guidance');
      expect(rollbackResult.steps.some((step) => step.includes('Restored'))).toBe(true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
