/**
 * Style System Entry Point
 * 
 * Orchestrates cinematic style loading, parsing, and merging
 */

import { StyleLoader, StyleModule, MergedStyleGuidelines } from './types';
import { createStyleLoader } from './style-loader';
import { createStyleMerger } from './style-merger';

/**
 * Style system orchestrator
 */
export class StyleSystem {
  private loader: StyleLoader;
  private merger: ReturnType<typeof createStyleMerger>;
  
  constructor(extensionsRoot?: string) {
    this.loader = createStyleLoader(extensionsRoot);
    this.merger = createStyleMerger();
  }
  
  /**
   * Load and merge multiple styles
   */
  async loadStyles(stylePaths: string[]): Promise<MergedStyleGuidelines | null> {
    if (stylePaths.length === 0) {
      return null;
    }
    
    // Load all styles
    const styles: StyleModule[] = [];
    for (let i = 0; i < stylePaths.length; i++) {
      const style = await this.loader.loadStyle(stylePaths[i]);
      style.priority = i + 1;  // First style = priority 1 (highest)
      styles.push(style);
    }
    
    // Merge styles
    return this.merger.mergeStyles(styles);
  }
  
  /**
   * Validate a style path
   */
  async validateStylePath(stylePath: string): Promise<boolean> {
    return this.loader.validateStylePath(stylePath);
  }
  
  /**
   * Get available styles in a category
   */
  async getAvailableStyles(category: string): Promise<string[]> {
    return this.loader.getAvailableStyles(category);
  }
  
  /**
   * Format merged styles for display
   */
  formatStylesForDisplay(merged: MergedStyleGuidelines): string {
    return merged.appliedStyles.join(', ');
  }
}

/**
 * Create a style system instance
 */
export function createStyleSystem(extensionsRoot?: string): StyleSystem {
  return new StyleSystem(extensionsRoot);
}

// Re-export types
export * from './types';
export { createStyleLoader } from './style-loader';
export { createGuidelineParser } from './guideline-parser';
export { createStyleMerger } from './style-merger';

