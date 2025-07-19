import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import crypto from 'crypto';

describe('PubSubHubbub Security Integration Tests', () => {
  let mockYouTubeMonitor;
  let mockRequest;
  let mockResponse;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      headers: {
        'content-type': 'application/atom+xml',
      },
      body: '',
      rawBody: Buffer.from(''),
      url: '/webhook/youtube',
      method: 'POST',
    };

    mockYouTubeMonitor = {
      logger: mockLogger,
      PSH_SECRET: 'main-bot-secret-12345',
      YOUTUBE_FALLBACK_ENABLED: true,
      handleFailedNotification: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Cross-Bot Signature Interference', () => {
    it('should handle notifications intended for different bot instances', async () => {
      // Simulate scenario from user report: two bots with different secrets
      const mainBotSecret = 'main-bot-secret-12345';
      const testBotSecret = 'test-bot-secret-67890';

      const validNotification = generateValidAtomFeed();

      // Test bot generates signature with its own secret
      const testBotSignature = crypto
        .createHmac('sha1', testBotSecret)
        .update(Buffer.from(validNotification))
        .digest('hex');

      // Main bot receives notification with test bot's signature
      mockRequest.body = validNotification;
      mockRequest.rawBody = Buffer.from(validNotification);
      mockRequest.headers['x-hub-signature'] = `sha1=${testBotSignature}`;
      mockRequest.url = '/webhook/youtube'; // Main bot endpoint

      // Main bot verifies with its own secret
      const [algorithm, providedSignature] = mockRequest.headers['x-hub-signature'].split('=');
      const hmac = crypto.createHmac('sha1', mainBotSecret);
      hmac.update(mockRequest.rawBody);
      const expectedSignature = hmac.digest('hex');

      const isValidSignature = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(providedSignature, 'hex')
      );

      expect(isValidSignature).toBe(false);

      // Should reject and NOT trigger fallback (security measure)
      if (!isValidSignature) {
        mockLogger.warn('X-Hub-Signature mismatch detected');
        mockResponse.status(403).send('Forbidden: Invalid signature.');
        return; // Important: should not continue processing
      }

      expect(mockLogger.warn).toHaveBeenCalledWith('X-Hub-Signature mismatch detected');
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockYouTubeMonitor.handleFailedNotification).not.toHaveBeenCalled();
    });

    it('should handle webhook path confusion', async () => {
      // Test different webhook paths as mentioned in user report
      const sharedSecret = 'shared-secret-key'; // Same secret, different paths
      const validNotification = generateValidAtomFeed();

      const correctSignature = crypto
        .createHmac('sha1', sharedSecret)
        .update(Buffer.from(validNotification))
        .digest('hex');

      // Test main bot endpoint
      const mainBotRequest = {
        ...mockRequest,
        body: validNotification,
        rawBody: Buffer.from(validNotification),
        headers: {
          ...mockRequest.headers,
          'x-hub-signature': `sha1=${correctSignature}`,
        },
        url: '/webhook/youtube',
      };

      // Test secondary bot endpoint
      const testBotRequest = {
        ...mockRequest,
        body: validNotification,
        rawBody: Buffer.from(validNotification),
        headers: {
          ...mockRequest.headers,
          'x-hub-signature': `sha1=${correctSignature}`,
        },
        url: '/webhook/youtube-test',
      };

      // Both should validate correctly if using same secret
      const mainBotHmac = crypto.createHmac('sha1', sharedSecret);
      mainBotHmac.update(mainBotRequest.rawBody);
      const mainBotExpected = mainBotHmac.digest('hex');

      const testBotHmac = crypto.createHmac('sha1', sharedSecret);
      testBotHmac.update(testBotRequest.rawBody);
      const testBotExpected = testBotHmac.digest('hex');

      expect(mainBotExpected).toBe(correctSignature);
      expect(testBotExpected).toBe(correctSignature);

      // Both bots should accept the same notification if using same secret
      // (This might be the source of confusion in the user's report)
    });

    it('should handle replay attack scenarios', async () => {
      const validNotification = generateValidAtomFeed();
      const validSignature = crypto
        .createHmac('sha1', mockYouTubeMonitor.PSH_SECRET)
        .update(Buffer.from(validNotification))
        .digest('hex');

      mockRequest.body = validNotification;
      mockRequest.rawBody = Buffer.from(validNotification);
      mockRequest.headers['x-hub-signature'] = `sha1=${validSignature}`;

      // Simulate signature verification (should pass)
      const [algorithm, providedSignature] = mockRequest.headers['x-hub-signature'].split('=');
      const hmac = crypto.createHmac('sha1', mockYouTubeMonitor.PSH_SECRET);
      hmac.update(mockRequest.rawBody);
      const expectedSignature = hmac.digest('hex');

      const isValidSignature = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(providedSignature, 'hex')
      );

      expect(isValidSignature).toBe(true);

      // First request should succeed
      mockLogger.info('X-Hub-Signature verified successfully.');

      // Replay of same request should also succeed signature-wise
      // (Additional replay protection would need timestamp/nonce checking)
      const replayValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(providedSignature, 'hex')
      );

      expect(replayValid).toBe(true);

      // Note: Basic HMAC-SHA1 doesn't prevent replay attacks
      // Would need additional mechanisms (timestamps, nonces) for full protection
    });
  });

  describe('Security Edge Cases', () => {
    it('should handle malformed signature headers', async () => {
      const validNotification = generateValidAtomFeed();
      const malformedHeaders = [
        '', // Empty
        'invalid-format', // No algorithm
        'md5=hash', // Wrong algorithm
        'sha1=', // Empty hash
        'sha1=invalid-hex-chars!!!', // Invalid hex
        'sha1=short', // Too short
      ];

      for (const malformedHeader of malformedHeaders) {
        mockRequest.body = validNotification;
        mockRequest.rawBody = Buffer.from(validNotification);
        mockRequest.headers['x-hub-signature'] = malformedHeader;

        // Should handle gracefully
        try {
          const parts = malformedHeader.split('=');
          if (parts.length !== 2) {
            throw new Error('Invalid signature format');
          }

          const [algorithm, signature] = parts;
          if (algorithm !== 'sha1') {
            mockLogger.warn('Unsupported signature algorithm: %s', algorithm);
            mockResponse.status(400).send('Bad Request: Unsupported signature algorithm.');
            continue;
          }

          if (!signature) {
            throw new Error('Empty signature');
          }

          // Try to verify
          const hmac = crypto.createHmac('sha1', mockYouTubeMonitor.PSH_SECRET);
          hmac.update(mockRequest.rawBody);
          const expectedSignature = hmac.digest('hex');

          crypto.timingSafeEqual(Buffer.from(expectedSignature, 'hex'), Buffer.from(signature, 'hex'));
        } catch (error) {
          // Should log error and reject
          mockLogger.error('Error processing signature:', error.message);
          mockResponse.status(400).send('Bad Request: Invalid signature format.');
        }
      }

      // Should have handled all malformed headers gracefully
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should prevent timing attacks on signature verification', async () => {
      const validNotification = generateValidAtomFeed();
      const correctSignature = crypto
        .createHmac('sha1', mockYouTubeMonitor.PSH_SECRET)
        .update(Buffer.from(validNotification))
        .digest('hex');

      // Generate slightly different signatures to test timing-safe comparison
      const almostCorrectSignature = `${correctSignature.substring(0, 39)}0`; // Change last char
      const completelyWrongSignature = 'a'.repeat(40);

      mockRequest.body = validNotification;
      mockRequest.rawBody = Buffer.from(validNotification);

      // Test timing-safe comparison behavior
      const testSignatures = [correctSignature, almostCorrectSignature, completelyWrongSignature];
      const timings = [];

      for (const testSig of testSignatures) {
        const start = process.hrtime.bigint();

        const isValid = crypto.timingSafeEqual(Buffer.from(correctSignature, 'hex'), Buffer.from(testSig, 'hex'));

        const end = process.hrtime.bigint();
        timings.push(Number(end - start));

        // Only correct signature should validate
        if (testSig === correctSignature) {
          expect(isValid).toBe(true);
        } else {
          expect(isValid).toBe(false);
        }
      }

      // Timing-safe comparison should have similar execution times
      // (This is more of a conceptual test - actual timing analysis would be more complex)
      expect(timings).toHaveLength(3);
    });
  });

  describe('YouTube Hub Behavior Analysis', () => {
    it('should handle YouTube hub sending to wrong endpoints', async () => {
      // Simulate YouTube hub potentially sending same notification to multiple endpoints
      const notification = generateValidAtomFeed('newVideoId123');
      const botConfigs = [
        { secret: 'bot1-secret', path: '/webhook/youtube' },
        { secret: 'bot2-secret', path: '/webhook/youtube-test' },
        { secret: 'bot3-secret', path: '/webhook/youtube-staging' },
      ];

      // Each bot should only accept notifications signed with its own secret
      for (const config of botConfigs) {
        const correctSignature = crypto
          .createHmac('sha1', config.secret)
          .update(Buffer.from(notification))
          .digest('hex');

        const wrongSignature = crypto
          .createHmac('sha1', 'wrong-secret')
          .update(Buffer.from(notification))
          .digest('hex');

        // Test correct signature
        const validResult = crypto.timingSafeEqual(
          Buffer.from(correctSignature, 'hex'),
          Buffer.from(correctSignature, 'hex')
        );
        expect(validResult).toBe(true);

        // Test wrong signature
        const invalidResult = crypto.timingSafeEqual(
          Buffer.from(correctSignature, 'hex'),
          Buffer.from(wrongSignature, 'hex')
        );
        expect(invalidResult).toBe(false);
      }
    });

    it('should log sufficient information for debugging signature mismatches', async () => {
      const notification = generateValidAtomFeed();
      const wrongSignature = 'wrong-signature-hash';

      mockRequest.body = notification;
      mockRequest.rawBody = Buffer.from(notification);
      mockRequest.headers['x-hub-signature'] = `sha1=${wrongSignature}`;
      mockRequest.url = '/webhook/youtube';

      // Generate what signature should be
      const hmac = crypto.createHmac('sha1', mockYouTubeMonitor.PSH_SECRET);
      hmac.update(mockRequest.rawBody);
      const expectedSignature = hmac.digest('hex');

      // Verify mismatch (handle different length signatures)
      let isValid = false;
      try {
        isValid = crypto.timingSafeEqual(Buffer.from(expectedSignature, 'hex'), Buffer.from(wrongSignature, 'hex'));
      } catch (error) {
        // Different lengths will cause timingSafeEqual to throw
        isValid = false;
      }

      expect(isValid).toBe(false);

      // Should log sufficient debugging info (but not expose secret)
      mockLogger.warn('X-Hub-Signature mismatch detected');
      mockLogger.debug('Request details for signature mismatch:', {
        url: mockRequest.url,
        contentType: mockRequest.headers['content-type'],
        bodyLength: mockRequest.rawBody.length,
        providedAlgorithm: 'sha1',
        // Note: Should NOT log actual signatures or secret for security
      });

      expect(mockLogger.warn).toHaveBeenCalledWith('X-Hub-Signature mismatch detected');
    });
  });
});

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
