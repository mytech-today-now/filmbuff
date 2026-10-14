# Proposal

## Why

`08-video-status.jsonl` is project-controlled input, but current reject, reopen, recovery, and compile paths resolve `clip_path` directly. A crafted relative or absolute path can therefore reach filesystem operations and archive or pass unrelated local media to ffmpeg.

## What Changes

- Add a shared resolver for status-controlled media paths. It canonicalizes the project root, rejects rooted and parent-traversing paths across Windows and POSIX separators, rejects symlink components, and requires existing targets to be regular files.
- Use the resolver before lifecycle checkpoint writes, media inspection or movement, restart recovery, ffmpeg input, and ZIP clip entries.
- Return the stable `INVALID_PROJECT_MEDIA_PATH` code for invalid paths without changing status history or media. Preserve the existing explicit missing-source result for reject/reopen.
- Validate every compile input before creating output files or invoking ffmpeg. Propagate unexpected filesystem and archive errors instead of reporting compile success.
- Keep current status schemas, lifecycle ordering, valid relative paths, and agent-mode envelope fields.

## Capabilities

### New Capabilities

- `video-clip-path-safety`: safe handling of project-controlled video media paths at filesystem boundaries.

### Modified Capabilities

None.

## Impact

- Affected implementation: `cli/src/lib/status-file-manager.ts`, `cli/src/commands/video/compile.ts`, and a new shared CLI library module.
- Affected verification: status manager, video compile, video subcommand, and lifecycle recovery tests.
- No new dependencies, status schema changes, provider changes, or user-path-specific diagnostics.
- Related Beads issue: `bd-7l09`.
