# LLM Rubric: Step 05 — Screenplay
# Threshold: 0.80
# Purpose: Evaluate Fountain-format screenplay excerpt for format correctness and narrative quality.

You are a professional script reader (coverage analyst) evaluating an AI-generated screenplay excerpt.
This is the most format-critical rubric in the pipeline. Both format AND content must pass.

## Dimension 1 — Fountain Format (Required — Highest Weight)
- Scene headings (sluglines) must be in ALL CAPS: INT. or EXT., LOCATION, TIME OF DAY
  - Valid: "INT. MEMORY FORENSICS LAB - NIGHT"
  - Invalid: "Interior. Memory lab - night" or "int. memory forensics lab"
- Action lines must NOT be in ALL CAPS (action is sentence-case prose)
- Character names before dialogue must be in ALL CAPS and centered (or on their own line)
- Parentheticals (beat directions) must appear between character name and dialogue line
- Dialogue must appear immediately after the character name (no extra blank lines)
- Transitions (CUT TO:, FADE IN:, FADE OUT:) must be in ALL CAPS and right-aligned or on their own line

## Dimension 2 — Scene Structure (Required)
- Must contain at least 2 distinct scene headings (INT. or EXT.) — excerpts must still show scene changes
- Each scene must have at least one action line describing setting or character action
- Scenes must progress logically — time and space must be coherent between consecutive scenes

## Dimension 3 — Dialogue Quality (Required)
- Must contain at least ONE dialogue exchange between TWO named characters
- Each character's dialogue should reflect their established personality/genre voice
- Dialogue must NOT be expository ("As you know, Bob..." style) without dramatic motivation
- Monologues with no response are acceptable IF the scene context justifies them

## Dimension 4 — Three-Act Progression (Required for full-length excerpts)
- For excerpts (< 5 scenes): must demonstrate movement along the story arc (not static)
- For longer outputs (5+ scenes): must show clear act structure with inciting incident + rising action + climax
- Static scenes (nothing changes between start and end) score FAIL on this dimension

## Dimension 5 — Genre and Tone (Bonus)
- Sci-fi thriller: Action lines should create tension; pacing should be brisk; dialogue terse
- Romantic comedy: Dialogue should be witty; physical comedy should be apparent in action lines
- Tone inconsistency (thriller treated like comedy or vice versa) is flagged but not auto-FAIL

## Scoring Guide
| Result | Criteria |
|--------|----------|
| PASS (1.0) | Perfect Fountain format, 2+ scenes, dialogue exchange, arc movement |
| STRONG PASS (0.9) | All 4 required dimensions; minor format deviations (1-2 lowercase sluglines) |
| MARGINAL PASS (0.80) | Fountain mostly correct; 1 major format error OR dialogue is present but weak |
| FAIL (0.5) | Multiple format errors; no dialogue; or no scene headings |
| HARD FAIL (0.0) | Output is prose/paragraph, not screenplay format; no INT./EXT. headings at all |

## Critical Format Rules (Auto-FAIL if ALL of these are violated)
- No INT. or EXT. anywhere in the output
- All text is in ALL CAPS (action lines should NOT be all caps)
- No character names before dialogue (dialogue with no speaker attribution)
- Output is a numbered list or bullet points

