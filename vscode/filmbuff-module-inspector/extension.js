'use strict';

const vscode = require('vscode');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
  buildCliInvocation,
  findModuleRoot,
  getModuleNameFromPath,
  renderOptimizationSuggestionsMarkdown
} = require('./utils');

const execFileAsync = promisify(execFile);

async function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('filmbuff.inspectModule', async uri => {
      await openInspectionReport(uri);
    }),
    vscode.commands.registerCommand('filmbuff.inspectModuleOptimizations', async uri => {
      await openOptimizationSuggestions(uri);
    })
  );
}

async function openInspectionReport(uri) {
  try {
    const selection = resolveSelection(uri);
    const payload = await runCli(selection, 'inspect');
    if (!payload.reportPath) {
      throw new Error('Inspection report path missing from CLI output.');
    }

    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(payload.reportPath), { preview: true });
  } catch (error) {
    vscode.window.showErrorMessage(`FilmBuff inspection failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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
    vscode.window.showErrorMessage(`FilmBuff optimization suggestions failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveSelection(uri) {
  const resource = uri || vscode.window.activeTextEditor?.document?.uri;
  if (!resource || resource.scheme !== 'file') {
    throw new Error('Select or open a supported file inside augment-extensions before running FilmBuff inspection.');
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(resource) || vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('Open the FilmBuff workspace before using module inspection commands.');
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const moduleRoot = findModuleRoot(resource.fsPath);
  if (!moduleRoot) {
    throw new Error('Could not find a module.json file for the selected resource.');
  }

  const moduleName = getModuleNameFromPath(moduleRoot, workspaceRoot);
  if (!moduleName) {
    throw new Error('The selected resource is not inside augment-extensions/<type>/<module>.');
  }

  return {
    workspaceRoot,
    moduleName
  };
}

async function runCli(selection, mode) {
  const invocation = buildCliInvocation({
    workspaceRoot: selection.workspaceRoot,
    moduleName: selection.moduleName,
    mode
  });
  const { stdout } = await execFileAsync(invocation.command, invocation.args, invocation.options);
  return JSON.parse(stdout);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};