/**
 * Shot List Formatter Types
 * 
 * Type definitions for output format generation
 */

import { ShotList } from '../generator/types';

/**
 * Supported output formats
 */
export type OutputFormat = 'md' | 'json' | 'jsonl' | 'csv' | 'txt' | 'html';

/**
 * Formatter options
 */
export interface FormatterOptions {
  /**
   * Pretty-print output (for JSON)
   */
  prettyPrint?: boolean;

  /**
   * Include warnings in output
   */
  includeWarnings?: boolean;

  /**
   * Maximum character limit for display
   */
  maxCharacters?: number;

  /**
   * Include metadata in output
   */
  includeMetadata?: boolean;
}

/**
 * Formatter interface
 */
export interface Formatter {
  /**
   * Format shot list to string
   */
  format(shotList: ShotList, options?: FormatterOptions): string;

  /**
   * Get file extension for this format
   */
  getExtension(): string;

  /**
   * Get MIME type for this format
   */
  getMimeType(): string;
}

/**
 * Formatter factory function type
 */
export type FormatterFactory = (format: OutputFormat) => Formatter;

/**
 * Time formatting utilities
 */
export interface TimeFormatter {
  /**
   * Format seconds to MM:SS
   */
  formatTime(seconds: number): string;

  /**
   * Format total duration to human-readable format (e.g., "1h 23m 15s")
   */
  formatDuration(totalSeconds: number): string;
}

/**
 * Text wrapping utilities
 */
export interface TextWrapper {
  /**
   * Wrap text to specified width
   */
  wrapText(text: string, width: number, indent?: string): string;
}
