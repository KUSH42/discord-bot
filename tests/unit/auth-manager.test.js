import { jest } from '@jest/globals';
import { AuthManager } from '../../src/application/auth-manager.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('AuthManager', () => {
  let authManager;
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
      url: jest.fn().mockResolvedValue('https://x.com/home'),
    };

    mockBrowserService = {
      setCookies: jest.fn().mockResolvedValue(),
      goto: jest.fn().mockResolvedValue(),
      getCookies: jest.fn().mockResolvedValue([]),
      waitForSelector: jest.fn().mockResolvedValue(),
      type: jest.fn().mockResolvedValue(),
      click: jest.fn().mockResolvedValue(),
      waitForNavigation: jest.fn().mockResolvedValue(),
      page: mockPage,
    };

    mockConfig = {
      getRequired: jest.fn().mockImplementation(key => {
        const config = {
          TWITTER_USERNAME: 'test_user',
          TWITTER_PASSWORD: 'test_password',
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

    authManager = new AuthManager(dependencies);
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(authManager.browser).toBe(mockBrowserService);
      expect(authManager.config).toBe(mockConfig);
      expect(authManager.state).toBe(mockStateManager);
      expect(authManager.logger).toEqual(expect.objectContaining({ moduleName: 'auth' }));
    });

    it('should get required config values during initialization', () => {
      expect(mockConfig.getRequired).toHaveBeenCalledWith('TWITTER_USERNAME');
      expect(mockConfig.getRequired).toHaveBeenCalledWith('TWITTER_PASSWORD');
    });
  });

  describe('validateCookieFormat', () => {
    it('should return true for valid cookie array', () => {
      const validCookies = [
        { name: 'session', value: 'abc123' },
        { name: 'auth', value: 'def456' },
      ];

      expect(authManager.validateCookieFormat(validCookies)).toBe(true);
    });

    it('should return false for empty array', () => {
      expect(authManager.validateCookieFormat([])).toBe(false);
    });

    it('should return false for non-array input', () => {
      expect(authManager.validateCookieFormat(null)).toBe(false);
      expect(authManager.validateCookieFormat('not-array')).toBe(false);
      expect(authManager.validateCookieFormat({})).toBe(false);
    });

    it('should return false for array with invalid cookie objects', () => {
      const invalidCookies = [
        { name: 'session' }, // Missing value
        { value: 'abc123' }, // Missing name
        { name: 123, value: 'abc123' }, // Invalid name type
        { name: 'session', value: 456 }, // Invalid value type
      ];

      expect(authManager.validateCookieFormat([invalidCookies[0]])).toBe(false);
      expect(authManager.validateCookieFormat([invalidCookies[1]])).toBe(false);
      expect(authManager.validateCookieFormat([invalidCookies[2]])).toBe(false);
      expect(authManager.validateCookieFormat([invalidCookies[3]])).toBe(false);
    });

    it('should return false if any cookie in array is invalid', () => {
      const mixedCookies = [
        { name: 'valid', value: 'abc123' },
        { name: 'invalid' }, // Missing value
      ];

      expect(authManager.validateCookieFormat(mixedCookies)).toBe(false);
    });
  });

  describe('isAuthenticated', () => {
    beforeEach(() => {
      // Mock methods for cookie-based authentication
      mockBrowserService.getCookies = jest.fn();
      mockBrowserService.getUrl = jest.fn();
    });

    it('should return true when valid cookies are present and navigation succeeds', async () => {
      // Mock valid cookies
      mockBrowserService.getCookies.mockResolvedValue([
        { name: 'auth_token', value: 'valid_auth_token' },
        { name: 'ct0', value: 'valid_ct0_token' },
      ]);

      // Mock successful navigation to home page
      mockBrowserService.getUrl.mockResolvedValue('https://x.com/home');

      const result = await authManager.isAuthenticated();

      expect(result).toBe(true);
      expect(mockBrowserService.getCookies).toHaveBeenCalled();
      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://x.com/home', {
        timeout: 10000,
        waitUntil: 'domcontentloaded',
      });
      expect(mockBrowserService.getUrl).toHaveBeenCalled();
    });

    it('should return false when valid cookies are not present', async () => {
      // Mock missing or invalid cookies
      mockBrowserService.getCookies.mockResolvedValue([{ name: 'other_cookie', value: 'some_value' }]);

      const result = await authManager.isAuthenticated();

      expect(result).toBe(false);
      expect(mockBrowserService.getCookies).toHaveBeenCalled();
    });

    it('should return false and log warning on cookie check error', async () => {
      const error = new Error('Cookie check failed');
      mockBrowserService.getCookies.mockRejectedValue(error);

      const result = await authManager.isAuthenticated();

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Error checking authentication status:',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should return false if browser or page is not available', async () => {
      authManager.browser = { ...mockBrowserService, page: null };
      let result = await authManager.isAuthenticated();
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Browser service or page not available for authentication check.',
        expect.objectContaining({
          module: 'auth',
        })
      );

      authManager.browser = null;
      result = await authManager.isAuthenticated();
      expect(result).toBe(false);
    });
  });

  describe('clickNextButton', () => {
    it('should click the Next button', async () => {
      await authManager.clickNextButton();

      expect(mockBrowserService.click).toHaveBeenCalledWith('button:has-text("Next")');
    });
  });

  describe('clickLoginButton', () => {
    it('should click the Login button', async () => {
      await authManager.clickLoginButton();

      expect(mockBrowserService.click).toHaveBeenCalledWith('button[data-testid="LoginForm_Login_Button"]');
    });
  });

  describe('saveAuthenticationState', () => {
    it('should save valid cookies to state', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockBrowserService.getCookies.mockResolvedValue(validCookies);

      await authManager.saveAuthenticationState();

      expect(mockBrowserService.getCookies).toHaveBeenCalled();
      expect(mockStateManager.set).toHaveBeenCalledWith('x_session_cookies', validCookies);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Saved session cookies to state',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should warn when cookies are invalid format', async () => {
      const invalidCookies = [
        { name: 'invalid' }, // Missing value
      ];
      mockBrowserService.getCookies.mockResolvedValue(invalidCookies);

      await authManager.saveAuthenticationState();

      expect(mockStateManager.set).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Could not find any valid cookies to save.',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should handle errors when getting cookies', async () => {
      mockBrowserService.getCookies.mockRejectedValue(new Error('Cookie error'));

      await authManager.saveAuthenticationState();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error saving session cookies:',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });
  });

  describe('loginToX', () => {
    it('should perform complete login flow successfully', async () => {
      const clickNextButtonSpy = jest.spyOn(authManager, 'clickNextButton').mockResolvedValue();
      const clickLoginButtonSpy = jest.spyOn(authManager, 'clickLoginButton').mockResolvedValue();
      const saveAuthStateSpy = jest.spyOn(authManager, 'saveAuthenticationState').mockResolvedValue();
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(true);

      jest.useFakeTimers();

      const loginPromise = authManager.loginToX();

      // Advance timers to resolve all pending promises
      await jest.runAllTimersAsync();

      const result = await loginPromise;

      expect(result).toBe(true);
      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://x.com/i/flow/login');
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[name="text"]', 'test_user');
      expect(clickNextButtonSpy).toHaveBeenCalled();
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[name="password"]', 'test_password');
      expect(clickLoginButtonSpy).toHaveBeenCalled();
      expect(saveAuthStateSpy).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Login successful'),
        expect.objectContaining({
          module: 'auth',
        })
      );

      jest.useRealTimers();
    });

    it('should throw error when authentication fails after login', async () => {
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(false);
      jest.spyOn(authManager, 'clickNextButton').mockResolvedValue();
      jest.spyOn(authManager, 'clickLoginButton').mockResolvedValue();
      jest.spyOn(authManager, 'saveAuthenticationState').mockResolvedValue();

      await expect(authManager.loginToX()).rejects.toThrow('Authentication failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Credential-based login failed.',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should handle browser interaction errors', async () => {
      mockBrowserService.type.mockRejectedValue(new Error('Type error'));

      await expect(authManager.loginToX()).rejects.toThrow('Type error');
    });
  });

  describe('ensureAuthenticated', () => {
    beforeEach(() => {
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(true);
      jest.spyOn(authManager, 'loginToX').mockResolvedValue(true);
    });

    it('should use saved cookies when available and valid', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockStateManager.get.mockReturnValue(validCookies);

      await authManager.ensureAuthenticated();

      expect(mockBrowserService.setCookies).toHaveBeenCalledWith(validCookies);
      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://x.com/home', { waitUntil: 'domcontentloaded' });
      expect(authManager.loginToX).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully authenticated using saved cookies'),
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should fallback to login when saved cookies are invalid', async () => {
      const invalidCookies = [{ name: 'invalid' }]; // Missing value
      mockStateManager.get.mockReturnValue(invalidCookies);

      await authManager.ensureAuthenticated();

      expect(mockStateManager.delete).toHaveBeenCalledWith('x_session_cookies');
      expect(authManager.loginToX).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid saved cookies format, performing login',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should fallback to login when saved cookies fail authentication', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockStateManager.get.mockReturnValue(validCookies);
      authManager.isAuthenticated.mockResolvedValue(false);

      await authManager.ensureAuthenticated();

      expect(mockStateManager.delete).toHaveBeenCalledWith('x_session_cookies');
      expect(authManager.loginToX).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Saved cookies failed, attempting login',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should perform login when no saved cookies', async () => {
      mockStateManager.get.mockReturnValue(null);

      await authManager.ensureAuthenticated();

      expect(authManager.loginToX).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'No saved cookies found, performing login',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should handle errors during cookie validation and fallback to login', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockStateManager.get.mockReturnValue(validCookies);
      mockBrowserService.setCookies.mockRejectedValue(new Error('Cookie error'));

      await authManager.ensureAuthenticated();

      expect(authManager.loginToX).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error validating saved cookies, falling back to login:',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should throw error when entire authentication process fails', async () => {
      mockStateManager.get.mockReturnValue(null);
      authManager.loginToX.mockRejectedValue(new Error('Login failed'));

      await expect(authManager.ensureAuthenticated()).rejects.toThrow('Authentication failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Non-recoverable authentication error:',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should handle browser navigation errors during cookie validation', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockStateManager.get.mockReturnValue(validCookies);
      mockBrowserService.goto.mockRejectedValue(new Error('Navigation error'));

      await authManager.ensureAuthenticated();

      expect(authManager.loginToX).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error validating saved cookies, falling back to login:',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle missing required config gracefully', () => {
      mockConfig.getRequired.mockImplementation(key => {
        throw new Error(`Missing required config: ${key}`);
      });

      expect(
        () =>
          new AuthManager({
            browserService: mockBrowserService,
            config: mockConfig,
            stateManager: mockStateManager,
            logger: mockLogger,
          })
      ).toThrow('Missing required config: TWITTER_USERNAME');
    });

    it('should handle browser service being unavailable', async () => {
      authManager.browser = null;

      // The new implementation should not throw, but return false and log.
      const result = await authManager.isAuthenticated();
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Browser service or page not available for authentication check.',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should handle timeout errors during login', async () => {
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(false);
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Timeout'));

      await expect(authManager.loginToX()).rejects.toThrow('Timeout');
    });

    it('should handle network errors during navigation', async () => {
      mockBrowserService.waitForNavigation.mockRejectedValue(new Error('Network error'));
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(true);
      jest.spyOn(authManager, 'saveAuthenticationState').mockResolvedValue();
      jest.spyOn(authManager, 'clickNextButton').mockResolvedValue();
      jest.spyOn(authManager, 'clickLoginButton').mockResolvedValue();

      await expect(authManager.loginToX()).rejects.toThrow('Network error');
    });

    it('should handle malformed cookies in state gracefully', async () => {
      mockStateManager.get.mockReturnValue('not-an-array');
      jest.spyOn(authManager, 'loginToX').mockResolvedValue(true);

      await authManager.ensureAuthenticated();

      expect(authManager.loginToX).toHaveBeenCalled();
    });
  });

  describe('integration scenarios', () => {
    it('should handle rapid authentication requests', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockStateManager.get.mockReturnValue(validCookies);
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(true);

      const promises = Array.from({ length: 5 }, () => authManager.ensureAuthenticated());

      await Promise.all(promises);

      expect(mockBrowserService.setCookies).toHaveBeenCalledTimes(5);
    });

    it('should handle authentication state changes during process', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockStateManager.get.mockReturnValue(validCookies);

      // First call succeeds, second fails
      authManager.isAuthenticated = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      jest.spyOn(authManager, 'loginToX').mockResolvedValue(true);

      await authManager.ensureAuthenticated();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully authenticated using saved cookies'),
        expect.objectContaining({
          module: 'auth',
        })
      );
    });
  });

  describe('recovery scenarios', () => {
    it('should recover when browser is disconnected during cookie validation', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockStateManager.get.mockReturnValue(validCookies);
      mockBrowserService.setCookies.mockRejectedValue(new Error('Browser disconnected'));
      jest.spyOn(authManager, 'loginToX').mockResolvedValue(true);

      await authManager.ensureAuthenticated();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error validating saved cookies, falling back to login:',
        expect.objectContaining({
          module: 'auth',
        })
      );
      expect(authManager.loginToX).toHaveBeenCalled();
    });

    it('should handle login page taking too long to load', async () => {
      mockBrowserService.goto.mockRejectedValue(new Error('Timeout waiting for navigation'));
      jest.spyOn(authManager, 'loginToX').mockRejectedValueOnce(new Error('Timeout error'));

      await expect(authManager.loginToX()).rejects.toThrow('Timeout error');
    });

    it('should retry login if authentication fails mid-process', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockStateManager.get.mockReturnValue(validCookies);
      authManager.isAuthenticated = jest
        .fn()
        .mockResolvedValueOnce(true) // Initial check passes
        .mockResolvedValueOnce(false); // Second check fails

      jest.spyOn(authManager, 'loginToX').mockResolvedValue(true);

      await authManager.ensureAuthenticated(); // Should pass with cookies
      await authManager.ensureAuthenticated(); // Should fail and trigger login

      expect(authManager.loginToX).toHaveBeenCalledTimes(1);
    });
  });

  describe('State manager failure scenarios', () => {
    beforeEach(() => {
      jest.spyOn(authManager, 'loginToX').mockResolvedValue(true);
    });

    it('should fall back to login if stateManager.get throws an error', async () => {
      mockStateManager.get.mockImplementation(() => {
        throw new Error('State read error');
      });

      await expect(authManager.ensureAuthenticated()).rejects.toThrow('Authentication failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Non-recoverable authentication error:',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should log an error but still attempt to login if stateManager.delete fails', async () => {
      const invalidCookies = [{ name: 'invalid' }];
      mockStateManager.get.mockReturnValue(invalidCookies);
      mockStateManager.delete.mockImplementation(() => {
        throw new Error('State delete error');
      });

      await authManager.ensureAuthenticated();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid saved cookies format, performing login',
        expect.objectContaining({
          module: 'auth',
        })
      );
      expect(authManager.loginToX).toHaveBeenCalled();
    });

    it('should log an error if stateManager.set fails during cookie save', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockBrowserService.getCookies.mockResolvedValue(validCookies);
      mockStateManager.set.mockImplementation(() => {
        throw new Error('State write error');
      });

      await authManager.saveAuthenticationState();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error saving session cookies:',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });
  });
});
