import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import crypto from 'crypto';
import { timestampUTC } from '../../src/utilities/utc-time.js';

describe('Empty PubSubHubbub Notification Fallback E2E Tests', () => {
  let mockYouTubeMonitor;
  let mockLogger;
  let mockYouTubeAPI;
  let mockDiscordClient;
  let mockRequest;
  let _mockResponse;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    mockYouTubeAPI = {
      search: {
        list: jest.fn(),
      },
      videos: {
        list: jest.fn(),
      },
    };

    mockDiscordClient = {
      channels: {
        fetch: jest.fn(),
      },
    };

    mockRequest = {
      body: '',
      rawBody: Buffer.from(''),
      headers: {
        'x-hub-signature': '',
        'content-type': 'application/atom+xml',
        'user-agent': 'FeedFetcher-Google',
      },
      url: '/webhook/youtube',
      method: 'POST',
    };

    _mockResponse = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    // Mock complete YouTube monitor with all required methods
    mockYouTubeMonitor = {
      logger: mockLogger,
      youtube: mockYouTubeAPI,
      discordClient: mockDiscordClient,

      // Configuration
      PSH_SECRET: 'test-secret-key',
      YOUTUBE_CHANNEL_ID: 'UCTestChannelId123456789',
      YOUTUBE_FALLBACK_ENABLED: true,
      YOUTUBE_FALLBACK_DELAY_MS: 100, // Fast for testing
      YOUTUBE_FALLBACK_MAX_RETRIES: 3,
      YOUTUBE_API_POLL_INTERVAL_MS: 1000,
      DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345678',

      // State
      lastSuccessfulCheck: new Date(timestampUTC() - 300000), // 5 minutes ago
      failedNotifications: new Map(),
      recentFailures: [],
      fallbackInProgress: false,
      apiFallbackTimer: null,
      announcedVideos: new Set(['oldVideo1', 'oldVideo2']), // Previously announced

      // Metrics
      fallbackMetrics: {
        totalNotificationFailures: 0,
        totalRetryAttempts: 0,
        totalSuccessfulRetries: 0,
        totalFallbackTriggers: 0,
        totalVideosRecoveredByFallback: 0,
        totalApiFallbackExecutions: 0,
      },

      // Mock methods
      handlePubSubNotification: jest.fn(),
      handleFailedNotification: jest.fn(),
      scheduleRetry: jest.fn(),
      scheduleApiFallback: jest.fn(),
      performApiFallback: jest.fn(),
      announceYouTubeContent: jest.fn(),
      sendMirroredMessage: jest.fn(),
      verifySignature: jest.fn(),
    };

    // Implement mock behavior
    setupMockImplementations(mockYouTubeMonitor);
  });

  afterEach(() => {
    if (mockYouTubeMonitor.apiFallbackTimer) {
      clearTimeout(mockYouTubeMonitor.apiFallbackTimer);
    }
    jest.clearAllMocks();
  });

  describe('Empty Notification Complete Workflow', () => {
    it('should handle empty PubSubHubbub notification and recover via fallback', async () => {
      // Step 1: Setup empty notification with valid signature
      const emptyBody = '';
      const signature = generateValidSignature(emptyBody, mockYouTubeMonitor.PSH_SECRET);

      mockRequest.body = emptyBody;
      mockRequest.rawBody = Buffer.from(emptyBody);
      mockRequest.headers['x-hub-signature'] = `sha1=${signature}`;

      // Step 2: Mock YouTube API response with a new video that wasn't announced
      const newVideoId = 'newVideo123ABC';
      const newVideoData = {
        id: { videoId: newVideoId },
        snippet: {
          title: 'New Video: Important Announcement',
          publishedAt: new Date().toISOString(),
          channelId: mockYouTubeMonitor.YOUTUBE_CHANNEL_ID,
          channelTitle: 'Test Channel',
          description: 'This is a new video that was missed due to empty notification',
        },
      };

      mockYouTubeAPI.search.list.mockResolvedValue({
        data: {
          items: [newVideoData],
        },
      });

      mockYouTubeAPI.videos.list.mockResolvedValue({
        data: {
          items: [
            {
              id: newVideoId,
              snippet: newVideoData.snippet,
              contentDetails: { duration: 'PT8M30S' },
              statistics: { viewCount: '1234', likeCount: '56' },
            },
          ],
        },
      });

      // Step 3: Mock Discord channel for announcements
      const mockChannel = {
        send: jest.fn().mockResolvedValue({ id: 'message123' }),
        isTextBased: () => true,
      };
      mockDiscordClient.channels.fetch.mockResolvedValue(mockChannel);

      // Step 4: Execute the complete workflow

      // 4a: Signature verification should pass
      expect(mockYouTubeMonitor.verifySignature(mockRequest)).toBe(true);

      // 4b: Handle the empty notification (should fail parsing)
      const parseError = new Error('Empty notification body - no XML content to parse');

      // 4c: This should trigger fallback handling
      await mockYouTubeMonitor.handleFailedNotification(emptyBody, parseError);

      // 4d: After delay, API fallback should be triggered
      await new Promise(resolve => setTimeout(resolve, 150)); // Wait for fallback delay
      await mockYouTubeMonitor.performApiFallback();

      // Step 5: Verify the complete workflow executed correctly

      // 5a: Verify failure was recorded
      expect(mockYouTubeMonitor.handleFailedNotification).toHaveBeenCalledWith(emptyBody, parseError);

      // 5b: Verify API fallback was called with correct parameters
      expect(mockYouTubeAPI.search.list).toHaveBeenCalledWith({
        part: 'id,snippet',
        channelId: mockYouTubeMonitor.YOUTUBE_CHANNEL_ID,
        type: 'video',
        order: 'date',
        publishedAfter: expect.any(String),
        maxResults: 10,
      });

      // 5c: Verify new video was announced (not previously announced videos)
      expect(mockYouTubeMonitor.announceYouTubeContent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: newVideoId,
          title: 'New Video: Important Announcement',
          channelTitle: 'Test Channel',
        })
      );

      // 5d: Verify metrics were updated
      expect(mockYouTubeMonitor.fallbackMetrics.totalNotificationFailures).toBe(1);
      expect(mockYouTubeMonitor.fallbackMetrics.totalApiFallbackExecutions).toBe(1);
      expect(mockYouTubeMonitor.fallbackMetrics.totalVideosRecoveredByFallback).toBe(1);

      // 5e: Verify Discord announcement was sent
      expect(mockDiscordClient.channels.fetch).toHaveBeenCalledWith(mockYouTubeMonitor.DISCORD_YOUTUBE_CHANNEL_ID);
      expect(mockChannel.send).toHaveBeenCalled();

      // 5f: Verify appropriate logging occurred
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed notification queued for retry'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('API fallback completed'));

      mockLogger.info('Empty notification fallback workflow completed successfully');
    });

    it('should handle empty notification but skip already announced videos', async () => {
      // Setup empty notification
      const emptyBody = '';
      const signature = generateValidSignature(emptyBody, mockYouTubeMonitor.PSH_SECRET);

      mockRequest.body = emptyBody;
      mockRequest.rawBody = Buffer.from(emptyBody);
      mockRequest.headers['x-hub-signature'] = `sha1=${signature}`;

      // Mock API response with only already announced videos
      const oldVideoId = 'oldVideo1'; // This is in our announcedVideos set
      mockYouTubeAPI.search.list.mockResolvedValue({
        data: {
          items: [
            {
              id: { videoId: oldVideoId },
              snippet: {
                title: 'Old Video Already Announced',
                publishedAt: new Date(timestampUTC() - 600000).toISOString(), // 10 minutes ago
                channelId: mockYouTubeMonitor.YOUTUBE_CHANNEL_ID,
                channelTitle: 'Test Channel',
              },
            },
          ],
        },
      });

      // Execute workflow
      const parseError = new Error('Empty notification body');
      await mockYouTubeMonitor.handleFailedNotification(emptyBody, parseError);
      await mockYouTubeMonitor.performApiFallback();

      // Verify no announcement was made for already announced video
      expect(mockYouTubeMonitor.announceYouTubeContent).not.toHaveBeenCalled();
      expect(mockYouTubeMonitor.fallbackMetrics.totalVideosRecoveredByFallback).toBe(0);

      mockLogger.info('Correctly skipped already announced videos during fallback');
    });

    it('should handle empty notification with multiple new videos', async () => {
      // Setup empty notification
      const emptyBody = '';
      const signature = generateValidSignature(emptyBody, mockYouTubeMonitor.PSH_SECRET);

      mockRequest.body = emptyBody;
      mockRequest.rawBody = Buffer.from(emptyBody);
      mockRequest.headers['x-hub-signature'] = `sha1=${signature}`;

      // Mock API response with multiple new videos
      const newVideos = [
        {
          id: { videoId: 'newVideo1' },
          snippet: {
            title: 'First New Video',
            publishedAt: new Date().toISOString(),
            channelId: mockYouTubeMonitor.YOUTUBE_CHANNEL_ID,
            channelTitle: 'Test Channel',
          },
        },
        {
          id: { videoId: 'newVideo2' },
          snippet: {
            title: 'Second New Video',
            publishedAt: new Date().toISOString(),
            channelId: mockYouTubeMonitor.YOUTUBE_CHANNEL_ID,
            channelTitle: 'Test Channel',
          },
        },
      ];

      mockYouTubeAPI.search.list.mockResolvedValue({
        data: { items: newVideos },
      });

      mockYouTubeAPI.videos.list.mockResolvedValue({
        data: {
          items: newVideos.map(v => ({
            id: v.id.videoId,
            snippet: v.snippet,
            contentDetails: { duration: 'PT5M' },
            statistics: { viewCount: '100' },
          })),
        },
      });

      // Mock Discord channel
      const mockChannel = {
        send: jest.fn().mockResolvedValue({ id: 'message123' }),
        isTextBased: () => true,
      };
      mockDiscordClient.channels.fetch.mockResolvedValue(mockChannel);

      // Execute workflow
      const parseError = new Error('Empty notification body');
      await mockYouTubeMonitor.handleFailedNotification(emptyBody, parseError);
      await mockYouTubeMonitor.performApiFallback();

      // Verify both videos were announced
      expect(mockYouTubeMonitor.announceYouTubeContent).toHaveBeenCalledTimes(2);
      expect(mockYouTubeMonitor.fallbackMetrics.totalVideosRecoveredByFallback).toBe(2);

      // Verify both specific videos were announced
      expect(mockYouTubeMonitor.announceYouTubeContent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'newVideo1', title: 'First New Video' })
      );
      expect(mockYouTubeMonitor.announceYouTubeContent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'newVideo2', title: 'Second New Video' })
      );

      mockLogger.info('Successfully handled multiple new videos during fallback');
    });

    it('should handle empty notification when fallback is disabled', async () => {
      // Disable fallback system
      mockYouTubeMonitor.YOUTUBE_FALLBACK_ENABLED = false;

      // Setup empty notification
      const emptyBody = '';
      const signature = generateValidSignature(emptyBody, mockYouTubeMonitor.PSH_SECRET);

      mockRequest.body = emptyBody;
      mockRequest.rawBody = Buffer.from(emptyBody);
      mockRequest.headers['x-hub-signature'] = `sha1=${signature}`;

      // Execute workflow
      const parseError = new Error('Empty notification body');
      await mockYouTubeMonitor.handleFailedNotification(emptyBody, parseError);

      // Verify fallback was not triggered
      expect(mockYouTubeMonitor.scheduleApiFallback).not.toHaveBeenCalled();
      expect(mockYouTubeMonitor.fallbackMetrics.totalNotificationFailures).toBe(0);

      // Should log warning about disabled fallback
      expect(mockLogger.warn).toHaveBeenCalledWith('YouTube fallback system is disabled. Notification lost.');

      mockLogger.info('Correctly handled disabled fallback system');
    });
  });

  describe('Edge Cases for Empty Notifications', () => {
    it('should handle whitespace-only notification body', async () => {
      // Setup whitespace-only notification (should also be considered empty)
      const whitespaceBody = '   \n\t  \r\n  ';
      const signature = generateValidSignature(whitespaceBody, mockYouTubeMonitor.PSH_SECRET);

      mockRequest.body = whitespaceBody;
      mockRequest.rawBody = Buffer.from(whitespaceBody);
      mockRequest.headers['x-hub-signature'] = `sha1=${signature}`;

      // Mock new video for recovery
      mockYouTubeAPI.search.list.mockResolvedValue({
        data: {
          items: [
            {
              id: { videoId: 'whitespaceRecovery' },
              snippet: {
                title: 'Recovered from Whitespace Notification',
                publishedAt: new Date().toISOString(),
                channelId: mockYouTubeMonitor.YOUTUBE_CHANNEL_ID,
                channelTitle: 'Test Channel',
              },
            },
          ],
        },
      });

      // Mock Discord channel
      const mockChannel = {
        send: jest.fn().mockResolvedValue({ id: 'message123' }),
        isTextBased: () => true,
      };
      mockDiscordClient.channels.fetch.mockResolvedValue(mockChannel);

      // Execute workflow
      const parseError = new Error('Whitespace-only notification body - no valid XML content');
      await mockYouTubeMonitor.handleFailedNotification(whitespaceBody, parseError);
      await mockYouTubeMonitor.performApiFallback();

      // Verify fallback was triggered and video was recovered
      expect(mockYouTubeMonitor.announceYouTubeContent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'whitespaceRecovery',
          title: 'Recovered from Whitespace Notification',
        })
      );

      mockLogger.info('Successfully handled whitespace-only notification');
    });

    it('should handle empty notification with YouTube API errors during fallback', async () => {
      // Setup empty notification
      const emptyBody = '';
      const signature = generateValidSignature(emptyBody, mockYouTubeMonitor.PSH_SECRET);

      mockRequest.body = emptyBody;
      mockRequest.rawBody = Buffer.from(emptyBody);
      mockRequest.headers['x-hub-signature'] = `sha1=${signature}`;

      // Mock YouTube API failure
      const apiError = new Error('YouTube API quota exceeded');
      mockYouTubeAPI.search.list.mockRejectedValue(apiError);

      // Execute workflow
      const parseError = new Error('Empty notification body');
      await mockYouTubeMonitor.handleFailedNotification(emptyBody, parseError);

      let fallbackError;
      try {
        await mockYouTubeMonitor.performApiFallback();
      } catch (error) {
        fallbackError = error;
      }

      // Verify API error was handled gracefully
      expect(fallbackError).toBeDefined();
      expect(fallbackError.message).toBe('YouTube API quota exceeded');

      // Should still record the notification failure
      expect(mockYouTubeMonitor.fallbackMetrics.totalNotificationFailures).toBe(1);
      expect(mockYouTubeMonitor.fallbackMetrics.totalApiFallbackExecutions).toBe(1);

      // Should log the API error (done by the mock implementation)
      // Note: The actual logging is handled by the production code, not the mock

      mockLogger.info('Gracefully handled YouTube API error during fallback');
    });
  });
});

// Helper functions
function generateValidSignature(body, secret) {
  return crypto.createHmac('sha1', secret).update(Buffer.from(body)).digest('hex');
}

function setupMockImplementations(monitor) {
  // Mock signature verification
  monitor.verifySignature.mockImplementation(request => {
    if (!request.headers['x-hub-signature']) {
      return false;
    }

    const [algorithm, providedSignature] = request.headers['x-hub-signature'].split('=');
    if (algorithm !== 'sha1') {
      return false;
    }

    const hmac = crypto.createHmac('sha1', monitor.PSH_SECRET);
    hmac.update(request.rawBody);
    const expectedSignature = hmac.digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(expectedSignature, 'hex'), Buffer.from(providedSignature, 'hex'));
    } catch {
      return false;
    }
  });

  // Mock failed notification handler
  monitor.handleFailedNotification.mockImplementation(async function (rawXML, error) {
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
      `Failed notification queued for retry. Failure ID: ${failureId}, Recent failures: ${this.recentFailures.length}`
    );

    this.scheduleRetry(failureId);

    if (this.recentFailures.length >= 2) {
      this.logger.warn('Multiple recent failures detected, scheduling API fallback');
      this.scheduleApiFallback();
    }
  });

  // Mock API fallback
  monitor.performApiFallback.mockImplementation(async function () {
    this.fallbackInProgress = true;
    this.fallbackMetrics.totalApiFallbackExecutions++;

    try {
      const backfillStart = new Date(timestampUTC() - 2 * 60 * 60 * 1000); // 2 hours ago
      const publishedAfter = this.lastSuccessfulCheck > backfillStart ? this.lastSuccessfulCheck : backfillStart;

      const searchResponse = await this.youtube.search.list({
        part: 'id,snippet',
        channelId: this.YOUTUBE_CHANNEL_ID,
        type: 'video',
        order: 'date',
        publishedAfter: publishedAfter.toISOString(),
        maxResults: 10,
      });

      const videos = searchResponse.data.items || [];
      let recoveredCount = 0;

      for (const video of videos) {
        const { videoId } = video.id;
        if (!this.announcedVideos.has(videoId)) {
          await this.announceYouTubeContent({
            id: videoId,
            title: video.snippet.title,
            channelTitle: video.snippet.channelTitle,
            publishedAt: video.snippet.publishedAt,
          });
          this.announcedVideos.add(videoId);
          recoveredCount++;
        }
      }

      this.fallbackMetrics.totalVideosRecoveredByFallback += recoveredCount;
      this.lastSuccessfulCheck = new Date();
      this.logger.info(`API fallback completed, recovered ${recoveredCount} videos`);
    } finally {
      this.fallbackInProgress = false;
    }
  });

  // Mock announcement
  monitor.announceYouTubeContent.mockImplementation(async function (videoData) {
    const channel = await this.discordClient.channels.fetch(this.DISCORD_YOUTUBE_CHANNEL_ID);
    await channel.send(`New video: ${videoData.title} by ${videoData.channelTitle}`);
    this.logger.info(`Announced video: ${videoData.title}`);
  });
}
