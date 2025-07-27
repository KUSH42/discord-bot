import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { timestampUTC } from '../../src/utilities/utc-time.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('ScraperApplication Content Detection', () => {
  let scraperApp;
  let mockDependencies;
  let mockConfig;
  let mockDuplicateDetector;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create enhanced logging mocks
    const enhancedLoggingMocks = createMockDependenciesWithEnhancedLogging();

    mockConfig = {
      getRequired: jest.fn(),
      get: jest.fn(),
      getBoolean: jest.fn(),
    };

    mockDuplicateDetector = {
      isDuplicate: jest.fn(),
      markAsSeen: jest.fn(),
      getStats: jest.fn().mockReturnValue({ totalSeen: 0, totalChecked: 0 }),
    };

    mockLogger = enhancedLoggingMocks.logger;

    // Configure default mock returns
    mockConfig.getRequired.mockImplementation(key => {
      const defaults = {
        X_USER_HANDLE: 'testuser',
        TWITTER_USERNAME: 'testuser@example.com',
        TWITTER_PASSWORD: 'testpass',
      };
      return defaults[key] || 'default-value';
    });

    mockConfig.get.mockImplementation((key, defaultValue) => {
      const defaults = {
        X_QUERY_INTERVAL_MIN: '300000',
        X_QUERY_INTERVAL_MAX: '600000',
        X_DEBUG_SAMPLING_RATE: '0.1',
        X_VERBOSE_LOG_SAMPLING_RATE: '0.05',
        MAX_CONTENT_AGE_HOURS: '2',
      };
      return defaults[key] || defaultValue;
    });

    mockConfig.getBoolean.mockImplementation((key, defaultValue) => {
      const defaults = {
        ANNOUNCE_OLD_TWEETS: false,
        ENABLE_RETWEET_PROCESSING: true,
      };
      return defaults[key] !== undefined ? defaults[key] : defaultValue;
    });

    mockDependencies = {
      browserService: {
        launch: jest.fn(),
        close: jest.fn(),
        goto: jest.fn(),
        waitForSelector: jest.fn(),
        evaluate: jest.fn(),
        setUserAgent: jest.fn(),
        isRunning: jest.fn().mockReturnValue(false),
        type: jest.fn(),
        click: jest.fn(),
      },
      contentClassifier: { classifyXContent: jest.fn() },
      contentAnnouncer: { announceContent: jest.fn() },
      config: mockConfig,
      stateManager: { get: jest.fn(), set: jest.fn() },
      discordService: { login: jest.fn() },
      eventBus: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
      logger: mockLogger,
      debugManager: enhancedLoggingMocks.debugManager,
      metricsManager: enhancedLoggingMocks.metricsManager,
      authManager: {
        login: jest.fn(),
        clickNextButton: jest.fn(),
        clickLoginButton: jest.fn(),
        isAuthenticated: jest.fn(),
        ensureAuthenticated: jest.fn(),
      },
      duplicateDetector: mockDuplicateDetector,
      persistentStorage: { get: jest.fn(), set: jest.fn() },
    };

    scraperApp = new ScraperApplication(mockDependencies);
  });

  describe('filterNewTweets', () => {
    it('should filter out duplicate tweets', async () => {
      const tweets = [
        {
          tweetID: '1',
          url: 'https://x.com/user/status/1',
          text: 'First tweet',
          timestamp: new Date().toISOString(),
        },
        {
          tweetID: '2',
          url: 'https://x.com/user/status/2',
          text: 'Second tweet',
          timestamp: new Date().toISOString(),
        },
      ];

      mockDuplicateDetector.isDuplicate
        .mockReturnValueOnce(true) // First tweet is duplicate
        .mockReturnValueOnce(false); // Second tweet is not duplicate

      jest.spyOn(scraperApp, 'isNewContent').mockReturnValue(true);

      const newTweets = await scraperApp.filterNewTweets(tweets);

      expect(newTweets).toHaveLength(1);
      expect(newTweets[0].tweetID).toBe('2');
      expect(mockDuplicateDetector.markAsSeen).toHaveBeenCalledWith(tweets[1].url);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Filtering results: 1 new, 1 duplicates, 0 old content',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should filter out old content', async () => {
      const tweets = [
        {
          tweetID: '1',
          url: 'https://x.com/user/status/1',
          text: 'Old tweet',
          timestamp: new Date(timestampUTC() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
        },
        {
          tweetID: '2',
          url: 'https://x.com/user/status/2',
          text: 'New tweet',
          timestamp: new Date().toISOString(),
        },
      ];

      mockDuplicateDetector.isDuplicate.mockReturnValue(false);
      jest
        .spyOn(scraperApp, 'isNewContent')
        .mockReturnValueOnce(false) // First tweet is old
        .mockReturnValueOnce(true); // Second tweet is new

      const newTweets = await scraperApp.filterNewTweets(tweets);

      expect(newTweets).toHaveLength(1);
      expect(newTweets[0].tweetID).toBe('2');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Filtering results: 1 new, 0 duplicates, 1 old content',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should log debug information with sampling', async () => {
      const tweets = [
        {
          tweetID: '1',
          url: 'https://x.com/user/status/1',
          text: 'This is a long tweet that should be truncated when logged for debugging purposes',
          timestamp: new Date().toISOString(),
        },
      ];

      mockDuplicateDetector.isDuplicate.mockReturnValue(false);
      jest.spyOn(scraperApp, 'isNewContent').mockReturnValue(true);
      jest.spyOn(scraperApp, 'shouldLogDebug').mockReturnValue(true);

      await scraperApp.filterNewTweets(tweets);

      expect(mockLogger.verbose).toHaveBeenCalledWith(
        expect.stringContaining('Added new tweet: 1 - This is a long tweet that should be truncated'),
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should log verbose information for old content with sampling', async () => {
      const tweets = [
        {
          tweetID: '1',
          url: 'https://x.com/user/status/1',
          text: 'Old tweet',
          timestamp: new Date(timestampUTC() - 5 * 60 * 60 * 1000).toISOString(),
        },
      ];

      mockDuplicateDetector.isDuplicate.mockReturnValue(false);
      jest.spyOn(scraperApp, 'isNewContent').mockReturnValue(false);
      jest.spyOn(scraperApp, 'shouldLogVerbose').mockReturnValue(true);

      await scraperApp.filterNewTweets(tweets);

      expect(mockLogger.verbose).toHaveBeenCalledWith(
        expect.stringContaining('Filtered out old tweet: 1 - timestamp:'),
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });
  });

  describe('isNewContent', () => {
    it('should return true when ANNOUNCE_OLD_TWEETS is enabled', async () => {
      mockConfig.getBoolean.mockImplementation((key, defaultValue) => {
        if (key === 'ANNOUNCE_OLD_TWEETS') {
          return true;
        }
        return defaultValue;
      });

      const tweet = {
        tweetID: '1',
        url: 'https://x.com/user/status/1',
        timestamp: new Date(timestampUTC() - 5 * 60 * 60 * 1000).toISOString(), // Very old
      };

      const result = await scraperApp.isNewContent(tweet);

      expect(result).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'ANNOUNCE_OLD_TWEETS=true, considering tweet 1 as new',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should return false for duplicate content', async () => {
      mockDuplicateDetector.isDuplicate.mockReturnValue(true);

      const tweet = {
        tweetID: '1',
        url: 'https://x.com/user/status/1',
        timestamp: new Date().toISOString(),
      };

      const result = await scraperApp.isNewContent(tweet);

      expect(result).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Tweet 1 already known (duplicate), not new',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should return false for content older than backoff duration', async () => {
      mockDuplicateDetector.isDuplicate.mockReturnValue(false);
      mockConfig.get.mockImplementation((key, defaultValue) => {
        if (key === 'MAX_CONTENT_AGE_HOURS') {
          return '2';
        }
        return defaultValue;
      });

      const tweet = {
        tweetID: '1',
        url: 'https://x.com/user/status/1',
        timestamp: new Date(timestampUTC() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
      };

      const result = await scraperApp.isNewContent(tweet);

      expect(result).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Tweet 1 is too old'),
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should return true for content within backoff duration', async () => {
      mockDuplicateDetector.isDuplicate.mockReturnValue(false);
      mockConfig.get.mockImplementation((key, defaultValue) => {
        if (key === 'MAX_CONTENT_AGE_HOURS') {
          return '2';
        }
        return defaultValue;
      });

      const tweet = {
        tweetID: '1',
        url: 'https://x.com/user/status/1',
        timestamp: new Date(timestampUTC() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
      };

      const result = await scraperApp.isNewContent(tweet);

      expect(result).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Tweet 1 passed all checks, considering as new',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should return true for content without timestamp', async () => {
      mockDuplicateDetector.isDuplicate.mockReturnValue(false);

      const tweet = {
        tweetID: '1',
        url: 'https://x.com/user/status/1',
        timestamp: null,
      };

      const result = await scraperApp.isNewContent(tweet);

      expect(result).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'No timestamp for tweet 1, considering as new',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should use default backoff duration when not configured', async () => {
      mockDuplicateDetector.isDuplicate.mockReturnValue(false);
      mockConfig.get.mockImplementation((key, defaultValue) => {
        if (key === 'MAX_CONTENT_AGE_HOURS') {
          return defaultValue;
        }
        return defaultValue;
      });

      const tweet = {
        tweetID: '1',
        url: 'https://x.com/user/status/1',
        timestamp: new Date(timestampUTC() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
      };

      const result = await scraperApp.isNewContent(tweet);

      expect(result).toBe(false); // Should be false because default is 2 hours and tweet is 3 hours old
      expect(mockConfig.get).toHaveBeenCalledWith('MAX_CONTENT_AGE_HOURS', '2');
    });
  });

  describe('Enhanced Retweet Detection', () => {
    beforeEach(() => {
      jest.spyOn(scraperApp, 'extractTweets').mockResolvedValue([]);
      jest.spyOn(scraperApp, 'navigateToProfileTimeline').mockResolvedValue();
      jest.spyOn(scraperApp, 'filterNewTweets').mockReturnValue([]);
      jest.spyOn(scraperApp, 'isNewContent').mockReturnValue(true);
      jest.spyOn(scraperApp, 'processNewTweet').mockResolvedValue();
    });

    it('should skip enhanced retweet detection when disabled', async () => {
      jest.spyOn(scraperApp, 'shouldProcessRetweets').mockReturnValue(false);

      await scraperApp.performEnhancedRetweetDetection();

      expect(scraperApp.navigateToProfileTimeline).not.toHaveBeenCalled();
    });

    it('should perform enhanced retweet detection when enabled', async () => {
      jest.spyOn(scraperApp, 'shouldProcessRetweets').mockReturnValue(true);
      scraperApp.extractTweets.mockResolvedValue([
        { tweetID: '1', url: 'https://x.com/user/status/1', tweetCategory: 'Retweet' },
      ]);
      scraperApp.filterNewTweets.mockReturnValue([
        { tweetID: '1', url: 'https://x.com/user/status/1', tweetCategory: 'Retweet' },
      ]);

      await scraperApp.performEnhancedRetweetDetection();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Performing enhanced retweet detection...',
        expect.objectContaining({
          module: 'scraper',
        })
      );
      expect(scraperApp.navigateToProfileTimeline).toHaveBeenCalledWith('testuser');
      expect(scraperApp.processNewTweet).toHaveBeenCalled();
      expect(scraperApp.stats.totalTweetsAnnounced).toBe(1);
    });

    it('should log debug information with sampling during retweet detection', async () => {
      jest.spyOn(scraperApp, 'shouldProcessRetweets').mockReturnValue(true);
      jest.spyOn(scraperApp, 'shouldLogDebug').mockReturnValue(true);
      jest.spyOn(scraperApp, 'shouldLogVerbose').mockReturnValue(false);

      scraperApp.extractTweets.mockResolvedValue([
        { tweetID: '1', url: 'https://x.com/user/status/1', tweetCategory: 'Post' },
      ]);
      scraperApp.filterNewTweets.mockReturnValue([
        { tweetID: '1', url: 'https://x.com/user/status/1', tweetCategory: 'Post' },
      ]);

      await scraperApp.performEnhancedRetweetDetection();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Checking tweet 1, category: Post',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should log verbose information for old tweets with sampling', async () => {
      jest.spyOn(scraperApp, 'shouldProcessRetweets').mockReturnValue(true);
      jest.spyOn(scraperApp, 'shouldLogVerbose').mockReturnValue(true);
      scraperApp.isNewContent.mockReturnValue(false);

      scraperApp.extractTweets.mockResolvedValue([
        { tweetID: '1', url: 'https://x.com/user/status/1', tweetCategory: 'Post' },
      ]);
      scraperApp.filterNewTweets.mockReturnValue([
        { tweetID: '1', url: 'https://x.com/user/status/1', tweetCategory: 'Post' },
      ]);

      await scraperApp.performEnhancedRetweetDetection();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Skipping tweet 1 as it is old.',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should handle errors during enhanced retweet detection', async () => {
      jest.spyOn(scraperApp, 'shouldProcessRetweets').mockReturnValue(true);
      const retweetError = new Error('Retweet detection failed');
      scraperApp.navigateToProfileTimeline.mockRejectedValue(retweetError);

      await scraperApp.performEnhancedRetweetDetection();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error during enhanced retweet detection:',
        expect.objectContaining({
          module: 'scraper',
        })
      );
      // Should not rethrow error
    });
  });

  describe('Content Initialization', () => {
    beforeEach(() => {
      jest.spyOn(scraperApp, 'navigateToProfileTimeline').mockResolvedValue();
      jest.spyOn(scraperApp, 'extractTweets').mockResolvedValue([]);
      jest.spyOn(scraperApp, 'shouldProcessRetweets').mockReturnValue(true);
    });

    it('should initialize recent content and mark as seen', async () => {
      const now = new Date();
      const recentTweet = {
        tweetID: '1',
        url: 'https://x.com/user/status/1',
        timestamp: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
      };
      const oldTweet = {
        tweetID: '2',
        url: 'https://x.com/user/status/2',
        timestamp: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
      };

      scraperApp.extractTweets.mockResolvedValueOnce([recentTweet, oldTweet]).mockResolvedValueOnce([recentTweet]); // Second call for retweets

      mockConfig.get.mockImplementation((key, defaultValue) => {
        if (key === 'INITIALIZATION_WINDOW_HOURS') {
          return '24';
        }
        return defaultValue;
      });

      await scraperApp.initializeRecentContent();

      expect(mockDuplicateDetector.markAsSeen).toHaveBeenCalledWith(recentTweet.url);
      expect(mockDuplicateDetector.markAsSeen).toHaveBeenCalledTimes(2); // Once for each call
      expect(mockLogger.info).toHaveBeenCalledWith(
        '✅ Initialization complete: marked 2 recent posts as seen',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should handle errors during initialization gracefully', async () => {
      const initError = new Error('Initialization failed');
      scraperApp.navigateToProfileTimeline.mockRejectedValue(initError);

      await scraperApp.initializeRecentContent();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error during recent content initialization:',
        expect.objectContaining({
          module: 'scraper',
        })
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Continuing with normal operation despite initialization error',
        expect.objectContaining({
          module: 'scraper',
        })
      );
      // Should not rethrow error
    });

    it('should handle retweet scan errors during initialization', async () => {
      scraperApp.extractTweets
        .mockResolvedValueOnce([]) // Normal tweets
        .mockRejectedValueOnce(new Error('Retweet scan failed')); // Retweet scan fails

      await scraperApp.initializeRecentContent();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Error during retweet initialization scan:',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should skip retweet initialization when retweet processing is disabled', async () => {
      scraperApp.shouldProcessRetweets.mockReturnValue(false);
      scraperApp.extractTweets.mockResolvedValueOnce([]);

      await scraperApp.initializeRecentContent();

      expect(scraperApp.extractTweets).toHaveBeenCalledTimes(1); // Only called once for normal tweets
    });
  });
});
