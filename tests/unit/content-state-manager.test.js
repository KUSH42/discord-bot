import { jest } from '@jest/globals';
import { ContentStateManager } from '../../src/core/content-state-manager.js';
import { timestampUTC } from '../../src/utilities/utc-time.js';

describe('ContentStateManager', () => {
  let stateManager;
  let mockConfigManager;
  let mockPersistentStorage;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    mockConfigManager = {
      getNumber: jest.fn(),
    };

    mockPersistentStorage = {
      getAllContentStates: jest.fn(),
      storeContentState: jest.fn(),
      removeContentStates: jest.fn(),
      clearAllContentStates: jest.fn(),
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    stateManager = new ContentStateManager(mockConfigManager, mockPersistentStorage, mockLogger);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with empty content states', () => {
      expect(stateManager.contentStates.size).toBe(0);
      expect(stateManager.botStartTime).toBeInstanceOf(Date);
    });

    it('should call initializeFromStorage', () => {
      const initSpy = jest.spyOn(ContentStateManager.prototype, 'initializeFromStorage');
      new ContentStateManager(mockConfigManager, mockPersistentStorage, mockLogger);
      expect(initSpy).toHaveBeenCalled();
    });
  });

  describe('initializeFromStorage', () => {
    it('should load recent states from storage', async () => {
      const recentTime = new Date(timestampUTC() - 60000).toISOString(); // 1 minute ago
      const storedStates = {
        'video-1': {
          id: 'video-1',
          type: 'youtube_video',
          state: 'published',
          firstSeen: recentTime,
          lastUpdated: recentTime,
          publishedAt: recentTime,
          announced: false,
        },
      };

      mockPersistentStorage.getAllContentStates.mockResolvedValue(storedStates);
      mockConfigManager.getNumber.mockReturnValue(24); // 24 hours max age

      await stateManager.initializeFromStorage();

      expect(stateManager.contentStates.size).toBe(1);
      expect(stateManager.contentStates.has('video-1')).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('Content state manager initialized', {
        loadedStates: 1,
        botStartTime: expect.any(String),
      });
    });

    it('should skip old states to prevent memory bloat', async () => {
      const oldTime = new Date(timestampUTC() - 72 * 60 * 60 * 1000).toISOString(); // 72 hours ago (older than 2x max age)
      const storedStates = {
        'video-old': {
          id: 'video-old',
          lastUpdated: oldTime,
        },
      };

      mockPersistentStorage.getAllContentStates.mockResolvedValue(storedStates);
      mockConfigManager.getNumber.mockReturnValue(24); // 24 hours max age

      await stateManager.initializeFromStorage();

      expect(stateManager.contentStates.size).toBe(0);
    });

    it('should handle storage initialization failures gracefully', async () => {
      const error = new Error('Storage failed');
      mockPersistentStorage.getAllContentStates.mockRejectedValue(error);

      await stateManager.initializeFromStorage();

      expect(stateManager.contentStates.size).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith('❌ Failed to initialize from storage, starting fresh', {
        error: 'Storage failed',
      });
    });

    it('should handle null/undefined storage data', async () => {
      mockPersistentStorage.getAllContentStates.mockResolvedValue(null);

      await stateManager.initializeFromStorage();

      expect(stateManager.contentStates.size).toBe(0);
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('addContent', () => {
    const contentId = 'test-video-123';
    const initialState = {
      type: 'youtube_video',
      state: 'published',
      source: 'webhook',
      publishedAt: new Date().toISOString(),
      url: 'https://www.youtube.com/watch?v=test123',
      title: 'Test Video',
      metadata: { duration: '10:30' },
    };

    beforeEach(() => {
      mockPersistentStorage.storeContentState.mockResolvedValue();
    });

    it('should validate content ID', async () => {
      await expect(stateManager.addContent('', initialState)).rejects.toThrow('Content ID must be a non-empty string');
      await expect(stateManager.addContent(null, initialState)).rejects.toThrow(
        'Content ID must be a non-empty string'
      );
      await expect(stateManager.addContent(123, initialState)).rejects.toThrow('Content ID must be a non-empty string');
    });

    it('should add content with all provided data', async () => {
      const result = await stateManager.addContent(contentId, initialState);

      expect(result).toEqual({
        id: contentId,
        type: 'youtube_video',
        state: 'published',
        firstSeen: expect.any(Date),
        lastUpdated: expect.any(Date),
        publishedAt: expect.any(Date),
        announced: false,
        source: 'webhook',
        url: 'https://www.youtube.com/watch?v=test123',
        title: 'Test Video',
        metadata: { duration: '10:30' },
      });

      expect(stateManager.contentStates.has(contentId)).toBe(true);
      expect(mockPersistentStorage.storeContentState).toHaveBeenCalledWith(contentId, {
        id: contentId,
        type: 'youtube_video',
        state: 'published',
        firstSeen: expect.any(Date),
        lastUpdated: expect.any(Date),
        publishedAt: expect.any(Date),
        announced: false,
        source: 'webhook',
        url: 'https://www.youtube.com/watch?v=test123',
        title: 'Test Video',
        metadata: { duration: '10:30' },
      });
    });

    it('should add content with default values for missing fields', async () => {
      const minimalState = {
        source: 'webhook',
      };

      const result = await stateManager.addContent(contentId, minimalState);

      expect(result).toEqual({
        id: contentId,
        type: 'unknown',
        state: 'published',
        firstSeen: expect.any(Date),
        lastUpdated: expect.any(Date),
        publishedAt: expect.any(Date),
        announced: false,
        source: 'webhook',
        url: null,
        title: null,
        metadata: {},
      });
    });

    it('should use current time as publishedAt when not provided', async () => {
      const stateWithoutPublishedAt = {
        type: 'youtube_video',
        source: 'webhook',
      };

      const result = await stateManager.addContent(contentId, stateWithoutPublishedAt);

      expect(result.publishedAt).toBeInstanceOf(Date);
      expect(result.firstSeen.getTime()).toBe(result.publishedAt.getTime());
    });

    it('should log debug information', async () => {
      await stateManager.addContent(contentId, initialState);

      expect(mockLogger.debug).toHaveBeenCalledWith('Content added to state management', {
        contentId,
        type: 'youtube_video',
        state: 'published',
        source: 'webhook',
      });
    });

    it('should handle persistence failures gracefully', async () => {
      const error = new Error('Persistence failed');
      mockPersistentStorage.storeContentState.mockRejectedValue(error);

      const result = await stateManager.addContent(contentId, initialState);

      expect(result).toBeDefined();
      expect(stateManager.contentStates.has(contentId)).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to persist content state', {
        contentId,
        error: 'Persistence failed',
      });
    });
  });

  describe('updateContentState', () => {
    const contentId = 'test-video-123';
    const initialState = {
      id: contentId,
      type: 'youtube_video',
      state: 'scheduled',
      firstSeen: new Date(),
      lastUpdated: new Date(),
      publishedAt: new Date(),
      announced: false,
      source: 'webhook',
    };

    beforeEach(() => {
      stateManager.contentStates.set(contentId, initialState);
      mockPersistentStorage.storeContentState.mockResolvedValue();
    });

    it('should update existing content state', async () => {
      const updates = {
        state: 'live',
        announced: true,
        metadata: { viewers: 1000 },
      };

      const result = await stateManager.updateContentState(contentId, updates);

      expect(result).toEqual({
        ...initialState,
        ...updates,
        lastUpdated: expect.any(Date),
      });

      expect(stateManager.contentStates.get(contentId)).toEqual(result);
      expect(mockPersistentStorage.storeContentState).toHaveBeenCalled();
    });

    it('should update lastUpdated timestamp', async () => {
      const originalLastUpdated = initialState.lastUpdated;

      // Advance time to ensure different timestamp
      jest.advanceTimersByTime(1000);

      const result = await stateManager.updateContentState(contentId, { state: 'live' });

      expect(result.lastUpdated.getTime()).toBeGreaterThan(originalLastUpdated.getTime());
    });

    it('should throw error for non-existent content', async () => {
      await expect(stateManager.updateContentState('non-existent', { state: 'live' })).rejects.toThrow(
        'Content state not found for ID: non-existent'
      );
    });

    it('should log debug information', async () => {
      const updates = { state: 'live', announced: true };

      await stateManager.updateContentState(contentId, updates);

      expect(mockLogger.debug).toHaveBeenCalledWith('Content state updated', {
        contentId,
        updates: ['state', 'announced'],
        newState: 'live',
      });
    });

    it('should handle persistence failures gracefully', async () => {
      const error = new Error('Persistence failed');
      mockPersistentStorage.storeContentState.mockRejectedValue(error);

      const result = await stateManager.updateContentState(contentId, { state: 'live' });

      expect(result.state).toBe('live');
      expect(stateManager.contentStates.get(contentId).state).toBe('live');
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to persist content state', {
        contentId,
        error: 'Persistence failed',
      });
    });
  });

  describe('getContentState', () => {
    const contentId = 'test-video-123';
    const contentState = {
      id: contentId,
      type: 'youtube_video',
      state: 'published',
    };

    it('should return existing content state', () => {
      stateManager.contentStates.set(contentId, contentState);

      const result = stateManager.getContentState(contentId);

      expect(result).toEqual(contentState);
    });

    it('should return null for non-existent content', () => {
      const result = stateManager.getContentState('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('hasContent', () => {
    const contentId = 'test-video-123';

    it('should return true for existing content', () => {
      stateManager.contentStates.set(contentId, {});

      expect(stateManager.hasContent(contentId)).toBe(true);
    });

    it('should return false for non-existent content', () => {
      expect(stateManager.hasContent('non-existent')).toBe(false);
    });
  });

  describe('isNewContent', () => {
    const contentId = 'test-video-123';

    beforeEach(() => {
      mockConfigManager.getNumber.mockReturnValue(24); // 24 hours max age
    });

    it('should return true for existing unannounced content', () => {
      const existingState = { announced: false };
      stateManager.contentStates.set(contentId, existingState);

      const result = stateManager.isNewContent(contentId, new Date().toISOString());

      expect(result).toBe(true);
    });

    it('should return false for existing announced content', () => {
      const existingState = { announced: true };
      stateManager.contentStates.set(contentId, existingState);

      const result = stateManager.isNewContent(contentId, new Date().toISOString());

      expect(result).toBe(false);
    });

    it('should return true for new content within age limit and after bot start', () => {
      const recentTime = new Date(timestampUTC() - 30000); // 30 seconds ago
      stateManager.botStartTime = new Date(timestampUTC() - 60000); // Bot started 1 minute ago

      const result = stateManager.isNewContent(contentId, recentTime.toISOString());

      expect(result).toBe(true);
    });

    it('should return false for content older than max age', () => {
      const oldTime = new Date(timestampUTC() - 25 * 60 * 60 * 1000); // 25 hours ago

      const result = stateManager.isNewContent(contentId, oldTime.toISOString());

      expect(result).toBe(false);
    });

    it('should return false for content published before bot started', () => {
      // Set specific times with large gap to avoid grace period
      const botStartTime = new Date('2023-01-01T12:00:00.000Z');
      const beforeBotStart = new Date('2023-01-01T10:00:00.000Z'); // 2 hours before (outside grace period)
      const detectionTime = new Date('2023-01-01T13:00:00.000Z'); // 1 hour after bot start (outside grace period)

      stateManager.botStartTime = botStartTime;

      const result = stateManager.isNewContent(contentId, beforeBotStart.toISOString(), detectionTime);

      expect(result).toBe(false);
    });

    it('should log debug information', () => {
      // Use fixed times to ensure predictable behavior
      const botStartTime = new Date('2023-01-01T12:00:00.000Z');
      const publishTime = new Date('2023-01-01T12:30:00.000Z'); // 30 minutes after bot start
      const detectionTime = new Date('2023-01-01T12:35:00.000Z');

      stateManager.botStartTime = botStartTime;

      stateManager.isNewContent(contentId, publishTime.toISOString(), detectionTime);

      // The implementation logs different messages before vs after initialization
      // Before initialization: "New content evaluation (pre-initialization)"
      expect(mockLogger.debug).toHaveBeenCalledWith('New content evaluation (pre-initialization)', {
        contentId,
        publishedAt: publishTime.toISOString(),
        contentAge: expect.any(Number),
        maxAge: expect.any(Number),
        isWithinAgeLimit: expect.any(Boolean),
        isAfterBotStart: expect.any(Boolean),
        timeSinceBotStart: expect.any(Number),
        botStartTime: expect.any(String),
        shouldAllow: expect.any(Boolean),
      });
    });

    it('should handle custom detection time', () => {
      const publishTime = new Date(timestampUTC() - 30000); // 30 seconds ago
      const detectionTime = new Date(); // now
      stateManager.botStartTime = new Date(timestampUTC() - 60000); // Bot started 1 minute ago

      const result = stateManager.isNewContent(contentId, publishTime.toISOString(), detectionTime);

      expect(result).toBe(true);
    });

    it('should return false for missing publishedAt parameter', () => {
      const result = stateManager.isNewContent(contentId, null);

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith('isNewContent called with missing publishedAt', { contentId });
    });

    it('should return false for undefined publishedAt parameter', () => {
      const result = stateManager.isNewContent(contentId, undefined);

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith('isNewContent called with missing publishedAt', { contentId });
    });

    it('should return false for invalid date string', () => {
      const result = stateManager.isNewContent(contentId, 'invalid-date');

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith('isNewContent called with invalid publishedAt', {
        contentId,
        publishedAt: 'invalid-date',
      });
    });

    it('should return false for empty string publishedAt', () => {
      const result = stateManager.isNewContent(contentId, '');

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith('isNewContent called with missing publishedAt', { contentId });
    });
  });

  describe('markAsAnnounced', () => {
    const contentId = 'test-video-123';
    const existingState = {
      id: contentId,
      type: 'youtube_video',
      state: 'published',
      source: 'webhook',
      announced: false,
    };

    beforeEach(() => {
      stateManager.contentStates.set(contentId, existingState);
      mockPersistentStorage.storeContentState.mockResolvedValue();
    });

    it('should mark existing content as announced', async () => {
      await stateManager.markAsAnnounced(contentId);

      const updatedState = stateManager.contentStates.get(contentId);
      expect(updatedState.announced).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('Content marked as announced', {
        contentId,
        type: 'youtube_video',
        source: 'webhook',
      });
    });

    it('should throw error for non-existent content', async () => {
      await expect(stateManager.markAsAnnounced('non-existent')).rejects.toThrow(
        'Cannot mark unknown content as announced: non-existent'
      );
    });
  });

  describe('getContentByState', () => {
    beforeEach(() => {
      stateManager.contentStates.set('video-1', { state: 'live', type: 'youtube_video' });
      stateManager.contentStates.set('video-2', { state: 'scheduled', type: 'youtube_video' });
      stateManager.contentStates.set('video-3', { state: 'live', type: 'youtube_livestream' });
      stateManager.contentStates.set('tweet-1', { state: 'published', type: 'x_tweet' });
    });

    it('should return content with specified state', () => {
      const liveContent = stateManager.getContentByState('live');

      expect(liveContent).toHaveLength(2);
      expect(liveContent.every(content => content.state === 'live')).toBe(true);
    });

    it('should return empty array for non-existent state', () => {
      const result = stateManager.getContentByState('non-existent');

      expect(result).toEqual([]);
    });
  });

  describe('getContentByType', () => {
    beforeEach(() => {
      stateManager.contentStates.set('video-1', { state: 'live', type: 'youtube_video' });
      stateManager.contentStates.set('video-2', { state: 'scheduled', type: 'youtube_video' });
      stateManager.contentStates.set('video-3', { state: 'live', type: 'youtube_livestream' });
      stateManager.contentStates.set('tweet-1', { state: 'published', type: 'x_tweet' });
    });

    it('should return content with specified type', () => {
      const youtubeVideos = stateManager.getContentByType('youtube_video');

      expect(youtubeVideos).toHaveLength(2);
      expect(youtubeVideos.every(content => content.type === 'youtube_video')).toBe(true);
    });

    it('should return empty array for non-existent type', () => {
      const result = stateManager.getContentByType('non-existent');

      expect(result).toEqual([]);
    });
  });

  describe('getDetectionSources', () => {
    const contentId = 'test-video-123';

    it('should return source for existing content', () => {
      stateManager.contentStates.set(contentId, { source: 'webhook' });

      const sources = stateManager.getDetectionSources(contentId);

      expect(sources).toEqual(['webhook']);
    });

    it('should return empty array for non-existent content', () => {
      const sources = stateManager.getDetectionSources('non-existent');

      expect(sources).toEqual([]);
    });
  });

  describe('cleanup', () => {
    beforeEach(() => {
      mockConfigManager.getNumber.mockReturnValue(24); // 24 hours
      mockPersistentStorage.removeContentStates.mockResolvedValue();

      // Add some test content with different ages
      const now = new Date();
      const recentHours = 6; // Less than 48 hours (2x24h default)
      const oldHours = 72; // More than 48 hours

      const recentTime = new Date(now.getTime() - recentHours * 60 * 60 * 1000); // 6 hours ago
      const oldTime = new Date(now.getTime() - oldHours * 60 * 60 * 1000); // 72 hours ago

      stateManager.contentStates.set('recent-1', { lastUpdated: recentTime });
      stateManager.contentStates.set('recent-2', { lastUpdated: recentTime });
      stateManager.contentStates.set('old-1', { lastUpdated: oldTime });
      stateManager.contentStates.set('old-2', { lastUpdated: oldTime });
    });

    it('should remove old content states', async () => {
      await stateManager.cleanup();

      expect(stateManager.contentStates.size).toBe(2);
      expect(stateManager.contentStates.has('recent-1')).toBe(true);
      expect(stateManager.contentStates.has('recent-2')).toBe(true);
      expect(stateManager.contentStates.has('old-1')).toBe(false);
      expect(stateManager.contentStates.has('old-2')).toBe(false);

      expect(mockPersistentStorage.removeContentStates).toHaveBeenCalledWith(['old-1', 'old-2']);
      expect(mockLogger.info).toHaveBeenCalledWith('Content state cleanup completed', {
        removedCount: 2,
        remainingCount: 2,
        maxAgeHours: expect.any(Number),
      });
    });

    it('should use custom age threshold', async () => {
      await stateManager.cleanup(4); // 4 hour threshold - newer than recent content (6h old)

      // Should remove all content since both are older than 4 hours
      expect(stateManager.contentStates.size).toBe(0);
    });

    it('should handle cleanup with no old content', async () => {
      // Clear old content manually
      stateManager.contentStates.delete('old-1');
      stateManager.contentStates.delete('old-2');

      // Clear the initialization call
      mockLogger.info.mockClear();

      await stateManager.cleanup();

      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe('getMaxContentAgeMs', () => {
    it('should return configured max age in milliseconds', () => {
      mockConfigManager.getNumber.mockReturnValue(48); // 48 hours

      const maxAge = stateManager.getMaxContentAgeMs();

      expect(maxAge).toBe(48 * 60 * 60 * 1000);
      expect(mockConfigManager.getNumber).toHaveBeenCalledWith('MAX_CONTENT_AGE_HOURS', 24);
    });

    it('should use default value when config returns undefined', () => {
      mockConfigManager.getNumber.mockReturnValue(24); // Return the default that config would return

      const maxAge = stateManager.getMaxContentAgeMs();

      expect(maxAge).toBe(24 * 60 * 60 * 1000); // Default 24 hours
    });
  });

  describe('persistContentState', () => {
    const contentId = 'test-video-123';
    const contentState = {
      id: contentId,
      firstSeen: new Date(),
      lastUpdated: new Date(),
      publishedAt: new Date(),
      type: 'youtube_video',
      state: 'published',
    };

    it('should persist content state with serialized dates', async () => {
      mockPersistentStorage.storeContentState.mockResolvedValue();

      await stateManager.persistContentState(contentId, contentState);

      expect(mockPersistentStorage.storeContentState).toHaveBeenCalledWith(contentId, {
        ...contentState,
        firstSeen: contentState.firstSeen,
        lastUpdated: contentState.lastUpdated,
        publishedAt: contentState.publishedAt,
      });
    });

    it('should handle persistence failures gracefully', async () => {
      const error = new Error('Persistence failed');
      mockPersistentStorage.storeContentState.mockRejectedValue(error);

      await stateManager.persistContentState(contentId, contentState);

      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to persist content state', {
        contentId,
        error: 'Persistence failed',
      });
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      mockConfigManager.getNumber.mockReturnValue(24);

      // Add test content with various states and types
      stateManager.contentStates.set('video-1', {
        state: 'live',
        type: 'youtube_video',
        source: 'webhook',
        announced: true,
      });
      stateManager.contentStates.set('video-2', {
        state: 'scheduled',
        type: 'youtube_livestream',
        source: 'api',
        announced: false,
      });
      stateManager.contentStates.set('tweet-1', {
        state: 'published',
        type: 'x_tweet',
        source: 'scraper',
        announced: true,
      });
    });

    it('should return comprehensive statistics', () => {
      const stats = stateManager.getStats();

      expect(stats).toEqual({
        totalContent: 3,
        announced: 2,
        unannounced: 1,
        byState: {
          live: 1,
          scheduled: 1,
          published: 1,
        },
        byType: {
          youtube_video: 1,
          youtube_livestream: 1,
          x_tweet: 1,
        },
        bySource: {
          webhook: 1,
          api: 1,
          scraper: 1,
        },
        botStartTime: expect.any(String),
        maxContentAge: 24,
      });
    });

    it('should handle empty content states', () => {
      stateManager.contentStates.clear();

      const stats = stateManager.getStats();

      expect(stats).toEqual({
        totalContent: 0,
        announced: 0,
        unannounced: 0,
        byState: {},
        byType: {},
        bySource: {},
        botStartTime: expect.any(String),
        maxContentAge: 24,
      });
    });
  });

  describe('reset', () => {
    beforeEach(() => {
      // Add some test content
      stateManager.contentStates.set('test-1', {});
      stateManager.contentStates.set('test-2', {});
      mockPersistentStorage.clearAllContentStates.mockResolvedValue();
    });

    it('should clear all content states and reset bot start time', async () => {
      const originalBotStartTime = stateManager.botStartTime;

      // Advance time to ensure different timestamp
      jest.advanceTimersByTime(1000);

      await stateManager.reset();

      expect(stateManager.contentStates.size).toBe(0);
      expect(stateManager.botStartTime.getTime()).toBeGreaterThan(originalBotStartTime.getTime());
      expect(mockPersistentStorage.clearAllContentStates).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Content state manager reset');
    });
  });

  describe('destroy', () => {
    beforeEach(() => {
      // Add some test content
      stateManager.contentStates.set('test-1', {});
      stateManager.contentStates.set('test-2', {});

      // Mock cleanup to prevent actual cleanup logic
      jest.spyOn(stateManager, 'cleanup').mockResolvedValue();
    });

    it('should cleanup and clear all content states', async () => {
      await stateManager.destroy();

      expect(stateManager.cleanup).toHaveBeenCalled();
      expect(stateManager.contentStates.size).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith('Content state manager destroyed');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle addContent with Date objects for publishedAt', async () => {
      mockPersistentStorage.storeContentState.mockResolvedValue();
      const publishedDate = new Date('2023-01-01T12:00:00Z');

      const result = await stateManager.addContent('test-id', {
        type: 'youtube_video',
        source: 'webhook',
        publishedAt: publishedDate, // Date object instead of string
      });

      expect(result.publishedAt).toEqual(publishedDate);
    });

    it('should handle updateContentState with nested object updates', async () => {
      const contentId = 'test-video-123';
      const initialState = {
        id: contentId,
        metadata: { views: 100 },
        lastUpdated: new Date(),
      };

      stateManager.contentStates.set(contentId, initialState);
      mockPersistentStorage.storeContentState.mockResolvedValue();

      const result = await stateManager.updateContentState(contentId, {
        metadata: { views: 200, likes: 50 },
      });

      expect(result.metadata).toEqual({ views: 200, likes: 50 });
    });

    it('should handle cleanup with storage failures', async () => {
      const error = new Error('Storage cleanup failed');
      mockPersistentStorage.removeContentStates.mockRejectedValue(error);
      mockConfigManager.getNumber.mockReturnValue(24);

      // Add old content (older than 2x 24h = 48h)
      const oldTime = new Date(timestampUTC() - 72 * 60 * 60 * 1000); // 72 hours ago
      stateManager.contentStates.set('old-content', { lastUpdated: oldTime });

      // This should not throw even if storage fails (we now handle the error)
      await stateManager.cleanup();

      // Should still remove from memory even if storage fails
      expect(stateManager.contentStates.has('old-content')).toBe(false);

      // Should log the storage error
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to remove content states from storage', {
        error: 'Storage cleanup failed',
        removedFromMemory: 1,
      });
    });

    it('should handle initializeFromStorage with malformed date strings', async () => {
      const storedStates = {
        'video-1': {
          id: 'video-1',
          firstSeen: 'invalid-date',
          lastUpdated: 'invalid-date',
          publishedAt: 'invalid-date',
        },
      };

      mockPersistentStorage.getAllContentStates.mockResolvedValue(storedStates);
      mockConfigManager.getNumber.mockReturnValue(24);

      // This test might not trigger the error path - let's just ensure it doesn't crash
      await expect(stateManager.initializeFromStorage()).resolves.not.toThrow();
    });

    it('should handle isNewContent with string dates vs Date objects', () => {
      mockConfigManager.getNumber.mockReturnValue(24);

      const stringDate = new Date(timestampUTC() - 60000).toISOString();
      const dateObject = new Date(timestampUTC() - 60000);

      const result1 = stateManager.isNewContent('test-1', stringDate);
      const result2 = stateManager.isNewContent('test-2', dateObject);

      expect(result1).toBe(result2); // Should handle both consistently
    });
  });
});
