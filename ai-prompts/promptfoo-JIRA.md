# JIRA Ticket: FB-0043 - Apply Promptfoo Evaluation Framework to the 10-Step Screenplay Pipeline

### Summary
Integrate [Promptfoo](https://promptfoo.dev) as the automated prompt evaluation layer for every step of the FilmBuff screenplay generation pipeline. Implement per-step `promptfooconfig.yaml` files covering four concrete use cases: **prompt regression testing** (ensure logline/synopsis/treatment prompts still produce quality output after edits), **model comparison** (run the same screenplay prompt against `gpt-5.2`, `claude-sonnet-4-6`, and `gemini-3.1-pro` side-by-side), **provider switching validation** (confirm that changing the active provider via the `configurable-ai-providers` abstraction does not degrade output quality), and **assertion coverage** (`contains` for required story elements, `llm-rubric` for narrative quality, `is-json` for beat-sheet and shot-list steps). All evaluation configs live under `evals/` at the repository root and are runnable via `npm run eval` or `npx promptfoo eval`.

---

### Description

#### Background

FilmBuff's 10-step screenplay pipeline (`filmbuff start → continue → complete`) uses AI generation at every step to produce logline, synopsis, treatment, beat sheet, screenplay, shooting script, script breakdown, storyboards, shot list, and final screenplay documents. Each step builds on all prior accepted documents, and every generation call is routed through the configurable AI provider abstraction (`resolveActiveProvider` / `resolveProviderByProfile` in `cli/src/utils/runtime-resolver.ts`).

There is currently no systematic way to:
- Verify that editing a generation prompt does not silently degrade output quality.
- Compare how GPT-5.2, Claude Sonnet 4.6, and Gemini 3.1 Pro respond to identical screenplay prompts.
- Confirm that switching the active provider (e.g. from OpenAI to Anthropic) produces acceptable output without manual spot-checking.
- Assert structural correctness on machine-readable steps (beat-sheet.json, shot-list.json).

Promptfoo solves all four problems. It runs a matrix of prompts × providers × test cases, evaluates each output against typed assertions, and produces a pass/fail report. It integrates cleanly with the `.env`-based API key configuration already in place (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) and supports `llm-rubric` assertions that use an AI judge to evaluate narrative quality without hard-coding expected text.

The `getting-started/` directory already contains a minimal Promptfoo example (`promptfooconfig.yaml`) that demonstrates the config schema and assertion syntax. This ticket extends that foundation into a full evaluation suite for all 10 pipeline steps.

---

#### Evaluation Suite Structure

```
evals/
  promptfooconfig.yaml                   # Root config: shared providers, env, default thresholds
  steps/
    01-logline.yaml                      # Logline regression + model comparison
    02-synopsis.yaml
    03-treatment.yaml
    04-beat-sheet.yaml                   # is-json + json-schema assertions
    05-screenplay.yaml                   # contains (fountain format) + llm-rubric
    06-shooting-script.yaml
    07-script-breakdown.yaml
    08-storyboards.yaml
    09-shot-list.yaml                    # is-json + json-schema assertions
    10-final-screenplay.yaml
  suites/
    regression.yaml                      # All 10 steps, single provider, run on prompt edits
    model-comparison.yaml                # All 10 steps × 3 providers side-by-side
    provider-switching.yaml              # Active-provider swap validation
cli/src/prompts/                         # Prompt templates extracted from command handlers
  logline.txt
  synopsis.txt
  treatment.txt
  beat-sheet.txt
  screenplay.txt
  shooting-script.txt
  script-breakdown.txt
  storyboards.txt
  shot-list.txt
  final-screenplay.txt
```

---

#### Key Requirements

**1 — Prompt Template Extraction**

Each generation step's system and user prompt must be extracted from the command handler into a standalone text file under `cli/src/prompts/`. Promptfoo loads prompts from files using `file://cli/src/prompts/<step>.txt`. Prompt files use `{{variable_name}}` syntax for dynamic values (genre, tone, prior document content). The extraction must not change observable CLI behavior; command handlers continue to read from `cli/src/prompts/` at runtime.

**2 — Per-Step Promptfoo Config (10 files)**

Each `evals/steps/<N>-<step>.yaml` file defines:

| Field | Value |
|---|---|
| `description` | Step name and pipeline position |
| `prompts` | `file://cli/src/prompts/<step>.txt` |
| `providers` | At minimum `openai:gpt-5.2` for regression; all three for model comparison |
| `tests` | Two or more test cases covering different genre/tone/budget combinations |
| `assert` | Typed assertions appropriate to the step (see Assertion Types below) |

**3 — Assertion Types by Step**

| Step | Assertion Types | Rationale |
|---|---|---|
| `logline` | `llm-rubric`: single sentence, conflict present, hook present | Narrative quality requires AI judgment |
| `synopsis` | `llm-rubric`: covers protagonist, antagonist, arc; `contains`: genre keyword | Structural completeness |
| `treatment` | `llm-rubric`: scene-level detail, tone consistent; `icontains`: character names from logline | Cross-step consistency |
| `beat-sheet` | `is-json`; `json-schema`: requires `acts[]`, `beats[]` arrays with required fields | Machine-readable output must be structurally valid |
| `screenplay` | `contains`: `INT.` or `EXT.` (Fountain scene headings); `llm-rubric`: dialogue present, three-act structure | Format correctness + narrative quality |
| `shooting-script` | `contains`: scene numbers (`A1`, `1`, etc.); `llm-rubric`: technical notes present | Production-format correctness |
| `script-breakdown` | `llm-rubric`: locations, cast, props sections present; `icontains`: at least one location from screenplay | Element completeness |
| `storyboards` | `llm-rubric`: shot descriptions reference scene headings from shooting-script | Cross-document reference |
| `shot-list` | `is-json`; `json-schema`: requires `shots[]` with `id`, `scene`, `type`, `description` fields | Machine-readable format correctness |
| `final-screenplay` | `llm-rubric`: incorporates all accepted prior document elements; `contains`: `FADE OUT` | Completeness and format |

**4 — Model Comparison Suite**

`evals/suites/model-comparison.yaml` runs all 10 step configs simultaneously against three providers:

```yaml
providers:
  - openai:gpt-5.2
  - anthropic:messages:claude-sonnet-4-6
  - google:gemini-3.1-pro-preview
```

Each provider's output is evaluated against the same assertions. The Promptfoo HTML report (`promptfoo eval --output evals/results/model-comparison.html`) shows a side-by-side matrix of pass/fail rates per provider per step, making provider selection decisions data-driven.

**5 — Provider Switching Validation Suite**

`evals/suites/provider-switching.yaml` validates the configurable AI provider abstraction (described in `ai-prompts/ai-providers-JIRA.md`). It runs a representative subset of steps (logline, treatment, beat-sheet, screenplay) against each provider independently. All outputs must meet the same `llm-rubric` and structural thresholds. A provider switch is considered non-degrading if all assertions pass at the same rate as the baseline (OpenAI) run. This suite is intended to gate the `configurable-ai-providers` change before activating a new default provider.

**6 — Regression Suite**

`evals/suites/regression.yaml` runs all 10 step configs against `openai:gpt-5.2` only. It is fast (single provider), deterministic (fixed `temperature: 0`), and designed to be run on every edit to a prompt file in `cli/src/prompts/`. CI failure on this suite indicates a regression in prompt quality or format correctness.

**7 — npm Script and CI Integration**

Add the following scripts to the root `package.json`:

```json
"eval": "promptfoo eval --config evals/promptfooconfig.yaml",
"eval:regression": "promptfoo eval --config evals/suites/regression.yaml",
"eval:compare": "promptfoo eval --config evals/suites/model-comparison.yaml --output evals/results/model-comparison.html",
"eval:switching": "promptfoo eval --config evals/suites/provider-switching.yaml"
```

`npm run eval:regression` must be runnable in CI with only `OPENAI_API_KEY` set. The comparison and switching suites require all three provider keys and are intended for manual or pre-release runs.

**8 — Environment and Secret Handling**

All API keys are read from `.env` (already gitignored) via the `env:` block in the root `evals/promptfooconfig.yaml`. No keys are hardcoded in any eval config file. The Promptfoo cache directory (`.promptfoo/`) is added to `.gitignore`.

**9 — Dependencies**

Promptfoo is installed as a dev dependency:
```bash
npm install --save-dev promptfoo
```
No runtime dependency is introduced. The `promptfoo` binary is invoked via `npx` in the npm scripts so teams without a global install can still run evals.

---

#### Files Changed

| File | Action | Reason |
|---|---|---|
| `evals/promptfooconfig.yaml` | **Create** | Root eval config: shared providers, env keys, default thresholds |
| `evals/steps/01-logline.yaml` … `10-final-screenplay.yaml` | **Create** (×10) | Per-step eval configs with prompts, providers, test cases, and assertions |
| `evals/suites/regression.yaml` | **Create** | Single-provider regression suite for CI |
| `evals/suites/model-comparison.yaml` | **Create** | Three-provider side-by-side comparison suite |
| `evals/suites/provider-switching.yaml` | **Create** | Provider swap validation suite |
| `cli/src/prompts/*.txt` | **Create** (×10) | Extracted prompt templates, one per pipeline step |
| `package.json` | **Modify** | Add `eval`, `eval:regression`, `eval:compare`, `eval:switching` npm scripts |
| `.gitignore` | **Modify** | Add `.promptfoo/` cache directory |
| `getting-started/promptfooconfig.yaml` | **No change** | Existing example preserved as-is |
| `cli/src/commands/` pipeline handlers | **Modify** | Update prompt loading to read from `cli/src/prompts/*.txt` at runtime |

#### Files Explicitly NOT Changed

| File | Reason |
|---|---|
| `cli/src/db/` | Promptfoo is a dev-time evaluation tool; no database interaction required |
| `cli/src/utils/runtime-resolver.ts` | Provider resolution is not invoked by Promptfoo; evals call providers directly |
| `getting-started/README.md` | Existing getting-started example is unchanged |

---

#### Edge Cases and Risk Notes

**Temperature and Determinism**: `llm-rubric` assertions use an AI judge, which introduces non-determinism. Regression suite configs set `temperature: 0` on all providers where supported to maximize reproducibility. `llm-rubric` thresholds are set at `0.7` (pass if judge score ≥ 0.7) to allow minor phrasing variation without failing.

**Context Variables**: Steps 2–10 depend on prior accepted document content. Promptfoo test cases supply representative prior-document content as `{{variable}}` values in each test case `vars:` block. This is a controlled approximation of the real pipeline context; it does not replace end-to-end integration tests.

**Fountain Format Assertions**: The `contains: 'INT.'` assertion is a coarse proxy for Fountain correctness. A future enhancement could add a custom Promptfoo assertion provider that parses the output with a Fountain library (`fountain-js`) and validates structure programmatically.

**Cost Control**: Model comparison and provider switching suites call three providers per test case. With two test cases per step × 10 steps × 3 providers, a full comparison run makes ~60 API calls. Token costs are bounded by `maxTokens: 1024` in all eval configs.

---

### Acceptance Criteria

- [ ] `cli/src/prompts/` contains one `.txt` prompt template per pipeline step (10 files).
- [ ] `evals/steps/` contains one `promptfooconfig.yaml` per pipeline step (10 files), each referencing its prompt via `file://`.
- [ ] `evals/suites/regression.yaml` runs against `openai:gpt-5.2` only and passes with `OPENAI_API_KEY` set.
- [ ] `evals/suites/model-comparison.yaml` runs against `gpt-5.2`, `claude-sonnet-4-6`, and `gemini-3.1-pro-preview` and produces an HTML report.
- [ ] `evals/suites/provider-switching.yaml` runs representative steps against each provider and all assertions pass.
- [ ] `beat-sheet` and `shot-list` step configs include `is-json` and `json-schema` assertions; an invalid JSON output fails the assertion.
- [ ] `logline`, `treatment`, `screenplay`, and `final-screenplay` step configs include `llm-rubric` assertions evaluated by an AI judge.
- [ ] `screenplay` step config includes a `contains` assertion for Fountain scene heading format (`INT.` or `EXT.`).
- [ ] `npm run eval:regression` exits 0 when all assertions pass and non-zero when any assertion fails.
- [ ] `.promptfoo/` is listed in `.gitignore`.
- [ ] No API keys appear in any committed eval config file.
- [ ] CLI command handlers load their prompt text from `cli/src/prompts/*.txt` at runtime; existing behavior is unchanged.
- [ ] `npx tsc --noEmit` from `cli/` reports zero errors after prompt-loading changes.
- [ ] `npx jest --no-coverage` from `cli/` passes all existing tests after prompt-loading changes.

---

### Estimated Effort

| Area | Hours |
|---|---|
| Prompt template extraction (10 steps × handler refactor) | 8 |
| Per-step eval configs (10 × yaml + test cases + assertions) | 10 |
| Regression suite + CI script integration | 3 |
| Model comparison suite + HTML report config | 3 |
| Provider switching validation suite | 3 |
| `llm-rubric` threshold tuning and reviewer prompt authoring | 4 |
| `json-schema` definitions for beat-sheet and shot-list | 2 |
| Documentation and README updates | 2 |
| **Total** | **35** |

---

### Attachments

- Promptfoo getting-started example: `getting-started/promptfooconfig.yaml`
- Getting-started README: `getting-started/README.md`
- Provider abstraction ticket: `ai-prompts/ai-providers-JIRA.md`
- Film pipeline ticket: `ai-prompts/film-docs-JIRA.md`
- Hybrid storage ticket (document_revisions): `ai-prompts/write-docs-prompt-JIRA.md`
- Runtime resolver: `cli/src/utils/runtime-resolver.ts`
- Pipeline command handlers: `cli/src/commands/complete.ts`, `cli/src/commands/continue.ts`
- Promptfoo documentation: https://promptfoo.dev/docs/getting-started
- Promptfoo assertion types reference: https://promptfoo.dev/docs/configuration/expected-outputs

