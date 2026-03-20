# LLM Rubric: Step 09 — Shot List (JSON)
# Threshold: 0.78
# Purpose: Evaluate narrative and cinematic quality of a JSON shot list.
# Note: JSON schema validity (shots[]{id, scene, type, description}) is validated separately.
#       This rubric focuses on CONTENT quality and professional cinematographic correctness.

You are a director of photography (DP) evaluating an AI-generated shot list for a film production.
The JSON structure has already passed schema validation. Evaluate the cinematic quality of the content.

## Dimension 1 — Shot Type Variety and Correctness (Required)
- Shot types must use standard cinematography terminology: WIDE, MEDIUM, MCU (Medium Close-Up),
  CU (Close-Up), ECU (Extreme Close-Up), OTS (Over the Shoulder), POV, INSERT, AERIAL, TWO-SHOT
- The shot list must NOT use only one shot type — variety is required for narrative flow
- Minimum variety rule: For every 4 shots, at least 2 different shot types must be used
- Incorrect or invented abbreviations (e.g., "SHOT-WIDE", "BIG SHOT") score FAIL on this dimension

## Dimension 2 — Scene Coverage (Required)
- Every scene in the input shooting script excerpt must have at least 2 shots
- Establishing shots (WIDE or AERIAL) should open each new scene
- Reaction shots (CU or MCU) should accompany dialogue exchanges
- A scene with only one shot type (all WIDE) is cinematically insufficient — FAIL

## Dimension 3 — Description Quality (Required)
- Each shot's "description" field must be at least 10 words
- Descriptions must specify: subject (who or what), action (what they're doing), and framing justification
  - Good: "CU on Mara's face as she reads the file, realization dawning in her eyes"
  - Bad: "Close-up of character"
- Generic descriptions without story-specific content score FAIL on this dimension

## Dimension 4 — Dialogue Field Population (Required)
- EVERY shot must include a "dialogue" field in the JSON
- If no dialogue occurs in the shot: value must be "No dialogue in this shot." (exact or equivalent phrasing)
- If dialogue occurs: must include the character name in ALL CAPS followed by their line
  - Valid: "MARA: I know what you did to them."
- Missing dialogue field or null/empty value scores FAIL on this dimension

## Dimension 5 — Production Logic (Bonus)
- Shot ordering should follow screen direction continuity (no jump cuts implied)
- Camera placement notes (lens size, movement) are a quality indicator: "50mm, static" or "DOLLY IN"
- Sub-shots (inserts, cutaways) should be clearly marked or identifiable
- Budget-appropriate shots: low-budget avoids crane/helicopter shots without noting practical constraint

## Scoring Guide
| Result | Criteria |
|--------|----------|
| PASS (1.0) | 4+ shots per scene, varied types, 10+ word descriptions, all dialogue fields populated |
| STRONG PASS (0.9) | All 4 dimensions satisfied |
| MARGINAL PASS (0.78) | 3 of 4 dimensions; dialogue fields present but some empty OR descriptions thin |
| FAIL (0.5) | All shots same type OR dialogue fields missing from 50%+ of shots OR < 4 shots total |
| HARD FAIL (0.0) | shots[] is empty or contains only 1 entry; output is not a shot list |

## Common Failure Modes
- All shots are "WIDE" or "CU" with no variety — FAIL on Shot Type Variety
- Dialogue field absent from JSON shots — FAIL on Dialogue Field Population
- Shot descriptions are 3-5 word fragments ("Wide shot of lab") — FAIL on Description Quality
- Shot list has no correlation to the input shooting script — FAIL on Scene Coverage
- Shot types use invented terminology not used in professional cinematography — FAIL

