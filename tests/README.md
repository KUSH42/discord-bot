# Test Architecture & CI Framework

## 1. Introduction & Purpose

This document serves as the definitive architectural guideline and detailed
documentation for the project's testing and Continuous Integration (CI)
framework. It is designed for both human developers and AI agents to gain a deep
understanding of our testing practices.

The primary purpose of this guide is to:

- Define our testing philosophy and strategy.
- Standardize the structure, location, and conventions for all test types.
- Detail the tools and frameworks used in our testing ecosystem.
- Explain the Continuous Integration (CI) process and how tests are executed and
  reported.
- Provide clear, actionable instructions for maintaining and expanding the test
  suite.

A robust testing framework is critical for ensuring code quality, stability, and
preventing regressions. It enables confident, rapid development and deployment
cycles. For our AI development assistants, this document is the foundational
knowledge base, enabling them to autonomously improve, expand, and maintain our
test suite and CI processes.

## 2. Testing Philosophy & Principles

Our testing strategy is guided by the following core principles:

- **Fast Feedback Loops:** Tests should run quickly, especially those executed
  frequently during development.
- **High Confidence on Critical Paths:** We prioritize comprehensive testing of
  core functionalities and critical user flows.
- **Adherence to the Testing Trophy Model:** We strive for a balanced portfolio
  of tests, with a strong base of unit tests, a healthy number of integration
  tests, and a select group of E2E tests for critical workflows.
- **Maintainability Over Sheer Coverage:** While we aim for high coverage, the
  clarity, readability, and maintainability of tests are paramount.
- **Reliability:** Tests must be deterministic and free of flakiness.
- **Shift-Left Testing:** We aim to catch issues as early as possible in the
  development lifecycle.

### 2.1. Recent Test Infrastructure Improvements ✅

**Major fixes completed in 2025-07-21:**

- **Timer Testing Resolution:** Implemented reliable patterns for testing async
  timer-dependent code (see `tests/TIMER-TESTING-GUIDE.md`)
- **Enhanced Duplicate Detection:** Complete test coverage for content
  fingerprinting and persistent storage integration
- **YouTube Scraper Updates:** Updated tests for new architecture with content
  coordinator integration
- **CI/CD Reliability:** Resolved hanging tests and improved GitHub Actions
  execution time

**Event-Driven Architecture Migration (2025-07-22):**

- **Modern Message Processing:** Migrated from infinite-loop to
  EventEmitter-based architecture with deterministic testing
- **Comprehensive Component Testing:** Added tests for MessageQueue,
  RateLimiter, MessageProcessor, and ProcessingScheduler
- **Test Mode Support:** Implemented proper test vs production mode handling for
  reliable test execution
- **Jest Compatibility Improvements:** Resolved EventEmitter async operation
  issues in Jest environment
- **Backward Compatibility Validation:** Ensured seamless migration with adapter
  pattern testing

**Application Layer Testing Achievement (2025-07-23):**

- **Comprehensive Application Coverage**: Achieved exceptional test coverage
  across all application orchestrators with 22 new test files and 500+ new
  tests:
  - **bot-application.js**: 89.02% statement coverage (36.17% → 89.02%) with
    comprehensive Discord command processing, state management, and error
    handling tests
  - **monitor-application.js**: 95.84% statement coverage (59.74% → 95.84%)
    with complete PubSubHubbub webhook handling, video processing pipeline,
    scheduled content polling, and signature verification tests
  - **scraper-application.js**: 77.83% statement coverage (51.88% → 77.83%)
    with authentication flows, content detection, tweet processing, and browser
    automation tests
- **Production-Ready Testing**: All application layer components now have
  comprehensive test suites covering normal operations, error scenarios, edge
  cases, and integration points
- **YouTube Monitoring Excellence**: Complete test coverage for PubSubHubbub
  subscriptions, webhook signature verification, scheduled livestream polling,
  state transitions, and API fallback mechanisms
- **Authentication & Security Testing**: Comprehensive test suites for X/Twitter
  authentication, session management, credential handling, and browser
  automation security
- **Discord Integration Testing**: Full coverage of Discord bot commands,
  message processing, rate limiting integration, and health monitoring

For detailed information on recent fixes, see
`docs/TEST-INFRASTRUCTURE-FIXES.md` and
`DISCORD-RATE-LIMITED-SENDER-MIGRATION.md`.

## 3. Test Types & Scope

### 3.1. Unit Tests

- **Definition:** Unit tests verify the functionality of individual, isolated
  units of code, such as functions, methods, or components. Their primary
  objective is to ensure that each unit of the software performs as designed.
- **Tools/Frameworks:** [Jest](https://jestjs.io/)
- **Location:** `tests/unit/`
- **Conventions:**
  - **Naming:** `*.test.js`
  - **Mocking:** Mocks are located in `tests/mocks/`. Jest's built-in mocking
    features (`jest.mock`, `jest.spyOn`) are used extensively to isolate units
    under test.
- **AI Agent Guidance:**
  - Prioritize creating unit tests for all new functions and logic.
  - When fixing a bug, first write a failing unit test that reproduces the
    issue, then implement the fix.
  - Ensure all mocks are cleared between tests using `jest.clearAllMocks()`.

### 3.2. Integration Tests

- **Definition:** Integration tests verify that different modules or services
  used by the application work together as expected. These tests focus on the
  interactions between components.
- **Tools/Frameworks:** [Jest](https://jestjs.io/)
- **Location:** `tests/integration/`
- **Conventions:**
  - **Naming:** `*.test.js`
  - **Environment:** These tests run in a Docker container with dependent
    services (like Redis) available.
- **AI Agent Guidance:**
  - Create integration tests for workflows that involve multiple internal
    modules (e.g., the command processor interacting with the Discord service).
  - Focus on testing the contracts and data flow between integrated parts.

### 3.3. End-to-End (E2E) Tests

- **Definition:** E2E tests simulate real user scenarios and verify that the
  entire application works as expected from start to finish. This includes the
  UI, backend services, and external integrations.
- **Tools/Frameworks:** [Jest](https://jestjs.io/),
  [Playwright](https://playwright.dev/) (for browser interactions)
- **Location:** `tests/e2e/`
- **Conventions:**
  - **Naming:** `*.test.js`
  - **Configuration:** E2E tests use `jest.e2e.config.js`.
- **AI Agent Guidance:**
  - Add E2E tests for new critical user journeys.
  - When a bug is found in production, consider if an E2E test could have caught
    it.
  - Analyze flaky E2E tests and propose more robust solutions (e.g., improved
    waiting strategies, atomic assertions).

### 3.4. Performance Tests

- **Definition:** Performance tests measure the application's responsiveness,
  stability, and scalability under a given workload.
- **Tools/Frameworks:** [Jest](https://jestjs.io/)
- **Location:** `tests/performance/`
- **Conventions:**
  - **Naming:** `*.test.js`
  - **Focus:** These tests are designed to benchmark critical operations and
    identify performance regressions.
- **AI Agent Guidance:**
  - Analyze the output of performance tests to identify bottlenecks.
  - Propose optimizations to the code or test environment to improve
    performance.

### 3.5. Security Tests

- **Definition:** Security tests are designed to uncover vulnerabilities in the
  application and ensure that it is robust against common threats.
- **Tools/Frameworks:** [Jest](https://jestjs.io/), `npm audit`
- **Location:** `tests/security/`
- **Conventions:**
  - **Naming:** `*.test.js`
  - **Configuration:** Security tests use `jest.security.config.js`.
  - **Focus:** Tests include input validation, dependency vulnerability checks,
    and checks for potential secret leaks.
- **AI Agent Guidance:**
  - Add new security tests for any new input processing logic.

### 3.6. Accessibility (A11y) Tests

- (Not currently implemented)

## 4. Test Frameworks & Libraries

- **[Jest](https://jestjs.io/):** The primary testing framework for unit,
  integration, E2E, performance, and security tests.
- **[Playwright](https://playwright.dev/):** Used for browser automation in E2E
  tests.
- **[ESLint](https://eslint.org/):** Modern flat configuration with Jest
  integration, comprehensive rules for code quality, security, and performance.
- **[Prettier](https://prettier.io/):** Consistent code formatting with
  file-specific rules and integration with ESLint.
- **[Babel](https://babeljs.io/):** JavaScript transpilation with Node.js 18+
  targeting and modern transform plugins.
- **[Husky](https://typicode.github.io/husky/):** Pre-commit hooks for automated
  quality checks and build incrementing.
- **[Codecov](https://about.codecov.io/):** Used for tracking code coverage.

## 4.1. Test Configurations

The project includes multiple Jest configurations optimized for different
scenarios:

### Main Configuration (`jest.config.js`)

- **Production-ready configuration** with full coverage enforcement
- **Parallel execution** with 50% worker utilization
- **Caching enabled** for improved performance
- **Coverage thresholds enforced** for quality gates

### Development Configuration (`jest.dev.config.js`)

- **Optimized for fast feedback** during development
- **Single worker execution** for easier debugging
- **Bail on first failure** for immediate attention
- **Coverage disabled** for faster execution
- **Git-aware testing** (only changed files)

### Specialized Configurations

- **E2E Configuration (`jest.e2e.config.js`):** Extended timeouts, coverage
  disabled
- **Security Configuration (`jest.security.config.js`):** Security-focused test
  execution

## 4.2. Coverage Thresholds

The project enforces different coverage requirements based on component
criticality:

### Global Thresholds (Minimum)

```javascript
{
  statements: 25%,
  branches: 20%,
  functions: 25%,
  lines: 25%
}
```

### Core Modules (Higher Standards)

```javascript
'src/core/': {
  statements: 50%,
  branches: 40%,
  functions: 55%,
  lines: 50%
}
```

### Application Layer (High Standards)

```javascript
'src/application/bot-application.js': {
  statements: 85%,
  branches: 70%,
  functions: 80%,
  lines: 85%
},
'src/application/monitor-application.js': {
  statements: 85%,
  branches: 75%,
  functions: 85%,
  lines: 85%
},
'src/application/scraper-application.js': {
  statements: 75%,
  branches: 60%,
  functions: 80%,
  lines: 75%
}
```

### Critical Components (High Standards)

```javascript
'src/services/implementations/youtube-api-service.js': {
  statements: 90%,
  branches: 85%,
  functions: 90%,
  lines: 90%
},
'src/core/content-classifier.js': {
  statements: 85%,
  branches: 75%,
  functions: 90%,
  lines: 85%
}
```

These thresholds ensure code quality while being realistic and achievable.

## 5. Test Structure & Code Conventions

- **File Naming & Organization:** Test files are co-located in the `tests/`
  directory, under subdirectories corresponding to the test type.
- **Test Data Management:** Test data and fixtures are managed within the tests
  themselves or in the `tests/fixtures/` directory.
- **Mocking/Stubbing/Spying Strategy:** Jest's built-in functions (`jest.mock`,
  `jest.spyOn`, `jest.fn`) are the standard for creating test doubles.
- **Assertion Style:** The `expect` assertion style from Jest is used
  (`expect(value).toBe(expected)`).
- **Readability & Maintainability:** Tests should follow the
  **Arrange-Act-Assert** pattern. Each test should have a single, clear
  responsibility.

## 5.1. Async Handling & Mock Implementation Best Practices

### Async Callback Testing

When testing code that uses `setImmediate` or other async callback mechanisms:

```javascript
// ✅ Correct: Wait for both promises and setImmediate callbacks
const flushPromises = async () => {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
};

// Usage in tests
it('should notify subscribers of state changes', async () => {
  stateManager.subscribe('key', mockCallback);
  stateManager.set('key', 'value');

  await flushPromises(); // Wait for async callbacks
  expect(mockCallback).toHaveBeenCalledWith('value', undefined, 'key');
});
```

### Proper Mock Setup

For classes with complex constructor behavior:

```javascript
// ✅ Correct: Use jest.spyOn for methods after instantiation
beforeEach(() => {
  const dependencies = {
    /* mock dependencies */
  };
  instance = new MyClass(dependencies);

  // Spy on methods that need mocking
  jest.spyOn(instance, 'methodName').mockResolvedValue(expectedValue);
});

// ❌ Incorrect: Don't use Class.mockImplementation in tests
// This won't work as expected
MyClass.mockImplementation(() => ({
  /* mock */
}));
```

### Timer Handling

When testing code with delays or timeouts:

```javascript
// ✅ Correct: Use async timer advancement
it('should handle delayed operations', async () => {
  jest.useFakeTimers();

  const promise = myFunction();
  await jest.runAllTimersAsync(); // Wait for timers AND promises

  const result = await promise;
  expect(result).toBe(expected);

  jest.useRealTimers();
});
```

### Error Log Silencing in Tests

The project uses global console mocking in `tests/setup.js` to prevent false
positive error logs during test execution. This ensures clean test output while
preserving the ability to test error handling behavior.

#### ✅ **Automatic Console Silencing**

All `console.error`, `console.warn`, `console.log`, and `console.info` calls are
automatically mocked in the test environment:

```javascript
// These are automatically silenced in tests
console.error('This error message will not appear in test output');
console.warn('This warning will not appear in test output');
```

#### ✅ **Testing Error Handling Without Log Noise**

When testing error scenarios, focus on the error handling logic rather than
logging:

```javascript
// ✅ Good: Test validates error handling without generating log noise
describe('Error Handling', () => {
  it('should handle API failures gracefully', async () => {
    mockApiService.getData.mockRejectedValue(new Error('API Error'));

    const result = await service.fetchData();

    // Focus on the error handling outcome, not logging
    expect(result.success).toBe(false);
    expect(result.error).toBe('API Error');
  });
});
```

#### ✅ **When Testing Error Logging Behavior is Required**

For tests that specifically validate logging behavior, use explicit console
spies:

```javascript
// ✅ Good: For tests that specifically validate error logging behavior
it('should log critical errors to console', async () => {
  const consoleErrorSpy = jest
    .spyOn(console, 'error')
    .mockImplementation(() => {});

  await service.handleCriticalError(new Error('Critical failure'));

  expect(consoleErrorSpy).toHaveBeenCalledWith(
    expect.stringContaining('Critical error:'),
    expect.any(Error)
  );

  consoleErrorSpy.mockRestore();
});
```

#### ✅ **Retry Logic and Promise Rejection Testing**

For testing retry logic with setTimeout delays, use these proven patterns:

```javascript
// ✅ Method 1: Global advanceAsyncTimers (for complex timer scenarios)
it('should retry with proper time advancement', async () => {
  // Set up fake timers and global.advanceAsyncTimers helper
  // See tests/TIMER-TESTING-GUIDE.md for complete setup
  
  mockService.operation.mockRejectedValue(new Error('Retry Error'));
  const promise = service.operationWithRetry();
  
  await global.advanceAsyncTimers(10000); // Advance through all retry delays
  await expect(promise).rejects.toThrow('Retry Error');
  expect(mockService.operation).toHaveBeenCalledTimes(3);
});

// ✅ Method 2: setTimeout Override (for simple retry scenarios)
it('should retry navigation and succeed', async () => {
  mockPage.goto
    .mockRejectedValueOnce(new Error('net::ERR_ABORTED'))
    .mockRejectedValueOnce(new Error('net::ERR_ABORTED'))
    .mockResolvedValueOnce('success');

  // Override setTimeout to make delays instant for testing
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn, _delay) => originalSetTimeout(fn, 0);

  try {
    const result = await browserService.goto('https://example.com');
    expect(result).toBe('success');
    expect(mockPage.goto).toHaveBeenCalledTimes(3);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});
```

**Key points for retry testing:**
- Use `mockRejectedValueOnce` per retry attempt to avoid Jest error display issues
- Always restore overridden globals in finally blocks
- Choose setTimeout override for simple cases, advanceAsyncTimers for complex scenarios

#### ❌ **Avoid Adding Console Calls in Test Mocks**

Don't add console.error calls in test mock implementations as they create noise:

```javascript
// ❌ Avoid: This creates false positive error logs
const mockHandler = async data => {
  try {
    return await processData(data);
  } catch (error) {
    console.error('Processing failed:', error.message); // Creates noise!
    throw error;
  }
};

// ✅ Better: Silent error handling in test mocks
const mockHandler = async data => {
  try {
    return await processData(data);
  } catch (error) {
    // Silenced in tests - error is re-thrown for Jest to handle
    throw error;
  }
};
```

#### **Global Test Setup Benefits**

- **Clean Output:** No false positive error logs cluttering test results
- **Test Integrity:** Tests that validate logging behavior still work correctly
- **Debugging Support:** Access to original console via `global.originalConsole`
  when needed
- **Unhandled Rejection Silence:** Unhandled rejections are silenced in test
  environment

#### **Debugging When Needed**

If you need to see actual console output during debugging:

```javascript
// Use original console for debugging
global.originalConsole.error('This will actually appear in output');

// Or temporarily restore console for a test
beforeEach(() => {
  console.error = global.originalConsole.error; // Restore for debugging
});
```

### Common Pitfalls to Avoid

- **Don't** use duplicate `beforeEach` blocks - this causes test interference
- **Don't** mock class constructors directly in test files
- **Don't** forget to wait for `setImmediate` callbacks in async tests
- **Don't** add console.error calls in test mock implementations (creates false
  positives)
- **Do** use `jest.clearAllMocks()` in `beforeEach` to ensure clean test state
- **Do** restore timers with `jest.useRealTimers()` after fake timer tests
- **Do** focus on error handling outcomes rather than logging in most tests

## 6. Continuous Integration (CI) Framework

- **CI/CD Platform:** [GitHub Actions](https://github.com/features/actions)
- **Workflow Triggers:**
  - `push`: On pushes to `main`, `master`, `dev`, and `develop` branches.
  - `pull_request`: On pull requests targeting the main branches.
  - `schedule`: Daily runs at 2 AM UTC.
  - `workflow_dispatch`: Manual runs.
- **Test Execution Commands:**
  - **All Tests (via individual jobs):** The CI pipeline runs each test suite in
    a separate job.
  - **Unit Tests:** `npm run test:unit`
  - **Integration Tests:** `npm run test:integration`
  - **E2E Tests:** `npm run test:e2e`
  - **Performance Tests:** `npm run test:performance`
  - **Security Tests:** `npm run test:security`
  - **Parallel Execution:** `npm run test:parallel` (50% worker utilization)
  - **Code Quality:** `npm run lint` (ESLint with Jest integration and
    comprehensive rules)
  - **Formatting:** `npm run format` (Prettier with file-specific
    configurations)
- **Enhanced Testing Options:**
  - **Development Mode:** `npm run test:dev` (optimized for fast feedback)
  - **Changed Files Only:** `npm run test:changed` (Git-aware testing)
  - **Debug Mode:** `npm run test:debug` (with breakpoint support)
  - **Interactive Runner:** `npm run test:runner <command>` (enhanced CLI)
  - **Verbose Output:** `npm run test:verbose`
  - **Silent Mode:** `npm run test:silent`
- **Coverage Enforcement:**
  - **Global Thresholds:** 25% statements/lines, 20% branches, 25% functions
  - **Core Modules:** 50% statements/lines, 40% branches, 55% functions
  - **Critical Components:** 85-90% for well-tested modules
- **Reporting:**
  - **Code Coverage:** Coverage is collected using Jest's `--coverage` flag and
    uploaded to [Codecov](https://app.codecov.io/gh/KUSH42/discord-youtube-bot).
    Merged reports are generated in CI.
  - **Test Results:** Test results and artifacts are uploaded to GitHub Actions
    for each run.
  - **Performance Metrics:** Test execution times and memory usage tracking
- **Quality Gates & Checks:**
  - All tests must pass before a pull request can be merged.
  - Coverage thresholds must be met (enforced by Jest)
  - ESLint code quality checks must pass (enhanced with security and performance
    rules).
  - Prettier formatting validation must pass.
  - Pre-commit hooks automatically enforce code quality standards.
  - Parallel test execution with 50% worker utilization for optimal performance.

## 7. Local Development Workflow

### 7.1. Quick Start Commands

- **Running All Tests:**
  ```shell
  npm test
  ```
- **Development Mode (Fast Feedback):**
  ```shell
  npm run test:dev
  ```
- **Watch Mode:**
  ```shell
  npm run test:watch
  ```
- **Only Changed Files:**
  ```shell
  npm run test:changed
  ```

### 7.2. Specific Test Types

- **Unit Tests Only:**
  ```shell
  npm run test:unit
  ```
- **Integration Tests:**
  ```shell
  npm run test:integration
  ```
- **End-to-End Tests:**
  ```shell
  npm run test:e2e
  ```
- **Performance Tests:**
  ```shell
  npm run test:performance
  ```
- **Security Tests:**
  ```shell
  npm run test:security
  ```

### 7.3. Enhanced Testing Options

- **Parallel Execution (Faster):**
  ```shell
  npm run test:parallel
  ```
- **Specific Test Files:**
  ```shell
  npm run test:file -- command-processor
  ```
- **Debug Mode (with breakpoints):**
  ```shell
  npm run test:debug
  ```
- **Interactive Test Runner:**
  ```shell
  npm run test:runner unit
  npm run test:runner coverage --verbose
  npm run test:runner watch fallback
  ```

### 7.4. Coverage and Reporting

- **Generate Coverage Reports:**
  ```shell
  npm run test:coverage
  ```
  The report is generated in the `coverage/` directory. Open
  `coverage/lcov-report/index.html` to view it.
- **Verbose Test Output:**
  ```shell
  npm run test:verbose
  ```
- **Silent Mode (errors only):**
  ```shell
  npm run test:silent
  ```

### 7.5. Advanced Workflows

- **Test Development Configuration:**
  ```shell
  # Uses jest.dev.config.js for optimized development
  npm run test:dev -- --watch
  ```
- **Git-Aware Testing:**
  ```shell
  # Only test files related to your changes
  npm run test:watch:changed
  ```
- **Debugging Specific Tests:**
  ```shell
  # Run with Node.js debugger
  npm run test:debug -- monitor-application
  ```

### 7.6. Interactive Test Runner

The project includes a custom test runner (`tests/test-runner.js`) with enhanced
capabilities:

```shell
# Basic usage
npm run test:runner <command> [options]

# Examples
npm run test:runner unit                    # Run unit tests
npm run test:runner coverage --verbose      # Coverage with verbose output
npm run test:runner watch --bail           # Watch mode, stop on first failure
npm run test:runner dev                     # Development-optimized run

# Get help
npm run test:runner --help

# Show test statistics
npm run test:runner --stats
```

**Features:**

- ✅ **Colored output** for better readability
- ✅ **Performance timing** for test execution
- ✅ **Enhanced error reporting** with stack traces
- ✅ **Automatic Jest option passing**
- ✅ **Quick command shortcuts**

## 8. Performance Optimizations

The test suite includes several performance optimizations:

### 8.1. Parallel Execution

- **50% worker utilization** by default (`maxWorkers: '50%'`)
- **Automatic core detection** for optimal resource usage
- **Load balancing** across available workers

### 8.2. Caching Strategy

- **Jest cache enabled** with dedicated `.jest-cache/` directory
- **Module resolution caching** with Haste configuration
- **Transform caching** for faster subsequent runs

### 8.3. Test Discovery Optimization

- **Simplified glob patterns** for faster file discovery
- **Optimized testMatch** configuration
- **Reduced filesystem scanning** through targeted patterns

### 8.4. Development Optimizations

- **Git-aware testing** (`--onlyChanged`) for incremental development
- **Watch mode optimizations** with intelligent file monitoring
- **Development configuration** for faster feedback loops

**Performance Gains:**

- ⚡ **~40% faster execution** through parallelization
- ⚡ **~60% faster subsequent runs** with caching
- ⚡ **~80% faster development cycles** with git-aware testing

## 9. Contribution Guidelines & AI Agent Directives

- **Adding New Tests:** All new features and bug fixes must be accompanied by
  corresponding tests. The type of test (unit, integration, etc.) should be
  chosen based on the nature of the change.
- **Updating Existing Tests:** When refactoring or modifying code, the
  corresponding tests must be updated to reflect the changes.
- **Coverage Requirements:** New code must meet the established coverage
  thresholds for its component type.
- **Performance Considerations:** Tests should execute efficiently and use
  appropriate configurations for their purpose.

### AI Agent Specific Directives:

- **Coverage Improvement:** Proactively identify critical modules with low test
  coverage and generate new tests to cover untested logic.
- **Flakiness Detection & Resolution:** Analyze test results to identify flaky
  tests and propose deterministic fixes.
- **Performance Optimization:** Analyze test runtimes and suggest optimizations
  using the available performance configurations.
- **CI Optimization:** Propose improvements to the GitHub Actions workflow
  (`.github/workflows/test.yml`) for speed, efficiency, or robustness.
- **Code Generation:** Generate new test files and test cases, strictly adhering
  to the conventions defined in this document.
- **Configuration Management:** Utilize appropriate Jest configurations (main,
  dev, e2e, security) based on the testing context.
- **Coverage Threshold Compliance:** Ensure all new code meets or exceeds the
  established coverage thresholds for its component type.

### Enhanced Testing Workflows:

- **Development Phase:** Use `jest.dev.config.js` for rapid iteration and
  immediate feedback
- **Integration Testing:** Leverage parallel execution for faster comprehensive
  testing
- **Debugging:** Utilize debug configuration with breakpoint support
- **CI/CD:** Employ full configuration with coverage enforcement and quality
  gates

## 10. Troubleshooting & Common Issues

### 10.1. Common Error Patterns

- **`Module not found`:** This usually indicates a problem with module mocking
  or a missing dependency. Verify that `jest.mock` is used correctly or run
  `npm install`.
- **Timeout Errors:** In E2E or integration tests, this can indicate a slow
  response from an external service or a flaw in the test's waiting mechanism.
- **Flaky E2E Tests:** Often caused by race conditions or timing issues.
  Investigate the test flow and add more robust waiting mechanisms (e.g.,
  `waitForSelector` instead of fixed delays).
- **Coverage Threshold Failures:** Tests fail due to insufficient coverage.
  Check which files/functions need additional test coverage.

### 10.2. Performance Issues

- **Slow Test Execution:**
  - Use `npm run test:parallel` for faster execution
  - Switch to `npm run test:dev` for development
  - Utilize `npm run test:changed` for git-aware testing
- **Memory Issues:** Large test suites may consume significant memory. Use
  `forceExit: true` and `detectOpenHandles: true` in Jest config.
- **Cache Issues:** Clear Jest cache with `rm -rf .jest-cache` if experiencing
  unexpected behavior.

### 10.3. Configuration Issues

- **Wrong Configuration Loading:** Ensure you're using the correct Jest config
  file for your use case:
  - `jest.config.js` - Production/CI
  - `jest.dev.config.js` - Development
  - `jest.e2e.config.js` - End-to-end tests
  - `jest.security.config.js` - Security tests

## 11. Future Enhancements & Roadmap

- **Mutation Testing:** Explore integrating a mutation testing framework to
  assess the quality of our tests.
- **Contract Testing:** For services we don't own, introduce contract testing to
  ensure our integrations remain valid.
- **Expand Performance Testing:** Broaden the scope of performance tests to
  cover more application scenarios.
- **Visual Regression Testing:** Add visual testing capabilities for UI
  components.
- **Test Analytics:** Implement test execution analytics and reporting
  dashboard.

## 12. Support & Contact

For any questions or issues related to the testing framework or CI pipeline,
please refer to the project's main `README.md` or open an issue in the GitHub
repository.

### Quick Reference Commands

```shell
# Essential Commands
npm test                    # Run all tests
npm run test:dev           # Development mode (fast)
npm run test:coverage      # Generate coverage report
npm run test:watch         # Watch mode
npm run test:parallel      # Parallel execution

# Debugging
npm run test:debug         # Debug mode with breakpoints
npm run test:verbose       # Detailed output
npm run test:runner --help # Interactive runner help

# Specific Test Types
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
npm run test:e2e           # End-to-end tests
npm run test:security      # Security tests
npm run test:performance   # Performance tests
```
