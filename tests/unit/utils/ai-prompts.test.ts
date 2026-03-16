import { describe, it, expect } from 'vitest';
import {
  getPromptTemplates,
  renderPromptTemplate,
  resolvePromptTemplate,
  validatePromptTemplateUsage
} from '@cli/utils/ai-prompts';
import type { Module } from '@cli/utils/module-system';

const testModule = {
  fullName: 'coding-standards/test-module',
  path: '/tmp/test-module',
  rules: ['Prefer small functions', 'Validate user input'],
  examples: ['example-a.ts', 'example-b.ts'],
  metadata: {
    name: 'test-module',
    version: '1.2.3',
    displayName: 'Test Module',
    description: 'A module for prompt testing',
    type: 'coding-standards',
    tags: ['test'],
    augment: { characterCount: 1234 }
  }
} as Module;

describe('ai-prompts', () => {
  it('loads built-in and custom prompt templates', () => {
    const templates = getPromptTemplates({
      ai: {
        promptTemplates: [
          {
            name: 'custom-summary',
            description: 'Custom summary template',
            template: 'Module {{module.fullName}} for {{context.audience}}'
          }
        ]
      }
    });

    expect(templates.some(template => template.name === 'module-summary')).toBe(true);
    expect(templates.some(template => template.name === 'custom-summary')).toBe(true);
  });

  it('renders module and context placeholders', () => {
    const template = resolvePromptTemplate('optimization');
    expect(template).toBeDefined();

    const output = renderPromptTemplate(template!, testModule, { file: 'src/index.ts' });

    expect(output).toContain('coding-standards/test-module');
    expect(output).toContain('src/index.ts');
    expect(output).toContain('1. Prefer small functions');
  });

  it('validates missing placeholders before use', () => {
    const result = validatePromptTemplateUsage({
      name: 'custom',
      description: 'Needs context',
      template: 'Audience: {{context.audience}}'
    }, testModule);

    expect(result.valid).toBe(false);
    expect(result.missingVariables).toContain('context.audience');
  });
});