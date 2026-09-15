import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';

import { redactValue } from '../utils/redaction';
import lifecycleSchema from './lifecycle-artifact.schema.json';
import { readPackageVersion } from '../utils/version';

export const LIFECYCLE_SCHEMA_VERSION = '1.0.0';
export const LIFECYCLE_APPLICATION_NAME = 'FilmBuff';
export const LIFECYCLE_APPLICATION_IDENTIFIER = '@mytechtoday/filmbuff';
export const LIFECYCLE_ARTIFACT_FILE = 'lifecycle-artifact.json';

export type LifecycleState =
  | 'not-installed'
  | 'installation-detected'
  | 'installation-in-progress'
  | 'installation-completed'
  | 'installation-partially-completed'
  | 'installation-failed'
  | 'upgrade-available'
  | 'upgrade-in-progress'
  | 'rollback-available'
  | 'rollback-in-progress'
  | 'uninstallation-pending-confirmation'
  | 'uninstallation-in-progress'
  | 'uninstallation-partially-completed'
  | 'uninstallation-completed'
  | 'diagnostic-analysis-in-progress'
  | 'repair-available'
  | 'repair-in-progress'
  | 'recovery-required';

export type LifecycleOperation =
  | 'install'
  | 'reinstall'
  | 'upgrade'
  | 'rollback'
  | 'uninstall'
  | 'diagnose'
  | 'repair'
  | 'restore';

export type LifecycleResultStatus = 'success' | 'partial' | 'failure' | 'blocked' | 'dry-run';

export type CredentialStatus =
  | 'secure-reference'
  | 'missing'
  | 'expired'
  | 'revoked'
  | 'inaccessible'
  | 'reauthenticate';

export interface LifecycleHistoryEntry {
  operation: LifecycleOperation;
  state: LifecycleState;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  result?: LifecycleResultStatus;
  message?: string;
  step?: string;
}

export interface LifecycleBackupEntry {
  id: string;
  kind: 'pre-install' | 'pre-upgrade' | 'pre-uninstall' | 'manual' | 'recovery';
  path: string;
  checksum: string;
  createdAt: string;
  verified: boolean;
  restorable?: boolean;
  notes?: string;
}

export interface LifecycleDiagnosticAction {
  id: string;
  label: string;
  safe: boolean;
  destructive?: boolean;
  requiresConfirmation?: boolean;
}

export interface LifecycleDiagnosticFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'warning' | 'informational';
  title: string;
  explanation: string;
  evidence: string[];
  path?: string;
  blocked: boolean;
  recommendedSolution?: string;
  risk?: string;
  reversible?: boolean;
  requiresPermission?: boolean;
  requiresConfirmation?: boolean;
  expectedResult?: string;
  actions?: LifecycleDiagnosticAction[];
}

export interface LifecycleArtifactPathSet {
  projectRoot: string;
  augmentDir?: string;
  artifactDir: string;
  artifactPath?: string;
  backupDir: string;
  diagnosticDir: string;
  promptArchiveDir?: string;
  promptArchivePath?: string;
  configPath?: string;
  commandHelpPath?: string;
}

export interface LifecycleArtifact {
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
  application: {
    name: string;
    identifier: string;
    packageVersion: string;
    installedVersion?: string;
    previousVersion?: string;
  };
  environment?: {
    platform?: string;
    arch?: string;
    nodeVersion?: string;
    runtime?: string;
  };
  state: {
    current: LifecycleState;
    detected: boolean;
    installed: boolean;
    rollbackAvailable: boolean;
    diagnosticAvailable: boolean;
    recoveryRequired: boolean;
    lastOperation?: LifecycleOperation;
    lastStep?: string;
    failureReason?: string;
  };
  paths: LifecycleArtifactPathSet;
  installation?: {
    mode?: 'fresh' | 'reinstall' | 'upgrade' | 'restore' | 'uninstall';
    source?: 'workspace' | 'artifact' | 'package-manager' | 'unknown';
    startedAt?: string;
    completedAt?: string;
    installedVersion?: string;
    previousVersion?: string;
    progress?: {
      completedSteps?: string[];
      remainingSteps?: string[];
    };
  };
  upgrade?: {
    available?: boolean;
    previousVersion?: string;
    targetVersion?: string;
    rollbackAvailable?: boolean;
  };
  promptArchive?: {
    sourceDir?: string;
    archivePath?: string;
    checksum?: string;
    entryCount?: number;
    verified?: boolean;
    extractedAt?: string;
  };
  checksums?: {
    packageJson?: string;
    packageLock?: string;
    extensionsConfig?: string;
    commandHelp?: string;
    promptArchive?: string;
  };
  credentials?: {
    entries?: Array<{
      name: string;
      status: CredentialStatus;
      reference: string;
      managedBy?: string;
      requiresUserAction?: boolean;
    }>;
  };
  diagnostics?: {
    lastRunAt?: string;
    reportPath?: string;
    summary?: {
      critical?: number;
      high?: number;
      medium?: number;
      low?: number;
      warning?: number;
      informational?: number;
    };
    findings?: LifecycleDiagnosticFinding[];
  };
  backups: LifecycleBackupEntry[];
  history: LifecycleHistoryEntry[];
  result: {
    status: LifecycleResultStatus;
    summary: string;
    notes?: string[];
    warnings?: string[];
    errors?: string[];
    nextSteps?: string[];
  };
  manualActions?: string[];
  notes?: string[];
}

export interface ArtifactValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ArtifactPathResolution {
  projectRoot: string;
  augmentDir: string;
  artifactDir: string;
  artifactPath: string;
  backupDir: string;
  diagnosticDir: string;
  promptArchiveDir: string;
  promptArchivePath: string;
  configPath: string;
  commandHelpPath: string;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(lifecycleSchema);

function cloneArray(values: string[] | undefined): string[] | undefined {
  return values ? [...values] : undefined;
}

export function resolveLifecyclePaths(cwd: string = process.cwd()): ArtifactPathResolution {
  const projectRoot = path.resolve(cwd);
  const augmentDir = path.join(projectRoot, '.augment');
  const artifactDir = path.join(augmentDir, 'lifecycle');
  const backupDir = path.join(artifactDir, 'backups');
  const diagnosticDir = path.join(artifactDir, 'diagnostics');
  const promptArchiveDir = path.join(artifactDir, 'archives');
  const promptArchivePath = path.join(promptArchiveDir, 'ai-prompts.zip');
  const artifactPath = path.join(artifactDir, LIFECYCLE_ARTIFACT_FILE);
  const configPath = path.join(augmentDir, 'extensions.json');
  const commandHelpPath = path.join(augmentDir, 'COMMAND_HELP.md');

  return {
    projectRoot,
    augmentDir,
    artifactDir,
    artifactPath,
    backupDir,
    diagnosticDir,
    promptArchiveDir,
    promptArchivePath,
    configPath,
    commandHelpPath
  };
}

export function createLifecycleArtifactSeed(params: {
  cwd?: string;
  state?: LifecycleState;
  installed?: boolean;
  rollbackAvailable?: boolean;
  diagnosticAvailable?: boolean;
  recoveryRequired?: boolean;
  detected?: boolean;
  previousVersion?: string;
  installedVersion?: string;
  resultStatus?: LifecycleResultStatus;
  resultSummary?: string;
  lastOperation?: LifecycleOperation;
  lastStep?: string;
  failureReason?: string;
}): LifecycleArtifact {
  const paths = resolveLifecyclePaths(params.cwd);
  const now = new Date().toISOString();
  const packageVersion = readPackageVersion();
  const currentState = params.state ?? 'not-installed';

  return {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    application: {
      name: LIFECYCLE_APPLICATION_NAME,
      identifier: LIFECYCLE_APPLICATION_IDENTIFIER,
      packageVersion,
      installedVersion: params.installedVersion ?? packageVersion,
      previousVersion: params.previousVersion
    },
    environment: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      runtime: 'node'
    },
    state: {
      current: currentState,
      detected: params.detected ?? false,
      installed: params.installed ?? false,
      rollbackAvailable: params.rollbackAvailable ?? false,
      diagnosticAvailable: params.diagnosticAvailable ?? true,
      recoveryRequired: params.recoveryRequired ?? false,
      lastOperation: params.lastOperation,
      lastStep: params.lastStep,
      failureReason: params.failureReason
    },
    paths: paths,
    backups: [],
    history: [],
    result: {
      status: params.resultStatus ?? 'dry-run',
      summary: params.resultSummary ?? 'No lifecycle operation has been recorded yet.'
    }
  };
}

export function normalizeLifecycleArtifact(raw: unknown, cwd: string = process.cwd()): LifecycleArtifact {
  const base = createLifecycleArtifactSeed({ cwd });

  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const record = raw as Partial<LifecycleArtifact> & Record<string, unknown>;
  const schemaVersion = typeof record.schemaVersion === 'string' && record.schemaVersion.trim()
    ? record.schemaVersion.trim()
    : base.schemaVersion;
  const history = Array.isArray(record.history) ? record.history as LifecycleHistoryEntry[] : [];
  const backups = Array.isArray(record.backups) ? record.backups as LifecycleBackupEntry[] : [];

  return {
    ...base,
    ...record,
    schemaVersion,
    application: {
      ...base.application,
      ...(typeof record.application === 'object' && record.application ? record.application as LifecycleArtifact['application'] : {})
    },
    environment: record.environment && typeof record.environment === 'object'
      ? { ...record.environment as NonNullable<LifecycleArtifact['environment']> }
      : base.environment,
    state: {
      ...base.state,
      ...(typeof record.state === 'object' && record.state ? record.state as LifecycleArtifact['state'] : {})
    },
    paths: {
      ...base.paths,
      ...(typeof record.paths === 'object' && record.paths ? record.paths as LifecycleArtifactPathSet : {})
    },
    installation: record.installation && typeof record.installation === 'object'
      ? {
          ...record.installation,
          progress: record.installation.progress
            ? {
                completedSteps: cloneArray(record.installation.progress.completedSteps),
                remainingSteps: cloneArray(record.installation.progress.remainingSteps)
              }
            : undefined
        }
      : base.installation,
    upgrade: record.upgrade && typeof record.upgrade === 'object'
      ? { ...record.upgrade }
      : base.upgrade,
    promptArchive: record.promptArchive && typeof record.promptArchive === 'object'
      ? { ...record.promptArchive }
      : base.promptArchive,
    checksums: record.checksums && typeof record.checksums === 'object'
      ? { ...record.checksums }
      : base.checksums,
    credentials: record.credentials && typeof record.credentials === 'object'
      ? {
          entries: Array.isArray(record.credentials.entries)
            ? record.credentials.entries.map((entry) => ({ ...entry }))
            : []
        }
      : base.credentials,
    diagnostics: record.diagnostics && typeof record.diagnostics === 'object'
      ? {
          lastRunAt: record.diagnostics.lastRunAt,
          reportPath: record.diagnostics.reportPath,
          summary: record.diagnostics.summary ? { ...record.diagnostics.summary } : undefined,
          findings: Array.isArray(record.diagnostics.findings)
            ? record.diagnostics.findings.map((finding) => ({
                ...finding,
                evidence: Array.isArray(finding.evidence) ? [...finding.evidence] : [],
                actions: Array.isArray(finding.actions)
                  ? finding.actions.map((action) => ({ ...action }))
                  : undefined
              }))
            : []
        }
      : base.diagnostics,
    backups,
    history,
    result: {
      ...base.result,
      ...(typeof record.result === 'object' && record.result ? record.result as LifecycleArtifact['result'] : {})
    },
    manualActions: Array.isArray(record.manualActions) ? [...record.manualActions as string[]] : undefined,
    notes: Array.isArray(record.notes) ? [...record.notes as string[]] : undefined
  };
}

export function validateLifecycleArtifact(artifact: unknown): ArtifactValidationResult {
  const valid = validateSchema(artifact);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!valid && Array.isArray(validateSchema.errors)) {
    for (const error of validateSchema.errors) {
      errors.push(formatAjvError(error));
    }
  }

  if (artifact && typeof artifact === 'object') {
    const candidate = artifact as Record<string, unknown>;
    const application = candidate.application as Record<string, unknown> | undefined;

    if (application) {
      const identifier = typeof application.identifier === 'string' ? application.identifier : '';
      if (identifier && identifier !== LIFECYCLE_APPLICATION_IDENTIFIER) {
        errors.push(`Artifact identity mismatch: ${identifier}`);
      }
    }

    const state = candidate.state as Record<string, unknown> | undefined;
    if (state && typeof state.current === 'string' && !isLifecycleState(state.current)) {
      errors.push(`Unknown lifecycle state: ${state.current}`);
    }

    const result = candidate.result as Record<string, unknown> | undefined;
    if (result && typeof result.status === 'string' && !isLifecycleResultStatus(result.status)) {
      errors.push(`Unknown lifecycle result status: ${result.status}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export function loadLifecycleArtifact(cwd: string = process.cwd()): LifecycleArtifact | null {
  const artifactPath = resolveLifecyclePaths(cwd).artifactPath;

  if (!fs.existsSync(artifactPath)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(artifactPath, 'utf-8')) as unknown;
    return normalizeLifecycleArtifact(raw, cwd);
  } catch {
    return null;
  }
}

export function loadLifecycleArtifactRaw(cwd: string = process.cwd()): unknown | null {
  const artifactPath = resolveLifecyclePaths(cwd).artifactPath;

  if (!fs.existsSync(artifactPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(artifactPath, 'utf-8')) as unknown;
  } catch {
    return null;
  }
}

export function saveLifecycleArtifact(
  artifact: LifecycleArtifact,
  cwd: string = process.cwd()
): LifecycleArtifact {
  const paths = resolveLifecyclePaths(cwd);
  fs.mkdirSync(paths.artifactDir, { recursive: true });

  const normalized = normalizeLifecycleArtifact(artifact, cwd);
  normalized.updatedAt = new Date().toISOString();
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;

  const tempPath = `${paths.artifactPath}.tmp`;
  fs.writeFileSync(tempPath, serialized, 'utf-8');
  fs.renameSync(tempPath, paths.artifactPath);

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(paths.artifactPath, 0o600);
    } catch {
      // Ignore permission tightening failures on unsupported filesystems.
    }
  }

  return normalized;
}

export function appendLifecycleHistory(
  artifact: LifecycleArtifact,
  entry: LifecycleHistoryEntry
): LifecycleArtifact {
  const history = [...artifact.history];
  history.push(entry);
  return {
    ...artifact,
    history,
    state: {
      ...artifact.state,
      current: entry.state,
      lastOperation: entry.operation,
      lastStep: entry.step ?? artifact.state.lastStep,
      failureReason: entry.result === 'failure' ? entry.message ?? artifact.state.failureReason : artifact.state.failureReason
    },
    result: {
      ...artifact.result,
      status: entry.result ?? artifact.result.status,
      summary: entry.message ?? artifact.result.summary,
      notes: entry.message ? [entry.message] : artifact.result.notes
    }
  };
}

export function updateLifecycleState(
  artifact: LifecycleArtifact,
  state: LifecycleState,
  options: {
    operation?: LifecycleOperation;
    step?: string;
    result?: LifecycleResultStatus;
    message?: string;
    completedAt?: string;
  } = {}
): LifecycleArtifact {
  const updatedAt = new Date().toISOString();
  const lastHistoryEntry = artifact.history[artifact.history.length - 1];
  const historyEntry: LifecycleHistoryEntry = {
    operation: options.operation ?? artifact.state.lastOperation ?? 'diagnose',
    state,
    startedAt: lastHistoryEntry?.startedAt ?? artifact.createdAt,
    updatedAt,
    completedAt: options.completedAt,
    result: options.result,
    message: options.message,
    step: options.step
  };

  return appendLifecycleHistory({
    ...artifact,
    updatedAt,
    state: {
      ...artifact.state,
      current: state,
      lastOperation: options.operation ?? artifact.state.lastOperation,
      lastStep: options.step ?? artifact.state.lastStep,
      failureReason: options.result === 'failure' ? options.message ?? artifact.state.failureReason : artifact.state.failureReason
    },
    result: {
      ...artifact.result,
      status: options.result ?? artifact.result.status,
      summary: options.message ?? artifact.result.summary,
      notes: options.message ? [options.message] : artifact.result.notes
    }
  }, historyEntry);
}

export function createBackupRecord(params: {
  id: string;
  kind: LifecycleBackupEntry['kind'];
  path: string;
  checksum: string;
  verified: boolean;
  restorable?: boolean;
  notes?: string;
}): LifecycleBackupEntry {
  return {
    id: params.id,
    kind: params.kind,
    path: params.path,
    checksum: params.checksum,
    createdAt: new Date().toISOString(),
    verified: params.verified,
    restorable: params.restorable ?? true,
    notes: params.notes
  };
}

export function isLifecycleState(value: unknown): value is LifecycleState {
  return typeof value === 'string' && [
    'not-installed',
    'installation-detected',
    'installation-in-progress',
    'installation-completed',
    'installation-partially-completed',
    'installation-failed',
    'upgrade-available',
    'upgrade-in-progress',
    'rollback-available',
    'rollback-in-progress',
    'uninstallation-pending-confirmation',
    'uninstallation-in-progress',
    'uninstallation-partially-completed',
    'uninstallation-completed',
    'diagnostic-analysis-in-progress',
    'repair-available',
    'repair-in-progress',
    'recovery-required'
  ].includes(value);
}

export function isLifecycleResultStatus(value: unknown): value is LifecycleResultStatus {
  return typeof value === 'string' && ['success', 'partial', 'failure', 'blocked', 'dry-run'].includes(value);
}

export function buildLifecycleArtifactIdentityMismatchMessage(
  artifact: Pick<LifecycleArtifact, 'application'>
): string {
  return `Artifact identity mismatch: expected ${LIFECYCLE_APPLICATION_IDENTIFIER}, found ${artifact.application.identifier}`;
}

export function redactLifecycleArtifact(artifact: LifecycleArtifact): LifecycleArtifact {
  return redactValue(artifact) as LifecycleArtifact;
}

function formatAjvError(error: ErrorObject): string {
  const location = error.instancePath || 'artifact';
  const message = error.message || 'validation failed';
  return `${location} ${message}`.trim();
}
