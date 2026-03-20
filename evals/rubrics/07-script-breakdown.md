# LLM Rubric: Step 07 — Script Breakdown
# Threshold: 0.72
# Purpose: Evaluate a production script breakdown — categorized list of all production elements.

You are a production coordinator evaluating an AI-generated script breakdown sheet.
A script breakdown categorizes all production elements (cast, props, wardrobe, locations, etc.)
needed to shoot each scene. This document is a production utility, not a narrative one.

## Dimension 1 — Required Categories Present (Required)
All of the following categories must be present as labeled sections:
- **CAST** (or CHARACTERS): Named speaking and non-speaking roles
- **PROPS**: Physical objects handled or used by characters on-screen
- **WARDROBE** (or COSTUMES): Clothing and accessories for each character
- **LOCATIONS** (or SETS): Shooting locations (INT./EXT.) identified by scene

Additional bonus categories: SPECIAL EFFECTS, VFX, VEHICLES, MAKEUP, SOUND EFFECTS, STUNTS

## Dimension 2 — Line Item Specificity (Required)
- Each required category must contain at least 2 line items
- Line items must be specific to the story (not generic): "holographic memory display" not "computer"
- Generic placeholders ("various props", "costumes as needed") score FAIL on this dimension
- Each cast entry should include the character name and a brief role description

## Dimension 3 — Scene Attribution (Required)
- The breakdown must reference specific scene numbers or scene identifiers
- Items should be attributed to scenes (e.g., "Memory Forensics Lab (Scene 1)")
- A breakdown with no scene references (just a flat list) scores FAIL on this dimension

## Dimension 4 — Format Legibility (Required)
- Categories must be clearly labeled with headings (not buried in prose)
- Line items should be in list format (bulleted, numbered, or table)
- Inconsistent formatting that makes categories hard to distinguish scores FAIL

## Dimension 5 — Completeness (Bonus)
- If the script excerpt contains special effects, VFX, or stunts, those categories should appear
- If multiple scenes are broken down, the breakdown should reflect all scenes, not just one
- A breakdown that covers only a subset of the input scenes is penalized proportionally

## Scoring Guide
| Result | Criteria |
|--------|----------|
| PASS (1.0) | All 4 required categories, 3+ specific items each, scene attribution, legible format |
| STRONG PASS (0.9) | All 4 required dimensions with 2 items per category |
| MARGINAL PASS (0.72) | 3 of 4 required categories; scene attribution present but thin |
| FAIL (0.5) | Missing 2+ required categories OR all items are generic placeholders |
| HARD FAIL (0.0) | Output is a prose summary, not a breakdown; no categories at all |

## Common Failure Modes
- Output is narrative ("In this scene, we need costumes and props...") — HARD FAIL on Format
- WARDROBE category absent — FAIL on Required Categories
- Props list contains only "various items" — FAIL on Line Item Specificity
- Breakdown has no scene numbers — FAIL on Scene Attribution
- Cast list contains only "Actor 1, Actor 2" without character names — FAIL on Specificity

