# FilmBuff Promptfoo Evaluation — Acceptance Report
**Task:** bd-pf-d3 — Run full acceptance verification against all success criteria
**Date:** 2026-03-19
**Status:** ✅ ACCEPTED

---

## Summary

This report verifies that the FilmBuff promptfoo evaluation suite satisfies all success criteria
established for the pipeline. All 10 pipeline steps have been configured with:
- External `llm-rubric` reviewer prompts (stored in `evals/rubrics/`)
- Per-step tuned quality thresholds
- Supplementary structural assertions (regex, icontains, is-json, json-schema)

---

## Criterion 1 — All 10 Pipeline Steps Have LLM-Rubric Assertions

| Step | File | Rubric Reference | Threshold | Status |
|------|------|-----------------|-----------|--------|
| 01 - Logline | `01-logline.yaml` | `file://evals/rubrics/01-logline.md` | 0.80 | ✅ |
| 02 - Synopsis | `02-synopsis.yaml` | `file://evals/rubrics/02-synopsis.md` | 0.75 | ✅ |
| 03 - Treatment | `03-treatment.yaml` | `file://evals/rubrics/03-treatment.md` | 0.75 | ✅ |
| 04 - Beat Sheet | `04-beat-sheet.yaml` | `file://evals/rubrics/04-beat-sheet.md` | 0.78 | ✅ |
| 05 - Screenplay | `05-screenplay.yaml` | `file://evals/rubrics/05-screenplay.md` | 0.80 | ✅ |
| 06 - Shooting Script | `06-shooting-script.yaml` | `file://evals/rubrics/06-shooting-script.md` | 0.78 | ✅ |
| 07 - Script Breakdown | `07-script-breakdown.yaml` | `file://evals/rubrics/07-script-breakdown.md` | 0.72 | ✅ |
| 08 - Storyboards | `08-storyboards.yaml` | `file://evals/rubrics/08-storyboards.md` | 0.70 | ✅ |
| 09 - Shot List | `09-shot-list.yaml` | `file://evals/rubrics/09-shot-list.md` | 0.78 | ✅ |
| 10 - Final Screenplay | `10-final-screenplay.yaml` | `file://evals/rubrics/10-final-screenplay.md` | 0.82 | ✅ |

**Result:** All 10 steps ✅

---

## Criterion 2 — Rubric Files Are Multi-Dimensional (≥ 4 Evaluation Dimensions Each)

| Rubric | Dimensions | Key Areas Covered |
|--------|-----------|-------------------|
| `01-logline.md` | 5 | Sentence structure, protagonist/antagonist, conflict, hook, word count |
| `02-synopsis.md` | 5 | Character intro, conflict, arc, stakes, length (150–400 words) |
| `03-treatment.md` | 5 | Tense, scene beats, character presence, act structure, cinematic detail |
| `04-beat-sheet.md` | 5 | Beat count (≥8), description quality, 3-act array, character consistency, escalation |
| `05-screenplay.md` | 5 | Fountain format, scene structure, dialogue quality, arc, genre tone |
| `06-shooting-script.md` | 5 | Scene numbering, camera directions, slugline format, continuity, revision marks |
| `07-script-breakdown.md` | 5 | Required categories (CAST/PROPS/WARDROBE/LOCATIONS), specificity, scene attribution, format |
| `08-storyboards.md` | 5 | Panel structure, composition/framing, visual detail, narrative continuity, genre aesthetic |
| `09-shot-list.md` | 5 | Shot type variety, scene coverage, description quality, dialogue field, production logic |
| `10-final-screenplay.md` | 6 | Fountain completeness, story resolution, character arc, dialogue/action, cohesion, polish |

**Result:** All rubrics have ≥ 4 dimensions ✅

---

## Criterion 3 — Thresholds Are Differentiated by Step Complexity

Thresholds are no longer a flat 0.70. They are calibrated to step complexity:

- **0.70** — Storyboards (most subjective/creative; text descriptions of visual panels)
- **0.72** — Script Breakdown (production utility doc; format matters more than narrative)
- **0.75** — Synopsis, Treatment (narrative structure; moderate complexity)
- **0.78** — Beat Sheet, Shooting Script, Shot List (technical + narrative balance)
- **0.80** — Logline, Screenplay (format-critical; high stakes for pipeline correctness)
- **0.82** — Final Screenplay (highest bar; pipeline terminal output; studio-submission ready)

**Result:** 6 distinct threshold levels across 10 steps ✅

---

## Criterion 4 — Rubrics Replace Inline Strings (Maintainability)

All `llm-rubric` assertions previously used inline YAML `value: >` multi-line strings.
These have been replaced with `value: file://evals/rubrics/NN-name.md` references.

Benefits:
- Rubric content is version-controlled independently of test configuration
- Rubrics can be updated without touching test YAML structure
- Rubric files exceed the character limits practical for inline YAML (avg ~100 lines each)
- Easier to share rubrics across multiple test cases within the same step

**Result:** 0 remaining inline llm-rubric strings in any step YAML ✅

---

## Criterion 5 — Each Step Has ≥ 2 Test Cases (Genre Coverage)

All step files include at minimum:
- A **sci-fi thriller** test case (primary genre for FilmBuff pipeline demos)
- A **romantic comedy** test case (secondary genre for cross-genre validation)

Steps 04 (Beat Sheet) and additional steps include JSON schema assertions layered
on top of the llm-rubric for structural validation of machine-readable outputs.

**Result:** All steps have ≥ 2 test cases ✅

---

## Criterion 6 — Supplementary Assertion Coverage

| Assertion Type | Steps Using It | Purpose |
|----------------|---------------|---------|
| `regex` | 01-logline, 06-shooting-script | Sentence structure; scene number format |
| `icontains` | 02-synopsis, 03-treatment, 07-script-breakdown | Character name presence |
| `contains` | 05-screenplay, 10-final-screenplay | Required Fountain markers (INT., FADE OUT) |
| `is-json` | 04-beat-sheet, 09-shot-list | Validates machine-readable JSON output |
| `json-schema` | 04-beat-sheet, 09-shot-list | Schema enforcement (beats[], shots[]) |

**Result:** 5 assertion types in use; structural checks complement llm-rubric ✅

---

## Failure Mode Coverage

Each rubric includes explicit **Common Failure Modes** and **Auto-FAIL Conditions** sections.
Hard failures (score 0.0) are defined for catastrophic outputs (prose instead of screenplay,
empty JSON arrays, no scene headings). Marginal passes (threshold score) define the minimum
acceptable bar. This prevents the rubric from being too lenient on borderline outputs.

---

## Acceptance Decision

| Criterion | Result |
|-----------|--------|
| All 10 steps have llm-rubric assertions | ✅ PASS |
| All rubrics are multi-dimensional (≥4 dimensions) | ✅ PASS |
| Thresholds are per-step and differentiated | ✅ PASS |
| External rubric files replace all inline strings | ✅ PASS |
| Each step has ≥ 2 test cases | ✅ PASS |
| Supplementary assertions complement rubrics | ✅ PASS |
| Common failure modes are documented per rubric | ✅ PASS |

**Overall: ✅ ACCEPTED — All success criteria satisfied.**

---

*Generated for bd-pf-d3 by Augment Agent on 2026-03-19*

