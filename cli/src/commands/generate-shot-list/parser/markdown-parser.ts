/**
 * Markdown Format Parser
 *
 * Parses Markdown screenplay format
 * Convention: Headings as scene headings, paragraphs as action/dialogue
 */

import {
  Parser,
  Screenplay,
  Scene,
  SceneElement,
  SceneHeading,
  Character,
  Dialogue,
  ParseError
} from './types';

export class MarkdownParser implements Parser {
  getName(): string {
    return 'Markdown Parser';
  }

  canParse(content: string): boolean {
    // Check for Markdown headings
    const lines = content.split('\n');
    for (const line of lines.slice(0, 50)) {
      if (/^#{1,6}\s/.test(line.trim())) {
        return true;
      }
    }
    return false;
  }

  parse(content: string): Screenplay {
    const lines = content.split('\n');
    const scenes: Scene[] = [];
    let currentScene: Scene | null = null;
    let sceneNumber = 0;
    let lineNumber = 0;

    // Extract title from first H1 (if present)
    let title: string | undefined;
    let author: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      lineNumber = i + 1;
      const trimmed = line.trim();

      // Skip empty lines
      if (trimmed === '') {
        continue;
      }

      // Parse headings
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2].trim();

        // First H1 is title
        if (level === 1 && !title && !this.isSceneHeading(headingText)) {
          title = headingText;
          continue;
        }

        // H2 or scene heading format
        if (level === 2 || this.isSceneHeading(headingText)) {
          // Save previous scene
          if (currentScene) {
            currentScene.endLine = lineNumber - 1;
            scenes.push(currentScene);
          }

          // Create new scene
          sceneNumber++;
          const heading = this.parseSceneHeading(headingText, lineNumber);
          currentScene = {
            number: sceneNumber,
            heading,
            elements: [],
            startLine: lineNumber,
            endLine: lineNumber
          };

          currentScene.elements.push({
            type: 'heading',
            text: headingText,
            line: lineNumber,
            column: 1,
            heading
          } as import('./types').HeadingElement);
          continue;
        }
      }

      // Skip if no current scene
      if (!currentScene) {
        continue;
      }

      // Parse dialogue (bold character name)
      const boldDialogueMatch = trimmed.match(/^\*\*([A-Z][A-Z\s]+)\*\*:?\s*(.+)$/);
      if (boldDialogueMatch) {
        const character: Character = {
          name: boldDialogueMatch[1].trim()
        };

        const dialogue: Dialogue = {
          character,
          speech: boldDialogueMatch[2].trim()
        };

        currentScene.elements.push({
          type: 'dialogue',
          text: boldDialogueMatch[2].trim(),
          line: lineNumber,
          column: 1,
          dialogue
        } as import('./types').DialogueElement);
        continue;
      }

      // Parse blockquote as dialogue (optional convention)
      if (trimmed.startsWith('>')) {
        const blockquoteText = trimmed.substring(1).trim();
        
        // Try to extract character name from blockquote
        const quoteDialogueMatch = blockquoteText.match(/^([A-Z][A-Z\s]+):\s*(.+)$/);
        if (quoteDialogueMatch) {
          const character: Character = {
            name: quoteDialogueMatch[1].trim()
          };

          const dialogue: Dialogue = {
            character,
            speech: quoteDialogueMatch[2].trim()
          };

          currentScene.elements.push({
            type: 'dialogue',
            text: quoteDialogueMatch[2].trim(),
            line: lineNumber,
            column: 1,
            dialogue
          } as import('./types').DialogueElement);
        } else {
          // Blockquote without character name - treat as action
          currentScene.elements.push({
            type: 'action',
            text: blockquoteText,
            line: lineNumber,
            column: 1
          });
        }
        continue;
      }

      // Default to action
      currentScene.elements.push({
        type: 'action',
        text: trimmed,
        line: lineNumber,
        column: 1
      });
    }

    // Save last scene
    if (currentScene) {
      currentScene.endLine = lineNumber;
      scenes.push(currentScene);
    }

    return {
      title,
      author,
      scenes,
      metadata: {
        format: 'markdown',
        totalLines: lines.length,
        totalScenes: scenes.length,
        parsedAt: new Date()
      }
    };
  }

  /**
   * Check if text is a scene heading
   */
  private isSceneHeading(text: string): boolean {
    return /^(INT|EXT|INT\/EXT|EXT\/INT)[\.\s]/.test(text);
  }

  /**
   * Parse scene heading
   */
  private parseSceneHeading(text: string, lineNumber: number): SceneHeading {
    const match = text.match(/^(INT|EXT|INT\/EXT|EXT\/INT)[\.\s]+(.+?)\s*-\s*(.+)$/);

    if (!match) {
      // Try without time of day
      const simpleMatch = text.match(/^(INT|EXT|INT\/EXT|EXT\/INT)[\.\s]+(.+)$/);
      if (simpleMatch) {
        return {
          intExt: simpleMatch[1] as any,
          location: simpleMatch[2].trim(),
          timeOfDay: 'UNKNOWN',
          raw: text
        };
      }

      // If no INT/EXT pattern, use entire text as location
      return {
        intExt: 'INT',
        location: text,
        timeOfDay: 'DAY',
        raw: text
      };
    }

    return {
      intExt: match[1] as any,
      location: match[2].trim(),
      timeOfDay: match[3].trim(),
      raw: text
    };
  }
}
