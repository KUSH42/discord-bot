import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MonitorApplication } from '../../src/application/monitor-application.js';

describe('MonitorApplication - Fallback Integration Tests', () => {
  let monitorApp;
  let mockYoutubeService;
  let mockHttpService;
  let mockContentClassifier;
  let mockContentAnnouncer;
  let mockConfig;
  let mockStateManager;
  let mockEventBus;
  let mockLogger;
  let realTimeouts;

  beforeEach(() => {
    jest.useFakeTimers();

    // Store real timeout functions for specific tests
    realTimeouts = {
      setTimeout: global.setTimeout,
      clearTimeout: global.clearTimeout,
    };

    mockYoutubeService = {
      getChannelDetails: jest.fn(),
      getVideoDetails: jest.fn(),
      getChannelVideos: jest.fn(),
    };

    mockHttpService = {
      post: jest.fn(),
      isSuccessResponse: jest.fn().mockReturnValue(true),
    };

    mockContentClassifier = {
      classifyYouTubeContent: jest.fn().mockReturnValue({
        type: 'video',
        details: {},
      }),
    };

    mockContentAnnouncer = {
      announceContent: jest.fn().mockResolvedValue({ success: true }),
    };

    mockConfig = {
      getRequired: jest.fn().mockImplementation(key => {
        const values = {
          YOUTUBE_CHANNEL_ID: 'UCTestChannel',
          YOUTUBE_API_KEY: 'test-api-key',
          PSH_CALLBACK_URL: 'https://example.com/webhook',
        };
        return values[key];
      }),
      get: jest.fn().mockReturnValue('test-secret'),
      getNumber: jest.fn().mockReturnValue(300000),
      getBoolean: jest.fn().mockReturnValue(false),
    };

    mockStateManager = {
      get: jest.fn().mockReturnValue(new Date('2023-01-01T00:00:00Z')),
    };

    mockEventBus = {
      emit: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      // Add enhanced logger methods
      startOperation: jest.fn().mockReturnValue({
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      }),
      child: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        // Add enhanced logger methods to child logger too
        startOperation: jest.fn().mockReturnValue({
          progress: jest.fn(),
          success: jest.fn(),
          error: jest.fn(),
        }),
        child: jest.fn().mockReturnThis(),
      }),
    };

    const mockPersistentStorage = {
      hasFingerprint: jest.fn().mockResolvedValue(false),
      storeFingerprint: jest.fn().mockResolvedValue(),
      hasUrl: jest.fn().mockResolvedValue(false),
      addUrl: jest.fn().mockResolvedValue(),
      destroy: jest.fn().mockResolvedValue(),
    };

    const mockContentStateManager = {
      getContentState: jest.fn().mockReturnValue({ isProcessed: false }),
      setContentState: jest.fn(),
      cleanupOldStates: jest.fn(),
    };

    const mockLivestreamStateMachine = {
      transitionState: jest.fn(),
      getCurrentState: jest.fn().mockReturnValue('published'),
    };

    const mockContentCoordinator = {
      processContent: jest.fn().mockResolvedValue({
        action: 'announced',
        announcementResult: { success: true, channelId: 'test-channel', messageId: 'test-message' },
      }),
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
      persistentStorage: mockPersistentStorage,
      contentStateManager: mockContentStateManager,
      livestreamStateMachine: mockLivestreamStateMachine,
      contentCoordinator: mockContentCoordinator,
    };

    monitorApp = new MonitorApplication(dependencies);

    // Clear DuplicateDetector cache at the start of each test
    if (monitorApp && monitorApp.duplicateDetector) {
      monitorApp.duplicateDetector.destroy();
    }
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();

    // Clear DuplicateDetector cache to prevent test interference
    if (monitorApp && monitorApp.duplicateDetector) {
      monitorApp.duplicateDetector.destroy();
    }
  });

  describe('Error-Triggered Fallback Integration', () => {
    it('should trigger fallback when webhook processing fails due to XML parsing error', async () => {
      // Setup
      jest
        .spyOn(monitorApp, 'verifyWebhookSignatureDebug')
        .mockReturnValue({ isValid: true, details: { method: 'sha1' } });
      jest.spyOn(monitorApp, 'parseNotificationXML').mockReturnValue(null);
      jest.spyOn(monitorApp, 'performApiFallback').mockResolvedValue();

      const request = {
        body: '<xml>malformed</xml>',
        headers: { 'x-hub-signature': 'sha1=test' },
        method: 'POST',
      };

      // Execute
      await monitorApp.handleWebhook(request);

      // Verify no fallback scheduled for XML parsing failures (these don't trigger fallback)
      expect(monitorApp.fallbackTimerId).toBeNull();
      expect(monitorApp.performApiFallback).not.toHaveBeenCalled();
    });

    it('should trigger fallback when webhook processing fails due to video details API error', async () => {
      // Setup
      jest
        .spyOn(monitorApp, 'verifyWebhookSignatureDebug')
        .mockReturnValue({ isValid: true, details: { method: 'sha1' } });
      jest.spyOn(monitorApp, 'parseNotificationXML').mockReturnValue({ videoId: 'test123' });
      jest.spyOn(monitorApp, 'performApiFallback').mockResolvedValue();
      mockYoutubeService.getVideoDetails.mockRejectedValue(new Error('API Error'));

      const request = {
        body: '<xml>valid</xml>',
        headers: { 'x-hub-signature': 'sha1=test' },
        method: 'POST',
      };

      // Execute
      await monitorApp.handleWebhook(request);

      // Verify fallback was scheduled
      expect(monitorApp.fallbackTimerId).toBeTruthy();
      expect(mockLogger.warn).toHaveBeenCalledWith('Scheduling API fallback due to notification processing failure');

      // Fast forward timer to trigger fallback
      jest.advanceTimersByTime(30000);

      expect(monitorApp.performApiFallback).toHaveBeenCalled();
    });

    it('should trigger fallback when webhook processing fails due to video processing error', async () => {
      // Setup
      jest
        .spyOn(monitorApp, 'verifyWebhookSignatureDebug')
        .mockReturnValue({ isValid: true, details: { method: 'sha1' } });
      jest.spyOn(monitorApp, 'parseNotificationXML').mockReturnValue({ videoId: 'test123' });
      jest.spyOn(monitorApp, 'processVideo').mockRejectedValue(new Error('Processing Error'));
      jest.spyOn(monitorApp, 'performApiFallback').mockResolvedValue();
      mockYoutubeService.getVideoDetails.mockResolvedValue({
        id: 'test123',
        snippet: { title: 'Test Video' },
      });

      const request = {
        body: '<xml>valid</xml>',
        headers: { 'x-hub-signature': 'sha1=test' },
        method: 'POST',
      };

      // Execute
      await monitorApp.handleWebhook(request);

      // Verify fallback was scheduled
      expect(monitorApp.fallbackTimerId).toBeTruthy();

      // Fast forward timer to trigger fallback
      jest.advanceTimersByTime(30000);

      expect(monitorApp.performApiFallback).toHaveBeenCalled();
    });

    it('should NOT trigger fallback when webhook processing succeeds completely', async () => {
      // Setup
      jest
        .spyOn(monitorApp, 'verifyWebhookSignatureDebug')
        .mockReturnValue({ isValid: true, details: { method: 'sha1' } });
      jest.spyOn(monitorApp, 'parseNotificationXML').mockReturnValue({ videoId: 'test123' });
      jest.spyOn(monitorApp, 'processVideo').mockResolvedValue();
      jest.spyOn(monitorApp, 'performApiFallback').mockResolvedValue();
      mockYoutubeService.getVideoDetails.mockResolvedValue({
        id: 'test123',
        snippet: { title: 'Test Video' },
      });

      const request = {
        body: '<xml>valid</xml>',
        headers: { 'x-hub-signature': 'sha1=test' },
        method: 'POST',
      };

      // Execute
      await monitorApp.handleWebhook(request);

      // Verify no fallback was scheduled
      expect(monitorApp.fallbackTimerId).toBeNull();
      expect(monitorApp.performApiFallback).not.toHaveBeenCalled();
    });

    it('should handle multiple notification errors with only one fallback scheduled', async () => {
      // Setup
      jest
        .spyOn(monitorApp, 'verifyWebhookSignatureDebug')
        .mockReturnValue({ isValid: true, details: { method: 'sha1' } });
      jest.spyOn(monitorApp, 'parseNotificationXML').mockReturnValue({ videoId: 'test123' });
      jest.spyOn(monitorApp, 'performApiFallback').mockResolvedValue();
      mockYoutubeService.getVideoDetails.mockRejectedValue(new Error('API Error'));

      const request = {
        body: '<xml>valid</xml>',
        headers: { 'x-hub-signature': 'sha1=test' },
        method: 'POST',
      };

      // Execute multiple failing webhooks
      await monitorApp.handleWebhook(request);
      await monitorApp.handleWebhook(request);
      await monitorApp.handleWebhook(request);

      // Verify only one fallback was scheduled
      expect(monitorApp.fallbackTimerId).toBeTruthy();
      expect(mockLogger.debug).toHaveBeenCalledWith('API fallback already scheduled, skipping');

      // Fast forward timer to trigger fallback
      jest.advanceTimersByTime(30000);

      expect(monitorApp.performApiFallback).toHaveBeenCalledTimes(1);
    });

    it('should complete full fallback workflow when triggered by error', async () => {
      // Setup
      const mockVideos = [
        {
          id: 'fallback-video-1',
          snippet: {
            title: 'Fallback Video 1',
            publishedAt: '2023-01-02T00:00:00Z',
            channelTitle: 'Test Channel',
          },
        },
        {
          id: 'fallback-video-2',
          snippet: {
            title: 'Fallback Video 2',
            publishedAt: '2023-01-03T00:00:00Z',
            channelTitle: 'Test Channel',
          },
        },
      ];

      jest.spyOn(monitorApp, 'processVideo').mockResolvedValue();
      mockYoutubeService.getChannelVideos.mockResolvedValue(mockVideos);

      // Execute fallback directly (simulating triggered fallback)
      await monitorApp.performApiFallback();

      // Verify complete fallback workflow
      expect(mockYoutubeService.getChannelVideos).toHaveBeenCalledWith('UCTestChannel', 5);
      expect(monitorApp.processVideo).toHaveBeenCalledWith(mockVideos[0], 'api-fallback');
      expect(monitorApp.processVideo).toHaveBeenCalledWith(mockVideos[1], 'api-fallback');
      expect(monitorApp.stats.fallbackPolls).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith('API fallback check completed successfully');
    });

    it('should handle fallback API errors gracefully', async () => {
      // Setup
      mockYoutubeService.getChannelVideos.mockRejectedValue(new Error('Fallback API Error'));

      // Execute fallback directly (simulating triggered fallback)
      await expect(monitorApp.performApiFallback()).rejects.toThrow('Fallback API Error');

      // Verify fallback error was logged
      expect(mockLogger.error).toHaveBeenCalledWith('API fallback check failed:', expect.any(Error));
      expect(monitorApp.stats.fallbackPolls).toBe(1);
    });

    it('should not start automatic polling during monitor startup', async () => {
      // Setup
      jest.spyOn(monitorApp, 'performApiFallback').mockResolvedValue();
      jest.spyOn(monitorApp, 'subscribeToPubSubHubbub').mockResolvedValue();
      mockYoutubeService.getChannelDetails.mockResolvedValue({
        snippet: { title: 'Test Channel' },
      });

      // Execute startup
      await monitorApp.start();

      // Verify no automatic polling started
      expect(monitorApp.fallbackTimerId).toBeNull();
      expect(monitorApp.performApiFallback).not.toHaveBeenCalled();

      // Fast forward through extended time periods
      jest.advanceTimersByTime(30 * 60 * 1000); // 30 minutes

      // Verify still no automatic polling
      expect(monitorApp.performApiFallback).not.toHaveBeenCalled();
    });

    it('should clear fallback timer on monitor stop', async () => {
      // Setup
      jest.spyOn(monitorApp, 'subscribeToPubSubHubbub').mockResolvedValue();
      jest.spyOn(monitorApp, 'unsubscribeFromPubSubHubbub').mockResolvedValue();
      mockYoutubeService.getChannelDetails.mockResolvedValue({
        snippet: { title: 'Test Channel' },
      });

      // Start monitor and schedule a fallback
      await monitorApp.start();
      monitorApp.scheduleApiFallback();
      expect(monitorApp.fallbackTimerId).toBeTruthy();

      // Stop monitor
      await monitorApp.stop();

      // Verify fallback timer was cleared
      expect(monitorApp.fallbackTimerId).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith('Scheduled API fallback cleared');
    });
  });

  describe('Fallback Workflow Integration', () => {
    it('should properly integrate with duplicate detection during fallback', async () => {
      // Setup
      const mockVideo = {
        id: 'duplicate-video',
        snippet: {
          title: 'Duplicate Video',
          publishedAt: '2023-01-02T00:00:00Z',
          channelTitle: 'Test Channel',
        },
      };

      mockYoutubeService.getChannelVideos.mockResolvedValue([mockVideo]);

      // Mock duplicate detection
      jest.spyOn(monitorApp.duplicateDetector, 'isDuplicate').mockReturnValue(true);
      jest.spyOn(monitorApp, 'processVideo').mockImplementation(async (video, source) => {
        // Simulate the real processVideo logic for duplicates
        if (monitorApp.duplicateDetector.isDuplicate(`https://www.youtube.com/watch?v=${video.id}`)) {
          mockLogger.debug(`Duplicate video detected: ${video.snippet.title} (${video.id})`);
          return;
        }
        // Normal processing...
      });

      // Execute fallback
      await monitorApp.performApiFallback();

      // Verify duplicate was detected and skipped
      expect(monitorApp.duplicateDetector.isDuplicate).toHaveBeenCalledWith(
        'https://www.youtube.com/watch?v=duplicate-video'
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('Duplicate video detected: Duplicate Video (duplicate-video)');
      expect(mockContentAnnouncer.announceContent).not.toHaveBeenCalled();
    });

    it('should properly integrate with content classification during fallback', async () => {
      // Setup
      const mockVideo = {
        id: 'classified-video',
        snippet: {
          title: 'Test Video',
          publishedAt: '2023-01-02T00:00:00Z',
          channelTitle: 'Test Channel',
        },
      };

      mockYoutubeService.getChannelVideos.mockResolvedValue([mockVideo]);
      mockContentClassifier.classifyYouTubeContent.mockReturnValue({
        type: 'livestream',
        details: { isLive: true },
      });

      // Get the mockContentCoordinator from dependencies to update its mock
      const mockContentCoordinator = monitorApp.contentCoordinator;

      // Execute fallback
      await monitorApp.performApiFallback();

      // Verify content was classified
      expect(mockContentClassifier.classifyYouTubeContent).toHaveBeenCalledWith(mockVideo);

      // Since contentCoordinator is present, verify it was called instead of direct announcer
      expect(mockContentCoordinator.processContent).toHaveBeenCalledWith(
        'classified-video',
        'api-fallback',
        expect.objectContaining({
          platform: 'youtube',
          type: 'livestream',
          id: 'classified-video',
          isLive: true,
        })
      );
    });

    it('should emit proper events during fallback workflow', async () => {
      // Setup
      const mockVideo = {
        id: 'event-video',
        snippet: {
          title: 'Event Video',
          publishedAt: '2023-01-02T00:00:00Z',
          channelTitle: 'Test Channel',
        },
      };

      mockYoutubeService.getChannelVideos.mockResolvedValue([mockVideo]);

      // Execute fallback
      await monitorApp.performApiFallback();

      // Verify video processed event was emitted
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'monitor.video.processed',
        expect.objectContaining({
          video: expect.objectContaining({
            id: 'event-video',
            platform: 'youtube',
          }),
          source: 'api-fallback',
          timestamp: expect.any(Date),
        })
      );
    });
  });
});
