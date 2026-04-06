/**
 * Context Builder
 *
 * Implements context repetition for each shot: maintain scene-level context
 * (set, lighting, time), track character states (position, appearance, emotion),
 * build complete set and character descriptions per shot.
 *
 * Task: bd-shot-list-3.3
 * Requirement 10: Rich Character Descriptions (Character Bible)
 * Requirement 11: Rich Set Descriptions (Set Bible)
 */

import { Scene, SceneElement, DialogueElement, ActionElement } from '../parser/types';
import { SceneContext, CharacterState } from './types';
import { MergedStyleGuidelines } from '../style/types';
import { AIEntityExtractor } from './ai-entity-extractor';
import type { AIProviderConfig } from '../../../utils/ai-provider-config';

/**
 * Context builder configuration
 */
export interface ContextBuilderConfig extends AIProviderConfig {
  includeAtmosphere: boolean;
  includeWeather: boolean;
  trackCharacterEmotions: boolean;
  styleGuidelines?: MergedStyleGuidelines | null;
}

/**
 * Character Bible entry - maintains complete character description across shots
 * Requirement 10: Rich Character Descriptions
 */
interface CharacterBibleEntry {
  name: string;
  wardrobe: string;
  physicalAppearance: string;
  props: string[];
  lastSeenPosition: string;
  lastSeenEmotion?: string;
  // Detailed spatial blocking (AI-inferred)
  detailedPosition?: string; // Full position description
  stagePosition?: string; // stage left/right/center, upstage/downstage
  relativePosition?: string; // beside X, behind Y, at Z
  posture?: string; // sits, stands, kneels, etc.
}

/**
 * Set Bible entry - maintains complete set description across shots
 * Requirement 11: Rich Set Descriptions
 */
interface SetBibleEntry {
  location: string;
  environment: string;
  lighting: string;
  atmosphere: string;
  weather?: string;
  timeOfDay: string;
  setDressing: string[];
}

/**
 * Context Builder class
 * Requirement 9: Track character blocking continuity across shots
 * Requirement 10: Maintain Character Bible for consistent descriptions
 * Requirement 11: Maintain Set Bible for consistent descriptions
 */
export class ContextBuilder {
  private config: ContextBuilderConfig;
  private characterBlockingHistory: Map<string, CharacterState> = new Map();
  private characterBible: Map<string, CharacterBibleEntry> = new Map();  // Requirement 10
  private setBible: Map<string, SetBibleEntry> = new Map();              // Requirement 11
  private styleGuidelines: MergedStyleGuidelines | null = null;
  private aiExtractor: AIEntityExtractor;

  constructor(config: ContextBuilderConfig) {
    this.config = config;
    this.styleGuidelines = config.styleGuidelines || null;
    // Phase 5 (bd-551f): AIEntityExtractor no longer takes credentials; the
    // ai-powered library sources them from its own config layers.
    this.aiExtractor = new AIEntityExtractor();
  }

  /**
   * Normalize character name for fuzzy matching
   * Handles variations like "THE CAPTAIN" vs "CAPTAIN", "A WIZARD" vs "WIZARD"
   *
   * Rules:
   * - Remove leading articles: THE, A, AN
   * - Trim whitespace
   * - Convert to uppercase for consistent comparison
   *
   * Examples:
   * - "THE CAPTAIN" -> "CAPTAIN"
   * - "A WIZARD" -> "WIZARD"
   * - "AN OFFICER" -> "OFFICER"
   * - "CAPTAIN" -> "CAPTAIN"
   */
  private normalizeCharacterName(name: string): string {
    return name
      .trim()
      .toUpperCase()
      .replace(/^(THE|A|AN)\s+/, ''); // Remove leading articles
  }

  /**
   * Find character in Bible using fuzzy matching
   * Tries exact match first, then normalized match, then partial match
   *
   * @param characterName - The character name to search for
   * @returns The Bible entry if found, null otherwise
   */
  private findCharacterInBible(characterName: string): CharacterBibleEntry | null {
    // Try exact match first
    let bibleEntry = this.characterBible.get(characterName);
    if (bibleEntry) return bibleEntry;

    // Try normalized match
    const normalizedName = this.normalizeCharacterName(characterName);
    for (const [bibleKey, bibleValue] of this.characterBible.entries()) {
      if (this.normalizeCharacterName(bibleKey) === normalizedName) {
        return bibleValue;
      }
    }

    // Try partial match (e.g., "CLIF" matches "WIZARD CLIF HIGH")
    for (const [bibleKey, bibleValue] of this.characterBible.entries()) {
      if (bibleKey.includes(characterName) || characterName.includes(bibleKey)) {
        return bibleValue;
      }
    }

    return null;
  }

  /**
   * Get or create character in Bible using fuzzy matching
   * Returns the canonical name (the one stored in the Bible)
   *
   * @param characterName - The character name to search for
   * @returns Object with bibleEntry and canonicalName
   */
  private getOrCreateCharacterInBible(characterName: string): {
    bibleEntry: CharacterBibleEntry;
    canonicalName: string;
  } {
    // Try to find existing entry
    const existingEntry = this.findCharacterInBible(characterName);
    if (existingEntry) {
      return { bibleEntry: existingEntry, canonicalName: existingEntry.name };
    }

    // Create new entry
    const newEntry: CharacterBibleEntry = {
      name: characterName,
      wardrobe: '',
      physicalAppearance: '',
      props: [],
      lastSeenPosition: 'in scene',
      lastSeenEmotion: undefined
    };
    this.characterBible.set(characterName, newEntry);
    return { bibleEntry: newEntry, canonicalName: characterName };
  }

  /**
   * Reset all state (Character Bible, Set Bible, blocking history)
   * Call this at the start of each new screenplay generation to prevent contamination
   */
  reset(): void {
    this.characterBlockingHistory.clear();
    this.characterBible.clear();
    this.setBible.clear();
    console.log('ContextBuilder state reset - all Bibles and history cleared');
  }

  /**
   * Build scene-level context from scene heading and elements
   * Requirement 11: Use Set Bible to maintain rich, consistent set descriptions
   * PRIORITY: Extract actual description text from screenplay action lines
   */
  buildSceneContext(scene: Scene): SceneContext {
    const location = scene.heading.location;

    // Extract the actual set description from the first action line(s)
    const actualDescription = this.extractActualSetDescription(scene);

    // Check if we have this set in the Set Bible
    let setBibleEntry = this.setBible.get(location);

    if (!setBibleEntry) {
      // Create new Set Bible entry with actual description from screenplay
      setBibleEntry = {
        location,
        environment: actualDescription || this.extractEnvironment(scene),
        lighting: this.extractRichLighting(scene),
        atmosphere: this.extractAtmosphere(scene) || 'neutral',
        weather: this.config.includeWeather ? this.extractWeather(scene) : undefined,
        timeOfDay: scene.heading.timeOfDay,
        setDressing: this.extractSetDressing(scene)
      };
      this.setBible.set(location, setBibleEntry);
    } else {
      // Update Set Bible entry if new information is available
      if (actualDescription && actualDescription.length > setBibleEntry.environment.length) {
        setBibleEntry.environment = actualDescription;
      }

      const newLighting = this.extractRichLighting(scene);
      if (newLighting && newLighting !== 'natural') {
        setBibleEntry.lighting = newLighting;
      }

      const newAtmosphere = this.extractAtmosphere(scene);
      if (newAtmosphere) {
        setBibleEntry.atmosphere = newAtmosphere;
      }

      const newWeather = this.extractWeather(scene);
      if (newWeather) {
        setBibleEntry.weather = newWeather;
      }

      setBibleEntry.timeOfDay = scene.heading.timeOfDay;

      const newSetDressing = this.extractSetDressing(scene);
      if (newSetDressing.length > 0) {
        setBibleEntry.setDressing = [...new Set([...setBibleEntry.setDressing, ...newSetDressing])];
      }
    }

    // Build rich context from Set Bible
    const context: SceneContext = {
      set: `${scene.heading.intExt}. ${location} - ${scene.heading.timeOfDay}`,
      description: setBibleEntry.environment,
      lighting: setBibleEntry.lighting,
      timeOfDay: scene.heading.timeOfDay,
      atmosphere: setBibleEntry.atmosphere,
      weather: setBibleEntry.weather
    };

    return context;
  }

  /**
   * Build character states from scene elements
   * Requirement 9: Maintain character blocking continuity across shots
   * Requirement 10: Use Character Bible to maintain rich, consistent character descriptions
   * PRIORITY: Use AI-powered fuzzy logic to extract characters following MPAA/AMPAS standards
   */
  async buildCharacterStates(elements: SceneElement[], sceneContext: SceneContext): Promise<CharacterState[]> {
    const characterMap = new Map<string, CharacterState>();

    // FIRST PASS: Use AI to extract characters from scene text
    const characterNames = await this.extractCharactersWithAI(elements, sceneContext);

    // ALSO check Character Bible for mixed-case character name references
    // Example: "Clif pauses" should match "CLIF" or "WIZARD CLIF HIGH" from Bible
    // This handles cases where a character was introduced in a previous segment
    for (const element of elements) {
      if (element.type === 'action') {
        const actionElement = element as ActionElement;
        for (const [bibleName, bibleEntry] of this.characterBible.entries()) {
          const nameParts = bibleName.split(/\s+/);
          for (const part of nameParts) {
            if (part.length > 2) {
              const regex = new RegExp(`\\b${part}\\b`, 'i'); // Case-insensitive match
              if (regex.test(actionElement.text)) {
                // Found a reference to this character - add the full Bible name
                if (!characterNames.includes(bibleName)) {
                  characterNames.push(bibleName);
                }
                break;
              }
            }
          }
        }
      }
    }

    // SECOND PASS: Process action lines to extract character introductions for known characters
    for (const element of elements) {
      if (element.type === 'action') {
        const actionElement = element as ActionElement;
        // Extract character introductions from action lines using known character names
        this.extractCharacterIntroductionsFromAction(actionElement, characterNames);
      }
    }

    // THIRD PASS: Build character states from dialogue and action
    for (const element of elements) {
      if (element.type === 'dialogue') {
        const dialogueElement = element as DialogueElement;
        const characterName = dialogueElement.dialogue.character.name;

        // Use fuzzy matching to find or create character in Bible
        let { bibleEntry, canonicalName } = this.getOrCreateCharacterInBible(characterName);

        if (!characterMap.has(canonicalName)) {
          const previousState = this.characterBlockingHistory.get(characterName);

          // If we found an existing entry but it's under a different name, update from previous state
          if (canonicalName !== characterName && previousState) {
            if (previousState.wardrobe) bibleEntry.wardrobe = previousState.wardrobe;
            if (previousState.physicalAppearance) bibleEntry.physicalAppearance = previousState.physicalAppearance;
            if (previousState.position) bibleEntry.lastSeenPosition = previousState.position;
            if (previousState.emotion) bibleEntry.lastSeenEmotion = previousState.emotion;
          }

          // If this is a new entry and we have previous state, populate from it
          if (!bibleEntry.wardrobe && !bibleEntry.physicalAppearance && previousState) {
            bibleEntry.wardrobe = previousState.wardrobe || '';
            bibleEntry.physicalAppearance = previousState.physicalAppearance || '';
            bibleEntry.lastSeenPosition = previousState.position || 'in scene';
            bibleEntry.lastSeenEmotion = previousState.emotion;
          }

          // Check if character is V.O. (voice over) - they're not visible
          const isVoiceOver = dialogueElement.dialogue.character.extension?.includes('V.O.');
          const position = isVoiceOver ? 'not visible' : bibleEntry.lastSeenPosition;

          // Build rich character state from Bible (use canonical name for consistency)
          characterMap.set(canonicalName, {
            name: canonicalName,
            position: position,
            appearance: `${bibleEntry.physicalAppearance}${bibleEntry.props.length > 0 ? ', carrying ' + bibleEntry.props.join(', ') : ''}`,
            wardrobe: bibleEntry.wardrobe,
            physicalAppearance: bibleEntry.physicalAppearance,
            emotion: this.config.trackCharacterEmotions ? this.extractEmotion(dialogueElement) : bibleEntry.lastSeenEmotion,
            action: undefined
          });
        } else {
          // Update position if V.O. (voice over)
          const isVoiceOver = dialogueElement.dialogue.character.extension?.includes('V.O.');
          if (isVoiceOver) {
            characterMap.get(canonicalName)!.position = 'not visible';
          }

          // Update emotion if tracking
          if (this.config.trackCharacterEmotions) {
            const emotion = this.extractEmotion(dialogueElement);
            if (emotion) {
              characterMap.get(canonicalName)!.emotion = emotion;
              // Update Bible (already have bibleEntry from above)
              bibleEntry.lastSeenEmotion = emotion;
            }
          }
        }
      } else if (element.type === 'action') {
        const actionElement = element as ActionElement;
        this.updateCharacterStatesFromAction(actionElement, characterMap);
      }
    }

    // FOURTH PASS: Process any character names found in action lines that weren't in dialogue
    // This handles cases like "Clif pauses" where the character is referenced but doesn't speak
    for (const characterName of characterNames) {
      // Use fuzzy matching to find or create character in Bible
      let { bibleEntry, canonicalName } = this.getOrCreateCharacterInBible(characterName);

      if (!characterMap.has(canonicalName)) {
        const previousState = this.characterBlockingHistory.get(characterName);

        // If we found an existing entry but it's under a different name, update from previous state
        if (canonicalName !== characterName && previousState) {
          if (previousState.wardrobe) bibleEntry.wardrobe = previousState.wardrobe;
          if (previousState.physicalAppearance) bibleEntry.physicalAppearance = previousState.physicalAppearance;
          if (previousState.position) bibleEntry.lastSeenPosition = previousState.position;
          if (previousState.emotion) bibleEntry.lastSeenEmotion = previousState.emotion;
        }

        // If this is a new entry and we have previous state, populate from it
        if (!bibleEntry.wardrobe && !bibleEntry.physicalAppearance && previousState) {
          bibleEntry.wardrobe = previousState.wardrobe || '';
          bibleEntry.physicalAppearance = previousState.physicalAppearance || '';
          bibleEntry.lastSeenPosition = previousState.position || 'in scene';
          bibleEntry.lastSeenEmotion = previousState.emotion;
        }

        // Build character state from Bible (use canonical name for consistency)
        characterMap.set(canonicalName, {
          name: canonicalName,
          position: bibleEntry.lastSeenPosition,
          appearance: `${bibleEntry.physicalAppearance}${bibleEntry.props.length > 0 ? ', carrying ' + bibleEntry.props.join(', ') : ''}`,
          wardrobe: bibleEntry.wardrobe,
          physicalAppearance: bibleEntry.physicalAppearance,
          emotion: bibleEntry.lastSeenEmotion,
          action: undefined
        });
      }
    }

    // Update blocking history and Character Bible for continuity
    for (const [name, state] of characterMap.entries()) {
      this.characterBlockingHistory.set(name, { ...state });

      // Update Character Bible with latest information (using fuzzy matching)
      const bibleEntry = this.findCharacterInBible(name);
      if (bibleEntry) {
        // Normalize position: "enters scene" becomes "in scene" after first appearance
        let normalizedPosition = state.position;
        if (normalizedPosition === 'enters scene') {
          normalizedPosition = 'in scene';
        }

        if (state.position) bibleEntry.lastSeenPosition = normalizedPosition;
        if (state.wardrobe) bibleEntry.wardrobe = state.wardrobe;
        if (state.physicalAppearance) bibleEntry.physicalAppearance = state.physicalAppearance;
        if (state.emotion) bibleEntry.lastSeenEmotion = state.emotion;
      }
    }

    return Array.from(characterMap.values());
  }

  /**
   * Extract environment description from scene
   * Requirement 11: Rich Set Descriptions
   */
  /**
   * Extract actual set description from the first action line(s) of the scene
   * PRIORITY: Use the actual screenplay text, not generic templates
   */
  private extractActualSetDescription(scene: Scene): string {
    // Get the first few action lines (usually contain set description)
    const actionLines: string[] = [];

    for (const element of scene.elements) {
      if (element.type === 'action') {
        actionLines.push(element.text);
        // Stop after collecting enough description (usually first 1-3 action blocks)
        if (actionLines.length >= 3) break;
      }
      // Stop if we hit dialogue (description usually comes before dialogue)
      if (element.type === 'dialogue') break;
    }

    // Join the action lines to form the complete set description
    const description = actionLines.join(' ').trim();

    // Only return if we have substantial description (not just character actions)
    if (description.length > 50) {
      return description;
    }

    return '';
  }

  private extractEnvironment(scene: Scene): string {
    const intExt = scene.heading.intExt;
    const location = scene.heading.location.toLowerCase();

    // Determine environment type
    if (intExt === 'INT') {
      if (location.includes('office') || location.includes('workplace')) {
        return 'Professional interior space';
      } else if (location.includes('home') || location.includes('house') || location.includes('apartment')) {
        return 'Residential interior';
      } else if (location.includes('restaurant') || location.includes('cafe') || location.includes('bar')) {
        return 'Commercial dining space';
      } else if (location.includes('store') || location.includes('shop')) {
        return 'Retail interior';
      } else {
        return 'Interior space';
      }
    } else {
      if (location.includes('street') || location.includes('sidewalk')) {
        return 'Urban exterior';
      } else if (location.includes('park') || location.includes('forest') || location.includes('field')) {
        return 'Natural outdoor setting';
      } else if (location.includes('parking') || location.includes('lot')) {
        return 'Paved exterior area';
      } else {
        return 'Exterior location';
      }
    }
  }

  /**
   * Extract rich lighting description from scene elements
   * Requirement 11: Rich Set Descriptions (lighting type, quality, direction, color temp)
   */
  private extractRichLighting(scene: Scene): string {
    const timeOfDay = scene.heading.timeOfDay.toLowerCase();
    const intExt = scene.heading.intExt;

    // Build rich lighting description
    let lightingType = '';
    let lightingQuality = '';
    let lightingDirection = '';
    let colorTemp = '';

    // Determine lighting type and color temperature based on time of day
    if (timeOfDay.includes('night')) {
      lightingType = intExt === 'INT' ? 'artificial overhead lighting' : 'moonlight and street lamps';
      colorTemp = intExt === 'INT' ? 'warm tungsten (3200K)' : 'cool blue (5500K)';
      lightingQuality = 'low-key, high contrast';
    } else if (timeOfDay.includes('day')) {
      lightingType = intExt === 'INT' ? 'natural window light' : 'direct sunlight';
      colorTemp = 'daylight balanced (5600K)';
      lightingQuality = 'bright, even illumination';
      lightingDirection = intExt === 'INT' ? 'from windows' : 'overhead sun';
    } else if (timeOfDay.includes('dawn') || timeOfDay.includes('dusk')) {
      lightingType = 'golden hour natural light';
      colorTemp = 'warm amber (3000K)';
      lightingQuality = 'soft, diffused';
      lightingDirection = 'low angle';
    } else if (timeOfDay.includes('evening')) {
      lightingType = intExt === 'INT' ? 'mixed natural and artificial' : 'twilight ambient';
      colorTemp = 'cool to warm transition (4500K)';
      lightingQuality = 'moderate, transitional';
    } else {
      lightingType = 'natural ambient';
      colorTemp = 'neutral (5000K)';
      lightingQuality = 'balanced';
    }

    // Check action lines for specific lighting details
    for (const element of scene.elements) {
      if (element.type === 'action') {
        const text = element.text.toLowerCase();
        if (text.includes('dark') || text.includes('shadows')) {
          lightingQuality = 'low-key, dramatic shadows';
        } else if (text.includes('bright') || text.includes('sunlight')) {
          lightingQuality = 'high-key, bright';
        } else if (text.includes('fluorescent')) {
          lightingType = 'fluorescent overhead';
          colorTemp = 'cool white (4000K)';
        } else if (text.includes('candle') || text.includes('firelight')) {
          lightingType = 'warm practical sources';
          colorTemp = 'very warm (2000K)';
        }
      }
    }

    // Combine into rich description
    return `${lightingType}, ${lightingQuality}${lightingDirection ? ', ' + lightingDirection : ''}, ${colorTemp}`;
  }

  /**
   * Extract set dressing elements from scene
   * Requirement 11: Rich Set Descriptions
   */
  private extractSetDressing(scene: Scene): string[] {
    const dressing: string[] = [];
    const dressingKeywords = [
      'table', 'chair', 'desk', 'lamp', 'picture', 'painting', 'plant',
      'couch', 'sofa', 'bed', 'curtain', 'window', 'door', 'shelf',
      'book', 'computer', 'phone', 'clock', 'mirror', 'rug', 'carpet'
    ];

    for (const element of scene.elements) {
      if (element.type === 'action') {
        const text = element.text.toLowerCase();
        for (const keyword of dressingKeywords) {
          if (text.includes(keyword) && !dressing.includes(keyword)) {
            dressing.push(keyword);
          }
        }
      }
    }

    return dressing;
  }

  /**
   * Extract lighting from scene elements (legacy method, kept for compatibility)
   */
  private extractLighting(scene: Scene): string {
    return this.extractRichLighting(scene);
  }

  /**
   * Extract atmosphere from scene elements
   */
  private extractAtmosphere(scene: Scene): string | undefined {
    const keywords = {
      tense: ['tense', 'nervous', 'anxious', 'worried'],
      calm: ['calm', 'peaceful', 'serene', 'quiet'],
      chaotic: ['chaotic', 'frantic', 'hectic', 'busy'],
      romantic: ['romantic', 'intimate', 'tender', 'loving'],
      ominous: ['ominous', 'threatening', 'dark', 'foreboding']
    };

    for (const element of scene.elements) {
      const text = element.text.toLowerCase();
      
      for (const [atmosphere, words] of Object.entries(keywords)) {
        if (words.some(word => text.includes(word))) {
          return atmosphere;
        }
      }
    }

    return undefined;
  }

  /**
   * Check if the scene is set in space (spaceship, space station, etc.)
   * where weather doesn't make sense
   */
  private isSpaceSetting(scene: Scene): boolean {
    const location = scene.heading.location.toLowerCase();
    const intExt = scene.heading.intExt.toLowerCase();

    // Check for space-related keywords in location
    const spaceKeywords = [
      'enterprise', 'starship', 'spaceship', 'space station',
      'bridge', 'engineering', 'sickbay', 'transporter room',
      'cargo bay', 'shuttle bay', 'ready room', 'observation lounge',
      'holodeck', 'jefferies tube', 'turbolift',
      'death star', 'millennium falcon', 'star destroyer',
      'serenity', 'galactica', 'voyager', 'defiant', 'discovery'
    ];

    // If it's an interior space setting, no weather
    if (intExt === 'int' && spaceKeywords.some(keyword => location.includes(keyword))) {
      return true;
    }

    // Check for explicit "space" in location
    if (location.includes('space') || location.includes('orbit')) {
      return true;
    }

    return false;
  }

  /**
   * Extract weather from scene elements
   * Style-aware: respects franchise settings (no weather on spaceships!)
   */
  private extractWeather(scene: Scene): string | undefined {
    // Check if this is a space setting where weather doesn't make sense
    if (this.isSpaceSetting(scene)) {
      return undefined;
    }

    const weatherKeywords = ['rain', 'snow', 'fog', 'storm', 'sunny', 'cloudy', 'wind'];

    for (const element of scene.elements) {
      const text = element.text.toLowerCase();

      for (const keyword of weatherKeywords) {
        if (text.includes(keyword)) {
          return keyword;
        }
      }
    }

    return undefined;
  }

  /**
   * Extract emotion from dialogue element
   * Handles both parenthetical and character extension (V.O., O.S., etc.)
   */
  private extractEmotion(dialogueElement: DialogueElement): string | undefined {
    const parts: string[] = [];

    // Check character extension (V.O., O.S., etc.)
    let hasVoiceOver = false;
    let hasOffScreen = false;

    if (dialogueElement.dialogue.character.extension) {
      const ext = dialogueElement.dialogue.character.extension.replace(/[()]/g, '').trim();
      if (ext === 'V.O.') {
        parts.push('voice over');
        hasVoiceOver = true;
      } else if (ext === 'O.S.') {
        parts.push('off screen');
        hasOffScreen = true;
      } else {
        parts.push(ext.toLowerCase());
      }
    }

    // Check parenthetical for additional context (e.g., "over intercom")
    if (dialogueElement.dialogue.parenthetical) {
      let paren = dialogueElement.dialogue.parenthetical.replace(/[()]/g, '').trim();

      // Skip if it's redundant with the extension
      if (paren.toLowerCase().includes('v.o.') || paren.toLowerCase().includes('o.s.')) {
        return parts.length > 0 ? parts.join(' ') : undefined;
      }

      // If we have voice over and parenthetical starts with "over", merge them
      // "voice over" + "over intercom" -> "voice over intercom"
      if (hasVoiceOver && paren.toLowerCase().startsWith('over ')) {
        paren = paren.substring(5); // Remove "over " prefix
      }

      parts.push(paren);
    }

    return parts.length > 0 ? parts.join(' ') : undefined;
  }

  /**
   * Extract ALL character introductions from an action line
   * Scans for pattern: "CHARACTER NAME (description details)"
   * Updates Character Bible with extracted details
   * Uses known character names to match partial names (e.g., "WIZARD CLIF HIGH" -> "CLIF")
   */
  private extractCharacterIntroductionsFromAction(actionElement: ActionElement, knownCharacterNames: string[]): void {
    const text = actionElement.text;

    // Look for pattern: ALL CAPS NAME (details)
    // This regex finds character names in all caps followed by parenthetical descriptions
    const regex = /([A-Z][A-Z\s]+)\s*\(([^)]+)\)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const fullName = match[1].trim();
      const details = match[2].trim();

      // Skip if this looks like a parenthetical direction (e.g., "(V.O.)", "(O.S.)")
      if (details.length < 10 || details.match(/^(V\.O\.|O\.S\.|CONT'D)$/i)) {
        continue;
      }

      // Try to match the full name to a known character name
      // E.g., "WIZARD CLIF HIGH" should match "CLIF"
      let matchedName: string | null = null;
      for (const knownName of knownCharacterNames) {
        if (fullName.includes(knownName)) {
          matchedName = knownName;
          break;
        }
      }

      // If no match found, skip this entry (it's probably not a character introduction)
      if (!matchedName) {
        continue;
      }

      // Split details by commas
      const parts = details.split(',').map(p => p.trim());

      // Try to separate physical appearance from wardrobe
      const wardrobeKeywords = ['wearing', 'dressed', 'uniform', 'robe', 'suit', 'dress', 'shirt', 'jacket', 'coat', 'hat', 'holster'];
      const physicalParts: string[] = [];
      const wardrobeParts: string[] = [];

      for (const part of parts) {
        const lowerPart = part.toLowerCase();
        if (wardrobeKeywords.some(kw => lowerPart.includes(kw))) {
          wardrobeParts.push(part);
        } else {
          physicalParts.push(part);
        }
      }

      // Detect if this is an entrance or exit
      const lowerText = text.toLowerCase();
      let position = 'in scene';
      if (lowerText.includes('enters') || lowerText.includes('enter')) {
        position = 'enters scene';
      } else if (lowerText.includes('exits') || lowerText.includes('exit')) {
        position = 'exits scene';
      }

      // Enrich wardrobe with specific colors based on cinematic style
      const enrichedWardrobe = this.enrichWardrobeWithColors(
        wardrobeParts.join(', '),
        matchedName,
        text
      );

      // Update or create Character Bible entry using the matched name (with fuzzy matching)
      let { bibleEntry } = this.getOrCreateCharacterInBible(matchedName);

      // Update entry with extracted details
      if (physicalParts.length > 0 && !bibleEntry.physicalAppearance) {
        bibleEntry.physicalAppearance = physicalParts.join(', ');
      }
      if (wardrobeParts.length > 0 && !bibleEntry.wardrobe) {
        bibleEntry.wardrobe = enrichedWardrobe;
      }
      // Update position if this is an entrance/exit
      if (position !== 'in scene') {
        bibleEntry.lastSeenPosition = position;
      }
    }
  }

  /**
   * Extract character introduction from action line for a specific character
   * Handles format: "CHARACTER NAME (description details)"
   */
  private extractCharacterIntroduction(text: string, characterName: string): {
    physicalAppearance?: string;
    wardrobe?: string;
  } | null {
    // Look for pattern: CHARACTER NAME (details)
    const regex = new RegExp(`${characterName}\\s*\\(([^)]+)\\)`, 'i');
    const match = text.match(regex);

    if (match && match[1]) {
      const details = match[1].trim();

      // Split details by commas
      const parts = details.split(',').map(p => p.trim());

      // Try to separate physical appearance from wardrobe
      const wardrobeKeywords = ['wearing', 'dressed', 'uniform', 'robe', 'suit', 'dress', 'shirt', 'jacket', 'coat', 'hat'];
      const physicalParts: string[] = [];
      const wardrobeParts: string[] = [];

      for (const part of parts) {
        const lowerPart = part.toLowerCase();
        if (wardrobeKeywords.some(kw => lowerPart.includes(kw))) {
          wardrobeParts.push(part);
        } else {
          physicalParts.push(part);
        }
      }

      return {
        physicalAppearance: physicalParts.length > 0 ? physicalParts.join(', ') : undefined,
        wardrobe: wardrobeParts.length > 0 ? wardrobeParts.join(', ') : undefined
      };
    }

    return null;
  }

  /**
   * Update character states from action line
   * Requirement 9: Extract blocking, wardrobe, and physical appearance details
   * Requirement 10: Extract props and accessories for Character Bible
   * PRIORITY: Extract actual character descriptions from screenplay
   */
  private updateCharacterStatesFromAction(
    actionElement: ActionElement,
    characterMap: Map<string, CharacterState>
  ): void {
    const text = actionElement.text;

    // First, check for character introductions in the action line
    for (const [name, state] of characterMap.entries()) {
      const intro = this.extractCharacterIntroduction(text, name);
      if (intro) {
        if (intro.physicalAppearance) {
          state.physicalAppearance = intro.physicalAppearance;
          const bibleEntry = this.findCharacterInBible(name);
          if (bibleEntry) {
            bibleEntry.physicalAppearance = intro.physicalAppearance;
          }
        }
        if (intro.wardrobe) {
          state.wardrobe = intro.wardrobe;
          const bibleEntry = this.findCharacterInBible(name);
          if (bibleEntry) {
            bibleEntry.wardrobe = intro.wardrobe;
          }
        }
      }
    }

    for (const [name, state] of characterMap.entries()) {
      // Check for character name (case-insensitive, and check for partial matches)
      // Example: "CLIF" should match "Clif" or "WIZARD CLIF HIGH" should match "Clif"
      const nameParts = name.split(/\s+/);
      const textLower = text.toLowerCase();
      const nameMatches = nameParts.some(part =>
        part.length > 2 && textLower.includes(part.toLowerCase())
      );

      if (nameMatches || text.includes(name)) {
        state.action = text;
        console.log(`[DEBUG] Assigning action to ${name}: "${text.substring(0, 100)}..."`);

        // Extract position/blocking keywords
        const positionKeywords = [
          'stands', 'sits', 'walks', 'enters', 'exits', 'moves',
          'left', 'right', 'center', 'foreground', 'background',
          'door', 'window', 'table', 'chair', 'corner'
        ];

        for (const keyword of positionKeywords) {
          if (text.toLowerCase().includes(keyword)) {
            // Special handling for "enters" and "exits" - use simple position
            if (keyword === 'enters' && text.toLowerCase().includes('enters')) {
              state.position = 'enters scene';
              break;
            } else if (keyword === 'exits' && text.toLowerCase().includes('exits')) {
              state.position = 'exits scene';
              break;
            }

            // Extract sentence containing the keyword for position context
            const sentences = text.split(/[.!?]/);
            for (const sentence of sentences) {
              if (sentence.toLowerCase().includes(keyword) && sentence.includes(name)) {
                state.position = sentence.trim();
                break;
              }
            }
            break;
          }
        }

        // Extract wardrobe keywords (Requirement 10: Rich character descriptions)
        // Enhanced to capture multiple sentences for verbose descriptions
        const wardrobeKeywords = [
          'wearing', 'dressed in', 'suit', 'dress', 'shirt', 'jacket',
          'coat', 'hat', 'uniform', 'costume', 'clothes', 'tie', 'shoes',
          'jeans', 'pants', 'skirt', 'blouse', 'sweater', 'hoodie', 'robe',
          'cloak', 'vest', 'boots', 'gloves', 'scarf', 'belt'
        ];

        for (const keyword of wardrobeKeywords) {
          if (text.toLowerCase().includes(keyword)) {
            const sentences = text.split(/[.!?]/).filter(s => s.trim().length > 0);
            const relevantSentences: string[] = [];

            // Collect all sentences mentioning the character and wardrobe
            for (const sentence of sentences) {
              if (sentence.toLowerCase().includes(keyword) && sentence.includes(name)) {
                relevantSentences.push(sentence.trim());
              }
            }

            if (relevantSentences.length > 0) {
              // Join multiple sentences for verbose description
              state.wardrobe = relevantSentences.join('. ');
              // Update Character Bible
              const bibleEntry = this.findCharacterInBible(name);
              if (bibleEntry) {
                bibleEntry.wardrobe = relevantSentences.join('. ');
              }
              break;
            }
          }
        }

        // Extract physical appearance keywords (Requirement 10: Rich character descriptions)
        // Enhanced to capture multiple sentences for verbose descriptions
        const appearanceKeywords = [
          'tall', 'short', 'thin', 'heavy', 'muscular', 'slender',
          'hair', 'eyes', 'beard', 'glasses', 'scar', 'tattoo',
          'young', 'old', 'middle-aged', 'athletic', 'stocky', 'petite',
          'wrinkled', 'smooth', 'pale', 'tanned', 'freckled', 'bald',
          'gray', 'blonde', 'brunette', 'redhead', 'blue eyes', 'brown eyes',
          'green eyes', 'hazel eyes', 'clean-shaven', 'mustache', 'goatee'
        ];

        for (const keyword of appearanceKeywords) {
          if (text.toLowerCase().includes(keyword)) {
            const sentences = text.split(/[.!?]/).filter(s => s.trim().length > 0);
            const relevantSentences: string[] = [];

            // Collect all sentences mentioning the character and appearance
            for (const sentence of sentences) {
              if (sentence.toLowerCase().includes(keyword) && sentence.includes(name)) {
                relevantSentences.push(sentence.trim());
              }
            }

            if (relevantSentences.length > 0) {
              // Join multiple sentences for verbose description
              state.physicalAppearance = relevantSentences.join('. ');
              // Update Character Bible
              const bibleEntry = this.findCharacterInBible(name);
              if (bibleEntry) {
                bibleEntry.physicalAppearance = relevantSentences.join('. ');
              }
              break;
            }
          }
        }

        // Extract props/accessories (Requirement 10: Rich character descriptions)
        const propKeywords = [
          'holding', 'carrying', 'grabs', 'picks up', 'puts down',
          'briefcase', 'bag', 'purse', 'phone', 'keys', 'wallet',
          'gun', 'knife', 'weapon', 'book', 'paper', 'document',
          'coffee', 'drink', 'food', 'cigarette', 'lighter'
        ];

        for (const keyword of propKeywords) {
          if (text.toLowerCase().includes(keyword)) {
            const sentences = text.split(/[.!?]/);
            for (const sentence of sentences) {
              if (sentence.toLowerCase().includes(keyword) && sentence.includes(name)) {
                // Update Character Bible with prop
                const bibleEntry = this.findCharacterInBible(name);
                if (bibleEntry) {
                  const prop = sentence.trim();
                  if (!bibleEntry.props.includes(prop)) {
                    bibleEntry.props.push(prop);
                  }
                }
                break;
              }
            }
            break;
          }
        }
      }
    }
  }

  /**
   * Enrich wardrobe descriptions with specific colors based on cinematic style
   * Maintains visual continuity by adding particular details
   *
   * Star Trek uniform colors:
   * - Command: Gold/Yellow
   * - Science/Medical: Blue
   * - Engineering/Security: Red
   */
  private enrichWardrobeWithColors(
    wardrobe: string,
    characterName: string,
    fullText: string
  ): string {
    if (!wardrobe || !this.styleGuidelines) {
      return wardrobe;
    }

    // Check if this is a Star Trek style
    const isStarTrek = this.styleGuidelines.appliedStyles.some(style =>
      style.toLowerCase().includes('star trek')
    );

    if (!isStarTrek) {
      return wardrobe; // Only enrich for Star Trek for now
    }

    // If wardrobe already has color, don't override
    const hasColor = /\b(red|blue|gold|yellow|green|black|white|gray|grey|purple|orange|brown)\b/i.test(wardrobe);
    if (hasColor) {
      return wardrobe;
    }

    // Determine department from wardrobe or character context
    const lowerWardrobe = wardrobe.toLowerCase();
    const lowerText = fullText.toLowerCase();

    let color = '';

    // Engineering/Security = Red
    if (lowerWardrobe.includes('engineering') || lowerWardrobe.includes('security') ||
        lowerText.includes('engineer') || lowerText.includes('security')) {
      color = 'red';
    }
    // Science/Medical = Blue
    else if (lowerWardrobe.includes('science') || lowerWardrobe.includes('medical') ||
             lowerText.includes('science') || lowerText.includes('medical') || lowerText.includes('doctor')) {
      color = 'blue';
    }
    // Command = Gold
    else if (lowerWardrobe.includes('command') || lowerWardrobe.includes('captain') ||
             lowerText.includes('captain') || lowerText.includes('commander')) {
      color = 'gold';
    }
    // Default to red for generic Starfleet uniforms
    else if (lowerWardrobe.includes('starfleet') || lowerWardrobe.includes('uniform')) {
      color = 'red'; // Default to engineering red
    }

    // Add color to wardrobe description
    if (color) {
      // Insert color before "uniform" or "robe" if present
      if (lowerWardrobe.includes('uniform')) {
        return wardrobe.replace(/uniform/i, `${color} uniform`);
      } else if (lowerWardrobe.includes('robe')) {
        return wardrobe.replace(/robe/i, `${color} robe`);
      } else {
        // Prepend color
        return `${color} ${wardrobe}`;
      }
    }

    return wardrobe;
  }

  /**
   * Extract characters using AI-powered fuzzy logic
   * Follows MPAA and AMPAS Nicholl Fellowship screenplay standards
   */
  private async extractCharactersWithAI(elements: SceneElement[], sceneContext: SceneContext): Promise<string[]> {
    // Build scene text from all elements
    const sceneText = elements.map(el => {
      if (el.type === 'dialogue') {
        const dialogueEl = el as DialogueElement;
        return `${dialogueEl.dialogue.character.name}\n${dialogueEl.dialogue.speech}`;
      } else if (el.type === 'action') {
        const actionEl = el as ActionElement;
        return actionEl.text;
      }
      return '';
    }).join('\n\n');

    // Use AI extractor
    const result = await this.aiExtractor.extractEntities(sceneText, sceneContext.set);

    // Combine AI-extracted characters with dialogue characters
    const characterNames: string[] = [];

    // Add dialogue characters (always include these)
    for (const element of elements) {
      if (element.type === 'dialogue') {
        const dialogueElement = element as DialogueElement;
        const characterName = dialogueElement.dialogue.character.name;
        if (!characterNames.includes(characterName)) {
          characterNames.push(characterName);
        }
      }
    }

    // Add AI-extracted characters
    for (const character of result.characters) {
      if (!characterNames.includes(character)) {
        characterNames.push(character);
      }
    }

    return characterNames;
  }
}

