import baseConfig from './jest.config.js';

// CI-specific Jest configuration that disables coverage thresholds
// This prevents individual test suites from failing on partial coverage
export default {
  ...baseConfig,
  rootDir: '../../', // Set root to project root
  // Remove coverage thresholds for CI - we'll validate merged coverage instead
  coverageThreshold: undefined,
  // CI-specific optimizations
  maxWorkers: 1,
  cache: false,
  collectCoverage: true,
  coverageReporters: ['lcov', 'text-summary'],
  coverageProvider: 'v8', // Use V8 coverage instead of Babel for better consistency

  // Override reporters for CI with structured output
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'test-results',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true,
        addFileAttribute: true,
        includeConsoleOutput: true,
      },
    ],
  ],
  // Ensure consistent behavior in CI
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
