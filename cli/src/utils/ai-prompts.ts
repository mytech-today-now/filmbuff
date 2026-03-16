/**
 * AI Prompt Generation Utilities
 *
 * Generates AI-ready prompts from module inspection results and configurable templates.
 */

import { Module } from './module-system';
import type { AugmentConfig } from './config-system';

export interface PromptTemplateContext {
  code?: string;
  file?: string;
  complexity?: string | number;
  [key: string]: unknown;
}

export interface PromptTemplateDefinition {
  name: string;
  description: string;
  template: string;
  builtIn?: boolean;
}

export interface PromptTemplate extends PromptTemplateDefinition {
  generate: (module: Module, context?: PromptTemplateContext) => string;
}

export interface PromptTemplateValidationResult {
  valid: boolean;
  errors: string[];
  missingVariables: string[];
}

const BUILTIN_TEMPLATES: PromptTemplateDefinition[] = [
  {
    name: 'code-review',
    description: 'Generate code review prompt with module standards',
    builtIn: true,
    template: `# Code Review Request

## Standards Module
**Module**: {{module.fullName}}
**Version**: {{module.metadata.version}}
**Type**: {{module.metadata.type}}

## Standards to Apply
{{module.metadata.description}}

## Rules
{{derived.numberedRules}}

## Task
Please review the following code against these standards:

{{context.code}}

## Expected Output
1. Compliance assessment
2. Violations found (if any)
3. Specific recommendations
4. Code examples for fixes`
  },
  {
    name: 'module-summary',
    description: 'Generate module summary for AI context',
    builtIn: true,
    template: `# Module Summary for AI Context

**Module**: {{module.fullName}}
**Version**: {{module.metadata.version}}
**Type**: {{module.metadata.type}}
**Description**: {{module.metadata.description}}

## Purpose
This module provides {{module.metadata.type}} guidelines for {{module.fullName}}.

## Key Rules
{{derived.topRules}}

## Examples Available
{{derived.topExamples}}

## Character Count
Approximately {{derived.characterCount}} characters`
  },
  {
    name: 'optimization',
    description: 'Generate optimization suggestions prompt',
    builtIn: true,
    template: `# Code Optimization Request

## Context
**Standards Module**: {{module.fullName}}
**Target**: {{context.file}}

## Optimization Goals
Based on {{module.fullName}} standards, suggest optimizations for:

1. Performance
2. Code Quality
3. Best Practices
4. Security

## Standards Reference
{{derived.topRules}}`
  },
  {
    name: 'refactoring',
    description: 'Generate refactoring recommendations prompt',
    builtIn: true,
    template: `# Refactoring Recommendations

## Module Standards
**Module**: {{module.fullName}}
**Type**: {{module.metadata.type}}

## Refactoring Goals
Refactor code to align with {{module.fullName}} standards.

### Complexity Context
{{context.complexity}}

## Standards to Follow
{{derived.numberedRules}}`
  }
];

export function generateCodeReviewPrompt(module: Module, codeSnippet?: string): string {
  return renderPromptTemplate(resolvePromptTemplate('code-review')!, module, {
    code: codeSnippet ? `\`\`\`\n${codeSnippet}\n\`\`\`` : '[Paste your code here]'
  });
}

export function generateModuleSummaryPrompt(module: Module): string {
  return renderPromptTemplate(resolvePromptTemplate('module-summary')!, module);
}

export function generateOptimizationPrompt(module: Module, targetFile?: string): string {
  return renderPromptTemplate(resolvePromptTemplate('optimization')!, module, {
    file: targetFile || 'Current codebase'
  });
}

export function generateRefactoringPrompt(module: Module, complexity?: unknown): string {
  return renderPromptTemplate(resolvePromptTemplate('refactoring')!, module, {
    complexity: typeof complexity === 'string' || typeof complexity === 'number'
      ? complexity
      : 'Current complexity analysis unavailable'
  });
}

export function getPromptTemplates(config?: Pick<AugmentConfig, 'ai'>): PromptTemplate[] {
  const templateMap = new Map<string, PromptTemplate>();

  [...BUILTIN_TEMPLATES, ...(config?.ai?.promptTemplates || [])]
    .filter(definition => isValidDefinition(definition))
    .forEach(definition => {
      templateMap.set(definition.name, createTemplate(definition));
    });

  return [...templateMap.values()];
}

export function resolvePromptTemplate(name: string, config?: Pick<AugmentConfig, 'ai'>): PromptTemplate | undefined {
  return getPromptTemplates(config).find(template => template.name === name);
}

export function validatePromptTemplateUsage(
  template: PromptTemplateDefinition,
  module: Module,
  context: PromptTemplateContext = {}
): PromptTemplateValidationResult {
  if (!isValidDefinition(template)) {
    return {
      valid: false,
      errors: ['Prompt template "unknown" is invalid'],
      missingVariables: []
    };
  }

  const missingVariables = extractTemplateVariables(template.template).filter(variable => {
    return resolveTemplateValue(variable, module, context) === undefined;
  });

  return {
    valid: missingVariables.length === 0,
    errors: missingVariables.length > 0 ? [`Missing template variables: ${missingVariables.join(', ')}`] : [],
    missingVariables
  };
}

export function renderPromptTemplate(
  template: PromptTemplateDefinition,
  module: Module,
  context: PromptTemplateContext = {}
): string {
  return template.template.replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_, expression: string) => {
    const value = resolveTemplateValue(expression, module, context);
    return value === undefined ? `{{${expression}}}` : formatTemplateValue(value);
  });
}

function createTemplate(definition: PromptTemplateDefinition): PromptTemplate {
  return {
    ...definition,
    generate: (module: Module, context?: PromptTemplateContext) => renderPromptTemplate(definition, module, context)
  };
}

function resolveTemplateValue(expression: string, module: Module, context: PromptTemplateContext): unknown {
  const derived = {
    numberedRules: formatNumberedList(module.rules, 'No specific rules defined'),
    topRules: formatNumberedList(module.rules.slice(0, 10), 'No rules defined'),
    topExamples: formatNumberedList(module.examples.slice(0, 5), 'No examples available'),
    characterCount: module.metadata.augment?.characterCount || 'unknown'
  };

  const roots: Record<string, unknown> = {
    module,
    context: {
      code: '[Paste your code here]',
      file: 'Current codebase',
      complexity: 'Current complexity analysis unavailable',
      ...context
    },
    derived
  };

  return expression.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key];
    }

    return undefined;
  }, roots);
}

function extractTemplateVariables(template: string): string[] {
  const variables = new Set<string>();
  template.replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_, expression: string) => {
    variables.add(expression);
    return '';
  });
  return [...variables];
}

function formatTemplateValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? 'None' : value.join('\n');
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function formatNumberedList(items: string[], emptyValue: string): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item}`).join('\n') : emptyValue;
}

function isValidDefinition(template?: PromptTemplateDefinition): template is PromptTemplateDefinition {
  return Boolean(
    template &&
    typeof template.name === 'string' &&
    template.name.trim() &&
    typeof template.description === 'string' &&
    template.description.trim() &&
    typeof template.template === 'string' &&
    template.template.trim()
  );
}

