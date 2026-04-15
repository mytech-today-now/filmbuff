Write-Step "Phase 2: ai-powered Library - Per-Shot API"

$ph2Desc = @"
PHASE: ai-powered Library — Per-Shot API (WS-1 per implementation.md)
BLOCKED BY: EPIC (spec approval gate)
BLOCKS: Phase 3 (Shot State Machine depends on ai-powered interfaces)

TASKS (from tasks.md Phase 2):
  • Define SingleShotOptions and SingleShotResult TypeScript interfaces in ai-powered/src/types.ts
  • Implement generateSingleShot(opts) — submit + poll until complete or timeout
  • Implement submitSingleShot(opts) — submit only, return jobId immediately
  • Implement pollShotJob(jobId, provider, outputPath, timeoutMs?) — poll to completion or timeout
  • Implement prompt construction template from ShotListEntry fields:
    scene, shot_type, camera, movement, subject, duration_seconds, mood, dialogue, sfx, notes
  • Implement extraNotes appending to Director notes: field ONLY; NEVER persisted to shot list
  • Implement agentToken forwarding as Authorization: Bearer header; enforce no-log constraint
  • Implement creditsCharged discovery: extract from provider response; fall back to static map
  • Write unit tests UT-API-01 through UT-API-10 and UT-PROMPT-01 through UT-PROMPT-05