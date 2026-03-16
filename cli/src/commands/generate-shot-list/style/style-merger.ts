/**
 * Style Merger
 * 
 * Merges multiple cinematic styles with priority-based conflict resolution
 */

import { StyleMerger as IStyleMerger, StyleModule, MergedStyleGuidelines, StyleConflict } from './types';

/**
 * Style merger implementation
 */
export class StyleMerger implements IStyleMerger {
  /**
   * Merge multiple styles with priority-based resolution
   */
  mergeStyles(styles: StyleModule[]): MergedStyleGuidelines {
    if (styles.length === 0) {
      throw new Error('No styles to merge');
    }
    
    // Sort by priority (1 = highest)
    const sortedStyles = [...styles].sort((a, b) => a.priority - b.priority);
    
    // Start with highest priority style
    const primary = sortedStyles[0];
    const merged: MergedStyleGuidelines = {
      ...primary.guidelines,
      appliedStyles: sortedStyles.map((s, i) => 
        `${s.name} (${i === 0 ? 'Primary' : i === 1 ? 'Secondary' : 'Tertiary'})`
      ),
      conflicts: []
    };
    
    // Merge additional styles
    for (let i = 1; i < sortedStyles.length; i++) {
      const style = sortedStyles[i];
      this.mergeIntoGuidelines(merged, style, sortedStyles[0]);
    }
    
    return merged;
  }
  
  /**
   * Merge a style into existing guidelines
   */
  private mergeIntoGuidelines(
    target: MergedStyleGuidelines,
    source: StyleModule,
    primary: StyleModule
  ): void {
    // Merge camera work
    this.mergeArrayField(target.cameraWork, 'preferredFraming', source.guidelines.cameraWork.preferredFraming, target, source, primary);
    this.mergeArrayField(target.cameraWork, 'preferredMovement', source.guidelines.cameraWork.preferredMovement, target, source, primary);
    this.mergeArrayField(target.cameraWork, 'preferredAngles', source.guidelines.cameraWork.preferredAngles, target, source, primary);
    this.mergeArrayField(target.cameraWork, 'techniques', source.guidelines.cameraWork.techniques, target, source, primary);
    
    // Merge visual characteristics
    this.mergeArrayField(target.visualCharacteristics, 'colorPalette', source.guidelines.visualCharacteristics.colorPalette, target, source, primary);
    this.mergeArrayField(target.visualCharacteristics, 'lighting', source.guidelines.visualCharacteristics.lighting, target, source, primary);
    this.mergeArrayField(target.visualCharacteristics, 'composition', source.guidelines.visualCharacteristics.composition, target, source, primary);
    
    // Merge pacing and rhythm
    this.mergeArrayField(target.pacingAndRhythm, 'editingStyle', source.guidelines.pacingAndRhythm.editingStyle, target, source, primary);
    this.mergeArrayField(target.pacingAndRhythm, 'transitions', source.guidelines.pacingAndRhythm.transitions, target, source, primary);
    
    // Merge character blocking
    this.mergeArrayField(target.characterBlocking, 'staging', source.guidelines.characterBlocking.staging, target, source, primary);
    this.mergeArrayField(target.characterBlocking, 'movement', source.guidelines.characterBlocking.movement, target, source, primary);
    
    // Merge dialogue delivery
    this.mergeArrayField(target.dialogueDelivery, 'pacing', source.guidelines.dialogueDelivery.pacing, target, source, primary);
    this.mergeArrayField(target.dialogueDelivery, 'style', source.guidelines.dialogueDelivery.style, target, source, primary);
  }
  
  /**
   * Merge an array field with conflict detection
   */
  private mergeArrayField(
    targetObj: any,
    field: string,
    sourceValues: string[],
    merged: MergedStyleGuidelines,
    source: StyleModule,
    primary: StyleModule
  ): void {
    const targetValues = targetObj[field] as string[];
    
    for (const value of sourceValues) {
      // Check if value conflicts with existing values
      const conflicts = targetValues.filter(tv => this.isConflicting(tv, value));
      
      if (conflicts.length > 0) {
        // Record conflict
        merged.conflicts.push({
          guideline: `${field}: ${value}`,
          styles: [primary.name, source.name],
          resolution: `Using ${primary.name}'s guideline: ${conflicts[0]}`,
          resolvedBy: primary.name
        });
      } else if (!targetValues.includes(value)) {
        // Add complementary value
        targetValues.push(value);
      }
    }
  }
  
  /**
   * Check if two values are conflicting
   */
  private isConflicting(value1: string, value2: string): boolean {
    const v1 = value1.toLowerCase();
    const v2 = value2.toLowerCase();
    
    // Define conflicting pairs
    const conflicts = [
      ['fast-paced', 'slow-paced'],
      ['fast-paced', 'contemplative'],
      ['vibrant', 'desaturated'],
      ['vibrant', 'monochrome'],
      ['high-contrast', 'soft'],
      ['symmetrical', 'asymmetrical'],
      ['static', 'dynamic'],
      ['rapid-fire', 'measured'],
      ['naturalistic', 'stylized']
    ];
    
    for (const [a, b] of conflicts) {
      if ((v1.includes(a) && v2.includes(b)) || (v1.includes(b) && v2.includes(a))) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Resolve conflicts between styles
   */
  resolveConflicts(styles: StyleModule[], guideline: string): string {
    // Always use highest priority style
    return styles[0].name;
  }
}

/**
 * Create a style merger
 */
export function createStyleMerger(): StyleMerger {
  return new StyleMerger();
}

