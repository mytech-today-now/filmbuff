import chalk from 'chalk';
import { ProgressBar, Spinner } from './progress';

export type OutputChannelLevel = 'info' | 'warn' | 'error' | 'success';

export interface OutputChannelEntry {
  level: OutputChannelLevel;
  message: string;
  timestamp: string;
}

export class InspectionOutputChannel {
  private entries: OutputChannelEntry[] = [];
  private spinner: Spinner | null = null;
  private progressBar: ProgressBar | null = null;

  write(message: string): void {
    this.record('info', message);
    process.stdout.write(`${message}\n`);
  }

  info(message: string): void {
    this.record('info', message);
    process.stderr.write(`${chalk.cyan(message)}\n`);
  }

  warn(message: string): void {
    this.record('warn', message);
    process.stderr.write(`${chalk.yellow(message)}\n`);
  }

  error(message: string): void {
    this.record('error', message);
    process.stderr.write(`${chalk.red(message)}\n`);
  }

  success(message: string): void {
    this.record('success', message);
    process.stderr.write(`${chalk.green(message)}\n`);
  }

  startSpinner(message: string): void {
    this.stopSpinner();
    this.spinner = new Spinner(message);
    this.spinner.start();
  }

  updateSpinner(message: string): void {
    this.spinner?.setText(message);
  }

  stopSpinner(finalMessage?: string): void {
    if (!this.spinner) {
      return;
    }

    this.spinner.stop(finalMessage);
    if (finalMessage) {
      this.record('success', finalMessage);
    }
    this.spinner = null;
  }

  startProgress(total: number): void {
    this.progressBar = new ProgressBar({ total });
  }

  updateProgress(current: number, tokens?: Record<string, unknown>): void {
    this.progressBar?.update(current, tokens);
  }

  tickProgress(delta: number = 1, tokens?: Record<string, unknown>): void {
    this.progressBar?.tick(delta, tokens);
  }

  completeProgress(finalMessage?: string): void {
    if (this.progressBar) {
      this.progressBar.complete();
      this.progressBar = null;
    }

    if (finalMessage) {
      this.success(finalMessage);
    }
  }

  clear(): void {
    this.stopSpinner();
    this.progressBar = null;
    this.entries = [];
  }

  reset(): void {
    this.clear();
  }

  getEntries(): OutputChannelEntry[] {
    return [...this.entries];
  }

  private record(level: OutputChannelLevel, message: string): void {
    this.entries.push({
      level,
      message,
      timestamp: new Date().toISOString()
    });
  }
}