/**
 * Performance tests for module inspection (bd-modinsp.7.4)
 *
 * Benchmarks:
 *   – Module-system operations (discoverModules, search, metadata, file listing)
 *   – ContentInspector (bd-modinsp.3.1): inspectFile() cold/warm, concurrency
 *   – DependencyAnalyzer (bd-modinsp.3.2): analyzeFile() single, analyzeFiles() batch
 *   – SecurityScanner (bd-modinsp.3.3): scanFile() per language, scanFiles() batch
 *   – Combined pipeline: inspect + analyze + scan in one pass
 *
 * All benchmarks assert against documented performance targets.
 * Tests use real temp files for I/O-bound paths and in-memory content for
 * scanner benchmarks to produce reproducible timings.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'perf_hooks';
import {
  discoverModules,
  findModuleEnhanced,
  extractModuleMetadata,
  listModuleFiles
} from '../../utils/module-system';
import { PluginLoader } from '../../utils/plugin-system';
import { ConfigManager } from '../../utils/config-system';
import { ContentInspector } from '../../utils/content-inspector';
import type { ContentElement } from '../../utils/content-inspector';
import { InspectionCache } from '../../utils/inspection-cache';
import { DependencyAnalyzer } from '../../utils/dependency-analyzer';
import { scanFile, scanFiles } from '../../utils/security-scanner';

/**
 * Performance benchmark result
 */
interface BenchmarkResult {
  operation: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  opsPerSecond: number;
}

/**
 * Run a performance benchmark
 */
function benchmark(
  operation: string,
  fn: () => void | Promise<void>,
  iterations: number = 100
): BenchmarkResult {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }

  const totalTime = times.reduce((sum, time) => sum + time, 0);
  const averageTime = totalTime / iterations;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const opsPerSecond = 1000 / averageTime;

  return {
    operation,
    iterations,
    totalTime,
    averageTime,
    minTime,
    maxTime,
    opsPerSecond
  };
}

/**
 * Async benchmark
 */
async function benchmarkAsync(
  operation: string,
  fn: () => Promise<void>,
  iterations: number = 100
): Promise<BenchmarkResult> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  const totalTime = times.reduce((sum, time) => sum + time, 0);
  const averageTime = totalTime / iterations;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const opsPerSecond = 1000 / averageTime;

  return {
    operation,
    iterations,
    totalTime,
    averageTime,
    minTime,
    maxTime,
    opsPerSecond
  };
}

// ---------------------------------------------------------------------------
// Synthetic source content used for I/O-less scanner benchmarks and as
// the body written into temp files for inspector/analyzer benchmarks.
// ---------------------------------------------------------------------------

const TS_CONTENT = `
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';

export interface FileInfo {
  name: string;
  size: number;
  modified: Date;
}

export const VERSION = '1.0.0';
export const MAX_FILES = 500;

export async function readFile(filePath: string): Promise<string> {
  return fs.readFileSync(filePath, 'utf-8');
}

export function normalizePath(p: string): string {
  return path.resolve(p);
}

export class FileManager extends EventEmitter {
  private files: Map<string, FileInfo> = new Map();

  constructor(private rootDir: string) {
    super();
  }

  async loadFile(name: string): Promise<FileInfo | null> {
    return this.files.get(name) ?? null;
  }

  listFiles(): FileInfo[] {
    return [...this.files.values()];
  }

  clearFiles(): void {
    this.files.clear();
  }
}

export default FileManager;
`.trim();

const PY_CONTENT = `
import os
import json
from typing import List, Optional, Dict

FILE_VERSION = '1.0.0'
MAX_FILES = 500

def read_file(file_path: str) -> str:
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()

def normalize_path(p: str) -> str:
    return os.path.abspath(p)

class FileManager:
    """Manages a collection of files."""

    def __init__(self, root_dir: str) -> None:
        self.root_dir = root_dir
        self._files: Dict[str, dict] = {}

    async def load_file(self, name: str) -> Optional[str]:
        return self._files.get(name)

    def list_files(self) -> List[str]:
        return list(self._files.keys())

    def clear_files(self) -> None:
        self._files.clear()
`.trim();

const PHP_CONTENT = `
<?php
namespace App\\Files;

use App\\Contracts\\FileInterface;
use App\\Events\\FileLoaded;

const FILE_VERSION = '1.0.0';
const MAX_FILES = 500;

function readFile(string $path): string {
    return file_get_contents($path);
}

function normalizePath(string $p): string {
    return realpath($p);
}

class FileManager implements FileInterface {
    private array $files = [];

    public function __construct(private string $rootDir) {}

    public function loadFile(string $name): ?string {
        return $this->files[$name] ?? null;
    }

    public function listFiles(): array {
        return array_keys($this->files);
    }

    public function clearFiles(): void {
        $this->files = [];
    }
}
`.trim();

// Temp-file registry – populated in beforeAll, removed in afterAll
let tmpDir: string;
let tmpTs: string;
let tmpPy: string;
let tmpPhp: string;
const tmpTsBatch: string[] = [];

// ---------------------------------------------------------------------------
// Performance targets (milliseconds)
// ---------------------------------------------------------------------------
const PERF = {
  // ContentInspector
  inspectFileCold:  50,   // single small file, first parse
  inspectFileWarm:   2,   // cache hit
  inspectBatch10:  250,   // 10 files concurrently

  // DependencyAnalyzer
  analyzeFileSingle: 60,  // single file incl. manifest read attempt
  analyzeFileBatch10: 350,// 10 files sequentially

  // SecurityScanner (pure in-memory regex: should be sub-ms)
  scanFileSingle:    5,   // single file any language
  scanFilesBatch10: 30,   // 10 files

  // Combined pipeline
  pipeline:        200,   // inspect + analyze + scan one file
};

describe('Module Inspection Performance Tests', () => {
  // Performance thresholds (in milliseconds)
  const THRESHOLDS = {
    moduleDiscovery: 1000, // 1 second
    moduleSearch: 100, // 100ms
    metadataExtraction: 50, // 50ms
    fileList: 200, // 200ms
    pluginRegistration: 10, // 10ms
    hookExecution: 5, // 5ms
    configLoad: 20 // 20ms
  };

  describe('Module Discovery Performance', () => {
    it('should discover modules within performance threshold', () => {
      const result = benchmark('Module Discovery', () => {
        discoverModules();
      }, 10);

      console.log(`Module Discovery: ${result.averageTime.toFixed(2)}ms (avg)`);
      expect(result.averageTime).toBeLessThan(THRESHOLDS.moduleDiscovery);
    });

    it('should search modules efficiently', () => {
      const result = benchmark('Module Search', () => {
        findModuleEnhanced('typescript');
      }, 50);

      console.log(`Module Search: ${result.averageTime.toFixed(2)}ms (avg)`);
      expect(result.averageTime).toBeLessThan(THRESHOLDS.moduleSearch);
    });
  });

  describe('Metadata Extraction Performance', () => {
    it('should extract metadata within threshold', () => {
      const modules = discoverModules();
      if (modules.length === 0) {
        console.warn('No modules found for performance testing');
        return;
      }

      const testModule = modules[0];

      const result = benchmark('Metadata Extraction', () => {
        extractModuleMetadata(testModule.path);
      }, 100);

      console.log(`Metadata Extraction: ${result.averageTime.toFixed(2)}ms (avg)`);
      expect(result.averageTime).toBeLessThan(THRESHOLDS.metadataExtraction);
    });
  });

  describe('File Listing Performance', () => {
    it('should list module files efficiently', () => {
      const modules = discoverModules();
      if (modules.length === 0) {
        console.warn('No modules found for performance testing');
        return;
      }

      const testModule = modules[0];

      const result = benchmark('File Listing', () => {
        listModuleFiles(testModule.path);
      }, 50);

      console.log(`File Listing: ${result.averageTime.toFixed(2)}ms (avg)`);
      expect(result.averageTime).toBeLessThan(THRESHOLDS.fileList);
    });
  });

  describe('Plugin System Performance', () => {
    it('should register plugins quickly', async () => {
      const result = await benchmarkAsync('Plugin Registration', async () => {
        const loader = new PluginLoader();
        const plugin = {
          id: `test-plugin-${Math.random()}`,
          name: 'Test Plugin',
          version: '1.0.0',
          initialize: async () => {}
        };
        await loader.registerPlugin(plugin);
        await loader.clear();
      }, 100);

      console.log(`Plugin Registration: ${result.averageTime.toFixed(2)}ms (avg)`);
      expect(result.averageTime).toBeLessThan(THRESHOLDS.pluginRegistration);
    });
  });
});

// ===========================================================================
// Shared temp-file setup/teardown
// ===========================================================================

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modinsp-perf-'));
  tmpTs  = path.join(tmpDir, 'file-manager.ts');
  tmpPy  = path.join(tmpDir, 'file_manager.py');
  tmpPhp = path.join(tmpDir, 'FileManager.php');
  fs.writeFileSync(tmpTs,  TS_CONTENT,  'utf-8');
  fs.writeFileSync(tmpPy,  PY_CONTENT,  'utf-8');
  fs.writeFileSync(tmpPhp, PHP_CONTENT, 'utf-8');

  // Create 10 TypeScript files for batch benchmarks
  for (let i = 0; i < 10; i++) {
    const fp = path.join(tmpDir, `module-${i}.ts`);
    fs.writeFileSync(fp, TS_CONTENT.replace('FileManager', `FileManager${i}`), 'utf-8');
    tmpTsBatch.push(fp);
  }
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ===========================================================================
// ContentInspector Performance  (bd-modinsp.3.1)
// ===========================================================================

describe('ContentInspector Performance (bd-modinsp.3.1)', () => {
  it(`inspectFile() TypeScript cold parse ≤ ${PERF.inspectFileCold}ms avg`, async () => {
    const inspector = new ContentInspector(new InspectionCache({ ttl: 0, maxSize: 0 }));
    const result = await benchmarkAsync('ContentInspector cold TS', async () => {
      await inspector.inspectFile(tmpTs, { noCache: true });
    }, 20);
    console.log(`ContentInspector cold TS: ${result.averageTime.toFixed(2)}ms avg`);
    expect(result.averageTime).toBeLessThan(PERF.inspectFileCold);
  });

  it(`inspectFile() TypeScript warm cache hit ≤ ${PERF.inspectFileWarm}ms avg`, async () => {
    const inspector = new ContentInspector();
    // Prime the cache
    await inspector.inspectFile(tmpTs);
    // Measure warm reads
    const result = await benchmarkAsync('ContentInspector warm TS', async () => {
      await inspector.inspectFile(tmpTs);
    }, 50);
    console.log(`ContentInspector warm TS (cache hit): ${result.averageTime.toFixed(2)}ms avg`);
    expect(result.averageTime).toBeLessThan(PERF.inspectFileWarm);
  });

  it(`inspectFile() Python cold parse ≤ ${PERF.inspectFileCold}ms avg`, async () => {
    const inspector = new ContentInspector(new InspectionCache({ ttl: 0, maxSize: 0 }));
    const result = await benchmarkAsync('ContentInspector cold Py', async () => {
      await inspector.inspectFile(tmpPy, { noCache: true });
    }, 20);
    console.log(`ContentInspector cold Python: ${result.averageTime.toFixed(2)}ms avg`);
    expect(result.averageTime).toBeLessThan(PERF.inspectFileCold);
  });

  it(`inspectFile() PHP cold parse ≤ ${PERF.inspectFileCold}ms avg`, async () => {
    const inspector = new ContentInspector(new InspectionCache({ ttl: 0, maxSize: 0 }));
    const result = await benchmarkAsync('ContentInspector cold PHP', async () => {
      await inspector.inspectFile(tmpPhp, { noCache: true });
    }, 20);
    console.log(`ContentInspector cold PHP: ${result.averageTime.toFixed(2)}ms avg`);
    expect(result.averageTime).toBeLessThan(PERF.inspectFileCold);
  });

  it(`inspectFiles() 10-file concurrent batch total ≤ ${PERF.inspectBatch10}ms`, async () => {
    const inspector = new ContentInspector(new InspectionCache({ ttl: 0, maxSize: 0 }));
    const start = performance.now();
    await inspector.inspectFiles(tmpTsBatch, { noCache: true });
    const elapsed = performance.now() - start;
    console.log(`ContentInspector 10-file batch: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(PERF.inspectBatch10);
  });

  it('inspectFile() result has correct element counts', async () => {
    const inspector = new ContentInspector();
    const result = await inspector.inspectFile(tmpTs);
    expect(result.elements.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
    expect(['javascript', 'typescript']).toContain(result.language);
  });

  it('cacheStats() reflects populated cache', async () => {
    const cache = new InspectionCache<ContentElement[]>({ ttl: 60_000, maxSize: 50 });
    const inspector = new ContentInspector(cache);
    await inspector.inspectFile(tmpTs);
    const stats = inspector.cacheStats();
    expect(stats.size).toBeGreaterThan(0);
    expect(stats.maxSize).toBe(50);
    expect(stats.enabled).toBe(true);
  });
});

// ===========================================================================
// DependencyAnalyzer Performance  (bd-modinsp.3.2)
// ===========================================================================

describe('DependencyAnalyzer Performance (bd-modinsp.3.2)', () => {
  it(`analyzeFile() TypeScript single ≤ ${PERF.analyzeFileSingle}ms avg`, async () => {
    const analyzer = new DependencyAnalyzer();
    const result = await benchmarkAsync('DependencyAnalyzer single TS', async () => {
      await analyzer.analyzeFile(tmpTs, { projectRoot: tmpDir });
    }, 20);
    console.log(`DependencyAnalyzer single TS: ${result.averageTime.toFixed(2)}ms avg`);
    expect(result.averageTime).toBeLessThan(PERF.analyzeFileSingle);
  });

  it(`analyzeFiles() 10-file batch total ≤ ${PERF.analyzeFileBatch10}ms`, async () => {
    const analyzer = new DependencyAnalyzer();
    const start = performance.now();
    await analyzer.analyzeFiles(tmpTsBatch, { projectRoot: tmpDir });
    const elapsed = performance.now() - start;
    console.log(`DependencyAnalyzer 10-file batch: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(PERF.analyzeFileBatch10);
  });

  it('analyzeFile() result graph has expected structure', async () => {
    const analyzer = new DependencyAnalyzer();
    const graph = await analyzer.analyzeFile(tmpTs, { projectRoot: tmpDir });
    expect(graph.files).toHaveLength(1);
    expect(graph.summary.totalFiles).toBe(1);
    expect(typeof graph.summary.totalImports).toBe('number');
    expect(graph.summary.totalImports).toBeGreaterThan(0);
  });

  it(`analyzeFile() Python single ≤ ${PERF.analyzeFileSingle}ms avg`, async () => {
    const analyzer = new DependencyAnalyzer();
    const result = await benchmarkAsync('DependencyAnalyzer single Py', async () => {
      await analyzer.analyzeFile(tmpPy, { projectRoot: tmpDir });
    }, 20);
    console.log(`DependencyAnalyzer single Python: ${result.averageTime.toFixed(2)}ms avg`);
    expect(result.averageTime).toBeLessThan(PERF.analyzeFileSingle);
  });
});

// ===========================================================================
// SecurityScanner Performance  (bd-modinsp.3.3)
// ===========================================================================

describe('SecurityScanner Performance (bd-modinsp.3.3)', () => {
  // In-memory benchmarks – no disk I/O, purely regex throughput

  it(`scanFile() TypeScript content ≤ ${PERF.scanFileSingle}ms avg`, () => {
    const result = benchmark('SecurityScanner TS', () => {
      scanFile('app.ts', TS_CONTENT);
    }, 200);
    console.log(`SecurityScanner TS: ${result.averageTime.toFixed(3)}ms avg`);
    expect(result.averageTime).toBeLessThan(PERF.scanFileSingle);
  });

  it(`scanFile() Python content ≤ ${PERF.scanFileSingle}ms avg`, () => {
    const result = benchmark('SecurityScanner Python', () => {
      scanFile('app.py', PY_CONTENT);
    }, 200);
    console.log(`SecurityScanner Python: ${result.averageTime.toFixed(3)}ms avg`);
    expect(result.averageTime).toBeLessThan(PERF.scanFileSingle);
  });

  it(`scanFile() PHP content ≤ ${PERF.scanFileSingle}ms avg`, () => {
    const result = benchmark('SecurityScanner PHP', () => {
      scanFile('app.php', PHP_CONTENT);
    }, 200);
    console.log(`SecurityScanner PHP: ${result.averageTime.toFixed(3)}ms avg`);
    expect(result.averageTime).toBeLessThan(PERF.scanFileSingle);
  });

  it(`scanFiles() 10-file batch total ≤ ${PERF.scanFilesBatch10}ms`, () => {
    const batch = Array.from({ length: 10 }, (_, i) => ({
      filePath: `module-${i}.ts`,
      content: TS_CONTENT,
    }));
    const start = performance.now();
    scanFiles(batch);
    const elapsed = performance.now() - start;
    console.log(`SecurityScanner 10-file batch: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(PERF.scanFilesBatch10);
  });

  it('scanFile() result has expected shape', () => {
    const result = scanFile('app.ts', TS_CONTENT);
    expect(result.filePath).toBe('app.ts');
    expect(['javascript', 'typescript']).toContain(result.language);
    expect(typeof result.summary.total).toBe('number');
    expect(Array.isArray(result.findings)).toBe(true);
  });

  it('scanFile() ops/second reflects regex throughput', () => {
    const result = benchmark('SecurityScanner throughput', () => {
      scanFile('app.ts', TS_CONTENT);
    }, 500);
    console.log(`SecurityScanner throughput: ${result.opsPerSecond.toFixed(0)} ops/sec`);
    // Expect at least 200 scans/second on any reasonable CI machine
    expect(result.opsPerSecond).toBeGreaterThan(200);
  });
});

// ===========================================================================
// Combined Pipeline Performance  (bd-modinsp.3.1 + .3.2 + .3.3)
// ===========================================================================

describe('Combined Pipeline Performance (inspect + analyze + scan)', () => {
  it(`full pipeline single TypeScript file ≤ ${PERF.pipeline}ms`, async () => {
    const inspector = new ContentInspector(new InspectionCache({ ttl: 0, maxSize: 0 }));
    const analyzer  = new DependencyAnalyzer();
    const start = performance.now();
    await Promise.all([
      inspector.inspectFile(tmpTs, { noCache: true }),
      analyzer.analyzeFile(tmpTs, { projectRoot: tmpDir }),
    ]);
    scanFile(tmpTs, TS_CONTENT); // synchronous – no await needed
    const elapsed = performance.now() - start;
    console.log(`Combined pipeline (inspect+analyze+scan) TS: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(PERF.pipeline);
  });

  it('pipeline results are internally consistent (elements > 0, imports > 0)', async () => {
    const inspector = new ContentInspector();
    const analyzer  = new DependencyAnalyzer();
    const [inspectResult, analyzeResult] = await Promise.all([
      inspector.inspectFile(tmpTs),
      analyzer.analyzeFile(tmpTs, { projectRoot: tmpDir }),
    ]);
    const scanResult = scanFile(tmpTs, TS_CONTENT);

    expect(inspectResult.elements.length).toBeGreaterThan(0);
    expect(analyzeResult.summary.totalImports).toBeGreaterThan(0);
    expect(scanResult.summary).toBeDefined();
  });
});

