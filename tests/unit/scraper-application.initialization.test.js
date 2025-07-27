import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { timestampUTC } from '../../src/utilities/utc-time.js';

describe('ScraperApplication Initialization', () => {
  let scraperApp;
  let mockDependencies;
  let mockConfig;
  let mockBrowserService;
  let mockClassifier;
  let mockAnnouncer;
  let mockStateManager;
  let mockLogger;
  let mockAuthManager;
  let mockEventBus;

  beforeEach(() => {
    // Mock all dependencies
    mockConfig = {
      getRequired: jest.fn(),
      get: jest.fn(),
      getBoolean: jest.fn(),
    };

    mockBrowserService = {
      launch: jest.fn(),
      close: jest.fn(),
      goto: jest.fn(),
      waitForSelector: jest.fn(),
      evaluate: jest.fn(),
      setUserAgent: jest.fn(),
      isRunning: jest.fn().mockReturnValue(false),
    };

    mockClassifier = {
      classifyXContent: jest.fn(),
    };

    mockAnnouncer = {
      announceContent: jest.fn(),
    };

    mockStateManager = {
      get: jest.fn(),
      set: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    // Mock enhanced logging dependencies
    const mockDebugManager = {
      isEnabled: jest.fn(() => false),
      getLevel: jest.fn(() => 1),
      toggleFlag: jest.fn(),
      setLevel: jest.fn(),
    };

    const mockMetricsManager = {
      recordMetric: jest.fn(),
      startTimer: jest.fn(() => ({ end: jest.fn() })),
      incrementCounter: jest.fn(),
      setGauge: jest.fn(),
      recordHistogram: jest.fn(),
    };

    mockAuthManager = {
      login: jest.fn(),
      ensureAuthenticated: jest.fn(),
    };

    mockEventBus = {
      emit: jest.fn(),
      on: jest.fn(),
    };

    mockDependencies = {
      browserService: mockBrowserService,
      contentClassifier: mockClassifier,
      contentAnnouncer: mockAnnouncer,
      config: mockConfig,
      stateManager: mockStateManager,
      discordService: {},
      eventBus: mockEventBus,
      logger: mockLogger,
      debugManager: mockDebugManager,
      metricsManager: mockMetricsManager,
      authManager: mockAuthManager,
      persistentStorage: {
        hasFingerprint: jest.fn().mockResolvedValue(false),
        storeFingerprint: jest.fn().mockResolvedValue(),
        hasUrl: jest.fn().mockResolvedValue(false),
        addUrl: jest.fn().mockResolvedValue(),
      },
    };

    // Setup config defaults
    mockConfig.getRequired.mockImplementation(key => {
      const values = {
        X_USER_HANDLE: 'testuser',
        TWITTER_USERNAME: 'testuser',
        TWITTER_PASSWORD: 'testpass',
      };
      return values[key];
    });

    mockConfig.get.mockImplementation((key, defaultValue) => {
      const values = {
        X_QUERY_INTERVAL_MIN: '300000',
        X_QUERY_INTERVAL_MAX: '600000',
        INITIALIZATION_WINDOW_HOURS: '24',
      };
      return values[key] || defaultValue;
    });

    mockConfig.getBoolean.mockImplementation((key, defaultValue) => {
      const values = {
        ANNOUNCE_OLD_TWEETS: false,
        ENABLE_RETWEET_PROCESSING: true,
      };
      return values[key] ?? defaultValue;
    });

    scraperApp = new ScraperApplication(mockDependencies);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeRecentContent', () => {
    it('should mark recent tweets as seen during initialization', async () => {
      // Mock recent tweets from the last 24 hours
      const now = new Date();
      const recentTweets = [
        {
          tweetID: '1234567890123456789',
          timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
          author: 'testuser',
          text: 'Recent tweet',
          url: 'https://x.com/testuser/status/1234567890123456789',
        },
        {
          tweetID: '9876543210987654321',
          timestamp: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
          author: 'testuser',
          text: 'Another recent tweet',
          url: 'https://x.com/testuser/status/9876543210987654321',
        },
      ];

      // Mock browser navigation and tweet extraction
      mockBrowserService.goto.mockResolvedValue();

      // Mock the navigateToProfileTimeline method
      scraperApp.navigateToProfileTimeline = jest.fn().mockResolvedValue();

      // Mock the extractTweets method to return our test data
      scraperApp.extractTweets = jest.fn().mockResolvedValue(recentTweets);

      await scraperApp.initializeRecentContent();

      // Verify navigation to profile
      expect(scraperApp.navigateToProfileTimeline).toHaveBeenCalledWith('testuser');

      // Verify tweets were marked as seen
      expect(await scraperApp.duplicateDetector.isDuplicate('https://x.com/testuser/status/1234567890123456789')).toBe(
        true
      );
      expect(await scraperApp.duplicateDetector.isDuplicate('https://x.com/testuser/status/9876543210987654321')).toBe(
        true
      );

      // Verify logging
      // Enhanced Logger produces structured messages, check if info was called
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should filter out old tweets during initialization', async () => {
      const now = new Date();
      const tweets = [
        {
          tweetID: '1234567890123456789',
          timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago (recent)
          author: 'testuser',
          url: 'https://x.com/testuser/status/1234567890123456789',
        },
        {
          tweetID: '9876543210987654321',
          timestamp: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago (old)
          author: 'testuser',
          url: 'https://x.com/testuser/status/9876543210987654321',
        },
      ];

      mockBrowserService.goto.mockResolvedValue();
      scraperApp.navigateToProfileTimeline = jest.fn().mockResolvedValue();
      scraperApp.extractTweets = jest.fn().mockResolvedValue(tweets);

      await scraperApp.initializeRecentContent();

      // Only recent tweet should be marked as seen
      expect(await scraperApp.duplicateDetector.isDuplicate('https://x.com/testuser/status/1234567890123456789')).toBe(
        true
      );
      expect(await scraperApp.duplicateDetector.isDuplicate('https://x.com/testuser/status/9876543210987654321')).toBe(
        false
      );
    });

    it('should handle initialization errors gracefully', async () => {
      mockBrowserService.goto.mockRejectedValue(new Error('Navigation failed'));
      scraperApp.navigateToProfileTimeline = jest.fn().mockRejectedValue(new Error('Navigation failed'));

      // Should not throw - initialization is best-effort
      await expect(scraperApp.initializeRecentContent()).resolves.not.toThrow();

      // Enhanced Logger produces structured messages, check if error and warn were called
      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should use configurable initialization window', async () => {
      // Configure 6-hour window instead of default 24
      mockConfig.get.mockImplementation((key, defaultValue) => {
        if (key === 'INITIALIZATION_WINDOW_HOURS') {
          return '6';
        }
        return defaultValue;
      });

      const now = new Date();
      const tweets = [
        {
          tweetID: '1234567890123456789',
          timestamp: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago (within 6h window)
          url: 'https://x.com/testuser/status/1234567890123456789',
        },
        {
          tweetID: '9876543210987654321',
          timestamp: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString(), // 8 hours ago (outside 6h window)
          url: 'https://x.com/testuser/status/9876543210987654321',
        },
      ];

      scraperApp.navigateToProfileTimeline = jest.fn().mockResolvedValue();
      scraperApp.extractTweets = jest.fn().mockResolvedValue(tweets);

      await scraperApp.initializeRecentContent();

      // Only tweet within 6-hour window should be marked
      expect(await scraperApp.duplicateDetector.isDuplicate('https://x.com/testuser/status/1234567890123456789')).toBe(
        true
      );
      expect(await scraperApp.duplicateDetector.isDuplicate('https://x.com/testuser/status/9876543210987654321')).toBe(
        false
      );
    });
  });

  describe('isNewContent with improved logic', () => {
    it('should return false for already known tweets', async () => {
      const tweet = {
        tweetID: '1234567890123456789',
        timestamp: new Date().toISOString(),
        url: 'https://x.com/testuser/status/1234567890123456789',
      };

      // Mark tweet as seen
      scraperApp.duplicateDetector.markAsSeen('https://x.com/testuser/status/1234567890123456789');

      expect(await scraperApp.isNewContent(tweet)).toBe(false);
    });

    it('should return false for very old tweets', async () => {
      const oldDate = new Date(timestampUTC() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
      const tweet = { tweetID: '1111111111111111111', timestamp: oldDate.toISOString() };

      expect(await scraperApp.isNewContent(tweet)).toBe(false);
    });

    it('should return true for recent unknown tweets', async () => {
      const recentDate = new Date(timestampUTC() - 90 * 60 * 1000); // 1.5 hours ago (within 2h backoff)
      const tweet = { tweetID: '2222222222222222222', timestamp: recentDate.toISOString() };

      expect(await scraperApp.isNewContent(tweet)).toBe(true);
    });

    it('should be permissive for tweets during bot startup period', async () => {
      const botStartTime = new Date();
      const tweetBeforeStart = new Date(botStartTime.getTime() - 30 * 60 * 1000); // 30 mins before bot start

      mockStateManager.get.mockReturnValue(botStartTime);

      const tweet = { tweetID: '3333333333333333333', timestamp: tweetBeforeStart.toISOString() };

      // Should be permissive since bot just started
      expect(await scraperApp.isNewContent(tweet)).toBe(true);
    });

    it('should respect ANNOUNCE_OLD_TWEETS setting', async () => {
      mockConfig.getBoolean.mockImplementation(key => {
        if (key === 'ANNOUNCE_OLD_TWEETS') {
          return true;
        }
        return false;
      });

      const veryOldTweet = {
        tweetID: '4444444444444444444',
        timestamp: new Date(timestampUTC() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
      };

      expect(await scraperApp.isNewContent(veryOldTweet)).toBe(true);
    });
  });
});
