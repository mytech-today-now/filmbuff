import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CompletedHistoryCorruptionError,
  CompletedTask,
  getAllCompletedTasks,
  getCompletedTask,
  getCompletedTaskHistory,
  isTaskCompleted,
  InvalidCompletedDateFilterError,
  filterTasksByDateRange
} from '@cli/utils/beadsCompletedChecker';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  createdDirs.length = 0;
});

function createCompletedHistory(lines: string[]): string {
  const workspace = fs.mkdtempSync(path.join(tmpdir(), 'filmbuff-completed-'));
  createdDirs.push(workspace);

  const completedPath = path.join(workspace, 'scripts', 'completed.jsonl');
  fs.mkdirSync(path.dirname(completedPath), { recursive: true });
  fs.writeFileSync(completedPath, lines.join('\n'), 'utf-8');

  return completedPath;
}

function createTask(id: string, closedAt: Date): CompletedTask {
  return {
    id,
    title: `Task ${id}`,
    status: 'closed',
    closed_at: closedAt.toISOString(),
    close_reason: 'Completed'
  };
}

function taskIds(tasks: CompletedTask[]): string[] {
  return tasks.map((task) => task.id);
}

describe('beads completed checker', () => {
  it('returns clean negatives for empty files and resolves valid records', () => {
    const completedPath = createCompletedHistory([]);
    const task = {
      id: 'bd-1001',
      title: 'Finish the draft',
      status: 'closed' as const,
      closed_at: '2026-09-07T12:00:00.000Z',
      close_reason: 'Done'
    };

    expect(isTaskCompleted('bd-1001', completedPath)).toBe(false);
    expect(getCompletedTask('bd-1001', completedPath)).toBeNull();
    expect(getAllCompletedTasks(completedPath)).toEqual([]);

    fs.writeFileSync(completedPath, JSON.stringify(task), 'utf-8');

    expect(isTaskCompleted('bd-1001', completedPath)).toBe(true);
    expect(getCompletedTask('bd-1001', completedPath)).toEqual(task);
    expect(getAllCompletedTasks(completedPath)).toEqual([task]);
  });

  it('skips blank lines between valid completed records', () => {
    const task = {
      id: 'bd-1002',
      title: 'Update the outline',
      status: 'closed' as const,
      closed_at: '2026-09-08T12:00:00.000Z',
      close_reason: 'Completed'
    };
    const completedPath = createCompletedHistory([
      '',
      JSON.stringify(task),
      '   ',
      ''
    ]);

    expect(isTaskCompleted('bd-1002', completedPath)).toBe(true);
    expect(getCompletedTask('bd-1002', completedPath)).toEqual(task);
    expect(getAllCompletedTasks(completedPath)).toEqual([task]);
  });

  it('returns the last completed record when task ids are duplicated', () => {
    const firstTask = {
      id: 'bd-1003',
      title: 'Old revision',
      status: 'closed' as const,
      closed_at: '2026-09-05T12:00:00.000Z',
      close_reason: 'First pass'
    };
    const latestTask = {
      id: 'bd-1003',
      title: 'Final revision',
      status: 'closed' as const,
      closed_at: '2026-09-09T12:00:00.000Z',
      close_reason: 'Final pass'
    };
    const unrelatedTask = {
      id: 'bd-1004',
      title: 'Different task',
      status: 'closed' as const,
      closed_at: '2026-09-10T12:00:00.000Z',
      close_reason: 'Separate work'
    };
    const completedPath = createCompletedHistory([
      JSON.stringify(firstTask),
      JSON.stringify(unrelatedTask),
      JSON.stringify(latestTask)
    ]);

    expect(isTaskCompleted('bd-1003', completedPath)).toBe(true);
    expect(getCompletedTask('bd-1003', completedPath)).toEqual(latestTask);

    const allTasks = getAllCompletedTasks(completedPath);
    expect(allTasks).toHaveLength(2);
    expect(allTasks.find((task) => task.id === 'bd-1003')).toEqual(latestTask);
    expect(allTasks.find((task) => task.id === 'bd-1004')).toEqual(unrelatedTask);
  });

  it('reports corruption without dropping valid completed records', () => {
    const validTask = {
      id: 'bd-1005',
      title: 'Valid completed record',
      status: 'closed' as const,
      closed_at: '2026-09-11T12:00:00.000Z',
      close_reason: 'Completed'
    };
    const completedPath = createCompletedHistory([
      '{"id":"bd-broken"',
      JSON.stringify(validTask)
    ]);

    const assertCorruption = (lookup: () => unknown): void => {
      try {
        lookup();
        throw new Error('Expected a CompletedHistoryCorruptionError');
      } catch (error) {
        expect(error).toBeInstanceOf(CompletedHistoryCorruptionError);
        if (error instanceof CompletedHistoryCorruptionError) {
          expect(error.completedPath).toBe(completedPath);
          expect(error.lineNumber).toBe(1);
        }
      }
    };

    assertCorruption(() => isTaskCompleted('bd-missing', completedPath));
    assertCorruption(() => getCompletedTask('bd-missing', completedPath));
    assertCorruption(() => getAllCompletedTasks(completedPath));

    const history = getCompletedTaskHistory(completedPath);
    expect(history.tasks).toEqual([validTask]);
    expect(history.corruption).toBeInstanceOf(CompletedHistoryCorruptionError);
    if (history.corruption instanceof CompletedHistoryCorruptionError) {
      expect(history.corruption.completedPath).toBe(completedPath);
      expect(history.corruption.lineNumber).toBe(1);
    }
  }, 20_000);

  describe('date range filtering', () => {
    it('rejects invalid date filters before applying the range', () => {
      const tasks = [createTask('bd-2001', new Date(2026, 8, 11, 12, 0, 0, 0))];

      expect(() => filterTasksByDateRange(tasks, '2026-02-30')).toThrow(
        InvalidCompletedDateFilterError
      );
      expect(() => filterTasksByDateRange(tasks, undefined, 'not-a-date')).toThrow(
        InvalidCompletedDateFilterError
      );
    });

    it('treats bare dates as local-day windows and keeps open-ended filters working', () => {
      const tasks = [
        createTask('bd-2002', new Date(2026, 8, 10, 18, 0, 0, 0)),
        createTask('bd-2003', new Date(2026, 8, 11, 0, 15, 0, 0)),
        createTask('bd-2004', new Date(2026, 8, 11, 23, 30, 0, 0)),
        createTask('bd-2005', new Date(2026, 8, 12, 0, 15, 0, 0))
      ];

      expect(taskIds(filterTasksByDateRange(tasks, '2026-09-11', '2026-09-11'))).toEqual([
        'bd-2003',
        'bd-2004'
      ]);

      expect(taskIds(filterTasksByDateRange(tasks, '2026-09-11'))).toEqual([
        'bd-2003',
        'bd-2004',
        'bd-2005'
      ]);

      expect(taskIds(filterTasksByDateRange(tasks, undefined, '2026-09-11'))).toEqual([
        'bd-2002',
        'bd-2003',
        'bd-2004'
      ]);
    });

    it('keeps midnight-edge tasks inside the correct local day and rejects timezone-free timestamps', () => {
      const tasks = [
        createTask('bd-2006', new Date(2026, 8, 11, 23, 59, 59, 999)),
        createTask('bd-2007', new Date(2026, 8, 12, 0, 0, 0, 0)),
        createTask('bd-2008', new Date(2026, 8, 12, 0, 0, 0, 1))
      ];

      expect(() => filterTasksByDateRange(tasks, '2026-09-11T00:00:00')).toThrow(
        InvalidCompletedDateFilterError
      );

      expect(taskIds(filterTasksByDateRange(tasks, '2026-09-11', '2026-09-11'))).toEqual([
        'bd-2006'
      ]);

      expect(taskIds(filterTasksByDateRange(tasks, '2026-09-12', '2026-09-12'))).toEqual([
        'bd-2007',
        'bd-2008'
      ]);
    });
  });
});
