/**
 * Setup file for open handle debugging
 * This file is loaded automatically when using jest.handle-debug.config.js
 */

import detector, {
  setupOpenHandleDetection,
  debugOpenHandles,
  forceCloseOpenHandles,
  waitForHandleCleanup,
} from './open-handle-detector.js';

// Enable handle detection globally
setupOpenHandleDetection();

// Add global functions for debugging
global.debugOpenHandles = debugOpenHandles;
global.forceCloseOpenHandles = forceCloseOpenHandles;
global.waitForHandleCleanup = waitForHandleCleanup;

// Enhanced afterEach that reports handles
const originalAfterEach = global.afterEach;
global.afterEach = fn => {
  originalAfterEach(async () => {
    if (fn) {
      await fn();
    }

    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check for handles if debugging is enabled
    if (global.__HANDLE_DEBUG__) {
      const analysis = detector.getOpenHandles();
      if (analysis.summary.newSinceStart.length > 0) {
        console.warn('\n⚠️  Open handles detected after test:');
        console.warn(detector.generateReport());

        // Optional: Try to force close them
        if (process.env.FORCE_CLOSE_HANDLES === 'true') {
          const closed = forceCloseOpenHandles();
          console.log(`🔧 Forcefully closed ${closed} handles`);
        }
      }
    }
  });
};

// Enhanced error handling for handle-related issues
process.on('warning', warning => {
  if (
    warning.name === 'MaxListenersExceededWarning' ||
    warning.message.includes('handle') ||
    warning.message.includes('leak')
  ) {
    console.warn('\n🚨 Handle-related warning detected:');
    console.warn(warning);
    if (global.__HANDLE_DEBUG__) {
      console.warn('\nCurrent handles:');
      debugOpenHandles();
    }
  }
});

// Timeout warning for long-running tests
let testStartTime;
beforeEach(() => {
  testStartTime = Date.now();
});

afterEach(() => {
  const duration = Date.now() - testStartTime;
  if (duration > 10000) {
    // 10 seconds
    console.warn(`\n⏱️  Test took ${duration}ms - check for async operations that aren't properly cleaned up`);
    if (global.__HANDLE_DEBUG__) {
      debugOpenHandles();
    }
  }
});

console.log('🔍 Handle debugging enabled - use global.debugOpenHandles() to check handles anytime');
