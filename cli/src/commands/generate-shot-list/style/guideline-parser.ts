/**
 * Guideline Parser
 * 
 * Parses cinematic style guidelines from markdown files
 */

import { StyleGuidelines, GuidelineParser as IGuidelineParser } from './types';

/**
 * Guideline parser implementation
 */
export class GuidelineParser implements IGuidelineParser {
  /**
   * Parse guidelines from markdown content
   */
  parseGuidelines(markdown: string): StyleGuidelines {
    return {
      cameraWork: {
        preferredFraming: this.extractList(markdown, 'framing', 'camera'),
        preferredMovement: this.extractList(markdown, 'movement', 'camera'),
        preferredAngles: this.extractList(markdown, 'angles', 'camera'),
        techniques: this.extractList(markdown, 'techniques', 'camera'),
      },
      visualCharacteristics: {
        colorPalette: this.extractList(markdown, 'color', 'visual'),
        lighting: this.extractList(markdown, 'lighting', 'visual'),
        composition: this.extractList(markdown, 'composition', 'visual'),
      },
      pacingAndRhythm: {
        editingStyle: this.extractList(markdown, 'editing', 'pacing'),
        shotDuration: this.extractValue(markdown, 'shot duration', 'pacing') || 'varies',
        transitions: this.extractList(markdown, 'transitions', 'pacing'),
      },
      characterBlocking: {
        staging: this.extractList(markdown, 'staging', 'blocking'),
        movement: this.extractList(markdown, 'movement', 'blocking'),
      },
      dialogueDelivery: {
        pacing: this.extractList(markdown, 'pacing', 'dialogue'),
        style: this.extractList(markdown, 'style', 'dialogue'),
      },
    };
  }
  
  /**
   * Extract a specific section from markdown
   */
  extractSection(markdown: string, sectionName: string): string {
    const regex = new RegExp(`##\\s+${sectionName}[\\s\\S]*?(?=##|$)`, 'i');
    const match = markdown.match(regex);
    return match ? match[0] : '';
  }
  
  /**
   * Extract a list of values from markdown
   */
  private extractList(markdown: string, keyword: string, context: string): string[] {
    const values: string[] = [];
    
    // Look for bullet points containing the keyword
    const lines = markdown.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        const content = trimmed.substring(1).trim();
        if (this.matchesKeyword(content, keyword, context)) {
          const value = this.extractValue(content, keyword, context);
          if (value) {
            values.push(value);
          }
        }
      }
    }
    
    // Also look for inline mentions
    const inlineRegex = new RegExp(`${keyword}[:\\s]+([^.\\n]+)`, 'gi');
    let match;
    while ((match = inlineRegex.exec(markdown)) !== null) {
      const value = match[1].trim();
      if (value && !values.includes(value)) {
        values.push(value);
      }
    }
    
    return values;
  }
  
  /**
   * Extract a single value from markdown
   */
  private extractValue(markdown: string, keyword: string, context: string): string | null {
    const regex = new RegExp(`${keyword}[:\\s]+([^.\\n]+)`, 'i');
    const match = markdown.match(regex);
    return match ? match[1].trim() : null;
  }
  
  /**
   * Check if content matches keyword in context
   */
  private matchesKeyword(content: string, keyword: string, context: string): boolean {
    const lowerContent = content.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    const lowerContext = context.toLowerCase();
    
    return lowerContent.includes(lowerKeyword) || lowerContent.includes(lowerContext);
  }
}

/**
 * Create a guideline parser
 */
export function createGuidelineParser(): GuidelineParser {
  return new GuidelineParser();
}

