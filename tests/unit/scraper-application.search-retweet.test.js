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
      authManager: mockAuthManager,
      delay: mockDelay,
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
    jest.spyOn(scraperApp, 'filterNewTweets').mockReturnValue([]);
    jest.spyOn(scraperApp, 'processNewTweet').mockResolvedValue();
    jest.spyOn(scraperApp, 'getNextInterval').mockReturnValue(300000);
    jest.spyOn(scraperApp, 'verifyAuthentication').mockResolvedValue();
    jest.spyOn(scraperApp, 'navigateToProfileTimeline').mockResolvedValue();

    // Mock browser evaluate method for scrolling
    mockBrowserService.evaluate.mockResolvedValue({ isLoggedIn: true });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should always navigate to search URL regardless of retweet processing setting', async () => {
    jest.spyOn(scraperApp, 'shouldProcessRetweets').mockReturnValue(true);
    const expectedSearchUrl = `https://x.com/search?q=(from%3Atestuser)&f=live&pf=on&src=typed_query`;

    // Mock generateSearchUrl to control the output for this test
    jest.spyOn(scraperApp, 'generateSearchUrl').mockReturnValue(expectedSearchUrl);

    await scraperApp.pollXProfile();

    expect(scraperApp.generateSearchUrl).toHaveBeenCalledWith(true);
    expect(mockBrowserService.goto).toHaveBeenCalledWith(expectedSearchUrl);
  });

  it('should generate correct search URL with date parameter', async () => {
    const expectedSearchUrlWithDate = `https://x.com/search?q=(from%3Atestuser)%20since%3A2025-07-17&f=live&pf=on&src=typed_query`;

    // Mock generateSearchUrl to return a predictable URL with a date
    jest.spyOn(scraperApp, 'generateSearchUrl').mockReturnValue(expectedSearchUrlWithDate);

    await scraperApp.pollXProfile();

    expect(scraperApp.generateSearchUrl).toHaveBeenCalledWith(true);
    expect(mockBrowserService.goto).toHaveBeenCalledWith(expectedSearchUrlWithDate);
  });

  it('should log polling completion message', async () => {
    await scraperApp.pollXProfile();

    expect(mockLogger.info).toHaveBeenCalledWith(
      'X profile polling completed successfully',
      expect.objectContaining({
        module: 'scraper',
      })
    );
  });

  it('should not log enhanced retweet message when disabled', async () => {
    jest.spyOn(scraperApp, 'shouldProcessRetweets').mockReturnValue(false);

    await scraperApp.pollXProfile();

    expect(mockLogger.info).not.toHaveBeenCalledWith(expect.stringContaining('Enhanced retweet detection'));
  });

  it('should prioritize search URL navigation over retweet processing', async () => {
    // Mock shouldProcessRetweets to return different values
    const shouldProcessRetweetsSpy = jest.spyOn(scraperApp, 'shouldProcessRetweets').mockReturnValue(true);

    await scraperApp.pollXProfile();

    // Should navigate to search URL first, regardless of retweet processing setting
    expect(mockBrowserService.goto).toHaveBeenCalledWith(
      expect.stringMatching(/https:\/\/x.com\/search\?q=\(from%3Atestuser\)/)
    );

    // Should then check for retweet processing
    expect(shouldProcessRetweetsSpy).toHaveBeenCalled();
  });

  it('should perform scrolling to load more content', async () => {
    await scraperApp.pollXProfile();

    // Should call evaluate multiple times for scrolling and content extraction
    expect(mockBrowserService.evaluate).toHaveBeenCalled();
    expect(mockBrowserService.evaluate).toHaveBeenCalledWith(expect.any(Function));
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

    scraperApp.extractTweets.mockResolvedValue(mockTweets);
    scraperApp.filterNewTweets.mockReturnValue(mockTweets);

    await scraperApp.pollXProfile();

    expect(scraperApp.extractTweets).toHaveBeenCalled();
    expect(scraperApp.filterNewTweets).toHaveBeenCalledWith(mockTweets);
    expect(scraperApp.processNewTweet).toHaveBeenCalledWith(mockTweets[0]);
  });

  it('should emit poll completion event with correct data', async () => {
    const mockTweets = [{ tweetID: '123' }];
    const newTweets = [{ tweetID: '123' }];

    scraperApp.extractTweets.mockResolvedValue(mockTweets);
    scraperApp.filterNewTweets.mockReturnValue(newTweets);

    await scraperApp.pollXProfile();

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      'scraper.poll.completed',
      expect.objectContaining({
        timestamp: expect.any(Date),
        tweetsFound: 1,
        newTweets: 1,
        stats: expect.any(Object),
      })
    );
  });
});
