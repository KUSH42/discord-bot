# AsyncMutex Utility

The `AsyncMutex` utility provides a simple, promise-based mutual exclusion mechanism for preventing concurrent operations in JavaScript applications.

## Overview

The `AsyncMutex` class is designed to solve race condition problems in browser automation and other scenarios where operations must be executed sequentially rather than concurrently.

## Use Cases

- **Browser Automation**: Preventing concurrent Playwright operations that could cause "Target page, context or browser has been closed" errors
- **Resource Management**: Ensuring exclusive access to shared resources
- **API Rate Limiting**: Controlling concurrent API requests
- **File Operations**: Preventing simultaneous file access conflicts

## API Reference

### Constructor

```javascript
import { AsyncMutex } from '../src/utilities/async-mutex.js';

const mutex = new AsyncMutex();
```

### Methods

#### `acquire(): Promise<Function>`

Acquires the mutex lock and returns a release function.

```javascript
const release = await mutex.acquire();
try {
  // Critical section
  await performExclusiveOperation();
} finally {
  release();
}
```

#### `runExclusive(fn: Function): Promise<any>`

Executes a function exclusively with automatic lock management.

```javascript
const result = await mutex.runExclusive(async () => {
  // This code runs exclusively
  return await performOperation();
});
```

### Properties

#### `locked: boolean` (read-only)

Returns `true` if the mutex is currently locked.

```javascript
console.log('Mutex is locked:', mutex.locked);
```

#### `queueLength: number` (read-only)

Returns the number of operations waiting for the mutex.

```javascript
console.log('Operations waiting:', mutex.queueLength);
```

## Usage Examples

### Basic Browser Operation Protection

```javascript
class ScraperService {
  constructor() {
    this.browserMutex = new AsyncMutex();
    this.browserService = new PlaywrightBrowserService();
  }

  async fetchContent(url) {
    return await this.browserMutex.runExclusive(async () => {
      // Check if shutting down
      if (this.isShuttingDown) {
        return null;
      }

      // Perform browser operation safely
      await this.browserService.goto(url);
      return await this.browserService.evaluate(() => {
        return document.title;
      });
    });
  }
}
```

### Manual Lock Management

```javascript
async function complexOperation() {
  const release = await mutex.acquire();
  
  try {
    // Step 1: Setup
    await setupResources();
    
    // Step 2: Critical operation
    const result = await performCriticalOperation();
    
    // Step 3: Cleanup
    await cleanupResources();
    
    return result;
  } finally {
    // Always release the lock
    release();
  }
}
```

### Concurrent Operation Testing

```javascript
// Test that operations are sequential
async function testSequentialExecution() {
  const mutex = new AsyncMutex();
  const results = [];
  
  const promises = [];
  for (let i = 0; i < 3; i++) {
    promises.push(
      mutex.runExclusive(async () => {
        results.push(`start-${i}`);
        await new Promise(resolve => setTimeout(resolve, 100));
        results.push(`end-${i}`);
        return `result-${i}`;
      })
    );
  }
  
  await Promise.all(promises);
  
  // Results should show sequential execution:
  // ['start-0', 'end-0', 'start-1', 'end-1', 'start-2', 'end-2']
  console.log('Execution order:', results);
}
```

## Integration with YouTube Scraper

The `AsyncMutex` is used in the YouTube Scraper Service to prevent race conditions:

```javascript
export class YouTubeScraperService {
  constructor({ logger, config, contentCoordinator }) {
    this.browserMutex = new AsyncMutex();
    // ... other initialization
  }

  async fetchLatestVideo() {
    return await this.browserMutex.runExclusive(async () => {
      if (this.isShuttingDown) {
        return null;
      }
      
      // Safe browser operations
      await this.browserService.goto(this.videosUrl);
      return await this.extractVideoData();
    });
  }

  async fetchActiveLiveStream() {
    return await this.browserMutex.runExclusive(async () => {
      if (this.isShuttingDown) {
        return null;
      }
      
      // Safe browser operations
      await this.browserService.goto(this.liveStreamUrl);
      return await this.extractLiveStreamData();
    });
  }
}
```

## Performance Considerations

- **Low Overhead**: The mutex has minimal performance impact with simple promise-based queuing
- **Memory Efficient**: No persistent state is maintained when no operations are queued
- **FIFO Ordering**: Operations are executed in first-in-first-out order
- **Non-Blocking**: The mutex doesn't block the event loop; it uses promise-based waiting

## Error Handling

The `AsyncMutex` itself doesn't throw errors, but it's important to handle errors in the critical sections:

```javascript
await mutex.runExclusive(async () => {
  try {
    await riskyOperation();
  } catch (error) {
    logger.error('Operation failed:', error);
    throw error; // Re-throw if needed
  }
});
```

## Testing

The utility includes a test file (`test-mutex-fix.js`) that demonstrates:

- Sequential execution of concurrent operations
- Proper queueing behavior
- Integration with browser services

Run the test:

```bash
node test-mutex-fix.js
```

## Best Practices

1. **Always Use `runExclusive()`**: Prefer the automatic lock management over manual `acquire()`/`release()`
2. **Handle Shutdown Gracefully**: Check shutdown flags within the critical section
3. **Keep Critical Sections Short**: Minimize the time spent holding the lock
4. **Error Handling**: Always handle errors within the critical section
5. **Testing**: Test concurrent scenarios to ensure proper synchronization

## Related Components

- **PlaywrightBrowserService**: Enhanced with mutex-aware browser operations
- **YouTubeScraperService**: Uses AsyncMutex for browser operation synchronization
- **ScraperApplication**: Coordinates with mutex during shutdown procedures