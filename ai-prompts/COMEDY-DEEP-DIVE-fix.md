# Prompt: Refactor `COMEDY-DEEP-DIVE.md` for Filmbuff Compatibility

## Role

You are an Augment Code agent working inside the `filmbuff` repository
(root: `g:\_kyle\temp_documents\GitHub\filmbuff-project\filmbuff`).
Refactor an existing comedy reference document so it conforms to
Filmbuff's extension-module conventions and is discoverable by the
`filmbuff` CLI.

## Target File

- **Path (current & final)**:
  `filmbuff/writing-standards/screenplay/genres/comedy/rules/COMEDY-DEEP-DIVE.md`
- **Do not move the file.** It is already in the correct module
  location (`rules/` directory, sibling to `comedy.md`). Any earlier
  instruction implying a duplicated `filmbuff\filmbuff\...` path was a
  typo — treat the path above as canonical.

## Objectives (in priority order)

1. Preserve **all substantive comedy craft content** (theories,
   structures, joke mechanics, satire, slapstick, deadpan, meta-humor,
   callbacks, hybrid techniques, validation checklists, film
   examples). Condense prose; never drop a covered concept.
2. Align the document's **structure, metadata, and voice** with the
   sibling file `rules/comedy.md` so both files feel like members of
   the same module.
3. Register the file in `module.json` so the Filmbuff CLI lists it.
4. Keep the refactored output **≤ 5,100 tokens**.

## Required Document Structure

Emit the file in this exact order. Match heading levels literally.

```
# Comedy Deep Dive

**Category**: Screenplay Genre — Deep Reference
**Type**: Extended / Companion to `comedy.md`
**Complexity**: High
**Module**: `writing-standards/screenplay/genres/comedy`
**Version**: 1.1.0
**Last Updated**: <YYYY-MM-DD of edit>

## Overview
## Core Concept
## Table of Contents
## Comedy Fundamentals & Philosophy
## Comedy Structure & Architecture
## How to Write a Joke
## How to Land a Joke
## Why a Punchline Works (or Fails)
## Satire & Anti-Satire
## Slapstick & Physical Comedy
## Deadpan & Understatement
## Meta-Humor & Fourth-Wall Breaks
## Callbacks & Collaborative Humor
## Advanced & Hybrid Techniques
## Integration with Filmbuff Ecosystem
## Validation & Revision Checklists
## Resources

---

**Depth Coverage**: <percent>%
**Last Updated**: <YYYY-MM-DD>
**Version**: 1.1.0
```

## Formatting Rules (match `comedy.md`)

- Use `##` for top-level sections, `###` for rules/subtopics.
- For any concrete rule or technique, use this template:
  - **Description**: one-sentence definition.
  - **Why It Matters**: one sentence of rationale.
  - **Examples**:
    - ✅ **Good**: …
    - ❌ **Bad**: …
  - **Film Reference**: `Title (Year) — short note.`
- Use bullet lists over paragraphs where the source allows.
- Use fenced code blocks only for Fountain snippets or
  beat-sheet tables.
- Avoid smart quotes (`’`, `“`, `”`); use ASCII `'` and `"` so the
  file parses cleanly in tooling.
- Keep lines ≤ 100 columns where practical.

## Filmbuff Integration Requirements

1. **Frontmatter-equivalent metadata**: the bold key/value block at
   the top (shown above) is the module's convention — do not switch
   to YAML frontmatter.
2. **Cross-link to the sibling rule**: in the Overview, add:
   `See also: [comedy.md](./comedy.md) for the base rule set.`
3. **Integration section** must name the specific Filmbuff surfaces
   this file informs: Fountain linting, beat-sheet generation,
   character schema, cinematic style guide, and the
   `filmbuff show screenplay-genre-comedy` CLI output.
4. **Validation checklist** must be expressed as a GitHub-style task
   list (`- [ ]`) so agents can tick items during review.
5. Register the file under `contents.rules` in
   `filmbuff/writing-standards/screenplay/genres/comedy/module.json`:

   ```json
   "contents": {
     "rules": ["comedy.md", "COMEDY-DEEP-DIVE.md"]
   }
   ```

   Also bump `module.json` `version` to `1.1.0` and, if the added
   content increases module size materially, update
   `augment.characterCount` to the new rounded total.

## Content Rules

- Preserve every film example in the current file; you may trim
  the surrounding prose but keep the title, year, and the point
  being illustrated.
- Replace long narrative passages with the rule template above
  wherever the source is prescriptive.
- Convert the existing "Four Major Theories" list into four
  rule-template entries under **Comedy Fundamentals & Philosophy**.
- Keep the Benign Violation note but express it as one rule entry,
  not a nested sub-discussion.
- Remove redundant meta-text (e.g., marketing lines like
  "Production-Ready ... engine"); state capability through content,
  not promotion.

## Acceptance Criteria

- [ ] File path unchanged; content rewritten in place.
- [ ] Structure matches the skeleton above exactly.
- [ ] Every `###` rule uses the Description / Why It Matters /
      Examples / Film Reference template.
- [ ] Sibling cross-link to `comedy.md` present in Overview.
- [ ] `module.json` updated: `COMEDY-DEEP-DIVE.md` listed under
      `contents.rules`, version bumped to `1.1.0`.
- [ ] Output ≤ 4,500 tokens (measure the resulting `.md` only).
- [ ] No smart quotes; ASCII punctuation only.
- [ ] No content categories from the original file are dropped.
- [ ] `filmbuff show screenplay-genre-comedy` (if available) still
      resolves without error after changes.

## Out of Scope

- Do **not** create new directories, READMEs, or summary files.
- Do **not** move `COMEDY-DEEP-DIVE.md`.
- Do **not** modify `.augment/` files or other modules.
- Do **not** commit or push; stop after edits are on disk.

## Deliverables

1. Rewritten `COMEDY-DEEP-DIVE.md` at the path above.
2. Updated `module.json` (same directory's parent: `comedy/module.json`).
3. A short change summary printed to the chat listing: sections
   retained, sections restructured, token count of the final file,
   and the `module.json` diff.
