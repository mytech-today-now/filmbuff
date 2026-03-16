/**
 * HTML Formatter
 *
 * Generates HTML output with editable fields and character counting
 */

import { BaseFormatter } from './base-formatter';
import { ShotList, Shot } from '../generator/types';
import { FormatterOptions } from './types';
import { HTML_TEMPLATE, SHOT_CARD_TEMPLATE } from './html-template';

/**
 * HTML formatter implementation
 */
export class HTMLFormatter extends BaseFormatter {
  /**
   * Format shot list to HTML
   */
  format(shotList: ShotList, options?: FormatterOptions): string {
    const maxChars = options?.maxCharacters || 400;
    
    // Generate shot cards
    const shotCards = shotList.shots.map(shot => 
      this.formatShot(shot, maxChars)
    ).join('\n');

    // Replace template variables
    let html = HTML_TEMPLATE;
    html = html.replace('{{TITLE}}', this.escapeHtml(shotList.title || 'Shot List'));
    html = html.replace('{{SUBTITLE}}', this.escapeHtml(shotList.author || ''));
    html = html.replace('{{TOTAL_SHOTS}}', shotList.shots.length.toString());
    html = html.replace('{{TOTAL_DURATION}}', this.formatDuration(shotList.totalDuration));
    html = html.replace('{{TOTAL_CHARACTERS}}', this.getTotalCharacters(shotList).toLocaleString());
    html = html.replace('{{GENERATED_DATE}}', new Date().toLocaleDateString());
    html = html.replace('{{SHOTS}}', shotCards);

    return html;
  }

  /**
   * Format individual shot
   */
  private formatShot(shot: Shot, maxChars: number): string {
    const charCount = shot.characterCount;
    const charPercentage = Math.min((charCount / maxChars) * 100, 100);

    let card = SHOT_CARD_TEMPLATE;
    card = card.replace(/{{SHOT_NUMBER}}/g, shot.number.toString());
    card = card.replace('{{DURATION}}', this.formatTime(shot.duration));
    card = card.replace('{{SCENE_HEADING}}', this.escapeHtml(shot.heading.raw));
    card = card.replace('{{DESCRIPTION}}', this.escapeHtml(shot.description));
    card = card.replace(/{{MAX_CHARS}}/g, maxChars.toString());
    card = card.replace('{{CHAR_COUNT}}', charCount.toString());
    card = card.replace(/{{CHAR_PERCENTAGE}}/g, charPercentage.toFixed(0));

    return card;
  }

  /**
   * Get total character count across all shots
   */
  private getTotalCharacters(shotList: ShotList): number {
    return shotList.shots.reduce((sum, shot) => sum + shot.characterCount, 0);
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const htmlEscapes: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    
    return text.replace(/[&<>"']/g, char => htmlEscapes[char]);
  }

  /**
   * Get file extension
   */
  getExtension(): string {
    return 'html';
  }

  /**
   * Get MIME type
   */
  getMimeType(): string {
    return 'text/html';
  }
}
