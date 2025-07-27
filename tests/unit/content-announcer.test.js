import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ContentAnnouncer } from '../../src/core/content-announcer.js';

describe('ContentAnnouncer', () => {
  let contentAnnouncer;
  let mockDiscordService;
  let mockConfig;
  let mockStateManager;
  let mockLogger;
  let mockDebugFlagManager;
  let mockMetricsManager;

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

    // Mock logger with child method for enhanced logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      child: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      })),
    };

    // Mock debug flag manager
    mockDebugFlagManager = {
      isEnabled: jest.fn(() => false),
      getLevel: jest.fn(() => 1),
    };

    // Mock metrics manager
    mockMetricsManager = {
      increment: jest.fn(),
      timing: jest.fn(),
      gauge: jest.fn(),
      startTimer: jest.fn(() => jest.fn()),
    };

    // Create content announcer instance
    contentAnnouncer = new ContentAnnouncer(
      mockDiscordService,
      mockConfig,
      mockStateManager,
      mockLogger,
      mockDebugFlagManager,
      mockMetricsManager
    );
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

      expect(result.reason).toBeNull();
      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345679',
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
        '123456789012345680',
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
        '123456789012345681',
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
        '123456789012345682',
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
        '123456789012345679',
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

      expect(channelId).toBe('123456789012345679');
    });

    it('should route X replies to correct channel', () => {
      const channelId = contentAnnouncer.getChannelForContent({
        platform: 'x',
        type: 'reply',
      });

      expect(channelId).toBe('123456789012345680');
    });

    it('should route YouTube videos to correct channel', () => {
      const channelId = contentAnnouncer.getChannelForContent({
        platform: 'youtube',
        type: 'video',
      });

      expect(channelId).toBe('123456789012345678');
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

  describe('YouTube Message Formatting', () => {
    it('should format basic YouTube video message correctly', async () => {
      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'dQw4w9WgXcQ',
        title: 'Test Video Title',
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345678',
        '🎬 **Test Channel** uploaded a new video:\n**Test Video Title**\nhttps://youtube.com/watch?v=dQw4w9WgXcQ'
      );
    });

    it('should format livestream message correctly', async () => {
      const content = {
        platform: 'youtube',
        type: 'livestream',
        id: 'livestream123',
        title: 'Live Stream Title',
        url: 'https://youtube.com/watch?v=livestream123',
        channelTitle: 'Live Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345678',
        '🔴 **Live Channel** is now live:\n**Live Stream Title**\nhttps://youtube.com/watch?v=livestream123'
      );
    });

    it('should format upcoming stream message correctly', async () => {
      const content = {
        platform: 'youtube',
        type: 'upcoming',
        id: 'upcoming123',
        title: 'Upcoming Stream',
        url: 'https://youtube.com/watch?v=upcoming123',
        channelTitle: 'Stream Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345678',
        '📅 **Stream Channel** scheduled:\n**Upcoming Stream**\nhttps://youtube.com/watch?v=upcoming123'
      );
    });

    it('should format YouTube Short message correctly', async () => {
      const content = {
        platform: 'youtube',
        type: 'short',
        id: 'short123',
        title: 'YouTube Short Title',
        url: 'https://youtube.com/shorts/short123',
        channelTitle: 'Shorts Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345678',
        '🩳 **Shorts Channel** Short:\n**YouTube Short Title**\nhttps://youtube.com/shorts/short123'
      );
    });

    it('should format livestream with embed when useEmbed option is true', async () => {
      const content = {
        platform: 'youtube',
        type: 'livestream',
        id: 'livestream123',
        title: 'Live Stream with Embed',
        url: 'https://youtube.com/watch?v=livestream123',
        channelTitle: 'Embed Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content, { useEmbed: true });

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345678',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: '🔴 Embed Channel is now live!',
              description: 'Live Stream with Embed',
              url: 'https://youtube.com/watch?v=livestream123',
              color: 0xff0000,
            }),
          ]),
        })
      );
    });

    it('should handle missing channel title gracefully', async () => {
      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'video123',
        title: 'Video Without Channel',
        url: 'https://youtube.com/watch?v=video123',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345678',
        '🎬 **Channel** uploaded a new video:\n**Video Without Channel**\nhttps://youtube.com/watch?v=video123'
      );
    });
  });

  describe('Content Sanitization', () => {
    it('should sanitize Discord mentions in content', async () => {
      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'video123',
        title: 'Video with @everyone and @here mentions',
        url: 'https://youtube.com/watch?v=video123',
        channelTitle: 'Channel with @everyone',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345678',
        expect.stringContaining('**Channel with [@]everyone**')
      );
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345678',
        expect.stringContaining('**Video with [@]everyone and [@]here mentions**')
      );
    });

    it('should remove script tags from content', async () => {
      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'video123',
        title: 'Title with <script>alert("xss")</script> content',
        url: 'https://youtube.com/watch?v=video123',
        channelTitle: 'Clean Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345678',
        expect.stringContaining('**Title with  content**')
      );
    });

    it('should block javascript URLs', async () => {
      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'video123',
        title: 'Title with javascript:alert(1) URL',
        url: 'https://youtube.com/watch?v=video123',
        channelTitle: 'Safe Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345678',
        expect.stringContaining('**Title with blocked:alert(1) URL**')
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle Discord service errors gracefully', async () => {
      mockDiscordService.sendMessage.mockRejectedValue(new Error('Discord API error'));

      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'video123',
        title: 'Test Video',
        url: 'https://youtube.com/watch?v=video123',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Discord API error');
    });

    it('should handle invalid channel ID', async () => {
      mockConfig.getRequired.mockImplementation(key => {
        if (key === 'DISCORD_YOUTUBE_CHANNEL_ID') {
          return 'invalid-id';
        }
        return `mock-${key}`;
      });

      // Create new instance with the overridden config
      const testContentAnnouncer = new ContentAnnouncer(mockDiscordService, mockConfig, mockStateManager, mockLogger);

      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'video123',
        title: 'Test Video',
        url: 'https://youtube.com/watch?v=video123',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await testContentAnnouncer.announceContent(content);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Invalid or missing channel ID: invalid-id');
    });

    it('should handle null content object', async () => {
      const result = await contentAnnouncer.announceContent(null);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Content must be an object');
    });

    it('should handle non-object content', async () => {
      const result = await contentAnnouncer.announceContent('invalid content');

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Content must be an object');
    });
  });

  describe('Skip Reasons', () => {
    it('should provide correct skip reason for old YouTube content', async () => {
      mockStateManager._state.botStartTime = new Date('2024-01-01T00:00:00Z');

      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'old-video',
        title: 'Old Video',
        url: 'https://youtube.com/watch?v=old-video',
        channelTitle: 'Test Channel',
        publishedAt: '2023-12-31T23:59:00Z', // Before bot start time
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('Content was published before bot started');
    });

    it('should provide correct skip reason for old X content', async () => {
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
    });
  });

  describe('Message Mirroring', () => {
    beforeEach(() => {
      mockConfig.getBoolean.mockImplementation((key, defaultValue) => {
        if (key === 'MIRROR_ANNOUNCEMENTS') {
          return true;
        }
        return defaultValue;
      });

      mockConfig.get.mockImplementation((key, defaultValue) => {
        if (key === 'DISCORD_BOT_SUPPORT_LOG_CHANNEL') {
          return '123456789012345683';
        }
        return defaultValue;
      });
    });

    it('should send mirror message when mirroring is enabled', async () => {
      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'video123',
        title: 'Test Video',
        url: 'https://youtube.com/watch?v=video123',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledTimes(2);

      // First call is the main announcement
      expect(mockDiscordService.sendMessage).toHaveBeenNthCalledWith(1, '123456789012345678', expect.any(String));

      // Second call is the mirror
      expect(mockDiscordService.sendMessage).toHaveBeenNthCalledWith(
        2,
        '123456789012345683',
        expect.stringContaining('[Bot message from #')
      );
    });

    it('should not mirror to the same channel', async () => {
      // Create a new config with same channel for mirroring
      const sameChannelConfig = {
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
          if (key === 'DISCORD_BOT_SUPPORT_LOG_CHANNEL') {
            return '123456789012345678'; // Same as YouTube channel
          }
          const values = {
            DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345682',
          };
          return values[key] || defaultValue;
        }),
        getBoolean: jest.fn((key, defaultValue) => {
          if (key === 'MIRROR_ANNOUNCEMENTS') {
            return true; // Enable mirroring to test the same-channel logic
          }
          const values = {
            ANNOUNCE_OLD_TWEETS: false,
          };
          return values[key] !== undefined ? values[key] : defaultValue;
        }),
      };

      // Create a new ContentAnnouncer instance with the same-channel configuration
      const sameChannelAnnouncer = new ContentAnnouncer(
        mockDiscordService,
        sameChannelConfig,
        mockStateManager,
        mockLogger
      );

      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'video123',
        title: 'Test Video',
        url: 'https://youtube.com/watch?v=video123',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await sameChannelAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledTimes(1); // Only main message, no mirror
    });

    it('should handle mirror message errors gracefully', async () => {
      // Reset all mocks first
      jest.clearAllMocks();

      // Mock sendMessage to succeed on first call, fail on second
      let callCount = 0;
      mockDiscordService.sendMessage.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ id: 'message123' }); // Main message succeeds
        } else {
          return Promise.reject(new Error('Mirror failed')); // Mirror fails
        }
      });

      // Create a new ContentAnnouncer instance with the updated config
      const mirrorContentAnnouncer = new ContentAnnouncer(
        mockDiscordService,
        mockConfig,
        mockStateManager,
        mockLogger,
        mockDebugFlagManager,
        mockMetricsManager
      );

      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'video123',
        title: 'Test Video',
        url: 'https://youtube.com/watch?v=video123',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      // Test that mirroring is enabled
      expect(mirrorContentAnnouncer.shouldMirrorMessage('123456789012345678', {})).toBe(true);

      // The enhanced logger creates a child logger, so we need to spy on that instance
      const enhancedLoggerInstance = mirrorContentAnnouncer.logger;
      const errorSpy = jest.spyOn(enhancedLoggerInstance, 'error');

      const result = await mirrorContentAnnouncer.announceContent(content);

      expect(result.success).toBe(true); // Main message succeeded
      expect(mockDiscordService.sendMessage).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to send mirror message',
        expect.objectContaining({
          error: 'Mirror failed',
        })
      );
    });
  });

  describe('Generic Message Formatting', () => {
    it('should format unsupported platform content with generic formatter', async () => {
      // Mock a generic platform that uses the fallback formatter
      const mockGenericConfig = {
        ...mockConfig,
        getRequired: jest.fn(key => {
          if (key === 'DISCORD_GENERIC_CHANNEL_ID') {
            return '123456789012345684';
          }
          return mockConfig.getRequired(key);
        }),
      };

      // Create a new announcer with a modified channel map
      const genericAnnouncer = new ContentAnnouncer(
        mockDiscordService,
        mockGenericConfig,
        mockStateManager,
        mockLogger
      );

      // Add a generic platform to the channel map
      genericAnnouncer.channelMap.generic = {
        content: '123456789012345684',
      };
      const content = {
        platform: 'generic',
        type: 'content',
        title: 'Generic Content',
        url: 'https://example.com/content',
        author: 'Generic Author',
      };

      const result = await genericAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345684',
        expect.stringContaining('**Generic Author**')
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle content without URL', async () => {
      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'video123',
        title: 'Video Without URL',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
      expect(mockDiscordService.sendMessage).toHaveBeenCalledWith(
        '123456789012345678',
        expect.stringContaining('Video Without URL')
      );
    });

    it('should handle content with empty title', async () => {
      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'video123',
        title: '',
        url: 'https://youtube.com/watch?v=video123',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
    });

    it('should handle very long content titles', async () => {
      const longTitle = 'A'.repeat(2000); // Very long title
      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'video123',
        title: longTitle,
        url: 'https://youtube.com/watch?v=video123',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T00:01:00Z',
      };

      const result = await contentAnnouncer.announceContent(content);

      expect(result.success).toBe(true);
    });
  });
});
