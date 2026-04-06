/**
 * AI-Powered Blocking Extractor
 *
 * Extracts detailed character blocking and spatial positions from screenplay
 * action lines using the ai-powered library via getFilmbuffAiClient().
 *
 * Phase 5 migration (bd-551f): replaced prior direct SDK usage with
 * getFilmbuffAiClient('blocking-extractor').  The client is lazily initialised
 * on the first extractBlocking() call and reused for all subsequent calls
 * (single getFilmbuffAiClient() invocation per AIBlockingExtractor instance).
 *
 * All prompt builders and response parsers are unchanged (spec requirement).
 */

import { getFilmbuffAiClient } from '../../../utils/filmbuff-ai-client.js';
import type { AiClient } from '../../../utils/filmbuff-ai-client.js';

export interface CharacterBlockingPosition {
  character: string;
  position: string; // Detailed position description
  stagePosition?: string; // stage left/right/center, upstage/downstage
  relativePosition?: string; // beside X, behind Y, etc.
  action?: string; // sits, stands, walks, etc.
}

export interface CharacterDescription {
  character: string;
  physicalAppearance: string; // Detailed physical description (200-800 chars)
  wardrobe: string; // Detailed wardrobe description (200-800 chars)
  emotion?: string; // Current emotional state
}

export interface BlockingExtractionResult {
  characterPositions: CharacterBlockingPosition[];
  characterDescriptions: CharacterDescription[]; // Detailed character descriptions
  setDescription: string; // Pure environment description (400-800 chars)
  characterActions: string[]; // Movement/action descriptions only
  soundEffects: string[]; // Sound effect descriptions
}

export class AIBlockingExtractor {
  /** Lazily-initialised ai-powered client; null until first extractBlocking() call. */
  private client: AiClient | null = null;
  private characterDescriptionCache: Map<string, CharacterDescription> = new Map();
  private styleGuidelines: any | null = null; // MergedStyleGuidelines type

  constructor(styleGuidelines?: any) {
    this.styleGuidelines = styleGuidelines || null;
  }

  /**
   * Ensure the AiClient is initialised (lazy, called once per extractor instance).
   * Subsequent calls return the cached client immediately.
   */
  private async ensureClient(): Promise<AiClient> {
    if (!this.client) {
      this.client = await getFilmbuffAiClient('blocking-extractor');
    }
    return this.client;
  }

  /**
   * Clear the character description cache (call at start of new screenplay)
   */
  clearCache(): void {
    this.characterDescriptionCache.clear();
  }

  /**
   * Get cached character description
   */
  getCachedDescription(characterName: string): CharacterDescription | undefined {
    return this.characterDescriptionCache.get(characterName);
  }

  /**
   * Extract blocking, set description, and actions from action lines using AI.
   */
  async extractBlocking(
    actionLines: string[],
    characterNames: string[],
    previousPositions?: Map<string, CharacterBlockingPosition>
  ): Promise<BlockingExtractionResult> {
    const actionText = actionLines.join('\n');

    // Identify which characters need descriptions (not in cache)
    const charactersNeedingDescriptions = characterNames.filter(
      name => !this.characterDescriptionCache.has(name)
    );

    const prompt = this.buildBlockingPrompt(
      actionText,
      characterNames,
      previousPositions,
      charactersNeedingDescriptions
    );

    try {
      const client = await this.ensureClient();
      const response = await client.generateText(prompt, {
        maxTokens: 4096,   // Increased for verbose descriptions
        temperature: 0.0,  // Deterministic for consistency
      });

      // response.content IS the generated text string (same as old response.content[0].text)
      const result = this.parseBlockingResponse(response.content, characterNames);

      // Cache new character descriptions
      for (const desc of result.characterDescriptions) {
        if (!this.characterDescriptionCache.has(desc.character)) {
          this.characterDescriptionCache.set(desc.character, desc);
        }
      }

      // Add cached descriptions for characters that didn't need new ones
      for (const name of characterNames) {
        const cached = this.characterDescriptionCache.get(name);
        if (cached && !result.characterDescriptions.find(d => d.character === name)) {
          result.characterDescriptions.push(cached);
        }
      }

      return result;
    } catch (error) {
      console.error('AI blocking extraction failed:', error);
      // Fallback to basic extraction
      return this.fallbackExtraction(actionLines, characterNames);
    }
  }

  /**
   * Build prompt for AI blocking extraction
   */
  private buildBlockingPrompt(
    actionText: string,
    characterNames: string[],
    previousPositions?: Map<string, CharacterBlockingPosition>,
    charactersNeedingDescriptions?: string[]
  ): string {
    let prompt = `You are a screenplay blocking analyzer. Extract character positions, set descriptions, and actions from the following action lines.

**Action Lines:**
${actionText}

**Characters in Scene:**
${characterNames.join(', ')}

`;

    if (previousPositions && previousPositions.size > 0) {
      prompt += `**Previous Character Positions (maintain unless explicitly changed):**
`;
      for (const [name, pos] of previousPositions.entries()) {
        prompt += `- ${name}: ${pos.position}`;
        if (pos.stagePosition) prompt += ` (${pos.stagePosition})`;
        prompt += '\n';
      }
      prompt += '\n';
    }

    // Add cached character descriptions to reduce redundant generation
    const cachedDescriptions: string[] = [];
    for (const name of characterNames) {
      const cached = this.characterDescriptionCache.get(name);
      if (cached) {
        cachedDescriptions.push(`- ${name}: ${cached.physicalAppearance.substring(0, 100)}... (wardrobe: ${cached.wardrobe.substring(0, 100)}...)`);
      }
    }

    if (cachedDescriptions.length > 0) {
      prompt += `**Existing Character Descriptions (DO NOT regenerate these):**
${cachedDescriptions.join('\n')}

`;
    }

    // Add style guidelines if available
    if (this.styleGuidelines) {
      prompt += `**Cinematic Style Guidelines:**
`;

      // Add applied styles
      if (this.styleGuidelines.appliedStyles && this.styleGuidelines.appliedStyles.length > 0) {
        prompt += `Active Styles: ${this.styleGuidelines.appliedStyles.join(', ')}\n\n`;
      }

      // Add visual characteristics
      if (this.styleGuidelines.visualCharacteristics) {
        const vc = this.styleGuidelines.visualCharacteristics;
        if (vc.colorPalette && vc.colorPalette.length > 0) {
          prompt += `Color Palette: ${vc.colorPalette.join(', ')}\n`;
        }
        if (vc.lighting && vc.lighting.length > 0) {
          prompt += `Lighting: ${vc.lighting.join(', ')}\n`;
        }
        if (vc.composition && vc.composition.length > 0) {
          prompt += `Composition: ${vc.composition.join(', ')}\n`;
        }
      }

      // Add character blocking style
      if (this.styleGuidelines.characterBlocking) {
        const cb = this.styleGuidelines.characterBlocking;
        if (cb.staging && cb.staging.length > 0) {
          prompt += `Staging: ${cb.staging.join(', ')}\n`;
        }
        if (cb.movement && cb.movement.length > 0) {
          prompt += `Movement: ${cb.movement.join(', ')}\n`;
        }
      }

      prompt += `\n**IMPORTANT**: Apply these style guidelines to ALL descriptions (set, characters, wardrobe). Descriptions should reflect the visual language and aesthetic of the active cinematic style.\n\n`;
    }

    const needsDescriptions = charactersNeedingDescriptions && charactersNeedingDescriptions.length > 0;

    prompt += `**Instructions:**
1. **Character Blocking**: For each character, extract their detailed spatial position
   - Include stage position (stage left/right/center, upstage/downstage/center stage)
   - Include relative positions (beside X, behind Y, at Z)
   - Include action/posture (sits, stands, walks, etc.)
   - Infer positions when not explicit (e.g., "beside her" → "beside CAPTAIN")
   - Infer stage positions for set pieces (e.g., "tactical station" → "stage left, upstage")
   - Use best guess for ambiguous positions based on typical stage layouts

`;

    if (needsDescriptions) {
      prompt += `2. **Character Descriptions**: ONLY for these NEW characters: ${charactersNeedingDescriptions!.join(', ')}
   - Physical Appearance (200-800 characters): Detailed physical description including face, body, age, distinguishing features
   - Wardrobe (200-800 characters): Detailed clothing description including colors, style, materials, accessories
   - Emotion (optional): Current emotional state if evident
   - Expand on any hints in the text with rich cinematic details
   - Make descriptions vivid and immersive
   - IMPORTANT: Aim for 200-800 characters per character field
   - DO NOT generate descriptions for characters already listed above

`;
    } else {
      prompt += `2. **Character Descriptions**: All characters already have descriptions (see above). DO NOT generate new ones.

`;
    }

    prompt += `3. **Set Description**: Create a DETAILED, VERBOSE environment description (400-800 characters)
   - Expand on the basic set description with rich visual details
   - Describe physical environment (walls, doors, furniture, props, materials, textures)
   - Describe lighting, atmosphere, mood, visual style
   - Add cinematic details that enhance the scene
   - Make it vivid and immersive
   - NO character positions or actions
   - IMPORTANT: Aim for 400-800 characters of detailed description

4. **Character Actions**: Extract ONLY character movements and actions
   - Movements (walks, runs, enters, exits)
   - Physical actions (picks up, opens, closes)
   - NOT static positions (sits, stands at)

5. **Sound Effects**: Extract sound effect descriptions
   - Sounds, noises, music
   - Format: "SOUND EFFECT: description"

**Output Format (JSON):**
\`\`\`json
{
  "characterPositions": [
    {
      "character": "CHARACTER NAME",
      "position": "detailed position description",
      "stagePosition": "stage left/right/center, upstage/downstage/center stage",
      "relativePosition": "beside X, behind Y, at Z (optional)",
      "action": "sits/stands/etc (optional)"
    }
  ],
  "characterDescriptions": [${needsDescriptions ? `
    {
      "character": "CHARACTER NAME (ONLY NEW CHARACTERS)",
      "physicalAppearance": "detailed physical description (200-800 chars)",
      "wardrobe": "detailed wardrobe description (200-800 chars)",
      "emotion": "emotional state (optional)"
    }` : ' // Empty array - all characters already described'}
  ],
  "setDescription": "detailed environment description (400-800 chars)",
  "characterActions": ["movement/action descriptions"],
  "soundEffects": ["sound effect descriptions"]
}
\`\`\`

Respond with ONLY the JSON object, no additional text.`;

    return prompt;
  }

  /**
   * Parse AI response into structured blocking data
   */
  private parseBlockingResponse(responseText: string, characterNames: string[]): BlockingExtractionResult {
    try {
      // Extract JSON from response (may be wrapped in ```json```)
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/({[\s\S]*})/);
      const jsonText = jsonMatch ? jsonMatch[1] : responseText;

      const parsed = JSON.parse(jsonText);

      return {
        characterPositions: parsed.characterPositions || [],
        characterDescriptions: parsed.characterDescriptions || [],
        setDescription: parsed.setDescription || '',
        characterActions: parsed.characterActions || [],
        soundEffects: parsed.soundEffects || []
      };
    } catch (error) {
      console.error('Failed to parse AI blocking response:', error);
      console.error('Response text:', responseText);
      return {
        characterPositions: [],
        characterDescriptions: [],
        setDescription: '',
        characterActions: [],
        soundEffects: []
      };
    }
  }

  /**
   * Fallback extraction when AI fails
   */
  private fallbackExtraction(actionLines: string[], characterNames: string[]): BlockingExtractionResult {
    return {
      characterPositions: characterNames.map(name => ({
        character: name,
        position: 'in scene',
        stagePosition: undefined,
        relativePosition: undefined,
        action: undefined
      })),
      characterDescriptions: [],
      setDescription: actionLines.join('. '),
      characterActions: [],
      soundEffects: []
    };
  }
}

