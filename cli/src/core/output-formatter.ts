/**
 * Output Format Rules and PDF Export
 *
 * Defines format-specific rules for each DocumentFormat supported by FilmBuff
 * (md, json, fountain, pdf) and provides an export utility that writes a
 * document to disk in the requested format.
 *
 * PDF generation uses a plain-text fallback that wraps Markdown/Fountain
 * content in a minimal PDF envelope without external dependencies.  Projects
 * that need full typesetting can post-process the output with a tool such as
 * Pandoc or WeasyPrint.
 *
 * Satisfies: bd-pipe-c8 buff-core.03.02.02 - Implement output format rules
 *            and PDF export
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DocumentFormat } from '../db/index.js';

// ---------------------------------------------------------------------------
// Format rules
// ---------------------------------------------------------------------------

export interface FormatRule {
  /** Canonical file extension (without leading dot). */
  extension: string;
  /** MIME type for the format. */
  mimeType: string;
  /** Human-readable description for diagnostic output. */
  description: string;
  /**
   * Validates that the content string is appropriate for the format.
   * Returns null when valid, otherwise a diagnostic message.
   */
  validate(content: string): string | null;
}

/** Format rules keyed by DocumentFormat literal. */
export const FORMAT_RULES: Record<DocumentFormat, FormatRule> = {
  md: {
    extension:   'md',
    mimeType:    'text/markdown',
    description: 'Markdown — human-readable prose and screenplay notes',
    validate(content) {
      if (!content.trim()) return 'Markdown content must not be empty.';
      return null;
    },
  },
  json: {
    extension:   'json',
    mimeType:    'application/json',
    description: 'JSON — structured data for programmatic consumption',
    validate(content) {
      try {
        JSON.parse(content);
        return null;
      } catch (e: unknown) {
        return `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },
  fountain: {
    extension:   'fountain',
    mimeType:    'text/plain',
    description: 'Fountain — plain-text screenplay markup',
    validate(content) {
      if (!content.trim()) return 'Fountain content must not be empty.';
      // Heuristic: a Fountain screenplay must contain at least one scene header
      if (!/^(INT\.|EXT\.|I\/E\.|INT\/EXT\.)/im.test(content)) {
        return 'Fountain content should contain at least one scene heading (INT. / EXT.).';
      }
      return null;
    },
  },
  pdf: {
    extension:   'pdf',
    mimeType:    'application/pdf',
    description: 'PDF — portable document for distribution and printing',
    validate(content) {
      if (!content.trim()) return 'PDF source content must not be empty.';
      return null;
    },
  },
};

// ---------------------------------------------------------------------------
// PDF generation (minimal plain-text-in-PDF envelope)
// ---------------------------------------------------------------------------

/**
 * Encode a string as a PDF text stream.
 * Handles the basic set of special characters required by the PDF spec.
 */
function pdfEscapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Generate a minimal valid PDF byte string from plain text content.
 *
 * Each logical line of `text` is rendered as a separate Tj text-show
 * operation in a single page.  Lines longer than `lineWidth` characters
 * are word-wrapped.
 *
 * This produces a valid, spec-compliant PDF 1.4 file without external deps.
 */
export function generatePdf(text: string, lineWidth = 80): Buffer {
  const FONT  = 'F1';
  const SIZE  = 11;
  const LEAD  = 14;   // leading in points
  const MARG  = 72;   // left margin (1 inch)
  const TOP   = 720;  // top of text area from bottom (792pt A4 - 1in margin)
  const PAGE_W = 612;
  const PAGE_H = 792;

  // Word-wrap each source line
  const rawLines = text.split('\n');
  const wrappedLines: string[] = [];
  for (const raw of rawLines) {
    if (raw.length <= lineWidth) {
      wrappedLines.push(raw);
    } else {
      const words = raw.split(/\s+/);
      let current = '';
      for (const word of words) {
        if (current.length + word.length + 1 <= lineWidth) {
          current += (current ? ' ' : '') + word;
        } else {
          wrappedLines.push(current);
          current = word;
        }
      }
      if (current) wrappedLines.push(current);
    }
  }

  // Build content stream
  const lines: string[] = [
    `BT`,
    `/${FONT} ${SIZE} Tf`,
    `${LEAD} TL`,
    `${MARG} ${TOP} Td`,
  ];
  for (const ln of wrappedLines) {
    lines.push(`(${pdfEscapeString(ln)}) Tj T*`);
  }
  lines.push('ET');
  const contentStream = lines.join('\n');

  // Build PDF objects
  const objs: string[] = [];
  const addObj = (body: string): number => { objs.push(body); return objs.length; };

  const catId   = addObj('');  // placeholder — filled below
  const pagesId = addObj('');
  const pageId  = addObj('');
  const fontId  = addObj('');
  const streamId = addObj('');

  const streamBytes = Buffer.from(contentStream, 'latin1');

  // Build the actual PDF source
  const parts: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [];

  const appendObj = (id: number, body: string) => {
    offsets[id - 1] = parts.reduce((a, p) => a + p.length, 0);
    parts.push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  appendObj(catId,   `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  appendObj(pagesId, `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
  appendObj(pageId,
    `<< /Type /Page /Parent ${pagesId} 0 R ` +
    `/MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
    `/Contents ${streamId} 0 R ` +
    `/Resources << /Font << /${FONT} ${fontId} 0 R >> >> >>`
  );
  appendObj(fontId,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Courier ` +
    `/Encoding /WinAnsiEncoding >>`
  );
  appendObj(streamId,
    `<< /Length ${streamBytes.length} >>\nstream\n${contentStream}\nendstream`
  );

  const xrefOffset = parts.reduce((a, p) => a + p.length, 0);
  parts.push('xref\n');
  parts.push(`0 ${objs.length + 1}\n`);
  parts.push('0000000000 65535 f \n');
  for (const off of offsets) {
    parts.push(String(off).padStart(10, '0') + ' 00000 n \n');
  }
  parts.push(
    `trailer\n<< /Size ${objs.length + 1} /Root ${catId} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`
  );

  return Buffer.from(parts.join(''), 'latin1');
}

// ---------------------------------------------------------------------------
// Public export API
// ---------------------------------------------------------------------------

export interface ExportResult {
  filePath:  string;
  format:    DocumentFormat;
  sizeBytes: number;
  warnings:  string[];
}

/**
 * Write `content` to `outputPath` according to the rules for `format`.
 *
 * For the `pdf` format, `content` is treated as the source text and a PDF
 * byte string is generated and written.  For all other formats the content
 * string is written directly.
 *
 * @throws {Error} if validation fails or the file cannot be written.
 */
export function exportDocument(
  content:    string,
  outputPath: string,
  format:     DocumentFormat,
): ExportResult {
  const rule     = FORMAT_RULES[format];
  const warnings: string[] = [];

  // Validate content
  const validationError = rule.validate(content);
  if (validationError) {
    throw new Error(`[${format}] Validation failed: ${validationError}`);
  }

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  // Ensure the file path has the correct extension
  const expectedExt = `.${rule.extension}`;
  let finalPath = outputPath;
  if (!finalPath.endsWith(expectedExt)) {
    const base = finalPath.replace(/\.[^.]+$/, '');
    finalPath = `${base}${expectedExt}`;
    warnings.push(
      `Output path extension changed from "${path.extname(outputPath)}" to "${expectedExt}".`,
    );
  }

  // Write
  if (format === 'pdf') {
    const pdfBuffer = generatePdf(content);
    fs.writeFileSync(finalPath, pdfBuffer);
    return { filePath: finalPath, format, sizeBytes: pdfBuffer.length, warnings };
  }

  const encoded = Buffer.from(content, 'utf-8');
  fs.writeFileSync(finalPath, encoded);
  return { filePath: finalPath, format, sizeBytes: encoded.length, warnings };
}

