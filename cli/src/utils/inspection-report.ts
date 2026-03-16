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