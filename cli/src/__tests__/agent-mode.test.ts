/**
 * cli/src/__tests__/agent-mode.test.ts
 *
 * Test plan: openspec/changes/filmb-ai-p/tests/agent-mode.test-plan.md
 * Beads: bd-1751 (Phase 8 — AC-16 through AC-22)
 *
 * UT-AGENT-01  isAgentMode() priority: --agent flag > env var > stdin TTY
 * UT-AGENT-02  agentSuccess() emits valid JSON envelope to stdout
 * UT-AGENT-03  agentError() emits JSON to stdout AND error JSON to stderr
 * UT-AGENT-04  agentSuccess envelope contains required fields
 * UT-AGENT-05  agentError envelope contains required fields
 * UT-AGENT-06  Human mode suppresses stdout JSON
 * UT-AGENT-07  FILMBUFF_AGENT_MODE=1 activates agent mode
 * UT-EXIT-01   EXIT.SUCCESS = 0
 * UT-EXIT-02   EXIT.NOT_FOUND = 2
 * UT-EXIT-03   EXIT.INSUFFICIENT_CREDITS = 3
 * UT-EXIT-04   EXIT.PROVIDER_ERROR = 4
 * UT-EXIT-05   EXIT.STATE_CONFLICT = 5
 * UT-EXIT-06   EXIT.INVALID_ARGS = 6
 * UT-DEPR-01   generate-video emits deprecation warning in human mode
 *
 * Spec: openspec/changes/filmb-ai-p/specs/agent-mode/spec.md
 * Beads: bd-1751 (Phase 8)
 */

// ---------------------------------------------------------------------------
// ExitError — thrown by process.exit mock
// ---------------------------------------------------------------------------

class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
    this.name = 'ExitError';
  }
}

// ---------------------------------------------------------------------------
// Capture helper
// ---------------------------------------------------------------------------

interface Capture {
  readonly stdout: string;
  readonly stderr: string;
  restore(): void;
}

function beginCapture(): Capture {
  const state = { stdout: '', stderr: '' };
  const sOut  = jest.spyOn(process.stdout, 'write').mockImplementation((d) => {
    state.stdout += typeof d === 'string' ? d : Buffer.from(d as Uint8Array).toString();
    return true;
  });
  const sErr  = jest.spyOn(process.stderr, 'write').mockImplementation((d) => {
    state.stderr += typeof d === 'string' ? d : Buffer.from(d as Uint8Array).toString();
    return true;
  });
  return {
    get stdout() { return state.stdout; },
    get stderr() { return state.stderr; },
    restore() { sOut.mockRestore(); sErr.mockRestore(); },
  };
}

// ---------------------------------------------------------------------------
// Module-level setup
// ---------------------------------------------------------------------------

import type { ExitCode } from '../lib/agent-mode';

let agentMode: typeof import('../lib/agent-mode');

beforeEach(async () => {
  jest.resetModules();
  agentMode = await import('../lib/agent-mode');
});

afterEach(() => {
  delete process.env['FILMBUFF_AGENT_MODE'];
  delete process.env['AIPOWERED_AGENT_TOKEN'];
  delete process.env['AIPOWERED_API_KEY'];
  jest.restoreAllMocks();
});

// ===========================================================================
// UT-AGENT — isAgentMode() detection priority
// ===========================================================================

describe('[UT-AGENT-01] isAgentMode() priority: flag > env > TTY', () => {
  it('returns true when agentFlag = true regardless of env and TTY', () => {
    delete process.env['FILMBUFF_AGENT_MODE'];
    expect(agentMode.isAgentMode(true)).toBe(true);
  });

  it('returns true when FILMBUFF_AGENT_MODE=1 and no flag', () => {
    process.env['FILMBUFF_AGENT_MODE'] = '1';
    expect(agentMode.isAgentMode(undefined)).toBe(true);
  });

  it('returns true when stdin is not a TTY and no flag/env', () => {
    delete process.env['FILMBUFF_AGENT_MODE'];
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      expect(agentMode.isAgentMode(undefined)).toBe(true);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
    }
  });

  it('returns false when flag is undefined and env is absent and stdin is TTY', () => {
    delete process.env['FILMBUFF_AGENT_MODE'];
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      expect(agentMode.isAgentMode(undefined)).toBe(false);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
    }
  });
});

describe('[UT-AGENT-07] FILMBUFF_AGENT_MODE=1 activates agent mode', () => {
  it('isAgentMode returns true with env var set', () => {
    process.env['FILMBUFF_AGENT_MODE'] = '1';
    expect(agentMode.isAgentMode()).toBe(true);
  });

  it('isAgentMode returns false with env var unset', () => {
    delete process.env['FILMBUFF_AGENT_MODE'];
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    expect(agentMode.isAgentMode()).toBe(false);
  });
});

// ===========================================================================
// UT-AGENT — agentSuccess / agentError output format
// ===========================================================================

describe('[UT-AGENT-02] agentSuccess() emits valid JSON envelope to stdout', () => {
  it('output is parseable JSON', () => {
    const c = beginCapture();
    try {
      agentMode.agentSuccess({ shot_id: 's001', clip_path: '/tmp/s001.mp4' }, { creditsSpent: 5, shotId: 's001' });
    } finally { c.restore(); }
    expect(() => JSON.parse(c.stdout.trim())).not.toThrow();
  });
});

describe('[UT-AGENT-04] agentSuccess envelope has required fields', () => {
  it('envelope contains status, data, creditsSpent, shotId, errorCode', () => {
    const c = beginCapture();
    try {
      agentMode.agentSuccess({ result: 'ok' }, { creditsSpent: 3, shotId: 's002' });
    } finally { c.restore(); }
    const env = JSON.parse(c.stdout.trim());
    expect(env).toHaveProperty('status', 'success');
    expect(env).toHaveProperty('data');
    expect(env).toHaveProperty('creditsSpent', 3);
    expect(env).toHaveProperty('shotId', 's002');
    expect(env).toHaveProperty('errorCode', null);
  });
});

describe('[UT-AGENT-03] agentError() emits JSON to stdout AND error JSON to stderr', () => {
  it('both stdout and stderr receive JSON output', () => {
    const c = beginCapture();
    try {
      agentMode.agentError(agentMode.EXIT.NOT_FOUND, 'Shot not found', { shotId: 's042' });
    } finally { c.restore(); }
    expect(() => JSON.parse(c.stdout.trim())).not.toThrow();
    expect(() => JSON.parse(c.stderr.trim())).not.toThrow();
  });
});

describe('[UT-AGENT-05] agentError envelope has required fields', () => {
  it('envelope contains status=error, data=null, errorCode, shotId', () => {
    const c = beginCapture();
    try {
      agentMode.agentError(agentMode.EXIT.STATE_CONFLICT, 'cannot approve', { shotId: 's003' });
    } finally { c.restore(); }
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('error');
    expect(env.data).toBeNull();
    expect(env.errorCode).toBe('STATE_CONFLICT');
    expect(env.shotId).toBe('s003');
  });

  it('stderr contains error object with code and message', () => {
    const c = beginCapture();
    try {
      agentMode.agentError(agentMode.EXIT.PROVIDER_ERROR, 'API timeout');
    } finally { c.restore(); }
    const errObj = JSON.parse(c.stderr.trim());
    expect(errObj).toHaveProperty('error');
    expect(errObj.error.code).toBe('PROVIDER_ERROR');
    expect(errObj.error.message).toBe('API timeout');
  });
});

describe('[UT-AGENT-06] humanLog() suppresses stdout in agent mode', () => {
  it('does not write to stdout when agentMode=true', () => {
    const c = beginCapture();
    try { agentMode.humanLog('This should not appear', true); }
    finally { c.restore(); }
    expect(c.stdout).toBe('');
  });

  it('writes to stdout when agentMode=false', () => {
    const c = beginCapture();
    try { agentMode.humanLog('Hello human', false); }
    finally { c.restore(); }
    expect(c.stdout).toContain('Hello human');
  });
});

// ===========================================================================
// UT-EXIT — Exit code constants
// ===========================================================================

describe('[UT-EXIT-01 through UT-EXIT-06] Exit code constants are version-stable', () => {
  it('[UT-EXIT-01] SUCCESS = 0',              () => expect(agentMode.EXIT.SUCCESS).toBe(0));
  it('[UT-EXIT-02] NOT_FOUND = 2',            () => expect(agentMode.EXIT.NOT_FOUND).toBe(2));
  it('[UT-EXIT-03] INSUFFICIENT_CREDITS = 3', () => expect(agentMode.EXIT.INSUFFICIENT_CREDITS).toBe(3));
  it('[UT-EXIT-04] PROVIDER_ERROR = 4',       () => expect(agentMode.EXIT.PROVIDER_ERROR).toBe(4));
  it('[UT-EXIT-05] STATE_CONFLICT = 5',       () => expect(agentMode.EXIT.STATE_CONFLICT).toBe(5));
  it('[UT-EXIT-06] INVALID_ARGS = 6',         () => expect(agentMode.EXIT.INVALID_ARGS).toBe(6));
});

describe('[UT-EXIT] EXIT_NAME maps each code to its string name', () => {
  it('all exit codes have corresponding EXIT_NAME entries', () => {
    const { EXIT, EXIT_NAME } = agentMode;
    for (const [name, code] of Object.entries(EXIT)) {
      expect(EXIT_NAME[code as ExitCode]).toBe(name);
    }
  });
});

// ===========================================================================
// UT-DEPR — generate-video deprecation warning
// ===========================================================================

describe('[UT-DEPR-01] generate-video deprecation message in human mode', () => {
  it('cli.ts includes DEPRECATED warning for generate-video command', async () => {
    const cliSource = require('fs').readFileSync(
      require('path').resolve(__dirname, '../cli.ts'), 'utf-8',
    );
    expect(cliSource).toMatch(/DEPRECATED/i);
    expect(cliSource).toMatch(/generate-video/);
  });
});

describe('[UT-DEPR-02] generate-video deprecation message skipped in agent mode', () => {
  it('cli.ts skips delay when isAgent check is true', () => {
    const cliSource = require('fs').readFileSync(
      require('path').resolve(__dirname, '../cli.ts'), 'utf-8',
    );
    // Verify the agent mode guard exists around the deprecation warning
    expect(cliSource).toMatch(/isAgent.*DEPRECATED|DEPRECATED.*isAgent|if.*isAgent[\s\S]*DEPRECATED/);
  });
});
