/**
 * references-manager.ts
 *
 * Build, prune, and render the document-level references map for the
 * `generate-shot-list` command (filmbuff-prompt-JIRA DR-8, Phase 5 / bd-f5b3).
 *
 * A "references map" maps symbolic keys (e.g. "sarah", "lake-sunrise") to
 * absolute HTTPS URLs or data URIs representing reference images.  Keys are
 * derived from character and scene assignments in the filmbuff project, then
 * pruned to include only keys actually referenced by shots.
 *
 * Public API:
 *   resolveReferences(project)            — build the document-level map
 *   pruneUnusedKeys(map, shotRefs)        — remove keys not used by any shot
 *   normalizeReferenceKey(name)           — normalise character/scene names to key format
 *   renderReferencesSection(map)          — emit the ## References Markdown section
 *   renderShotReferencesLine(keys)        — emit the **References:** per-shot line
 *
 * Spec: filmbuff-prompt-JIRA DR-8 (references map format and placement)
 * Beads: bd-f5b3 (Phase 5)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A character or scene image assignment from the filmbuff project. */
export interface ReferenceAssignment {
  /** Character or scene name (raw; will be normalised to a key). */
  name: string;
  /**
   * Absolute HTTPS URL or data:image/... URI for the reference image.
   * Must pass V-2 validation before export.
   */
  url: string;
}

/**
 * Minimal filmbuff project shape needed to build the references map.
 * Consumers should supply the relevant arrays; absent arrays are treated as empty.
 */
export interface FilmbuffProject {
  /** Per-character image assignments (from the filmbuff project UI). */
  characterImages?: ReferenceAssignment[];
  /** Per-scene / location image assignments. */
  sceneImages?: ReferenceAssignment[];
}

/** Document-level references map: symbolic key → image URL. */
export type ReferencesMap = Map<string, string>;

// ---------------------------------------------------------------------------
// Key normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a character or scene name to the reference key format.
 *
 * Rules (DR-8):
 *   - Lowercase
 *   - Replace spaces and underscores with hyphens
 *   - Strip characters not in [a-z0-9-]
 *   - Remove leading hyphens
 *
 * @example normalizeReferenceKey("Sarah Connor") → "sarah-connor"
 * @example normalizeReferenceKey("Lake Sunrise!") → "lake-sunrise"
 */
export function normalizeReferenceKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')          // spaces/underscores → hyphens
    .replace(/[^a-z0-9-]/g, '')       // strip non-alphanumeric (except hyphens)
    .replace(/^-+/, '');              // remove leading hyphens
}

// ---------------------------------------------------------------------------
// resolveReferences
// ---------------------------------------------------------------------------

/**
 * Build the document-level references map from the filmbuff project.
 *
 * Merge precedence (higher wins on duplicate keys):
 *   1. Per-character image assignments
 *   2. Per-scene image assignments
 *
 * Duplicate keys (same character referenced twice) retain the most-recently
 * assigned URL per DR-8.
 */
export function resolveReferences(project: FilmbuffProject): ReferencesMap {
  const map: ReferencesMap = new Map();

  // Layer 1: scene images (lower precedence — applied first)
  for (const assignment of project.sceneImages ?? []) {
    const key = normalizeReferenceKey(assignment.name);
    if (key.length > 0) {
      map.set(key, assignment.url);
    }
  }

  // Layer 2: character images (higher precedence — applied second; overrides scene)
  for (const assignment of project.characterImages ?? []) {
    const key = normalizeReferenceKey(assignment.name);
    if (key.length > 0) {
      map.set(key, assignment.url);
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// pruneUnusedKeys
// ---------------------------------------------------------------------------

/**
 * Remove keys from the map that are not referenced by any shot.
 *
 * Per DR-8: "The map must only contain keys that are actually referenced by
 * at least one shot in items. Unused keys MUST be omitted."
 *
 * @param map      — document-level references map (modified in place and returned)
 * @param shotRefs — array of per-shot reference-key arrays (from all shots)
 * @returns        — pruned map (same object, modified in place)
 */
export function pruneUnusedKeys(
  map: ReferencesMap,
  shotRefs: ReadonlyArray<ReadonlyArray<string>>
): ReferencesMap {
  const usedKeys = new Set<string>();
  for (const refs of shotRefs) {
    for (const key of refs) {
      usedKeys.add(key);
    }
  }

  for (const key of map.keys()) {
    if (!usedKeys.has(key)) {
      map.delete(key);
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

/**
 * Render the ## References section that appears at the top of shot-list.md
 * when reference images exist (DR-8 Markdown Shot Lists).
 *
 * Example output:
 *   ## References
 *
 *   - sarah: https://cdn.example.com/cast/sarah-frame0.jpg
 *   - sarah-end: https://cdn.example.com/cast/sarah-frame1.jpg
 *
 * Returns an empty string when the map is empty.
 */
export function renderReferencesSection(map: ReferencesMap): string {
  if (map.size === 0) return '';

  const lines = ['## References', ''];
  for (const [key, url] of map) {
    lines.push(`- ${key}: ${url}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Render the per-shot **References:** line that appears after the shot heading
 * and before the **Video Controls:** table (DR-8 Markdown Shot Lists).
 *
 * Example output:
 *   **References:** sarah, sarah-end
 *
 * Returns an empty string when the shot has no reference keys.
 */
export function renderShotReferencesLine(keys: readonly string[]): string {
  if (keys.length === 0) return '';
  return `**References:** ${keys.join(', ')}`;
}
