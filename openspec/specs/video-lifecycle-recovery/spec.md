# video-lifecycle-recovery Specification

## Purpose
Recover interrupted `video reject` and `video reopen` operations without losing or replacing attempt clips, duplicating status transitions, or changing cumulative shot counters.
## Requirements
### Requirement: Reject and reopen intents use the append-only status log

The CLI SHALL persist reject/reopen intent and completion markers as optional metadata on ordinary status records in `08-video-status.jsonl`. Existing records without this metadata MUST remain valid, and no status record or marker may be edited in place.

#### Scenario: Read a legacy status record

- **WHEN** the status log contains records without lifecycle markers
- **THEN** the status manager MUST read each record using the existing status schema
- **AND** the last record for a shot MUST continue to define its current state

#### Scenario: Begin a reject or reopen operation

- **WHEN** reject or reopen has validated its current shot state and clip paths
- **THEN** the CLI MUST append an intent containing the operation ID, planned status records, source/archive paths, and source file identity before moving the clip
- **AND** the intent record MUST preserve the prior shot state and cumulative counters

### Requirement: Status reads and writes reconcile interrupted lifecycle operations

The status manager MUST reconcile unfinished reject/reopen intents under the status-file lock before returning `getLatestState()` or appending ordinary status records. Recovery MUST append only missing transition steps for the same operation ID.

#### Scenario: Stop after the intent append

- **WHEN** a process stops after the intent is appended and before the clip is archived
- **AND** a later command reads or writes status
- **THEN** recovery MUST archive the matching source clip and append the planned transition records exactly once

#### Scenario: Stop between archive link creation and source removal

- **WHEN** a process stops with source and archive paths pointing to the same recorded file identity
- **AND** a later command reads or writes status
- **THEN** recovery MUST finish the move without replacing either path
- **AND** the archived attempt clip MUST remain readable

#### Scenario: Stop after archive movement

- **WHEN** a process stops after the source is archived but before any transition record is committed
- **AND** a later command reads or writes status
- **THEN** recovery MUST recognize the archive by its recorded identity and append the planned transitions once

#### Scenario: Stop after only the rejected record is committed

- **WHEN** reject has appended its `rejected` record but not its following `pending` record
- **AND** a later command reads or writes status
- **THEN** recovery MUST append the missing `pending` record without duplicating `rejected`

#### Scenario: Stop after all transition records are committed

- **WHEN** a process stops after the full reject or reopen transition is appended
- **AND** recovery is entered again
- **THEN** recovery MUST leave the transition count unchanged
- **AND** the attempt clip MUST remain at its archive path

### Requirement: Lifecycle recovery preserves clips and cumulative state

Reject/reopen recovery MUST preserve existing transition semantics, attempt clips, `attempt_count`, and cumulative `credits_spent`. It MUST NOT replace a pre-existing attempt destination. An unknown or conflicting restart state MUST fail closed with the shot ID and a concise recovery instruction.

#### Scenario: Status append fails before any transition is committed

- **WHEN** the clip has moved but no transition record was appended
- **AND** the status append fails
- **THEN** the CLI MUST restore the clip only when the original path is free and the archived file matches the recorded identity
- **AND** it MUST report a rollback failure and retain recoverable intent if restoration fails

#### Scenario: Attempt destination already exists

- **WHEN** reject or reopen finds an existing attempt destination
- **THEN** the CLI MUST leave both existing files and the status state unchanged
- **AND** it MUST report the shot ID and the archive conflict

#### Scenario: Restart paths do not match the intent

- **WHEN** neither path or both different files conflict with the recorded source identity
- **THEN** the CLI MUST preserve the files and stop recovery
- **AND** the error MUST identify the shot and state that manual recovery is required

#### Scenario: Recovery keeps counters unchanged

- **WHEN** a reject or reopen is recovered after any persistence boundary
- **THEN** every committed transition MUST retain the original `attempt_count` and `credits_spent`
- **AND** recovery MUST NOT reset or charge either counter
