/**
 * Plain Text Format Parser
 *
 * Parses plain text screenplay format with heuristic-based scene detection
 * Convention: Minimal formatting, inferred structure
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

export class PlainTextParser implements Parser {
  getName(): string {
    return 'Plain Text Parser';
  }

  canParse(content: string): boolean {
    // Plain text parser can handle any content
    return true;
  }

  parse(content: string): Screenplay {
    const lines = content.split('\n');
    const scenes: Scene[] = [];
    let currentScene: Scene | null = null;
    let sceneNumber = 0;
    let lineNumber = 0;
    let lastCharacterName: string | null = null;

    // Extract title from first line if it looks like a title
    let title: string | undefined;
    let author: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      lineNumber = i + 1;
      const trimmed = line.trim();

      // Skip empty lines
      if (trimmed === '') {
        lastCharacterName = null;
        continue;
      }

      // Parse scene heading
      if (this.isSceneHeading(trimmed)) {
        // Save previous scene
        if (currentScene) {
          currentScene.endLine = lineNumber - 1;
          scenes.push(currentScene);
        }

        // Create new scene
        sceneNumber++;
        const heading = this.parseSceneHeading(trimmed, lineNumber);
        currentScene = {
          number: sceneNumber,
          heading,
          elements: [],
          startLine: lineNumber,
          endLine: lineNumber
        };

        currentScene.elements.push({
          type: 'heading',
          text: trimmed,
          line: lineNumber,
          column: 1,
          heading
        } as import('./types').HeadingElement);
        lastCharacterName = null;
        continue;
      }

      // Skip if no current scene
      if (!currentScene) {
        // First non-scene line might be title
        if (!title && sceneNumber === 0) {
          title = trimmed;
        }
        continue;
      }

      // Parse transition
      if (this.isTransition(trimmed)) {
        currentScene.elements.push({
          type: 'transition',
          text: trimmed,
          line: lineNumber,
          column: 1
        });
        lastCharacterName = null;
        continue;
      }

      // Parse character name (ALL CAPS on its own line)
      if (this.isCharacterName(trimmed)) {
        lastCharacterName = trimmed;
        currentScene.elements.push({
          type: 'action',
          text: trimmed,
          line: lineNumber,
          column: 1
        });
        continue;
      }

      // Parse parenthetical
      if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        const parentheticalText = trimmed.substring(1, trimmed.length - 1);
        
        // If we have a character name, this is dialogue parenthetical
        if (lastCharacterName) {
          currentScene.elements.push({
            type: 'action',
            text: `(${parentheticalText})`,
            line: lineNumber,
            column: 1
          });
        } else {
          // Otherwise it's action
          currentScene.elements.push({
            type: 'action',
            text: trimmed,
            line: lineNumber,
            column: 1
          });
        }
        continue;
      }

      // Parse dialogue (follows character name)
      if (lastCharacterName) {
        const character: Character = {
          name: lastCharacterName
        };

        const dialogue: Dialogue = {
          character,
          speech: trimmed
        };

        currentScene.elements.push({
          type: 'dialogue',
          text: trimmed,
          line: lineNumber,
          column: 1,
          dialogue
        } as import('./types').DialogueElement);
        lastCharacterName = null;
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
        format: 'plaintext',
        totalLines: lines.length,
        totalScenes: scenes.length,
        parsedAt: new Date()
      }
    };
  }

  /**
   * Check if line is a scene heading
   */
  private isSceneHeading(line: string): boolean {
    return /^(INT|EXT|INT\/EXT|EXT\/INT)[\.\s]/.test(line);
  }

  /**
   * Parse scene heading
   */
  private parseSceneHeading(line: string, lineNumber: number): SceneHeading {
    const match = line.match(/^(INT|EXT|INT\/EXT|EXT\/INT)[\.\s]+(.+?)\s*-\s*(.+)$/);

    if (!match) {
      // Try without time of day
      const simpleMatch = line.match(/^(INT|EXT|INT\/EXT|EXT\/INT)[\.\s]+(.+)$/);
      if (simpleMatch) {
        return {
          intExt: simpleMatch[1] as any,
          location: simpleMatch[2].trim(),
          timeOfDay: 'UNKNOWN',
          raw: line
        };
      }

      throw new ParseError(
        `Malformed scene heading: ${line}`,
        lineNumber,
        1,
        line
      );
    }

    return {
      intExt: match[1] as any,
      location: match[2].trim(),
      timeOfDay: match[3].trim(),
      raw: line
    };
  }

  /**
   * Check if line is a transition
   */
  private isTransition(line: string): boolean {
    return /^(FADE IN:|FADE OUT\.|CUT TO:|DISSOLVE TO:|SMASH CUT TO:)/.test(line) ||
           /^[A-Z\s]+TO:$/.test(line);
  }

  /**
   * Check if line is a character name
   */
  private isCharacterName(line: string): boolean {
    // Character names are all caps, may have extension in parentheses
    return /^[A-Z][A-Z\s]+(\s*\([^\)]+\))?$/.test(line) &&
           line.length > 2 &&
           line.length < 50 &&
           !this.isTransition(line) &&
           !this.isSceneHeading(line);
  }
}


