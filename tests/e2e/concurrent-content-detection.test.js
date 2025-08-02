import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ContentCoordinator } from '../../src/core/content-coordinator.js';
import { MonitorApplication } from '../../src/application/monitor-application.js';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { YouTubeScraperService } from '../../src/services/implementations/youtube-scraper-service.js';
import { createEnhancedLoggerMocks } from '../fixtures/enhanced-logger-factory.js';
import { timerTestUtils } from '../fixtures/timer-test-utils.js';

/**
 * Multi-Source Content Detection Race Condition E2E Tests
 *
 * Tests ContentCoordinator handling of simultaneous content detection from:
 * - PubSubHubbub webhook notifications (highest priority)
 * - YouTube API polling (medium priority)
 * - X scraper detection (lowest priority)
 *
 * Validates proper deduplication, source priority, and race condition handling.
 */
describe('Concurrent Content Detection E2E', () => {
  let contentCoordinator;
  let monitorApp;
  let scraperApp;
  let youtubeScraperService;
  let loggerMocks;
  let mockConfig;
  let mockStateManager;
  let mockContentAnnouncer;
  let mockContentStateManager;
  let timerUtils;

  beforeEach(() => {
    jest.clearAllMocks();
    timerUtils = timerTestUtils.setupComplexTimerTest();

    // Create enhanced logger mocks
    loggerMocks = createEnhancedLoggerMocks();

    // Mock configuration
    mockConfig = {
      get: jest.fn((key, defaultValue) => {
        const values = {
          YOUTUBE_CHANNEL_ID: 'UCrAOyUwjSM5zzPz_FqsUhuQ',
          YOUTUBE_API_KEY: 'test-api-key',
          X_USER_HANDLE: 'testuser',
          SCRAPER_POLL_INTERVAL_MINUTES: 2,
          WEBHOOK_PRIORITY_WINDOW_MS: 5000, // 5 second priority window
          API_FALLBACK_DELAY_MS: 10000, // 10 second fallback delay
          SCRAPER_PRIORITY_DELAY_MS: 15000, // 15 second scraper delay
        };
        return values[key] || defaultValue;
      }),
      getRequired: jest.fn(key => mockConfig.get(key)),
    };

    // Mock state manager
    mockStateManager = {
      data: new Map([
        ['postingEnabled', true],
        ['scrapingEnabled', true],
        ['lastProcessedContent', new Map()],
      ]),
      get: jest.fn((key, defaultValue) => mockStateManager.data.get(key) ?? defaultValue),
      set: jest.fn((key, value) => mockStateManager.data.set(key, value)),
    };

    // Mock content announcer
    mockContentAnnouncer = {
      announceContent: jest.fn(async content => ({
        success: true,
        messageId: `msg_${content.id}`,
        channel: content.type === 'youtube' ? 'youtube' : 'x-posts',
      })),
    };

    // Mock content state manager for deduplication
    mockContentStateManager = {
      contentStates: new Map(),

      getContentState: jest.fn(contentId => {
        return mockContentStateManager.contentStates.get(contentId) || null;
      }),

      updateContentState: jest.fn((contentId, source, status, data = {}) => {
        const existingState = mockContentStateManager.contentStates.get(contentId) || {
          id: contentId,
          sources: {},
          firstDetected: Date.now(),
          lastUpdated: Date.now(),
        };

        existingState.sources[source] = {
          status,
          timestamp: Date.now(),
          ...data,
        };
        existingState.lastUpdated = Date.now();

        mockContentStateManager.contentStates.set(contentId, existingState);
        return existingState;
      }),

      hasBeenProcessed: jest.fn(contentId => {
        const state = mockContentStateManager.contentStates.get(contentId);
        return (
          state?.sources?.webhook?.status === 'announced' ||
          state?.sources?.api?.status === 'announced' ||
          state?.sources?.scraper?.status === 'announced'
        );
      }),
    };

    // Mock browser service for scraper
    const mockBrowserService = {
      isConnected: jest.fn(() => true),
      isClosed: jest.fn(() => false),
      launch: jest.fn(),
      close: jest.fn(),
      goto: jest.fn(),
      evaluate: jest.fn(() => Promise.resolve([])),
      waitForSelector: jest.fn(),
    };

    // Mock YouTube service
    const mockYoutubeService = {
      getVideoDetails: jest.fn(),
      getChannelVideos: jest.fn(() => Promise.resolve([])),
      verifyApiAccess: jest.fn(() => Promise.resolve(true)),
    };

    // Mock auth manager
    const mockAuthManager = {
      ensureAuthenticated: jest.fn(() => Promise.resolve(true)),
      isAuthenticated: jest.fn(() => true),
    };

    // Create ContentCoordinator with race condition handling
    contentCoordinator = new ContentCoordinator(
      mockContentAnnouncer,
      mockContentStateManager,
      mockConfig,
      loggerMocks.baseLogger,
      loggerMocks.debugManager,
      loggerMocks.metricsManager
    );

    // Create MonitorApplication (webhook + API fallback)
    monitorApp = new MonitorApplication(
      mockConfig,
      mockStateManager,
      contentCoordinator,
      mockYoutubeService,
      loggerMocks.baseLogger,
      loggerMocks.debugManager,
      loggerMocks.metricsManager
    );

    // Create ScraperApplication (X scraping)
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

    // Create YouTubeScraperService (API polling)
    youtubeScraperService = new YouTubeScraperService(
      mockYoutubeService,
      contentCoordinator,
      mockConfig,
      loggerMocks.baseLogger,
      loggerMocks.debugManager,
      loggerMocks.metricsManager
    );
  });

  afterEach(() => {
    timerUtils.cleanup();
  });

  describe('Source Priority Handling', () => {
    it('should prioritize webhook over API and scraper for same content', async () => {
      const contentId = 'video123';
      const contentData = {
        id: contentId,
        title: 'Test Video',
        publishedAt: '2024-01-01T12:00:00Z',
        url: `https://youtube.com/watch?v=${contentId}`,
      };

      // Simulate near-simultaneous detection from all sources
      const webhookPromise = contentCoordinator.processContent(contentId, 'webhook', {
        ...contentData,
        source: 'pubsubhubbub',
      });

      const apiPromise = contentCoordinator.processContent(contentId, 'api', {
        ...contentData,
        source: 'youtube-api',
      });

      const scraperPromise = contentCoordinator.processContent(contentId, 'scraper', {
        ...contentData,
        source: 'x-scraper',
      });

      // Execute all simultaneously
      const results = await Promise.all([webhookPromise, apiPromise, scraperPromise]);

      // Verify: Only webhook result should be announced
      expect(results[0].action).toBe('announced'); // webhook
      expect(results[1].action).toBe('duplicate_detected'); // api
      expect(results[2].action).toBe('duplicate_detected'); // scraper

      // Verify: Content announcer called only once
      expect(mockContentAnnouncer.announceContent).toHaveBeenCalledTimes(1);
      expect(mockContentAnnouncer.announceContent).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'pubsubhubbub' })
      );

      // Verify: Metrics recorded for race condition handling
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('race_condition_resolved', 1, 'state');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('source_priority_applied', 2, 'state');
    }, 15000);

    it('should handle API fallback when webhook fails', async () => {
      const contentId = 'video456';

      // Setup: Mock webhook processing failure
      mockContentAnnouncer.announceContent
        .mockRejectedValueOnce(new Error('Webhook processing failed'))
        .mockResolvedValueOnce({ success: true, messageId: 'msg_456' });

      // Execute: Webhook fails, API processes successfully
      const webhookResult = await contentCoordinator.processContent(contentId, 'webhook', {
        id: contentId,
        title: 'Test Video',
        source: 'pubsubhubbub',
      });

      const apiResult = await contentCoordinator.processContent(contentId, 'api', {
        id: contentId,
        title: 'Test Video',
        source: 'youtube-api',
      });

      // Verify: Webhook failed, API succeeded
      expect(webhookResult.action).toBe('processing_failed');
      expect(apiResult.action).toBe('announced');

      // Verify: API processing allowed after webhook failure
      expect(mockContentAnnouncer.announceContent).toHaveBeenCalledTimes(2);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('fallback_processing_success', 1, 'state');
    }, 15000);

    it('should respect priority window timing for delayed sources', async () => {
      const contentId = 'video789';

      // Execute: Webhook processes first
      const webhookResult = await contentCoordinator.processContent(contentId, 'webhook', {
        id: contentId,
        title: 'Test Video',
        source: 'pubsubhubbub',
      });

      // Advance time beyond priority window
      await timerUtils.advance(6000); // 6 seconds > 5 second priority window

      // Execute: API attempts processing after priority window
      const apiResult = await contentCoordinator.processContent(contentId, 'api', {
        id: contentId,
        title: 'Test Video',
        source: 'youtube-api',
      });

      // Verify: Webhook succeeded, API properly rejected as duplicate
      expect(webhookResult.action).toBe('announced');
      expect(apiResult.action).toBe('duplicate_detected');

      // Verify: Priority window enforcement metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('priority_window_enforced', 1, 'state');
    }, 15000);
  });

  describe('Concurrent Processing Load Tests', () => {
    it('should handle multiple simultaneous content items from different sources', async () => {
      const contentItems = [
        { id: 'video1', title: 'Video 1', source: 'webhook' },
        { id: 'video2', title: 'Video 2', source: 'api' },
        { id: 'video3', title: 'Video 3', source: 'scraper' },
        { id: 'video4', title: 'Video 4', source: 'webhook' },
        { id: 'video5', title: 'Video 5', source: 'api' },
      ];

      // Execute: Process all content simultaneously
      const promises = contentItems.map(item => contentCoordinator.processContent(item.id, item.source, item));

      const results = await Promise.all(promises);

      // Verify: All items processed successfully (no conflicts)
      const successCount = results.filter(r => r.action === 'announced').length;
      expect(successCount).toBe(5);

      // Verify: No race conditions between different content items
      expect(mockContentAnnouncer.announceContent).toHaveBeenCalledTimes(5);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('concurrent_processing_success', 5, 'state');
    }, 15000);

    it('should maintain performance under high concurrent load', async () => {
      const startTime = Date.now();
      const contentCount = 20;

      // Generate multiple content items with mixed sources
      const contentItems = Array.from({ length: contentCount }, (_, i) => ({
        id: `content${i}`,
        title: `Content ${i}`,
        source: ['webhook', 'api', 'scraper'][i % 3],
      }));

      // Execute: High concurrent load
      const promises = contentItems.map(item => contentCoordinator.processContent(item.id, item.source, item));

      const results = await Promise.all(promises);
      const processingTime = Date.now() - startTime;

      // Verify: All items processed within reasonable time
      const successCount = results.filter(r => r.action === 'announced').length;
      expect(successCount).toBe(contentCount);
      expect(processingTime).toBeLessThan(5000); // Should complete within 5 seconds

      // Verify: Performance metrics recorded
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'high_load_processing_time',
        processingTime,
        'performance'
      );
    }, 15000);
  });

  describe('Error Recovery in Concurrent Scenarios', () => {
    it('should isolate errors to individual content items during concurrent processing', async () => {
      // Setup: Mix of successful and failing content
      mockContentAnnouncer.announceContent
        .mockResolvedValueOnce({ success: true, messageId: 'msg1' }) // content1 succeeds
        .mockRejectedValueOnce(new Error('Network error')) // content2 fails
        .mockResolvedValueOnce({ success: true, messageId: 'msg3' }) // content3 succeeds
        .mockRejectedValueOnce(new Error('Rate limit exceeded')) // content4 fails
        .mockResolvedValueOnce({ success: true, messageId: 'msg5' }); // content5 succeeds

      const contentItems = [
        { id: 'content1', title: 'Success 1' },
        { id: 'content2', title: 'Fail 1' },
        { id: 'content3', title: 'Success 2' },
        { id: 'content4', title: 'Fail 2' },
        { id: 'content5', title: 'Success 3' },
      ];

      // Execute: Concurrent processing with mixed results
      const promises = contentItems.map(item => contentCoordinator.processContent(item.id, 'webhook', item));

      const results = await Promise.all(promises);

      // Verify: Errors isolated, successful items still processed
      const successCount = results.filter(r => r.action === 'announced').length;
      const failureCount = results.filter(r => r.action === 'processing_failed').length;

      expect(successCount).toBe(3);
      expect(failureCount).toBe(2);

      // Verify: Error isolation metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('concurrent_error_isolation', 2, 'state');
    }, 15000);

    it('should handle ContentCoordinator overload gracefully', async () => {
      // Setup: Simulate processing delays and backpressure
      mockContentAnnouncer.announceContent.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay per item
        return { success: true, messageId: 'msg' };
      });

      const contentCount = 50; // Large number to test overload
      const contentItems = Array.from({ length: contentCount }, (_, i) => ({
        id: `overload${i}`,
        title: `Overload Content ${i}`,
        source: 'webhook',
      }));

      // Execute: Overload scenario
      const startTime = Date.now();
      const promises = contentItems.map(item => contentCoordinator.processContent(item.id, item.source, item));

      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // Verify: System handles overload without crashes
      const successCount = results.filter(r => r.action === 'announced').length;
      expect(successCount).toBeGreaterThan(0); // Some should succeed

      // Verify: Overload handling metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('system_overload_handled', 1, 'performance');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'overload_processing_time',
        totalTime,
        'performance'
      );
    }, 20000);
  });

  describe('Real-World Race Condition Scenarios', () => {
    it('should handle YouTube webhook followed by immediate API poll', async () => {
      const videoId = 'realworld123';

      // Simulate real scenario: webhook notification arrives
      const webhookPromise = monitorApp.processWebhookNotification(
        {
          'hub.mode': 'publish',
          'hub.topic': `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${mockConfig.get('YOUTUBE_CHANNEL_ID')}`,
          'hub.signature': 'sha1=valid_signature',
        },
        `
        <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
          <entry>
            <yt:videoId>${videoId}</yt:videoId>
            <title>New Video</title>
            <published>2024-01-01T12:00:00Z</published>
          </entry>
        </feed>
      `
      );

      // Simulate immediate API poll (triggered by fallback mechanism)
      await timerUtils.advance(100); // Small delay to simulate near-simultaneous

      const apiPromise = youtubeScraperService.checkForNewContent();

      // Setup API to return the same video
      youtubeScraperService.mockYoutubeService.getChannelVideos.mockResolvedValue([
        {
          id: videoId,
          title: 'New Video',
          publishedAt: '2024-01-01T12:00:00Z',
          url: `https://youtube.com/watch?v=${videoId}`,
        },
      ]);

      // Execute both simultaneously
      const [webhookResult, apiResult] = await Promise.all([webhookPromise, apiPromise]);

      // Verify: Webhook wins, API detects duplicate
      expect(webhookResult).toEqual(expect.objectContaining({ success: true }));
      expect(mockContentAnnouncer.announceContent).toHaveBeenCalledTimes(1);

      // Verify: Race condition properly handled in real workflow
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('webhook_api_race_resolved', 1, 'youtube');
    }, 15000);

    it('should handle X scraper detecting content already processed by YouTube', async () => {
      const contentText = 'Check out my new YouTube video: https://youtube.com/watch?v=cross123';

      // First: YouTube content processed via webhook
      await contentCoordinator.processContent('cross123', 'webhook', {
        id: 'cross123',
        title: 'Cross-platform Content',
        publishedAt: '2024-01-01T12:00:00Z',
        source: 'youtube',
      });

      // Then: X scraper finds tweet about the same video
      const scraperResult = await contentCoordinator.processContent('tweet_cross123', 'scraper', {
        id: 'tweet_cross123',
        text: contentText,
        author: 'testuser',
        timestamp: '2024-01-01T12:05:00Z',
        url: 'https://x.com/testuser/status/tweet_cross123',
        type: 'post',
        source: 'x-scraper',
      });

      // Verify: X content processed separately (different content IDs)
      expect(scraperResult.action).toBe('announced');
      expect(mockContentAnnouncer.announceContent).toHaveBeenCalledTimes(2);

      // Verify: Cross-platform content handling metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'cross_platform_content_detected',
        1,
        'state'
      );
    }, 15000);
  });
});
