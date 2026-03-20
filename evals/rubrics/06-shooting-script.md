# LLM Rubric: Step 06 — Shooting Script
# Threshold: 0.78
# Purpose: Evaluate a shooting script — a numbered, camera-annotated version of the screenplay.

You are a first assistant director (1st AD) evaluating an AI-generated shooting script.
A shooting script differs from a screenplay by adding: scene numbers, camera directions, and
production-specific notes. Both format accuracy and production utility are evaluated.

## Dimension 1 — Scene Numbering (Required)
- Every scene heading must be preceded by a scene number (integer, sequential)
- Scene numbers must appear on both the left AND right of the slugline (standard format)
  - Valid: "1  INT. MEMORY FORENSICS LAB - NIGHT  1"
  - Acceptable: "1  INT. MEMORY FORENSICS LAB - NIGHT" (left side only is marginal)
  - Invalid: Scene headings with no numbers at all
- Scene numbers must be sequential — gaps are only acceptable if scenes were deleted (noted)

## Dimension 2 — Camera Directions (Required)
- At least ONE camera direction must appear per scene
- Valid camera directions include: WIDE SHOT, CLOSE ON, MEDIUM SHOT, CU (Close-Up),
  ECU, MCU, OTS (Over the Shoulder), POV, DOLLY IN, TRACK WITH, CRANE UP, etc.
- Camera directions must appear in ALL CAPS within or before action lines
- Generic action descriptions without camera language ("we see...", "the camera shows...")
  are NOT camera directions and score FAIL on this dimension

## Dimension 3 — Slugline Format (Required)
- All sluglines must be in ALL CAPS: INT./EXT., LOCATION, DASH, TIME OF DAY
- Slugline must follow this pattern: [INT.|EXT.] [LOCATION] - [TIME OF DAY]
- Missing time of day (DAY, NIGHT, DAWN, DUSK, etc.) in sluglines is a format violation

## Dimension 4 — Production Continuity (Required)
- Action lines must be written in present tense
- Character and location names must be consistent across scenes (no spelling variations)
- If a character exits a scene, they must not appear in the next consecutive scene without
  a scene change establishing their movement

## Dimension 5 — Revision Marks (Bonus)
- Professional shooting scripts include revision color markers (e.g., "BLUE REVISION 03/19/26")
- An asterisk (*) in the margin indicating changed lines is a bonus indicator of quality
- Absence of revision marks is acceptable (not penalized) but their presence indicates sophistication

## Scoring Guide
| Result | Criteria |
|--------|----------|
| PASS (1.0) | Sequential scene numbers, camera directions in each scene, valid sluglines, continuity intact |
| STRONG PASS (0.9) | All 4 required dimensions |
| MARGINAL PASS (0.78) | Scene numbers present, ≥1 camera direction total (not per scene), sluglines mostly correct |
| FAIL (0.5) | No scene numbers OR no camera directions at all |
| HARD FAIL (0.0) | Output is a plain screenplay without scene numbers or camera language; or a prose document |

## Common Failure Modes
- Output is identical to the screenplay with no scene numbers added — HARD FAIL
- Camera directions are lowercase or described in parenthetical-style ("slow pan to...") — FAIL on Camera
- Scene numbers are present but non-sequential (jumps from 1 to 5 without explanation) — FAIL on Numbering
- Sluglines missing time of day — violation of Slugline Format

