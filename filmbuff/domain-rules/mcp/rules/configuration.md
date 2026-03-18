# MCP Configuration

## Primary config surfaces

- `.augment/mcp/servers.json` stores CLI-side server definitions.
- `.vscode/mcp.json` stores editor/runtime MCP wiring.
- `.vscode/MCP_SETUP.md` documents local setup and troubleshooting.

## Guidance

- Keep server definitions explicit and reviewable.
- Prefer the smallest permissions and environment scope needed.
- When troubleshooting, confirm the CLI and editor configs describe the same servers and transport expectations.

## Compatibility note

The checked-in `.augment/mcp/*.md` files are compact pointers only; this module is the long-form reference.