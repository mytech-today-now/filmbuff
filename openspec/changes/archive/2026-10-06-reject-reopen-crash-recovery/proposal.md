## Why

`filmbuff video reject` and `reopen` move a clip before appending the corresponding state transition. A process stop between those writes leaves the status log and clip path out of sync, so the next lifecycle command may act on stale state or a missing clip.

## What Changes

- Add optional append-only intent and operation markers to the existing video status log.
- Reconcile interrupted reject/reopen operations before status is returned or another status write proceeds.
- Move clips without replacing an existing attempt destination, and fail closed when recovery cannot identify a safe state.
- Preserve existing transitions, archived clip contents, `attempt_count`, and cumulative `credits_spent`.

## Capabilities

### New Capabilities

- `video-lifecycle-recovery`: recover reject/reopen updates across the append-only status log and clip filesystem paths.

### Modified Capabilities

None. The canonical OpenSpec inventory has no existing lifecycle capability to modify; the current `filmb-ai-p` documents are full-text change specs rather than canonical delta specs.

## Impact

- CLI status persistence and `video reject` / `video reopen` handlers.
- The status record TypeScript contract and the `filmb-ai-p` lifecycle documentation.
- Vitest and Jest coverage for normal, failed, interrupted, and conflicting filesystem states.
- No new package dependencies or separate recovery file.
