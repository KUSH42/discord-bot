import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ContentCoordinator } from '../../src/core/content-coordinator.js';
import { ContentAnnouncer } from '../../src/core/content-announcer.js';
import { MonitorApplication } from '../../src/application/monitor-application.js';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { createEnhancedLoggerMocks } from '../fixtures/enhanced-logger-factory.js';
import { timerTestUtils } from '../fixtures/timer-test-utils.js';

/**
 * High-Volume Processing Integration Tests
 *
 * Tests system behavior under realistic load scenarios:
 * - Multiple concurrent content detections
 * - High-frequency Discord message sending
 * - Memory usage under sustained load
 * - Rate limiting behavior
 * - Performance degradation thresholds
 * - Resource cleanup under stress
 */
describe('High-Volume Processing Integration', () => {
  let contentCoordinator;
  let contentAnnouncer;
  let monitorApp;
  let scraperApp;
  let loggerMocks;
  let mockConfig;
  let mockStateManager;
  let mockDiscordService;
  let timerUtils;

  beforeEach(() => {
    jest.clearAllMocks();
    timerUtils = timerTestUtils.setupComplexTimerTest();

    // Create enhanced logger mocks
    loggerMocks = createEnhancedLoggerMocks();

    // Mock configuration for load testing
    mockConfig = {
      get: jest.fn((key, defaultValue) => {
        const values = {
          // Rate limiting configuration
          DISCORD_RATE_LIMIT_MESSAGES_PER_MINUTE: 30,
          DISCORD_RATE_LIMIT_BURST_SIZE: 5,
          CONTENT_PROCESSING_BATCH_SIZE: 10,
          CONTENT_PROCESSING_DELAY_MS: 100,

          // Performance thresholds
          MAX_CONCURRENT_PROCESSING: 20,
          MEMORY_WARNING_THRESHOLD_MB: 256,
          MEMORY_CRITICAL_THRESHOLD_MB: 512,
          PROCESSING_TIMEOUT_MS: 30000,

          // Discord configuration
          DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345678',
          DISCORD_X_POSTS_CHANNEL_ID: '123456789012345679',
          DISCORD_X_REPLIES_CHANNEL_ID: '123456789012345680',

          // Content sources
          YOUTUBE_CHANNEL_ID: 'UCrAOyUwjSM5zzPz_FqsUhuQ',
          X_USER_HANDLE: 'testuser',
        };
        return values[key] || defaultValue;
      }),
      getRequired: jest.fn(key => mockConfig.get(key)),
    };

    // Mock state manager with performance tracking
    mockStateManager = {
      data: new Map([
        ['postingEnabled', true],
        ['scrapingEnabled', true],
        [
          'processingMetrics',
          {
            totalProcessed: 0,
            successCount: 0,
            failureCount: 0,
            averageProcessingTime: 0,
          },
        ],
      ]),
      get: jest.fn((key, defaultValue) => mockStateManager.data.get(key) ?? defaultValue),
      set: jest.fn((key, value) => mockStateManager.data.set(key, value)),
    };

    // Mock Discord service with rate limiting and performance tracking
    mockDiscordService = {
      messageQueue: [],
      rateLimitHits: 0,
      lastMessageTime: 0,
      totalMessagesSent: 0,

      sendMessage: jest.fn(async (channelId, content) => {
        const now = Date.now();
        mockDiscordService.totalMessagesSent++;

        // Simulate rate limiting
        if (now - mockDiscordService.lastMessageTime < 2000) {
          // 2 second minimum between messages
          mockDiscordService.rateLimitHits++;
          if (mockDiscordService.rateLimitHits > 3) {
            throw new Error('Discord rate limit exceeded');
          }
        }

        mockDiscordService.lastMessageTime = now;
        mockDiscordService.messageQueue.push({ channelId, content, timestamp: now });

        // Simulate variable response times based on load
        const delay = Math.min(100 + mockDiscordService.totalMessagesSent * 2, 1000);
        await new Promise(resolve => setTimeout(resolve, delay));

        return {
          id: `msg_${Date.now()}_${Math.random()}`,
          timestamp: new Date().toISOString(),
        };
      }),

      fetchChannel: jest.fn(async channelId => ({
        id: channelId,
        name: `test-channel-${channelId.slice(-4)}`,
      })),

      // Test helpers
      resetRateLimit: () => {
        mockDiscordService.rateLimitHits = 0;
        mockDiscordService.lastMessageTime = 0;
      },

      getQueueSize: () => mockDiscordService.messageQueue.length,
      getTotalMessagesSent: () => mockDiscordService.totalMessagesSent,
    };

    // Create ContentAnnouncer with performance monitoring
    contentAnnouncer = new ContentAnnouncer(
      mockDiscordService,
      mockConfig,
      loggerMocks.baseLogger,
      loggerMocks.debugManager,
      loggerMocks.metricsManager
    );

    // Mock ContentStateManager for deduplication
    const mockContentStateManager = {
      contentStates: new Map(),

      getContentState: jest.fn(contentId => {
        return mockContentStateManager.contentStates.get(contentId) || null;
      }),

      updateContentState: jest.fn((contentId, source, status, data = {}) => {
        const state = mockContentStateManager.contentStates.get(contentId) || {
          id: contentId,
          sources: {},
          firstDetected: Date.now(),
          lastUpdated: Date.now(),
        };

        state.sources[source] = { status, timestamp: Date.now(), ...data };
        state.lastUpdated = Date.now();

        mockContentStateManager.contentStates.set(contentId, state);
        return state;
      }),

      hasBeenProcessed: jest.fn(contentId => {
        const state = mockContentStateManager.contentStates.get(contentId);
        return Object.values(state?.sources || {}).some(s => s.status === 'announced');
      }),
    };

    // Create ContentCoordinator
    contentCoordinator = new ContentCoordinator(
      contentAnnouncer,
      mockContentStateManager,
      mockConfig,
      loggerMocks.baseLogger,
      loggerMocks.debugManager,
      loggerMocks.metricsManager
    );

    // Create applications for load testing
    const mockYoutubeService = {
      getVideoDetails: jest.fn(),
      getChannelVideos: jest.fn(() => Promise.resolve([])),
      verifyApiAccess: jest.fn(() => Promise.resolve(true)),
    };

    const mockBrowserService = {
      isConnected: jest.fn(() => true),
      launch: jest.fn(),
      close: jest.fn(),
      evaluate: jest.fn(() => Promise.resolve([])),
    };

    const mockAuthManager = {
      ensureAuthenticated: jest.fn(() => Promise.resolve(true)),
    };

    monitorApp = new MonitorApplication(
      mockConfig,
      mockStateManager,
      contentCoordinator,
      mockYoutubeService,
      loggerMocks.baseLogger,
      loggerMocks.debugManager,
      loggerMocks.metricsManager
    );

    scraperApp = new ScraperApplication(
      mockConfig,
      mockStateManager,
      contentCoordinator,
      mockAuthManager,
      mockBrowserService,
      loggerMocks.baseLogger,
      loggerMocks.debugManager,
      loggerMocks.metricsManager
    );
  });

  afterEach(() => {
    timerUtils.cleanup();
  });

  describe('Concurrent Content Processing Load Tests', () => {
    it('should handle 50 simultaneous content items efficiently', async () => {
      const contentCount = 50;
      const startTime = Date.now();

      // Generate diverse content items
      const contentItems = Array.from({ length: contentCount }, (_, i) => ({
        id: `load_test_${i}`,
        title: `Load Test Content ${i}`,
        publishedAt: new Date(Date.now() - i * 1000).toISOString(),
        url: `https://example.com/content/${i}`,
        source: ['webhook', 'api', 'scraper'][i % 3],
        contentType: ['youtube', 'post', 'retweet'][i % 3],
      }));

      // Execute: Process all content simultaneously
      const promises = contentItems.map(item => contentCoordinator.processContent(item.id, item.source, item));

      const results = await Promise.all(promises);
      const processingTime = Date.now() - startTime;

      // Verify: All items processed successfully
      const successCount = results.filter(r => r.action === 'announced').length;
      expect(successCount).toBe(contentCount);
      expect(processingTime).toBeLessThan(10000); // Should complete within 10 seconds

      // Verify: Performance metrics recorded
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'high_volume_processing_time',
        processingTime,
        'performance'
      );
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'concurrent_processing_success',
        contentCount,
        'performance'
      );

      // Verify: Discord rate limiting respected
      expect(mockDiscordService.rateLimitHits).toBeLessThan(5);
    }, 20000);

    it('should maintain performance under sustained load', async () => {
      const sustainedDurationMs = 5000; // 5 seconds of sustained load
      const contentPerSecond = 10;
      const totalContent = Math.floor(sustainedDurationMs / 1000) * contentPerSecond;

      const startTime = Date.now();
      let processedCount = 0;
      const processingTimes = [];

      // Execute: Sustained load over time
      const loadPromise = new Promise(resolve => {
        const interval = setInterval(async () => {
          if (Date.now() - startTime >= sustainedDurationMs) {
            clearInterval(interval);
            resolve();
            return;
          }

          // Process batch of content
          const batchSize = 5;
          const batch = Array.from({ length: batchSize }, (_, i) => ({
            id: `sustained_${processedCount + i}`,
            title: `Sustained Load Content ${processedCount + i}`,
            source: 'webhook',
            timestamp: Date.now(),
          }));

          const batchStartTime = Date.now();
          await Promise.all(batch.map(item => contentCoordinator.processContent(item.id, item.source, item)));

          const batchTime = Date.now() - batchStartTime;
          processingTimes.push(batchTime);
          processedCount += batchSize;
        }, 500); // Every 500ms
      });

      await loadPromise;
      const totalTime = Date.now() - startTime;

      // Verify: Consistent performance over time
      const averageProcessingTime = processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
      const maxProcessingTime = Math.max(...processingTimes);

      expect(processedCount).toBeGreaterThanOrEqual(totalContent * 0.8); // At least 80% processed
      expect(averageProcessingTime).toBeLessThan(2000); // Average batch under 2 seconds
      expect(maxProcessingTime).toBeLessThan(5000); // No batch over 5 seconds

      // Verify: Sustained load metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'sustained_load_duration',
        totalTime,
        'performance'
      );
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'sustained_load_throughput',
        processedCount,
        'performance'
      );
    }, 15000);

    it('should handle mixed content types under load', async () => {
      const contentTypes = [
        { type: 'youtube_video', count: 20, processingTime: 200 },
        { type: 'x_post', count: 30, processingTime: 100 },
        { type: 'x_retweet', count: 25, processingTime: 50 },
        { type: 'x_reply', count: 15, processingTime: 75 },
      ];

      const allContent = [];
      contentTypes.forEach(({ type, count, processingTime }) => {
        for (let i = 0; i < count; i++) {
          allContent.push({
            id: `mixed_${type}_${i}`,
            title: `Mixed Content ${type} ${i}`,
            contentType: type,
            expectedProcessingTime: processingTime,
            source: type.includes('youtube') ? 'webhook' : 'scraper',
          });
        }
      });

      // Shuffle for realistic mixed processing
      const shuffledContent = allContent.sort(() => Math.random() - 0.5);

      // Execute: Process mixed content types
      const startTime = Date.now();
      const results = await Promise.all(
        shuffledContent.map(item => contentCoordinator.processContent(item.id, item.source, item))
      );
      const totalTime = Date.now() - startTime;

      // Verify: All content types processed successfully
      const successCount = results.filter(r => r.action === 'announced').length;
      expect(successCount).toBe(allContent.length);

      // Verify: Type-specific processing metrics
      contentTypes.forEach(({ type, count }) => {
        expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(`${type}_processed`, count, 'content');
      });

      // Verify: Mixed content performance
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'mixed_content_processing_time',
        totalTime,
        'performance'
      );
    }, 15000);
  });

  describe('Rate Limiting and Backpressure', () => {
    it('should handle Discord rate limiting gracefully', async () => {
      // Setup: Force rate limiting scenario
      mockDiscordService.sendMessage.mockImplementation(async (channelId, content) => {
        mockDiscordService.totalMessagesSent++;

        // Simulate aggressive rate limiting
        if (mockDiscordService.totalMessagesSent > 10) {
          throw new Error('Discord rate limit exceeded');
        }

        return { id: `msg_${mockDiscordService.totalMessagesSent}` };
      });

      const contentCount = 20; // More than rate limit allows
      const contentItems = Array.from({ length: contentCount }, (_, i) => ({
        id: `rate_limit_${i}`,
        title: `Rate Limit Test ${i}`,
        source: 'webhook',
      }));

      // Execute: Process content that will hit rate limits
      const results = await Promise.all(
        contentItems.map(item => contentCoordinator.processContent(item.id, item.source, item))
      );

      // Verify: Some succeed, some fail due to rate limiting
      const successCount = results.filter(r => r.action === 'announced').length;
      const failureCount = results.filter(r => r.action === 'processing_failed').length;

      expect(successCount).toBeGreaterThan(0);
      expect(failureCount).toBeGreaterThan(0);
      expect(successCount + failureCount).toBe(contentCount);

      // Verify: Rate limiting metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'rate_limit_hit',
        expect.any(Number),
        'discord'
      );
    }, 15000);

    it('should implement backpressure when processing queue is full', async () => {
      // Setup: Slow processing to create queue buildup
      mockDiscordService.sendMessage.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
        return { id: `slow_msg_${Date.now()}` };
      });

      const largeContentBatch = Array.from({ length: 30 }, (_, i) => ({
        id: `backpressure_${i}`,
        title: `Backpressure Test ${i}`,
        source: 'webhook',
      }));

      const startTime = Date.now();

      // Execute: Large batch that should trigger backpressure
      const results = await Promise.all(
        largeContentBatch.map(item => contentCoordinator.processContent(item.id, item.source, item))
      );

      const totalTime = Date.now() - startTime;

      // Verify: Backpressure applied (longer processing time)
      expect(totalTime).toBeGreaterThan(5000); // Should take longer due to backpressure

      const successCount = results.filter(r => r.action === 'announced').length;
      expect(successCount).toBeGreaterThan(20); // Most should still succeed

      // Verify: Backpressure metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'backpressure_applied',
        expect.any(Number),
        'performance'
      );
    }, 20000);
  });

  describe('Memory and Resource Management', () => {
    it('should monitor memory usage under high load', async () => {
      // Mock memory monitoring
      let simulatedMemoryUsage = 100; // MB
      const originalMemoryUsage = process.memoryUsage;

      process.memoryUsage = jest.fn(() => ({
        rss: simulatedMemoryUsage * 1024 * 1024,
        heapUsed: simulatedMemoryUsage * 0.8 * 1024 * 1024,
        heapTotal: simulatedMemoryUsage * 1024 * 1024,
        external: 0,
      }));

      const contentBatches = [];
      for (let batch = 0; batch < 5; batch++) {
        const batchContent = Array.from({ length: 20 }, (_, i) => ({
          id: `memory_test_${batch}_${i}`,
          title: `Memory Test Batch ${batch} Item ${i}`,
          source: 'webhook',
          // Simulate larger content to increase memory usage
          largeData: 'x'.repeat(1000), // 1KB per item
        }));

        contentBatches.push(batchContent);
      }

      // Execute: Process batches with memory monitoring
      const coordinator = contentCoordinator; // Capture reference outside loop
      for (const batch of contentBatches) {
        simulatedMemoryUsage += 50; // Simulate memory growth

        await Promise.all(batch.map(item => coordinator.processContent(item.id, item.source, item)));

        // Simulate memory cleanup after each batch
        if (simulatedMemoryUsage > 300) {
          simulatedMemoryUsage = Math.max(150, simulatedMemoryUsage - 100);
        }
      }

      // Cleanup
      process.memoryUsage = originalMemoryUsage;

      // Verify: Memory monitoring metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'memory_usage_mb',
        expect.any(Number),
        'performance'
      );
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'memory_cleanup_triggered',
        expect.any(Number),
        'performance'
      );
    }, 15000);

    it('should handle resource cleanup under continuous load', async () => {
      const resourceCounts = {
        openConnections: 0,
        activeTimers: 0,
        pendingPromises: 0,
      };

      // Mock resource tracking
      const trackResources = () => {
        resourceCounts.openConnections = Math.floor(Math.random() * 10);
        resourceCounts.activeTimers = Math.floor(Math.random() * 5);
        resourceCounts.pendingPromises = Math.floor(Math.random() * 15);
      };

      // Execute: Continuous processing with resource monitoring
      const continuousProcessing = async () => {
        const coordinator = contentCoordinator; // Capture reference outside loop
        for (let i = 0; i < 10; i++) {
          trackResources();

          const batch = Array.from({ length: 10 }, (_, j) => ({
            id: `resource_test_${i}_${j}`,
            title: `Resource Test ${i}.${j}`,
            source: 'webhook',
          }));

          await Promise.all(batch.map(item => coordinator.processContent(item.id, item.source, item)));

          // Simulate periodic cleanup
          if (i % 3 === 0) {
            resourceCounts.openConnections = Math.max(0, resourceCounts.openConnections - 2);
            resourceCounts.pendingPromises = Math.max(0, resourceCounts.pendingPromises - 5);
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        }
      };

      await continuousProcessing();

      // Verify: Resource management metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'resource_cleanup_cycles',
        expect.any(Number),
        'performance'
      );
    }, 15000);
  });

  describe('Performance Degradation Recovery', () => {
    it('should detect and recover from performance degradation', async () => {
      let processingDelay = 100; // Start with normal delay

      // Mock gradual performance degradation
      mockDiscordService.sendMessage.mockImplementation(async () => {
        processingDelay += 50; // Increase delay each time
        await new Promise(resolve => setTimeout(resolve, processingDelay));

        // Simulate recovery after threshold
        if (processingDelay > 1000) {
          processingDelay = 100; // Reset to normal
        }

        return { id: `perf_test_${Date.now()}` };
      });

      const performanceTestContent = Array.from({ length: 15 }, (_, i) => ({
        id: `perf_degradation_${i}`,
        title: `Performance Degradation Test ${i}`,
        source: 'webhook',
      }));

      const startTime = Date.now();
      const results = await Promise.all(
        performanceTestContent.map(item => contentCoordinator.processContent(item.id, item.source, item))
      );
      const totalTime = Date.now() - startTime;

      // Verify: System detected and recovered from degradation
      const successCount = results.filter(r => r.action === 'announced').length;
      expect(successCount).toBeGreaterThan(10); // Most should succeed

      // Verify: Performance degradation metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'performance_degradation_detected',
        expect.any(Number),
        'performance'
      );
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'performance_recovery_triggered',
        expect.any(Number),
        'performance'
      );
    }, 20000);

    it('should maintain service availability during load spikes', async () => {
      // Simulate load spike scenario
      const normalLoad = Array.from({ length: 10 }, (_, i) => ({
        id: `normal_${i}`,
        title: `Normal Load ${i}`,
        source: 'webhook',
      }));

      const loadSpike = Array.from({ length: 50 }, (_, i) => ({
        id: `spike_${i}`,
        title: `Load Spike ${i}`,
        source: 'webhook',
      }));

      // Execute: Normal load first
      const normalResults = await Promise.all(
        normalLoad.map(item => contentCoordinator.processContent(item.id, item.source, item))
      );

      // Execute: Load spike
      const spikeStartTime = Date.now();
      const spikeResults = await Promise.all(
        loadSpike.map(item => contentCoordinator.processContent(item.id, item.source, item))
      );
      const spikeTime = Date.now() - spikeStartTime;

      // Verify: Service maintained availability during spike
      const normalSuccessRate = normalResults.filter(r => r.action === 'announced').length / normalLoad.length;
      const spikeSuccessRate = spikeResults.filter(r => r.action === 'announced').length / loadSpike.length;

      expect(normalSuccessRate).toBeGreaterThan(0.9); // 90%+ success under normal load
      expect(spikeSuccessRate).toBeGreaterThan(0.7); // 70%+ success during spike

      // Verify: Load spike handling metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('load_spike_detected', 1, 'performance');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'load_spike_processing_time',
        spikeTime,
        'performance'
      );
    }, 25000);
  });
});
