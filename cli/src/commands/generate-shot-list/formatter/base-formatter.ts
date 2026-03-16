/**
 * Base Formatter
 * 
 * Abstract base class with common utilities for all formatters
 */

import { ShotList } from '../generator/types';
import { Formatter, FormatterOptions, TimeFormatter, TextWrapper } from './types';

/**
 * Time formatting utilities
 */
export const timeFormatter: TimeFormatter = {
  /**
   * Format seconds to MM:SS
   */
  formatTime(seconds: number): string {
    const roundedSeconds = Math.round(seconds);
    const mins = Math.floor(roundedSeconds / 60);
    const secs = roundedSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  },

  /**
   * Format total duration to human-readable format
   */
  formatDuration(totalSeconds: number): string {
    const roundedSeconds = Math.round(totalSeconds);
    const hours = Math.floor(roundedSeconds / 3600);
    const mins = Math.floor((roundedSeconds % 3600) / 60);
    const secs = roundedSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }
};

/**
 * Text wrapping utilities
 */
export const textWrapper: TextWrapper = {
  /**
   * Wrap text to specified width
   */
  wrapText(text: string, width: number, indent: string = ''): string {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + word).length > width) {
        lines.push(currentLine.trim());
        currentLine = indent + word + ' ';
      } else {
        currentLine += word + ' ';
      }
    }

    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    return lines.join('\n');
  }
};

/**
 * Base formatter class with common utilities
 */
export abstract class BaseFormatter implements Formatter {
  abstract format(shotList: ShotList, options?: FormatterOptions): string;
  abstract getExtension(): string;
  abstract getMimeType(): string;

  /**
   * Format time using utility
   */
  protected formatTime(seconds: number): string {
    return timeFormatter.formatTime(seconds);
  }

  /**
   * Format duration using utility
   */
  protected formatDuration(totalSeconds: number): string {
    return timeFormatter.formatDuration(totalSeconds);
  }

  /**
   * Wrap text using utility
   */
  protected wrapText(text: string, width: number, indent?: string): string {
    return textWrapper.wrapText(text, width, indent);
  }

  /**
   * Calculate average character count
   */
  protected getAverageCharCount(shotList: ShotList): number {
    if (shotList.shots.length === 0) return 0;
    return Math.round(
      shotList.shots.reduce((sum, s) => sum + s.characterCount, 0) / shotList.shots.length
    );
  }

  /**
   * Get maximum character count
   */
  protected getMaxCharCount(shotList: ShotList): number {
    if (shotList.shots.length === 0) return 0;
    return Math.max(...shotList.shots.map(s => s.characterCount));
  }

  /**
   * Calculate average shot length
   */
  protected getAverageShotLength(shotList: ShotList): string {
    if (shotList.shots.length === 0) return '0.0';
    return (shotList.totalDuration / shotList.shots.length).toFixed(1);
  }
}
