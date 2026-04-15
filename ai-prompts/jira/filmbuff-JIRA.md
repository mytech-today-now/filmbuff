# JIRA Ticket: FB-0042 — Per-Shot Video Generation Control for `filmbuff` CLI

---

## Summary

Extend the `filmbuff` CLI to support **per-shot, step-by-step AI video generation** with individual shot retry, approval, rejection ("weird" flagging), and final compilation. Replace the current all-or-nothing `filmbuff generate-video` batch behavior with a granular shot-level state machine, a new `filmbuff video` sub-command group, MCP tool server integration, and full AI agent / non-interactive operation mode.

---

## Issue Type
**Epic / Feature**

## Priority
**High**

## Component
`filmbuff` CLI — Video Generation Pipeline

## Labels
`cli`, `video-generation`, `ai-powered`, `state-machine`, `mcp`, `agent-mode`, `breaking-change`

## Affects Versions
`filmbuff` current release (pre-v2.0)

## Fix Version
`filmbuff` v2.0.0

---

## Background & Motivation

The current `filmbuff generate-video` command submits the entire `08-shot-list.jsonl` to the `ai-powered` library as a **single monolithic batch job**. This design creates three production-blocking problems:

### Problem 1 — No Individual Shot Control
When a single shot produces a broken, off-tone, or visually incoherent result, the only available recourse is to discard and re-run the **entire batch**. All credits spent on the correctly generated shots are wasted.

> **Example:** A 42-shot project finishes its batch run. Shot `s017` has the camera movement direction inverted — a push-in rendered as a pull-back. Fixing it currently requires re-running all 42 shots (potentially 210 credits) when only 5 credits are needed to regenerate `s017` alone.

### Problem 2 — No Incremental Review
Users cannot watch completed clips while later shots are still generating. The entire batch must reach 100% completion before any output is reviewable. For a 42-shot project generating at ~90 seconds per shot, that is a minimum 63-minute blind wait before a single frame can be inspected.

> **Example:** Shots `s001`–`s010` complete in the first 15 minutes of a batch run. The user must wait another 48 minutes before they can view `s001`, even though `s001.mp4` has been sitting on disk, ready for review, since minute 15.

### Problem 3 — No Approval Gate Before Compilation
`combined.mp4` is assembled from whatever the AI produced — there is no curation step. Any technically broken, content-policy-violating, or aesthetically unacceptable clip silently enters the final output.

> **Example:** Shot `s033` contains a distorted face due to a model hallucination. The batch finishes, `combined.mp4` is built, and the user discovers the defect only when watching the assembled film — at which point the entire pipeline must restart.

---

## Solution Overview

Introduce a **shot-level state machine** with an append-only status log (`08-video-status.jsonl`) and a new `filmbuff video` sub-command group. Each shot independently progresses through well-defined states. Users and AI agents can generate, review, approve, reject, and recompile individual shots without touching the rest of the project.

---

## Detailed Requirements

### REQ-1: Shot-Level State Machine

Each shot in `08-shot-list.jsonl` gains an independent lifecycle. Valid states and transitions:

```
pending ──► generating ──► complete ──► approved ──► (included in compile)
                │                           │
                ▼                           ▼
              failed                    rejected ("weird")
                │                           │
                └───────────────────────► pending  (re-queued for retry)
```

**State Definitions:**

| State | Description |
|-------|-------------|
| `pending` | Shot not yet submitted. Initial state after `filmbuff video init`. |
| `generating` | Submitted to AI provider; `provider_job_id` recorded; polling active. |
| `complete` | AI returned a successful clip; MP4 downloaded to `video/clips/`. Awaiting user review. |
| `approved` | User explicitly approved. Will be included in `combined.mp4`. |
| `rejected` | User flagged as "weird"/unusable. Reverts to `pending` automatically. Prior clip preserved. |
| `failed` | Provider returned an error (timeout, content policy, API error). Reverts to `pending`. |

**State Machine Rules:**

1. A shot may only be `generating` if a valid `provider_job_id` is recorded. No shot may be permanently stuck in `generating` — a configurable watchdog timeout (default: 10 minutes) automatically transitions timed-out generating shots to `failed`, then immediately to `pending`.

   > **Example:** `filmbuff video status` is run and detects `s022` has been in `generating` state for 14 minutes against a 10-minute timeout. The watchdog transitions it: `generating` → `failed` → `pending`. Output: `"[s022] ✗ Generation timed out after 10m. Shot reset to pending."`

2. `approved` is a terminal state unless explicitly re-opened via `filmbuff video reopen`.

   > **Example:** `s001` is approved. Running `filmbuff video generate --shot s001` without first calling `filmbuff video reopen --shot s001` exits with code `5` (`STATE_CONFLICT`): `"Shot s001 is already approved. Use 'filmbuff video reopen' to re-queue it."`

3. Only `approved` shots are included in `combined.mp4` when using the default `--include approved` compile mode.

4. Credits are charged per generation attempt. A shot generated, rejected, and retried costs credits twice. `credits_spent` is cumulative per shot across all attempts.

   > **Example:** Shot `s017` is generated once (5 credits), rejected, then retried (5 more credits). `08-video-status.jsonl` records `"credits_spent":10` for `s017`. The project summary shows `credits_spent` as 10 for that shot alone.

---

### REQ-2: New File — `08-video-status.jsonl`

Created by `filmbuff video init`. Append-only (last record per `shot_id` is authoritative, same pattern as `.beads/issues.jsonl`). Lives alongside `08-shot-list.jsonl` in the project root.

**Full Schema:**

```jsonl
{"shot_id":"s001","status":"pending","provider":null,"provider_job_id":null,"clip_path":null,"attempt_count":0,"rejection_reason":null,"approved_at":null,"rejected_at":null,"generated_at":null,"failed_at":null,"credits_spent":0,"updated_at":"2026-04-15T10:00:00Z"}
```

**Field Definitions:**

| Field | Type | Description |
|-------|------|-------------|
| `shot_id` | string | Matches `shot_id` in `08-shot-list.jsonl` |
| `status` | enum | Current state: `pending`, `generating`, `complete`, `approved`, `rejected`, `failed` |
| `provider` | string\|null | AI provider used for most recent attempt |
| `provider_job_id` | string\|null | Provider-assigned job ID for the active or last attempt |
| `clip_path` | string\|null | Relative path from project root to the current MP4 file |
| `attempt_count` | integer | Total number of generation attempts for this shot (cumulative, never reset) |
| `rejection_reason` | string\|null | Human-readable reason provided with the most recent rejection |
| `approved_at` | ISO8601\|null | Timestamp when shot was last approved |
| `rejected_at` | ISO8601\|null | Timestamp when shot was last rejected |
| `generated_at` | ISO8601\|null | Timestamp when the most recent successful generation completed |
| `failed_at` | ISO8601\|null | Timestamp of the most recent provider failure |
| `credits_spent` | integer | Cumulative credits charged across all attempts for this shot |
| `updated_at` | ISO8601 | Timestamp of this record's creation (append-only log) |

**Full Lifecycle Example — Shot `s001` (generated, rejected, retried, approved):**

```jsonl
{"shot_id":"s001","status":"pending","provider":null,"provider_job_id":null,"clip_path":null,"attempt_count":0,"rejection_reason":null,"approved_at":null,"rejected_at":null,"generated_at":null,"failed_at":null,"credits_spent":0,"updated_at":"2026-04-15T10:00:00Z"}
{"shot_id":"s001","status":"generating","provider":"runway-gen3","provider_job_id":"rw_job_abc123","clip_path":null,"attempt_count":1,"rejection_reason":null,"approved_at":null,"rejected_at":null,"generated_at":null,"failed_at":null,"credits_spent":5,"updated_at":"2026-04-15T10:01:00Z"}
{"shot_id":"s001","status":"complete","provider":"runway-gen3","provider_job_id":"rw_job_abc123","clip_path":"video/clips/s001.mp4","attempt_count":1,"rejection_reason":null,"approved_at":null,"rejected_at":null,"generated_at":"2026-04-15T10:03:22Z","failed_at":null,"credits_spent":5,"updated_at":"2026-04-15T10:03:22Z"}
{"shot_id":"s001","status":"rejected","provider":"runway-gen3","provider_job_id":"rw_job_abc123","clip_path":"video/clips/s001.mp4","attempt_count":1,"rejection_reason":"Camera movement is opposite direction to script note. Subject exits frame too early.","approved_at":null,"rejected_at":"2026-04-15T10:07:45Z","generated_at":"2026-04-15T10:03:22Z","failed_at":null,"credits_spent":5,"updated_at":"2026-04-15T10:07:45Z"}
{"shot_id":"s001","status":"pending","provider":null,"provider_job_id":null,"clip_path":null,"attempt_count":1,"rejection_reason":null,"approved_at":null,"rejected_at":null,"generated_at":null,"failed_at":null,"credits_spent":5,"updated_at":"2026-04-15T10:07:46Z"}
{"shot_id":"s001","status":"generating","provider":"runway-gen3","provider_job_id":"rw_job_def456","clip_path":null,"attempt_count":2,"rejection_reason":null,"approved_at":null,"rejected_at":null,"generated_at":null,"failed_at":null,"credits_spent":10,"updated_at":"2026-04-15T10:08:00Z"}
{"shot_id":"s001","status":"complete","provider":"runway-gen3","provider_job_id":"rw_job_def456","clip_path":"video/clips/s001.mp4","attempt_count":2,"rejection_reason":null,"approved_at":null,"rejected_at":null,"generated_at":"2026-04-15T10:10:14Z","failed_at":null,"credits_spent":10,"updated_at":"2026-04-15T10:10:14Z"}
{"shot_id":"s001","status":"approved","provider":"runway-gen3","provider_job_id":"rw_job_def456","clip_path":"video/clips/s001.mp4","attempt_count":2,"rejection_reason":null,"approved_at":"2026-04-15T10:12:00Z","rejected_at":"2026-04-15T10:07:45Z","generated_at":"2026-04-15T10:10:14Z","failed_at":null,"credits_spent":10,"updated_at":"2026-04-15T10:12:00Z"}
```

**Rejected-clip rename convention:** When a shot is rejected, its clip is renamed from `video/clips/s001.mp4` to `video/clips/s001_attempt{N}.mp4` where `N` is the current `attempt_count`. Prior rejected attempts are never deleted — they are available for side-by-side comparison.

> **Example:** Shot `s017` has been through three rejection cycles. The `video/clips/` directory contains:
> - `video/clips/s017_attempt1.mp4` — first generation, rejected: "face distorted"
> - `video/clips/s017_attempt2.mp4` — second generation, rejected: "wrong lighting"
> - `video/clips/s017_attempt3.mp4` — third generation, rejected: "subject exits too early"
> - `video/clips/s017.mp4` — fourth generation, currently in `complete` state, awaiting review

---

### REQ-3: New `filmbuff video` Sub-Command Group

All new functionality lives under `filmbuff video <subcommand>`. Ten sub-commands are required.

---

#### 3.1 — `filmbuff video init`

Reads `08-shot-list.jsonl`, creates `08-video-status.jsonl` with one `pending` record per shot, and creates the `video/clips/` directory.

**Options:**

| Flag | Description |
|------|-------------|
| `-p, --project <path>` | Path to project directory (default: CWD) |
| `--overwrite` | Re-initialize status file, resetting all shots to `pending` (requires confirmation unless in agent mode) |
| `--no-interactive, --agent` | Enable agent mode |
| `-h, --help` | Display help |

**Examples:**

```bash
# Standard init for a new project
filmbuff video init

# Init for a project in a specific path
filmbuff video init --project ./echoes-of-the-canyon

# Reset an in-progress project (interactive: prompts for confirmation)
filmbuff video init --overwrite

# Reset in agent mode (no confirmation prompt, immediate execution)
filmbuff video init --overwrite --agent
FILMBUFF_AGENT_MODE=1 filmbuff video init --overwrite
```

**Expected Outputs:**

```
# Success (42 shots found):
Initialized video status for 42 shots. Run 'filmbuff video next' to begin generating.

# Error — shot list missing:
Error: Shot list not found. Run 'filmbuff generate-shot-list' first.
# Exit code: 2 (NOT_FOUND)

# Error — already initialized, no --overwrite:
Error: Video status already initialized. Use --overwrite to reset (this will lose all current progress).
# Exit code: 5 (STATE_CONFLICT)

# Existing clips detected (legacy project migration):
Detected 18 existing clips in video/clips/. Initializing their status as 'complete'.
Initialized video status for 42 shots (18 complete, 24 pending).
```

**Agent mode JSON output (stdout):**
```json
{"status":"success","data":{"initialized":42,"detected_clips":18,"set_complete":18,"set_pending":24},"creditsSpent":0,"shotId":null,"errorCode":null}
```

---

#### 3.2 — `filmbuff video next`

Finds the next `pending` shot in original `08-shot-list.jsonl` order, submits it to `ai-powered`, polls for completion, and downloads the resulting MP4.

**Options:**

| Flag | Description |
|------|-------------|
| `-p, --project <path>` | Path to project directory (default: CWD) |
| `--provider <name>` | AI provider: `runway-gen3` \| `pika-2` \| `kling-1.6` (default: `ai-powered` config) |
| `--no-wait` | Submit to provider and return immediately without polling |
| `--timeout <seconds>` | Max polling wait (default: 600) |
| `--no-interactive, --agent` | Enable agent mode |
| `-h, --help` | Display help |

**Examples:**

```bash
# Generate next pending shot using default provider
filmbuff video next

# Use Pika 2 instead of the configured default
filmbuff video next --provider pika-2

# Submit to Kling 1.6 and return immediately (for manual polling later)
filmbuff video next --provider kling-1.6 --no-wait

# In agent mode — JSON output, no ANSI colors
filmbuff video next --agent

# With a custom timeout of 5 minutes
filmbuff video next --timeout 300
```

**Polling output (human mode):**
```
[s004] Submitting to runway-gen3…
[s004] Generating… 15s elapsed (~90s estimated)
[s004] Generating… 30s elapsed (~90s estimated)
[s004] Generating… 60s elapsed (~90s estimated)
[s004] Generating… 90s elapsed (~90s estimated)
[s004] ✓ Complete — video/clips/s004.mp4 (1920x1080, 4.2s). Run 'filmbuff video next' for the next shot.
```

**No pending shots remaining:**
```
All shots generated. Approve shots then run 'filmbuff video compile'.
# Exit code: 0
```

**Provider failure:**
```
[s004] ✗ Failed — runway-gen3: content_policy_violation. Shot reset to pending.
# Exit code: 4 (PROVIDER_ERROR)
```

**Agent mode JSON output (success):**
```json
{"status":"success","data":{"shot_id":"s004","clip_path":"video/clips/s004.mp4","duration_seconds":4.2,"resolution":"1920x1080","attempt_count":1},"creditsSpent":5,"shotId":"s004","errorCode":null}
```

**Agent mode JSON output (no pending shots):**
```json
{"status":"success","data":{"message":"all_shots_generated","pending":0,"complete":10,"approved":30},"creditsSpent":0,"shotId":null,"errorCode":null}
```

---

#### 3.3 — `filmbuff video generate`

Generate a **specific shot by ID**, out of order. Used for targeted regeneration of known problem shots.

**Options:**

| Flag | Description |
|------|-------------|
| `-s, --shot <shot_id>` | **Required.** The shot ID to generate (e.g., `s017`) |
| `-p, --project <path>` | Path to project directory |
| `--provider <name>` | AI provider override |
| `--notes <text>` | Extra director notes appended to the prompt for this attempt only (does NOT mutate `08-shot-list.jsonl`) |
| `--force` | Cancel any in-flight job for this shot and start a new one |
| `--no-wait` | Submit and return immediately |
| `--no-interactive, --agent` | Enable agent mode |
| `-h, --help` | Display help |

**Examples:**

```bash
# Targeted regeneration of a known bad shot
filmbuff video generate --shot s017

# Regenerate with provider-specific director guidance (does not modify shot list)
filmbuff video generate --shot s017 --notes "Emphasize the shadow falling across her face. Slow push-in. Hold on eyes."

# Switch providers for a shot that failed content policy on Runway
filmbuff video generate --shot s042 --provider kling-1.6

# Force-cancel an in-flight job and restart with a different provider
filmbuff video generate --shot s022 --force --provider pika-2

# Regenerate without waiting, then check status later
filmbuff video generate --shot s033 --no-wait
filmbuff video status --filter generating

# Full agent-mode example with notes and provider override
filmbuff video generate --shot s017 --notes "Slow motion. Match lighting of s016." --provider pika-2 --agent
```

**Conflict error (shot already generating):**
```
Error: Shot s017 is already generating (job rw_job_abc123). Use --force to cancel and restart.
# Exit code: 5 (STATE_CONFLICT)
```

**Conflict error (shot approved):**
```
Error: Shot s017 is already approved. Use 'filmbuff video reopen --shot s017' to re-queue it for regeneration.
# Exit code: 5 (STATE_CONFLICT)
```

---

#### 3.4 — `filmbuff video retry`

Convenience alias for `filmbuff video generate`. Semantically communicates user intent (retrying a previously failed or rejected shot vs. first-time generation). Accepts the same options as `filmbuff video generate` minus `--force` (which is implicit for retry).

**Examples:**

```bash
# Retry the last failed/rejected shot with same settings
filmbuff video retry --shot s017

# Retry with a different provider and additional guidance
filmbuff video retry --shot s017 --provider kling-1.6 --notes "Match slow-motion style of scene 3. Avoid lens flare."

# Retry a content-policy-failed shot with softened notes
filmbuff video retry --shot s028 --provider pika-2 --notes "Reduce intensity of the confrontation. Soften lighting."

# Retry all failed shots in sequence (using shell loop)
filmbuff video status --filter failed --json | jq -r '.shots[].shot_id' | xargs -I{} filmbuff video retry --shot {}
```

---

#### 3.5 — `filmbuff video approve`

Mark one or more shots as `approved`. Only approved shots are included in `combined.mp4` during the default compile.

**Options:**

| Flag | Description |
|------|-------------|
| `-s, --shot <shot_id>` | Shot ID to approve. Repeatable for multiple shots. |
| `--all-complete` | Approve all shots currently in `complete` status |
| `-p, --project <path>` | Path to project directory |
| `--no-interactive, --agent` | Enable agent mode |
| `-h, --help` | Display help |

**Examples:**

```bash
# Approve a single shot after reviewing
filmbuff video approve --shot s001

# Approve multiple reviewed shots at once
filmbuff video approve --shot s001 --shot s003 --shot s005 --shot s007

# Approve all complete shots in a batch review session
filmbuff video approve --all-complete

# Agent mode — approve specific shots, get JSON confirmation
filmbuff video approve --shot s012 --shot s013 --agent
```

**Human output:**
```
Approved 3 shots. Total approved: 15/42.
```

**Agent mode JSON output:**
```json
{"status":"success","data":{"approved_this_call":3,"total_approved":15,"total_shots":42},"creditsSpent":0,"shotId":null,"errorCode":null}
```

---

#### 3.6 — `filmbuff video reject`

Mark a shot as `rejected` ("weird"). The shot automatically reverts to `pending`. The prior clip is renamed and preserved for comparison.

**Options:**

| Flag | Description |
|------|-------------|
| `-s, --shot <shot_id>` | **Required.** The shot ID to reject |
| `-r, --reason <text>` | Human-readable rejection reason (stored in status file; surfaced in web UI) |
| `-p, --project <path>` | Path to project directory |
| `--no-interactive, --agent` | Enable agent mode |
| `-h, --help` | Display help |

**Examples:**

```bash
# Reject with a specific technical note
filmbuff video reject --shot s017 --reason "Subject face is distorted. Wrong lighting direction — should be backlit."

# Reject for camera movement inversion
filmbuff video reject --shot s042 --reason "Camera movement inverted — should be push-in, not pull-back. Matches wrong script direction."

# Reject for content continuity failure
filmbuff video reject --shot s031 --reason "Car color changes from red to blue between s030 and s031. Continuity break."

# Reject without a reason (recorded as 'no reason provided')
filmbuff video reject --shot s003

# Agent mode with reason
filmbuff video reject --shot s019 --reason "Incorrect subject — wrong actor framing." --agent
```

**Human output:**
```
[s017] Rejected. Clip preserved at video/clips/s017_attempt1.mp4. Run 'filmbuff video retry --shot s017' to regenerate.
```

**Agent mode JSON output:**
```json
{"status":"success","data":{"shot_id":"s017","rejected_at":"2026-04-15T10:07:45Z","preserved_clip":"video/clips/s017_attempt1.mp4","next_status":"pending"},"creditsSpent":0,"shotId":"s017","errorCode":null}
```

---

#### 3.7 — `filmbuff video status`

Display per-shot generation status as a formatted table (human) or structured JSON (agent/API).

**Options:**

| Flag | Description |
|------|-------------|
| `-p, --project <path>` | Path to project directory |
| `--json` | Machine-readable JSON output (consumed directly by web server `GET /api/projects/:id/video-status`) |
| `--filter <state>` | Show only shots in: `pending` \| `generating` \| `complete` \| `approved` \| `rejected` \| `failed` |
| `--no-interactive, --agent` | Enable agent mode (implies `--json`) |
| `-h, --help` | Display help |

**Examples:**

```bash
# Full status table
filmbuff video status

# Only pending shots (to see what's left)
filmbuff video status --filter pending

# Only failed shots (to identify what needs retry)
filmbuff video status --filter failed

# Machine-readable output for web API or scripting
filmbuff video status --json

# Filter to approved only in JSON format
filmbuff video status --filter approved --json

# Agent mode status check (always JSON)
filmbuff video status --agent
```

**Full human-readable table output:**
```
=== Video Generation Status — Echoes of the Canyon ===

Shot   Scene                            Status      Provider       Attempts  Credits
------ -------------------------------- ----------- -------------- --------- -------
s001   EXT. CANYON ROAD - DAY           approved    runway-gen3    2         10   ← retried once
s002   INT. PICKUP TRUCK - CONT.        approved    runway-gen3    1         5
s003   EXT. CANYON ROAD - CONT.         complete    runway-gen3    1         5
s004   INT. GAS STATION - NIGHT         generating  runway-gen3    1         5
s005   EXT. GAS STATION - DAWN          complete    runway-gen3    1         5
s017   INT. MOTEL ROOM - NIGHT          pending     —              2         10   ← retried once
s028   EXT. HIGHWAY - DUSK              rejected    pika-2         1         5
s033   INT. DINER - DAY                 failed      runway-gen3    1         5

Total: 42 shots | 2 approved | 2 complete | 1 generating | 35 pending | 1 rejected | 1 failed
Credits spent: 50 | Credits remaining: 250
```

**Full JSON output** (consumed by `GET /api/projects/:id/video-status`):
```json
{
  "project": "Echoes of the Canyon",
  "total_shots": 42,
  "counts": {"approved":2,"complete":2,"generating":1,"pending":35,"rejected":1,"failed":1},
  "credits_spent": 50,
  "credits_remaining": 250,
  "shots": [
    {"shot_id":"s001","status":"approved","attempt_count":2,"credits_spent":10,"clip_path":"video/clips/s001.mp4","rejection_reason":null,"approved_at":"2026-04-15T10:12:00Z"},
    {"shot_id":"s017","status":"pending","attempt_count":2,"credits_spent":10,"clip_path":null,"last_rejection_reason":"Camera movement inverted — should be push-in.","approved_at":null},
    {"shot_id":"s028","status":"rejected","attempt_count":1,"credits_spent":5,"clip_path":"video/clips/s028_attempt1.mp4","last_rejection_reason":"Incorrect time-of-day lighting. Should be dusk, not midday.","approved_at":null},
    {"shot_id":"s033","status":"failed","attempt_count":1,"credits_spent":5,"clip_path":null,"last_rejection_reason":null,"approved_at":null}
  ]
}
```

---

#### 3.8 — `filmbuff video compile`

Assemble `combined.mp4`, `index.html`, and `project.zip` from approved shots in original shot-list order.

**Options:**

| Flag | Description |
|------|-------------|
| `-p, --project <path>` | Path to project directory |
| `--include <mode>` | `approved` (default) \| `all-complete` \| `all` |
| `--title-cards` | Insert 2-second scene-title cards at scene boundaries (default: true) |
| `--output-dir <path>` | Output directory (default: `video/output/` within project) |
| `--no-interactive, --agent` | Enable agent mode |
| `-h, --help` | Display help |

**Examples:**

```bash
# Standard compile — approved shots only, with title cards
filmbuff video compile

# Include all complete and approved shots (skip rejected/failed/pending)
filmbuff video compile --include all-complete

# Custom output directory for delivery
filmbuff video compile --output-dir ./finals/2026-04-15-delivery

# Compile without title cards (for raw assembly)
filmbuff video compile --title-cards false

# Agent mode compile
filmbuff video compile --agent
```

**Human output:**
```
Compiling 38 approved shots…
  Adding title card: EXT. CANYON ROAD - DAY
  Concatenating s001.mp4 (approved, attempt 2)
  Concatenating s002.mp4 (approved, attempt 1)
  …
  Adding title card: INT. DINER - DAY
  Concatenating s038.mp4 (approved, attempt 1)
Generating index.html viewer…
Packaging project.zip…

Compilation complete. 38/42 shots compiled.
  combined.mp4 → video/output/combined.mp4 (12m 43s, 1.8 GB)
  index.html   → video/output/index.html
  project.zip  → video/output/project.zip (2.3 GB)
```

**Error — zero approved shots:**
```
Error: No approved shots to compile. Approve shots with 'filmbuff video approve'.
# Exit code: 5 (STATE_CONFLICT)
```

**`index.html` requirements:**
- Fully self-contained HTML5 viewer. No external CDN dependencies. All CSS/JS inlined.
- Project title header.
- Scene navigation sidebar (grouped by scene heading).
- `<video>` element per shot with metadata overlay: scene name, shot type, camera angle, camera movement, dialogue (if any).

**`project.zip` contents:**
- All included MP4 clips (current approved versions only)
- `index.html`
- All `.md` pre-production documents (`01-logline.md` through `07-shot-list-prep.md`)
- `06-screenplay.fountain`
- `08-shot-list.jsonl`
- `08-video-status.jsonl` (full generation history for recipient inspection)

---

#### 3.9 — `filmbuff video reopen`

Re-open an `approved` shot for regeneration. Used for continuity fixes after a full review cycle.

**Options:**

| Flag | Description |
|------|-------------|
| `-s, --shot <shot_id>` | **Required.** The shot ID to reopen |
| `-r, --reason <text>` | Reason for reopening (logged in `08-video-status.jsonl`) |
| `-p, --project <path>` | Path to project directory |
| `--no-interactive, --agent` | Enable agent mode |

**Examples:**

```bash
# Reopen for continuity fix
filmbuff video reopen --shot s005 --reason "Continuity error with s004 — car door position changes between shots."

# Reopen for color-grade mismatch
filmbuff video reopen --shot s012 --reason "Color temperature inconsistency with adjacent shots. Needs cooler tone."

# Reopen without reason
filmbuff video reopen --shot s007

# Agent mode reopen
filmbuff video reopen --shot s005 --reason "Match eyeline direction of s006." --agent
```

**Human output:**
```
[s005] Reopened. Clip renamed to video/clips/s005_attempt1.mp4. Shot reset to pending.
Run 'filmbuff video generate --shot s005' or 'filmbuff video next' to regenerate.
```

---

#### 3.10 — `filmbuff video generate-all` (Batch Convenience)

Run `filmbuff video next` in a loop until no `pending` shots remain. Equivalent to the old batch behavior, but using the new per-shot state machine. This is the target delegate for the deprecated `filmbuff generate-video`.

**Options:**

| Flag | Description |
|------|-------------|
| `-p, --project <path>` | Path to project directory |
| `--provider <name>` | AI provider for all shots |
| `--concurrency <n>` | Number of shots to generate in parallel (default: 1) |
| `--no-interactive, --agent` | Enable agent mode |
| `-h, --help` | Display help |

**Examples:**

```bash
# Sequential batch generation (safest, easiest to debug)
filmbuff video generate-all

# All shots on Kling 1.6
filmbuff video generate-all --provider kling-1.6

# Parallel generation — submit 3 shots simultaneously (faster, uses more credits at once)
filmbuff video generate-all --concurrency 3

# Agent mode batch generation with provider override
filmbuff video generate-all --provider pika-2 --agent

# Resume interrupted batch (only generates remaining pending shots)
filmbuff video generate-all   # Picks up where it left off — skips complete/approved shots
```

---

### REQ-4: `ai-powered` Integration — Per-Shot API

The `ai-powered` library must expose the following TypeScript interface additions. Implement them if they do not exist.

**New TypeScript Interfaces and Functions:**

```typescript
export interface SingleShotOptions {
  shot: ShotListEntry;       // Single parsed JSONL line from 08-shot-list.jsonl
  provider: string;          // 'runway-gen3' | 'pika-2' | 'kling-1.6'
  extraNotes?: string;       // Appended to shot.notes for this attempt only
  outputPath: string;        // Absolute path to write the downloaded MP4
  timeoutMs?: number;        // Default: 600_000
  agentToken?: string;       // Bearer token for agent credential passthrough (see REQ-7)
}

export interface SingleShotResult {
  jobId: string;
  status: 'complete' | 'failed';
  clipPath?: string;          // Absolute path to MP4 if status === 'complete'
  durationSeconds?: number;
  resolution?: string;        // e.g. '1920x1080'
  errorMessage?: string;
}

// Synchronous: submit + poll until done or timeout
export async function generateSingleShot(opts: SingleShotOptions): Promise<SingleShotResult>;

// Async: submit only, returns immediately with job ID
export async function submitSingleShot(
  opts: Omit<SingleShotOptions, 'outputPath' | 'timeoutMs'>
): Promise<{ jobId: string }>;

// Poll a previously submitted job to completion
export async function pollShotJob(
  jobId: string,
  provider: string,
  outputPath: string,
  timeoutMs?: number
): Promise<SingleShotResult>;
```

**Prompt Construction Template (build from shot JSONL fields):**
```
Scene: {scene}
Shot type: {shot_type}
Camera angle: {camera}
Camera movement: {movement}
Subject: {subject}
Duration: {duration_seconds} seconds
Mood/tone: {mood}
{dialogue ? `Dialogue: "{dialogue}"` : '(no dialogue)'}
{sfx ? `Sound design reference: {sfx}` : ''}
Director notes: {notes}{extraNotes ? `. Additional guidance: {extraNotes}` : ''}
```

**Prompt construction example (shot `s017`):**
```
Scene: INT. MOTEL ROOM - NIGHT
Shot type: CU (Close-Up)
Camera angle: Eye level
Camera movement: Slow push-in
Subject: Elena staring at the photograph
Duration: 4 seconds
Mood/tone: Haunted, melancholic, still
Dialogue: "He was never here. Was he?"
Director notes: Hold on her eyes in the last 2 seconds. Shallow depth of field.
```

**Prompt with `--notes` override (does NOT appear in `08-shot-list.jsonl`):**
```
Scene: INT. MOTEL ROOM - NIGHT
Shot type: CU (Close-Up)
Camera angle: Eye level
Camera movement: Slow push-in
Subject: Elena staring at the photograph
Duration: 4 seconds
Mood/tone: Haunted, melancholic, still
Dialogue: "He was never here. Was he?"
Director notes: Hold on her eyes in the last 2 seconds. Shallow depth of field.. Additional guidance: Emphasize the shadow falling across her face. Add slight camera tremor.
```

---

### REQ-5: File System Layout

The following directory and file structure must be created and maintained by the `filmbuff video` commands:

```
<project-root>/
├── 01-logline.md
├── 02-treatment.md
├── 03-characters.md
├── 04-scenes.md
├── 05-act-structure.md
├── 06-screenplay.fountain
├── 07-shot-list-prep.md
├── 08-shot-list.jsonl           ← shot definitions — NEVER mutated by video commands
├── 08-video-status.jsonl        ← NEW: append-only shot state log
└── video/
    ├── clips/
    │   ├── s001.mp4             ← current approved clip (attempt 2)
    │   ├── s001_attempt1.mp4    ← rejected first attempt (preserved for comparison)
    │   ├── s017_attempt1.mp4    ← first rejected attempt
    │   ├── s017_attempt2.mp4    ← second rejected attempt
    │   ├── s017_attempt3.mp4    ← third rejected attempt
    │   └── ...
    └── output/                  ← created by 'filmbuff video compile'
        ├── combined.mp4
        ├── index.html
        └── project.zip
```

**Key constraints:**
- `08-shot-list.jsonl` is **read-only** to all `filmbuff video` commands. No video command may write to, append to, or mutate this file under any circumstances.
- `08-video-status.jsonl` is append-only. Records are never modified in place. The latest record per `shot_id` is authoritative.
- `video/clips/` must be created by `filmbuff video init`.
- `video/output/` is created by `filmbuff video compile` and may be recreated on each compile run.

---

### REQ-6: Backward Compatibility — Deprecated `filmbuff generate-video`

`filmbuff generate-video` is **deprecated, not removed.**

**On invocation, it must:**
1. Print the deprecation warning with a 3-second countdown (human mode only):
   ```
   ⚠ Warning: 'filmbuff generate-video' is deprecated and will be removed in a future version.
     Use 'filmbuff video generate-all' instead.
     Proceeding with full batch generation in 3 seconds… (Ctrl-C to cancel)
   ```
2. After 3 seconds, call the full pipeline:
   - `filmbuff video init` (skips if already initialized — uses `--overwrite` logic only if `--overwrite` was passed on the original command)
   - `filmbuff video generate-all`
   - `filmbuff video approve --all-complete`
   - `filmbuff video compile`
3. In agent mode (`--agent` or `FILMBUFF_AGENT_MODE=1`): skip the 3-second delay entirely and proceed immediately.

**Legacy project migration:**
- `filmbuff video init` detects existing MP4 files in `video/clips/` that match a known shot ID pattern.
- Detected clips are initialized with status `complete` instead of `pending`.
- The existing clip is registered as `clip_path`, `attempt_count` is set to 1, and `credits_spent` is set to 0 (unknown retroactively).

> **Example:** A project was generated under the old batch system. `video/clips/` contains `s001.mp4` through `s042.mp4`. Running `filmbuff video init` produces: `"Detected 42 existing clips in video/clips/. Initializing their status as 'complete'. Run 'filmbuff video approve --all-complete' to approve them all, or review individually."`

---

### REQ-7: Agent Mode & Non-Interactive Operation

The entire `filmbuff video` command group must be fully operable by AI agents without any human-in-the-loop. This is not optional — it is a first-class requirement.

#### 7.1 — Agent Mode Activation

Agent mode is activated by **any** of the following (evaluated in this order):

1. `--no-interactive` or `--agent` flag on any command.
2. Environment variable `FILMBUFF_AGENT_MODE=1`.
3. Automatic: when `stdin` is not a TTY (`!process.stdin.isTTY`).

#### 7.2 — Agent Mode Behavior Changes

The following changes apply to **all commands in Section 4** when agent mode is active:

| Human Mode Behavior | Agent Mode Behavior |
|---------------------|---------------------|
| `--overwrite` prompts for confirmation | Bypassed — proceeds immediately |
| `filmbuff generate-video` 3-second delay | Removed — no `setTimeout` pause |
| ANSI color codes and spinner characters | Stripped from all output streams |
| Human-readable table (Section 4.7) | Replaced with `--json` format output |
| `stdout`: free-form human text | `stdout`: exactly one JSON object per invocation |
| `stderr`: human-readable error text | `stderr`: exactly one JSON error object |
| Blocks on stdin for confirmation | Never blocks on stdin |

**Agent mode stdout envelope (all commands):**
```json
{
  "status": "success" | "error",
  "data": { /* command-specific payload */ },
  "creditsSpent": 5,
  "shotId": "s003" | null,
  "errorCode": null | "<SYMBOLIC_CODE>"
}
```

**Agent mode stderr on error (non-zero exit code):**
```json
{"error":{"code":"PROVIDER_ERROR","message":"runway-gen3 returned content_policy_violation for shot s017. Job ID: rw_job_abc123."}}
```

#### 7.3 — Machine-Readable Exit Codes

All `filmbuff video` commands exit with a consistent, version-stable exit code:

| Exit Code | Symbolic Name | Meaning | Example Trigger |
|-----------|---------------|---------|-----------------|
| 0 | `SUCCESS` | Command completed successfully | Normal generation, approval, or compile |
| 1 | `GENERAL_ERROR` | Unclassified runtime error | Unexpected exception, file I/O error |
| 2 | `NOT_FOUND` | Shot, project, or required file does not exist | `--shot s999` when `s999` is not in shot list |
| 3 | `INSUFFICIENT_CREDITS` | Provider call rejected due to credit exhaustion | Runway credit balance is zero |
| 4 | `PROVIDER_ERROR` | AI provider returned an error | Content policy violation, API timeout, quota exceeded |
| 5 | `STATE_CONFLICT` | Operation invalid in current state | Shot already generating, status already initialized |
| 6 | `INVALID_ARGS` | Required argument missing or invalid value | `--shot` missing from `generate`, unknown `--provider` value |

**Exit code contract:** Codes are stable across versions. New codes may be added (backward-compatible). No existing code may be renumbered.

> **Agent usage example:** A LangGraph node calls `filmbuff video next --agent`. It reads the exit code:
> - `0` → mark subtask complete, call next tool
> - `4` → log `PROVIDER_ERROR`, switch provider and retry
> - `3` → pause pipeline, surface credit alert to human supervisor
> - `5` → call `filmbuff video status --agent` to diagnose state, then decide

#### 7.4 — MCP Tool Server (`filmbuff mcp-server`)

Expose all `filmbuff video` sub-commands as MCP tools conforming to MCP specification 2025-11-25.

**Usage:**
```bash
# stdio transport — for local agent runtimes (Claude Desktop, etc.)
filmbuff mcp-server

# Streamable HTTP transport — for remote agents
filmbuff mcp-server --transport http --port 3742

# Explicit project path
filmbuff mcp-server --project ./echoes-of-the-canyon --transport http --port 3742
```

**Exposed MCP Tools (10 total):**

| Tool Name | Description | Required Params | Optional Params |
|-----------|-------------|-----------------|-----------------|
| `video_init` | Initialize `08-video-status.jsonl` for the project | — | `project`, `overwrite` |
| `video_next` | Generate the next pending shot in order | — | `project`, `provider`, `noWait`, `timeoutSeconds` |
| `video_generate` | Generate a specific shot by ID | `shotId` | `project`, `provider`, `notes`, `force`, `noWait` |
| `video_retry` | Retry a failed or rejected shot | `shotId` | `project`, `provider`, `notes` |
| `video_approve` | Approve one or more shots | — | `shots` (array), `allComplete`, `project` |
| `video_reject` | Reject a shot with optional reason | `shotId` | `reason`, `project` |
| `video_status` | Return current per-shot status | — | `project`, `filter` |
| `video_compile` | Compile approved shots into `combined.mp4` | — | `project`, `include`, `titleCards`, `outputDir` |
| `video_reopen` | Reopen an approved shot for regeneration | `shotId` | `reason`, `project` |
| `video_generate_all` | Batch-generate all pending shots | — | `project`, `provider`, `concurrency` |

**MCP tool response envelope:**
```json
{
  "status": "success",
  "data": { },
  "creditsSpent": 5,
  "shotId": "s003",
  "errorCode": null
}
```

On error: `"status": "error"`, `"errorCode"` set to symbolic name (e.g., `"PROVIDER_ERROR"`), `"data"` is `null`.

**MCP resource exposed:**
- URI: `video://status`
- Description: Current `08-video-status.jsonl` parsed and returned as a live MCP resource.
- Agents call `resources/read` to inspect all shot states without invoking a tool.

**Transport requirements:**
- `stdio`: JSON-RPC 2.0 framing over process stdin/stdout. No authentication (local trust model).
- `http` (Streamable HTTP): Server listens on configured port. Requests must include `Authorization: Bearer <token>` where the token is the value of `FILMBUFF_MCP_TOKEN` environment variable. Requests with missing or invalid tokens receive HTTP 401.

**Agent usage example (Claude Desktop):**
```json
{
  "mcpServers": {
    "filmbuff": {
      "command": "filmbuff",
      "args": ["mcp-server", "--project", "/Users/kyle/films/echoes-of-the-canyon"]
    }
  }
}
```
Claude Desktop can then invoke `video_next`, `video_approve`, `video_reject`, and `video_compile` as native tools within a conversation — no shell scripting required.

#### 7.5 — Agent Credential Passthrough to `ai-powered`

When `filmbuff` calls `ai-powered` on behalf of an agent, the agent's identity must be forwarded for usage attribution, per-agent quota enforcement, and accurate billing.

- **`AIPOWERED_AGENT_TOKEN` environment variable**: if set, `filmbuff` passes this as `agentToken` in `SingleShotOptions`. `ai-powered` uses it as a Bearer token on all outbound provider API calls instead of the global service-account credential.
- **Fallback**: if `AIPOWERED_AGENT_TOKEN` is not set, `filmbuff` uses `AIPOWERED_API_KEY` (existing global key).
- **Security constraint**: `agentToken` must never be logged, printed to any output stream, or written to `08-video-status.jsonl` or any other file. It is a credential.

> **Example:** An AutoGen agent has its own Runway API token provisioned via `AIPOWERED_AGENT_TOKEN=<token>`. When it calls `filmbuff video next --agent`, `filmbuff` forwards the token to `ai-powered`. Runway bills the agent's account (not the global service account). The token never appears in `08-video-status.jsonl`, logs, or `filmbuff video status` output.

---

### REQ-8: Watchdog — Stuck-in-Generating Timeout

A watchdog check runs at the **start** of every `filmbuff video next` and `filmbuff video status` invocation.

**Watchdog logic:**
1. Read all shots whose current status is `generating`.
2. For each such shot, compute `elapsed = now - updated_at` (from the `generating` record).
3. If `elapsed > timeoutMs` (default: 600,000 ms / 10 minutes): transition the shot `generating` → `failed` → `pending` by appending two new records.
4. Print a warning for each transitioned shot.

**Example watchdog output (human mode):**
```
⚠ Watchdog: Shot s022 has been generating for 14m 32s (timeout: 10m). Resetting to pending.
⚠ Watchdog: Shot s031 has been generating for 22m 07s (timeout: 10m). Resetting to pending.
```

**Example watchdog output (agent mode JSON):**
```json
{
  "watchdog": {
    "timed_out": [
      {"shot_id": "s022", "elapsed_seconds": 872, "timeout_seconds": 600},
      {"shot_id": "s031", "elapsed_seconds": 1327, "timeout_seconds": 600}
    ]
  }
}
```
(Included in the `data` field of the command's normal response envelope.)

---

## Acceptance Criteria

All of the following must pass for the implementation to be considered complete.

### Core State Machine & File I/O

- [ ] **AC-01:** `filmbuff video init` creates `08-video-status.jsonl` with exactly one `pending` record per shot in `08-shot-list.jsonl`. Running twice without `--overwrite` exits with code `5` and a clear error message.
- [ ] **AC-02:** `filmbuff video next` generates exactly one shot per invocation and exits cleanly (exit 0).
- [ ] **AC-03:** `filmbuff video next` selects the next shot in **original JSONL order** — not alphabetical, not insertion order.
- [ ] **AC-04:** `filmbuff video generate --shot s017 --notes "..."` appends extra notes to the provider prompt without mutating `08-shot-list.jsonl`. Reading `08-shot-list.jsonl` before and after confirms the file is byte-for-byte identical.
- [ ] **AC-05:** `filmbuff video reject --shot s017 --reason "..."` renames `video/clips/s017.mp4` → `video/clips/s017_attempt{N}.mp4` and appends a new `pending` record. The `rejected` record's `rejection_reason` field matches the `--reason` argument exactly.
- [ ] **AC-06:** `filmbuff video approve --all-complete` approves only `complete` shots. Shots in `pending`, `generating`, `rejected`, `failed` states are unaffected.
- [ ] **AC-07:** `filmbuff video compile` includes shots in original shot-list order, not in approval order or alphabetical order.
- [ ] **AC-08:** `filmbuff video compile` exits with code `5` and an explicit error message if zero shots are `approved` (in default `--include approved` mode).
- [ ] **AC-09:** `combined.mp4` title cards appear only at **scene boundaries**, not between every shot within a scene.
- [ ] **AC-10:** `project.zip` includes `08-video-status.jsonl` so recipients can inspect the full generation history.
- [ ] **AC-11:** `credits_spent` in `08-video-status.jsonl` accumulates correctly across retries. The total credit cost for each shot is computable from the status file alone.

### Watchdog

- [ ] **AC-12:** A shot stuck in `generating` state longer than the configured timeout is automatically transitioned `generating` → `failed` → `pending` by the watchdog check that runs at the start of every `filmbuff video next` and `filmbuff video status` invocation.

### Backward Compatibility

- [ ] **AC-13:** `filmbuff generate-video` prints the deprecation warning with the full message, waits exactly 3 seconds (in human mode), and then completes the full pipeline (`init` → `generate-all` → `approve --all-complete` → `compile`) without additional user interaction.
- [ ] **AC-14:** All commands accept `--project <path>` and default to CWD when the flag is omitted.
- [ ] **AC-15:** `filmbuff video init` detects existing clips in `video/clips/` from an old batch run and initializes their status as `complete` instead of `pending`.

### Agent Mode & JSON Output

- [ ] **AC-16:** Running any `filmbuff video` command with `FILMBUFF_AGENT_MODE=1` produces **only valid, parseable JSON** on `stdout` — no ANSI codes, no spinner characters, no human-readable tables, no extra whitespace.
- [ ] **AC-17:** `filmbuff video init --overwrite --agent` does NOT pause for user confirmation; it initializes immediately and exits 0.
- [ ] **AC-18:** `filmbuff generate-video --agent` skips the 3-second deprecation delay entirely and completes the full pipeline.
- [ ] **AC-19:** Exit code `3` (`INSUFFICIENT_CREDITS`) is returned when a generation attempt is rejected by the provider for credit exhaustion.
- [ ] **AC-20:** Exit code `4` (`PROVIDER_ERROR`) is returned when the AI provider returns an API error or content policy rejection.
- [ ] **AC-21:** `stderr` contains **only** a valid JSON error object (no plain text) whenever any command exits with a non-zero code in agent mode.
- [ ] **AC-22:** `filmbuff video status --json` outputs valid JSON parseable by the web server's `GET /api/projects/:id/video-status` endpoint without transformation.

### MCP Tool Server

- [ ] **AC-23:** `filmbuff mcp-server` starts successfully and responds to a JSON-RPC `tools/list` request with all 10 tools listed in REQ-7.4.
- [ ] **AC-24:** An MCP client calling `video_status` receives a response whose `data` field matches the JSON schema defined in Section 4.7.
- [ ] **AC-25:** An MCP client calling `video_approve` with `allComplete: true` approves all `complete` shots and returns the correct approved count in the `data` field.
- [ ] **AC-26:** `filmbuff mcp-server --transport http` exposes tools over Streamable HTTP transport conforming to MCP specification 2025-11-25. A standard MCP client library can connect and invoke all 10 tools successfully.

### Agent Credential Security

- [ ] **AC-27:** `agentToken` passed via `AIPOWERED_AGENT_TOKEN` is forwarded to every `ai-powered` call without being logged, printed to stdout/stderr, or written to any status file, log file, or output directory.

---

## Implementation Notes

### Ordering Guarantee
Shot order in `08-video-status.jsonl` is determined by position in `08-shot-list.jsonl`. The status file is append-only and unordered. Whenever "order" matters (e.g., `filmbuff video next`, `filmbuff video compile`), the implementation must read `08-shot-list.jsonl` for canonical order and use `08-video-status.jsonl` only for current state lookup.

### Append-Only Pattern
`08-video-status.jsonl` follows the same append-only pattern as `.beads/issues.jsonl`. Each state change appends a new record. No record is ever modified in place. The "current state" for a shot is the **last** record for that `shot_id`.

### Credit Cost Discovery
Credit costs per generation attempt must be retrieved from the `ai-powered` provider response or from a provider configuration map. If unavailable from the response, fall back to a static per-provider default (e.g., `runway-gen3: 5`, `pika-2: 4`, `kling-1.6: 6`). The `credits_spent` field must never be hardcoded in the CLI for a specific project.

### `08-shot-list.jsonl` Immutability
No `filmbuff video` command may write to, append to, or modify `08-shot-list.jsonl`. The `--notes` flag on `filmbuff video generate` and `filmbuff video retry` appends extra text to the **prompt sent to the AI provider** for that attempt only. The notes are stored in the `rejection_reason` field of the in-flight `generating` status record for audit purposes but never written back to the shot list.

---

## Dependencies

- `ffmpeg` — required for `filmbuff video compile` (concatenation and title card generation). Must be present in PATH or configured via `FILMBUFF_FFMPEG_PATH`.
- `ai-powered` library — must expose the `generateSingleShot`, `submitSingleShot`, and `pollShotJob` functions described in REQ-4. These must be implemented if they do not yet exist.
- MCP SDK — required for `filmbuff mcp-server`. Use the official MCP TypeScript SDK compatible with specification 2025-11-25.

---

## Out of Scope

- Changes to `08-shot-list.jsonl` format or content.
- Changes to pre-production commands (`filmbuff generate-shot-list`, `filmbuff write-screenplay`, etc.).
- Web server UI changes (the web server already consumes `filmbuff video status --json` output via `GET /api/projects/:id/video-status` — no web server changes required for this ticket).
- New AI providers beyond `runway-gen3`, `pika-2`, and `kling-1.6`.

---

*Ticket created: 2026-04-15 | Source: `ai-prompts/filmbuff.md` | Epic: FB-0042*
