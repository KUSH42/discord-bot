import baseConfig from '../../jest.config.js';

export default {
  ...baseConfig,
  rootDir: '../../', // Set root to project root
  // E2E tests focus on integration behavior, not source code coverage
  coverageThreshold: {
    global: {
      statements: 0,
      branches: 0,
      functions: 0,
      lines: 0,
    },
  },
  // Disable coverage for E2E tests by default since they don't exercise source code directly
  collectCoverage: false,
  testMatch: ['<rootDir>/tests/e2e/**/*.test.js', '<rootDir>/tests/e2e/**/*.spec.js'],
  testTimeout: 60000,

  // E2E test reporters
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'test-results',
        outputName: 'e2e-tests.xml',
        classNameTemplate: 'E2E.{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true,
        addFileAttribute: true,
        includeConsoleOutput: true,
      },
    ],
  ],
};
