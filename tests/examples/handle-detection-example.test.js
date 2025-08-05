/**
 * Example test demonstrating open handle detection utilities
 * Run with: npm run test:handles -- --testPathPatterns="handle-detection-example"
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  withHandleDetection,
  waitForHandleCleanup,
  debugOpenHandles,
  forceCloseOpenHandles,
} from '../utils/open-handle-detector.js';

describe('Handle Detection Examples', () => {
  describe('Basic usage', () => {
    it('should detect no handles in simple test', async () => {
      // This test should create no handles
      const result = 1 + 1;
      expect(result).toBe(2);

      // Debug current handle state
      console.log('Current handles:');
      debugOpenHandles();
    });

    it('should detect timer handles', async () => {
      // This test creates a handle that should be cleaned up
      let timeoutId;

      const promise = new Promise(resolve => {
        timeoutId = setTimeout(() => {
          resolve('completed');
        }, 100);
      });

      const result = await promise;
      expect(result).toBe('completed');

      // The timeout should already be cleared, but let's check
      console.log('After timeout completion:');
      debugOpenHandles();
    });

    it('should detect uncleaned timer handles', async () => {
      // This test intentionally creates a handle that won't be cleaned up
      const timeoutId = setTimeout(() => {
        console.log('This should not run');
      }, 10000);

      console.log('Created long timeout, checking handles:');
      debugOpenHandles();

      // Clean up manually to prevent hanging
      clearTimeout(timeoutId);
    });
  });

  describe('Advanced patterns', () => {
    it(
      'should work with withHandleDetection wrapper',
      withHandleDetection(async () => {
        // This test is wrapped with automatic handle detection
        const intervalId = setInterval(() => {
          console.log('interval tick');
        }, 1000);

        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 50));

        // Clean up
        clearInterval(intervalId);
      })
    );

    it('should wait for handle cleanup', async () => {
      // Create a handle that cleans itself up after a delay
      setTimeout(() => {
        // This will clean itself up
      }, 200);

      console.log('Created self-cleaning handle');
      debugOpenHandles();

      // Wait for it to clean up
      const cleanedUp = await waitForHandleCleanup(5000, 50);
      expect(cleanedUp).toBe(true);

      console.log('After cleanup wait:');
      debugOpenHandles();
    });
  });

  describe('HTTP server handles', () => {
    let server;

    afterEach(async () => {
      if (server) {
        await new Promise(resolve => {
          server.close(resolve);
        });
        server = null;
      }
    });

    it('should detect HTTP server handles', async () => {
      const { createServer } = await import('http');

      server = createServer((req, res) => {
        res.writeHead(200);
        res.end('Hello');
      });

      await new Promise(resolve => {
        server.listen(0, resolve);
      });

      console.log('Created HTTP server:');
      debugOpenHandles();

      // Server will be cleaned up in afterEach
    });
  });

  describe('Emergency cleanup', () => {
    it('should demonstrate force cleanup', async () => {
      // Create several handles
      const timeout1 = setTimeout(() => {}, 10000);
      const timeout2 = setTimeout(() => {}, 20000);
      const interval = setInterval(() => {}, 5000);

      console.log('Created multiple handles:');
      debugOpenHandles();

      // Force close them
      const closed = forceCloseOpenHandles();
      console.log(`Force closed ${closed} handles`);

      console.log('After force cleanup:');
      debugOpenHandles();
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle Promise race conditions', async () => {
      // Simulate a race condition that might leave handles
      const promises = [];

      for (let i = 0; i < 5; i++) {
        promises.push(
          new Promise(resolve => {
            const delay = Math.random() * 100;
            setTimeout(() => resolve(`result-${i}`), delay);
          })
        );
      }

      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);

      console.log('After Promise.all:');
      debugOpenHandles();
    });

    it('should handle async generator cleanup', async () => {
      async function* dataGenerator() {
        for (let i = 0; i < 3; i++) {
          await new Promise(resolve => setTimeout(resolve, 10));
          yield `data-${i}`;
        }
      }

      const results = [];
      for await (const data of dataGenerator()) {
        results.push(data);
      }

      expect(results).toEqual(['data-0', 'data-1', 'data-2']);

      console.log('After async generator:');
      debugOpenHandles();
    });
  });
});
