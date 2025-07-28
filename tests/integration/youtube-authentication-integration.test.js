import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { YouTubeScraperService } from '../../src/services/implementations/youtube-scraper-service.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('YouTube Authentication Integration Tests', () => {
  let scraperService;
  let mockLogger;
  let mockConfig;
  let mockBrowserService;
  let mockDependencies;
  let mockContentCoordinator;

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
    };

    mockContentCoordinator = {
      processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
    };

    scraperService = new YouTubeScraperService({
      logger: mockLogger,
      config: mockConfig,
      contentCoordinator: mockContentCoordinator,
      debugManager: mockDependencies.debugManager,
      metricsManager: mockDependencies.metricsManager,
    });

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
    };
    scraperService.browserService = mockBrowserService;
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
      // Mock all the helper methods to simulate successful authentication
      jest.spyOn(scraperService, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(scraperService, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleDeviceVerification').mockResolvedValue();

      // Mock browser service calls in sequence
      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();

      // Mock signed-in indicator detection
      mockBrowserService.evaluate.mockResolvedValue(true); // Successfully signed in

      await scraperService.authenticateWithYouTube();

      // Verify complete flow execution
      expect(mockBrowserService.goto).toHaveBeenCalledWith(
        'https://accounts.google.com/signin/v2/identifier?service=youtube'
      );
      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://www.youtube.com');
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[type="email"]', 'test@example.com');
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[type="password"]', 'testpassword123');
      expect(mockBrowserService.click).toHaveBeenCalledWith('#identifierNext');
      expect(mockBrowserService.click).toHaveBeenCalledWith('#passwordNext');

      // Verify helper methods were called
      expect(scraperService.handleCookieConsent).toHaveBeenCalled();
      expect(scraperService.handleAccountChallenges).toHaveBeenCalled();
      expect(scraperService.handle2FA).toHaveBeenCalled();
      expect(scraperService.handleCaptcha).toHaveBeenCalled();
      expect(scraperService.handleDeviceVerification).toHaveBeenCalled();

      // Verify authentication state is set
      expect(scraperService.isAuthenticated).toBe(true);

      // Verify enhanced logging integration
      expect(mockLogger.info).toHaveBeenCalledWith('Starting YouTube authentication...', expect.any(Object));
      expect(mockLogger.info).toHaveBeenCalledWith('✅ Successfully authenticated with YouTube', expect.any(Object));
    });

    it('should handle authentication failure with proper error context', async () => {
      const authError = new Error('Network timeout during authentication');
      mockBrowserService.goto.mockRejectedValue(authError);

      await scraperService.authenticateWithYouTube();

      // Verify error handling and state
      expect(scraperService.isAuthenticated).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        '⚠️Failed to authenticate with YouTube:',
        expect.objectContaining({
          error: 'Network timeout during authentication',
          stack: expect.any(String),
        })
      );
    });

    it('should maintain authentication state across browser recovery', async () => {
      // Mock all the helper methods for both authentication attempts
      jest.spyOn(scraperService, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(scraperService, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleDeviceVerification').mockResolvedValue();

      // Initial successful authentication
      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();
      mockBrowserService.evaluate.mockResolvedValue(true); // Signed in

      await scraperService.authenticateWithYouTube();
      expect(scraperService.isAuthenticated).toBe(true);

      // Simulate browser recovery scenario
      const recoveryOperation = scraperService.logger.startOperation('browserRecovery', {});

      // Mock recovery process
      mockBrowserService.isRunning.mockReturnValueOnce(false).mockReturnValue(true);
      mockBrowserService.launch.mockResolvedValue();

      // Reset authentication state to simulate recovery
      scraperService.isAuthenticated = false;

      // Simulate recovery completing with re-authentication
      await scraperService.authenticateWithYouTube();

      recoveryOperation.success('Browser recovery completed with re-authentication');

      expect(scraperService.isAuthenticated).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('✅ Successfully authenticated with YouTube', expect.any(Object));
    });
  });

  describe('Authentication Challenge Integration', () => {
    it('should handle authentication challenges and still complete successfully', async () => {
      // Mock helper methods to simulate various challenges being handled
      jest.spyOn(scraperService, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(scraperService, 'handleAccountChallenges').mockResolvedValue(true); // Challenge handled successfully
      jest.spyOn(scraperService, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleDeviceVerification').mockResolvedValue();

      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();
      mockBrowserService.evaluate.mockResolvedValue(true);

      await scraperService.authenticateWithYouTube();

      expect(scraperService.isAuthenticated).toBe(true);
      expect(scraperService.handleAccountChallenges).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('✅ Successfully authenticated with YouTube', expect.any(Object));
    });

    it('should fail authentication when challenges cannot be handled', async () => {
      // Mock helper methods to simulate challenge failure
      jest.spyOn(scraperService, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(scraperService, 'handleAccountChallenges').mockResolvedValue(false); // Challenge failed
      jest.spyOn(scraperService, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleDeviceVerification').mockResolvedValue();

      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();

      await scraperService.authenticateWithYouTube();

      expect(scraperService.isAuthenticated).toBe(false);
      expect(scraperService.handleAccountChallenges).toHaveBeenCalled();
      // Should not proceed to other steps when challenge fails
      expect(scraperService.handle2FA).not.toHaveBeenCalled();
    });

    it('should fail authentication when 2FA cannot be completed', async () => {
      // Mock helper methods with 2FA failure
      jest.spyOn(scraperService, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(scraperService, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handle2FA').mockResolvedValue(false); // 2FA failed
      jest.spyOn(scraperService, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleDeviceVerification').mockResolvedValue();

      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();

      await scraperService.authenticateWithYouTube();

      expect(scraperService.isAuthenticated).toBe(false);
      expect(scraperService.handleAccountChallenges).toHaveBeenCalled();
      expect(scraperService.handle2FA).toHaveBeenCalled();
      // Should not proceed to CAPTCHA when 2FA fails
      expect(scraperService.handleCaptcha).not.toHaveBeenCalled();
    });

    it('should fail authentication when CAPTCHA blocks the process', async () => {
      // Mock helper methods with CAPTCHA failure
      jest.spyOn(scraperService, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(scraperService, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleCaptcha').mockResolvedValue(false); // CAPTCHA failed
      jest.spyOn(scraperService, 'handleDeviceVerification').mockResolvedValue();

      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();

      await scraperService.authenticateWithYouTube();

      expect(scraperService.isAuthenticated).toBe(false);
      expect(scraperService.handleCaptcha).toHaveBeenCalled();
      // Should not proceed to device verification when CAPTCHA fails
      expect(scraperService.handleDeviceVerification).not.toHaveBeenCalled();
    });
  });

  describe('Authentication State Management Integration', () => {
    it('should properly handle authentication when disabled in config', async () => {
      // Create service with authentication disabled
      const disabledConfig = {
        ...mockConfig,
        getBoolean: jest.fn(() => false), // Authentication disabled
      };

      const disabledService = new YouTubeScraperService({
        logger: mockLogger,
        config: disabledConfig,
        contentCoordinator: mockContentCoordinator,
        debugManager: mockDependencies.debugManager,
        metricsManager: mockDependencies.metricsManager,
      });

      await disabledService.authenticateWithYouTube();

      expect(disabledService.isAuthenticated).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith('YouTube authentication is disabled', expect.any(Object));
    });

    it('should handle missing credentials gracefully', async () => {
      // Create service with missing credentials
      const noCredsConfig = {
        ...mockConfig,
        get: jest.fn((key, defaultValue) => {
          if (key === 'YOUTUBE_USERNAME' || key === 'YOUTUBE_PASSWORD') {
            return '';
          }
          return mockConfig.get(key, defaultValue);
        }),
      };

      const noCredsService = new YouTubeScraperService({
        logger: mockLogger,
        config: noCredsConfig,
        contentCoordinator: mockContentCoordinator,
        debugManager: mockDependencies.debugManager,
        metricsManager: mockDependencies.metricsManager,
      });

      await noCredsService.authenticateWithYouTube();

      expect(noCredsService.isAuthenticated).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'YouTube authentication enabled but credentials not provided',
        expect.any(Object)
      );
    });

    it('should handle authentication timeout during sign-in check', async () => {
      // Mock helper methods for successful flow until sign-in check
      jest.spyOn(scraperService, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(scraperService, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleDeviceVerification').mockResolvedValue();

      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();

      // Mock signed-in check failure
      mockBrowserService.evaluate.mockResolvedValue(false); // Not signed in

      await scraperService.authenticateWithYouTube();

      expect(scraperService.isAuthenticated).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '⚠️ YouTube authentication may have failed - proceeding without authentication',
        expect.any(Object)
      );
    });
  });

  describe('Enhanced Logging Integration for Authentication', () => {
    it('should track authentication operations with enhanced logging', async () => {
      // Mock successful authentication
      jest.spyOn(scraperService, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(scraperService, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleDeviceVerification').mockResolvedValue();

      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();
      mockBrowserService.evaluate.mockResolvedValue(true);

      await scraperService.authenticateWithYouTube();

      // Verify enhanced logging captured authentication steps
      expect(mockLogger.info).toHaveBeenCalledWith('Starting YouTube authentication...', expect.any(Object));
      expect(mockLogger.info).toHaveBeenCalledWith('✅ Successfully authenticated with YouTube', expect.any(Object));

      // Verify the logger was called multiple times during the process
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });

    it('should sanitize sensitive data in authentication error logs', async () => {
      const authError = new Error('Authentication failed');
      authError.response = {
        data: {
          username: 'test@example.com',
          password: 'testpassword123',
          token: 'secret-token-123',
        },
      };

      mockBrowserService.goto.mockRejectedValue(authError);

      await scraperService.authenticateWithYouTube();

      // Verify error logging occurred but sensitive data was sanitized
      expect(mockLogger.error).toHaveBeenCalledWith(
        '⚠️Failed to authenticate with YouTube:',
        expect.objectContaining({
          error: 'Authentication failed',
          stack: expect.any(String),
        })
      );

      // Ensure no sensitive data appears in logs
      const errorCall = mockLogger.error.mock.calls.find(call => call[0].includes('Failed to authenticate'));
      expect(JSON.stringify(errorCall)).not.toContain('testpassword123');
      expect(JSON.stringify(errorCall)).not.toContain('secret-token-123');
    });
  });

  describe('Authentication Integration with Service Initialization', () => {
    it('should seamlessly integrate authentication with service initialization', async () => {
      // Mock successful authentication
      jest.spyOn(scraperService, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(scraperService, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(scraperService, 'handleDeviceVerification').mockResolvedValue();

      mockBrowserService.goto.mockResolvedValue();
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.type.mockResolvedValue();
      mockBrowserService.click.mockResolvedValue();
      mockBrowserService.waitFor.mockResolvedValue();
      mockBrowserService.evaluate
        .mockResolvedValueOnce(true) // Authentication success
        .mockResolvedValueOnce({
          // Initial video for initialization
          id: 'test123',
          title: 'Test Video',
          url: 'https://www.youtube.com/watch?v=test123',
          publishedAt: new Date().toISOString(),
        });

      const authSpy = jest.spyOn(scraperService, 'authenticateWithYouTube');

      await scraperService.initialize('testchannel');

      expect(authSpy).toHaveBeenCalled();
      expect(scraperService.isAuthenticated).toBe(true);
      expect(scraperService.isInitialized).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('✅ Successfully authenticated with YouTube', expect.any(Object));
    });

    it('should handle authentication failure during initialization gracefully', async () => {
      const authError = new Error('Authentication timeout');
      mockBrowserService.goto.mockRejectedValue(authError);
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'test123',
        title: 'Test Video',
        url: 'https://www.youtube.com/watch?v=test123',
      });

      await scraperService.initialize('testchannel');

      expect(scraperService.isAuthenticated).toBe(false);
      expect(scraperService.isInitialized).toBe(true); // Should still initialize
      expect(mockLogger.error).toHaveBeenCalledWith(
        '⚠️Failed to authenticate with YouTube:',
        expect.objectContaining({
          error: 'Authentication timeout',
        })
      );
    });
  });
});
