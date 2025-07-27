#!/usr/bin/env node

/**
 * Manual test to verify mutex and browser state validation fixes
 * This is a quick validation script that can be run independently
 */

import { AsyncMutex } from '../../src/utilities/async-mutex.js';
import { PlaywrightBrowserService } from '../../src/services/implementations/playwright-browser-service.js';

async function testAsyncMutex() {
  console.log('Testing AsyncMutex...');

  const mutex = new AsyncMutex();
  const results = [];

  // Test concurrent operations
  const promises = [];
  for (let i = 0; i < 3; i++) {
    promises.push(
      mutex.runExclusive(async () => {
        const id = i;
        results.push(`start-${id}`);
        await new Promise(resolve => setTimeout(resolve, 100));
        results.push(`end-${id}`);
        return `result-${id}`;
      })
    );
  }

  const mutexResults = await Promise.all(promises);

  console.log('AsyncMutex results:', mutexResults);
  console.log('Execution order:', results);

  // Verify operations were sequential
  const isSequential = results.every((item, index) => {
    if (index % 2 === 0) {
      // Start items should be followed by corresponding end
      const expectedEnd = item.replace('start', 'end');
      return results[index + 1] === expectedEnd;
    }
    return true;
  });

  console.log('Operations were sequential:', isSequential);
  return isSequential;
}

async function testBrowserService() {
  console.log('\nTesting PlaywrightBrowserService validation...');

  const browserService = new PlaywrightBrowserService();

  // Test health check on uninitialized browser
  console.log('Browser healthy (uninitialized):', browserService.isHealthy());
  console.log('Browser running (uninitialized):', browserService.isRunning());

  try {
    // This should throw an error with proper validation
    await browserService.goto('https://example.com');
    console.log('ERROR: goto() should have thrown an error');
    return false;
  } catch (error) {
    console.log('Expected error caught:', error.message);
    return error.message.includes('Browser or page not available');
  }
}

async function main() {
  try {
    console.log('Running mutex and browser validation tests...\n');

    const mutexTest = await testAsyncMutex();
    const browserTest = await testBrowserService();

    console.log('\n=== Test Results ===');
    console.log('Mutex test passed:', mutexTest);
    console.log('Browser validation test passed:', browserTest);

    if (mutexTest && browserTest) {
      console.log('✅ All tests passed!');
      process.exit(0);
    } else {
      console.log('❌ Some tests failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('Test error:', error);
    process.exit(1);
  }
}

main().catch(console.error);
