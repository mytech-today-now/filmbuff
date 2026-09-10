import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGenerator } from '../../../cli/src/commands/generate-shot-list/generator';
import { AIBlockingExtractor } from '../../../cli/src/commands/generate-shot-list/generator/ai-blocking-extractor';
import { AIEntityExtractor } from '../../../cli/src/commands/generate-shot-list/generator/ai-entity-extractor';
import type { GeneratorConfig, ShotListSourceFormat } from '../../../cli/src/commands/generate-shot-list/generator/types';
import type { Scene, SceneHeading } from '../../../cli/src/commands/generate-shot-list/parser/types';

const baseConfig: GeneratorConfig = {
  maxCharacters: 400,
  maxShotLength: 30,
  warningThreshold: 90,
  includeContext: true,
  includeMetadata: true
};

function createScene(): Scene {
  const heading: SceneHeading = {
    intExt: 'INT',
    location: 'ROOM',
    timeOfDay: 'DAY',
    raw: 'INT. ROOM - DAY'
  };

  return {
    number: 1,
    heading,
    elements: [
      {
        type: 'heading',
        text: heading.raw,
        line: 1,
        column: 1,
        heading
      }
    ],
    startLine: 1,
    endLine: 1
  };
}

async function generateShotList(sourceFormat?: ShotListSourceFormat) {
  const generator = createGenerator();
  return generator.generate([createScene()], {
    ...baseConfig,
    sourceFormat
  });
}

describe('generate-shot-list generator metadata', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.spyOn(AIEntityExtractor.prototype, 'extractEntities').mockResolvedValue({
      characters: [],
      objects: [],
      confidence: 0
    });

    vi.spyOn(AIBlockingExtractor.prototype, 'extractBlocking').mockResolvedValue({
      characterPositions: [],
      characterDescriptions: [],
      setDescription: '',
      characterActions: [],
      soundEffects: []
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    'fountain',
    'markdown',
    'plaintext',
    'finaldraft',
    'pdf',
    'docx',
    'rtf'
  ] as const)('preserves the source format for %s input', async sourceFormat => {
    const shotList = await generateShotList(sourceFormat);

    expect(shotList.metadata.sourceFormat).toBe(sourceFormat);
  });

  it('falls back to unknown when the source format is omitted', async () => {
    const shotList = await generateShotList();

    expect(shotList.metadata.sourceFormat).toBe('unknown');
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      expect.stringContaining('Source format could not be confirmed. Marking the generated metadata as unknown.')
    );
  });
});
