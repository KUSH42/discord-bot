import { createEnhancedLogger } from '../utilities/enhanced-logger.js';

/**
 * Manages authentication for the scraper, handling cookies and login flows.
 */
export class AuthManager {
  constructor(dependencies) {
    this.browser = dependencies.browserService;
    this.config = dependencies.config;
    this.state = dependencies.stateManager;
    this.twitterUsername = this.config.getRequired('TWITTER_USERNAME');
    this.twitterPassword = this.config.getRequired('TWITTER_PASSWORD');

    // Create enhanced logger for this module
    this.logger = createEnhancedLogger(
      'auth',
      dependencies.logger,
      dependencies.debugManager,
      dependencies.metricsManager
    );
  }

  /**
   * Ensures the user is authenticated, using cookies if available, otherwise performing a full login.
   * @param {Object} options - Configuration options
   * @param {number} options.maxRetries - Maximum number of retry attempts (default: 3)
   * @param {number} options.baseDelay - Base delay between retries in ms (default: 2000)
   * @returns {Promise<void>}
   */
  async ensureAuthenticated(options = {}) {
    const { maxRetries = 3, baseDelay = 2000 } = options;

    const operation = this.logger.startOperation('ensureAuthenticated', {
      maxRetries,
      baseDelay,
      username: this.twitterUsername ? '[CONFIGURED]' : '[NOT_SET]',
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        operation.progress(`Authentication attempt ${attempt}/${maxRetries}`);
        const savedCookies = this.state.get('x_session_cookies');

        if (savedCookies && this.validateCookieFormat(savedCookies)) {
          operation.progress('Attempting authentication with saved cookies');
          try {
            await this.browser.setCookies(savedCookies);
            await this.browser.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });

            if (await this.isAuthenticated()) {
              this.clearSensitiveData();
              this.logger.info('✅ Successfully authenticated using saved cookies.');
              operation.success('Successfully authenticated using saved cookies', {
                method: 'saved_cookies',
                attempt,
              });
              return;
            } else {
              operation.progress('Saved cookies expired, attempting fresh login');
              try {
                this.state.delete('x_session_cookies');
              } catch (deleteError) {
                this.logger.error('Failed to delete session cookies from state:', deleteError);
              }
              this.logger.warn('Saved cookies failed, attempting login');
              await this.loginToX();
              operation.success('Authentication successful after fresh login', {
                method: 'fresh_login_after_expired_cookies',
                attempt,
              });
              return;
            }
          } catch (error) {
            operation.progress('Cookie validation failed, falling back to login');
            this.logger.error('Error validating saved cookies, falling back to login:', error.message);
            await this.loginToX();
            operation.success('Authentication successful after cookie fallback', {
              method: 'login_after_cookie_error',
              attempt,
              cookieError: this.sanitizeErrorMessage(error.message),
            });
            return;
          }
        } else if (savedCookies) {
          operation.progress('Invalid cookie format, performing fresh login');
          try {
            this.state.delete('x_session_cookies');
          } catch (deleteError) {
            this.logger.error('Failed to delete session cookies from state:', deleteError);
          }
          this.logger.warn('Invalid saved cookies format, performing login');
          await this.loginToX();
          operation.success('Authentication successful after invalid cookie cleanup', {
            method: 'login_after_invalid_cookies',
            attempt,
          });
          return;
        } else {
          operation.progress('No saved cookies found, performing fresh login');
          this.logger.info('No saved cookies found, performing login');
          await this.loginToX();
          operation.success('Authentication successful with fresh login', {
            method: 'fresh_login',
            attempt,
          });
          return;
        }
      } catch (error) {
        const sanitizedMessage =
          error && error.message
            ? this.sanitizeErrorMessage(error.message)
            : 'An unknown authentication error occurred.';

        if (attempt === maxRetries) {
          this.logger.error('Non-recoverable authentication error:', sanitizedMessage);
          operation.error(error, `Authentication failed after ${maxRetries} attempts`, {
            attempts: maxRetries,
            finalError: sanitizedMessage,
          });
          throw new Error('Authentication failed');
        }

        // Check if this is a recoverable error
        const isRecoverable = this.isRecoverableError(error);
        if (!isRecoverable) {
          this.logger.error('Non-recoverable authentication error:', sanitizedMessage);
          operation.error(error, 'Non-recoverable authentication error', {
            attempt,
            errorType: 'non_recoverable',
          });
          throw new Error('Authentication failed');
        }

        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
        operation.progress(`Attempt ${attempt} failed, retrying in ${delay}ms`);
        await this.delay(delay);
      }
    }
  }

  /**
   * Check if an authentication error is recoverable
   * @param {Error} error - The error to check
   * @returns {boolean} True if the error is recoverable
   */
  isRecoverableError(error) {
    const recoverableMessages = [
      'timeout',
      'network',
      'connection',
      'temporarily unavailable',
      'server error',
      'loading',
      'page crash',
      'navigation timeout',
      'protocol error',
    ];

    const errorMessage = error.message.toLowerCase();
    return recoverableMessages.some(msg => errorMessage.includes(msg));
  }

  /**
   * Delay helper function
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Performs the full login flow using credentials.
   * @returns {Promise<boolean>} True if login is successful.
   */
  async loginToX() {
    const operation = this.logger.startOperation('loginToX', {
      username: this.twitterUsername ? '[CONFIGURED]' : '[NOT_SET]',
      loginUrl: 'https://x.com/i/flow/login',
    });

    try {
      operation.progress('Navigating to X login page');
      await this.browser.goto('https://x.com/i/flow/login');

      operation.progress('Entering username credentials');
      await this.browser.waitForSelector('input[name="text"]', { timeout: 10000 });
      await this.browser.type('input[name="text"]', this.twitterUsername);
      await this.clickNextButton();
      await new Promise(resolve => setTimeout(resolve, 4000));

      operation.progress('Entering password credentials');
      await this.browser.waitForSelector('input[name="password"]', { timeout: 10000 });
      await this.browser.type('input[name="password"]', this.twitterPassword);
      await this.clickLoginButton();
      await this.browser.waitForNavigation({ timeout: 15000 });

      operation.progress('Verifying login success');
      if (await this.isAuthenticated()) {
        operation.progress('Saving authentication state');
        await this.saveAuthenticationState();
        this.clearSensitiveData();
        this.logger.info('✅ Login successful, a new session has been established.');
        operation.success('Login successful, new session established', {
          method: 'credential_login',
        });
        return true;
      } else {
        this.logger.error('Credential-based login failed.');
        operation.error(new Error('Credential-based login failed'), 'Login verification failed');
        throw new Error('Authentication failed');
      }
    } catch (error) {
      operation.error(error, 'Credential-based login failed');
      throw error;
    }
  }

  /**
   * Clicks the "Next" button during the login flow.
   * @returns {Promise<void>}
   */
  async clickNextButton() {
    const nextButtonSelector = 'button:has-text("Next")';
    await this.browser.click(nextButtonSelector);
  }

  /**
   * Clicks the "Log in" button during the login flow.
   * @returns {Promise<void>}
   */
  async clickLoginButton() {
    const loginButtonSelector = 'button[data-testid="LoginForm_Login_Button"]';
    await this.browser.click(loginButtonSelector);
  }

  /**
   * Saves the current session cookies to the state manager.
   * @returns {Promise<void>}
   */
  async saveAuthenticationState() {
    try {
      this.logger.info('Saving session cookies to state...');
      const cookies = await this.browser.getCookies();
      if (this.validateCookieFormat(cookies)) {
        this.state.set('x_session_cookies', cookies);
        this.logger.info('Saved session cookies to state');
      } else {
        this.logger.warn('Could not find any valid cookies to save.');
      }
    } catch (error) {
      this.logger.error('Error saving session cookies:', error);
    }
  }

  /**
   * Checks if the current session is authenticated by verifying the URL.
   * @returns {Promise<boolean>}
   */
  async isAuthenticated() {
    const operation = this.logger.startOperation('isAuthenticated', {
      hasBrowser: !!this.browser,
      hasPage: !!(this.browser && this.browser.page),
    });

    try {
      if (!this.browser || !this.browser.page) {
        this.logger.warn('Browser service or page not available for authentication check.');
        operation.success('Browser service not available', {
          authenticated: false,
          reason: 'no_browser_service',
        });
        return false;
      }

      operation.progress('Checking authentication cookies');
      const cookies = await this.browser.getCookies();

      // X uses 'auth_token' and 'ct0' cookies for authentication
      const authToken = cookies.find(cookie => cookie.name === 'auth_token');
      const ct0Token = cookies.find(cookie => cookie.name === 'ct0');
      const hasValidCookies = authToken && authToken.value && ct0Token && ct0Token.value;

      if (hasValidCookies) {
        operation.progress('Valid cookies found, performing navigation test');
        try {
          await this.browser.goto('https://x.com/home', { timeout: 10000, waitUntil: 'domcontentloaded' });
          const currentUrl = await this.browser.getUrl();
          const isOnHomePage = currentUrl.includes('/home') || currentUrl === 'https://x.com/';

          operation.success('Authentication verification completed', {
            authenticated: isOnHomePage,
            method: 'navigation_test',
            currentUrl: currentUrl.substring(0, 50),
            cookiesPresent: true,
          });
          return isOnHomePage;
        } catch (navError) {
          // If navigation fails but cookies are present, assume authenticated
          operation.success('Authentication verified by cookies (navigation failed)', {
            authenticated: true,
            method: 'cookies_only',
            navigationError: this.sanitizeErrorMessage(navError.message),
            cookiesPresent: true,
          });
          return true;
        }
      }

      operation.success('Authentication check completed', {
        authenticated: false,
        reason: 'missing_or_invalid_cookies',
        cookiesFound: cookies.length,
        hasAuthToken: !!authToken,
        hasCt0Token: !!ct0Token,
      });
      return false;
    } catch (error) {
      this.logger.warn('Error checking authentication status:', error.message);
      operation.error(error, 'Error checking authentication status');
      return false;
    }
  }

  /**
   * Clears sensitive data from memory after successful authentication.
   * @returns {void}
   */
  clearSensitiveData() {
    // Clear credentials from memory after successful authentication
    this.twitterUsername = null;
    this.twitterPassword = null;
  }

  /**
   * Sanitizes error messages to remove sensitive credentials.
   * @param {string} message - Error message to sanitize
   * @returns {string} Sanitized error message
   */
  sanitizeErrorMessage(message) {
    if (typeof message !== 'string') {
      return 'An unknown error occurred';
    }
    let sanitized = message;

    // Get original credentials from config for sanitization
    const originalUsername = this.config.getRequired('TWITTER_USERNAME');
    const originalPassword = this.config.getRequired('TWITTER_PASSWORD');

    // Replace credentials with placeholders
    if (originalPassword) {
      sanitized = sanitized.replace(new RegExp(originalPassword, 'g'), '[REDACTED_PASSWORD]');
    }
    if (originalUsername) {
      sanitized = sanitized.replace(new RegExp(originalUsername, 'g'), '[REDACTED_USERNAME]');
    }

    return sanitized;
  }

  /**
   * Validates the format and security of cookies.
   * @param {any} cookies - The cookies to validate.
   * @returns {boolean} - True if the format is valid and secure, false otherwise.
   */
  validateCookieFormat(cookies) {
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return false;
    }

    return cookies.every(cookie => {
      // Basic format validation
      if (!cookie || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') {
        return false;
      }

      // Security validation - reject suspicious patterns
      const suspiciousPatterns = [
        /data:text\/html/i, // Data URLs with HTML
        /javascript:/i, // JavaScript URLs
        /vbscript:/i, // VBScript URLs
        /\$\(/, // Command substitution
        /`.*`/, // Backtick command execution
        /\.\.[/\\]/, // Path traversal patterns
        /<script/i, // Script tags
        /<iframe/i, // Iframe tags
        /eval\(/i, // eval() calls
        /document\./i, // DOM access
        /window\./i, // Window object access
      ];

      // Check cookie name and value against suspicious patterns
      const nameValue = cookie.name + cookie.value;
      return !suspiciousPatterns.some(pattern => pattern.test(nameValue));
    });
  }
}
