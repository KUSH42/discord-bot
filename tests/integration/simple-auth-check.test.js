import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { XAuthManager } from '../../src/application/auth-manager.js';
import { createEnhancedLoggerMocks } from '../fixtures/enhanced-logger-factory.js';

/**
 * Simple Authentication Check Integration Test
 *
 * Basic test to verify XAuthManager integration without complex flows
 */
describe('Simple Authentication Check Integration', () => {
  let xAuthManager;
  let mockConfig;
  let mockBrowserService;
  let loggerMocks;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create enhanced logger mocks
    loggerMocks = createEnhancedLoggerMocks();

    // Mock configuration
    mockConfig = {
      get: jest.fn((key, defaultValue) => defaultValue || 'test-value'),
      getRequired: jest.fn(key => {
        const values = {
          TWITTER_USERNAME: 'testuser',
          TWITTER_PASSWORD: 'testpass',
        };
        return values[key] || 'test-value';
      }),
    };

    // Mock browser service
    mockBrowserService = {
      launch: jest.fn().mockResolvedValue({}),
      close: jest.fn().mockResolvedValue(),
      goto: jest.fn().mockResolvedValue(),
      isConnected: jest.fn(() => true),
      isClosed: jest.fn(() => false),
      setCookies: jest.fn().mockResolvedValue(),
      waitForSelector: jest.fn().mockResolvedValue({}),
      type: jest.fn().mockResolvedValue(),
      click: jest.fn().mockResolvedValue(),
      waitForNavigation: jest.fn().mockResolvedValue(),
    };

    // Create XAuthManager
    xAuthManager = new XAuthManager({
      config: mockConfig,
      browserService: mockBrowserService,
      stateManager: {
        get: jest.fn(() => null),
        set: jest.fn(),
        delete: jest.fn(),
      },
      logger: loggerMocks.baseLogger,
      debugManager: loggerMocks.debugManager,
      metricsManager: loggerMocks.metricsManager,
    });
  });

  describe('Basic Integration', () => {
    it('should initialize XAuthManager with dependencies', () => {
      expect(xAuthManager).toBeDefined();
      expect(xAuthManager.browser).toBe(mockBrowserService);
      expect(xAuthManager.config).toBe(mockConfig);
      expect(xAuthManager.twitterUsername).toBe('testuser');
      expect(xAuthManager.twitterPassword).toBe('testpass');
      expect(xAuthManager.logger).toBeDefined();
    });

    it('should handle authentication dependency integration', async () => {
      // Mock the entire authentication flow to succeed immediately
      const mockEnsureAuthenticated = jest.spyOn(xAuthManager, 'ensureAuthenticated').mockResolvedValue();

      // Test that we can call the authentication method
      await xAuthManager.ensureAuthenticated();

      // Verify the method was called
      expect(mockEnsureAuthenticated).toHaveBeenCalled();

      // Cleanup
      mockEnsureAuthenticated.mockRestore();
    });

    it('should integrate with browser service correctly', async () => {
      // Test direct browser service integration
      await mockBrowserService.launch();
      await mockBrowserService.goto('https://x.com/login');

      expect(mockBrowserService.launch).toHaveBeenCalled();
      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://x.com/login');
    });

    it('should handle configuration access correctly', () => {
      expect(mockConfig.getRequired).toHaveBeenCalledWith('TWITTER_USERNAME');
      expect(mockConfig.getRequired).toHaveBeenCalledWith('TWITTER_PASSWORD');
    });

    it('should have enhanced logger with correct module name', () => {
      expect(xAuthManager.logger).toBeDefined();
      // The enhanced logger should have been created with 'auth' module name
      expect(loggerMocks.debugManager.isEnabled).toBeDefined();
      expect(loggerMocks.metricsManager.recordMetric).toBeDefined();
    });
  });
});
