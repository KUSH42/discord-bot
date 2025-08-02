import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('ScraperApplication Authentication Verification', () => {
  let scraperApp;
  let mockDependencies;
  let mockConfig;
  let mockBrowserService;
  let mockLogger;
  let mockAuthManager;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create enhanced logging mocks
    const enhancedLoggingMocks = createMockDependenciesWithEnhancedLogging();

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

    mockLogger = enhancedLoggingMocks.logger;

    mockAuthManager = {
      login: jest.fn(),
      clickNextButton: jest.fn(),
      clickLoginButton: jest.fn(),
      isAuthenticated: jest.fn(),
      ensureAuthenticated: jest.fn(),
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
      debugManager: enhancedLoggingMocks.debugManager,
      metricsManager: enhancedLoggingMocks.metricsManager,
      xAuthManager: mockAuthManager,
      duplicateDetector: {
        isDuplicate: jest.fn().mockReturnValue(false),
        markAsSeen: jest.fn(),
        getStats: jest.fn().mockReturnValue({ totalSeen: 0, totalChecked: 0 }),
      },
      persistentStorage: { get: jest.fn(), set: jest.fn() },
    };

    scraperApp = new ScraperApplication(mockDependencies);
  });

  describe('verifyAuthentication', () => {
    it('should verify authentication successfully', async () => {
      mockAuthManager.isAuthenticated.mockResolvedValue(true);

      await scraperApp.verifyAuthentication();

      expect(mockAuthManager.isAuthenticated).toHaveBeenCalled();
    });

    it('should re-authenticate when verification fails', async () => {
      mockAuthManager.isAuthenticated.mockResolvedValue(false);
      mockAuthManager.ensureAuthenticated.mockResolvedValue();

      await scraperApp.verifyAuthentication();

      expect(mockAuthManager.isAuthenticated).toHaveBeenCalled();
      expect(mockAuthManager.ensureAuthenticated).toHaveBeenCalled();
    });

    it('should handle authentication verification errors', async () => {
      const authError = new Error('Auth check failed');
      mockAuthManager.isAuthenticated.mockRejectedValue(authError);

      await expect(scraperApp.verifyAuthentication()).rejects.toThrow('Auth check failed');

      expect(mockAuthManager.isAuthenticated).toHaveBeenCalled();
    });
  });

  describe('ensureAuthenticated', () => {
    it('should delegate to xAuthManager.ensureAuthenticated', async () => {
      mockAuthManager.ensureAuthenticated.mockResolvedValue();

      await scraperApp.ensureAuthenticated();

      expect(mockAuthManager.ensureAuthenticated).toHaveBeenCalled();
    });

    it('should pass options to xAuthManager.ensureAuthenticated', async () => {
      mockAuthManager.ensureAuthenticated.mockResolvedValue();
      const options = { force: true };

      await scraperApp.ensureAuthenticated(options);

      expect(mockAuthManager.ensureAuthenticated).toHaveBeenCalledWith(options);
    });

    it('should handle authentication errors from xAuthManager', async () => {
      mockAuthManager.ensureAuthenticated.mockRejectedValue(new Error('Auth failed'));

      await expect(scraperApp.ensureAuthenticated()).rejects.toThrow('Auth failed');

      expect(mockAuthManager.ensureAuthenticated).toHaveBeenCalled();
    });
  });

  describe('Navigation Operations', () => {
    it('should navigate to profile timeline', async () => {
      mockBrowserService.waitForSelector.mockResolvedValue();
      jest.spyOn(scraperApp, 'performEnhancedScrolling').mockResolvedValue();

      await scraperApp.navigateToProfileTimeline('testuser');

      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://x.com/testuser');
      expect(mockBrowserService.waitForSelector).toHaveBeenCalledWith('[data-testid="primaryColumn"]');
      expect(scraperApp.performEnhancedScrolling).toHaveBeenCalled();
    });

    it('should perform enhanced scrolling', async () => {
      const mockDelay = jest.fn().mockResolvedValue();
      scraperApp.delay = mockDelay;

      // Mock the browser property and its evaluate method
      scraperApp.browser = {
        page: { isClosed: jest.fn().mockReturnValue(false) },
        evaluate: jest.fn().mockResolvedValue(),
      };

      await scraperApp.performEnhancedScrolling();

      // Enhanced scrolling now performs 4 iterations with 3 evaluate calls per iteration
      expect(scraperApp.browser.evaluate).toHaveBeenCalledTimes(12);
      // Delay is called multiple times per iteration (2500ms + 1000ms per iteration, plus final delay)
      expect(mockDelay).toHaveBeenCalled();
      expect(mockDelay).toHaveBeenCalledWith(2500); // Main delay between scrolls
    });
  });
});
