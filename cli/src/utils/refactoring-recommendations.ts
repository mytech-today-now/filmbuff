import type { ExtendedModuleMetadata, FileInfo, Module } from './module-system';

export type RecommendationPriority = 'high' | 'medium' | 'low';

export interface RefactoringRecommendation {
  id: string;
  priority: RecommendationPriority;
  title: string;
  summary: string;
  rationale: string;
  steps: string[];
  metrics: string[];
  targetPath?: string;
}

interface ScoredRecommendation extends RefactoringRecommendation {
  score: number;
}

export function generateRefactoringRecommendations(
  module: Module,
  metadata: ExtendedModuleMetadata,
  files: FileInfo[]
): RefactoringRecommendation[] {
  const recommendations: ScoredRecommendation[] = [];
  const ruleFiles = files.filter(file => file.type === 'rule');
  const exampleFiles = files.filter(file => file.type === 'example');
  const docFiles = files.filter(file => file.type === 'documentation');
  const rootFiles = files.filter(file => !file.directory || file.directory === '.');
  const largestFile = [...files].sort((a, b) => b.size - a.size)[0];

  if (exampleFiles.length === 0) {
    recommendations.push({
      id: 'add-examples',
      priority: 'high',
      score: 300,
      title: 'Add runnable examples',
      summary: 'The module has rules and documentation but no example artifacts to demonstrate them.',
      rationale: 'Examples reduce ambiguity and make module guidance easier to apply correctly.',
      steps: [
        'Create an examples/ directory for the module.',
        'Add at least one end-to-end example covering the most important rule or workflow.',
        'Link the example from README.md so users can discover it quickly.'
      ],
      metrics: [
        `Rules: ${ruleFiles.length}`,
        `Examples: ${exampleFiles.length}`,
        `Documentation files: ${docFiles.length}`
      ],
      targetPath: module.path
    });
  }

  if (ruleFiles.length > 0 && exampleFiles.length > 0 && exampleFiles.length < Math.ceil(ruleFiles.length / 2)) {
    recommendations.push({
      id: 'balance-rules-and-examples',
      priority: 'medium',
      score: 220,
      title: 'Balance rules with more examples',
      summary: 'Rule coverage significantly exceeds example coverage.',
      rationale: 'A healthier rule-to-example ratio improves learnability and reduces interpretation drift.',
      steps: [
        'Identify the highest-impact rules that do not have a companion example.',
        'Add short, focused examples that demonstrate compliant usage.',
        'Cross-link each example from the related rule file.'
      ],
      metrics: [
        `Rules: ${ruleFiles.length}`,
        `Examples: ${exampleFiles.length}`,
        `Recommended minimum examples: ${Math.ceil(ruleFiles.length / 2)}`
      ],
      targetPath: module.path
    });
  }

  if ((metadata.size?.totalCharacters || 0) > 20000 || (largestFile?.size || 0) > 12000) {
    recommendations.push({
      id: 'split-large-documents',
      priority: 'high',
      score: 280,
      title: 'Split oversized documents into focused sections',
      summary: 'The module content is large enough that discoverability and maintenance will degrade over time.',
      rationale: 'Smaller documents are easier to scan, review, and update without creating merge hotspots.',
      steps: [
        'Break the largest document into topic-focused files.',
        'Keep the README short and use it as an index into deeper guidance.',
        'Move extended reference material into rules/ or docs-style subdirectories.'
      ],
      metrics: [
        `Total characters: ${(metadata.size?.totalCharacters || 0).toLocaleString()}`,
        `Largest file: ${largestFile?.relativePath || 'n/a'} (${largestFile ? largestFile.size.toLocaleString() : 0} bytes)`,
        `Total files: ${files.length}`
      ],
      targetPath: largestFile?.path || module.path
    });
  }

  if (!metadata.tags?.length || !metadata.augment?.priority || !metadata.augment?.category) {
    recommendations.push({
      id: 'tighten-metadata',
      priority: 'medium',
      score: 180,
      title: 'Tighten module metadata for better discoverability',
      summary: 'The module metadata is missing discovery fields that downstream tooling can use.',
      rationale: 'Complete metadata improves filtering, ranking, and maintenance workflows.',
      steps: [
        'Add or refine tags in module.json.',
        'Set augment.priority to reflect the module’s relative importance.',
        'Set augment.category so related tooling can group the module accurately.'
      ],
      metrics: [
        `Tags: ${metadata.tags?.length || 0}`,
        `Priority set: ${metadata.augment?.priority ? 'yes' : 'no'}`,
        `Category set: ${metadata.augment?.category ? 'yes' : 'no'}`
      ],
      targetPath: files.find(file => file.name === 'module.json')?.path || module.path
    });
  }

  if (docFiles.length > Math.max(3, ruleFiles.length + exampleFiles.length)) {
    recommendations.push({
      id: 'organize-documentation',
      priority: 'low',
      score: 120,
      title: 'Organize documentation into clearer groups',
      summary: 'Documentation volume is beginning to outweigh the module’s structural organization.',
      rationale: 'Grouping related docs reduces navigation friction and makes reports easier to scan.',
      steps: [
        'Group long-form documents by topic or workflow.',
        'Use consistent prefixes or subdirectories for related guidance.',
        'Keep the top-level module directory focused on entry points.'
      ],
      metrics: [
        `Documentation files: ${docFiles.length}`,
        `Rules + examples: ${ruleFiles.length + exampleFiles.length}`,
        `Root-level files: ${rootFiles.length}`
      ],
      targetPath: module.path
    });
  }

  if (rootFiles.length > 5) {
    recommendations.push({
      id: 'reduce-root-clutter',
      priority: 'low',
      score: 100,
      title: 'Reduce root-level clutter',
      summary: 'Too many top-level files make the module harder to navigate quickly.',
      rationale: 'Moving supporting files into dedicated directories improves structure without changing content.',
      steps: [
        'Keep only module.json, README.md, and a small number of entry-point files at the root.',
        'Move supporting content into rules/, examples/, or topic-specific folders.',
        'Update README links after restructuring.'
      ],
      metrics: [
        `Root-level files: ${rootFiles.length}`,
        `Total files: ${files.length}`
      ],
      targetPath: module.path
    });
  }

  return recommendations
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .map(({ score: _score, ...recommendation }) => recommendation);
}