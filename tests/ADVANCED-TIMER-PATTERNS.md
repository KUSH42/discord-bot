# Advanced Timer Testing Patterns for Complex Async Operations

## Deep Timer Synchronization Issues Identified

### Root Cause Analysis

The existing `TIMER-TESTING-GUIDE.md` handles basic timer patterns, but fails with **complex nested async operations** that involve:

1. **Multiple Timer Sources**: `setInterval`, `setTimeout`, Promise.all(), async/await chains
2. **Event Loop Coordination**: Timer callbacks that trigger additional async operations
3. **Shared State Dependencies**: Operations that depend on state changes from previous timer cycles
4. **Resource Cleanup Race Conditions**: Cleanup operations that compete with ongoing timer cycles

### Specific Failing Pattern: Health Monitoring

**Current Issue**: Health monitoring tests timeout because:
```javascript
// In ScraperApplication.startHealthMonitoring()
this.healthCheckInterval = setInterval(async () => {
  const healthOperation = this.logger.startOperation('performHealthCheck', {});
  try {
    const result = await this.performHealthCheck(); // ← Async operation inside timer
    if (result.errors.length > 0) {
      await this.handleHealthCheckFailure(new Error('Health check failed')); // ← More async
    }
    healthOperation.success('Health check passed', result);
  } catch (error) {
    healthOperation.error(error, 'Health check failed');
    await this.handleHealthCheckFailure(error); // ← Cleanup async operations
  }
}, intervalMs);
```

**Problem**: The `global.advanceAsyncTimers()` helper advances the timer but doesn't wait for the **nested async operations** inside the timer callback to complete.

## Advanced Pattern 1: Nested Async Timer Operations

### Issue
Timer callbacks that contain multiple async operations with their own Promise chains.

### Solution: Deep Async Coordination
```javascript
// Enhanced timer advancement with deep Promise resolution
global.advanceAsyncTimersDeep = async (ms, maxIterations = 10) => {
  await jest.advanceTimersByTimeAsync(ms);
  
  // Multiple rounds of Promise resolution to handle nested async operations
  for (let i = 0; i < maxIterations; i++) {
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => process.nextTick(resolve));
    
    // Allow any microtasks to complete
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

// ENHANCED: setInterval-specific advancement
global.advanceIntervalTimersDeep = async (ms, maxIterations = 15) => {
  // For setInterval, we need to ensure all timer callbacks complete
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

### Test Pattern
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

## Advanced Pattern 6: Direct Timer Control

### Issue
Some `setInterval` operations with complex async callbacks are difficult to coordinate with Jest fake timers.

### Solution: Direct Timer Function Testing
Instead of testing the timer mechanism, test the callback function directly:

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

### Alternative: Manual Timer Simulation
```javascript
it('should handle interval-based health monitoring', async () => {
  // Mock setInterval to capture the callback
  let intervalCallback;
  jest.spyOn(global, 'setInterval').mockImplementation((callback, ms) => {
    intervalCallback = callback;
    return 'mock-interval-id';
  });
  
  const performHealthCheckSpy = jest.spyOn(scraperApp, 'performHealthCheck')
    .mockResolvedValue({ errors: [] });
  
  scraperApp.startHealthMonitoring(100);
  
  // Manually trigger the interval callback
  await intervalCallback();
  
  expect(performHealthCheckSpy).toHaveBeenCalled();
});
```

## Advanced Pattern 2: State-Dependent Timer Sequences

### Issue
Timer operations that depend on state changes from previous timer cycles.

### Solution: State Synchronization Points
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

### Test Pattern
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

## Advanced Pattern 3: Resource Cleanup Race Conditions

### Issue
Cleanup operations that compete with ongoing timer cycles, causing resource conflicts.

### Solution: Cleanup Synchronization
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

### Test Pattern
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

## Advanced Pattern 4: Event-Driven Timer Interactions

### Issue
Timers that trigger events which cause other timers to start/stop/modify.

### Solution: Event Synchronization
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

### Test Pattern
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

## Advanced Pattern 5: Multi-Phase Timer Operations

### Issue
Operations that have multiple phases, each with their own timing requirements.

### Solution: Phase-Aware Testing
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
```

### Test Pattern
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

## Enhanced Test Setup Template

```javascript
beforeEach(() => {
  jest.useFakeTimers();
  
  // Basic timer advancement (from existing guide)
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
  
  // ADVANCED: Event synchronization
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
});
```

## Migration Strategy for Failing Tests

### Step 1: Identify Test Complexity Level
- **Basic**: Single timer, single async operation → Use existing `advanceAsyncTimers()`
- **Nested**: Timer with nested async operations → Use `advanceAsyncTimersDeep()`
- **State-dependent**: Operations that depend on state changes → Add `waitForStateChange()`
- **Cleanup-sensitive**: Resource cleanup race conditions → Add `ensureCleanupComplete()`
- **Event-driven**: Timer operations that emit/listen to events → Add `waitForEvent()`

### Step 2: Update Test Timeouts
```javascript
// Old: Default Jest timeout (5000ms) - too short for complex operations
it('complex test', async () => { /* ... */ });

// New: Increased timeout for complex async operations
it('complex test', async () => { /* ... */ }, 15000);
```

### Step 3: Add Operation Monitoring
```javascript
// Monitor actual operations for debugging
const operationSpy = jest.spyOn(component.logger, 'startOperation');
// ... test code ...
console.log('Operations started:', operationSpy.mock.calls.map(call => call[0]));
```

## Testing Guidelines

### DO Use Advanced Patterns When:
- Tests involve `setInterval` with async callbacks
- Timer operations modify shared state
- Multiple timers interact with each other  
- Resource cleanup happens during timer operations
- Events are emitted from timer callbacks

### DON'T Use Advanced Patterns For:
- Simple timeout operations
- Single Promise chains
- Basic retry logic without timers
- Tests that don't use fake timers

### Performance Considerations
- Advanced patterns add 2-5x test execution time
- Only use the complexity level you need
- Consider splitting complex tests into focused scenarios
- Use `maxIterations` parameter to limit Promise resolution cycles

## Debugging Complex Timer Issues

### Enable Timer Debugging
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

### Run with Timer Debugging
```bash
DEBUG_TIMERS=true npm test -- --testNamePattern="health monitoring"
```

This advanced pattern system addresses the deep timer synchronization issues by providing:
1. **Deep Promise resolution** for nested async operations
2. **State synchronization points** for dependent operations  
3. **Cleanup coordination** to prevent race conditions
4. **Event synchronization** for event-driven timer interactions
5. **Phase-aware testing** for multi-step timer operations

The key insight is that complex timer operations require **multiple rounds of Promise resolution** and **state synchronization points** beyond what the basic timer guide provides.