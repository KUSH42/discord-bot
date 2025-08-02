# Open Handle Detection Guide

This guide covers how to detect and diagnose open handles that prevent Jest from exiting cleanly in your tests.

## What Are Open Handles?

Open handles are asynchronous resources that haven't been properly cleaned up:
- **Timers**: `setTimeout`, `setInterval`, `setImmediate`
- **Network**: HTTP servers, sockets, database connections
- **Files**: Open file descriptors
- **Processes**: Child processes
- **Event Emitters**: Unremoved listeners

## Built-in Jest Detection

Your Jest configuration already includes basic handle detection:

```javascript
// jest.config.js
{
  detectOpenHandles: true,  // Shows handles when Jest hangs
  forceExit: true          // Forces exit after tests complete
}
```

### Basic Usage

Run any test with handle detection:
```bash
npm test -- --detectOpenHandles --testPathPatterns="your-test"
```

Jest will show you exactly which handles are keeping it alive:
```
Jest has detected the following 2 open handles potentially keeping Jest from exiting:

  ●  Timeout
      at Object.setTimeout (tests/your-test.test.js:25:24)

  ●  Server  
      at Server.listen (tests/your-test.test.js:42:16)
```

## Enhanced Handle Detection Tools

We've created advanced tools for deeper analysis:

### 1. Handle Debugging Test Configuration

Use the special Jest config for detailed handle analysis:

```bash
# Run with enhanced handle detection
npm run test:handles -- --testPathPatterns="your-test"

# Features:
# - Longer timeout (30s) for debugging
# - Verbose output
# - No forced exit (so you see all handles)
# - Serial execution for clarity
```

### 2. Open Handle Detector Utility

Use the programmatic API in your tests:

```javascript
import { 
  debugOpenHandles, 
  forceCloseOpenHandles,
  withHandleDetection,
  waitForHandleCleanup 
} from '../utils/open-handle-detector.js';

describe('Your Test', () => {
  it('should detect handles', async () => {
    // Create some resources
    const server = createServer();
    
    // Debug current state
    debugOpenHandles();
    
    // Clean up
    server.close();
    
    // Wait for cleanup to complete
    const cleaned = await waitForHandleCleanup(5000);
    expect(cleaned).toBe(true);
  });
  
  // Automatic handle detection wrapper
  it('auto-detects handles', withHandleDetection(async () => {
    // Your test code - handles are automatically monitored
  }));
});
```

### 3. CLI Handle Monitor

Monitor handles in your running application:

```bash
# Check handles once
npm run debug:handles

# Monitor continuously  
npm run debug:handles:monitor

# Force close all handles
npm run debug:handles:force-close
```

## Common Handle Problems & Solutions

### 1. Timer Handles

**Problem**: Unclosed timers
```javascript
// ❌ This creates a handle that never closes
const timer = setTimeout(() => {}, 10000);
```

**Solution**: Always clean up timers
```javascript
// ✅ Clean up in afterEach
let timer;
afterEach(() => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
});
```

### 2. HTTP Server Handles

**Problem**: Server not closed
```javascript
// ❌ Server stays open
const server = createServer().listen(3000);
```

**Solution**: Close in cleanup
```javascript
// ✅ Proper cleanup
let server;
afterEach(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
    server = null;
  }
});
```

### 3. Event Listener Handles

**Problem**: Listeners not removed
```javascript
// ❌ Process listeners accumulate
process.on('SIGINT', handler);
```

**Solution**: Remove listeners
```javascript
// ✅ Remove in cleanup
afterEach(() => {
  process.removeListener('SIGINT', handler);
});
```

### 4. Database Connection Handles

**Problem**: Connections not closed
```javascript
// ❌ Connection stays open
const db = await connect();
```

**Solution**: Close connections
```javascript
// ✅ Close in cleanup
let db;
afterEach(async () => {
  if (db) {
    await db.close();
    db = null;
  }
});
```

### 5. Child Process Handles

**Problem**: Processes not terminated
```javascript
// ❌ Process keeps running
const child = spawn('node', ['script.js']);
```

**Solution**: Kill processes
```javascript
// ✅ Terminate in cleanup
let child;
afterEach(() => {
  if (child && !child.killed) {
    child.kill();
    child = null;
  }
});
```

## Best Practices

### 1. Use Resource Cleanup Patterns
```javascript
describe('Component with resources', () => {
  let resource;
  
  beforeEach(() => {
    resource = createResource();
  });
  
  afterEach(async () => {
    if (resource) {
      await resource.cleanup();
      resource = null;
    }
  });
});
```

### 2. Test Resource Cleanup
```javascript
it('should clean up resources', async () => {
  const resource = createResource();
  
  // Verify resource is active
  expect(resource.isActive()).toBe(true);
  
  // Clean up
  await resource.cleanup();
  
  // Verify cleanup
  expect(resource.isActive()).toBe(false);
  
  // Wait for handles to close
  const cleaned = await waitForHandleCleanup(1000);
  expect(cleaned).toBe(true);
});
```

### 3. Mock External Resources
```javascript
// ✅ Mock instead of creating real resources
jest.mock('http', () => ({
  createServer: jest.fn(() => ({
    listen: jest.fn(),
    close: jest.fn(cb => cb())
  }))
}));
```

### 4. Use Test Timeouts
```javascript
// ✅ Set appropriate timeouts
describe('Component', () => {
  // Shorter timeout to catch hanging tests quickly
  jest.setTimeout(5000);
  
  it('should complete quickly', async () => {
    // Test implementation
  });
});
```

## Debugging Workflow

1. **Identify the problem**:
   ```bash
   npm test -- --testPathPatterns="failing-test" --detectOpenHandles
   ```

2. **Get detailed analysis**:
   ```bash
   npm run test:handles -- --testPathPatterns="failing-test"
   ```

3. **Monitor handles during test**:
   ```javascript
   it('debug test', async () => {
     debugOpenHandles(); // Before
     await yourTestCode();
     debugOpenHandles(); // After
   });
   ```

4. **Force cleanup if needed**:
   ```javascript
   afterEach(() => {
     const closed = forceCloseOpenHandles();
     console.log(`Closed ${closed} handles`);
   });
   ```

## Configuration Options

### Jest Options
```javascript
{
  detectOpenHandles: true,     // Show handles on exit
  forceExit: true,            // Force exit after tests  
  testTimeout: 5000,          // Timeout for hanging tests
  maxWorkers: 1,              // Serial execution for debugging
}
```

### Environment Variables
```bash
FORCE_CLOSE_HANDLES=true     # Auto-close handles in debug mode
DEBUG_UNHANDLED_REJECTIONS=true  # Log unhandled rejections
```

## Integration with Existing Tests

The handle detection utilities integrate seamlessly with your existing test infrastructure:

- **Enhanced Logger**: Handle detection works with your enhanced logging system
- **Timer Test Utils**: Compatible with your advanced timer testing patterns  
- **Mock Frameworks**: Works with your existing Jest mocks and fixtures

## Example Integration

```javascript
import { createScraperApplicationMocks } from '../fixtures/test-helpers.js';
import { debugOpenHandles, waitForHandleCleanup } from '../utils/open-handle-detector.js';

describe('ScraperApplication', () => {
  let scraperApp;
  let mocks;
  
  beforeEach(() => {
    mocks = createScraperApplicationMocks();
    scraperApp = new ScraperApplication(mocks);
  });
  
  afterEach(async () => {
    if (scraperApp) {
      await scraperApp.stop();
    }
    
    // Wait for all handles to close
    const cleaned = await waitForHandleCleanup(2000);
    if (!cleaned) {
      console.warn('Handles still open after cleanup');
      debugOpenHandles();
    }
  });
});
```

This approach gives you comprehensive handle detection while maintaining compatibility with your existing test patterns.