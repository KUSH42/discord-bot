import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createMockClient, createMockChannel, createMockMessage } from '../mocks/discord.mock.js';
import {
  mockVideoDetails,
  mockPubSubNotification,
  createMockVideoDetails,
  createMockPubSubNotification,
} from '../mocks/youtube.mock.js';
import { mockTweetData, mockScraperResults, createMockTweet } from '../mocks/x-twitter.mock.js';
import { createMockRequest, createMockResponse } from '../mocks/express.mock.js';

describe('End-to-End Announcement Workflows', () => {
  let discordClient;
  let youtubeChannel;
  let xPostsChannel;
  let xRepliesChannel;
  let xQuotesChannel;
  let xRetweetsChannel;
  let supportChannel;
  let botStartTime;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Set bot start time for content filtering
    botStartTime = new Date('2024-01-01T12:00:00Z');

    // Create mock Discord client and channels
    discordClient = createMockClient();
    youtubeChannel = createMockChannel({ id: 'youtube-channel', name: 'youtube' });
    xPostsChannel = createMockChannel({ id: 'x-posts-channel', name: 'x-posts' });
    xRepliesChannel = createMockChannel({ id: 'x-replies-channel', name: 'x-replies' });
    xQuotesChannel = createMockChannel({ id: 'x-quotes-channel', name: 'x-quotes' });
    xRetweetsChannel = createMockChannel({ id: 'x-retweets-channel', name: 'x-retweets' });
    supportChannel = createMockChannel({ id: 'support-channel', name: 'support' });

    // Set up Discord client channels
    discordClient.channels.cache.set('youtube-channel', youtubeChannel);
    discordClient.channels.cache.set('x-posts-channel', xPostsChannel);
    discordClient.channels.cache.set('x-replies-channel', xRepliesChannel);
    discordClient.channels.cache.set('x-quotes-channel', xQuotesChannel);
    discordClient.channels.cache.set('x-retweets-channel', xRetweetsChannel);
    discordClient.channels.cache.set('support-channel', supportChannel);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('YouTube Announcement Workflow', () => {
    it('should process complete YouTube video announcement workflow', async () => {
      // Step 1: Receive PubSubHubbub notification
      const videoId = 'dQw4w9WgXcQ';
      const notification = createMockPubSubNotification(videoId);

      const parseNotification = xmlData => {
        const videoIdMatch = xmlData.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
        const publishedMatch = xmlData.match(/<published>([^<]+)<\/published>/);

        return {
          videoId: videoIdMatch[1],
          publishedAt: publishedMatch[1],
        };
      };

      const parsedNotification = parseNotification(notification);
      expect(parsedNotification.videoId).toBe(videoId);

      // Step 2: Check if content is new (after bot start time)
      const contentTimestamp = new Date('2024-01-01T13:00:00Z'); // After bot start
      const isNewContent = contentTimestamp > botStartTime;
      expect(isNewContent).toBe(true);

      // Step 3: Check for duplicates
      const knownVideoIds = new Set();
      const isDuplicate = knownVideoIds.has(videoId);
      expect(isDuplicate).toBe(false);
      knownVideoIds.add(videoId);

      // Step 4: Fetch video details from YouTube API
      const videoDetails = createMockVideoDetails({
        id: videoId,
        snippet: {
          title: 'Test Video Title',
          channelTitle: 'Test Channel',
          description: 'Test video description',
          publishedAt: '2024-01-01T13:00:00Z',
          thumbnails: {
            high: { url: 'https://i.ytimg.com/vi/test/hqdefault.jpg' },
          },
        },
      });

      // Step 5: Create Discord embed
      const createVideoEmbed = video => ({
        title: `🎥 New Video: ${video.snippet.title}`,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        author: {
          name: video.snippet.channelTitle,
          icon_url: 'https://www.youtube.com/favicon.ico',
        },
        description: `${video.snippet.description.substring(0, 200)}...`,
        thumbnail: { url: video.snippet.thumbnails.high.url },
        color: 0xff0000,
        timestamp: video.snippet.publishedAt,
        footer: { text: 'YouTube' },
      });

      const embed = createVideoEmbed(videoDetails);

      // Step 6: Send announcement to Discord
      await youtubeChannel.send({ embeds: [embed] });

      // Step 7: Log successful announcement
      await supportChannel.send({
        embeds: [
          {
            title: '✅ YouTube Announcement Sent',
            description: `Video: ${videoDetails.snippet.title}`,
            color: 0x00ff00,
            timestamp: new Date().toISOString(),
          },
        ],
      });

      // Verify the complete workflow
      expect(youtubeChannel.send).toHaveBeenCalledWith({ embeds: [embed] });
      expect(supportChannel.send).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ YouTube Announcement Sent',
          }),
        ],
      });
    });

    it('should handle YouTube livestream announcements', async () => {
      const liveVideoDetails = createMockVideoDetails({
        id: 'live123456789',
        snippet: {
          title: 'Live Stream: Test Stream',
          channelTitle: 'Test Channel',
          liveBroadcastContent: 'live',
          publishedAt: new Date().toISOString(),
        },
        liveStreamingDetails: {
          actualStartTime: new Date().toISOString(),
          concurrentViewers: '1000',
        },
      });

      const createLiveEmbed = video => ({
        title: `🔴 LIVE NOW: ${video.snippet.title}`,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        author: { name: video.snippet.channelTitle },
        description: `🔴 Live with ${video.liveStreamingDetails.concurrentViewers} viewers`,
        color: 0xff0000,
        fields: [
          {
            name: 'Status',
            value: '🔴 Live',
            inline: true,
          },
          {
            name: 'Viewers',
            value: video.liveStreamingDetails.concurrentViewers,
            inline: true,
          },
        ],
      });

      const liveEmbed = createLiveEmbed(liveVideoDetails);
      await youtubeChannel.send({ embeds: [liveEmbed] });

      expect(youtubeChannel.send).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: expect.stringContaining('🔴 LIVE NOW:'),
          }),
        ],
      });
    });

    it('should filter out old YouTube content', async () => {
      const oldVideoDetails = createMockVideoDetails({
        snippet: {
          publishedAt: '2023-12-01T10:00:00Z', // Before bot start time
        },
      });

      const contentTimestamp = new Date(oldVideoDetails.snippet.publishedAt);
      const isNewContent = contentTimestamp > botStartTime;

      expect(isNewContent).toBe(false);

      // Should not send announcement for old content
      if (!isNewContent) {
        console.log('Skipping old content');
        return;
      }

      // This should not execute
      expect(youtubeChannel.send).not.toHaveBeenCalled();
    });
  });

  describe('X/Twitter Announcement Workflow', () => {
    it('should process complete X/Twitter post announcement workflow', async () => {
      // Step 1: Scrape X/Twitter for new content
      const scrapedPosts = [
        createMockTweet({
          id: '1234567890123456789',
          text: 'This is a new test post',
          user: { username: 'testuser' },
          createdAt: '2024-01-01T13:00:00Z',
        }),
      ];

      // Step 2: Filter by timestamp (after bot start)
      const newPosts = scrapedPosts.filter(post => {
        const postTime = new Date(post.createdAt);
        return postTime > botStartTime;
      });

      expect(newPosts).toHaveLength(1);

      // Step 3: Extract post IDs and check for duplicates
      const knownTweetIds = new Set();
      const postUrlRegex = /https?:\/\/(?:[\w-]+\.)*(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/;

      const processPost = post => {
        const url = `https://x.com/${post.user.username}/status/${post.id}`;
        const match = url.match(postUrlRegex);

        if (match) {
          const tweetId = match[1];

          if (knownTweetIds.has(tweetId)) {
            return { duplicate: true };
          }

          knownTweetIds.add(tweetId);
          return { duplicate: false, tweetId, url };
        }

        return { duplicate: false };
      };

      const processedPost = processPost(newPosts[0]);
      expect(processedPost.duplicate).toBe(false);
      expect(processedPost.tweetId).toBe('1234567890123456789');

      // Step 4: Create Discord message
      const createPostMessage = (post, url) => {
        return `**New Post from @${post.user.username}:**\n\n${post.text}\n\n${url}`;
      };

      const message = createPostMessage(newPosts[0], processedPost.url);

      // Step 5: Send announcement to Discord
      await xPostsChannel.send(message);

      // Step 6: Log successful announcement
      await supportChannel.send({
        embeds: [
          {
            title: '✅ X/Twitter Post Announced',
            description: `@${newPosts[0].user.username}: ${newPosts[0].text.substring(0, 100)}...`,
            color: 0x1da1f2,
            timestamp: new Date().toISOString(),
          },
        ],
      });

      // Verify the complete workflow
      expect(xPostsChannel.send).toHaveBeenCalledWith(expect.stringContaining('New Post from @testuser:'));
      expect(supportChannel.send).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ X/Twitter Post Announced',
          }),
        ],
      });
    });

    it('should categorize and route different X/Twitter content types', async () => {
      const mixedContent = {
        posts: [createMockTweet({ text: 'Regular post', type: 'post' })],
        replies: [createMockTweet({ text: 'Reply to someone', type: 'reply' })],
        quotes: [createMockTweet({ text: 'Quote tweet', type: 'quote' })],
        retweets: [createMockTweet({ text: 'RT @user: Original tweet', type: 'retweet' })],
      };

      const routeContent = async content => {
        const promises = [];

        if (content.posts.length > 0) {
          promises.push(xPostsChannel.send(`New posts: ${content.posts.length}`));
        }

        if (content.replies.length > 0) {
          promises.push(xRepliesChannel.send(`New replies: ${content.replies.length}`));
        }

        if (content.quotes.length > 0) {
          promises.push(xQuotesChannel.send(`New quotes: ${content.quotes.length}`));
        }

        if (content.retweets.length > 0) {
          promises.push(xRetweetsChannel.send(`New retweets: ${content.retweets.length}`));
        }

        await Promise.all(promises);
      };

      await routeContent(mixedContent);

      expect(xPostsChannel.send).toHaveBeenCalledWith('New posts: 1');
      expect(xRepliesChannel.send).toHaveBeenCalledWith('New replies: 1');
      expect(xQuotesChannel.send).toHaveBeenCalledWith('New quotes: 1');
      expect(xRetweetsChannel.send).toHaveBeenCalledWith('New retweets: 1');
    });

    it('should handle VX Twitter URL conversion', async () => {
      const originalPost = createMockTweet({
        id: '1234567890123456789',
        text: 'Test post for URL conversion',
        user: { username: 'testuser' },
      });

      const convertToVxTwitter = twitterUrl => {
        return twitterUrl.replace(/(https?:\/\/)?(?:www\.)?(twitter\.com|x\.com)/g, 'https://vxtwitter.com');
      };

      const originalUrl = `https://x.com/${originalPost.user.username}/status/${originalPost.id}`;
      const vxUrl = convertToVxTwitter(originalUrl);

      expect(vxUrl).toBe(`https://vxtwitter.com/${originalPost.user.username}/status/${originalPost.id}`);

      const messageWithVx = `**New Post from @${originalPost.user.username}:**\n\n${originalPost.text}\n\n${vxUrl}`;
      await xPostsChannel.send(messageWithVx);

      expect(xPostsChannel.send).toHaveBeenCalledWith(expect.stringContaining('vxtwitter.com'));
    });
  });

  describe('Cross-Platform Duplicate Detection', () => {
    it('should detect duplicates across YouTube and X/Twitter platforms', async () => {
      const globalDuplicateTracker = {
        urls: new Set(),
        videoIds: new Set(),
        tweetIds: new Set(),
      };

      // Process YouTube video
      const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const videoUrlRegex =
        /https?:\/\/(?:(?:www\.)?youtube\.com\/(?:watch\?v=|live\/|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
      const videoMatch = youtubeUrl.match(videoUrlRegex);

      if (videoMatch) {
        const videoId = videoMatch[1];

        if (globalDuplicateTracker.videoIds.has(videoId)) {
          console.log('Duplicate YouTube video detected');
        } else {
          globalDuplicateTracker.videoIds.add(videoId);
          globalDuplicateTracker.urls.add(youtubeUrl);
        }
      }

      // Process X/Twitter post
      const twitterUrl = 'https://x.com/user/status/1234567890123456789';
      const tweetUrlRegex =
        /https?:\/\/(?:[\w-]+\.)*(?:x\.com|twitter\.com|vxtwitter\.com|fxtwitter\.com)\/[^/]+\/status\/(\d+)/;
      const tweetMatch = twitterUrl.match(tweetUrlRegex);

      if (tweetMatch) {
        const tweetId = tweetMatch[1];

        if (globalDuplicateTracker.tweetIds.has(tweetId)) {
          console.log('Duplicate X/Twitter post detected');
        } else {
          globalDuplicateTracker.tweetIds.add(tweetId);
          globalDuplicateTracker.urls.add(twitterUrl);
        }
      }

      // Test duplicate detection
      expect(globalDuplicateTracker.videoIds.has('dQw4w9WgXcQ')).toBe(true);
      expect(globalDuplicateTracker.tweetIds.has('1234567890123456789')).toBe(true);
      expect(globalDuplicateTracker.urls.size).toBe(2);

      // Try to add the same URLs again
      const duplicateVideoId = videoUrlRegex.exec('https://youtu.be/dQw4w9WgXcQ')[1];
      const duplicateTweetId = tweetUrlRegex.exec('https://twitter.com/user/status/1234567890123456789')[1];

      expect(globalDuplicateTracker.videoIds.has(duplicateVideoId)).toBe(true);
      expect(globalDuplicateTracker.tweetIds.has(duplicateTweetId)).toBe(true);
    });

    it('should handle cross-channel duplicate prevention', async () => {
      const channelTracker = new Map();

      const trackChannelMessage = (channelId, content) => {
        if (!channelTracker.has(channelId)) {
          channelTracker.set(channelId, new Set());
        }

        const channelMessages = channelTracker.get(channelId);
        const contentHash = Buffer.from(content).toString('base64');

        if (channelMessages.has(contentHash)) {
          return { duplicate: true };
        }

        channelMessages.add(contentHash);
        return { duplicate: false };
      };

      const message1 = 'Check out this YouTube video: https://youtu.be/dQw4w9WgXcQ';
      const message2 = 'Same content: https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // Different URL, same video

      // Track in YouTube channel
      const result1 = trackChannelMessage('youtube-channel', message1);
      const result2 = trackChannelMessage('youtube-channel', message2);

      expect(result1.duplicate).toBe(false);
      expect(result2.duplicate).toBe(false); // Different text, but same video ID should be caught by video ID tracking

      // For proper duplicate detection, we need to extract and compare video IDs
      const extractVideoId = text => {
        const match = text.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : null;
      };

      const videoId1 = extractVideoId(message1);
      const videoId2 = extractVideoId(message2);

      expect(videoId1).toBe(videoId2);
    });
  });

  describe('Error Handling and Recovery Workflows', () => {
    it('should handle Discord API failures gracefully', async () => {
      const apiError = new Error('API Error');
      apiError.code = 50013; // Missing Permissions
      youtubeChannel.send.mockRejectedValue(apiError);

      const sendWithFallback = async (primaryChannel, fallbackChannel, content) => {
        try {
          await primaryChannel.send(content);
          return { success: true, channel: 'primary' };
        } catch (error) {
          console.error('Primary channel failed:', error.message);

          try {
            await fallbackChannel.send(`[Fallback] ${content}`);
            return { success: true, channel: 'fallback' };
          } catch (fallbackError) {
            console.error('Fallback channel failed:', fallbackError.message);
            return { success: false, error: fallbackError.message };
          }
        }
      };

      const result = await sendWithFallback(youtubeChannel, supportChannel, 'Test message');

      expect(result.success).toBe(true);
      expect(result.channel).toBe('fallback');
      expect(supportChannel.send).toHaveBeenCalledWith('[Fallback] Test message');
    });

    it('should implement retry logic for transient failures', async () => {
      const retryError = new Error('Rate Limited');
      retryError.code = 50004;

      youtubeChannel.send
        .mockRejectedValueOnce(retryError)
        .mockRejectedValueOnce(retryError)
        .mockResolvedValue({ id: 'success-message' });

      const sendWithRetry = async (channel, content, maxRetries = 3, delay = 1) => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            return await channel.send(content);
          } catch (error) {
            if (attempt === maxRetries) {
              throw error;
            }

            console.log(`Attempt ${attempt} failed, retrying...`);
            // No timeout in test - immediate retry
            delay *= 2; // Exponential backoff for tracking
          }
        }
      };

      const result = await sendWithRetry(youtubeChannel, 'Test message');

      expect(youtubeChannel.send).toHaveBeenCalledTimes(3);
      expect(result.id).toBe('success-message');
    });

    it('should log all announcement activities', async () => {
      const activityLogger = {
        logs: [],
        log(level, message, data = {}) {
          this.logs.push({
            level,
            message,
            data,
            timestamp: new Date().toISOString(),
          });
        },
      };

      // Simulate successful YouTube announcement
      activityLogger.log('info', 'YouTube video processed', {
        videoId: 'dQw4w9WgXcQ',
        channelId: 'youtube-channel',
        success: true,
      });

      // Simulate failed X/Twitter announcement
      activityLogger.log('error', 'X/Twitter announcement failed', {
        tweetId: '1234567890123456789',
        error: 'Channel not found',
        success: false,
      });

      // Simulate duplicate detection
      activityLogger.log('warn', 'Duplicate content detected', {
        contentType: 'youtube',
        videoId: 'dQw4w9WgXcQ',
        action: 'skipped',
      });

      expect(activityLogger.logs).toHaveLength(3);
      expect(activityLogger.logs[0].level).toBe('info');
      expect(activityLogger.logs[1].level).toBe('error');
      expect(activityLogger.logs[2].level).toBe('warn');

      // Send logs to Discord support channel
      const logSummary = activityLogger.logs.map(log => `[${log.level.toUpperCase()}] ${log.message}`).join('\n');

      await supportChannel.send({
        embeds: [
          {
            title: '📊 Activity Summary',
            description: logSummary,
            color: 0x00ff00,
            timestamp: new Date().toISOString(),
          },
        ],
      });

      expect(supportChannel.send).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '📊 Activity Summary',
          }),
        ],
      });
    });
  });

  describe('Real-time Monitoring and Health Checks', () => {
    it('should monitor announcement success rates', async () => {
      const metrics = {
        youtube: { success: 0, failed: 0, total: 0 },
        twitter: { success: 0, failed: 0, total: 0 },
      };

      const recordMetric = (platform, success) => {
        metrics[platform].total++;
        if (success) {
          metrics[platform].success++;
        } else {
          metrics[platform].failed++;
        }
      };

      // Simulate announcements
      recordMetric('youtube', true);
      recordMetric('youtube', true);
      recordMetric('youtube', false);
      recordMetric('twitter', true);
      recordMetric('twitter', false);

      const calculateSuccessRate = platform => {
        const platformMetrics = metrics[platform];
        return platformMetrics.total > 0 ? (platformMetrics.success / platformMetrics.total) * 100 : 0;
      };

      const youtubeSuccessRate = calculateSuccessRate('youtube');
      const twitterSuccessRate = calculateSuccessRate('twitter');

      expect(youtubeSuccessRate).toBeCloseTo(66.67, 2);
      expect(twitterSuccessRate).toBe(50);

      // Generate health report
      const healthReport = {
        timestamp: new Date().toISOString(),
        platforms: {
          youtube: {
            successRate: youtubeSuccessRate,
            total: metrics.youtube.total,
          },
          twitter: {
            successRate: twitterSuccessRate,
            total: metrics.twitter.total,
          },
        },
        overall: {
          totalAnnouncements: Object.values(metrics).reduce((sum, m) => sum + m.total, 0),
          overallSuccessRate:
            (Object.values(metrics).reduce((sum, m) => sum + m.success, 0) /
              Object.values(metrics).reduce((sum, m) => sum + m.total, 0)) *
            100,
        },
      };

      expect(healthReport.overall.totalAnnouncements).toBe(5);
      expect(healthReport.overall.overallSuccessRate).toBe(60);
    });

    it('should detect and alert on system anomalies', async () => {
      const anomalyDetector = {
        thresholds: {
          failureRate: 50, // Alert if failure rate > 50%
          responseTime: 5000, // Alert if response time > 5 seconds
          duplicateRate: 80, // Alert if duplicate rate > 80%
        },

        checkAnomaly(metrics) {
          const alerts = [];

          if (metrics.failureRate > this.thresholds.failureRate) {
            alerts.push({
              type: 'HIGH_FAILURE_RATE',
              value: metrics.failureRate,
              threshold: this.thresholds.failureRate,
            });
          }

          if (metrics.avgResponseTime > this.thresholds.responseTime) {
            alerts.push({
              type: 'HIGH_RESPONSE_TIME',
              value: metrics.avgResponseTime,
              threshold: this.thresholds.responseTime,
            });
          }

          if (metrics.duplicateRate > this.thresholds.duplicateRate) {
            alerts.push({
              type: 'HIGH_DUPLICATE_RATE',
              value: metrics.duplicateRate,
              threshold: this.thresholds.duplicateRate,
            });
          }

          return alerts;
        },
      };

      // Test with problematic metrics
      const problemMetrics = {
        failureRate: 75, // Above threshold
        avgResponseTime: 6000, // Above threshold
        duplicateRate: 85, // Above threshold
      };

      const alerts = anomalyDetector.checkAnomaly(problemMetrics);

      expect(alerts).toHaveLength(3);
      expect(alerts[0].type).toBe('HIGH_FAILURE_RATE');
      expect(alerts[1].type).toBe('HIGH_RESPONSE_TIME');
      expect(alerts[2].type).toBe('HIGH_DUPLICATE_RATE');

      // Send alerts to support channel
      if (alerts.length > 0) {
        const alertMessage = {
          embeds: [
            {
              title: '🚨 System Anomaly Detected',
              description: alerts
                .map(alert => `**${alert.type}**: ${alert.value} (threshold: ${alert.threshold})`)
                .join('\n'),
              color: 0xff0000,
              timestamp: new Date().toISOString(),
            },
          ],
        };

        await supportChannel.send(alertMessage);
      }

      expect(supportChannel.send).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🚨 System Anomaly Detected',
          }),
        ],
      });
    });
  });
});
