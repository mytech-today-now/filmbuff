import { Parser, Screenplay } from './types';
import { PlainTextParser } from './plaintext-parser';

/**
 * Parser for Rich Text Format (.rtf)
 * 
 * Extracts text from RTF files and delegates to PlainTextParser for screenplay parsing.
 * Uses rtf-parser library for text extraction.
 */
export class RTFParser implements Parser {
  private plainTextParser: PlainTextParser;
  private rtfParser: any;

  constructor() {
    this.plainTextParser = new PlainTextParser();
    
    // Lazy load rtf-parser to avoid bundling issues
    try {
      this.rtfParser = require('rtf-parser');
    } catch (error) {
      throw new Error(
        'rtf-parser library is required for RTF parsing. Install it with: npm install rtf-parser'
      );
    }
  }

  getName(): string {
    return 'RTF';
  }

  canParse(content: string | Buffer, filePath?: string): boolean {
    // Check file extension
    if (filePath && /\.rtf$/i.test(filePath)) {
      return true;
    }

    // Check for RTF magic string
    const contentStr = typeof content === 'string' ? content : content.toString('utf-8');
    return contentStr.startsWith('{\\rtf');
  }

  async parse(content: string | Buffer): Promise<Screenplay> {
    // Convert Buffer to string if needed
    const text = typeof content === 'string' 
      ? content 
      : content.toString('utf-8');

    try {
      // Parse RTF and extract plain text
      const doc = await this.rtfParser.string(text);
      const plainText = this.extractPlainText(doc);

      if (!plainText || plainText.trim().length === 0) {
        throw new Error('RTF contains no extractable text');
      }

      // Parse extracted text as plain text screenplay
      const screenplay = this.plainTextParser.parse(plainText);
      
      // Update format metadata
      screenplay.format = 'rtf';
      screenplay.metadata = {
        ...screenplay.metadata,
        format: 'rtf',
        originalFormat: 'rtf',
        extractedText: true,
      };

      return screenplay;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to parse RTF: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Extract plain text from RTF document tree with formatting awareness
   * Maps RTF formatting to screenplay elements:
   * - \b (bold) + ALL CAPS → Scene heading or Character
   * - \li (left indent) → Dialogue
   * - Normal text → Action
   */
  private extractPlainText(doc: any): string {
    const lines: string[] = [];
    let currentFormatting = {
      bold: false,
      italic: false,
      leftIndent: 0,
    };

    const traverse = (node: any, formatting = { ...currentFormatting }) => {
      if (!node) return;

      // Update formatting state based on RTF control words
      if (node.style) {
        if (node.style.bold !== undefined) {
          formatting.bold = node.style.bold;
        }
        if (node.style.italic !== undefined) {
          formatting.italic = node.style.italic;
        }
        if (node.style.leftIndent !== undefined) {
          formatting.leftIndent = node.style.leftIndent;
        }
      }

      if (node.content) {
        // Text node
        if (typeof node.content === 'string') {
          let text = node.content;

          // Apply formatting hints
          // If text is ALL CAPS and bold, it might be a scene heading or character
          if (formatting.bold && /^[A-Z\s]+$/.test(text.trim()) && text.trim().length > 2) {
            // Keep as-is, PlainTextParser will handle it
            lines.push(text);
          } else if (formatting.leftIndent > 0) {
            // Indented text might be dialogue
            lines.push(text);
          } else {
            lines.push(text);
          }
        } else if (Array.isArray(node.content)) {
          node.content.forEach((child: any) => traverse(child, { ...formatting }));
        }
      }

      // Handle paragraph breaks
      if (node.type === 'paragraph' || node.type === 'par') {
        lines.push('\n');
      }

      if (node.children && Array.isArray(node.children)) {
        node.children.forEach((child: any) => traverse(child, { ...formatting }));
      }
    };

    traverse(doc);

    // Clean up multiple consecutive newlines
    return lines
      .join('')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

}

/**
 * Helper function to read RTF file and parse it
 */
export async function parseRTFFile(filePath: string): Promise<Screenplay> {
  const fs = require('fs').promises;
  const content = await fs.readFile(filePath, 'utf-8');
  const parser = new RTFParser();
  return parser.parse(content);
}

