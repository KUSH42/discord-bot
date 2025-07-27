import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { timestampUTC } from '../../src/utilities/utc-time.js';

describe('Content Filtering Logic', () => {
  let scraperApp;
  let mockBrowserService;
  let mockContentClassifier;
  let mockContentAnnouncer;
  let mockConfig;
  let mockStateManager;
  let mockEventBus;
  let mockLogger;
  let mockDiscordService;
  let mockAuthManager;

  beforeEach(() => {
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
          botStartTime: new Date(timestampUTC() - 60 * 60 * 1000), // 1 hour ago
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
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(), // Support logger.child() calls
    };

    // Mock discord service
    mockDiscordService = {
      sendMessage: jest.fn(),
    };

    // Mock auth manager
    mockAuthManager = {
      ensureAuthenticated: jest.fn(),
      isAuthenticated: jest.fn().mockResolvedValue(true),
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
      discord: mockDiscordService,
      authManager: mockAuthManager,
      persistentStorage: {
        hasFingerprint: jest.fn().mockResolvedValue(false),
        storeFingerprint: jest.fn().mockResolvedValue(),
        hasUrl: jest.fn().mockResolvedValue(false),
        addUrl: jest.fn().mockResolvedValue(),
      },
      duplicateDetector: {
        isDuplicate: jest.fn().mockReturnValue(false),
        markAsSeen: jest.fn(),
      },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isNewContent', () => {
    beforeEach(() => {
      // The scraperApp is already initialized with mockConfig and mockStateManager
      // We can just modify the mocks for each test case
    });

    it('should return true when ANNOUNCE_OLD_TWEETS is enabled', async () => {
      mockConfig.getBoolean.mockImplementation(key => {
        if (key === 'ANNOUNCE_OLD_TWEETS') {
          return true;
        }
        return false;
      });

      const oldTweet = {
        tweetID: '1234567890123456789',
        timestamp: new Date(timestampUTC() - 24 * 60 * 60 * 1000).toISOString(), // 24 hours ago (older than 2h backoff)
        url: 'https://x.com/testuser/status/1234567890123456789',
      };

      const result = await scraperApp.isNewContent(oldTweet);
      expect(result).toBe(true);
    });

    it('should return false for old tweets when ANNOUNCE_OLD_TWEETS is disabled', async () => {
      mockConfig.getBoolean.mockReturnValue(false);

      const oldTweet = {
        tweetID: '1234567890123456789',
        timestamp: new Date(timestampUTC() - 24 * 60 * 60 * 1000).toISOString(), // 24 hours ago (older than 2h backoff)
        url: 'https://x.com/testuser/status/1234567890123456789',
      };

      const result = await scraperApp.isNewContent(oldTweet);
      expect(result).toBe(false);
    });

    it('should return true for tweets within the backoff window', async () => {
      mockConfig.getBoolean.mockReturnValue(false);

      const newTweet = {
        tweetID: '1234567890123456781',
        timestamp: new Date(timestampUTC() - 30 * 60 * 1000).toISOString(), // 30 minutes ago (within 2h backoff)
        url: 'https://x.com/testuser/status/1234567890123456781',
      };

      const result = await scraperApp.isNewContent(newTweet);
      expect(result).toBe(true);
    });

    it('should return true when no bot start time is set', async () => {
      mockStateManager.get.mockReturnValue(null);

      const tweet = {
        tweetID: '1234567890123456789',
        timestamp: new Date(timestampUTC() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
        url: 'https://x.com/testuser/status/1234567890123456789',
      };

      const result = await scraperApp.isNewContent(tweet);
      expect(result).toBe(true);
    });

    it('should return true when tweet has no timestamp', async () => {
      const tweet = {
        tweetID: '1234567890123456789',
        timestamp: null,
        url: 'https://x.com/testuser/status/1234567890123456789',
      };

      const result = await scraperApp.isNewContent(tweet);
      expect(result).toBe(true);
    });
  });
});
