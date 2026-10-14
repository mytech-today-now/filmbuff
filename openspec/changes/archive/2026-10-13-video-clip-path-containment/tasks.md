# Tasks

## 1. Shared Resolver

- [x] 1.1 Add the shared resolver and stable error; verify empty, drive, POSIX, mixed-separator traversal, dot-segment, missing, symlink, and non-regular-file cases in the status manager Jest suite.

## 2. Lifecycle Protection

- [x] 2.1 Route archive, recovery, abort, and rollback paths through the resolver before checkpoints or file operations; verify existing lifecycle recovery Vitest cases still pass.
- [x] 2.2 Add reject/reopen and interrupted-intent sentinel tests; verify status JSONL bytes and outside-file hashes remain unchanged on invalid paths.

## 3. Compile Protection

- [x] 3.1 Preflight all eligible clips before output creation and reuse validated paths for ffmpeg and ZIP entries; verify nested legacy paths still compile.
- [x] 3.2 Add traversal, absolute-path, symlink, missing-source, and archive-failure assertions; verify invalid paths create no outputs, call no ffmpeg, and add no ZIP entries.

## 4. Integration

- [x] 4.1 Link `bd-7l09`, the new spec, and affected files in coordination metadata; verify the JSON parses and the Beads record shows the expected status.
- [x] 4.2 Run the requested Jest and Vitest commands, relevant lint/build checks, and `openspec validate`; record exact results.

## Workflow follow-up

- Archive this change after implementation and verification tasks are complete, then verify its archived spec and final OpenSpec status.
