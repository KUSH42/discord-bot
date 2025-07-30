import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AuthManager } from '../../src/application/auth-manager.js';
import { createEnhancedLoggerMocks } from '../fixtures/enhanced-logger-factory.js';
import { timerTestUtils } from '../fixtures/timer-test-utils.js';

/**
 * Authentication Flow Integration Tests
 *
 * Tests complete authentication workflow including:
 * - Login attempt with credentials
 * - Email verification handling
 * - Session persistence across restarts
 * - Authentication failure recovery
 * - Cookie management and storage
 * - Browser automation integration
 */
describe('Authentication Flow Integration', () => {
  let authManager;
  let mockConfig;
  let mockBrowserService;
  let mockCookieStorage;
  let loggerMocks;
  let timerUtils;

  beforeEach(() => {
    jest.clearAllMocks();
    timerUtils = timerTestUtils.setupComplexTimerTest();

    // Create enhanced logger mocks
    loggerMocks = createEnhancedLoggerMocks();

    // Mock configuration with authentication credentials
    mockConfig = {
      get: jest.fn((key, defaultValue) => {
        const values = {
          X_LOGIN_EMAIL: 'test@example.com',
          X_LOGIN_PASSWORD: 'securepassword123',
          X_VERIFICATION_EMAIL: 'verification@example.com',
          TWITTER_USERNAME: 'testuser',
          TWITTER_PASSWORD: 'securepassword123',
          LOGIN_TIMEOUT_MS: 30000,
          VERIFICATION_TIMEOUT_MS: 60000,
          SESSION_CHECK_INTERVAL_MS: 300000, // 5 minutes
          MAX_LOGIN_ATTEMPTS: 3,
          LOGIN_RETRY_DELAY_MS: 5000,
        };
        return values[key] || defaultValue;
      }),
      getRequired: jest.fn(key => {
        const values = {
          TWITTER_USERNAME: 'testuser',
          TWITTER_PASSWORD: 'securepassword123',
        };
        const value = values[key];
        if (!value) {
          throw new Error(`Required configuration key missing: ${key}`);
        }
        return value;
      }),
    };

    // Mock browser service with realistic authentication flow
    mockBrowserService = {
      browser: null,
      page: {
        goto: jest.fn(),
        waitForSelector: jest.fn(),
        evaluate: jest.fn(),
        click: jest.fn(),
        type: jest.fn(),
        screenshot: jest.fn(),
        close: jest.fn(),
        url: () => 'https://x.com/login',
        isClosed: () => false,
      },
      isConnected: jest.fn(() => true),
      isClosed: jest.fn(() => false),

      launch: jest.fn(async () => {
        mockBrowserService.browser = {
          isConnected: () => true,
          close: jest.fn(),
          newPage: jest.fn(async () => {
            return mockBrowserService.page;
          }),
        };
        return mockBrowserService.browser;
      }),

      close: jest.fn(async () => {
        if (mockBrowserService.browser) {
          await mockBrowserService.browser.close();
        }
      }),

      goto: jest.fn(async url => {
        if (!mockBrowserService.page) {
          throw new Error('No page available');
        }
        await mockBrowserService.page.goto(url);
      }),

      waitForSelector: jest.fn(async (selector, options = {}) => {
        if (!mockBrowserService.page) {
          throw new Error('No page available');
        }
        return mockBrowserService.page.waitForSelector(selector, options);
      }),

      evaluate: jest.fn(async fn => {
        if (!mockBrowserService.page) {
          throw new Error('No page available');
        }

        // Simulate different page states based on URL
        const currentUrl = mockBrowserService.page.url();
        if (currentUrl.includes('/home')) {
          return true; // Logged in
        } else if (currentUrl.includes('/login')) {
          return false; // Not logged in
        }
        return false;
      }),

      click: jest.fn(async selector => {
        if (!mockBrowserService.page) {
          throw new Error('No page available');
        }
        return mockBrowserService.page.click(selector);
      }),

      type: jest.fn(async (selector, text) => {
        if (!mockBrowserService.page) {
          throw new Error('No page available');
        }
        return mockBrowserService.page.type(selector, text);
      }),

      // Test helper methods
      simulateLoginPage: () => {
        mockBrowserService.page.url = () => 'https://x.com/login';
        mockBrowserService.evaluate.mockResolvedValue(false);
      },

      simulateHomePage: () => {
        mockBrowserService.page.url = () => 'https://x.com/home';
        mockBrowserService.evaluate.mockResolvedValue(true);
      },

      simulateVerificationPage: () => {
        mockBrowserService.page.url = () => 'https://x.com/account/access';
        mockBrowserService.waitForSelector
          .mockRejectedValueOnce(new Error('Password input not found'))
          .mockResolvedValueOnce({}); // Verification input found
      },

      simulateNetworkError: () => {
        mockBrowserService.goto.mockRejectedValue(new Error('Network timeout'));
        mockBrowserService.waitForSelector.mockRejectedValue(new Error('Timeout'));
      },

      simulateElementNotFound: () => {
        mockBrowserService.waitForSelector.mockRejectedValue(new Error('Element not found'));
      },
    };

    // Mock cookie storage
    mockCookieStorage = {
      cookies: new Map(),

      saveCookies: jest.fn(async cookies => {
        cookies.forEach(cookie => {
          mockCookieStorage.cookies.set(cookie.name, cookie);
        });
      }),

      loadCookies: jest.fn(async () => {
        return Array.from(mockCookieStorage.cookies.values());
      }),

      clearCookies: jest.fn(async () => {
        mockCookieStorage.cookies.clear();
      }),

      hasCookies: jest.fn(() => mockCookieStorage.cookies.size > 0),
    };

    // Create AuthManager with proper dependencies object
    authManager = new AuthManager({
      config: mockConfig,
      browserService: mockBrowserService,
      stateManager: { get: jest.fn(), set: jest.fn() },
      logger: loggerMocks.baseLogger,
      debugManager: loggerMocks.debugManager,
      metricsManager: loggerMocks.metricsManager,
    });

    // Inject cookie storage (normally done by dependency injection)
    authManager.cookieStorage = mockCookieStorage;
  });

  afterEach(() => {
    timerUtils.cleanup();
  });

  describe('Complete Login Flow Integration', () => {
    it('should perform successful login with credentials', async () => {
      // Setup: Add missing browser service methods
      mockBrowserService.setCookies = jest.fn();
      mockBrowserService.waitForNavigation = jest.fn();
      mockBrowserService.waitForSelector = jest.fn().mockResolvedValue({});
      mockBrowserService.click = jest.fn();
      mockBrowserService.type = jest.fn();

      // Mock no saved cookies (fresh login)
      authManager.state.get.mockReturnValue(null); // No saved cookies

      // Mock successful authentication check
      let authCheckCount = 0;
      const mockIsAuthenticated = jest.spyOn(authManager, 'isAuthenticated').mockImplementation(async () => {
        authCheckCount++;
        // Return true after login attempt
        return authCheckCount > 1;
      });

      // Mock login flow methods
      const mockClickNextButton = jest.spyOn(authManager, 'clickNextButton').mockResolvedValue();
      const mockClickLoginButton = jest.spyOn(authManager, 'clickLoginButton').mockResolvedValue();
      const mockClearSensitiveData = jest.spyOn(authManager, 'clearSensitiveData').mockImplementation(() => {});

      // Execute: Complete login flow
      await authManager.ensureAuthenticated();

      // Verify: Login workflow steps
      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://x.com/i/flow/login');
      expect(mockBrowserService.waitForSelector).toHaveBeenCalledWith('input[name="text"]', { timeout: 10000 });
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[name="text"]', 'testuser');
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[name="password"]', 'securepassword123');
      expect(mockClickNextButton).toHaveBeenCalled();
      expect(mockClickLoginButton).toHaveBeenCalled();

      // Verify: Authentication succeeded
      expect(mockIsAuthenticated).toHaveBeenCalled();
      expect(mockClearSensitiveData).toHaveBeenCalled();

      // Cleanup
      mockIsAuthenticated.mockRestore();
      mockClickNextButton.mockRestore();
      mockClickLoginButton.mockRestore();
      mockClearSensitiveData.mockRestore();
    }, 15000);

    it('should handle email verification flow', async () => {
      // Setup: Simulate verification required scenario
      mockBrowserService.simulateLoginPage();

      let verificationTriggered = false;
      mockBrowserService.waitForSelector.mockImplementation(async selector => {
        if (selector.includes('input[name="text"]') && !verificationTriggered) {
          return {}; // Email input
        } else if (selector.includes('Next') && !verificationTriggered) {
          return {}; // First Next button
        } else if (selector.includes('input[name="password"]') && !verificationTriggered) {
          verificationTriggered = true;
          throw new Error('Password input not found - verification needed');
        } else if (selector.includes('input[name="text"]') && verificationTriggered) {
          return {}; // Verification email input
        } else if (selector.includes('Next') && verificationTriggered) {
          return {}; // Second Next button
        } else if (selector.includes('input[name="password"]')) {
          return {}; // Password input after verification
        } else if (selector.includes('Log in')) {
          return {}; // Login button
        }
        throw new Error(`Unexpected selector: ${selector}`);
      });

      mockBrowserService.click.mockImplementation(async selector => {
        if (selector.includes('Log in')) {
          mockBrowserService.simulateHomePage();
        }
      });

      // Execute: Login with verification
      const result = await authManager.ensureAuthenticated();

      // Verify: Verification workflow steps
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[name="text"]', 'test@example.com');
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[name="text"]', 'verification@example.com');
      expect(mockBrowserService.type).toHaveBeenCalledWith('input[name="password"]', 'securepassword123');

      // Verify: Success and verification metrics
      expect(result).toBe(true);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('email_verification_required', 1, 'auth');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('verification_success', 1, 'auth');
    }, 15000);

    it('should retry login on temporary failures', async () => {
      // Setup: First attempt fails, second succeeds
      let attemptCount = 0;
      mockBrowserService.waitForSelector.mockImplementation(async selector => {
        attemptCount++;
        if (attemptCount <= 2) {
          throw new Error('Network timeout');
        }
        return {}; // Success on third attempt
      });

      mockBrowserService.click.mockImplementation(async () => {
        if (attemptCount >= 3) {
          mockBrowserService.simulateHomePage();
        }
      });

      // Execute: Login with retries
      const result = await authManager.ensureAuthenticated();

      // Verify: Retry attempts made
      expect(result).toBe(true);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('login_retry_attempt', 2, 'auth');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('login_success_after_retry', 1, 'auth');
    }, 15000);

    it('should fail gracefully after max retry attempts', async () => {
      // Setup: All attempts fail
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Persistent network error'));
      mockBrowserService.simulateNetworkError();

      // Execute: Login attempts exhaust retries
      const result = await authManager.ensureAuthenticated();

      // Verify: Failure after max attempts
      expect(result).toBe(false);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('login_max_retries_exceeded', 1, 'auth');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('login_failure', 1, 'auth');
    }, 15000);
  });

  describe('Session Persistence Integration', () => {
    it('should save and restore authentication cookies', async () => {
      // Setup: Mock successful login with cookies
      mockBrowserService.simulateLoginPage();

      const mockCookies = [
        { name: 'auth_token', value: 'abc123', domain: '.x.com' },
        { name: 'session_id', value: 'sess456', domain: '.x.com' },
        { name: 'csrf_token', value: 'csrf789', domain: '.x.com' },
      ];

      mockBrowserService.evaluate
        .mockResolvedValueOnce(false) // Not logged in initially
        .mockResolvedValueOnce(mockCookies) // Return cookies after login
        .mockResolvedValueOnce(true); // Logged in after cookie restoration

      mockBrowserService.click.mockImplementation(async selector => {
        if (selector.includes('Log in')) {
          mockBrowserService.simulateHomePage();
        }
      });

      // Execute: Login and save session
      const loginResult = await authManager.ensureAuthenticated();
      expect(loginResult).toBe(true);

      // Verify: Cookies saved
      expect(mockCookieStorage.saveCookies).toHaveBeenCalledWith(mockCookies);

      // Execute: Simulate restart - restore session
      mockBrowserService.simulateLoginPage();
      mockCookieStorage.hasCookies.mockReturnValue(true);
      mockCookieStorage.loadCookies.mockResolvedValue(mockCookies);

      const restoreResult = await authManager.ensureAuthenticated();

      // Verify: Session restored without re-login
      expect(restoreResult).toBe(true);
      expect(mockCookieStorage.loadCookies).toHaveBeenCalled();
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('session_restored', 1, 'auth');
    }, 15000);

    it('should handle corrupted cookie data gracefully', async () => {
      // Setup: Mock corrupted cookies
      mockCookieStorage.hasCookies.mockReturnValue(true);
      mockCookieStorage.loadCookies.mockRejectedValue(new Error('Corrupted cookie data'));

      mockBrowserService.simulateLoginPage();
      mockBrowserService.click.mockImplementation(async () => {
        mockBrowserService.simulateHomePage();
      });

      // Execute: Attempt session restore with corrupted data
      const result = await authManager.ensureAuthenticated();

      // Verify: Falls back to fresh login
      expect(result).toBe(true);
      expect(mockCookieStorage.clearCookies).toHaveBeenCalled();
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('cookie_corruption_detected', 1, 'auth');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('fallback_to_fresh_login', 1, 'auth');
    }, 15000);

    it('should validate session expiry and re-authenticate', async () => {
      // Setup: Mock expired session
      mockCookieStorage.hasCookies.mockReturnValue(true);
      mockCookieStorage.loadCookies.mockResolvedValue([{ name: 'auth_token', value: 'expired123', domain: '.x.com' }]);

      mockBrowserService.evaluate
        .mockResolvedValueOnce(false) // Session invalid after cookie restore
        .mockResolvedValueOnce(true); // Valid after re-login

      mockBrowserService.click.mockImplementation(async () => {
        mockBrowserService.simulateHomePage();
      });

      // Execute: Session validation and re-authentication
      const result = await authManager.ensureAuthenticated();

      // Verify: Re-authentication performed
      expect(result).toBe(true);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('session_expired', 1, 'auth');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('reauthentication_success', 1, 'auth');
    }, 15000);
  });

  describe('Authentication State Management Integration', () => {
    it('should maintain authentication state across multiple operations', async () => {
      // Setup: Successful initial authentication
      mockBrowserService.simulateHomePage();
      mockBrowserService.evaluate.mockResolvedValue(true);

      // Execute: Multiple authentication checks
      const results = await Promise.all([
        authManager.ensureAuthenticated(),
        authManager.ensureAuthenticated(),
        authManager.ensureAuthenticated(),
      ]);

      // Verify: All checks pass, browser launched only once
      expect(results).toEqual([true, true, true]);
      expect(mockBrowserService.launch).toHaveBeenCalledTimes(1);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('authentication_cache_hit', 2, 'auth');
    }, 15000);

    it('should handle concurrent authentication requests', async () => {
      // Setup: Multiple simultaneous auth requests
      mockBrowserService.simulateLoginPage();
      mockBrowserService.click.mockImplementation(async () => {
        // Simulate login delay
        await new Promise(resolve => setTimeout(resolve, 100));
        mockBrowserService.simulateHomePage();
      });

      // Execute: Concurrent authentication requests
      const promises = Array.from({ length: 5 }, () => authManager.ensureAuthenticated());

      const results = await Promise.all(promises);

      // Verify: All succeed, single login process
      expect(results).toEqual([true, true, true, true, true]);
      expect(mockBrowserService.launch).toHaveBeenCalledTimes(1);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('concurrent_auth_requests', 5, 'auth');
    }, 15000);

    it('should detect and recover from authentication loss during operation', async () => {
      // Setup: Initially authenticated, then session lost
      mockBrowserService.evaluate
        .mockResolvedValueOnce(true) // Initially authenticated
        .mockResolvedValueOnce(false) // Session lost
        .mockResolvedValueOnce(true); // Re-authenticated

      mockBrowserService.click.mockImplementation(async () => {
        mockBrowserService.simulateHomePage();
      });

      // Execute: Initial check (success)
      let result = await authManager.ensureAuthenticated();
      expect(result).toBe(true);

      // Execute: Second check (detects session loss)
      result = await authManager.ensureAuthenticated();
      expect(result).toBe(true);

      // Verify: Session loss detected and recovered
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('session_loss_detected', 1, 'auth');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('session_recovery_success', 1, 'auth');
    }, 15000);
  });

  describe('Error Recovery Integration', () => {
    it('should handle browser crashes during authentication', async () => {
      // Setup: Browser crash during login
      mockBrowserService.launch.mockImplementation(async () => {
        // Simulate browser crash
        mockBrowserService.browser = null;
        mockBrowserService.isConnected = jest.fn(() => false);
        throw new Error('Browser crashed during startup');
      });

      // Execute: Authentication attempt with browser crash
      const result = await authManager.ensureAuthenticated();

      // Verify: Graceful failure handling
      expect(result).toBe(false);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('browser_crash_during_auth', 1, 'auth');
    }, 15000);

    it('should recover from temporary network issues', async () => {
      // Setup: Network issues then recovery
      let networkCallCount = 0;
      mockBrowserService.goto.mockImplementation(async () => {
        networkCallCount++;
        if (networkCallCount <= 2) {
          throw new Error('Network timeout');
        }
        // Network recovered
      });

      mockBrowserService.click.mockImplementation(async () => {
        mockBrowserService.simulateHomePage();
      });

      // Execute: Authentication with network recovery
      const result = await authManager.ensureAuthenticated();

      // Verify: Success after network recovery
      expect(result).toBe(true);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('network_recovery_success', 1, 'auth');
    }, 15000);

    it('should handle rate limiting gracefully', async () => {
      // Setup: Rate limiting error
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Rate limit exceeded. Please try again later.'));

      // Execute: Authentication with rate limiting
      const result = await authManager.ensureAuthenticated();

      // Verify: Rate limiting handled
      expect(result).toBe(false);
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('rate_limit_encountered', 1, 'auth');
    }, 15000);
  });
});
