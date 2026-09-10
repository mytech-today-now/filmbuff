/**
 * Help Text for generate-shot-list command
 * 
 * Comprehensive help documentation for the AI Shot List Generator
 */

export const HELP_TEXT = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                        AI SHOT LIST GENERATOR                                ║
║                                                                              ║
║  Convert traditional screenplays into AI-optimized shot lists for video     ║
║  generation platforms (Runway, Pika, Stable Video Diffusion, etc.)          ║
╚══════════════════════════════════════════════════════════════════════════════╝

SYNOPSIS
  filmbuff generate-shot-list --input <screenplay-file> [options]

DESCRIPTION
  Converts traditional screenplays into AI-optimized shot lists with automatic
  enforcement of shot duration and character limits. Each shot includes:
  
  • Complete scene context (set, lighting, time of day)
  • Character descriptions and positions
  • Camera framing and movement suggestions
  • Shot duration and character count validation
  • Technical notes and metadata

REQUIRED ARGUMENTS
  --input <file>
      Path to screenplay file
      Supported formats: Fountain (.fountain), Markdown (.md), Plain Text (.txt),
      Final Draft (.fdx), PDF (.pdf), DOCX (.docx), and RTF (.rtf)
      
      Examples:
        --input screenplay.fountain
        --input /path/to/screenplay.md
        --input "C:\\Users\\Name\\screenplay.txt"

OPTIONAL ARGUMENTS
  --format <format>
      Output format for shot list
      Valid values: md, json, jsonl, csv, txt, html
      Default: md
      
      Examples:
        --format json
        --format html

  --output <filename>
      Custom output filename
      Default: <input>-ai-shot-list.<ext>
      
      Examples:
        --output my-shots.json
        --output /path/to/output.md

  --max-characters <number>
      Maximum characters per shot description
      Range: 100 - 10000
      Default: 4000
      
      Examples:
        --max-characters 3000
        --max-characters 5000

  --max-shot-length <seconds>
      Maximum shot duration in seconds
      Range: 1 - 60
      Default: 12

      Examples:
        --max-shot-length 10
        --max-shot-length 15

  --logging
      Enable debug logging to ~/.filmbuff/logs/shot-list-generator.jsonl
      Logs all stages: parsing, generation, validation, formatting
      Includes error details, warnings, and style decisions

      Example:
        --logging

  --mute-sfx
      Remove all MUSIC and SOUND EFFECT content from the output
      Dialogue will remain intact if appropriate for the shot
      The missing SFX and Music will not affect the shot(s) in any other way

      Example:
        --mute-sfx

  --style <module-path>
      Apply cinematic style guidelines (can be specified multiple times)
      Format: writing-standards/screenplay/cinematic-styles/[category]/[style-name]
      Categories: directors, franchises, films, comedy-formats
      Priority: first --style flag = highest priority

      Examples:
        --style writing-standards/screenplay/cinematic-styles/directors/brian-de-palma
        --style writing-standards/screenplay/cinematic-styles/directors/brian-de-palma \
        --style writing-standards/screenplay/cinematic-styles/directors/alfred-hitchcock

  --ai-provider <provider>
      AI provider for shot list generation
      Currently implemented: anthropic
      Default: anthropic

      Example:
        --ai-provider anthropic

  --ai-model <model>
      AI model for the selected provider
      Default: claude-sonnet-4-6

      Example:
        --ai-model claude-sonnet-4-6

  --help, -h
      Display this help message

USAGE EXAMPLES
  Basic usage (Markdown output):
    filmbuff generate-shot-list --input screenplay.fountain

  Generate JSON output:
    filmbuff generate-shot-list --input screenplay.md --format json

  Custom character limit:
    filmbuff generate-shot-list --input screenplay.txt --max-characters 3000

  Custom output file:
    filmbuff generate-shot-list --input screenplay.fountain --output my-shots.html --format html

  With debug logging:
    filmbuff generate-shot-list --input screenplay.md --logging

  Mute sound effects and music:
    filmbuff generate-shot-list --input screenplay.fountain --mute-sfx

  Apply cinematic style:
    filmbuff generate-shot-list --input screenplay.fountain \
      --style writing-standards/screenplay/cinematic-styles/directors/christopher-nolan

  Multiple styles (priority-based):
    filmbuff generate-shot-list --input screenplay.fountain \
      --style writing-standards/screenplay/cinematic-styles/directors/brian-de-palma \
      --style writing-standards/screenplay/cinematic-styles/directors/alfred-hitchcock \
      --logging

  Select provider and model explicitly:
    filmbuff generate-shot-list --input screenplay.md --ai-provider anthropic --ai-model claude-sonnet-4-6

SUPPORTED FORMATS
  Input Formats:
    • Fountain (.fountain) - Industry-standard screenplay format
    • Markdown (.md) - Headings as scenes, paragraphs as action/dialogue
    • Plain Text (.txt) - Simple text with INT/EXT scene headings
    • Final Draft (.fdx) - Final Draft XML screenplay files
    • PDF (.pdf) - Extracted screenplay text from PDF documents
    • DOCX (.docx) - Microsoft Word screenplay documents
    • RTF (.rtf) - Rich Text Format screenplay documents

  Output Formats:
    • Markdown (md) - Structured shot list with tables
    • JSON (json) - Machine-readable format with all metadata
    • JSONL (jsonl) - One shot per line (streaming-friendly)
    • CSV (csv) - Spreadsheet-compatible format
    • TXT (txt) - Simple plain text format
    • HTML (html) - Interactive format with character counting

ERROR HANDLING
  When --logging is enabled, all events are logged to ~/.filmbuff/logs/shot-list-generator.jsonl

  Common errors:
    • PE001: Invalid scene heading format
    • VE001: Shot exceeds character limit
    • VE002: Shot exceeds duration limit
    • IO001: Input file not found
    • IO002: Output file cannot be written
    • STYLE_CONFLICT: Multiple styles have conflicting guidelines

EXIT CODES
  0 - Success
  1 - General error
  2 - Invalid arguments
  3 - Input file error
  4 - Output file error
  5 - Parsing error
  6 - Validation error

BEST PRACTICES
  1. Use Fountain format for best results (most structured)
  2. Keep shot descriptions under 4000 characters for optimal AI generation
  3. Limit shots to 12 seconds for better video quality
  4. Use HTML output for interactive editing and character counting
  5. Review warnings in the output for potential issues
  6. Enable --logging for debugging and audit trails
  7. Apply cinematic styles to match specific director aesthetics

CINEMATIC STYLES
  • Styles are loaded from FilmBuff extension modules
  • Multiple styles can be combined with priority-based merging
  • First --style flag = highest priority (primary style)
  • Conflicts are automatically resolved using primary style
  • Style conflicts are logged when --logging is enabled

TIPS
  • The generator automatically splits long scenes into multiple shots
  • Context is repeated for each shot (set, characters, lighting)
  • Metadata extraction identifies shot types and camera movements
  • Character limits include full context, not just action description
  • Style guidelines influence camera work, lighting, and pacing suggestions

For more information, visit:
  https://github.com/mytech-today-now/filmbuff

Report issues at:
  https://github.com/mytech-today-now/filmbuff/issues
`;

/**
 * Display help text
 */
export function displayHelp(): void {
  console.log(HELP_TEXT);
}
