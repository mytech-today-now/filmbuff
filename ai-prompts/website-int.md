# Refactored & Expanded FilmBuff Library Integration Section (Final Production-Ready Version)

## 6. FilmBuff Library Integration: Complete Technical Blueprint & Shot-List Output Specification

The website **must** integrate the official FilmBuff TypeScript library (sourced directly from https://github.com/mytech-today-now/filmbuff.git) as a first-class production dependency named `@mytechtoday/filmbuff`. Pin it in the backend `package.json` and install via `npm install`. All interactions occur exclusively through a dedicated, well-typed `FilmBuffService` (NestJS `@Injectable()` service or equivalent TypeScript class in Next.js API routes). This service acts as the single source of truth for every library call, ensuring zero raw exposure of FilmBuff internals to the frontend, full credit awareness, queue-based async execution, and strict adherence to the exact output format defined below.

### Core Responsibilities of FilmBuffService
- **Import Strategy**: Dynamically or statically import required modules at service initialization:
  ```ts
  import { generateShotList, generateNewFountain, linkModules, listAvailableStyles } from '@mytechtoday/filmbuff';
Call linkModules(['writing-standards/screenplay', 'ai-prompts', 'genre-modules', 'narrative-styles']) once at startup to activate the full 60+ cinematic style guides, 13 narrative styles, 18+ genre modules, franchise/director/producer presets, and theme inventory.

Supported Workflows (exposed via two clean public methods):
async convertToShotList(input: Buffer | string, options: FilmBuffOptions): Promise<ShotListResult>
async generateNewFountain(promptOrSeed: string | Buffer, options: FilmBuffOptions): Promise<NewFountainResult>

StyleSelection Interface (populated dynamically from library via listAvailableStyles()):TypeScriptexport interface StyleSelection {
  franchises?: string[];      // e.g. ["Marvel Cinematic Universe", "Star Wars Original Trilogy"]
  directors?: string[];       // e.g. ["Christopher Nolan", "Quentin Tarantino"]
  producers?: string[];       // e.g. ["Jerry Bruckheimer"]
  genres?: string[];          // dynamically loaded from 18+ genres
  themes?: string[];          // e.g. ["redemption", "revenge", "found family"]
  narrativeStyles?: string[]; // e.g. ["Hero’s Journey", "Three-Act", "Nonlinear"]
}
Options & Credit Handling:TypeScriptexport interface FilmBuffOptions {
  styles?: StyleSelection;
  aiEnabled?: boolean;           // routes through library’s internal AI orchestration (GPT-4o / Claude 3.5)
  outputFormats?: ('json' | 'csv' | 'pdf' | 'fountain')[];
  creditMultiplier?: number;     // injected from AdminConfig
}Before queuing, the service calls CreditCalculatorService to compute and pre-authorize exact credits. On success, credits are deducted atomically; on failure, full rollback occurs with user-friendly messaging.
Async Execution: Every job is enqueued via BullMQ + Redis. Real-time progress is broadcast via WebSocket (status updates: “Parsing Fountain…”, “Applying Nolan director style…”, “Generating AI-video prompts…”). Job payload includes userId, inputHash, and full options for deduplication and auditing.

Mandatory Output Format for 'generate-shot-list' / convertToShotList
All shot-list results must be returned and stored in the exact Markdown + table format shown in the reference example. The FilmBuffService (or a thin post-processing wrapper) is responsible for transforming the library’s internal data into this standardized, human-readable, and AI-video-ready structure. The frontend will render this output directly as Markdown with proper table styling.
Exact Required Output Structure (every shot must follow this verbatim):
Markdown## Shot List

### Shot 1
**Scene:**
| Property          | Value                  |
|-------------------|------------------------|
| Duration          | 0:12                   |
| Shot Type         | establishing           |
| Camera Movement   | pan                    |
| Framing           | wide                   |
| Visual Style      | Reality                |
| C:                | 806 / 4000             |
**Set:**
EXT. COMMERCIAL WAREHOUSE - STORMY NIGHT
**Description:**
SUPER: "LAST QUARTER...". A drone glides low over an expansive flat industrial roof. Storm water pools in wide black sheets. A membrane seam has split — a dark wound running six feet across the surface.
**Characters:**
No characters specified in this shot
**Actions:**
No specific actions in this shot
**Dialogue:**
No dialogue in this shot
**Blocking:**
Characters maintain their positions
**SFX:**
No sound effects specified
**Technical Details:**
Shot Type: establishing. Camera Movement: pan. Framing: wide. Visual Style: Reality

### Shot 2
**Scene:**
| Property          | Value                  |
|-------------------|------------------------|
| Duration          | 0:08                   |
| Shot Type         | close-up               |
| Camera Movement   | static                 |
| Framing           | tight                  |
| Visual Style      | Cinematic              |
| C:                | 807 / 4000             |
**Set:**
INT. ABANDONED OFFICE - SAME NIGHT
**Description:**
[Full descriptive paragraph generated by FilmBuff, including any SUPER, lighting notes, weather, etc.]
**Characters:**
John Doe (mid-30s, weary)
**Actions:**
John slowly opens the rusted filing cabinet.
**Dialogue:**
JOHN: "It has to be here somewhere..."
**Blocking:**
John stands center-frame, back partially to camera.
**SFX:**
Creaking metal, distant thunder rumble
**Technical Details:**
Shot Type: close-up. Camera Movement: static. Framing: tight. Visual Style: Cinematic
Rules for Output Generation:

Shot numbers increment sequentially (### Shot 1, ### Shot 2, ### Shot 2a if sub-shots are needed).
Every shot must contain the exact sections in order: Scene (with Markdown table), Set, Description, Characters, Actions, Dialogue, Blocking, SFX, Technical Details.
The Scene table must include at minimum: Duration, Shot Type, Camera Movement, Framing, Visual Style, and C: (credit/token counter).
Description must be a rich, cinematic paragraph ready for downstream AI video tools.
Empty fields use the exact phrasing: “No characters specified in this shot”, “No specific actions in this shot”, etc.
Technical Details at the bottom is a concise one-line summary repeating the key visual properties.
When styles are applied (Nolan, Marvel, etc.), FilmBuff’s internal modules automatically influence Shot Type, Visual Style, Camera Movement, and Description language.
PDF and CSV versions are generated from this same Markdown source using server-side rendering (pdf-lib or marked + pdf converter).

Additional Integration Requirements

File Support: Native parsing of .fountain, .txt, .pdf, .fdx. Temporary files written only to secure /tmp/ and deleted immediately after processing.
Error Mapping: Library errors are translated into clear user messages with retry buttons (e.g., “Invalid scene heading detected — please check formatting”).
Caching: Frequently used style presets and module lists are cached in Redis for instant UI population.
Testing: Unit tests mock @mytechtoday/filmbuff; integration tests run against real library with sample files; end-to-end Playwright tests verify the exact Markdown shot-list format is produced and downloadable.
Versioning & Safety: All calls are versioned (/api/v1/filmbuff/convert). Service exposes a /health/filmbuff endpoint that reports linked modules and library version.
Theme Compatibility: The generated Markdown renders beautifully in both Retro Web (phosphor green tables) and any swapped theme (Minimalist, Cinematic, etc.) via CSS.