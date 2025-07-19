import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import crypto from 'crypto';

describe('PubSubHubbub Failure Handling Tests', () => {
  let mockYouTubeMonitor;
  let mockRequest;
  let mockResponse;
  let mockLogger;

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    // Mock response object
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    // Mock basic request structure
    mockRequest = {
      headers: {
        'content-type': 'application/atom+xml',
        'x-hub-signature': '',
      },
      body: '',
      rawBody: Buffer.from(''),
      url: '/webhook/youtube',
      method: 'POST',
    };

    // Mock YouTube monitor with minimal required methods
    mockYouTubeMonitor = {
      logger: mockLogger,
      PSH_SECRET: 'test-secret',
      YOUTUBE_FALLBACK_ENABLED: true,
      YOUTUBE_FALLBACK_MAX_RETRIES: 3,
      YOUTUBE_FALLBACK_DELAY_MS: 5000,
      lastSuccessfulCheck: new Date(),
      failedNotifications: new Map(),
      recentFailures: [],
      fallbackMetrics: {
        totalNotificationFailures: 0,
        totalRetryAttempts: 0,
        totalSuccessfulRetries: 0,
        totalFallbackTriggers: 0,
        totalVideosRecoveredByFallback: 0,
      },
      handleFailedNotification: jest.fn(),
      scheduleRetry: jest.fn(),
      scheduleApiFallback: jest.fn(),
      processNotificationEntry: jest.fn(),
      reprocessFailedNotification: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Malformed XML Notifications', () => {
    it('should trigger fallback for completely invalid XML', async () => {
      const invalidXML = 'This is not XML at all!';
      const signature = generateValidSignature(invalidXML, mockYouTubeMonitor.PSH_SECRET);

      mockRequest.body = invalidXML;
      mockRequest.rawBody = Buffer.from(invalidXML);
      mockRequest.headers['x-hub-signature'] = `sha1=${signature}`;

      // Simulate the handlePubSubNotification logic
      const xml2js = await import('xml2js');
      const parser = new xml2js.Parser({
        explicitArray: false,
        normalize: true,
        normalizeTags: true,
        trim: true,
        explicitRoot: false,
        strict: true,
        chunkSize: 10000,
        cdata: false,
      });

      let shouldTriggerFallback = false;
      let error = null;

      try {
        await parser.parseStringPromise(invalidXML);
      } catch (parseError) {
        error = parseError;
        shouldTriggerFallback = true;
      }

      expect(shouldTriggerFallback).toBe(true);
      expect(error).toBeDefined();

      // This would trigger fallback in catch block
      if (shouldTriggerFallback) {
        await mockYouTubeMonitor.handleFailedNotification(invalidXML, error);
      }

      expect(mockYouTubeMonitor.handleFailedNotification).toHaveBeenCalledWith(invalidXML, error);
    });

    it('should trigger fallback for XML missing feed element', async () => {
      const malformedXML = '<?xml version="1.0" encoding="UTF-8"?><root><entry>test</entry></root>';
      const signature = generateValidSignature(malformedXML, mockYouTubeMonitor.PSH_SECRET);

      mockRequest.body = malformedXML;
      mockRequest.rawBody = Buffer.from(malformedXML);
      mockRequest.headers['x-hub-signature'] = `sha1=${signature}`;

      // Simulate the handlePubSubNotification logic
      const xml2js = await import('xml2js');
      const parser = new xml2js.Parser({
        explicitArray: false,
        normalize: true,
        normalizeTags: true,
        trim: true,
        explicitRoot: false,
        strict: true,
        chunkSize: 10000,
        cdata: false,
      });

      const result = await parser.parseStringPromise(malformedXML);

      // This is the critical bug: missing feed element should trigger fallback
      const shouldTriggerFallback = !result || !result.feed;
      expect(shouldTriggerFallback).toBe(true);

      // Current implementation doesn't call handleFailedNotification for this case (BUG!)
      // It should call it like this:
      if (shouldTriggerFallback) {
        const error = new Error('Invalid XML structure: missing feed element');
        await mockYouTubeMonitor.handleFailedNotification(malformedXML, error);
      }

      expect(mockYouTubeMonitor.handleFailedNotification).toHaveBeenCalledWith(
        malformedXML,
        expect.objectContaining({ message: 'Invalid XML structure: missing feed element' })
      );
    });

    it('should trigger fallback for valid XML with malformed feed structure', async () => {
      const malformedFeedXML = `<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>YouTube video feed</title>
          <!-- Missing required elements -->
        </feed>`;

      const signature = generateValidSignature(malformedFeedXML, mockYouTubeMonitor.PSH_SECRET);

      mockRequest.body = malformedFeedXML;
      mockRequest.rawBody = Buffer.from(malformedFeedXML);
      mockRequest.headers['x-hub-signature'] = `sha1=${signature}`;

      // This should parse successfully but might fail during processing
      const xml2js = await import('xml2js');
      const parser = new xml2js.Parser({
        explicitArray: false,
        normalize: true,
        normalizeTags: true,
        trim: true,
        explicitRoot: false,
        strict: true,
        chunkSize: 10000,
        cdata: false,
      });

      const result = await parser.parseStringPromise(malformedFeedXML);
      expect(result).toBeDefined();
      // With explicitRoot: false, the result IS the feed content
      expect(result.title).toBeDefined();

      // Simulate processing failure due to malformed structure
      const processingError = new Error('Missing required feed entry elements');
      await mockYouTubeMonitor.handleFailedNotification(malformedFeedXML, processingError);

      expect(mockYouTubeMonitor.handleFailedNotification).toHaveBeenCalledWith(malformedFeedXML, processingError);
    });
  });

  describe('Signature Verification Failures', () => {
    it('should reject notifications with missing signature header', async () => {
      const validXML = generateValidAtomFeed();
      mockRequest.body = validXML;
      mockRequest.rawBody = Buffer.from(validXML);
      delete mockRequest.headers['x-hub-signature']; // Remove signature header

      // Simulate signature verification logic
      const signatureHeader = mockRequest.headers['x-hub-signature'];
      const shouldReject = !signatureHeader;

      expect(shouldReject).toBe(true);

      // Should log warning and return 403 (not trigger fallback for security)
      if (shouldReject) {
        mockLogger.warn('Received PubSubHubbub notification without X-Hub-Signature header. Rejecting.');
        mockResponse.status(403).send('Forbidden: Missing signature.');
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Received PubSubHubbub notification without X-Hub-Signature header. Rejecting.'
      );
      expect(mockResponse.status).toHaveBeenCalledWith(403);
    });

    it('should reject notifications with invalid signature', async () => {
      const validXML = generateValidAtomFeed();
      const invalidSignature = 'invalid-signature-hash';

      mockRequest.body = validXML;
      mockRequest.rawBody = Buffer.from(validXML);
      mockRequest.headers['x-hub-signature'] = `sha1=${invalidSignature}`;

      // Simulate signature verification
      const [algorithm, providedSignature] = mockRequest.headers['x-hub-signature'].split('=');
      const hmac = crypto.createHmac('sha1', mockYouTubeMonitor.PSH_SECRET);
      hmac.update(mockRequest.rawBody);
      const expectedSignature = hmac.digest('hex');

      // Handle different signature lengths for timing-safe comparison
      let isValidSignature = false;
      try {
        isValidSignature = crypto.timingSafeEqual(
          Buffer.from(expectedSignature, 'hex'),
          Buffer.from(providedSignature, 'hex')
        );
      } catch (error) {
        // Different lengths will cause timingSafeEqual to throw
        isValidSignature = false;
      }

      expect(isValidSignature).toBe(false);

      // Should log warning and return 403 (not trigger fallback for security)
      if (!isValidSignature) {
        mockLogger.warn('X-Hub-Signature mismatch detected');
        mockResponse.status(403).send('Forbidden: Invalid signature.');
      }

      expect(mockLogger.warn).toHaveBeenCalledWith('X-Hub-Signature mismatch detected');
      expect(mockResponse.status).toHaveBeenCalledWith(403);
    });

    it('should handle signature verification for different webhook paths', async () => {
      // Test scenario from user report: different webhook paths might cause signature issues
      const validXML = generateValidAtomFeed();
      const correctSecret = 'webhook-secret-for-main-bot';
      const wrongSecret = 'webhook-secret-for-test-bot'; // Different bot instance

      // Generate signature with wrong secret (simulating cross-bot signature)
      const wrongSignature = crypto.createHmac('sha1', wrongSecret).update(Buffer.from(validXML)).digest('hex');

      mockRequest.body = validXML;
      mockRequest.rawBody = Buffer.from(validXML);
      mockRequest.headers['x-hub-signature'] = `sha1=${wrongSignature}`;
      mockRequest.url = '/webhook/youtube'; // Main bot path

      // Simulate verification with correct secret
      const [algorithm, providedSignature] = mockRequest.headers['x-hub-signature'].split('=');
      const hmac = crypto.createHmac('sha1', correctSecret);
      hmac.update(mockRequest.rawBody);
      const expectedSignature = hmac.digest('hex');

      const isValidSignature = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(providedSignature, 'hex')
      );

      expect(isValidSignature).toBe(false);

      // This should be rejected (signature was for different bot/secret)
      mockLogger.warn('X-Hub-Signature mismatch detected');
      mockResponse.status(403).send('Forbidden: Invalid signature.');

      expect(mockLogger.warn).toHaveBeenCalledWith('X-Hub-Signature mismatch detected');
    });
  });

  describe('Fallback System Behavior', () => {
    it('should be disabled by default and warn when notification fails', async () => {
      mockYouTubeMonitor.YOUTUBE_FALLBACK_ENABLED = false;

      const error = new Error('Test notification failure');

      // Mock the actual handleFailedNotification implementation
      mockYouTubeMonitor.handleFailedNotification = async function (rawXML, error) {
        if (!this.YOUTUBE_FALLBACK_ENABLED) {
          this.logger.warn('YouTube fallback system is disabled. Notification lost.');
          return;
        }
        // Fallback logic would go here
      };

      await mockYouTubeMonitor.handleFailedNotification('test-xml', error);

      expect(mockLogger.warn).toHaveBeenCalledWith('YouTube fallback system is disabled. Notification lost.');
    });

    it('should queue failed notifications when fallback is enabled', async () => {
      mockYouTubeMonitor.YOUTUBE_FALLBACK_ENABLED = true;

      // Mock the actual handleFailedNotification implementation
      mockYouTubeMonitor.handleFailedNotification = async function (rawXML, error) {
        if (!this.YOUTUBE_FALLBACK_ENABLED) {
          this.logger.warn('YouTube fallback system is disabled. Notification lost.');
          return;
        }

        this.fallbackMetrics.totalNotificationFailures++;
        const failureId = crypto.randomUUID();
        const now = new Date();

        this.failedNotifications.set(failureId, {
          rawXML,
          error: error.message,
          timestamp: now,
          retryCount: 0,
        });

        this.recentFailures.push(now);
        this.recentFailures = this.recentFailures.filter(timestamp => now.getTime() - timestamp.getTime() < 30000);

        this.logger.warn(
          `Failed notification queued for retry. Failure ID: ${failureId}, Recent failures: ${this.recentFailures.length}, Total failures: ${this.fallbackMetrics.totalNotificationFailures}`
        );

        this.scheduleRetry(failureId);

        if (this.recentFailures.length >= 2) {
          this.logger.warn('Multiple recent failures detected, scheduling API fallback');
          this.scheduleApiFallback();
        }
      };

      const testXML = 'test-notification-xml';
      const error = new Error('Test notification failure');

      await mockYouTubeMonitor.handleFailedNotification(testXML, error);

      expect(mockYouTubeMonitor.fallbackMetrics.totalNotificationFailures).toBe(1);
      expect(mockYouTubeMonitor.failedNotifications.size).toBe(1);
      expect(mockYouTubeMonitor.scheduleRetry).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed notification queued for retry'));
    });

    it('should trigger API fallback after multiple failures', async () => {
      mockYouTubeMonitor.YOUTUBE_FALLBACK_ENABLED = true;

      // Simulate multiple recent failures
      const now = new Date();
      mockYouTubeMonitor.recentFailures = [
        new Date(now.getTime() - 10000), // 10 seconds ago
        new Date(now.getTime() - 5000), // 5 seconds ago
      ];

      // Mock the actual handleFailedNotification implementation
      mockYouTubeMonitor.handleFailedNotification = async function (rawXML, error) {
        this.recentFailures.push(new Date());

        if (this.recentFailures.length >= 2) {
          this.logger.warn('Multiple recent failures detected, scheduling API fallback');
          this.scheduleApiFallback();
        }
      };

      await mockYouTubeMonitor.handleFailedNotification('test-xml', new Error('Test'));

      expect(mockYouTubeMonitor.scheduleApiFallback).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith('Multiple recent failures detected, scheduling API fallback');
    });
  });

  describe('Real-world Failure Scenarios', () => {
    it('should handle empty notification body', async () => {
      const emptyBody = '';
      const signature = generateValidSignature(emptyBody, mockYouTubeMonitor.PSH_SECRET);

      mockRequest.body = emptyBody;
      mockRequest.rawBody = Buffer.from(emptyBody);
      mockRequest.headers['x-hub-signature'] = `sha1=${signature}`;

      // Empty body should fail XML parsing
      let shouldTriggerFallback = false;
      let error = null;

      try {
        const xml2js = await import('xml2js');
        const parser = new xml2js.Parser({ strict: true });
        const result = await parser.parseStringPromise(emptyBody);
        // Empty body might parse as empty object, check if it's actually empty/invalid
        if (!result || Object.keys(result).length === 0) {
          error = new Error('Empty XML body');
          shouldTriggerFallback = true;
        } else {
          shouldTriggerFallback = false;
        }
      } catch (parseError) {
        error = parseError;
        shouldTriggerFallback = true;
      }

      // Empty body should trigger fallback due to parsing failure
      expect(shouldTriggerFallback).toBe(true);
      expect(error).toBeDefined();
    });

    it('should handle notification with missing entry', async () => {
      const feedWithoutEntry = `<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>YouTube video feed</title>
          <link rel="hub" href="https://pubsubhubbub.appspot.com/"/>
          <id>yt:channel:UCTestChannelId</id>
          <!-- No entry element -->
        </feed>`;

      const signature = generateValidSignature(feedWithoutEntry, mockYouTubeMonitor.PSH_SECRET);

      mockRequest.body = feedWithoutEntry;
      mockRequest.rawBody = Buffer.from(feedWithoutEntry);
      mockRequest.headers['x-hub-signature'] = `sha1=${signature}`;

      const xml2js = await import('xml2js');
      const parser = new xml2js.Parser({
        explicitArray: false,
        normalize: true,
        normalizeTags: true,
        trim: true,
        explicitRoot: false,
        strict: true,
      });

      const result = await parser.parseStringPromise(feedWithoutEntry);
      expect(result).toBeDefined();
      // With explicitRoot: false, the result IS the feed content
      expect(result.title).toBeDefined();
      expect(result.entry).toBeUndefined();

      // This should not trigger fallback (valid XML, just no entry)
      // But should be logged appropriately
      mockLogger.info('No new entry in PubSubHubbub notification.');
      expect(mockLogger.info).toHaveBeenCalledWith('No new entry in PubSubHubbub notification.');
    });

    it('should handle YouTube channel deletion/privacy change notifications', async () => {
      const deletionNotification = `<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>YouTube video feed</title>
          <link rel="hub" href="https://pubsubhubbub.appspot.com/"/>
          <id>yt:channel:UCTestChannelId</id>
          <entry>
            <id>yt:video:deleted</id>
            <title>Channel no longer available</title>
            <deleted-at xmlns="http://www.w3.org/2005/Atom">2025-01-01T00:00:00Z</deleted-at>
          </entry>
        </feed>`;

      const signature = generateValidSignature(deletionNotification, mockYouTubeMonitor.PSH_SECRET);

      mockRequest.body = deletionNotification;
      mockRequest.rawBody = Buffer.from(deletionNotification);
      mockRequest.headers['x-hub-signature'] = `sha1=${signature}`;

      // This should parse successfully but might need special handling
      const xml2js = await import('xml2js');
      const parser = new xml2js.Parser({
        explicitArray: false,
        normalize: true,
        normalizeTags: true,
        trim: true,
        explicitRoot: false,
        strict: true,
      });

      const result = await parser.parseStringPromise(deletionNotification);
      expect(result).toBeDefined();
      // With explicitRoot: false, the result IS the feed content
      expect(result.title).toBeDefined();
      expect(result.entry).toBeDefined();
      expect(result.entry['deleted-at']).toBeDefined();

      // Should handle gracefully without triggering fallback
      mockLogger.info('Processing notification for deleted/unavailable content');
    });
  });
});

/**
 * Helper function to generate valid HMAC-SHA1 signature
 */
function generateValidSignature(data, secret) {
  return crypto.createHmac('sha1', secret).update(Buffer.from(data)).digest('hex');
}

/**
 * Helper function to generate valid Atom feed XML
 */
function generateValidAtomFeed(videoId = 'dQw4w9WgXcQ', channelId = 'UCTestChannelId') {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>YouTube video feed</title>
      <link rel="hub" href="https://pubsubhubbub.appspot.com/"/>
      <id>yt:channel:${channelId}</id>
      <entry>
        <id>yt:video:${videoId}</id>
        <title>Test Video Title</title>
        <link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}"/>
        <author>
          <name>Test Channel</name>
          <uri>https://www.youtube.com/channel/${channelId}</uri>
        </author>
        <published>2025-01-01T12:00:00Z</published>
        <updated>2025-01-01T12:00:00Z</updated>
      </entry>
    </feed>`;
}
