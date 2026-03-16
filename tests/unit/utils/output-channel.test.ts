import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InspectionOutputChannel } from '@cli/utils/output-channel';

describe('InspectionOutputChannel', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as any);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as any);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('records log entries and resets them', () => {
    const channel = new InspectionOutputChannel();
    channel.info('loading');
    channel.warn('warning');
    channel.error('failure');

    expect(channel.getEntries()).toHaveLength(3);
    channel.reset();
    expect(channel.getEntries()).toHaveLength(0);
  });

  it('supports spinner and progress lifecycle', () => {
    const channel = new InspectionOutputChannel();

    channel.startSpinner('working');
    vi.advanceTimersByTime(100);
    channel.stopSpinner('done');

    channel.startProgress(2);
    channel.tickProgress();
    channel.completeProgress('complete');

    expect(stderrSpy).toHaveBeenCalled();
    expect(channel.getEntries().some(entry => entry.message === 'done')).toBe(true);
    expect(channel.getEntries().some(entry => entry.message === 'complete')).toBe(true);
  });
});