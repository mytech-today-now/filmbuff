/**
 * Parser Factory
 * 
 * Factory pattern for creating screenplay parsers
 */

import { Parser, ParserFactory } from './types';
import { FountainParser } from './fountain-parser';
import { MarkdownParser } from './markdown-parser';
import { PlainTextParser } from './plaintext-parser';
import { FinalDraftParser } from './finaldraft-parser';
import { PDFParser } from './pdf-parser';
import { DOCXParser } from './docx-parser';
import { RTFParser } from './rtf-parser';

/**
 * Create parser for specified format
 */
export const createParser: ParserFactory = (format) => {
  switch (format) {
    case 'fountain':
      return new FountainParser();
    case 'markdown':
      return new MarkdownParser();
    case 'plaintext':
      return new PlainTextParser();
    case 'finaldraft':
      return new FinalDraftParser();
    case 'pdf':
      return new PDFParser();
    case 'docx':
      return new DOCXParser();
    case 'rtf':
      return new RTFParser();
    default:
      throw new Error(`Unknown format: ${format}`);
  }
};

/**
 * Detect format from file extension
 */
export function detectFormatFromExtension(filename: string): 'fountain' | 'markdown' | 'plaintext' | 'finaldraft' | 'pdf' | 'docx' | 'rtf' | null {
  const ext = filename.toLowerCase().split('.').pop();

  switch (ext) {
    case 'fountain':
      return 'fountain';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'txt':
      return 'plaintext';
    case 'fdx':
      return 'finaldraft';
    case 'pdf':
      return 'pdf';
    case 'doc':
    case 'docx':
      return 'docx';
    case 'rtf':
      return 'rtf';
    default:
      return null;
  }
}

/**
 * Detect format from content analysis
 * Handles both text-based and binary format detection
 */
export function detectFormatFromContent(content: string | Buffer): 'fountain' | 'markdown' | 'plaintext' | 'finaldraft' | 'pdf' | 'docx' | 'rtf' {
  // Convert Buffer to string for signature checking
  const contentStr = typeof content === 'string' ? content : content.toString('binary');

  // Check for binary format signatures first

  // PDF signature: %PDF-
  if (contentStr.startsWith('%PDF-')) {
    return 'pdf';
  }

  // RTF signature: {\rtf
  if (contentStr.startsWith('{\\rtf')) {
    return 'rtf';
  }

  // DOCX signature: PK (ZIP archive)
  // DOCX files are ZIP archives containing XML files
  if (contentStr.startsWith('PK\x03\x04')) {
    // Further check for DOCX-specific content
    // Look for word/ directory or [Content_Types].xml
    if (contentStr.includes('word/') || contentStr.includes('[Content_Types].xml')) {
      return 'docx';
    }
  }

  // Final Draft XML signature: <?xml with <FinalDraft>
  if (contentStr.trimStart().startsWith('<?xml')) {
    // Check if it contains FinalDraft root element
    if (contentStr.includes('<FinalDraft')) {
      return 'finaldraft';
    }
  }

  // Text-based format detection
  const lines = contentStr.split('\n');

  // Check for Fountain markers
  let fountainScore = 0;
  let markdownScore = 0;

  for (const line of lines.slice(0, Math.min(100, lines.length))) {
    const trimmed = line.trim();

    // Fountain indicators
    if (/^(INT|EXT|INT\/EXT|EXT\/INT)[\.\s]/.test(trimmed)) {
      fountainScore += 3;
    }
    if (/^[A-Z][A-Z\s]+$/.test(trimmed) && trimmed.length > 2 && trimmed.length < 50) {
      fountainScore += 1; // Character name
    }
    if (/^(FADE IN:|FADE OUT\.|CUT TO:)/.test(trimmed)) {
      fountainScore += 2;
    }

    // Markdown indicators
    if (/^#{1,6}\s/.test(trimmed)) {
      markdownScore += 2;
    }
    if (/^\*\*.*\*\*$/.test(trimmed) || /^__.*__$/.test(trimmed)) {
      markdownScore += 1;
    }
    if (/^\[.*\]\(.*\)/.test(trimmed)) {
      markdownScore += 1;
    }
  }

  // Determine format based on scores
  // Lower thresholds to be more sensitive to format indicators
  if (fountainScore > markdownScore && fountainScore >= 3) {
    return 'fountain';
  }
  if (markdownScore >= 3) {
    return 'markdown';
  }

  // Default to plaintext
  return 'plaintext';
}

/**
 * Auto-detect format and create appropriate parser
 */
export function createParserAuto(filename: string, content: string | Buffer): Parser {
  // Try extension first
  let format = detectFormatFromExtension(filename);

  // Fall back to content analysis
  if (!format) {
    format = detectFormatFromContent(content);
  }

  return createParser(format);
}

// Re-export types
export * from './types';

