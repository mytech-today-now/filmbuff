'use strict';

require('ts-node/register/transpile-only');

const fs = require('fs');
const Module = require('module');
const path = require('path');

// Production TypeScript uses .js import specifiers for compiled output. In this
// isolated source-level child, resolve those specifiers to sibling .ts files.
const sourceRoot = `${path.resolve(__dirname, '../..')}${path.sep}`;
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveSourceImport(request, parent, isMain, options) {
  if (parent?.filename?.startsWith(sourceRoot) && request.endsWith('.js')) {
    const sourcePath = path.resolve(
      path.dirname(parent.filename),
      `${request.slice(0, -3)}.ts`,
    );
    if (fs.existsSync(sourcePath)) request = sourcePath;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { mcpServerCommand } = require(path.join(sourceRoot, 'commands', 'mcp-server.ts'));
const [project, transport, rawPort] = process.argv.slice(2);

void mcpServerCommand({ project, transport, port: Number(rawPort) }).catch(() => {
  process.stderr.write('[filmbuff mcp-server] Child command failed\n');
  process.exitCode = 1;
});
