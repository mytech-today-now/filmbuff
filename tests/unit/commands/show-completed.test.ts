import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showCompletedCommand } from '../../../cli/src/commands/showCompleted';

describe('showCompletedCommand date validation', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports invalid date filters and exits before reading completed history', () => {
    showCompletedCommand({ since: '2026-02-30' });

    expect(exitSpy).toHaveBeenCalledWith(1);

    const errorText = errorSpy.mock.calls.flat().join(' ');
    expect(errorText).toContain('Invalid --since value "2026-02-30"');
    expect(errorText).toContain('YYYY-MM-DD');
    expect(errorText).toContain('UTC calendar day');
    expect(errorText).toContain('ISO 8601 timestamp with timezone');
  });
});
