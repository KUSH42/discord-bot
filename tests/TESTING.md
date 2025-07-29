# Testing Guide - Discord YouTube Bot

## Quick Start

### Essential Commands
```bash
npm run test:dev           # Fast development testing
npm run test:watch         # Auto-run on file changes
npm test                   # Full test suite with coverage
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests
```

### Target Specific Tests
```bash
# Single test file
npm test -- path/to/specific.test.js

# Pattern matching
npm run test:unit --testPathPatterns="command-processor" -- --verbose

# Specific test name
npm test -- --testNamePattern="health monitoring"
```

## Test Structure

```
tests/
├── unit/           # Individual component tests
├── integration/    # Component interaction tests  
├── e2e/           # End-to-end workflow tests
├── performance/   # Performance benchmarks
├── security/      # Security validation tests
├── fixtures/      # Test utilities and helpers
└── mocks/         # Mock implementations
```

## Coverage Requirements

| Component Type | Statements | Branches | Functions | Lines |
|---------------|------------|----------|-----------|-------|
| Global        | 25%        | 20%      | 25%       | 25%   |
| Core modules  | 50%        | 40%      | 55%       | 50%   |
| Critical      | 85-90%     | 75-85%   | 90%       | 85-90%|

## Test Utilities ✅ Production Ready

All major test utilities are fully operational in `tests/fixtures/`:

### Application Mocks
```javascript
import { createScraperApplicationMocks } from '../fixtures/test-helpers.js';

// ✅ Before: 50+ lines of manual mock setup
// ✅ Now: 3 lines with comprehensive mocks
const mocks = createScraperApplicationMocks();
const scraperApp = new ScraperApplication(mocks);
```

### Timer Testing (Advanced)
```javascript
import { timerTestUtils } from '../fixtures/test-helpers.js';

beforeEach(() => {
  timerUtils = timerTestUtils.setupComplexTimerTest();
});

afterEach(() => {
  timerUtils.cleanup();
});

// Use proven patterns for complex timer operations
await timerUtils.advance(1000);
await timerUtils.waitForState(() => component.isReady, true);
```

### Advanced Timer Patterns for Complex Operations

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

#### Event-Driven Timer Interactions
```javascript
// Wait for specific events to be emitted before proceeding
global.waitForEvent = async (eventBus, eventName, timeoutMs = 5000) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      eventBus.off(eventName, handler);
      reject(new Error(`Event ${eventName} not emitted within ${timeoutMs}ms`));
    }, timeoutMs);
    
    const handler = (data) => {
      clearTimeout(timeout);
      eventBus.off(eventName, handler);
      resolve(data);
    };
    
    eventBus.on(eventName, handler);
  });
};
```

#### Direct Timer Control (For Complex setInterval Operations)
```javascript
it('should execute health check logic correctly', async () => {
  // Test the actual health check logic, not the timer mechanism
  const performHealthCheckSpy = jest.spyOn(scraperApp, 'performHealthCheck')
    .mockResolvedValue({ errors: [] });
  
  // Access the timer callback directly rather than waiting for setInterval
  scraperApp.startHealthMonitoring(100);
  
  // Get the interval callback function
  const intervalCallback = jest.mocked(setInterval).mock.calls[0][0];
  
  // Execute the callback directly
  await intervalCallback();
  
  expect(performHealthCheckSpy).toHaveBeenCalled();
});
```

#### Multi-Phase Timer Operations
```javascript
// Helper for multi-phase timer operations
global.advancePhases = async (phases) => {
  for (const phase of phases) {
    await global.advanceAsyncTimersDeep(phase.duration, phase.iterations || 10);
    if (phase.validator) {
      expect(phase.validator()).toBe(true);
    }
  }
};

// Usage example
it('should handle multi-phase restart with retry logic', async () => {
  await global.advancePhases([
    { duration: 200, validator: () => !scraperApp.isRunning },
    { duration: 300, iterations: 15 }, // Cleanup phase needs more Promise resolution
    { duration: 400, validator: () => scraperApp.isRunning },
    { duration: 100, validator: () => scraperApp.healthCheckInterval !== null }
  ]);
});
```

### Enhanced Logger Testing
```javascript
// ✅ Correct: Spy on enhanced logger instance
const enhancedLogger = component.logger;
const errorSpy = jest.spyOn(enhancedLogger, 'error');
expect(errorSpy).toHaveBeenCalledWith(...);

// ❌ Incorrect: Testing mock base logger
expect(mockLogger.error).toHaveBeenCalledWith(...);
```

## Common Patterns

### Async Operations
```javascript
// Flush all async operations  
const flushPromises = async () => {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
};

// Basic timer testing
jest.useFakeTimers();
await jest.runAllTimersAsync();
jest.useRealTimers();
```

### Error Log Silencing in Tests

The project uses global console mocking in `tests/setup.js` to prevent false positive error logs during test execution.

#### Automatic Console Silencing
All `console.error`, `console.warn`, `console.log`, and `console.info` calls are automatically mocked in the test environment:

```javascript
// These are automatically silenced in tests
console.error('This error message will not appear in test output');
console.warn('This warning will not appear in test output');
```

#### Testing Error Handling Without Log Noise
When testing error scenarios, focus on the error handling logic rather than logging:

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

#### When Testing Error Logging Behavior is Required
For tests that specifically validate logging behavior, use explicit console spies:

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

#### Avoid Adding Console Calls in Test Mocks
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

#### Global Test Setup Benefits
- **Clean Output**: No false positive error logs cluttering test results
- **Test Integrity**: Tests that validate logging behavior still work correctly
- **Debugging Support**: Access to original console via `global.originalConsole` when needed
- **Unhandled Rejection Silence**: Unhandled rejections are silenced in test environment

#### Debugging When Needed
If you need to see actual console output during debugging:

```javascript
// Use original console for debugging
global.originalConsole.error('This will actually appear in output');

// Or temporarily restore console for a test
beforeEach(() => {
  console.error = global.originalConsole.error; // Restore for debugging
});
```

### ContentCoordinator Pattern
```javascript
// ✅ Current architecture
expect(mocks.contentCoordinator.processContent).toHaveBeenCalledWith(
  contentId, 'scraper', expectedContent
);

// ❌ Deprecated pattern
expect(mocks.contentAnnouncer.announceContent).toHaveBeenCalledWith(content);
```

## Development Workflow

1. **Start development**: `npm run test:dev -- --watch`
2. **Target specific components**: `npm run test:unit --testPathPatterns="your-component"`
3. **Debug failing tests**: `npm run test:debug -- failing-test`
4. **Before committing**: `npm test`

## Configuration Files

- `jest.config.js` - Production config with coverage enforcement
- `jest.dev.config.js` - Development optimized (fast feedback)
- `tests/configs/jest.*.config.js` - Specialized configs for each test type

## Troubleshooting

### Timer Test Timeouts
**Symptoms**: Tests involving `setInterval`, health monitoring, or restart functionality timing out

**Root Cause**: Complex nested async operations inside timer callbacks require multiple rounds of Promise resolution.

**Solutions by Complexity Level**:

1. **Basic timers** (single async operation):
   ```javascript
   await global.advanceAsyncTimers(1000);
   ```

2. **Nested async operations** (timer callbacks with async operations):
   ```javascript
   await global.advanceAsyncTimersDeep(1000, 15);
   ```

3. **setInterval with async callbacks**:
   ```javascript
   await global.advanceIntervalTimersDeep(100, 25);
   ```

4. **Complex state-dependent operations**:
   ```javascript
   await global.waitForStateChange(() => component.isReady, 10000);
   ```

5. **Resource cleanup race conditions**:
   ```javascript
   await global.ensureCleanupComplete(() => component.resourcesCleared);
   ```

6. **Direct callback testing** (when timer coordination fails):
   ```javascript
   const intervalCallback = jest.mocked(setInterval).mock.calls[0][0];
   await intervalCallback();
   ```

**Debug Timer Issues**:
```bash
DEBUG_TIMERS=true npm test -- --testNamePattern="your test"
```

### Enhanced Logger Failures
**Problem**: Mock expectations failing with enhanced logger components
**Root Cause**: Enhanced logger creates child logger instances, not the mock base logger

**Solution**: Spy on the enhanced logger instance:
```javascript
// ❌ This won't work - tests the mock base logger
expect(mockLogger.error).toHaveBeenCalledWith(...);

// ✅ This works - spy on the enhanced logger instance
const enhancedLogger = component.logger;
const errorSpy = jest.spyOn(enhancedLogger, 'error');
expect(errorSpy).toHaveBeenCalledWith(...);
```

### Resource Cleanup Issues
**Problem**: Tests hanging due to cleanup race conditions
**Root Cause**: Cleanup operations compete with ongoing timer cycles

**Solutions**:
1. **Basic cleanup coordination**:
   ```javascript
   await timerUtils.ensureCleanup(() => component.resourcesCleared);
   ```

2. **Advanced cleanup with timeout**:
   ```javascript
   const cleanupComplete = await global.ensureCleanupComplete(
     async () => scraperApp.healthCheckInterval === null,
     5000
   );
   expect(cleanupComplete).toBe(true);
   ```

### Complex Timer Pattern Selection Guide

**When to use each pattern**:

| Pattern | Use Case | Example |
|---------|----------|---------|
| `advanceAsyncTimers()` | Basic setTimeout with single async operation | Simple retries |
| `advanceAsyncTimersDeep()` | Nested async operations in timer callbacks | Complex API calls in timers |
| `advanceIntervalTimersDeep()` | setInterval with async callbacks | Health monitoring, periodic tasks |
| `waitForStateChange()` | State-dependent timer sequences | Restart sequences |
| `ensureCleanupComplete()` | Resource cleanup race conditions | Component shutdown |
| `waitForEvent()` | Event-driven timer interactions | Event-based restarts |
| Direct callback testing | When Jest coordination fails | Complex setInterval operations |

### Enhanced Test Setup Template

```javascript
beforeEach(() => {
  jest.useFakeTimers();
  
  // Basic timer advancement
  global.advanceAsyncTimers = async (ms) => {
    await jest.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
  };
  
  // ADVANCED: Deep async coordination for nested operations
  global.advanceAsyncTimersDeep = async (ms, maxIterations = 10) => {
    await jest.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < maxIterations; i++) {
      await Promise.resolve();
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => process.nextTick(resolve));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  };
  
  // ADVANCED: setInterval-specific advancement
  global.advanceIntervalTimersDeep = async (ms, maxIterations = 15) => {
    await jest.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < maxIterations; i++) {
      await Promise.resolve();
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => process.nextTick(resolve));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await new Promise(resolve => process.nextTick(resolve));
  };
  
  // ADVANCED: State synchronization
  global.waitForStateChange = async (stateChecker, timeoutMs = 5000) => {
    const startTime = Date.now();
    while (!stateChecker() && (Date.now() - startTime) < timeoutMs) {
      await global.advanceAsyncTimersDeep(10);
    }
    if (!stateChecker()) {
      throw new Error(`State change timeout after ${timeoutMs}ms`);
    }
  };
  
  // ADVANCED: Cleanup coordination
  global.ensureCleanupComplete = async (cleanupChecker, maxWaitMs = 3000) => {
    let iterations = 0;
    const maxIterations = maxWaitMs / 50;
    while (iterations < maxIterations) {
      await global.advanceAsyncTimersDeep(50);
      if (await cleanupChecker()) return true;
      iterations++;
    }
    return false;
  };
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});
```

### Retry Logic and Promise Rejection Testing

For testing retry logic with setTimeout delays, use these proven patterns:

```javascript
// ✅ Method 1: Global advanceAsyncTimers (for complex timer scenarios)
it('should retry with proper time advancement', async () => {
  // Set up fake timers and global.advanceAsyncTimers helper
  // See Enhanced Test Setup Template above for complete setup
  
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

### Migration Strategy for Failing Tests

**Step 1: Identify Test Complexity Level**
- **Basic**: Single timer, single async operation → Use existing `advanceAsyncTimers()`
- **Nested**: Timer with nested async operations → Use `advanceAsyncTimersDeep()`
- **State-dependent**: Operations that depend on state changes → Add `waitForStateChange()`
- **Cleanup-sensitive**: Resource cleanup race conditions → Add `ensureCleanupComplete()`
- **Event-driven**: Timer operations that emit/listen to events → Add `waitForEvent()`

**Step 2: Update Test Timeouts**
```javascript
// Old: Default Jest timeout (5000ms) - too short for complex operations
it('complex test', async () => { /* ... */ });

// New: Increased timeout for complex async operations
it('complex test', async () => { /* ... */ }, 15000);
```

**Step 3: Add Operation Monitoring**
```javascript
// Monitor actual operations for debugging
const operationSpy = jest.spyOn(component.logger, 'startOperation');
// ... test code ...
console.log('Operations started:', operationSpy.mock.calls.map(call => call[0]));
```

### Complete Advanced Timer Pattern Examples

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

#### Resource Cleanup Test Pattern
```javascript
it('should handle cleanup during health monitoring stop', async () => {
  scraperApp.startHealthMonitoring(100);
  
  // Trigger several health checks
  await global.advanceAsyncTimersDeep(300);
  
  // Stop health monitoring
  scraperApp.stopHealthMonitoring();
  
  // Ensure all pending health operations complete
  const cleanupComplete = await global.ensureCleanupComplete(
    async () => scraperApp.healthCheckInterval === null
  );
  
  expect(cleanupComplete).toBe(true);
  expect(scraperApp.healthCheckInterval).toBeNull();
});
```

#### Event-Driven Restart Test Pattern
```javascript
it('should handle event-driven restart cycles', async () => {
  const eventPromise = global.waitForEvent(mockEventBus, 'scraper.restart.completed');
  
  // Trigger health check failure that should cause restart
  scraperApp.startHealthMonitoring(100);
  await global.advanceAsyncTimersDeep(100);
  
  // Mock health check failure
  jest.spyOn(scraperApp, 'performHealthCheck').mockRejectedValue(new Error('Health failed'));
  await global.advanceAsyncTimersDeep(100);
  
  // Wait for restart event
  const eventData = await eventPromise;
  expect(eventData).toBeDefined();
});
```

#### Multi-Phase Operation Test Pattern
```javascript
it('should handle multi-phase restart with retry logic', async () => {
  // Mock restart phases: stop (200ms) -> cleanup (300ms) -> start (400ms) -> verify (100ms)
  await global.advancePhases([
    { duration: 200, validator: () => !scraperApp.isRunning },
    { duration: 300, iterations: 15 }, // Cleanup phase needs more Promise resolution
    { duration: 400, validator: () => scraperApp.isRunning },
    { duration: 100, validator: () => scraperApp.healthCheckInterval !== null }
  ]);
});
```

### Performance Considerations for Advanced Patterns
- Advanced patterns add 2-5x test execution time
- Only use the complexity level you need
- Consider splitting complex tests into focused scenarios
- Use `maxIterations` parameter to limit Promise resolution cycles

### Debugging Complex Timer Issues

#### Enable Timer Debugging
```javascript
beforeEach(() => {
  global.debugTimers = process.env.DEBUG_TIMERS === 'true';
  
  if (global.debugTimers) {
    const originalAdvance = global.advanceAsyncTimersDeep;
    global.advanceAsyncTimersDeep = async (ms, maxIterations = 10) => {
      console.log(`🕐 Advancing ${ms}ms with ${maxIterations} iterations`);
      await originalAdvance(ms, maxIterations);
      console.log(`✅ Timer advancement complete`);
    };
  }
});
```

#### Quick Diagnostic for Timer Issues
**If your timer-based test is timing out:**

1. **Identify the pattern**:
   ```bash
   # Basic setTimeout/Promise chains
   → Use patterns from basic timer testing
   
   # setInterval with async callbacks  
   → Use advanceIntervalTimersDeep()
   
   # Health monitoring, restart functionality
   → Use interval-specific advancement with high iterations
   ```

2. **Quick fixes**:
   ```javascript
   // Increase timeout for complex operations
   it('complex test', async () => { /* ... */ }, 15000);
   
   // Use appropriate advancement method
   await global.advanceIntervalTimersDeep(100, 25); // For setInterval
   await global.advanceAsyncTimers(100);            // For setTimeout
   ```

3. **Debug with logging**:
   ```bash
   DEBUG_TIMERS=true npm test -- --testNamePattern="your failing test"
   ```

### When NOT to Use Advanced Patterns
- Simple timeout operations
- Single Promise chains
- Basic retry logic without timers
- Tests that don't use fake timers

## Best Practices

### DO
- Use test utilities from `tests/fixtures/`
- Target specific test files/patterns during development
- Expect ContentCoordinator calls for content processing
- Add proper cleanup in `afterEach` blocks
- Use appropriate timeouts for complex operations
- Use `jest.clearAllMocks()` in `beforeEach` to ensure clean test state
- Restore timers with `jest.useRealTimers()` after fake timer tests
- Focus on error handling outcomes rather than logging in most tests

### DON'T
- Run full test suites during development
- Create manual mocks when utilities exist
- Test base logger mocks with enhanced logger components
- Call `main()` functions in tests (starts infinite processes)
- Mix real timers with fake timers
- Use duplicate `beforeEach` blocks (causes test interference)
- Mock class constructors directly in test files
- Forget to wait for `setImmediate` callbacks in async tests
- Add console.error calls in test mock implementations (creates false positives)

## Command Reference

```bash
# Development
npm run test:dev           # Fast feedback mode
npm run test:watch         # Watch mode
npm run test:changed       # Git-aware testing

# Coverage & Quality
npm run test:coverage      # Generate coverage report
npm run test:parallel      # 50% worker utilization
npm run lint:fix           # Fix ESLint issues

# Debugging
npm run test:debug         # Debug with breakpoints
npm run test:verbose       # Detailed output
npm run test:runner --help # Interactive runner

# Specific Types
npm run test:unit          # Unit tests
npm run test:integration   # Integration tests
npm run test:e2e           # End-to-end tests
npm run test:performance   # Performance tests
npm run test:security      # Security tests
```

## Performance Optimizations

- **Parallel execution**: 50% worker utilization
- **Caching**: Jest cache with dedicated directory
- **Git-aware testing**: Only test changed files during development
- **Development config**: Optimized for fast feedback loops

**Performance Gains**:
- ~40% faster execution through parallelization
- ~60% faster subsequent runs with caching
- ~80% faster development cycles with git-aware testing

## Migration Guide

### Updating Old Tests
1. Replace manual mocks with factory functions
2. Update assertions to expect ContentCoordinator calls
3. Use timer utilities for complex timer operations
4. Add proper cleanup in afterEach blocks

### Example Migration
```javascript
// Before
const mockDep1 = { method: jest.fn() };
const mockDep2 = { method: jest.fn() };
// ... 50+ lines of manual setup

// After
import { createScraperApplicationMocks } from '../fixtures/test-helpers.js';
const mocks = createScraperApplicationMocks();
```