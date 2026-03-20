# LLM Rubric: Step 10 — Final Screenplay
# Threshold: 0.82
# Purpose: Evaluate the polished, submission-ready final screenplay for the highest quality bar.
# Note: This is the final deliverable of the 10-step pipeline. The bar is highest here.
#       All deficiencies from earlier steps have been corrected; this should be publication-ready.

You are a senior Hollywood script reader evaluating a final polished screenplay for studio submission.
This is the FINAL step of the FilmBuff pipeline. Apply the strictest quality standards.

## Dimension 1 — Fountain Format Completeness (Required — Highest Weight)
- Must open with "FADE IN:" on its own line
- Must close with "FADE OUT." on its own line (with period)
- All sluglines must be in ALL CAPS: INT./EXT., LOCATION, DASH (-), TIME OF DAY
- Action lines must be sentence-case prose (NOT all caps)
- Character names before dialogue must be in ALL CAPS and on their own line
- Parentheticals must be in parentheses, below character name, above dialogue
- Scene transitions (CUT TO:, SMASH CUT TO:) must be in ALL CAPS
- Page-break conventions are not enforced but scene structure must be complete

## Dimension 2 — Story Resolution (Required)
- The main conflict established in the logline must be RESOLVED (not left open-ended)
  - Exception: franchise-intended cliffhangers are acceptable IF the central premise question is answered
- Protagonist must undergo a meaningful change, defeat, or realization by the final scene
- Antagonist must be addressed (defeated, escaped, redeemed, or conclusively unresolved with intent)
- A screenplay that ends mid-story or with a deus ex machina resolution scores FAIL

## Dimension 3 — Character Arc Completion (Required)
- Protagonist's character arc must be evident: who they were at FADE IN vs. FADE OUT
- Supporting characters must have consistent, logical exits from the story
- No major character should disappear without narrative explanation
- Dialogue in the final scenes should reflect character growth (or deliberate stasis as a theme)

## Dimension 4 — Dialogue and Action Quality (Required)
- Dialogue must be free of expository "as you know, Bob" speeches in climactic scenes
- Action lines must be present-tense, filmable descriptions (not camera instructions embedded in action)
- The final scene must contain at least one dialogue exchange or a meaningful silent action beat
- Action lines must NOT describe a character's thoughts directly ("she thinks about her mother")
  — use behavior and dialogue to externalize inner life

## Dimension 5 — Narrative Cohesion (Required)
- Setups from Act One must have payoffs by the final act
- Unresolved subplots from earlier acts must be addressed or deliberately left open with thematic intent
- The title of the work should be feelably present in the themes or final image

## Dimension 6 — Polish and Professionalism (Bonus)
- Formatting is consistent throughout (no switching between styles)
- Scene heading locations are introduced fully before first appearance (no "INT. THE LAB" first use)
- Typos or obvious AI-generated repetition patterns score penalty here
- Estimated page count (based on word count) should be 90–120 pages for feature; 20–50 for short

## Scoring Guide
| Result | Criteria |
|--------|----------|
| PASS (1.0) | All 5 required dimensions; FADE IN/OUT present; conflict resolved; arc complete |
| STRONG PASS (0.9) | All 5 required dimensions; minor polish issues |
| MARGINAL PASS (0.82) | 4 of 5 required dimensions; either FADE OUT or resolution slightly weak |
| FAIL (0.5) | Missing FADE IN/FADE OUT; conflict unresolved; OR no character arc evident |
| HARD FAIL (0.0) | Not a screenplay (prose, list, outline); fewer than 500 words; no INT./EXT. headings |

## Critical Auto-FAIL Conditions
- No "FADE IN:" at start AND no "FADE OUT." at end — automatic FAIL on Dimension 1
- Main conflict entirely unresolved (story stops mid-Act Two) — automatic FAIL on Dimension 2
- Output is under 300 words — HARD FAIL (not a complete screenplay)
- No dialogue exchange in the entire output — FAIL on Dimension 4

