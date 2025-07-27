# Timer Testing Guide for DiscordRateLimitedSender

## Overview

This guide documents the async timer handling improvements made to fix complex timing issues in the `DiscordRateLimitedSender` tests. The fixes address conflicts between Jest fake timers, real time sources, and automatic queue processing.

## Root Problems Fixed

### 1. **Time Source Conflicts**
- **Problem**: `timestampUTC()` returned real time while Jest fake timers controlled `setTimeout`
- **Solution**: Added `timeSource` abstraction to make time controllable in tests

### 2. **Automatic vs Manual Processing**
- **Problem**: Constructor auto-started queue processing that conflicted with manual test control
- **Solution**: Added `autoStart` option to disable automatic processing in tests

### 3. **Async Timer Synchronization**
- **Problem**: Race conditions between timer advancement and Promise resolution
- **Solution**: Created `advanceAsyncTimers()` helper for synchronized advancement

## Implementation Changes

### Service Changes (`discord-rate-limited-sender.js`)

```javascript
// Constructor now supports test-friendly options
constructor(logger, options = {}) {
  // Time source abstraction for testing
  this.timeSource = options.timeSource || (() => timestampUTC());
  
  // Allow disabling auto-start for tests
  this.autoStart = options.autoStart !== false; // Default true
  
  // Conditional auto-start
  if (this.autoStart) {
    this.startProcessing();
  }
}

// All timestampUTC() calls replaced with this.timeSource()
async processQueue() {
  if (this.isPaused && this.pauseUntil && this.timeSource() < this.pauseUntil) {
    // ... uses timeSource instead of timestampUTC()
  }
}
```

### Test Pattern Changes (`discord-rate-limited-sender.test.js`)

```javascript
beforeEach(() => {
  jest.useFakeTimers();

  // Mock time source for deterministic testing
  let currentTime = 0;
  const mockTimeSource = jest.fn(() => currentTime);
  mockTimeSource.advanceTime = (ms) => {
    currentTime += ms;
    return currentTime;
  };
  global.mockTimeSource = mockTimeSource;

  // Test helper for synchronized async timer advancement
  global.advanceAsyncTimers = async (ms) => {
    mockTimeSource.advanceTime(ms);
    await jest.advanceTimersByTimeAsync(ms);
    // Allow promises to resolve
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
  };

  // Create service with test-friendly options
  sender = new DiscordRateLimitedSender(mockLogger, {
    autoStart: false, // Disable auto-start for manual control
    timeSource: global.mockTimeSource, // Use controllable time source
    baseSendDelay: 100, // Faster for testing
    burstAllowance: 3,
  });
});
```

## New Test Patterns

### Pattern 1: Manual Processing Control

```javascript
it('should apply delay after burst allowance exceeded', async () => {
  // Start processing manually when needed
  sender.startProcessing();
  
  const promises = [];
  for (let i = 0; i < 4; i++) {
    promises.push(sender.queueMessage(mockChannel, `Message ${i + 1}`));
  }

  // Advance time to trigger all delays and processing
  await global.advanceAsyncTimers(1000);

  await Promise.all(promises);
  expect(mockChannel.send).toHaveBeenCalledTimes(4);
});
```

### Pattern 2: Rate Limit Testing

```javascript
it('should pause entire queue when rate limited', async () => {
  const rateLimitError = new Error('Rate limited');
  rateLimitError.code = 429;
  rateLimitError.retryAfter = 1000; // 1 second in ms

  mockChannel.send.mockRejectedValueOnce(rateLimitError);
  
  // Start processing manually
  sender.startProcessing();

  const promises = [...]; // Queue messages

  // Allow first message to be processed and trigger rate limit
  await global.advanceAsyncTimers(100);
  expect(sender.isPaused).toBe(true);

  // Advance past the rate limit pause
  await global.advanceAsyncTimers(1100);

  await Promise.all(promises);
  expect(sender.metrics.rateLimitHits).toBe(1);
});
```

### Pattern 3: Retry Logic Testing

```javascript
it('should fail permanently after max retries', async () => {
  const networkError = new Error('ECONNRESET');
  mockChannel.send.mockRejectedValue(networkError);

  // Start processing manually
  sender.startProcessing();

  const messagePromise = sender.queueMessage(mockChannel, 'Will fail');

  // Process through all retries with proper time advancement
  await global.advanceAsyncTimers(10000);

  await expect(messagePromise).rejects.toThrow('ECONNRESET');
  expect(mockChannel.send).toHaveBeenCalledTimes(3); // Initial + 2 retries
});
```

## Key Testing Principles

### 1. **Synchronized Time Control**
- Always use `global.advanceAsyncTimers()` instead of `jest.advanceTimersByTimeAsync()`
- This ensures both fake timers and mock time source advance together

### 2. **Manual Processing Control**
- Disable `autoStart` in test setup
- Call `sender.startProcessing()` when needed in tests
- This prevents race conditions with automatic processing

### 3. **Appropriate Timeouts**
- Use reasonable test timeouts (3-5 seconds for complex tests)
- Most tests should complete quickly with proper time control

### 4. **Promise Resolution Timing**
- The `advanceAsyncTimers()` helper includes Promise resolution steps
- This ensures all async operations complete before assertions

## Migration Guide

To update existing timer-dependent tests:

1. **Update test setup**:
   ```javascript
   sender = new DiscordRateLimitedSender(mockLogger, {
     autoStart: false,
     timeSource: global.mockTimeSource,
     // ... other options
   });
   ```

2. **Replace timer advancement**:
   ```javascript
   // Old:
   await jest.advanceTimersByTimeAsync(1000);
   
   // New:
   await global.advanceAsyncTimers(1000);
   ```

3. **Add manual processing control**:
   ```javascript
   // Start processing when needed
   sender.startProcessing();
   ```

4. **Reduce test timeouts**:
   ```javascript
   // Old: }, 60000);
   // New: }, 5000);
   ```

## Benefits

1. **Deterministic Testing**: Time is fully controlled and predictable
2. **No Race Conditions**: Synchronized timer and Promise handling
3. **Faster Tests**: Proper time control eliminates real delays
4. **Reliable CI/CD**: Tests pass consistently across environments
5. **Better Debugging**: Clear separation between time advancement and business logic

## Common Pitfalls to Avoid

1. **Don't mix real timers with fake timers** - Always use the abstracted time source
2. **Don't forget to start processing** - Manual control means manual start
3. **Don't use excessive timeouts** - Proper time control should make tests fast
4. **Don't advance time without Promise resolution** - Use the helper function
5. **Don't assume immediate processing** - Allow time for async operations