import baseConfig from './jest.config.js';

// CI-specific Jest configuration that disables coverage thresholds
// This prevents individual test suites from failing on partial coverage
export default {
  ...baseConfig,
  // Remove coverage thresholds for CI - we'll validate merged coverage instead
  coverageThreshold: undefined,
  // CI-specific optimizations
  maxWorkers: 1,
  cache: false,
  collectCoverage: true,
  coverageReporters: ['lcov', 'text-summary'],

  // Override reporters for CI with structured output
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'test-results',
        outputName: 'ci-tests.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true,
        addFileAttribute: true,
        includeConsoleOutput: false,
      },
    ],
  ],
  // Ensure consistent behavior in CI
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
