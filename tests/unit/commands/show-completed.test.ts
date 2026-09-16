import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showCompletedCommand } from '../../../cli/src/commands/showCompleted';

describe('showCompletedCommand date validation', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    cwdSpy = vi.spyOn(process, 'cwd').mockImplementation(() => {
      throw new Error('cwd should not be called for invalid completed date filters');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['since', '2026-02-30'],
    ['until', 'not-a-date']
  ] as const)('reports invalid %s filters and exits before reading completed history', (filterName, value) => {
    showCompletedCommand({ [filterName]: value } as { since?: string; until?: string });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(cwdSpy).not.toHaveBeenCalled();

    const errorText = errorSpy.mock.calls.flat().join(' ');
    expect(errorText).toContain(`Invalid --${filterName} value "${value}"`);
    expect(errorText).toContain('YYYY-MM-DD');
    expect(errorText).toContain('UTC calendar day');
    expect(errorText).toContain('ISO 8601 timestamp with timezone');
  });
});
