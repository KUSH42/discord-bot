import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { XAuthManager } from '../../src/application/auth-manager.js';
import { ContentCoordinator } from '../../src/core/content-coordinator.js';
import { PlaywrightBrowserService } from '../../src/services/implementations/playwright-browser-service.js';
import { createEnhancedLoggerMocks } from '../fixtures/enhanced-logger-factory.js';
import { createScraperApplicationMocks } from '../fixtures/application-mocks.js';

/**
 * End-to-End Browser Automation Flow Tests
 *
 * Tests complete X scraping workflow with realistic browser interactions:
 * - XAuthManager login flow with browser automation
 * - Page navigation and element detection
 * - Content extraction and classification
 * - Browser error recovery scenarios
 * - Session persistence across operations
 */
describe('Browser Automation Flow E2E', () => {
  let scraperApp;
  let xAuthManager;
  let contentCoordinator;
  let browserService;
  let loggerMocks;
  let mockConfig;
  let mockStateManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create enhanced logger mocks
    loggerMocks = createEnhancedLoggerMocks();

    // Create comprehensive application mocks
    const mocks = createScraperApplicationMocks();
    mockConfig = mocks.config;
    mockStateManager = mocks.stateManager;
    contentCoordinator = mocks.contentCoordinator;

    // Enhanced browser service mock with realistic behaviors
    browserService = {
      browser: null,
      page: null,
      isConnected: jest.fn(() => true),
      isClosed: jest.fn(() => false),

      // Browser lifecycle
      launch: jest.fn(async () => {
        browserService.browser = {
          isConnected: () => true,
          close: jest.fn(),
          pages: jest.fn(() => []),
          newPage: jest.fn(async () => {
            browserService.page = {
              goto: jest.fn(),
              waitForSelector: jest.fn(),
              evaluate: jest.fn(),
              click: jest.fn(),
              type: jest.fn(),
              screenshot: jest.fn(),
              close: jest.fn(),
              url: () => 'https://x.com/search',
              isClosed: () => false,
            };
            return browserService.page;
          }),
        };
        return browserService.browser;
      }),

      close: jest.fn(async () => {
        if (browserService.browser) {
          await browserService.browser.close();
          browserService.browser = null;
          browserService.page = null;
        }
      }),

      // Page operations
      goto: jest.fn(async url => {
        if (!browserService.page) {
          throw new Error('No page available - browser not launched');
        }
        return browserService.page.goto(url);
      }),

      waitForSelector: jest.fn(async (selector, options = {}) => {
        if (!browserService.page) {
          throw new Error('No page available - browser not launched');
        }
        return browserService.page.waitForSelector(selector, options);
      }),

      evaluate: jest.fn(async fn => {
        if (!browserService.page) {
          throw new Error('No page available - browser not launched');
        }
        // Simulate realistic responses based on context
        if (fn.toString().includes('tweet')) {
          return [
            {
              id: 'tweet123',
              text: 'Test tweet content',
              author: 'testuser',
              timestamp: '2024-01-01T12:00:00Z',
              url: 'https://x.com/testuser/status/tweet123',
              type: 'post',
            },
          ];
        }
        return [];
      }),

      click: jest.fn(async selector => {
        if (!browserService.page) {
          throw new Error('No page available - browser not launched');
        }
        return browserService.page.click(selector);
      }),

      type: jest.fn(async (selector, text) => {
        if (!browserService.page) {
          throw new Error('No page available - browser not launched');
        }
        return browserService.page.type(selector, text);
      }),

      // Error simulation helpers
      simulateBrowserCrash: () => {
        browserService.browser = null;
        browserService.page = null;
        browserService.isConnected = jest.fn(() => false);
        browserService.isClosed = jest.fn(() => true);
      },

      simulateNetworkError: () => {
        browserService.goto = jest.fn().mockRejectedValue(new Error('Network timeout'));
        browserService.waitForSelector = jest.fn().mockRejectedValue(new Error('Navigation timeout'));
      },

      restoreNormalOperation: () => {
        browserService.isConnected = jest.fn(() => true);
        browserService.isClosed = jest.fn(() => false);
        browserService.goto = jest.fn().mockResolvedValue({});
        browserService.waitForSelector = jest.fn().mockResolvedValue({});
      },
    };

    // Create XAuthManager with proper dependencies object
    xAuthManager = new XAuthManager({
      config: mockConfig,
      browserService,
      stateManager: mockStateManager,
      logger: loggerMocks.baseLogger,
      debugManager: loggerMocks.debugManager,
      metricsManager: loggerMocks.metricsManager,
    });

    // Create ScraperApplication with proper dependencies object
    scraperApp = new ScraperApplication({
      config: mockConfig,
      stateManager: mockStateManager,
      contentCoordinator,
      xAuthManager,
      browserService,
      logger: loggerMocks.baseLogger,
      debugManager: loggerMocks.debugManager,
      metricsManager: loggerMocks.metricsManager,
    });

    // Mock configuration values for X scraping
    mockConfig.get.mockImplementation((key, defaultValue) => {
      const values = {
        X_USER_HANDLE: 'testuser',
        X_LOGIN_EMAIL: 'test@example.com',
        X_LOGIN_PASSWORD: 'testpassword',
        X_VERIFICATION_EMAIL: 'verification@example.com',
        TWITTER_USERNAME: 'testuser',
        TWITTER_PASSWORD: 'testpassword',
        SCRAPER_POLL_INTERVAL_MINUTES: 2,
        BROWSER_STEALTH_ENABLED: 'true',
        SCRAPER_MAX_TWEETS_PER_RUN: 10,
      };
      return values[key] || defaultValue;
    });

    mockConfig.getRequired = jest.fn(key => {
      const values = {
        TWITTER_USERNAME: 'testuser',
        TWITTER_PASSWORD: 'testpassword',
        X_USER_HANDLE: 'testuser',
        X_LOGIN_EMAIL: 'test@example.com',
        X_LOGIN_PASSWORD: 'testpassword',
      };
      const value = values[key];
      if (!value) {
        throw new Error(`Required configuration key missing: ${key}`);
      }
      return value;
    });

    // Mock state manager for scraping state
    mockStateManager.get.mockImplementation((key, defaultValue) => {
      const values = {
        postingEnabled: true,
        scrapingEnabled: true,
        authenticationStatus: 'authenticated',
      };
      return values[key] || defaultValue;
    });
  });

  afterEach(async () => {
    jest.useRealTimers();
    if (browserService && browserService.close) {
      await browserService.close();
    }
  });

  describe('Complete Authentication Flow E2E', () => {
    it('should perform complete login workflow with browser automation', async () => {
      // Setup: Configure authentication flow
      browserService.evaluate
        .mockResolvedValueOnce(false) // Not logged in initially
        .mockResolvedValueOnce(true); // Successfully logged in after process

      // Execute: Complete authentication flow
      const result = await xAuthManager.ensureAuthenticated();

      // Verify: Authentication workflow steps
      expect(browserService.launch).toHaveBeenCalled();
      expect(browserService.goto).toHaveBeenCalledWith('https://x.com/login');
      expect(browserService.waitForSelector).toHaveBeenCalledWith('input[name="text"]', expect.any(Object));
      expect(browserService.type).toHaveBeenCalledWith('input[name="text"]', 'test@example.com');
      expect(browserService.click).toHaveBeenCalledWith('[role="button"]:has-text("Next")');

      expect(result).toBe(true);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('auth_success', 1, 'auth');
    }, 15000);

    it('should handle email verification during login', async () => {
      // Setup: Simulate email verification requirement
      browserService.waitForSelector
        .mockResolvedValueOnce({}) // Email input found
        .mockResolvedValueOnce({}) // Next button found
        .mockRejectedValueOnce(new Error('Timeout')) // Password input not found - verification needed
        .mockResolvedValueOnce({}) // Verification input found
        .mockResolvedValueOnce({}); // Password input found after verification

      browserService.evaluate
        .mockResolvedValueOnce(false) // Not logged in initially
        .mockResolvedValueOnce(true); // Successfully logged in after verification

      mockConfig.get.mockImplementation((key, defaultValue) => {
        const values = {
          X_LOGIN_EMAIL: 'test@example.com',
          X_LOGIN_PASSWORD: 'testpassword',
          X_VERIFICATION_EMAIL: 'verification@example.com',
        };
        return values[key] || defaultValue;
      });

      // Execute: Authentication with verification
      const result = await xAuthManager.ensureAuthenticated();

      // Verify: Email verification workflow
      expect(browserService.type).toHaveBeenCalledWith('input[name="text"]', 'verification@example.com');
      expect(result).toBe(true);

      // Verify metrics for verification flow
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('email_verification_required', 1, 'auth');
    }, 15000);

    it('should handle authentication failures gracefully', async () => {
      // Setup: Simulate authentication failure
      browserService.evaluate.mockResolvedValue(false); // Always not logged in
      browserService.waitForSelector.mockRejectedValue(new Error('Element not found'));

      // Execute: Authentication attempt
      const result = await xAuthManager.ensureAuthenticated();

      // Verify: Graceful failure handling
      expect(result).toBe(false);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('auth_failure', 1, 'auth');

      // Verify error logging
      const operation = loggerMocks.enhancedLogger.startOperation.mock.results[0].value;
      expect(operation.error).toHaveBeenCalledWith(expect.any(Error), expect.stringContaining('Authentication failed'));
    }, 15000);
  });

  describe('Content Scraping Flow E2E', () => {
    beforeEach(() => {
      // Mock successful authentication
      jest.spyOn(xAuthManager, 'ensureAuthenticated').mockResolvedValue(true);
    });

    it('should perform complete scraping workflow with content detection', async () => {
      // Setup: Mock tweet content discovery
      const mockTweets = [
        {
          id: 'tweet123',
          text: 'New blog post about JavaScript testing',
          author: 'testuser',
          timestamp: '2024-01-01T12:00:00Z',
          url: 'https://x.com/testuser/status/tweet123',
          type: 'post',
        },
        {
          id: 'tweet124',
          text: 'Retweeting this great article',
          author: 'testuser',
          timestamp: '2024-01-01T12:05:00Z',
          url: 'https://x.com/testuser/status/tweet124',
          type: 'retweet',
        },
      ];

      browserService.evaluate.mockResolvedValue(mockTweets);

      // Execute: Complete scraping run
      await scraperApp.runScrapingCycle();

      // Verify: Scraping workflow steps
      expect(xAuthManager.ensureAuthenticated).toHaveBeenCalled();
      expect(browserService.goto).toHaveBeenCalledWith(expect.stringContaining('x.com/search'));
      expect(browserService.evaluate).toHaveBeenCalled();

      // Verify: Content processing
      expect(contentCoordinator.processContent).toHaveBeenCalledTimes(2);
      expect(contentCoordinator.processContent).toHaveBeenCalledWith(
        'tweet123',
        'scraper',
        expect.objectContaining({
          text: 'New blog post about JavaScript testing',
          type: 'post',
        })
      );
      expect(contentCoordinator.processContent).toHaveBeenCalledWith(
        'tweet124',
        'scraper',
        expect.objectContaining({
          text: 'Retweeting this great article',
          type: 'retweet',
        })
      );

      // Verify: Metrics collection
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('tweets_scraped', 2, 'scraper');
    }, 15000);

    it('should handle browser crashes during scraping with recovery', async () => {
      // Setup: Simulate browser crash mid-scraping
      browserService.evaluate
        .mockResolvedValueOnce([]) // First call succeeds
        .mockImplementationOnce(async () => {
          browserService.simulateBrowserCrash();
          throw new Error('Browser connection lost');
        });

      // Execute: Scraping with browser crash
      await scraperApp.runScrapingCycle();

      // Verify: Browser crash detection and recovery attempt
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('browser_crash', 1, 'scraper');

      // Verify: Error logged appropriately
      const operation = loggerMocks.enhancedLogger.startOperation.mock.results[0].value;
      expect(operation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Browser connection lost' }),
        expect.stringContaining('Browser error during scraping')
      );
    }, 15000);

    it('should handle network errors with retry logic', async () => {
      // Setup: Simulate network failures then success
      browserService.simulateNetworkError();

      let callCount = 0;
      browserService.goto.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('Network timeout');
        }
        browserService.restoreNormalOperation();
        return {};
      });

      // Execute: Scraping with network issues
      await scraperApp.runScrapingCycle();

      // Verify: Retry attempts made
      expect(browserService.goto).toHaveBeenCalledTimes(3);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('network_retry', 2, 'scraper');
    }, 15000);
  });

  describe('Browser Resource Management E2E', () => {
    it('should properly manage browser lifecycle across multiple operations', async () => {
      // Execute: Multiple scraping cycles
      await scraperApp.runScrapingCycle();
      await scraperApp.runScrapingCycle();
      await scraperApp.runScrapingCycle();

      // Verify: Browser reused across cycles (not relaunched each time)
      expect(browserService.launch).toHaveBeenCalledTimes(1);
      expect(browserService.goto).toHaveBeenCalledTimes(3);

      // Execute: Cleanup
      await scraperApp.cleanup();

      // Verify: Browser properly closed
      expect(browserService.close).toHaveBeenCalled();
    }, 15000);

    it('should handle browser memory leaks with periodic restarts', async () => {
      // Setup: Mock memory monitoring
      let memoryUsage = 100;
      browserService.evaluate.mockImplementation(async () => {
        memoryUsage += 50; // Simulate memory growth
        if (memoryUsage > 300) {
          throw new Error('Out of memory');
        }
        return [];
      });

      // Execute: Multiple cycles until memory threshold
      try {
        for (let i = 0; i < 10; i++) {
          await scraperApp.runScrapingCycle();
        }
      } catch (error) {
        // Expected memory error
      }

      // Verify: Memory leak detection and browser restart
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('memory_threshold_exceeded', 1, 'scraper');
    }, 15000);
  });

  describe('Integration with ContentCoordinator E2E', () => {
    it('should properly integrate scraped content with ContentCoordinator processing', async () => {
      // Setup: Mock successful authentication and content discovery
      jest.spyOn(xAuthManager, 'ensureAuthenticated').mockResolvedValue(true);

      const mockContent = {
        id: 'tweet123',
        text: 'Integration test content',
        author: 'testuser',
        timestamp: '2024-01-01T12:00:00Z',
        url: 'https://x.com/testuser/status/tweet123',
        type: 'post',
      };

      browserService.evaluate.mockResolvedValue([mockContent]);

      // Mock ContentCoordinator processing
      contentCoordinator.processContent.mockResolvedValue({
        success: true,
        action: 'announced',
        message: 'Content successfully announced',
      });

      // Execute: Complete integration flow
      await scraperApp.runScrapingCycle();

      // Verify: Proper integration between scraper and coordinator
      expect(contentCoordinator.processContent).toHaveBeenCalledWith(
        'tweet123',
        'scraper',
        expect.objectContaining({
          text: 'Integration test content',
          source: 'x-scraper',
        })
      );

      // Verify: Success metrics recorded
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('content_processing_success', 1, 'scraper');
    }, 15000);

    it('should handle ContentCoordinator processing failures gracefully', async () => {
      // Setup: Mock scraping success but coordinator failure
      jest.spyOn(xAuthManager, 'ensureAuthenticated').mockResolvedValue(true);
      browserService.evaluate.mockResolvedValue([
        {
          id: 'tweet123',
          text: 'Test content',
          author: 'testuser',
          timestamp: '2024-01-01T12:00:00Z',
          url: 'https://x.com/testuser/status/tweet123',
          type: 'post',
        },
      ]);

      contentCoordinator.processContent.mockRejectedValue(new Error('Processing failed'));

      // Execute: Scraping with coordinator failure
      await scraperApp.runScrapingCycle();

      // Verify: Error handling and metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('content_processing_failure', 1, 'scraper');

      // Verify: Scraping continues despite processing failures
      const operation = loggerMocks.enhancedLogger.startOperation.mock.results[0].value;
      expect(operation.progress).toHaveBeenCalledWith(
        expect.stringContaining('Content processing failed, continuing with next item')
      );
    }, 15000);
  });
});
