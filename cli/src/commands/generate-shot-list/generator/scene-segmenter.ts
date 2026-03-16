/**
 * Scene Segmenter
 * 
 * Implements scene-to-shot segmentation logic with duration-based segmentation,
 * natural break points (dialogue, action beats), and max duration enforcement.
 * 
 * Task: bd-shot-list-3.2
 */

import { Scene, SceneElement, DialogueElement, ActionElement } from '../parser/types';

/**
 * Segmentation configuration
 */
export interface SegmentationConfig {
  maxShotLength: number; // Maximum shot duration in seconds
  targetShotLength: number; // Target shot duration in seconds
  minShotLength: number; // Minimum shot duration in seconds
}

/**
 * Scene segment (will become a shot)
 */
export interface SceneSegment {
  elements: SceneElement[];
  estimatedDuration: number;
  breakReason: 'duration' | 'dialogue' | 'action-beat' | 'scene-end';
}

/**
 * Duration estimation constants (in seconds)
 */
const DURATION_ESTIMATES = {
  ACTION_LINE: 3, // Average seconds per action line
  DIALOGUE_WORD: 0.4, // Average seconds per word of dialogue
  TRANSITION: 1, // Transition duration
  NOTE: 0 // Notes don't add screen time
};

/**
 * Scene Segmenter class
 */
export class SceneSegmenter {
  private config: SegmentationConfig;

  constructor(config: SegmentationConfig) {
    this.config = config;
  }

  /**
   * Segment a scene into shots
   */
  segment(scene: Scene): SceneSegment[] {
    const segments: SceneSegment[] = [];
    let currentSegment: SceneElement[] = [];
    let currentDuration = 0;

    for (let i = 0; i < scene.elements.length; i++) {
      const element = scene.elements[i];
      const elementDuration = this.estimateElementDuration(element);

      // Check if adding this element would exceed max duration
      if (currentDuration + elementDuration > this.config.maxShotLength && currentSegment.length > 0) {
        // Create segment at natural break point
        segments.push({
          elements: [...currentSegment],
          estimatedDuration: currentDuration,
          breakReason: 'duration'
        });
        currentSegment = [];
        currentDuration = 0;
      }

      // Add element to current segment
      currentSegment.push(element);
      currentDuration += elementDuration;

      // Check for natural break points
      const nextElement = scene.elements[i + 1];
      if (this.isNaturalBreakPoint(element, nextElement, currentDuration)) {
        segments.push({
          elements: [...currentSegment],
          estimatedDuration: currentDuration,
          breakReason: this.getBreakReason(element, nextElement, currentDuration)
        });
        currentSegment = [];
        currentDuration = 0;
      }
    }

    // Add remaining elements as final segment
    if (currentSegment.length > 0) {
      segments.push({
        elements: currentSegment,
        estimatedDuration: currentDuration,
        breakReason: 'scene-end'
      });
    }

    return segments;
  }

  /**
   * Estimate duration of a scene element
   */
  private estimateElementDuration(element: SceneElement): number {
    switch (element.type) {
      case 'action':
        return DURATION_ESTIMATES.ACTION_LINE;
      
      case 'dialogue':
        const dialogueElement = element as DialogueElement;
        const wordCount = dialogueElement.dialogue.speech.split(/\s+/).length;
        return wordCount * DURATION_ESTIMATES.DIALOGUE_WORD;
      
      case 'transition':
        return DURATION_ESTIMATES.TRANSITION;
      
      case 'note':
        return DURATION_ESTIMATES.NOTE;
      
      default:
        return 0;
    }
  }

  /**
   * Check if this is a natural break point between shots
   */
  private isNaturalBreakPoint(
    current: SceneElement,
    next: SceneElement | undefined,
    currentDuration: number
  ): boolean {
    if (!next) {
      return false; // End of scene, not a break point
    }

    // Break after dialogue if we're near target duration
    if (current.type === 'dialogue' && currentDuration >= this.config.targetShotLength) {
      return true;
    }

    // Break at action beats (action followed by dialogue or vice versa)
    if (current.type === 'action' && next.type === 'dialogue' && currentDuration >= this.config.minShotLength) {
      return true;
    }

    if (current.type === 'dialogue' && next.type === 'action' && currentDuration >= this.config.minShotLength) {
      return true;
    }

    return false;
  }

  /**
   * Get the reason for the break
   */
  private getBreakReason(
    current: SceneElement,
    next: SceneElement | undefined,
    currentDuration: number
  ): 'duration' | 'dialogue' | 'action-beat' | 'scene-end' {
    if (!next) {
      return 'scene-end';
    }

    if (currentDuration >= this.config.maxShotLength) {
      return 'duration';
    }

    if (current.type === 'dialogue') {
      return 'dialogue';
    }

    return 'action-beat';
  }
}

