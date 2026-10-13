# MCP Configuration

## Primary config surfaces

- `.augment/mcp/servers.json` stores CLI-side server definitions.
- `.vscode/mcp.json` stores editor/runtime MCP wiring.
- `.vscode/MCP_SETUP.md` documents local setup and troubleshooting.

## Guidance

- Keep server definitions explicit and reviewable.
- Prefer the smallest permissions and environment scope needed.
- When troubleshooting, confirm the CLI and editor configs describe the same servers and transport expectations.

## Video workflow MCP over HTTP

`filmbuff mcp-server --transport http` exposes video workflow tools that can change project media or submit provider work. Configure a non-empty `FILMBUFF_MCP_TOKEN` in the server process environment before starting it. If the variable is unset, empty, or whitespace-only, startup is refused. Requests must use `Authorization: Bearer <token>`; missing, malformed, or incorrect credentials receive HTTP 401 before MCP request handling.

The HTTP listener binds only to `127.0.0.1`; the CLI has no direct remote-bind option. Use a local client or stdio when no reviewed proxy is available. For remote clients, use a separately reviewed TLS-terminating proxy on the same host that forwards only to `127.0.0.1`. The proxy must protect the Bearer token in transit, must not log the `Authorization` header, and must not make the MCP listener directly reachable from the network. Keep the token in a secret-managed environment variable and out of source control, command-line arguments, and diagnostics.

## Compatibility note

The checked-in `.augment/mcp/*.md` files are compact pointers only; this module is the long-form reference.
