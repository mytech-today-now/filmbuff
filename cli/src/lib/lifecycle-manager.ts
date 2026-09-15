import chalk from 'chalk';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { compareSemanticVersions, isValidSemanticVersion } from '../utils/module-system';
import { extractCommandHelp } from '../utils/extractCommandHelp';
import {
  createBackupRecord,
  createLifecycleArtifactSeed,
  loadLifecycleArtifact,
  loadLifecycleArtifactRaw,
  normalizeLifecycleArtifact,
  resolveLifecyclePaths,
  saveLifecycleArtifact,
  type ArtifactPathResolution,
  type CredentialStatus,
  type LifecycleArtifact,
  type LifecycleBackupEntry,
  type LifecycleDiagnosticAction,
  type LifecycleDiagnosticFinding,
  type LifecycleOperation,
  type LifecycleResultStatus,
  type LifecycleState,
  type ArtifactValidationResult,
  validateLifecycleArtifact,
  updateLifecycleState
} from './lifecycle-artifact';
import {
  ArchiveBuildResult,
  ArchiveExtractionResult,
  createZipArchiveFromDirectory,
  extractZipArchiveSafely,
  sha256File,
  verifyArchiveChecksum
} from './lifecycle-archive';
import { performWorkspaceInstallation } from './workspace-installer';

export interface LifecycleSnapshot {
  cwd: string;
  paths: ArtifactPathResolution;
  packageVersion: string;
  installedVersion?: string;
  previousVersion?: string;
  state: LifecycleState;
  artifact: LifecycleArtifact | null;
  artifactValidation: ArtifactValidationResult;
  hasExtensionsConfig: boolean;
  hasCommandHelp: boolean;
  hasPromptArchive: boolean;
  rollbackAvailable: boolean;
  upgradeAvailable: boolean;
  recoveryRequired: boolean;
  staleInProgress: boolean;
  credentialStatus: Array<{
    name: string;
    status: CredentialStatus;
    reference: string;
    managedBy: string;
    requiresUserAction: boolean;
  }>;
}

export interface LifecycleDiagnosticsSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  warning: number;
  informational: number;
}

export interface LifecycleDiagnosticsResult {
  snapshot: LifecycleSnapshot;
  findings: LifecycleDiagnosticFinding[];
  summary: LifecycleDiagnosticsSummary;
  status: LifecycleResultStatus;
  reportPath?: string;
  reportFormat?: 'json' | 'markdown' | 'html';
  repairedActions: string[];
  warnings: string[];
  errors: string[];
}

export interface LifecycleBackupResult {
  backup: LifecycleBackupEntry;
  backupZipPath: string;
  manifestPath: string;
  stagingDir: string;
  entryCount: number;
  checksum: string;
}

export interface LifecycleRollbackResult {
  status: LifecycleResultStatus;
  restored: boolean;
  backup?: LifecycleBackupEntry;
  backupZipPath?: string;
  artifact: LifecycleArtifact;
  reportPath?: string;
  warnings: string[];
  errors: string[];
  steps: string[];
}

export interface LifecycleUninstallResult {
  status: LifecycleResultStatus;
  artifact: LifecycleArtifact;
  archivePath?: string;
  archiveChecksum?: string;
  removedPaths: string[];
  preservedPaths: string[];
  archivedPaths: string[];
  warnings: string[];
  errors: string[];
  reportPath?: string;
}

export interface LifecycleInstallOrRepairResult {
  status: LifecycleResultStatus;
  artifact: LifecycleArtifact;
  reportPath?: string;
  warnings: string[];
  errors: string[];
}

export interface LifecycleOperationOptions {
  cwd?: string;
  dryRun?: boolean;
  allowNetwork?: boolean;
  reportFormat?: 'json' | 'markdown' | 'html';
  reportPath?: string;
}

export interface LifecycleUninstallOptions extends LifecycleOperationOptions {
  removeData?: boolean;
  confirm?: boolean;
}

export interface LifecycleRollbackOptions extends LifecycleOperationOptions {
  backupId?: string;
}

const DEFAULT_CREDENTIAL_ENV_VARS = [
  'AIPOWERED_AGENT_TOKEN',
  'AIPOWERED_API_KEY'
];

const LIFECYCLE_BACKUP_PREFIX = 'workspace-backup';

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

function checksumIfExists(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function countFreeBytes(cwd: string): number | null {
  try {
    const stats = fs.statfsSync(cwd);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

function isInProgressState(state: LifecycleState): boolean {
  return state.endsWith('in-progress');
}

function stateFromArtifact(artifact: LifecycleArtifact | null, snapshot: LifecycleSnapshot): LifecycleState {
  if (!artifact) {
    return snapshot.hasExtensionsConfig ? 'installation-detected' : 'not-installed';
  }

  if (!snapshot.artifactValidation.valid) {
    return 'recovery-required';
  }

  if (artifact.state.recoveryRequired) {
    return 'recovery-required';
  }

  if (isInProgressState(artifact.state.current) && snapshot.staleInProgress) {
    return 'recovery-required';
  }

  if (snapshot.upgradeAvailable && artifact.state.installed) {
    return 'upgrade-available';
  }

  if (snapshot.rollbackAvailable && artifact.state.installed) {
    return 'rollback-available';
  }

  return artifact.state.current;
}

function isStaleInProgress(artifact: LifecycleArtifact | null): boolean {
  if (!artifact || !isInProgressState(artifact.state.current)) {
    return false;
  }

  const updatedAt = Date.parse(artifact.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    return true;
  }

  return Date.now() - updatedAt > 10 * 60 * 1000;
}

function buildCredentialStatus(): LifecycleSnapshot['credentialStatus'] {
  return DEFAULT_CREDENTIAL_ENV_VARS.map((name) => {
    const present = typeof process.env[name] === 'string' && process.env[name]!.trim().length > 0;
    return {
      name,
      status: present ? 'secure-reference' : 'missing',
      reference: `env:${name}`,
      managedBy: 'environment',
      requiresUserAction: !present
    };
  });
}

function summarizeFindings(findings: LifecycleDiagnosticFinding[]): LifecycleDiagnosticsSummary {
  return findings.reduce<LifecycleDiagnosticsSummary>(
    (summary, finding) => {
      summary[finding.severity === 'informational' ? 'informational' : finding.severity] += 1;
      return summary;
    },
    {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      warning: 0,
      informational: 0
    }
  );
}

function buildFinding(params: LifecycleDiagnosticFinding): LifecycleDiagnosticFinding {
  return {
    ...params,
    actions: params.actions ? params.actions.map((action) => ({ ...action })) : undefined,
    evidence: [...params.evidence]
  };
}

function withReportContent(
  reportFormat: 'json' | 'markdown' | 'html',
  result: LifecycleDiagnosticsResult
): string {
  switch (reportFormat) {
    case 'json':
      return `${JSON.stringify(result, null, 2)}\n`;
    case 'html':
      return renderLifecycleHtml(result);
    case 'markdown':
    default:
      return renderLifecycleMarkdown(result);
  }
}

function renderLifecycleMarkdown(result: LifecycleDiagnosticsResult): string {
  const lines: string[] = [];
  lines.push('# FilmBuff Lifecycle Diagnostics');
  lines.push('');
  lines.push(`- State: ${result.snapshot.state}`);
  lines.push(`- Package version: ${result.snapshot.packageVersion}`);
  lines.push(`- Installed version: ${result.snapshot.installedVersion ?? 'not recorded'}`);
  lines.push(`- Rollback available: ${result.snapshot.rollbackAvailable ? 'yes' : 'no'}`);
  lines.push(`- Upgrade available: ${result.snapshot.upgradeAvailable ? 'yes' : 'no'}`);
  lines.push(`- Recovery required: ${result.snapshot.recoveryRequired ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('| --- | ---: |');
  lines.push(`| Critical | ${result.summary.critical} |`);
  lines.push(`| High | ${result.summary.high} |`);
  lines.push(`| Medium | ${result.summary.medium} |`);
  lines.push(`| Low | ${result.summary.low} |`);
  lines.push(`| Warning | ${result.summary.warning} |`);
  lines.push(`| Informational | ${result.summary.informational} |`);
  lines.push('');

  if (result.findings.length === 0) {
    lines.push('_No findings detected._');
    lines.push('');
  } else {
    lines.push('## Findings');
    lines.push('');
    for (const finding of result.findings) {
      lines.push(`### ${finding.title}`);
      lines.push('');
      lines.push(`- ID: ${finding.id}`);
      lines.push(`- Severity: ${finding.severity}`);
      lines.push(`- Blocks workflow: ${finding.blocked ? 'yes' : 'no'}`);
      lines.push(`- Risk: ${finding.risk ?? 'unknown'}`);
      lines.push(`- Reversible: ${finding.reversible ? 'yes' : 'no'}`);
      if (finding.path) {
        lines.push(`- Path: \`${finding.path}\``);
      }
      lines.push('');
      lines.push(finding.explanation);
      lines.push('');
      lines.push('Evidence:');
      for (const item of finding.evidence) {
        lines.push(`- ${item}`);
      }
      if (finding.recommendedSolution) {
        lines.push('');
        lines.push(`Recommended solution: ${finding.recommendedSolution}`);
      }
      if (finding.expectedResult) {
        lines.push(`Expected result: ${finding.expectedResult}`);
      }
      lines.push('');
    }
  }

  if (result.repairedActions.length > 0) {
    lines.push('## Repair Actions');
    lines.push('');
    for (const action of result.repairedActions) {
      lines.push(`- ${action}`);
    }
    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  if (result.errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const item of result.errors) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderLifecycleHtml(result: LifecycleDiagnosticsResult): string {
  const findings = result.findings.map((finding) => `
    <section class="finding ${finding.severity}">
      <h3>${escapeHtml(finding.title)}</h3>
      <p class="meta">${escapeHtml(finding.severity)} | ${finding.blocked ? 'blocks workflow' : 'does not block workflow'} | ${escapeHtml(finding.risk ?? 'unknown')}</p>
      <p>${escapeHtml(finding.explanation)}</p>
      <ul>${finding.evidence.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>
    </section>
  `).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FilmBuff lifecycle diagnostics</title>
  <style>
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #0f172a; color: #e5e7eb; padding: 24px; }
    .panel { background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .finding { border-left: 4px solid #60a5fa; padding-left: 12px; margin: 16px 0; }
    .critical { border-left-color: #ef4444; }
    .high { border-left-color: #f97316; }
    .medium { border-left-color: #facc15; }
    .low { border-left-color: #22c55e; }
    .warning { border-left-color: #eab308; }
    .informational { border-left-color: #60a5fa; }
    .meta { color: #94a3b8; font-size: 14px; }
    button, a { border: 1px solid #475569; background: #0f172a; color: inherit; padding: 8px 12px; border-radius: 8px; text-decoration: none; display: inline-block; }
  </style>
</head>
<body>
  <div class="panel">
    <h1>FilmBuff lifecycle diagnostics</h1>
    <p class="meta">State: ${escapeHtml(result.snapshot.state)} | Package version: ${escapeHtml(result.snapshot.packageVersion)}</p>
  </div>
  <div class="panel">
    <h2>Summary</h2>
    <p>Critical: ${result.summary.critical}, High: ${result.summary.high}, Medium: ${result.summary.medium}, Low: ${result.summary.low}, Warning: ${result.summary.warning}, Informational: ${result.summary.informational}</p>
    <div style="display:flex; gap:12px; flex-wrap:wrap;">
      <button type="button" onclick="navigator.clipboard.writeText(document.body.innerText)">Copy redacted report</button>
      <a href="file://${escapeHtml(result.snapshot.paths.projectRoot)}">Open project root</a>
    </div>
  </div>
  <div class="panel">
    <h2>Findings</h2>
    ${findings}
  </div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function reportPathFor(cwd: string, format: 'json' | 'markdown' | 'html'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(resolveLifecyclePaths(cwd).diagnosticDir, `lifecycle-diagnostics-${timestamp}.${format === 'json' ? 'json' : format === 'markdown' ? 'md' : 'html'}`);
}

function stagedCopyPath(sourcePath: string, targetRoot: string): string {
  return path.join(targetRoot, path.relative(path.parse(sourcePath).root, sourcePath));
}

function copyPathSafely(sourcePath: string, targetPath: string): void {
  const stat = fs.lstatSync(sourcePath);
  if (stat.isSymbolicLink()) {
    return;
  }

  if (stat.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath)) {
      copyPathSafely(path.join(sourcePath, entry), path.join(targetPath, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function removePathSafely(targetPath: string, cwd: string): void {
  const resolvedRoot = path.resolve(cwd);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to delete outside workspace scope: ${targetPath}`);
  }

  if (!fs.existsSync(resolvedTarget)) {
    return;
  }

  const stat = fs.lstatSync(resolvedTarget);
  if (stat.isSymbolicLink() || stat.isFile()) {
    fs.unlinkSync(resolvedTarget);
    return;
  }

  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}

function buildBackupCandidates(cwd: string): string[] {
  const paths = resolveLifecyclePaths(cwd);
  return [
    path.relative(cwd, paths.artifactPath),
    path.join('.augment', 'extensions.json'),
    path.join('.augment', 'COMMAND_HELP.md'),
    path.join('.augment', 'rules'),
    path.join('.augment', 'cache'),
    path.join('.augment', 'plugins'),
    path.join('.augment', 'temp'),
    path.join('.augment', 'lifecycle', 'diagnostics'),
    path.join('.augment', 'lifecycle', 'archives'),
    'AGENTS.md',
    '.gitignore',
    '.beads',
    path.join('scripts', 'completed.jsonl'),
    'ai-prompts',
    path.join('cli', 'output'),
    path.join('cli', 'filmbuff.db'),
    path.join('cli', 'filmbuff.db-wal'),
    path.join('cli', 'filmbuff.db-shm')
  ]
    .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
    .map((candidate) => path.join(cwd, candidate))
    .filter((candidate) => fs.existsSync(candidate));
}

function buildRemovalCandidates(cwd: string, removeData: boolean): string[] {
  const candidates = [
    path.join(cwd, '.augment', 'extensions.json'),
    path.join(cwd, '.augment', 'COMMAND_HELP.md'),
    path.join(cwd, '.augment', 'rules', 'character-count-management.md'),
    path.join(cwd, '.augment', 'cache'),
    path.join(cwd, '.augment', 'plugins'),
    path.join(cwd, '.augment', 'temp'),
    path.join(cwd, 'AGENTS.md'),
    path.join(cwd, '.gitignore')
  ];

  if (removeData) {
    candidates.push(
      path.join(cwd, '.beads'),
      path.join(cwd, 'scripts', 'completed.jsonl'),
      path.join(cwd, 'cli', 'output'),
      path.join(cwd, 'cli', 'filmbuff.db'),
      path.join(cwd, 'cli', 'filmbuff.db-wal'),
      path.join(cwd, 'cli', 'filmbuff.db-shm')
    );
  }

  return candidates.filter((candidate) => fs.existsSync(candidate));
}

function removeFilmbuffSectionFromAgents(cwd: string): void {
  const agentsPath = path.join(cwd, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    return;
  }

  const content = fs.readFileSync(agentsPath, 'utf-8');
  const beginMarker = '<!-- BEGIN FILMBUFF -->';
  const endMarker = '<!-- END FILMBUFF -->';
  const beginIndex = content.indexOf(beginMarker);
  const endIndex = content.indexOf(endMarker);

  if (beginIndex !== -1 && endIndex !== -1 && endIndex > beginIndex) {
    const prefix = content.slice(0, beginIndex).trimEnd();
    const suffix = content.slice(endIndex + endMarker.length).trimStart();
    const merged = [prefix, suffix].filter(Boolean).join('\n\n');
    fs.writeFileSync(agentsPath, `${merged}\n`, 'utf-8');
  }
}

function removeFilmbuffEntryFromGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return;
  }

  const lines = fs.readFileSync(gitignorePath, 'utf-8').split(/\r?\n/);
  const filtered = lines.filter((line) => line.trim() !== '.augment/extensions.json' && line.trim() !== '# Filmbuff');
  fs.writeFileSync(gitignorePath, `${filtered.join('\n')}\n`, 'utf-8');
}

function findLatestVerifiedBackup(artifact: LifecycleArtifact, cwd: string): LifecycleBackupEntry | undefined {
  const backups = artifact.backups.filter((backup) => backup.verified && backup.restorable !== false);
  if (backups.length === 0) {
    const backupDir = resolveLifecyclePaths(cwd).backupDir;
    if (!fs.existsSync(backupDir)) {
      return undefined;
    }

    const folders = fs.readdirSync(backupDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(backupDir, entry.name, 'backup.json'))
      .filter((entry) => fs.existsSync(entry));

    const manifests = folders
      .map((manifestPath) => {
        try {
          return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as LifecycleBackupEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is LifecycleBackupEntry => Boolean(entry))
      .filter((entry) => entry.verified && entry.restorable !== false);

    if (manifests.length === 0) {
      return undefined;
    }

    return manifests.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  return backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function detectLifecycleSnapshot(cwd: string = process.cwd()): LifecycleSnapshot {
  const paths = resolveLifecyclePaths(cwd);
  const rawArtifact = loadLifecycleArtifactRaw(cwd);
  const artifact = loadLifecycleArtifact(cwd);
  const artifactValidation = rawArtifact === null
    ? { valid: false, errors: ['Lifecycle artifact is missing.'], warnings: [] }
    : validateLifecycleArtifact(rawArtifact);
  const packageVersion = artifact?.application.packageVersion ?? createLifecycleArtifactSeed({ cwd }).application.packageVersion;
  const installedVersion = artifact?.application.installedVersion;
  const previousVersion = artifact?.application.previousVersion;
  const hasExtensionsConfig = fs.existsSync(paths.configPath);
  const hasCommandHelp = fs.existsSync(paths.commandHelpPath);
  const hasPromptArchive = fs.existsSync(paths.promptArchivePath);
  const staleInProgress = isStaleInProgress(artifact);
  const rollbackAvailable = Boolean(findLatestVerifiedBackup(artifact ?? createLifecycleArtifactSeed({ cwd }), cwd));
  const upgradeAvailable = Boolean(
    installedVersion &&
    isValidSemanticVersion(packageVersion) &&
    isValidSemanticVersion(installedVersion) &&
    compareSemanticVersions(packageVersion, installedVersion) > 0
  );
  const recoveryRequired = !artifactValidation.valid || staleInProgress || Boolean(artifact?.state.recoveryRequired);

  const snapshot: LifecycleSnapshot = {
    cwd,
    paths,
    packageVersion,
    installedVersion,
    previousVersion,
    state: stateFromArtifact(artifact, {
      cwd,
      paths,
      packageVersion,
      installedVersion,
      previousVersion,
      state: artifact?.state.current ?? (hasExtensionsConfig ? 'installation-detected' : 'not-installed'),
      artifact,
      artifactValidation,
      hasExtensionsConfig,
      hasCommandHelp,
      hasPromptArchive,
      rollbackAvailable,
      upgradeAvailable,
      recoveryRequired,
      staleInProgress,
      credentialStatus: buildCredentialStatus()
    }),
    artifact,
    artifactValidation,
    hasExtensionsConfig,
    hasCommandHelp,
    hasPromptArchive,
    rollbackAvailable,
    upgradeAvailable,
    recoveryRequired,
    staleInProgress,
    credentialStatus: buildCredentialStatus()
  };

  return snapshot;
}

function createDiagnosticsReportPath(cwd: string, format: 'json' | 'markdown' | 'html'): string {
  const reportDir = resolveLifecyclePaths(cwd).diagnosticDir;
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const extension = format === 'json' ? 'json' : format === 'markdown' ? 'md' : 'html';
  return path.join(reportDir, `lifecycle-diagnostics-${stamp}.${extension}`);
}

function buildDiagnosticsFindings(snapshot: LifecycleSnapshot): LifecycleDiagnosticFinding[] {
  const findings: LifecycleDiagnosticFinding[] = [];

  if (!snapshot.hasExtensionsConfig) {
    findings.push(buildFinding({
      id: 'missing-extensions-config',
      severity: 'critical',
      title: 'Workspace configuration is missing',
      explanation: 'The extensions manifest is not present, so the workspace cannot be restored or upgraded safely.',
      evidence: [`Missing file: ${snapshot.paths.configPath}`],
      path: snapshot.paths.configPath,
      blocked: true,
      recommendedSolution: 'Recreate the workspace manifest from the latest compatible template.',
      risk: 'low',
      reversible: true,
      requiresPermission: false,
      requiresConfirmation: false,
      expectedResult: 'Workspace can be installed or repaired again.',
      actions: [
        { id: 'restore-extensions-config', label: 'Recreate configuration', safe: true },
        { id: 'install-workspace', label: 'Run workspace install', safe: true }
      ]
    }));
  }

  if (!snapshot.hasCommandHelp) {
    findings.push(buildFinding({
      id: 'missing-command-help',
      severity: 'low',
      title: 'Command help reference is missing',
      explanation: 'The generated workflow command help reference is not present.',
      evidence: [`Missing file: ${snapshot.paths.commandHelpPath}`],
      path: snapshot.paths.commandHelpPath,
      blocked: false,
      recommendedSolution: 'Regenerate the command help reference.',
      risk: 'low',
      reversible: true,
      requiresPermission: false,
      requiresConfirmation: false,
      expectedResult: 'The command help reference is restored.',
      actions: [
        { id: 'regenerate-command-help', label: 'Regenerate command help', safe: true }
      ]
    }));
  }

  if (!snapshot.hasPromptArchive && fs.existsSync(path.join(snapshot.paths.projectRoot, 'ai-prompts'))) {
    findings.push(buildFinding({
      id: 'missing-prompt-archive',
      severity: 'medium',
      title: 'Prompt archive is missing',
      explanation: 'The workspace prompt archive is missing or has not been generated yet.',
      evidence: [`Missing file: ${snapshot.paths.promptArchivePath}`],
      path: snapshot.paths.promptArchivePath,
      blocked: false,
      recommendedSolution: 'Rebuild the prompt archive from the ai-prompts directory.',
      risk: 'low',
      reversible: true,
      requiresPermission: false,
      requiresConfirmation: false,
      expectedResult: 'The prompt archive is available for restore or uninstall.',
      actions: [
        { id: 'rebuild-prompt-archive', label: 'Rebuild archive', safe: true }
      ]
    }));
  }

  if (!snapshot.artifactValidation.valid) {
    findings.push(buildFinding({
      id: 'invalid-lifecycle-artifact',
      severity: 'critical',
      title: 'Lifecycle artifact is invalid',
      explanation: 'The lifecycle artifact does not pass schema validation and should be repaired before destructive changes.',
      evidence: snapshot.artifactValidation.errors.length > 0
        ? snapshot.artifactValidation.errors
        : ['Artifact schema validation failed'],
      path: snapshot.paths.artifactPath,
      blocked: true,
      recommendedSolution: 'Repair or regenerate the lifecycle artifact from the current workspace state.',
      risk: 'medium',
      reversible: true,
      requiresPermission: false,
      requiresConfirmation: false,
      expectedResult: 'The artifact becomes readable and restorable.',
      actions: [
        { id: 'repair-lifecycle-artifact', label: 'Repair artifact', safe: true },
        { id: 'export-report', label: 'Export report', safe: true }
      ]
    }));
  }

  if (snapshot.recoveryRequired) {
    findings.push(buildFinding({
      id: 'recovery-required',
      severity: 'high',
      title: 'Recovery is required',
      explanation: 'The workspace appears to have an interrupted lifecycle operation or a stale in-progress state.',
      evidence: [
        `State: ${snapshot.state}`,
        `UpdatedAt stale: ${snapshot.staleInProgress ? 'yes' : 'no'}`
      ],
      path: snapshot.paths.artifactPath,
      blocked: true,
      recommendedSolution: 'Run diagnostics and either repair the workspace or restore from the latest verified backup.',
      risk: 'low',
      reversible: true,
      requiresPermission: false,
      requiresConfirmation: false,
      expectedResult: 'The workspace returns to a stable state.',
      actions: [
        { id: 'restore-latest-backup', label: 'Restore latest backup', safe: true },
        { id: 'repair-lifecycle-artifact', label: 'Repair artifact', safe: true }
      ]
    }));
  }

  if (!snapshot.rollbackAvailable) {
    findings.push(buildFinding({
      id: 'rollback-unavailable',
      severity: 'warning',
      title: 'Rollback backup is not available',
      explanation: 'No verified rollback backup was found in the lifecycle backup area.',
      evidence: [`Backup directory: ${snapshot.paths.backupDir}`],
      path: snapshot.paths.backupDir,
      blocked: false,
      recommendedSolution: 'Create a backup before the next lifecycle change.',
      risk: 'low',
      reversible: true,
      requiresPermission: false,
      requiresConfirmation: false,
      expectedResult: 'Future install or upgrade flows can roll back safely.',
      actions: [
        { id: 'create-backup', label: 'Create backup', safe: true }
      ]
    }));
  }

  const nodeVersion = process.version.replace(/^v/, '');
  if (compareSemanticVersions(nodeVersion, '20.20.0') < 0) {
    findings.push(buildFinding({
      id: 'runtime-version-low',
      severity: 'informational',
      title: 'Runtime version is lower than the recommended baseline',
      explanation: 'The current Node runtime is below the documented baseline for this workspace.',
      evidence: [`Node version: ${process.version}`],
      path: undefined,
      blocked: false,
      recommendedSolution: 'Upgrade Node.js if you need the newest lifecycle or CLI features.',
      risk: 'low',
      reversible: true,
      requiresPermission: false,
      requiresConfirmation: false,
      expectedResult: 'Lifecycle operations continue with reduced compatibility risk.'
    }));
  }

  const freeBytes = countFreeBytes(snapshot.paths.projectRoot);
  if (freeBytes !== null && freeBytes < 250 * 1024 * 1024) {
    findings.push(buildFinding({
      id: 'low-disk-space',
      severity: 'high',
      title: 'Disk space is low',
      explanation: 'The workspace has limited free space, which can interrupt backups and rollback operations.',
      evidence: [`Free bytes: ${freeBytes}`],
      path: snapshot.paths.projectRoot,
      blocked: false,
      recommendedSolution: 'Remove verified caches or free additional disk space before retrying.',
      risk: 'low',
      reversible: true,
      requiresPermission: false,
      requiresConfirmation: false,
      expectedResult: 'Backups and writes complete without running out of space.'
    }));
  }

  for (const credential of snapshot.credentialStatus) {
    if (credential.status !== 'secure-reference') {
      findings.push(buildFinding({
        id: `credential-${credential.name.toLowerCase()}`,
        severity: 'warning',
        title: `${credential.name} credential requires attention`,
        explanation: 'The workspace only tracks a secure reference for this credential, or the credential is missing.',
        evidence: [`Reference: ${credential.reference}`, `Managed by: ${credential.managedBy}`],
        path: undefined,
        blocked: false,
        recommendedSolution: 'Reauthenticate through the supported credential flow or provide the missing reference.',
        risk: 'low',
        reversible: true,
        requiresPermission: false,
        requiresConfirmation: false,
        expectedResult: 'The credential reference can be resolved without exposing the secret value.'
      }));
    }
  }

  return findings;
}

function repairActionById(actionId: string): string {
  switch (actionId) {
    case 'restore-extensions-config':
      return 'Recreated the workspace manifest from the current workspace state.';
    case 'regenerate-command-help':
      return 'Regenerated the command help reference.';
    case 'rebuild-prompt-archive':
      return 'Rebuilt the prompt archive from the ai-prompts directory.';
    case 'repair-lifecycle-artifact':
      return 'Normalized and rewrote the lifecycle artifact.';
    case 'restore-latest-backup':
      return 'Restored the latest verified backup.';
    case 'create-backup':
      return 'Created a new verified backup.';
    case 'install-workspace':
      return 'Ran the workspace installer.';
    default:
      return `Executed repair action ${actionId}.`;
  }
}

async function writeReport(
  result: LifecycleDiagnosticsResult,
  format: 'json' | 'markdown' | 'html',
  reportPath?: string
): Promise<string> {
  const targetPath = reportPath ? path.resolve(reportPath) : createDiagnosticsReportPath(result.snapshot.cwd, format);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, withReportContent(format, result), 'utf-8');
  return targetPath;
}

function updateArtifactDiagnostics(
  artifact: LifecycleArtifact | null,
  snapshot: LifecycleSnapshot,
  findings: LifecycleDiagnosticFinding[],
  reportPath: string | undefined
): LifecycleArtifact {
  const base = artifact ?? createLifecycleArtifactSeed({ cwd: snapshot.cwd });
  const summary = summarizeFindings(findings);

  return saveLifecycleArtifact({
    ...base,
    diagnostics: {
      lastRunAt: new Date().toISOString(),
      reportPath,
      summary,
      findings
    },
    state: {
      ...base.state,
      current: findings.some((finding) => finding.blocked) ? 'repair-available' : base.state.current,
      diagnosticAvailable: true,
      recoveryRequired: findings.some((finding) => finding.blocked),
      detected: true,
      installed: snapshot.hasExtensionsConfig,
      rollbackAvailable: snapshot.rollbackAvailable
    },
    result: {
      status: findings.some((finding) => finding.blocked) ? 'partial' : 'success',
      summary: findings.length === 0 ? 'Diagnostics completed without findings.' : 'Diagnostics completed with findings.'
    }
  }, snapshot.cwd);
}

export async function runLifecycleDiagnostics(
  options: LifecycleOperationOptions = {}
): Promise<LifecycleDiagnosticsResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const snapshot = detectLifecycleSnapshot(cwd);
  const findings = buildDiagnosticsFindings(snapshot);
  const summary = summarizeFindings(findings);
  const reportFormat = options.reportFormat ?? 'markdown';
  const status: LifecycleResultStatus = findings.some((finding) => finding.blocked)
    ? 'partial'
    : 'success';
  const result: LifecycleDiagnosticsResult = {
    snapshot,
    findings,
    summary,
    status,
    reportFormat,
    repairedActions: [],
    warnings: [],
    errors: []
  };

  if (options.reportPath || options.reportFormat) {
    result.reportPath = await writeReport(result, reportFormat, options.reportPath);
  }

  const repairableActionIds = new Set<string>();
  for (const finding of findings) {
    for (const action of finding.actions ?? []) {
      if (action.safe && !action.destructive) {
        repairableActionIds.add(action.id);
      }
    }
  }

  if (repairableActionIds.size > 0 && options.dryRun !== true) {
    result.warnings.push(`Safe repair actions available: ${Array.from(repairableActionIds).join(', ')}`);
  }

  if (!options.dryRun) {
    updateArtifactDiagnostics(snapshot.artifact, snapshot, findings, result.reportPath);
  }

  return result;
}

async function createBackupManifest(result: LifecycleBackupResult, cwd: string): Promise<void> {
  const manifest = {
    id: result.backup.id,
    kind: result.backup.kind,
    path: result.backup.path,
    checksum: result.backup.checksum,
    createdAt: result.backup.createdAt,
    verified: result.backup.verified,
    restorable: result.backup.restorable,
    notes: result.backup.notes,
    entryCount: result.entryCount
  };

  fs.writeFileSync(result.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(result.manifestPath, 0o600);
    } catch {
      // Ignore permission tightening failures on unsupported filesystems.
    }
  }
}

function copyBackupCandidate(source: string, stagingRoot: string, cwd: string): string {
  const resolvedSource = path.resolve(source);
  const relative = path.relative(path.resolve(cwd), resolvedSource);
  const target = path.join(stagingRoot, relative);
  copyPathSafely(resolvedSource, target);
  return target;
}

export async function createWorkspaceBackup(
  options: LifecycleOperationOptions & { kind?: LifecycleBackupEntry['kind'] } = {}
): Promise<LifecycleBackupResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const paths = resolveLifecyclePaths(cwd);
  const kind = options.kind ?? 'manual';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = path.join(paths.backupDir, `${LIFECYCLE_BACKUP_PREFIX}-${timestamp}`);
  const stagingDir = path.join(backupRoot, 'staging');
  const backupZipPath = path.join(backupRoot, 'backup.zip');
  const manifestPath = path.join(backupRoot, 'backup.json');

  fs.mkdirSync(stagingDir, { recursive: true });
  const candidates = buildBackupCandidates(cwd);

  for (const candidate of candidates) {
    copyBackupCandidate(candidate, stagingDir, cwd);
  }

  const archive: ArchiveBuildResult = await createZipArchiveFromDirectory(stagingDir, backupZipPath);
  const verified = await verifyArchiveChecksum(backupZipPath, archive.checksum);
  const backup = createBackupRecord({
    id: `${LIFECYCLE_BACKUP_PREFIX}-${timestamp}`,
    kind,
    path: backupZipPath,
    checksum: archive.checksum,
    verified,
    restorable: true,
    notes: `Captured ${archive.entryCount} entries.`
  });

  const result: LifecycleBackupResult = {
    backup,
    backupZipPath,
    manifestPath,
    stagingDir,
    entryCount: archive.entryCount,
    checksum: archive.checksum
  };

  await createBackupManifest(result, cwd);
  return result;
}

async function ensureArchiveIntegrity(backupZipPath: string, expectedChecksum: string): Promise<void> {
  const actualChecksum = await sha256File(backupZipPath);
  if (actualChecksum !== expectedChecksum) {
    throw new Error('Backup checksum verification failed');
  }
}

export async function restoreWorkspaceBackup(
  options: LifecycleRollbackOptions & { backup: LifecycleBackupEntry }
): Promise<ArchiveExtractionResult> {
  await ensureArchiveIntegrity(options.backup.path, options.backup.checksum);
  return extractZipArchiveSafely(options.backup.path, options.cwd ?? process.cwd());
}

export async function runLifecycleRollback(
  options: LifecycleRollbackOptions = {}
): Promise<LifecycleRollbackResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const snapshot = detectLifecycleSnapshot(cwd);
  const artifact = snapshot.artifact ?? createLifecycleArtifactSeed({ cwd });
  const backup = options.backupId
    ? artifact.backups.find((entry) => entry.id === options.backupId)
    : findLatestVerifiedBackup(artifact, cwd);

  if (!backup) {
    if (options.dryRun) {
      return {
        status: 'dry-run',
        restored: false,
        artifact,
        warnings: [],
        errors: ['No verified backup available'],
        steps: ['Select or create a verified backup first.']
      };
    }

    const updatedArtifact = saveLifecycleArtifact(updateLifecycleState(artifact, 'recovery-required', {
      operation: 'rollback',
      result: 'blocked',
      message: 'No verified backup was available for rollback.',
      step: 'select-backup'
    }), cwd);

    return {
      status: 'blocked',
      restored: false,
      artifact: updatedArtifact,
      warnings: [],
      errors: ['No verified backup available'],
      steps: ['Select or create a verified backup first.']
    };
  }

  await ensureArchiveIntegrity(backup.path, backup.checksum);

  if (options.dryRun) {
    return {
      status: 'dry-run',
      restored: false,
      artifact,
      backup,
      backupZipPath: backup.path,
      warnings: [],
      errors: [],
      steps: [
        `Verified checksum for ${path.basename(backup.path)}`,
        'Dry run only - no files were restored'
      ]
    };
  }

  const extraction = await extractZipArchiveSafely(backup.path, cwd);
  const restoredArtifact = saveLifecycleArtifact(updateLifecycleState(artifact, 'installation-completed', {
    operation: 'rollback',
    result: 'success',
    message: 'Rollback completed successfully.',
    step: 'restore-backup',
    completedAt: new Date().toISOString()
  }), cwd);

  return {
    status: 'success',
    restored: true,
    artifact: restoredArtifact,
    backup,
    backupZipPath: backup.path,
    warnings: [],
    errors: [],
    steps: [
      `Verified checksum for ${path.basename(backup.path)}`,
      `Restored ${extraction.entryCount} entries from backup`
    ]
  };
}

function removeGeneratedWorkspaceFiles(cwd: string, removeData: boolean): { removedPaths: string[]; preservedPaths: string[] } {
  const removedPaths: string[] = [];
  const preservedPaths: string[] = [];
  const candidates = buildRemovalCandidates(cwd, removeData);

  for (const candidate of candidates) {
    removePathSafely(candidate, cwd);
    removedPaths.push(candidate);
  }

  removeFilmbuffSectionFromAgents(cwd);
  removeFilmbuffEntryFromGitignore(cwd);

  preservedPaths.push(path.join(cwd, 'ai-prompts'));

  return { removedPaths, preservedPaths };
}

async function createPromptArchiveIfNeeded(cwd: string): Promise<{ archivePath: string; checksum: string; entryCount: number }> {
  const paths = resolveLifecyclePaths(cwd);
  if (!fs.existsSync(path.join(cwd, 'ai-prompts'))) {
    return {
      archivePath: paths.promptArchivePath,
      checksum: '',
      entryCount: 0
    };
  }

  const archive = await createZipArchiveFromDirectory(path.join(cwd, 'ai-prompts'), paths.promptArchivePath);
  return {
    archivePath: archive.archivePath,
    checksum: archive.checksum,
    entryCount: archive.entryCount
  };
}

function latestBackupFromFilesystem(cwd: string): LifecycleBackupEntry | undefined {
  const artifact = loadLifecycleArtifact(cwd);
  if (artifact) {
    const backup = findLatestVerifiedBackup(artifact, cwd);
    if (backup) {
      return backup;
    }
  }

  return undefined;
}

function repairActionFinding(
  id: string,
  title: string,
  explanation: string,
  evidence: string[],
  actionId: string,
  cwd: string,
  pathValue?: string
): LifecycleDiagnosticFinding {
  return buildFinding({
    id,
    severity: 'medium',
    title,
    explanation,
    evidence,
    path: pathValue,
    blocked: false,
    recommendedSolution: explanation,
    risk: 'low',
    reversible: true,
    requiresPermission: false,
    requiresConfirmation: false,
    expectedResult: 'The issue is cleared.',
    actions: [
      { id: actionId, label: title, safe: true }
    ]
  });
}

async function executeRepairAction(actionId: string, cwd: string): Promise<string> {
  switch (actionId) {
    case 'restore-extensions-config': {
      const snapshot = detectLifecycleSnapshot(cwd);
      const artifact = snapshot.artifact ?? createLifecycleArtifactSeed({ cwd });
      const configPath = snapshot.paths.configPath;
      const existing = readJsonIfExists(configPath);
      const merged = existing && typeof existing === 'object'
        ? { ...existing, version: existing.version ?? '0.1.0', modules: Array.isArray(existing.modules) ? existing.modules : [] }
        : { version: '0.1.0', modules: [], settings: { autoUpdate: false, checkUpdatesOnInit: true } };
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
      saveLifecycleArtifact(updateLifecycleState(artifact, 'installation-completed', {
        operation: 'repair',
        result: 'success',
        message: 'Workspace manifest repaired.',
        step: 'restore-extensions-config'
      }), cwd);
      return 'Recreated the workspace manifest from the current workspace state.';
    }
    case 'regenerate-command-help': {
      await extractCommandHelp(cwd, '.augment/COMMAND_HELP.md');
      return 'Regenerated the command help reference.';
    }
    case 'rebuild-prompt-archive': {
      const archive = await createPromptArchiveIfNeeded(cwd);
      const snapshot = detectLifecycleSnapshot(cwd);
      const artifact = snapshot.artifact ?? createLifecycleArtifactSeed({ cwd });
      saveLifecycleArtifact({
        ...artifact,
        promptArchive: {
          sourceDir: path.join(cwd, 'ai-prompts'),
          archivePath: archive.archivePath,
          checksum: archive.checksum,
          entryCount: archive.entryCount,
          verified: Boolean(archive.checksum),
          extractedAt: new Date().toISOString()
        },
        checksums: {
          ...(artifact.checksums ?? {}),
          promptArchive: archive.checksum
        }
      }, cwd);
      return 'Rebuilt the prompt archive from the ai-prompts directory.';
    }
    case 'repair-lifecycle-artifact': {
      const raw = loadLifecycleArtifactRaw(cwd);
      const normalized = raw ? normalizeLifecycleArtifact(raw, cwd) : createLifecycleArtifactSeed({ cwd });
      saveLifecycleArtifact(normalized, cwd);
      return 'Normalized and rewrote the lifecycle artifact.';
    }
    case 'restore-latest-backup': {
      const backup = latestBackupFromFilesystem(cwd);
      if (!backup) {
        throw new Error('No verified backup found');
      }
      await ensureArchiveIntegrity(backup.path, backup.checksum);
      await extractZipArchiveSafely(backup.path, cwd);
      return 'Restored the latest verified backup.';
    }
    case 'create-backup': {
      const backup = await createWorkspaceBackup({ cwd, kind: 'manual' });
      const snapshot = detectLifecycleSnapshot(cwd);
      const artifact = snapshot.artifact ?? createLifecycleArtifactSeed({ cwd });
      saveLifecycleArtifact({
        ...artifact,
        backups: [...artifact.backups, backup.backup]
      }, cwd);
      return `Created a verified backup at ${backup.backupZipPath}`;
    }
    case 'install-workspace': {
      await performWorkspaceInstallation({ cwd, mode: 'reinstall' });
      return 'Ran the workspace installer.';
    }
    case 'cleanup-temp-files': {
      const lifecycleDir = resolveLifecyclePaths(cwd).artifactDir;
      if (fs.existsSync(lifecycleDir)) {
        for (const entry of fs.readdirSync(lifecycleDir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.tmp')) {
            fs.unlinkSync(path.join(lifecycleDir, entry.name));
          }
        }
      }
      return 'Removed temporary lifecycle files.';
    }
    default:
      throw new Error(`Unknown repair action: ${actionId}`);
  }
}

export async function applyLifecycleRepairActions(
  actionIds: string[],
  options: LifecycleOperationOptions = {}
): Promise<LifecycleInstallOrRepairResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const warnings: string[] = [];
  const errors: string[] = [];
  const snapshot = detectLifecycleSnapshot(cwd);
  const artifact = snapshot.artifact ?? createLifecycleArtifactSeed({ cwd });
  let nextArtifact = artifact;

  if (options.dryRun) {
    return {
      status: 'dry-run',
      artifact,
      warnings: actionIds.map((actionId) => `Would execute repair action: ${actionId}`),
      errors: []
    };
  }

  for (const actionId of actionIds) {
    try {
      const message = await executeRepairAction(actionId, cwd);
      warnings.push(message);
      nextArtifact = updateLifecycleState(nextArtifact, 'repair-available', {
        operation: 'repair',
        result: 'success',
        message,
        step: actionId
      });
    } catch (repairError) {
      const message = repairError instanceof Error ? repairError.message : String(repairError);
      errors.push(message);
      nextArtifact = updateLifecycleState(nextArtifact, 'repair-available', {
        operation: 'repair',
        result: 'failure',
        message,
        step: actionId
      });
    }
  }

  saveLifecycleArtifact(nextArtifact, cwd);

  return {
    status: errors.length > 0 ? 'partial' : 'success',
    artifact: nextArtifact,
    warnings,
    errors
  };
}

export async function runLifecycleUninstall(
  options: LifecycleUninstallOptions = {}
): Promise<LifecycleUninstallResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const snapshot = detectLifecycleSnapshot(cwd);
  const artifact = snapshot.artifact ?? createLifecycleArtifactSeed({ cwd });
  const warnings: string[] = [];
  const errors: string[] = [];

  if (options.dryRun) {
    const promptArchivePath = resolveLifecyclePaths(cwd).promptArchivePath;
    const archivedPaths = fs.existsSync(path.join(cwd, 'ai-prompts')) ? [promptArchivePath] : [];
    const dryRunArtifact = updateLifecycleState(artifact, 'uninstallation-in-progress', {
      operation: 'uninstall',
      result: 'dry-run',
      message: 'Dry run completed without removing files.',
      step: 'preview-uninstall'
    });

    return {
      status: 'dry-run',
      artifact: dryRunArtifact,
      archivePath: promptArchivePath,
      archiveChecksum: '',
      removedPaths: buildRemovalCandidates(cwd, Boolean(options.removeData)),
      preservedPaths: [path.join(cwd, 'ai-prompts')],
      archivedPaths,
      warnings,
      errors
    };
  }

  if (!options.confirm) {
    const pending = saveLifecycleArtifact(updateLifecycleState(artifact, 'uninstallation-pending-confirmation', {
      operation: 'uninstall',
      result: 'blocked',
      message: 'Uninstallation requires explicit confirmation.',
      step: 'confirm'
    }), cwd);

    return {
      status: 'blocked',
      artifact: pending,
      removedPaths: [],
      preservedPaths: [],
      archivedPaths: [],
      warnings,
      errors: ['Uninstallation confirmation is required.']
    };
  }

  const archiveInfo = await createPromptArchiveIfNeeded(cwd);
  const backup = await createWorkspaceBackup({ cwd, kind: 'pre-uninstall' });
  const updatedArtifact = saveLifecycleArtifact({
    ...artifact,
    backups: [...artifact.backups, backup.backup],
    promptArchive: archiveInfo.checksum
      ? {
          sourceDir: path.join(cwd, 'ai-prompts'),
          archivePath: archiveInfo.archivePath,
          checksum: archiveInfo.checksum,
          entryCount: archiveInfo.entryCount,
          verified: true,
          extractedAt: new Date().toISOString()
        }
      : artifact.promptArchive,
    state: {
      ...artifact.state,
      current: 'uninstallation-in-progress',
      installed: true,
      rollbackAvailable: true,
      recoveryRequired: false,
      lastOperation: 'uninstall'
    },
    installation: {
      ...(artifact.installation ?? {}),
      mode: 'uninstall',
      source: 'workspace',
      startedAt: artifact.installation?.startedAt ?? new Date().toISOString()
    },
    result: {
      status: 'dry-run',
      summary: 'Uninstallation started.',
      warnings: warnings.length > 0 ? warnings : undefined
    }
  }, cwd);

  const removed = removeGeneratedWorkspaceFiles(cwd, Boolean(options.removeData));
  const finalArtifact = saveLifecycleArtifact(updateLifecycleState(updatedArtifact, 'uninstallation-completed', {
    operation: 'uninstall',
    result: errors.length > 0 ? 'partial' : 'success',
    message: errors.length > 0 ? 'Uninstallation completed with errors.' : 'Uninstallation completed successfully.',
    step: 'remove-generated-files',
    completedAt: new Date().toISOString()
  }), cwd);

  return {
    status: errors.length > 0 ? 'partial' : 'success',
    artifact: finalArtifact,
    archivePath: archiveInfo.archivePath,
    archiveChecksum: archiveInfo.checksum,
    removedPaths: removed.removedPaths,
    preservedPaths: removed.preservedPaths,
    archivedPaths: archiveInfo.checksum ? [archiveInfo.archivePath] : [],
    warnings,
    errors,
    reportPath: backup.manifestPath
  };
}

export async function runWorkspaceInstallWithBackup(
  options: LifecycleOperationOptions & { mode?: 'fresh' | 'reinstall' | 'upgrade' } = {}
): Promise<LifecycleInstallOrRepairResult> {
  if (options.dryRun) {
    const dryRunResult = await performWorkspaceInstallation({
      cwd: options.cwd,
      dryRun: true,
      mode: options.mode ?? 'fresh'
    });

    return {
      status: dryRunResult.status,
      artifact: dryRunResult.artifact,
      warnings: dryRunResult.warnings,
      errors: dryRunResult.errors
    };
  }

  const backup = await createWorkspaceBackup({ cwd: options.cwd, kind: options.mode === 'upgrade' ? 'pre-upgrade' : 'pre-install' });
  const result = await performWorkspaceInstallation({
    cwd: options.cwd,
    dryRun: options.dryRun,
    mode: options.mode ?? 'fresh'
  });

  const updatedArtifact = saveLifecycleArtifact({
    ...result.artifact,
    backups: [...result.artifact.backups, backup.backup]
  }, options.cwd ?? process.cwd());

  return {
    status: result.status,
    artifact: updatedArtifact,
    reportPath: backup.manifestPath,
    warnings: result.warnings,
    errors: result.errors
  };
}

export async function runLifecycleInstallRecovery(
  options: LifecycleOperationOptions & { mode?: 'fresh' | 'reinstall' | 'upgrade' } = {}
): Promise<LifecycleInstallOrRepairResult> {
  return runWorkspaceInstallWithBackup(options);
}
