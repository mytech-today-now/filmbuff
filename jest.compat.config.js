module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/unit/utils', '<rootDir>/cli/src'],
  testMatch: [
    // extractCommandHelp.test.ts uses Vitest APIs (vi.*) — run it with
    // `npm run test:vitest` / `npm run test:unit` instead.
    '**/extractCommandHelp.integration.test.ts'
  ],
  transform: {
    '^.+\\.tsx?$': [require.resolve('ts-jest'), {}]
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^@cli/(.*)$': '<rootDir>/cli/src/$1',
    '^uuid$': '<rootDir>/__mocks__/uuid.js',
    '^chalk$': '<rootDir>/__mocks__/chalk.js'
  },
  collectCoverageFrom: [
    'cli/src/utils/extractCommandHelp.ts'
  ],
  coverageDirectory: 'coverage/compat',
  verbose: true,
  testTimeout: 120000
};