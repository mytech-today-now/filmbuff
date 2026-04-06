/**
 * AI-Powered Entity Extractor
 *
 * Intelligently identifies characters and objects from Fountain screenplay text
 * following MPAA and AMPAS Nicholl Fellowship screenplay standards.
 *
 * This replaces rigid regex patterns with fuzzy logic that understands:
 * - Character conventions (THE CAPTAIN, FIRST OFFICER, etc.)
 * - Object conventions (airlock door, viewscreen, etc.)
 * - Industry-standard screenplay formatting
 *
 * Phase 5 migration (bd-551f): replaced direct @anthropic-ai/sdk usage with
 * getFilmbuffAiClient('entity-extractor').  The client is lazily initialised
 * on the first extractEntities() call and reused for all subsequent calls
 * (single getFilmbuffAiClient() invocation per AIEntityExtractor instance).
 *
 * All prompt builders and response parsers are unchanged (spec requirement).
 */

import { getFilmbuffAiClient } from '../../../utils/filmbuff-ai-client.js';
import type { AiClient } from '../../../utils/filmbuff-ai-client.js';

export interface EntityExtractionResult {
  characters: string[];
  objects: string[];
  confidence: number;
}

/**
 * AI-powered entity extractor using the ai-powered library.
 */
export class AIEntityExtractor {
  /** Lazily-initialised ai-powered client; null until first extractEntities() call. */
  private client: AiClient | null = null;

  constructor() {
    // No credentials needed — ai-powered sources them from config layers.
  }

  /**
   * Ensure the AiClient is initialised (lazy, called once per extractor instance).
   * Subsequent calls return the cached client immediately.
   */
  private async ensureClient(): Promise<AiClient> {
    if (!this.client) {
      this.client = await getFilmbuffAiClient('entity-extractor');
    }
    return this.client;
  }

  /**
   * Extract characters and objects from screenplay text using AI.
   */
  async extractEntities(sceneText: string, sceneHeading: string): Promise<EntityExtractionResult> {
    const prompt = this.buildExtractionPrompt(sceneText, sceneHeading);

    try {
      console.log('Using AI-powered entity extraction...');
      const client = await this.ensureClient();
      const response = await client.generateText(prompt, { maxTokens: 2048 });

      // response.content IS the generated text string (same as old response.content[0].text)
      const result = this.parseAIResponse(response.content);
      console.log(`AI extracted ${result.characters.length} characters and ${result.objects.length} objects`);
      return result;
    } catch (error) {
      console.warn('AI extraction failed, using fallback:', error);
      return this.fallbackExtraction(sceneText);
    }
  }

  /**
   * Build prompt for AI entity extraction
   */
  private buildExtractionPrompt(sceneText: string, sceneHeading: string): string {
    return `You are an expert screenplay analyst following MPAA and AMPAS Nicholl Fellowship standards.

Extract CHARACTERS and OBJECTS from this Fountain screenplay scene.

**SCENE HEADING:**
${sceneHeading}

**SCENE TEXT:**
${sceneText}

**RULES:**

**Characters** are people or beings with agency:
- THE CAPTAIN, FIRST OFFICER, ENGINEER, ENSIGN, ADMIRAL
- WIZARD CLIF HIGH, HEIDI
- Any named person or being who speaks or acts
- Titles used as character names (THE CAPTAIN, not "captain" as description)

**Objects** are props, set pieces, or environmental elements:
- airlock door, viewscreen, console, PADD
- warp core, transporter, phaser
- Physical things that characters interact with

**Extract ALL CAPS words that are characters or objects.**

**OUTPUT FORMAT (JSON only, no explanation):**
\`\`\`json
{
  "characters": ["THE CAPTAIN", "FIRST OFFICER", "ENGINEER"],
  "objects": ["airlock door", "viewscreen", "console"]
}
\`\`\`

Return ONLY the JSON, nothing else.`;
  }

  /**
   * Parse AI response into structured result
   */
  private parseAIResponse(responseText: string): EntityExtractionResult {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || 
                       responseText.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const jsonText = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonText);

      return {
        characters: parsed.characters || [],
        objects: parsed.objects || [],
        confidence: 0.95 // High confidence for AI extraction
      };
    } catch (error) {
      console.warn('Failed to parse AI response:', error);
      return { characters: [], objects: [], confidence: 0.0 };
    }
  }

  /**
   * Fallback regex-based extraction (when AI unavailable)
   */
  private fallbackExtraction(sceneText: string): EntityExtractionResult {
    const characters: string[] = [];
    const objects: string[] = [];

    // Extract ALL CAPS words (2+ letters)
    const capsRegex = /\b([A-Z]{2,}(?:\s+[A-Z]{2,})*)\b/g;
    const matches = sceneText.matchAll(capsRegex);

    for (const match of matches) {
      const word = match[1].trim();
      
      // Skip common non-character words
      const skipWords = ['INT', 'EXT', 'DAY', 'NIGHT', 'CONTINUOUS', 'LATER', 'FADE', 'CUT'];
      if (skipWords.includes(word)) continue;

      // Simple heuristic: if it's a title or name, it's likely a character
      if (word.includes('CAPTAIN') || word.includes('OFFICER') || word.includes('ENGINEER') || 
          word.includes('ENSIGN') || word.includes('ADMIRAL') || word.includes('WIZARD')) {
        if (!characters.includes(word)) characters.push(word);
      }
    }

    return { characters, objects, confidence: 0.5 }; // Lower confidence for fallback
  }
}

