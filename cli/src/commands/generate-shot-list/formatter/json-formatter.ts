/**
 * JSON Formatter
 *
 * Generates JSON output with valid JSON structure and all shot metadata
 */

import { BaseFormatter } from './base-formatter';
import { ShotList, Shot, Warning } from '../generator/types';
import { FormatterOptions } from './types';

/**
 * JSON formatter implementation
 */
export class JSONFormatter extends BaseFormatter {
  /**
   * Format shot list to JSON
   */
  format(shotList: ShotList, options?: FormatterOptions): string {
    const prettyPrint = options?.prettyPrint !== false; // Default to true
    const includeWarnings = options?.includeWarnings !== false; // Default to true

    // Build JSON-serializable object
    const output = {
      metadata: {
        title: shotList.title || null,
        author: shotList.author || null,
        generatedAt: shotList.metadata.generatedAt.toISOString(),
        sourceFormat: shotList.metadata.sourceFormat,
        maxCharacters: shotList.metadata.maxCharacters,
        maxShotLength: shotList.metadata.maxShotLength
      },
      summary: {
        totalShots: shotList.totalShots,
        totalDuration: shotList.totalDuration,
        totalDurationFormatted: this.formatDuration(shotList.totalDuration),
        totalCharacters: shotList.totalCharacters,
        averageShotLength: parseFloat(this.getAverageShotLength(shotList)),
        averageCharacters: this.getAverageCharCount(shotList),
        maxCharacters: this.getMaxCharCount(shotList)
      },
      warnings: includeWarnings ? this.formatWarnings(shotList.warnings) : [],
      shots: shotList.shots.map(shot => this.formatShot(shot, options))
    };

    // Serialize to JSON
    if (prettyPrint) {
      return JSON.stringify(output, null, 2);
    } else {
      return JSON.stringify(output);
    }
  }

  /**
   * Format individual shot for JSON
   * Requirement 12: Include all fields from Shot interface
   */
  private formatShot(shot: Shot, options?: FormatterOptions): any {
    const includeWarnings = options?.includeWarnings !== false;

    return {
      number: shot.number,
      sceneNumber: shot.sceneNumber,
      heading: {
        raw: shot.heading.raw,
        intExt: shot.heading.intExt,
        location: shot.heading.location,
        timeOfDay: shot.heading.timeOfDay
      },
      context: {
        set: shot.context.set,
        lighting: shot.context.lighting,
        timeOfDay: shot.context.timeOfDay,
        atmosphere: shot.context.atmosphere || null,
        weather: shot.context.weather || null
      },
      characters: shot.characters.map(char => ({
        name: char.name,
        position: char.position,
        appearance: char.appearance,
        wardrobe: char.wardrobe || null,              // Requirement 10: Rich character descriptions
        physicalAppearance: char.physicalAppearance || null,  // Requirement 10: Rich character descriptions
        emotion: char.emotion || null,
        action: char.action || null
      })),
      set: shot.set,
      description: shot.description,
      actions: shot.actions,
      dialogue: shot.dialogue,  // Requirement 8 & 12: Mandatory dialogue property
      blocking: shot.blocking,
      sfx: shot.sfx,
      techDetails: shot.techDetails,
      metadata: {
        shotType: shot.metadata.shotType,
        cameraMovement: shot.metadata.cameraMovement,
        framing: shot.metadata.framing,
        visualStyle: shot.metadata.visualStyle,        // Requirement 5 & 12: Visual style property
        cinematicStyle: shot.metadata.cinematicStyle || null,  // Requirement 12: Cinematic style
        technicalNotes: shot.metadata.technicalNotes || []
      },
      duration: {
        seconds: shot.duration,
        formatted: this.formatTime(shot.duration)
      },
      characterCount: {
        count: shot.characterCount,
        limit: options?.maxCharacters || shot.characterCount,
        percentage: Math.round((shot.characterCount / (options?.maxCharacters || shot.characterCount)) * 100)
      },
      warnings: includeWarnings ? this.formatWarnings(shot.warnings) : []
    };
  }

  /**
   * Format warnings for JSON
   */
  private formatWarnings(warnings: Warning[]): any[] {
    return warnings.map(warning => ({
      type: warning.type,
      message: warning.message,
      shotNumber: warning.shotNumber,
      severity: warning.severity,
      suggestion: warning.suggestion || null
    }));
  }

  /**
   * Get file extension
   */
  getExtension(): string {
    return 'json';
  }

  /**
   * Get MIME type
   */
  getMimeType(): string {
    return 'application/json';
  }
}
