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
      authManager: mockAuthManager,
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

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Verifying X authentication status...',
        expect.objectContaining({
          module: 'scraper',
        })
      );
      expect(mockAuthManager.isAuthenticated).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '✅ Authentication verified successfully',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should re-authenticate when verification fails', async () => {
      mockAuthManager.isAuthenticated.mockResolvedValue(false);
      jest.spyOn(scraperApp, 'ensureAuthenticated').mockResolvedValue();

      await scraperApp.verifyAuthentication();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Authentication check failed, re-authenticating...',
        expect.objectContaining({
          module: 'scraper',
        })
      );
      expect(scraperApp.ensureAuthenticated).toHaveBeenCalled();
    });

    it('should handle authentication verification errors', async () => {
      const authError = new Error('Auth check failed');
      mockAuthManager.isAuthenticated.mockRejectedValue(authError);
      jest.spyOn(scraperApp, 'ensureAuthenticated').mockResolvedValue();

      await scraperApp.verifyAuthentication();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Authentication verification failed:',
        expect.objectContaining({
          module: 'scraper',
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Attempting to re-authenticate after verification failure...',
        expect.objectContaining({
          module: 'scraper',
        })
      );
      expect(scraperApp.ensureAuthenticated).toHaveBeenCalled();
    });
  });

  describe('refreshAuth', () => {
    it('should refresh authentication successfully when logged in', async () => {
      mockBrowserService.evaluate.mockResolvedValue(true); // Not logged in check returns false (meaning logged in)

      await scraperApp.refreshAuth();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Refreshing X authentication...',
        expect.objectContaining({
          module: 'scraper',
        })
      );
      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://x.com/home');
      expect(mockBrowserService.evaluate).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Authentication refreshed successfully',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should re-login when authentication has expired', async () => {
      mockBrowserService.evaluate.mockResolvedValue(false); // Login selector found (meaning not logged in)
      jest.spyOn(scraperApp, 'loginToX').mockResolvedValue();

      await scraperApp.refreshAuth();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Authentication expired, re-logging in...',
        expect.objectContaining({
          module: 'scraper',
        })
      );
      expect(scraperApp.loginToX).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Authentication refreshed successfully',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should handle refresh authentication errors', async () => {
      const refreshError = new Error('Refresh failed');
      mockBrowserService.goto.mockRejectedValue(refreshError);

      await expect(scraperApp.refreshAuth()).rejects.toThrow('Refresh failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to refresh authentication:',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should evaluate login status correctly', async () => {
      // First call refreshAuth to trigger the evaluate call
      await scraperApp.refreshAuth();

      const evaluateFunction = mockBrowserService.evaluate.mock.calls[0]?.[0];

      // Ensure evaluate function was called
      expect(evaluateFunction).toBeDefined();

      // Test the evaluation function logic
      const mockDocument = {
        querySelector: jest.fn(),
      };

      // Mock logged in scenario (no login button found)
      mockDocument.querySelector.mockReturnValue(null);

      // We need to simulate the browser evaluation context
      const result = evaluateFunction.toString().includes('!document.querySelector(\'[data-testid="login"]\')');
      expect(result).toBe(true);
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

      await scraperApp.performEnhancedScrolling();

      expect(mockBrowserService.evaluate).toHaveBeenCalledTimes(5);
      expect(mockDelay).toHaveBeenCalledTimes(5);
      expect(mockDelay).toHaveBeenCalledWith(1500);
    });
  });
});
