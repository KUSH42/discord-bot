import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('Search and Retweet Logic', () => {
  let scraperApp;
  let mockBrowserService;
  let mockContentClassifier;
  let mockContentAnnouncer;
  let mockConfig;
  let mockStateManager;
  let mockEventBus;
  let mockLogger;
  let mockDiscordService;
  let mockDelay;

  beforeEach(() => {
    // Create enhanced logging mocks
    const enhancedLoggingMocks = createMockDependenciesWithEnhancedLogging();

    // Mock browser service
    mockBrowserService = {
      launch: jest.fn(),
      close: jest.fn(),
      isRunning: jest.fn(() => true),
      goto: jest.fn(),
      getCurrentUrl: jest.fn(() => 'https://x.com/search?q=(from%3Atestuser)'),
      waitForSelector: jest.fn(),
      type: jest.fn(),
      click: jest.fn(),
      waitForNavigation: jest.fn(),
      evaluate: jest.fn(),
      page: {
        url: jest.fn(() => 'https://x.com/home'),
        screenshot: jest.fn(),
      },
    };

    mockBrowserService.waitForSelector.mockResolvedValue(true);

    // Mock content classifier
    mockContentClassifier = {
      classifyXContent: jest.fn(() => ({ type: 'post' })),
    };

    // Mock content announcer
    mockContentAnnouncer = {
      announceContent: jest.fn(() => Promise.resolve({ success: true })),
    };

    // Mock config
    mockConfig = {
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
    };

    // Mock state manager
    mockStateManager = {
      get: jest.fn(key => {
        const values = {
          botStartTime: new Date('2024-01-01T00:00:00Z'),
        };
        return values[key];
      }),
      set: jest.fn(),
    };

    // Mock event bus
    mockEventBus = {
      emit: jest.fn(),
    };

    // Mock logger
    mockLogger = enhancedLoggingMocks.logger;

    // Mock discord service
    mockDiscordService = {
      sendMessage: jest.fn(),
    };

    // Mock auth manager
    const mockAuthManager = {
      ensureAuthenticated: jest.fn(),
      isAuthenticated: jest.fn().mockResolvedValue(true),
    };

    mockDelay = jest.fn().mockResolvedValue();

    // Mock duplicate detector
    const mockDuplicateDetector = {
      isDuplicate: jest.fn().mockResolvedValue(false),
      addFingerprint: jest.fn().mockResolvedValue(),
      getStats: jest.fn().mockReturnValue({
        totalChecked: 0,
        duplicatesFound: 0,
        uniqueContent: 0,
      }),
    };

    // Create scraper application instance
    scraperApp = new ScraperApplication({
      browserService: mockBrowserService,
      contentClassifier: mockContentClassifier,
      contentAnnouncer: mockContentAnnouncer,
      config: mockConfig,
      stateManager: mockStateManager,
      eventBus: mockEventBus,
      logger: mockLogger,
      debugManager: enhancedLoggingMocks.debugManager,
      metricsManager: enhancedLoggingMocks.metricsManager,
      discord: mockDiscordService,
      xAuthManager: mockAuthManager,
      delay: mockDelay,
      duplicateDetector: mockDuplicateDetector,
      persistentStorage: {
        hasFingerprint: jest.fn().mockResolvedValue(false),
        storeFingerprint: jest.fn().mockResolvedValue(),
        hasUrl: jest.fn().mockResolvedValue(false),
        addUrl: jest.fn().mockResolvedValue(),
      },
    });

    // Set up browser and other dependencies
    scraperApp.browser = mockBrowserService;
    scraperApp.discord = mockDiscordService;

    // Mock methods that pollXProfile depends on
    jest.spyOn(scraperApp, 'extractTweets').mockResolvedValue([]);
    jest.spyOn(scraperApp, 'processNewTweet').mockResolvedValue();
    jest.spyOn(scraperApp, 'getNextInterval').mockReturnValue(300000);
    jest.spyOn(scraperApp, 'verifyAuthentication').mockResolvedValue();
    jest.spyOn(scraperApp, 'navigateToProfileTimeline').mockResolvedValue();
    jest.spyOn(scraperApp, 'performEnhancedScrolling').mockResolvedValue();

    // Mock browser evaluate method for scrolling
    mockBrowserService.evaluate.mockResolvedValue({ isLoggedIn: true });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should perform enhanced retweet detection regardless of step 1 results', async () => {
    // Mock generateSearchUrl and performEnhancedRetweetDetection
    jest.spyOn(scraperApp, 'generateSearchUrl').mockReturnValue('https://x.com/search?q=(from%3Atestuser)');
    jest.spyOn(scraperApp, 'performEnhancedRetweetDetection').mockResolvedValue();
    jest.spyOn(scraperApp, 'shouldProcessRetweets').mockReturnValue(true);

    await scraperApp.pollXProfile();

    // Should always perform step 2 (enhanced retweet detection) after step 1 (search)
    expect(scraperApp.performEnhancedRetweetDetection).toHaveBeenCalled();
  });

  it('should use two-step approach: advanced search + enhanced retweet detection', async () => {
    // Mock generateSearchUrl method for the first step
    jest
      .spyOn(scraperApp, 'generateSearchUrl')
      .mockReturnValue('https://x.com/search?q=(from%3Atestuser)%20since%3A2025-07-28&f=live&pf=on&src=typed_query');

    // Mock performEnhancedRetweetDetection for the second step
    jest.spyOn(scraperApp, 'performEnhancedRetweetDetection').mockResolvedValue();

    await scraperApp.pollXProfile();

    // Step 1: Should use advanced search with browser.goto
    expect(scraperApp.generateSearchUrl).toHaveBeenCalledWith(true);
    expect(mockBrowserService.goto).toHaveBeenCalledWith(
      'https://x.com/search?q=(from%3Atestuser)%20since%3A2025-07-28&f=live&pf=on&src=typed_query'
    );

    // Step 2: Should perform enhanced retweet detection (which navigates to profile timeline internally)
    expect(scraperApp.performEnhancedRetweetDetection).toHaveBeenCalled();
  });

  it('should log polling completion message', async () => {
    // Mock the required methods for the two-step approach
    jest.spyOn(scraperApp, 'generateSearchUrl').mockReturnValue('https://x.com/search?q=(from%3Atestuser)');
    jest.spyOn(scraperApp, 'performEnhancedRetweetDetection').mockResolvedValue();

    await scraperApp.pollXProfile();

    expect(mockLogger.info).toHaveBeenCalledWith(
      'X profile polling completed successfully',
      expect.objectContaining({
        module: 'scraper',
      })
    );
  });

  it('should not log enhanced retweet message when disabled', async () => {
    // Mock the required methods for the two-step approach
    jest.spyOn(scraperApp, 'generateSearchUrl').mockReturnValue('https://x.com/search?q=(from%3Atestuser)');
    jest.spyOn(scraperApp, 'performEnhancedRetweetDetection').mockResolvedValue();
    jest.spyOn(scraperApp, 'shouldProcessRetweets').mockReturnValue(false);

    await scraperApp.pollXProfile();

    expect(mockLogger.info).not.toHaveBeenCalledWith(expect.stringContaining('Enhanced retweet detection'));
  });

  it('should use both search and enhanced retweet detection for complete coverage', async () => {
    // Mock the two-step approach methods
    jest.spyOn(scraperApp, 'generateSearchUrl').mockReturnValue('https://x.com/search?q=(from%3Atestuser)');
    jest.spyOn(scraperApp, 'performEnhancedRetweetDetection').mockResolvedValue();

    await scraperApp.pollXProfile();

    // Step 1: Should perform advanced search for user-authored posts
    expect(mockBrowserService.goto).toHaveBeenCalledWith('https://x.com/search?q=(from%3Atestuser)');

    // Step 2: Should perform enhanced retweet detection to get retweets missed by search
    expect(scraperApp.performEnhancedRetweetDetection).toHaveBeenCalled();
  });

  it('should extract tweets after navigating to search results', async () => {
    // Mock the methods needed for the test
    jest.spyOn(scraperApp, 'generateSearchUrl').mockReturnValue('https://x.com/search?q=(from%3Atestuser)');
    jest.spyOn(scraperApp, 'performEnhancedRetweetDetection').mockResolvedValue();

    await scraperApp.pollXProfile();

    // Should extract tweets from search results after navigation
    expect(scraperApp.extractTweets).toHaveBeenCalled();
  });

  it('should extract and process tweets after navigation', async () => {
    const mockTweets = [
      {
        tweetID: '1234567890',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'Test tweet',
        timestamp: '2024-01-01T00:01:00Z',
      },
    ];

    // Mock the required methods for the two-step approach
    jest.spyOn(scraperApp, 'generateSearchUrl').mockReturnValue('https://x.com/search?q=(from%3Atestuser)');
    jest.spyOn(scraperApp, 'performEnhancedRetweetDetection').mockResolvedValue();
    scraperApp.extractTweets.mockResolvedValue(mockTweets);

    await scraperApp.pollXProfile();

    expect(scraperApp.extractTweets).toHaveBeenCalled();
    expect(scraperApp.processNewTweet).toHaveBeenCalledWith(mockTweets[0]);
  });

  it('should emit poll completion event with correct data', async () => {
    const mockTweets = [{ tweetID: '123' }];
    const newTweets = [{ tweetID: '123' }];

    // Mock the required methods for the two-step approach
    jest.spyOn(scraperApp, 'generateSearchUrl').mockReturnValue('https://x.com/search?q=(from%3Atestuser)');
    jest.spyOn(scraperApp, 'performEnhancedRetweetDetection').mockResolvedValue();
    scraperApp.extractTweets.mockResolvedValue(mockTweets);

    await scraperApp.pollXProfile();

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      'scraper.poll.completed',
      expect.objectContaining({
        timestamp: expect.any(Date),
        tweetsFound: 1,
        tweetsProcessed: 1,
        stats: expect.any(Object),
      })
    );
  });
});
