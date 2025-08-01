import { jest } from '@jest/globals';
import { timestampUTC } from '../../src/utilities/utc-time.js';
import {
  createMockDependenciesWithEnhancedLogging,
  createMockEnhancedLogger,
} from '../utils/enhanced-logging-mocks.js';

// Import the ContentCoordinator after mocking
const { ContentCoordinator } = await import('../../src/core/content-coordinator.js');

describe('ContentCoordinator', () => {
  let coordinator;
  let mockContentStateManager;
  let mockContentAnnouncer;
  let mockDuplicateDetector;
  let mockContentClassifier;
  let mockLogger;
  let mockConfig;
  let mockDependencies;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    mockContentStateManager = {
      getContentState: jest.fn(),
      addContent: jest.fn(),
      updateContentState: jest.fn(),
      markAsAnnounced: jest.fn(),
      isNewContent: jest.fn(),
    };

    mockContentAnnouncer = {
      announceContent: jest.fn(),
    };

    mockDuplicateDetector = {
      isDuplicate: jest.fn(),
      markAsSeen: jest.fn(),
      isDuplicateWithFingerprint: jest.fn(),
      markAsSeenWithFingerprint: jest.fn(),
    };

    mockContentClassifier = {
      classify: jest.fn(),
    };

    mockConfig = {
      get: jest.fn().mockReturnValue(['webhook', 'api', 'scraper']),
      getNumber: jest.fn().mockReturnValue(30000),
    };

    // Enhanced logging mocks
    mockDependencies = createMockDependenciesWithEnhancedLogging();
    mockLogger = mockDependencies.logger;

    coordinator = new ContentCoordinator(
      mockContentStateManager,
      mockContentAnnouncer,
      mockDuplicateDetector,
      { classify: jest.fn() }, // classifier
      mockLogger,
      mockConfig,
      mockDependencies.debugManager,
      mockDependencies.metricsManager
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      expect(coordinator.lockTimeout).toBe(30000);
      expect(coordinator.sourcePriority).toEqual(['webhook', 'api', 'scraper']);
      expect(coordinator.processingQueue.size).toBe(0);
    });

    it('should initialize metrics to zero', () => {
      expect(coordinator.metrics).toEqual({
        totalProcessed: 0,
        duplicatesSkipped: 0,
        raceConditionsPrevented: 0,
        sourcePrioritySkips: 0,
        processingErrors: 0,
      });
    });

    it('should handle missing config gracefully', () => {
      const coordinatorWithoutConfig = new ContentCoordinator(
        mockContentStateManager,
        mockContentAnnouncer,
        mockDuplicateDetector,
        mockContentClassifier, // missing classifier parameter
        mockLogger,
        null, // no config
        mockDependencies.debugManager,
        mockDependencies.metricsManager
      );

      expect(coordinatorWithoutConfig.lockTimeout).toBeUndefined();
      expect(coordinatorWithoutConfig.sourcePriority).toEqual(['webhook', 'api', 'scraper']);
    });
  });

  describe('processContent', () => {
    const contentId = 'test-content-123';
    const source = 'webhook';
    const contentData = {
      type: 'video',
      title: 'Test Video',
      url: 'https://www.youtube.com/watch?v=test123',
      publishedAt: new Date().toISOString(),
    };

    beforeEach(() => {
      mockContentStateManager.getContentState.mockReturnValue(null);
      mockContentStateManager.isNewContent.mockReturnValue(true);
      mockContentStateManager.addContent.mockResolvedValue();
      mockContentStateManager.markAsAnnounced.mockResolvedValue();
      mockContentAnnouncer.announceContent.mockResolvedValue({ success: true });
      mockDuplicateDetector.isDuplicateWithFingerprint.mockResolvedValue(false);
      mockDuplicateDetector.markAsSeenWithFingerprint.mockResolvedValue();
    });

    it('should validate content ID', async () => {
      await expect(coordinator.processContent('', source, contentData)).rejects.toThrow(
        'Content ID must be a non-empty string'
      );
      await expect(coordinator.processContent(null, source, contentData)).rejects.toThrow(
        'Content ID must be a non-empty string'
      );
      await expect(coordinator.processContent(123, source, contentData)).rejects.toThrow(
        'Content ID must be a non-empty string'
      );
    });

    it('should warn about unknown sources', async () => {
      await coordinator.processContent(contentId, 'unknown_source', contentData);

      // Enhanced logging is integrated - coordinator should complete successfully
      expect(coordinator.metrics.totalProcessed).toBe(1);
    });

    it('should prevent race conditions by queuing', async () => {
      const promise1 = coordinator.processContent(contentId, source, contentData);
      const promise2 = coordinator.processContent(contentId, source, contentData);

      expect(coordinator.processingQueue.has(contentId)).toBe(true);
      expect(coordinator.metrics.raceConditionsPrevented).toBe(1);

      await Promise.all([promise1, promise2]);
    });

    it('should clear processing queue after completion', async () => {
      const result = await coordinator.processContent(contentId, source, contentData);

      expect(coordinator.processingQueue.has(contentId)).toBe(false);
      expect(result.action).toBe('announced');
    });

    it('should clear processing queue after timeout', async () => {
      // Set a very short timeout for testing
      coordinator.lockTimeout = 100;

      const slowPromise = coordinator.processContent(contentId, source, contentData);

      // Fast-forward past timeout
      jest.advanceTimersByTime(150);

      expect(coordinator.processingQueue.has(contentId)).toBe(false);

      await slowPromise;
    });

    it('should handle processing failures and increment error metrics', async () => {
      const error = new Error('Processing failed');
      mockContentAnnouncer.announceContent.mockRejectedValue(error);

      await expect(coordinator.processContent(contentId, source, contentData)).rejects.toThrow('Processing failed');

      expect(coordinator.metrics.processingErrors).toBe(1);
    });
  });

  describe('doProcessContent', () => {
    const contentId = 'test-content-123';
    const source = 'webhook';
    const contentData = {
      type: 'video',
      title: 'Test Video',
      url: 'https://www.youtube.com/watch?v=test123',
      publishedAt: new Date().toISOString(),
    };

    beforeEach(() => {
      mockContentStateManager.getContentState.mockReturnValue(null);
      mockContentStateManager.isNewContent.mockReturnValue(true);
      mockContentStateManager.addContent.mockResolvedValue();
      mockContentStateManager.markAsAnnounced.mockResolvedValue();
      mockContentAnnouncer.announceContent.mockResolvedValue({ success: true });
      mockDuplicateDetector.isDuplicateWithFingerprint.mockResolvedValue(false);
      mockDuplicateDetector.markAsSeenWithFingerprint.mockResolvedValue();
    });

    it('should skip content based on source priority', async () => {
      const existingState = { source: 'webhook', announced: false };
      mockContentStateManager.getContentState.mockReturnValue(existingState);

      const result = await coordinator.doProcessContent(contentId, 'scraper', contentData);

      expect(result).toEqual({
        action: 'skip',
        reason: 'source_priority',
        existingSource: 'webhook',
        newSource: 'scraper',
        contentId,
      });
      expect(coordinator.metrics.sourcePrioritySkips).toBe(1);
    });

    it('should skip already announced content', async () => {
      const existingState = { source: 'webhook', announced: true };
      mockContentStateManager.getContentState.mockReturnValue(existingState);

      const result = await coordinator.doProcessContent(contentId, 'webhook', contentData);

      expect(result).toEqual({
        action: 'skip',
        reason: 'already_announced',
        existingSource: 'webhook',
        newSource: 'webhook',
        contentId,
      });
      expect(coordinator.metrics.duplicatesSkipped).toBe(1);
    });

    it('should skip duplicate content', async () => {
      mockDuplicateDetector.isDuplicateWithFingerprint.mockResolvedValue(true);

      const result = await coordinator.doProcessContent(contentId, source, contentData);

      expect(result).toEqual({
        action: 'skip',
        reason: 'duplicate_detected',
        source,
        contentId,
      });
      expect(coordinator.metrics.duplicatesSkipped).toBe(1);
    });

    it('should skip content that is too old', async () => {
      mockContentStateManager.isNewContent.mockReturnValue(false);

      const result = await coordinator.doProcessContent(contentId, source, contentData);

      expect(result).toEqual({
        action: 'skip',
        reason: 'content_too_old',
        source,
        contentId,
        publishedAt: contentData.publishedAt,
      });
    });

    it('should process new content successfully', async () => {
      const result = await coordinator.doProcessContent(contentId, source, contentData);

      expect(mockContentStateManager.addContent).toHaveBeenCalledWith(contentId, {
        type: 'video',
        state: 'published',
        source,
        publishedAt: contentData.publishedAt,
        url: contentData.url,
        title: contentData.title,
        metadata: {},
      });

      expect(mockContentAnnouncer.announceContent).toHaveBeenCalledWith({
        ...contentData,
        id: contentId,
        source,
        detectionTime: expect.any(Date),
        contentType: 'video',
      });

      expect(mockContentStateManager.markAsAnnounced).toHaveBeenCalledWith(contentId);
      expect(coordinator.metrics.totalProcessed).toBe(1);

      expect(result).toEqual({
        action: 'announced',
        source,
        contentId,
        announcementResult: { success: true },
      });
    });

    it('should update existing content with better source', async () => {
      const existingState = { source: 'scraper', announced: false };
      mockContentStateManager.getContentState.mockReturnValue(existingState);

      await coordinator.doProcessContent(contentId, 'webhook', contentData);

      expect(mockContentStateManager.updateContentState).toHaveBeenCalledWith(contentId, {
        source: 'webhook',
        lastUpdated: expect.any(Date),
      });
    });

    it('should handle duplicate detection fallback', async () => {
      // Enhanced detection not available
      delete mockDuplicateDetector.isDuplicateWithFingerprint;
      mockDuplicateDetector.isDuplicate.mockReturnValue(false);

      const result = await coordinator.doProcessContent(contentId, source, contentData);

      expect(mockDuplicateDetector.isDuplicate).toHaveBeenCalledWith(contentData.url);
      expect(result.action).toBe('announced');
    });

    it('should handle duplicate detection failures gracefully', async () => {
      const error = new Error('Duplicate detection failed');
      mockDuplicateDetector.isDuplicateWithFingerprint.mockRejectedValue(error);

      const result = await coordinator.doProcessContent(contentId, source, contentData);

      expect(result.action).toBe('announced');
    });

    it('should handle mark as seen fallback', async () => {
      // Enhanced marking not available
      delete mockDuplicateDetector.markAsSeenWithFingerprint;

      await coordinator.doProcessContent(contentId, source, contentData);

      expect(mockDuplicateDetector.markAsSeen).toHaveBeenCalledWith(contentData.url);
    });

    it('should handle mark as seen failures gracefully', async () => {
      const error = new Error('Mark as seen failed');
      mockDuplicateDetector.markAsSeenWithFingerprint.mockRejectedValue(error);

      const result = await coordinator.doProcessContent(contentId, source, contentData);

      expect(result.action).toBe('announced');
    });
  });

  describe('source priority management', () => {
    describe('shouldProcessFromSource', () => {
      it('should allow higher priority sources to override lower priority', () => {
        const existingState = { source: 'scraper' };

        expect(coordinator.shouldProcessFromSource(existingState, 'webhook')).toBe(true);
        expect(coordinator.shouldProcessFromSource(existingState, 'api')).toBe(true);
        expect(coordinator.shouldProcessFromSource(existingState, 'scraper')).toBe(true);
      });

      it('should reject lower priority sources', () => {
        const existingState = { source: 'webhook' };

        expect(coordinator.shouldProcessFromSource(existingState, 'api')).toBe(false);
        expect(coordinator.shouldProcessFromSource(existingState, 'scraper')).toBe(false);
      });

      it('should allow same priority sources', () => {
        const existingState = { source: 'webhook' };

        expect(coordinator.shouldProcessFromSource(existingState, 'webhook')).toBe(true);
      });
    });

    describe('getSourcePriority', () => {
      it('should return correct priority index for known sources', () => {
        expect(coordinator.getSourcePriority('webhook')).toBe(0);
        expect(coordinator.getSourcePriority('api')).toBe(1);
        expect(coordinator.getSourcePriority('scraper')).toBe(2);
      });

      it('should return maximum index for unknown sources', () => {
        expect(coordinator.getSourcePriority('unknown')).toBe(3);
      });
    });

    describe('selectBestSource', () => {
      it('should select higher priority source', () => {
        expect(coordinator.selectBestSource('webhook', 'scraper')).toBe('webhook');
        expect(coordinator.selectBestSource('scraper', 'webhook')).toBe('webhook');
        expect(coordinator.selectBestSource('api', 'scraper')).toBe('api');
        expect(coordinator.selectBestSource('scraper', 'api')).toBe('api');
      });

      it('should select first source when priorities are equal', () => {
        expect(coordinator.selectBestSource('webhook', 'webhook')).toBe('webhook');
      });
    });

    describe('updateSourcePriority', () => {
      it('should update source priority successfully', () => {
        const newPriority = ['api', 'webhook', 'scraper'];

        coordinator.updateSourcePriority(newPriority);

        expect(coordinator.sourcePriority).toEqual(newPriority);
      });

      it('should reject non-array priority', () => {
        expect(() => coordinator.updateSourcePriority('not-an-array')).toThrow('Source priority must be an array');
      });
    });
  });

  describe('content type and state determination', () => {
    describe('determineContentType', () => {
      it('should return provided type if available', () => {
        const contentData = { type: 'custom_type' };
        expect(coordinator.determineContentType(contentData)).toBe('custom_type');
      });

      it('should detect YouTube video types from URL', () => {
        expect(
          coordinator.determineContentType({
            url: 'https://www.youtube.com/watch?v=123',
            isLive: false,
          })
        ).toBe('video');

        expect(
          coordinator.determineContentType({
            url: 'https://youtu.be/123',
            isLive: false,
          })
        ).toBe('video');

        expect(
          coordinator.determineContentType({
            url: 'https://www.youtube.com/watch?v=123',
            isLive: true,
          })
        ).toBe('livestream');
      });

      it('should detect X/Twitter types from URL', () => {
        expect(
          coordinator.determineContentType({
            url: 'https://x.com/user/status/123',
          })
        ).toBe('x_tweet');

        expect(
          coordinator.determineContentType({
            url: 'https://twitter.com/user/status/123',
          })
        ).toBe('x_tweet');
      });

      it('should return unknown for unrecognized content', () => {
        expect(coordinator.determineContentType({})).toBe('unknown');
        expect(coordinator.determineContentType({ url: 'https://example.com' })).toBe('unknown');
      });
    });

    describe('determineInitialState', () => {
      it('should return provided state if available', () => {
        const contentData = { state: 'custom_state' };
        expect(coordinator.determineInitialState(contentData)).toBe('custom_state');
      });

      it('should return live for live content', () => {
        const contentData = { isLive: true };
        expect(coordinator.determineInitialState(contentData)).toBe('live');
      });

      it('should determine scheduled vs live based on time', () => {
        const futureTime = new Date(timestampUTC() + 60000).toISOString();
        const pastTime = new Date(timestampUTC() - 60000).toISOString();

        expect(coordinator.determineInitialState({ scheduledStartTime: futureTime })).toBe('scheduled');

        expect(coordinator.determineInitialState({ scheduledStartTime: pastTime })).toBe('live');
      });

      it('should default to published', () => {
        expect(coordinator.determineInitialState({})).toBe('published');
      });
    });
  });

  describe('announceContent', () => {
    const contentId = 'test-content-123';
    const source = 'webhook';
    const contentData = {
      title: 'Test Video',
      url: 'https://www.youtube.com/watch?v=test123',
    };

    it('should call content announcer with enriched data', async () => {
      mockContentAnnouncer.announceContent.mockResolvedValue({ success: true });

      const result = await coordinator.announceContent(contentId, contentData, source);

      expect(mockContentAnnouncer.announceContent).toHaveBeenCalledWith({
        ...contentData,
        id: contentId,
        source,
        detectionTime: expect.any(Date),
        contentType: 'video',
      });

      expect(result).toEqual({ success: true });
    });
  });

  describe('statistics and monitoring', () => {
    describe('getStats', () => {
      it('should return comprehensive statistics', () => {
        coordinator.metrics.totalProcessed = 10;
        coordinator.metrics.duplicatesSkipped = 3;
        coordinator.metrics.raceConditionsPrevented = 2;
        coordinator.metrics.sourcePrioritySkips = 1;
        coordinator.metrics.processingErrors = 1;

        // Add some active processing
        coordinator.processingQueue.set('test-1', Promise.resolve());
        coordinator.processingQueue.set('test-2', Promise.resolve());

        const stats = coordinator.getStats();

        expect(stats).toEqual({
          totalProcessed: 10,
          duplicatesSkipped: 3,
          raceConditionsPrevented: 2,
          sourcePrioritySkips: 1,
          processingErrors: 1,
          activeProcessing: 2,
          sourcePriority: ['webhook', 'api', 'scraper'],
          lockTimeoutMs: expect.any(Number),
        });
      });
    });

    describe('getQueueInfo', () => {
      it('should return detailed queue information', () => {
        coordinator.processingQueue.set('test-1', Promise.resolve());
        coordinator.processingQueue.set('test-2', Promise.resolve());

        const queueInfo = coordinator.getQueueInfo();

        expect(queueInfo).toEqual({
          activeCount: 2,
          activeContentIds: ['test-1', 'test-2'],
          lockTimeoutMs: expect.any(Number),
        });
      });
    });

    describe('resetMetrics', () => {
      it('should reset all metrics to zero', () => {
        coordinator.metrics.totalProcessed = 10;
        coordinator.metrics.duplicatesSkipped = 3;

        coordinator.resetMetrics();

        expect(coordinator.metrics).toEqual({
          totalProcessed: 0,
          duplicatesSkipped: 0,
          raceConditionsPrevented: 0,
          sourcePrioritySkips: 0,
          processingErrors: 0,
        });
      });
    });
  });

  describe('emergency operations', () => {
    describe('forceClearQueue', () => {
      it('should clear processing queue and log warning', () => {
        coordinator.processingQueue.set('test-1', Promise.resolve());
        coordinator.processingQueue.set('test-2', Promise.resolve());

        const clearedCount = coordinator.forceClearQueue('test_reason');

        expect(clearedCount).toBe(2);
        expect(coordinator.processingQueue.size).toBe(0);
      });

      it('should handle empty queue gracefully', () => {
        const clearedCount = coordinator.forceClearQueue();

        expect(clearedCount).toBe(0);
        // No logging expectations needed for empty queue case
      });
    });
  });

  describe('lifecycle management', () => {
    describe('destroy', () => {
      it('should clear processing queue and log final metrics', async () => {
        coordinator.processingQueue.set('test-1', Promise.resolve());
        coordinator.processingQueue.set('test-2', Promise.resolve());
        coordinator.metrics.totalProcessed = 5;

        await coordinator.destroy();

        expect(coordinator.processingQueue.size).toBe(0);
      });

      it('should handle destroy with empty queue gracefully', async () => {
        await coordinator.destroy();

        expect(coordinator.processingQueue.size).toBe(0);
      });
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle content data without metadata gracefully', async () => {
      const contentId = 'test-content-123';
      const source = 'webhook';
      const contentData = {
        title: 'Test Video',
        url: 'https://www.youtube.com/watch?v=test123',
        publishedAt: new Date().toISOString(),
        // No metadata field
      };

      mockContentStateManager.getContentState.mockReturnValue(null);
      mockContentStateManager.isNewContent.mockReturnValue(true);
      mockContentStateManager.addContent.mockResolvedValue();
      mockContentStateManager.markAsAnnounced.mockResolvedValue();
      mockContentAnnouncer.announceContent.mockResolvedValue({ success: true });
      mockDuplicateDetector.isDuplicateWithFingerprint.mockResolvedValue(false);
      mockDuplicateDetector.markAsSeenWithFingerprint.mockResolvedValue();

      const result = await coordinator.processContent(contentId, source, contentData);

      expect(result.action).toBe('announced');
      expect(mockContentStateManager.addContent).toHaveBeenCalledWith(contentId, {
        type: 'video',
        state: 'published',
        source,
        publishedAt: contentData.publishedAt,
        url: contentData.url,
        title: contentData.title,
        metadata: {},
      });
    });

    it('should handle retry after failed processing', async () => {
      const contentId = 'test-content-123';
      const source = 'webhook';
      const contentData = {
        title: 'Test Video',
        url: 'https://www.youtube.com/watch?v=test123',
        publishedAt: new Date().toISOString(),
      };

      // Set up mocks for successful processing
      mockContentStateManager.getContentState.mockReturnValue(null);
      mockContentStateManager.isNewContent.mockReturnValue(true);
      mockContentStateManager.addContent.mockResolvedValue();
      mockContentStateManager.markAsAnnounced.mockResolvedValue();
      mockContentAnnouncer.announceContent.mockResolvedValue({ success: true });
      mockDuplicateDetector.isDuplicateWithFingerprint.mockResolvedValue(false);
      mockDuplicateDetector.markAsSeenWithFingerprint.mockResolvedValue();

      // Simulate a failed processing followed by successful retry
      const failedPromise = Promise.reject(new Error('Processing failed'));
      coordinator.processingQueue.set(contentId, failedPromise);

      const result = await coordinator.processContent(contentId, source, contentData);

      expect(result.action).toBe('announced');
    });
  });

  describe('Discord Channel Scanning Integration', () => {
    beforeEach(() => {
      coordinator = new ContentCoordinator(
        mockContentStateManager,
        mockContentAnnouncer,
        mockDuplicateDetector,
        mockContentClassifier,
        mockDependencies.logger,
        mockConfig,
        mockDependencies.debugManager,
        mockDependencies.metricsManager
      );
    });

    describe('initializeDiscordChannelScanning', () => {
      let mockDiscordService;

      beforeEach(() => {
        mockDiscordService = {
          isReady: jest.fn().mockReturnValue(true),
          fetchChannel: jest.fn(),
        };

        mockConfig.get.mockImplementation(key => {
          const configMap = {
            DISCORD_YOUTUBE_CHANNEL_ID: 'youtube-channel-123',
            DISCORD_X_POSTS_CHANNEL_ID: 'x-posts-456',
            DISCORD_X_REPLIES_CHANNEL_ID: 'x-replies-789',
            DISCORD_X_QUOTES_CHANNEL_ID: 'x-quotes-012',
            DISCORD_X_RETWEETS_CHANNEL_ID: 'x-retweets-345',
          };
          return configMap[key];
        });

        mockDuplicateDetector.scanDiscordChannelForVideos = jest.fn().mockResolvedValue({
          messagesScanned: 50,
          videoIdsAdded: 3,
          errors: [],
        });

        mockDuplicateDetector.scanDiscordChannelForTweets = jest.fn().mockResolvedValue({
          messagesScanned: 25,
          tweetIdsAdded: 2,
          errors: [],
        });
      });

      it('should successfully scan Discord channels for duplicate detection', async () => {
        const mockYouTubeChannel = { id: 'youtube-channel-123', name: 'YouTube Channel' };
        const mockXChannel = { id: 'x-posts-456', name: 'X Posts Channel' };

        mockDiscordService.fetchChannel.mockImplementation(channelId => {
          if (channelId === 'youtube-channel-123') {
            return Promise.resolve(mockYouTubeChannel);
          }
          if (channelId.startsWith('x-')) {
            return Promise.resolve(mockXChannel);
          }
          return Promise.resolve(null);
        });

        const result = await coordinator.initializeDiscordChannelScanning(mockDiscordService, mockConfig);

        expect(result.scanned).toBe(true);
        expect(result.results.totalScanned).toBe(150); // 50 + 25*4
        expect(result.results.totalAdded).toBe(11); // 3 + 2*4
        expect(mockDuplicateDetector.scanDiscordChannelForVideos).toHaveBeenCalledWith(mockYouTubeChannel, 100);
        expect(mockDuplicateDetector.scanDiscordChannelForTweets).toHaveBeenCalledTimes(4);
      });

      it('should skip scanning when Discord service is not ready', async () => {
        mockDiscordService.isReady.mockReturnValue(false);

        const result = await coordinator.initializeDiscordChannelScanning(mockDiscordService, mockConfig);

        expect(result.scanned).toBe(false);
        expect(result.reason).toBe('discord_not_ready');
        expect(mockDuplicateDetector.scanDiscordChannelForVideos).not.toHaveBeenCalled();
      });

      it('should skip scanning when no duplicate detector is available', async () => {
        coordinator.duplicateDetector = null;

        const result = await coordinator.initializeDiscordChannelScanning(mockDiscordService, mockConfig);

        expect(result.scanned).toBe(false);
        expect(result.reason).toBe('no_duplicate_detector');
      });

      it('should handle errors gracefully and continue with other channels', async () => {
        mockDiscordService.fetchChannel.mockImplementation(channelId => {
          if (channelId === 'youtube-channel-123') {
            throw new Error('Channel not found');
          }
          return Promise.resolve({ id: channelId, name: 'Test Channel' });
        });

        const result = await coordinator.initializeDiscordChannelScanning(mockDiscordService, mockConfig);

        expect(result.scanned).toBe(true);
        expect(result.results.youtube.errors).toContain('Failed to scan YouTube channel: Channel not found');
        expect(result.results.x.tweetIdsAdded).toBe(8); // 2*4 from X channels
      });
    });

    describe('checkDiscordForRecentAnnouncements', () => {
      beforeEach(() => {
        coordinator = new ContentCoordinator(
          mockContentStateManager,
          mockContentAnnouncer,
          mockDuplicateDetector,
          mockContentClassifier,
          mockDependencies.logger,
          mockConfig,
          mockDependencies.debugManager,
          mockDependencies.metricsManager
        );

        mockDuplicateDetector.hasVideoId = jest.fn().mockReturnValue(false);
        mockDuplicateDetector.hasTweetId = jest.fn().mockReturnValue(false);
        mockDuplicateDetector.isDuplicateByUrl = jest.fn().mockResolvedValue(false);
      });

      it('should detect YouTube video already announced', async () => {
        const contentData = {
          platform: 'YouTube',
          videoId: 'test-video-123',
          type: 'video',
          url: 'https://www.youtube.com/watch?v=test-video-123',
        };

        mockDuplicateDetector.hasVideoId.mockReturnValue(true);

        const result = await coordinator.checkDiscordForRecentAnnouncements(contentData);

        expect(result.found).toBe(true);
        expect(result.foundIn).toBe('youtube_duplicate_detector');
        expect(result.contentId).toBe('test-video-123');
        expect(mockDuplicateDetector.hasVideoId).toHaveBeenCalledWith('test-video-123');
      });

      it('should detect X/Twitter tweet already announced', async () => {
        const contentData = {
          platform: 'X',
          tweetId: 'test-tweet-456',
          type: 'post',
          url: 'https://twitter.com/user/status/test-tweet-456',
        };

        mockDuplicateDetector.hasTweetId.mockReturnValue(true);

        const result = await coordinator.checkDiscordForRecentAnnouncements(contentData);

        expect(result.found).toBe(true);
        expect(result.foundIn).toBe('x_duplicate_detector');
        expect(result.contentId).toBe('test-tweet-456');
        expect(mockDuplicateDetector.hasTweetId).toHaveBeenCalledWith('test-tweet-456');
      });

      it('should detect content by URL when specific ID not available', async () => {
        const contentData = {
          platform: 'YouTube',
          type: 'video',
          url: 'https://www.youtube.com/watch?v=test-video-789',
        };

        mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(true);

        const result = await coordinator.checkDiscordForRecentAnnouncements(contentData);

        expect(result.found).toBe(true);
        expect(result.foundIn).toBe('url_duplicate_detector');
        expect(result.url).toBe('https://www.youtube.com/watch?v=test-video-789');
        expect(mockDuplicateDetector.isDuplicateByUrl).toHaveBeenCalledWith(
          'https://www.youtube.com/watch?v=test-video-789'
        );
      });

      it('should return not found when content is not in duplicate detector', async () => {
        const contentData = {
          platform: 'YouTube',
          videoId: 'new-video-123',
          type: 'video',
          url: 'https://www.youtube.com/watch?v=new-video-123',
        };

        const result = await coordinator.checkDiscordForRecentAnnouncements(contentData);

        expect(result.found).toBe(false);
        expect(mockDuplicateDetector.hasVideoId).toHaveBeenCalledWith('new-video-123');
        expect(mockDuplicateDetector.isDuplicateByUrl).toHaveBeenCalledWith(
          'https://www.youtube.com/watch?v=new-video-123'
        );
      });

      it('should skip check when no duplicate detector is available', async () => {
        coordinator.duplicateDetector = null;

        const contentData = {
          platform: 'YouTube',
          videoId: 'test-video-123',
          type: 'video',
        };

        const result = await coordinator.checkDiscordForRecentAnnouncements(contentData);

        expect(result.found).toBe(false);
        expect(result.reason).toBe('no_duplicate_detector');
      });

      it('should handle errors gracefully and allow announcement to proceed', async () => {
        const contentData = {
          platform: 'YouTube',
          videoId: 'test-video-123',
          type: 'video',
        };

        mockDuplicateDetector.hasVideoId.mockImplementation(() => {
          throw new Error('Database connection failed');
        });

        const result = await coordinator.checkDiscordForRecentAnnouncements(contentData);

        expect(result.found).toBe(false);
        expect(result.error).toBe('Database connection failed');
      });
    });

    describe('Race Condition Prevention Integration', () => {
      beforeEach(() => {
        coordinator = new ContentCoordinator(
          mockContentStateManager,
          mockContentAnnouncer,
          mockDuplicateDetector,
          mockContentClassifier,
          mockDependencies.logger,
          mockConfig,
          mockDependencies.debugManager,
          mockDependencies.metricsManager
        );

        // Set up base mocks for processing
        mockContentStateManager.getContentState.mockReturnValue(null);
        mockContentStateManager.isNewContent.mockReturnValue(true);
        mockContentStateManager.addContent.mockResolvedValue();
        mockDuplicateDetector.isDuplicateWithFingerprint.mockResolvedValue(false);
        mockDuplicateDetector.markAsSeenWithFingerprint.mockResolvedValue();
      });

      it('should prevent announcement when content found in Discord channels', async () => {
        const contentId = 'test-video-123';
        const source = 'webhook';
        const contentData = {
          platform: 'YouTube',
          videoId: 'test-video-123',
          type: 'video',
          title: 'Test Video',
          url: 'https://www.youtube.com/watch?v=test-video-123',
          publishedAt: new Date().toISOString(),
        };

        // Mock that content is found in Discord channels
        mockDuplicateDetector.hasVideoId = jest.fn().mockReturnValue(true);
        coordinator.checkDiscordForRecentAnnouncements = jest.fn().mockResolvedValue({
          found: true,
          foundIn: 'youtube_duplicate_detector',
          contentId: 'test-video-123',
        });

        const result = await coordinator.processContent(contentId, source, contentData);

        expect(result.action).toBe('skip');
        expect(result.reason).toBe('recent_discord_announcement');
        expect(result.foundIn).toBe('youtube_duplicate_detector');
        expect(mockContentAnnouncer.announceContent).not.toHaveBeenCalled();
        expect(mockDuplicateDetector.markAsSeenWithFingerprint).toHaveBeenCalled();
      });

      it('should proceed with announcement when content not found in Discord channels', async () => {
        const contentId = 'new-video-456';
        const source = 'webhook';
        const contentData = {
          platform: 'YouTube',
          videoId: 'new-video-456',
          type: 'video',
          title: 'New Test Video',
          url: 'https://www.youtube.com/watch?v=new-video-456',
          publishedAt: new Date().toISOString(),
        };

        // Mock that content is NOT found in Discord channels
        coordinator.checkDiscordForRecentAnnouncements = jest.fn().mockResolvedValue({
          found: false,
        });

        mockContentAnnouncer.announceContent.mockResolvedValue({
          success: true,
          channelId: 'youtube-channel-123',
          messageId: 'message-456',
        });
        mockContentStateManager.markAsAnnounced.mockResolvedValue();

        const result = await coordinator.processContent(contentId, source, contentData);

        expect(result.action).toBe('announced');
        expect(coordinator.checkDiscordForRecentAnnouncements).toHaveBeenCalledWith(contentData);
        expect(mockContentAnnouncer.announceContent).toHaveBeenCalled();
        expect(mockContentStateManager.markAsAnnounced).toHaveBeenCalledWith(contentId);
      });
    });
  });
});
