/**
 * Test helpers and utilities for comprehensive testing
 * This file contains reusable testing utilities, assertion helpers, and common test patterns
 */

import { jest } from '@jest/globals';

// Test timing utilities
export const timing = {
  // Measure execution time of a function
  measure: async fn => {
    const start = performance.now();
    const result = await fn();
    const end = performance.now();
    return {
      result,
      duration: end - start,
      durationMs: Math.round(end - start),
    };
  },

  // Wait for a specified time
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),

  // Wait for a condition to be true
  waitFor: async (condition, timeout = 5000, interval = 100) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return true;
      }
      await timing.wait(interval);
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  },

  // Retry an operation with exponential backoff
  retry: async (fn, maxAttempts = 3, baseDelay = 1000) => {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await timing.wait(delay);
        }
      }
    }
    throw lastError;
  },
};

// Memory monitoring utilities
export const memory = {
  // Get current memory usage
  getUsage: () => {
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss,
      arrayBuffers: usage.arrayBuffers,
    };
  },

  // Monitor memory usage during test execution
  monitor: async testFn => {
    const initialMemory = memory.getUsage();

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const result = await testFn();

    const finalMemory = memory.getUsage();
    const memoryDelta = {
      heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
      heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
      external: finalMemory.external - initialMemory.external,
      rss: finalMemory.rss - initialMemory.rss,
    };

    return {
      result,
      initialMemory,
      finalMemory,
      memoryDelta,
    };
  },

  // Format memory size for display
  formatBytes: bytes => {
    if (bytes === 0) {
      return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  },
};

// Mock management utilities
export const mocks = {
  // Create a comprehensive mock function with call tracking
  createMockFunction: (name, implementation = jest.fn()) => {
    const mockFn = jest.fn(implementation);
    mockFn.mockName(name);

    // Add helper methods
    mockFn.getCallCount = () => mockFn.mock.calls.length;
    mockFn.getCallArgs = (callIndex = -1) => {
      const { calls } = mockFn.mock;
      return callIndex >= 0 ? calls[callIndex] : calls[calls.length - 1];
    };
    mockFn.wasCalledWith = (...args) => {
      return mockFn.mock.calls.some(call => call.length === args.length && call.every((arg, i) => arg === args[i]));
    };

    return mockFn;
  },

  // Create a mock with realistic delays
  createAsyncMock: (name, resolveValue, delay = 0) => {
    return mocks.createMockFunction(
      name,
      jest.fn().mockImplementation(async (...args) => {
        if (delay > 0) {
          await timing.wait(delay);
        }
        return resolveValue;
      })
    );
  },

  // Create a mock that fails after N successful calls
  createFailingMock: (name, successCount, errorMessage = 'Mock failure') => {
    let callCount = 0;
    return mocks.createMockFunction(
      name,
      jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount > successCount) {
          throw new Error(errorMessage);
        }
        return { success: true, callCount };
      })
    );
  },

  // Reset all mocks in an object
  resetAllMocks: mockObject => {
    Object.values(mockObject).forEach(mock => {
      if (jest.isMockFunction(mock)) {
        mock.mockReset();
      }
    });
  },
};

// Assertion helpers
export const assertions = {
  // Assert that a URL matches expected patterns
  assertValidUrl: (url, expectedProtocols = ['http:', 'https:']) => {
    expect(url).toMatch(/^https?:\/\/.+/);
    const parsed = new URL(url);
    expect(expectedProtocols).toContain(parsed.protocol);
  },

  // Assert that an object contains expected properties
  assertObjectStructure: (obj, expectedStructure) => {
    function checkStructure(actual, expected, path = '') {
      for (const [key, expectedType] of Object.entries(expected)) {
        const currentPath = path ? `${path}.${key}` : key;

        if (typeof expectedType === 'string') {
          expect(actual).toHaveProperty(key);
          expect(typeof actual[key]).toBe(expectedType);
        } else if (Array.isArray(expectedType)) {
          expect(actual).toHaveProperty(key);
          expect(Array.isArray(actual[key])).toBe(true);
          if (expectedType.length > 0) {
            actual[key].forEach((item, index) => {
              checkStructure(item, expectedType[0], `${currentPath}[${index}]`);
            });
          }
        } else if (typeof expectedType === 'object') {
          expect(actual).toHaveProperty(key);
          expect(typeof actual[key]).toBe('object');
          checkStructure(actual[key], expectedType, currentPath);
        }
      }
    }

    checkStructure(obj, expectedStructure);
  },

  // Assert performance metrics
  assertPerformance: (metrics, expectations) => {
    if (expectations.maxDuration) {
      expect(metrics.duration).toBeLessThan(expectations.maxDuration);
    }
    if (expectations.minThroughput) {
      const throughput = metrics.itemsProcessed / (metrics.duration / 1000);
      expect(throughput).toBeGreaterThan(expectations.minThroughput);
    }
    if (expectations.maxMemoryIncrease) {
      expect(metrics.memoryDelta.heapUsed).toBeLessThan(expectations.maxMemoryIncrease);
    }
  },

  // Assert that async operations complete within timeout
  assertCompletesWithin: async (asyncFn, timeout, description = 'Operation') => {
    const start = Date.now();
    await asyncFn();
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(timeout);
  },

  // Assert rate limiting behavior
  assertRateLimit: async (fn, maxRequests, windowMs, description = 'Rate limit') => {
    const results = [];
    const start = Date.now();

    // Make requests rapidly
    for (let i = 0; i < maxRequests + 5; i++) {
      try {
        const result = await fn();
        results.push({ success: true, result, timestamp: Date.now() });
      } catch (error) {
        results.push({ success: false, error, timestamp: Date.now() });
      }
    }

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    expect(successful.length).toBeLessThanOrEqual(maxRequests);
    expect(failed.length).toBeGreaterThan(0);
  },
};

// Test data validation
export const validation = {
  // Validate Discord snowflake ID format
  isValidDiscordId: id => {
    return typeof id === 'string' && /^\d{17,19}$/.test(id);
  },

  // Validate YouTube video ID format
  isValidYouTubeId: id => {
    return typeof id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(id);
  },

  // Validate Twitter/X status ID format
  isValidTwitterId: id => {
    return typeof id === 'string' && /^\d{1,19}$/.test(id);
  },

  // Validate timestamp format
  isValidTimestamp: timestamp => {
    if (typeof timestamp !== 'string') {
      return false;
    }
    const date = new Date(timestamp);
    return !isNaN(date.getTime()) && date.toISOString() === timestamp;
  },

  // Validate URL format
  isValidUrl: (url, allowedProtocols = ['http:', 'https:']) => {
    try {
      const parsed = new URL(url);
      return allowedProtocols.includes(parsed.protocol);
    } catch {
      return false;
    }
  },

  // Validate object against schema
  validateSchema: (obj, schema) => {
    const errors = [];

    function validate(actual, expected, path = '') {
      for (const [key, expectedType] of Object.entries(expected)) {
        const currentPath = path ? `${path}.${key}` : key;

        if (!(key in actual)) {
          errors.push(`Missing property: ${currentPath}`);
          continue;
        }

        const actualValue = actual[key];

        if (typeof expectedType === 'string') {
          if (typeof actualValue !== expectedType) {
            errors.push(`Type mismatch at ${currentPath}: expected ${expectedType}, got ${typeof actualValue}`);
          }
        } else if (Array.isArray(expectedType)) {
          if (!Array.isArray(actualValue)) {
            errors.push(`Type mismatch at ${currentPath}: expected array, got ${typeof actualValue}`);
          } else if (expectedType.length > 0) {
            actualValue.forEach((item, index) => {
              validate(item, expectedType[0], `${currentPath}[${index}]`);
            });
          }
        } else if (typeof expectedType === 'object') {
          if (typeof actualValue !== 'object' || actualValue === null) {
            errors.push(`Type mismatch at ${currentPath}: expected object, got ${typeof actualValue}`);
          } else {
            validate(actualValue, expectedType, currentPath);
          }
        }
      }
    }

    validate(obj, schema);
    return {
      valid: errors.length === 0,
      errors,
    };
  },
};

// Test environment utilities
export const environment = {
  // Set up clean test environment
  setup: (customEnv = {}) => {
    const originalEnv = { ...process.env };

    // Clear relevant environment variables
    Object.keys(process.env).forEach(key => {
      if (
        key.startsWith('DISCORD_') ||
        key.startsWith('YOUTUBE_') ||
        key.startsWith('X_') ||
        key.startsWith('TWITTER_') ||
        key.startsWith('PSH_') ||
        key.includes('LOG_') ||
        key.includes('COMMAND_')
      ) {
        delete process.env[key];
      }
    });

    // Set custom environment variables
    Object.assign(process.env, customEnv);

    return {
      restore: () => {
        process.env = originalEnv;
      },
    };
  },

  // Create isolated test context
  createIsolatedContext: () => {
    const mocks = new Map();
    const timers = [];

    return {
      addMock: (name, mock) => mocks.set(name, mock),
      getMock: name => mocks.get(name),
      addTimer: timer => timers.push(timer),
      cleanup: () => {
        // Clear all mocks
        mocks.forEach(mock => {
          if (jest.isMockFunction(mock)) {
            mock.mockRestore();
          }
        });

        // Clear all timers
        timers.forEach(timer => clearTimeout(timer));

        mocks.clear();
        timers.length = 0;
      },
    };
  },
};

// Logging utilities for tests
export const logging = {
  // Create a test logger that captures logs
  createTestLogger: () => {
    const logs = [];

    return {
      log: (level, message, meta = {}) => {
        logs.push({
          level,
          message,
          meta,
          timestamp: new Date().toISOString(),
        });
      },
      getLogs: (level = null) => {
        return level ? logs.filter(log => log.level === level) : logs;
      },
      clear: () => {
        logs.length = 0;
      },
      getLogCount: (level = null) => {
        return level ? logs.filter(log => log.level === level).length : logs.length;
      },
    };
  },

  // Suppress console output during tests
  suppressConsole: () => {
    const originalMethods = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug,
    };

    Object.keys(originalMethods).forEach(method => {
      console[method] = jest.fn();
    });

    return {
      restore: () => {
        Object.assign(console, originalMethods);
      },
    };
  },
};

// Network simulation utilities
export const network = {
  // Simulate network delay
  simulateDelay: (min = 100, max = 500) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return timing.wait(delay);
  },

  // Simulate network failure
  simulateFailure: (probability = 0.1) => {
    if (Math.random() < probability) {
      throw new Error('Simulated network failure');
    }
  },

  // Create a mock HTTP response
  createMockResponse: (status = 200, data = {}, headers = {}) => ({
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    data,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    ok: status >= 200 && status < 300,
  }),

  // Simulate rate limiting
  createRateLimiter: (maxRequests = 10, windowMs = 60000) => {
    const requests = [];

    return {
      checkLimit: () => {
        const now = Date.now();
        const windowStart = now - windowMs;

        // Remove old requests
        const validRequests = requests.filter(timestamp => timestamp > windowStart);
        requests.length = 0;
        requests.push(...validRequests);

        if (requests.length >= maxRequests) {
          throw new Error('Rate limit exceeded');
        }

        requests.push(now);
        return {
          remaining: maxRequests - requests.length,
          resetTime: now + windowMs,
        };
      },
    };
  },
};

// Test reporting utilities
export const reporting = {
  // Generate test summary
  generateSummary: testResults => {
    const summary = {
      total: testResults.length,
      passed: testResults.filter(r => r.passed).length,
      failed: testResults.filter(r => !r.passed).length,
      duration: testResults.reduce((sum, r) => sum + (r.duration || 0), 0),
      coverage: {
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0,
      },
    };

    summary.passRate = (summary.passed / summary.total) * 100;

    return summary;
  },

  // Format test results for display
  formatResults: summary => {
    return `
Test Summary:
  Total: ${summary.total}
  Passed: ${summary.passed} (${summary.passRate.toFixed(1)}%)
  Failed: ${summary.failed}
  Duration: ${summary.duration.toFixed(2)}ms
  
Coverage:
  Statements: ${summary.coverage.statements}%
  Branches: ${summary.coverage.branches}%
  Functions: ${summary.coverage.functions}%
  Lines: ${summary.coverage.lines}%
    `.trim();
  },
};

export default {
  timing,
  memory,
  mocks,
  assertions,
  validation,
  environment,
  logging,
  network,
  reporting,
};
