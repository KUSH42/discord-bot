import { jest } from '@jest/globals';
import { ContentCoordinator } from '../../src/core/content-coordinator.js';
import { timestampUTC } from '../../src/utilities/utc-time.js';

describe('ContentCoordinator', () => {
  let coordinator;
  let mockContentStateManager;
  let mockContentAnnouncer;
  let mockDuplicateDetector;
  let mockLogger;
  let mockConfig;

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

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockConfig = {
      get: jest.fn().mockReturnValue(['webhook', 'api', 'scraper']),
      getNumber: jest.fn().mockReturnValue(30000),
    };

    coordinator = new ContentCoordinator(
      mockContentStateManager,
      mockContentAnnouncer,
      mockDuplicateDetector,
      mockLogger,
      mockConfig
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
        mockLogger
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

      expect(mockLogger.warn).toHaveBeenCalledWith('Unknown content source', {
        contentId,
        source: 'unknown_source',
        validSources: coordinator.sourcePriority,
      });
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
      expect(mockLogger.warn).toHaveBeenCalledWith('Processing lock timeout, removing from queue', {
        contentId,
        source,
        timeoutMs: 100,
      });

      await slowPromise;
    });

    it('should handle processing failures and increment error metrics', async () => {
      const error = new Error('Processing failed');
      mockContentAnnouncer.announceContent.mockRejectedValue(error);

      await expect(coordinator.processContent(contentId, source, contentData)).rejects.toThrow('Processing failed');

      expect(coordinator.metrics.processingErrors).toBe(1);
      expect(mockLogger.error).toHaveBeenCalledWith('Content processing failed', {
        contentId,
        source,
        error: 'Processing failed',
        stack: expect.any(String),
        processingTimeMs: expect.any(Number),
      });
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
        processingTimeMs: expect.any(Number),
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

      expect(mockLogger.warn).toHaveBeenCalledWith('Duplicate detection failed, assuming not duplicate', {
        url: contentData.url,
        error: 'Duplicate detection failed',
      });
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

      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to mark content as seen', {
        url: contentData.url,
        error: 'Mark as seen failed',
      });
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
        expect(mockLogger.info).toHaveBeenCalledWith('Source priority updated', {
          oldPriority: ['webhook', 'api', 'scraper'],
          newPriority,
        });
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

        expect(mockLogger.info).toHaveBeenCalledWith('Content coordinator metrics reset');
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
        expect(mockLogger.warn).toHaveBeenCalledWith('Force clearing processing queue', {
          reason: 'test_reason',
          clearedCount: 2,
          activeContentIds: ['test-1', 'test-2'],
        });
      });

      it('should handle empty queue gracefully', () => {
        const clearedCount = coordinator.forceClearQueue();

        expect(clearedCount).toBe(0);
        expect(mockLogger.warn).not.toHaveBeenCalled();
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
        expect(mockLogger.warn).toHaveBeenCalledWith('Destroying coordinator with active processing', {
          activeCount: 2,
          activeContentIds: ['test-1', 'test-2'],
        });
        expect(mockLogger.info).toHaveBeenCalledWith('Content coordinator destroyed', {
          finalMetrics: expect.objectContaining({
            totalProcessed: 5,
            activeProcessing: 0,
          }),
        });
      });

      it('should handle destroy with empty queue gracefully', async () => {
        await coordinator.destroy();

        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith('Content coordinator destroyed', {
          finalMetrics: expect.any(Object),
        });
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

      expect(mockLogger.debug).toHaveBeenCalledWith('Original processing failed, allowing retry', {
        contentId,
        source,
        error: 'Processing failed',
      });
      expect(result.action).toBe('announced');
    });
  });
});
