/**
 * Example of clean test that properly manages handles
 * Run with: npm run test:handles -- --testPathPatterns="clean-handle-example"
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { debugOpenHandles, waitForHandleCleanup } from '../utils/open-handle-detector.js';

describe('Clean Handle Management Examples', () => {
  describe('Timer cleanup patterns', () => {
    let timers = [];

    afterEach(() => {
      // Clean up all timers
      timers.forEach(timer => {
        if (timer.type === 'timeout') {
          clearTimeout(timer.id);
        } else if (timer.type === 'interval') {
          clearInterval(timer.id);
        }
      });
      timers = [];
    });

    it('should properly clean up timeouts', async () => {
      const promise = new Promise(resolve => {
        const timeoutId = setTimeout(() => {
          resolve('completed');
        }, 50);

        timers.push({ type: 'timeout', id: timeoutId });
      });

      const result = await promise;
      expect(result).toBe('completed');

      console.log('After timeout completion:');
      debugOpenHandles();
    });

    it('should properly clean up intervals', async () => {
      let count = 0;

      const intervalId = setInterval(() => {
        count++;
      }, 10);

      timers.push({ type: 'interval', id: intervalId });

      // Let it run a few times
      await new Promise(resolve => setTimeout(resolve, 35));

      expect(count).toBeGreaterThan(0);

      console.log('After interval test:');
      debugOpenHandles();

      // Cleanup happens in afterEach
    });
  });

  describe('HTTP server cleanup patterns', () => {
    let servers = [];

    afterEach(async () => {
      // Clean up all servers
      await Promise.all(
        servers.map(
          server =>
            new Promise(resolve => {
              if (server.listening) {
                server.close(resolve);
              } else {
                resolve();
              }
            })
        )
      );
      servers = [];
    });

    it('should properly clean up HTTP servers', async () => {
      const { createServer } = await import('http');

      const server = createServer((req, res) => {
        res.writeHead(200);
        res.end('Hello');
      });

      servers.push(server);

      await new Promise(resolve => {
        server.listen(0, resolve);
      });

      expect(server.listening).toBe(true);

      console.log('After server creation:');
      debugOpenHandles();

      // Cleanup happens in afterEach
    });
  });

  describe('Event emitter cleanup patterns', () => {
    let emitters = [];
    let listeners = [];

    afterEach(() => {
      // Remove all listeners
      listeners.forEach(({ emitter, event, listener }) => {
        emitter.removeListener(event, listener);
      });
      listeners = [];
      emitters = [];
    });

    it('should properly clean up event listeners', async () => {
      const { EventEmitter } = await import('events');

      const emitter = new EventEmitter();
      emitters.push(emitter);

      let received = '';
      const listener = data => {
        received = data;
      };

      emitter.on('test', listener);
      listeners.push({ emitter, event: 'test', listener });

      emitter.emit('test', 'hello');
      expect(received).toBe('hello');

      console.log('After event emitter test:');
      debugOpenHandles();

      // Cleanup happens in afterEach
    });
  });

  describe('Promise and async cleanup', () => {
    it('should handle Promise.all without leaks', async () => {
      const promises = Array.from(
        { length: 5 },
        (_, i) =>
          new Promise(resolve => {
            const delay = Math.random() * 20 + 10; // 10-30ms
            setTimeout(() => resolve(`result-${i}`), delay);
          })
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);
      expect(results.every(r => r.startsWith('result-'))).toBe(true);

      console.log('After Promise.all:');
      debugOpenHandles();
    });

    it('should handle async generators without leaks', async () => {
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

  describe('Resource cleanup verification', () => {
    it('should verify all handles are cleaned up', async () => {
      // Do some async work
      await Promise.all([
        new Promise(resolve => setTimeout(resolve, 10)),
        new Promise(resolve => setTimeout(resolve, 20)),
        new Promise(resolve => setTimeout(resolve, 15)),
      ]);

      console.log('Before cleanup verification:');
      debugOpenHandles();

      // Wait for any remaining cleanup
      const cleaned = await waitForHandleCleanup(1000, 50);
      expect(cleaned).toBe(true);

      console.log('After cleanup verification:');
      debugOpenHandles();
    });
  });
});
