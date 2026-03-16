import * as fs from 'fs';
import * as path from 'path';

export type InspectionState = 'idle' | 'running' | 'complete' | 'error';

export interface InspectionStatusRecord {
  state: InspectionState;
  moduleName?: string;
  lastAction?: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  lastReportPath?: string;
  details?: string;
  errorMessage?: string;
  tooltip: string;
}

const STATUS_FILE = path.join('.augment', 'cache', 'inspection-status.json');

export function getInspectionStatusPath(cwd: string = process.cwd()): string {
  return path.join(cwd, STATUS_FILE);
}

export function readInspectionStatus(cwd: string = process.cwd()): InspectionStatusRecord {
  const statusPath = getInspectionStatusPath(cwd);
  if (!fs.existsSync(statusPath)) {
    return createIdleStatus();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statusPath, 'utf-8')) as Partial<InspectionStatusRecord>;
    return normalizeStatus(parsed);
  } catch {
    return createIdleStatus('Inspection status file could not be read.');
  }
}

export function writeInspectionStatus(
  status: Partial<InspectionStatusRecord>,
  cwd: string = process.cwd()
): InspectionStatusRecord {
  const statusPath = getInspectionStatusPath(cwd);
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  const normalized = normalizeStatus(status);
  fs.writeFileSync(statusPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
  return normalized;
}

export function beginInspection(
  moduleName: string,
  action: string,
  cwd: string = process.cwd()
): InspectionStatusRecord {
  const startedAt = new Date().toISOString();
  return writeInspectionStatus({
    state: 'running',
    moduleName,
    lastAction: action,
    startedAt,
    updatedAt: startedAt,
    details: `Running ${action} for ${moduleName}`
  }, cwd);
}

export function completeInspection(params: {
  moduleName: string;
  action: string;
  cwd?: string;
  lastReportPath?: string;
  details?: string;
}): InspectionStatusRecord {
  const timestamp = new Date().toISOString();
  return writeInspectionStatus({
    state: 'complete',
    moduleName: params.moduleName,
    lastAction: params.action,
    startedAt: readInspectionStatus(params.cwd).startedAt,
    updatedAt: timestamp,
    completedAt: timestamp,
    lastReportPath: params.lastReportPath,
    details: params.details
  }, params.cwd);
}

export function failInspection(
  moduleName: string,
  action: string,
  error: unknown,
  cwd: string = process.cwd()
): InspectionStatusRecord {
  const timestamp = new Date().toISOString();
  return writeInspectionStatus({
    state: 'error',
    moduleName,
    lastAction: action,
    startedAt: readInspectionStatus(cwd).startedAt,
    updatedAt: timestamp,
    errorMessage: error instanceof Error ? error.message : String(error),
    details: `Failed while running ${action}`
  }, cwd);
}

export function getModuleInspectionStatus(
  moduleName: string,
  cwd: string = process.cwd()
): InspectionStatusRecord {
  const status = readInspectionStatus(cwd);
  if (!status.moduleName || status.moduleName === moduleName) {
    return status;
  }

  return createIdleStatus(
    `No saved inspection state for ${moduleName}. Last recorded module: ${status.moduleName}.`
  );
}

export function getLastInspectionReportPath(
  moduleName?: string,
  cwd: string = process.cwd()
): string | undefined {
  const status = readInspectionStatus(cwd);
  if (!status.lastReportPath) {
    return undefined;
  }
  if (moduleName && status.moduleName && status.moduleName !== moduleName) {
    return undefined;
  }
  return fs.existsSync(status.lastReportPath) ? status.lastReportPath : undefined;
}

function createIdleStatus(details?: string): InspectionStatusRecord {
  const updatedAt = new Date().toISOString();
  return normalizeStatus({
    state: 'idle',
    updatedAt,
    details
  });
}

function normalizeStatus(status: Partial<InspectionStatusRecord>): InspectionStatusRecord {
  const normalized: InspectionStatusRecord = {
    state: status.state || 'idle',
    moduleName: status.moduleName,
    lastAction: status.lastAction,
    startedAt: status.startedAt,
    updatedAt: status.updatedAt || new Date().toISOString(),
    completedAt: status.completedAt,
    lastReportPath: status.lastReportPath,
    details: status.details,
    errorMessage: status.errorMessage,
    tooltip: ''
  };

  normalized.tooltip = buildTooltip(normalized);
  return normalized;
}

function buildTooltip(status: InspectionStatusRecord): string {
  const parts = [`State: ${status.state}`];
  if (status.moduleName) parts.push(`Module: ${status.moduleName}`);
  if (status.lastAction) parts.push(`Action: ${status.lastAction}`);
  if (status.lastReportPath) parts.push(`Last report: ${path.basename(status.lastReportPath)}`);
  if (status.details) parts.push(status.details);
  if (status.errorMessage) parts.push(`Error: ${status.errorMessage}`);
  return parts.join(' | ');
}