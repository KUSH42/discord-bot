import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ContentAnnouncer } from '../../src/core/content-announcer.js';

describe('ContentAnnouncer', () => {
  let contentAnnouncer;
  let mockDiscordService;
  let mockConfig;
  let mockStateManager;

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
          DISCORD_YOUTUBE_CHANNEL_ID: 'youtube-channel-123',
          DISCORD_X_POSTS_CHANNEL_ID: 'x-posts-channel-123',
          DISCORD_X_REPLIES_CHANNEL_ID: 'x-replies-channel-123',
          DISCORD_X_QUOTES_CHANNEL_ID: 'x-quotes-channel-123',
          DISCORD_X_RETWEETS_CHANNEL_ID: 'x-retweets-channel-123',
        };
        return values[key] || `mock-${key}`;
      }),
      get: jest.fn((key, defaultValue) => {
        const values = {
          DISCORD_BOT_SUPPORT_LOG_CHANNEL: 'support-channel-123',
          DISCORD_X_RETWEETS_CHANNEL_ID: 'x-retweets-channel-123',
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

    // Create content announcer instance
    contentAnnouncer = new ContentAnnouncer(mockDiscordService, mockConfig, mockStateManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('X/Twitter Message Formatting', () => {
    it('should format basic post message correctly without tweet text', async () => {
      const content = {
        platform: 'x',
        type: 'post',
        id: '1234567890',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'This is a test tweet with some content',
        timestamp: '2024-01-01T00:01:00Z',
        isOld: false,
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        'x-posts-channel-123',
        '🐦 **testuser** posted:\nhttps://x.com/testuser/status/1234567890'
      );
    });

    it('should format reply message correctly', async () => {
      const content = {
        platform: 'x',
        type: 'reply',
        id: '1234567890',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: '@someone This is a reply',
        timestamp: '2024-01-01T00:01:00Z',
        isOld: false,
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        'x-replies-channel-123',
        '↩️ **testuser** replied:\nhttps://x.com/testuser/status/1234567890'
      );
    });

    it('should format quote message correctly', async () => {
      const content = {
        platform: 'x',
        type: 'quote',
        id: '1234567890',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'Quoting this tweet',
        timestamp: '2024-01-01T00:01:00Z',
        isOld: false,
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        'x-quotes-channel-123',
        '💬 **testuser** quoted:\nhttps://x.com/testuser/status/1234567890'
      );
    });

    it('should format retweet message correctly', async () => {
      const content = {
        platform: 'x',
        type: 'retweet',
        id: '1234567890',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'RT @someone: Original tweet text',
        timestamp: '2024-01-01T00:01:00Z',
        isOld: false,
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        'x-retweets-channel-123',
        '🔄 **testuser** retweeted:\nhttps://x.com/testuser/status/1234567890'
      );
    });

    it('should convert to VX Twitter when enabled', async () => {
      mockStateManager._state.vxTwitterConversionEnabled = true;

      const content = {
        platform: 'x',
        type: 'post',
        id: '1234567890',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'Test tweet',
        timestamp: '2024-01-01T00:01:00Z',
        isOld: false,
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        'x-posts-channel-123',
        '🐦 **testuser** posted:\nhttps://vxtwitter.com/testuser/status/1234567890'
      );
    });
  });

  describe('Content Validation', () => {
    it('should reject content without platform', async () => {
      const content = {
        type: 'post',
        url: 'https://example.com',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Content must have a platform');
    });

    it('should reject content without type', async () => {
      const content = {
        platform: 'x',
        url: 'https://x.com/testuser/status/1234567890',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Content must have a type');
    });

    it('should reject unsupported platform', async () => {
      const content = {
        platform: 'unsupported',
        type: 'post',
        url: 'https://example.com',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Unsupported platform: unsupported');
    });

    it('should reject unsupported content type for platform', async () => {
      const content = {
        platform: 'x',
        type: 'unsupported',
        url: 'https://x.com/testuser/status/1234567890',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Unsupported content type: unsupported for platform x');
    });
  });

  describe('Announcement Control', () => {
    it('should skip announcement when posting is disabled', async () => {
      mockStateManager._state.postingEnabled = false;

      const content = {
        platform: 'x',
        type: 'post',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'Test tweet',
        isOld: false,
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('Bot posting is disabled');
      expect(mockDiscordService.sendMessage).not.toHaveBeenCalled();
    });

    it('should skip announcement when announcements are disabled', async () => {
      mockStateManager._state.announcementEnabled = false;

      const content = {
        platform: 'x',
        type: 'post',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'Test tweet',
        isOld: false,
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('Announcements are disabled');
      expect(mockDiscordService.sendMessage).not.toHaveBeenCalled();
    });

    it('should skip old X content when ANNOUNCE_OLD_TWEETS is disabled', async () => {
      const content = {
        platform: 'x',
        type: 'post',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'Old tweet',
        isOld: true,
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('Old tweets are not configured to be announced');
      expect(mockDiscordService.sendMessage).not.toHaveBeenCalled();
    });

    it('should announce old X content when ANNOUNCE_OLD_TWEETS is enabled', async () => {
      mockConfig.getBoolean.mockImplementation((key, defaultValue) => {
        if (key === 'ANNOUNCE_OLD_TWEETS') {
          return true;
        }
        return defaultValue;
      });

      const content = {
        platform: 'x',
        type: 'post',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'Old tweet',
        isOld: true,
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(mockDiscordService.sendMessage).toHaveBeenCalled();
    });

    it('should force announcement when force option is set', async () => {
      mockStateManager._state.postingEnabled = false;
      mockStateManager._state.announcementEnabled = false;

      const content = {
        platform: 'x',
        type: 'post',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'Test tweet',
        isOld: false,
      };

      await contentAnnouncer.announceContent(content, { force: true });

      expect(mockDiscordService.sendMessage).toHaveBeenCalled();
    });
  });

  describe('Channel Routing', () => {
    it('should route X posts to correct channel', () => {
      const channelId = contentAnnouncer.getChannelForContent({
        platform: 'x',
        type: 'post',
      });

      expect(channelId).toBe('x-posts-channel-123');
    });

    it('should route X replies to correct channel', () => {
      const channelId = contentAnnouncer.getChannelForContent({
        platform: 'x',
        type: 'reply',
      });

      expect(channelId).toBe('x-replies-channel-123');
    });

    it('should route YouTube videos to correct channel', () => {
      const channelId = contentAnnouncer.getChannelForContent({
        platform: 'youtube',
        type: 'video',
      });

      expect(channelId).toBe('youtube-channel-123');
    });

    it('should return null for unsupported platform/type combinations', () => {
      const channelId = contentAnnouncer.getChannelForContent({
        platform: 'unsupported',
        type: 'post',
      });

      expect(channelId).toBeNull();
    });
  });

  describe('VX Twitter Conversion', () => {
    it('should convert x.com URLs to vxtwitter.com', () => {
      const url = 'https://x.com/testuser/status/1234567890';
      const converted = contentAnnouncer.convertToVxTwitter(url);
      expect(converted).toBe('https://vxtwitter.com/testuser/status/1234567890');
    });

    it('should convert twitter.com URLs to vxtwitter.com', () => {
      const url = 'https://twitter.com/testuser/status/1234567890';
      const converted = contentAnnouncer.convertToVxTwitter(url);
      expect(converted).toBe('https://vxtwitter.com/testuser/status/1234567890');
    });

    it('should handle non-Twitter URLs gracefully', () => {
      const url = 'https://example.com/path';
      const converted = contentAnnouncer.convertToVxTwitter(url);
      expect(converted).toBe(url);
    });

    it('should handle invalid input gracefully', () => {
      expect(contentAnnouncer.convertToVxTwitter(null)).toBeNull();
      expect(contentAnnouncer.convertToVxTwitter(undefined)).toBeUndefined();
      expect(contentAnnouncer.convertToVxTwitter(123)).toBe(123);
    });
  });
});
