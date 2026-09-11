import { describe, expect, it } from 'vitest';

import {
  createParserAuto,
  detectFormatFromExtension,
} from '../../../cli/src/commands/generate-shot-list/parser';

describe('generate-shot-list parser auto-detection', () => {
  it.each([
    ['script.fountain', 'fountain'],
    ['script.md', 'markdown'],
    ['script.txt', 'plaintext'],
    ['script.fdx', 'finaldraft'],
    ['script.pdf', 'pdf'],
    ['script.docx', 'docx'],
    ['script.rtf', 'rtf'],
  ] as const)('keeps known extension mapping for %s', (filename, format) => {
    expect(detectFormatFromExtension(filename)).toBe(format);
  });

  it.each([
    {
      filename: 'screenplay.fountain',
      content: 'INT. ROOM - DAY\n\nAction.',
      parserName: 'Fountain Parser',
    },
    {
      filename: 'screenplay.md',
      content: '# Scene\n\n**Bold**\n\nAction.',
      parserName: 'Markdown Parser',
    },
    {
      filename: 'screenplay.md',
      content: '# Scene\n\n**Bold**\n\nAction.',
      parserName: 'Markdown Parser',
    },
    {
      filename: 'screenplay.txt',
      content: 'This is a plain prose page with no screenplay markers.',
      parserName: 'Plain Text Parser',
    },
    {
      filename: 'screenplay.fdx',
      content: '<?xml version="1.0" encoding="UTF-8"?><FinalDraft><Content><Paragraph Type="Scene Heading"><Text>INT. ROOM - DAY</Text></Paragraph></Content></FinalDraft>',
      parserName: 'FinalDraft',
    },
    {
      filename: 'screenplay.pdf',
      content: '%PDF-1.4\n%%EOF',
      parserName: 'PDF',
    },
    {
      filename: 'screenplay.docx',
      content: Buffer.from('PK\x03\x04word/[Content_Types].xml', 'binary'),
      parserName: 'DOCX',
    },
    {
      filename: 'screenplay.rtf',
      content: '{\\rtf1\\ansi',
      parserName: 'RTF',
    },
  ] as const)('resolves clearly identified %s input', ({ filename, content, parserName }) => {
    const parser = createParserAuto(filename, content);

    expect(parser.getName()).toBe(parserName);
  });

  it('throws when extension and content disagree', () => {
    const content = '<?xml version="1.0" encoding="UTF-8"?><FinalDraft><Content /></FinalDraft>';

    expect(() => createParserAuto('screenplay.txt', content)).toThrowError(
      'Format could not be detected confidently. Specify the input format explicitly.'
    );
  });

  it.each([
    ['markdown', 'screenplay.md', '# Draft'],
    ['fountain', 'screenplay.fountain', 'SARAH\nHello.'],
  ])('throws when a known extension masks weak %s content', (_label, filename, content) => {
    expect(() => createParserAuto(filename, content)).toThrowError(
      'Format could not be detected confidently. Specify the input format explicitly.'
    );
  });

  it('throws on low-confidence mixed-format content without an extension', () => {
    const content = '# Draft\n\nSARAH\n\nSome text.';

    expect(() => createParserAuto('screenplay', content)).toThrowError(
      'Format could not be detected confidently. Specify the input format explicitly.'
    );
  });
});
