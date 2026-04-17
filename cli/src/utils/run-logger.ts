/**
 * run-logger.ts
 *
 * Tees ALL terminal output to a plain-text run log file, capturing:
 *   • console.log / console.error output (chalk-formatted app messages)
 *   • pino / sonic-boom library logs (AI cost, tokens, latency)
 *   • Any other writes to fd 1 (stdout) or fd 2 (stderr)
 *
 * How it works
 * ------------
 * Node.js has two independent paths to fd 1 / fd 2:
 *
 *   Path A — process.stdout.write / process.stderr.write
 *     Used by console.log, chalk, and most Node.js app code.
 *
 *   Path B — fs.write(1, …) / fs.writeSync(1, …)
 *     Used by pino's sonic-boom transport, which calls the fs binding
 *     directly and therefore bypasses process.stdout.write entirely.
 *
 * We patch both paths.  Writes via Path B use `origFsWrite` /
 * `origFsWriteSync` (saved before patching) so there is no circular
 * recursion when appendFileSync internally opens and writes to its own fd.
 *
 * Design choices
 * --------------
 *  - appendFileSync for all tee writes → data is on disk even inside an
 *    exit handler or uncaughtException handler.
 *  - ANSI escape codes are stripped so the log is clean plain text.
 *  - originals are saved before any patching so restore is always clean.
 */

import * as fs from 'fs';
import * as path from 'path';

// The namespace import (`import * as fs`) uses TypeScript's __importStar which
// wraps each export as a getter-only live binding — direct assignment fails.
// `require('fs')` returns the raw CJS module object whose properties ARE
// writable, so we use it for patching fs.writeSync / fs.write.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsReal = require('fs') as typeof fs;

// Matches all ANSI CSI sequences (colours, cursor moves, etc.)
const ANSI_RE = /\x1B\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/**
 * RunLogger tees ALL stdout/stderr output to a log file for one run.
 *
 * Usage:
 *   const rl = new RunLogger('/path/to/run.log');
 *   rl.start(headerString);
 *   // ... all console/process output captured (including pino logs) ...
 *   rl.stop();
 */
export class RunLogger {
  readonly logPath: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private origStdout!:        (...args: any[]) => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private origStderr!:        (...args: any[]) => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private origFsWriteSync!:   (...args: any[]) => number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private origFsWrite!:       (...args: any[]) => void;

  private active = false;

  constructor(logPath: string) {
    this.logPath = logPath;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    // Touch the file early — surfaces permission errors before generation starts.
    fs.writeFileSync(logPath, '', 'utf-8');
  }

  /**
   * Begin tee-ing.  Patches both process.stdout/stderr (Path A — console.log)
   * and fs.write/fs.writeSync (Path B — pino/sonic-boom).
   * Writes an optional header block at the top of the log.
   */
  start(header?: string): void {
    if (this.active) return;
    this.active = true;

    // ── Save originals ─────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.origStdout      = (process.stdout.write as any).bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.origStderr      = (process.stderr.write as any).bind(process.stderr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.origFsWriteSync = (fsReal.writeSync as any).bind(fsReal);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.origFsWrite     = (fsReal.write as any).bind(fsReal);

    const self = this;

    // ── Path A: process.stdout.write / process.stderr.write ────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = function (chunk: any, ...args: any[]): boolean {
      self._teeChunk(chunk);
      return self.origStdout(chunk, ...args);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = function (chunk: any, ...args: any[]): boolean {
      self._teeChunk(chunk);
      return self.origStderr(chunk, ...args);
    };

    // ── Path B: fs.writeSync / fs.write — used by pino / sonic-boom ────────
    // We patch the raw CJS module object (`fsReal = require('fs')`) because the
    // namespace import's properties are getter-only live bindings.  sonic-boom
    // also uses `require('fs').writeSync`, so patching fsReal affects it too.
    // The tee writes appendFileSync which opens its own fd (never 1 or 2),
    // so there is no risk of recursion.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fsReal.writeSync = function (fd: number, buffer: any, ...args: any[]): number {
      if (fd === 1 || fd === 2) {
        process.stderr.write(`[RunLogger DEBUG] writeSync fd=${fd} type=${typeof buffer}\n`);
        self._teeChunk(buffer);
      }
      return self.origFsWriteSync(fd, buffer, ...args);
    } as typeof fs.writeSync;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fsReal.write = function (fd: number, buffer: any, ...args: any[]): void {
      if (fd === 1 || fd === 2) {
        process.stderr.write(`[RunLogger DEBUG] write fd=${fd} type=${typeof buffer}\n`);
        self._teeChunk(buffer);
      }
      return self.origFsWrite(fd, buffer, ...args);
    } as typeof fs.write;

    if (header) {
      this._appendRaw(header + '\n');
    }
  }

  /**
   * Stop tee-ing and restore all original write functions.
   * Safe to call multiple times.
   */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = this.origStdout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = this.origStderr;
    fsReal.writeSync = this.origFsWriteSync as typeof fs.writeSync;
    fsReal.write     = this.origFsWrite     as typeof fs.write;
  }

  /**
   * Write text directly to the log file only (not shown in the terminal).
   * Used for footers written from exit / uncaughtException handlers.
   */
  writeDirectly(text: string): void {
    this._appendRaw(text);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private _teeChunk(chunk: unknown): void {
    try {
      const raw = Buffer.isBuffer(chunk)
        ? chunk.toString('utf-8')
        : String(chunk);
      const text = stripAnsi(raw);
      if (text) this._appendRaw(text);
    } catch {
      // Never surface logging errors to the caller
    }
  }

  private _appendRaw(text: string): void {
    try {
      fs.appendFileSync(this.logPath, text, 'utf-8');
    } catch {
      // Silently ignore — log failures must never crash the CLI
    }
  }
}

/**
 * Compute a timestamped log file path next to the output file
 * (or next to the input file when no output path is specified).
 *
 * Examples:
 *   output = .../independent-monologue.jsonl
 *   →  log  = .../independent-monologue-2026-04-17T14-38-08.log
 *
 *   no output, input = .../screenplay.fountain
 *   →  log  = .../screenplay-2026-04-17T14-38-08.log
 */
export function computeRunLogPath(
  inputPath: string,
  outputPath?: string | null,
): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, '-')   // colons → hyphens (Windows-safe filenames)
    .replace(/\..+$/, ''); // drop milliseconds

  if (outputPath) {
    const resolved = path.resolve(outputPath);
    return path.join(
      path.dirname(resolved),
      `${path.basename(resolved, path.extname(resolved))}-${timestamp}.log`,
    );
  }

  const resolved = path.resolve(inputPath);
  return path.join(
    path.dirname(resolved),
    `${path.basename(resolved, path.extname(resolved))}-${timestamp}.log`,
  );
}
