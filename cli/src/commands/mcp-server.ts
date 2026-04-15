/**
 * cli/src/commands/mcp-server.ts
 *
 * `filmbuff mcp-server` — MCP Tool Server (WS-4)
 *
 * Exposes 10 video workflow tools + 1 resource over stdio or Streamable HTTP.
 *
 * Usage:
 *   filmbuff mcp-server                                     # stdio
 *   filmbuff mcp-server --transport http --port 3742        # HTTP
 *   filmbuff mcp-server --project ./my-film --port 3742
 *
 * HTTP auth: Authorization: Bearer <FILMBUFF_MCP_TOKEN>
 *            Missing/invalid token → HTTP 401.
 *
 * Spec: openspec/changes/filmb-ai-p/specs/agent-mode/spec.md §MCP Tool Server
 * Beads: bd-ea74 (Phase 6 — WS-4)
 */

import * as path from 'path';
import * as http from 'http';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getLatestState } from '../lib/status-file-manager.js';

// ── Video command handlers (agent-mode: true implicitly for all MCP calls) ──
import { videoInitCommand }        from './video/init.js';
import { videoNextCommand }        from './video/next.js';
import { videoGenerateCommand,
         videoRetryCommand }       from './video/generate.js';
import { videoApproveCommand }     from './video/approve.js';
import { videoRejectCommand }      from './video/reject.js';
import { videoStatusCommand }      from './video/status.js';
import { videoCompileCommand }     from './video/compile.js';
import { videoReopenCommand }      from './video/reopen.js';
import { videoGenerateAllCommand } from './video/generate-all.js';

export interface McpServerOptions {
  project:    string;
  transport?: string;   // 'stdio' | 'http'
  port?:      number;
}

// re-export for use in runCommandCapture return type
type McpCallResult = CallToolResult;

// ---------------------------------------------------------------------------
// Tool invocation helper — calls command handlers and captures JSON output
// ---------------------------------------------------------------------------

/**
 * Runs a video command handler in "capture mode":
 * - Intercepts process.exit() to prevent killing the MCP process.
 * - Intercepts stdout.write to capture the JSON envelope emitted by agentMode.
 * Returns a McpCallResult always containing { content: [{type:'text', text}] }.
 */
async function runCommandCapture(fn: () => Promise<void>): Promise<McpCallResult> {
  let capturedText = '';
  let isError = false;

  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array, ..._rest: unknown[]): boolean => {
    capturedText += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  };

  const origExit = process.exit;
  (process as NodeJS.Process).exit = ((code?: number) => {
    if ((code ?? 0) !== 0) isError = true;
  }) as typeof process.exit;

  try {
    await fn();
  } catch (err) {
    isError = true;
    capturedText = JSON.stringify({
      status: 'error', data: null, creditsSpent: 0, shotId: null,
      errorCode: 'GENERAL_ERROR',
    });
  } finally {
    process.stdout.write = origWrite;
    (process as NodeJS.Process).exit = origExit;
  }

  const text = capturedText.trim() || JSON.stringify({
    status: 'error', data: null, creditsSpent: 0, shotId: null,
    errorCode: 'NO_OUTPUT',
  });

  return { isError: isError || undefined, content: [{ type: 'text' as const, text }] };
}

// ---------------------------------------------------------------------------
// Register MCP tools
// ---------------------------------------------------------------------------

function registerTools(mcp: McpServer, projectPath: string): void {
  const A = { agent: true };

  mcp.registerTool('video_init',
    { description: 'Initialize 08-video-status.jsonl for the project',
      inputSchema: { overwrite: z.boolean().optional().describe('Reinitialize even if already initialized') } },
    async (args, _extra) =>
      runCommandCapture(() => videoInitCommand({ project: projectPath, overwrite: args.overwrite, ...A })));

  mcp.registerTool('video_next',
    { description: 'Generate the next pending shot in order',
      inputSchema: { provider: z.string().optional(), timeoutSeconds: z.number().optional() } },
    async (args, _extra) =>
      runCommandCapture(() => videoNextCommand({ project: projectPath, provider: args.provider, timeout: args.timeoutSeconds, ...A })));

  mcp.registerTool('video_generate',
    { description: 'Generate a specific shot by ID',
      inputSchema: { shotId: z.string(), provider: z.string().optional(), notes: z.string().optional(), force: z.boolean().optional() } },
    async (args, _extra) =>
      runCommandCapture(() => videoGenerateCommand({ project: projectPath, shotId: args.shotId, provider: args.provider, notes: args.notes, force: args.force, ...A })));

  mcp.registerTool('video_retry',
    { description: 'Retry a failed or rejected shot',
      inputSchema: { shotId: z.string(), provider: z.string().optional(), notes: z.string().optional() } },
    async (args, _extra) =>
      runCommandCapture(() => videoRetryCommand({ project: projectPath, shotId: args.shotId, provider: args.provider, notes: args.notes, ...A })));

  mcp.registerTool('video_approve',
    { description: 'Approve one or more shots',
      inputSchema: { shots: z.array(z.string()).optional(), allComplete: z.boolean().optional() } },
    async (args, _extra) =>
      runCommandCapture(() => videoApproveCommand({ project: projectPath, shots: args.shots, allComplete: args.allComplete, ...A })));

  mcp.registerTool('video_reject',
    { description: 'Reject a shot with optional reason',
      inputSchema: { shotId: z.string(), reason: z.string().optional() } },
    async (args, _extra) =>
      runCommandCapture(() => videoRejectCommand({ project: projectPath, shotId: args.shotId, reason: args.reason, ...A })));

  mcp.registerTool('video_status',
    { description: 'Return current per-shot status as JSON',
      inputSchema: { filter: z.string().optional() } },
    async (args, _extra) =>
      runCommandCapture(() => videoStatusCommand({ project: projectPath, filter: args.filter, json: true, ...A })));

  mcp.registerTool('video_compile',
    { description: 'Compile approved shots into combined.mp4, index.html, project.zip',
      inputSchema: { include: z.string().optional(), titleCards: z.boolean().optional(), outputDir: z.string().optional() } },
    async (args, _extra) =>
      runCommandCapture(() => videoCompileCommand({ project: projectPath, include: args.include, titleCards: args.titleCards, outputDir: args.outputDir, ...A })));

  mcp.registerTool('video_reopen',
    { description: 'Reopen an approved shot for regeneration',
      inputSchema: { shotId: z.string(), reason: z.string().optional() } },
    async (args, _extra) =>
      runCommandCapture(() => videoReopenCommand({ project: projectPath, shotId: args.shotId, reason: args.reason, ...A })));

  mcp.registerTool('video_generate_all',
    { description: 'Batch-generate all pending shots until none remain',
      inputSchema: { provider: z.string().optional(), concurrency: z.number().optional() } },
    async (args, _extra) =>
      runCommandCapture(() => videoGenerateAllCommand({ project: projectPath, provider: args.provider, concurrency: args.concurrency, ...A })));
}

// ---------------------------------------------------------------------------
// Register MCP resource: video://status
// ---------------------------------------------------------------------------

function registerResources(mcp: McpServer, projectPath: string): void {
  mcp.resource(
    'video-status',
    'video://status',
    { description: 'Live 08-video-status.jsonl parsed as a JSON object', mimeType: 'application/json' },
    async (_uri: URL) => {
      const statusMap = await getLatestState(projectPath);
      const counts: Record<string, number> = {};
      for (const [, rec] of statusMap) {
        counts[rec.status] = (counts[rec.status] ?? 0) + 1;
      }
      const payload = {
        total_shots: statusMap.size,
        counts,
        shots: [...statusMap.values()].map(r => ({
          shot_id:       r.shot_id,
          status:        r.status,
          provider:      r.provider,
          attempt_count: r.attempt_count,
          credits_spent: r.credits_spent,
          updated_at:    r.updated_at,
        })),
      };
      return {
        contents: [{ uri: 'video://status', mimeType: 'application/json', text: JSON.stringify(payload) }],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function mcpServerCommand(opts: McpServerOptions): Promise<void> {
  const projectPath = path.resolve(opts.project);
  const transport   = opts.transport ?? 'stdio';

  const mcp = new McpServer({ name: 'filmbuff', version: '1.0.0' });

  registerTools(mcp, projectPath);
  registerResources(mcp, projectPath);

  if (transport === 'http') {
    const port    = opts.port ?? 3742;
    const mcpToken = process.env['FILMBUFF_MCP_TOKEN'];

    const httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    const server = http.createServer(async (req, res) => {
      // ── Bearer token auth ─────────────────────────────────────────────
      if (mcpToken) {
        const authHeader = req.headers['authorization'] ?? '';
        const provided   = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (provided !== mcpToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
      }
      await httpTransport.handleRequest(req, res);
    });

    await mcp.connect(httpTransport);
    server.listen(port, () => {
      process.stderr.write(`[filmbuff mcp-server] HTTP transport listening on port ${port}\n`);
    });

    // Keep alive
    await new Promise<void>(() => { /* run until SIGINT */ });
  } else {
    // stdio transport (default)
    const stdioTransport = new StdioServerTransport();
    await mcp.connect(stdioTransport);
    // Run until stdin closes
    await new Promise<void>((resolve) => {
      process.stdin.on('close', resolve);
    });
  }
}
