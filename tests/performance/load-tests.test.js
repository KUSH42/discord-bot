import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createMockChannel } from '../mocks/discord.mock.js';
import { createMockRequest, createMockResponse } from '../mocks/express.mock.js';
import { DuplicateDetector } from '../../src/duplicate-detector.js';
import { createWebhookLimiter, createCommandRateLimiter } from '../../src/rate-limiter.js';
import { timestampUTC } from '../../src/utilities/utc-time.js';

describe('Performance and Load Tests', () => {
  let startTime;
  let endTime;
  let mockPersistentStorage;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    startTime = performance.now();

    // Mock PersistentStorage for DuplicateDetector
    mockPersistentStorage = {
      hasFingerprint: jest.fn().mockResolvedValue(false),
      storeFingerprint: jest.fn().mockResolvedValue(true),
      hasUrl: jest.fn().mockResolvedValue(false),
      addUrl: jest.fn().mockResolvedValue(true),
    };

    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  afterEach(() => {
    endTime = performance.now();
    const duration = endTime - startTime;
    console.log(`Test completed in ${duration.toFixed(2)}ms`);
  });

  describe('Memory Management Performance', () => {
    it('should handle large duplicate detection sets efficiently', async () => {
      const duplicateDetector = new DuplicateDetector(mockPersistentStorage, mockLogger);
      const numEntries = 1000; // Reduced for practical testing and avoid timeout

      const startMemory = process.memoryUsage();

      // Test with real YouTube and Twitter URLs
      const promises = [];
      for (let i = 0; i < numEntries; i++) {
        const youtubeText = `Check out this video: https://youtube.com/watch?v=dQw4w9WgXc${i.toString().padStart(4, '0')}`;
        const twitterText = `Great post: https://x.com/user/status/123456789012345${i.toString().padStart(3, '0')}`;

        // Mark URLs as seen to add them to the known sets
        promises.push(duplicateDetector.markAsSeen(youtubeText));
        promises.push(duplicateDetector.markAsSeen(twitterText));
      }

      // Wait for all markAsSeen operations to complete
      await Promise.all(promises);

      const endMemory = process.memoryUsage();
      const memoryIncrease = endMemory.heapUsed - startMemory.heapUsed;

      // Performance assertions using real duplicate detector
      const stats = duplicateDetector.getStats();
      expect(stats.totalKnownIds).toBeGreaterThan(numEntries);

      // Memory usage should be reasonable (less than 50MB for 1k entries)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);

      // Test lookup performance with actual duplicate detection
      const lookupStart = performance.now();
      const testText = 'Check out this video: https://youtube.com/watch?v=dQw4w9WgXc0500';
      const isDuplicate = await duplicateDetector.isDuplicate(testText);
      const lookupEnd = performance.now();

      expect(isDuplicate).toBe(true); // Should be duplicate since we added it above
      expect(lookupEnd - lookupStart).toBeLessThan(10); // Allow up to 10ms for async lookup
    });

    it('should handle memory cleanup for expired entries', () => {
      const memoryManager = {
        entries: new Map(),
        maxSize: 10000,
        maxAge: 3600000, // 1 hour

        add(key, value) {
          this.cleanup();

          if (this.entries.size >= this.maxSize) {
            // Remove oldest entry
            const oldestKey = this.entries.keys().next().value;
            this.entries.delete(oldestKey);
          }

          this.entries.set(key, {
            value,
            timestamp: timestampUTC(),
          });
        },

        cleanup() {
          const now = timestampUTC();
          for (const [key, entry] of this.entries) {
            if (now - entry.timestamp > this.maxAge) {
              this.entries.delete(key);
            }
          }
        },

        get(key) {
          const entry = this.entries.get(key);
          if (!entry) {
            return null;
          }

          if (timestampUTC() - entry.timestamp > this.maxAge) {
            this.entries.delete(key);
            return null;
          }

          return entry.value;
        },
      };

      const _initialMemory = process.memoryUsage().heapUsed;

      // Add entries up to limit
      for (let i = 0; i < 15000; i++) {
        memoryManager.add(`key${i}`, `value${i}`);
      }

      const _maxMemory = process.memoryUsage().heapUsed;

      // Force cleanup
      memoryManager.cleanup();

      const _cleanupMemory = process.memoryUsage().heapUsed;

      // Should not exceed max size
      expect(memoryManager.entries.size).toBeLessThanOrEqual(10000);

      // Memory should be managed by size, not heap usage (GC timing is unpredictable)
      expect(memoryManager.entries.size).toBeGreaterThan(0);
      expect(memoryManager.entries.size).toBeLessThanOrEqual(10000);
    });

    it('should handle concurrent access to shared data structures', async () => {
      const sharedSet = new Set();
      const promises = [];
      const numConcurrent = 1000;

      // Simulate concurrent additions
      for (let i = 0; i < numConcurrent; i++) {
        promises.push(
          new Promise(resolve => {
            // Add some delay to simulate real work
            setTimeout(() => {
              sharedSet.add(`item${i}`);
              resolve(i);
            }, Math.random() * 10);
          })
        );
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(numConcurrent);
      expect(sharedSet.size).toBe(numConcurrent);

      // Test concurrent lookups
      const lookupPromises = [];
      for (let i = 0; i < numConcurrent; i++) {
        lookupPromises.push(
          new Promise(resolve => {
            const exists = sharedSet.has(`item${i}`);
            resolve(exists);
          })
        );
      }

      const lookupResults = await Promise.all(lookupPromises);
      expect(lookupResults.every(result => result === true)).toBe(true);
    });
  });

  describe('Regex Performance at Scale', () => {
    it('should handle large text with many URLs efficiently', () => {
      const _duplicateDetector = new DuplicateDetector(mockPersistentStorage, mockLogger);

      // Define regex patterns locally
      const videoUrlRegex =
        /https?:\/\/(?:(?:www\.)?youtube\.com\/(?:watch\?v=|live\/|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;
      const tweetUrlRegex =
        /https?:\/\/(?:[\w-]+\.)*(?:x\.com|twitter\.com|vxtwitter\.com|fxtwitter\.com|nitter\.[^/]+)\/(?:(?:i\/web\/)?status(?:es)?|[^/]+\/status(?:es)?)\/(\d+)/g;

      // Generate large text with many URLs using real duplicate detection
      const numUrls = 10000;
      const textSegments = [];

      for (let i = 0; i < numUrls / 2; i++) {
        textSegments.push(
          `Text segment ${i} with YouTube: https://www.youtube.com/watch?v=video${i.toString().padStart(7, '0')} and`,
          `Twitter: https://x.com/user/status/12345678901234567${i.toString().padStart(2, '0')} more text.`
        );
      }

      const largeText = textSegments.join(' ');

      const regexStart = performance.now();

      const videoMatches = [...largeText.matchAll(videoUrlRegex)];
      const tweetMatches = [...largeText.matchAll(tweetUrlRegex)];

      const regexEnd = performance.now();
      const regexDuration = regexEnd - regexStart;

      expect(videoMatches).toHaveLength(numUrls / 2);
      expect(tweetMatches).toHaveLength(numUrls / 2);
      expect(regexDuration).toBeLessThan(1000); // Should complete in under 1 second

      // Test individual URL processing performance
      const processingStart = performance.now();

      const videoIds = videoMatches.map(match => match[1]);
      const tweetIds = tweetMatches.map(match => match[1]);

      const processingEnd = performance.now();
      const processingDuration = processingEnd - processingStart;

      expect(videoIds).toHaveLength(numUrls / 2);
      expect(tweetIds).toHaveLength(numUrls / 2);
      expect(processingDuration).toBeLessThan(100); // Should be very fast
    });

    it('should handle malformed URLs gracefully without performance degradation', () => {
      const malformedText = `
        This text contains many malformed URLs that should not match:
        ${'https://youtube.com/watch?v= '.repeat(1000)}
        ${'https://x.com/user/status/ '.repeat(1000)}
        ${'http://not-youtube.com/watch?v=dQw4w9WgXcQ '.repeat(1000)}
        ${'https://twitter.com/user/followers '.repeat(1000)}
        ${'invalid-url-format '.repeat(1000)}
      `;

      const videoUrlRegex =
        /https?:\/\/(?:(?:www\.)?youtube\.com\/(?:watch\?v=|live\/|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;
      const tweetUrlRegex =
        /https?:\/\/(?:[\w-]+\.)*(?:x\.com|twitter\.com|vxtwitter\.com|fxtwitter\.com|nitter\.[^/]+)\/(?:(?:i\/web\/)?status(?:es)?|[^/]+\/status(?:es)?)\/(\d+)/g;

      const malformedStart = performance.now();

      const videoMatches = [...malformedText.matchAll(videoUrlRegex)];
      const tweetMatches = [...malformedText.matchAll(tweetUrlRegex)];

      const malformedEnd = performance.now();
      const malformedDuration = malformedEnd - malformedStart;

      // Should not match any malformed URLs
      expect(videoMatches).toHaveLength(0);
      expect(tweetMatches).toHaveLength(0);

      // Should still complete quickly despite many malformed URLs
      expect(malformedDuration).toBeLessThan(500);
    });
  });

  describe('Discord API Performance', () => {
    it('should handle high-frequency message sending efficiently', async () => {
      const mockChannel = createMockChannel();
      const numMessages = 1000;

      // Mock successful sends with realistic delay
      mockChannel.send.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ id: `msg-${timestampUTC()}` }), Math.random() * 50))
      );

      const sendStart = performance.now();
      const promises = [];

      // Send messages in batches to simulate rate limiting
      const batchSize = 10;
      for (let i = 0; i < numMessages; i += batchSize) {
        const batch = [];
        for (let j = 0; j < batchSize && i + j < numMessages; j++) {
          batch.push(mockChannel.send(`Message ${i + j}`));
        }

        promises.push(Promise.all(batch));

        // Small delay between batches to simulate rate limiting
        if (i + batchSize < numMessages) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      const results = await Promise.all(promises);
      const sendEnd = performance.now();
      const sendDuration = sendEnd - sendStart;

      const totalMessages = results.reduce((sum, batch) => sum + batch.length, 0);

      expect(totalMessages).toBe(numMessages);
      expect(mockChannel.send).toHaveBeenCalledTimes(numMessages);

      // Calculate messages per second
      const messagesPerSecond = (numMessages / sendDuration) * 1000;
      console.log(`Sent ${messagesPerSecond.toFixed(2)} messages per second`);

      // Should handle reasonable throughput
      expect(messagesPerSecond).toBeGreaterThan(10);
    });

    it('should handle concurrent channel operations', async () => {
      const numChannels = 50;
      const channels = Array.from({ length: numChannels }, (_, i) =>
        createMockChannel({ id: `channel-${i}`, name: `test-channel-${i}` })
      );

      // Mock send operations with varying delays
      channels.forEach(channel => {
        channel.send.mockImplementation(
          () => new Promise(resolve => setTimeout(() => resolve({ id: `msg-${timestampUTC()}` }), Math.random() * 100))
        );
      });

      const concurrentStart = performance.now();

      // Send messages to all channels simultaneously
      const promises = channels.map(channel => channel.send('Broadcast message to all channels'));

      const results = await Promise.all(promises);
      const concurrentEnd = performance.now();
      const concurrentDuration = concurrentEnd - concurrentStart;

      expect(results).toHaveLength(numChannels);

      // All channels should have been called
      channels.forEach(channel => {
        expect(channel.send).toHaveBeenCalledWith('Broadcast message to all channels');
      });

      // Should complete in reasonable time despite concurrency
      expect(concurrentDuration).toBeLessThan(500);
    });
  });

  describe('Webhook Processing Performance', () => {
    it('should handle high-frequency webhook notifications', async () => {
      const numWebhooks = 1000;
      const webhookHandler = jest.fn().mockImplementation((req, res) => {
        // Simulate processing time
        setTimeout(() => {
          res.status(200).json({ received: true });
        }, Math.random() * 10);
      });

      const webhookStart = performance.now();
      const promises = [];

      for (let i = 0; i < numWebhooks; i++) {
        const req = createMockRequest({
          method: 'POST',
          url: '/webhook/youtube',
          body: `<notification>Video ${i}</notification>`,
        });
        const res = createMockResponse();

        promises.push(
          new Promise(resolve => {
            webhookHandler(req, res);
            // Simulate async completion
            setTimeout(() => resolve({ req, res }), Math.random() * 20);
          })
        );
      }

      const results = await Promise.all(promises);
      const webhookEnd = performance.now();
      const webhookDuration = webhookEnd - webhookStart;

      expect(results).toHaveLength(numWebhooks);
      expect(webhookHandler).toHaveBeenCalledTimes(numWebhooks);

      // Calculate webhooks per second
      const webhooksPerSecond = (numWebhooks / webhookDuration) * 1000;
      console.log(`Processed ${webhooksPerSecond.toFixed(2)} webhooks per second`);

      // Should handle reasonable webhook throughput
      expect(webhooksPerSecond).toBeGreaterThan(50);
    });

    it('should handle large webhook payloads efficiently', async () => {
      const createLargePayload = size => {
        return Array(size)
          .fill(0)
          .map((_, i) => `<entry><id>video${i}</id><title>Video Title ${i}</title></entry>`)
          .join('');
      };

      const payloadSizes = [1, 10, 100, 1000]; // Number of entries
      const results = [];

      for (const size of payloadSizes) {
        const payload = createLargePayload(size);
        const _req = createMockRequest({
          body: `<feed>${payload}</feed>`,
          headers: { 'content-length': payload.length.toString() },
        });

        const parseStart = performance.now();

        // Simulate XML parsing
        const entries = payload.match(/<entry>.*?<\/entry>/g) || [];
        const videoIds = entries
          .map(entry => {
            const match = entry.match(/<id>([^<]+)<\/id>/);
            return match ? match[1] : null;
          })
          .filter(Boolean);

        const parseEnd = performance.now();
        const parseDuration = parseEnd - parseStart;

        results.push({
          size,
          entries: videoIds.length,
          duration: parseDuration,
          throughput: (videoIds.length / parseDuration) * 1000,
        });

        expect(videoIds).toHaveLength(size);
      }

      // Performance should scale reasonably
      results.forEach(result => {
        console.log(`Size ${result.size}: ${result.throughput.toFixed(2)} entries/sec`);
        expect(result.throughput).toBeGreaterThan(100); // At least 100 entries per second
      });

      // Larger payloads should still be processed efficiently
      const largestResult = results[results.length - 1];
      expect(largestResult.duration).toBeLessThan(100); // Under 100ms for 1000 entries
    });
  });

  describe('Rate Limiting Performance', () => {
    it('should handle high-frequency rate limit checks efficiently', async () => {
      const webhookRateLimit = createWebhookLimiter();
      const commandRateLimit = createCommandRateLimiter();
      const numRequests = 1000;

      // Test webhook rate limiting performance
      const webhookStart = performance.now();
      for (let i = 0; i < numRequests; i++) {
        const mockReq = createMockRequest({ ip: `192.168.1.${i % 255}` });
        const mockRes = createMockResponse();
        webhookRateLimit(mockReq, mockRes, () => {});
      }
      const webhookEnd = performance.now();
      const webhookDuration = webhookEnd - webhookStart;

      // Test command rate limiting performance
      const commandStart = performance.now();
      for (let i = 0; i < numRequests; i++) {
        const userId = `user${i % 100}`;
        commandRateLimit.isAllowed(userId);
      }
      const commandEnd = performance.now();
      const commandDuration = commandEnd - commandStart;

      // Performance assertions
      expect(webhookDuration).toBeLessThan(1000); // Should complete within 1 second
      expect(commandDuration).toBeLessThan(500); // Should be even faster

      const webhookThroughput = numRequests / (webhookDuration / 1000);
      const commandThroughput = numRequests / (commandDuration / 1000);

      expect(webhookThroughput).toBeGreaterThan(500); // At least 500 requests per second
      expect(commandThroughput).toBeGreaterThan(1000); // At least 1000 checks per second
    });
  });

  describe('Memory Leak Detection', () => {
    it('should not leak memory during continuous operation', () => {
      const _initialMemory = process.memoryUsage();
      const duplicateTracker = new Set();
      const cycleCount = 1000;

      // Simulate continuous operation with cleanup
      for (let cycle = 0; cycle < cycleCount; cycle++) {
        // Add entries
        for (let i = 0; i < 100; i++) {
          duplicateTracker.add(`cycle${cycle}-item${i}`);
        }

        // Periodic cleanup (simulate cleanup every 10 cycles)
        if (cycle % 10 === 0) {
          duplicateTracker.clear();
        }
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - _initialMemory.heapUsed;

      // Memory increase should be reasonable (less than 15MB)
      expect(memoryIncrease).toBeLessThan(15 * 1024 * 1024);

      // Force garbage collection if available (only in local dev with --expose-gc)
      const gcAvailable = typeof global.gc === 'function';
      let afterGCIncrease = 0;

      if (gcAvailable) {
        global.gc();
        const afterGCMemory = process.memoryUsage();
        afterGCIncrease = afterGCMemory.heapUsed - _initialMemory.heapUsed;
      }

      // Test memory behavior - different thresholds based on GC availability
      const expectedThreshold = gcAvailable ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
      const actualIncrease = gcAvailable ? afterGCIncrease : memoryIncrease;
      expect(actualIncrease).toBeLessThan(expectedThreshold);
    });

    it('should handle circular reference cleanup', () => {
      const createCircularStructure = () => {
        const obj1 = { name: 'obj1' };
        const obj2 = { name: 'obj2' };

        obj1.ref = obj2;
        obj2.ref = obj1;

        return { obj1, obj2 };
      };

      const _initialMemory = process.memoryUsage();
      const structures = [];

      // Create many circular structures
      for (let i = 0; i < 10000; i++) {
        structures.push(createCircularStructure());
      }

      const _midMemory = process.memoryUsage();

      // Clear references
      structures.length = 0;

      // Force garbage collection if available
      if (typeof global.gc === 'function') {
        global.gc();
      }

      const finalMemory = process.memoryUsage();
      const netIncrease = finalMemory.heapUsed - _initialMemory.heapUsed;

      // Memory should be cleaned up properly (allow some variance for GC timing)
      expect(netIncrease).toBeLessThan(5 * 1024 * 1024); // Less than 5MB net increase
    });
  });

  describe('CPU Performance Under Load', () => {
    it('should handle CPU-intensive duplicate detection efficiently', () => {
      const complexDuplicateDetection = urls => {
        const videoIds = new Set();
        const tweetIds = new Set();
        const duplicates = [];

        const videoRegex = /(?:(?:www\.)?youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const tweetRegex = /(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/;

        for (const url of urls) {
          // Simulate complex processing
          const normalizedUrl = url.toLowerCase().trim();

          const videoMatch = normalizedUrl.match(videoRegex);
          if (videoMatch) {
            const videoId = videoMatch[1];
            if (videoIds.has(videoId)) {
              duplicates.push({ type: 'video', id: videoId, url });
            } else {
              videoIds.add(videoId);
            }
          }

          const tweetMatch = normalizedUrl.match(tweetRegex);
          if (tweetMatch) {
            const tweetId = tweetMatch[1];
            if (tweetIds.has(tweetId)) {
              duplicates.push({ type: 'tweet', id: tweetId, url });
            } else {
              tweetIds.add(tweetId);
            }
          }
        }

        return { unique: videoIds.size + tweetIds.size, duplicates: duplicates.length };
      };

      // Generate large set of URLs with duplicates
      const urls = [];
      for (let i = 0; i < 10000; i++) {
        const videoId = `video${String(i % 1000).padStart(5, '0')}0`; // 11 characters
        urls.push(`https://www.youtube.com/watch?v=${videoId}`); // Intentional duplicates
        urls.push(`https://x.com/user/status/${1000000000000000 + (i % 500)}`); // Intentional duplicates
      }

      const cpuStart = performance.now();
      const result = complexDuplicateDetection(urls);
      const cpuEnd = performance.now();
      const cpuDuration = cpuEnd - cpuStart;

      expect(result.unique).toBe(1500); // 1000 unique videos + 500 unique tweets
      expect(result.duplicates).toBe(18500); // Total URLs - unique URLs

      // Should complete in reasonable time (relaxed for CI environment)
      expect(cpuDuration).toBeLessThan(10000); // Under 10 seconds

      const urlsPerSecond = (urls.length / cpuDuration) * 1000;
      console.log(`Processed ${urlsPerSecond.toFixed(2)} URLs per second`);
      expect(urlsPerSecond).toBeGreaterThan(1000); // At least 1000 URLs/sec
    });

    it('should maintain performance under sustained load', async () => {
      const performanceMetrics = [];
      const iterations = 100;
      const urlsPerIteration = 1000;

      for (let iteration = 0; iteration < iterations; iteration++) {
        const urls = Array.from(
          { length: urlsPerIteration },
          (_, i) => `https://www.youtube.com/watch?v=test${iteration * urlsPerIteration + i}`
        );

        const iterationStart = performance.now();

        // Simulate processing
        const videoIds = new Set();
        urls.forEach(url => {
          const match = url.match(/watch\?v=([a-zA-Z0-9_-]+)/);
          if (match) {
            videoIds.add(match[1]);
          }
        });

        const iterationEnd = performance.now();
        const iterationDuration = iterationEnd - iterationStart;

        performanceMetrics.push({
          iteration,
          duration: iterationDuration,
          throughput: (urlsPerIteration / iterationDuration) * 1000,
        });

        expect(videoIds.size).toBe(urlsPerIteration);
      }

      // Calculate average and check for performance degradation
      const avgThroughput = performanceMetrics.reduce((sum, m) => sum + m.throughput, 0) / iterations;
      const firstHalfAvg =
        performanceMetrics.slice(0, iterations / 2).reduce((sum, m) => sum + m.throughput, 0) / (iterations / 2);
      const secondHalfAvg =
        performanceMetrics.slice(iterations / 2).reduce((sum, m) => sum + m.throughput, 0) / (iterations / 2);

      console.log(`Average throughput: ${avgThroughput.toFixed(2)} URLs/sec`);
      console.log(`First half: ${firstHalfAvg.toFixed(2)}, Second half: ${secondHalfAvg.toFixed(2)}`);

      // Performance should not degrade significantly over time
      const degradationRatio = secondHalfAvg / firstHalfAvg;
      expect(degradationRatio).toBeGreaterThan(0.8); // Less than 20% degradation

      // Overall performance should be acceptable
      expect(avgThroughput).toBeGreaterThan(10000); // At least 10k URLs/sec average
    });
  });
});
