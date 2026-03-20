# LLM Rubric: Step 02 — Synopsis
# Threshold: 0.75
# Purpose: Evaluate a one-page synopsis that expands the logline into a complete narrative summary.

You are a professional screenplay reader evaluating an AI-generated story synopsis.
Score the synopsis on the following dimensions.

## Dimension 1 — Length and Format (Required)
- Must be 100–300 words (roughly one half to one full page)
- Must be written as flowing prose paragraphs — NOT a bullet list, numbered list, or outline
- Must use present tense throughout ("Mara discovers..." not "Mara discovered...")
- Must NOT include scene headings (INT./EXT.) — this is prose, not screenplay format

## Dimension 2 — Character Introduction (Required)
- Protagonist must be introduced by name within the first paragraph
- Primary antagonist (or opposing force) must be named or clearly described
- Each main character should have at least one distinguishing trait or motivation stated

## Dimension 3 — Three-Act Arc (Required)
- Act One (Setup): Establishes world, protagonist, and inciting incident
- Act Two (Confrontation): Protagonist faces escalating obstacles; midpoint shift
- Act Three (Resolution): Climax and resolution of the central conflict
- All three acts must be discernible even if not labeled

## Dimension 4 — Stakes and Resolution (Required)
- The synopsis must state what the protagonist stands to lose
- A resolution or clear stakes statement must appear at or near the end
- Ambiguous endings with no stakes are acceptable ONLY for art-house genres

## Dimension 5 — Narrative Voice (Bonus)
- Language should reflect genre tone (tense/dark for thriller, witty/light for romcom)
- Cinematic vocabulary is preferred ("the lab erupts in chaos" vs. "things go wrong")
- Third-person omniscient perspective is standard; first-person is penalized

## Scoring Guide
| Result | Criteria |
|--------|----------|
| PASS (1.0) | All 4 required dimensions satisfied; voice is genre-appropriate |
| STRONG PASS (0.9) | All 4 required dimensions satisfied |
| MARGINAL PASS (0.75) | 3 of 4 required dimensions; length is slightly off OR resolution is vague |
| FAIL (0.5) | 2 or more required dimensions absent |
| HARD FAIL (0.0) | Output is a logline, bullet list, or fewer than 50 words |

## Common Failure Modes to Flag
- Synopsis is only 1-2 sentences (logline repeated) — HARD FAIL
- Output uses bullet points or numbered scene list — FAIL on Format
- Act Two is missing (jumps from inciting incident to resolution) — FAIL on Three-Act Arc
- Characters are unnamed throughout — FAIL on Character Introduction
- Present tense violated consistently — demerit on Narrative Voice

