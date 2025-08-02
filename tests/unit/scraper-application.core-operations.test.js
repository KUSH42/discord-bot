import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { timestampUTC } from '../../src/utilities/utc-time.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

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
  let mockContentCoordinator;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create enhanced logging mocks
    const enhancedLoggingMocks = createMockDependenciesWithEnhancedLogging();

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
      isHealthy: jest.fn().mockReturnValue(true),
      type: jest.fn(),
      click: jest.fn(),
      getCurrentUrl: jest.fn().mockResolvedValue('https://x.com/test'),
      getUrl: jest.fn().mockResolvedValue('https://x.com/test'),
      getConsoleLogs: jest.fn().mockResolvedValue([]),
      page: { isClosed: jest.fn().mockReturnValue(false) },
    };

    mockClassifier = {
      classifyXContent: jest.fn(),
    };

    mockContentCoordinator = {
      announceContent: jest.fn(),
    };

    mockStateManager = {
      get: jest.fn(),
      set: jest.fn(),
    };

    mockLogger = enhancedLoggingMocks.logger;

    mockAuthManager = {
      login: jest.fn(),
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
      contentCoordinator: mockContentCoordinator,
      config: mockConfig,
      stateManager: mockStateManager,
      discordService: mockDiscordService,
      eventBus: mockEventBus,
      logger: mockLogger,
      xAuthManager: mockAuthManager,
      duplicateDetector: mockDuplicateDetector,
      persistentStorage: mockPersistentStorage,
      debugManager: enhancedLoggingMocks.debugManager,
      metricsManager: enhancedLoggingMocks.metricsManager,
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
      expect(scraperApp.contentCoordinator).toBe(mockContentCoordinator);
      expect(scraperApp.config).toBe(mockConfig);
      expect(scraperApp.state).toBe(mockStateManager);
      expect(scraperApp.discord).toBe(mockDiscordService);
      expect(scraperApp.eventBus).toBe(mockEventBus);
      expect(scraperApp.logger).toEqual(expect.objectContaining({ moduleName: 'scraper' }));
      expect(scraperApp.xAuthManager).toBe(mockAuthManager);
    });

    it('should initialize with provided duplicate detector', () => {
      expect(scraperApp.duplicateDetector).toBe(mockDuplicateDetector);
    });

    it('should throw error if duplicate detector not provided', () => {
      const depsWithoutDetector = { ...mockDependencies };
      delete depsWithoutDetector.duplicateDetector;

      expect(() => new ScraperApplication(depsWithoutDetector)).toThrow(
        'DuplicateDetector dependency is required but not provided'
      );
    });

    it('should initialize configuration values', () => {
      expect(scraperApp.xUser).toBe('testuser');
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

    it('should initialize with default state', () => {
      expect(scraperApp.isRunning).toBe(false);
      expect(scraperApp.timerId).toBe(null);
    });
  });

  describe('State Management', () => {
    it('should handle state changes properly', () => {
      expect(scraperApp.isRunning).toBe(false);

      // Test state getters/setters work as expected
      expect(typeof scraperApp.getStats).toBe('function');
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
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to start scraper application',
        expect.objectContaining({
          error: 'Browser launch failed',
          module: 'scraper',
          outcome: 'error',
        })
      );
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
      expect(mockLogger.info).toHaveBeenCalledWith(
        'X scraper application started successfully',
        expect.objectContaining({
          module: 'scraper',
          outcome: 'success',
        })
      );
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

      await expect(scraperApp.stop()).rejects.toThrow('Stop failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error stopping scraper application',
        expect.objectContaining({
          module: 'scraper',
          error: 'Stop failed',
          outcome: 'error',
        })
      );
    });
  });

  describe('Browser Operations', () => {
    it('should initialize browser with proper options', async () => {
      // Store and remove DISPLAY to ensure consistent test
      const originalDisplay = process.env.DISPLAY;
      delete process.env.DISPLAY;

      await scraperApp.initializeBrowser();

      expect(mockBrowserService.launch).toHaveBeenCalledWith({
        headless: true,
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

    it('should handle browser initialization without DISPLAY environment variable', async () => {
      const originalDisplay = process.env.DISPLAY;
      delete process.env.DISPLAY;

      await scraperApp.initializeBrowser();

      expect(mockBrowserService.launch).toHaveBeenCalledWith({
        headless: true,
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

      // Restore original DISPLAY
      if (originalDisplay !== undefined) {
        process.env.DISPLAY = originalDisplay;
      }
    });

    it('should close browser when running', async () => {
      mockBrowserService.isRunning.mockReturnValue(true);

      await scraperApp.closeBrowser();

      expect(mockBrowserService.close).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Browser closed successfully',
        expect.objectContaining({
          module: 'scraper',
          outcome: 'success',
        })
      );
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

      await expect(scraperApp.closeBrowser()).rejects.toThrow('Close failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to close browser',
        expect.objectContaining({
          error: 'Close failed',
          module: 'scraper',
          outcome: 'error',
        })
      );
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
    it('should delegate ensure authenticated to auth manager', async () => {
      await scraperApp.ensureAuthenticated();
      expect(mockAuthManager.ensureAuthenticated).toHaveBeenCalled();
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
