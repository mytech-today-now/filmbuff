import { Parser, Screenplay, Scene, SceneElement, SceneHeading, AnySceneElement } from './types';
import { XMLParser } from 'fast-xml-parser';

/**
 * Parser for Final Draft XML (.fdx) format
 * 
 * Final Draft is the industry-standard professional screenwriting software.
 * The .fdx format is XML-based with specific paragraph types for screenplay elements.
 */
export class FinalDraftParser implements Parser {
  private xmlParser: XMLParser;

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
      trimValues: true,
    });
  }

  getName(): string {
    return 'FinalDraft';
  }

  canParse(content: string, filePath?: string): boolean {
    // Check file extension
    if (filePath && /\.fdx$/i.test(filePath)) {
      return true;
    }

    // Check for Final Draft XML structure
    return content.includes('<FinalDraft') && content.includes('</FinalDraft>');
  }

  parse(content: string): Screenplay {
    const parsed = this.xmlParser.parse(content);
    
    if (!parsed.FinalDraft) {
      throw new Error('Invalid Final Draft XML: Missing FinalDraft root element');
    }

    const fdx = parsed.FinalDraft;
    const content_elem = fdx.Content;
    
    if (!content_elem || !content_elem.Paragraph) {
      throw new Error('Invalid Final Draft XML: Missing Content or Paragraph elements');
    }

    // Extract title and author from TitlePage if available
    let title = 'Untitled';
    let author: string | undefined;

    if (fdx.TitlePage && fdx.TitlePage.Content && fdx.TitlePage.Content.Paragraph) {
      const titleParas = Array.isArray(fdx.TitlePage.Content.Paragraph) 
        ? fdx.TitlePage.Content.Paragraph 
        : [fdx.TitlePage.Content.Paragraph];
      
      for (const para of titleParas) {
        const type = para['@_Type'];
        const text = this.extractText(para);
        
        if (type === 'Title' && text) {
          title = text;
        } else if (type === 'Authors' && text) {
          author = text;
        }
      }
    }

    // Parse paragraphs into scenes
    const paragraphs = Array.isArray(content_elem.Paragraph)
      ? content_elem.Paragraph
      : [content_elem.Paragraph];

    const scenes: Scene[] = [];
    let currentScene: Scene | null = null;
    let lineNumber = 0;

    for (const para of paragraphs) {
      const type = para['@_Type'];
      const text = this.extractText(para);
      lineNumber++;

      if (!text) continue;

      if (type === 'Scene Heading') {
        // Start new scene
        if (currentScene) {
          currentScene.endLine = lineNumber - 1;
          scenes.push(currentScene);
        }

        const heading = this.parseSceneHeading(text);
        currentScene = {
          number: scenes.length + 1,
          heading,
          elements: [],
          startLine: lineNumber,
          endLine: lineNumber,
        };
      } else if (currentScene) {
        // Add element to current scene
        const element = this.parseElement(type, text, lineNumber);
        if (element) {
          currentScene.elements.push(element);
        }
      }
    }

    // Add final scene
    if (currentScene) {
      currentScene.endLine = lineNumber;
      scenes.push(currentScene);
    }

    return {
      title,
      author,
      scenes,
      format: 'finaldraft',
      metadata: {
        format: 'finaldraft',
        totalScenes: scenes.length,
        parsedAt: new Date().toISOString(),
      },
    };
  }

  private extractText(para: any): string {
    if (!para.Text) return '';
    
    const texts = Array.isArray(para.Text) ? para.Text : [para.Text];
    return texts
      .map((t: any) => {
        if (typeof t === 'string') return t;
        if (t['#text']) return t['#text'];
        return '';
      })
      .join('')
      .trim();
  }

  private parseSceneHeading(text: string): SceneHeading {
    // Match INT/EXT. LOCATION - TIME
    const match = text.match(/^(INT\.|EXT\.|INT\/EXT\.|EXT\/INT\.)\s+(.+?)(?:\s+-\s+(.+))?$/i);

    if (match) {
      const intExt = match[1].replace('.', '').toUpperCase() as 'INT' | 'EXT' | 'INT/EXT' | 'EXT/INT';
      return {
        intExt,
        location: match[2].trim(),
        timeOfDay: match[3]?.trim() || '',
        raw: text,
      };
    }

    // Default to INT if no match
    return {
      intExt: 'INT',
      location: text,
      timeOfDay: '',
      raw: text,
    };
  }

  private parseElement(type: string, text: string, line: number): AnySceneElement | null {
    switch (type) {
      case 'Action':
        return { type: 'action', text, line, column: 0 };

      case 'Character':
        return {
          type: 'dialogue',
          dialogue: { character: { name: text }, speech: '' },
          text: text,
          line,
          column: 0
        };

      case 'Dialogue':
        return {
          type: 'dialogue',
          dialogue: { character: { name: '' }, speech: text },
          text: text,
          line,
          column: 0
        };

      case 'Parenthetical':
        return {
          type: 'dialogue',
          dialogue: { character: { name: '' }, parenthetical: text, speech: '' },
          text: text,
          line,
          column: 0
        };

      case 'Transition':
        return { type: 'transition', text, line, column: 0 };

      default:
        return null;
    }
  }
}

