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

      expect(mockBrowserService.evaluate).toHaveBeenCalledTimes(5);
      expect(mockBrowserService.evaluate).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should call evaluate with scroll function for each iteration', async () => {
      scraperApp.browser = mockBrowserService;
      mockBrowserService.evaluate.mockResolvedValue();

      await scraperApp.performEnhancedScrolling();

      // Verify the correct number of evaluate calls
      expect(mockBrowserService.evaluate).toHaveBeenCalledTimes(5);

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
});
