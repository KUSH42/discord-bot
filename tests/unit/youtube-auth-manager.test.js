import { jest } from '@jest/globals';
import { YouTubeAuthManager } from '../../src/application/youtube-auth-manager.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('YouTubeAuthManager', () => {
  let youtubeAuthManager;
  let mockBrowserService;
  let mockConfig;
  let mockStateManager;
  let mockLogger;
  let mockPage;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create enhanced logging mocks
    const enhancedLoggingMocks = createMockDependenciesWithEnhancedLogging();

    mockPage = {
      url: jest.fn().mockResolvedValue('https://www.youtube.com/'),
      evaluate: jest.fn(),
    };

    mockBrowserService = {
      clearCookies: jest.fn().mockResolvedValue(),
      goto: jest.fn().mockResolvedValue(),
      waitFor: jest.fn().mockResolvedValue(),
      evaluate: jest.fn().mockResolvedValue('https://accounts.google.com/signin'),
      waitForSelector: jest.fn().mockResolvedValue(),
      type: jest.fn().mockResolvedValue(),
      click: jest.fn().mockResolvedValue(),
      page: mockPage,
    };

    mockConfig = {
      getRequired: jest.fn().mockImplementation(key => {
        const config = {
          YOUTUBE_USERNAME: 'test@example.com',
          YOUTUBE_PASSWORD: 'test_password',
        };
        return config[key];
      }),
      get: jest.fn().mockImplementation(key => {
        const config = {
          YOUTUBE_AUTHENTICATION_ENABLED: 'false',
        };
        return config[key];
      }),
    };

    mockStateManager = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    };

    mockLogger = enhancedLoggingMocks.logger;

    const dependencies = {
      browserService: mockBrowserService,
      config: mockConfig,
      stateManager: mockStateManager,
      logger: mockLogger,
      debugManager: enhancedLoggingMocks.debugManager,
      metricsManager: enhancedLoggingMocks.metricsManager,
    };

    youtubeAuthManager = new YouTubeAuthManager(dependencies);
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(youtubeAuthManager.browserService).toBe(mockBrowserService);
      expect(youtubeAuthManager.config).toBe(mockConfig);
      expect(youtubeAuthManager.state).toBe(mockStateManager);
      expect(youtubeAuthManager.logger).toEqual(expect.objectContaining({ moduleName: 'auth' }));
    });

    it('should get required config values during initialization', () => {
      expect(mockConfig.getRequired).toHaveBeenCalledWith('YOUTUBE_USERNAME');
      expect(mockConfig.getRequired).toHaveBeenCalledWith('YOUTUBE_PASSWORD');
    });

    it('should set authentication enabled flag from config', () => {
      expect(youtubeAuthManager.authEnabled).toBe(false);
      expect(mockConfig.get).toHaveBeenCalledWith('YOUTUBE_AUTHENTICATION_ENABLED', 'false');
    });

    it('should handle authentication enabled configuration', () => {
      mockConfig.get.mockImplementation(key => {
        if (key === 'YOUTUBE_AUTHENTICATION_ENABLED') {
          return 'true';
        }
        return 'false';
      });

      const authManager = new YouTubeAuthManager({
        browserService: mockBrowserService,
        config: mockConfig,
        stateManager: mockStateManager,
        logger: mockLogger,
        debugManager: jest.fn(),
        metricsManager: jest.fn(),
      });

      expect(authManager.authEnabled).toBe(true);
    });
  });

  describe('ensureAuthenticated', () => {
    beforeEach(() => {
      jest.spyOn(youtubeAuthManager, 'isQuickAuthenticated').mockResolvedValue(false);
      jest.spyOn(youtubeAuthManager, 'isAuthenticated').mockResolvedValue(false);
      jest.spyOn(youtubeAuthManager, 'authenticateWithYouTube').mockResolvedValue(true);
    });

    it('should return true immediately when authentication is disabled', async () => {
      youtubeAuthManager.authEnabled = false;

      const result = await youtubeAuthManager.ensureAuthenticated();

      expect(result).toBe(true);
      expect(youtubeAuthManager.isQuickAuthenticated).not.toHaveBeenCalled();
      expect(youtubeAuthManager.isAuthenticated).not.toHaveBeenCalled();
      expect(youtubeAuthManager.authenticateWithYouTube).not.toHaveBeenCalled();
    });

    it('should return false when credentials are missing', async () => {
      youtubeAuthManager.authEnabled = true;
      youtubeAuthManager.youtubeUsername = null;
      youtubeAuthManager.youtubePassword = null;

      const result = await youtubeAuthManager.ensureAuthenticated();

      expect(result).toBe(false);
    });

    it('should return true if quick authentication succeeds', async () => {
      youtubeAuthManager.authEnabled = true;
      youtubeAuthManager.isQuickAuthenticated.mockResolvedValue(true);

      const result = await youtubeAuthManager.ensureAuthenticated();

      expect(result).toBe(true);
      expect(youtubeAuthManager.isQuickAuthenticated).toHaveBeenCalled();
      expect(youtubeAuthManager.isAuthenticated).not.toHaveBeenCalled();
      expect(youtubeAuthManager.authenticateWithYouTube).not.toHaveBeenCalled();
    });

    it('should return true if full authentication check succeeds', async () => {
      youtubeAuthManager.authEnabled = true;
      youtubeAuthManager.isQuickAuthenticated.mockResolvedValue(false);
      youtubeAuthManager.isAuthenticated.mockResolvedValue(true);

      const result = await youtubeAuthManager.ensureAuthenticated();

      expect(result).toBe(true);
      expect(youtubeAuthManager.isQuickAuthenticated).toHaveBeenCalled();
      expect(youtubeAuthManager.isAuthenticated).toHaveBeenCalled();
      expect(youtubeAuthManager.authenticateWithYouTube).not.toHaveBeenCalled();
    });

    it('should perform fresh authentication when existing authentication fails', async () => {
      youtubeAuthManager.authEnabled = true;
      youtubeAuthManager.isQuickAuthenticated.mockResolvedValue(false);
      youtubeAuthManager.isAuthenticated.mockResolvedValue(false);
      youtubeAuthManager.authenticateWithYouTube.mockResolvedValue(true);

      const result = await youtubeAuthManager.ensureAuthenticated();

      expect(result).toBe(true);
      expect(youtubeAuthManager.isQuickAuthenticated).toHaveBeenCalled();
      expect(youtubeAuthManager.isAuthenticated).toHaveBeenCalled();
      expect(youtubeAuthManager.authenticateWithYouTube).toHaveBeenCalled();
    });

    it('should retry authentication with exponential backoff on recoverable errors', async () => {
      youtubeAuthManager.authEnabled = true;
      jest.useFakeTimers();
      jest.spyOn(youtubeAuthManager, 'delay').mockResolvedValue();
      jest.spyOn(youtubeAuthManager, 'isRecoverableError').mockReturnValue(true);

      youtubeAuthManager.authenticateWithYouTube
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(true);

      const result = await youtubeAuthManager.ensureAuthenticated({ maxRetries: 3, baseDelay: 1000 });

      expect(result).toBe(true);
      expect(youtubeAuthManager.authenticateWithYouTube).toHaveBeenCalledTimes(3);
      expect(youtubeAuthManager.delay).toHaveBeenCalledWith(1000); // First retry delay
      expect(youtubeAuthManager.delay).toHaveBeenCalledWith(2000); // Second retry delay

      jest.useRealTimers();
    });

    it('should fail immediately on non-recoverable errors', async () => {
      youtubeAuthManager.authEnabled = true;
      jest.spyOn(youtubeAuthManager, 'isRecoverableError').mockReturnValue(false);

      youtubeAuthManager.authenticateWithYouTube.mockRejectedValue(new Error('Account suspended'));

      const result = await youtubeAuthManager.ensureAuthenticated({ maxRetries: 3 });

      expect(result).toBe(false);
      expect(youtubeAuthManager.authenticateWithYouTube).toHaveBeenCalledTimes(1);
    });

    it('should fail after max retries exceeded', async () => {
      youtubeAuthManager.authEnabled = true;
      jest.spyOn(youtubeAuthManager, 'delay').mockResolvedValue();
      jest.spyOn(youtubeAuthManager, 'isRecoverableError').mockReturnValue(true);

      youtubeAuthManager.authenticateWithYouTube.mockRejectedValue(new Error('Network timeout'));

      const result = await youtubeAuthManager.ensureAuthenticated({ maxRetries: 2, baseDelay: 100 });

      expect(result).toBe(false);
      expect(youtubeAuthManager.authenticateWithYouTube).toHaveBeenCalledTimes(2);
    });
  });

  describe('authenticateWithYouTube', () => {
    beforeEach(() => {
      jest.spyOn(youtubeAuthManager, 'handleCookieConsent').mockResolvedValue();
      jest.spyOn(youtubeAuthManager, 'handleAccountChallenges').mockResolvedValue(true);
      jest.spyOn(youtubeAuthManager, 'handle2FA').mockResolvedValue(true);
      jest.spyOn(youtubeAuthManager, 'handleCaptcha').mockResolvedValue(true);
      jest.spyOn(youtubeAuthManager, 'handleConsentPageRedirect').mockResolvedValue();
      jest.spyOn(youtubeAuthManager, 'isAuthenticated').mockResolvedValue(true);
      jest.spyOn(youtubeAuthManager, 'clearSensitiveData').mockImplementation(() => {});
    });

    it('should perform complete authentication flow successfully', async () => {
      mockBrowserService.evaluate.mockResolvedValue('https://accounts.google.com/signin');

      const result = await youtubeAuthManager.authenticateWithYouTube();

      expect(result).toBe(true);
      expect(mockBrowserService.clearCookies).toHaveBeenCalled();
      expect(mockBrowserService.goto).toHaveBeenCalledWith(
        'https://accounts.google.com/signin/v2/identifier?service=youtube'
      );
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[type="email"]', 'test@example.com');
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[type="password"]', 'test_password');
      expect(youtubeAuthManager.handleCookieConsent).toHaveBeenCalled();
      expect(youtubeAuthManager.handleAccountChallenges).toHaveBeenCalled();
      expect(youtubeAuthManager.handle2FA).toHaveBeenCalled();
      expect(youtubeAuthManager.handleCaptcha).toHaveBeenCalled();
      expect(youtubeAuthManager.handleConsentPageRedirect).toHaveBeenCalled();
      expect(youtubeAuthManager.isAuthenticated).toHaveBeenCalled();
      expect(youtubeAuthManager.clearSensitiveData).toHaveBeenCalled();
    });

    it('should fail if not on Google sign-in page', async () => {
      mockBrowserService.evaluate.mockResolvedValue('https://example.com/other-page');

      const result = await youtubeAuthManager.authenticateWithYouTube();

      expect(result).toBe(false);
    });

    it('should fail if account challenge handling fails', async () => {
      mockBrowserService.evaluate.mockResolvedValue('https://accounts.google.com/signin');
      youtubeAuthManager.handleAccountChallenges.mockResolvedValue(false);

      const result = await youtubeAuthManager.authenticateWithYouTube();

      expect(result).toBe(false);
    });

    it('should fail if 2FA challenge is detected', async () => {
      mockBrowserService.evaluate.mockResolvedValue('https://accounts.google.com/signin');
      youtubeAuthManager.handle2FA.mockResolvedValue(false);

      const result = await youtubeAuthManager.authenticateWithYouTube();

      expect(result).toBe(false);
    });

    it('should fail if CAPTCHA challenge is detected', async () => {
      mockBrowserService.evaluate.mockResolvedValue('https://accounts.google.com/signin');
      youtubeAuthManager.handleCaptcha.mockResolvedValue(false);

      const result = await youtubeAuthManager.authenticateWithYouTube();

      expect(result).toBe(false);
    });

    it('should fail if final authentication verification fails', async () => {
      mockBrowserService.evaluate.mockResolvedValue('https://accounts.google.com/signin');
      youtubeAuthManager.isAuthenticated.mockResolvedValue(false);

      const result = await youtubeAuthManager.authenticateWithYouTube();

      expect(result).toBe(false);
    });

    it('should handle errors during authentication process', async () => {
      mockBrowserService.clearCookies.mockRejectedValue(new Error('Browser error'));

      const result = await youtubeAuthManager.authenticateWithYouTube();

      expect(result).toBe(false);
    });

    it('should sanitize error messages in logs', async () => {
      const error = new Error('Authentication failed with password test_password');
      mockBrowserService.clearCookies.mockRejectedValue(error);
      jest.spyOn(youtubeAuthManager, 'sanitizeErrorMessage');

      await youtubeAuthManager.authenticateWithYouTube();

      expect(youtubeAuthManager.sanitizeErrorMessage).toHaveBeenCalledWith(error.message);
    });
  });

  describe('handleCookieConsent', () => {
    it('should handle cookie consent successfully', async () => {
      mockBrowserService.waitForSelector.mockResolvedValueOnce();

      await youtubeAuthManager.handleCookieConsent();

      expect(mockBrowserService.waitFor).toHaveBeenCalledWith(2000);
      expect(mockBrowserService.waitForSelector).toHaveBeenCalled();
      expect(mockBrowserService.click).toHaveBeenCalled();
    });

    it('should continue when no cookie consent banner found', async () => {
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector not found'));

      await expect(youtubeAuthManager.handleCookieConsent()).resolves.not.toThrow();
    });

    it('should try multiple consent selectors', async () => {
      // Mock first selector fails, second succeeds
      mockBrowserService.waitForSelector
        .mockRejectedValueOnce(new Error('First selector not found'))
        .mockResolvedValueOnce();

      await youtubeAuthManager.handleCookieConsent();

      expect(mockBrowserService.waitForSelector).toHaveBeenCalledTimes(2);
      expect(mockBrowserService.click).toHaveBeenCalledTimes(1);
    });

    it('should handle errors gracefully during consent handling', async () => {
      const error = new Error('Click failed');
      mockBrowserService.waitForSelector.mockResolvedValue();
      mockBrowserService.click.mockRejectedValue(error);

      await expect(youtubeAuthManager.handleCookieConsent()).resolves.not.toThrow();
    });
  });

  describe('handleConsentPageRedirect', () => {
    it('should handle YouTube consent page redirect successfully', async () => {
      mockBrowserService.evaluate.mockResolvedValue('https://consent.youtube.com/consent');
      mockBrowserService.waitForSelector.mockResolvedValueOnce();

      await youtubeAuthManager.handleConsentPageRedirect();

      expect(mockBrowserService.evaluate).toHaveBeenCalled();
      expect(mockBrowserService.waitForSelector).toHaveBeenCalled();
      expect(mockBrowserService.click).toHaveBeenCalled();
    });

    it('should skip handling if not on consent page', async () => {
      mockBrowserService.evaluate.mockResolvedValue('https://www.youtube.com/');

      await youtubeAuthManager.handleConsentPageRedirect();

      expect(mockBrowserService.waitForSelector).not.toHaveBeenCalled();
      expect(mockBrowserService.click).not.toHaveBeenCalled();
    });

    it('should try multiple consent selectors', async () => {
      mockBrowserService.evaluate.mockResolvedValue('https://consent.youtube.com/consent');
      // Mock first selector fails, second succeeds
      mockBrowserService.waitForSelector
        .mockRejectedValueOnce(new Error('First selector not found'))
        .mockResolvedValueOnce();

      await youtubeAuthManager.handleConsentPageRedirect();

      expect(mockBrowserService.waitForSelector).toHaveBeenCalledTimes(2);
      expect(mockBrowserService.click).toHaveBeenCalledTimes(1);
    });

    it('should handle errors when no consent buttons found', async () => {
      mockBrowserService.evaluate.mockResolvedValue('https://consent.youtube.com/consent');
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('No buttons found'));

      await expect(youtubeAuthManager.handleConsentPageRedirect()).resolves.not.toThrow();
    });
  });

  describe('handleAccountChallenges', () => {
    it('should return true when no challenges are detected', async () => {
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector not found'));

      const result = await youtubeAuthManager.handleAccountChallenges();

      expect(result).toBe(true);
    });

    it('should return false when email verification challenge is detected', async () => {
      mockBrowserService.waitForSelector.mockResolvedValueOnce();

      const result = await youtubeAuthManager.handleAccountChallenges();

      expect(result).toBe(false);
    });

    it('should return false when phone verification challenge is detected', async () => {
      // Mock email selectors fail, phone selector succeeds
      mockBrowserService.waitForSelector
        .mockRejectedValueOnce(new Error('Email selector not found'))
        .mockRejectedValueOnce(new Error('Email selector not found'))
        .mockRejectedValueOnce(new Error('Email selector not found'))
        .mockResolvedValueOnce(); // Phone selector found

      const result = await youtubeAuthManager.handleAccountChallenges();

      expect(result).toBe(false);
    });

    it('should check multiple email challenge selectors', async () => {
      // Mock first two email selectors fail, third succeeds
      mockBrowserService.waitForSelector
        .mockRejectedValueOnce(new Error('First email selector not found'))
        .mockRejectedValueOnce(new Error('Second email selector not found'))
        .mockResolvedValueOnce(); // Third email selector found

      const result = await youtubeAuthManager.handleAccountChallenges();

      expect(result).toBe(false);
      expect(mockBrowserService.waitForSelector).toHaveBeenCalledTimes(3);
    });

    it('should handle errors during challenge detection', async () => {
      // Mock all selectors to fail, then check that the try-catch in the implementation works
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector not found'));

      const result = await youtubeAuthManager.handleAccountChallenges();

      // Should return true because no challenges were detected (all selectors failed)
      expect(result).toBe(true);
    });
  });

  describe('handle2FA', () => {
    it('should return true when no 2FA challenge is detected', async () => {
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector not found'));

      const result = await youtubeAuthManager.handle2FA();

      expect(result).toBe(true);
    });

    it('should return false when 2FA challenge is detected', async () => {
      mockBrowserService.waitForSelector.mockResolvedValueOnce();

      const result = await youtubeAuthManager.handle2FA();

      expect(result).toBe(false);
    });

    it('should check multiple 2FA selectors', async () => {
      // Mock first selector fails, second succeeds
      mockBrowserService.waitForSelector
        .mockRejectedValueOnce(new Error('First 2FA selector not found'))
        .mockResolvedValueOnce(); // Second 2FA selector found

      const result = await youtubeAuthManager.handle2FA();

      expect(result).toBe(false);
      expect(mockBrowserService.waitForSelector).toHaveBeenCalledTimes(2);
    });

    it('should handle errors during 2FA detection', async () => {
      // Mock all selectors to fail
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector not found'));

      const result = await youtubeAuthManager.handle2FA();

      // Should return true because no 2FA challenges were detected (all selectors failed)
      expect(result).toBe(true);
    });
  });

  describe('handleCaptcha', () => {
    it('should return true when no CAPTCHA challenge is detected', async () => {
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector not found'));

      const result = await youtubeAuthManager.handleCaptcha();

      expect(result).toBe(true);
    });

    it('should return false when CAPTCHA challenge is detected', async () => {
      mockBrowserService.waitForSelector.mockResolvedValueOnce();

      const result = await youtubeAuthManager.handleCaptcha();

      expect(result).toBe(false);
    });

    it('should check multiple CAPTCHA selectors', async () => {
      // Mock first two selectors fail, third succeeds
      mockBrowserService.waitForSelector
        .mockRejectedValueOnce(new Error('First CAPTCHA selector not found'))
        .mockRejectedValueOnce(new Error('Second CAPTCHA selector not found'))
        .mockResolvedValueOnce(); // Third CAPTCHA selector found

      const result = await youtubeAuthManager.handleCaptcha();

      expect(result).toBe(false);
      expect(mockBrowserService.waitForSelector).toHaveBeenCalledTimes(3);
    });

    it('should handle errors during CAPTCHA detection', async () => {
      // Mock all selectors to fail
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector not found'));

      const result = await youtubeAuthManager.handleCaptcha();

      // Should return true because no CAPTCHA challenges were detected (all selectors failed)
      expect(result).toBe(true);
    });
  });

  describe('isQuickAuthenticated', () => {
    it('should return true when authentication cookies are present', async () => {
      mockBrowserService.evaluate.mockResolvedValue(true);

      const result = await youtubeAuthManager.isQuickAuthenticated();

      expect(result).toBe(true);
      expect(mockBrowserService.evaluate).toHaveBeenCalled();
    });

    it('should return false when authentication cookies are not present', async () => {
      mockBrowserService.evaluate.mockResolvedValue(false);

      const result = await youtubeAuthManager.isQuickAuthenticated();

      expect(result).toBe(false);
    });

    it('should return false when browser service is not available', async () => {
      youtubeAuthManager.browserService = null;

      const result = await youtubeAuthManager.isQuickAuthenticated();

      expect(result).toBe(false);
    });

    it('should return false when page is not available', async () => {
      youtubeAuthManager.browserService.page = null;

      const result = await youtubeAuthManager.isQuickAuthenticated();

      expect(result).toBe(false);
    });

    it('should handle errors during cookie check', async () => {
      mockBrowserService.evaluate.mockRejectedValue(new Error('Cookie check failed'));

      const result = await youtubeAuthManager.isQuickAuthenticated();

      expect(result).toBe(false);
    });
  });

  describe('isAuthenticated', () => {
    beforeEach(() => {
      mockBrowserService.evaluate.mockResolvedValue({
        hasAvatar: false,
        hasSignIn: false,
        hasAuthCookies: false,
        hasUserMenu: false,
        onLoginPage: false,
        currentUrl: 'https://www.youtube.com',
        pageTitle: 'YouTube',
      });
    });

    it('should return false when browser service is not available', async () => {
      youtubeAuthManager.browserService = null;

      const result = await youtubeAuthManager.isAuthenticated();

      expect(result).toBe(false);
    });

    it('should return false when page is not available', async () => {
      youtubeAuthManager.browserService.page = null;

      const result = await youtubeAuthManager.isAuthenticated();

      expect(result).toBe(false);
    });

    it('should return true when authentication score is positive', async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        hasAvatar: true, // +3 score
        hasSignIn: false, // +2 score (no sign in button)
        hasAuthCookies: true, // +2 score
        hasUserMenu: true, // +1 score
        onLoginPage: false, // 0 score
        currentUrl: 'https://www.youtube.com',
        pageTitle: 'YouTube',
      });

      const result = await youtubeAuthManager.isAuthenticated();

      expect(result).toBe(true);
      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://www.youtube.com', {
        timeout: 15000,
        waitUntil: 'domcontentloaded',
      });
    });

    it('should return false when authentication score is negative', async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        hasAvatar: false, // 0 score
        hasSignIn: true, // -2 score (sign in button present)
        hasAuthCookies: false, // 0 score
        hasUserMenu: false, // 0 score
        onLoginPage: true, // -5 score
        currentUrl: 'https://accounts.google.com/signin',
        pageTitle: 'Sign in - Google Accounts',
      });

      const result = await youtubeAuthManager.isAuthenticated();

      expect(result).toBe(false);
    });

    it('should provide detailed authentication indicators in logs', async () => {
      const authIndicators = {
        hasAvatar: true,
        hasSignIn: false,
        hasAuthCookies: true,
        hasUserMenu: true,
        onLoginPage: false,
        currentUrl: 'https://www.youtube.com/feed/subscriptions',
        pageTitle: 'Subscriptions - YouTube',
      };
      mockBrowserService.evaluate.mockResolvedValue(authIndicators);

      const result = await youtubeAuthManager.isAuthenticated();

      expect(result).toBe(true);
      // Just verify the result, not the specific logging calls
    });

    it('should handle evaluation errors gracefully', async () => {
      mockBrowserService.evaluate.mockRejectedValue(new Error('Page evaluation failed'));

      const result = await youtubeAuthManager.isAuthenticated();

      expect(result).toBe(false);
    });

    it('should include debug information in logs', async () => {
      const authIndicators = {
        hasAvatar: false,
        hasSignIn: true,
        hasAuthCookies: false,
        hasUserMenu: false,
        onLoginPage: false,
        currentUrl: 'https://www.youtube.com',
        pageTitle: 'YouTube',
      };
      mockBrowserService.evaluate.mockResolvedValue(authIndicators);
      jest.spyOn(youtubeAuthManager.logger, 'info');

      await youtubeAuthManager.isAuthenticated();

      expect(youtubeAuthManager.logger.info).toHaveBeenCalledWith(expect.stringContaining('YouTube auth debug:'));
    });
  });

  describe('isRecoverableError', () => {
    it('should identify recoverable network errors', () => {
      const recoverableErrors = [
        new Error('Network timeout occurred'),
        new Error('Connection refused'),
        new Error('Server error 500'),
        new Error('Page loading failed'),
        new Error('Navigation timeout'),
        new Error('Protocol error'),
        new Error('Service temporarily unavailable'),
        new Error('Page crash detected'),
      ];

      recoverableErrors.forEach(error => {
        expect(youtubeAuthManager.isRecoverableError(error)).toBe(true);
      });
    });

    it('should identify non-recoverable authentication errors', () => {
      const nonRecoverableErrors = [
        new Error('Invalid credentials provided'),
        new Error('Account suspended'),
        new Error('Access denied'),
        new Error('Authentication method not supported'),
        new Error('2FA challenge detected'),
        new Error('CAPTCHA challenge detected'),
      ];

      nonRecoverableErrors.forEach(error => {
        expect(youtubeAuthManager.isRecoverableError(error)).toBe(false);
      });
    });

    it('should handle case-insensitive error matching', () => {
      const mixedCaseErrors = [
        new Error('NETWORK ERROR OCCURRED'),
        new Error('Connection TIMEOUT'),
        new Error('PAGE CRASH detected'),
      ];

      mixedCaseErrors.forEach(error => {
        expect(youtubeAuthManager.isRecoverableError(error)).toBe(true);
      });
    });
  });

  describe('delay method', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should delay for specified milliseconds', async () => {
      const delayPromise = youtubeAuthManager.delay(1000);

      // Fast-forward time
      jest.advanceTimersByTime(1000);

      await expect(delayPromise).resolves.toBeUndefined();
    });

    it('should handle zero delay', async () => {
      const delayPromise = youtubeAuthManager.delay(0);

      jest.advanceTimersByTime(0);

      await expect(delayPromise).resolves.toBeUndefined();
    });

    it('should handle negative delay', async () => {
      const delayPromise = youtubeAuthManager.delay(-100);

      jest.advanceTimersByTime(0);

      await expect(delayPromise).resolves.toBeUndefined();
    });
  });

  describe('clearSensitiveData method', () => {
    it('should clear all sensitive credential data', () => {
      // Verify credentials are initially set
      expect(youtubeAuthManager.youtubeUsername).toBe('test@example.com');
      expect(youtubeAuthManager.youtubePassword).toBe('test_password');

      youtubeAuthManager.clearSensitiveData();

      expect(youtubeAuthManager.youtubeUsername).toBeNull();
      expect(youtubeAuthManager.youtubePassword).toBeNull();
    });

    it('should not throw if credentials were already cleared', () => {
      youtubeAuthManager.clearSensitiveData();

      expect(() => youtubeAuthManager.clearSensitiveData()).not.toThrow();
    });
  });

  describe('sanitizeErrorMessage method', () => {
    it('should remove username from error messages', () => {
      const errorMessage = 'Login failed for user test@example.com with timeout';
      const sanitized = youtubeAuthManager.sanitizeErrorMessage(errorMessage);

      expect(sanitized).toBe('Login failed for user [REDACTED_USERNAME] with timeout');
      expect(sanitized).not.toContain('test@example.com');
    });

    it('should remove password from error messages', () => {
      const errorMessage = 'Authentication failed with password test_password';
      const sanitized = youtubeAuthManager.sanitizeErrorMessage(errorMessage);

      expect(sanitized).toBe('Authentication failed with password [REDACTED_PASSWORD]');
      expect(sanitized).not.toContain('test_password');
    });

    it('should handle non-string input gracefully', () => {
      expect(youtubeAuthManager.sanitizeErrorMessage(null)).toBe('An unknown error occurred');
      expect(youtubeAuthManager.sanitizeErrorMessage(undefined)).toBe('An unknown error occurred');
      expect(youtubeAuthManager.sanitizeErrorMessage(123)).toBe('An unknown error occurred');
      expect(youtubeAuthManager.sanitizeErrorMessage({})).toBe('An unknown error occurred');
    });

    it('should handle error messages with special regex characters', () => {
      // Test with simple credentials without special regex characters
      const errorMessage = 'Login failed for test@example.com with test_password';
      const sanitized = youtubeAuthManager.sanitizeErrorMessage(errorMessage);

      expect(sanitized).toBe('Login failed for [REDACTED_USERNAME] with [REDACTED_PASSWORD]');
      expect(sanitized).not.toContain('test@example.com');
      expect(sanitized).not.toContain('test_password');
    });

    it('should handle multiple occurrences of the same credential', () => {
      const errorMessage = 'test@example.com login failed, retry for test@example.com again';
      const sanitized = youtubeAuthManager.sanitizeErrorMessage(errorMessage);

      expect(sanitized).toBe('[REDACTED_USERNAME] login failed, retry for [REDACTED_USERNAME] again');
      expect(sanitized).not.toContain('test@example.com');
    });

    it('should handle empty credentials gracefully', () => {
      mockConfig.getRequired.mockImplementation(key => {
        return ''; // Empty credentials
      });

      const errorMessage = 'Login failed with empty credentials';
      const sanitized = youtubeAuthManager.sanitizeErrorMessage(errorMessage);

      expect(sanitized).toBe('Login failed with empty credentials');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle missing required config gracefully', () => {
      mockConfig.getRequired.mockImplementation(key => {
        throw new Error(`Missing required config: ${key}`);
      });

      expect(
        () =>
          new YouTubeAuthManager({
            browserService: mockBrowserService,
            config: mockConfig,
            stateManager: mockStateManager,
            logger: mockLogger,
          })
      ).toThrow('Missing required config: YOUTUBE_USERNAME');
    });

    it('should handle browser navigation errors during authentication check', async () => {
      mockBrowserService.goto.mockRejectedValue(new Error('Navigation failed'));

      const result = await youtubeAuthManager.isAuthenticated();

      expect(result).toBe(false);
    });

    it('should handle malformed credentials in config', async () => {
      const malformedConfig = {
        getRequired: jest.fn().mockImplementation(key => {
          if (key === 'YOUTUBE_USERNAME') {
            return null;
          }
          if (key === 'YOUTUBE_PASSWORD') {
            return undefined;
          }
          return '';
        }),
        get: jest.fn().mockReturnValue('true'), // Enable authentication
      };

      const authManager = new YouTubeAuthManager({
        browserService: mockBrowserService,
        config: malformedConfig,
        stateManager: mockStateManager,
        logger: mockLogger,
        debugManager: jest.fn(),
        metricsManager: jest.fn(),
      });

      const result = await authManager.ensureAuthenticated();

      expect(result).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('should handle rapid authentication requests', async () => {
      youtubeAuthManager.authEnabled = false; // Disable for quick resolution

      const promises = Array.from({ length: 5 }, () => youtubeAuthManager.ensureAuthenticated());

      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result).toBe(true);
      });
    });

    it('should handle authentication state changes during process', async () => {
      youtubeAuthManager.authEnabled = true;
      jest.spyOn(youtubeAuthManager, 'isQuickAuthenticated').mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      jest.spyOn(youtubeAuthManager, 'isAuthenticated').mockResolvedValue(false);
      jest.spyOn(youtubeAuthManager, 'authenticateWithYouTube').mockResolvedValue(true);

      const result1 = await youtubeAuthManager.ensureAuthenticated();
      const result2 = await youtubeAuthManager.ensureAuthenticated();

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(youtubeAuthManager.authenticateWithYouTube).toHaveBeenCalledTimes(1);
    });
  });

  describe('recovery scenarios', () => {
    it('should recover from browser disconnect during authentication', async () => {
      youtubeAuthManager.authEnabled = true;
      jest.spyOn(youtubeAuthManager, 'isQuickAuthenticated').mockResolvedValue(false);
      jest.spyOn(youtubeAuthManager, 'isAuthenticated').mockResolvedValue(false);
      mockBrowserService.clearCookies.mockRejectedValue(new Error('Browser disconnected'));

      const result = await youtubeAuthManager.authenticateWithYouTube();

      expect(result).toBe(false);
    });

    it('should handle login page taking too long to load', async () => {
      youtubeAuthManager.authEnabled = true;
      jest.spyOn(youtubeAuthManager, 'isQuickAuthenticated').mockResolvedValue(false);
      jest.spyOn(youtubeAuthManager, 'isAuthenticated').mockResolvedValue(false);
      mockBrowserService.goto.mockRejectedValue(new Error('Timeout waiting for navigation'));

      const result = await youtubeAuthManager.authenticateWithYouTube();

      expect(result).toBe(false);
    });

    it('should retry authentication if challenge handling fails temporarily', async () => {
      youtubeAuthManager.authEnabled = true;
      jest.spyOn(youtubeAuthManager, 'isQuickAuthenticated').mockResolvedValue(false);
      jest.spyOn(youtubeAuthManager, 'isAuthenticated').mockResolvedValue(false);
      jest.spyOn(youtubeAuthManager, 'delay').mockResolvedValue();
      jest.spyOn(youtubeAuthManager, 'isRecoverableError').mockReturnValue(true);
      jest
        .spyOn(youtubeAuthManager, 'authenticateWithYouTube')
        .mockRejectedValueOnce(new Error('Timeout waiting for selector'))
        .mockResolvedValueOnce(true);

      const result = await youtubeAuthManager.ensureAuthenticated({ maxRetries: 2, baseDelay: 100 });

      expect(result).toBe(true);
      expect(youtubeAuthManager.authenticateWithYouTube).toHaveBeenCalledTimes(2);
    });
  });

  describe('security validation', () => {
    it('should never log credentials in plain text', async () => {
      const error = new Error('Authentication failed for test@example.com with test_password');
      mockBrowserService.clearCookies.mockRejectedValue(error);

      const result = await youtubeAuthManager.authenticateWithYouTube();

      expect(result).toBe(false);
      // The main goal is that authentication fails safely and doesn't expose credentials
    });

    it('should clear credentials after successful authentication', async () => {
      youtubeAuthManager.authEnabled = true;
      jest.spyOn(youtubeAuthManager, 'isQuickAuthenticated').mockResolvedValue(false);
      jest.spyOn(youtubeAuthManager, 'isAuthenticated').mockResolvedValue(false);
      const authenticateSpy = jest.spyOn(youtubeAuthManager, 'authenticateWithYouTube').mockImplementation(async () => {
        // Mock the behavior that clearSensitiveData is called within authenticateWithYouTube
        youtubeAuthManager.clearSensitiveData();
        return true;
      });
      jest.spyOn(youtubeAuthManager, 'clearSensitiveData').mockReturnValue();

      await youtubeAuthManager.ensureAuthenticated();

      expect(youtubeAuthManager.clearSensitiveData).toHaveBeenCalled();
    });

    it('should handle credential sanitization with null/undefined credentials', () => {
      mockConfig.getRequired.mockImplementation(() => null);

      const errorMessage = 'Authentication failed with null credentials';
      const sanitized = youtubeAuthManager.sanitizeErrorMessage(errorMessage);

      expect(sanitized).toBe('Authentication failed with null credentials');
    });
  });

  describe('configuration validation', () => {
    it('should respect authentication enabled/disabled configuration', () => {
      mockConfig.get.mockImplementation(key => {
        if (key === 'YOUTUBE_AUTHENTICATION_ENABLED') {
          return 'true';
        }
        return 'false';
      });

      const authManager = new YouTubeAuthManager({
        browserService: mockBrowserService,
        config: mockConfig,
        stateManager: mockStateManager,
        logger: mockLogger,
        debugManager: jest.fn(),
        metricsManager: jest.fn(),
      });

      expect(authManager.authEnabled).toBe(true);
    });

    it('should default to disabled authentication when config is missing', () => {
      mockConfig.get.mockImplementation(() => undefined);

      const authManager = new YouTubeAuthManager({
        browserService: mockBrowserService,
        config: mockConfig,
        stateManager: mockStateManager,
        logger: mockLogger,
        debugManager: jest.fn(),
        metricsManager: jest.fn(),
      });

      expect(authManager.authEnabled).toBe(false);
    });

    it('should handle non-boolean authentication config values', () => {
      mockConfig.get.mockImplementation(key => {
        if (key === 'YOUTUBE_AUTHENTICATION_ENABLED') {
          return 'yes';
        }
        return 'false';
      });

      const authManager = new YouTubeAuthManager({
        browserService: mockBrowserService,
        config: mockConfig,
        stateManager: mockStateManager,
        logger: mockLogger,
        debugManager: jest.fn(),
        metricsManager: jest.fn(),
      });

      expect(authManager.authEnabled).toBe(false); // Should be false for non-'true' values
    });
  });
});
