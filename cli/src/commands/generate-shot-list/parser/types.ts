/**
 * Screenplay Parser Types
 * 
 * Data structures for representing parsed screenplay content
 */

/**
 * Scene heading components
 */
export interface SceneHeading {
  intExt: 'INT' | 'EXT' | 'INT/EXT' | 'EXT/INT';
  location: string;
  timeOfDay: string;
  raw: string;
}

/**
 * Character in dialogue
 */
export interface Character {
  name: string;
  extension?: string; // e.g., (V.O.), (O.S.)
}

/**
 * Dialogue element
 */
export interface Dialogue {
  character: Character;
  parenthetical?: string; // e.g., (whispering)
  speech: string;
}

/**
 * Scene element types
 */
export type SceneElementType = 
  | 'heading'
  | 'action'
  | 'dialogue'
  | 'transition'
  | 'note';

/**
 * Generic scene element
 */
export interface SceneElement {
  type: SceneElementType;
  text: string;
  line: number; // Line number in source file
  column: number; // Column number in source file
}

/**
 * Scene heading element
 */
export interface HeadingElement extends SceneElement {
  type: 'heading';
  heading: SceneHeading;
}

/**
 * Action element
 */
export interface ActionElement extends SceneElement {
  type: 'action';
}

/**
 * Dialogue element
 */
export interface DialogueElement extends SceneElement {
  type: 'dialogue';
  dialogue: Dialogue;
}

/**
 * Transition element
 */
export interface TransitionElement extends SceneElement {
  type: 'transition';
}

/**
 * Note element
 */
export interface NoteElement extends SceneElement {
  type: 'note';
}

/**
 * Union type for all scene element types
 */
export type AnySceneElement =
  | HeadingElement
  | ActionElement
  | DialogueElement
  | TransitionElement
  | NoteElement;

/**
 * Scene in screenplay
 */
export interface Scene {
  number: number;
  heading: SceneHeading;
  elements: AnySceneElement[];
  startLine: number;
  endLine: number;
}

/**
 * Complete screenplay AST
 */
export interface Screenplay {
  title?: string;
  author?: string;
  scenes: Scene[];
  format?: string;
  metadata: {
    format: 'fountain' | 'markdown' | 'plaintext' | 'finaldraft' | 'pdf' | 'docx' | 'rtf';
    totalLines?: number;
    totalScenes: number;
    parsedAt: string | Date;
    [key: string]: any; // Allow additional metadata fields
  };
}

/**
 * Parser interface
 */
export interface Parser {
  /**
   * Parse screenplay file content
   * Can be synchronous or asynchronous depending on the parser
   */
  parse(content: string | Buffer): Screenplay | Promise<Screenplay>;

  /**
   * Get parser name
   */
  getName(): string;

  /**
   * Check if parser can handle this content
   */
  canParse(content: string | Buffer, filePath?: string): boolean;
}

/**
 * Parser factory function type
 */
export type ParserFactory = (format: 'fountain' | 'markdown' | 'plaintext' | 'finaldraft' | 'pdf' | 'docx' | 'rtf') => Parser;

/**
 * Parse error
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public line: number,
    public column: number,
    public context?: string
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

