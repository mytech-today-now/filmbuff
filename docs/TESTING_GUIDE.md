# Testing Guide

## Overview

This guide provides comprehensive documentation for testing the Augment Extensions project, including test setup, execution, debugging, coverage requirements, and best practices.

## Table of Contents

1. [Test Architecture](#test-architecture)
2. [Running Tests](#running-tests)
3. [Writing New Tests](#writing-new-tests)
4. [Debugging Test Failures](#debugging-test-failures)
5. [Coverage Requirements](#coverage-requirements)
6. [Best Practices](#best-practices)
7. [CI/CD Integration](#cicd-integration)

## Test Architecture

### Test Frameworks

The repository currently uses three complementary test lanes:

1. **Jest repo suite**
   - Location: `__tests__/`
   - Config: `jest.config.js`
   - Purpose: package smoke tests plus the Jest wrapper around `test-all.ts`

2. **Compatibility Jest suite**
   - Location: `tests/unit/utils/extractCommandHelp*.test.ts`
   - Config: `jest.compat.config.js`
   - Purpose: keep targeted compatibility coverage runnable without migrating the whole `tests/` tree to Jest

3. **Vitest unit/integration suite**
   - Location: `tests/`
   - Config: `vitest.config.ts`
   - Coverage: V8 provider
   - Purpose: broader unit and integration coverage for the CLI codebase
   - Note: this lane requires a local `vitest` devDependency and currently fails fast with an install hint if `vitest` is not present

The standalone CLI regression suite still lives in `test-all.ts` and is normally exercised through `npm run test:standalone`.

### Directory Structure

```
filmbuff/
├── __tests__/             # Jest repo-level smoke/package tests
├── tests/                 # Vitest-oriented unit/integration tests
│   ├── unit/
│   ├── integration/
│   ├── helpers/
│   └── setup.ts
├── test-all.ts            # Standalone CLI regression suite
├── jest.config.js
├── jest.compat.config.js
└── vitest.config.ts
```

### Core Test Components

#### 1. TestEnvironment Class (`tests/helpers/test-env.ts`)

Provides isolated test environments:

```typescript
const env = new TestEnvironment();
await env.createProject('my-project');
await env.createModule('test-module', { /* config */ });
// ... run tests
await env.cleanup();
```

Features:
- Temporary directory creation/cleanup
- Project structure setup
- Module/collection creation
- File tracking
- Automatic cleanup

#### 2. Test Factories (`tests/helpers/factories.ts`)

Generate test data:

```typescript
const module = ModuleFactory.createValid({ name: 'test' });
const collection = CollectionFactory.createWithModules(['mod1', 'mod2']);
const project = ProjectFactory.create();
```

#### 3. Custom Matchers (`tests/helpers/matchers.ts`)

Domain-specific assertions:

```typescript
expect(module).toBeValidModule();
expect(project).toHaveLinkedModule('typescript-standards');
expect(collection).toHaveCollection('web-dev');
```

## Running Tests

### Stable Repo Checks

```bash
# Default stable repo entrypoint
npm test

# Explicit stable subset
npm run test:stable

# Focused compatibility lane
npm run test:compat

# Broader Jest lanes (currently under repair)
npm run test:jest
npm run test:repo

# Comprehensive CLI regression wrapper
npm run test:standalone
```

`npm test` intentionally targets the known-green compatibility subset while the broader Jest lane is being repaired.

### Vitest Tests

```bash
# Run all tests
npm run test:vitest

# Watch mode
npm run test:vitest:watch

# Coverage report
npm run test:vitest:coverage

# Specific test file
npx vitest run tests/unit/modules/link.test.ts

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration
```

If `vitest` is not installed locally, these commands fail immediately with an actionable install message instead of silently skipping the suite.

### Standalone Test Suite

```bash
# Run the Jest wrapper around the standalone CLI regression suite
npm run test:standalone

# Run the full standalone script directly
npx tsx test-all.ts

# Run every configured repo lane (requires vitest to be installed)
npm run test:all
```

### All Tests

```bash
# Stable default: compatibility subset
npm test

# Broader repo-wide Jest lane
npm run test:repo

# Full suite including the Vitest lane
npm run test:all
```

## Writing New Tests

### Unit Test Example

```typescript
// tests/unit/my-feature.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestEnvironment } from '../helpers/test-env';

describe('My Feature', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment();
    await env.createProject('test-project');
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('should do something', async () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = await myFeature(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

### Integration Test Example

```typescript
// tests/integration/workflow.test.ts
import { describe, it, expect } from 'vitest';
import { TestEnvironment } from '../helpers/test-env';
import { ModuleFactory } from '../helpers/factories';

describe('Module Workflow', () => {
  it('should link, show, and unlink module', async () => {
    const env = new TestEnvironment();
    await env.createProject('test-project');
    
    // Create module
    const module = ModuleFactory.createValid();
    await env.createModule(module.name, module);
    
    // Link module
    await linkModule(env.projectPath, module.name);
    expect(env.projectPath).toHaveLinkedModule(module.name);
    
    // Show module
    const info = await showModule(module.name);
    expect(info).toMatchObject(module);
    
    // Unlink module
    await unlinkModule(env.projectPath, module.name);
    expect(env.projectPath).not.toHaveLinkedModule(module.name);
    
    await env.cleanup();
  });
});
```

### Adding Tests to Standalone Suite

```typescript
// test-all.ts
function testMyNewCommands(runner: TestRunner): void {
  console.log('\n🚀 Testing MY NEW commands...\n');

  const testCases: TestCase[] = [
    {
      name: 'my command --help',
      args: ['--help'],
      expectedExitCode: 0,
      shouldContain: ['Usage:', 'Options:'],
      shouldNotContain: ['Error']
    }
  ];

  for (const testCase of testCases) {
    const sandbox = new TestSandbox();
    sandbox.setupBasicProject();

    logTestStart('my-command', testCase.name);
    const result = runner.runCommand(sandbox, 'my-command', testCase.args, {
      expectedExitCode: testCase.expectedExitCode,
      shouldContain: testCase.shouldContain
    });

    logTestResult(result);
    sandbox.cleanup();
  }
}
```

## Debugging Test Failures

### Vitest Debugging

1. **Run specific test**: `npx vitest run tests/unit/modules/link.test.ts`
2. **Use debug mode**: `DEBUG=* npx vitest run`
3. **Run a focused npm lane**: `npm run test:unit`

### Common Issues

#### Test Timeouts
- Increase timeout: `it('slow test', async () => { /* ... */ }, 30000);`
- Check for interactive prompts
- Verify cleanup runs

#### File System Errors
- Ensure cleanup runs in `afterEach`
- Use absolute paths
- Check file existence before operations

## Coverage Requirements

### Target Metrics
- **Line Coverage**: ≥80%
- **Branch Coverage**: ≥70%
- **Function Coverage**: ≥75%
- **Statement Coverage**: ≥80%

### Checking Coverage

```bash
npm run test:vitest:coverage
open coverage/index.html
```

## Best Practices

### 1. Test Isolation
- Each test should be independent
- Use `beforeEach` and `afterEach` for setup/cleanup
- Don't rely on test execution order

### 2. Descriptive Test Names
```typescript
// Good
it('should throw error when module name is empty', () => {});

// Bad
it('test1', () => {});
```

### 3. Arrange-Act-Assert Pattern
```typescript
it('should calculate total', () => {
  // Arrange
  const items = [1, 2, 3];

  // Act
  const total = calculateTotal(items);

  // Assert
  expect(total).toBe(6);
});
```

### 4. Test Edge Cases
- Empty inputs
- Null/undefined values
- Maximum/minimum values
- Invalid inputs
- Boundary conditions

### 5. Use Factories for Test Data
```typescript
// Good
const module = ModuleFactory.createValid();

// Bad
const module = {
  name: 'test',
  version: '1.0.0',
  // ... many fields
};
```

### 6. Mock External Dependencies
```typescript
import { vi } from 'vitest';

vi.mock('fs-extra', () => ({
  readFile: vi.fn().mockResolvedValue('content'),
  writeFile: vi.fn().mockResolvedValue(undefined)
}));
```

### 7. Clean Up Resources
```typescript
afterEach(async () => {
  await env.cleanup();
  vi.clearAllMocks();
});
```

## CI/CD Integration

Tests run automatically on:
- Every push to `main` or `develop`
- Every pull request
- Multiple platforms (Windows, Linux, macOS)
- Multiple Node versions (16, 18, 20)

See `.github/workflows/test.yml` for configuration.

### Quality Gates

All PRs must pass:
- ✅ All tests pass (100% pass rate)
- ✅ Coverage thresholds met (≥80% line, ≥70% branch)
- ✅ No linting errors
- ✅ No type errors
- ✅ Build succeeds

## Test Results Analysis

### Standalone Suite Results

```powershell
# View summary
Get-Content test-results.jsonl | ConvertFrom-Json |
  Group-Object status | Select-Object Name, Count

# View failures
Get-Content test-results.jsonl | ConvertFrom-Json |
  Where-Object { $_.status -eq 'failure' } |
  Format-Table name, exitCode

# View slowest tests
Get-Content test-results.jsonl | ConvertFrom-Json |
  Sort-Object durationMs -Descending |
  Select-Object -First 10 name, durationMs
```

## Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Best Practices](https://testingjavascript.com/)
- [Test-Driven Development](https://martinfowler.com/bliki/TestDrivenDevelopment.html)
- [Coverage Reports](./coverage/index.html)

