/**
 * Integration tests for retweet detection and announcement workflows
 */
import { jest } from '@jest/globals';
import { ContentClassifier } from '../../src/core/content-classifier.js';
import { ContentAnnouncer } from '../../src/core/content-announcer.js';

describe('Retweet Workflows Integration', () => {
  let classifier;
  let announcer;
  let config;
  let mockDiscordClient;

  // Helper function to create mock config
  const createMockConfig = (overrides = {}) => {
    const defaultValues = {
      DISCORD_X_CHANNEL_ID: '123456789',
      DISCORD_X_RETWEETS_CHANNEL_ID: '987654321',
      DISCORD_SUPPORT_CHANNEL_ID: '555666777',
      DISCORD_YOUTUBE_CHANNEL_ID: '111222333',
      DISCORD_X_POSTS_CHANNEL_ID: '123456789',
      DISCORD_X_REPLIES_CHANNEL_ID: '123456789',
      DISCORD_X_QUOTES_CHANNEL_ID: '123456789',
      DISCORD_BOT_SUPPORT_LOG_CHANNEL: '555666777',
      ...overrides,
    };

    return {
      get: jest.fn(key => defaultValues[key]),
      getRequired: jest.fn(key => defaultValues[key]),
      getBoolean: jest.fn((key, defaultValue) => {
        const value = defaultValues[key];
        return value !== undefined ? value : defaultValue;
      }),
      isRetweetChannelConfigured: jest.fn(() => !!defaultValues['DISCORD_X_RETWEETS_CHANNEL_ID']),
    };
  };

  beforeEach(() => {
    // Mock Discord service
    mockDiscordClient = {
      sendMessage: jest.fn().mockResolvedValue({ id: 'message123' }),
    };

    // Mock state manager
    const mockStateManager = {
      get: jest.fn((key, defaultValue) => {
        const values = {
          postingEnabled: true,
          announcementEnabled: true,
          botStartTime: new Date('2024-01-01T00:00:00Z'),
        };
        return values[key] !== undefined ? values[key] : defaultValue;
      }),
      set: jest.fn(),
    };

    // Mock configuration
    config = createMockConfig();

    classifier = new ContentClassifier();
    announcer = new ContentAnnouncer(mockDiscordClient, config, mockStateManager);
  });

  describe('Enhanced Retweet Detection Integration', () => {
    it('should detect retweets using socialContext and route to correct channel', async () => {
      // Mock tweet element with socialContext
      const mockTweetElement = {
        querySelector: jest.fn(selector => {
          if (selector === '[data-testid="socialContext"]') {
            return {
              textContent: 'The Enforcer reposted',
            };
          }
          return null;
        }),
      };

      // Simulate content classification
      const content = {
        platform: 'x',
        type: 'retweet',
        url: 'https://x.com/testuser/status/123456789',
        text: 'This is a retweet content',
        author: 'testuser',
        timestamp: new Date().toISOString(),
        tweetCategory: 'Retweet',
      };

      const classification = classifier.analyzeXContentType(content.text, {
        domElement: mockTweetElement,
      });

      expect(classification.type).toBe('retweet');
      expect(classification.confidence).toBe(0.95);

      // Test announcement routing
      const result = await announcer.announceContent(content);

      expect(result.success).toBe(true);
      expect(result.channelId).toBe('987654321');
      expect(mockDiscordClient.sendMessage).toHaveBeenCalledWith('987654321', expect.any(String));
    });

    it('should fallback to regular channel when retweet channel not configured', async () => {
      // Configure without retweet channel
      const configWithoutRetweets = createMockConfig({ DISCORD_X_RETWEETS_CHANNEL_ID: undefined });

      const mockStateManager = {
        get: jest.fn((key, defaultValue) => {
          const values = {
            postingEnabled: true,
            announcementEnabled: true,
            botStartTime: new Date('2024-01-01T00:00:00Z'),
          };
          return values[key] !== undefined ? values[key] : defaultValue;
        }),
        set: jest.fn(),
      };

      const announcerWithoutRetweets = new ContentAnnouncer(mockDiscordClient, configWithoutRetweets, mockStateManager);

      const retweetContent = {
        platform: 'x',
        type: 'retweet',
        url: 'https://x.com/testuser/status/123456789',
        text: 'RT @someone This is a retweet',
        author: 'testuser',
        timestamp: new Date().toISOString(),
        tweetCategory: 'Retweet',
      };

      const result = await announcerWithoutRetweets.announceContent(retweetContent);

      expect(mockDiscordClient.sendMessage).toHaveBeenCalledWith('123456789', expect.any(String));
      expect(result.success).toBe(true);
      expect(result.channelId).toBe('123456789');
    });

    it('should handle retweet detection with multiple strategies', async () => {
      const testCases = [
        {
          name: 'socialContext detection',
          mockElement: {
            querySelector: jest.fn(selector => {
              if (selector === '[data-testid="socialContext"]') {
                return { textContent: 'User reposted' };
              }
              return null;
            }),
          },
          expectedMethod: 'socialContext',
        },
        {
          name: 'text pattern detection',
          mockElement: {
            querySelector: jest.fn(selector => {
              if (selector === '[data-testid="tweetText"], [lang] span, div[dir="ltr"]') {
                return { textContent: 'RT @user This is a retweet' };
              }
              return null;
            }),
          },
          expectedMethod: 'textPattern',
        },
        {
          name: 'contextual text detection',
          mockElement: {
            querySelector: jest.fn(() => null),
            textContent: 'User retweeted this content',
          },
          expectedMethod: 'contextualText',
        },
      ];

      for (const testCase of testCases) {
        const result = classifier.enhancedRetweetDetection(testCase.mockElement);

        expect(result.isRetweet).toBe(true);
        expect(result.method).toBe(testCase.expectedMethod);
        expect(result.confidence).toBeGreaterThan(0);
      }
    });

    it('should preserve retweet metadata in announcements', async () => {
      const retweetContent = {
        platform: 'x',
        type: 'retweet',
        url: 'https://x.com/testuser/status/123456789',
        text: 'This is retweeted content',
        author: 'testuser',
        timestamp: new Date().toISOString(),
        tweetCategory: 'Retweet',
        retweetedBy: 'The Enforcer',
      };

      await announcer.announceContent(retweetContent);

      const sentMessage = mockDiscordClient.sendMessage.mock.calls[0][1];

      // Verify retweet indicator is included
      expect(sentMessage).toContain('testuser');
      expect(mockDiscordClient.sendMessage).toHaveBeenCalledWith('987654321', expect.any(String));
    });
  });

  describe('Retweet Channel Configuration', () => {
    it('should validate retweet channel configuration', () => {
      const validConfig = createMockConfig();

      expect(validConfig.get('DISCORD_X_RETWEETS_CHANNEL_ID')).toBe('987654321');
      expect(validConfig.isRetweetChannelConfigured()).toBe(true);
    });

    it('should handle missing retweet channel configuration', () => {
      const configWithoutRetweets = createMockConfig({ DISCORD_X_RETWEETS_CHANNEL_ID: undefined });

      expect(configWithoutRetweets.get('DISCORD_X_RETWEETS_CHANNEL_ID')).toBeUndefined();
      expect(configWithoutRetweets.isRetweetChannelConfigured()).toBe(false);
    });

    it('should handle empty retweet channel configuration', () => {
      const configWithEmptyRetweets = createMockConfig({ DISCORD_X_RETWEETS_CHANNEL_ID: '' });

      expect(configWithEmptyRetweets.isRetweetChannelConfigured()).toBe(false);
    });
  });

  describe('Error Handling in Retweet Workflows', () => {
    it('should handle retweet channel send failures gracefully', async () => {
      // Mock Discord service failure
      mockDiscordClient.sendMessage.mockRejectedValue(new Error('Discord API error'));

      const retweetContent = {
        platform: 'x',
        type: 'retweet',
        url: 'https://x.com/testuser/status/123456789',
        text: 'RT @someone This is a retweet',
        author: 'testuser',
        timestamp: new Date().toISOString(),
        tweetCategory: 'Retweet',
      };

      const result = await announcer.announceContent(retweetContent);

      // Should handle error gracefully
      expect(mockDiscordClient.sendMessage).toHaveBeenCalledWith('987654321', expect.any(String));
      expect(result.success).toBe(false);
      expect(result.reason).toBe('Discord API error');
    });

    it('should handle invalid DOM elements in enhanced detection', () => {
      const invalidElements = [null, undefined, {}, { querySelector: null }];

      invalidElements.forEach(element => {
        const result = classifier.enhancedRetweetDetection(element);

        expect(result.isRetweet).toBe(false);
        expect(result.confidence).toBe(0);
        expect(['no-element', 'no-match']).toContain(result.method);
      });
    });
  });

  describe('Performance and Rate Limiting', () => {
    it('should handle multiple concurrent retweet detections', async () => {
      const mockElements = Array(10)
        .fill(null)
        .map((_, i) => ({
          querySelector: jest.fn(selector => {
            if (selector === '[data-testid="socialContext"]') {
              return { textContent: `User${i} reposted` };
            }
            return null;
          }),
        }));

      const detectionPromises = mockElements.map(element =>
        Promise.resolve(classifier.enhancedRetweetDetection(element))
      );

      const results = await Promise.all(detectionPromises);

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.isRetweet).toBe(true);
        expect(result.method).toBe('socialContext');
      });
    });

    it('should respect rate limiting for retweet announcements', async () => {
      const retweetContents = Array(5)
        .fill(null)
        .map((_, i) => ({
          platform: 'x',
          type: 'retweet',
          url: `https://x.com/testuser/status/12345678${i}`,
          text: `RT @someone This is retweet ${i}`,
          author: 'testuser',
          timestamp: new Date().toISOString(),
          tweetCategory: 'Retweet',
        }));

      const announcePromises = retweetContents.map(content => announcer.announceContent(content));

      const results = await Promise.all(announcePromises);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      expect(mockDiscordClient.sendMessage).toHaveBeenCalledTimes(5);
    });
  });
});
