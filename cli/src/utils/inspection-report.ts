import * as fs from 'fs';
import * as path from 'path';
import type { ExtendedModuleMetadata, FileInfo, Module } from './module-system';
import type { RefactoringRecommendation } from './refactoring-recommendations';
import type { OptimizationSuggestion } from './optimization-suggestions';

export interface InspectionReportResult {
  reportPath: string;
  generatedAt: string;
  fileCount: number;
  recommendationCount: number;
  optimizationSuggestionCount: number;
}

export interface MarkdownReportResult {
  reportPath: string;
  generatedAt: string;
  fileCount: number;
  recommendationCount: number;
  optimizationSuggestionCount: number;
}

export function generateInspectionReport(params: {
  module: Module;
  metadata: ExtendedModuleMetadata;
  files: FileInfo[];
  recommendations?: RefactoringRecommendation[];
  optimizationSuggestions?: OptimizationSuggestion[];
  cwd?: string;
}): InspectionReportResult {
  const cwd = params.cwd || process.cwd();
  const reportDirectory = path.join(cwd, '.augment', 'cache', 'inspection-reports');
  fs.mkdirSync(reportDirectory, { recursive: true });

  const generatedAt = new Date().toISOString();
  const fileName = `${sanitizeName(params.module.fullName)}-${timestampForFile(generatedAt)}.html`;
  const reportPath = path.join(reportDirectory, fileName);
  const html = renderReportHtml(
    params.module,
    params.metadata,
    params.files,
    params.recommendations || [],
    params.optimizationSuggestions || [],
    generatedAt
  );
  fs.writeFileSync(reportPath, html, 'utf-8');

  return {
    reportPath,
    generatedAt,
    fileCount: params.files.length,
    recommendationCount: (params.recommendations || []).length,
    optimizationSuggestionCount: (params.optimizationSuggestions || []).length
  };
}

function renderReportHtml(
  module: Module,
  metadata: ExtendedModuleMetadata,
  files: FileInfo[],
  recommendations: RefactoringRecommendation[],
  optimizationSuggestions: OptimizationSuggestion[],
  generatedAt: string
): string {
  const cards = [
    ['Files', String(metadata.files?.total || files.length)],
    ['Rules', String(metadata.files?.rules || 0)],
    ['Examples', String(metadata.files?.examples || 0)],
    ['Characters', (metadata.size?.totalCharacters || 0).toLocaleString()],
    ['Optimizations', String(optimizationSuggestions.length)]
  ];

  const fileRows = files.map(file => `
      <tr data-type="${escapeHtml(file.type)}" data-path="${escapeHtml(file.relativePath.toLowerCase())}">
        <td>${escapeHtml(file.relativePath)}</td>
        <td>${escapeHtml(file.type)}</td>
        <td>${file.size.toLocaleString()}</td>
        <td>${escapeHtml(file.modified.toISOString())}</td>
      </tr>`).join('');

  const recommendationItems = recommendations.length === 0
    ? '<li class="empty">No immediate refactoring recommendations were generated.</li>'
    : recommendations.map(rec => `
      <li class="recommendation ${escapeHtml(rec.priority)}">
        <strong>${escapeHtml(rec.title)}</strong>
        <p>${escapeHtml(rec.summary)}</p>
        <small>${escapeHtml(rec.priority.toUpperCase())} priority</small>
      </li>`).join('');

  const optimizationItems = optimizationSuggestions.length === 0
    ? '<li class="empty">No immediate optimization suggestions were generated.</li>'
    : optimizationSuggestions.map(suggestion => `
      <li class="optimization ${escapeHtml(suggestion.impact)} ${escapeHtml(suggestion.category)}">
        <strong>${escapeHtml(suggestion.title)}</strong>
        <p>${escapeHtml(suggestion.summary)}</p>
        <small>${escapeHtml(suggestion.category.toUpperCase())} · ${escapeHtml(suggestion.impact.toUpperCase())} impact</small>
        <p>${escapeHtml(suggestion.rationale)}</p>
        <pre>${escapeHtml(suggestion.codeExample)}</pre>
      </li>`).join('');

  const cardHtml = cards.map(([label, value]) => `
      <div class="card">
        <span class="label">${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(module.fullName)} inspection report</title>
  <style>
    :root { color-scheme: light dark; font-family: Segoe UI, Arial, sans-serif; }
    body { margin: 0; padding: 24px; background: #111827; color: #e5e7eb; }
    h1, h2 { margin: 0 0 12px; }
    .toolbar, .cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
    .card, .panel { background: #1f2937; border: 1px solid #374151; border-radius: 10px; padding: 14px; }
    .card { min-width: 140px; }
    .label { display: block; font-size: 12px; color: #93c5fd; margin-bottom: 6px; }
    input, button { border-radius: 8px; border: 1px solid #4b5563; padding: 8px 12px; background: #0f172a; color: inherit; }
    button.active { border-color: #60a5fa; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; border-bottom: 1px solid #374151; padding: 10px 8px; }
    ul { padding-left: 20px; }
    .recommendation.high { border-left: 4px solid #f87171; padding-left: 8px; }
    .recommendation.medium { border-left: 4px solid #fbbf24; padding-left: 8px; }
    .recommendation.low { border-left: 4px solid #34d399; padding-left: 8px; }
    .optimization { border-left: 4px solid #60a5fa; padding-left: 8px; margin-bottom: 12px; }
    .optimization.high { border-left-color: #f87171; }
    .optimization.medium { border-left-color: #fbbf24; }
    .optimization.low { border-left-color: #34d399; }
    pre { overflow-x: auto; background: #0f172a; border-radius: 8px; padding: 12px; }
    .meta { color: #9ca3af; font-size: 14px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(module.fullName)}</h1>
  <p class="meta">Generated ${escapeHtml(generatedAt)} · ${escapeHtml(metadata.description)}</p>

  <div class="cards">${cardHtml}</div>

  <div class="panel">
    <h2>Interactive file explorer</h2>
    <div class="toolbar">
      <input id="file-search" type="search" placeholder="Filter files by path" />
      <button type="button" class="filter active" data-filter="all">All</button>
      <button type="button" class="filter" data-filter="rule">Rules</button>
      <button type="button" class="filter" data-filter="example">Examples</button>
      <button type="button" class="filter" data-filter="documentation">Docs</button>
      <button type="button" id="refresh-button">Refresh view</button>
    </div>
    <table>
      <thead>
        <tr><th>File</th><th>Type</th><th>Size</th><th>Modified</th></tr>
      </thead>
      <tbody id="file-table-body">${fileRows}</tbody>
    </table>
  </div>

  <div class="panel" style="margin-top: 16px;">
    <h2>Refactoring recommendations</h2>
    <ul>${recommendationItems}</ul>
  </div>

  <div class="panel" style="margin-top: 16px;">
    <h2>Optimization suggestions</h2>
    <ul>${optimizationItems}</ul>
  </div>

  <script>
    const searchInput = document.getElementById('file-search');
    const buttons = Array.from(document.querySelectorAll('.filter'));
    const rows = Array.from(document.querySelectorAll('#file-table-body tr'));
    let activeFilter = 'all';
    function applyFilters() {
      const term = (searchInput.value || '').toLowerCase();
      rows.forEach(row => {
        const matchesFilter = activeFilter === 'all' || row.dataset.type === activeFilter;
        const matchesSearch = !term || (row.dataset.path || '').includes(term);
        row.style.display = matchesFilter && matchesSearch ? '' : 'none';
      });
    }
    buttons.forEach(button => button.addEventListener('click', () => {
      activeFilter = button.dataset.filter || 'all';
      buttons.forEach(item => item.classList.toggle('active', item === button));
      applyFilters();
    }));
    searchInput.addEventListener('input', applyFilters);
    document.getElementById('refresh-button').addEventListener('click', () => location.reload());
    applyFilters();
  </script>
</body>
</html>`;
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function timestampForFile(isoDate: string): string {
  return isoDate.replace(/[:.]/g, '-');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Markdown report generator (bd-modinsp.4.3)
// ---------------------------------------------------------------------------

/**
 * Generate a Markdown inspection report and write it to the cache directory.
 * The report includes:
 *   - Summary stats table
 *   - File inventory table (path, type, size, modified)
 *   - Mermaid dependency-tree diagram showing module → directory → file structure
 *   - Refactoring recommendations table
 *   - Optimization suggestions with fenced code blocks
 */
export function generateMarkdownReport(params: {
  module: Module;
  metadata: ExtendedModuleMetadata;
  files: FileInfo[];
  recommendations?: RefactoringRecommendation[];
  optimizationSuggestions?: OptimizationSuggestion[];
  cwd?: string;
}): MarkdownReportResult {
  const cwd = params.cwd || process.cwd();
  const reportDirectory = path.join(cwd, '.augment', 'cache', 'inspection-reports');
  fs.mkdirSync(reportDirectory, { recursive: true });

  const generatedAt = new Date().toISOString();
  const fileName = `${sanitizeName(params.module.fullName)}-${timestampForFile(generatedAt)}.md`;
  const reportPath = path.join(reportDirectory, fileName);

  const markdown = renderReportMarkdown(
    params.module,
    params.metadata,
    params.files,
    params.recommendations || [],
    params.optimizationSuggestions || [],
    generatedAt
  );
  fs.writeFileSync(reportPath, markdown, 'utf-8');

  return {
    reportPath,
    generatedAt,
    fileCount: params.files.length,
    recommendationCount: (params.recommendations || []).length,
    optimizationSuggestionCount: (params.optimizationSuggestions || []).length
  };
}

function renderReportMarkdown(
  module: Module,
  metadata: ExtendedModuleMetadata,
  files: FileInfo[],
  recommendations: RefactoringRecommendation[],
  optimizationSuggestions: OptimizationSuggestion[],
  generatedAt: string
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Inspection Report: ${module.fullName}`);
  lines.push('');
  lines.push(`> Generated: ${generatedAt}`);
  lines.push(`> ${metadata.description}`);
  lines.push('');

  // Summary stats table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| **Total files** | ${metadata.files?.total || files.length} |`);
  lines.push(`| **Rules** | ${metadata.files?.rules || 0} |`);
  lines.push(`| **Examples** | ${metadata.files?.examples || 0} |`);
  lines.push(`| **Characters** | ${(metadata.size?.totalCharacters || 0).toLocaleString()} |`);
  lines.push(`| **Optimizations** | ${optimizationSuggestions.length} |`);
  lines.push(`| **Recommendations** | ${recommendations.length} |`);
  lines.push('');

  // Mermaid dependency tree (module → directories → files)
  lines.push('## Dependency Tree');
  lines.push('');
  lines.push('```mermaid');
  lines.push('graph TD');
  const mermaidModuleId = safeMermaidId(module.fullName);
  lines.push(`  ${mermaidModuleId}["📦 ${escapeMermaid(module.fullName)}"]`);

  // Group files by their top-level directory for the tree
  const dirMap = new Map<string, FileInfo[]>();
  for (const file of files) {
    const parts = file.relativePath.replace(/\\/g, '/').split('/');
    const topDir = parts.length > 1 ? parts[0] : '(root)';
    if (!dirMap.has(topDir)) dirMap.set(topDir, []);
    dirMap.get(topDir)!.push(file);
  }

  for (const [dir, dirFiles] of dirMap) {
    const dirId = safeMermaidId(`${module.fullName}/${dir}`);
    lines.push(`  ${dirId}["📁 ${escapeMermaid(dir)}"]`);
    lines.push(`  ${mermaidModuleId} --> ${dirId}`);
    // Show up to 5 files per directory to keep the diagram readable
    const sample = dirFiles.slice(0, 5);
    for (const file of sample) {
      const fileName = path.basename(file.relativePath);
      const fileId = safeMermaidId(file.relativePath);
      const icon = file.type === 'rule' ? '📋' : file.type === 'example' ? '💡' : '📄';
      lines.push(`  ${fileId}["${icon} ${escapeMermaid(fileName)}"]`);
      lines.push(`  ${dirId} --> ${fileId}`);
    }
    if (dirFiles.length > 5) {
      const moreId = safeMermaidId(`${module.fullName}/${dir}/more`);
      lines.push(`  ${moreId}["… ${dirFiles.length - 5} more"]`);
      lines.push(`  ${dirId} --> ${moreId}`);
    }
  }
  lines.push('```');
  lines.push('');

  // File inventory table
  lines.push('## Files');
  lines.push('');
  lines.push('| Path | Type | Size (bytes) | Modified |');
  lines.push('|------|------|-------------|----------|');
  for (const file of files) {
    const modifiedStr = file.modified instanceof Date
      ? file.modified.toISOString().replace('T', ' ').slice(0, 19)
      : String(file.modified);
    lines.push(`| \`${mdEscape(file.relativePath)}\` | ${file.type} | ${file.size.toLocaleString()} | ${modifiedStr} |`);
  }
  lines.push('');

  // Refactoring recommendations
  lines.push('## Refactoring Recommendations');
  lines.push('');
  if (recommendations.length === 0) {
    lines.push('_No immediate refactoring recommendations._');
  } else {
    lines.push('| Priority | Title | Summary |');
    lines.push('|----------|-------|---------|');
    for (const rec of recommendations) {
      lines.push(`| **${rec.priority.toUpperCase()}** | ${mdEscape(rec.title)} | ${mdEscape(rec.summary)} |`);
    }
    lines.push('');
    for (const rec of recommendations) {
      lines.push(`### ${mdEscape(rec.title)}`);
      lines.push('');
      lines.push(`**Priority:** ${rec.priority} | **Rationale:** ${mdEscape(rec.rationale)}`);
      lines.push('');
      if (rec.steps.length > 0) {
        lines.push('**Steps:**');
        for (const step of rec.steps) {
          lines.push(`- ${mdEscape(step)}`);
        }
      }
      if (rec.metrics.length > 0) {
        lines.push('');
        lines.push('**Metrics:**');
        for (const metric of rec.metrics) {
          lines.push(`- ${mdEscape(metric)}`);
        }
      }
      lines.push('');
    }
  }
  lines.push('');

  // Optimization suggestions with code blocks
  lines.push('## Optimization Suggestions');
  lines.push('');
  if (optimizationSuggestions.length === 0) {
    lines.push('_No immediate optimization suggestions._');
  } else {
    for (const suggestion of optimizationSuggestions) {
      lines.push(`### ${mdEscape(suggestion.title)}`);
      lines.push('');
      lines.push(`**Category:** ${suggestion.category} | **Impact:** ${suggestion.impact}`);
      lines.push('');
      lines.push(mdEscape(suggestion.summary));
      lines.push('');
      lines.push(`> ${mdEscape(suggestion.rationale)}`);
      lines.push('');
      if (suggestion.steps.length > 0) {
        lines.push('**Steps:**');
        for (const step of suggestion.steps) {
          lines.push(`- ${mdEscape(step)}`);
        }
        lines.push('');
      }
      if (suggestion.codeExample) {
        const lang = suggestion.exampleLanguage || '';
        lines.push(`\`\`\`${lang}`);
        lines.push(suggestion.codeExample);
        lines.push('```');
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

/** Convert an arbitrary string to a valid Mermaid node ID (alphanumeric + underscores). */
function safeMermaidId(value: string): string {
  return 'n_' + value.replace(/[^a-zA-Z0-9]/g, '_');
}

/** Escape double-quotes inside Mermaid node labels. */
function escapeMermaid(value: string): string {
  return value.replace(/"/g, "'");
}

/** Escape pipe characters in Markdown table cells. */
function mdEscape(value: string): string {
  return value.replace(/\|/g, '\\|');
}