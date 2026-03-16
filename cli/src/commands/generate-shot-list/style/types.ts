/**
 * Style System Types
 * 
 * Type definitions for cinematic style loading and application
 */

/**
 * Style guidelines extracted from markdown files
 */
export interface StyleGuidelines {
  cameraWork: {
    preferredFraming: string[];      // ["wide", "medium", "close-up"]
    preferredMovement: string[];     // ["static", "dolly", "tracking"]
    preferredAngles: string[];       // ["eye-level", "low-angle", "high-angle"]
    techniques: string[];            // ["split-screen", "long-take", "handheld"]
  };
  visualCharacteristics: {
    colorPalette: string[];          // ["desaturated", "vibrant", "monochrome"]
    lighting: string[];              // ["natural", "high-contrast", "soft"]
    composition: string[];           // ["symmetrical", "rule-of-thirds", "centered"]
  };
  pacingAndRhythm: {
    editingStyle: string[];          // ["fast-paced", "contemplative", "rhythmic"]
    shotDuration: string;            // "average 3-5 seconds" or "long takes 30+ seconds"
    transitions: string[];           // ["hard-cuts", "dissolves", "match-cuts"]
  };
  characterBlocking: {
    staging: string[];               // ["deep-focus", "foreground-background", "isolated"]
    movement: string[];              // ["static", "dynamic", "choreographed"]
  };
  dialogueDelivery: {
    pacing: string[];                // ["rapid-fire", "measured", "overlapping"]
    style: string[];                 // ["naturalistic", "stylized", "improvised"]
  };
}

/**
 * Style module metadata
 */
export interface StyleModule {
  id: string;
  name: string;
  category: 'directors' | 'franchises' | 'films' | 'comedy-formats';
  path: string;
  guidelines: StyleGuidelines;
  priority: number;  // 1 = highest priority
}

/**
 * Merged style guidelines with priority information
 */
export interface MergedStyleGuidelines extends StyleGuidelines {
  appliedStyles: string[];  // ["Brian De Palma (Primary)", "Alfred Hitchcock (Secondary)"]
  conflicts: StyleConflict[];
}

/**
 * Style conflict information
 */
export interface StyleConflict {
  guideline: string;
  styles: string[];
  resolution: string;
  resolvedBy: string;  // Which style won
}

/**
 * Style loader interface
 */
export interface StyleLoader {
  /**
   * Load a style module from path
   */
  loadStyle(modulePath: string): Promise<StyleModule>;
  
  /**
   * Validate a style module path
   */
  validateStylePath(modulePath: string): Promise<boolean>;
  
  /**
   * Get available styles in a category
   */
  getAvailableStyles(category: string): Promise<string[]>;
}

/**
 * Guideline parser interface
 */
export interface GuidelineParser {
  /**
   * Parse guidelines from markdown content
   */
  parseGuidelines(markdown: string): StyleGuidelines;
  
  /**
   * Extract specific section from markdown
   */
  extractSection(markdown: string, sectionName: string): string;
}

/**
 * Style merger interface
 */
export interface StyleMerger {
  /**
   * Merge multiple styles with priority-based resolution
   */
  mergeStyles(styles: StyleModule[]): MergedStyleGuidelines;
  
  /**
   * Resolve conflicts between styles
   */
  resolveConflicts(styles: StyleModule[], guideline: string): string;
}

