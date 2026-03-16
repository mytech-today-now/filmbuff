# MCP Implementation Notes

## Code locations

- `cli/src/utils/mcp-integration.ts` contains the integration helpers.
- `cli/src/commands/mcp.ts` exposes the CLI surface.

## Practical reminders

- Treat `.augment/mcp/servers.json` as the persisted CLI config.
- Keep long narrative documentation out of `.augment/`.
- Use the compact stubs under `.augment/mcp/` as compatibility entrypoints, not as the full reference.