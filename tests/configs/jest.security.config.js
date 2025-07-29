import baseConfig from '../../jest.config.js';

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

  // Test discovery - only security test files
  testMatch: ['<rootDir>/tests/**/*security*.test.js'],

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

  coverageDirectory: 'coverage/security-tests1',
  coverageReporters: ['text', 'lcov', 'html', 'clover'],

  // Integration test reporters
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'test-results',
        outputName: 'security-tests.xml',
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
  cacheDirectory: '<rootDir>/.jest-cache-security',

  // Error handling
  errorOnDeprecated: false,
};
