import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MonitorApplication } from '../../src/application/monitor-application.js';

describe('MonitorApplication', () => {
  let monitorApp;
  let mockYoutubeService;
  let mockHttpService;
  let mockContentClassifier;
  let mockContentAnnouncer;
  let mockConfig;
  let mockStateManager;
  let mockEventBus;
  let mockLogger;

  beforeEach(() => {
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
    mockConfig.get.mockReturnValue('test-secret');
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

    const dependencies = {
      youtubeService: mockYoutubeService,
      httpService: mockHttpService,
      contentClassifier: mockContentClassifier,
      contentAnnouncer: mockContentAnnouncer,
      config: mockConfig,
      stateManager: mockStateManager,
      eventBus: mockEventBus,
      logger: mockLogger,
      persistentStorage: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
    };

    monitorApp = new MonitorApplication(dependencies);
  });

  describe('handleWebhook', () => {
    it('should increment xmlParseFailures when XML is malformed', async () => {
      jest.spyOn(monitorApp, 'verifyWebhookSignatureDebug').mockReturnValue({ isValid: true, details: {} });
      jest.spyOn(monitorApp, 'parseNotificationXML').mockReturnValue(null);
      jest.spyOn(monitorApp, 'logWebhookDebug').mockImplementation(() => {});
      jest.spyOn(monitorApp, 'sanitizeHeaders').mockReturnValue({});
      jest.spyOn(monitorApp, 'getBodyPreview').mockReturnValue('preview');

      const request = {
        body: '<xml>malformed</xml>',
        headers: { 'x-hub-signature': 'sha1=test' },
        method: 'POST',
      };

      const result = await monitorApp.handleWebhook(request);

      expect(monitorApp.stats.xmlParseFailures).toBe(1);
      expect(result.status).toBe(400);
      expect(result.message).toBe('Invalid XML');
    });

    it('should trigger API fallback when notification processing fails', async () => {
      jest.spyOn(monitorApp, 'verifyWebhookSignatureDebug').mockReturnValue({ isValid: true, details: {} });
      jest.spyOn(monitorApp, 'parseNotificationXML').mockReturnValue({ videoId: 'test123' });
      jest.spyOn(monitorApp, 'scheduleApiFallback').mockImplementation(() => {});
      jest.spyOn(monitorApp, 'logWebhookDebug').mockImplementation(() => {});
      jest.spyOn(monitorApp, 'sanitizeHeaders').mockReturnValue({});
      jest.spyOn(monitorApp, 'getBodyPreview').mockReturnValue('preview');
      mockYoutubeService.getVideoDetails.mockRejectedValue(new Error('API Error'));

      const request = {
        body: '<xml>valid</xml>',
        headers: { 'x-hub-signature': 'sha1=test' },
        method: 'POST',
      };

      await monitorApp.handleWebhook(request);

      expect(monitorApp.scheduleApiFallback).toHaveBeenCalled();
    });

    it('should NOT trigger API fallback when notification processing succeeds', async () => {
      jest.spyOn(monitorApp, 'verifyWebhookSignatureDebug').mockReturnValue({ isValid: true, details: {} });
      jest.spyOn(monitorApp, 'parseNotificationXML').mockReturnValue({ videoId: 'test123' });
      jest.spyOn(monitorApp, 'scheduleApiFallback').mockImplementation(() => {});
      jest.spyOn(monitorApp, 'processVideo').mockResolvedValue();
      jest.spyOn(monitorApp, 'logWebhookDebug').mockImplementation(() => {});
      jest.spyOn(monitorApp, 'sanitizeHeaders').mockReturnValue({});
      jest.spyOn(monitorApp, 'getBodyPreview').mockReturnValue('preview');
      mockYoutubeService.getVideoDetails.mockResolvedValue({
        id: 'test123',
        snippet: { title: 'Test Video' },
      });

      const request = {
        body: '<xml>valid</xml>',
        headers: { 'x-hub-signature': 'sha1=test' },
        method: 'POST',
      };

      await monitorApp.handleWebhook(request);

      expect(monitorApp.scheduleApiFallback).not.toHaveBeenCalled();
    });

    it('should handle GET verification requests', async () => {
      jest.spyOn(monitorApp, 'verifyWebhookSignatureDebug').mockReturnValue({ isValid: true, details: {} });
      jest.spyOn(monitorApp, 'handleVerificationRequest').mockReturnValue({ status: 200, message: 'verified' });
      jest.spyOn(monitorApp, 'logWebhookDebug').mockImplementation(() => {});
      jest.spyOn(monitorApp, 'sanitizeHeaders').mockReturnValue({});

      const request = {
        headers: { 'x-hub-signature': 'sha1=test' },
        method: 'GET',
        query: { 'hub.challenge': 'test123' },
      };

      const result = await monitorApp.handleWebhook(request);

      expect(monitorApp.handleVerificationRequest).toHaveBeenCalledWith(request.query);
      expect(result.status).toBe(200);
      expect(result.message).toBe('verified');
    });

    it('should reject requests with invalid signatures', async () => {
      jest.spyOn(monitorApp, 'verifyWebhookSignatureDebug').mockReturnValue({
        isValid: false,
        details: { error: 'invalid signature' },
      });
      jest.spyOn(monitorApp, 'logWebhookDebug').mockImplementation(() => {});
      jest.spyOn(monitorApp, 'sanitizeHeaders').mockReturnValue({});

      const request = {
        body: '<xml>test</xml>',
        headers: { 'x-hub-signature': 'sha1=invalid' },
        method: 'POST',
      };

      const result = await monitorApp.handleWebhook(request);

      expect(result.status).toBe(403);
      expect(result.message).toBe('Invalid signature');
    });
  });

  describe('scheduleApiFallback', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should schedule API fallback when enabled', () => {
      monitorApp.fallbackEnabled = true;
      jest.spyOn(monitorApp, 'performApiFallback');

      monitorApp.scheduleApiFallback();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Scheduling API fallback due to notification processing failure',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
      expect(monitorApp.fallbackTimerId).toBeTruthy();

      // Fast forward the timer
      jest.advanceTimersByTime(30000);

      expect(monitorApp.performApiFallback).toHaveBeenCalled();
    });

    it('should not schedule API fallback when disabled', () => {
      monitorApp.fallbackEnabled = false;
      jest.spyOn(monitorApp, 'performApiFallback');

      monitorApp.scheduleApiFallback();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'API fallback is disabled',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
      expect(monitorApp.fallbackTimerId).toBeNull();
      expect(monitorApp.performApiFallback).not.toHaveBeenCalled();
    });

    it('should not schedule multiple fallbacks simultaneously', () => {
      monitorApp.fallbackEnabled = true;
      monitorApp.fallbackTimerId = 'existing-timer';

      monitorApp.scheduleApiFallback();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'API fallback already scheduled, skipping',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
    });

    it('should clear timer ID after fallback execution', async () => {
      monitorApp.fallbackEnabled = true;
      jest.spyOn(monitorApp, 'performApiFallback').mockResolvedValue();

      monitorApp.scheduleApiFallback();
      expect(monitorApp.fallbackTimerId).toBeTruthy();

      // Fast forward the timer
      jest.advanceTimersByTime(30000);
      await Promise.resolve(); // Wait for async completion

      expect(monitorApp.fallbackTimerId).toBeNull();
    });

    it('should clear timer ID even when fallback execution fails', async () => {
      monitorApp.fallbackEnabled = true;
      jest.spyOn(monitorApp, 'performApiFallback').mockRejectedValue(new Error('Fallback failed'));

      monitorApp.scheduleApiFallback();
      expect(monitorApp.fallbackTimerId).toBeTruthy();

      // Fast forward the timer
      jest.advanceTimersByTime(30000);
      await Promise.resolve(); // Wait for async completion

      expect(monitorApp.fallbackTimerId).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'API fallback execution failed:',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
    });
  });

  describe('performApiFallback', () => {
    it('should fetch and process videos from YouTube API', async () => {
      const mockVideos = [
        {
          id: 'video1',
          snippet: { title: 'Video 1', publishedAt: '2023-01-01T00:00:00Z' },
        },
        {
          id: 'video2',
          snippet: { title: 'Video 2', publishedAt: '2023-01-02T00:00:00Z' },
        },
      ];

      mockYoutubeService.getChannelVideos.mockResolvedValue(mockVideos);
      jest.spyOn(monitorApp, 'processVideo').mockResolvedValue();

      await monitorApp.performApiFallback();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Performing API fallback check due to notification failure...',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
      expect(mockYoutubeService.getChannelVideos).toHaveBeenCalledWith(monitorApp.youtubeChannelId, 5);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'API fallback found 2 videos from YouTube API.',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
      expect(monitorApp.processVideo).toHaveBeenCalledTimes(2);
      expect(monitorApp.processVideo).toHaveBeenCalledWith(mockVideos[0], 'api-fallback');
      expect(monitorApp.processVideo).toHaveBeenCalledWith(mockVideos[1], 'api-fallback');
      expect(monitorApp.stats.fallbackPolls).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'API fallback check completed successfully',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
    });

    it('should handle case when no videos are found', async () => {
      mockYoutubeService.getChannelVideos.mockResolvedValue([]);
      jest.spyOn(monitorApp, 'processVideo');

      await monitorApp.performApiFallback();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'No videos found in API fallback check',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
      expect(monitorApp.processVideo).not.toHaveBeenCalled();
      expect(monitorApp.stats.fallbackPolls).toBe(1);
    });

    it('should handle null response from YouTube API', async () => {
      mockYoutubeService.getChannelVideos.mockResolvedValue(null);
      jest.spyOn(monitorApp, 'processVideo');

      await monitorApp.performApiFallback();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'No videos found in API fallback check',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
      expect(monitorApp.processVideo).not.toHaveBeenCalled();
    });

    it('should continue processing other videos when one fails', async () => {
      const mockVideos = [
        {
          id: 'video1',
          snippet: { title: 'Video 1' },
        },
        {
          id: 'video2',
          snippet: { title: 'Video 2' },
        },
      ];

      mockYoutubeService.getChannelVideos.mockResolvedValue(mockVideos);
      jest
        .spyOn(monitorApp, 'processVideo')
        .mockRejectedValueOnce(new Error('Processing failed'))
        .mockResolvedValueOnce();

      await monitorApp.performApiFallback();

      expect(monitorApp.processVideo).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error processing video video1 in API fallback:',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'API fallback check completed successfully',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
    });

    it('should throw error when YouTube API call fails', async () => {
      const apiError = new Error('YouTube API quota exceeded');
      mockYoutubeService.getChannelVideos.mockRejectedValue(apiError);

      await expect(monitorApp.performApiFallback()).rejects.toThrow('YouTube API quota exceeded');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'API fallback check failed:',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
      expect(monitorApp.stats.fallbackPolls).toBe(1);
    });
  });

  describe('start - No Automatic Polling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      mockYoutubeService.getChannelDetails.mockResolvedValue({
        snippet: { title: 'Test Channel' },
      });
      jest.spyOn(monitorApp, 'subscribeToPubSubHubbub').mockResolvedValue();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should NOT start automatic fallback polling on startup', async () => {
      jest.spyOn(monitorApp, 'performApiFallback');

      await monitorApp.start();

      // Fast forward through any potential timer delays
      jest.advanceTimersByTime(10 * 60 * 1000); // 10 minutes

      expect(monitorApp.performApiFallback).not.toHaveBeenCalled();
      expect(monitorApp.fallbackTimerId).toBeNull();
    });

    it('should only trigger fallback when explicitly called', async () => {
      jest.spyOn(monitorApp, 'performApiFallback').mockResolvedValue();

      await monitorApp.start();

      // Simulate notification processing error
      monitorApp.scheduleApiFallback();
      jest.advanceTimersByTime(30000);

      expect(monitorApp.performApiFallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopFallbackPolling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should clear scheduled fallback timer', () => {
      monitorApp.fallbackTimerId = setTimeout(() => {}, 30000);

      monitorApp.stopFallbackPolling();

      expect(monitorApp.fallbackTimerId).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Scheduled API fallback cleared',
        expect.objectContaining({
          module: 'youtube',
          timestamp: expect.any(Number),
        })
      );
    });

    it('should do nothing when no timer is scheduled', () => {
      monitorApp.fallbackTimerId = null;

      monitorApp.stopFallbackPolling();

      expect(mockLogger.info).not.toHaveBeenCalledWith('Scheduled API fallback cleared');
    });
  });

  describe('parseNotificationXML', () => {
    it('should parse valid YouTube XML notification', () => {
      const validXml = `
        <feed>
          <yt:videoId>test123</yt:videoId>
          <media:title>Test Video Title</media:title>
          <link rel="alternate" href="https://www.youtube.com/watch?v=test123"/>
        </feed>
      `;

      const result = monitorApp.parseNotificationXML(validXml);

      expect(result).toEqual({
        videoId: 'test123',
        title: 'Test Video Title',
        link: 'https://www.youtube.com/watch?v=test123',
      });
    });

    it('should return null for invalid XML', () => {
      const invalidXml = '<invalid>xml</invalid>';

      const result = monitorApp.parseNotificationXML(invalidXml);

      expect(result).toBeNull();
    });

    it('should return null for XML missing video ID', () => {
      const xmlMissingVideoId = `
        <feed>
          <media:title>Test Video Title</media:title>
          <link rel="alternate" href="https://www.youtube.com/watch?v=test123"/>
        </feed>
      `;

      const result = monitorApp.parseNotificationXML(xmlMissingVideoId);

      expect(result).toBeNull();
    });
  });

  describe('helper methods', () => {
    it('should sanitize headers by removing authorization', () => {
      const headers = {
        'content-type': 'application/xml',
        authorization: 'Bearer secret-token',
        'x-hub-signature': 'sha1=test',
      };

      const result = monitorApp.sanitizeHeaders(headers);

      expect(result).toEqual({
        'content-type': 'application/xml',
        authorization: '[REDACTED]',
        'x-hub-signature': '[SIGNATURE:9chars]',
      });
    });

    it('should return preview of body content', () => {
      const longBody = 'A'.repeat(250);

      const result = monitorApp.getBodyPreview(longBody);

      expect(result).toContain('...');
      expect(result).toContain('[TRUNCATED:250total]');
      expect(result.substring(0, 200)).toBe('A'.repeat(200));
    });

    it('should return full body if short enough', () => {
      const shortBody = 'Short content';

      const result = monitorApp.getBodyPreview(shortBody);

      expect(result).toBe(shortBody);
    });

    it('should handle empty body', () => {
      const result = monitorApp.getBodyPreview(null);

      expect(result).toBe('[EMPTY]');
    });
  });
});
