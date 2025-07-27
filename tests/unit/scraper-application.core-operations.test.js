import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { timestampUTC } from '../../src/utilities/utc-time.js';

describe('ScraperApplication Core Operations', () => {
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
  let mockDiscordService;
  let mockDuplicateDetector;
  let mockPersistentStorage;

  beforeEach(() => {
    jest.clearAllMocks();

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
      type: jest.fn(),
      click: jest.fn(),
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
      child: jest.fn().mockReturnThis(),
    };

    mockAuthManager = {
      login: jest.fn(),
      clickNextButton: jest.fn(),
      clickLoginButton: jest.fn(),
      isAuthenticated: jest.fn(),
      ensureAuthenticated: jest.fn(),
    };

    mockEventBus = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    mockDiscordService = {
      login: jest.fn(),
    };

    mockDuplicateDetector = {
      isDuplicate: jest.fn().mockReturnValue(false),
      markAsSeen: jest.fn(),
      getStats: jest.fn().mockReturnValue({ totalSeen: 0, totalChecked: 0 }),
    };

    mockPersistentStorage = {
      get: jest.fn(),
      set: jest.fn(),
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
        MAX_CONTENT_AGE_HOURS: '24',
        INITIALIZATION_WINDOW_HOURS: '24',
        TWITTER_EMAIL: 'test@example.com',
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
      browserService: mockBrowserService,
      contentClassifier: mockClassifier,
      contentAnnouncer: mockAnnouncer,
      config: mockConfig,
      stateManager: mockStateManager,
      discordService: mockDiscordService,
      eventBus: mockEventBus,
      logger: mockLogger,
      authManager: mockAuthManager,
      duplicateDetector: mockDuplicateDetector,
      persistentStorage: mockPersistentStorage,
    };

    scraperApp = new ScraperApplication(mockDependencies);
  });

  afterEach(() => {
    if (scraperApp && scraperApp.timerId) {
      clearTimeout(scraperApp.timerId);
    }
  });

  describe('Constructor and Configuration', () => {
    it('should create with proper dependency injection', () => {
      expect(scraperApp.browser).toBe(mockBrowserService);
      expect(scraperApp.classifier).toBe(mockClassifier);
      expect(scraperApp.announcer).toBe(mockAnnouncer);
      expect(scraperApp.config).toBe(mockConfig);
      expect(scraperApp.state).toBe(mockStateManager);
      expect(scraperApp.discord).toBe(mockDiscordService);
      expect(scraperApp.eventBus).toBe(mockEventBus);
      expect(scraperApp.logger).toBe(mockLogger);
      expect(scraperApp.authManager).toBe(mockAuthManager);
    });

    it('should initialize with provided duplicate detector', () => {
      expect(scraperApp.duplicateDetector).toBe(mockDuplicateDetector);
    });

    it('should create duplicate detector if not provided', () => {
      const depsWithoutDetector = { ...mockDependencies };
      delete depsWithoutDetector.duplicateDetector;

      const app = new ScraperApplication(depsWithoutDetector);
      expect(app.duplicateDetector).toBeDefined();
      expect(app.duplicateDetector).not.toBe(mockDuplicateDetector);
    });

    it('should initialize configuration values', () => {
      expect(scraperApp.xUser).toBe('testuser');
      expect(scraperApp.twitterUsername).toBe('testuser@example.com');
      expect(scraperApp.twitterPassword).toBe('testpass');
      expect(scraperApp.minInterval).toBe(300000);
      expect(scraperApp.maxInterval).toBe(600000);
    });

    it('should initialize statistics', () => {
      expect(scraperApp.stats).toEqual({
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        totalTweetsFound: 0,
        totalTweetsAnnounced: 0,
        lastRunTime: null,
        lastError: null,
      });
    });

    it('should initialize sampling rates', () => {
      expect(scraperApp.debugSamplingRate).toBe(0.1);
      expect(scraperApp.verboseLogSamplingRate).toBe(0.05);
    });
  });

  describe('Logging Sampling', () => {
    it('should sample debug logging based on rate', () => {
      // Mock Math.random to control sampling
      const originalRandom = Math.random;
      Math.random = jest.fn().mockReturnValue(0.05); // Below debug threshold (0.1)

      expect(scraperApp.shouldLogDebug()).toBe(true);

      Math.random = jest.fn().mockReturnValue(0.15); // Above debug threshold (0.1)
      expect(scraperApp.shouldLogDebug()).toBe(false);

      Math.random = originalRandom;
    });

    it('should sample verbose logging based on rate', () => {
      // Mock Math.random to control sampling
      const originalRandom = Math.random;
      Math.random = jest.fn().mockReturnValue(0.03); // Below verbose threshold (0.05)

      expect(scraperApp.shouldLogVerbose()).toBe(true);

      Math.random = jest.fn().mockReturnValue(0.07); // Above verbose threshold (0.05)
      expect(scraperApp.shouldLogVerbose()).toBe(false);

      Math.random = originalRandom;
    });
  });

  describe('Start Operation', () => {
    it('should throw error if already running', async () => {
      scraperApp.isRunning = true;

      await expect(scraperApp.start()).rejects.toThrow('Scraper application is already running');
    });

    it('should handle start failure and cleanup', async () => {
      mockBrowserService.launch.mockRejectedValue(new Error('Browser launch failed'));

      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'initializeBrowser').mockRejectedValue(new Error('Browser launch failed'));

      await expect(scraperApp.start()).rejects.toThrow('Browser launch failed');

      expect(scraperApp.stop).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith('❌ Failed to start scraper application:', expect.any(Error));
    });

    it('should emit start event on successful start', async () => {
      jest.spyOn(scraperApp, 'initializeBrowser').mockResolvedValue();
      jest.spyOn(scraperApp, 'ensureAuthenticated').mockResolvedValue();
      jest.spyOn(scraperApp, 'initializeRecentContent').mockResolvedValue();
      jest.spyOn(scraperApp, 'startPolling').mockImplementation(() => {});
      jest.spyOn(scraperApp, 'getNextInterval').mockReturnValue(300000);

      await scraperApp.start();

      expect(scraperApp.isRunning).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith('scraper.started', {
        startTime: expect.any(Date),
        xUser: 'testuser',
        pollingInterval: 300000,
      });
      expect(mockLogger.info).toHaveBeenCalledWith('✅ X scraper application started successfully');
    });
  });

  describe('Stop Operation', () => {
    it('should return early if not running', async () => {
      scraperApp.isRunning = false;

      await scraperApp.stop();

      expect(mockLogger.info).not.toHaveBeenCalledWith('Stopping X scraper application...');
    });

    it('should stop polling and close browser', async () => {
      scraperApp.isRunning = true;
      scraperApp.timerId = setTimeout(() => {}, 1000);

      jest.spyOn(scraperApp, 'stopPolling').mockImplementation(() => {});
      jest.spyOn(scraperApp, 'closeBrowser').mockResolvedValue();
      jest.spyOn(scraperApp, 'getStats').mockReturnValue({ test: 'stats' });

      await scraperApp.stop();

      expect(scraperApp.stopPolling).toHaveBeenCalled();
      expect(scraperApp.closeBrowser).toHaveBeenCalled();
      expect(scraperApp.isRunning).toBe(false);
      expect(mockEventBus.emit).toHaveBeenCalledWith('scraper.stopped', {
        stopTime: expect.any(Date),
        stats: { test: 'stats' },
      });
    });

    it('should handle stop errors gracefully', async () => {
      scraperApp.isRunning = true;
      const stopError = new Error('Stop failed');

      jest.spyOn(scraperApp, 'stopPolling').mockImplementation(() => {});
      jest.spyOn(scraperApp, 'closeBrowser').mockRejectedValue(stopError);

      await scraperApp.stop();

      expect(mockLogger.error).toHaveBeenCalledWith('Error stopping scraper application:', stopError);
    });
  });

  describe('Browser Operations', () => {
    it('should initialize browser with proper options', async () => {
      // Store and remove DISPLAY to ensure consistent test
      const originalDisplay = process.env.DISPLAY;
      delete process.env.DISPLAY;

      await scraperApp.initializeBrowser();

      expect(mockBrowserService.launch).toHaveBeenCalledWith({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          // Minimal performance optimizations to avoid bot detection
          '--disable-images',
          '--disable-plugins',
          '--mute-audio',
        ],
      });
      expect(mockBrowserService.setUserAgent).toHaveBeenCalledWith(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      );

      // Restore original DISPLAY
      if (originalDisplay !== undefined) {
        process.env.DISPLAY = originalDisplay;
      }
    });

    it('should add display arg when DISPLAY environment variable is set', async () => {
      const originalDisplay = process.env.DISPLAY;
      process.env.DISPLAY = ':0';

      await scraperApp.initializeBrowser();

      expect(mockBrowserService.launch).toHaveBeenCalledWith({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          // Minimal performance optimizations to avoid bot detection
          '--disable-images',
          '--disable-plugins',
          '--mute-audio',
          '--display=:0',
        ],
      });

      // Restore original DISPLAY
      if (originalDisplay !== undefined) {
        process.env.DISPLAY = originalDisplay;
      } else {
        delete process.env.DISPLAY;
      }
    });

    it('should close browser when running', async () => {
      mockBrowserService.isRunning.mockReturnValue(true);

      await scraperApp.closeBrowser();

      expect(mockBrowserService.close).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Browser closed');
    });

    it('should skip closing browser when not running', async () => {
      mockBrowserService.isRunning.mockReturnValue(false);

      await scraperApp.closeBrowser();

      expect(mockBrowserService.close).not.toHaveBeenCalled();
    });

    it('should handle browser close errors', async () => {
      mockBrowserService.isRunning.mockReturnValue(true);
      const closeError = new Error('Close failed');
      mockBrowserService.close.mockRejectedValue(closeError);

      await scraperApp.closeBrowser();

      expect(mockLogger.error).toHaveBeenCalledWith('Error closing browser:', closeError);
    });
  });

  describe('Polling Operations', () => {
    beforeEach(() => {
      jest.spyOn(scraperApp, 'pollXProfile').mockResolvedValue();
      jest.spyOn(scraperApp, 'scheduleNextPoll').mockImplementation(() => {});
      jest.spyOn(scraperApp, 'scheduleRetry').mockImplementation(() => {});
    });

    it('should stop existing polling before starting new', () => {
      scraperApp.timerId = setTimeout(() => {}, 1000);
      jest.spyOn(scraperApp, 'stopPolling').mockImplementation(() => {});

      scraperApp.startPolling();

      expect(scraperApp.stopPolling).toHaveBeenCalled();
    });

    it('should handle polling errors and schedule retry', async () => {
      const pollError = new Error('Poll failed');
      scraperApp.pollXProfile.mockRejectedValueOnce(pollError);
      jest.spyOn(scraperApp, 'getStats').mockReturnValue({ test: 'stats' });

      scraperApp.startPolling();

      // Wait for async operation
      await new Promise(resolve => setImmediate(resolve));

      expect(scraperApp.stats.failedRuns).toBe(1);
      expect(scraperApp.stats.lastError).toBe('Poll failed');
      expect(mockEventBus.emit).toHaveBeenCalledWith('scraper.error', {
        error: pollError,
        timestamp: expect.any(Date),
        stats: { test: 'stats' },
      });
      expect(scraperApp.scheduleRetry).toHaveBeenCalled();
    });

    it('should stop polling and clear timer', () => {
      scraperApp.timerId = setTimeout(() => {}, 1000);
      scraperApp.nextPollTimestamp = timestampUTC();

      scraperApp.stopPolling();

      expect(scraperApp.timerId).toBeNull();
      expect(scraperApp.nextPollTimestamp).toBeNull();
    });

    it('should have polling operations defined', () => {
      expect(typeof scraperApp.scheduleNextPoll).toBe('function');
      expect(typeof scraperApp.scheduleRetry).toBe('function');
      expect(typeof scraperApp.getNextInterval).toBe('function');
    });

    it('should calculate retry interval correctly', () => {
      const expectedRetryInterval = Math.min(scraperApp.maxInterval, scraperApp.minInterval * 2);
      expect(expectedRetryInterval).toBe(600000); // 600000 is the min of 600000 and 600000
    });

    it('should calculate next interval with jitter', () => {
      const originalRandom = Math.random;
      Math.random = jest.fn().mockReturnValue(0.5);

      const interval = scraperApp.getNextInterval();

      expect(interval).toBeGreaterThan(0);
      expect(interval).toBeLessThan(scraperApp.maxInterval * 1.1); // Account for jitter

      Math.random = originalRandom;
    });
  });

  describe('Authentication Methods', () => {
    it('should delegate login to auth manager', async () => {
      await scraperApp.loginToX();
      expect(mockAuthManager.login).toHaveBeenCalled();
    });

    it('should delegate click next button to auth manager', async () => {
      mockAuthManager.clickNextButton.mockResolvedValue(true);

      const result = await scraperApp.clickNextButton();

      expect(mockAuthManager.clickNextButton).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should delegate click login button to auth manager', async () => {
      mockAuthManager.clickLoginButton.mockResolvedValue(true);

      const result = await scraperApp.clickLoginButton();

      expect(mockAuthManager.clickLoginButton).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should delegate ensure authenticated to auth manager', async () => {
      await scraperApp.ensureAuthenticated();
      expect(mockAuthManager.ensureAuthenticated).toHaveBeenCalled();
    });

    it('should handle authentication errors', async () => {
      const authError = new Error('Auth failed');
      mockAuthManager.ensureAuthenticated.mockRejectedValue(authError);

      await expect(scraperApp.ensureAuthenticated()).rejects.toThrow('Auth failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Authentication failed after all retry attempts:', authError);
    });
  });

  describe('Statistics and Status', () => {
    it('should return correct running status', () => {
      scraperApp.isRunning = false;
      expect(scraperApp.isRunning).toBe(false);

      scraperApp.isRunning = true;
      expect(scraperApp.isRunning).toBe(true);
    });

    it('should return comprehensive statistics', () => {
      scraperApp.isRunning = true;
      scraperApp.nextPollTimestamp = 12345;
      scraperApp.stats.totalRuns = 10;

      const stats = scraperApp.getStats();

      expect(stats).toEqual({
        isRunning: true,
        xUser: 'testuser',
        pollingInterval: {
          min: 300000,
          max: 600000,
          next: 12345,
        },
        totalRuns: 10,
        successfulRuns: 0,
        failedRuns: 0,
        totalTweetsFound: 0,
        totalTweetsAnnounced: 0,
        lastRunTime: null,
        lastError: null,
        duplicateDetectorStats: { totalSeen: 0, totalChecked: 0 },
      });
    });
  });

  describe('URL Generation', () => {
    it('should generate search URL with date', () => {
      const url = scraperApp.generateSearchUrl(true);

      expect(url).toContain('https://x.com/search?q=(from%3Atestuser)');
      expect(url).toContain('%20since%3A');
      expect(url).toContain('&f=live&pf=on&src=typed_query');
    });

    it('should generate search URL without date', () => {
      const url = scraperApp.generateSearchUrl(false);

      expect(url).toBe('https://x.com/search?q=(from%3Atestuser)&f=live&pf=on&src=typed_query');
      expect(url).not.toContain('since%3A');
    });
  });

  describe('Cookie Validation', () => {
    it('should validate correct cookie format', () => {
      const validCookies = [
        { name: 'session', value: 'abc123', domain: 'x.com' },
        { name: 'auth_token', value: 'def456', domain: 'x.com' },
      ];

      expect(scraperApp.validateCookieFormat(validCookies)).toBe(true);
    });

    it('should reject invalid cookie formats', () => {
      expect(scraperApp.validateCookieFormat(null)).toBe(false);
      expect(scraperApp.validateCookieFormat([])).toBe(false);
      expect(scraperApp.validateCookieFormat('not-array')).toBe(false);
      expect(scraperApp.validateCookieFormat([{ name: 'test' }])).toBe(false); // Missing value
      expect(scraperApp.validateCookieFormat([{ value: 'test' }])).toBe(false); // Missing name
      expect(scraperApp.validateCookieFormat([{ name: 123, value: 'test' }])).toBe(false); // Invalid name type
    });
  });

  describe('Content Processing Configuration', () => {
    it('should check if retweet processing is enabled', () => {
      mockConfig.getBoolean.mockReturnValue(true);
      expect(scraperApp.shouldProcessRetweets()).toBe(true);
      expect(mockConfig.getBoolean).toHaveBeenCalledWith('ENABLE_RETWEET_PROCESSING', true);
    });

    it('should check if retweet processing is disabled', () => {
      mockConfig.getBoolean.mockReturnValue(false);
      expect(scraperApp.shouldProcessRetweets()).toBe(false);
    });
  });

  describe('Disposal', () => {
    it('should dispose by calling stop', async () => {
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();

      await scraperApp.dispose();

      expect(scraperApp.stop).toHaveBeenCalled();
    });
  });
});
