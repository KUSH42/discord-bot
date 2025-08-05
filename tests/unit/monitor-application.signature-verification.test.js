import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MonitorApplication } from '../../src/application/yt-monitor-application.js';
import crypto from 'crypto';

describe('MonitorApplication - Signature Verification', () => {
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

  describe('verifyWebhookSignatureDebug method', () => {
    const testBody = 'test webhook body content';
    const testSecret = 'test-secret';

    beforeEach(() => {
      monitorApp.webhookSecret = testSecret;
    });

    it('should verify valid webhook signature', () => {
      const expectedSignature = `sha1=${crypto.createHmac('sha1', testSecret).update(testBody).digest('hex')}`;
      const headers = {
        'x-hub-signature': expectedSignature,
      };

      const result = monitorApp.verifyWebhookSignatureDebug(testBody, headers);

      expect(result.isValid).toBe(true);
      expect(result.details).toEqual({
        hasSignatureHeader: true,
        signatureReceived: expectedSignature,
        bodyLength: testBody.length,
        secretConfigured: true,
        secretLength: testSecret.length,
        method: 'HMAC-SHA1',
        expectedSignature,
        signatureMatch: true,
        reason: 'Signature valid',
      });
    });

    it('should reject invalid webhook signature', () => {
      const headers = {
        'x-hub-signature': 'sha1=invalid-signature',
      };

      const result = monitorApp.verifyWebhookSignatureDebug(testBody, headers);

      expect(result.isValid).toBe(false);
      expect(result.details.reason).toContain('Signature comparison failed');
      expect(result.details.signatureMatch).toBe(false);
    });

    it('should reject request with missing signature header', () => {
      const headers = {};

      const result = monitorApp.verifyWebhookSignatureDebug(testBody, headers);

      expect(result.isValid).toBe(false);
      expect(result.details).toEqual({
        hasSignatureHeader: false,
        signatureReceived: 'none',
        bodyLength: testBody.length,
        secretConfigured: true,
        secretLength: testSecret.length,
        method: 'HMAC-SHA1',
        reason: 'No x-hub-signature header provided',
      });
    });

    it('should reject request when webhook secret is not configured', () => {
      monitorApp.webhookSecret = '';
      const headers = {
        'x-hub-signature': 'sha1=some-signature',
      };

      const result = monitorApp.verifyWebhookSignatureDebug(testBody, headers);

      expect(result.isValid).toBe(false);
      expect(result.details.reason).toBe('No webhook secret configured');
      expect(result.details.secretConfigured).toBe(false);
    });

    it('should handle null webhook secret', () => {
      monitorApp.webhookSecret = null;
      const headers = {
        'x-hub-signature': 'sha1=some-signature',
      };

      const result = monitorApp.verifyWebhookSignatureDebug(testBody, headers);

      expect(result.isValid).toBe(false);
      expect(result.details.reason).toBe('No webhook secret configured');
      expect(result.details.secretConfigured).toBe(false);
    });

    it('should handle empty body', () => {
      const emptyBody = '';
      const expectedSignature = `sha1=${crypto.createHmac('sha1', testSecret).update(emptyBody).digest('hex')}`;
      const headers = {
        'x-hub-signature': expectedSignature,
      };

      const result = monitorApp.verifyWebhookSignatureDebug(emptyBody, headers);

      expect(result.isValid).toBe(true);
      expect(result.details.bodyLength).toBe(0);
    });

    it('should handle buffer body', () => {
      const bufferBody = Buffer.from(testBody);
      const expectedSignature = `sha1=${crypto.createHmac('sha1', testSecret).update(bufferBody).digest('hex')}`;
      const headers = {
        'x-hub-signature': expectedSignature,
      };

      const result = monitorApp.verifyWebhookSignatureDebug(bufferBody, headers);

      expect(result.isValid).toBe(true);
      expect(result.details.bodyLength).toBe(bufferBody.length);
    });

    it('should handle crypto.timingSafeEqual errors', () => {
      const headers = {
        'x-hub-signature': 'invalid-format-no-sha1-prefix',
      };

      // Mock crypto.timingSafeEqual to throw an error
      const originalTimingSafeEqual = crypto.timingSafeEqual;
      crypto.timingSafeEqual = jest.fn().mockImplementation(() => {
        throw new Error('Buffer length mismatch');
      });

      const result = monitorApp.verifyWebhookSignatureDebug(testBody, headers);

      expect(result.isValid).toBe(false);
      expect(result.details.reason).toBe('Signature comparison failed: Buffer length mismatch');
      expect(result.details.error).toBe('Buffer length mismatch');

      // Restore original function
      crypto.timingSafeEqual = originalTimingSafeEqual;
    });

    it('should include all debug details in response', () => {
      const signature = 'sha1=test-signature';
      const headers = {
        'x-hub-signature': signature,
      };

      const result = monitorApp.verifyWebhookSignatureDebug(testBody, headers);

      expect(result.details).toEqual(
        expect.objectContaining({
          hasSignatureHeader: true,
          signatureReceived: signature,
          bodyLength: testBody.length,
          secretConfigured: true,
          secretLength: testSecret.length,
          method: 'HMAC-SHA1',
          expectedSignature: expect.stringContaining('sha1='),
          signatureMatch: expect.any(Boolean),
          reason: expect.any(String),
        })
      );
    });
  });

  describe('verifyWebhookSignature method (legacy)', () => {
    it('should delegate to verifyWebhookSignatureDebug and return isValid', () => {
      const mockResult = { isValid: true, details: {} };
      jest.spyOn(monitorApp, 'verifyWebhookSignatureDebug').mockReturnValue(mockResult);

      const testBody = 'test body';
      const testHeaders = { 'x-hub-signature': 'sha1=test' };

      const result = monitorApp.verifyWebhookSignature(testBody, testHeaders);

      expect(result).toBe(true);
      expect(monitorApp.verifyWebhookSignatureDebug).toHaveBeenCalledWith(testBody, testHeaders);
    });

    it('should return false for invalid signature', () => {
      const mockResult = { isValid: false, details: { reason: 'Invalid' } };
      jest.spyOn(monitorApp, 'verifyWebhookSignatureDebug').mockReturnValue(mockResult);

      const result = monitorApp.verifyWebhookSignature('test', {});

      expect(result).toBe(false);
    });
  });

  describe('Signature verification integration with different body types', () => {
    const testSecret = 'integration-test-secret';

    beforeEach(() => {
      monitorApp.webhookSecret = testSecret;
    });

    it('should handle string bodies correctly', () => {
      const body = '<xml>test content</xml>';
      const expectedSignature = `sha1=${crypto.createHmac('sha1', testSecret).update(body).digest('hex')}`;
      const headers = { 'x-hub-signature': expectedSignature };

      const result = monitorApp.verifyWebhookSignatureDebug(body, headers);

      expect(result.isValid).toBe(true);
    });

    it('should handle buffer bodies correctly', () => {
      const body = Buffer.from('<xml>test content</xml>', 'utf8');
      const expectedSignature = `sha1=${crypto.createHmac('sha1', testSecret).update(body).digest('hex')}`;
      const headers = { 'x-hub-signature': expectedSignature };

      const result = monitorApp.verifyWebhookSignatureDebug(body, headers);

      expect(result.isValid).toBe(true);
    });

    it('should handle large bodies correctly', () => {
      const body = 'A'.repeat(10000); // Large body
      const expectedSignature = `sha1=${crypto.createHmac('sha1', testSecret).update(body).digest('hex')}`;
      const headers = { 'x-hub-signature': expectedSignature };

      const result = monitorApp.verifyWebhookSignatureDebug(body, headers);

      expect(result.isValid).toBe(true);
      expect(result.details.bodyLength).toBe(10000);
    });

    it('should handle special characters in body', () => {
      const body = '<xml>Test with émojis 🎉 and spéciál chars</xml>';
      const expectedSignature = `sha1=${crypto.createHmac('sha1', testSecret).update(body).digest('hex')}`;
      const headers = { 'x-hub-signature': expectedSignature };

      const result = monitorApp.verifyWebhookSignatureDebug(body, headers);

      expect(result.isValid).toBe(true);
    });
  });
});
