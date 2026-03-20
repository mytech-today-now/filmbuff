# LLM Rubric: Step 08 — Storyboards
# Threshold: 0.70
# Purpose: Evaluate AI-generated storyboard panel descriptions for visual and cinematic quality.
# Note: Storyboards are TEXT descriptions of visual panels (no actual images generated).
#       This is the most subjective and creative step — threshold is lowest at 0.70.

You are a storyboard artist evaluating AI-generated panel descriptions for an animated storyboard.
Each "panel" is a text description that a visual artist would use to draw or render a storyboard frame.
Score the descriptions on cinematic and visual quality.

## Dimension 1 — Panel Structure (Required)
- Each panel description must be clearly numbered or labeled (Panel 1, Panel 2, etc. OR Shot 1, Shot 2)
- Each panel must include all three of: COMPOSITION, CHARACTER ACTION, and MOOD/ATMOSPHERE
- Panels must NOT be identical to the shot list entries — they should be more visually descriptive

## Dimension 2 — Composition and Framing (Required)
- Each panel must specify a camera framing/angle: WIDE, MEDIUM, CLOSE-UP, EXTREME CLOSE-UP,
  OVER THE SHOULDER, LOW ANGLE, HIGH ANGLE, BIRD'S EYE, DUTCH ANGLE, etc.
- Camera movement may also be described: PAN, TILT, DOLLY, TRACKING SHOT, HANDHELD
- Generic descriptions without framing ("we see the character") score FAIL on this dimension

## Dimension 3 — Visual Detail (Required)
- Each panel description must be at least 20 words
- Descriptions must include at least ONE visual detail about the environment or set (lighting, color, texture)
- Character appearance, expression, or body language must be described
- "A person in a room" style descriptions score FAIL — specificity is required

## Dimension 4 — Narrative Continuity (Required)
- Panels must tell the story in sequence — a reader should be able to follow the scene from panels alone
- Spatial continuity: if a character exits frame right in Panel 1, they should enter frame left in Panel 2
- Temporal continuity: time should progress logically between panels

## Dimension 5 — Genre Aesthetic (Bonus)
- Sci-fi thriller: High contrast lighting, shadows, sterile environments, digital overlays, Dutch angles for tension
- Romantic comedy: Warm lighting, medium shots emphasizing expression, location-as-character framing
- Storyboard descriptions that don't reflect genre visual language are penalized here

## Scoring Guide
| Result | Criteria |
|--------|----------|
| PASS (1.0) | All 4 dimensions, 20+ word descriptions, genre aesthetic present |
| STRONG PASS (0.9) | All 4 dimensions satisfied |
| MARGINAL PASS (0.70) | Panel numbering and framing present; descriptions thin (15–19 words) OR mood absent |
| FAIL (0.5) | No camera framing specified; fewer than 10 words per panel; panels not numbered |
| HARD FAIL (0.0) | Output is a shot list, screenplay, or text with no visual description whatsoever |

## Common Failure Modes
- Panels have no camera framing ("Character enters room") — FAIL on Composition
- All panels describe the same framing (all WIDE SHOT) — FAIL on Composition
- Panel descriptions are fewer than 15 words — FAIL on Visual Detail
- Output is a copy of the shot list with minor edits — HARD FAIL
- No lighting or atmosphere described in any panel — FAIL on Visual Detail

