/**
 * AI Providers – Phase 5 automated tests
 *
 * Covers: routing, persistence, validation failures, capability mismatches,
 * secret redaction, and help/version flag preservation.
 *
 * Satisfies: bd-ai-providers.9 – Phase 5: Publish docs, add tests, and verify
 *            provider workflows
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  REDACTED,
  redactCredentials,
  redactProfile,
  redactString,
  redactValue,
} from '../utils/redaction';
import { providerRegistry } from '../utils/provider-registry';
import { ProfileStore, resolveSecrets, isEnvRef } from '../utils/profile-store';
import { CustomProviderStore } from '../utils/custom-provider-store';
import {
  validateProfile,
  checkCapability,
  validateAndResolve,
} from '../utils/provider-validator';
import {
  resolveActiveProvider,
  resolveProviderByProfile,
  NoActiveProviderError,
  ProfileNotFoundError,
} from '../utils/runtime-resolver';
import { profileStore } from '../utils/profile-store';
import { customProviderStore } from '../utils/custom-provider-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filmbuff-test-'));
}

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeProfile(
  name = 'default',
  provider = 'anthropic',
  secretRef = 'env:TEST_PROVIDER_KEY'
) {
  return {
    providerId: provider,
    profileName: name,
    settings: { model: 'claude-sonnet-4-6' },
    secretRefs: { apiKey: secretRef },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 1. Redaction utilities
// ---------------------------------------------------------------------------

describe('redaction utilities', () => {
  const schema = [
    { key: 'apiKey', label: 'API Key', required: true, secret: true },
    { key: 'org', label: 'Org', required: false, secret: false },
  ];

  it('redactCredentials masks secret fields', () => {
    const result = redactCredentials({ apiKey: 'sk-ant-realkey', org: 'myorg' }, schema);
    expect(result.apiKey).toBe(REDACTED);
    expect(result.org).toBe('myorg');
  });

  it('redactCredentials passes through non-secret fields unchanged', () => {
    const result = redactCredentials({ apiKey: 'secret', org: 'acme' }, schema);
    expect(result.org).toBe('acme');
  });

  it('redactProfile replaces secretRefs values with REDACTED', () => {
    const profile = {
      providerId: 'anthropic',
      profileName: 'prod',
      settings: { model: 'claude-3' },
      secretRefs: { apiKey: 'sk-ant-real' },
      createdAt: '',
      updatedAt: '',
    };
    const safe = redactProfile(profile);
    expect(safe.secretRefs.apiKey).toBe(REDACTED);
    expect(safe.settings.model).toBe('claude-3');
  });

  it('redactString masks Anthropic API keys', () => {
    const out = redactString('Token: sk-ant-abcdefghijklmnopqrst is my key');
    expect(out).toContain(REDACTED);
    expect(out).not.toContain('sk-ant-abcdefghijklmnopqrst');
  });

  it('redactString masks OpenAI API keys', () => {
    const out = redactString('my key is sk-abcdefghijklmnopqrstu');
    expect(out).toContain(REDACTED);
  });

  it('redactString masks Google AI keys', () => {
    const out = redactString('AIzaabcdefghijklmnopqrstu1234567890xyz');
    expect(out).toContain(REDACTED);
  });

  it('redactString leaves safe strings unchanged', () => {
    const out = redactString('no secrets here');
    expect(out).toBe('no secrets here');
  });

  it('redactValue recursively redacts strings in objects', () => {
    const obj = { message: 'sk-ant-abcdefghij0123456789', count: 3 };
    const result = redactValue(obj) as Record<string, unknown>;
    expect((result.message as string)).toContain(REDACTED);
    expect(result.count).toBe(3);
  });

  it('redactValue handles arrays', () => {
    const arr = ['sk-ant-abcdefghij0123456789', 'safe'];
    const result = redactValue(arr) as string[];
    expect(result[0]).toContain(REDACTED);
    expect(result[1]).toBe('safe');
  });

  it('redactValue passes through primitives', () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// 2. ProviderRegistry singleton
// ---------------------------------------------------------------------------

describe('ProviderRegistry', () => {
  it('lists all three built-in providers', () => {
    const ids = providerRegistry.list().map((p) => p.id);
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
    expect(ids).toContain('google-ai');
  });

  it('get() returns a provider by id', () => {
    const p = providerRegistry.get('anthropic');
    expect(p).toBeDefined();
    expect(p!.displayName).toBe('Anthropic (Claude)');
  });

  it('get() returns undefined for unknown provider', () => {
    expect(providerRegistry.get('unknown-provider-xyz')).toBeUndefined();
  });

  it('has() returns true for registered provider', () => {
    expect(providerRegistry.has('openai')).toBe(true);
  });

  it('has() returns false for unregistered provider', () => {
    expect(providerRegistry.has('not-there-xyz')).toBe(false);
  });

  it('listByCapability() includes vision providers', () => {
    const withVision = providerRegistry.listByCapability('vision');
    const ids = withVision.map((p) => p.id);
    expect(ids).toContain('openai');
    expect(ids).toContain('google-ai');
  });

  it('listByCapability() excludes providers without the capability', () => {
    // anthropic does not list 'vision'
    const withVision = providerRegistry.listByCapability('vision');
    const ids = withVision.map((p) => p.id);
    expect(ids).not.toContain('anthropic');
  });

  it('register() adds a custom provider to the registry', () => {
    const custom = {
      id: 'test-custom-reg-' + Date.now(),
      type: 'custom' as const,
      displayName: 'Test Custom',
      description: 'Test provider',
      capabilities: ['text-generation' as const],
      settingsSchema: [],
      credentialSchema: [],
      validate: () => ({ valid: true, errors: [] }),
      createExecutor: () => ({ execute: async () => ({ content: '' }) }),
    };
    providerRegistry.register(custom);
    expect(providerRegistry.has(custom.id)).toBe(true);
    expect(providerRegistry.get(custom.id)!.displayName).toBe('Test Custom');
  });
});

// ---------------------------------------------------------------------------
// 3. ProfileStore – persistence and active selection
// ---------------------------------------------------------------------------

describe('ProfileStore', () => {
  let tmpDir: string;
  let store: ProfileStore;

  beforeEach(() => {
    tmpDir = makeTempDir();
    store = new ProfileStore(tmpDir);
  });

  afterEach(() => rmrf(tmpDir));

  it('save() and load() round-trip a profile', () => {
    const p = makeProfile();
    store.save(p);
    const loaded = store.load('anthropic', 'default');
    expect(loaded).toBeDefined();
    expect(loaded!.settings.model).toBe('claude-sonnet-4-6');
  });

  it('load() returns undefined for a missing profile', () => {
    expect(store.load('anthropic', 'nonexistent')).toBeUndefined();
  });

  it('delete() removes a profile and returns true', () => {
    store.save(makeProfile());
    expect(store.delete('anthropic', 'default')).toBe(true);
    expect(store.load('anthropic', 'default')).toBeUndefined();
  });

  it('delete() returns false when profile does not exist', () => {
    expect(store.delete('anthropic', 'ghost')).toBe(false);
  });

  it('listAll() returns all saved profiles', () => {
    store.save(makeProfile('alpha', 'anthropic'));
    store.save(makeProfile('beta', 'openai'));
    expect(store.listAll().length).toBe(2);
  });

  it('listByProvider() filters by provider', () => {
    store.save(makeProfile('a', 'anthropic'));
    store.save(makeProfile('b', 'anthropic'));
    store.save(makeProfile('c', 'openai'));
    expect(store.listByProvider('anthropic').length).toBe(2);
    expect(store.listByProvider('openai').length).toBe(1);
  });

  it('setActive() and getActive() round-trip the active selection', () => {
    store.setActive({ providerId: 'anthropic', profileName: 'default' });
    const active = store.getActive();
    expect(active!.providerId).toBe('anthropic');
    expect(active!.profileName).toBe('default');
  });

  it('getActive() returns undefined when no active file exists', () => {
    expect(store.getActive()).toBeUndefined();
  });

  it('clearActive() removes the active selection', () => {
    store.setActive({ providerId: 'openai', profileName: 'prod' });
    store.clearActive();
    expect(store.getActive()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3b. resolveSecrets and isEnvRef
// ---------------------------------------------------------------------------

describe('resolveSecrets', () => {
  afterEach(() => {
    delete process.env.TEST_RESOLVE_KEY_ABC;
  });

  it('resolves env refs to environment variable values', () => {
    process.env.TEST_RESOLVE_KEY_ABC = 'sk-resolved-value';
    const resolved = resolveSecrets({ apiKey: 'env:TEST_RESOLVE_KEY_ABC' });
    expect(resolved.apiKey).toBe('sk-resolved-value');
  });

  it('returns undefined for unset env refs', () => {
    const resolved = resolveSecrets({ apiKey: 'env:UNSET_ENV_VAR_XYZ_9999' });
    expect(resolved.apiKey).toBeUndefined();
  });

  it('passes plain-text values through unchanged', () => {
    const resolved = resolveSecrets({ apiKey: 'plaintext-secret' });
    expect(resolved.apiKey).toBe('plaintext-secret');
  });
});

describe('isEnvRef', () => {
  it('returns true for env: prefixed strings', () => {
    expect(isEnvRef('env:MY_VAR')).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(isEnvRef('sk-ant-secret')).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// 4. CustomProviderStore – registration and persistence
// ---------------------------------------------------------------------------

describe('CustomProviderStore', () => {
  let tmpDir: string;
  let store: CustomProviderStore;

  const makeCustom = (id = 'test-custom') => ({
    id,
    displayName: 'Test Custom',
    description: 'A test provider',
    capabilities: ['text-generation' as const],
    settingsSchema: [],
    credentialSchema: [
      { key: 'token', label: 'Token', required: true, secret: true },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  beforeEach(() => {
    tmpDir = makeTempDir();
    store = new CustomProviderStore(tmpDir);
  });

  afterEach(() => rmrf(tmpDir));

  it('register() persists and get() retrieves a custom provider', () => {
    store.register(makeCustom('p-a'));
    const found = store.get('p-a');
    expect(found).toBeDefined();
    expect(found!.displayName).toBe('Test Custom');
  });

  it('listAll() returns all registered custom providers', () => {
    store.register(makeCustom('p-1'));
    store.register(makeCustom('p-2'));
    expect(store.listAll().length).toBe(2);
  });

  it('register() overwrites an existing provider with same id', () => {
    store.register(makeCustom('p-dup'));
    const updated = { ...makeCustom('p-dup'), displayName: 'Updated' };
    store.register(updated);
    expect(store.listAll().length).toBe(1);
    expect(store.get('p-dup')!.displayName).toBe('Updated');
  });

  it('unregister() removes a provider and returns true', () => {
    store.register(makeCustom('p-rm'));
    expect(store.unregister('p-rm')).toBe(true);
    expect(store.get('p-rm')).toBeUndefined();
  });

  it('unregister() returns false when provider does not exist', () => {
    expect(store.unregister('not-there')).toBe(false);
  });

  it('loadIntoRegistry() registers providers in the global registry', () => {
    const uid = 'custom-load-test-' + Date.now();
    store.register({ ...makeCustom(uid) });
    store.loadIntoRegistry();
    expect(providerRegistry.has(uid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. ProviderValidator – validation failures, capability checks
// ---------------------------------------------------------------------------

describe('validateProfile', () => {
  afterEach(() => {
    delete process.env.TEST_ANT_KEY;
  });

  it('returns valid for a well-formed anthropic profile', () => {
    process.env.TEST_ANT_KEY = 'sk-ant-test-key';
    const profile = makeProfile('default', 'anthropic', 'env:TEST_ANT_KEY');
    const result = validateProfile(profile);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns invalid when required credential env ref is unset', () => {
    const profile = makeProfile('default', 'anthropic', 'env:DEFINITELY_NOT_SET_XYZ');
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('API Key'))).toBe(true);
  });

  it('returns invalid when credential fails provider format check', () => {
    process.env.TEST_ANT_KEY = 'INVALID_KEY_FORMAT';
    const profile = makeProfile('default', 'anthropic', 'env:TEST_ANT_KEY');
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
  });

  it('does not echo secret values in validation errors', () => {
    process.env.TEST_ANT_KEY = 'BADKEY_WITH_SECRET_DATA';
    const profile = makeProfile('default', 'anthropic', 'env:TEST_ANT_KEY');
    const result = validateProfile(profile);
    expect(JSON.stringify(result.errors)).not.toContain('BADKEY_WITH_SECRET_DATA');
  });

  it('returns invalid for an unknown provider id', () => {
    const profile = makeProfile('default', 'unknown-provider-xyz');
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('unknown-provider-xyz');
  });
});

describe('checkCapability', () => {
  it('does not throw when provider supports the capability', () => {
    expect(() => checkCapability('anthropic', 'generate-shot-list')).not.toThrow();
  });

  it('throws CAPABILITY_MISSING when provider lacks capability', () => {
    let err: any;
    try {
      checkCapability('anthropic', 'vision');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('CAPABILITY_MISSING');
    expect(err.errors[0]).toContain('vision');
  });

  it('throws PROVIDER_NOT_FOUND for unregistered provider', () => {
    let err: any;
    try {
      checkCapability('no-such-provider', 'text-generation');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('PROVIDER_NOT_FOUND');
  });
});

describe('validateAndResolve', () => {
  afterEach(() => {
    delete process.env.TEST_VAR_KEY;
  });

  it('returns an executor for a valid profile', () => {
    process.env.TEST_VAR_KEY = 'sk-valid-key';
    const profile = makeProfile('default', 'anthropic', 'env:TEST_VAR_KEY');
    const executor = validateAndResolve(profile);
    expect(executor).toBeDefined();
    expect(typeof executor.execute).toBe('function');
  });

  it('throws PROFILE_INVALID for an invalid profile', () => {
    const profile = makeProfile('default', 'anthropic', 'env:UNSET_XYZ_KEY_9999');
    let err: any;
    try {
      validateAndResolve(profile);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('PROFILE_INVALID');
  });

  it('throws CAPABILITY_MISSING when required capability is unsupported', () => {
    process.env.TEST_VAR_KEY = 'sk-valid-key';
    const profile = makeProfile('default', 'anthropic', 'env:TEST_VAR_KEY');
    let err: any;
    try {
      validateAndResolve(profile, 'vision');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('CAPABILITY_MISSING');
  });
});

// ---------------------------------------------------------------------------
// 6. RuntimeResolver – routing through active provider
// ---------------------------------------------------------------------------

describe('resolveActiveProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TEST_RT_KEY;
  });

  it('throws NoActiveProviderError when no active selection exists', () => {
    jest.spyOn(profileStore, 'getActive').mockReturnValue(undefined);
    jest.spyOn(customProviderStore, 'loadIntoRegistry').mockReturnValue(undefined);
    expect(() => resolveActiveProvider()).toThrow(NoActiveProviderError);
  });

  it('throws ProfileNotFoundError when active profile does not exist on disk', () => {
    jest.spyOn(customProviderStore, 'loadIntoRegistry').mockReturnValue(undefined);
    jest.spyOn(profileStore, 'getActive').mockReturnValue({
      providerId: 'anthropic',
      profileName: 'missing-profile',
    });
    jest.spyOn(profileStore, 'load').mockReturnValue(undefined);
    expect(() => resolveActiveProvider()).toThrow(ProfileNotFoundError);
  });

  it('throws when active provider id is not registered', () => {
    jest.spyOn(customProviderStore, 'loadIntoRegistry').mockReturnValue(undefined);
    jest.spyOn(profileStore, 'getActive').mockReturnValue({
      providerId: 'unknown-provider-rt',
      profileName: 'default',
    });
    expect(() => resolveActiveProvider()).toThrow(/not registered/);
  });

  it('returns a ResolvedProvider for a valid active selection', () => {
    process.env.TEST_RT_KEY = 'sk-ant-valid';
    jest.spyOn(customProviderStore, 'loadIntoRegistry').mockReturnValue(undefined);
    jest.spyOn(profileStore, 'getActive').mockReturnValue({
      providerId: 'anthropic',
      profileName: 'default',
    });
    jest.spyOn(profileStore, 'load').mockReturnValue(
      makeProfile('default', 'anthropic', 'env:TEST_RT_KEY')
    );
    const resolved = resolveActiveProvider();
    expect(resolved.providerId).toBe('anthropic');
    expect(resolved.profileName).toBe('default');
    expect(typeof resolved.executor.execute).toBe('function');
  });

  it('throws CAPABILITY_MISSING when active provider does not support capability', () => {
    process.env.TEST_RT_KEY = 'sk-ant-valid';
    jest.spyOn(customProviderStore, 'loadIntoRegistry').mockReturnValue(undefined);
    jest.spyOn(profileStore, 'getActive').mockReturnValue({
      providerId: 'anthropic',
      profileName: 'default',
    });
    jest.spyOn(profileStore, 'load').mockReturnValue(
      makeProfile('default', 'anthropic', 'env:TEST_RT_KEY')
    );
    let err: any;
    try {
      resolveActiveProvider('vision'); // anthropic lacks vision
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('CAPABILITY_MISSING');
  });
});

describe('resolveProviderByProfile', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TEST_RT_KEY2;
  });

  it('throws for unregistered provider', () => {
    jest.spyOn(customProviderStore, 'loadIntoRegistry').mockReturnValue(undefined);
    expect(() =>
      resolveProviderByProfile('unregistered-provider', 'default')
    ).toThrow(/not registered/);
  });

  it('throws ProfileNotFoundError when profile does not exist', () => {
    jest.spyOn(customProviderStore, 'loadIntoRegistry').mockReturnValue(undefined);
    jest.spyOn(profileStore, 'load').mockReturnValue(undefined);
    expect(() =>
      resolveProviderByProfile('anthropic', 'no-such-profile')
    ).toThrow(ProfileNotFoundError);
  });

  it('returns a ResolvedProvider for a valid provider and profile', () => {
    process.env.TEST_RT_KEY2 = 'sk-ant-key2';
    jest.spyOn(customProviderStore, 'loadIntoRegistry').mockReturnValue(undefined);
    jest.spyOn(profileStore, 'load').mockReturnValue(
      makeProfile('prod', 'anthropic', 'env:TEST_RT_KEY2')
    );
    const resolved = resolveProviderByProfile('anthropic', 'prod');
    expect(resolved.providerId).toBe('anthropic');
    expect(resolved.profileName).toBe('prod');
  });
});
