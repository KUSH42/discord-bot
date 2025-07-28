import baseConfig from '../../jest.config.js';

export default {
  ...baseConfig,
  rootDir: '../../', // Set root to project root
  // Security tests focus on validation behavior, not source code coverage
  coverageThreshold: {
    global: {
      statements: 0,
      branches: 0,
      functions: 0,
      lines: 0,
    },
  },
  // Disable coverage for security tests by default since they focus on input validation
  collectCoverage: true,
  testMatch: ['**/tests/security/**/*.test.js', '**/tests/security/**/*.spec.js'],
  testTimeout: 45000,

  // Security test reporters
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'test-results',
        outputName: 'security-tests.xml',
        classNameTemplate: 'Security.{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true,
        addFileAttribute: true,
        includeConsoleOutput: true,
      },
    ],
  ],
};
