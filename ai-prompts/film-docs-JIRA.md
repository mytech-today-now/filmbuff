# JIRA Ticket: TBD - AI-Powered Narrative Document Pipeline for FilmBuff (`filmbuff start`)

### Summary
Introduce a sequential, AI-powered document generation pipeline to FilmBuff that takes a user's creative brief and produces every development artifact a commercial or narrative film project needs — from a one-sentence logline through a production-ready shot list — using the same configurable AI provider abstraction already powering `filmbuff generate-shot-list`. New commands `filmbuff start`, `filmbuff continue`, `filmbuff complete`, and `filmbuff retry` drive the workflow so users can generate, review, override, and resume at any step without restarting from scratch.

### Description

#### Background
FilmBuff can already produce an AI-optimised shot list from a finished screenplay. What is missing is the pipeline that gets a project from the user's initial idea to that finished screenplay. Writers, directors, and commercial producers typically work through a structured sequence of documents — logline, synopsis, treatment, beat sheet, screenplay, shooting script, script breakdown, storyboards, shot list — each one building on the last. Generating those documents by hand is slow and expensive; generating them without continuity or creative context produces generic output that does not serve the project.

This ticket introduces an AI-powered pipeline that preserves creative context across every step, routes all generation through the user's already-configured provider/profile (Anthropic, OpenAI, Google AI, or any custom provider), and lets users guide, correct, and resume the workflow at any stage. The result should work equally well for narrative features, short films, episodic content, branded commercials, and social video.

#### Key Requirements

**Workflow Commands**
- `filmbuff start` — begin a new project pipeline. Prompts the user for the project name, genre, tone, target audience, budget tier, and desired outcome, then generates documents in sequence.
- `filmbuff continue` — resume the pipeline from the last successfully completed document. Uses previously generated documents as context for subsequent steps.
- `filmbuff complete` — mark the current document as accepted and advance to the next step without regenerating.
- `filmbuff retry` — discard the last generated document and regenerate it using updated inputs or a different prompt.

**Document Pipeline — Sequential Steps**
1. `logline.md` — one-sentence premise, conflict, and hook
2. `synopsis.md` — 1-to-2 page plot and character summary
3. `treatment.md` — 5-to-20 page narrative prose with tone, arc, and character detail; no dialogue
4. `beat-sheet.json` — structured act/scene/beat breakdown used as the scripting roadmap
5. `screenplay.fountain` — full scripted document with dialogue, action, and scene headings
6. `shooting-script.fountain` — production-ready screenplay with scene numbers, technical notes, and revision marks
7. `script-breakdown.md` — element inventory: locations, props, cast, costumes, VFX, practical effects
8. `storyboards.pdf` — ordered visual frame sequence for each key shot
9. `shot-list.md` / `shot-list.json` — detailed shot inventory produced via the existing `generate-shot-list` subsystem
10. `final-screenplay.md` — clean final draft consolidated from all revisions

**AI Provider Integration**
- All generation steps resolve the active provider/profile through the same `resolveActiveProvider` / `resolveProviderByProfile` runtime resolver used by `generate-shot-list`.
- Each command must support `--ai-provider` and `--ai-profile` flags to override the active selection per run.
- No step should hard-code a provider; the abstraction must remain clean so future providers plug in without changes to the pipeline.

**Context Preservation**
- Each generation step receives the full content of all previously accepted documents as context so the AI can maintain character names, tone, genre conventions, and plot consistency automatically.
- Context is stored in a project state file (e.g. `.filmbuff/project.json`) so `filmbuff continue` can restore it reliably after a break.

**User Control and Overrides**
- After each generation step the user is shown the output and offered the options: accept, edit, retry with new instructions, or skip.
- The user may override any generated value — project name, logline text, character names — before the pipeline advances.
- Output directory, file names, and per-document format (`.md`, `.json`, `.fountain`, `.pdf`) must be configurable, with sensible defaults.
- `filmbuff start --input <brief.md>` should accept a pre-written creative brief file to skip the interactive setup prompts.

**Commercial and Narrative Support**
- Genre support must include narrative (drama, thriller, comedy, sci-fi, horror), documentary, branded commercial, social/short-form video, and episodic/series formats.
- Tone and style options should map to the cinematic-style modules already in the FilmBuff extension system so directors and franchise styles can be applied to generation prompts.
- Budget-tier input (micro, low, mid, studio) should influence what the script breakdown and shot list recommend as practical versus ambitious.

**Output Formats**
- Each document must be exportable in the format appropriate to its type: `.md` for prose documents, `.json` for structured data, `.fountain` for scripts, `.pdf` for storyboards and final deliverables.
- `filmbuff start --format pdf` should convert all compatible documents to PDF at the end of the pipeline.

**Testing and Documentation**
- Unit tests for project state persistence, context assembly, provider resolution per step, and retry/resume logic.
- Integration tests that walk the pipeline end-to-end with a mock AI adapter.
- User documentation covering setup, creative inputs, per-step review, provider selection, format options, and resume behavior.

### Acceptance Criteria
- `filmbuff start` prompts for creative inputs and generates all ten pipeline documents in sequence using the active AI provider.
- `filmbuff continue` resumes from the last accepted document without losing creative context.
- `filmbuff complete` and `filmbuff retry` advance or regenerate individual steps reliably.
- All generation steps use the shared provider abstraction (`resolveActiveProvider`) and respect `--ai-provider` / `--ai-profile` overrides.
- Creative context (tone, genre, characters, prior documents) is preserved automatically across all steps.
- Users can override any generated document before the pipeline advances.
- Output formats `.md`, `.json`, `.fountain`, and `.pdf` are supported per document type.
- Genre modes cover narrative, documentary, branded commercial, social/short-form, and episodic content.
- Cinematic-style modules from the FilmBuff extension system can be applied to generation prompts.
- Budget tier influences shot list and script breakdown recommendations.
- Project state survives a restart so `filmbuff continue` works across sessions.
- Documentation and automated tests cover pipeline sequencing, context assembly, provider routing, override behavior, and retry/resume logic.

### Estimated Effort
- Design and Planning: 8 hours
- Pipeline State and Context Engine: 10 hours
- Per-Step AI Generation and Prompt Engineering: 20 hours
- User Override and Review UX: 8 hours
- Format Export (fountain, PDF, JSON): 8 hours
- Testing and Documentation: 10 hours
- Total: 64 hours

### Attachments
- Source prompt: `ai-prompts/film-docs-prompt.md`
- Provider integration reference: `ai-prompts/ai-providers-JIRA.md`
- AI provider runtime: `cli/src/utils/runtime-resolver.ts`
- Existing shot-list pipeline: `cli/src/commands/generate-shot-list.ts`
- Style system: `cli/src/commands/generate-shot-list/style/`

