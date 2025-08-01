import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { YouTubeScraperService } from '../../src/services/implementations/youtube-scraper-service.js';
import { YouTubeAuthManager } from '../../src/application/youtube-auth-manager.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('YouTube Authentication Integration Tests', () => {
  let scraperService;
  let authManager;
  let mockLogger;
  let mockConfig;
  let mockBrowserService;
  let mockDependencies;
  let mockContentCoordinator;
  let mockStateManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create enhanced logging mocks
    mockDependencies = createMockDependenciesWithEnhancedLogging();
    mockLogger = mockDependencies.logger;

    // Configuration for authenticated service
    mockConfig = {
      get: jest.fn((key, defaultValue) => {
        const config = {
          YOUTUBE_SCRAPER_INTERVAL_MIN: '300000',
          YOUTUBE_SCRAPER_INTERVAL_MAX: '600000',
          YOUTUBE_SCRAPER_MAX_RETRIES: 3,
          YOUTUBE_SCRAPER_RETRY_DELAY_MS: 5000,
          YOUTUBE_SCRAPER_TIMEOUT_MS: 30000,
          YOUTUBE_AUTHENTICATION_ENABLED: 'true',
          YOUTUBE_USERNAME: 'test@example.com',
          YOUTUBE_PASSWORD: 'testpassword123',
        };
        return config[key] || defaultValue;
      }),
      getBoolean: jest.fn((key, defaultValue) => {
        const config = {
          YOUTUBE_AUTHENTICATION_ENABLED: true,
        };
        return config[key] !== undefined ? config[key] : defaultValue;
      }),
      getRequired: jest.fn(key => {
        const config = {
          YOUTUBE_USERNAME: 'test@example.com',
          YOUTUBE_PASSWORD: 'testpassword123',
        };
        return config[key];
      }),
    };

    mockStateManager = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    };

    mockContentCoordinator = {
      processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
    };

    // Comprehensive browser service mock for authentication flows
    mockBrowserService = {
      launch: jest.fn(),
      setUserAgent: jest.fn(),
      setViewport: jest.fn(),
      goto: jest.fn(),
      waitFor: jest.fn(),
      evaluate: jest.fn(),
      waitForSelector: jest.fn(),
      type: jest.fn(),
      click: jest.fn(),
      setCookies: jest.fn(),
      close: jest.fn(),
      isRunning: jest.fn(() => true),
      page: jest.fn(() => ({})),
    };

    // Create YouTube auth manager with dependencies
    authManager = new YouTubeAuthManager({
      browserService: mockBrowserService,
      config: mockConfig,
      stateManager: mockStateManager,
      logger: mockLogger,
      debugManager: mockDependencies.debugManager,
      metricsManager: mockDependencies.metricsManager,
    });

    scraperService = new YouTubeScraperService({
      logger: mockLogger,
      config: mockConfig,
      contentCoordinator: mockContentCoordinator,
      debugManager: mockDependencies.debugManager,
      metricsManager: mockDependencies.metricsManager,
      browserService: mockBrowserService,
      youtubeAuthManager: authManager,
    });
  });

  afterEach(async () => {
    if (scraperService) {
      if (scraperService.isRunning) {
        await scraperService.stopMonitoring();
      }
      await scraperService.cleanup();
    }
    jest.useRealTimers();
  });

  describe('Complete Authentication Flow Integration', () => {
    it('should successfully authenticate through complete Google/YouTube flow', async () => {
      // Mock all the helper methods on the auth manager to simulate successful authentication
      jest.spyOn(authManager, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(authManager, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(authManager, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleConsentPageRedirect').mockResolvedValue();

      // Mock browser service calls in sequence
      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();

      // Mock authentication check to return true
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(true);

      const result = await authManager.ensureAuthenticated();

      expect(result).toBe(true);

      // Verify complete flow execution
      expect(mockBrowserService.goto).toHaveBeenCalledWith(
        'https://accounts.google.com/signin/v2/identifier?service=youtube'
      );
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[type="email"]', 'test@example.com');
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[type="password"]', 'testpassword123');
      expect(mockBrowserService.click).toHaveBeenCalledWith('#identifierNext');
      expect(mockBrowserService.click).toHaveBeenCalledWith('#passwordNext');

      // Verify helper methods were called
      expect(authManager.handleCookieConsent).toHaveBeenCalled();
      expect(authManager.handleAccountChallenges).toHaveBeenCalled();
      expect(authManager.handle2FA).toHaveBeenCalled();
      expect(authManager.handleCaptcha).toHaveBeenCalled();
      expect(authManager.handleConsentPageRedirect).toHaveBeenCalled();
    });

    it('should handle authentication failure with proper error context', async () => {
      const authError = new Error('Network timeout during authentication');
      mockBrowserService.goto.mockRejectedValue(authError);

      const result = await authManager.ensureAuthenticated();

      // Verify error handling and state
      expect(result).toBe(false);

      // Check that enhanced logging captured the error
      const operationMock = mockLogger.startOperation.mock.results[0].value;
      expect(operationMock.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.stringContaining('Authentication failed'),
        expect.any(Object)
      );
    });

    it('should maintain authentication state across browser recovery', async () => {
      // Mock all the helper methods for both authentication attempts
      jest.spyOn(authManager, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(authManager, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(authManager, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleConsentPageRedirect').mockResolvedValue();

      // Initial successful authentication
      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();

      // Mock isAuthenticated to return true after authentication
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(true);

      let result = await authManager.ensureAuthenticated();
      expect(result).toBe(true);

      // Simulate browser recovery scenario - mock isAuthenticated to return false first, then true
      authManager.isAuthenticated.mockResolvedValueOnce(false).mockResolvedValue(true);

      // Mock recovery process
      mockBrowserService.isRunning.mockReturnValueOnce(false).mockReturnValue(true);
      mockBrowserService.launch.mockResolvedValue();

      // Simulate recovery completing with re-authentication
      result = await authManager.ensureAuthenticated();

      expect(result).toBe(true);
    });
  });

  describe('Authentication Challenge Integration', () => {
    it('should handle authentication challenges and still complete successfully', async () => {
      // Mock helper methods to simulate various challenges being handled
      jest.spyOn(authManager, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(authManager, 'handleAccountChallenges').mockResolvedValue(true); // Challenge handled successfully
      jest.spyOn(authManager, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleConsentPageRedirect').mockResolvedValue();

      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();

      // Mock authentication to succeed
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(true);

      const result = await authManager.ensureAuthenticated();

      expect(result).toBe(true);
      expect(authManager.handleAccountChallenges).toHaveBeenCalled();
    });

    it('should fail authentication when challenges cannot be handled', async () => {
      // Mock helper methods to simulate challenge failure
      jest.spyOn(authManager, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(authManager, 'handleAccountChallenges').mockResolvedValue(false); // Challenge failed
      jest.spyOn(authManager, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleConsentPageRedirect').mockResolvedValue();

      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();

      // Mock authentication to fail
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(false);

      const result = await authManager.ensureAuthenticated();

      expect(result).toBe(false);
      expect(authManager.handleAccountChallenges).toHaveBeenCalled();
      // Should not proceed to other steps when challenge fails
      expect(authManager.handle2FA).not.toHaveBeenCalled();
    });

    it('should fail authentication when 2FA cannot be completed', async () => {
      // Mock helper methods with 2FA failure
      jest.spyOn(authManager, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(authManager, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(authManager, 'handle2FA').mockResolvedValue(false); // 2FA failed
      jest.spyOn(authManager, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleConsentPageRedirect').mockResolvedValue();

      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();

      // Mock authentication to fail
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(false);

      const result = await authManager.ensureAuthenticated();

      expect(result).toBe(false);
      expect(authManager.handleAccountChallenges).toHaveBeenCalled();
      expect(authManager.handle2FA).toHaveBeenCalled();
      // Should not proceed to CAPTCHA when 2FA fails
      expect(authManager.handleCaptcha).not.toHaveBeenCalled();
    });

    it('should fail authentication when CAPTCHA blocks the process', async () => {
      // Mock helper methods with CAPTCHA failure
      jest.spyOn(authManager, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(authManager, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(authManager, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleCaptcha').mockResolvedValue(false); // CAPTCHA failed
      jest.spyOn(authManager, 'handleConsentPageRedirect').mockResolvedValue();

      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();

      // Mock authentication to fail
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(false);

      const result = await authManager.ensureAuthenticated();

      expect(result).toBe(false);
      expect(authManager.handleCaptcha).toHaveBeenCalled();
      // Should not proceed to consent page redirect when CAPTCHA fails
      expect(authManager.handleConsentPageRedirect).not.toHaveBeenCalled();
    });
  });

  describe('Authentication State Management Integration', () => {
    it('should properly handle authentication when disabled in config', async () => {
      // Create auth manager with authentication disabled
      const disabledConfig = {
        ...mockConfig,
        get: jest.fn((key, defaultValue) => {
          if (key === 'YOUTUBE_AUTH_ENABLED') {
            return 'false';
          }
          return mockConfig.get(key, defaultValue);
        }),
      };

      const disabledAuthManager = new YouTubeAuthManager({
        browserService: mockBrowserService,
        config: disabledConfig,
        stateManager: mockStateManager,
        logger: mockLogger,
        debugManager: mockDependencies.debugManager,
        metricsManager: mockDependencies.metricsManager,
      });

      const result = await disabledAuthManager.ensureAuthenticated();

      expect(result).toBe(true); // Returns true when disabled (no auth needed)

      // Check that operation was logged as disabled
      const operationMock = mockLogger.startOperation.mock.results[0].value;
      expect(operationMock.success).toHaveBeenCalledWith(
        'YouTube authentication is disabled',
        expect.objectContaining({ method: 'disabled' })
      );
    });

    it('should handle missing credentials gracefully', async () => {
      // Create auth manager with missing credentials
      const noCredsConfig = {
        ...mockConfig,
        getRequired: jest.fn(key => {
          if (key === 'YOUTUBE_USERNAME' || key === 'YOUTUBE_PASSWORD') {
            return '';
          }
          return mockConfig.getRequired(key);
        }),
      };

      const noCredsAuthManager = new YouTubeAuthManager({
        browserService: mockBrowserService,
        config: noCredsConfig,
        stateManager: mockStateManager,
        logger: mockLogger,
        debugManager: mockDependencies.debugManager,
        metricsManager: mockDependencies.metricsManager,
      });

      const result = await noCredsAuthManager.ensureAuthenticated();

      expect(result).toBe(false);

      // Check that operation was logged as error due to missing credentials
      const operationMock = mockLogger.startOperation.mock.results[0].value;
      expect(operationMock.error).toHaveBeenCalledWith(
        expect.any(Error),
        'YouTube authentication enabled but credentials not provided'
      );
    });

    it('should handle authentication timeout during sign-in check', async () => {
      // Mock helper methods for successful flow until sign-in check
      jest.spyOn(authManager, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(authManager, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(authManager, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleConsentPageRedirect').mockResolvedValue();

      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();

      // Mock authentication check to fail
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(false);

      const result = await authManager.ensureAuthenticated();

      expect(result).toBe(false);

      // Check that operation logged verification failure
      const operationMock = mockLogger.startOperation.mock.results[0].value;
      expect(operationMock.error).toHaveBeenCalledWith(expect.any(Error), 'Login completed but verification failed');
    });
  });

  describe('Enhanced Logging Integration for Authentication', () => {
    it('should track authentication operations with enhanced logging', async () => {
      // Mock successful authentication
      jest.spyOn(authManager, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(authManager, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(authManager, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(authManager, 'handleConsentPageRedirect').mockResolvedValue();

      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();

      // Mock authentication to succeed
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(true);

      const result = await authManager.ensureAuthenticated();

      expect(result).toBe(true);

      // Verify enhanced logging captured authentication operations
      expect(mockLogger.startOperation).toHaveBeenCalledWith(
        'ensureAuthenticated',
        expect.objectContaining({
          authEnabled: true,
          maxRetries: 3,
          username: '[CONFIGURED]',
        })
      );
    });

    it('should sanitize sensitive data in authentication error logs', async () => {
      const authError = new Error('Authentication failed with credentials testpassword123');

      mockBrowserService.goto.mockRejectedValue(authError);

      const result = await authManager.ensureAuthenticated();

      expect(result).toBe(false);

      // Verify error logging occurred with sanitized data
      const operationMock = mockLogger.startOperation.mock.results[0].value;
      expect(operationMock.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.stringContaining('Authentication failed'),
        expect.objectContaining({
          errorMessage: expect.not.stringContaining('testpassword123'),
        })
      );
    });
  });

  describe('Authentication Integration with Service Initialization', () => {
    it('should seamlessly integrate authentication with service initialization', async () => {
      // Mock successful authentication on the auth manager
      jest.spyOn(authManager, 'ensureAuthenticated').mockResolvedValue(true);

      // Mock scraper service evaluate calls for initialization content detection
      mockBrowserService.evaluate.mockResolvedValue({
        // Initial video for initialization
        id: 'test123',
        title: 'Test Video',
        url: 'https://www.youtube.com/watch?v=test123',
        publishedAt: new Date().toISOString(),
      });

      // Mock config to include required YOUTUBE_CHANNEL_ID
      const configWithChannelId = {
        ...mockConfig,
        getRequired: jest.fn(key => {
          if (key === 'YOUTUBE_CHANNEL_ID') {
            return 'UC123456789';
          }
          return mockConfig.getRequired(key);
        }),
      };

      // Create a new scraper service with the updated config for this test
      const testScraperService = new YouTubeScraperService({
        logger: mockLogger,
        config: configWithChannelId,
        contentCoordinator: mockContentCoordinator,
        debugManager: mockDependencies.debugManager,
        metricsManager: mockDependencies.metricsManager,
        browserService: mockBrowserService,
        youtubeAuthManager: authManager,
      });

      await testScraperService.initialize('testchannel');

      expect(authManager.ensureAuthenticated).toHaveBeenCalled();
      expect(testScraperService.isInitialized).toBe(true);
    });

    it('should handle authentication failure during initialization gracefully', async () => {
      // Mock authentication failure on the auth manager
      jest.spyOn(authManager, 'ensureAuthenticated').mockResolvedValue(false);

      // Mock scraper service evaluate calls for initialization
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'test123',
        title: 'Test Video',
        url: 'https://www.youtube.com/watch?v=test123',
      });

      // Mock config to include required YOUTUBE_CHANNEL_ID
      const configWithChannelId = {
        ...mockConfig,
        getRequired: jest.fn(key => {
          if (key === 'YOUTUBE_CHANNEL_ID') {
            return 'UC123456789';
          }
          return mockConfig.getRequired(key);
        }),
      };

      // Create a new scraper service with the updated config for this test
      const testScraperService = new YouTubeScraperService({
        logger: mockLogger,
        config: configWithChannelId,
        contentCoordinator: mockContentCoordinator,
        debugManager: mockDependencies.debugManager,
        metricsManager: mockDependencies.metricsManager,
        browserService: mockBrowserService,
        youtubeAuthManager: authManager,
      });

      await testScraperService.initialize('testchannel');

      expect(authManager.ensureAuthenticated).toHaveBeenCalled();
      expect(testScraperService.isInitialized).toBe(true); // Should still initialize
    });
  });
});
