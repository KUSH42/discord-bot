import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ContentAnnouncer } from '../../src/core/content-announcer.js';
import { ContentCoordinator } from '../../src/core/content-coordinator.js';
import { ContentStateManager } from '../../src/core/content-state-manager.js';
import { MonitorApplication } from '../../src/application/monitor-application.js';
import { ScraperApplication } from '../../src/application/scraper-application.js';

/**
 * Debug-focused test scenarios to identify announcement bugs
 * Focuses on real-world scenarios that might cause announcements to fail
 */
describe('Announcement Debug Scenarios', () => {
  let contentAnnouncer;
  let contentCoordinator;
  let contentStateManager;
  let monitorApp;
  let scraperApp;
  let mockDependencies;
  let logCapture;

  beforeEach(() => {
    // Capture all log output for analysis
    logCapture = {
      debug: [],
      info: [],
      warn: [],
      error: [],
    };

    const mockLogger = {
      debug: jest.fn((...args) => logCapture.debug.push(args)),
      info: jest.fn((...args) => logCapture.info.push(args)),
      warn: jest.fn((...args) => logCapture.warn.push(args)),
      error: jest.fn((...args) => logCapture.error.push(args)),
      child: jest.fn(() => mockLogger),
      // Add enhanced logger methods
      startOperation: jest.fn().mockReturnValue({
        progress: jest.fn(),
        success: jest.fn((message, context) => {
          logCapture.info.push([message, context]);
        }),
        error: jest.fn((error, message, context) => {
          logCapture.error.push([message, context, error]);
        }),
      }),
    };

    // Track Discord messages
    const discordMessages = [];
    const mockDiscordService = {
      sendMessage: jest.fn((channelId, message) => {
        discordMessages.push({ channelId, message, timestamp: new Date().toISOString() });
        return Promise.resolve({ id: `msg_${Date.now()}` });
      }),
      fetchChannel: jest.fn(() => Promise.resolve({ name: 'test-channel' })),
    };

    // Mock configuration with realistic values
    const mockConfig = {
      getRequired: jest.fn(key => {
        const values = {
          YOUTUBE_CHANNEL_ID: 'UCtest123',
          YOUTUBE_API_KEY: 'test_api_key',
          PSH_CALLBACK_URL: 'https://example.com/webhook',
          DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345678',
          DISCORD_X_POSTS_CHANNEL_ID: '123456789012345679',
          DISCORD_X_REPLIES_CHANNEL_ID: '123456789012345680',
          DISCORD_X_QUOTES_CHANNEL_ID: '123456789012345681',
          DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345682',
          X_USER_HANDLE: 'testuser',
          TWITTER_USERNAME: 'test@example.com',
          TWITTER_PASSWORD: 'testpass123',
        };
        return values[key] || `mock-${key}`;
      }),
      get: jest.fn((key, defaultValue) => {
        const values = {
          PSH_SECRET: 'test_secret',
          PSH_VERIFY_TOKEN: 'test_verify',
          WEBHOOK_DEBUG_LOGGING: 'true',
          X_QUERY_INTERVAL_MIN: '60000',
          X_QUERY_INTERVAL_MAX: '120000',
          ANNOUNCE_OLD_TWEETS: 'false',
          MAX_CONTENT_AGE_HOURS: '24',
          DISCORD_BOT_SUPPORT_LOG_CHANNEL: '123456789012345683',
        };
        return values[key] || defaultValue;
      }),
      getBoolean: jest.fn((key, defaultValue) => {
        const values = {
          WEBHOOK_DEBUG_LOGGING: true,
          ANNOUNCE_OLD_TWEETS: false,
          ENABLE_RETWEET_PROCESSING: true,
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

    // Mock state manager with realistic bot state
    const mockStateManager = {
      get: jest.fn((key, defaultValue) => {
        const state = {
          postingEnabled: true,
          announcementEnabled: true,
          vxTwitterConversionEnabled: false,
          botStartTime: new Date('2024-01-01T00:00:00Z'),
        };
        return state[key] !== undefined ? state[key] : defaultValue;
      }),
      set: jest.fn(),
    };

    // Mock persistent storage
    const mockPersistentStorage = {
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

    // Mock debug manager for enhanced logging
    const mockDebugManager = {
      shouldLog: jest.fn().mockReturnValue(true),
      getLevel: jest.fn().mockReturnValue(3),
    };

    // Mock metrics manager for enhanced logging
    const mockMetricsManager = {
      recordMetric: jest.fn(),
      startTimer: jest.fn().mockReturnValue({ end: jest.fn() }),
    };

    // Set up dependencies
    mockDependencies = {
      discordService: mockDiscordService,
      config: mockConfig,
      stateManager: mockStateManager,
      logger: mockLogger,
      debugManager: mockDebugManager,
      metricsManager: mockMetricsManager,
      persistentStorage: mockPersistentStorage,
      eventBus: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
      httpService: {
        post: jest.fn(() => Promise.resolve({ status: 202 })),
        isSuccessResponse: jest.fn(response => response.status >= 200 && response.status < 300),
      },
      youtubeService: {
        getChannelDetails: jest.fn(() => Promise.resolve({ snippet: { title: 'Test Channel' } })),
        getVideoDetails: jest.fn(() =>
          Promise.resolve({
            id: 'test123',
            snippet: {
              title: 'Test Video',
              channelTitle: 'Test Channel',
              publishedAt: new Date().toISOString(),
              liveBroadcastContent: 'none',
            },
          })
        ),
        getChannelVideos: jest.fn(() => Promise.resolve([])),
        getScheduledContent: jest.fn(() => Promise.resolve([])),
        checkScheduledContentStates: jest.fn(() => Promise.resolve([])),
      },
      browserService: {
        launch: jest.fn(() => Promise.resolve()),
        goto: jest.fn(() => Promise.resolve()),
        evaluate: jest.fn(() => Promise.resolve([])),
        waitForSelector: jest.fn(() => Promise.resolve()),
        type: jest.fn(() => Promise.resolve()),
        click: jest.fn(() => Promise.resolve()),
        close: jest.fn(() => Promise.resolve()),
        isRunning: jest.fn(() => true),
        isConnected: jest.fn(() => true),
        setUserAgent: jest.fn(() => Promise.resolve()),
      },
      authManager: {
        login: jest.fn(() => Promise.resolve()),
        isAuthenticated: jest.fn(() => Promise.resolve(true)),
        ensureAuthenticated: jest.fn(() => Promise.resolve()),
        clickNextButton: jest.fn(() => Promise.resolve(true)),
        clickLoginButton: jest.fn(() => Promise.resolve(true)),
      },
      contentClassifier: {
        classifyYouTubeContent: jest.fn(video => ({
          type: video.snippet?.liveBroadcastContent === 'live' ? 'livestream' : 'video',
          confidence: 0.95,
          platform: 'youtube',
          details: {},
        })),
        classifyXContent: jest.fn(() => ({
          type: 'post',
          confidence: 0.9,
          platform: 'x',
          details: {},
        })),
      },
      duplicateDetector: {
        isDuplicate: jest.fn(() => Promise.resolve(false)),
        isDuplicateWithFingerprint: jest.fn(() => Promise.resolve(false)),
        markAsSeen: jest.fn(() => Promise.resolve()),
        markAsSeenWithFingerprint: jest.fn(() => Promise.resolve()),
        getStats: jest.fn(() => ({ seenCount: 0 })),
      },
      delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
    };

    // Create components
    contentStateManager = new ContentStateManager(mockConfig, mockPersistentStorage, mockLogger, mockStateManager);
    contentAnnouncer = new ContentAnnouncer(mockDiscordService, mockConfig, mockStateManager, mockLogger);
    contentCoordinator = new ContentCoordinator(
      contentStateManager,
      contentAnnouncer,
      mockDependencies.duplicateDetector,
      mockLogger,
      mockConfig
    );

    // Add ContentCoordinator to dependencies
    mockDependencies.contentCoordinator = contentCoordinator;
    mockDependencies.contentStateManager = contentStateManager;
    mockDependencies.contentAnnouncer = contentAnnouncer;
    mockDependencies.livestreamStateMachine = {
      transitionState: jest.fn(() => Promise.resolve()),
    };

    // Create applications
    monitorApp = new MonitorApplication(mockDependencies);
    scraperApp = new ScraperApplication(mockDependencies);

    // Store references for test analysis
    mockDependencies.discordMessages = discordMessages;
    mockDependencies.logCapture = logCapture;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('YouTube Content Scenarios', () => {
    it('should debug new video announcement flow end-to-end', async () => {
      const video = {
        id: 'debug_video_123',
        snippet: {
          title: 'Debug Test Video - New Content',
          channelTitle: 'Test Channel',
          publishedAt: new Date().toISOString(),
          liveBroadcastContent: 'none',
        },
      };

      console.log('🔍 DEBUG: Processing new video through monitor application...');
      await monitorApp.processVideo(video, 'debug_test');

      // Analyze logs
      console.log('\n📋 DEBUG LOG ANALYSIS:');
      console.log('Info logs:', logCapture.info.length);
      console.log('Debug logs:', logCapture.debug.length);
      console.log('Warning logs:', logCapture.warn.length);
      console.log('Error logs:', logCapture.error.length);

      // Print relevant logs
      logCapture.info.forEach((log, index) => {
        console.log(`Info ${index + 1}:`, log[0], log[1] || '');
      });

      logCapture.warn.forEach((log, index) => {
        console.log(`Warning ${index + 1}:`, log[0], log[1] || '');
      });

      logCapture.error.forEach((log, index) => {
        console.log(`Error ${index + 1}:`, log[0], log[1] || '');
      });

      // Check Discord messages
      console.log('\n💬 DISCORD MESSAGES SENT:', mockDependencies.discordMessages.length);
      mockDependencies.discordMessages.forEach((msg, index) => {
        console.log(`Message ${index + 1}:`, {
          channelId: msg.channelId,
          message: `${msg.message.substring(0, 100)}...`,
        });
      });

      // Verify announcement occurred
      expect(mockDependencies.discordMessages).toHaveLength(1);
      expect(mockDependencies.discordMessages[0].channelId).toBe('123456789012345678');
      expect(mockDependencies.discordMessages[0].message).toContain('Debug Test Video');
    });

    it('should debug old video filtering', async () => {
      const oldVideo = {
        id: 'old_video_123',
        snippet: {
          title: 'Old Video - Should Be Skipped',
          channelTitle: 'Test Channel',
          publishedAt: '2023-01-01T00:00:00Z', // Very old
          liveBroadcastContent: 'none',
        },
      };

      console.log('🔍 DEBUG: Processing old video...');
      await monitorApp.processVideo(oldVideo, 'debug_test');

      // Check if video was properly filtered
      console.log('\n📋 OLD VIDEO FILTER ANALYSIS:');
      const skipLogs = logCapture.info.filter(log => typeof log[0] === 'string' && log[0].includes('too old'));
      console.log('Skip logs found:', skipLogs.length);
      skipLogs.forEach(log => console.log('Skip reason:', log[0]));

      expect(mockDependencies.discordMessages).toHaveLength(0);
      expect(skipLogs.length).toBeGreaterThan(0);
    });

    it('should debug posting disabled scenario', async () => {
      // Disable posting
      mockDependencies.stateManager.get.mockImplementation((key, defaultValue) => {
        if (key === 'postingEnabled') {
          return false;
        }
        if (key === 'botStartTime') {
          return new Date('2024-01-01T00:00:00Z');
        }
        return defaultValue;
      });

      const video = {
        id: 'disabled_video_123',
        snippet: {
          title: 'Video When Posting Disabled',
          channelTitle: 'Test Channel',
          publishedAt: new Date().toISOString(),
          liveBroadcastContent: 'none',
        },
      };

      console.log('🔍 DEBUG: Processing video with posting disabled...');
      await monitorApp.processVideo(video, 'debug_test');

      console.log('\n📋 POSTING DISABLED ANALYSIS:');
      const skipLogs = logCapture.info.filter(
        log =>
          typeof log[0] === 'string' &&
          (log[0].includes('disabled') || log[0].includes('skipping') || log[0].includes('Skipping'))
      );
      console.log('Skip logs found:', skipLogs.length);
      skipLogs.forEach(log => console.log('Skip log:', log[0], log[1]));

      expect(mockDependencies.discordMessages).toHaveLength(0);
    });
  });

  describe('X/Twitter Content Scenarios', () => {
    beforeEach(() => {
      // Mock browser evaluation to return test tweets
      mockDependencies.browserService.evaluate.mockImplementation(() => {
        return Promise.resolve([
          {
            tweetID: 'debug_tweet_123',
            url: 'https://x.com/testuser/status/debug_tweet_123',
            author: 'testuser',
            text: 'This is a debug test tweet',
            timestamp: new Date().toISOString(),
            tweetCategory: 'Post',
          },
        ]);
      });
    });

    it('should debug X content processing and announcement', async () => {
      console.log('🔍 DEBUG: Processing X content through scraper...');

      // Process a single new tweet manually to debug
      const tweet = {
        tweetID: 'debug_tweet_456',
        url: 'https://x.com/testuser/status/debug_tweet_456',
        author: 'testuser',
        text: 'Debug test tweet content',
        timestamp: new Date().toISOString(),
        tweetCategory: 'Post',
      };

      await scraperApp.processNewTweet(tweet);

      console.log('\n📋 X CONTENT DEBUG ANALYSIS:');
      console.log('Total logs:', {
        info: logCapture.info.length,
        debug: logCapture.debug.length,
        warn: logCapture.warn.length,
        error: logCapture.error.length,
      });

      // Print announcement-related logs
      const announcementLogs = logCapture.info.filter(
        log =>
          typeof log[0] === 'string' &&
          (log[0].includes('announcement') ||
            log[0].includes('Announcement') ||
            log[0].includes('📢') ||
            log[0].includes('🚀'))
      );
      console.log('Announcement logs:', announcementLogs.length);
      announcementLogs.forEach(log => console.log('Announcement log:', log[0]));

      console.log('\n💬 X CONTENT DISCORD MESSAGES:', mockDependencies.discordMessages.length);
      mockDependencies.discordMessages.forEach((msg, index) => {
        console.log(`X Message ${index + 1}:`, {
          channelId: msg.channelId,
          message: msg.message.substring(0, 100),
        });
      });

      expect(mockDependencies.discordMessages).toHaveLength(1);
      expect(mockDependencies.discordMessages[0].channelId).toBe('123456789012345679');
    });

    it('should debug old tweet filtering', async () => {
      const oldTweet = {
        tweetID: 'old_tweet_123',
        url: 'https://x.com/testuser/status/old_tweet_123',
        author: 'testuser',
        text: 'Old tweet that should be filtered',
        timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
        tweetCategory: 'Post',
      };

      console.log('🔍 DEBUG: Processing old tweet...');
      await scraperApp.processNewTweet(oldTweet);

      console.log('\n📋 OLD TWEET FILTER ANALYSIS:');
      const filterLogs = logCapture.debug.filter(log => typeof log[0] === 'string' && log[0].includes('old'));
      console.log('Filter logs found:', filterLogs.length);

      expect(mockDependencies.discordMessages).toHaveLength(0);
    });
  });

  describe('Configuration Debug Scenarios', () => {
    it('should debug missing channel configuration', async () => {
      // Mock invalid channel configuration
      mockDependencies.config.getRequired.mockImplementation(key => {
        if (key === 'DISCORD_YOUTUBE_CHANNEL_ID') {
          return 'invalid_channel_id';
        }
        return 'mock_value';
      });

      // Create new announcer with invalid config
      const debugAnnouncer = new ContentAnnouncer(
        mockDependencies.discordService,
        mockDependencies.config,
        mockDependencies.stateManager,
        mockDependencies.logger
      );

      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'config_debug_123',
        title: 'Config Debug Video',
        url: 'https://youtube.com/watch?v=config_debug_123',
        channelTitle: 'Test Channel',
        publishedAt: new Date().toISOString(),
      };

      console.log('🔍 DEBUG: Testing invalid channel configuration...');
      const result = await debugAnnouncer.announceContent(content);

      console.log('\n📋 CONFIG ERROR ANALYSIS:');
      console.log('Result:', result);
      const configErrors = logCapture.error.filter(log => typeof log[0] === 'string' && log[0].includes('channel'));
      console.log('Config error logs:', configErrors.length);
      configErrors.forEach(log => console.log('Config error:', log[0]));

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Invalid or missing channel ID');
    });

    it('should debug Discord service failures', async () => {
      // Mock Discord service to fail
      mockDependencies.discordService.sendMessage.mockRejectedValue(new Error('Discord API error'));

      const content = {
        platform: 'youtube',
        type: 'video',
        id: 'discord_error_123',
        title: 'Discord Error Video',
        url: 'https://youtube.com/watch?v=discord_error_123',
        channelTitle: 'Test Channel',
        publishedAt: new Date().toISOString(),
      };

      console.log('🔍 DEBUG: Testing Discord service failure...');
      const result = await contentAnnouncer.announceContent(content);

      console.log('\n📋 DISCORD ERROR ANALYSIS:');
      console.log('Result:', result);
      const discordErrors = logCapture.error.filter(
        log => typeof log[0] === 'string' && log[0].includes('Announcement failed')
      );
      console.log('Discord error logs:', discordErrors.length);

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Discord API error');
    });
  });

  describe('End-to-End Bug Detection', () => {
    it('should identify where announcements are failing in the pipeline', async () => {
      console.log('🔍 DEBUG: Running comprehensive pipeline test...');

      // Test 1: YouTube video
      const youtubeVideo = {
        id: 'pipeline_test_youtube',
        snippet: {
          title: 'Pipeline Test YouTube Video',
          channelTitle: 'Test Channel',
          publishedAt: new Date().toISOString(),
          liveBroadcastContent: 'none',
        },
      };

      console.log('\n1️⃣ Testing YouTube pipeline...');
      await monitorApp.processVideo(youtubeVideo, 'pipeline_test');

      // Test 2: X content
      const xTweet = {
        tweetID: 'pipeline_test_x',
        url: 'https://x.com/testuser/status/pipeline_test_x',
        author: 'testuser',
        text: 'Pipeline test X content',
        timestamp: new Date().toISOString(),
        tweetCategory: 'Post',
      };

      console.log('\n2️⃣ Testing X pipeline...');
      await scraperApp.processNewTweet(xTweet);

      // Analyze complete pipeline
      console.log('\n📊 COMPLETE PIPELINE ANALYSIS:');
      console.log('Total Discord messages sent:', mockDependencies.discordMessages.length);
      console.log('Expected messages: 2 (1 YouTube + 1 X)');

      if (mockDependencies.discordMessages.length !== 2) {
        console.log('❌ PIPELINE FAILURE DETECTED!');

        // Analyze where the failure occurred
        const coordinatorLogs = logCapture.info.filter(
          log => typeof log[0] === 'string' && log[0].includes('coordination')
        );
        const announcementLogs = logCapture.info.filter(
          log => typeof log[0] === 'string' && log[0].includes('announcement')
        );
        const skipLogs = logCapture.info.filter(
          log => typeof log[0] === 'string' && (log[0].includes('skip') || log[0].includes('Skip'))
        );

        console.log('Coordinator logs:', coordinatorLogs.length);
        console.log('Announcement logs:', announcementLogs.length);
        console.log('Skip logs:', skipLogs.length);

        // Print detailed analysis
        console.log('\n🔍 DETAILED FAILURE ANALYSIS:');
        skipLogs.forEach((log, index) => {
          console.log(`Skip ${index + 1}:`, log[0], JSON.stringify(log[1], null, 2));
        });

        logCapture.error.forEach((log, index) => {
          console.log(`Error ${index + 1}:`, log[0], JSON.stringify(log[1], null, 2));
        });
      } else {
        console.log('✅ Pipeline working correctly!');
      }

      // Verify both announcements succeeded
      expect(mockDependencies.discordMessages).toHaveLength(2);

      const youtubeMessage = mockDependencies.discordMessages.find(msg => msg.channelId === '123456789012345678');
      const xMessage = mockDependencies.discordMessages.find(msg => msg.channelId === '123456789012345679');

      expect(youtubeMessage).toBeDefined();
      expect(xMessage).toBeDefined();
      expect(youtubeMessage.message).toContain('Pipeline Test YouTube Video');
      expect(xMessage.message).toContain('testuser');
    });
  });
});
