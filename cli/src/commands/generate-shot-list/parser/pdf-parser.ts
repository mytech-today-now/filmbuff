import { Parser, Screenplay } from './types';
import { PlainTextParser } from './plaintext-parser';

/**
 * Parser for PDF (.pdf) format
 * 
 * Extracts text from PDF files and delegates to PlainTextParser for screenplay parsing.
 * Requires pdf-parse library for text extraction.
 */
export class PDFParser implements Parser {
  private plainTextParser: PlainTextParser;
  private pdfParse: any;

  constructor() {
    this.plainTextParser = new PlainTextParser();
    
    // Lazy load pdf-parse to avoid bundling issues
    try {
      this.pdfParse = require('pdf-parse');
    } catch (error) {
      throw new Error(
        'pdf-parse library is required for PDF parsing. Install it with: npm install pdf-parse'
      );
    }
  }

  getName(): string {
    return 'PDF';
  }

  canParse(content: string, filePath?: string): boolean {
    // Check file extension
    if (filePath && /\.pdf$/i.test(filePath)) {
      return true;
    }

    // Check for PDF magic number (%PDF-)
    return content.startsWith('%PDF-');
  }

  async parse(content: string | Buffer): Promise<Screenplay> {
    // Convert string to Buffer if needed
    const buffer = typeof content === 'string' 
      ? Buffer.from(content, 'binary')
      : content;

    try {
      // Extract text from PDF
      const data = await this.pdfParse(buffer);
      const text = data.text;

      if (!text || text.trim().length === 0) {
        throw new Error('PDF contains no extractable text');
      }

      // Parse extracted text as plain text screenplay
      const screenplay = this.plainTextParser.parse(text);
      
      // Update format metadata
      screenplay.format = 'pdf';
      screenplay.metadata = {
        ...screenplay.metadata,
        format: 'pdf',
        originalFormat: 'pdf',
        extractedText: true,
        pdfPages: data.numpages,
        pdfInfo: data.info,
      };

      return screenplay;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to parse PDF: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Async parse method for PDF files
   */
  async parseAsync(content: string | Buffer): Promise<Screenplay> {
    return this.parse(content);
  }
}

/**
 * Helper function to read PDF file and parse it
 */
export async function parsePDFFile(filePath: string): Promise<Screenplay> {
  const fs = require('fs').promises;
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParser();
  return parser.parseAsync(buffer);
}

