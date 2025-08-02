import baseConfig from '../../jest.config.js';

/**
 * Jest configuration for debugging open handles
 * Use this config when you need to diagnose async resource leaks
 */
export default {
  ...baseConfig,
  // Set correct root directory
  rootDir: '../../',

  // Enhanced handle detection
  detectOpenHandles: true,
  forceExit: false, // Don't force exit so we can see the handles

  // Longer timeout to debug properly
  testTimeout: 30000,

  // Run tests serially for better debugging
  maxWorkers: 1,

  // Disable coverage for debugging sessions
  collectCoverage: false,

  // Enhanced output
  verbose: true,

  // Add handle debug setup to existing setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js', '<rootDir>/tests/utils/handle-debug-setup.js'],

  // Use default reporter for now
  reporters: ['default'],

  // Environment variables for debugging
  testEnvironment: 'node',
  globals: {
    __HANDLE_DEBUG__: true,
  },
};
