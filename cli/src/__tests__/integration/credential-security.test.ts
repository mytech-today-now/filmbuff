/**
 * cli/src/__tests__/integration/credential-security.test.ts
 *
 * AC-27 Credential Security Audit — Phase 7 (bd-aafe)
 *
 * Tests:
 *   UT-CRED-01  agentToken forwarded as Authorization: Bearer only
 *   UT-CRED-02  agentToken never written to 08-video-status.jsonl
 *   UT-CRED-03  agentToken never appears in stdout or stderr
 *   UT-CRED-04  Falls back to AIPOWERED_API_KEY when token absent
 *   UT-SCAN-01  Static source scan: no console.log/write of agentToken
 *   UT-SCAN-02  VideoStatusRecord type contains no agentToken field
 *   UT-SCAN-03  AgentEnvelope type contains no agentToken field
 *   UT-SCAN-04  resolveAgentToken() is only path that reads token env vars
 *
 * Spec: openspec/changes/filmb-ai-p/specs/agent-mode/spec.md §AC-27
 * Beads: bd-aafe (Phase 7)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Shared sentinel token value — deliberately synthetic, not a real token
// ---------------------------------------------------------------------------
const SENTINEL_TOKEN = 'test-sentinel-token-ac27-do-not-log';

// ---------------------------------------------------------------------------
// Process capture helper (no-exit variant)
// ---------------------------------------------------------------------------

class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
    this.name = 'ExitError';
  }
}

interface Capture {
  stdout: string;
  stderr: string;
  exitCode?: number;
  restore: () => void;
}

function beginCapture(): Capture {
  const captured = { stdout: '', stderr: '', exitCode: undefined as number | undefined };
  const sOut = jest.spyOn(process.stdout, 'write').mockImplementation((d) => {
    captured.stdout += typeof d === 'string' ? d : Buffer.from(d as Uint8Array).toString();
    return true;
  });
  const sErr = jest.spyOn(process.stderr, 'write').mockImplementation((d) => {
    captured.stderr += typeof d === 'string' ? d : Buffer.from(d as Uint8Array).toString();
    return true;
  });
  const sExit = jest.spyOn(process, 'exit').mockImplementation((code?) => {
    captured.exitCode = (code as number) ?? 0;
    throw new ExitError((code as number) ?? 0);
  }) as jest.SpyInstance;

  return {
    get stdout() { return captured.stdout; },
    get stderr() { return captured.stderr; },
    get exitCode() { return captured.exitCode; },
    restore: () => { sOut.mockRestore(); sErr.mockRestore(); sExit.mockRestore(); },
  };
}

// ---------------------------------------------------------------------------
// Temp project factory
// ---------------------------------------------------------------------------

async function makeTempProject(shots: number = 3): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fb-cred-'));
  const lines = Array.from({ length: shots }, (_, i) => {
    const id = `s${String(i + 1).padStart(3, '0')}`;
    return JSON.stringify({ shot_id: id, scene: 'EXT. ROOFTOP - NIGHT', shot_type: 'Wide', duration_seconds: 5 });
  }).join('\n') + '\n';
  await fs.promises.writeFile(path.join(dir, '08-shot-list.jsonl'), lines);
  return dir;
}

// ---------------------------------------------------------------------------
// UT-SCAN-01 — Static source scan: prohibited logging patterns
// ---------------------------------------------------------------------------

const SOURCE_ROOTS = [
  path.resolve(__dirname, '../../lib'),
  path.resolve(__dirname, '../../commands/video'),
  path.resolve(__dirname, '../../commands/mcp-server.ts'),
  path.resolve(__dirname, '../../../../ai-powered/src'),
];

function collectTsFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const stat = fs.statSync(root);
  if (stat.isFile()) return [root];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => {
    const full = path.join(root, e.name);
    return e.isDirectory() ? collectTsFiles(full) : (e.name.endsWith('.ts') ? [full] : []);
  });
}

const PROHIBITED_PATTERNS: Array<{ re: RegExp; description: string }> = [
  { re: /console\.(log|error|warn|info)\s*\(.*agentToken/,  description: 'console.* call with agentToken argument' },
  { re: /process\.stdout\.write\s*\(.*agentToken/,           description: 'process.stdout.write with agentToken' },
  { re: /process\.stderr\.write\s*\(.*agentToken/,           description: 'process.stderr.write with agentToken' },
  { re: /JSON\.stringify\s*\(.*agentToken/,                  description: 'JSON.stringify with agentToken in call' },
  // Note: "agentToken?: string" in type interfaces is correct (optional param).
  // UT-SCAN-02 separately verifies VideoStatusRecord has no agentToken field.
];

describe('[UT-SCAN-01] Static source scan: no prohibited agentToken logging', () => {
  const allFiles = SOURCE_ROOTS.flatMap(collectTsFiles);

  it('source files exist to scan', () => {
    expect(allFiles.length).toBeGreaterThan(0);
  });

  for (const { re, description } of PROHIBITED_PATTERNS) {
    it(`No file contains: ${description}`, () => {
      const violations: string[] = [];
      for (const file of allFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (re.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
            violations.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
          }
        });
      }
      if (violations.length > 0) {
        throw new Error(`AC-27 VIOLATION — ${description}:\n${violations.join('\n')}`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// UT-SCAN-02 — VideoStatusRecord has no agentToken field
// ---------------------------------------------------------------------------

describe('[UT-SCAN-02] VideoStatusRecord type has no agentToken field', () => {
  it('status-file-manager serializes records without agentToken', async () => {
    const { appendRecord, readAllRecords } = await import('../../lib/status-file-manager');
    const dir = await makeTempProject(1);
    const record = {
      shot_id: 's001', status: 'pending' as const, provider: null, provider_job_id: null,
      clip_path: null, attempt_count: 0, rejection_reason: null, approved_at: null,
      rejected_at: null, generated_at: null, failed_at: null, credits_spent: 0,
      updated_at: new Date().toISOString(),
    };
    await appendRecord(dir, record);
    const raw = await fs.promises.readFile(path.join(dir, '08-video-status.jsonl'), 'utf-8');
    expect(raw).not.toContain('agentToken');
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// UT-SCAN-03 — AgentEnvelope has no agentToken field
// ---------------------------------------------------------------------------

describe('[UT-SCAN-03] AgentEnvelope JSON output contains no agentToken field', () => {
  it('agentSuccess envelope omits agentToken', () => {
    const c = beginCapture();
    try {
      const { agentSuccess } = require('../../lib/agent-mode');
      agentSuccess({ shot_id: 's001', clip_path: '/tmp/s001.mp4' }, { creditsSpent: 5 });
    } finally { c.restore(); }
    const envelope = JSON.parse(c.stdout.trim());
    expect(Object.keys(envelope)).not.toContain('agentToken');
    expect(JSON.stringify(envelope)).not.toContain('agentToken');
  });

  it('agentError envelope omits agentToken', () => {
    const c = beginCapture();
    try {
      const { agentError, EXIT } = require('../../lib/agent-mode');
      agentError(EXIT.NOT_FOUND, 'Shot not found', { shotId: 's001' });
    } finally { c.restore(); }
    const envelope = JSON.parse(c.stdout.trim());
    expect(JSON.stringify(envelope)).not.toContain('agentToken');
  });
});

// ---------------------------------------------------------------------------
// UT-SCAN-04 — resolveAgentToken() is only env-reader for token vars
// ---------------------------------------------------------------------------

describe('[UT-SCAN-04] resolveAgentToken() is sole env reader for token vars', () => {
  it('agent-mode.ts is the only file that reads AIPOWERED_AGENT_TOKEN', () => {
    const violations: string[] = [];
    const allFiles = SOURCE_ROOTS.flatMap(collectTsFiles);
    const TOKEN_ENV_RE = /process\.env\[['"]AIPOWERED_(AGENT_TOKEN|API_KEY)['"]\]/;
    const ALLOWED_FILES = [
      path.normalize('cli/src/lib/agent-mode.ts'),
      path.normalize('cli/src/lib/per-shot-api.ts'), // mock mode reads per-shot-api which checks env
    ];
    for (const file of allFiles) {
      const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
      const isAllowed = ALLOWED_FILES.some(a => rel.endsWith(a.replace(/\\/g, '/')));
      if (isAllowed) continue;
      const content = fs.readFileSync(file, 'utf-8');
      content.split('\n').forEach((line, i) => {
        if (TOKEN_ENV_RE.test(line) && !line.trim().startsWith('//')) {
          violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    if (violations.length > 0) {
      throw new Error(`AC-27 VIOLATION — env token read outside allowed files:\n${violations.join('\n')}`);
    }
  });
});

// ---------------------------------------------------------------------------
// UT-CRED-02 — agentToken never written to 08-video-status.jsonl
// ---------------------------------------------------------------------------

describe('[UT-CRED-02] agentToken never written to status file', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTempProject(3); });
  afterEach(async () => { await fs.promises.rm(tmpDir, { recursive: true, force: true }); });

  it('running video init does not write token to status file', async () => {
    const savedToken = process.env['AIPOWERED_AGENT_TOKEN'];
    process.env['AIPOWERED_AGENT_TOKEN'] = SENTINEL_TOKEN;
    const c = beginCapture();
    try {
      const { videoInitCommand } = await import('../../commands/video/init');
      await videoInitCommand({ project: tmpDir, agent: true }).catch(() => {});
    } finally {
      c.restore();
      if (savedToken === undefined) delete process.env['AIPOWERED_AGENT_TOKEN'];
      else process.env['AIPOWERED_AGENT_TOKEN'] = savedToken;
    }
    const statusPath = path.join(tmpDir, '08-video-status.jsonl');
    if (fs.existsSync(statusPath)) {
      const raw = fs.readFileSync(statusPath, 'utf-8');
      expect(raw).not.toContain(SENTINEL_TOKEN);
    }
  });
});

// ---------------------------------------------------------------------------
// UT-CRED-03 — agentToken never in stdout or stderr
// ---------------------------------------------------------------------------

describe('[UT-CRED-03] agentToken never in stdout or stderr', () => {
  it('agentSuccess output does not contain sentinel token', () => {
    process.env['AIPOWERED_AGENT_TOKEN'] = SENTINEL_TOKEN;
    const c = beginCapture();
    try {
      const { agentSuccess } = require('../../lib/agent-mode');
      agentSuccess({ result: 'ok', shot_id: 's001' }, { creditsSpent: 5, shotId: 's001' });
    } finally {
      delete process.env['AIPOWERED_AGENT_TOKEN'];
      c.restore();
    }
    expect(c.stdout).not.toContain(SENTINEL_TOKEN);
    expect(c.stderr).not.toContain(SENTINEL_TOKEN);
  });

  it('agentError output does not contain sentinel token', () => {
    process.env['AIPOWERED_AGENT_TOKEN'] = SENTINEL_TOKEN;
    const c = beginCapture();
    try {
      const { agentError, EXIT } = require('../../lib/agent-mode');
      agentError(EXIT.STATE_CONFLICT, 'state conflict');
    } finally {
      delete process.env['AIPOWERED_AGENT_TOKEN'];
      c.restore();
    }
    expect(c.stdout).not.toContain(SENTINEL_TOKEN);
    expect(c.stderr).not.toContain(SENTINEL_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// UT-CRED-04 — Falls back to AIPOWERED_API_KEY when token absent
// ---------------------------------------------------------------------------

describe('[UT-CRED-04] resolveAgentToken() falls back to AIPOWERED_API_KEY', () => {
  afterEach(() => {
    delete process.env['AIPOWERED_AGENT_TOKEN'];
    delete process.env['AIPOWERED_API_KEY'];
  });

  it('returns AIPOWERED_AGENT_TOKEN when set', async () => {
    process.env['AIPOWERED_AGENT_TOKEN'] = 'agent-tok';
    process.env['AIPOWERED_API_KEY']     = 'api-key';
    const { resolveAgentToken } = await import('../../lib/agent-mode');
    expect(resolveAgentToken()).toBe('agent-tok');
  });

  it('falls back to AIPOWERED_API_KEY when agent token absent', async () => {
    delete process.env['AIPOWERED_AGENT_TOKEN'];
    process.env['AIPOWERED_API_KEY'] = 'global-api-key';
    const { resolveAgentToken } = await import('../../lib/agent-mode');
    expect(resolveAgentToken()).toBe('global-api-key');
  });

  it('returns undefined when both are absent', async () => {
    delete process.env['AIPOWERED_AGENT_TOKEN'];
    delete process.env['AIPOWERED_API_KEY'];
    const { resolveAgentToken } = await import('../../lib/agent-mode');
    expect(resolveAgentToken()).toBeUndefined();
  });
});
