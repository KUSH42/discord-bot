/**
 * Jest configuration for unit tests
 * Tests individual functions and modules with extensive mocking
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
  coverageReporters: ['text', 'lcov', 'html', 'clover'],

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

  // Unit test coverage thresholds
  coverageThreshold: {
    global: {
      statements: 50, // Higher threshold for unit tests
      branches: 40,
      functions: 55,
      lines: 50,
    },
    // Core modules should have excellent unit test coverage
    'src/core/': {
      statements: 85,
      branches: 80,
      functions: 90,
      lines: 85,
    },
    'src/utilities/': {
      statements: 90,
      branches: 85,
      functions: 95,
      lines: 90,
    },
  },

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
  cacheDirectory: '<rootDir>/.jest-cache-unit',

  // Error handling
  errorOnDeprecated: false,
};
