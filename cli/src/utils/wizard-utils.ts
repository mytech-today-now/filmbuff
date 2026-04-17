/**
 * wizard-utils.ts — Shared utilities for the interactive `filmbuff start` wizard.
 *
 * All three exported functions are pure and side-effect-free, enabling isolated
 * unit testing without any I/O or database dependencies.
 *
 * Satisfies: bd-bugs [start-wizard] Phase 2: Shared Utilities
 * Spec:      openspec/changes/start-wizard/design.md §5-8
 */

import type { BudgetTier, DocumentFormat, DetailLevel } from '../db/index.js';

// ---------------------------------------------------------------------------
// WizardState — internal state collected across all 12 wizard steps
// ---------------------------------------------------------------------------

/**
 * Internal representation of all data gathered during the wizard flow.
 * Maps 1-to-1 to the corresponding fields of StartOptions.
 * Exported so start-wizard.ts and unit tests can reference it without
 * importing from start.ts (avoids circular dependency).
 */
export interface WizardState {
  title:     string;
  genre:     string;
  slug:      string;
  tone?:     string;
  audience?: string;
  budget?:   BudgetTier;
  outcome?:  string;
  outputDir: string;
  /** Ordered list of output formats; first entry is the primary format stored in the DB. */
  format:    DocumentFormat[];
  detail:    DetailLevel;
  styles:           string[];
  /** Industry-standard narrative format identifier (e.g. 'feature-std', 'tv-half-hour'). */
  narrativeLength?: string;
  provider?:        string;
  profile?:         string;
}

// ---------------------------------------------------------------------------
// deriveSlug — URL-safe slug from a project title
// ---------------------------------------------------------------------------

/**
 * Derive a URL-safe slug from a project title.
 *
 * Algorithm:
 *   1. NFD Unicode normalisation (decomposes composite characters)
 *   2. Lowercase
 *   3. Strip combining diacritical marks (U+0300–U+036F)
 *   4. Remove characters that are not alphanumeric, spaces, or hyphens
 *   5. Trim leading/trailing whitespace
 *   6. Collapse runs of whitespace/hyphens into a single hyphen
 *   7. Strip leading/trailing hyphens
 *
 * Examples:
 *   'The Midnight Run'    → 'the-midnight-run'
 *   '2046: A Space Drama' → '2046-a-space-drama'
 *   '  Untitled Project ' → 'untitled-project'
 *   'Björk\'s Comeback!!' → 'bjorks-comeback'
 *   'ROMANCe & Action'    → 'romance-action'
 */
export function deriveSlug(title: string): string {
  return title
    .normalize('NFD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')    // strip combining diacritics
    .replace(/[^a-z0-9\s-]/g, '')       // remove non-alphanumeric except spaces/hyphens
    .trim()
    .replace(/[\s-]+/g, '-')            // collapse whitespace/hyphen runs
    .replace(/^-+|-+$/g, '');           // strip leading/trailing hyphens
}

// ---------------------------------------------------------------------------
// normaliseGenre — canonical genre string with alias resolution
// ---------------------------------------------------------------------------

const GENRE_ALIASES: Readonly<Record<string, string>> = {
  'sci fi':   'sci-fi',
  'scifi':    'sci-fi',
  'rom com':  'romantic-comedy',
  'romcom':   'romantic-comedy',
  'rom-com':  'romantic-comedy',
};

/**
 * Normalise a genre string, resolving known aliases and trimming whitespace.
 *
 * Comma-separated multi-genre input is split and each token normalised
 * independently before being re-joined with ', '.
 *
 * Examples:
 *   'sci fi'          → 'sci-fi'
 *   'romcom'          → 'romantic-comedy'
 *   'rom-com'         → 'romantic-comedy'
 *   'thriller'        → 'thriller'  (no-op)
 *   '  Drama  '       → 'Drama'     (trimmed, case preserved for non-aliases)
 *   'sci fi, rom com' → 'sci-fi, romantic-comedy'
 */
export function normaliseGenre(raw: string): string {
  // Delegate comma-separated tokens recursively
  if (raw.includes(',')) {
    return raw
      .split(',')
      .map((token) => normaliseGenre(token))
      .join(', ');
  }

  const trimmed = raw.trim();
  return GENRE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

// ---------------------------------------------------------------------------
// buildEquivalentCommand — reconstruct the filmbuff start one-liner
// ---------------------------------------------------------------------------

/**
 * Build a multi-line `filmbuff start` command string that exactly reproduces
 * the wizard-collected settings when run non-interactively.
 *
 * Rules:
 *   - Values containing spaces are double-quoted; values without spaces are not.
 *   - Undefined optional fields (tone, audience, budget, outcome, provider,
 *     profile) are omitted entirely — no flag is emitted for them.
 *   - Each style module is emitted as a separate --style flag in collection order.
 *   - Lines are joined with ' \\\n' to produce a shell-continuable multi-liner.
 */
export function buildEquivalentCommand(state: WizardState): string {
  const q = (s: string): string => (s.includes(' ') ? `"${s}"` : s);
  const flags: string[] = ['filmbuff start'];

  flags.push(`  --title ${q(state.title)}`);
  flags.push(`  --genre ${q(state.genre)}`);

  if (state.tone)     flags.push(`  --tone ${q(state.tone)}`);
  if (state.audience) flags.push(`  --audience ${q(state.audience)}`);
  if (state.budget)   flags.push(`  --budget ${state.budget}`);
  if (state.outcome)         flags.push(`  --outcome ${q(state.outcome)}`);
  if (state.narrativeLength) flags.push(`  --narrative-length ${state.narrativeLength}`);

  // output-dir is auto-derived from slug — omit it from the equivalent command
  for (const fmt of state.format) {
    flags.push(`  --format ${fmt}`);
  }
  flags.push(`  --detail ${state.detail}`);

  for (const style of state.styles) {
    flags.push(`  --style ${q(style)}`);
  }

  if (state.provider) flags.push(`  --ai-provider ${state.provider}`);
  if (state.profile)  flags.push(`  --ai-profile ${state.profile}`);

  return flags.join(' \\\n');
}
