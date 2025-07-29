# Testing Guidelines for AI Development Assistants

**Primary Reference**: This file contains the authoritative testing patterns and guidelines for AI agents working with the Discord YouTube Bot codebase.

**For Human Developers**: See `tests/TESTING.md` for quick start guides and interactive development workflows.

**For Architecture Details**: See `tests/README.md` for comprehensive CI/CD and testing philosophy documentation.

## Test Requirements & Coverage

### Coverage Thresholds
- **Global**: 25% statements/lines, 20% branches, 25% functions
- **Core modules**: 50% statements/lines, 40% branches, 55% functions
- **Critical components**: 85-90% coverage

### Test Organization
- `tests/unit/` - Individual functions/classes with mocking
- `tests/integration/` - Service interactions, API endpoints
- `tests/e2e/` - Complete user workflows
- `tests/performance/` - Benchmarks and bottlenecks
- `tests/security/` - Input validation, security controls

### Key Testing Patterns
```javascript
// Async callback handling
const flushPromises = async () => {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
};

// Timer testing
jest.useFakeTimers();
await jest.runAllTimersAsync();
jest.useRealTimers();

// Proper mock setup
beforeEach(() => {
  service = new Service(dependencies);
  jest.spyOn(service, 'method').mockResolvedValue(result);
});
```

### Test Utilities ✅ **FULLY OPERATIONAL**
**Location**: `tests/fixtures/` - Centralized test utilities for consistent, reliable testing

**Core Utilities:**
- **Enhanced Logger Factory** (`enhanced-logger-factory.js`): Pre-configured mocks for enhanced logging system
- **Timer Test Utils** (`timer-test-utils.js`): Advanced async timer coordination patterns
- **Playwright Mocks** (`playwright-mocks.js`): Complete browser automation mocks with all required methods
- **Application Mocks** (`application-mocks.js`): Standardized dependency injection for ScraperApplication, MonitorApplication, ContentAnnouncer

**Usage Example:**
```javascript
import { createScraperApplicationMocks, timerTestUtils } from '../fixtures/test-helpers.js';

// ✅ BEFORE: 50+ lines of manual mock setup
// ✅ NOW: 3 lines with comprehensive, tested mocks
const mocks = createScraperApplicationMocks();
const scraperApp = new ScraperApplication(mocks);
const timerUtils = timerTestUtils.setupComplexTimerTest();
```

### Advanced Timer Testing ✅ **RESOLVED WITH UTILITIES**

**For Complex Timer Operations** (health monitoring, restart functionality):

**✅ Solution**: Use `timerTestUtils` from `tests/fixtures/timer-test-utils.js`

**Common Issues Solved:**
- ✅ Tests timing out with `setInterval` + async callbacks
- ✅ Resource cleanup race conditions  
- ✅ State-dependent timer sequences
- ✅ Event-driven timer interactions

**Simplified Pattern:**
```javascript
import { timerTestUtils } from '../fixtures/test-helpers.js';

beforeEach(() => {
  timerUtils = timerTestUtils.setupComplexTimerTest();
});

afterEach(() => {
  timerUtils.cleanup();
});

// Use proven utility methods instead of manual coordination
await timerUtils.advance(1000);  // Instead of complex manual patterns
await timerUtils.waitForState(() => component.isReady, true);
await timerUtils.ensureCleanup(() => component.resourcesCleared);
```

### Critical Advanced Timer Patterns for Restart Capabilities

#### Deep Async Coordination
For complex nested async operations inside timer callbacks:

```javascript
// Enhanced timer advancement with deep Promise resolution
global.advanceAsyncTimersDeep = async (ms, maxIterations = 10) => {
  await jest.advanceTimersByTimeAsync(ms);
  
  // Multiple rounds of Promise resolution for nested async operations
  for (let i = 0; i < maxIterations; i++) {
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => process.nextTick(resolve));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

// setInterval-specific advancement
global.advanceIntervalTimersDeep = async (ms, maxIterations = 15) => {
  await jest.advanceTimersByTimeAsync(ms);
  
  // Extra Promise resolution rounds for setInterval callbacks
  for (let i = 0; i < maxIterations; i++) {
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => process.nextTick(resolve));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  // Additional tick to ensure setInterval callbacks are processed
  await new Promise(resolve => process.nextTick(resolve));
};
```

#### Health Monitoring Test Pattern
```javascript
it('should handle nested async operations in health monitoring', async () => {
  const performHealthCheckSpy = jest.spyOn(scraperApp, 'performHealthCheck')
    .mockImplementation(async () => {
      // Simulate nested async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      return { errors: [] };
    });

  scraperApp.startHealthMonitoring(100);

  // Use interval-specific advancement for setInterval callbacks
  await global.advanceIntervalTimersDeep(100, 25);

  expect(performHealthCheckSpy).toHaveBeenCalled();
}, 15000); // Increased timeout for complex operations
```

#### Restart Functionality Test Pattern
```javascript
it('should handle state-dependent restart sequences', async () => {
  const restartSpy = jest.spyOn(scraperApp, 'restart').mockImplementation(async () => {
    scraperApp.isRunning = false;
    await new Promise(resolve => setTimeout(resolve, 100));
    scraperApp.isRunning = true;
  });

  // Start the restart process
  const restartPromise = scraperApp.handleHealthCheckFailure(new Error('Test failure'));
  
  // Wait for restart to begin
  await global.waitForStateChange(() => !scraperApp.isRunning);
  await global.advanceAsyncTimersDeep(200);
  
  // Wait for restart to complete
  await global.waitForStateChange(() => scraperApp.isRunning);
  
  await restartPromise;
  expect(restartSpy).toHaveBeenCalled();
}, 15000);
```

#### State-Dependent Timer Sequences
```javascript
// Wait for specific state changes before advancing timers
global.waitForStateChange = async (stateChecker, timeoutMs = 5000) => {
  const startTime = Date.now();
  while (!stateChecker() && (Date.now() - startTime) < timeoutMs) {
    await global.advanceAsyncTimersDeep(10);
  }
  if (!stateChecker()) {
    throw new Error(`State change timeout after ${timeoutMs}ms`);
  }
};
```

#### Resource Cleanup Race Conditions
```javascript
// Ensure all cleanup operations complete before test assertions
global.ensureCleanupComplete = async (cleanupChecker, maxWaitMs = 3000) => {
  let iterations = 0;
  const maxIterations = maxWaitMs / 50;
  
  while (iterations < maxIterations) {
    await global.advanceAsyncTimersDeep(50);
    if (await cleanupChecker()) {
      return true;
    }
    iterations++;
  }
  return false;
};
```

### Enhanced Logger Testing Pattern
```javascript
// ✅ Correct: Spy on enhanced logger instance
const enhancedLogger = component.logger;
const errorSpy = jest.spyOn(enhancedLogger, 'error');
expect(errorSpy).toHaveBeenCalledWith(...);

// ❌ Incorrect: Testing mock base logger
expect(mockLogger.error).toHaveBeenCalledWith(...);
```

**Why**: Enhanced logger creates child logger instances with correlation tracking, so the actual logging calls don't reach the base mock.

### ContentCoordinator Pattern
```javascript
// ✅ Current architecture
expect(mocks.contentCoordinator.processContent).toHaveBeenCalledWith(
  contentId, 'scraper', expectedContent
);

// ❌ Deprecated pattern
expect(mocks.contentAnnouncer.announceContent).toHaveBeenCalledWith(content);
```

### Error Log Silencing in Tests
The project uses global console mocking in `tests/setup.js` to prevent false positive error logs:

```javascript
// These are automatically silenced in tests
console.error('This error message will not appear in test output');
console.warn('This warning will not appear in test output');
```

**For tests that specifically validate logging behavior:**
```javascript
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

### Efficient Testing Approach
**NEVER run full test suites to check single file fixes:**
- **Single test file**: `npm test -- path/to/specific.test.js`
- **Specific test name**: `npm test -- --testNamePattern="specific test name"`
- **Pattern matching**: `npm test -- --testNamePattern="AuthManager"`
- **Note**: `--testPathPattern` is often unreliable - use direct file paths instead

**Development workflow:**
1. Run only the test you're fixing
2. Once passing, run related tests if needed
3. Full suite only before commits/PRs

## 🤖 AI Agent Decision Tree

### When Writing Tests:
```
Are you testing timer-dependent code (setInterval, health monitoring, restart)?
├─ YES → Use timerTestUtils.setupComplexTimerTest() + advanced patterns
└─ NO  → Use standard createApplicationMocks() from fixtures

Is the component using enhanced logging?
├─ YES → Spy on component.logger instance, NOT base mock
└─ NO  → Use standard mock expectations

Does the test involve content processing?
├─ YES → Expect contentCoordinator.processContent() calls
└─ NO  → Use standard service patterns
```

### When Debugging Failing Tests:
```
Is the test timing out?
├─ YES → Check if it uses timers → Use appropriate advancement pattern
└─ NO  → Check mock expectations and enhanced logger patterns

Are enhanced logger expectations failing?
├─ YES → Spy on component.logger instance instead of base mock
└─ NO  → Check ContentCoordinator vs direct announcer patterns

Is a setInterval test hanging?
├─ YES → Use advanceIntervalTimersDeep(ms, 25) with 15s timeout
└─ NO  → Use standard timer patterns
```

## 🚨 CRITICAL RULES FOR AI AGENTS

### Test Execution Rules
1. **NEVER run full test suites** - use specific patterns to avoid timeouts and excessive output
2. **ALWAYS use specific file patterns**: `npm test -- path/to/specific.test.js`
3. **NEVER run `npm run` for jest** - use `npx jest` command directly when needed
4. **ALWAYS verify test utilities exist** before using advanced patterns

### Memory Leak Prevention
- **NEVER call `main()` functions in tests** - they start infinite processes
- **ALWAYS use test utilities** from `tests/fixtures/` instead of manual mocks
- **ALWAYS clean up timers** with `jest.useRealTimers()` in `afterEach`

### Jest CLI Parameter Update
Node option `"testPathPattern"` was replaced by COMMAND LINE ARGUMENT `"--testPathPatterns"`. 
`"--testPathPatterns"` is only available as a command-line option.

**Correct usage example:**
`npm run test:unit --testPathPatterns='message-sender' -- --verbose`

**Incorrect usage example - DO NOT USE:**
`npm run test:unit -- --testPathPattern="message-sender" --verbose`

## Correct Test Commands

### Running Individual Test Suites
```bash
# ✅ CORRECT: Run specific test patterns
npm run test:unit --testPathPatterns='message-sender' -- --verbose
npm run test:integration --testPathPatterns='webhook' -- --verbose
npm run test:e2e --testPathPatterns='command-processor' -- --verbose

# ❌ INCORRECT: Old parameter name (deprecated)
npm run test:unit -- --testPathPattern='message-sender' --verbose
```

### Commonly Used Test Patterns
```bash
# Core functionality tests
npm run test:unit --testPathPatterns="command-processor|content-announcer|scraper-application"

# Infrastructure tests  
npm run test:unit --testPathPatterns="dependency-container|state-manager|debug-flag"

# Service tests
npm run test:integration --testPathPatterns="youtube-service|browser-profile"

# Specific component focus
npm run test:unit --testPathPatterns="enhanced-logger" -- --verbose
```

### Development Workflow
```bash
# Watch mode for active development
npm run test:watch --testPathPatterns="your-component"

# Run tests for changed files only
npm test -- --onlyChanged

# Update snapshots when needed
npm test -- --updateSnapshot --testPathPatterns="component-name"
```

## Key Jest Options for This Project

### Essential Flags
- `--testPathPatterns=<regex>` - Target specific test files (replaces deprecated testPathPattern)
- `--verbose` - Detailed test output with individual test names
- `--onlyChanged` - Run tests related to changed files
- `--watch` - Interactive watch mode for development
- `--bail` - Stop on first failure (useful for debugging)

### Performance & Debugging
- `--runInBand` - Run tests serially (helps with async issues)
- `--detectOpenHandles` - Find async operations preventing Jest exit
- `--forceExit` - Force Jest to exit (use sparingly)
- `--maxWorkers=1` - Limit parallelism for debugging

### Coverage & Reporting
- `--coverage` - Generate coverage reports
- `--collectCoverageFrom="src/**/*.js"` - Specify coverage scope
- `--silent` - Suppress console.log output in tests

## Project-Specific Testing Notes

### Test Categories
- **Unit Tests**: Individual component testing with mocks
- **Integration Tests**: Service interaction testing
- **E2E Tests**: Full workflow testing with real Discord/API interactions
- **Performance Tests**: Load testing and benchmarking

### Common Patterns
```bash
# Test specific Discord command handling
npm run test:unit --testPathPatterns="command-processor" -- --testNamePattern="debug commands"

# Test browser automation components
npm run test:integration --testPathPatterns="browser|scraper" -- --verbose

# Test logging and monitoring systems
npm run test:unit --testPathPatterns="enhanced-logger|metrics-manager|debug-flag"
```

### Memory Leak Prevention
Always ensure tests don't call `main()` functions - these start infinite processes and will cause test hangs.

### Useful Jest CLI Reference
- `jest <regexForTestFiles>` - Run tests matching pattern
- `--bail[=<n>]` - Exit after n failures (default: 1)
- `--testNamePattern=<regex>` - Run tests matching specific names
- `--updateSnapshot` - Update test snapshots
- `--detectOpenHandles` - Debug async handle leaks
- `--runInBand` - Disable parallel execution
- `--maxWorkers=<num>` - Control test parallelism