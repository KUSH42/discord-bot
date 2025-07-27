import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('ScraperApplication Email Verification', () => {
  let scraperApp;
  let mockDependencies;
  let mockConfig;
  let mockBrowserService;
  let mockLogger;

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
        TWITTER_EMAIL: 'test@example.com',
      };
      return defaults[key] || defaultValue;
    });

    const mockDelay = jest.fn().mockResolvedValue();

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
      authManager: {
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
      delay: mockDelay,
    };

    scraperApp = new ScraperApplication(mockDependencies);
  });

  describe('handleEmailVerification', () => {
    it('should handle email verification with TWITTER_EMAIL', async () => {
      mockConfig.get.mockImplementation((key, defaultValue) => {
        if (key === 'TWITTER_EMAIL') {
          return 'test@example.com';
        }
        if (key === 'TWITTER_USERNAME') {
          return 'testuser';
        }
        return defaultValue;
      });

      mockBrowserService.waitForSelector
        .mockResolvedValueOnce() // Email input found
        .mockResolvedValueOnce(); // Continue button found

      await scraperApp.handleEmailVerification();

      expect(mockBrowserService.waitForSelector).toHaveBeenCalledWith('input[data-testid="ocfEnterTextTextInput"]', {
        timeout: 5000,
      });
      expect(mockBrowserService.type).toHaveBeenCalledWith(
        'input[data-testid="ocfEnterTextTextInput"]',
        'test@example.com'
      );
      expect(mockBrowserService.click).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Entered email: test@example.com',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should handle email verification with TWITTER_USERNAME fallback', async () => {
      mockConfig.get.mockImplementation((key, defaultValue) => {
        if (key === 'TWITTER_EMAIL') {
          return null;
        }
        if (key === 'TWITTER_USERNAME') {
          return 'user@domain.com';
        }
        return defaultValue;
      });

      mockBrowserService.waitForSelector
        .mockResolvedValueOnce() // Email input found
        .mockResolvedValueOnce(); // Continue button found

      await scraperApp.handleEmailVerification();

      expect(mockBrowserService.type).toHaveBeenCalledWith(
        'input[data-testid="ocfEnterTextTextInput"]',
        'user@domain.com'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Entered email: user@domain.com',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should throw error when no valid email is configured', async () => {
      mockConfig.get.mockImplementation((key, defaultValue) => {
        if (key === 'TWITTER_EMAIL') {
          return null;
        }
        if (key === 'TWITTER_USERNAME') {
          return 'notanemail';
        }
        return defaultValue;
      });

      await expect(scraperApp.handleEmailVerification()).rejects.toThrow(
        'Email verification required but no email configured'
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No valid email found in configuration for email verification',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should handle email input not found', async () => {
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector not found'));

      await scraperApp.handleEmailVerification();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Could not find email input field, proceeding anyway',
        expect.objectContaining({
          module: 'scraper',
        })
      );
      expect(mockBrowserService.type).not.toHaveBeenCalled();
    });

    it('should try multiple email input selectors', async () => {
      mockBrowserService.waitForSelector
        .mockRejectedValueOnce(new Error('First selector failed'))
        .mockRejectedValueOnce(new Error('Second selector failed'))
        .mockResolvedValueOnce() // Third selector works
        .mockResolvedValueOnce(); // Continue button found

      await scraperApp.handleEmailVerification();

      expect(mockBrowserService.waitForSelector).toHaveBeenCalledTimes(4); // 3 for email input + 1 for continue button
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[name="email"]', 'test@example.com');
    });

    it('should handle continue button not found', async () => {
      mockBrowserService.waitForSelector
        .mockResolvedValueOnce() // Email input found
        .mockRejectedValue(new Error('Continue button not found')); // All continue button selectors fail

      await scraperApp.handleEmailVerification();

      expect(mockBrowserService.type).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Could not find continue button after email entry',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should try multiple continue button selectors', async () => {
      mockBrowserService.waitForSelector
        .mockResolvedValueOnce() // Email input found
        .mockRejectedValueOnce(new Error('First continue selector failed'))
        .mockRejectedValueOnce(new Error('Second continue selector failed'))
        .mockResolvedValueOnce(); // Third continue selector works

      await scraperApp.handleEmailVerification();

      expect(mockBrowserService.click).toHaveBeenCalledWith('div[role="button"]:has-text("Continue")');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Clicked continue button using selector: div[role="button"]:has-text("Continue")',
        expect.objectContaining({
          module: 'scraper',
        })
      );
    });

    it('should handle email verification errors', async () => {
      const _verificationError = new Error('Verification failed');

      // Mock a non-email configuration to trigger early error
      mockConfig.get.mockImplementation((key, defaultValue) => {
        if (key === 'TWITTER_EMAIL') {
          return null;
        }
        if (key === 'TWITTER_USERNAME') {
          return 'notanemail';
        } // Not an email
        return defaultValue;
      });

      await expect(scraperApp.handleEmailVerification()).rejects.toThrow(
        'Email verification required but no email configured'
      );
    });

    it('should wait for next screen after successful verification', async () => {
      mockBrowserService.waitForSelector
        .mockResolvedValueOnce() // Email input found
        .mockResolvedValueOnce(); // Continue button found

      const mockDelay = mockDependencies.delay;

      await scraperApp.handleEmailVerification();

      expect(mockDelay).toHaveBeenCalledWith(3000);
    });
  });
});
