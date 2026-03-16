/**
 * Error Catalog for AI Shot List Generator
 * 
 * Comprehensive error definitions with codes, messages, and fix suggestions
 */

export type ErrorType = 'parsing' | 'validation' | 'formatting' | 'io' | 'runtime';
export type Severity = 'critical' | 'error' | 'warning' | 'info';

export interface ErrorDefinition {
  code: string;
  name: string;
  description: string;
  severity: Severity;
  exitCode: number;
  recovery: string;
  message: (context?: any) => string;
  fix: (context?: any) => string;
  autoFixable: boolean;
  relatedDocs: string[];
}

/**
 * Parsing Errors (PE001-PE004)
 */
export const PARSING_ERRORS: Record<string, ErrorDefinition> = {
  PE001: {
    code: 'PE001',
    name: 'Invalid Screenplay Format',
    description: 'Input file is not in a recognized format',
    severity: 'critical',
    exitCode: 5,
    recovery: 'Fail - cannot parse',
    message: (ctx) => `Invalid screenplay format: ${ctx?.format || 'unknown'}. File must be Fountain (.fountain), Markdown (.md), or Plain Text (.txt)`,
    fix: (ctx) => `Convert your screenplay to one of the supported formats: Fountain, Markdown, or Plain Text. See https://fountain.io for Fountain format specification.`,
    autoFixable: false,
    relatedDocs: ['https://fountain.io/syntax', 'https://github.com/mytech-today-now/augment-extensions/blob/main/docs/screenplay-formats.md']
  },
  PE002: {
    code: 'PE002',
    name: 'Malformed Scene Heading',
    description: "Scene heading doesn't follow standard format",
    severity: 'error',
    exitCode: 5,
    recovery: 'Skip scene, continue',
    message: (ctx) => `Malformed scene heading at line ${ctx?.line}: "${ctx?.text}". Expected format: INT/EXT. LOCATION - TIME`,
    fix: (ctx) => `Correct the scene heading format. Use: INT. or EXT. followed by location, hyphen, and time of day. Example: "INT. COFFEE SHOP - DAY"`,
    autoFixable: true,
    relatedDocs: ['https://fountain.io/syntax#section-sluglines']
  },
  PE003: {
    code: 'PE003',
    name: 'Unclosed Dialogue Block',
    description: 'Character dialogue is not properly terminated',
    severity: 'error',
    exitCode: 5,
    recovery: 'Skip dialogue, continue',
    message: (ctx) => `Unclosed dialogue block starting at line ${ctx?.line}. Character: ${ctx?.character}`,
    fix: (ctx) => `Ensure dialogue blocks are properly terminated with a blank line or next scene element.`,
    autoFixable: true,
    relatedDocs: ['https://fountain.io/syntax#section-dialogue']
  },
  PE004: {
    code: 'PE004',
    name: 'Invalid Character Name',
    description: 'Character name contains invalid characters',
    severity: 'warning',
    exitCode: 0,
    recovery: 'Sanitize name, continue',
    message: (ctx) => `Invalid character name at line ${ctx?.line}: "${ctx?.name}". Character names should be uppercase letters, spaces, and hyphens only.`,
    fix: (ctx) => `Remove special characters from character name. Use only uppercase letters, spaces, and hyphens.`,
    autoFixable: true,
    relatedDocs: ['https://fountain.io/syntax#section-character']
  }
};

/**
 * Validation Errors (VE001-VE004)
 */
export const VALIDATION_ERRORS: Record<string, ErrorDefinition> = {
  VE001: {
    code: 'VE001',
    name: 'Character Limit Exceeded',
    description: 'Shot description exceeds maximum characters',
    severity: 'warning',
    exitCode: 0,
    recovery: 'Continue with warning',
    message: (ctx) => `Shot ${ctx?.shotNumber} exceeds character limit: ${ctx?.actualChars} characters (max: ${ctx?.maxChars})`,
    fix: (ctx) => `Reduce shot description length or increase --max-characters limit. Consider splitting into multiple shots.`,
    autoFixable: false,
    relatedDocs: []
  },
  VE002: {
    code: 'VE002',
    name: 'Shot Duration Exceeded',
    description: 'Shot duration exceeds maximum length',
    severity: 'warning',
    exitCode: 0,
    recovery: 'Continue with warning',
    message: (ctx) => `Shot ${ctx?.shotNumber} exceeds duration limit: ${ctx?.actualDuration}s (max: ${ctx?.maxDuration}s)`,
    fix: (ctx) => `Reduce shot duration or increase --max-shot-length limit. Consider splitting into multiple shots.`,
    autoFixable: false,
    relatedDocs: []
  },
  VE003: {
    code: 'VE003',
    name: 'Empty Shot Description',
    description: 'Shot has no action or dialogue',
    severity: 'warning',
    exitCode: 0,
    recovery: 'Continue with warning',
    message: (ctx) => `Shot ${ctx?.shotNumber} has no action or dialogue`,
    fix: (ctx) => `Add action description or dialogue to the shot, or remove the empty shot.`,
    autoFixable: false,
    relatedDocs: []
  },
  VE004: {
    code: 'VE004',
    name: 'Missing Required Metadata',
    description: 'Shot is missing required fields',
    severity: 'error',
    exitCode: 6,
    recovery: 'Fail - cannot generate',
    message: (ctx) => `Shot ${ctx?.shotNumber} is missing required metadata: ${ctx?.missingFields?.join(', ')}`,
    fix: (ctx) => `Ensure all required fields are present: scene heading, location, time of day, and action/dialogue.`,
    autoFixable: false,
    relatedDocs: []
  }
};

/**
 * Formatting Errors (FE001-FE002)
 */
export const FORMATTING_ERRORS: Record<string, ErrorDefinition> = {
  FE001: {
    code: 'FE001',
    name: 'Invalid Output Format',
    description: 'Specified output format is not supported',
    severity: 'critical',
    exitCode: 2,
    recovery: 'Fail - invalid argument',
    message: (ctx) => `Invalid output format: "${ctx?.format}". Supported formats: md, json, jsonl, csv, txt, html`,
    fix: (ctx) => `Use one of the supported output formats: md, json, jsonl, csv, txt, or html. Example: --format json`,
    autoFixable: false,
    relatedDocs: []
  },
  FE002: {
    code: 'FE002',
    name: 'Output File Extension Mismatch',
    description: "Filename extension doesn't match format",
    severity: 'warning',
    exitCode: 0,
    recovery: 'Continue with warning',
    message: (ctx) => `Output file extension ".${ctx?.extension}" doesn't match format "${ctx?.format}"`,
    fix: (ctx) => `Rename output file to use correct extension for format "${ctx?.format}", or change format to match extension.`,
    autoFixable: false,
    relatedDocs: []
  }
};

/**
 * I/O Errors (IO001-IO005)
 */
export const IO_ERRORS: Record<string, ErrorDefinition> = {
  IO001: {
    code: 'IO001',
    name: 'Input File Not Found',
    description: "Specified screenplay file doesn't exist",
    severity: 'critical',
    exitCode: 3,
    recovery: 'Fail - cannot read',
    message: (ctx) => `Input file not found: ${ctx?.path}`,
    fix: (ctx) => `Check that the file path is correct and the file exists. Use absolute path or path relative to current directory.`,
    autoFixable: false,
    relatedDocs: []
  },
  IO002: {
    code: 'IO002',
    name: 'Permission Denied (Read)',
    description: 'No read permission for input file',
    severity: 'critical',
    exitCode: 3,
    recovery: 'Fail - cannot read',
    message: (ctx) => `Permission denied reading file: ${ctx?.path}`,
    fix: (ctx) => `Check file permissions and ensure you have read access. On Unix: chmod +r "${ctx?.path}"`,
    autoFixable: false,
    relatedDocs: []
  },
  IO003: {
    code: 'IO003',
    name: 'Permission Denied (Write)',
    description: 'No write permission for output directory',
    severity: 'critical',
    exitCode: 4,
    recovery: 'Fail - cannot write',
    message: (ctx) => `Permission denied writing to: ${ctx?.path}`,
    fix: (ctx) => `Check directory permissions and ensure you have write access. On Unix: chmod +w "${ctx?.directory}"`,
    autoFixable: false,
    relatedDocs: []
  },
  IO004: {
    code: 'IO004',
    name: 'Disk Full',
    description: 'Insufficient disk space for output file',
    severity: 'critical',
    exitCode: 4,
    recovery: 'Fail - cannot write',
    message: (ctx) => `Insufficient disk space. Required: ${ctx?.required}MB, Available: ${ctx?.available}MB`,
    fix: (ctx) => `Free up disk space or choose a different output location with more available space.`,
    autoFixable: false,
    relatedDocs: []
  },
  IO005: {
    code: 'IO005',
    name: 'Output File Already Exists',
    description: 'Output file exists and overwrite not enabled',
    severity: 'error',
    exitCode: 4,
    recovery: 'Fail - would overwrite',
    message: (ctx) => `Output file already exists: ${ctx?.path}. Use --force to overwrite.`,
    fix: (ctx) => `Either delete the existing file, choose a different output filename, or use --force flag to overwrite.`,
    autoFixable: false,
    relatedDocs: []
  }
};

/**
 * Runtime Errors (RE001-RE003)
 */
export const RUNTIME_ERRORS: Record<string, ErrorDefinition> = {
  RE001: {
    code: 'RE001',
    name: 'Out of Memory',
    description: 'Screenplay is too large to process',
    severity: 'critical',
    exitCode: 1,
    recovery: 'Fail - insufficient memory',
    message: (ctx) => `Out of memory processing screenplay. File size: ${ctx?.fileSize}MB`,
    fix: (ctx) => `Split the screenplay into smaller files or increase Node.js memory limit: node --max-old-space-size=4096`,
    autoFixable: false,
    relatedDocs: []
  },
  RE002: {
    code: 'RE002',
    name: 'Processing Timeout',
    description: 'Processing takes longer than maximum time',
    severity: 'critical',
    exitCode: 1,
    recovery: 'Fail - timeout exceeded',
    message: (ctx) => `Processing timeout after ${ctx?.timeout}s. File may be too large or complex.`,
    fix: (ctx) => `Simplify the screenplay, split into smaller files, or increase timeout limit.`,
    autoFixable: false,
    relatedDocs: []
  },
  RE003: {
    code: 'RE003',
    name: 'Unexpected Exception',
    description: 'Unhandled error in processing logic',
    severity: 'critical',
    exitCode: 1,
    recovery: 'Fail - unknown error',
    message: (ctx) => `Unexpected error: ${ctx?.error?.message || 'Unknown error'}`,
    fix: (ctx) => `This is an internal error. Please report this issue with the error details and input file.`,
    autoFixable: false,
    relatedDocs: ['https://github.com/mytech-today-now/augment-extensions/issues']
  }
};

/**
 * All errors combined
 */
export const ALL_ERRORS: Record<string, ErrorDefinition> = {
  ...PARSING_ERRORS,
  ...VALIDATION_ERRORS,
  ...FORMATTING_ERRORS,
  ...IO_ERRORS,
  ...RUNTIME_ERRORS
};

/**
 * Get error definition by code
 */
export function getErrorDefinition(code: string): ErrorDefinition | undefined {
  return ALL_ERRORS[code];
}

/**
 * Get all errors of a specific type
 */
export function getErrorsByType(type: ErrorType): Record<string, ErrorDefinition> {
  switch (type) {
    case 'parsing':
      return PARSING_ERRORS;
    case 'validation':
      return VALIDATION_ERRORS;
    case 'formatting':
      return FORMATTING_ERRORS;
    case 'io':
      return IO_ERRORS;
    case 'runtime':
      return RUNTIME_ERRORS;
    default:
      return {};
  }
}
