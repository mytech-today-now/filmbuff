import * as fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateModuleDocumentation, validateReadmeStructure } from '@cli/utils/documentation-validator';
import type { Module } from '@cli/utils/module-system';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}));

describe('Documentation Validator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateReadmeStructure', () => {
    it('should validate README with all required sections', () => {
      const mockReadme = `
# Test Module

This is a test module.

## Overview

This module provides testing functionality.

## Contents

- Rule 1
- Rule 2

## Character Count

Total: ~5,000 characters
`;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockReadme as never);

      const result = validateReadmeStructure('/test/module');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required sections', () => {
      const mockReadme = `
# Test Module

This is a test module.
`;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockReadme as never);

      const result = validateReadmeStructure('/test/module');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('README.md missing required section: Overview');
      expect(result.errors).toContain('README.md missing required section: Contents');
      expect(result.errors).toContain('README.md missing required section: Character Count');
    });

    it('should warn about short README', () => {
      const mockReadme = `# Test`;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockReadme as never);

      const result = validateReadmeStructure('/test/module');

      expect(result.warnings).toContain('README.md appears to be too short (< 100 characters)');
    });

    it('should handle missing README', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = validateReadmeStructure('/test/module');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('README.md file is missing');
    });
  });

  describe('validateModuleDocumentation', () => {
    it('should validate complete module documentation', () => {
      const mockModule: Module = {
        metadata: {
          name: 'test-module',
          version: '1.0.0',
          displayName: 'Test Module',
          description: 'A comprehensive test module for validation',
          type: 'coding-standards',
          tags: ['test', 'validation'],
          augment: {
            characterCount: 5000,
            priority: 'high',
            category: 'coding-standards'
          }
        },
        path: '/test/module',
        fullName: 'coding-standards/test-module',
        rules: ['rule1.md', 'rule2.md'],
        examples: ['example1.ts']
      };

      const mockReadme = `
# Test Module

## Overview
Complete overview

## Contents
- Rules

## Character Count
~5,000

## Usage
Example usage

## Installation
Setup instructions

\`\`\`bash
filmbuff show test-module
\`\`\`
`;

      const mockRule = `
# Rule 1

This is a comprehensive rule.

## Steps

1. Step one
2. Step two

\`\`\`typescript
// Example code
\`\`\`
`;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        const fileName = String(filePath);
        if (fileName.includes('README.md')) return mockReadme as never;
        if (fileName.includes('rule')) return mockRule as never;
        return '' as never;
      });

      const result = validateModuleDocumentation(mockModule);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require examples for examples modules', () => {
      const mockModule: Module = {
        metadata: {
          name: 'test-examples',
          version: '1.0.0',
          displayName: 'Test Examples',
          description: 'Test examples module',
          type: 'examples',
          augment: {
            characterCount: 5000
          }
        },
        path: '/test/module',
        fullName: 'examples/test-examples',
        rules: ['rule1.md'],
        examples: []
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('# Test\n\n## Overview\n\n## Contents\n\n## Character Count\n~5000' as never);

      const result = validateModuleDocumentation(mockModule);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Examples module must have files in examples/ directory');
    });
  });
});

