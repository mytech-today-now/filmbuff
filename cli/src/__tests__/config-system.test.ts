/**
 * config-system.test.ts — updated for Phase 10 (bd-2d41).
 *
 * Phase 7 (bd-e8ad) renamed the config block from `ai` with url/model/etc.
 * fields to `aiPowered` with shape { plugins: string[], debug: boolean }.
 * The old constants AI_POWERED_DEFAULT_MODEL and AI_POWERED_DEFAULT_URL have
 * been removed from ai-provider-config.ts.
 *
 * These tests verify the Phase 7 aiPowered schema is applied correctly.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager, DEFAULT_CONFIG } from '../utils/config-system';
import { resolveAIClient } from '../utils/runtime-resolver';
import { aiSetCommand } from '../commands/ai-set';
import { aiEnvCommand } from '../commands/ai-env';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filmbuff-config-system-'));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('ConfigManager — Phase 7 aiPowered schema (bd-e8ad)', () => {
  // -------------------------------------------------------------------------
  // DEFAULT_CONFIG shape
  // -------------------------------------------------------------------------

  it('DEFAULT_CONFIG.aiPowered.plugins defaults to ["audit-log"]', () => {
    expect(DEFAULT_CONFIG.aiPowered?.plugins).toEqual(['audit-log']);
  });

  it('DEFAULT_CONFIG.aiPowered.debug defaults to false', () => {
    expect(DEFAULT_CONFIG.aiPowered?.debug).toBe(false);
  });

  it('DEFAULT_CONFIG.aiPowered has no url field (removed in Phase 7)', () => {
    expect((DEFAULT_CONFIG.aiPowered as Record<string, unknown>)?.url).toBeUndefined();
  });

  it('DEFAULT_CONFIG.aiPowered has no model field (removed in Phase 7)', () => {
    expect((DEFAULT_CONFIG.aiPowered as Record<string, unknown>)?.model).toBeUndefined();
  });

  it('DEFAULT_CONFIG.aiPowered has no temperature field (removed in Phase 7)', () => {
    expect((DEFAULT_CONFIG.aiPowered as Record<string, unknown>)?.temperature).toBeUndefined();
  });

  it('DEFAULT_CONFIG.aiPowered has no maxTokens field (removed in Phase 7)', () => {
    expect((DEFAULT_CONFIG.aiPowered as Record<string, unknown>)?.maxTokens).toBeUndefined();
  });

  it('DEFAULT_CONFIG.aiPowered has no timeoutMs field (removed in Phase 7)', () => {
    expect((DEFAULT_CONFIG.aiPowered as Record<string, unknown>)?.timeoutMs).toBeUndefined();
  });

  it('DEFAULT_CONFIG.aiPowered has no systemPrompt field (removed in Phase 7)', () => {
    expect((DEFAULT_CONFIG.aiPowered as Record<string, unknown>)?.systemPrompt).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Merge behaviour
  // -------------------------------------------------------------------------

  it('mergeConfig deep-merges aiPowered.plugins override', () => {
    const merged = {
      ...DEFAULT_CONFIG,
      aiPowered: { ...DEFAULT_CONFIG.aiPowered, plugins: ['rate-limiter', 'audit-log'] },
    };
    expect(merged.aiPowered?.plugins).toEqual(['rate-limiter', 'audit-log']);
    // debug should still hold its default value
    expect(merged.aiPowered?.debug).toBe(false);
  });

  it('mergeConfig deep-merges aiPowered.debug override', () => {
    const merged = {
      ...DEFAULT_CONFIG,
      aiPowered: { ...DEFAULT_CONFIG.aiPowered, debug: true },
    };
    expect(merged.aiPowered?.debug).toBe(true);
    expect(merged.aiPowered?.plugins).toEqual(['audit-log']);
  });

  // -------------------------------------------------------------------------
  // Isolation and persistence
  // -------------------------------------------------------------------------

  describe('instance isolation and persistence', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      removeTempDir(tmpDir);
    });

    it('creates isolated config trees per instance', () => {
      const managerA = new ConfigManager(path.join(tmpDir, 'a.json'));
      const managerB = new ConfigManager(path.join(tmpDir, 'b.json'));

      const configA = managerA.getConfig();
      const configB = managerB.getConfig();

      expect(configA).not.toBe(configB);
      expect(configA.aiPowered).not.toBe(configB.aiPowered);
      expect(configA.aiPowered?.debug).toBe(false);
      expect(configB.aiPowered?.debug).toBe(false);

      managerA.set('aiPowered.debug', true);

      expect(managerA.getConfig().aiPowered?.debug).toBe(true);
      expect(managerB.getConfig().aiPowered?.debug).toBe(false);
      expect(DEFAULT_CONFIG.aiPowered?.debug).toBe(false);
      expect(DEFAULT_CONFIG.aiPowered?.plugins).toEqual(['audit-log']);
    });

    it('loads default values when the config file does not exist', () => {
      const manager = new ConfigManager(path.join(tmpDir, 'missing.json'));
      const loaded = manager.load();

      expect(loaded).toEqual(DEFAULT_CONFIG);
      expect(loaded).not.toBe(DEFAULT_CONFIG);
      expect(manager.getConfig()).toEqual(DEFAULT_CONFIG);
    });

    it('saves the current config using the existing JSON shape', () => {
      const configPath = path.join(tmpDir, 'augment.json');
      const manager = new ConfigManager(configPath);

      manager.set('aiPowered.debug', true);
      manager.set('modules.searchPaths', ['filmbuff', 'custom-modules']);
      manager.save();

      const written = fs.readFileSync(configPath, 'utf-8');
      const expected = JSON.stringify(manager.getConfig(), null, 2) + '\n';

      expect(written).toBe(expected);
      expect(JSON.parse(written)).toEqual(manager.getConfig());
    });
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it('ConfigManager.validate returns valid for DEFAULT_CONFIG', () => {
    const manager = new ConfigManager();
    const result = manager.validate({ ...DEFAULT_CONFIG });
    expect(result.valid).toBe(true);
  });

  it('ConfigManager.validate returns valid when aiPowered.plugins is empty array', () => {
    const manager = new ConfigManager();
    const result = manager.validate({
      ...DEFAULT_CONFIG,
      aiPowered: { plugins: [], debug: false },
    });
    expect(result.valid).toBe(true);
  });

  it('ConfigManager.validate still reports aiPowered type errors', () => {
    const manager = new ConfigManager();
    const result = manager.validate({
      ...DEFAULT_CONFIG,
      aiPowered: { plugins: 'not-an-array' as unknown as string[], debug: false },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('aiPowered.plugins must be an array');
  });

  it.each([
    'https://gateway.example',
    'https://gateway.example/v1?api_key=synthetic-query',
    'http://localhost:3001',
    'http://127.0.0.2:3001',
    'http://[::1]:3001',
  ])('ConfigManager.validate accepts secure endpoint %s', (url) => {
    const manager = new ConfigManager();
    const result = manager.validate({
      ...DEFAULT_CONFIG,
      aiPowered: { ...DEFAULT_CONFIG.aiPowered, url },
    });

    expect(result.valid).toBe(true);
  });

  it.each([
    'http://gateway.example',
    'http://localhost.attacker.test:3001',
    'ftp://gateway.example',
    'https:gateway.example',
    'not-a-url',
    'https://synthetic-user:synthetic-password@gateway.example?api_key=synthetic-query',
  ])('ConfigManager.validate rejects unsafe endpoint %s without echoing it', (url) => {
    const manager = new ConfigManager();
    const result = manager.validate({
      ...DEFAULT_CONFIG,
      aiPowered: { ...DEFAULT_CONFIG.aiPowered, url },
    });
    const diagnostics = result.errors.join('\n');

    expect(result.valid).toBe(false);
    expect(diagnostics).toContain('Remote AI gateways require HTTPS');
    for (const secret of ['synthetic-user', 'synthetic-password', 'synthetic-query']) {
      expect(diagnostics).not.toContain(secret);
    }
  });

  it('deprecated ai.provider triggers no schema validation error', () => {
    // The schema marks ai.provider as deprecated but valid — presence alone
    // must not fail validation; only a runtime stderr warning is emitted.
    const manager = new ConfigManager();
    const result = manager.validate({
      ...DEFAULT_CONFIG,
      ai: { ...DEFAULT_CONFIG.ai, provider: 'anthropic' },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes('ai.provider'))).toBe(true);
  });
});

describe('AI gateway URL resolution and CLI output baseline', () => {
  const originalCwd = process.cwd();
  const originalAIUrl = process.env['AI_POWERED_URL'];
  const originalSystemPrompt = process.env['AI_SYSTEM_PROMPT'];
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    process.chdir(tmpDir);
    delete process.env['AI_POWERED_URL'];
    delete process.env['AI_SYSTEM_PROMPT'];
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.chdir(originalCwd);
    if (originalAIUrl === undefined) {
      delete process.env['AI_POWERED_URL'];
    } else {
      process.env['AI_POWERED_URL'] = originalAIUrl;
    }
    if (originalSystemPrompt === undefined) {
      delete process.env['AI_SYSTEM_PROMPT'];
    } else {
      process.env['AI_SYSTEM_PROMPT'] = originalSystemPrompt;
    }
    removeTempDir(tmpDir);
  });

  function writeConfigUrl(url: string): void {
    const configDirectory = path.join(process.cwd(), '.augment');
    fs.mkdirSync(configDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(configDirectory, 'augment.json'),
      JSON.stringify({
        ...DEFAULT_CONFIG,
        aiPowered: { ...DEFAULT_CONFIG.aiPowered, url },
      }),
    );
  }

  async function expectHealthRequestAt(url: string, overrides?: { url: string }): Promise<void> {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => ({
      ok: true,
      status: 200,
      text: async () => 'ok',
    }) as unknown as Response);

    await resolveAIClient(overrides).checkHealth();

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${url}/health`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  }

  it('keeps CLI overrides above environment and config URLs', async () => {
    writeConfigUrl('https://config.example');
    process.env['AI_POWERED_URL'] = 'https://env.example';

    await expectHealthRequestAt('https://cli.example', { url: 'https://cli.example' });
  });

  it('keeps environment URLs above config URLs', async () => {
    writeConfigUrl('https://config.example');
    process.env['AI_POWERED_URL'] = 'https://env.example';

    await expectHealthRequestAt('https://env.example');
  });

  it('uses config URLs when no environment or CLI override is set', async () => {
    writeConfigUrl('https://config.example');

    await expectHealthRequestAt('https://config.example');
  });

  it('uses the built-in loopback URL when no override or config is present', async () => {
    await expectHealthRequestAt('http://localhost:3001');
  });

  it('does not print URL query values when setting an endpoint', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const querySecret = 'synthetic-query-secret';
    const promptSecret = 'synthetic-system-prompt-secret';

    await aiSetCommand('url', `https://gateway.example/v1?api_key=${querySecret}`);
    await aiSetCommand('systemPrompt', promptSecret);

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('[configured endpoint]');
    expect(output).toContain('[prompt content hidden]');
    expect(output).not.toContain(querySecret);
    expect(output).not.toContain('api_key=');
    expect(output).not.toContain(promptSecret);
  });

  it('summarizes AI_POWERED_URL in environment output without userinfo or query values', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const querySecret = 'synthetic-query-secret';
    const promptSecret = 'synthetic-system-prompt-secret';
    process.env['AI_POWERED_URL'] =
      `https://synthetic-user:synthetic-password@gateway.example/private?api_key=${querySecret}`;
    process.env['AI_SYSTEM_PROMPT'] = promptSecret;

    await aiEnvCommand();

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('https://gateway.example');
    for (const secret of [
      'synthetic-user',
      'synthetic-password',
      querySecret,
      '/private',
      promptSecret,
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[prompt content hidden]');
  });
});
