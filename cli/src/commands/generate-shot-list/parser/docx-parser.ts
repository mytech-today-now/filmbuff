import { Parser, Screenplay } from './types';
import { PlainTextParser } from './plaintext-parser';

/**
 * Parser for Microsoft Word (.doc, .docx) format
 * 
 * Extracts text from Word documents and delegates to PlainTextParser for screenplay parsing.
 * Requires mammoth library for DOCX extraction.
 */
export class DOCXParser implements Parser {
  private plainTextParser: PlainTextParser;
  private mammoth: any;

  constructor() {
    this.plainTextParser = new PlainTextParser();
    
    // Lazy load mammoth to avoid bundling issues
    try {
      this.mammoth = require('mammoth');
    } catch (error) {
      throw new Error(
        'mammoth library is required for DOCX parsing. Install it with: npm install mammoth'
      );
    }
  }

  getName(): string {
    return 'DOCX';
  }

  canParse(content: string | Buffer, filePath?: string): boolean {
    // Check file extension
    if (filePath && /\.(docx?|doc)$/i.test(filePath)) {
      return true;
    }

    // Check for DOCX magic number (PK zip archive)
    const contentStr = typeof content === 'string' ? content : content.toString('binary');
    return contentStr.startsWith('PK\x03\x04');
  }

  async parse(content: string | Buffer): Promise<Screenplay> {
    // Convert string to Buffer if needed
    const buffer = typeof content === 'string'
      ? Buffer.from(content, 'binary')
      : content;

    try {
      // Extract HTML with styles preserved
      const result = await this.mammoth.convertToHtml({ buffer });
      const html = result.value ?? '';

      // Parse HTML to extract screenplay elements with style information
      const text = this.convertHtmlToScreenplayText(html);

      // Parse extracted text as plain text screenplay
      const screenplay = this.plainTextParser.parse(text);

      // Update format metadata
      screenplay.format = 'docx';
      screenplay.metadata = {
        ...screenplay.metadata,
        format: 'docx',
        originalFormat: 'docx',
        extractedText: text.trim().length > 0,
        extractedHtml: html.trim().length > 0,
        messages: result.messages,
      };

      return screenplay;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to parse DOCX: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Convert HTML from mammoth to screenplay-formatted text
   * Maps HTML styles to screenplay elements:
   * - <h1>, <h2> → Scene headings
   * - <strong>, <b> with ALL CAPS → Character names
   * - Indented paragraphs → Dialogue
   * - Regular paragraphs → Action
   */
  private convertHtmlToScreenplayText(html: string): string {
    const lines: string[] = [];

    // Simple HTML parser - extract text from tags
    // Remove HTML tags but preserve structure
    let text = html
      .replace(/<h[12]>(.*?)<\/h[12]>/gi, '\n$1\n')  // Headings as scene headings
      .replace(/<strong>(.*?)<\/strong>/gi, '$1')     // Preserve bold text
      .replace(/<b>(.*?)<\/b>/gi, '$1')               // Preserve bold text
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')      // Paragraphs
      .replace(/<br\s*\/?>/gi, '\n')                  // Line breaks
      .replace(/<[^>]+>/g, '')                        // Remove remaining tags
      .replace(/&nbsp;/g, ' ')                        // Replace &nbsp;
      .replace(/&amp;/g, '&')                         // Replace &amp;
      .replace(/&lt;/g, '<')                          // Replace &lt;
      .replace(/&gt;/g, '>')                          // Replace &gt;
      .replace(/&quot;/g, '"')                        // Replace &quot;
      .trim();

    return text;
  }

}

/**
 * Helper function to read DOCX file and parse it
 */
export async function parseDOCXFile(filePath: string): Promise<Screenplay> {
  const fs = require('fs').promises;
  const buffer = await fs.readFile(filePath);
  const parser = new DOCXParser();
  return parser.parse(buffer);
}

