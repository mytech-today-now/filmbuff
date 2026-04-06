/**
 * Unit tests for cli/src/lib/filmbuff-config.ts
 *
 * Satisfies bd-fefd (Phase 2) test requirements:
 *   - config absent → default lumaai/ray-2
 *   - CLI flag → overrides config default
 *   - fetchProviderCapabilities offline → static fallback
 *   - buildStaticCapabilities → maps all providers
 *   - AC-8: --provider mock accepted; AC-16: xai/venice video-capable
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadFilmbuffConfig,
  resolveProvider,
  fetchProviderCapabilities,
  buildStaticCapabilities,
  DEFAULT_PROVIDER_ID,
  DEFAULT_MODEL,
  BUILTIN_DEFAULT_CONFIG,
  type FilmbuffConfig,
} from '../lib/filmbuff-config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filmbuff-cfg-'));
}

function writeConfig(dir: string, data: object): string {
  const cfgPath = path.join(dir, 'filmbuff.config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(data), 'utf-8');
  return cfgPath;
}

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// loadFilmbuffConfig
// ---------------------------------------------------------------------------

describe('loadFilmbuffConfig', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { rmrf(tmpDir); });

  it('returns built-in defaults when config file is absent', () => {
    const cfg = loadFilmbuffConfig(path.join(tmpDir, 'nonexistent.json'));
    expect(cfg.defaultProvider).toBe(DEFAULT_PROVIDER_ID);
    expect(cfg.defaultModel).toBe(DEFAULT_MODEL);
    expect(cfg.videoProviders.length).toBeGreaterThan(0);
  });

  it('returns built-in defaults when config file contains malformed JSON', () => {
    const cfgPath = path.join(tmpDir, 'filmbuff.config.json');
    fs.writeFileSync(cfgPath, 'not-valid-json', 'utf-8');
    const cfg = loadFilmbuffConfig(cfgPath);
    expect(cfg.defaultProvider).toBe(DEFAULT_PROVIDER_ID);
    expect(cfg.defaultModel).toBe(DEFAULT_MODEL);
  });

  it('reads defaultProvider and defaultModel from file', () => {
    const cfgPath = writeConfig(tmpDir, {
      defaultProvider: 'mock',
      defaultModel: 'mock-v1',
      videoProviders: []
    });
    const cfg = loadFilmbuffConfig(cfgPath);
    expect(cfg.defaultProvider).toBe('mock');
    expect(cfg.defaultModel).toBe('mock-v1');
  });

  it('uses built-in default for missing defaultProvider', () => {
    const cfgPath = writeConfig(tmpDir, { defaultModel: 'ray-2-turbo', videoProviders: [] });
    const cfg = loadFilmbuffConfig(cfgPath);
    expect(cfg.defaultProvider).toBe(DEFAULT_PROVIDER_ID);
    expect(cfg.defaultModel).toBe('ray-2-turbo');
  });

  it('uses built-in videoProviders when field is not an array', () => {
    const cfgPath = writeConfig(tmpDir, { defaultProvider: 'mock', defaultModel: 'mock-v1' });
    const cfg = loadFilmbuffConfig(cfgPath);
    expect(Array.isArray(cfg.videoProviders)).toBe(true);
    expect(cfg.videoProviders.length).toBeGreaterThan(0);
  });

  it('preserves videoProviders array from file', () => {
    const providers = [{ id: 'custom', supportedModels: ['m1'] }];
    const cfgPath = writeConfig(tmpDir, {
      defaultProvider: 'custom', defaultModel: 'm1', videoProviders: providers
    });
    const cfg = loadFilmbuffConfig(cfgPath);
    expect(cfg.videoProviders).toHaveLength(1);
    expect(cfg.videoProviders[0].id).toBe('custom');
  });
});

// ---------------------------------------------------------------------------
// resolveProvider
// ---------------------------------------------------------------------------

describe('resolveProvider', () => {
  const baseConfig: FilmbuffConfig = {
    defaultProvider: 'lumaai',
    defaultModel: 'ray-2',
    videoProviders: [
      { id: 'lumaai', supportedModels: ['ray-2', 'ray-2-turbo'] },
      { id: 'mock',   supportedModels: ['mock-v1'] }
    ]
  };

  it('returns config defaults when no CLI flags supplied', () => {
    const result = resolveProvider(baseConfig, {});
    expect(result.providerId).toBe('lumaai');
    expect(result.model).toBe('ray-2');
  });

  it('CLI --provider flag overrides config defaultProvider', () => {
    const result = resolveProvider(baseConfig, { provider: 'mock' });
    expect(result.providerId).toBe('mock');
    expect(result.model).toBe('ray-2'); // model unchanged
  });

  it('CLI --model flag overrides config defaultModel', () => {
    const result = resolveProvider(baseConfig, { model: 'ray-2-turbo' });
    expect(result.model).toBe('ray-2-turbo');
    expect(result.providerId).toBe('lumaai'); // provider unchanged
  });

  it('both CLI flags override both config defaults', () => {
    const result = resolveProvider(baseConfig, { provider: 'mock', model: 'mock-v1' });
    expect(result.providerId).toBe('mock');
    expect(result.model).toBe('mock-v1');
  });

  it('populates providerConfig when provider id matches', () => {
    const result = resolveProvider(baseConfig, { provider: 'lumaai' });
    expect(result.providerConfig).toBeDefined();
    expect(result.providerConfig?.id).toBe('lumaai');
  });

  it('providerConfig is undefined for unknown provider id', () => {
    const result = resolveProvider(baseConfig, { provider: 'unknown-provider' });
    expect(result.providerConfig).toBeUndefined();
  });

  it('falls back to built-in defaults when config values are missing', () => {
    const minimalConfig: FilmbuffConfig = {
      defaultProvider: '',
      defaultModel: '',
      videoProviders: []
    };
    // empty strings are falsy so built-in defaults kick in
    const result = resolveProvider(minimalConfig, {});
    expect(result.providerId).toBe(DEFAULT_PROVIDER_ID);
    expect(result.model).toBe(DEFAULT_MODEL);
  });
});

// ---------------------------------------------------------------------------
// buildStaticCapabilities — AC-16 (provider table: xai/venice video-capable)
// ---------------------------------------------------------------------------

describe('buildStaticCapabilities', () => {
  it('maps all built-in providers to capability records', () => {
    const map = buildStaticCapabilities(BUILTIN_DEFAULT_CONFIG);
    expect(map.size).toBeGreaterThanOrEqual(6); // lumaai, xai, venice, openai, anthropic, mock
  });

  it('lumaai: videoSupport=true, maxI2VImages=2 (dual-keyframe)', () => {
    const map = buildStaticCapabilities(BUILTIN_DEFAULT_CONFIG);
    const lumaai = map.get('lumaai');
    expect(lumaai?.videoSupport).toBe(true);
    expect(lumaai?.maxI2VImages).toBe(2);
  });

  it('[AC-16] xai: videoSupport=true, maxI2VImages=1', () => {
    const map = buildStaticCapabilities(BUILTIN_DEFAULT_CONFIG);
    const xai = map.get('xai');
    expect(xai?.videoSupport).toBe(true);
    expect(xai?.maxI2VImages).toBe(1);
  });

  it('[AC-16] venice: videoSupport=true, maxI2VImages=1', () => {
    const map = buildStaticCapabilities(BUILTIN_DEFAULT_CONFIG);
    const venice = map.get('venice');
    expect(venice?.videoSupport).toBe(true);
    expect(venice?.maxI2VImages).toBe(1);
  });

  it('openai: videoSupport=false', () => {
    const map = buildStaticCapabilities(BUILTIN_DEFAULT_CONFIG);
    const openai = map.get('openai');
    expect(openai?.videoSupport).toBe(false);
    expect(openai?.maxI2VImages).toBe(0);
  });

  it('anthropic: videoSupport=false', () => {
    const map = buildStaticCapabilities(BUILTIN_DEFAULT_CONFIG);
    const anthropic = map.get('anthropic');
    expect(anthropic?.videoSupport).toBe(false);
    expect(anthropic?.maxI2VImages).toBe(0);
  });

  it('[AC-8] mock: videoSupport=true, maxI2VImages=-1 (unlimited)', () => {
    const map = buildStaticCapabilities(BUILTIN_DEFAULT_CONFIG);
    const mock = map.get('mock');
    expect(mock?.videoSupport).toBe(true);
    expect(mock?.maxI2VImages).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// fetchProviderCapabilities — offline mode returns static fallback
// ---------------------------------------------------------------------------

describe('fetchProviderCapabilities', () => {
  it('returns static fallback immediately in offline mode', async () => {
    const result = await fetchProviderCapabilities(
      'http://localhost:9999',
      BUILTIN_DEFAULT_CONFIG,
      { offline: true }
    );
    expect(result.has('lumaai')).toBe(true);
    expect(result.has('mock')).toBe(true);
  });

  it('returns static fallback when server is unreachable (network error)', async () => {
    // Port 1 is never open; request will fail immediately
    const result = await fetchProviderCapabilities(
      'http://127.0.0.1:1',
      BUILTIN_DEFAULT_CONFIG,
      { timeoutMs: 500 }
    );
    expect(result.has('lumaai')).toBe(true);
  }, 5000);
});
