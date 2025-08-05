import { jest } from '@jest/globals';
import { timestampUTC } from '../../src/utilities/utc-time.js';
import {
  createMockDependenciesWithEnhancedLogging,
  createMockEnhancedLogger,
} from '../utils/enhanced-logging-mocks.js';

// Import the ContentCoordinator after mocking
const { ContentCoordinator } = await import('../../src/core/content-coordinator.js');

describe('ContentCoordinator - Race Condition Tests', () => {
  let coordinator;
  let mockContentStateManager;
  let mockContentAnnouncer;
  let mockDuplicateDetector;
  let mockContentClassifier;
  let mockLogger;
  let mockConfig;
  let mockDiscordService;
  let mockDependencies;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    mockContentStateManager = {
      getContentState: jest.fn(),
      addContent: jest.fn(),
      updateContentState: jest.fn(),
      markAsAnnounced: jest.fn(),
      isNewContent: jest.fn().mockReturnValue(true),
      getBotStartTime: jest.fn().mockReturnValue(new Date('2024-01-01T10:00:00Z')),
    };

    mockContentAnnouncer = {
      announceContent: jest.fn().mockResolvedValue({
        success: true,
        channelId: '123456789',
        messageId: '987654321',
      }),
    };

    mockDuplicateDetector = {
      isDuplicate: jest.fn().mockResolvedValue(false),
      markAsSeen: jest.fn(),
      isDuplicateWithFingerprint: jest.fn().mockResolvedValue(false),
      markAsSeenWithFingerprint: jest.fn(),
      isDuplicateByUrl: jest.fn().mockResolvedValue(false),
      markAsSeenByUrl: jest.fn(),
      isVideoIdKnown: jest.fn().mockReturnValue(false),
      isTweetIdKnown: jest.fn().mockReturnValue(false),
      addVideoId: jest.fn(),
    };

    mockContentClassifier = {
      classify: jest.fn(),
      classifyXContent: jest.fn(),
    };

    mockConfig = {
      get: jest.fn(key => {
        const configMap = {
          SOURCE_PRIORITY: ['webhook', 'api', 'scraper'],
          PROCESSING_LOCK_TIMEOUT_MS: 30000,
          X_USER_HANDLE: 'testuser',
          DISCORD_YOUTUBE_CHANNEL_ID: 'youtube-channel-123',
          DISCORD_X_POSTS_CHANNEL_ID: 'x-posts-channel-123',
          DISCORD_X_REPLIES_CHANNEL_ID: 'x-replies-channel-123',
          DISCORD_X_QUOTES_CHANNEL_ID: 'x-quotes-channel-123',
          DISCORD_X_RETWEETS_CHANNEL_ID: 'x-retweets-channel-123',
        };
        return configMap[key];
      }),
      getNumber: jest.fn((key, defaultValue) => {
        if (key === 'PROCESSING_LOCK_TIMEOUT_MS') {
          return 30000;
        }
        return defaultValue;
      }),
    };

    // Create mock Discord service for live scanning
    mockDiscordService = {
      isReady: jest.fn().mockReturnValue(true),
      fetchChannel: jest.fn(),
    };

    // Create mock Discord channel with messages
    const createMockDiscordChannel = (messageContents = []) => {
      const mockMessages = new Map();
      messageContents.forEach((content, index) => {
        const messageId = `message-${index + 1}`;
        mockMessages.set(messageId, {
          id: messageId,
          content,
          createdAt: new Date('2024-01-01T10:05:00Z'), // 5 minutes after bot start
        });
      });

      return {
        messages: {
          fetch: jest.fn().mockResolvedValue(mockMessages),
        },
      };
    };

    // Setup mock enhanced logging
    mockDependencies = createMockDependenciesWithEnhancedLogging();
    mockLogger = mockDependencies.logger;

    coordinator = new ContentCoordinator(
      mockContentStateManager,
      mockContentAnnouncer,
      mockDuplicateDetector,
      mockContentClassifier,
      mockLogger,
      mockConfig,
      mockDependencies.debugFlagManager,
      mockDependencies.metricsManager,
      mockDiscordService
    );

    // Mock the getSnowflakeFromDate method to return a valid Discord snowflake
    coordinator.getSnowflakeFromDate = jest.fn().mockReturnValue('1234567890123456789');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('checkForPreviouslyAnnouncedContent - Two-Phase Detection', () => {
    describe('Phase 1: Cache Check (Fast Path)', () => {
      it('should find YouTube video in duplicate detector cache', async () => {
        // Arrange
        const contentData = {
          platform: 'YouTube',
          type: 'video',
          videoId: 'dQw4w9WgXcQ',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: 'Test Video',
        };

        mockDuplicateDetector.isVideoIdKnown.mockReturnValue(true);

        // Act
        const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

        // Assert
        expect(result).toEqual({
          found: true,
          foundIn: 'youtube_duplicate_detector_cache',
          contentId: 'dQw4w9WgXcQ',
        });

        expect(mockDuplicateDetector.isVideoIdKnown).toHaveBeenCalledWith('dQw4w9WgXcQ');

        // Should not proceed to live Discord scan
        expect(mockDiscordService.fetchChannel).not.toHaveBeenCalled();
      });

      it('should find X tweet in duplicate detector cache', async () => {
        // Arrange
        const contentData = {
          platform: 'X',
          type: 'post',
          tweetId: '1234567890123456789',
          url: 'https://x.com/user/status/1234567890123456789',
          title: 'Test Tweet',
        };

        mockDuplicateDetector.isTweetIdKnown.mockReturnValue(true);

        // Act
        const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

        // Assert
        expect(result).toEqual({
          found: true,
          foundIn: 'x_duplicate_detector_cache',
          contentId: '1234567890123456789',
        });

        expect(mockDuplicateDetector.isTweetIdKnown).toHaveBeenCalledWith('1234567890123456789');

        // Should not proceed to live Discord scan
        expect(mockDiscordService.fetchChannel).not.toHaveBeenCalled();
      });

      it('should find URL in duplicate detector cache', async () => {
        // Arrange
        const contentData = {
          platform: 'YouTube',
          type: 'video',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: 'Test Video',
        };

        mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(true);

        // Act
        const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

        // Assert
        expect(result).toEqual({
          found: true,
          foundIn: 'url_duplicate_detector_cache',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        });

        expect(mockDuplicateDetector.isDuplicateByUrl).toHaveBeenCalledWith(contentData.url);

        // Should not proceed to live Discord scan
        expect(mockDiscordService.fetchChannel).not.toHaveBeenCalled();
      });
    });

    describe('Phase 2: Live Discord Scan (On Cache Miss)', () => {
      it('should perform live Discord scan when cache misses occur', async () => {
        // Arrange - Cache miss scenario
        const contentData = {
          platform: 'YouTube',
          type: 'video',
          videoId: 'dQw4w9WgXcQ',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: 'Test Video',
        };

        // Mock cache misses
        mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
        mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

        // Mock Discord channel with content containing the video URL
        const mockChannel = {
          messages: {
            fetch: jest.fn().mockResolvedValue(
              new Map([
                [
                  'msg1',
                  {
                    id: 'msg1',
                    content: 'Check out this video: https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                    createdAt: new Date('2024-01-01T10:05:00Z'),
                  },
                ],
              ])
            ),
          },
        };

        mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

        // Act
        const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

        // Assert
        expect(result).toEqual({
          found: true,
          foundIn: 'recent_discord_youtube',
          channelName: 'YouTube',
          messageId: 'msg1',
          timestamp: '2024-01-01T10:05:00.000Z',
        });

        // Verify cache was checked first
        expect(mockDuplicateDetector.isVideoIdKnown).toHaveBeenCalledWith('dQw4w9WgXcQ');
        expect(mockDuplicateDetector.isDuplicateByUrl).toHaveBeenCalledWith(contentData.url);

        // Verify live Discord scan was triggered
        expect(mockDiscordService.fetchChannel).toHaveBeenCalledWith('youtube-channel-123');
        expect(mockChannel.messages.fetch).toHaveBeenCalled();

        // Verify cache was updated after finding content
        expect(mockDuplicateDetector.addVideoId).toHaveBeenCalledWith('dQw4w9WgXcQ');
      });

      it('should scan multiple X channels when checking X content', async () => {
        // Arrange - X content cache miss
        const contentData = {
          platform: 'X',
          type: 'post',
          tweetId: '1234567890123456789',
          url: 'https://x.com/user/status/1234567890123456789',
          title: 'Test Tweet',
        };

        // Mock cache misses
        mockDuplicateDetector.isTweetIdKnown.mockReturnValue(false);
        mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

        // Mock Discord channels - content found in X quotes channel
        const mockPostsChannel = {
          messages: {
            fetch: jest.fn().mockResolvedValue(new Map()),
          },
        };

        const mockQuotesChannel = {
          messages: {
            fetch: jest.fn().mockResolvedValue(
              new Map([
                [
                  'msg1',
                  {
                    id: 'msg1',
                    content: 'Quote tweet: https://x.com/user/status/1234567890123456789',
                    createdAt: new Date('2024-01-01T10:07:00Z'),
                  },
                ],
              ])
            ),
          },
        };

        mockDiscordService.fetchChannel
          .mockResolvedValueOnce(mockPostsChannel) // X posts channel
          .mockResolvedValueOnce(null) // X replies channel (not found)
          .mockResolvedValueOnce(mockQuotesChannel); // X quotes channel

        // Act
        const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

        // Assert
        expect(result).toEqual({
          found: true,
          foundIn: 'recent_discord_x',
          channelName: 'X quotes',
          messageId: 'msg1',
          timestamp: '2024-01-01T10:07:00.000Z',
        });

        // Verify multiple channels were attempted
        expect(mockDiscordService.fetchChannel).toHaveBeenCalledTimes(3);
        expect(mockDiscordService.fetchChannel).toHaveBeenNthCalledWith(1, 'x-posts-channel-123');
        expect(mockDiscordService.fetchChannel).toHaveBeenNthCalledWith(2, 'x-replies-channel-123');
        expect(mockDiscordService.fetchChannel).toHaveBeenNthCalledWith(3, 'x-quotes-channel-123');

        // Verify cache was updated
        expect(mockDuplicateDetector.markAsSeenByUrl).toHaveBeenCalledWith(contentData.url);
      });

      it('should return not found when content is not in cache or recent Discord messages', async () => {
        // Arrange - Complete cache miss
        const contentData = {
          platform: 'YouTube',
          type: 'video',
          videoId: 'NewVideo123',
          url: 'https://www.youtube.com/watch?v=NewVideo123',
          title: 'Brand New Video',
        };

        // Mock cache misses
        mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
        mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

        // Mock Discord channel with no matching content
        const mockChannel = {
          messages: {
            fetch: jest.fn().mockResolvedValue(
              new Map([
                [
                  'msg1',
                  {
                    id: 'msg1',
                    content: 'Some other video: https://www.youtube.com/watch?v=OtherVideo',
                    createdAt: new Date('2024-01-01T10:05:00Z'),
                  },
                ],
              ])
            ),
          },
        };

        mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

        // Act
        const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

        // Assert
        expect(result).toEqual({
          found: false,
        });

        // Verify both phases were executed
        expect(mockDuplicateDetector.isVideoIdKnown).toHaveBeenCalledWith('NewVideo123');
        expect(mockDuplicateDetector.isDuplicateByUrl).toHaveBeenCalledWith(contentData.url);
        expect(mockDiscordService.fetchChannel).toHaveBeenCalledWith('youtube-channel-123');

        // Verify cache was NOT updated (no content found)
        expect(mockDuplicateDetector.addVideoId).not.toHaveBeenCalled();
      });
    });

    describe('Smart Time Window Calculation', () => {
      it('should scan messages from bot startup time when bot started recently', async () => {
        // Arrange - Bot started 5 minutes ago, which is within the 10-minute window
        const botStartTime = new Date('2024-01-01T10:00:00Z');
        mockContentStateManager.getBotStartTime.mockReturnValue(botStartTime);

        const contentData = {
          platform: 'YouTube',
          type: 'video',
          videoId: 'test123',
          url: 'https://www.youtube.com/watch?v=test123',
        };

        // Mock cache miss
        mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
        mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

        const mockChannel = {
          messages: {
            fetch: jest.fn().mockResolvedValue(new Map()),
          },
        };

        mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

        // Mock current time to be 5 minutes after bot start
        jest.setSystemTime(new Date('2024-01-01T10:05:00Z'));

        // Act
        await coordinator.checkForPreviouslyAnnouncedContent(contentData);

        // Assert - Should use bot start time (more recent than 10 minutes ago)
        expect(coordinator.getSnowflakeFromDate).toHaveBeenCalledWith(botStartTime);
      });

      it('should scan messages from 10 minutes ago when bot started earlier', async () => {
        // Arrange - Bot started 30 minutes ago, so use 10-minute window
        const botStartTime = new Date('2024-01-01T09:30:00Z');
        mockContentStateManager.getBotStartTime.mockReturnValue(botStartTime);

        const contentData = {
          platform: 'YouTube',
          type: 'video',
          videoId: 'test123',
          url: 'https://www.youtube.com/watch?v=test123',
        };

        // Mock cache miss
        mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
        mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

        const mockChannel = {
          messages: {
            fetch: jest.fn().mockResolvedValue(new Map()),
          },
        };

        mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

        // Mock current time to be 10:00 AM
        jest.setSystemTime(new Date('2024-01-01T10:00:00Z'));

        // Act
        await coordinator.checkForPreviouslyAnnouncedContent(contentData);

        // Assert - Should use 10 minutes ago (09:50) instead of bot start time (09:30)
        const expectedScanTime = new Date('2024-01-01T09:50:00Z');
        expect(coordinator.getSnowflakeFromDate).toHaveBeenCalledWith(expectedScanTime);
      });
    });

    describe('Content Matching Patterns', () => {
      it('should match YouTube content by video ID patterns', async () => {
        // Arrange
        const contentData = {
          platform: 'YouTube',
          type: 'video',
          videoId: 'dQw4w9WgXcQ',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        };

        mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
        mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

        // Test different YouTube URL patterns
        const testCases = [
          'Direct video ID: dQw4w9WgXcQ',
          'Short URL: https://youtu.be/dQw4w9WgXcQ',
          'Full URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        ];

        for (const [index, messageContent] of testCases.entries()) {
          const mockChannel = {
            messages: {
              fetch: jest.fn().mockResolvedValue(
                new Map([
                  [
                    `msg${index}`,
                    {
                      id: `msg${index}`,
                      content: messageContent,
                      createdAt: new Date('2024-01-01T10:05:00Z'),
                    },
                  ],
                ])
              ),
            },
          };

          mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

          // Act
          const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

          // Assert
          expect(result.found).toBe(true);
          expect(result.foundIn).toBe('recent_discord_youtube');
          expect(result.messageId).toBe(`msg${index}`);

          // Reset mocks for next iteration
          jest.clearAllMocks();
          mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
          mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);
        }
      });

      it('should match X content by tweet ID and status URL patterns', async () => {
        // Arrange
        const contentData = {
          platform: 'X',
          type: 'post',
          tweetId: '1234567890123456789',
          url: 'https://x.com/user/status/1234567890123456789',
        };

        mockDuplicateDetector.isTweetIdKnown.mockReturnValue(false);
        mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

        // Test different X URL patterns
        const testCases = [
          'Tweet ID: 1234567890123456789',
          'Status URL: https://x.com/user/status/1234567890123456789',
        ];

        for (const [index, messageContent] of testCases.entries()) {
          const mockChannel = {
            messages: {
              fetch: jest.fn().mockResolvedValue(
                new Map([
                  [
                    `msg${index}`,
                    {
                      id: `msg${index}`,
                      content: messageContent,
                      createdAt: new Date('2024-01-01T10:05:00Z'),
                    },
                  ],
                ])
              ),
            },
          };

          mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

          // Act
          const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

          // Assert
          expect(result.found).toBe(true);
          expect(result.foundIn).toBe('recent_discord_x');
          expect(result.messageId).toBe(`msg${index}`);

          // Reset mocks for next iteration
          jest.clearAllMocks();
          mockDuplicateDetector.isTweetIdKnown.mockReturnValue(false);
          mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);
        }
      });
    });

    describe('Error Handling and Fallbacks', () => {
      it('should handle Discord service not ready gracefully', async () => {
        // Arrange
        mockDiscordService.isReady.mockReturnValue(false);

        const contentData = {
          platform: 'YouTube',
          type: 'video',
          videoId: 'test123',
          url: 'https://www.youtube.com/watch?v=test123',
        };

        // Mock cache miss
        mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
        mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

        // Act
        const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

        // Assert
        expect(result).toEqual({
          found: false,
        });

        // Should not attempt Discord operations
        expect(mockDiscordService.fetchChannel).not.toHaveBeenCalled();
      });

      it('should handle individual channel fetch errors gracefully', async () => {
        // Arrange
        const contentData = {
          platform: 'X',
          type: 'post',
          tweetId: '1234567890123456789',
          url: 'https://x.com/user/status/1234567890123456789',
        };

        // Mock cache miss
        mockDuplicateDetector.isTweetIdKnown.mockReturnValue(false);
        mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

        // Mock channel fetch errors and success
        mockDiscordService.fetchChannel
          .mockRejectedValueOnce(new Error('Channel 1 access denied'))
          .mockRejectedValueOnce(new Error('Channel 2 not found'))
          .mockResolvedValueOnce({
            messages: {
              fetch: jest.fn().mockResolvedValue(
                new Map([
                  [
                    'msg1',
                    {
                      id: 'msg1',
                      content: 'Found tweet: https://x.com/user/status/1234567890123456789',
                      createdAt: new Date('2024-01-01T10:05:00Z'),
                    },
                  ],
                ])
              ),
            },
          });

        // Act
        const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

        // Assert - Should still find content despite earlier channel errors
        expect(result.found).toBe(true);
        expect(result.foundIn).toBe('recent_discord_x');
        expect(result.messageId).toBe('msg1');

        // Should have attempted all configured channels
        expect(mockDiscordService.fetchChannel).toHaveBeenCalledTimes(3);
      });

      it('should handle no duplicate detector gracefully', async () => {
        // Arrange - Create coordinator without duplicate detector
        const coordinatorWithoutDetector = new ContentCoordinator(
          mockContentStateManager,
          mockContentAnnouncer,
          null, // No duplicate detector
          mockContentClassifier,
          mockLogger,
          mockConfig,
          mockDependencies.debugFlagManager,
          mockDependencies.metricsManager,
          mockDiscordService
        );

        const contentData = {
          platform: 'YouTube',
          type: 'video',
          videoId: 'test123',
          url: 'https://www.youtube.com/watch?v=test123',
        };

        // Act
        const result = await coordinatorWithoutDetector.checkForPreviouslyAnnouncedContent(contentData);

        // Assert
        expect(result).toEqual({
          found: false,
          reason: 'no_duplicate_detector',
        });

        // Should not attempt Discord operations
        expect(mockDiscordService.fetchChannel).not.toHaveBeenCalled();
      });
    });
  });

  describe('Integration with Content Processing', () => {
    it('should prevent duplicate announcements using two-phase detection in full processing flow', async () => {
      // Arrange - Simulate the race condition scenario
      const contentData = {
        platform: 'YouTube',
        type: 'video',
        videoId: 'RaceConditionTest',
        url: 'https://www.youtube.com/watch?v=RaceConditionTest',
        title: 'Race Condition Test Video',
        publishedAt: '2024-01-01T10:10:00Z',
      };

      // Mock cache miss (content posted after startup but before bot detection)
      mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
      mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

      // Mock Discord channel with manually posted content
      const mockChannel = {
        messages: {
          fetch: jest.fn().mockResolvedValue(
            new Map([
              [
                'manual-post',
                {
                  id: 'manual-post',
                  content: 'I just found this great video: https://www.youtube.com/watch?v=RaceConditionTest',
                  createdAt: new Date('2024-01-01T10:05:00Z'), // Posted after bot start but before detection
                },
              ],
            ])
          ),
        },
      };

      mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

      // Act - Process content (this calls checkForPreviouslyAnnouncedContent internally)
      const result = await coordinator.processContent('RaceConditionTest', 'scraper', contentData);

      // Assert - Content should be skipped due to previous manual announcement
      expect(result.action).toBe('skip');
      expect(result.reason).toBe('previously_announced');
      expect(result.foundIn).toBe('recent_discord_youtube');

      // Verify announcement was NOT made
      expect(mockContentAnnouncer.announceContent).not.toHaveBeenCalled();

      // Verify duplicate detector was updated with found content
      expect(mockDuplicateDetector.addVideoId).toHaveBeenCalledWith('RaceConditionTest');
    });

    it('should allow announcement when content truly has not been seen before', async () => {
      // Arrange - Completely new content
      const contentData = {
        platform: 'YouTube',
        type: 'video',
        videoId: 'BrandNewVideo',
        url: 'https://www.youtube.com/watch?v=BrandNewVideo',
        title: 'Brand New Video',
        publishedAt: '2024-01-01T10:10:00Z',
      };

      // Mock complete cache miss
      mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
      mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

      // Mock Discord channel with no matching content
      const mockChannel = {
        messages: {
          fetch: jest.fn().mockResolvedValue(
            new Map([
              [
                'other-content',
                {
                  id: 'other-content',
                  content: 'Some other video: https://www.youtube.com/watch?v=SomeOtherVideo',
                  createdAt: new Date('2024-01-01T10:05:00Z'),
                },
              ],
            ])
          ),
        },
      };

      mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

      // Act
      const result = await coordinator.processContent('BrandNewVideo', 'scraper', contentData);

      // Assert - Content should be announced
      expect(result.action).toBe('announced');

      // Verify announcement was made
      expect(mockContentAnnouncer.announceContent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'BrandNewVideo',
          videoId: 'BrandNewVideo',
          url: 'https://www.youtube.com/watch?v=BrandNewVideo',
          title: 'Brand New Video',
        })
      );

      // Verify duplicate detector was updated
      expect(mockDuplicateDetector.markAsSeenWithFingerprint || mockDuplicateDetector.markAsSeen).toHaveBeenCalled();
    });

    it('should handle the exact race condition timeline described in requirements', async () => {
      // Arrange - Reproduce the exact timeline from the requirements:
      // 1. Bot starts → Scans Discord history → Populates duplicate detector cache
      // 2. User posts content link manually in Discord (after startup, before bot detection)
      // 3. Bot detects same content → Should find it and skip

      const contentData = {
        platform: 'X',
        type: 'post',
        tweetId: '1840123456789012345',
        url: 'https://x.com/user/status/1840123456789012345',
        title: 'Important Tweet',
        publishedAt: '2024-01-01T10:08:00Z',
      };

      // Step 1: Bot startup scan completed (cache populated with other content, not this one)
      mockDuplicateDetector.isTweetIdKnown.mockReturnValue(false); // Not in startup cache

      // Step 2: User manually posted the link at 10:06 AM (2 minutes after startup, 2 minutes before detection)
      const mockChannel = {
        messages: {
          fetch: jest.fn().mockResolvedValue(
            new Map([
              [
                'user-manual-post',
                {
                  id: 'user-manual-post',
                  content: 'Hey everyone, check this out: https://x.com/user/status/1840123456789012345',
                  createdAt: new Date('2024-01-01T10:06:00Z'), // Between startup and detection
                  author: { username: 'regularuser' }, // Not the bot
                },
              ],
            ])
          ),
        },
      };

      mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

      // Step 3: Bot detects the same content at 10:08 AM and should find the manual post
      jest.setSystemTime(new Date('2024-01-01T10:08:00Z'));

      // Act
      const result = await coordinator.processContent('1840123456789012345', 'scraper', contentData);

      // Assert - Bot should skip announcing because user already posted it manually
      expect(result.action).toBe('skip');
      expect(result.reason).toBe('previously_announced');
      expect(result.foundIn).toBe('recent_discord_x');

      // Verify the race condition was properly detected and prevented
      expect(mockContentAnnouncer.announceContent).not.toHaveBeenCalled();

      // Verify cache was updated to prevent future duplicates
      expect(mockDuplicateDetector.markAsSeenByUrl).toHaveBeenCalledWith(contentData.url);
    });
  });

  describe('Edge Cases and Advanced Race Condition Scenarios', () => {
    it('should handle content posted in multiple channels (first match wins)', async () => {
      // Arrange - Content appears in multiple channels, should return first match
      const contentData = {
        platform: 'X',
        type: 'post',
        tweetId: '1234567890123456789',
        url: 'https://x.com/user/status/1234567890123456789',
      };

      mockDuplicateDetector.isTweetIdKnown.mockReturnValue(false);
      mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

      // Mock channels with content in both
      const mockPostsChannel = {
        messages: {
          fetch: jest.fn().mockResolvedValue(
            new Map([
              [
                'posts-msg',
                {
                  id: 'posts-msg',
                  content: 'New post: https://x.com/user/status/1234567890123456789',
                  createdAt: new Date('2024-01-01T10:05:00Z'),
                },
              ],
            ])
          ),
        },
      };

      const mockRepliesChannel = {
        messages: {
          fetch: jest.fn().mockResolvedValue(
            new Map([
              [
                'replies-msg',
                {
                  id: 'replies-msg',
                  content: 'Reply to: https://x.com/user/status/1234567890123456789',
                  createdAt: new Date('2024-01-01T10:06:00Z'),
                },
              ],
            ])
          ),
        },
      };

      mockDiscordService.fetchChannel.mockResolvedValueOnce(mockPostsChannel).mockResolvedValueOnce(mockRepliesChannel);

      // Act
      const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

      // Assert - Should return first match (posts channel)
      expect(result.found).toBe(true);
      expect(result.channelName).toBe('X posts');
      expect(result.messageId).toBe('posts-msg');

      // Should not check remaining channels after finding first match
      expect(mockDiscordService.fetchChannel).toHaveBeenCalledTimes(1);
    });

    it('should handle messages exactly at the time boundary', async () => {
      // Arrange - Message posted exactly at bot start time
      const botStartTime = new Date('2024-01-01T10:00:00Z');
      mockContentStateManager.getBotStartTime.mockReturnValue(botStartTime);

      const contentData = {
        platform: 'YouTube',
        type: 'video',
        videoId: 'TimeBoundaryTest',
        url: 'https://www.youtube.com/watch?v=TimeBoundaryTest',
      };

      mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
      mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

      const mockChannel = {
        messages: {
          fetch: jest.fn().mockResolvedValue(
            new Map([
              [
                'boundary-msg',
                {
                  id: 'boundary-msg',
                  content: 'Posted at startup: https://www.youtube.com/watch?v=TimeBoundaryTest',
                  createdAt: botStartTime, // Exactly at bot start time
                },
              ],
            ])
          ),
        },
      };

      mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

      // Act
      const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

      // Assert - Should find the message
      expect(result.found).toBe(true);
      expect(result.messageId).toBe('boundary-msg');
    });

    it('should handle partial URL matches correctly', async () => {
      // Arrange - Test that partial URL matches don't trigger false positives
      const contentData = {
        platform: 'YouTube',
        type: 'video',
        videoId: 'UniqueTestId123',
        url: 'https://www.youtube.com/watch?v=UniqueTestId123',
      };

      mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
      mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

      const mockChannel = {
        messages: {
          fetch: jest.fn().mockResolvedValue(
            new Map([
              [
                'partial-match',
                {
                  id: 'partial-match',
                  content: 'Similar video: https://www.youtube.com/watch?v=DifferentId999', // Completely different video ID
                  createdAt: new Date('2024-01-01T10:05:00Z'),
                },
              ],
              [
                'substring-match',
                {
                  id: 'substring-match',
                  content: 'Contains substring: UniqueTest but not the full ID', // Partial ID but not enough to match
                  createdAt: new Date('2024-01-01T10:05:00Z'),
                },
              ],
            ])
          ),
        },
      };

      mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

      // Act
      const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

      // Assert - Should NOT find matches (different video IDs and no exact URL match)
      expect(result.found).toBe(false);
    });

    it('should handle very recent messages (within seconds of detection)', async () => {
      // Arrange - Message posted just seconds before detection
      const contentData = {
        platform: 'YouTube',
        type: 'video',
        videoId: 'JustPosted123',
        url: 'https://www.youtube.com/watch?v=JustPosted123',
      };

      mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
      mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

      // Mock current time
      const detectionTime = new Date('2024-01-01T10:08:00Z');
      jest.setSystemTime(detectionTime);

      const mockChannel = {
        messages: {
          fetch: jest.fn().mockResolvedValue(
            new Map([
              [
                'very-recent',
                {
                  id: 'very-recent',
                  content: 'Just posted: https://www.youtube.com/watch?v=JustPosted123',
                  createdAt: new Date('2024-01-01T10:07:58Z'), // 2 seconds before detection
                },
              ],
            ])
          ),
        },
      };

      mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

      // Act
      const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

      // Assert - Should find the very recent message
      expect(result.found).toBe(true);
      expect(result.messageId).toBe('very-recent');
    });

    it('should handle concurrent race condition detection calls', async () => {
      // Arrange - Multiple simultaneous checks for the same content
      const contentData = {
        platform: 'YouTube',
        type: 'video',
        videoId: 'ConcurrentTest',
        url: 'https://www.youtube.com/watch?v=ConcurrentTest',
      };

      let callCount = 0;
      mockDuplicateDetector.isVideoIdKnown.mockImplementation(() => {
        callCount++;
        return false; // Cache miss for all calls
      });
      mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

      const mockChannel = {
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map()),
        },
      };

      mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

      // Act - Make multiple concurrent calls
      const promises = [
        coordinator.checkForPreviouslyAnnouncedContent(contentData),
        coordinator.checkForPreviouslyAnnouncedContent(contentData),
        coordinator.checkForPreviouslyAnnouncedContent(contentData),
      ];

      const results = await Promise.all(promises);

      // Assert - All calls should complete successfully
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.found).toBe(false); // No content found
      });

      // Verify all calls executed the cache check
      expect(callCount).toBe(3);
    });

    it('should handle content with missing platform or type gracefully', async () => {
      // Arrange - Content data with missing platform
      const malformedContentData = {
        // platform: missing
        type: 'video',
        videoId: 'MalformedTest',
        url: 'https://www.youtube.com/watch?v=MalformedTest',
      };

      // Act
      const result = await coordinator.checkForPreviouslyAnnouncedContent(malformedContentData);

      // Assert - Should handle gracefully and fall back to URL checking
      expect(result.found).toBe(false);

      // Should still check URL-based duplicate detection
      expect(mockDuplicateDetector.isDuplicateByUrl).toHaveBeenCalledWith(malformedContentData.url);
    });

    it('should handle empty Discord channel messages', async () => {
      // Arrange - Channel exists but has no messages
      const contentData = {
        platform: 'YouTube',
        type: 'video',
        videoId: 'EmptyChannel',
        url: 'https://www.youtube.com/watch?v=EmptyChannel',
      };

      mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
      mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

      const mockChannel = {
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map()), // Empty message collection
        },
      };

      mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

      // Act
      const result = await coordinator.checkForPreviouslyAnnouncedContent(contentData);

      // Assert - Should handle empty channels gracefully
      expect(result.found).toBe(false);
    });

    it('should handle very long Discord message scanning timeout gracefully', async () => {
      // Arrange - Simulate a slow Discord API response using fake timers
      const contentData = {
        platform: 'YouTube',
        type: 'video',
        videoId: 'SlowResponse',
        url: 'https://www.youtube.com/watch?v=SlowResponse',
      };

      mockDuplicateDetector.isVideoIdKnown.mockReturnValue(false);
      mockDuplicateDetector.isDuplicateByUrl.mockResolvedValue(false);

      let fetchResolve;
      const mockChannel = {
        messages: {
          fetch: jest.fn().mockImplementation(
            () =>
              new Promise(resolve => {
                fetchResolve = resolve;
                // Use fake timer instead of real setTimeout
                setTimeout(() => resolve(new Map()), 100);
              })
          ),
        },
      };

      mockDiscordService.fetchChannel.mockResolvedValue(mockChannel);

      // Act - Start the operation
      const resultPromise = coordinator.checkForPreviouslyAnnouncedContent(contentData);

      // Advance fake timers to resolve the setTimeout
      await jest.advanceTimersByTimeAsync(100);

      const result = await resultPromise;

      // Assert - Should complete and handle timeout scenario
      expect(result.found).toBe(false);
    }, 10000); // Increase timeout for this specific test
  });
});
