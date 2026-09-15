import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';

import { extractCommandHelp } from '../utils/extractCommandHelp';
import { installCharacterCountRule } from '../utils/install-rules';
import {
  createLifecycleArtifactSeed,
  loadLifecycleArtifact,
  resolveLifecyclePaths,
  saveLifecycleArtifact,
  updateLifecycleState,
  type LifecycleArtifact,
  type LifecycleState
} from './lifecycle-artifact';

export interface WorkspaceInstallOptions {
  cwd?: string;
  overwriteExisting?: boolean;
  includeBeads?: boolean;
  dryRun?: boolean;
  mode?: 'fresh' | 'reinstall' | 'upgrade';
  packageVersion?: string;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

export interface WorkspaceInstallStepResult {
  id: string;
  label: string;
  status: 'completed' | 'skipped' | 'warning' | 'failed';
  details?: string;
}

export interface WorkspaceInstallResult {
  status: 'success' | 'partial' | 'failure' | 'dry-run';
  state: LifecycleState;
  artifact: LifecycleArtifact;
  artifactPath: string;
  createdFiles: string[];
  updatedFiles: string[];
  skippedFiles: string[];
  warnings: string[];
  errors: string[];
  steps: WorkspaceInstallStepResult[];
}

const DEFAULT_LOG = (message: string) => console.log(message);
const DEFAULT_WARN = (message: string) => console.warn(message);
const DEFAULT_ERROR = (message: string) => console.error(message);

function cloneArray(values: string[] | undefined): string[] | undefined {
  return values ? [...values] : undefined;
}

function readJsonIfExists(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mergeExtensionsConfig(existing: Record<string, unknown> | null): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    version: '0.1.0',
    modules: [],
    settings: {
      autoUpdate: false,
      checkUpdatesOnInit: true
    }
  };

  if (existing && typeof existing === 'object') {
    Object.assign(merged, existing);
    if (!Array.isArray(merged.modules)) {
      merged.modules = [];
    }
    if (!merged.settings || typeof merged.settings !== 'object') {
      merged.settings = {
        autoUpdate: false,
        checkUpdatesOnInit: true
      };
    }
  }

  return merged;
}

function ensureDirectory(dirPath: string, dryRun: boolean, steps: WorkspaceInstallStepResult[], label: string): void {
  if (fs.existsSync(dirPath)) {
    steps.push({ id: `ensure-${label}`, label, status: 'skipped', details: 'Already exists' });
    return;
  }

  if (dryRun) {
    steps.push({ id: `ensure-${label}`, label, status: 'skipped', details: 'Would create directory' });
    return;
  }

  fs.mkdirSync(dirPath, { recursive: true });
  steps.push({ id: `ensure-${label}`, label, status: 'completed', details: 'Directory created' });
}

function writeFileAtomic(filePath: string, content: string, dryRun: boolean): void {
  if (dryRun) {
    return;
  }

  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, filePath);
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Best effort only.
    }
  }
}

function updateTextFile(
  filePath: string,
  content: string,
  dryRun: boolean,
  createdFiles: string[],
  updatedFiles: string[],
  skippedFiles: string[],
  steps: WorkspaceInstallStepResult[],
  label: string
): void {
  const exists = fs.existsSync(filePath);
  const current = exists ? fs.readFileSync(filePath, 'utf-8') : null;

  if (current !== null && current.trim() === content.trim()) {
    skippedFiles.push(filePath);
    steps.push({ id: label, label, status: 'skipped', details: 'Already up to date' });
    return;
  }

  if (dryRun) {
    steps.push({
      id: label,
      label,
      status: 'skipped',
      details: exists ? 'Would update file' : 'Would create file'
    });
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileAtomic(filePath, content, dryRun);

  if (exists) {
    updatedFiles.push(filePath);
  } else {
    createdFiles.push(filePath);
  }

  steps.push({
    id: label,
    label,
    status: 'completed',
    details: exists ? 'File updated' : 'File created'
  });
}

async function updateCommandHelp(
  cwd: string,
  dryRun: boolean,
  createdFiles: string[],
  updatedFiles: string[],
  skippedFiles: string[],
  steps: WorkspaceInstallStepResult[]
): Promise<void> {
  const helpPath = path.join(cwd, '.augment', 'COMMAND_HELP.md');
  const existedBefore = fs.existsSync(helpPath);

  if (dryRun) {
    steps.push({ id: 'command-help', label: 'Generate command help', status: 'skipped', details: 'Would generate command help' });
    return;
  }

  const help = await extractCommandHelp(cwd, '.augment/COMMAND_HELP.md');
  if (!help) {
    steps.push({
      id: 'command-help',
      label: 'Generate command help',
      status: 'warning',
      details: 'No workflow tools were detected'
    });
    return;
  }

  if (existedBefore) {
    updatedFiles.push(helpPath);
  } else {
    createdFiles.push(helpPath);
  }

  steps.push({
    id: 'command-help',
    label: 'Generate command help',
    status: 'completed',
    details: 'Command help reference generated'
  });
}

function updateGitignore(cwd: string, dryRun: boolean, steps: WorkspaceInstallStepResult[], createdFiles: string[], updatedFiles: string[], skippedFiles: string[]): void {
  const gitignorePath = path.join(cwd, '.gitignore');
  const entry = '\n# Filmbuff\n.augment/extensions.json\n';

  if (!fs.existsSync(gitignorePath)) {
    if (!dryRun) {
      fs.writeFileSync(gitignorePath, entry.trimStart(), 'utf-8');
      createdFiles.push(gitignorePath);
    }
    steps.push({ id: 'gitignore', label: 'Update .gitignore', status: dryRun ? 'skipped' : 'completed', details: 'Created .gitignore entry' });
    return;
  }

  const existing = fs.readFileSync(gitignorePath, 'utf-8');
  if (existing.includes('.augment/extensions.json')) {
    skippedFiles.push(gitignorePath);
    steps.push({ id: 'gitignore', label: 'Update .gitignore', status: 'skipped', details: 'Entry already present' });
    return;
  }

  if (!dryRun) {
    fs.appendFileSync(gitignorePath, entry, 'utf-8');
    updatedFiles.push(gitignorePath);
  }

  steps.push({ id: 'gitignore', label: 'Update .gitignore', status: dryRun ? 'skipped' : 'completed', details: 'Added Filmbuff ignore entry' });
}

function updateAgentsFile(cwd: string, dryRun: boolean, steps: WorkspaceInstallStepResult[], createdFiles: string[], updatedFiles: string[], skippedFiles: string[]): void {
  const agentsPath = path.join(cwd, 'AGENTS.md');
  const agentsContent = `# Filmbuff Integration

This project uses Filmbuff for additional AI coding guidelines.

## For AI Agents

Use the \`filmbuff\` CLI to discover and apply extension modules:

\`\`\`bash
# List linked modules
filmbuff list --linked

# Show module details
filmbuff show <module-name>

# Search for modules
filmbuff search <keyword>
\`\`\`

## Linked Modules

Check \`.augment/extensions.json\` for currently linked modules.
`;

  if (!fs.existsSync(agentsPath)) {
    if (!dryRun) {
      fs.writeFileSync(agentsPath, agentsContent.trim(), 'utf-8');
      createdFiles.push(agentsPath);
    }
    steps.push({ id: 'agents', label: 'Update AGENTS.md', status: dryRun ? 'skipped' : 'completed', details: 'AGENTS.md created' });
    return;
  }

  const existing = fs.readFileSync(agentsPath, 'utf-8');
  if (existing.includes('Filmbuff')) {
    skippedFiles.push(agentsPath);
    steps.push({ id: 'agents', label: 'Update AGENTS.md', status: 'skipped', details: 'Filmbuff guidance already present' });
    return;
  }

  if (!dryRun) {
    fs.appendFileSync(agentsPath, `\n${agentsContent}`, 'utf-8');
    updatedFiles.push(agentsPath);
  }

  steps.push({ id: 'agents', label: 'Update AGENTS.md', status: dryRun ? 'skipped' : 'completed', details: 'Filmbuff guidance appended' });
}

async function updateBeadsIntegration(
  cwd: string,
  dryRun: boolean,
  steps: WorkspaceInstallStepResult[],
  createdFiles: string[],
  updatedFiles: string[],
  skippedFiles: string[]
): Promise<void> {
  const beadsDir = path.join(cwd, '.beads');
  const beadsIssuesPath = path.join(beadsDir, 'issues.jsonl');
  const beadsConfigPath = path.join(beadsDir, 'config.json');
  const scriptsDir = path.join(cwd, 'scripts');
  const completedPath = path.join(scriptsDir, 'completed.jsonl');

  if (!fs.existsSync(beadsDir) && !fs.existsSync(beadsIssuesPath) && !fs.existsSync(beadsConfigPath)) {
    steps.push({ id: 'beads', label: 'Update Beads integration', status: 'skipped', details: 'Beads not detected in workspace' });
    return;
  }

  ensureDirectory(beadsDir, dryRun, steps, '.beads');

  if (!fs.existsSync(beadsIssuesPath)) {
    if (!dryRun) {
      fs.writeFileSync(beadsIssuesPath, '', 'utf-8');
      createdFiles.push(beadsIssuesPath);
    }
    steps.push({ id: 'beads-issues', label: 'Create .beads/issues.jsonl', status: dryRun ? 'skipped' : 'completed', details: 'Issues file created' });
  } else {
    skippedFiles.push(beadsIssuesPath);
    steps.push({ id: 'beads-issues', label: 'Create .beads/issues.jsonl', status: 'skipped', details: 'Issues file already exists' });
  }

  if (!fs.existsSync(beadsConfigPath)) {
    if (!dryRun) {
      const beadsConfig = {
        version: '1.0.0',
        project: path.basename(cwd),
        created: new Date().toISOString()
      };
      fs.writeFileSync(beadsConfigPath, JSON.stringify(beadsConfig, null, 2), 'utf-8');
      createdFiles.push(beadsConfigPath);
    }
    steps.push({ id: 'beads-config', label: 'Create .beads/config.json', status: dryRun ? 'skipped' : 'completed', details: 'Beads config created' });
  } else {
    skippedFiles.push(beadsConfigPath);
    steps.push({ id: 'beads-config', label: 'Create .beads/config.json', status: 'skipped', details: 'Beads config already exists' });
  }

  ensureDirectory(scriptsDir, dryRun, steps, 'scripts');

  if (!fs.existsSync(completedPath)) {
    if (!dryRun) {
      fs.writeFileSync(completedPath, '', 'utf-8');
      createdFiles.push(completedPath);
    }
    steps.push({ id: 'completed-jsonl', label: 'Create scripts/completed.jsonl', status: dryRun ? 'skipped' : 'completed', details: 'Completed file created' });
  } else {
    skippedFiles.push(completedPath);
    steps.push({ id: 'completed-jsonl', label: 'Create scripts/completed.jsonl', status: 'skipped', details: 'Completed file already exists' });
  }
}

function mergeLifecycleArtifactInstallState(
  cwd: string,
  baseArtifact: LifecycleArtifact,
  options: WorkspaceInstallOptions,
  existingConfig: Record<string, unknown> | null
): LifecycleArtifact {
  const mergedConfig = mergeExtensionsConfig(existingConfig);
  const installedVersion = options.packageVersion ?? baseArtifact.application.packageVersion;
  const mode = options.mode ?? 'fresh';
  const state: LifecycleState = mode === 'upgrade'
    ? 'upgrade-in-progress'
    : mode === 'reinstall'
      ? 'installation-in-progress'
      : 'installation-in-progress';

  return {
    ...baseArtifact,
    application: {
      ...baseArtifact.application,
      packageVersion: options.packageVersion ?? baseArtifact.application.packageVersion,
      installedVersion,
      previousVersion: baseArtifact.application.installedVersion
    },
    installation: {
      mode,
      source: 'workspace',
      startedAt: new Date().toISOString(),
      installedVersion,
      previousVersion: baseArtifact.application.installedVersion,
      progress: {
        completedSteps: [],
        remainingSteps: ['augment', 'agents', 'gitignore', 'rules', 'command-help', 'beads', 'artifact']
      }
    },
    state: {
      ...baseArtifact.state,
      current: state,
      detected: true,
      installed: true,
      rollbackAvailable: true,
      diagnosticAvailable: true,
      recoveryRequired: false,
      lastOperation: mode === 'upgrade' ? 'upgrade' : mode === 'reinstall' ? 'reinstall' : 'install'
    },
    result: {
      status: 'dry-run',
      summary: 'Workspace installation started.',
      notes: ['Settings and modules were preserved where compatible.']
    },
    notes: [
      ...(baseArtifact.notes ?? []),
      `Merged ${Array.isArray(mergedConfig.modules) ? mergedConfig.modules.length : 0} linked module entries.`
    ]
  };
}

export async function performWorkspaceInstallation(
  options: WorkspaceInstallOptions = {}
): Promise<WorkspaceInstallResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const log = options.log ?? DEFAULT_LOG;
  const warn = options.warn ?? DEFAULT_WARN;
  const error = options.error ?? DEFAULT_ERROR;
  const dryRun = Boolean(options.dryRun);
  const paths = resolveLifecyclePaths(cwd);
  const steps: WorkspaceInstallStepResult[] = [];
  const createdFiles: string[] = [];
  const updatedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const existingConfig = readJsonIfExists(paths.configPath);
  const existingArtifact = loadLifecycleArtifact(cwd) ?? createLifecycleArtifactSeed({ cwd });

  let artifact = mergeLifecycleArtifactInstallState(cwd, existingArtifact, options, existingConfig);

  if (dryRun) {
    steps.push({
      id: 'dry-run',
      label: 'Dry run validation',
      status: 'skipped',
      details: 'No files were written'
    });
    artifact = updateLifecycleState(artifact, 'installation-detected', {
      operation: options.mode === 'upgrade' ? 'upgrade' : options.mode === 'reinstall' ? 'reinstall' : 'install',
      result: 'dry-run',
      message: 'Dry run completed without changes.',
      step: 'dry-run'
    });
    return {
      status: 'dry-run',
      state: artifact.state.current,
      artifact,
      artifactPath: paths.artifactPath,
      createdFiles,
      updatedFiles,
      skippedFiles,
      warnings,
      errors,
      steps
    };
  }

  try {
    ensureDirectory(paths.augmentDir, dryRun, steps, '.augment');
    ensureDirectory(paths.artifactDir, dryRun, steps, '.augment/lifecycle');
    ensureDirectory(paths.backupDir, dryRun, steps, '.augment/lifecycle/backups');
    ensureDirectory(paths.diagnosticDir, dryRun, steps, '.augment/lifecycle/diagnostics');
    ensureDirectory(paths.promptArchiveDir, dryRun, steps, '.augment/lifecycle/archives');

    const config = mergeExtensionsConfig(existingConfig);
    if (!dryRun) {
      const configExisted = fs.existsSync(paths.configPath);
      writeFileAtomic(paths.configPath, `${JSON.stringify(config, null, 2)}\n`, dryRun);
      if (configExisted) {
        updatedFiles.push(paths.configPath);
      } else {
        createdFiles.push(paths.configPath);
      }
    }
    steps.push({
      id: 'extensions-config',
      label: 'Update .augment/extensions.json',
      status: 'completed',
      details: 'Extensions manifest preserved and normalized'
    });

    updateAgentsFile(cwd, dryRun, steps, createdFiles, updatedFiles, skippedFiles);
    updateGitignore(cwd, dryRun, steps, createdFiles, updatedFiles, skippedFiles);

    const ruleResult = await installCharacterCountRule({
      targetDir: cwd,
      skipIfExists: true,
      verbose: false
    });
    if (!ruleResult.success) {
      warnings.push(ruleResult.error || 'Unable to install character count rule');
      steps.push({
        id: 'character-count-rule',
        label: 'Install character count management rule',
        status: 'warning',
        details: ruleResult.error
      });
    } else {
      if (ruleResult.path && !skippedFiles.includes(ruleResult.path)) {
        (ruleResult.created ? createdFiles : updatedFiles).push(ruleResult.path);
      }
      steps.push({
        id: 'character-count-rule',
        label: 'Install character count management rule',
        status: 'completed',
        details: ruleResult.created ? 'Rule installed' : 'Rule already present'
      });
    }

    await updateCommandHelp(cwd, dryRun, createdFiles, updatedFiles, skippedFiles, steps);
    await updateBeadsIntegration(cwd, dryRun, steps, createdFiles, updatedFiles, skippedFiles);

    artifact = updateLifecycleState(artifact, options.mode === 'upgrade' ? 'installation-completed' : 'installation-completed', {
      operation: options.mode === 'upgrade' ? 'upgrade' : options.mode === 'reinstall' ? 'reinstall' : 'install',
      result: warnings.length > 0 ? 'partial' : 'success',
      message: warnings.length > 0
        ? 'Workspace installation completed with warnings.'
        : 'Workspace installation completed successfully.',
      step: 'finalize',
      completedAt: new Date().toISOString()
    });

    artifact = {
      ...artifact,
      installation: {
        ...(artifact.installation ?? {}),
        mode: options.mode ?? 'fresh',
        source: 'workspace',
        completedAt: new Date().toISOString(),
        progress: {
          completedSteps: steps.filter((step) => step.status === 'completed').map((step) => step.id),
          remainingSteps: []
        }
      },
      result: {
        status: warnings.length > 0 ? 'partial' : 'success',
        summary: warnings.length > 0
          ? 'Workspace installation completed with warnings.'
          : 'Workspace installation completed successfully.',
        warnings: cloneArray(warnings),
        errors: cloneArray(errors),
        nextSteps: warnings.length > 0 ? ['Review warnings', 'Run diagnostics'] : ['Run diagnostics to verify installation']
      }
    };

    saveLifecycleArtifact(artifact, cwd);

    log(chalk.green('Workspace installation completed.'));
    if (warnings.length > 0) {
      warn(chalk.yellow('Some lifecycle checks reported warnings.'));
    }

    return {
      status: warnings.length > 0 ? 'partial' : 'success',
      state: artifact.state.current,
      artifact,
      artifactPath: paths.artifactPath,
      createdFiles,
      updatedFiles,
      skippedFiles,
      warnings,
      errors,
      steps
    };
  } catch (installError) {
    const message = installError instanceof Error ? installError.message : String(installError);
    errors.push(message);
    artifact = updateLifecycleState(artifact, 'installation-failed', {
      operation: options.mode === 'upgrade' ? 'upgrade' : options.mode === 'reinstall' ? 'reinstall' : 'install',
      result: 'failure',
      message,
      step: 'failed'
    });
    artifact = {
      ...artifact,
      result: {
        status: 'failure',
        summary: 'Workspace installation failed.',
        errors: [...errors],
        warnings: [...warnings],
        nextSteps: ['Run diagnostics', 'Restore from backup if available']
      }
    };
    saveLifecycleArtifact(artifact, cwd);
    error(chalk.red(`Workspace installation failed: ${message}`));

    return {
      status: 'failure',
      state: artifact.state.current,
      artifact,
      artifactPath: paths.artifactPath,
      createdFiles,
      updatedFiles,
      skippedFiles,
      warnings,
      errors,
      steps
    };
  }
}
