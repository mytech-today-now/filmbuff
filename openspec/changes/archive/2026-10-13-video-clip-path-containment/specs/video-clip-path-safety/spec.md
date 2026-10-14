# Spec Delta

## Purpose

Keep filesystem operations driven by persisted video status paths within the canonical project root.

## ADDED Requirements

### Requirement: Persisted clip paths remain within the project root

The CLI MUST resolve persisted media paths against the canonical project root and reject empty, absolute, drive-rooted, UNC-rooted, parent-traversing, or otherwise escaping paths under Windows and POSIX separator rules.

#### Scenario: Reject absolute and traversing paths

- **WHEN** a status record contains a drive path, POSIX path, or path with a `..` segment using either slash convention
- **THEN** the resolver MUST return `INVALID_PROJECT_MEDIA_PATH`
- **AND** it MUST NOT inspect or change the outside target

#### Scenario: Preserve nested project-relative paths

- **WHEN** a status record contains a nested relative path using either separator convention and its target is a regular file inside the project
- **THEN** lifecycle operations and compile MUST resolve that file inside the canonical project root

### Requirement: Reject symlinked and non-file media targets

The CLI MUST reject existing symlink components and existing targets that are not regular files. Only a missing path may produce a missing-source result; other filesystem errors MUST remain failures.

#### Scenario: Reject an in-project symlink to an outside target

- **WHEN** any existing path component is a symlink, including one that points outside the project
- **THEN** the resolver MUST return `INVALID_PROJECT_MEDIA_PATH` before media is read, moved, or archived

#### Scenario: Preserve a missing lifecycle source result

- **WHEN** a valid project-relative source file is missing during reject or reopen
- **THEN** the existing explicit `missing` archive outcome and state-transition ordering MUST be preserved

#### Scenario: Fail on unexpected filesystem errors

- **WHEN** path inspection or media archiving fails for a reason other than a missing path
- **THEN** the CLI MUST report an error and MUST NOT report the operation as successful

### Requirement: Validate lifecycle and compile paths before side effects

Lifecycle operations MUST resolve source and archive paths before writing an intent or moving media. Compile MUST resolve every selected clip before creating output files, invoking ffmpeg, or creating ZIP clip entries.

#### Scenario: Reject unsafe lifecycle state without mutation

- **WHEN** reject, reopen, or recovery encounters an unsafe status or intent path
- **THEN** it MUST return `INVALID_PROJECT_MEDIA_PATH`
- **AND** status history and referenced files MUST remain unchanged

#### Scenario: Reject an unsafe compile input before output creation

- **WHEN** compile selects a status record with an unsafe clip path
- **THEN** it MUST fail before creating compile outputs or invoking ffmpeg
- **AND** it MUST preserve the agent-mode envelope fields and omit the rejected path from diagnostics
