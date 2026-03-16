'use strict';

const fs = require('fs');
const path = require('path');

const SUPPORTED_EXTENSIONS = [
  '.md', '.json', '.txt', '.ts', '.tsx', '.js', '.jsx', '.py', '.php', '.rb',
  '.go', '.rs', '.java', '.c', '.cpp', '.cs', '.sh', '.ps1', '.yml', '.yaml',
  '.xml', '.html', '.css', '.scss', '.sql'
];

function findModuleRoot(resourcePath) {
  let current = resourcePath;

  if (!fs.existsSync(current)) {
    current = path.dirname(current);
  } else if (fs.statSync(current).isFile()) {
    current = path.dirname(current);
  }

  while (true) {
    if (fs.existsSync(path.join(current, 'module.json'))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function getModuleNameFromPath(moduleRoot, workspaceRoot) {
  const modulesRoot = path.join(workspaceRoot, 'augment-extensions');
  const relativePath = path.relative(modulesRoot, moduleRoot);
  if (!relativePath || relativePath.startsWith('..')) {
    return null;
  }

  const parts = relativePath.split(path.sep).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  return `${parts[0]}/${parts[1]}`;
}

function buildCliInvocation({ workspaceRoot, moduleName, mode }) {
  const args = [path.join(workspaceRoot, 'bin', 'filmbuff.js'), 'show', moduleName];
  if (mode === 'inspect') {
    args.push('--webview', '--json');
  } else {
    args.push('--optimization-suggestions', '--json');
  }

  return {
    command: process.execPath,
    args,
    options: {
      cwd: workspaceRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    }
  };
}

function renderOptimizationSuggestionsMarkdown(moduleName, suggestions) {
  const lines = [`# Optimization suggestions for ${moduleName}`, ''];

  if (!suggestions.length) {
    lines.push('No optimization suggestions were generated.');
    return lines.join('\n');
  }

  suggestions.forEach((suggestion, index) => {
    lines.push(`## ${index + 1}. ${suggestion.title}`);
    lines.push(`- Category: ${suggestion.category}`);
    lines.push(`- Impact: ${suggestion.impact}`);
    lines.push(`- Summary: ${suggestion.summary}`);
    lines.push(`- Why: ${suggestion.rationale}`);
    if (suggestion.targetPath) {
      lines.push(`- Target: \`${suggestion.targetPath}\``);
    }
    lines.push('');
    lines.push('### Steps');
    suggestion.steps.forEach(step => lines.push(`- ${step}`));
    lines.push('');
    lines.push('### Metrics');
    suggestion.metrics.forEach(metric => lines.push(`- ${metric}`));
    lines.push('');
    lines.push('### Example');
    lines.push(`\`\`\`${suggestion.exampleLanguage || 'text'}`);
    lines.push(suggestion.codeExample);
    lines.push('\`\`\`');
    lines.push('');
  });

  return lines.join('\n');
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  findModuleRoot,
  getModuleNameFromPath,
  buildCliInvocation,
  renderOptimizationSuggestionsMarkdown
};