import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ContentAnnouncer } from '../../src/core/content-announcer.js';
import { ContentCoordinator } from '../../src/core/content-coordinator.js';
import { ContentStateManager } from '../../src/core/content-state-manager.js';
import { ContentClassifier } from '../../src/core/content-classifier.js';
import { DuplicateDetector } from '../../src/duplicate-detector.js';

/**
 * Integration tests for the complete content announcement flow
 * Tests the interaction between ContentCoordinator, ContentStateManager, ContentClassifier, and ContentAnnouncer
 */
describe('Content Announcement Flow Integration', () => {
  let contentCoordinator;
  let contentAnnouncer;
  let contentStateManager;
  let _contentClassifier;
  let duplicateDetector;
  let mockConfig;
  let mockDiscordService;
  let mockStateManager;
  let mockPersistentStorage;
  let mockLogger;

  beforeEach(() => {
    // Mock Discord service
    mockDiscordService = {
      sendMessage: jest.fn(() => Promise.resolve({ id: 'message123' })),
      fetchChannel: jest.fn(() => Promise.resolve({ name: 'test-channel' })),
    };

    // Mock config
    mockConfig = {
      getRequired: jest.fn(key => {
        const values = {
          DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345678',
          DISCORD_X_POSTS_CHANNEL_ID: '123456789012345679',
          DISCORD_X_REPLIES_CHANNEL_ID: '123456789012345680',
          DISCORD_X_QUOTES_CHANNEL_ID: '123456789012345681',
          DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345682',
        };
        return values[key] || `mock-${key}`;
      }),
      get: jest.fn((key, defaultValue) => {
        const values = {
          DISCORD_BOT_SUPPORT_LOG_CHANNEL: '123456789012345683',
          DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345682',
          MAX_CONTENT_AGE_HOURS: '24',
          PROCESSING_LOCK_TIMEOUT_MS: '30000',
          ANNOUNCE_OLD_TWEETS: 'false',
        };
        return values[key] || defaultValue;
      }),
      getBoolean: jest.fn((key, defaultValue) => {
        const values = {
          ANNOUNCE_OLD_TWEETS: false,
          MIRROR_ANNOUNCEMENTS: false,
        };
        return values[key] !== undefined ? values[key] : defaultValue;
      }),
      getNumber: jest.fn((key, defaultValue) => {
        const values = {
          MAX_CONTENT_AGE_HOURS: 24,
          PROCESSING_LOCK_TIMEOUT_MS: 30000,
        };
        return values[key] !== undefined ? values[key] : defaultValue;
      }),
    };

    // Mock state manager
    const state = {
      postingEnabled: true,
      announcementEnabled: true,
      vxTwitterConversionEnabled: false,
      botStartTime: new Date('2024-01-01T00:00:00Z'),
    };

    mockStateManager = {
      get: jest.fn((key, defaultValue) => {
        return mockStateManager._state[key] !== undefined ? mockStateManager._state[key] : defaultValue;
      }),
      set: jest.fn(),
      _state: state,
    };

    // Mock persistent storage
    mockPersistentStorage = {
      storeContentState: jest.fn(() => Promise.resolve()),
      getContentState: jest.fn(() => Promise.resolve(null)),
      getAllContentStates: jest.fn(() => Promise.resolve({})),
      removeContentStates: jest.fn(() => Promise.resolve()),
      clearAllContentStates: jest.fn(() => Promise.resolve()),
      markAsSeen: jest.fn(() => Promise.resolve()),
      isDuplicate: jest.fn(() => Promise.resolve(false)),
      getSeenUrls: jest.fn(() => Promise.resolve([])),
      getStorageStats: jest.fn(() => Promise.resolve({ seenCount: 0 })),
    };

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(() => mockLogger),
    };

    // Create components
    contentAnnouncer = new ContentAnnouncer(mockDiscordService, mockConfig, mockStateManager, mockLogger);
    contentStateManager = new ContentStateManager(mockConfig, mockPersistentStorage, mockLogger, mockStateManager);
    _contentClassifier = new ContentClassifier(mockConfig, mockLogger);
    duplicateDetector = new DuplicateDetector(mockPersistentStorage, mockLogger);

    contentCoordinator = new ContentCoordinator(
      contentStateManager,
      contentAnnouncer,
      duplicateDetector,
      mockLogger,
      mockConfig
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('YouTube Content Flow', () => {
    it('should process and announce new YouTube video successfully', async () => {
      const contentId = 'dQw4w9WgXcQ';
      const videoData = {
        id: contentId,
        platform: 'youtube',
        type: 'video',
        url: `https://www.youtube.com/watch?v=${contentId}`,
        title: 'Test Video Title',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T12:00:00Z',
        metadata: {
          description: 'Test video description',
          duration: 'PT3M45S',
        },
      };

      const result = await contentCoordinator.processContent(contentId, 'webhook', videoData);

      expect(result.action).toBe('announced');
      expect(result.contentId).toBe(contentId);
      expect(result.source).toBe('webhook');
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345678',
        expect.stringContaining('Test Video Title')
      );
    });

    it('should process and announce new YouTube livestream successfully', async () => {
      const contentId = 'live123';
      const liveData = {
        id: contentId,
        platform: 'youtube',
        type: 'livestream',
        url: `https://www.youtube.com/watch?v=${contentId}`,
        title: 'Live Stream Title',
        channelTitle: 'Live Channel',
        publishedAt: '2024-01-01T12:00:00Z',
        isLive: true,
        metadata: {
          liveBroadcastContent: 'live',
        },
      };

      const result = await contentCoordinator.processContent(contentId, 'webhook', liveData);

      expect(result.action).toBe('announced');
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith('123456789012345678', expect.stringContaining('🔴'));
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345678',
        expect.stringContaining('is now live')
      );
    });

    it('should skip old YouTube content', async () => {
      const contentId = 'old-video';
      const oldVideoData = {
        id: contentId,
        platform: 'youtube',
        type: 'video',
        url: `https://www.youtube.com/watch?v=${contentId}`,
        title: 'Old Video',
        channelTitle: 'Test Channel',
        publishedAt: '2023-12-31T23:59:00Z', // Before bot start time
      };

      const result = await contentCoordinator.processContent(contentId, 'webhook', oldVideoData);

      expect(result.action).toBe('skip');
      expect(result.reason).toBe('content_too_old');
      expect(mockDiscordService.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('X/Twitter Content Flow', () => {
    it('should process and announce new X post successfully', async () => {
      const contentId = '1234567890';
      const tweetData = {
        id: contentId,
        platform: 'x',
        type: 'post',
        url: `https://x.com/testuser/status/${contentId}`,
        author: 'testuser',
        text: 'This is a test tweet',
        timestamp: '2024-01-01T12:00:00Z',
        publishedAt: '2024-01-01T12:00:00Z',
        isOld: false,
      };

      const result = await contentCoordinator.processContent(contentId, 'scraper', tweetData);

      expect(result.action).toBe('announced');
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith('123456789012345679', expect.stringContaining('🐦'));
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345679',
        expect.stringContaining('testuser')
      );
    });

    it('should process and announce X reply successfully', async () => {
      const contentId = '1234567891';
      const replyData = {
        id: contentId,
        platform: 'x',
        type: 'reply',
        url: `https://x.com/testuser/status/${contentId}`,
        author: 'testuser',
        text: '@someone This is a reply',
        timestamp: '2024-01-01T12:00:00Z',
        publishedAt: '2024-01-01T12:00:00Z',
        isOld: false,
      };

      const result = await contentCoordinator.processContent(contentId, 'scraper', replyData);

      expect(result.action).toBe('announced');
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith('123456789012345680', expect.stringContaining('↩️'));
    });

    it('should process and announce X retweet successfully', async () => {
      const contentId = '1234567892';
      const retweetData = {
        id: contentId,
        platform: 'x',
        type: 'retweet',
        url: `https://x.com/testuser/status/${contentId}`,
        author: 'testuser',
        originalAuthor: 'originaluser',
        text: 'RT @originaluser: Original tweet content',
        timestamp: '2024-01-01T12:00:00Z',
        publishedAt: '2024-01-01T12:00:00Z',
        isOld: false,
      };

      const result = await contentCoordinator.processContent(contentId, 'scraper', retweetData);

      expect(result.action).toBe('announced');
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith('123456789012345682', expect.stringContaining('🔄'));
    });

    it('should skip old X content when ANNOUNCE_OLD_TWEETS is false', async () => {
      const contentId = '1234567893';
      const oldTweetData = {
        id: contentId,
        platform: 'x',
        type: 'post',
        url: `https://x.com/testuser/status/${contentId}`,
        author: 'testuser',
        text: 'Old tweet',
        timestamp: '2023-12-31T23:59:00Z',
        publishedAt: '2023-12-31T23:59:00Z',
        isOld: true,
      };

      // The ContentAnnouncer should skip this based on isOld flag
      const result = await contentAnnouncer.announceContent(oldTweetData);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('Old tweets are not configured to be announced');
      expect(mockDiscordService.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Duplicate Detection', () => {
    it('should skip duplicate content', async () => {
      const contentId = 'duplicate-video';
      const videoData = {
        id: contentId,
        platform: 'youtube',
        type: 'video',
        url: `https://www.youtube.com/watch?v=${contentId}`,
        title: 'Duplicate Video',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T12:00:00Z',
      };

      // Mock duplicate detector to return true for duplicates
      duplicateDetector.isDuplicateWithFingerprint = jest.fn(() => Promise.resolve(true));

      const result = await contentCoordinator.processContent(contentId, 'webhook', videoData);

      expect(result.action).toBe('skip');
      expect(result.reason).toBe('duplicate_detected');
      expect(mockDiscordService.sendMessage).not.toHaveBeenCalled();
    });

    it('should skip already announced content', async () => {
      const contentId = 'already-announced';
      const videoData = {
        id: contentId,
        platform: 'youtube',
        type: 'video',
        url: `https://www.youtube.com/watch?v=${contentId}`,
        title: 'Already Announced Video',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T12:00:00Z',
      };

      // First announcement
      await contentCoordinator.processContent(contentId, 'webhook', videoData);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledTimes(1);

      // Second attempt should skip
      const result = await contentCoordinator.processContent(contentId, 'webhook', videoData);

      expect(result.action).toBe('skip');
      expect(result.reason).toBe('already_announced');
      expect(mockDiscordService.sendMessage).toHaveBeenCalledTimes(1); // No additional calls
    });
  });

  describe('Source Priority', () => {
    it('should prefer webhook over scraper source', async () => {
      const contentId = 'priority-test';
      const videoData = {
        id: contentId,
        platform: 'youtube',
        type: 'video',
        url: `https://www.youtube.com/watch?v=${contentId}`,
        title: 'Priority Test Video',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T12:00:00Z',
      };

      // First process from scraper (lower priority)
      await contentCoordinator.processContent(contentId, 'scraper', videoData);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledTimes(1);

      // Then process from webhook (higher priority) - should skip due to already announced
      const result = await contentCoordinator.processContent(contentId, 'webhook', videoData);

      expect(result.action).toBe('skip');
      expect(result.reason).toBe('already_announced');
      expect(mockDiscordService.sendMessage).toHaveBeenCalledTimes(1); // No additional calls
    });
  });

  describe('Error Handling', () => {
    it('should handle Discord service errors gracefully', async () => {
      mockDiscordService.sendMessage.mockRejectedValue(new Error('Discord API error'));

      const contentId = 'error-test';
      const videoData = {
        id: contentId,
        platform: 'youtube',
        type: 'video',
        url: `https://www.youtube.com/watch?v=${contentId}`,
        title: 'Error Test Video',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T12:00:00Z',
      };

      const result = await contentCoordinator.processContent(contentId, 'webhook', videoData);
      expect(result.action).toBe('failed');
      expect(result.reason).toContain('Discord API error');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle invalid content gracefully', async () => {
      const contentId = 'invalid-test';
      const invalidData = {
        id: contentId,
        // Missing required fields
        publishedAt: '2024-01-01T12:00:00Z',
      };

      const result = await contentCoordinator.processContent(contentId, 'webhook', invalidData);
      expect(result.action).toBe('failed');
      expect(result.reason).toContain('Content must have a platform');
    });
  });

  describe('Posting Controls', () => {
    it('should skip announcement when posting is disabled', async () => {
      mockStateManager._state.postingEnabled = false;

      const contentId = 'disabled-test';
      const videoData = {
        id: contentId,
        platform: 'youtube',
        type: 'video',
        url: `https://www.youtube.com/watch?v=${contentId}`,
        title: 'Disabled Test Video',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T12:00:00Z',
      };

      const result = await contentCoordinator.processContent(contentId, 'webhook', videoData);

      // Content should be added to state but not announced
      expect(contentStateManager.hasContent(contentId)).toBe(true);
      expect(result.announcementResult.skipped).toBe(true);
      expect(result.announcementResult.reason).toBe('Bot posting is disabled');
      expect(mockDiscordService.sendMessage).not.toHaveBeenCalled();
    });

    it('should skip announcement when announcements are disabled', async () => {
      mockStateManager._state.announcementEnabled = false;

      const contentId = 'announce-disabled-test';
      const videoData = {
        id: contentId,
        platform: 'youtube',
        type: 'video',
        url: `https://www.youtube.com/watch?v=${contentId}`,
        title: 'Announce Disabled Test Video',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T12:00:00Z',
      };

      const result = await contentCoordinator.processContent(contentId, 'webhook', videoData);

      expect(result.announcementResult.skipped).toBe(true);
      expect(result.announcementResult.reason).toBe('Announcements are disabled');
      expect(mockDiscordService.sendMessage).not.toHaveBeenCalled();
    });

    it('should force announcement when force option is used', async () => {
      mockStateManager._state.postingEnabled = false;
      mockStateManager._state.announcementEnabled = false;

      const contentId = 'force-test';
      const videoData = {
        id: contentId,
        platform: 'youtube',
        type: 'video',
        url: `https://www.youtube.com/watch?v=${contentId}`,
        title: 'Force Test Video',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T12:00:00Z',
      };

      // Directly test the announcer with force option
      const result = await contentAnnouncer.announceContent(videoData, { force: true });

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalled();
    });
  });

  describe('Content State Management', () => {
    it('should add content to state manager', async () => {
      const contentId = 'state-test';
      const videoData = {
        id: contentId,
        platform: 'youtube',
        type: 'video',
        url: `https://www.youtube.com/watch?v=${contentId}`,
        title: 'State Test Video',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T12:00:00Z',
      };

      await contentCoordinator.processContent(contentId, 'webhook', videoData);

      expect(contentStateManager.hasContent(contentId)).toBe(true);
      const state = contentStateManager.getContentState(contentId);
      expect(state.id).toBe(contentId);
      expect(state.announced).toBe(true);
      expect(state.source).toBe('webhook');
    });

    it('should update existing content state with new source', async () => {
      const contentId = 'update-test';
      const videoData = {
        id: contentId,
        platform: 'youtube',
        type: 'video',
        url: `https://www.youtube.com/watch?v=${contentId}`,
        title: 'Update Test Video',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T12:00:00Z',
      };

      // Add with scraper first
      await contentCoordinator.processContent(contentId, 'scraper', videoData);
      const state = contentStateManager.getContentState(contentId);
      expect(state.source).toBe('scraper');

      // Try to update with webhook (higher priority) - should be skipped due to already announced
      const result = await contentCoordinator.processContent(contentId, 'webhook', videoData);
      expect(result.action).toBe('skip');
      expect(result.reason).toBe('already_announced');
    });
  });

  describe('Race Condition Prevention', () => {
    it('should prevent race conditions when processing same content simultaneously', async () => {
      const contentId = 'race-test';
      const videoData = {
        id: contentId,
        platform: 'youtube',
        type: 'video',
        url: `https://www.youtube.com/watch?v=${contentId}`,
        title: 'Race Test Video',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T12:00:00Z',
      };

      // Reset call count for this test
      mockDiscordService.sendMessage.mockClear();

      // Start multiple processing operations simultaneously
      const promises = [
        contentCoordinator.processContent(contentId, 'webhook', videoData),
        contentCoordinator.processContent(contentId, 'webhook', videoData),
        contentCoordinator.processContent(contentId, 'webhook', videoData),
      ];

      const results = await Promise.all(promises);

      // All results should be identical (first one processes, others wait and get same result)
      expect(results).toHaveLength(3);
      expect(results[0].action).toBe('announced');
      expect(results[1].action).toBe('announced');
      expect(results[2].action).toBe('announced');

      // But Discord should only be called once due to race condition prevention
      expect(mockDiscordService.sendMessage).toHaveBeenCalledTimes(1);
    });
  });
});
