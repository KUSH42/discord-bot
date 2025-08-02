/**
 * Jest configuration for integration tests
 * Tests module interactions while maintaining reasonable coverage expectations
 */

export default {
  testEnvironment: 'node',

  rootDir: '../../', // Set root to project root

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
  coverageReporters: ['text', 'json', 'html'],
  coverageProvider: 'v8', // Use V8 coverage instead of Babel for better consistency

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
