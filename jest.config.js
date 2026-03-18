module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/cli/src', '<rootDir>/filmbuff', '<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [require.resolve('ts-jest'), {}]
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^uuid$': '<rootDir>/__mocks__/uuid.js',  // Mock uuid module
    '^chalk$': '<rootDir>/__mocks__/chalk.js',  // Mock chalk module for ESM compatibility
    '^(\\.{1,2}/.+)\\.js$': '$1'  // Strip .js extensions so ts-jest resolves .ts sources
  },
  collectCoverageFrom: [
    'cli/src/**/*.ts',
    'filmbuff/**/*.ts',
    '!cli/src/**/*.d.ts',
    '!filmbuff/**/*.d.ts',
    '!cli/src/**/__tests__/**',
    '!filmbuff/**/__tests__/**',
    '!test-all.ts'  // Exclude test-all.ts from coverage (it's a test file)
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 120000  // 2 minute timeout for comprehensive tests
};

