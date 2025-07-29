/**
 * Jest configuration for performance tests
 * Focused on timing and benchmarking rather than code coverage
 */

export default {
  testEnvironment: 'node',
  rootDir: '../../',

  // Transform configuration
  transform: {
    '^.+.js$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }],
  },

  // Module resolution
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  // Test discovery - only performance tests
  testMatch: ['<rootDir>/tests/performance/**/*.test.js'],

  // Performance-specific settings
  testTimeout: 120000, // 2 minutes for performance tests
  maxWorkers: 1, // Run performance tests sequentially for accurate timing

  // Enable coverage collection for performance tests
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.js',
    'index.js',
    'src/x-scraper.js',
    'src/youtube-monitor.js',
    '!node_modules/**',
    '!coverage/**',
    '!jest.*.config.js',
    '!scripts/setup-encryption.js',
    '!tests/**',
    '!src/services/interfaces/**',
    '!src/setup/**',
  ],

  coverageDirectory: 'coverage/performance-tests',
  coverageReporters: ['text', 'lcov', 'html', 'clover'],
  coverageProvider: 'v8', // Use V8 coverage instead of Babel for better consistency

  // Performance test reporters
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'test-results',
        outputName: 'performance-tests.xml',
        classNameTemplate: 'Performance.{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true,
        addFileAttribute: true,
        includeConsoleOutput: true,
      },
    ],
  ],

  // No coverage thresholds for performance tests
  // They contribute to overall coverage but don't enforce minimums
  coverageThreshold: {},

  // Test execution
  verbose: true,
  bail: false,

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,

  // Performance optimizations
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache-performance',

  // Error handling
  errorOnDeprecated: false, // Allow for performance testing flexibility
};
