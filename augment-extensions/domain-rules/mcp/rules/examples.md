# MCP Examples

## Typical tasks

- list configured servers
- discover tools exposed by a server
- execute a tool with structured JSON arguments
- compare editor and CLI configuration when discovery works in one place but not the other

## Example command shapes

Use the active CLI name in this checkout for:

- `mcp list`
- `mcp discover <server>`
- `mcp exec <server> <tool> --args '{...}'`

Check the generated command help or local CLI help if the binary name differs between versions.