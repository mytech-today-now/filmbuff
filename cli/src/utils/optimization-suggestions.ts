import * as fs from 'fs';
import * as path from 'path';
import type { ExtendedModuleMetadata, FileInfo, Module } from './module-system';

export type OptimizationCategory = 'performance' | 'quality' | 'security';
export type OptimizationImpact = 'high' | 'medium' | 'low';

export interface OptimizationSuggestion {
  id: string;
  category: OptimizationCategory;
  impact: OptimizationImpact;
  title: string;
  summary: string;
  rationale: string;
  steps: string[];
  metrics: string[];
  codeExample: string;
  exampleLanguage: string;
  targetPath?: string;
}

interface ScoredOptimizationSuggestion extends OptimizationSuggestion {
  score: number;
}

const SEARCHABLE_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.yml', '.yaml', '.xml', '.html', '.css', '.scss',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.php', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.cs', '.sh', '.ps1', '.sql'
]);

const SENSITIVE_HINT_PATTERN = /(api[_ -]?key|token|secret|password|credential|auth)/i;
const SAFEGUARD_HINT_PATTERN = /(redact|sanitize|mask|secure|placeholder|example[_ -]?only)/i;

export function generateOptimizationSuggestions(
  module: Module,
  metadata: ExtendedModuleMetadata,
  files: FileInfo[]
): OptimizationSuggestion[] {
  const suggestions: ScoredOptimizationSuggestion[] = [];
  const ruleFiles = files.filter(file => file.type === 'rule');
  const exampleFiles = files.filter(file => file.type === 'example');
  const configFiles = files.filter(file => file.type === 'config');
  const docFiles = files.filter(file => file.type === 'documentation');
  const rootFiles = files.filter(file => !file.directory || file.directory === '.');
  const largestFile = [...files].sort((a, b) => b.size - a.size)[0];

  if ((metadata.size?.totalCharacters || 0) > 18000 || (largestFile?.size || 0) > 12000 || files.length > 10) {
    suggestions.push({
      id: 'segment-large-guidance',
      category: 'performance',
      impact: 'high',
      score: 320,
      title: 'Segment large guidance into indexed sections',
      summary: 'The module is large enough that developers will spend extra time scanning and reloading context.',
      rationale: 'Smaller, indexed guidance files reduce navigation time and keep module inspection fast and predictable.',
      steps: [
        'Split the largest rule or documentation file into focused topic files.',
        'Keep README.md as a short index with links to deeper guidance.',
        'Move repeated reference material into reusable rule or example files.'
      ],
      metrics: [
        `Total characters: ${(metadata.size?.totalCharacters || 0).toLocaleString()}`,
        `Largest file: ${largestFile?.relativePath || 'n/a'} (${largestFile ? largestFile.size.toLocaleString() : 0} bytes)`,
        `Total files: ${files.length}`
      ],
      codeExample: [
        '# README.md',
        '',
        '## Quick links',
        '- [Performance](rules/performance.md)',
        '- [Security](rules/security.md)',
        '- [Examples](examples/README.md)'
      ].join('\n'),
      exampleLanguage: 'markdown',
      targetPath: largestFile?.path || module.path
    });
  }

  if (exampleFiles.length === 0) {
    suggestions.push({
      id: 'add-usage-examples',
      category: 'quality',
      impact: 'high',
      score: 300,
      title: 'Add runnable usage examples',
      summary: 'The module explains guidance but does not include example artifacts that show how to apply it.',
      rationale: 'Examples improve adoption quality by turning abstract rules into concrete implementation patterns.',
      steps: [
        'Create an examples/ directory with one happy-path example.',
        'Link the example from README.md and the most relevant rule file.',
        'Prefer minimal examples that can be copied into a real project.'
      ],
      metrics: [
        `Rules: ${ruleFiles.length}`,
        `Examples: ${exampleFiles.length}`,
        `Documentation files: ${docFiles.length}`
      ],
      codeExample: [
        '// examples/basic-usage.ts',
        'export function applyModuleRule(input: string) {',
        "  return input.trim();",
        '}'
      ].join('\n'),
      exampleLanguage: 'typescript',
      targetPath: module.path
    });
  } else if (ruleFiles.length > 0 && exampleFiles.length < Math.ceil(ruleFiles.length / 2)) {
    suggestions.push({
      id: 'balance-rules-with-examples',
      category: 'quality',
      impact: 'medium',
      score: 230,
      title: 'Balance rules with companion examples',
      summary: 'Rule coverage is outpacing example coverage, which makes the module harder to apply consistently.',
      rationale: 'Companion examples reduce interpretation drift and improve implementation quality during reviews.',
      steps: [
        'Identify the highest-impact rules without examples.',
        'Add one short example per missing workflow or standard.',
        'Cross-link each example from the related rule document.'
      ],
      metrics: [
        `Rules: ${ruleFiles.length}`,
        `Examples: ${exampleFiles.length}`,
        `Suggested example floor: ${Math.ceil(ruleFiles.length / 2)}`
      ],
      codeExample: [
        '# rules/naming.md',
        '',
        'See also: [examples/naming/basic-example.ts](../examples/naming/basic-example.ts)'
      ].join('\n'),
      exampleLanguage: 'markdown',
      targetPath: module.path
    });
  }

  if (!metadata.tags?.length || !metadata.augment?.priority || !metadata.augment?.category) {
    suggestions.push({
      id: 'complete-module-metadata',
      category: 'quality',
      impact: 'medium',
      score: 200,
      title: 'Complete module metadata for better inspection quality',
      summary: 'Inspection output is missing metadata fields that help ranking, filtering, and discovery.',
      rationale: 'Complete metadata improves how downstream AI and reporting workflows prioritize the module.',
      steps: [
        'Add specific tags that describe language, workflow, and domain.',
        'Set augment.priority to reflect module importance.',
        'Set augment.category so related tooling can group the module correctly.'
      ],
      metrics: [
        `Tags present: ${metadata.tags?.length || 0}`,
        `Priority set: ${metadata.augment?.priority ? 'yes' : 'no'}`,
        `Category set: ${metadata.augment?.category ? 'yes' : 'no'}`
      ],
      codeExample: [
        '{',
        '  "tags": ["inspection", "security", "typescript"],',
        '  "augment": { "priority": "high", "category": "coding-standards" }',
        '}'
      ].join('\n'),
      exampleLanguage: 'json',
      targetPath: files.find(file => file.name === 'module.json')?.path || module.path
    });
  }

  const securitySignals = collectSecuritySignals(files);
  if (securitySignals.sensitiveHintCount > 0 && securitySignals.safeguardHintCount === 0) {
    suggestions.push({
      id: 'add-secret-safe-guidance',
      category: 'security',
      impact: 'high',
      score: 290,
      title: 'Add secret-safe examples and redaction guidance',
      summary: 'The module references credentials or authentication concepts without nearby guidance on safe handling.',
      rationale: 'Security-sensitive modules should show how to use placeholders, masking, and redaction to avoid leaking secrets.',
      steps: [
        'Add a dedicated rule covering placeholders, masking, and redaction.',
        'Update examples to use obvious fake values instead of realistic secrets.',
        'Link the security note from README.md and any auth-related examples.'
      ],
      metrics: [
        `Sensitive references detected: ${securitySignals.sensitiveHintCount}`,
        `Safeguard references detected: ${securitySignals.safeguardHintCount}`,
        `Example/config files: ${exampleFiles.length + configFiles.length}`
      ],
      codeExample: [
        'API_KEY="<REDACTED_EXAMPLE_ONLY>"',
        'TOKEN="<USE_LOCAL_ENV_VAR>"',
        '# Never commit real credentials in module examples.'
      ].join('\n'),
      exampleLanguage: 'bash',
      targetPath: securitySignals.firstSensitivePath || module.path
    });
  } else if ((exampleFiles.length > 0 || configFiles.length > 0) && securitySignals.safeguardHintCount === 0) {
    suggestions.push({
      id: 'document-safe-defaults',
      category: 'security',
      impact: 'medium',
      score: 210,
      title: 'Document safe defaults for examples and configs',
      summary: 'The module ships examples or config files but does not explicitly call out safe placeholder values.',
      rationale: 'Safe defaults reduce the chance that real credentials or unsafe snippets are copied into downstream projects.',
      steps: [
        'Add a short security note to README.md.',
        'Prefer placeholder values in examples and config snippets.',
        'Call out any commands that should only run in local or test environments.'
      ],
      metrics: [
        `Example files: ${exampleFiles.length}`,
        `Config files: ${configFiles.length}`,
        `Security note present: no`
      ],
      codeExample: [
        '> Security note: all examples use placeholder values.',
        '>',
        '> Replace them with local environment variables instead of committed secrets.'
      ].join('\n'),
      exampleLanguage: 'markdown',
      targetPath: module.path
    });
  }

  if (rootFiles.length > 6 && !suggestions.some(suggestion => suggestion.id === 'segment-large-guidance')) {
    suggestions.push({
      id: 'reduce-root-scan-cost',
      category: 'performance',
      impact: 'low',
      score: 120,
      title: 'Reduce root-level scan cost',
      summary: 'Many root-level files increase scan time for both humans and tooling.',
      rationale: 'Keeping the root focused lowers navigation overhead during inspections and code reviews.',
      steps: [
        'Leave README.md and module.json at the root.',
        'Move supporting guides into rules/, examples/, or docs-style folders.',
        'Keep top-level files limited to entry points.'
      ],
      metrics: [
        `Root-level files: ${rootFiles.length}`,
        `Total files: ${files.length}`
      ],
      codeExample: [
        'module/',
        '├─ module.json',
        '├─ README.md',
        '├─ rules/',
        '└─ examples/'
      ].join('\n'),
      exampleLanguage: 'text',
      targetPath: module.path
    });
  }

  return suggestions
    .sort((a, b) => b.score - a.score || a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
    .map(({ score: _score, ...suggestion }) => suggestion);
}

function collectSecuritySignals(files: FileInfo[]): {
  sensitiveHintCount: number;
  safeguardHintCount: number;
  firstSensitivePath?: string;
} {
  let sensitiveHintCount = 0;
  let safeguardHintCount = 0;
  let firstSensitivePath: string | undefined;

  for (const file of files) {
    if (!SEARCHABLE_EXTENSIONS.has(file.extension.toLowerCase()) || file.size > 128 * 1024) {
      continue;
    }

    let content = '';
    try {
      content = fs.readFileSync(file.path, 'utf-8');
    } catch {
      continue;
    }

    const sensitiveMatches = content.match(new RegExp(SENSITIVE_HINT_PATTERN.source, 'gi')) || [];
    const safeguardMatches = content.match(new RegExp(SAFEGUARD_HINT_PATTERN.source, 'gi')) || [];

    sensitiveHintCount += sensitiveMatches.length;
    safeguardHintCount += safeguardMatches.length;
    if (!firstSensitivePath && sensitiveMatches.length > 0) {
      firstSensitivePath = file.path;
    }
  }

  return { sensitiveHintCount, safeguardHintCount, firstSensitivePath };
}