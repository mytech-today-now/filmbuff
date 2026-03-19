/**
 * Genre Blending and Style Module Loading
 *
 * Parses a genre string that may contain multiple genres separated by "+" or ","
 * (e.g. "action+comedy", "noir,thriller"), resolves each genre's rule file from
 * the filmbuff writing-standards modules, and merges them into a single blended
 * context string suitable for injection into the generation pipeline.
 *
 * Style modules (e.g. cinematic-styles/directors/david-fincher) are loaded
 * from the filmbuff/ tree and appended after genre rules.
 *
 * Satisfies: bd-pipe-c7 buff-core.03.02.01 - Implement genre blending and
 *            style module loading
 */

import * as fs from 'fs';
import * as path from 'path';
import { getModulesDir } from '../utils/module-system.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Relative path from the filmbuff modules root to the genres rules directory. */
const GENRES_RULES_DIR = path.join(
  'writing-standards', 'screenplay', 'genres', 'rules',
);

/** Relative path from the filmbuff modules root to cinematic-styles. */
const CINEMATIC_STYLES_DIR = path.join(
  'writing-standards', 'screenplay', 'cinematic-styles',
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlendedStyle {
  /** Canonical genre identifiers resolved from the input string. */
  genres: string[];
  /** Canonical style module identifiers resolved from the input list. */
  styles: string[];
  /**
   * Merged Markdown content combining all genre rules and style guides,
   * ready to be injected as a `style_module` context snapshot.
   */
  blendedContent: string;
  /** Any genre or style names that could not be resolved (for diagnostics). */
  unresolved: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a user-supplied name to a filesystem-safe slug. */
function toSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Read a file, returning its content or null if it does not exist. */
function readOptional(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Attempt to find and read a genre rules file.
 * Looks first for `<slug>.md` in the flat rules/ directory, then for
 * `<slug>/rules/<slug>.md` inside a sub-module directory.
 */
function readGenreRules(modulesDir: string, slug: string): string | null {
  // Flat rules file (most genres)
  const flat = path.join(modulesDir, GENRES_RULES_DIR, `${slug}.md`);
  const flatContent = readOptional(flat);
  if (flatContent) return flatContent;

  // Sub-module rules file
  const sub = path.join(
    modulesDir, 'writing-standards', 'screenplay', 'genres', slug, 'rules', `${slug}.md`,
  );
  return readOptional(sub);
}

/**
 * Attempt to find and read a style module file.
 * Searches recursively inside the cinematic-styles directory for a file whose
 * stem matches the requested slug.
 */
function readStyleModule(modulesDir: string, slug: string): string | null {
  const stylesRoot = path.join(modulesDir, CINEMATIC_STYLES_DIR);
  if (!fs.existsSync(stylesRoot)) return null;

  // Walk the tree looking for <slug>.md
  const candidates: string[] = [];
  (function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); }
      else if (e.isFile() && e.name === `${slug}.md`) { candidates.push(full); }
    }
  })(stylesRoot);

  return candidates.length ? readOptional(candidates[0]) : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the user-supplied genre string and optional style modules list,
 * load the corresponding rule files, and return a BlendedStyle object.
 *
 * @param genreString  Raw genre value from project (e.g. "action+comedy")
 * @param styleModules Optional list of style identifiers (e.g. ["david-fincher"])
 * @param modulesDir   Override the filmbuff modules root (for testing)
 */
export function blendGenresAndStyles(
  genreString: string,
  styleModules: string[] = [],
  modulesDir?: string,
): BlendedStyle {
  const root = modulesDir ?? getModulesDir();
  const unresolved: string[] = [];
  const sections: string[] = [];

  // --- Parse genres ---
  const genreSlugs = genreString
    .split(/[+,]/)
    .map(toSlug)
    .filter(Boolean);

  const resolvedGenres: string[] = [];
  for (const slug of genreSlugs) {
    const content = readGenreRules(root, slug);
    if (content) {
      resolvedGenres.push(slug);
      sections.push(`## Genre: ${slug}\n\n${content.trim()}`);
    } else {
      unresolved.push(slug);
    }
  }

  // --- Parse style modules ---
  const styleSlugs = styleModules.map(toSlug).filter(Boolean);
  const resolvedStyles: string[] = [];
  for (const slug of styleSlugs) {
    const content = readStyleModule(root, slug);
    if (content) {
      resolvedStyles.push(slug);
      sections.push(`## Style: ${slug}\n\n${content.trim()}`);
    } else {
      unresolved.push(slug);
    }
  }

  const blendedContent = sections.join('\n\n---\n\n');

  return {
    genres:  resolvedGenres,
    styles:  resolvedStyles,
    blendedContent,
    unresolved,
  };
}

