/**
 * cli/src/lib/agent-mode.ts
 *
 * Shared agent-mode detection, machine-readable exit codes, and
 * structured JSON output helpers for all `filmbuff video` sub-commands.
 *
 * Spec: openspec/changes/filmb-ai-p/specs/agent-mode/spec.md
 * Beads: bd-7767 (Phase 5 — AC-16 through AC-22)
 *
 * Agent mode activates (in priority order) when:
 *   1. --no-interactive or --agent CLI flag is present
 *   2. FILMBUFF_AGENT_MODE=1 env var is set
 *   3. stdin is not a TTY (!process.stdin.isTTY)
 *
 * Security (AC-27):
 *   - AIPOWERED_AGENT_TOKEN is resolved HERE and passed as agentToken.
 *   - It MUST NOT be included in any output stream or log.
 */

// ---------------------------------------------------------------------------
// Exit codes — version-stable; never renumber existing codes
// ---------------------------------------------------------------------------

export const EXIT = {
  SUCCESS:              0,
  GENERAL_ERROR:        1,
  NOT_FOUND:            2,
  INSUFFICIENT_CREDITS: 3,
  PROVIDER_ERROR:       4,
  STATE_CONFLICT:       5,
  INVALID_ARGS:         6,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Symbolic name for each exit code (used in JSON errorCode field). */
export const EXIT_NAME: Record<ExitCode, string> = {
  [EXIT.SUCCESS]:              'SUCCESS',
  [EXIT.GENERAL_ERROR]:        'GENERAL_ERROR',
  [EXIT.NOT_FOUND]:            'NOT_FOUND',
  [EXIT.INSUFFICIENT_CREDITS]: 'INSUFFICIENT_CREDITS',
  [EXIT.PROVIDER_ERROR]:       'PROVIDER_ERROR',
  [EXIT.STATE_CONFLICT]:       'STATE_CONFLICT',
  [EXIT.INVALID_ARGS]:         'INVALID_ARGS',
};

// ---------------------------------------------------------------------------
// Agent mode detection
// ---------------------------------------------------------------------------

/**
 * Returns true if agent mode is active.
 *
 * Priority order:
 *   1. agentFlag — --agent or --no-interactive CLI flag
 *   2. FILMBUFF_AGENT_MODE=1 environment variable
 *   3. stdin is not a TTY
 */
export function isAgentMode(agentFlag?: boolean): boolean {
  if (agentFlag === true) return true;
  if (process.env['FILMBUFF_AGENT_MODE'] === '1') return true;
  if (!process.stdin.isTTY) return true;
  return false;
}

// ---------------------------------------------------------------------------
// JSON output envelope
// ---------------------------------------------------------------------------

export interface AgentEnvelope {
  status:       'success' | 'error';
  data:         unknown | null;
  creditsSpent: number;
  shotId:       string | null;
  errorCode:    string | null;
}

/** Emit success JSON to stdout (agent mode). */
export function agentSuccess(
  data: unknown,
  opts: { creditsSpent?: number; shotId?: string | null } = {},
): void {
  const envelope: AgentEnvelope = {
    status:       'success',
    data,
    creditsSpent: opts.creditsSpent ?? 0,
    shotId:       opts.shotId ?? null,
    errorCode:    null,
  };
  process.stdout.write(JSON.stringify(envelope) + '\n');
}

/** Emit error JSON to stdout AND error JSON to stderr (agent mode). */
export function agentError(
  code:    ExitCode,
  message: string,
  opts:    { shotId?: string | null; creditsSpent?: number } = {},
): void {
  const envelope: AgentEnvelope = {
    status:       'error',
    data:         null,
    creditsSpent: opts.creditsSpent ?? 0,
    shotId:       opts.shotId ?? null,
    errorCode:    EXIT_NAME[code],
  };
  process.stdout.write(JSON.stringify(envelope) + '\n');
  process.stderr.write(
    JSON.stringify({ error: { code: EXIT_NAME[code], message } }) + '\n',
  );
}

// ---------------------------------------------------------------------------
// Credential resolution (AC-27)
// ---------------------------------------------------------------------------

/**
 * Resolve the agent token for provider API calls.
 *
 * Priority:
 *   AIPOWERED_AGENT_TOKEN (per-call override) → AIPOWERED_API_KEY (global)
 *
 * The resolved token MUST NOT be logged, printed, or written to any file.
 */
export function resolveAgentToken(): string | undefined {
  return process.env['AIPOWERED_AGENT_TOKEN'] ?? process.env['AIPOWERED_API_KEY'];
}

// ---------------------------------------------------------------------------
// Human-mode helpers
// ---------------------------------------------------------------------------

/** Strip ANSI codes from a string (for agent-mode safe output). */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Write a human-readable message to stdout.
 * In agent mode this is suppressed (stdout is reserved for the JSON envelope).
 */
export function humanLog(msg: string, agentMode: boolean): void {
  if (!agentMode) process.stdout.write(msg + '\n');
}

/**
 * Write a warning to stderr.
 * In agent mode the text is still written to stderr (watchdog warnings etc.)
 * but without ANSI codes.
 */
export function warnLog(msg: string, agentMode: boolean): void {
  if (agentMode) {
    process.stderr.write(stripAnsi(msg) + '\n');
  } else {
    process.stderr.write(msg + '\n');
  }
}
