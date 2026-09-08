/**
 * Integration coverage for AI fallback behavior in generate-shot-list.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const runLoggerInstances: Array<{ logPath: string }> = [];
const mockGetFilmbuffAiClient = jest.fn();

jest.mock('../../utils/filmbuff-ai-client', () => ({
  getFilmbuffAiClient: (...args: unknown[]) => mockGetFilmbuffAiClient(...args),
}));

jest.mock('../../commands/generate-shot-list/generator', () => {
  const actual = jest.requireActual<typeof import('../../commands/generate-shot-list/generator')>(
    '../../commands/generate-shot-list/generator'
  );
  return {
    ...actual,
    applyBudgetWarning: jest.fn(),
  };
});

jest.mock('../../commands/generate-shot-list/exit-codes', () => {
  const actual = jest.requireActual<typeof import('../../commands/generate-shot-list/exit-codes')>(
    '../../commands/generate-shot-list/exit-codes'
  );
  return {
    ...actual,
    exitWithCode: jest.fn(),
  };
});

jest.mock('../../utils/run-logger', () => {
  const actual = jest.requireActual<typeof import('../../utils/run-logger')>(
    '../../utils/run-logger'
  );

  class MockRunLogger {
    readonly logPath: string;

    constructor(logPath: string) {
      this.logPath = logPath;
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, '', 'utf-8');
      runLoggerInstances.push(this);
    }

    start(header?: string): void {
      if (header) {
        fs.appendFileSync(this.logPath, `${header}\n`, 'utf-8');
      }
    }

    stop(): void {}

    writeDirectly(text: string): void {
      fs.appendFileSync(this.logPath, text, 'utf-8');
    }
  }

  return {
    ...actual,
    RunLogger: MockRunLogger,
  };
});

import { generateShotListCommand } from '../../commands/generate-shot-list';
import { AIEntityExtractor } from '../../commands/generate-shot-list/generator/ai-entity-extractor';
import { computeRunLogPath } from '../../utils/run-logger';

jest.setTimeout(30000);

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function serializeConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') {
        return stripAnsi(arg);
      }

      if (arg instanceof Error) {
        return arg.stack ?? arg.message;
      }

      if (arg && typeof arg === 'object') {
        try {
          return stripAnsi(JSON.stringify(arg));
        } catch {
          return String(arg);
        }
      }

      return String(arg);
    })
    .join(' ');
}

function createConsoleCapture(logPath: string) {
  const spies = [
    jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      fs.appendFileSync(logPath, `${serializeConsoleArgs(args)}\n`, 'utf-8');
    }),
    jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      fs.appendFileSync(logPath, `${serializeConsoleArgs(args)}\n`, 'utf-8');
    }),
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      fs.appendFileSync(logPath, `${serializeConsoleArgs(args)}\n`, 'utf-8');
    }),
    jest.spyOn(console, 'debug').mockImplementation((...args: unknown[]) => {
      fs.appendFileSync(logPath, `${serializeConsoleArgs(args)}\n`, 'utf-8');
    }),
  ];

  return spies;
}

function removeNewListeners(eventName: 'exit' | 'uncaughtException' | 'unhandledRejection', baseline: Function[]): void {
  for (const listener of (process as any).listeners(eventName) as Function[]) {
    if (!baseline.includes(listener)) {
      (process as any).removeListener(eventName, listener);
    }
  }
}

describe('generate-shot-list AI fallback', () => {
  const fixturePath = path.join(__dirname, '../fixtures/test-film.fountain');
  let tmpDir: string;
  let consoleSpies: Array<jest.SpyInstance> = [];
  let exitBaseline: Function[] = [];
  let exceptionBaseline: Function[] = [];
  let rejectionBaseline: Function[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filmbuff-ai-fallback-'));
    runLoggerInstances.length = 0;
    mockGetFilmbuffAiClient.mockReset();
    delete process.env.FILMBUFF_AI_FALLBACK_DEBUG;
    exitBaseline = process.listeners('exit');
    exceptionBaseline = process.listeners('uncaughtException');
    rejectionBaseline = process.listeners('unhandledRejection');
  });

  afterEach(() => {
    for (const spy of consoleSpies.reverse()) {
      spy.mockRestore();
    }
    consoleSpies = [];
    removeNewListeners('exit', exitBaseline);
    removeNewListeners('uncaughtException', exceptionBaseline);
    removeNewListeners('unhandledRejection', rejectionBaseline);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('falls back once, keeps the output file, and leaves the run log readable', async () => {
    const outputPath = path.join(tmpDir, 'shot-list.txt');
    const runLogPath = computeRunLogPath(fixturePath, outputPath);
    fs.writeFileSync(runLogPath, '', 'utf-8');

    const missingDependency = Object.assign(
      new Error("Cannot find module 'ai-powered'"),
      { code: 'ERR_MODULE_NOT_FOUND' }
    );
    mockGetFilmbuffAiClient.mockRejectedValue(missingDependency);
    consoleSpies = createConsoleCapture(runLogPath);

    await generateShotListCommand({
      input: fixturePath,
      output: outputPath,
      format: 'txt',
      offline: true,
      logging: false,
    });

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);

    const warnMessages = consoleSpies[1].mock.calls.map((call) => serializeConsoleArgs(call));
    const errorMessages = consoleSpies[2].mock.calls.map((call) => serializeConsoleArgs(call));
    const logContents = fs.readFileSync(runLogPath, 'utf-8');

    expect(warnMessages).toHaveLength(1);
    expect(warnMessages[0]).toContain('AI dependency unavailable; using fallback extraction for this run.');
    expect(errorMessages).toHaveLength(0);
    expect(logContents).toContain('AI dependency unavailable; using fallback extraction for this run.');
    expect(logContents).not.toContain('ERR_MODULE_NOT_FOUND');
  });

  it('still logs the normal success path when AI extraction returns content', async () => {
    const fakeClient = {
      generateText: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          characters: ['ALEX'],
          objects: ['TABLE'],
        }),
      }),
    };
    mockGetFilmbuffAiClient.mockResolvedValue(fakeClient);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleSpies = [logSpy, warnSpy];

    const extractor = new AIEntityExtractor();
    const result = await extractor.extractEntities('ALEX enters. A TABLE sits nearby.', 'INT. ROOM - DAY');

    expect(result.characters).toEqual(['ALEX']);
    expect(result.objects).toEqual(['TABLE']);
    expect(logSpy.mock.calls.some((call) => serializeConsoleArgs(call).includes('AI extracted 1 characters and 1 objects'))).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
