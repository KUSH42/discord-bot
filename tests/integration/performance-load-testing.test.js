import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DependencyContainer } from '../../src/infrastructure/dependency-container.js';
import { ContentCoordinator } from '../../src/core/content-coordinator.js';
import { ContentAnnouncer } from '../../src/core/content-announcer.js';
import { ContentStateManager } from '../../src/core/content-state-manager.js';
import { ContentClassifier } from '../../src/core/content-classifier.js';
import { DuplicateDetector } from '../../src/duplicate-detector.js';
import { StateManager } from '../../src/infrastructure/state-manager.js';
import { PersistentStorage } from '../../src/infrastructure/persistent-storage.js';
import { createEnhancedLoggerMocks } from '../fixtures/enhanced-logger-factory.js';
import { nowUTC } from '../../src/utilities/utc-time.js';

/**
 * Performance and Load Testing Integration
 *
 * Tests system performance under realistic high-volume scenarios using real instances
 * Focus areas:
 * - Concurrent content processing throughput
 * - Memory usage patterns under load
 * - Rate limiting behavior
 * - Resource cleanup efficiency
 * - Performance degradation detection
 */
describe('Performance and Load Testing Integration', () => {
  let container;
  let contentCoordinator;
  let contentAnnouncer;
  let contentStateManager;
  let contentClassifier;
  let duplicateDetector;
  let stateManager;
  let persistentStorage;
  let mockDiscordService;
  let mockConfig;
  let loggerMocks;
  let processMemoryBefore;

  beforeEach(async () => {
    // Track initial memory usage
    if (global.gc) {
      global.gc();
    }
    processMemoryBefore = process.memoryUsage();

    // Create enhanced logger mocks
    loggerMocks = createEnhancedLoggerMocks();

    // Mock Discord service with realistic rate limiting
    mockDiscordService = {
      messagesSent: 0,
      lastMessageTime: 0,
      rateLimitDelay: 0,

      sendMessage: jest.fn(async (channelId, content) => {
        const now = Date.now();
        mockDiscordService.messagesSent++;

        // Simulate Discord rate limiting (50 messages per minute = 1.2s between messages)
        if (now - mockDiscordService.lastMessageTime < 1200) {
          mockDiscordService.rateLimitDelay = Math.max(0, 1200 - (now - mockDiscordService.lastMessageTime));
          await new Promise(resolve => setTimeout(resolve, mockDiscordService.rateLimitDelay));
        }

        mockDiscordService.lastMessageTime = Date.now();

        // Simulate variable network latency (50-200ms)
        const networkDelay = 50 + Math.random() * 150;
        await new Promise(resolve => setTimeout(resolve, networkDelay));

        return {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
        };
      }),

      fetchChannel: jest.fn(async channelId => ({
        id: channelId,
        name: `test-channel-${channelId.slice(-4)}`,
      })),

      // Test utilities
      getMetrics: () => ({
        messagesSent: mockDiscordService.messagesSent,
        averageRateLimitDelay: mockDiscordService.rateLimitDelay,
      }),

      reset: () => {
        mockDiscordService.messagesSent = 0;
        mockDiscordService.lastMessageTime = 0;
        mockDiscordService.rateLimitDelay = 0;
      },
    };

    // Performance-focused configuration
    mockConfig = {
      data: new Map([
        // Discord channels
        ['DISCORD_YOUTUBE_CHANNEL_ID', '123456789012345678'],
        ['DISCORD_X_POSTS_CHANNEL_ID', '123456789012345679'],
        ['DISCORD_X_REPLIES_CHANNEL_ID', '123456789012345680'],
        ['DISCORD_X_QUOTES_CHANNEL_ID', '123456789012345681'],
        ['DISCORD_X_RETWEETS_CHANNEL_ID', '123456789012345682'],

        // Performance settings
        ['PROCESSING_LOCK_TIMEOUT_MS', 30000],
        ['SOURCE_PRIORITY', ['webhook', 'api', 'scraper']],
        ['DUPLICATE_DETECTION_WINDOW_HOURS', 24],
        ['CONTENT_FRESHNESS_THRESHOLD_HOURS', 48],

        // Rate limiting
        ['DISCORD_RATE_LIMIT_MESSAGES_PER_MINUTE', 50],
        ['DISCORD_RATE_LIMIT_BURST_SIZE', 5],

        // Memory management (null to use in-memory storage)
        ['PERSISTENT_STORAGE_PATH', null],
      ]),

      get: jest.fn((key, defaultValue) => mockConfig.data.get(key) ?? defaultValue),
      getRequired: jest.fn(key => {
        const value = mockConfig.data.get(key);
        if (value === undefined) {
          throw new Error(`Required config key '${key}' is missing`);
        }
        return value;
      }),
      getNumber: jest.fn((key, defaultValue) => {
        const value = mockConfig.get(key, defaultValue);
        return typeof value === 'number' ? value : defaultValue;
      }),
      getBoolean: jest.fn((key, defaultValue) => {
        const value = mockConfig.get(key, defaultValue);
        return typeof value === 'boolean' ? value : defaultValue;
      }),
    };

    // Create real instances using dependency injection
    container = new DependencyContainer();

    // Register core dependencies
    container.registerInstance('config', mockConfig);
    container.registerInstance('logger', loggerMocks.baseLogger);
    container.registerInstance('debugManager', loggerMocks.debugManager);
    container.registerInstance('metricsManager', loggerMocks.metricsManager);
    container.registerInstance('discordService', mockDiscordService);

    // Register and resolve real instances
    container.registerSingleton('persistentStorage', () => new PersistentStorage(mockConfig));
    container.registerSingleton('stateManager', () => new StateManager());
    container.registerSingleton(
      'duplicateDetector',
      () => new DuplicateDetector(container.resolve('config'), container.resolve('logger'))
    );
    container.registerSingleton('contentClassifier', () => new ContentClassifier(container.resolve('config')));
    container.registerSingleton(
      'contentStateManager',
      () =>
        new ContentStateManager(
          container.resolve('config'),
          container.resolve('persistentStorage'),
          container.resolve('logger'),
          container.resolve('stateManager')
        )
    );
    container.registerSingleton(
      'contentAnnouncer',
      () =>
        new ContentAnnouncer(
          container.resolve('discordService'),
          container.resolve('config'),
          container.resolve('stateManager'),
          container.resolve('logger'),
          container.resolve('debugManager'),
          container.resolve('metricsManager')
        )
    );
    container.registerSingleton(
      'contentCoordinator',
      () =>
        new ContentCoordinator(
          container.resolve('contentStateManager'),
          container.resolve('contentAnnouncer'),
          container.resolve('duplicateDetector'),
          container.resolve('contentClassifier'),
          container.resolve('logger'),
          container.resolve('config'),
          container.resolve('debugManager'),
          container.resolve('metricsManager')
        )
    );

    // Resolve instances
    persistentStorage = container.resolve('persistentStorage');
    stateManager = container.resolve('stateManager');
    duplicateDetector = container.resolve('duplicateDetector');
    contentClassifier = container.resolve('contentClassifier');
    contentStateManager = container.resolve('contentStateManager');
    contentAnnouncer = container.resolve('contentAnnouncer');
    contentCoordinator = container.resolve('contentCoordinator');

    // Initialize state
    stateManager.set('postingEnabled', true);
  });

  afterEach(async () => {
    // Cleanup real instances
    if (contentStateManager) {
      await contentStateManager.shutdown?.();
    }
    if (persistentStorage) {
      await persistentStorage.shutdown?.();
    }

    // Clear state
    mockDiscordService.reset();

    // Force garbage collection and check memory
    if (global.gc) {
      global.gc();
    }

    const memoryAfter = process.memoryUsage();
    const memoryDelta = {
      rss: memoryAfter.rss - processMemoryBefore.rss,
      heapUsed: memoryAfter.heapUsed - processMemoryBefore.heapUsed,
      heapTotal: memoryAfter.heapTotal - processMemoryBefore.heapTotal,
    };

    // Log memory delta for performance monitoring
    if (memoryDelta.heapUsed > 50 * 1024 * 1024) {
      // 50MB threshold
      console.warn(`Significant memory increase detected: ${Math.round(memoryDelta.heapUsed / 1024 / 1024)}MB heap`);
    }
  });

  describe('Concurrent Processing Performance', () => {
    it('should handle 25 simultaneous content items within performance thresholds', async () => {
      const contentCount = 25;
      const maxProcessingTimeMs = 15000; // 15 seconds max
      const startTime = Date.now();

      // Generate realistic content mix
      const contentItems = Array.from({ length: contentCount }, (_, i) => ({
        id: `perf_test_${Date.now()}_${i}`,
        title: `Performance Test Content ${i}`,
        description: `This is test content item ${i} for performance evaluation`,
        publishedAt: new Date(Date.now() - i * 60000).toISOString(), // Staggered by 1 minute
        url: `https://example.com/content/${i}`,
        source: ['webhook', 'api', 'scraper'][i % 3],
        contentType: ['youtube', 'post', 'retweet', 'quote'][i % 4],
        author: `TestAuthor${i % 5}`,
        metrics: {
          views: Math.floor(Math.random() * 10000),
          likes: Math.floor(Math.random() * 1000),
        },
      }));

      // Execute: Process all content simultaneously
      const processingPromises = contentItems.map(async (item, index) => {
        try {
          const result = await contentCoordinator.processContent(item.id, item.source, item);
          if (index === 0) {
            console.log('First result sample:', result);
          }
          return result;
        } catch (error) {
          console.error(`Processing error for item ${index}:`, error.message);
          return { success: false, error, action: 'error' };
        }
      });

      const results = await Promise.all(processingPromises);
      const totalProcessingTime = Date.now() - startTime;

      // Performance assertions
      expect(totalProcessingTime).toBeLessThan(maxProcessingTimeMs);
      expect(results).toHaveLength(contentCount);

      // Debug: Log actual results to understand what's happening
      console.log(
        'Sample results:',
        results.slice(0, 3).map(r => ({
          success: r.success,
          action: r.action,
          reason: r.reason,
          error: r.error?.message,
        }))
      );

      // Verify processing results
      const successfulResults = results.filter(r => r.success && r.action === 'announced');
      const allSuccessful = results.filter(r => r.success);
      console.log(
        `Success breakdown: ${successfulResults.length} announced, ${allSuccessful.length} total successful, ${contentCount} total`
      );

      expect(allSuccessful.length).toBeGreaterThan(contentCount * 0.8); // 80% success rate minimum

      // Discord service performance
      const discordMetrics = mockDiscordService.getMetrics();
      expect(discordMetrics.messagesSent).toBeGreaterThan(0);
      expect(discordMetrics.averageRateLimitDelay).toBeLessThan(2000); // Max 2s rate limit delay

      // Memory usage verification
      const memoryUsage = process.memoryUsage();
      expect(memoryUsage.heapUsed).toBeLessThan(200 * 1024 * 1024); // 200MB heap limit

      // Log performance metrics
      console.log(`Performance Results:
        - Total time: ${totalProcessingTime}ms
        - Success rate: ${((successfulResults.length / contentCount) * 100).toFixed(1)}%
        - Discord messages sent: ${discordMetrics.messagesSent}
        - Average processing time: ${(totalProcessingTime / contentCount).toFixed(1)}ms per item
        - Heap usage: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`);
    }, 30000);

    it('should maintain consistent performance with sequential processing', async () => {
      const batchSize = 10;
      const batchCount = 3;
      const processingTimes = [];
      const maxProcessingTimeVariance = 2.0; // Max 2x difference between fastest and slowest batch

      for (let batch = 0; batch < batchCount; batch++) {
        const batchStartTime = Date.now();

        // Create batch content
        const batchContent = Array.from({ length: batchSize }, (_, i) => ({
          id: `batch_${batch}_item_${i}`,
          title: `Batch ${batch} Content ${i}`,
          publishedAt: new Date(Date.now() - i * 10000).toISOString(),
          source: 'webhook',
          contentType: 'post',
        }));

        // Process batch
        const coordinator = contentCoordinator;
        const batchPromises = batchContent.map(item => coordinator.processContent(item.id, item.source, item));

        const batchResults = await Promise.all(batchPromises);
        const batchTime = Date.now() - batchStartTime;
        processingTimes.push(batchTime);

        // Verify batch success
        const successCount = batchResults.filter(r => r.success).length;
        expect(successCount).toBeGreaterThan(batchSize * 0.8);

        // Brief pause between batches to simulate realistic load patterns
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Performance consistency analysis
      const minTime = Math.min(...processingTimes);
      const maxTime = Math.max(...processingTimes);
      const avgTime = processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
      const variance = maxTime / minTime;

      expect(variance).toBeLessThan(maxProcessingTimeVariance);
      expect(avgTime).toBeLessThan(5000); // Average batch time under 5 seconds

      console.log(`Sequential Performance Results:
        - Batches processed: ${batchCount}
        - Min batch time: ${minTime}ms
        - Max batch time: ${maxTime}ms
        - Average batch time: ${avgTime.toFixed(1)}ms
        - Performance variance: ${variance.toFixed(2)}x`);
    }, 45000);
  });

  describe('Memory Management Under Load', () => {
    it('should maintain stable memory usage during sustained processing', async () => {
      const sustainedDurationMs = 8000; // 8 seconds
      const processingIntervalMs = 500; // Process content every 500ms
      const memoryMeasurements = [];
      let processedCount = 0;

      const startTime = Date.now();
      let sustainedProcessing = true;

      // Start sustained processing
      const processingLoop = async () => {
        while (sustainedProcessing && Date.now() - startTime < sustainedDurationMs) {
          const content = {
            id: `sustained_${processedCount}`,
            title: `Sustained Load Content ${processedCount}`,
            publishedAt: new Date().toISOString(),
            source: 'scraper',
            contentType: 'post',
          };

          try {
            await contentCoordinator.processContent(content.id, content.source, content);
            processedCount++;
          } catch (error) {
            // Log but continue processing
            console.warn(`Processing error: ${error.message}`);
          }

          // Measure memory every few iterations
          if (processedCount % 3 === 0) {
            const memUsage = process.memoryUsage();
            memoryMeasurements.push({
              timestamp: Date.now() - startTime,
              heapUsed: memUsage.heapUsed,
              heapTotal: memUsage.heapTotal,
              rss: memUsage.rss,
            });
          }

          await new Promise(resolve => setTimeout(resolve, processingIntervalMs));
        }
      };

      await processingLoop();
      sustainedProcessing = false;

      // Memory stability analysis
      expect(memoryMeasurements.length).toBeGreaterThan(0);

      const initialMemory = memoryMeasurements[0].heapUsed;
      const finalMemory = memoryMeasurements[memoryMeasurements.length - 1].heapUsed;
      const maxMemory = Math.max(...memoryMeasurements.map(m => m.heapUsed));

      const memoryGrowth = (finalMemory - initialMemory) / 1024 / 1024; // MB
      const peakMemoryUsage = maxMemory / 1024 / 1024; // MB

      // Memory stability assertions
      expect(memoryGrowth).toBeLessThan(50); // Less than 50MB growth
      expect(peakMemoryUsage).toBeLessThan(150); // Peak under 150MB
      expect(processedCount).toBeGreaterThan(10); // Minimum processing throughput

      console.log(`Memory Management Results:
        - Processing duration: ${Date.now() - startTime}ms
        - Items processed: ${processedCount}
        - Memory growth: ${memoryGrowth.toFixed(2)}MB
        - Peak memory usage: ${peakMemoryUsage.toFixed(2)}MB
        - Processing rate: ${(processedCount / ((Date.now() - startTime) / 1000)).toFixed(1)} items/sec`);
    }, 15000);
  });

  describe('Rate Limiting and Backpressure', () => {
    it('should handle Discord rate limiting gracefully without failures', async () => {
      const burstSize = 12; // Intentionally exceed Discord's rate limit
      const maxAllowedFailures = 1; // Allow minimal failures due to rate limiting

      // Generate burst content
      const burstContent = Array.from({ length: burstSize }, (_, i) => ({
        id: `burst_${Date.now()}_${i}`,
        title: `Burst Test Content ${i}`,
        publishedAt: new Date().toISOString(),
        source: 'webhook',
        contentType: 'youtube',
      }));

      const startTime = Date.now();
      const processingPromises = burstContent.map(content =>
        contentCoordinator.processContent(content.id, content.source, content)
      );

      const results = await Promise.all(processingPromises);
      const totalTime = Date.now() - startTime;

      // Rate limiting behavior analysis
      const failures = results.filter(r => !r.success);
      const announcements = results.filter(r => r.success && r.action === 'announced');

      expect(failures.length).toBeLessThanOrEqual(maxAllowedFailures);
      expect(announcements.length).toBeGreaterThan(burstSize * 0.85); // 85% success rate minimum

      // Verify rate limiting was respected (should take time due to rate limits)
      const expectedMinTime = (burstSize - 2) * 1200; // Approximate minimum time with rate limiting
      expect(totalTime).toBeGreaterThan(expectedMinTime * 0.5); // Allow some variance

      const discordMetrics = mockDiscordService.getMetrics();
      console.log(`Rate Limiting Results:
        - Burst size: ${burstSize}
        - Successful announcements: ${announcements.length}
        - Failed attempts: ${failures.length}
        - Total processing time: ${totalTime}ms
        - Messages sent to Discord: ${discordMetrics.messagesSent}
        - Average delay per message: ${(totalTime / discordMetrics.messagesSent).toFixed(1)}ms`);
    }, 25000);
  });

  describe('Resource Cleanup and Efficiency', () => {
    it('should clean up resources efficiently after high-volume processing', async () => {
      const highVolumeCount = 20;

      // Process high volume of content
      const contentItems = Array.from({ length: highVolumeCount }, (_, i) => ({
        id: `cleanup_test_${i}`,
        title: `Cleanup Test Content ${i}`,
        publishedAt: new Date(Date.now() - i * 30000).toISOString(),
        source: 'api',
        contentType: ['post', 'retweet'][i % 2],
      }));

      // Process all content
      const results = await Promise.all(
        contentItems.map(item => contentCoordinator.processContent(item.id, item.source, item))
      );

      const successCount = results.filter(r => r.success).length;
      expect(successCount).toBeGreaterThan(highVolumeCount * 0.8);

      // Force cleanup and verify resource state
      if (global.gc) {
        global.gc();
      }

      // Verify state manager contains processed content references
      const stateKeys = Array.from(stateManager.data?.keys() || []);
      expect(stateKeys.length).toBeGreaterThan(0);

      // Verify content state manager has tracked the content
      const contentStates = await Promise.all(
        contentItems.slice(0, 5).map(item => contentStateManager.getContentState(item.id))
      );
      const trackedStates = contentStates.filter(state => state !== null);
      expect(trackedStates.length).toBeGreaterThan(0);

      // Memory should be reasonable after processing
      const memoryAfterCleanup = process.memoryUsage();
      expect(memoryAfterCleanup.heapUsed).toBeLessThan(100 * 1024 * 1024); // 100MB limit

      console.log(`Resource Cleanup Results:
        - Items processed: ${successCount}/${highVolumeCount}
        - State manager keys: ${stateKeys.length}
        - Tracked content states: ${trackedStates.length}
        - Heap usage after cleanup: ${Math.round(memoryAfterCleanup.heapUsed / 1024 / 1024)}MB`);
    }, 20000);
  });
});
