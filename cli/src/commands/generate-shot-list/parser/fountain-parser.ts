/**
 * Fountain Format Parser
 *
 * Parses Fountain screenplay format
 * Spec: https://fountain.io/syntax
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

export class FountainParser implements Parser {
  getName(): string {
    return 'Fountain Parser';
  }

  canParse(content: string): boolean {
    // Check for Fountain scene headings
    const lines = content.split('\n');
    for (const line of lines.slice(0, 50)) {
      if (/^(INT|EXT|INT\/EXT|EXT\/INT)[\.\s]/.test(line.trim())) {
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

    // Extract title and author from title page (if present)
    let title: string | undefined;
    let author: string | undefined;
    let inTitlePage = true;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      lineNumber = i + 1;
      const trimmed = line.trim();

      // Skip empty lines in title page
      if (inTitlePage && trimmed === '') {
        continue;
      }

      // Parse title page
      if (inTitlePage && trimmed.startsWith('Title:')) {
        title = trimmed.substring(6).trim();
        continue;
      }
      if (inTitlePage && trimmed.startsWith('Author:')) {
        author = trimmed.substring(7).trim();
        continue;
      }

      // End of title page
      if (inTitlePage && this.isSceneHeading(trimmed)) {
        inTitlePage = false;
      }

      // Skip if still in title page
      if (inTitlePage) {
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
        continue;
      }

      // Skip if no current scene
      if (!currentScene) {
        continue;
      }

      // Skip empty lines
      if (trimmed === '') {
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
        continue;
      }

      // Parse dialogue
      if (this.isCharacterName(trimmed)) {
        const dialogue = this.parseDialogue(lines, i, lineNumber);
        if (dialogue) {
          currentScene.elements.push(dialogue.element);
          i = dialogue.nextIndex - 1; // -1 because loop will increment
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
        format: 'fountain',
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
    // Use greedy match (.+) for location to capture everything up to the LAST dash
    const match = line.match(/^(INT|EXT|INT\/EXT|EXT\/INT)[\.\s]+(.+)\s*-\s*([^-]+)$/);

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
           !this.isTransition(line);
  }

  /**
   * Parse dialogue block
   */
  private parseDialogue(
    lines: string[],
    startIndex: number,
    startLine: number
  ): { element: import('./types').DialogueElement; nextIndex: number } | null {
    const characterLine = lines[startIndex].trim();

    // Parse character name and extension
    const match = characterLine.match(/^([A-Z][A-Z\s]+?)(\s*\(([^\)]+)\))?$/);
    if (!match) {
      return null;
    }

    const character: Character = {
      name: match[1].trim(),
      extension: match[3]
    };

    let speech = '';
    let parenthetical: string | undefined;
    let i = startIndex + 1;

    // Collect dialogue lines
    while (i < lines.length) {
      const line = lines[i].trim();

      // Empty line ends dialogue
      if (line === '') {
        break;
      }

      // Scene heading ends dialogue
      if (this.isSceneHeading(line)) {
        break;
      }

      // Character name ends dialogue
      if (this.isCharacterName(line)) {
        break;
      }

      // Parenthetical
      if (line.startsWith('(') && line.endsWith(')')) {
        parenthetical = line.substring(1, line.length - 1);
        i++;
        continue;
      }

      // Add to speech
      if (speech) {
        speech += '\n';
      }
      speech += line;
      i++;
    }

    const dialogue: Dialogue = {
      character,
      parenthetical,
      speech: speech.trim()
    };

    return {
      element: {
        type: 'dialogue',
        text: speech.trim(),
        line: startLine,
        column: 1,
        dialogue
      } as import('./types').DialogueElement,
      nextIndex: i
    };
  }
}

