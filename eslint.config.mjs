/**
 * ESLint Flat Config — FilmBuff
 *
 * Enforces provider builtin isolation via no-restricted-imports.
 *
 * Install dependencies (if not already present):
 *   npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
 *
 * Run:
 *   npx eslint cli/src
 *
 * Satisfies: bd-prov-b9 buff-core.02.01.03 - 01
 *   Add ESLint no-restricted-imports rule for provider builtin isolation
 */

// @ts-check
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

// ---------------------------------------------------------------------------
// Shared ignore patterns
// ---------------------------------------------------------------------------

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/*.js',        // compiled output
  '**/*.d.ts',
];

// ---------------------------------------------------------------------------
// Provider builtin isolation rules
//
// Files in cli/src/providers/builtin/ must ONLY import from:
//   ../types.js          — ProviderAdapter, GenerateOptions, GenerateResult
//   ../ProviderRegistry.js — defaultRegistry
//
// Forbidden cross-layer imports:
//   ../../db/*      — database layer (creates tight coupling)
//   ../../utils/*   — utilities (may cause circular deps or expose internals)
//   ../../commands/* — command handlers (violates layer boundary)
//   ../../core/*    — core module (not needed by pure adapters)
//   ../../gui/*     — UI layer (adapters are headless)
//   ../../types/*   — root types (import from ../types.js instead)
//
// Forbidden third-party SDK imports (adapters must use fetch/HTTP only):
//   @anthropic-ai/sdk, openai, @google/generative-ai
// ---------------------------------------------------------------------------

/** @type {import('eslint').Linter.RulesRecord} */
const PROVIDER_BUILTIN_ISOLATION_RULES = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        // Cross-layer: database
        {
          group: ['../../db', '../../db/*'],
          message:
            'Provider builtins must not import from the db layer. ' +
            'Use only ../types.js and ../ProviderRegistry.js.',
        },
        // Cross-layer: utilities
        {
          group: ['../../utils', '../../utils/*'],
          message:
            'Provider builtins must not import from utils. ' +
            'Keep adapters self-contained; use fetch() for HTTP calls.',
        },
        // Cross-layer: commands
        {
          group: ['../../commands', '../../commands/*'],
          message:
            'Provider builtins must not import command handlers. ' +
            'Adapters are leaf-layer modules.',
        },
        // Cross-layer: core
        {
          group: ['../../core', '../../core/*'],
          message:
            'Provider builtins must not import from core. ' +
            'Keep adapters independent of the module system.',
        },
        // Cross-layer: GUI
        {
          group: ['../../gui', '../../gui/*'],
          message: 'Provider builtins must not import GUI modules.',
        },
        // Cross-layer: root types (use ../types.js instead)
        {
          group: ['../../types', '../../types/*'],
          message:
            'Import provider types from ../types.js, not ../../types/.',
        },
        // Third-party SDKs — adapters must use raw fetch() to stay thin
        {
          group: ['@anthropic-ai/sdk', '@anthropic-ai/*'],
          message:
            'Provider builtins must use fetch() directly, not the Anthropic SDK. ' +
            'This keeps the adapter zero-dependency.',
        },
        {
          group: ['openai'],
          message:
            'Provider builtins must use fetch() directly, not the OpenAI SDK.',
        },
        {
          group: ['@google/generative-ai', '@google-ai/*', 'google-auth-library'],
          message:
            'Provider builtins must use fetch() directly, not the Google AI SDK.',
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Config array
// ---------------------------------------------------------------------------

/** @type {import('eslint').Linter.Config[]} */
export default [
  // ── Global ignores ────────────────────────────────────────────────────────
  { ignores: IGNORE_PATTERNS },

  // ── Provider builtin isolation ────────────────────────────────────────────
  {
    files: ['cli/src/providers/builtin/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './cli/tsconfig.json',
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...PROVIDER_BUILTIN_ISOLATION_RULES,
      // Ensure no implicit any slips into adapters
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ── General TypeScript rules (whole cli/src) ──────────────────────────────
  {
    files: ['cli/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './cli/tsconfig.json',
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
];

