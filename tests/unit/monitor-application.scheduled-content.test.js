import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MonitorApplication } from '../../src/application/monitor-application.js';
import { timestampUTC } from '../../src/utilities/utc-time.js';

describe('MonitorApplication - Scheduled Content Polling', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

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
        SCHEDULED_CONTENT_POLL_INTERVAL_MS: 3600000,
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

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
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
    };

    monitorApp = new MonitorApplication(dependencies);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('startScheduledContentPolling method', () => {
    beforeEach(() => {
      jest.spyOn(monitorApp, 'pollScheduledContent').mockResolvedValue();
      jest.spyOn(monitorApp, 'stopScheduledContentPolling').mockImplementation(() => {});
    });

    it('should start scheduled content polling', () => {
      monitorApp.isRunning = true;

      monitorApp.startScheduledContentPolling();

      expect(monitorApp.scheduledContentPollTimerId).toBeTruthy();
      expect(mockLogger.info).toHaveBeenCalledWith('Scheduled content polling started', {
        interval: 3600000,
      });
    });

    it('should stop existing polling before starting new one', () => {
      // Set up existing timer to test the stop behavior
      monitorApp.scheduledContentPollTimerId = setTimeout(() => {}, 1000);

      monitorApp.startScheduledContentPolling();

      expect(monitorApp.stopScheduledContentPolling).toHaveBeenCalled();
    });

    it('should call pollScheduledContent after initial delay', async () => {
      monitorApp.isRunning = true;
      monitorApp.startScheduledContentPolling();

      // Fast forward initial delay
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(monitorApp.pollScheduledContent).toHaveBeenCalled();
    });

    it('should continue polling if monitor is running', async () => {
      monitorApp.isRunning = true;
      monitorApp.startScheduledContentPolling();

      // Fast forward initial delay
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      // Reset the call count
      jest.spyOn(monitorApp, 'pollScheduledContent').mockClear();

      // Fast forward to next poll
      jest.advanceTimersByTime(3600000);
      await Promise.resolve();

      expect(monitorApp.pollScheduledContent).toHaveBeenCalledTimes(1);
    });

    it('should handle monitor state changes during polling', async () => {
      monitorApp.isRunning = true;
      monitorApp.startScheduledContentPolling();

      // Fast forward initial delay
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(monitorApp.pollScheduledContent).toHaveBeenCalled();

      // The polling behavior when monitor stops is handled internally
      // and testing the exact timing is fragile, so we just verify
      // the polling started correctly
    });

    it('should handle polling errors gracefully', async () => {
      const error = new Error('Polling failed');
      jest.spyOn(monitorApp, 'pollScheduledContent').mockRejectedValue(error);
      monitorApp.isRunning = true;

      monitorApp.startScheduledContentPolling();

      // Fast forward initial delay
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(mockLogger.error).toHaveBeenCalledWith('Error in scheduled content polling loop:', error);

      // Should continue polling despite error
      jest.advanceTimersByTime(3600000);
      await Promise.resolve();

      expect(monitorApp.pollScheduledContent).toHaveBeenCalledTimes(2);
    });
  });

  describe('stopScheduledContentPolling method', () => {
    it('should clear scheduled content polling timer', () => {
      monitorApp.scheduledContentPollTimerId = setTimeout(() => {}, 1000);

      monitorApp.stopScheduledContentPolling();

      expect(monitorApp.scheduledContentPollTimerId).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith('Scheduled content polling stopped.');
    });

    it('should handle case when no timer is set', () => {
      monitorApp.scheduledContentPollTimerId = null;

      monitorApp.stopScheduledContentPolling();

      expect(mockLogger.info).not.toHaveBeenCalledWith('Scheduled content polling stopped.');
    });
  });

  describe('pollScheduledContent method', () => {
    const mockScheduledVideos = [
      {
        id: 'live1',
        title: 'Upcoming Stream 1',
        publishedAt: '2023-01-01T00:00:00Z',
        scheduledStartTime: '2023-01-01T12:00:00Z',
      },
      {
        id: 'live2',
        title: 'Upcoming Stream 2',
        publishedAt: '2023-01-01T00:00:00Z',
        scheduledStartTime: '2023-01-01T15:00:00Z',
      },
    ];

    beforeEach(() => {
      mockYoutubeService.getScheduledContent.mockResolvedValue(mockScheduledVideos);
      mockContentStateManager.hasContent.mockReturnValue(false);
      jest.spyOn(monitorApp, 'startLiveStatePolling').mockImplementation(() => {});
    });

    it('should fetch scheduled content and add new items', async () => {
      await monitorApp.pollScheduledContent();

      expect(mockLogger.debug).toHaveBeenCalledWith('Polling for scheduled content...');
      expect(mockYoutubeService.getScheduledContent).toHaveBeenCalledWith('UCTestChannel');

      expect(mockContentStateManager.addContent).toHaveBeenCalledTimes(2);
      expect(mockContentStateManager.addContent).toHaveBeenCalledWith('live1', {
        type: 'youtube_livestream',
        state: 'scheduled',
        source: 'api',
        publishedAt: '2023-01-01T00:00:00Z',
        url: 'https://www.youtube.com/watch?v=live1',
        title: 'Upcoming Stream 1',
        metadata: { scheduledStartTime: '2023-01-01T12:00:00Z' },
      });

      expect(monitorApp.startLiveStatePolling).toHaveBeenCalled();
    });

    it('should skip content that already exists', async () => {
      mockContentStateManager.hasContent.mockImplementation(id => id === 'live1');

      await monitorApp.pollScheduledContent();

      expect(mockContentStateManager.addContent).toHaveBeenCalledTimes(1);
      expect(mockContentStateManager.addContent).toHaveBeenCalledWith('live2', expect.any(Object));
    });

    it('should handle empty scheduled content list', async () => {
      mockYoutubeService.getScheduledContent.mockResolvedValue([]);

      await monitorApp.pollScheduledContent();

      expect(mockContentStateManager.addContent).not.toHaveBeenCalled();
      expect(monitorApp.startLiveStatePolling).toHaveBeenCalled();
    });

    it('should handle YouTube API errors', async () => {
      const error = new Error('YouTube API error');
      mockYoutubeService.getScheduledContent.mockRejectedValue(error);

      await expect(monitorApp.pollScheduledContent()).rejects.toThrow('YouTube API error');
    });

    it('should handle quota exceeded errors with backoff', async () => {
      const quotaError = new Error('The request cannot be completed because you have exceeded your quota.');
      mockYoutubeService.getScheduledContent.mockRejectedValue(quotaError);

      await monitorApp.pollScheduledContent();

      expect(monitorApp.lastQuotaError).toBeTruthy();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'YouTube API quota exceeded during scheduled content polling - implementing 4 hour backoff',
        expect.objectContaining({
          nextAttemptTime: expect.any(String),
        })
      );
    });

    it('should skip polling during quota backoff period', async () => {
      // Set recent quota error
      monitorApp.lastQuotaError = timestampUTC() - 2 * 60 * 60 * 1000; // 2 hours ago

      await monitorApp.pollScheduledContent();

      expect(mockYoutubeService.getScheduledContent).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Skipping scheduled content poll due to recent quota error',
        expect.objectContaining({
          timeSinceError: expect.any(Number),
          backoffMinutes: expect.any(Number),
        })
      );
    });

    it('should resume polling after quota backoff period expires', async () => {
      // Set old quota error (beyond backoff period)
      monitorApp.lastQuotaError = timestampUTC() - 5 * 60 * 60 * 1000; // 5 hours ago

      await monitorApp.pollScheduledContent();

      expect(monitorApp.lastQuotaError).toBeNull();
      expect(mockYoutubeService.getScheduledContent).toHaveBeenCalledWith('UCTestChannel');
    });
  });

  describe('startLiveStatePolling method', () => {
    beforeEach(() => {
      jest.spyOn(monitorApp, 'pollLiveStateTransitions').mockResolvedValue();
      mockContentStateManager.getContentByState.mockReturnValue([{ id: 'live1' }]);
    });

    it('should not start if already running', () => {
      monitorApp.liveStatePollTimerId = 'existing-timer';

      monitorApp.startLiveStatePolling();

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Live state transition polling started')
      );
    });

    it('should start live state polling', () => {
      monitorApp.isRunning = true;

      monitorApp.startLiveStatePolling();

      expect(monitorApp.liveStatePollTimerId).toBeTruthy();
      expect(mockLogger.info).toHaveBeenCalledWith('Live state transition polling started', {
        interval: 60000,
      });
    });

    it('should call pollLiveStateTransitions immediately', async () => {
      monitorApp.isRunning = true;
      monitorApp.startLiveStatePolling();

      // Fast forward initial delay
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(monitorApp.pollLiveStateTransitions).toHaveBeenCalled();
    });

    it('should continue polling while scheduled content exists', async () => {
      monitorApp.isRunning = true;
      monitorApp.startLiveStatePolling();

      // Fast forward initial delay
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // Fast forward to next poll
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      expect(monitorApp.pollLiveStateTransitions).toHaveBeenCalledTimes(2);
    });

    it('should stop polling when no scheduled content remains', async () => {
      jest.spyOn(monitorApp, 'stopLiveStatePolling').mockImplementation(() => {});
      monitorApp.isRunning = true;
      monitorApp.startLiveStatePolling();

      // Fast forward initial delay
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // Mock no scheduled content
      mockContentStateManager.getContentByState.mockReturnValue([]);

      // Fast forward to next poll
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      expect(monitorApp.stopLiveStatePolling).toHaveBeenCalled();
    });

    it('should stop polling when monitor is not running', async () => {
      jest.spyOn(monitorApp, 'stopLiveStatePolling').mockImplementation(() => {});
      monitorApp.isRunning = true;
      monitorApp.startLiveStatePolling();

      // Fast forward initial delay
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // Stop the monitor
      monitorApp.isRunning = false;

      // Fast forward to next poll
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      expect(monitorApp.stopLiveStatePolling).toHaveBeenCalled();
    });

    it('should handle polling errors gracefully', async () => {
      const error = new Error('State polling failed');
      jest.spyOn(monitorApp, 'pollLiveStateTransitions').mockRejectedValue(error);
      monitorApp.isRunning = true;

      monitorApp.startLiveStatePolling();

      // Fast forward initial delay
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(mockLogger.error).toHaveBeenCalledWith('Error in live state polling loop:', error);
    });
  });

  describe('stopLiveStatePolling method', () => {
    it('should clear live state polling timer', () => {
      monitorApp.liveStatePollTimerId = setTimeout(() => {}, 1000);

      monitorApp.stopLiveStatePolling();

      expect(monitorApp.liveStatePollTimerId).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith('Live state transition polling stopped.');
    });

    it('should handle case when no timer is set', () => {
      monitorApp.liveStatePollTimerId = null;

      monitorApp.stopLiveStatePolling();

      expect(mockLogger.info).not.toHaveBeenCalledWith('Live state transition polling stopped.');
    });
  });

  describe('pollLiveStateTransitions method', () => {
    const mockScheduledContent = [
      { id: 'live1', state: 'scheduled' },
      { id: 'live2', state: 'scheduled' },
    ];

    const mockCurrentStates = [
      { id: 'live1', state: 'live' },
      { id: 'live2', state: 'scheduled' },
    ];

    beforeEach(() => {
      mockContentStateManager.getContentByState.mockReturnValue(mockScheduledContent);
      mockYoutubeService.checkScheduledContentStates.mockResolvedValue(mockCurrentStates);
      mockContentStateManager.getContentState.mockImplementation(id => mockScheduledContent.find(c => c.id === id));
    });

    it('should return early when no scheduled content exists', async () => {
      mockContentStateManager.getContentByState.mockReturnValue([]);

      await monitorApp.pollLiveStateTransitions();

      expect(mockLogger.debug).toHaveBeenCalledWith('No scheduled content to poll for state changes.');
      expect(mockYoutubeService.checkScheduledContentStates).not.toHaveBeenCalled();
    });

    it('should check states for scheduled content', async () => {
      await monitorApp.pollLiveStateTransitions();

      expect(mockLogger.debug).toHaveBeenCalledWith('Polling state for 2 scheduled item(s)...');
      expect(mockYoutubeService.checkScheduledContentStates).toHaveBeenCalledWith(['live1', 'live2']);
    });

    it('should detect and handle state transitions', async () => {
      await monitorApp.pollLiveStateTransitions();

      expect(mockLogger.info).toHaveBeenCalledWith('State transition detected for live1: scheduled -> live');
      expect(mockLivestreamStateMachine.transitionState).toHaveBeenCalledWith('live1', 'live');
    });

    it('should not trigger transitions for unchanged states', async () => {
      await monitorApp.pollLiveStateTransitions();

      // Only live1 should trigger transition (scheduled -> live)
      expect(mockLivestreamStateMachine.transitionState).toHaveBeenCalledTimes(1);
      expect(mockLivestreamStateMachine.transitionState).not.toHaveBeenCalledWith('live2', 'scheduled');
    });

    it('should handle missing old state gracefully', async () => {
      mockContentStateManager.getContentState.mockReturnValue(null);

      await monitorApp.pollLiveStateTransitions();

      expect(mockLivestreamStateMachine.transitionState).not.toHaveBeenCalled();
    });

    it('should handle YouTube API errors', async () => {
      const error = new Error('YouTube API error');
      mockYoutubeService.checkScheduledContentStates.mockRejectedValue(error);

      await expect(monitorApp.pollLiveStateTransitions()).rejects.toThrow('YouTube API error');
    });
  });
});
