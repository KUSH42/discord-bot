import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MonitorApplication } from '../../src/application/monitor-application.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('MonitorApplication - Core Operations', () => {
  let monitorApp;
  let mockYoutubeService;
  let mockHttpService;
  let mockContentClassifier;
  let mockContentAnnouncer;
  let mockConfig;
  let mockStateManager;
  let mockEventBus;
  let mockLogger;
  let mockDebugManager;
  let mockMetricsManager;
  let mockContentStateManager;
  let mockLivestreamStateMachine;
  let mockContentCoordinator;
  let mockPersistentStorage;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create enhanced logging mocks
    const enhancedLoggingMocks = createMockDependenciesWithEnhancedLogging();

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

    mockLogger = enhancedLoggingMocks.logger;
    mockDebugManager = enhancedLoggingMocks.debugManager;
    mockMetricsManager = enhancedLoggingMocks.metricsManager;

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
      processContent: jest.fn(),
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
      debugManager: mockDebugManager,
      metricsManager: mockMetricsManager,
    };

    monitorApp = new MonitorApplication(dependencies);
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with all required dependencies', () => {
      expect(monitorApp.youtube).toBeDefined();
      expect(monitorApp.http).toBeDefined();
      expect(monitorApp.classifier).toBeDefined();
      expect(monitorApp.announcer).toBeDefined();
      expect(monitorApp.config).toBeDefined();
      expect(monitorApp.state).toBeDefined();
      expect(monitorApp.eventBus).toBeDefined();
      expect(monitorApp.logger).toBeDefined();
      expect(monitorApp.contentStateManager).toBeDefined();
      expect(monitorApp.livestreamStateMachine).toBeDefined();
      expect(monitorApp.contentCoordinator).toBeDefined();
    });

    it('should set up polling intervals from configuration', () => {
      expect(monitorApp.scheduledContentPollInterval).toBe(600000);
      expect(monitorApp.liveStatePollInterval).toBe(60000);
    });

    it('should set up YouTube configuration', () => {
      expect(monitorApp.youtubeChannelId).toBe('UCTestChannel');
      expect(monitorApp.youtubeApiKey).toBe('test-api-key');
    });

    it('should set up PubSubHubbub configuration', () => {
      expect(monitorApp.callbackUrl).toBe('https://example.com/webhook');
      expect(monitorApp.webhookSecret).toBe('test-secret');
      expect(monitorApp.verifyToken).toBe('verify-token');
    });

    it('should initialize duplicate detector dependency', () => {
      expect(monitorApp.duplicateDetector).toBeDefined();
    });

    it('should initialize statistics', () => {
      expect(monitorApp.stats).toEqual({
        subscriptions: 0,
        webhooksReceived: 0,
        videosProcessed: 0,
        videosAnnounced: 0,
        fallbackPolls: 0,
        lastSubscriptionTime: null,
        lastWebhookTime: null,
        lastError: null,
        xmlParseFailures: 0,
      });
    });

    it('should initialize state flags', () => {
      expect(monitorApp.isRunning).toBe(false);
      expect(monitorApp.subscriptionActive).toBe(false);
      expect(monitorApp.fallbackTimerId).toBeNull();
      expect(monitorApp.scheduledContentPollTimerId).toBeNull();
      expect(monitorApp.liveStatePollTimerId).toBeNull();
    });
  });

  describe('start method', () => {
    beforeEach(() => {
      mockYoutubeService.getChannelDetails.mockResolvedValue({
        snippet: { title: 'Test Channel' },
      });
      jest.spyOn(monitorApp, 'subscribeToPubSubHubbub').mockResolvedValue();
      jest.spyOn(monitorApp, 'startScheduledContentPolling').mockImplementation(() => {});
    });

    it('should throw error if already running', async () => {
      monitorApp.isRunning = true;

      await expect(monitorApp.start()).rejects.toThrow('Monitor application is already running');
    });

    it('should validate YouTube API access', async () => {
      await monitorApp.start();

      expect(mockYoutubeService.getChannelDetails).toHaveBeenCalledWith('UCTestChannel');
      expect(mockLogger.info).toHaveBeenCalledWith('Validating YouTube API access...');
      expect(mockLogger.info).toHaveBeenCalledWith('YouTube API validated. Monitoring channel: Test Channel');
    });

    it('should subscribe to PubSubHubbub', async () => {
      await monitorApp.start();

      expect(monitorApp.subscribeToPubSubHubbub).toHaveBeenCalled();
    });

    it('should start scheduled content polling', async () => {
      await monitorApp.start();

      expect(monitorApp.startScheduledContentPolling).toHaveBeenCalled();
    });

    it('should set isRunning to true', async () => {
      await monitorApp.start();

      expect(monitorApp.isRunning).toBe(true);
    });

    it('should emit start event', async () => {
      await monitorApp.start();

      expect(mockEventBus.emit).toHaveBeenCalledWith('monitor.started', {
        startTime: expect.any(Date),
        youtubeChannelId: 'UCTestChannel',
        callbackUrl: 'https://example.com/webhook',
        fallbackEnabled: true,
      });
    });

    it('should handle YouTube API validation failure', async () => {
      mockYoutubeService.getChannelDetails.mockRejectedValue(new Error('API Error'));
      jest.spyOn(monitorApp, 'stop').mockResolvedValue();

      await expect(monitorApp.start()).rejects.toThrow('YouTube API validation failed: API Error');
      expect(monitorApp.stop).toHaveBeenCalled();
    });

    it('should handle subscription failure', async () => {
      jest.spyOn(monitorApp, 'subscribeToPubSubHubbub').mockRejectedValue(new Error('Subscription failed'));
      jest.spyOn(monitorApp, 'stop').mockResolvedValue();

      await expect(monitorApp.start()).rejects.toThrow('Subscription failed');
      expect(monitorApp.stop).toHaveBeenCalled();
    });
  });

  describe('stop method', () => {
    beforeEach(() => {
      monitorApp.isRunning = true;
      jest.spyOn(monitorApp, 'stopFallbackPolling').mockImplementation(() => {});
      jest.spyOn(monitorApp, 'unsubscribeFromPubSubHubbub').mockResolvedValue();
      jest.spyOn(monitorApp, 'stopScheduledContentPolling').mockImplementation(() => {});
      jest.spyOn(monitorApp, 'stopLiveStatePolling').mockImplementation(() => {});
    });

    it('should return early if not running', async () => {
      monitorApp.isRunning = false;

      await monitorApp.stop();

      expect(monitorApp.stopFallbackPolling).not.toHaveBeenCalled();
    });

    it('should stop fallback polling', async () => {
      await monitorApp.stop();

      expect(monitorApp.stopFallbackPolling).toHaveBeenCalled();
    });

    it('should unsubscribe from PubSubHubbub', async () => {
      await monitorApp.stop();

      expect(monitorApp.unsubscribeFromPubSubHubbub).toHaveBeenCalled();
    });

    it('should stop all polling timers', async () => {
      await monitorApp.stop();

      expect(monitorApp.stopScheduledContentPolling).toHaveBeenCalled();
      expect(monitorApp.stopLiveStatePolling).toHaveBeenCalled();
    });

    it('should set isRunning to false', async () => {
      await monitorApp.stop();

      expect(monitorApp.isRunning).toBe(false);
    });

    it('should emit stop event with stats', async () => {
      const mockStats = { videosProcessed: 5 };
      jest.spyOn(monitorApp, 'getStats').mockReturnValue(mockStats);

      await monitorApp.stop();

      expect(mockEventBus.emit).toHaveBeenCalledWith('monitor.stopped', {
        stopTime: expect.any(Date),
        stats: mockStats,
      });
    });

    it('should handle unsubscription errors gracefully', async () => {
      jest.spyOn(monitorApp, 'unsubscribeFromPubSubHubbub').mockRejectedValue(new Error('Unsubscribe failed'));

      await monitorApp.stop();

      expect(mockLogger.error).toHaveBeenCalledWith('Error stopping monitor application:', expect.any(Error));
      // isRunning should still be set to false despite the error
    });
  });

  describe('validateYouTubeAccess method', () => {
    it('should validate API key by fetching channel details', async () => {
      const channelDetails = {
        snippet: { title: 'Test Channel' },
      };
      mockYoutubeService.getChannelDetails.mockResolvedValue(channelDetails);

      await monitorApp.validateYouTubeAccess();

      expect(mockYoutubeService.getChannelDetails).toHaveBeenCalledWith('UCTestChannel');
      expect(mockLogger.info).toHaveBeenCalledWith('Validating YouTube API access...');
      expect(mockLogger.info).toHaveBeenCalledWith('YouTube API validated. Monitoring channel: Test Channel');
    });

    it('should handle null channel details', async () => {
      mockYoutubeService.getChannelDetails.mockResolvedValue(null);

      await expect(monitorApp.validateYouTubeAccess()).rejects.toThrow('Failed to fetch YouTube channel details');
      expect(mockLogger.error).toHaveBeenCalledWith('YouTube API validation failed:', expect.any(Error));
    });

    it('should handle API errors', async () => {
      const error = new Error('API quota exceeded');
      mockYoutubeService.getChannelDetails.mockRejectedValue(error);

      await expect(monitorApp.validateYouTubeAccess()).rejects.toThrow(
        'YouTube API validation failed: API quota exceeded'
      );
      expect(mockLogger.error).toHaveBeenCalledWith('YouTube API validation failed:', error);
    });

    it('should handle channel details without title', async () => {
      const channelDetails = {
        snippet: {}, // No title
      };
      mockYoutubeService.getChannelDetails.mockResolvedValue(channelDetails);

      await monitorApp.validateYouTubeAccess();

      expect(mockLogger.info).toHaveBeenCalledWith('YouTube API validated. Monitoring channel: Unknown');
    });
  });

  describe('getStats method', () => {
    it('should return comprehensive statistics', () => {
      monitorApp.isRunning = true;
      monitorApp.subscriptionActive = true;
      monitorApp.stats.videosProcessed = 10;
      monitorApp.stats.videosAnnounced = 8;
      const mockDuplicateStats = { seenCount: 15 };
      jest.spyOn(monitorApp.duplicateDetector, 'getStats').mockReturnValue(mockDuplicateStats);

      const stats = monitorApp.getStats();

      expect(stats).toEqual({
        isRunning: true,
        subscriptionActive: true,
        youtubeChannelId: 'UCTestChannel',
        callbackUrl: 'https://example.com/webhook',
        fallbackEnabled: true,
        subscriptions: 0,
        webhooksReceived: 0,
        videosProcessed: 10,
        videosAnnounced: 8,
        fallbackPolls: 0,
        lastSubscriptionTime: null,
        lastWebhookTime: null,
        lastError: null,
        xmlParseFailures: 0,
        duplicateDetectorStats: mockDuplicateStats,
      });
    });
  });

  describe('dispose method', () => {
    it('should call stop method', async () => {
      jest.spyOn(monitorApp, 'stop').mockResolvedValue();

      await monitorApp.dispose();

      expect(monitorApp.stop).toHaveBeenCalled();
    });
  });

  describe('isRunning property', () => {
    it('should return current running state', () => {
      monitorApp.isRunning = true;
      expect(monitorApp.isRunning).toBe(true);

      monitorApp.isRunning = false;
      expect(monitorApp.isRunning).toBe(false);
    });
  });
});
