import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import {
  beginInspection,
  completeInspection,
  getLastInspectionReportPath,
  getModuleInspectionStatus,
  getInspectionStatusPath,
  readInspectionStatus
} from '@cli/utils/inspection-status';

const testRoot = path.join(tmpdir(), 'filmbuff-inspection-status-tests');

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe('inspection-status', () => {
  it('persists running and completed inspection state', () => {
    const reportPath = path.join(testRoot, 'report.html');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, '<html></html>', 'utf-8');

    beginInspection('coding-standards/test-module', 'webview', testRoot);
    completeInspection({
      moduleName: 'coding-standards/test-module',
      action: 'webview',
      cwd: testRoot,
      lastReportPath: reportPath,
      details: 'Report completed successfully.'
    });

    const status = readInspectionStatus(testRoot);
    expect(status.state).toBe('complete');
    expect(status.lastAction).toBe('webview');
    expect(status.lastReportPath).toBe(reportPath);
    expect(fs.existsSync(getInspectionStatusPath(testRoot))).toBe(true);
    expect(getLastInspectionReportPath('coding-standards/test-module', testRoot)).toBe(reportPath);
  });

  it('returns idle status for unrelated modules', () => {
    beginInspection('coding-standards/alpha', 'recommendations', testRoot);
    const status = getModuleInspectionStatus('coding-standards/beta', testRoot);

    expect(status.state).toBe('idle');
    expect(status.tooltip).toContain('No saved inspection state');
  });
});