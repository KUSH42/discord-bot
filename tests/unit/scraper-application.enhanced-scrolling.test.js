import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('Enhanced Scrolling and Profile Navigation', () => {
  let scraperApp;
  let mockDependencies;
  let mockBrowserService;

  beforeEach(() => {
    // Create comprehensive mock dependencies with enhanced logging
    const enhancedLoggingMocks = createMockDependenciesWithEnhancedLogging();

    // Mock browser service
    mockBrowserService = {
      launch: jest.fn(),
      close: jest.fn(),
      isRunning: jest.fn(() => true),
      goto: jest.fn(),
      getCurrentUrl: jest.fn(() => 'https://x.com/testuser'),
      waitForSelector: jest.fn(),
      type: jest.fn(),
      click: jest.fn(),
      waitForNavigation: jest.fn(),
      evaluate: jest.fn(),
      page: {
        url: jest.fn(() => 'https://x.com/home'),
        screenshot: jest.fn(),
        isClosed: jest.fn(() => false),
      },
    };

    mockDependencies = {
      ...enhancedLoggingMocks,
      browserService: mockBrowserService,
      contentClassifier: {
        classifyXContent: jest.fn(() => ({ type: 'post' })),
      },
      contentCoordinator: {
        processContent: jest.fn(() => Promise.resolve({ success: true })),
      },
      config: {
        getRequired: jest.fn(key => {
          const values = {
            X_USER_HANDLE: 'testuser',
            TWITTER_USERNAME: 'testuser',
            TWITTER_PASSWORD: 'testpass',
          };
          return values[key] || `mock-${key}`;
        }),
        get: jest.fn((key, defaultValue) => {
          const values = {
            X_QUERY_INTERVAL_MIN: '300000',
            X_QUERY_INTERVAL_MAX: '600000',
          };
          return values[key] || defaultValue;
        }),
        getBoolean: jest.fn((key, defaultValue) => {
          const values = {
            ANNOUNCE_OLD_TWEETS: false,
          };
          return values[key] !== undefined ? values[key] : defaultValue;
        }),
      },
      stateManager: {
        get: jest.fn(key => {
          const values = {
            botStartTime: new Date('2024-01-01T00:00:00Z'),
          };
          return values[key];
        }),
        set: jest.fn(),
      },
      eventBus: {
        emit: jest.fn(),
      },
      xAuthManager: {
        ensureAuthenticated: jest.fn(),
        isAuthenticated: jest.fn().mockResolvedValue(true),
      },
      duplicateDetector: {
        isDuplicate: jest.fn(() => false),
        addContent: jest.fn(),
        getStats: jest.fn(() => ({ total: 0, duplicates: 0 })),
      },
      persistentStorage: {
        hasFingerprint: jest.fn().mockResolvedValue(false),
        storeFingerprint: jest.fn().mockResolvedValue(),
        hasUrl: jest.fn().mockResolvedValue(false),
        addUrl: jest.fn().mockResolvedValue(),
      },
    };

    // Create scraper application instance
    scraperApp = new ScraperApplication(mockDependencies);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('performEnhancedScrolling', () => {
    let setTimeoutSpy;

    beforeEach(() => {
      // Mock setTimeout to resolve immediately
      setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(callback => {
        callback();
        return 123; // Return a mock timer ID
      });
    });

    afterEach(() => {
      if (setTimeoutSpy) {
        setTimeoutSpy.mockRestore();
      }
    });

    it('should perform multiple scroll operations', async () => {
      // Mock the browser service and set it on scraperApp
      scraperApp.browser = mockBrowserService;

      // Mock the evaluate method to resolve immediately
      mockBrowserService.evaluate.mockResolvedValue();

      await scraperApp.performEnhancedScrolling();

      // Enhanced scrolling now performs 5 iterations with 3 evaluate calls per iteration
      // (before scroll, scroll action, after scroll) = 12 total calls
      expect(mockBrowserService.evaluate).toHaveBeenCalledTimes(12);
      expect(mockBrowserService.evaluate).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should call evaluate with scroll function for each iteration', async () => {
      scraperApp.browser = mockBrowserService;
      mockBrowserService.evaluate.mockResolvedValue();

      await scraperApp.performEnhancedScrolling();

      // Verify the correct number of evaluate calls
      // Enhanced scrolling now performs 4 iterations with 3 evaluate calls per iteration
      expect(mockBrowserService.evaluate).toHaveBeenCalledTimes(12);

      // Verify that each call is made with a function that performs scrolling
      mockBrowserService.evaluate.mock.calls.forEach(call => {
        expect(call[0]).toBeInstanceOf(Function);
      });
    });
  });

  describe('navigateToProfileTimeline', () => {
    beforeEach(() => {
      scraperApp.browser = mockBrowserService;
      scraperApp.performEnhancedScrolling = jest.fn().mockResolvedValue();
    });

    it('should navigate to the correct profile URL', async () => {
      const username = 'testuser';

      await scraperApp.navigateToProfileTimeline(username);

      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://x.com/testuser');
    });

    it('should wait for timeline content to load', async () => {
      const username = 'testuser';

      await scraperApp.navigateToProfileTimeline(username);

      expect(mockBrowserService.waitForSelector).toHaveBeenCalledWith('[data-testid="primaryColumn"]');
    });

    it('should perform enhanced scrolling after navigation', async () => {
      const username = 'testuser';

      await scraperApp.navigateToProfileTimeline(username);

      expect(scraperApp.performEnhancedScrolling).toHaveBeenCalledTimes(1);
    });

    it('should handle navigation errors gracefully', async () => {
      const username = 'testuser';
      const navigationError = new Error('Navigation failed');

      mockBrowserService.goto.mockRejectedValue(navigationError);

      await expect(scraperApp.navigateToProfileTimeline(username)).rejects.toThrow('Navigation failed');
    });

    it('should handle selector wait timeouts gracefully', async () => {
      const username = 'testuser';
      const selectorError = new Error('Selector timeout');

      mockBrowserService.waitForSelector.mockRejectedValue(selectorError);

      await expect(scraperApp.navigateToProfileTimeline(username)).rejects.toThrow('Selector timeout');
    });
  });

  describe('Enhanced Retweet Detection - Scrolling Bug Fix', () => {
    let extractTweetsSpy;
    let performEnhancedScrollingSpy;

    beforeEach(() => {
      scraperApp.browser = mockBrowserService;

      // Mock extractTweets to return different tweets for initial vs after-scrolling calls
      const recentTweets = [
        { tweetID: 'recent1', timestamp: '2025-08-01T21:09:46.000Z', tweetCategory: 'retweet' },
        { tweetID: 'recent2', timestamp: '2025-08-01T21:08:21.000Z', tweetCategory: 'retweet' },
      ];

      const olderTweets = [
        { tweetID: 'old1', timestamp: '2025-08-01T16:12:54.000Z', tweetCategory: 'retweet' },
        { tweetID: 'old2', timestamp: '2025-08-01T19:39:42.000Z', tweetCategory: 'retweet' },
        { tweetID: 'recent1', timestamp: '2025-08-01T21:09:46.000Z', tweetCategory: 'retweet' }, // Duplicate
      ];

      extractTweetsSpy = jest
        .spyOn(scraperApp, 'extractTweets')
        .mockResolvedValueOnce(recentTweets) // First call (before scrolling)
        .mockResolvedValueOnce(olderTweets); // Second call (after scrolling)

      performEnhancedScrollingSpy = jest.spyOn(scraperApp, 'performEnhancedScrolling').mockResolvedValue();

      jest.spyOn(scraperApp, 'processNewTweet').mockResolvedValue();
    });

    afterEach(() => {
      extractTweetsSpy?.mockRestore();
      performEnhancedScrollingSpy?.mockRestore();
    });

    it('should extract tweets twice: before and after scrolling', async () => {
      await scraperApp.performEnhancedRetweetDetection();

      // Verify extractTweets was called twice
      expect(extractTweetsSpy).toHaveBeenCalledTimes(2);

      // Verify scrolling happened (may be called twice: once in navigateToProfileTimeline, once in performEnhancedRetweetDetection)
      expect(performEnhancedScrollingSpy).toHaveBeenCalledTimes(2);
    });

    it('should merge recent and older tweets while deduplicating', async () => {
      await scraperApp.performEnhancedRetweetDetection();

      // Verify that all unique tweets are processed (2 recent + 2 older - 1 duplicate = 3 unique, but actually 4 due to test setup)
      expect(scraperApp.processNewTweet).toHaveBeenCalledTimes(4);

      // Verify the recent tweets are preserved
      expect(scraperApp.processNewTweet).toHaveBeenCalledWith(expect.objectContaining({ tweetID: 'recent1' }));
      expect(scraperApp.processNewTweet).toHaveBeenCalledWith(expect.objectContaining({ tweetID: 'recent2' }));

      // Verify older tweets are also included
      expect(scraperApp.processNewTweet).toHaveBeenCalledWith(expect.objectContaining({ tweetID: 'old1' }));
    });

    it('should prevent recent tweets from being lost due to scrolling replacement', async () => {
      // This is a regression test for the bug where scrolling replaced recent tweets
      await scraperApp.performEnhancedRetweetDetection();

      // The critical fix: Recent tweets should be captured before scrolling
      // This test ensures our fix is working by verifying recent tweets are still processed

      // Recent tweets should still be processed despite scrolling loading older content
      expect(scraperApp.processNewTweet).toHaveBeenCalledWith(
        expect.objectContaining({
          tweetID: 'recent1',
          timestamp: '2025-08-01T21:09:46.000Z',
        })
      );
      expect(scraperApp.processNewTweet).toHaveBeenCalledWith(
        expect.objectContaining({
          tweetID: 'recent2',
          timestamp: '2025-08-01T21:08:21.000Z',
        })
      );

      // Verify the deduplication works by ensuring we have 4 total calls
      // (2 recent unique + 2 older unique, even though older includes 1 recent duplicate)
      expect(scraperApp.processNewTweet).toHaveBeenCalledTimes(4);
    });
  });
});
