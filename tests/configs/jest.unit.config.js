/**
 * Jest configuration for unit tests
 * Tests individual functions and modules with extensive mocking
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

  // Test discovery - only unit tests
  testMatch: ['<rootDir>/tests/unit/**/*.test.js'],

  // Coverage collection - ENABLED for unit tests
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!node_modules/**',
    '!coverage/**',
    '!jest.*.config.js',
    '!scripts/**',
    '!tests/**',
    '!src/services/interfaces/**',
    '!src/setup/**',
    // Exclude main entry points that start infinite processes
    '!index.js',
    '!src/x-scraper.js',
    '!src/youtube-monitor.js',
  ],

  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  coverageDirectory: `coverage/unit-tests-node${process.env.NODE_VERSION}`,
  coverageReporters: ['text', 'json', 'html'],
  coverageProvider: 'v8', // Use V8 coverage instead of Babel for better consistency

  // Unit test reporters
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'test-results',
        outputName: process.env.NODE_VERSION ? `unit-tests-node${process.env.NODE_VERSION}.xml` : 'unit-tests.xml',
        classNameTemplate: 'Unit.{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true,
        addFileAttribute: true,
        includeConsoleOutput: true,
      },
    ],
  ],

  // Unit test specific settings
  testTimeout: 10000, // 10 seconds for unit tests
  maxWorkers: 4, // Parallel execution for faster unit tests

  // Test execution
  verbose: true,
  bail: false,
  forceExit: true,
  detectOpenHandles: true,

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,

  // Unit test optimizations
  cache: true,
  cacheDirectory: `<rootDir>/.jest-cache-unit-${process.env.NODE_VERSION}`,

  // Error handling
  errorOnDeprecated: false,
};
