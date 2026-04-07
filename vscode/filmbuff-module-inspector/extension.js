'use strict';

/**
 * FilmBuff Module Inspector — VS Code Extension
 *
 * Commands registered:
 *   filmbuff.inspectModule           — Opens the HTML inspection report in the editor
 *   filmbuff.inspectModuleOptimizations — Opens optimization suggestions as Markdown
 *   filmbuff.showWebviewReport       — Opens an interactive WebviewPanel with:
 *                                        • In-panel section navigation (Summary, Files,
 *                                          Recommendations, Optimizations)
 *                                        • Export to user-selected file via Save Dialog
 *                                        • Refresh: re-runs the CLI and reloads the panel
 *
 * Implements: bd-modinsp.4.4 (Webview Integration)
 */

const vscode = require('vscode');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
  buildCliInvocation,
  findModuleRoot,
  getModuleNameFromPath,
  renderOptimizationSuggestionsMarkdown
} = require('./utils');

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Active WebviewPanel registry (module full-name → WebviewPanel)
// ---------------------------------------------------------------------------
/** @type {Map<string, import('vscode').WebviewPanel>} */
const _webviewPanels = new Map();

// ---------------------------------------------------------------------------
// activate
// ---------------------------------------------------------------------------

async function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('filmbuff.inspectModule', async uri => {
      await openInspectionReport(uri);
    }),
    vscode.commands.registerCommand('filmbuff.inspectModuleOptimizations', async uri => {
      await openOptimizationSuggestions(uri);
    }),
    vscode.commands.registerCommand('filmbuff.showWebviewReport', async uri => {
      await openInspectionWebview(context, uri);
    })
  );
}

// ---------------------------------------------------------------------------
// Original editor-based inspection report
// ---------------------------------------------------------------------------

async function openInspectionReport(uri) {
  try {
    const selection = resolveSelection(uri);
    const payload = await runCli(selection, 'inspect');
    if (!payload.reportPath) {
      throw new Error('Inspection report path missing from CLI output.');
    }
    await vscode.commands.executeCommand(
      'vscode.open',
      vscode.Uri.file(payload.reportPath),
      { preview: true }
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `FilmBuff inspection failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Optimization suggestions (Markdown in editor)
// ---------------------------------------------------------------------------

async function openOptimizationSuggestions(uri) {
  try {
    const selection = resolveSelection(uri);
    const payload = await runCli(selection, 'optimization');
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: renderOptimizationSuggestionsMarkdown(selection.moduleName, payload.suggestions || [])
    });
    await vscode.window.showTextDocument(document, { preview: true });
  } catch (error) {
    vscode.window.showErrorMessage(
      `FilmBuff optimization suggestions failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Interactive WebviewPanel (bd-modinsp.4.4)
// ---------------------------------------------------------------------------

/**
 * Open (or reveal if already open) an interactive inspection WebviewPanel for
 * the module containing the given resource URI.
 *
 * @param {import('vscode').ExtensionContext} context
 * @param {import('vscode').Uri | undefined} uri
 */
async function openInspectionWebview(context, uri) {
  let selection;
  try {
    selection = resolveSelection(uri);
  } catch (error) {
    vscode.window.showErrorMessage(
      `FilmBuff: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  const { moduleName } = selection;

  // Reveal existing panel if it is still open.
  const existing = _webviewPanels.get(moduleName);
  if (existing) {
    existing.reveal(vscode.ViewColumn.One);
    return;
  }

  // Create the panel before running the CLI so the user sees it immediately.
  const panel = vscode.window.createWebviewPanel(
    'filmbuffInspection',
    `FilmBuff: ${moduleName}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],  // no local file access needed
    }
  );
  _webviewPanels.set(moduleName, panel);

  panel.webview.html = buildLoadingHtml(moduleName);

  // Run CLI, then populate the webview.
  let reportPath;
  try {
    const payload = await runCli(selection, 'inspect');
    if (!payload.reportPath) throw new Error('reportPath missing from CLI output');
    reportPath = payload.reportPath;
    panel.webview.html = buildWebviewHtml(panel.webview, moduleName, reportPath);
  } catch (error) {
    panel.webview.html = buildErrorHtml(
      moduleName,
      error instanceof Error ? error.message : String(error)
    );
    vscode.window.showErrorMessage(
      `FilmBuff inspection failed: ${error instanceof Error ? error.message : String(error)}`
    );
    _webviewPanels.delete(moduleName);
    return;
  }

  // Handle messages from the webview JavaScript.
  panel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.command) {
        case 'export':
          await handleExport(moduleName, reportPath);
          break;
        case 'refresh':
          await handleRefresh(panel, selection, moduleName);
          // Update local reportPath reference after refresh.
          reportPath = _currentReportPath.get(moduleName) ?? reportPath;
          break;
      }
    },
    undefined,
    context.subscriptions
  );

  // Clean up registry when the panel is closed.
  panel.onDidDispose(() => {
    _webviewPanels.delete(moduleName);
    _currentReportPath.delete(moduleName);
  }, undefined, context.subscriptions);
}

/** Tracks the latest reportPath after a refresh, keyed by moduleName. */
const _currentReportPath = new Map();

/**
 * Export the HTML report to a user-chosen location via Save Dialog.
 *
 * @param {string} moduleName
 * @param {string} reportPath
 */
async function handleExport(moduleName, reportPath) {
  const safeBaseName = moduleName.replace(/[/\\]/g, '-');
  const defaultName  = `${safeBaseName}-inspection.html`;

  const destination = await vscode.window.showSaveDialog({
    title:      'Export Inspection Report',
    defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', defaultName)),
    filters:    { 'HTML Report': ['html'], 'All Files': ['*'] },
  });

  if (!destination) return;   // user cancelled

  try {
    const content = fs.readFileSync(reportPath, 'utf-8');
    fs.writeFileSync(destination.fsPath, content, 'utf-8');
    vscode.window.showInformationMessage(
      `Inspection report exported to ${destination.fsPath}`
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Export failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Refresh: re-run the CLI and reload the webview HTML.
 *
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ workspaceRoot: string; moduleName: string }} selection
 * @param {string} moduleName
 */
async function handleRefresh(panel, selection, moduleName) {
  const previousTitle = panel.title;
  panel.title = `FilmBuff: ${moduleName} (refreshing…)`;

  try {
    const payload = await runCli(selection, 'inspect');
    if (!payload.reportPath) throw new Error('reportPath missing from CLI output');
    _currentReportPath.set(moduleName, payload.reportPath);
    panel.webview.html = buildWebviewHtml(panel.webview, moduleName, payload.reportPath);
    panel.title = `FilmBuff: ${moduleName}`;
  } catch (error) {
    panel.title = previousTitle;
    vscode.window.showErrorMessage(
      `FilmBuff refresh failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ---------------------------------------------------------------------------
// HTML builders
// ---------------------------------------------------------------------------

/**
 * Inject the webview toolbar (navigation, export, refresh) into the CLI-
 * generated HTML inspection report and return the full HTML string.
 *
 * The generated HTML report already contains a navigation bar keyed by
 * section IDs (#summary, #files, #recommendations, #optimizations).  We
 * prepend a compact extension-controlled toolbar so the user can:
 *   - Jump to a named section      → scrollIntoView() in the webview
 *   - Export the report to a file  → postMessage({ command: 'export' })
 *   - Refresh the report           → postMessage({ command: 'refresh' })
 *
 * @param {import('vscode').Webview} webview
 * @param {string} moduleName
 * @param {string} reportPath  Absolute path to the generated .html file
 * @returns {string}
 */
function buildWebviewHtml(webview, moduleName, reportPath) {
  const nonce        = crypto.randomBytes(16).toString('hex');
  const cspSource    = webview.cspSource;
  const reportHtml   = fs.readFileSync(reportPath, 'utf-8');

  // Strip existing <!doctype> / <html> / <head> / <body> wrapper so we can
  // inject our own CSP meta tag and toolbar script.
  const bodyMatch = reportHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const innerHtml = bodyMatch ? bodyMatch[1] : reportHtml;

  const toolbar = `
<div id="wb-toolbar" style="
  position:sticky;top:0;z-index:9999;
  display:flex;align-items:center;gap:8px;
  padding:8px 16px;
  background:#0f172a;border-bottom:1px solid #334155;
  font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:#e2e8f0;">
  <strong style="color:#38bdf8;margin-right:8px">FilmBuff</strong>
  <button onclick="scrollTo('summary')"    class="wb-nav">Summary</button>
  <button onclick="scrollTo('files')"      class="wb-nav">Files</button>
  <button onclick="scrollTo('recommendations')" class="wb-nav">Recommendations</button>
  <button onclick="scrollTo('optimizations')"   class="wb-nav">Optimizations</button>
  <span style="flex:1"></span>
  <button onclick="vscExport()"  class="wb-action">⬇ Export</button>
  <button onclick="vscRefresh()" class="wb-action">↺ Refresh</button>
</div>`;

  const style = `
<style nonce="${nonce}">
  .wb-nav,.wb-action {
    padding:4px 10px;border-radius:5px;border:none;cursor:pointer;
    font-size:12px;font-family:inherit;
  }
  .wb-nav    { background:#1e3a5f;color:#93c5fd; }
  .wb-nav:hover { background:#1d4ed8;color:#fff; }
  .wb-action { background:#164e63;color:#67e8f9; }
  .wb-action:hover { background:#0e7490;color:#fff; }
</style>`;

  const script = `
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  function scrollTo(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function vscExport()  { vscode.postMessage({ command: 'export' }); }
  function vscRefresh() { vscode.postMessage({ command: 'refresh' }); }
</script>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src  ${cspSource} 'nonce-${nonce}' 'unsafe-inline';
                 script-src ${cspSource} 'nonce-${nonce}';" />
  <title>FilmBuff: ${escapeHtml(moduleName)}</title>
  ${style}
</head>
<body style="margin:0;padding:0">
  ${toolbar}
  <div id="report-body" style="padding:0 24px 40px">
    ${innerHtml}
  </div>
  ${script}
</body>
</html>`;
}

/** Minimal HTML shown while the CLI is running. */
function buildLoadingHtml(moduleName) {
  return `<!doctype html><html><body
    style="font-family:Segoe UI,sans-serif;background:#0f172a;color:#94a3b8;
           display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
    <p>Generating inspection report for <strong>${escapeHtml(moduleName)}</strong>…</p>
  </body></html>`;
}

/** Error page shown when the CLI fails. */
function buildErrorHtml(moduleName, message) {
  return `<!doctype html><html><body
    style="font-family:Segoe UI,sans-serif;background:#0f172a;color:#f87171;padding:32px">
    <h2>Inspection failed for ${escapeHtml(moduleName)}</h2>
    <pre style="white-space:pre-wrap;color:#fca5a5">${escapeHtml(message)}</pre>
  </body></html>`;
}

/** Minimal HTML escaping for user-supplied strings embedded in HTML. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function resolveSelection(uri) {
  const resource = uri || vscode.window.activeTextEditor?.document?.uri;
  if (!resource || resource.scheme !== 'file') {
    throw new Error(
      'Select or open a supported file inside filmbuff before running FilmBuff inspection.'
    );
  }

  const workspaceFolder =
    vscode.workspace.getWorkspaceFolder(resource) ||
    vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('Open the FilmBuff workspace before using module inspection commands.');
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const moduleRoot    = findModuleRoot(resource.fsPath);
  if (!moduleRoot) {
    throw new Error('Could not find a module.json file for the selected resource.');
  }

  const moduleName = getModuleNameFromPath(moduleRoot, workspaceRoot);
  if (!moduleName) {
    throw new Error('The selected resource is not inside filmbuff/<type>/<module>.');
  }

  return { workspaceRoot, moduleName };
}

async function runCli(selection, mode) {
  const invocation = buildCliInvocation({
    workspaceRoot: selection.workspaceRoot,
    moduleName:    selection.moduleName,
    mode,
  });
  const { stdout } = await execFileAsync(
    invocation.command,
    invocation.args,
    invocation.options
  );
  return JSON.parse(stdout);
}

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

function deactivate() {
  // Dispose all open panels on deactivation.
  for (const panel of _webviewPanels.values()) {
    panel.dispose();
  }
  _webviewPanels.clear();
  _currentReportPath.clear();
}

module.exports = { activate, deactivate };
