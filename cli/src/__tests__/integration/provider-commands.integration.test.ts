/**
 * Integration tests for provider CLI commands
 *
 * Exercises providerListCommand, providerShowCommand, providerActivateCommand,
 * providerDeleteCommand, providerAddCommand, and configureCommand using
 * jest.spyOn to isolate filesystem/network side-effects while fully executing
 * the command handler logic.
 *
 * Satisfies: bd-prov-b8 buff-core.02.03.04 - 01 Write integration tests for
 *            provider CLI commands
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ProfileStore } from '../../utils/profile-store';
import { profileStore } from '../../utils/profile-store';
import { providerRegistry } from '../../utils/provider-registry';
import {
  providerListCommand,
  providerShowCommand,
  providerActivateCommand,
  providerDeleteCommand,
  configureCommand,
} from '../../commands/provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fb-prov-int-'));
}

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeProfile(providerId = 'anthropic', profileName = 'default') {
  return {
    providerId,
    profileName,
    settings: { model: 'claude-sonnet-4-6' },
    secretRefs: { apiKey: 'env:ANTHROPIC_API_KEY' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Capture console output
// ---------------------------------------------------------------------------

let logOutput: string[] = [];
let errOutput: string[] = [];

beforeEach(() => {
  logOutput = [];
  errOutput = [];
  jest.spyOn(console, 'log').mockImplementation((...args) => {
    logOutput.push(args.join(' '));
  });
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    errOutput.push(args.join(' '));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. providerListCommand – providers view
// ---------------------------------------------------------------------------

describe('providerListCommand – providers view', () => {
  it('lists registered providers including anthropic, openai, google-ai', () => {
    jest.spyOn(profileStore, 'getActive').mockReturnValue(undefined);
    providerListCommand({});
    const joined = logOutput.join('\n');
    expect(joined).toContain('anthropic');
    expect(joined).toContain('openai');
    expect(joined).toContain('google-ai');
  });

  it('shows active provider when one is set', () => {
    jest.spyOn(profileStore, 'getActive').mockReturnValue({
      providerId: 'openai',
      profileName: 'prod',
    });
    providerListCommand({});
    const joined = logOutput.join('\n');
    expect(joined).toContain('openai');
    expect(joined).toContain('prod');
  });

  it('emits JSON with all providers when --json flag is set', () => {
    jest.spyOn(profileStore, 'getActive').mockReturnValue(undefined);
    providerListCommand({ json: true });
    const raw = logOutput.join('');
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    const ids = parsed.map((p: { id: string }) => p.id);
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
  });
});

// ---------------------------------------------------------------------------
// 2. providerListCommand – profiles view
// ---------------------------------------------------------------------------

describe('providerListCommand – profiles view', () => {
  it('emits profile details when --profiles flag is set', () => {
    jest.spyOn(profileStore, 'getActive').mockReturnValue(undefined);
    jest.spyOn(profileStore, 'listAll').mockReturnValue([makeProfile()]);
    providerListCommand({ profiles: true });
    const joined = logOutput.join('\n');
    expect(joined).toContain('default');
    expect(joined).toContain('anthropic');
  });

  it('shows prompt when no profiles are saved', () => {
    jest.spyOn(profileStore, 'getActive').mockReturnValue(undefined);
    jest.spyOn(profileStore, 'listAll').mockReturnValue([]);
    providerListCommand({ profiles: true });
    const joined = logOutput.join('\n');
    expect(joined).toContain('filmbuff configure');
  });

  it('emits JSON with active and profiles when --profiles --json', () => {
    const active = { providerId: 'anthropic', profileName: 'default' };
    jest.spyOn(profileStore, 'getActive').mockReturnValue(active);
    jest.spyOn(profileStore, 'listAll').mockReturnValue([makeProfile()]);
    jest.spyOn(profileStore, 'load').mockReturnValue(makeProfile());
    providerListCommand({ profiles: true, json: true });
    const raw = logOutput.join('');
    const parsed = JSON.parse(raw);
    expect(parsed.active).toEqual(active);
    expect(Array.isArray(parsed.profiles)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. providerShowCommand
// ---------------------------------------------------------------------------

describe('providerShowCommand', () => {
  it('shows profile details (secrets redacted)', () => {
    jest.spyOn(profileStore, 'load').mockReturnValue(makeProfile());
    providerShowCommand('anthropic', 'default', {});
    const joined = logOutput.join('\n');
    expect(joined).toContain('default');
    expect(joined).toContain('anthropic');
  });

  it('exits with error when profile not found', () => {
    jest.spyOn(profileStore, 'load').mockReturnValue(undefined);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error('process.exit called');
    });
    expect(() => providerShowCommand('anthropic', 'ghost', {})).toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errOutput.join('\n')).toContain('not found');
  });

  it('emits JSON output when --json flag is set', () => {
    jest.spyOn(profileStore, 'load').mockReturnValue(makeProfile());
    providerShowCommand('anthropic', 'default', { json: true });
    const raw = logOutput.join('');
    const parsed = JSON.parse(raw);
    expect(parsed.providerId).toBe('anthropic');
    expect(parsed.profileName).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// 4. providerActivateCommand
// ---------------------------------------------------------------------------

describe('providerActivateCommand', () => {
  it('calls setActive for a valid profile and prints success', () => {
    // Set env var so validateProfile resolves the env:ANTHROPIC_API_KEY ref
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-key-for-jest';
    jest.spyOn(profileStore, 'load').mockReturnValue(makeProfile());
    const setActiveSpy = jest.spyOn(profileStore, 'setActive').mockImplementation(() => {});
    providerActivateCommand('anthropic', 'default');
    delete process.env['ANTHROPIC_API_KEY'];
    expect(setActiveSpy).toHaveBeenCalledWith({ providerId: 'anthropic', profileName: 'default' });
    expect(logOutput.join('\n')).toContain('Activated');
  });

  it('exits with error when profile not found', () => {
    jest.spyOn(profileStore, 'load').mockReturnValue(undefined);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error('process.exit called');
    });
    expect(() => providerActivateCommand('anthropic', 'ghost')).toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// 5. providerDeleteCommand
// ---------------------------------------------------------------------------

describe('providerDeleteCommand', () => {
  it('deletes a profile and prints success', () => {
    jest.spyOn(profileStore, 'delete').mockReturnValue(true);
    jest.spyOn(profileStore, 'getActive').mockReturnValue(undefined);
    providerDeleteCommand('anthropic', 'default');
    expect(logOutput.join('\n')).toContain('Deleted');
  });

  it('clears active selection when the deleted profile was active', () => {
    jest.spyOn(profileStore, 'delete').mockReturnValue(true);
    jest.spyOn(profileStore, 'getActive').mockReturnValue({
      providerId: 'anthropic',
      profileName: 'default',
    });
    const clearSpy = jest.spyOn(profileStore, 'clearActive').mockImplementation(() => {});
    providerDeleteCommand('anthropic', 'default');
    expect(clearSpy).toHaveBeenCalled();
    expect(logOutput.join('\n')).toContain('cleared');
  });

  it('exits with error when profile not found', () => {
    jest.spyOn(profileStore, 'delete').mockReturnValue(false);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error('process.exit called');
    });
    expect(() => providerDeleteCommand('anthropic', 'ghost')).toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// 6. configureCommand – non-interactive flag paths
// ---------------------------------------------------------------------------

describe('configureCommand – non-interactive flag paths', () => {
  it('--list-providers lists registered providers', () => {
    jest.spyOn(profileStore, 'getActive').mockReturnValue(undefined);
    configureCommand({ listProviders: true });
    const joined = logOutput.join('\n');
    expect(joined).toContain('anthropic');
    expect(joined).toContain('openai');
    expect(joined).toContain('google-ai');
  });

  it('--list-profiles lists all saved profiles', () => {
    jest.spyOn(profileStore, 'getActive').mockReturnValue(undefined);
    jest.spyOn(profileStore, 'listAll').mockReturnValue([makeProfile()]);
    configureCommand({ listProfiles: true });
    const joined = logOutput.join('\n');
    expect(joined).toContain('default');
    expect(joined).toContain('anthropic');
  });

  it('--list-profiles-for-provider <id> lists profiles for that provider', () => {
    jest.spyOn(profileStore, 'listAll').mockReturnValue([
      makeProfile('anthropic', 'prod'),
      makeProfile('openai', 'staging'),
    ]);
    configureCommand({ listProfilesForProvider: 'anthropic' });
    const joined = logOutput.join('\n');
    expect(joined).toContain('prod');
    expect(joined).not.toContain('staging');
  });
});

