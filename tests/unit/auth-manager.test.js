import { jest } from '@jest/globals';
import { XAuthManager } from '../../src/application/x-auth-manager.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('XAuthManager', () => {
  let xAuthManager;
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
      getContent: jest.fn().mockResolvedValue('<html>Password login form</html>'),
      getUrl: jest.fn().mockResolvedValue('https://x.com/i/flow/login'),
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
      get: jest.fn().mockImplementation(key => {
        const config = {
          TWITTER_EMAIL: 'test@example.com',
          TWITTER_PHONE: '+1234567890',
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

    xAuthManager = new XAuthManager(dependencies);
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(xAuthManager.browser).toBe(mockBrowserService);
      expect(xAuthManager.config).toBe(mockConfig);
      expect(xAuthManager.state).toBe(mockStateManager);
      expect(xAuthManager.logger).toEqual(expect.objectContaining({ moduleName: 'auth' }));
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

      expect(xAuthManager.validateCookieFormat(validCookies)).toBe(true);
    });

    it('should return false for empty array', () => {
      expect(xAuthManager.validateCookieFormat([])).toBe(false);
    });

    it('should return false for non-array input', () => {
      expect(xAuthManager.validateCookieFormat(null)).toBe(false);
      expect(xAuthManager.validateCookieFormat('not-array')).toBe(false);
      expect(xAuthManager.validateCookieFormat({})).toBe(false);
    });

    it('should return false for array with invalid cookie objects', () => {
      const invalidCookies = [
        { name: 'session' }, // Missing value
        { value: 'abc123' }, // Missing name
        { name: 123, value: 'abc123' }, // Invalid name type
        { name: 'session', value: 456 }, // Invalid value type
      ];

      expect(xAuthManager.validateCookieFormat([invalidCookies[0]])).toBe(false);
      expect(xAuthManager.validateCookieFormat([invalidCookies[1]])).toBe(false);
      expect(xAuthManager.validateCookieFormat([invalidCookies[2]])).toBe(false);
      expect(xAuthManager.validateCookieFormat([invalidCookies[3]])).toBe(false);
    });

    it('should return false if any cookie in array is invalid', () => {
      const mixedCookies = [
        { name: 'valid', value: 'abc123' },
        { name: 'invalid' }, // Missing value
      ];

      expect(xAuthManager.validateCookieFormat(mixedCookies)).toBe(false);
    });

    it('should reject cookies with suspicious script patterns', () => {
      const suspiciousCookies = [
        { name: 'session', value: '<script>alert("xss")</script>' },
        { name: '<iframe src="evil"></iframe>', value: 'value' },
        { name: 'session', value: 'javascript' + ':alert(1)' },
        { name: 'eval(malicious)', value: 'normal' },
      ];

      suspiciousCookies.forEach(cookie => {
        expect(xAuthManager.validateCookieFormat([cookie])).toBe(false);
      });
    });

    it('should reject cookies with DOM manipulation patterns', () => {
      const domManipulationCookies = [
        { name: 'session', value: 'document.write("hack")' },
        { name: 'window.location', value: 'evil.com' },
        { name: 'session', value: 'vbscript:msgbox(1)' },
      ];

      domManipulationCookies.forEach(cookie => {
        expect(xAuthManager.validateCookieFormat([cookie])).toBe(false);
      });
    });

    it('should reject cookies with path traversal patterns', () => {
      const pathTraversalCookies = [
        { name: 'session', value: '../../../etc/passwd' },
        { name: '..\\windows\\system32', value: 'value' },
        { name: 'session', value: '$(cat /etc/hosts)' },
        { name: 'command', value: '`ls -la`' },
      ];

      pathTraversalCookies.forEach(cookie => {
        expect(xAuthManager.validateCookieFormat([cookie])).toBe(false);
      });
    });

    it('should reject cookies with data URLs', () => {
      const dataUrlCookies = [
        { name: 'session', value: 'data:text/html,<script>alert(1)</script>' },
        { name: 'session', value: 'data:text/html,malicious_content' },
      ];

      // Test each cookie individually to ensure proper failure detection
      expect(xAuthManager.validateCookieFormat([dataUrlCookies[0]])).toBe(false);
      expect(xAuthManager.validateCookieFormat([dataUrlCookies[1]])).toBe(false);
    });

    it('should accept cookies with normal special characters', () => {
      const normalCookies = [
        { name: 'session_id', value: 'abc-123_def.456' },
        { name: 'auth-token', value: 'Bearer eyJhbGciOiJIUzI1NiJ9' },
        { name: 'csrf', value: 'random+token/with=special&chars' },
        { name: 'tracking', value: 'utm_source=google&utm_medium=cpc' },
      ];

      expect(xAuthManager.validateCookieFormat(normalCookies)).toBe(true);
    });

    it('should handle edge cases with empty strings', () => {
      const edgeCaseCookies = [
        { name: '', value: 'value' }, // Empty name
        { name: 'name', value: '' }, // Empty value
        { name: ' ', value: 'value' }, // Whitespace name
        { name: 'name', value: ' ' }, // Whitespace value
      ];

      // All of these should be considered valid format (empty strings are valid)
      edgeCaseCookies.forEach(cookie => {
        expect(xAuthManager.validateCookieFormat([cookie])).toBe(true);
      });
    });

    it('should handle null and undefined cookie objects', () => {
      const nullCookies = [
        null,
        undefined,
        { name: null, value: 'value' },
        { name: 'name', value: null },
        { name: undefined, value: 'value' },
        { name: 'name', value: undefined },
      ];

      nullCookies.forEach(cookie => {
        expect(xAuthManager.validateCookieFormat([cookie])).toBe(false);
      });
    });

    it('should validate large cookie arrays efficiently', () => {
      const largeCookieArray = Array.from({ length: 100 }, (_, i) => ({
        name: `cookie_${i}`,
        value: `value_${i}`,
      }));

      expect(xAuthManager.validateCookieFormat(largeCookieArray)).toBe(true);

      // Add one malicious cookie
      largeCookieArray.push({ name: 'evil', value: '<script>alert(1)</script>' });
      expect(xAuthManager.validateCookieFormat(largeCookieArray)).toBe(false);
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

      // Mock current URL not on home page, so navigation will occur
      mockBrowserService.getUrl
        .mockResolvedValueOnce('https://x.com/i/flow/login') // First call - not on home page
        .mockResolvedValueOnce('https://x.com/home'); // Second call - after navigation

      const result = await xAuthManager.isAuthenticated();

      expect(result).toBe(true);
      expect(mockBrowserService.getCookies).toHaveBeenCalled();
      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://x.com/home', {
        timeout: 10000,
        waitUntil: 'domcontentloaded',
      });
      expect(mockBrowserService.getUrl).toHaveBeenCalledTimes(2);
    });

    it('should return false when valid cookies are not present', async () => {
      // Mock missing or invalid cookies
      mockBrowserService.getCookies.mockResolvedValue([{ name: 'other_cookie', value: 'some_value' }]);

      const result = await xAuthManager.isAuthenticated();

      expect(result).toBe(false);
      expect(mockBrowserService.getCookies).toHaveBeenCalled();
    });

    it('should return false and log warning on cookie check error', async () => {
      const error = new Error('Cookie check failed');
      mockBrowserService.getCookies.mockRejectedValue(error);

      const result = await xAuthManager.isAuthenticated();

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Error checking authentication status:',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should return false if browser or page is not available', async () => {
      xAuthManager.browser = { ...mockBrowserService, page: null };
      let result = await xAuthManager.isAuthenticated();
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Browser service or page not available for authentication check.',
        expect.objectContaining({
          module: 'auth',
        })
      );

      xAuthManager.browser = null;
      result = await xAuthManager.isAuthenticated();
      expect(result).toBe(false);
    });
  });

  describe('clickNextButton', () => {
    it('should click the Next button', async () => {
      await xAuthManager.clickNextButton();

      expect(mockBrowserService.click).toHaveBeenCalledWith('button:has-text("Next")');
    });
  });

  describe('clickLoginButton', () => {
    it('should click the Login button', async () => {
      await xAuthManager.clickLoginButton();

      expect(mockBrowserService.click).toHaveBeenCalledWith('button[data-testid="LoginForm_Login_Button"]');
    });
  });

  describe('saveAuthenticationState', () => {
    it('should save valid cookies to state', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockBrowserService.getCookies.mockResolvedValue(validCookies);

      await xAuthManager.saveAuthenticationState();

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

      await xAuthManager.saveAuthenticationState();

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

      await xAuthManager.saveAuthenticationState();

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
      const clickNextButtonSpy = jest.spyOn(xAuthManager, 'clickNextButton').mockResolvedValue();
      const clickLoginButtonSpy = jest.spyOn(xAuthManager, 'clickLoginButton').mockResolvedValue();
      const saveAuthStateSpy = jest.spyOn(xAuthManager, 'saveAuthenticationState').mockResolvedValue();
      jest.spyOn(xAuthManager, 'isAuthenticated').mockResolvedValue(true);

      jest.useFakeTimers();

      const loginPromise = xAuthManager.loginToX();

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
      // Mock all intermediate steps to succeed but final authentication to fail
      jest
        .spyOn(xAuthManager, 'isAuthenticated')
        .mockResolvedValueOnce(false) // Initial check
        .mockResolvedValueOnce(false) // First retry
        .mockResolvedValueOnce(false) // Second retry
        .mockResolvedValueOnce(false); // Third retry
      jest.spyOn(xAuthManager, 'clickNextButton').mockResolvedValue();
      jest.spyOn(xAuthManager, 'clickLoginButton').mockResolvedValue();
      jest.spyOn(xAuthManager, 'saveAuthenticationState').mockResolvedValue();
      jest
        .spyOn(xAuthManager, 'waitForSelectorWithFallback')
        .mockResolvedValueOnce('input[name="text"]')
        .mockResolvedValueOnce('input[name="password"]');
      jest.spyOn(xAuthManager, 'handleUnusualLoginChallenge').mockResolvedValue(false);

      await expect(xAuthManager.loginToX()).rejects.toThrow('Authentication failed');
    });

    it('should handle browser interaction errors', async () => {
      mockBrowserService.type.mockRejectedValue(new Error('Type error'));

      await expect(xAuthManager.loginToX()).rejects.toThrow('Type error');
    });
  });

  describe('ensureAuthenticated', () => {
    beforeEach(() => {
      jest.spyOn(xAuthManager, 'isAuthenticated').mockResolvedValue(true);
      jest.spyOn(xAuthManager, 'loginToX').mockResolvedValue(true);
    });

    it('should use saved cookies when available and valid', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockStateManager.get.mockReturnValue(validCookies);

      await xAuthManager.ensureAuthenticated();

      expect(mockBrowserService.setCookies).toHaveBeenCalledWith(validCookies);
      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://x.com/home', { waitUntil: 'domcontentloaded' });
      expect(xAuthManager.loginToX).not.toHaveBeenCalled();
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

      await xAuthManager.ensureAuthenticated();

      expect(mockStateManager.delete).toHaveBeenCalledWith('x_session_cookies');
      expect(xAuthManager.loginToX).toHaveBeenCalled();
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
      xAuthManager.isAuthenticated.mockResolvedValue(false);

      await xAuthManager.ensureAuthenticated();

      expect(mockStateManager.delete).toHaveBeenCalledWith('x_session_cookies');
      expect(xAuthManager.loginToX).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Saved cookies failed, attempting login',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should perform login when no saved cookies', async () => {
      mockStateManager.get.mockReturnValue(null);

      await xAuthManager.ensureAuthenticated();

      expect(xAuthManager.loginToX).toHaveBeenCalled();
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

      await xAuthManager.ensureAuthenticated();

      expect(xAuthManager.loginToX).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error validating saved cookies, falling back to login:',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should throw error when entire authentication process fails', async () => {
      mockStateManager.get.mockReturnValue(null);
      xAuthManager.loginToX.mockRejectedValue(new Error('Login failed'));

      await expect(xAuthManager.ensureAuthenticated()).rejects.toThrow('Authentication failed');
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

      await xAuthManager.ensureAuthenticated();

      expect(xAuthManager.loginToX).toHaveBeenCalled();
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
          new XAuthManager({
            browserService: mockBrowserService,
            config: mockConfig,
            stateManager: mockStateManager,
            logger: mockLogger,
          })
      ).toThrow('Missing required config: TWITTER_USERNAME');
    });

    it('should handle browser service being unavailable', async () => {
      xAuthManager.browser = null;

      // The new implementation should not throw, but return false and log.
      const result = await xAuthManager.isAuthenticated();
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Browser service or page not available for authentication check.',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should handle timeout errors during login', async () => {
      jest.spyOn(xAuthManager, 'isAuthenticated').mockResolvedValue(false);
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Timeout'));

      await expect(xAuthManager.loginToX()).rejects.toThrow('Could not find element with any of the selectors');
    });

    it('should handle network errors during navigation', async () => {
      jest
        .spyOn(xAuthManager, 'waitForSelectorWithFallback')
        .mockResolvedValueOnce('input[name="text"]')
        .mockResolvedValueOnce('input[name="password"]');
      jest.spyOn(xAuthManager, 'handleUnusualLoginChallenge').mockResolvedValue(false);
      jest.spyOn(xAuthManager, 'clickNextButton').mockResolvedValue();
      jest.spyOn(xAuthManager, 'clickLoginButton').mockResolvedValue();
      mockBrowserService.waitForNavigation.mockRejectedValue(new Error('Network error'));

      await expect(xAuthManager.loginToX()).rejects.toThrow('Network error');
    });

    it('should handle malformed cookies in state gracefully', async () => {
      mockStateManager.get.mockReturnValue('not-an-array');
      jest.spyOn(xAuthManager, 'loginToX').mockResolvedValue(true);

      await xAuthManager.ensureAuthenticated();

      expect(xAuthManager.loginToX).toHaveBeenCalled();
    });
  });

  describe('integration scenarios', () => {
    it('should handle rapid authentication requests', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockStateManager.get.mockReturnValue(validCookies);
      jest.spyOn(xAuthManager, 'isAuthenticated').mockResolvedValue(true);

      const promises = Array.from({ length: 5 }, () => xAuthManager.ensureAuthenticated());

      await Promise.all(promises);

      expect(mockBrowserService.setCookies).toHaveBeenCalledTimes(5);
    });

    it('should handle authentication state changes during process', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockStateManager.get.mockReturnValue(validCookies);

      // First call succeeds, second fails
      xAuthManager.isAuthenticated = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      jest.spyOn(xAuthManager, 'loginToX').mockResolvedValue(true);

      await xAuthManager.ensureAuthenticated();

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
      jest.spyOn(xAuthManager, 'loginToX').mockResolvedValue(true);

      await xAuthManager.ensureAuthenticated();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error validating saved cookies, falling back to login:',
        expect.objectContaining({
          module: 'auth',
        })
      );
      expect(xAuthManager.loginToX).toHaveBeenCalled();
    });

    it('should handle login page taking too long to load', async () => {
      mockBrowserService.goto.mockRejectedValue(new Error('Timeout waiting for navigation'));
      jest.spyOn(xAuthManager, 'loginToX').mockRejectedValueOnce(new Error('Timeout error'));

      await expect(xAuthManager.loginToX()).rejects.toThrow('Timeout error');
    });

    it('should retry login if authentication fails mid-process', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockStateManager.get.mockReturnValue(validCookies);
      xAuthManager.isAuthenticated = jest
        .fn()
        .mockResolvedValueOnce(true) // Initial check passes
        .mockResolvedValueOnce(false); // Second check fails

      jest.spyOn(xAuthManager, 'loginToX').mockResolvedValue(true);

      await xAuthManager.ensureAuthenticated(); // Should pass with cookies
      await xAuthManager.ensureAuthenticated(); // Should fail and trigger login

      expect(xAuthManager.loginToX).toHaveBeenCalledTimes(1);
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
      const delayPromise = xAuthManager.delay(1000);

      // Fast-forward time
      jest.advanceTimersByTime(1000);

      await expect(delayPromise).resolves.toBeUndefined();
    });

    it('should handle zero delay', async () => {
      const delayPromise = xAuthManager.delay(0);

      jest.advanceTimersByTime(0);

      await expect(delayPromise).resolves.toBeUndefined();
    });
  });

  describe('clearSensitiveData method', () => {
    it('should clear all sensitive credential data', () => {
      // Verify credentials are initially set
      expect(xAuthManager.twitterUsername).toBe('test_user');
      expect(xAuthManager.twitterPassword).toBe('test_password');

      xAuthManager.clearSensitiveData();

      expect(xAuthManager.twitterUsername).toBeNull();
      expect(xAuthManager.twitterPassword).toBeNull();
      expect(xAuthManager.twitterEmail).toBeNull();
      expect(xAuthManager.twitterPhone).toBeNull();
    });

    it('should not throw if credentials were already cleared', () => {
      xAuthManager.clearSensitiveData();

      expect(() => xAuthManager.clearSensitiveData()).not.toThrow();
    });
  });

  describe('sanitizeErrorMessage method', () => {
    beforeEach(() => {
      // Restore config mocks to return actual values for sanitization testing
      mockConfig.getRequired.mockImplementation(key => {
        const config = {
          TWITTER_USERNAME: 'test_user',
          TWITTER_PASSWORD: 'secret_password_123',
        };
        return config[key];
      });
      mockConfig.get.mockImplementation(key => {
        const config = {
          TWITTER_EMAIL: 'test@example.com',
          TWITTER_PHONE: '+1234567890',
        };
        return config[key];
      });
    });

    it('should remove username from error messages', () => {
      const errorMessage = 'Login failed for user test_user with timeout';
      const sanitized = xAuthManager.sanitizeErrorMessage(errorMessage);

      expect(sanitized).toBe('Login failed for user [REDACTED_USERNAME] with timeout');
      expect(sanitized).not.toContain('test_user');
    });

    it('should remove password from error messages', () => {
      const errorMessage = 'Authentication failed with password secret_password_123';
      const sanitized = xAuthManager.sanitizeErrorMessage(errorMessage);

      expect(sanitized).toBe('Authentication failed with password [REDACTED_PASSWORD]');
      expect(sanitized).not.toContain('secret_password_123');
    });

    it('should remove email from error messages', () => {
      const errorMessage = 'Email verification failed for test@example.com';
      const sanitized = xAuthManager.sanitizeErrorMessage(errorMessage);

      expect(sanitized).toBe('Email verification failed for [REDACTED_EMAIL]');
      expect(sanitized).not.toContain('test@example.com');
    });

    it('should remove phone from error messages', () => {
      const errorMessage = 'Phone verification sent to +1234567890';
      const sanitized = xAuthManager.sanitizeErrorMessage(errorMessage);

      expect(sanitized).toBe('Phone verification sent to [REDACTED_PHONE]');
      expect(sanitized).not.toContain('+1234567890');
    });

    it('should handle non-string input gracefully', () => {
      expect(xAuthManager.sanitizeErrorMessage(null)).toBe('An unknown error occurred');
      expect(xAuthManager.sanitizeErrorMessage(undefined)).toBe('An unknown error occurred');
      expect(xAuthManager.sanitizeErrorMessage(123)).toBe('An unknown error occurred');
      expect(xAuthManager.sanitizeErrorMessage({})).toBe('An unknown error occurred');
    });

    it('should handle error messages with special regex characters', () => {
      // Test username with special characters that need escaping
      mockConfig.getRequired.mockImplementation(key => {
        const config = {
          TWITTER_USERNAME: 'user.test+123',
          TWITTER_PASSWORD: 'pass[word]',
        };
        return config[key];
      });

      const errorMessage = 'Login failed for user.test+123 with pass[word]';
      const sanitized = xAuthManager.sanitizeErrorMessage(errorMessage);

      expect(sanitized).toBe('Login failed for [REDACTED_USERNAME] with [REDACTED_PASSWORD]');
      expect(sanitized).not.toContain('user.test+123');
      expect(sanitized).not.toContain('pass[word]');
    });

    it('should handle multiple occurrences of the same credential', () => {
      const errorMessage = 'test_user login failed, retry for test_user again';
      const sanitized = xAuthManager.sanitizeErrorMessage(errorMessage);

      expect(sanitized).toBe('[REDACTED_USERNAME] login failed, retry for [REDACTED_USERNAME] again');
      expect(sanitized).not.toContain('test_user');
    });
  });

  describe('isRecoverableError method', () => {
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
        expect(xAuthManager.isRecoverableError(error)).toBe(true);
      });
    });

    it('should identify non-recoverable challenge errors', () => {
      const nonRecoverableErrors = [
        new Error('Unusual login activity challenge detected, but no email or phone number configured'),
        new Error('Challenge form filled but could not find continue button'),
        new Error('Challenge detected but no verification credentials available'),
      ];

      nonRecoverableErrors.forEach(error => {
        expect(xAuthManager.isRecoverableError(error)).toBe(false);
      });
    });

    it('should identify non-recoverable authentication errors', () => {
      const nonRecoverableErrors = [
        new Error('Invalid credentials provided'),
        new Error('Account suspended'),
        new Error('Access denied'),
        new Error('Authentication method not supported'),
      ];

      nonRecoverableErrors.forEach(error => {
        expect(xAuthManager.isRecoverableError(error)).toBe(false);
      });
    });

    it('should handle case-insensitive error matching', () => {
      const mixedCaseErrors = [
        new Error('NETWORK ERROR OCCURRED'),
        new Error('Connection TIMEOUT'),
        new Error('unusual LOGIN activity challenge detected'),
      ];

      expect(xAuthManager.isRecoverableError(mixedCaseErrors[0])).toBe(true);
      expect(xAuthManager.isRecoverableError(mixedCaseErrors[1])).toBe(true);
      expect(xAuthManager.isRecoverableError(mixedCaseErrors[2])).toBe(false);
    });
  });

  describe('waitForSelectorWithFallback method', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return first successful selector', async () => {
      const selectors = ['input[name="username"]', 'input[type="text"]', 'input.username'];
      mockBrowserService.waitForSelector.mockResolvedValueOnce();

      const result = await xAuthManager.waitForSelectorWithFallback(selectors);

      expect(result).toBe('input[name="username"]');
      expect(mockBrowserService.waitForSelector).toHaveBeenCalledWith(
        'input[name="username"]',
        { timeout: 3333 } // 10000ms / 3 selectors = 3333ms per selector
      );
    });

    it('should try multiple selectors until one succeeds', async () => {
      const selectors = ['input[name="username"]', 'input[type="text"]', 'input.username'];
      mockBrowserService.waitForSelector.mockRejectedValueOnce(new Error('Selector not found')).mockResolvedValueOnce();

      const result = await xAuthManager.waitForSelectorWithFallback(selectors);

      expect(result).toBe('input[type="text"]');
      expect(mockBrowserService.waitForSelector).toHaveBeenCalledTimes(2);
    });

    it('should throw error when all selectors fail', async () => {
      const selectors = ['input[name="username"]', 'input[type="text"]'];
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector not found'));

      await expect(xAuthManager.waitForSelectorWithFallback(selectors)).rejects.toThrow(
        'Could not find element with any of the selectors: input[name="username"], input[type="text"]'
      );

      expect(mockBrowserService.waitForSelector).toHaveBeenCalledTimes(2);
    });

    it('should provide debug information for password selectors', async () => {
      const passwordSelectors = ['input[name="password"]', 'input[type="password"]'];
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector not found'));
      mockBrowserService.getUrl.mockResolvedValue('https://x.com/login');
      mockBrowserService.getContent.mockResolvedValue('<html><input type="text"><input type="email"></html>');

      await expect(xAuthManager.waitForSelectorWithFallback(passwordSelectors)).rejects.toThrow(
        'Could not find element with any of the selectors'
      );

      // Verify debug information was gathered
      expect(mockBrowserService.getUrl).toHaveBeenCalled();
      expect(mockBrowserService.getContent).toHaveBeenCalled();
    });

    it('should handle debug information failures gracefully', async () => {
      const passwordSelectors = ['input[name="password"]'];
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector not found'));
      mockBrowserService.getUrl.mockRejectedValue(new Error('Debug failed'));

      await expect(xAuthManager.waitForSelectorWithFallback(passwordSelectors)).rejects.toThrow(
        'Could not find element with any of the selectors'
      );

      // Should still attempt to get debug info even if it fails
      expect(mockBrowserService.getUrl).toHaveBeenCalled();
    });

    it('should respect minimum time per selector', async () => {
      const selectors = ['input[name="username"]'];
      const shortTimeout = 2000; // Less than minimum 3000ms
      mockBrowserService.waitForSelector.mockResolvedValue();

      await xAuthManager.waitForSelectorWithFallback(selectors, { timeout: shortTimeout });

      // Should use minimum time of 3000ms, not the calculated 2000ms
      expect(mockBrowserService.waitForSelector).toHaveBeenCalledWith('input[name="username"]', { timeout: 3000 });
    });

    it('should distribute time evenly among selectors', async () => {
      const selectors = ['input[name="username"]', 'input[type="text"]', 'input.username', 'input#username'];
      const totalTimeout = 12000;
      mockBrowserService.waitForSelector.mockResolvedValue();

      await xAuthManager.waitForSelectorWithFallback(selectors, { timeout: totalTimeout });

      // 12000ms / 4 selectors = 3000ms per selector
      expect(mockBrowserService.waitForSelector).toHaveBeenCalledWith('input[name="username"]', { timeout: 3000 });
    });
  });

  describe('ensureAuthenticated retry logic', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should retry authentication with exponential backoff', async () => {
      mockStateManager.get.mockReturnValue(null);
      jest
        .spyOn(xAuthManager, 'loginToX')
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(true);

      const ensureAuthPromise = xAuthManager.ensureAuthenticated({ maxRetries: 3, baseDelay: 1000 });

      // Advance through the delays: 1000ms, 2000ms exponential backoff
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);

      await ensureAuthPromise;

      expect(xAuthManager.loginToX).toHaveBeenCalledTimes(3);
    }, 10000);

    it('should fail after max retries exceeded', async () => {
      mockStateManager.get.mockReturnValue(null);
      const networkError = new Error('Network timeout');
      jest.spyOn(xAuthManager, 'loginToX').mockRejectedValue(networkError);

      // Mock delay to avoid actual waiting
      jest.spyOn(xAuthManager, 'delay').mockResolvedValue();

      await expect(xAuthManager.ensureAuthenticated({ maxRetries: 2, baseDelay: 10 })).rejects.toThrow(
        'Authentication failed'
      );
      expect(xAuthManager.loginToX).toHaveBeenCalledTimes(2);
    });

    it('should fail immediately on non-recoverable errors', async () => {
      mockStateManager.get.mockReturnValue(null);
      jest
        .spyOn(xAuthManager, 'loginToX')
        .mockRejectedValue(new Error('unusual login activity challenge detected, but no email configured'));

      await expect(xAuthManager.ensureAuthenticated({ maxRetries: 3 })).rejects.toThrow('Authentication failed');

      // Should only try once for non-recoverable errors
      expect(xAuthManager.loginToX).toHaveBeenCalledTimes(1);
    });

    it('should handle state manager errors during cookie cleanup', async () => {
      const invalidCookies = [{ name: 'invalid' }];
      mockStateManager.get.mockReturnValue(invalidCookies);
      mockStateManager.delete.mockImplementation(() => {
        throw new Error('State delete failed');
      });
      jest.spyOn(xAuthManager, 'loginToX').mockResolvedValue(true);

      await xAuthManager.ensureAuthenticated();

      // Should continue with login despite state cleanup failure
      expect(xAuthManager.loginToX).toHaveBeenCalled();
    });
  });

  describe('isAuthenticated advanced scenarios', () => {
    beforeEach(() => {
      mockBrowserService.getCookies = jest.fn();
      mockBrowserService.getUrl = jest.fn();
      mockBrowserService.goto = jest.fn();
    });

    it('should handle alternative authentication mechanisms', async () => {
      // Mock alternative auth with ct0 + twid instead of auth_token
      mockBrowserService.getCookies.mockResolvedValue([
        { name: 'ct0', value: 'valid_ct0_token' },
        { name: 'twid', value: 'valid_twid_token' },
        { name: 'other1', value: 'value1' },
        { name: 'other2', value: 'value2' },
        { name: 'other3', value: 'value3' },
        { name: 'other4', value: 'value4' }, // 6 total cookies to trigger alternative auth
      ]);

      mockBrowserService.getUrl
        .mockResolvedValueOnce('https://x.com/login')
        .mockResolvedValueOnce('https://x.com/home');

      const result = await xAuthManager.isAuthenticated();

      expect(result).toBe(true);
      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://x.com/home', {
        timeout: 10000,
        waitUntil: 'domcontentloaded',
      });
    });

    it('should skip navigation if already on home page', async () => {
      mockBrowserService.getCookies.mockResolvedValue([
        { name: 'auth_token', value: 'valid_token' },
        { name: 'ct0', value: 'valid_ct0' },
      ]);

      mockBrowserService.getUrl.mockResolvedValueOnce('https://x.com/home').mockResolvedValueOnce('https://x.com/home');

      const result = await xAuthManager.isAuthenticated();

      expect(result).toBe(true);
      expect(mockBrowserService.goto).not.toHaveBeenCalled();
    });

    it('should detect login page redirect as authentication failure', async () => {
      mockBrowserService.getCookies.mockResolvedValue([
        { name: 'auth_token', value: 'expired_token' },
        { name: 'ct0', value: 'expired_ct0' },
      ]);

      mockBrowserService.getUrl
        .mockResolvedValueOnce('https://x.com/profile')
        .mockResolvedValueOnce('https://x.com/i/flow/login'); // Redirected to login

      const result = await xAuthManager.isAuthenticated();

      expect(result).toBe(false);
    });

    it('should handle navigation errors gracefully with valid cookies', async () => {
      mockBrowserService.getCookies.mockResolvedValue([
        { name: 'auth_token', value: 'valid_token' },
        { name: 'ct0', value: 'valid_ct0' },
      ]);

      mockBrowserService.getUrl.mockResolvedValue('https://x.com/profile');
      mockBrowserService.goto.mockRejectedValue(new Error('Navigation failed'));

      const result = await xAuthManager.isAuthenticated();

      // Should return true because cookies are present, even if navigation fails
      expect(result).toBe(true);
    });

    it('should provide detailed logging for authentication checks', async () => {
      mockBrowserService.getCookies.mockResolvedValue([
        { name: 'auth_token', value: 'valid_token' },
        { name: 'ct0', value: 'valid_ct0' },
        { name: 'other', value: 'other_value' },
      ]);

      mockBrowserService.getUrl
        .mockResolvedValueOnce('https://x.com/profile')
        .mockResolvedValueOnce('https://x.com/home');

      const result = await xAuthManager.isAuthenticated();

      expect(result).toBe(true);

      // Verify enhanced logger operations were called with proper metadata
      const enhancedLogger = xAuthManager.logger;
      const startOperationSpy = jest.spyOn(enhancedLogger, 'startOperation');

      // Call again to verify logging
      await xAuthManager.isAuthenticated();

      expect(startOperationSpy).toHaveBeenCalledWith(
        'isAuthenticated',
        expect.objectContaining({
          hasBrowser: true,
          hasPage: true,
        })
      );
    });
  });

  describe('State manager failure scenarios', () => {
    beforeEach(() => {
      jest.spyOn(xAuthManager, 'loginToX').mockResolvedValue(true);
    });

    it('should fall back to login if stateManager.get throws an error', async () => {
      mockStateManager.get.mockImplementation(() => {
        throw new Error('State read error');
      });

      await expect(xAuthManager.ensureAuthenticated()).rejects.toThrow('Authentication failed');

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

      await xAuthManager.ensureAuthenticated();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid saved cookies format, performing login',
        expect.objectContaining({
          module: 'auth',
        })
      );
      expect(xAuthManager.loginToX).toHaveBeenCalled();
    });

    it('should log an error if stateManager.set fails during cookie save', async () => {
      const validCookies = [{ name: 'session', value: 'abc123' }];
      mockBrowserService.getCookies.mockResolvedValue(validCookies);
      mockStateManager.set.mockImplementation(() => {
        throw new Error('State write error');
      });

      await xAuthManager.saveAuthenticationState();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error saving session cookies:',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });
  });

  describe('unusual login activity challenge handling', () => {
    beforeEach(() => {
      // Mock successful base authentication methods
      jest.spyOn(xAuthManager, 'isAuthenticated').mockResolvedValue(true);
      jest.spyOn(xAuthManager, 'saveAuthenticationState').mockResolvedValue();
      jest.spyOn(xAuthManager, 'clickNextButton').mockResolvedValue();
      jest.spyOn(xAuthManager, 'clickLoginButton').mockResolvedValue();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should handle no challenge detected successfully', async () => {
      // Mock no challenge indicators found
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector not found'));
      mockBrowserService.getContent.mockResolvedValue('<html>Regular password form</html>');

      const result = await xAuthManager.handleUnusualLoginChallenge();

      expect(result).toBe(false);
    });

    it('should handle email challenge with email configured', async () => {
      // Mock challenge detected
      mockBrowserService.waitForSelector
        .mockResolvedValueOnce() // Challenge selector found
        .mockResolvedValueOnce() // Verification input found
        .mockResolvedValueOnce(); // Continue button found

      mockBrowserService.getContent.mockResolvedValue(
        "<html>Help us verify it's you. Please enter your email address</html>"
      );

      const challengePromise = xAuthManager.handleUnusualLoginChallenge();

      // Advance timers for internal delays
      await jest.advanceTimersByTimeAsync(5000);

      const result = await challengePromise;

      expect(result).toBe(true);
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[name="text"]', 'test@example.com');
      expect(mockBrowserService.click).toHaveBeenCalled();
    });

    it('should handle phone challenge with phone configured', async () => {
      // Mock config with only phone
      mockConfig.get.mockImplementation(key => {
        const config = {
          TWITTER_PHONE: '+1234567890',
        };
        return config[key];
      });

      // Mock challenge detected
      mockBrowserService.waitForSelector
        .mockResolvedValueOnce() // Challenge selector found
        .mockResolvedValueOnce() // Verification input found
        .mockResolvedValueOnce(); // Continue button found

      mockBrowserService.getContent.mockResolvedValue(
        "<html>Help us verify it's you. Please enter your phone number</html>"
      );

      const challengePromise = xAuthManager.handleUnusualLoginChallenge();

      // Advance timers for internal delays
      await jest.advanceTimersByTimeAsync(5000);

      const result = await challengePromise;

      expect(result).toBe(true);
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[name="text"]', '+1234567890');
      expect(mockBrowserService.click).toHaveBeenCalled();
    });

    it('should throw error when challenge detected but no credentials configured', async () => {
      // Create a fresh XAuthManager instance with no email/phone configured
      const configWithoutCredentials = {
        getRequired: jest.fn().mockImplementation(key => {
          const config = {
            TWITTER_USERNAME: 'test_user',
            TWITTER_PASSWORD: 'test_password',
          };
          return config[key];
        }),
        get: jest.fn().mockReturnValue(null), // No email or phone
      };

      const xAuthManagerNoCredentials = new XAuthManager({
        browserService: mockBrowserService,
        config: configWithoutCredentials,
        stateManager: mockStateManager,
        logger: mockLogger,
        debugManager: jest.fn(),
        metricsManager: jest.fn(),
      });

      // Mock challenge detected - use explicit mock implementation to avoid fallback issues
      let callCount = 0;
      mockBrowserService.waitForSelector.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve();
        } // Challenge selector found
        if (callCount === 2) {
          return Promise.resolve('input[name="text"]');
        } // Verification input found
        return Promise.reject(new Error('Selector not found')); // Other selectors fail
      });

      mockBrowserService.getContent.mockResolvedValue(
        "<html>Help us verify it's you. Please enter your email address</html>"
      );

      // This test should fail when checking for credentials
      await expect(xAuthManagerNoCredentials.handleUnusualLoginChallenge()).rejects.toThrow(
        'Unusual login activity challenge detected, but no email or phone number configured for verification'
      );
    }, 15000); // Increase timeout for this test

    it('should throw error when continue button cannot be found', async () => {
      // Mock challenge detected and form filled, but no continue button
      mockBrowserService.waitForSelector
        .mockResolvedValueOnce() // Challenge selector found
        .mockResolvedValueOnce() // Verification input found
        .mockRejectedValue(new Error('Continue button not found')); // All continue selectors fail

      mockBrowserService.getContent.mockResolvedValue(
        "<html>Help us verify it's you. Please enter your email address</html>"
      );

      const challengePromise = xAuthManager.handleUnusualLoginChallenge();

      await expect(challengePromise).rejects.toThrow(
        'Could not find continue button after filling verification challenge'
      );
    }, 10000);

    it('should be called during loginToX flow', async () => {
      const challengeSpy = jest.spyOn(xAuthManager, 'handleUnusualLoginChallenge').mockResolvedValue(false);

      const loginPromise = xAuthManager.loginToX();

      // Advance timers for internal delays in loginToX
      await jest.advanceTimersByTimeAsync(10000);

      await loginPromise;

      expect(challengeSpy).toHaveBeenCalled();
    }, 15000);

    it('should recognize challenge errors as non-recoverable', () => {
      const challengeError = new Error(
        'Unusual login activity challenge detected, but no email or phone number configured'
      );

      const result = xAuthManager.isRecoverableError(challengeError);

      expect(result).toBe(false);
    });
  });
});
