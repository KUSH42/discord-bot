import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MonitorApplication } from '../../src/application/monitor-application.js';

describe('MonitorApplication - Video Processing', () => {
  let monitorApp;
  let mockYoutubeService;
  let mockHttpService;
  let mockContentClassifier;
  let mockContentAnnouncer;
  let mockConfig;
  let mockStateManager;
  let mockEventBus;
  let mockLogger;
  let mockContentStateManager;
  let mockLivestreamStateMachine;
  let mockContentCoordinator;
  let mockPersistentStorage;
  let mockDuplicateDetector;
  let mockOperation;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDuplicateDetector = {
      isDuplicate: jest.fn(),
      markAsSeen: jest.fn(),
      getStats: jest.fn().mockReturnValue({ seenCount: 0 }),
    };

    mockYoutubeService = {
      getChannelDetails: jest.fn(),
      getVideoDetails: jest.fn(),
      getChannelVideos: jest.fn(),
      getScheduledContent: jest.fn(),
      checkScheduledContentStates: jest.fn(),
    };

    mockHttpService = {
      post: jest.fn(),
      isSuccessResponse: jest.fn().mockReturnValue(true),
    };

    mockContentClassifier = {
      classifyYouTubeContent: jest.fn(),
    };

    mockContentAnnouncer = {
      announceContent: jest.fn(),
    };

    mockConfig = {
      getRequired: jest.fn(),
      get: jest.fn(),
      getNumber: jest.fn(),
      getBoolean: jest.fn().mockReturnValue(false),
    };

    // Setup default config values
    mockConfig.getRequired.mockImplementation(key => {
      const values = {
        YOUTUBE_CHANNEL_ID: 'UCTestChannel',
        YOUTUBE_API_KEY: 'test-api-key',
        PSH_CALLBACK_URL: 'https://example.com/webhook',
      };
      return values[key] || 'default-value';
    });

    mockConfig.get.mockImplementation(key => {
      const values = {
        PSH_SECRET: 'test-secret',
        PSH_VERIFY_TOKEN: 'verify-token',
        SCHEDULED_CONTENT_POLL_INTERVAL_MS: 600000,
        LIVE_STATE_POLL_INTERVAL_MS: 60000,
      };
      return values[key] || 'default-value';
    });

    mockStateManager = {
      get: jest.fn(),
    };

    mockEventBus = {
      emit: jest.fn(),
    };

    // Create mock operation object that mimics enhanced logger behavior
    mockOperation = {
      progress: jest.fn(),
      success: jest.fn((message, data) => {
        // Mock the enhanced logger's behavior of calling the base logger
        mockLogger.info(message, data);
        return data;
      }),
      error: jest.fn((error, message, context) => {
        mockLogger.error(message, context);
        throw error;
      }),
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
      startOperation: jest.fn(() => mockOperation),
      forOperation: jest.fn().mockReturnThis(),
    };

    mockContentStateManager = {
      hasContent: jest.fn(),
      addContent: jest.fn(),
      getContentByState: jest.fn(),
      getContentState: jest.fn(),
    };

    mockLivestreamStateMachine = {
      transitionState: jest.fn(),
    };

    mockContentCoordinator = {
      processContent: jest.fn().mockResolvedValue({
        action: 'announced',
        announcementResult: { success: true },
      }),
    };

    mockPersistentStorage = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    };

    const dependencies = {
      youtubeService: mockYoutubeService,
      httpService: mockHttpService,
      contentClassifier: mockContentClassifier,
      contentAnnouncer: mockContentAnnouncer,
      config: mockConfig,
      stateManager: mockStateManager,
      eventBus: mockEventBus,
      logger: mockLogger,
      contentStateManager: mockContentStateManager,
      livestreamStateMachine: mockLivestreamStateMachine,
      contentCoordinator: mockContentCoordinator,
      persistentStorage: mockPersistentStorage,
      duplicateDetector: mockDuplicateDetector,
    };

    monitorApp = new MonitorApplication(dependencies);
  });

  describe('processVideo method', () => {
    const mockVideo = {
      id: 'test123',
      snippet: {
        title: 'Test Video',
        channelTitle: 'Test Channel',
        publishedAt: '2023-01-01T00:00:00Z',
      },
    };

    beforeEach(() => {
      mockDuplicateDetector.isDuplicate.mockResolvedValue(false);
      jest.spyOn(monitorApp, 'isNewContent').mockReturnValue(true);
      mockContentClassifier.classifyYouTubeContent.mockReturnValue({
        type: 'video',
        details: { duration: '10:30' },
      });
    });

    it('should process video successfully and announce', async () => {
      // ContentCoordinator should be called with processed content
      mockContentCoordinator.processContent.mockResolvedValue({
        action: 'announced',
        announcementResult: { success: true, messageId: 'msg123' },
      });

      await monitorApp.processVideo(mockVideo, 'webhook');

      expect(monitorApp.stats.videosProcessed).toBe(1);
      expect(mockDuplicateDetector.isDuplicate).toHaveBeenCalledWith('https://www.youtube.com/watch?v=test123');
      expect(monitorApp.isNewContent).toHaveBeenCalledWith(mockVideo);
      expect(mockContentClassifier.classifyYouTubeContent).toHaveBeenCalledWith(mockVideo);

      // Verify ContentCoordinator was called with the content
      expect(mockContentCoordinator.processContent).toHaveBeenCalledWith(
        'test123',
        'webhook',
        expect.objectContaining({
          platform: 'youtube',
          type: 'video',
          id: 'test123',
          title: 'Test Video',
        })
      );

      expect(monitorApp.stats.videosAnnounced).toBe(1);
      expect(mockDuplicateDetector.markAsSeen).toHaveBeenCalledWith('https://www.youtube.com/watch?v=test123');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Video announcement successful',
        expect.objectContaining({
          videoId: 'test123',
          source: 'webhook',
        })
      );
    });

    it('should skip duplicate videos', async () => {
      mockDuplicateDetector.isDuplicate.mockResolvedValue(true);

      await monitorApp.processVideo(mockVideo, 'webhook');

      expect(monitorApp.stats.videosProcessed).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Duplicate video detected, skipping',
        expect.objectContaining({
          videoId: 'test123',
        })
      );
      expect(mockContentClassifier.classifyYouTubeContent).not.toHaveBeenCalled();
      expect(mockContentCoordinator.processContent).not.toHaveBeenCalled();
      expect(monitorApp.stats.videosAnnounced).toBe(0);
    });

    it('should skip old content', async () => {
      jest.spyOn(monitorApp, 'isNewContent').mockReturnValue(false);

      await monitorApp.processVideo(mockVideo, 'webhook');

      expect(monitorApp.stats.videosProcessed).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Video is too old, skipping',
        expect.objectContaining({
          videoId: 'test123',
        })
      );
      expect(mockContentClassifier.classifyYouTubeContent).not.toHaveBeenCalled();
      expect(mockContentAnnouncer.announceContent).not.toHaveBeenCalled();
      expect(monitorApp.stats.videosAnnounced).toBe(0);
    });

    it('should handle skipped announcements', async () => {
      mockContentCoordinator.processContent.mockResolvedValue({
        action: 'skip',
        reason: 'announcements_disabled',
        contentId: 'test123',
        source: 'api-fallback',
      });

      await monitorApp.processVideo(mockVideo, 'api-fallback');

      expect(monitorApp.stats.videosProcessed).toBe(1);
      expect(monitorApp.stats.videosAnnounced).toBe(0);
      expect(mockDuplicateDetector.markAsSeen).not.toHaveBeenCalled();
    });

    it('should handle failed announcements', async () => {
      mockContentCoordinator.processContent.mockResolvedValue({
        action: 'skip',
        reason: 'announcement_failed',
        contentId: 'test123',
        source: 'webhook',
      });

      await monitorApp.processVideo(mockVideo, 'webhook');

      expect(monitorApp.stats.videosProcessed).toBe(1);
      expect(monitorApp.stats.videosAnnounced).toBe(0);
      expect(mockDuplicateDetector.markAsSeen).not.toHaveBeenCalled();
    });

    it('should emit video processed event', async () => {
      const mockResult = { success: true };
      const mockClassification = { type: 'livestream', details: {} };
      mockContentAnnouncer.announceContent.mockResolvedValue(mockResult);
      mockContentClassifier.classifyYouTubeContent.mockReturnValue(mockClassification);

      await monitorApp.processVideo(mockVideo, 'webhook');

      expect(mockEventBus.emit).toHaveBeenCalledWith('monitor.video.processed', {
        video: {
          platform: 'youtube',
          type: 'livestream',
          id: 'test123',
          url: 'https://www.youtube.com/watch?v=test123',
          title: 'Test Video',
          channelTitle: 'Test Channel',
          publishedAt: '2023-01-01T00:00:00Z',
        },
        classification: mockClassification,
        result: mockResult,
        source: 'webhook',
        timestamp: expect.any(Date),
      });
    });

    it('should handle processing errors', async () => {
      const error = new Error('Processing failed');
      mockDuplicateDetector.isDuplicate.mockRejectedValue(error);

      await expect(monitorApp.processVideo(mockVideo, 'webhook')).rejects.toThrow('Processing failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error processing video',
        expect.objectContaining({
          videoId: 'test123',
        })
      );
    });

    it('should use default source when not provided', async () => {
      mockContentAnnouncer.announceContent.mockResolvedValue({ success: true });

      await monitorApp.processVideo(mockVideo);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'monitor.video.processed',
        expect.objectContaining({
          source: 'unknown',
        })
      );
    });
  });

  describe('isNewContent method', () => {
    const mockVideo = {
      snippet: {
        publishedAt: '2023-01-15T12:00:00Z',
      },
    };

    it('should return true when no bot start time is set', () => {
      mockStateManager.get.mockReturnValue(null);

      const result = monitorApp.isNewContent(mockVideo);

      expect(result).toBe(true);
      expect(mockStateManager.get).toHaveBeenCalledWith('botStartTime');
    });

    it('should return true when video has no published date', () => {
      const videoWithoutDate = { snippet: {} };
      mockStateManager.get.mockReturnValue(new Date('2023-01-01T00:00:00Z'));

      const result = monitorApp.isNewContent(videoWithoutDate);

      expect(result).toBe(true);
    });

    it('should return true for content published after bot start time', () => {
      const botStartTime = new Date('2023-01-01T00:00:00Z');
      mockStateManager.get.mockReturnValue(botStartTime);

      const result = monitorApp.isNewContent(mockVideo);

      expect(result).toBe(true);
    });

    it('should return false for content published before bot start time', () => {
      const botStartTime = new Date('2023-01-20T00:00:00Z');
      mockStateManager.get.mockReturnValue(botStartTime);

      const result = monitorApp.isNewContent(mockVideo);

      expect(result).toBe(false);
    });

    it('should return true for content published exactly at bot start time', () => {
      const botStartTime = new Date('2023-01-15T12:00:00Z');
      mockStateManager.get.mockReturnValue(botStartTime);

      const result = monitorApp.isNewContent(mockVideo);

      expect(result).toBe(true);
    });
  });
});
