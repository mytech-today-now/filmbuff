/**
 * env-loader.ts
 *
 * Singleton dotenv loader for the FilmBuff CLI.
 *
 * Called once at the very start of cli.ts so that API keys and AI config
 * variables from the user's .env file are available in process.env before
 * any command handler runs.
 *
 * Dotenv's default behaviour is preserved: shell environment variables are
 * NOT overridden by the .env file.  Shell exports always take precedence.
 *
 * The parsed set is exported so that ai-status and ai-env can distinguish
 * "[from .env]" from "[from shell]" in their output.
 */

import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvLoadResult {
  /** Whether a .env file was found and loaded without errors. */
  loaded: boolean;
  /** Absolute path that was searched for a .env file. */
  filePath: string;
  /** Names of variables that were read from the .env file. */
  fromDotEnv: Set<string>;
}

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let _result: EnvLoadResult | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk up from `startDir` looking for a `.env` file.
 * Searches up to 6 levels so the repo root is always found whether the user
 * runs `filmbuff` from within a subdirectory or from the repo root itself.
 *
 * @internal
 */
function _findDotEnv(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}

/**
 * Load variables from a .env file into process.env (idempotent — no-ops on
 * second and subsequent calls).
 *
 * Search order (first match wins):
 *   1. `envPath` if explicitly supplied
 *   2. Walk up from `process.cwd()` looking for a `.env` file (up to 6 levels)
 *
 * This means `.env` can live at the repo root and will be found regardless of
 * which subdirectory the user runs `filmbuff` from.
 *
 * Existing shell environment variables are NOT overridden.
 *
 * @param envPath  Absolute path to the .env file.  Default: auto-discovered.
 */
export function loadDotEnv(envPath?: string): EnvLoadResult {
  if (_result) return _result;

  const filePath = envPath ?? _findDotEnv(process.cwd());

  if (!filePath || !fs.existsSync(filePath)) {
    _result = { loaded: false, filePath: envPath ?? path.resolve(process.cwd(), '.env'), fromDotEnv: new Set() };
    return _result;
  }

  // quiet: true suppresses the dotenv v17 / @dotenvx "◇ injected env …" banner.
  const { error, parsed } = dotenv.config({ path: filePath, quiet: true } as Parameters<typeof dotenv.config>[0]);
  const fromDotEnv = new Set(Object.keys(parsed ?? {}));

  _result = { loaded: !error, filePath, fromDotEnv };
  return _result;
}

/**
 * Return the last EnvLoadResult without triggering a new load.
 * Returns null before loadDotEnv() has been called.
 */
export function getDotEnvResult(): EnvLoadResult | null {
  return _result;
}

/**
 * Reset the singleton (test-only).
 * @internal
 */
export function _resetDotEnvResult(): void {
  _result = null;
}
