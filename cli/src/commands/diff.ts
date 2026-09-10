import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  findModuleEnhanced,
  isValidSemanticVersion
} from '../utils/module-system';

interface GitResult {
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
}

const GIT_MAX_BUFFER = 10 * 1024 * 1024;

function runGit(args: string[], cwd: string): GitResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: GIT_MAX_BUFFER
  });

  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    status: result.status,
    error: result.error ?? undefined
  };
}

function getGitRoot(startDir: string): string | null {
  const result = runGit(['rev-parse', '--show-toplevel'], startDir);

  if (result.error || result.status !== 0) {
    return null;
  }

  const root = result.stdout.trim();
  return root.length > 0 ? root : null;
}

function hasGitHead(repoRoot: string): boolean {
  const result = runGit(['rev-parse', '--verify', 'HEAD'], repoRoot);
  return result.status === 0;
}

function isInsideDirectory(parentDir: string, targetPath: string): boolean {
  const relative = path.relative(parentDir, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeOutput(value: string): string {
  return value.replace(/\r\n/g, '\n').trimEnd();
}

function formatUnsupported(moduleName: string, reason: string): string {
  return `Module diff is unsupported for ${moduleName}: ${reason}`;
}

function buildDiffOutput(modulePath: string, repoRoot: string): { output: string; error: string | null } {
  const relativeModulePath = path.relative(repoRoot, modulePath).replace(/\\/g, '/');

  if (!isInsideDirectory(repoRoot, modulePath)) {
    return {
      output: '',
      error: 'module path is outside the git repository root'
    };
  }

  const parts: string[] = [];

  // Compare the current working tree against HEAD so staged and unstaged changes
  // are both visible in a single deterministic diff.
  const trackedDiff = runGit(
    ['diff', '--no-color', '--no-ext-diff', '--ignore-cr-at-eol', '--unified=3', 'HEAD', '--', relativeModulePath],
    repoRoot
  );

  if (trackedDiff.error || (trackedDiff.status !== 0 && trackedDiff.status !== 1)) {
    return {
      output: '',
      error: trackedDiff.stderr.trim() || trackedDiff.error?.message || 'failed to read git diff'
    };
  }

  const normalizedTracked = normalizeOutput(trackedDiff.stdout);
  if (normalizedTracked.length > 0) {
    parts.push(normalizedTracked);
  }

  const untrackedResult = runGit(
    ['ls-files', '--others', '--exclude-standard', '--', relativeModulePath],
    repoRoot
  );

  if (untrackedResult.error || untrackedResult.status !== 0) {
    return {
      output: '',
      error: untrackedResult.stderr.trim() || untrackedResult.error?.message || 'failed to inspect untracked files'
    };
  }

  const untrackedFiles = untrackedResult.stdout
    .split(/\r?\n/)
    .map(entry => entry.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  for (const filePath of untrackedFiles) {
    const fileDiff = runGit(
      ['diff', '--no-index', '--no-color', '--no-ext-diff', '--ignore-cr-at-eol', '--unified=3', '--', '/dev/null', filePath],
      repoRoot
    );

    if (fileDiff.error || (fileDiff.status !== 0 && fileDiff.status !== 1)) {
      return {
        output: '',
        error: fileDiff.stderr.trim() || fileDiff.error?.message || `failed to diff untracked file: ${filePath}`
      };
    }

    const normalizedFileDiff = normalizeOutput(fileDiff.stdout);
    if (normalizedFileDiff.length > 0) {
      parts.push(normalizedFileDiff);
    }
  }

  return {
    output: parts.join('\n'),
    error: null
  };
}

export async function diffCommand(moduleName: string): Promise<void> {
  try {
    const module = findModuleEnhanced(moduleName);

    if (!module) {
      console.error(`Module not found: ${moduleName}`);
      console.error('Use "filmbuff list" to see available modules.');
      process.exit(1);
    }

    const version = module.metadata.version?.trim();
    if (!version || !isValidSemanticVersion(version)) {
      console.error(
        formatUnsupported(
          module.fullName,
          'module.json is missing a valid semantic version'
        )
      );
      process.exit(1);
    }

    const repoRoot = getGitRoot(module.path);
    if (!repoRoot) {
      console.error(
        formatUnsupported(
          module.fullName,
          'no git repository was found'
        )
      );
      process.exit(1);
    }

    if (!hasGitHead(repoRoot)) {
      console.error(
        formatUnsupported(
          module.fullName,
          'the repository has no committed HEAD baseline'
        )
      );
      process.exit(1);
    }

    const diff = buildDiffOutput(module.path, repoRoot);
    if (diff.error) {
      console.error(formatUnsupported(module.fullName, diff.error));
      process.exit(1);
    }

    console.log(`Module diff: ${module.fullName}`);
    console.log(`Version: ${version}`);
    console.log('Compared against: git HEAD');

    if (!diff.output.trim()) {
      console.log(`No differences found for ${module.fullName}.`);
      return;
    }

    console.log();
    console.log(diff.output);
  } catch (error) {
    console.error(`Error diffing module: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
