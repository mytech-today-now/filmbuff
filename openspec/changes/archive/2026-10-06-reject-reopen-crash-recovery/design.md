# Design: Reject/Reopen Crash Recovery

## Chosen protocol

Use the existing append-only `08-video-status.jsonl` as the durable journal. An intent record repeats the prior shot state and stores an operation ID, reject/reopen kind, source and archive paths, source file identity, and the exact planned status records. The intent marker is optional metadata on an otherwise valid status record, so legacy records remain readable and no sidecar file is introduced.

The operation holds the existing status-file lock across intent creation, clip movement, and status finalization:

1. Reconcile any earlier unfinished intents, then verify that the latest shot record still matches the transition input.
2. Confirm the attempt destination is absent and append the intent record.
3. Create the destination with an exclusive hard link and remove the source. The intent records the file identity so recovery can recognize a stop between these two filesystem calls.
4. Append planned transition records with the operation ID and ordered step number.
5. On a subsequent status read or append, complete only the missing archive or status steps.

`getLatestState()` and ordinary `appendRecords()` run recovery under the same lock. A partially finalized reject may therefore have its `rejected` record present; recovery appends its `pending` record once. Reopen has one planned `pending` record. Completed operation IDs and step numbers prevent duplicate transitions.

## Failure handling

- A move failure before any filesystem change appends an abort marker and reports an archive error.
- A status append failure with no committed transition attempts to restore the clip only if the original path is free and the archive still matches the recorded identity. It then appends an abort marker.
- If rollback fails, or any transition step has already been appended, retain the intent and report the shot ID and recovery state. Later recovery proceeds forward when the saved identities still match.
- Existing or conflicting destinations are never replaced. Unknown path combinations fail closed and preserve both files for manual recovery.
- Missing source clips remain a supported baseline outcome when both source and archive are absent before the intent is created.

## Compatibility and limits

The normal user commands, transition statuses, cumulative `attempt_count`, cumulative `credits_spent`, and attempt naming convention do not change. Existing records omit the optional marker. The protocol makes persistence boundaries detectable and recoverable; it does not make filesystem operations and JSONL writes one atomic transaction.

## Verification

Fault injection covers stops after intent append, between archive link and source unlink, after archive movement, after the first reject record, and after all transition records. Baselines cover normal reject/reopen, missing source, archive failure, status append failure with rollback, and pre-existing attempt destinations. Assertions inspect both the status log and clip bytes/paths after re-entering recovery.
