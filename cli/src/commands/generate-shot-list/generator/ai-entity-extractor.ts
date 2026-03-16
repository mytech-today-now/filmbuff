/**
 * AI-Powered Entity Extractor
 * 
 * Uses AI to intelligently identify characters and objects from Fountain screenplay text
 * following MPAA and AMPAS Nicholl Fellowship screenplay standards.
 * 
 * This replaces rigid regex patterns with fuzzy logic that understands:
 * - Character conventions (THE CAPTAIN, FIRST OFFICER, etc.)
 * - Object conventions (airlock door, viewscreen, etc.)
 * - Industry-standard screenplay formatting
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  isImplementedAIProvider,
  normalizeAIModel,
  normalizeAIProvider
} from '../../../utils/ai-provider-config';
import type { AIProviderConfig } from '../../../utils/ai-provider-config';

export interface EntityExtractionResult {
  characters: string[];
  objects: string[];
  confidence: number;
}

/**
 * AI-powered entity extractor using Claude
 */
export class AIEntityExtractor {
  private client: Anthropic | null = null;
  private apiKey: string | null = null;
  private provider: string;
  private model: string;

  constructor(config: AIProviderConfig = {}) {
    this.provider = normalizeAIProvider(config.aiProvider) || DEFAULT_AI_PROVIDER;
    this.model = normalizeAIModel(config.aiModel) || DEFAULT_AI_MODEL;

    if (!isImplementedAIProvider(this.provider)) {
      return;
    }

    this.apiKey = process.env.ANTHROPIC_API_KEY || null;

    if (this.apiKey) {
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
  }

  /**
   * Extract characters and objects from screenplay text using AI
   */
  async extractEntities(sceneText: string, sceneHeading: string): Promise<EntityExtractionResult> {
    if (!isImplementedAIProvider(this.provider)) {
      console.log(`AI provider "${this.provider}" is not implemented for entity extraction, using fallback regex extraction`);
      return this.fallbackExtraction(sceneText);
    }

    if (!this.client) {
      console.log('No Anthropic API key found, using fallback regex extraction');
      return this.fallbackExtraction(sceneText);
    }

    const prompt = this.buildExtractionPrompt(sceneText, sceneHeading);

    try {
      console.log('Using AI-powered entity extraction...');
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        temperature: 0.0, // Deterministic for consistency
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const result = this.parseAIResponse(content.text);
        console.log(`AI extracted ${result.characters.length} characters and ${result.objects.length} objects`);
        return result;
      }

      return this.fallbackExtraction(sceneText);
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

