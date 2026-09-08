/**
 * AI fallback reporter for generate-shot-list.
 *
 * Keeps fallback noise to one concise warning per generator run while allowing
 * opt-in debug detail through an explicit environment flag.
 */

export type AiFallbackSource = 'entity-extractor' | 'blocking-extractor';

function isMissingDependencyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' ? record.message : '';

  return (
    code === 'ERR_MODULE_NOT_FOUND' ||
    message.includes('ERR_MODULE_NOT_FOUND') ||
    message.includes('Cannot find module')
  );
}

function isDebugEnabled(): boolean {
  const value = String(process.env['FILMBUFF_AI_FALLBACK_DEBUG'] ?? '').toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function formatDebugMessage(source: AiFallbackSource, error: unknown): string {
  const record = error as { name?: unknown; code?: unknown; message?: unknown; stack?: unknown };
  const name = typeof record.name === 'string' ? record.name : 'Error';
  const code = typeof record.code === 'string' ? record.code : 'unknown';
  const message = typeof record.message === 'string' ? record.message : String(error);
  const stack = typeof record.stack === 'string' && record.stack.trim().length > 0
    ? `\n${record.stack}`
    : '';

  return `[AI fallback debug] ${source} | ${name} | code=${code} | ${message}${stack}`;
}

export class AiFallbackReporter {
  private warned = false;
  private debugLogged = false;
  private readonly debugEnabled = isDebugEnabled();

  reset(): void {
    this.warned = false;
    this.debugLogged = false;
  }

  report(source: AiFallbackSource, error: unknown): void {
    if (!this.warned) {
      const message = isMissingDependencyError(error)
        ? 'AI dependency unavailable; using fallback extraction for this run.'
        : 'AI extraction failed; using fallback extraction for this run.';
      console.warn(message);
      this.warned = true;
    }

    if (this.debugEnabled && !this.debugLogged) {
      console.debug(formatDebugMessage(source, error));
      this.debugLogged = true;
    }
  }
}
