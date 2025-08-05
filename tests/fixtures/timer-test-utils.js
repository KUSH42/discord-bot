/**
 * Advanced Timer Testing Utilities
 * Provides utilities for testing complex async timer operations
 */

import { jest } from '@jest/globals';

export const timerTestUtils = {
  /**
   * Advanced timer coordination for complex setInterval operations with nested async callbacks
   * Use this when basic jest.advanceTimersByTimeAsync() isn't sufficient
   */
  advanceIntervalTimersDeep: async (ms, maxIterations = 20) => {
    await jest.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < maxIterations; i++) {
      await Promise.resolve();
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => process.nextTick(resolve));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await new Promise(resolve => process.nextTick(resolve));
  },

  /**
   * Wait for a component state to change during timer operations
   */
  waitForStateChange: async (stateGetter, expectedValue, maxWait = 5000) => {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWait) {
      if (stateGetter() === expectedValue) {
        return true;
      }
      await jest.advanceTimersByTimeAsync(100);
      await Promise.resolve();
    }
    throw new Error(`State did not change to ${expectedValue} within ${maxWait}ms`);
  },

  /**
   * Ensure cleanup operations complete before assertions
   */
  ensureCleanupComplete: async (cleanupCheckFn, maxWait = 1000) => {
    let attempts = 0;
    const maxAttempts = maxWait / 50;

    while (attempts < maxAttempts) {
      if (await cleanupCheckFn()) {
        return true;
      }
      await jest.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      attempts++;
    }

    throw new Error('Cleanup did not complete within timeout');
  },

  /**
   * Mock setInterval with direct callback control
   * Use when Jest fake timers don't coordinate properly with complex async operations
   */
  mockIntervalWithDirectControl: () => {
    let intervalCallback;
    const mockSetInterval = jest.spyOn(global, 'setInterval').mockImplementation((callback, ms) => {
      intervalCallback = callback;
      return 'mock-interval-id';
    });

    return {
      executeCallback: async () => {
        if (intervalCallback) {
          await intervalCallback();
        }
      },
      restore: () => mockSetInterval.mockRestore(),
    };
  },

  /**
   * Setup comprehensive timer mocking for complex operations
   */
  setupComplexTimerTest: () => {
    jest.useFakeTimers();

    return {
      advance: timerTestUtils.advanceIntervalTimersDeep,
      waitForState: timerTestUtils.waitForStateChange,
      ensureCleanup: timerTestUtils.ensureCleanupComplete,
      cleanup: () => jest.useRealTimers(),
    };
  },
};
