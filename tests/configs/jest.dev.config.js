import baseConfig from '../../jest.config.js';

/**
 * Development-optimized Jest configuration
 * Provides faster feedback for local development
 */
export default {
  ...baseConfig,
  rootDir: '../../', // Set root to project root
  // Faster execution for development
  maxWorkers: 1,
  bail: 1, // Stop on first failure
  verbose: true,

  // Coverage disabled for faster runs
  collectCoverage: false,

  // Shorter timeout for faster feedback
  testTimeout: 5000,

  // Watch mode optimizations
  watchman: true,
  watchPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/coverage/',
    '<rootDir>/.git/',
    '<rootDir>/.jest-cache/',
    '<rootDir>/logs/',
  ],

  // Only run tests related to changed files (use --onlyChanged flag instead)
  // onlyChanged: true,

  // Clear terminal on each run
  clearMocks: true,

  // Show individual test results
  reporters: ['default'],
};
