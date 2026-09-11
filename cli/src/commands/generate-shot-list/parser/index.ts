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

type SupportedFormat = 'fountain' | 'markdown' | 'plaintext' | 'finaldraft' | 'pdf' | 'docx' | 'rtf';

interface FormatDetectionResult {
  format: SupportedFormat;
  ambiguous: boolean;
}

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
export function detectFormatFromExtension(filename: string): SupportedFormat | null {
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
function detectFormatFromContentDetailed(content: string | Buffer): FormatDetectionResult {
  // Convert Buffer to string for signature checking
  const contentStr = typeof content === 'string' ? content : content.toString('binary');

  // Check for binary format signatures first

  // PDF signature: %PDF-
  if (contentStr.startsWith('%PDF-')) {
    return { format: 'pdf', ambiguous: false };
  }

  // RTF signature: {\rtf
  if (contentStr.startsWith('{\\rtf')) {
    return { format: 'rtf', ambiguous: false };
  }

  // DOCX signature: PK (ZIP archive)
  // DOCX files are ZIP archives containing XML files
  if (contentStr.startsWith('PK\x03\x04')) {
    // Further check for DOCX-specific content
    // Look for word/ directory or [Content_Types].xml
    if (contentStr.includes('word/') || contentStr.includes('[Content_Types].xml')) {
      return { format: 'docx', ambiguous: false };
    }
  }

  // Final Draft XML signature: <?xml with <FinalDraft>
  if (contentStr.trimStart().startsWith('<?xml')) {
    // Check if it contains FinalDraft root element
    if (contentStr.includes('<FinalDraft')) {
      return { format: 'finaldraft', ambiguous: false };
    }
  }

  // Text-based format detection
  const lines = contentStr.split('\n');

  // Check for Fountain markers
  let fountainScore = 0;
  let markdownScore = 0;
  let hasStructuredSignals = false;

  for (const line of lines.slice(0, Math.min(100, lines.length))) {
    const trimmed = line.trim();

    // Fountain indicators
    if (/^(INT|EXT|INT\/EXT|EXT\/INT)[\.\s]/.test(trimmed)) {
      fountainScore += 3;
      hasStructuredSignals = true;
    }
    if (/^[A-Z][A-Z\s]+$/.test(trimmed) && trimmed.length > 2 && trimmed.length < 50) {
      fountainScore += 1; // Character name
      hasStructuredSignals = true;
    }
    if (/^(FADE IN:|FADE OUT\.|CUT TO:)/.test(trimmed)) {
      fountainScore += 2;
      hasStructuredSignals = true;
    }

    // Markdown indicators
    if (/^#{1,6}\s/.test(trimmed)) {
      markdownScore += 2;
      hasStructuredSignals = true;
    }
    if (/^\*\*.*\*\*$/.test(trimmed) || /^__.*__$/.test(trimmed)) {
      markdownScore += 1;
      hasStructuredSignals = true;
    }
    if (/^\[.*\]\(.*\)/.test(trimmed)) {
      markdownScore += 1;
      hasStructuredSignals = true;
    }
  }

  // Determine format based on scores
  // Lower thresholds to be more sensitive to format indicators
  if (fountainScore > markdownScore && fountainScore >= 3) {
    return { format: 'fountain', ambiguous: false };
  }
  if (markdownScore >= 3) {
    return { format: 'markdown', ambiguous: false };
  }

  // Default to plaintext only when there are no format signals at all.
  if (!hasStructuredSignals) {
    return { format: 'plaintext', ambiguous: false };
  }

  return { format: 'plaintext', ambiguous: true };
}

export function detectFormatFromContent(content: string | Buffer): SupportedFormat {
  return detectFormatFromContentDetailed(content).format;
}

/**
 * Auto-detect format and create appropriate parser
 */
export function createParserAuto(filename: string, content: string | Buffer): Parser {
  const formatFromExtension = detectFormatFromExtension(filename);
  const contentDetection = detectFormatFromContentDetailed(content);
  const ambiguousFormatError = 'Format could not be detected confidently. Specify the input format explicitly.';

  if (formatFromExtension) {
    if (contentDetection.ambiguous) {
      throw new Error(ambiguousFormatError);
    }

    if (
      contentDetection.format !== 'plaintext' &&
      contentDetection.format !== formatFromExtension
    ) {
      throw new Error(ambiguousFormatError);
    }

    return createParser(formatFromExtension);
  }

  if (contentDetection.ambiguous) {
    throw new Error(ambiguousFormatError);
  }

  return createParser(contentDetection.format);
}

// Re-export types
export * from './types';
