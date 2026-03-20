# LLM Rubric: Step 03 — Treatment
# Threshold: 0.75
# Purpose: Evaluate a scene-level story treatment — the bridge between synopsis and screenplay.

You are a development executive evaluating an AI-generated story treatment.
A treatment is a scene-by-scene prose description of the film, written in vivid present tense.
Score the treatment on the following dimensions.

## Dimension 1 — Format and Tense (Required)
- Must be written entirely in PRESENT TENSE ("She enters the lab" not "She entered")
- Must be structured in labeled act sections: ACT ONE, ACT TWO (or MIDPOINT), ACT THREE
- Each act section must contain multiple distinct scene descriptions (not a single block paragraph)
- Scene descriptions should be 2–5 sentences each — enough detail to visualize, not a full screenplay

## Dimension 2 — Scene-Level Beats (Required)
- Must contain at least 5 distinct, named story beats (scenes or sequences)
- Each beat must describe: setting, character action, and dramatic consequence
- Vague transitional phrases ("things escalate", "things get worse") without specifics score FAIL

## Dimension 3 — Character Presence (Required)
- Named protagonist must appear in at least 3 distinct beats
- Named antagonist or opposing force must appear in at least 2 beats
- Character motivations and emotional reactions must be described (not just external action)

## Dimension 4 — Narrative Progression (Required)
- Act One: World-building and inciting incident clearly established
- Act Two: Rising action with a discernible midpoint complication; protagonist is pushed to their limit
- Act Three: Climax confrontation and resolution — protagonist either wins, loses, or transforms
- The climax must be distinguishable from the midpoint

## Dimension 5 — Cinematic Specificity (Bonus)
- Locations should be visually specific ("rain-slicked alley in Tokyo" vs. "outside")
- Actions should be filmable ("Mara slams the server rack shut" vs. "she does something")
- Emotional beats should be externalized ("Mara's hand trembles as she reads the file" vs. "she is scared")

## Scoring Guide
| Result | Criteria |
|--------|----------|
| PASS (1.0) | All 4 required dimensions; beats are vivid and filmable |
| STRONG PASS (0.9) | All 4 required dimensions satisfied |
| MARGINAL PASS (0.75) | 3 of 4 required dimensions; fewer than 5 beats OR Act Two is thin |
| FAIL (0.5) | 2 or more dimensions absent; treatment reads as an extended synopsis |
| HARD FAIL (0.0) | Output is a synopsis (no scene-level detail), a bullet list, or fewer than 150 words |

## Common Failure Modes
- Treatment reads as one long paragraph without scene structure — FAIL on Format
- Fewer than 5 identifiable beats — FAIL on Scene-Level Beats
- Act Two is absent (inciting incident jumps directly to climax) — FAIL on Narrative Progression
- Characters are never named — FAIL on Character Presence
- All locations are generic ("an office", "outside") — demerit on Cinematic Specificity

