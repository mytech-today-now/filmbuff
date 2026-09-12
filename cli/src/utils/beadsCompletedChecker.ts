import * as fs from 'fs';
import * as path from 'path';
import { findProjectRoot } from './module-system';

export interface BeadsTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority?: number;
  issue_type?: string;
  owner?: string;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  closed_at?: string;
  close_reason?: string;
  labels?: string[];
  dependencies?: Array<{
    issue_id: string;
    depends_on_id: string;
    type: string;
    created_at?: string;
    created_by?: string;
  }>;
  comments?: Array<{
    id?: number;
    issue_id?: string;
    author?: string;
    text?: string;
    body?: string;
    created_at?: string;
  }>;
}

/**
 * Interface for completed tasks
 * Extends BeadsTask with required fields for completed tasks
 */
export interface CompletedTask extends BeadsTask {
  status: 'closed';
  closed_at: string;
  close_reason?: string;
}

export class CompletedHistoryCorruptionError extends Error {
  readonly completedPath: string;
  readonly lineNumber: number;
  readonly line: string;

  constructor(completedPath: string, lineNumber: number, line: string) {
    super(`Malformed completed history line ${lineNumber} in ${completedPath}`);
    this.name = 'CompletedHistoryCorruptionError';
    this.completedPath = completedPath;
    this.lineNumber = lineNumber;
    this.line = line;
    Object.setPrototypeOf(this, CompletedHistoryCorruptionError.prototype);
  }
}

function resolveCompletedPath(completedPath: string = 'scripts/completed.jsonl'): string {
  if (path.isAbsolute(completedPath)) {
    return completedPath;
  }

  const projectRoot = findProjectRoot() ?? process.cwd();
  return path.join(projectRoot, completedPath);
}

type CompletedHistoryScanMode = 'strict' | 'lenient';

export interface CompletedHistoryResult {
  tasks: CompletedTask[];
  corruption: CompletedHistoryCorruptionError | null;
}

function isCompletedTaskRecord(task: unknown): task is CompletedTask {
  if (typeof task !== 'object' || task === null || Array.isArray(task)) {
    return false;
  }

  const record = task as Partial<CompletedTask>;
  return (
    typeof record.id === 'string' &&
    record.status === 'closed' &&
    typeof record.closed_at === 'string'
  );
}

function scanCompletedTasks(
  completedPath: string,
  mode: CompletedHistoryScanMode,
  visitor: (task: CompletedTask) => void,
  onCorruption?: (error: CompletedHistoryCorruptionError) => void
): void {
  const resolvedPath = resolveCompletedPath(completedPath);

  if (!fs.existsSync(resolvedPath)) {
    return;
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    let task: CompletedTask | null = null;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isCompletedTaskRecord(parsed)) {
        throw new Error('Line does not match the completed-task record format.');
      }

      task = parsed;
    } catch {
      const corruption = new CompletedHistoryCorruptionError(resolvedPath, index + 1, line);
      if (mode === 'strict') {
        throw corruption;
      }

      onCorruption?.(corruption);
      continue;
    }

    if (!task) {
      continue;
    }

    visitor(task);
  }
}

/**
 * Check if a task exists in completed.jsonl
 */
export function isTaskCompleted(taskId: string, completedPath: string = 'scripts/completed.jsonl'): boolean {
  let found = false;

  scanCompletedTasks(completedPath, 'strict', (task) => {
    if (task.id === taskId) {
      found = true;
    }
  });

  return found;
}

/**
 * Get a completed task by ID from completed.jsonl
 */
export function getCompletedTask(taskId: string, completedPath: string = 'scripts/completed.jsonl'): CompletedTask | null {
  // Find the last occurrence of the task (most recent update)
  let foundTask: CompletedTask | null = null;

  scanCompletedTasks(completedPath, 'strict', (task) => {
    if (task.id === taskId) {
      foundTask = task;
    }
  });

  return foundTask;
}

/**
 * Read all completed tasks from completed.jsonl and report any corruption.
 */
export function getCompletedTaskHistory(completedPath: string = 'scripts/completed.jsonl'): CompletedHistoryResult {
  const tasksMap = new Map<string, CompletedTask>();
  let corruption: CompletedHistoryCorruptionError | null = null;

  scanCompletedTasks(completedPath, 'lenient', (task) => {
    tasksMap.set(task.id, task);
  }, (error) => {
    if (!corruption) {
      corruption = error;
    }
  });

  return {
    tasks: Array.from(tasksMap.values()),
    corruption
  };
}

/**
 * Get all completed tasks from completed.jsonl
 */
export function getAllCompletedTasks(completedPath: string = 'scripts/completed.jsonl'): CompletedTask[] {
  const history = getCompletedTaskHistory(completedPath);

  if (history.corruption) {
    throw history.corruption;
  }

  return history.tasks;
}

/**
 * Filter completed tasks by date range
 */
export function filterTasksByDateRange(
  tasks: CompletedTask[],
  since?: string,
  until?: string
): CompletedTask[] {
  return tasks.filter(task => {
    const closedAt = task.closed_at;
    if (!closedAt) return false;

    const taskDate = new Date(closedAt);

    if (since) {
      const sinceDate = new Date(since);
      if (taskDate < sinceDate) return false;
    }

    if (until) {
      const untilDate = new Date(until);
      if (taskDate > untilDate) return false;
    }

    return true;
  });
}

/**
 * Validate ISO 8601 timestamp
 */
export function validateISO8601(timestamp: string): boolean {
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  if (!iso8601Regex.test(timestamp)) {
    return false;
  }

  const date = new Date(timestamp);
  return !isNaN(date.getTime());
}

/**
 * Filter completed tasks by search term (searches title, description, close_reason)
 */
export function filterTasksBySearch(
  tasks: CompletedTask[],
  searchTerm: string
): CompletedTask[] {
  const lowerSearch = searchTerm.toLowerCase();
  return tasks.filter(task => {
    return (
      task.title.toLowerCase().includes(lowerSearch) ||
      (task.description && task.description.toLowerCase().includes(lowerSearch)) ||
      (task.close_reason && task.close_reason.toLowerCase().includes(lowerSearch))
    );
  });
}

/**
 * Filter completed tasks by labels
 */
export function filterTasksByLabels(
  tasks: CompletedTask[],
  labels: string[]
): CompletedTask[] {
  return tasks.filter(task => {
    if (!task.labels || task.labels.length === 0) return false;
    return labels.some(label => task.labels!.includes(label));
  });
}

/**
 * Sort completed tasks
 */
export function sortTasks(
  tasks: CompletedTask[],
  sortBy: 'date' | 'title' | 'priority' = 'date',
  order: 'asc' | 'desc' = 'desc'
): CompletedTask[] {
  const sorted = [...tasks].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'date':
        const dateA = new Date(a.closed_at).getTime();
        const dateB = new Date(b.closed_at).getTime();
        comparison = dateA - dateB;
        break;
      case 'title':
        comparison = a.title.localeCompare(b.title);
        break;
      case 'priority':
        const priorityA = a.priority ?? 999;
        const priorityB = b.priority ?? 999;
        comparison = priorityA - priorityB;
        break;
    }

    return order === 'asc' ? comparison : -comparison;
  });

  return sorted;
}

