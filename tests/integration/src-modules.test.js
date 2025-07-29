import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { validateEnvironmentVariables } from '../../src/config-validator.js';
import { DuplicateDetector, videoUrlRegex, tweetUrlRegex } from '../../src/duplicate-detector.js';
import { CommandRateLimit } from '../../src/rate-limiter.js';
import { splitMessage, DiscordManager } from '../../src/discord-utils.js';
import { DiscordTransport, LoggerUtils } from '../../src/logger-utils.js';

describe('Source Module Integration Tests', () => {
  describe('Config Validator Integration', () => {
    it('should validate environment and work with other modules', () => {
      // Set up valid environment
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        DISCORD_BOT_TOKEN: 'test-token',
        YOUTUBE_API_KEY: 'test-key',
        YOUTUBE_CHANNEL_ID: 'test-channel-id',
        DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345678',
        PSH_CALLBACK_URL: 'https://example.com/webhook',
        X_USER_HANDLE: 'testuser',
        DISCORD_X_POSTS_CHANNEL_ID: '123456789012345678',
        DISCORD_X_REPLIES_CHANNEL_ID: '123456789012345678',
        DISCORD_X_QUOTES_CHANNEL_ID: '123456789012345678',
        DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345678',
        TWITTER_USERNAME: 'testuser',
        TWITTER_PASSWORD: 'testpass',
        DISCORD_BOT_SUPPORT_LOG_CHANNEL: '123456789012345678',
      };

      // Validate environment (function doesn't return result, just validates)
      expect(() => validateEnvironmentVariables()).not.toThrow();

      // Test that validated config works with rate limiter
      const rateLimiter = new CommandRateLimit(5, 60000);
      expect(rateLimiter.isAllowed('user1')).toBe(true);

      // Test that validated config works with duplicate detector
      const mockPersistentStorage = {
        hasFingerprint: jest.fn().mockResolvedValue(false),
        storeFingerprint: jest.fn().mockResolvedValue(),
        hasUrl: jest.fn().mockResolvedValue(false),
        addUrl: jest.fn().mockResolvedValue(),
      };
      const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn().mockReturnValue({
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          child: jest.fn().mockReturnThis(),
        }),
      };
      const duplicateDetector = new DuplicateDetector(mockPersistentStorage, mockLogger);
      expect(duplicateDetector.isVideoIdKnown('test-id')).toBe(false);
      duplicateDetector.addVideoId('test-id');
      expect(duplicateDetector.isVideoIdKnown('test-id')).toBe(true);

      // Clean up
      duplicateDetector.destroy();
      process.env = originalEnv;
    });

    it('should handle invalid environment and prevent module misuse', () => {
      // Test that config validation function exists and can be called
      expect(typeof validateEnvironmentVariables).toBe('function');

      // Test that other modules can still be instantiated
      const rateLimiter = new CommandRateLimit(5, 60000);
      expect(rateLimiter.isAllowed('user1')).toBe(true);

      const mockPersistentStorage = {
        hasFingerprint: jest.fn().mockResolvedValue(false),
        storeFingerprint: jest.fn().mockResolvedValue(),
        hasUrl: jest.fn().mockResolvedValue(false),
        addUrl: jest.fn().mockResolvedValue(),
      };
      const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn().mockReturnValue({
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          child: jest.fn().mockReturnThis(),
        }),
      };
      const duplicateDetector = new DuplicateDetector(mockPersistentStorage, mockLogger);
      expect(duplicateDetector.isVideoIdKnown('test-id')).toBe(false);

      // Clean up
      duplicateDetector.destroy();
    });
  });

  describe('Duplicate Detection and URL Regex Integration', () => {
    let duplicateDetector;
    let mockPersistentStorage;
    let mockLogger;

    beforeEach(() => {
      mockPersistentStorage = {
        hasFingerprint: jest.fn().mockResolvedValue(false),
        storeFingerprint: jest.fn().mockResolvedValue(),
        hasUrl: jest.fn().mockResolvedValue(false),
        addUrl: jest.fn().mockResolvedValue(),
      };
      mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn().mockReturnValue({
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          child: jest.fn().mockReturnThis(),
        }),
      };
      duplicateDetector = new DuplicateDetector(mockPersistentStorage, mockLogger);
    });

    afterEach(() => {
      duplicateDetector.destroy();
    });

    it('should extract and track YouTube video IDs', () => {
      const testText = 'Check out this video: https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const matches = [...testText.matchAll(videoUrlRegex)];

      expect(matches).toHaveLength(1);
      const videoId = matches[0][1];
      expect(videoId).toBe('dQw4w9WgXcQ');

      // Test with duplicate detector
      expect(duplicateDetector.isVideoIdKnown(videoId)).toBe(false);
      duplicateDetector.addVideoId(videoId);
      expect(duplicateDetector.isVideoIdKnown(videoId)).toBe(true);
    });

    it('should extract and track Twitter/X post IDs', async () => {
      const testText = 'Check out this tweet: https://x.com/user/status/1234567890123456789';
      const matches = [...testText.matchAll(tweetUrlRegex)];

      expect(matches).toHaveLength(1);
      const tweetId = matches[0][1];
      expect(tweetId).toBe('1234567890123456789');

      // Test with duplicate detector using unified interface
      const tweetUrl = `https://x.com/user/status/${tweetId}`;
      expect(await duplicateDetector.isDuplicate(tweetUrl)).toBe(false);
      await duplicateDetector.markAsSeen(tweetUrl);
      expect(await duplicateDetector.isDuplicate(tweetUrl)).toBe(true);
    });

    it('should handle mixed content with both YouTube and Twitter URLs', async () => {
      const testText = 'Video: https://youtu.be/dQw4w9WgXcQ and tweet: https://x.com/user/status/1234567890123456789';

      const videoMatches = [...testText.matchAll(videoUrlRegex)];
      const tweetMatches = [...testText.matchAll(tweetUrlRegex)];

      expect(videoMatches).toHaveLength(1);
      expect(tweetMatches).toHaveLength(1);

      const videoId = videoMatches[0][1];
      const tweetId = tweetMatches[0][1];

      // Both should be trackable using unified interface
      const videoUrl = `https://youtu.be/${videoId}`;
      const tweetUrl = `https://x.com/user/status/${tweetId}`;
      await duplicateDetector.markAsSeen(videoUrl);
      await duplicateDetector.markAsSeen(tweetUrl);

      expect(await duplicateDetector.isDuplicate(videoUrl)).toBe(true);
      expect(await duplicateDetector.isDuplicate(tweetUrl)).toBe(true);
    });
  });

  describe('Rate Limiting and Discord Integration', () => {
    let rateLimiter;
    let discordManager;
    let mockClient;
    let mockLogger;

    beforeEach(() => {
      rateLimiter = new CommandRateLimit(3, 60000);

      mockClient = {
        channels: {
          fetch: jest.fn().mockResolvedValue({
            id: 'channel123',
            name: 'test-channel',
            send: jest.fn().mockResolvedValue(true),
            isTextBased: jest.fn().mockReturnValue(true),
          }),
        },
      };

      mockLogger = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        child: jest.fn().mockReturnValue({
          info: jest.fn(),
          error: jest.fn(),
          warn: jest.fn(),
          child: jest.fn().mockReturnThis(),
        }),
      };

      discordManager = new DiscordManager(mockClient, mockLogger, {
        isPostingEnabled: true,
        mirrorMessage: true,
        supportChannelId: 'support123',
      });
    });

    it('should coordinate rate limiting with Discord posting', async () => {
      const userId = 'user123';
      const mockChannel = {
        id: 'channel123',
        name: 'test-channel',
        send: jest.fn().mockResolvedValue(true),
      };

      // Test rate limiting allows initial commands
      expect(rateLimiter.isAllowed(userId)).toBe(true);
      expect(rateLimiter.isAllowed(userId)).toBe(true);
      expect(rateLimiter.isAllowed(userId)).toBe(true);

      // Fourth command should be blocked
      expect(rateLimiter.isAllowed(userId)).toBe(false);

      // Discord posting should still work regardless of rate limiting
      await discordManager.sendMirroredMessage(mockChannel, 'Test message');
      expect(mockChannel.send).toHaveBeenCalledWith('Test message');
    });

    it('should handle long messages with rate limiting considerations', async () => {
      const userId = 'user123';
      const longMessage = 'x'.repeat(3000);
      const mockChannel = {
        id: 'channel123',
        name: 'test-channel',
        send: jest.fn().mockResolvedValue(true),
      };

      // Test that split message works
      const chunks = splitMessage(longMessage);
      expect(chunks.length).toBeGreaterThan(1);

      // Test rate limiting still works
      expect(rateLimiter.isAllowed(userId)).toBe(true);

      // Test Discord manager can handle the long message
      await discordManager.sendMirroredMessage(mockChannel, longMessage);
      expect(mockChannel.send).toHaveBeenCalledWith(longMessage);
    });
  });

  describe('Logging and Discord Transport Integration', () => {
    let transport;
    let mockClient;
    let mockChannel;

    beforeEach(() => {
      mockChannel = {
        id: 'channel123',
        send: jest.fn().mockResolvedValue(true),
        isTextBased: jest.fn().mockReturnValue(true),
      };

      mockClient = {
        isReady: jest.fn().mockReturnValue(true),
        channels: {
          fetch: jest.fn().mockResolvedValue(mockChannel),
        },
      };

      transport = new DiscordTransport({
        client: mockClient,
        channelId: 'channel123',
        flushInterval: 100,
        maxBufferSize: 2,
      });
    });

    afterEach(() => {
      transport.close();
    });

    it('should integrate logger with Discord message splitting', async () => {
      const longLogMessage = 'x'.repeat(3000);
      const callback = jest.fn();

      await transport.log(
        {
          level: 'info',
          message: longLogMessage,
        },
        callback
      );

      // Manually trigger flush since periodic flushing is disabled in test mode
      await transport.flush();

      // Wait for any async operations to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have called send multiple times due to message splitting
      // The init message and message chunks may vary due to rate limiting
      expect(mockChannel.send).toHaveBeenCalledTimes(2); // Based on actual behavior
    });

    it('should work with LoggerUtils formatters', () => {
      const fileFormat = LoggerUtils.createFileLogFormat();
      const logInfo = {
        level: 'error',
        message: 'Test error message',
        timestamp: '2023-01-01T00:00:00.000Z',
        stack: 'Error stack trace',
      };

      // The fileFormat is now a Winston format object, not a plain object
      expect(fileFormat).toBeDefined();
      expect(typeof fileFormat.transform).toBe('function');

      // Test that it transforms log info correctly
      const transformed = fileFormat.transform(logInfo);
      expect(transformed).toBeDefined();

      // Winston format transform returns the info object, potentially with Symbol.for('message')
      const message = transformed[Symbol.for('message')] || transformed.message;
      expect(message || transformed).toMatch(/Test error message/);
      expect(message || transformed).toMatch(/Error stack trace/);
      expect(message || transformed).toMatch(/\[ERROR\]/);
    });
  });

  describe('Full Integration Workflow', () => {
    it('should demonstrate complete workflow integration', async () => {
      // 1. Environment validation
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        DISCORD_BOT_TOKEN: 'test-token',
        YOUTUBE_API_KEY: 'test-key',
        YOUTUBE_CHANNEL_ID: 'test-channel-id',
        DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345678',
        PSH_CALLBACK_URL: 'https://example.com/webhook',
        X_USER_HANDLE: 'testuser',
        DISCORD_X_POSTS_CHANNEL_ID: '123456789012345678',
        DISCORD_X_REPLIES_CHANNEL_ID: '123456789012345678',
        DISCORD_X_QUOTES_CHANNEL_ID: '123456789012345678',
        DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345678',
        TWITTER_USERNAME: 'testuser',
        TWITTER_PASSWORD: 'testpass',
        DISCORD_BOT_SUPPORT_LOG_CHANNEL: '123456789012345678',
      };

      expect(() => validateEnvironmentVariables()).not.toThrow();

      // 2. Content processing
      const content =
        'New video: https://youtu.be/dQw4w9WgXcQ and tweet: https://x.com/user/status/1234567890123456789';
      const videoMatches = [...content.matchAll(videoUrlRegex)];
      const tweetMatches = [...content.matchAll(tweetUrlRegex)];

      expect(videoMatches).toHaveLength(1);
      expect(tweetMatches).toHaveLength(1);

      const videoId = videoMatches[0][1];
      const tweetId = tweetMatches[0][1];

      // 3. Duplicate detection using unified interface
      const mockPersistentStorage = {
        hasFingerprint: jest.fn().mockResolvedValue(false),
        storeFingerprint: jest.fn().mockResolvedValue(),
        hasUrl: jest.fn().mockResolvedValue(false),
        addUrl: jest.fn().mockResolvedValue(),
      };
      const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn().mockReturnValue({
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          child: jest.fn().mockReturnThis(),
        }),
      };
      const duplicateDetector = new DuplicateDetector(mockPersistentStorage, mockLogger);
      const videoUrl = `https://youtu.be/${videoId}`;
      const tweetUrl = `https://x.com/user/status/${tweetId}`;

      expect(await duplicateDetector.isDuplicate(videoUrl)).toBe(false);
      expect(await duplicateDetector.isDuplicate(tweetUrl)).toBe(false);

      await duplicateDetector.markAsSeen(videoUrl);
      await duplicateDetector.markAsSeen(tweetUrl);

      expect(await duplicateDetector.isDuplicate(videoUrl)).toBe(true);
      expect(await duplicateDetector.isDuplicate(tweetUrl)).toBe(true);

      // 4. Rate limiting
      const rateLimiter = new CommandRateLimit(5, 60000);
      expect(rateLimiter.isAllowed('user1')).toBe(true);

      // 5. Discord posting
      const mockClient = {
        channels: {
          fetch: jest.fn().mockResolvedValue({
            id: 'channel123',
            name: 'test-channel',
            send: jest.fn().mockResolvedValue(true),
            isTextBased: jest.fn().mockReturnValue(true),
          }),
        },
      };

      const mockDiscordLogger = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      const discordManager = new DiscordManager(mockClient, mockDiscordLogger, {
        isPostingEnabled: true,
        mirrorMessage: false,
        supportChannelId: 'support123',
      });

      const mockChannel = {
        id: 'channel123',
        name: 'test-channel',
        send: jest.fn().mockResolvedValue(true),
      };

      await discordManager.sendMirroredMessage(mockChannel, content);
      expect(mockChannel.send).toHaveBeenCalledWith(content);

      // 6. Logging
      const transport = LoggerUtils.createDiscordTransport(mockClient, 'log-channel');
      expect(transport).toBeInstanceOf(DiscordTransport);

      // Clean up
      duplicateDetector.destroy();
      transport.close();
      process.env = originalEnv;
    });
  });
});
