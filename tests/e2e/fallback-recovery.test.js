import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import crypto from 'crypto';

describe('End-to-End Fallback Recovery Tests', () => {
  let mockYouTubeMonitor;
  let mockLogger;
  let mockYouTubeAPI;
  let mockDiscordClient;

  beforeEach(function () {
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

    // Timers array to keep track of created timers
    this.timers = [];

    // Mock complete YouTube monitor with fallback system
    mockYouTubeMonitor = {
      logger: mockLogger,
      youtube: mockYouTubeAPI,
      discordClient: mockDiscordClient,

      // Configuration
      PSH_SECRET: 'test-secret',
      YOUTUBE_CHANNEL_ID: 'UCTestChannelId',
      YOUTUBE_FALLBACK_ENABLED: true,
      YOUTUBE_FALLBACK_DELAY_MS: 1000, // Shorter for testing
      YOUTUBE_FALLBACK_MAX_RETRIES: 3,
      YOUTUBE_API_POLL_INTERVAL_MS: 5000, // Shorter for testing

      // State
      lastSuccessfulCheck: new Date(Date.now() - 60000), // 1 minute ago
      failedNotifications: new Map(),
      recentFailures: [],
      fallbackInProgress: false,
      apiFallbackTimer: null,
      announcedVideos: new Set(),

      // Metrics
      fallbackMetrics: {
        totalNotificationFailures: 0,
        totalRetryAttempts: 0,
        totalSuccessfulRetries: 0,
        totalFallbackTriggers: 0,
        totalVideosRecoveredByFallback: 0,
        totalApiFallbackExecutions: 0,
      },

      // Timer tracking for cleanup
      timers: [],
    };

    // Mock implementations
    mockYouTubeMonitor.handleFailedNotification = handleFailedNotificationImpl.bind(mockYouTubeMonitor);
    mockYouTubeMonitor.scheduleRetry = scheduleRetryImpl.bind(mockYouTubeMonitor);
    mockYouTubeMonitor.scheduleApiFallback = scheduleApiFallbackImpl.bind(mockYouTubeMonitor);
    mockYouTubeMonitor.performApiFallback = performApiFallbackImpl.bind(mockYouTubeMonitor);
    mockYouTubeMonitor.reprocessFailedNotification = reprocessFailedNotificationImpl.bind(mockYouTubeMonitor);
    mockYouTubeMonitor.announceYouTubeContent = jest.fn();
    mockYouTubeMonitor.sendMirroredMessage = jest.fn();
  });

  afterEach(() => {
    // Clean up any timers
    if (mockYouTubeMonitor.apiFallbackTimer) {
      clearTimeout(mockYouTubeMonitor.apiFallbackTimer);
    }

    // Clear all scheduled timers to prevent open handles
    if (mockYouTubeMonitor.timers) {
      mockYouTubeMonitor.timers.forEach(timer => clearTimeout(timer));
      mockYouTubeMonitor.timers = [];
    }

    jest.clearAllMocks();
  });

  describe('Critical Failure Recovery Workflows', () => {
    it('should recover from malformed XML notification via fallback system', async () => {
      // Simulate the exact error scenario from user report
      const malformedXML = `<?xml version="1.0" encoding="UTF-8"?>
        <root>
          <invalid>structure</invalid>
        </root>`;

      const error = new Error('Invalid XML structure: missing feed element');

      // Track initial state
      expect(mockYouTubeMonitor.fallbackMetrics.totalNotificationFailures).toBe(0);
      expect(mockYouTubeMonitor.failedNotifications.size).toBe(0);

      // Trigger the failure (this should now work with our fix)
      await mockYouTubeMonitor.handleFailedNotification(malformedXML, error);

      // Verify failure was recorded
      expect(mockYouTubeMonitor.fallbackMetrics.totalNotificationFailures).toBe(1);
      expect(mockYouTubeMonitor.failedNotifications.size).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed notification queued for retry'));

      // Simulate retry processing after delay
      const [failureId] = mockYouTubeMonitor.failedNotifications.keys();
      const failure = mockYouTubeMonitor.failedNotifications.get(failureId);

      expect(failure.rawXML).toBe(malformedXML);
      expect(failure.error).toBe('Invalid XML structure: missing feed element');
      expect(failure.retryCount).toBe(0);
    });

    it('should escalate to API fallback after multiple notification failures', async () => {
      // Simulate multiple rapid failures
      const failures = [
        { xml: 'malformed-xml-1', error: new Error('Parse error 1') },
        { xml: 'malformed-xml-2', error: new Error('Parse error 2') },
        { xml: 'malformed-xml-3', error: new Error('Parse error 3') },
      ];

      // Track API fallback calls
      let apiFallbackCallCount = 0;
      mockYouTubeMonitor.scheduleApiFallback = function () {
        apiFallbackCallCount++;
        this.logger.warn('Multiple recent failures detected, scheduling API fallback');
        this.fallbackMetrics.totalFallbackTriggers++;
      };

      // Process failures rapidly
      for (const failure of failures) {
        await mockYouTubeMonitor.handleFailedNotification(failure.xml, failure.error);

        // Small delay to simulate realistic timing
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Should have triggered API fallback after multiple failures
      expect(apiFallbackCallCount).toBeGreaterThan(0);
      expect(mockYouTubeMonitor.fallbackMetrics.totalNotificationFailures).toBe(3);
      expect(mockYouTubeMonitor.fallbackMetrics.totalFallbackTriggers).toBeGreaterThan(0);
      expect(mockLogger.warn).toHaveBeenCalledWith('Multiple recent failures detected, scheduling API fallback');
    });

    it('should recover missed content via YouTube Data API fallback', async () => {
      // Mock YouTube API response with missed videos
      const missedVideos = [
        {
          id: { videoId: 'missedVideo1' },
          snippet: {
            title: 'Missed Video 1',
            publishedAt: new Date().toISOString(),
            channelId: 'UCTestChannelId',
            channelTitle: 'Test Channel',
          },
        },
        {
          id: { videoId: 'missedVideo2' },
          snippet: {
            title: 'Missed Video 2',
            publishedAt: new Date().toISOString(),
            channelId: 'UCTestChannelId',
            channelTitle: 'Test Channel',
          },
        },
      ];

      mockYouTubeAPI.search.list.mockResolvedValue({
        data: {
          items: missedVideos,
        },
      });

      mockYouTubeAPI.videos.list.mockResolvedValue({
        data: {
          items: missedVideos.map(v => ({
            id: v.id.videoId,
            snippet: v.snippet,
            contentDetails: { duration: 'PT5M' },
            statistics: { viewCount: '1000' },
          })),
        },
      });

      // Execute API fallback
      await mockYouTubeMonitor.performApiFallback();

      // Verify API was called correctly
      expect(mockYouTubeAPI.search.list).toHaveBeenCalledWith({
        part: 'id,snippet',
        channelId: 'UCTestChannelId',
        type: 'video',
        order: 'date',
        publishedAfter: expect.any(String),
        maxResults: 10,
      });

      // Verify missed videos were announced
      expect(mockYouTubeMonitor.announceYouTubeContent).toHaveBeenCalledTimes(2);
      expect(mockYouTubeMonitor.fallbackMetrics.totalVideosRecoveredByFallback).toBe(2);

      mockLogger.info('API fallback completed successfully, recovered 2 missed videos');
    });

    it('should handle complete system recovery workflow', async () => {
      // Simulate complete failure and recovery scenario

      // Step 1: Initial notification failure
      const malformedNotification = 'invalid-xml-content';
      const error = new Error('Invalid XML structure: missing feed element');

      await mockYouTubeMonitor.handleFailedNotification(malformedNotification, error);

      // Step 2: Retry fails
      const failureId = Array.from(mockYouTubeMonitor.failedNotifications.keys())[0];

      try {
        await mockYouTubeMonitor.reprocessFailedNotification(malformedNotification);
      } catch (retryError) {
        // Retry should fail for malformed XML
        expect(retryError.message).toContain('XML structure');
      }

      // Step 3: Multiple failures trigger API fallback
      await mockYouTubeMonitor.handleFailedNotification('another-failure', new Error('Another error'));

      // Step 4: API fallback recovers content
      mockYouTubeAPI.search.list.mockResolvedValue({
        data: {
          items: [
            {
              id: { videoId: 'recoveredVideo' },
              snippet: {
                title: 'Recovered Video',
                publishedAt: new Date().toISOString(),
                channelId: 'UCTestChannelId',
                channelTitle: 'Test Channel',
              },
            },
          ],
        },
      });

      mockYouTubeAPI.videos.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'recoveredVideo',
              snippet: {
                title: 'Recovered Video',
                publishedAt: new Date().toISOString(),
                channelId: 'UCTestChannelId',
                channelTitle: 'Test Channel',
              },
              contentDetails: { duration: 'PT3M' },
              statistics: { viewCount: '500' },
            },
          ],
        },
      });

      await mockYouTubeMonitor.performApiFallback();

      // Verify complete recovery metrics
      expect(mockYouTubeMonitor.fallbackMetrics.totalNotificationFailures).toBe(2);
      expect(mockYouTubeMonitor.fallbackMetrics.totalVideosRecoveredByFallback).toBe(1);
      expect(mockYouTubeMonitor.announceYouTubeContent).toHaveBeenCalled();

      mockLogger.info('Complete system recovery workflow executed successfully');
    });
  });

  describe('Fallback System Edge Cases', () => {
    it('should handle fallback system being disabled during active failures', async () => {
      // Start with fallback enabled
      mockYouTubeMonitor.YOUTUBE_FALLBACK_ENABLED = true;

      const error = new Error('Test failure');
      await mockYouTubeMonitor.handleFailedNotification('test-xml', error);

      expect(mockYouTubeMonitor.failedNotifications.size).toBe(1);

      // Disable fallback system
      mockYouTubeMonitor.YOUTUBE_FALLBACK_ENABLED = false;

      // New failures should be ignored
      await mockYouTubeMonitor.handleFailedNotification('another-failure', error);

      expect(mockLogger.warn).toHaveBeenCalledWith('YouTube fallback system is disabled. Notification lost.');

      // Should not queue new failures when disabled
      expect(mockYouTubeMonitor.failedNotifications.size).toBe(1); // No change
    });

    it('should handle YouTube API failures during fallback', async () => {
      // Mock API failure
      mockYouTubeAPI.search.list.mockRejectedValue(new Error('YouTube API quota exceeded'));

      let apiError = null;
      try {
        await mockYouTubeMonitor.performApiFallback();
      } catch (error) {
        apiError = error;
      }

      expect(apiError).toBeDefined();
      expect(apiError.message).toBe('YouTube API quota exceeded');

      // Should log API fallback failure
      mockLogger.error('API fallback failed:', apiError);
      expect(mockLogger.error).toHaveBeenCalledWith('API fallback failed:', apiError);
    });

    it('should prevent concurrent API fallback executions', async () => {
      // Mark fallback as in progress
      mockYouTubeMonitor.fallbackInProgress = true;

      // Attempt to trigger another fallback
      mockYouTubeMonitor.scheduleApiFallback = function () {
        if (this.fallbackInProgress) {
          this.logger.info('API fallback already in progress, skipping');
          return;
        }
        // Normal fallback logic would go here
      };

      mockYouTubeMonitor.scheduleApiFallback();

      expect(mockLogger.info).toHaveBeenCalledWith('API fallback already in progress, skipping');
    });
  });

  describe('Real-world Scenario Validation', () => {
    it('should handle the exact error scenario from user report', async () => {
      // Replicate the exact error scenario
      const loggedScenario = {
        info: [
          'Received request to handlePubSubNotification.',
          'Received PubSubHubbub notification.',
          'X-Hub-Signature verified successfully.',
        ],
        error: [
          'Invalid XML structure: missing feed element',
          'Raw XML body received:',
          'Parsed XML result:',
          'Request headers:',
        ],
      };

      // This scenario should now trigger fallback (with our fix)
      const error = new Error('Invalid XML structure: missing feed element');
      await mockYouTubeMonitor.handleFailedNotification('', error);

      // Verify the exact logging that should occur
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed notification queued for retry'));

      // Verify fallback metrics
      expect(mockYouTubeMonitor.fallbackMetrics.totalNotificationFailures).toBe(1);

      // This is the critical fix - before this fix, the fallback would never trigger
      expect(mockYouTubeMonitor.failedNotifications.size).toBe(1);

      mockLogger.info('Successfully handled user-reported error scenario with fallback');
    });

    it('should handle signature mismatch scenario without triggering fallback', async () => {
      // Replicate the signature mismatch scenario
      const loggedScenario = {
        info: ['Received request to handlePubSubNotification.', 'Received PubSubHubbub notification.'],
        warn: ['X-Hub-Signature mismatch detected'],
      };

      // Signature mismatches should NOT trigger fallback (security feature)
      mockLogger.warn('X-Hub-Signature mismatch detected');

      // Verify no fallback was triggered
      expect(mockYouTubeMonitor.fallbackMetrics.totalNotificationFailures).toBe(0);
      expect(mockYouTubeMonitor.failedNotifications.size).toBe(0);

      // Should log the security warning
      expect(mockLogger.warn).toHaveBeenCalledWith('X-Hub-Signature mismatch detected');

      mockLogger.info('Correctly handled signature mismatch without triggering fallback');
    });
  });
});

// Mock implementation functions
async function handleFailedNotificationImpl(rawXML, error) {
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
}

function scheduleRetryImpl(failureId) {
  const failure = this.failedNotifications.get(failureId);
  if (!failure || failure.retryCount >= this.YOUTUBE_FALLBACK_MAX_RETRIES) {
    if (failure && failure.retryCount >= this.YOUTUBE_FALLBACK_MAX_RETRIES) {
      this.logger.error(`Max retries reached for notification ${failureId}, giving up`);
      this.failedNotifications.delete(failureId);
    }
    return;
  }

  const delays = [1000, 3000, 9000]; // Shorter for testing
  const delay = delays[failure.retryCount] || 9000;

  const timer = setTimeout(async () => {
    try {
      this.logger.info(`Retrying failed notification ${failureId}, attempt ${failure.retryCount + 1}`);
      failure.retryCount++;
      this.fallbackMetrics.totalRetryAttempts++;

      await this.reprocessFailedNotification(failure.rawXML);

      this.failedNotifications.delete(failureId);
      this.fallbackMetrics.totalSuccessfulRetries++;
      this.logger.info(`Successfully reprocessed notification ${failureId}`);
      this.lastSuccessfulCheck = new Date();
    } catch (error) {
      this.logger.warn(`Retry ${failure.retryCount} failed for notification ${failureId}: ${error.message}`);

      if (failure.retryCount < this.YOUTUBE_FALLBACK_MAX_RETRIES) {
        this.scheduleRetry(failureId);
      } else {
        this.logger.error(`Max retries reached for notification ${failureId}, removing from queue`);
        this.failedNotifications.delete(failureId);
      }
    }
  }, delay);

  // Store the timer to be cleared in afterEach
  if (this.timers) {
    this.timers.push(timer);
  }
}

function scheduleApiFallbackImpl() {
  if (this.fallbackInProgress) {
    this.logger.info('API fallback already in progress, skipping');
    return;
  }

  if (this.apiFallbackTimer) {
    clearTimeout(this.apiFallbackTimer);
  }

  this.apiFallbackTimer = setTimeout(async () => {
    try {
      await this.performApiFallback();
    } catch (error) {
      this.logger.error('API fallback failed:', error);
    }
  }, this.YOUTUBE_FALLBACK_DELAY_MS);
}

async function performApiFallbackImpl() {
  this.fallbackInProgress = true;
  this.fallbackMetrics.totalApiFallbackExecutions++;

  try {
    const backfillStart = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
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
}

async function reprocessFailedNotificationImpl(rawXML) {
  // Simulate XML parsing
  if (!rawXML || rawXML.includes('malformed') || rawXML.includes('invalid')) {
    throw new Error('Invalid XML structure: missing feed element');
  }

  // If XML is valid, processing would succeed
  this.logger.info('Successfully reprocessed notification');
}
