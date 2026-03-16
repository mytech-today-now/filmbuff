/**
 * Shot List Validator
 * 
 * Validates shot lists against character and duration limits
 */

import { ShotList, Shot, Warning, GeneratorConfig } from './types';

/**
 * Validator class for shot list validation
 */
export class ShotListValidator {
  /**
   * Validate entire shot list
   */
  validate(shotList: ShotList, config: GeneratorConfig): Warning[] {
    const warnings: Warning[] = [];

    // Validate each shot
    for (const shot of shotList.shots) {
      warnings.push(...this.validateShot(shot, config));
    }

    return warnings;
  }

  /**
   * Validate individual shot
   */
  validateShot(shot: Shot, config: GeneratorConfig): Warning[] {
    const warnings: Warning[] = [];

    // Validate character count
    warnings.push(...this.validateCharacterCount(shot, config));

    // Validate duration
    warnings.push(...this.validateDuration(shot, config));

    // Quality gates: Validate field consistency
    warnings.push(...this.validateFieldConsistency(shot));

    return warnings;
  }

  /**
   * Validate character count against limits
   */
  private validateCharacterCount(shot: Shot, config: GeneratorConfig): Warning[] {
    const warnings: Warning[] = [];
    const warningThreshold = config.maxCharacters * (config.warningThreshold / 100);

    // Error: Exceeds limit
    if (shot.characterCount > config.maxCharacters) {
      warnings.push({
        type: 'character-limit-error',
        message: `Shot ${shot.number} exceeds character limit (${shot.characterCount.toLocaleString()}/${config.maxCharacters.toLocaleString()})`,
        shotNumber: shot.number,
        severity: 'error',
        suggestion: 'Reduce description length or split into multiple shots'
      });
    }
    // Warning: Approaching limit (90% threshold)
    else if (shot.characterCount >= warningThreshold) {
      const percentage = Math.round((shot.characterCount / config.maxCharacters) * 100);
      warnings.push({
        type: 'character-limit-warning',
        message: `Shot ${shot.number} approaching character limit (${shot.characterCount.toLocaleString()}/${config.maxCharacters.toLocaleString()}, ${percentage}%)`,
        shotNumber: shot.number,
        severity: 'warning',
        suggestion: 'Consider reducing description length'
      });
    }

    return warnings;
  }

  /**
   * Validate duration against limits
   */
  private validateDuration(shot: Shot, config: GeneratorConfig): Warning[] {
    const warnings: Warning[] = [];
    const warningThreshold = config.maxShotLength * (config.warningThreshold / 100);

    // Error: Exceeds limit
    if (shot.duration > config.maxShotLength) {
      warnings.push({
        type: 'duration-limit-error',
        message: `Shot ${shot.number} exceeds duration limit (${shot.duration}s/${config.maxShotLength}s)`,
        shotNumber: shot.number,
        severity: 'error',
        suggestion: 'Split this shot into multiple shorter shots'
      });
    }
    // Warning: Approaching limit (90% threshold)
    else if (shot.duration >= warningThreshold) {
      const percentage = Math.round((shot.duration / config.maxShotLength) * 100);
      warnings.push({
        type: 'duration-limit-warning',
        message: `Shot ${shot.number} approaching duration limit (${shot.duration}s/${config.maxShotLength}s, ${percentage}%)`,
        shotNumber: shot.number,
        severity: 'warning',
        suggestion: 'Consider splitting into multiple shots'
      });
    }

    return warnings;
  }

  /**
   * Quality Gate: Validate field consistency
   * Checks for conflicts and inconsistencies between Description, Actions, Characters, and Blocking
   */
  private validateFieldConsistency(shot: Shot): Warning[] {
    const warnings: Warning[] = [];

    // Check for character-action conflicts
    warnings.push(...this.detectDescriptionActionConflicts(shot));

    // Check for character consistency
    warnings.push(...this.detectCharacterInconsistencies(shot));

    // Check for field duplication
    warnings.push(...this.detectFieldDuplication(shot));

    return warnings;
  }

  /**
   * Detect conflicts between Description and Actions fields
   * Example: Description says "waving staff" but Actions says "pauses, sighs"
   */
  private detectDescriptionActionConflicts(shot: Shot): Warning[] {
    const warnings: Warning[] = [];

    // Extract action verbs from description
    const descriptionActionVerbs = this.extractActionVerbs(shot.description);
    const actionsActionVerbs = this.extractActionVerbs(shot.actions);

    // Check if description contains character actions that conflict with Actions field
    if (descriptionActionVerbs.length > 0 && actionsActionVerbs.length > 0) {
      // Check for conflicting verbs
      const conflicts = descriptionActionVerbs.filter(descVerb =>
        !actionsActionVerbs.some(actVerb => actVerb.includes(descVerb) || descVerb.includes(actVerb))
      );

      if (conflicts.length > 0) {
        warnings.push({
          type: 'description-action-conflict',
          message: `Shot ${shot.number}: Description contains character actions ("${conflicts.join('", "')}") that may conflict with Actions field`,
          shotNumber: shot.number,
          severity: 'warning',
          suggestion: 'Description should focus on environment/set only, not character actions'
        });
      }
    }

    return warnings;
  }

  /**
   * Detect character inconsistencies
   * Example: Description mentions characters but Characters field is empty
   */
  private detectCharacterInconsistencies(shot: Shot): Warning[] {
    const warnings: Warning[] = [];

    // Check if description mentions character names but Characters field is empty
    const characterMentions = this.extractCharacterNames(shot.description);

    if (characterMentions.length > 0 && (!shot.characters || shot.characters.length === 0)) {
      warnings.push({
        type: 'description-character-inconsistency',
        message: `Shot ${shot.number}: Description mentions characters (${characterMentions.join(', ')}) but Characters field is empty`,
        shotNumber: shot.number,
        severity: 'warning',
        suggestion: 'Character introductions should be in Characters field, not Description'
      });
    }

    return warnings;
  }

  /**
   * Detect field duplication
   * Example: Same information appears in both Description and Actions
   */
  private detectFieldDuplication(shot: Shot): Warning[] {
    const warnings: Warning[] = [];

    // Check if description and actions contain similar content
    const descWords = shot.description.toLowerCase().split(/\s+/);
    const actionWords = shot.actions.toLowerCase().split(/\s+/);

    // Find common phrases (3+ words)
    const commonPhrases = this.findCommonPhrases(descWords, actionWords, 3);

    if (commonPhrases.length > 0) {
      warnings.push({
        type: 'field-duplication',
        message: `Shot ${shot.number}: Description and Actions contain duplicate information`,
        shotNumber: shot.number,
        severity: 'warning',
        suggestion: 'Remove duplicate content - Description should be environment only, Actions should be character actions only'
      });
    }

    return warnings;
  }

  /**
   * Extract action verbs from text
   * Uses context-aware detection to avoid false positives like "looks like"
   */
  private extractActionVerbs(text: string): string[] {
    const actionVerbs = [
      'waving', 'waved', 'wave',
      'pausing', 'paused', 'pause', 'pauses',
      'sighing', 'sighed', 'sigh', 'sighs',
      'standing', 'stood', 'stand', 'stands',
      'sitting', 'sat', 'sit', 'sits',
      'walking', 'walked', 'walk', 'walks',
      'running', 'ran', 'run', 'runs',
      'looking', 'looked', 'look', 'looks',
      'turning', 'turned', 'turn', 'turns',
      'moving', 'moved', 'move', 'moves',
      'gesturing', 'gestured', 'gesture', 'gestures',
      'pointing', 'pointed', 'point', 'points',
      'reaching', 'reached', 'reach', 'reaches',
      'grabbing', 'grabbed', 'grab', 'grabs',
      'holding', 'held', 'hold', 'holds',
      'carrying', 'carried', 'carry', 'carries'
    ];

    // Descriptive phrases that should NOT be flagged as actions
    const descriptivePhrases = [
      'looks like',
      'looks similar',
      'looks typical',
      'appears like',
      'appears similar',
      'stands out',
      'stands for',
      'holds up',
      'holds true'
    ];

    const found: string[] = [];
    const lowerText = text.toLowerCase();

    // First, check if any descriptive phrases are present
    const hasDescriptivePhrase = descriptivePhrases.some(phrase => lowerText.includes(phrase));

    for (const verb of actionVerbs) {
      if (lowerText.includes(verb)) {
        // If this verb is part of a descriptive phrase, skip it
        let isDescriptive = false;

        for (const phrase of descriptivePhrases) {
          if (phrase.includes(verb) && lowerText.includes(phrase)) {
            isDescriptive = true;
            break;
          }
        }

        if (!isDescriptive) {
          found.push(verb);
        }
      }
    }

    return found;
  }

  /**
   * Extract character names from text (capitalized words)
   */
  private extractCharacterNames(text: string): string[] {
    // Look for character introductions with parenthetical descriptions
    // Example: "WIZARD CLIF HIGH (mid-70s, magnificent long white beard...)"
    const characterIntroPattern = /([A-Z][A-Z\s]+)\s*\([^)]*\)/g;
    const matches = text.match(characterIntroPattern) || [];

    // Extract just the name part (before the parenthesis)
    const names = matches.map(match => {
      const nameMatch = match.match(/([A-Z][A-Z\s]+)\s*\(/);
      return nameMatch ? nameMatch[1].trim() : '';
    }).filter(name => name.length > 0);

    return [...new Set(names)];
  }

  /**
   * Find common phrases between two word arrays
   */
  private findCommonPhrases(words1: string[], words2: string[], minLength: number): string[] {
    const phrases: string[] = [];

    for (let i = 0; i < words1.length - minLength + 1; i++) {
      const phrase = words1.slice(i, i + minLength).join(' ');
      const phrase2 = words2.join(' ');

      if (phrase2.includes(phrase)) {
        phrases.push(phrase);
      }
    }

    return phrases;
  }

  /**
   * Get validation summary
   */
  getValidationSummary(warnings: Warning[]): {
    totalWarnings: number;
    totalErrors: number;
    byType: Record<string, number>;
  } {
    const summary = {
      totalWarnings: warnings.filter(w => w.severity === 'warning').length,
      totalErrors: warnings.filter(w => w.severity === 'error').length,
      byType: {} as Record<string, number>
    };

    // Count by type
    for (const warning of warnings) {
      summary.byType[warning.type] = (summary.byType[warning.type] || 0) + 1;
    }

    return summary;
  }
}

/**
 * Create validator instance
 */
export function createValidator(): ShotListValidator {
  return new ShotListValidator();
}

