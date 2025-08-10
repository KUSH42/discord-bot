import baseConfig from './jest.config.js';

// CI-specific Jest configuration that disables coverage thresholds
// This prevents individual test suites from failing on partial coverage
export default {
  ...baseConfig,
  rootDir: './', // Set root to project root
  // Remove coverage thresholds for CI - we'll validate merged coverage instead
  coverageThreshold: undefined,
  // CI-specific optimizations
  maxWorkers: 1,
  cache: false,
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.js',
    // Exclude main entry points that start infinite processes and cause genhtml errors
    '!index.js',
    '!src/x-scraper.js',
    '!src/youtube-monitor.js',
    '!node_modules/**',
    '!coverage/**',
    '!jest.config.js',
    '!scripts/setup-encryption.js',
    '!tests/**',
    '!src/services/interfaces/**',
    '!src/setup/**',
  ],
  coverageReporters: ['json', 'text-summary'],
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
