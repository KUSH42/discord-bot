import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MonitorApplication } from '../../src/application/monitor-application.js';

describe('MonitorApplication - PubSubHubbub Operations', () => {
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
      isSuccessResponse: jest.fn(),
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

  describe('subscribeToPubSubHubbub method', () => {
    beforeEach(() => {
      jest.spyOn(monitorApp, 'logWebhookDebug').mockImplementation(() => {});
      jest.spyOn(monitorApp, 'scheduleSubscriptionRenewal').mockImplementation(() => {});
    });

    it('should successfully subscribe to PubSubHubbub', async () => {
      const mockResponse = { status: 202, statusText: 'Accepted', headers: {} };
      mockHttpService.post.mockResolvedValue(mockResponse);
      mockHttpService.isSuccessResponse.mockReturnValue(true);

      await monitorApp.subscribeToPubSubHubbub();

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://pubsubhubbub.appspot.com/subscribe',
        expect.stringContaining('hub.callback=https%3A%2F%2Fexample.com%2Fwebhook'),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      expect(monitorApp.subscriptionActive).toBe(true);
      expect(monitorApp.stats.subscriptions).toBe(1);
      expect(monitorApp.stats.lastSubscriptionTime).toBeInstanceOf(Date);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Successfully subscribed to PubSubHubbub',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
      expect(monitorApp.scheduleSubscriptionRenewal).toHaveBeenCalled();
    });

    it('should send correct subscription parameters', async () => {
      const mockResponse = { status: 202 };
      mockHttpService.post.mockResolvedValue(mockResponse);
      mockHttpService.isSuccessResponse.mockReturnValue(true);

      await monitorApp.subscribeToPubSubHubbub();

      const [, subscriptionData] = mockHttpService.post.mock.calls[0];
      expect(subscriptionData).toContain('hub.callback=https%3A%2F%2Fexample.com%2Fwebhook');
      expect(subscriptionData).toContain(
        'hub.topic=https%3A%2F%2Fwww.youtube.com%2Fxml%2Ffeeds%2Fvideos.xml%3Fchannel_id%3DUCTestChannel'
      );
      expect(subscriptionData).toContain('hub.verify=async');
      expect(subscriptionData).toContain('hub.mode=subscribe');
      expect(subscriptionData).toContain('hub.verify_token=verify-token');
      expect(subscriptionData).toContain('hub.lease_seconds=86400');
    });

    it('should handle subscription failure', async () => {
      const mockResponse = { status: 400, statusText: 'Bad Request' };
      mockHttpService.post.mockResolvedValue(mockResponse);
      mockHttpService.isSuccessResponse.mockReturnValue(false);

      await expect(monitorApp.subscribeToPubSubHubbub()).rejects.toThrow('Subscription failed with status: 400');
      expect(monitorApp.subscriptionActive).toBe(false);
      expect(monitorApp.stats.subscriptions).toBe(0);
    });

    it('should handle HTTP request errors', async () => {
      const error = new Error('Network error');
      mockHttpService.post.mockRejectedValue(error);

      await expect(monitorApp.subscribeToPubSubHubbub()).rejects.toThrow('Network error');
      expect(monitorApp.logWebhookDebug).toHaveBeenCalledWith('PUBSUBHUBBUB SUBSCRIPTION ERROR', {
        error: 'Network error',
        stack: expect.any(String),
      });
    });

    it('should log webhook debug information when enabled', async () => {
      mockConfig.getBoolean.mockImplementation(key => key === 'WEBHOOK_DEBUG_LOGGING');
      monitorApp.webhookDebugEnabled = true;

      const mockResponse = { status: 202, statusText: 'Accepted', headers: {} };
      mockHttpService.post.mockResolvedValue(mockResponse);
      mockHttpService.isSuccessResponse.mockReturnValue(true);

      await monitorApp.subscribeToPubSubHubbub();

      expect(monitorApp.logWebhookDebug).toHaveBeenCalledWith('PUBSUBHUBBUB SUBSCRIPTION REQUEST', {
        hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
        topicUrl: 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UCTestChannel',
        callbackUrl: 'https://example.com/webhook',
        verifyToken: '[SET]',
        leaseSeconds: '86400',
      });

      expect(monitorApp.logWebhookDebug).toHaveBeenCalledWith('PUBSUBHUBBUB SUBSCRIPTION RESPONSE', {
        status: 202,
        statusText: 'Accepted',
        headers: {},
        success: true,
      });
    });
  });

  describe('unsubscribeFromPubSubHubbub method', () => {
    beforeEach(() => {
      monitorApp.subscriptionActive = true;
    });

    it('should return early if not subscribed', async () => {
      monitorApp.subscriptionActive = false;

      await monitorApp.unsubscribeFromPubSubHubbub();

      expect(mockHttpService.post).not.toHaveBeenCalled();
    });

    it('should successfully unsubscribe from PubSubHubbub', async () => {
      const mockResponse = { status: 202 };
      mockHttpService.post.mockResolvedValue(mockResponse);
      mockHttpService.isSuccessResponse.mockReturnValue(true);

      await monitorApp.unsubscribeFromPubSubHubbub();

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://pubsubhubbub.appspot.com/subscribe',
        expect.stringContaining('hub.mode=unsubscribe'),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      expect(monitorApp.subscriptionActive).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Successfully unsubscribed from PubSubHubbub',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
    });

    it('should send correct unsubscription parameters', async () => {
      const mockResponse = { status: 202 };
      mockHttpService.post.mockResolvedValue(mockResponse);
      mockHttpService.isSuccessResponse.mockReturnValue(true);

      await monitorApp.unsubscribeFromPubSubHubbub();

      const [, unsubscriptionData] = mockHttpService.post.mock.calls[0];
      expect(unsubscriptionData).toContain('hub.callback=https%3A%2F%2Fexample.com%2Fwebhook');
      expect(unsubscriptionData).toContain(
        'hub.topic=https%3A%2F%2Fwww.youtube.com%2Fxml%2Ffeeds%2Fvideos.xml%3Fchannel_id%3DUCTestChannel'
      );
      expect(unsubscriptionData).toContain('hub.verify=async');
      expect(unsubscriptionData).toContain('hub.mode=unsubscribe');
      expect(unsubscriptionData).toContain('hub.verify_token=verify-token');
    });

    it('should handle unsubscription failure gracefully', async () => {
      const mockResponse = { status: 400 };
      mockHttpService.post.mockResolvedValue(mockResponse);
      mockHttpService.isSuccessResponse.mockReturnValue(false);

      await monitorApp.unsubscribeFromPubSubHubbub();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unsubscription failed with status: 400',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
      // Should not throw an error for unsubscription failures
    });

    it('should handle HTTP request errors gracefully', async () => {
      const error = new Error('Network error');
      mockHttpService.post.mockRejectedValue(error);

      await monitorApp.unsubscribeFromPubSubHubbub();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'PubSubHubbub unsubscription failed:',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
      // Should not throw an error for unsubscription failures
    });
  });

  describe('scheduleSubscriptionRenewal method', () => {
    it('should schedule subscription renewal', () => {
      jest.spyOn(monitorApp, 'subscribeToPubSubHubbub').mockResolvedValue();
      monitorApp.isRunning = true;
      monitorApp.subscriptionActive = true;

      monitorApp.scheduleSubscriptionRenewal();

      // Fast forward to renewal time (20 hours)
      jest.advanceTimersByTime(20 * 60 * 60 * 1000);

      expect(monitorApp.subscribeToPubSubHubbub).toHaveBeenCalled();
    });

    it('should not renew if monitor is not running', async () => {
      jest.spyOn(monitorApp, 'subscribeToPubSubHubbub').mockResolvedValue();
      monitorApp.isRunning = false;
      monitorApp.subscriptionActive = true;

      monitorApp.scheduleSubscriptionRenewal();

      // Fast forward to renewal time
      jest.advanceTimersByTime(20 * 60 * 60 * 1000);
      await Promise.resolve(); // Allow promises to resolve

      expect(monitorApp.subscribeToPubSubHubbub).not.toHaveBeenCalled();
    });

    it('should not renew if subscription is not active', async () => {
      jest.spyOn(monitorApp, 'subscribeToPubSubHubbub').mockResolvedValue();
      monitorApp.isRunning = true;
      monitorApp.subscriptionActive = false;

      monitorApp.scheduleSubscriptionRenewal();

      // Fast forward to renewal time
      jest.advanceTimersByTime(20 * 60 * 60 * 1000);
      await Promise.resolve();

      expect(monitorApp.subscribeToPubSubHubbub).not.toHaveBeenCalled();
    });

    it('should handle renewal errors gracefully', async () => {
      const error = new Error('Renewal failed');
      jest.spyOn(monitorApp, 'subscribeToPubSubHubbub').mockRejectedValue(error);
      monitorApp.isRunning = true;
      monitorApp.subscriptionActive = true;

      monitorApp.scheduleSubscriptionRenewal();

      // Fast forward to renewal time
      jest.advanceTimersByTime(20 * 60 * 60 * 1000);
      await Promise.resolve();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Subscription renewal failed:',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
    });
  });

  describe('handleVerificationRequest method', () => {
    it('should handle valid verification request', () => {
      const query = {
        'hub.challenge': 'test-challenge-123',
        'hub.verify_token': 'verify-token',
        'hub.mode': 'subscribe',
      };

      const result = monitorApp.handleVerificationRequest(query);

      expect(result).toEqual({
        status: 200,
        body: 'test-challenge-123',
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'PubSubHubbub verification successful (mode: subscribe)',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
    });

    it('should reject request with invalid verify token', () => {
      const query = {
        'hub.challenge': 'test-challenge-123',
        'hub.verify_token': 'wrong-token',
        'hub.mode': 'subscribe',
      };

      const result = monitorApp.handleVerificationRequest(query);

      expect(result).toEqual({
        status: 403,
        message: 'Invalid verify token',
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Verification token mismatch',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
    });

    it('should handle unsubscribe verification', () => {
      const query = {
        'hub.challenge': 'unsubscribe-challenge',
        'hub.verify_token': 'verify-token',
        'hub.mode': 'unsubscribe',
      };

      const result = monitorApp.handleVerificationRequest(query);

      expect(result).toEqual({
        status: 200,
        body: 'unsubscribe-challenge',
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'PubSubHubbub verification successful (mode: unsubscribe)',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
    });
  });

  describe('logWebhookDebug method', () => {
    it('should not log when debugging is disabled', () => {
      monitorApp.webhookDebugEnabled = false;

      monitorApp.logWebhookDebug('TEST MESSAGE', { data: 'test' });

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should log when debugging is enabled', () => {
      monitorApp.webhookDebugEnabled = true;

      monitorApp.logWebhookDebug('TEST MESSAGE', { data: 'test' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WEBHOOK-DEBUG] TEST MESSAGE',
        expect.objectContaining({
          webhookDebug: true,
          timestamp: expect.any(Number),
          data: 'test',
          module: 'youtube',
        })
      );
    });

    it('should handle missing data parameter', () => {
      monitorApp.webhookDebugEnabled = true;

      monitorApp.logWebhookDebug('TEST MESSAGE');

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WEBHOOK-DEBUG] TEST MESSAGE',
        expect.objectContaining({
          webhookDebug: true,
          timestamp: expect.any(Number),
          module: 'youtube',
        })
      );
    });
  });
});
