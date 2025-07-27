export default {
  testEnvironment: 'node',
  transform: {
    '^.+.js$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
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
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'clover'],
  coverageProvider: 'v8', // Use V8 coverage instead of Babel for better consistency
  // Re-enabled coverage thresholds after fixing hanging tests
  coverageThreshold: {
    global: {
      statements: 80, // Increased from 20 to be more achievable
      branches: 75, // Increased from 15
      functions: 70, // Increased from 20
      lines: 70, // Increased from 20
    },
  },
  testMatch: ['**/tests/**/*.test.js', '**/tests/**/*.spec.js', '**/__tests__/**/*.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 5000, // Reduce timeout to catch hangs faster
  verbose: false,
  forceExit: true,
  detectOpenHandles: true,
  // Additional cleanup options
  resetMocks: true,
  resetModules: true,
  moduleFileExtensions: ['js', 'json'],
  transformIgnorePatterns: ['node_modules/(?!(.*\\.mjs$))'],
  maxWorkers: 4,
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache',
  clearMocks: true,
  restoreMocks: true,
  // Test result optimization
  bail: false,
  passWithNoTests: true,
  // Module resolution optimization
  haste: {
    computeSha1: true,
    throwOnModuleCollision: true,
  },
};
