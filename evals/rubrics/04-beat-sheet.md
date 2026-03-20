# LLM Rubric: Step 04 — Beat Sheet (JSON)
# Threshold: 0.78
# Purpose: Evaluate the narrative content quality of a structured JSON beat sheet.
# Note: JSON schema validity is checked separately via is-json + json-schema assertions.
#       This rubric focuses on CONTENT quality, NOT structural validity.

You are a story consultant evaluating the narrative quality of a JSON beat sheet produced by an AI system.
The JSON structure has already passed schema validation. Focus entirely on whether the content is meaningful.

## Dimension 1 — Beat Count and Coverage (Required)
- Must contain at least 8 distinct beats in the beats[] array
- Beats must cover the full story arc: setup → inciting incident → rising action →
  midpoint → crisis → climax → falling action → resolution
- Missing a climax beat or resolution beat is an automatic FAIL on this dimension

## Dimension 2 — Beat Description Quality (Required)
- Each beat's "description" field must be at least 15 words
- Each description must state: what happens, to whom, and what the dramatic consequence is
- Placeholder or filler descriptions ("This is where the midpoint happens") score FAIL
- All descriptions must be in present tense

## Dimension 3 — Three-Act Structure in Acts Array (Required)
- The acts[] array must contain 2–3 entries (Act One, Act Two, Act Three OR Act Two A/B)
- Each act must have a non-trivial description (not just "Act One" with no detail)
- Act numbers must be sequential and non-repeating

## Dimension 4 — Character and Story Consistency (Required)
- Protagonist must be named in at least 3 beat descriptions
- Antagonist or opposing force must appear in at least 2 beat descriptions
- Beat descriptions must be internally consistent (character cannot be in two mutually exclusive places simultaneously)
- Genre tone must be reflected (thriller beats should feel tense; romcom beats should feel light)

## Dimension 5 — Narrative Escalation (Bonus)
- Stakes should increase between beats: early beats are low-stakes; climax beat is highest-stakes
- Midpoint beat should represent a significant shift in protagonist's understanding or situation
- Resolution beat should feel earned relative to the escalation

## Scoring Guide
| Result | Criteria |
|--------|----------|
| PASS (1.0) | 8+ beats, all 4 dimensions satisfied, clear escalation |
| STRONG PASS (0.9) | All 4 dimensions satisfied |
| MARGINAL PASS (0.78) | 3 of 4 dimensions; 7 beats OR descriptions are thin but present |
| FAIL (0.5) | Fewer than 6 beats, OR climax/resolution missing, OR descriptions < 10 words each |
| HARD FAIL (0.0) | beats[] is empty, a single beat, or all descriptions are identical/placeholder |

## Common Failure Modes
- beats[] has 3–4 generic beats (setup, conflict, climax, end) — FAIL on Beat Count
- Descriptions are 5-word summaries without dramatic consequence — FAIL on Description Quality
- acts[] has only 1 entry — FAIL on Three-Act Structure
- Protagonist never named in any beat — FAIL on Character Consistency
- Beat descriptions are identical across genre variations (romcom == thriller beats) — FAIL on Genre Tone

