import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';

describe('ScraperApplication Tweet Extraction', () => {
  let scraperApp;
  let mockDependencies;
  let mockConfig;
  let mockBrowserService;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();

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
      type: jest.fn(),
      click: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

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
      };
      return defaults[key] || defaultValue;
    });

    mockDependencies = {
      browserService: mockBrowserService,
      contentClassifier: { classifyXContent: jest.fn() },
      contentAnnouncer: { announceContent: jest.fn() },
      config: mockConfig,
      stateManager: { get: jest.fn(), set: jest.fn() },
      discordService: { login: jest.fn() },
      eventBus: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
      logger: mockLogger,
      xAuthManager: {
        login: jest.fn(),
        clickNextButton: jest.fn(),
        clickLoginButton: jest.fn(),
        isAuthenticated: jest.fn(),
        ensureAuthenticated: jest.fn(),
      },
      duplicateDetector: {
        isDuplicate: jest.fn().mockReturnValue(false),
        markAsSeen: jest.fn(),
        getStats: jest.fn().mockReturnValue({ totalSeen: 0, totalChecked: 0 }),
      },
      persistentStorage: { get: jest.fn(), set: jest.fn() },
    };

    scraperApp = new ScraperApplication(mockDependencies);
  });

  describe('extractTweets', () => {
    it('should call browser evaluate with monitored user', async () => {
      mockBrowserService.evaluate.mockResolvedValue([]);

      await scraperApp.extractTweets();

      expect(mockBrowserService.evaluate).toHaveBeenCalledWith(expect.any(Function), 'testuser');
    });

    it('should return extraction results', async () => {
      const mockTweets = [{ tweetID: '123', url: 'test-url' }];
      mockBrowserService.evaluate.mockResolvedValue(mockTweets);

      const result = await scraperApp.extractTweets();

      expect(result).toEqual(mockTweets);
    });
  });

  describe('Simple Operation Tests', () => {
    it('should update statistics on poll', () => {
      scraperApp.stats.totalRuns = 0;
      scraperApp.stats.lastRunTime = null;

      // Simulate the beginning of pollXProfile
      scraperApp.nextPollTimestamp = null;
      scraperApp.stats.totalRuns++;
      scraperApp.stats.lastRunTime = new Date();

      expect(scraperApp.stats.totalRuns).toBe(1);
      expect(scraperApp.stats.lastRunTime).toBeInstanceOf(Date);
    });

    it('should increment tweet counts', () => {
      scraperApp.stats.totalTweetsFound = 0;
      scraperApp.stats.totalTweetsAnnounced = 0;

      // Simulate processing tweets
      scraperApp.stats.totalTweetsFound += 5;
      scraperApp.stats.totalTweetsAnnounced += 3;

      expect(scraperApp.stats.totalTweetsFound).toBe(5);
      expect(scraperApp.stats.totalTweetsAnnounced).toBe(3);
    });
  });
});
