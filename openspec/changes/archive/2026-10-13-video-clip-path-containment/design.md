# Design

## Context

See `proposal.md` for the risk and `specs/video-clip-path-safety/spec.md` for the required behavior. The project currently stores clip paths in JSONL and recovery intents and uses them later for filesystem operations.

## Goals / Non-Goals

**Goals:**

- Give lifecycle and compile code one resolver and one stable invalid-path error.
- Validate all path components before state or media changes.
- Keep historical relative paths, missing-source lifecycle results, state ordering, and agent envelope fields compatible.

**Non-Goals:**

- Change the status record schema or validate unrelated project/output options.
- Redesign the archive outcome API or lifecycle state machine.
- Make path-based operations atomic against a concurrent local process replacing checked directories.

## Decisions

1. **Canonical root and cross-platform syntax:** Resolve the project root with `realpath`. Treat both slash forms as separators, reject POSIX and Windows rooted paths, drive prefixes, NUL bytes, empty paths, and every `..` segment. Ignore harmless `.` and repeated separators. Then check the lexical relative path against the canonical root.
2. **Existing components and missing paths:** Walk components with `lstat`, reject symlinks, require directory parents and a regular-file leaf, and confirm an existing leaf with `realpath`. Return `missing` only on `ENOENT`; propagate permission, I/O, and other errors. Emit `ProjectMediaPathError` with code `INVALID_PROJECT_MEDIA_PATH` and a generic message that never includes the supplied path.
3. **Lifecycle ordering:** Resolve the source and derived archive target before inspecting identities or appending an intent. Persist normalized project-relative intent paths. Recovery, abort checks, and rollback resolve both intent paths again before any inspection or movement. A missing valid source still follows the existing missing outcome.
4. **Compile preflight:** Resolve every eligible record before output-directory creation or any generated output. Reuse validated absolute paths for ffmpeg and ZIP sources, and the normalized relative path for viewer packaging. A missing compile source returns `NOT_FOUND` before outputs are created. Only an actually missing `archiver` package retains the current non-fatal skip; archive I/O errors fail compilation.

## Risks / Trade-offs

- **Concurrent filesystem replacement:** Component checks and later operations are separate calls, so a local writer could race by replacing a checked directory. The resolver closes static traversal and symlink attacks; descriptor-relative operations would be needed to remove this race portably.
- **Older separator conventions:** Normalizing both slash forms may change the display form of paths in archive results, while preserving their project-relative target and package behavior.

## Migration Plan

No data migration is required. Existing safe relative paths remain valid; only unsafe or non-regular path targets fail closed.
