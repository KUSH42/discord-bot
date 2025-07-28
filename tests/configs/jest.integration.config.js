/**
 * Jest configuration for integration tests
 * Tests module interactions while maintaining reasonable coverage expectations
 */

export default {
  rootDir: '../../', // Set root to project root
  testEnvironment: 'node',

  // Transform configuration
  transform: {
    '^.+.js$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }],
  },

  // Module resolution
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  // Test discovery - only integration tests
  testMatch: ['<rootDir>/tests/integration/**/*.test.js'],

  // Coverage collection - ENABLED for integration tests
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.js',
    'index.js',
    'src/x-scraper.js',
    'src/youtube-monitor.js',
    '!node_modules/**',
    '!coverage/**',
    '!jest.*.config.js',
    '!scripts/**',
    '!tests/**',
    '!src/services/interfaces/**',
    '!src/setup/**',
  ],

  // This line tells Jest to run our script before the tests.
  // <rootDir> is a special Jest variable for the project's root folder.
  setupFiles: ['<rootDir>/scripts/setup-env.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  coverageDirectory: 'coverage/integration',
  coverageReporters: ['text', 'lcov', 'html', 'clover'],

  // Integration test reporters
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'test-results',
        outputName: 'integration-tests.xml',
        classNameTemplate: 'Integration.{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true,
        addFileAttribute: true,
        includeConsoleOutput: true,
      },
    ],
  ],

  // Realistic coverage thresholds for integration testing
  // Integration tests focus on module interactions, not exhaustive single-file coverage
  coverageThreshold: {
    global: {
      statements: 10, // Realistic global threshold for integration
      branches: 8,
      functions: 10,
      lines: 10,
    },
    // Set thresholds based on what integration tests actually achieve
    'src/core/': {
      statements: 20, // Based on observed 28%
      branches: 15, // Based on observed 23%
      functions: 30, // Based on observed 38%
      lines: 20, // Based on observed 28%
    },
    'src/services/implementations/youtube-api-service.js': {
      statements: 3, // Based on observed 3.44%
      branches: 2, // Based on observed 2.08%
      functions: 6, // Based on observed 6.66%
      lines: 3, // Based on observed 3.48%
    },
    'src/core/content-classifier.js': {
      statements: 25, // Based on observed 30.91%
      branches: 20, // Based on observed 26.31%
      functions: 35, // Based on observed 40.74%
      lines: 25, // Based on observed 30.91%
    },
  },

  // Integration test specific settings
  testTimeout: 30000, // 30 seconds for integration tests
  maxWorkers: 1, // Sequential execution for integration tests

  // Test execution
  verbose: true,
  bail: false,
  forceExit: true,
  detectOpenHandles: true,

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,

  // Integration test optimizations
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache-integration',

  // Error handling
  errorOnDeprecated: false,
};
