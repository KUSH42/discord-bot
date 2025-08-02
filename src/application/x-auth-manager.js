import { createEnhancedLogger } from '../utilities/enhanced-logger.js';

/**
 * Manages authentication for X (Twitter) scraper, handling cookies and login flows.
 */
export class XAuthManager {
  constructor(dependencies) {
    this.browser = dependencies.browserService;
    this.config = dependencies.config;
    this.state = dependencies.stateManager;
    this.twitterUsername = this.config.getRequired('TWITTER_USERNAME');
    this.twitterPassword = this.config.getRequired('TWITTER_PASSWORD');

    // Optional verification credentials
    this.twitterEmail = this.config.get('TWITTER_EMAIL');
    this.twitterPhone = this.config.get('TWITTER_PHONE');

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

    // Challenge-related errors are not recoverable and need user action
    const challengeMessages = [
      'unusual login activity challenge detected',
      'no email or phone number configured',
      'challenge form filled but could not find continue button',
    ];

    const errorMessage = error.message.toLowerCase();

    // If it's a challenge-related error, it's not recoverable
    if (challengeMessages.some(msg => errorMessage.includes(msg))) {
      return false;
    }

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
      const usernameSelectors = [
        'input[name="text"]',
        'input[autocomplete="username"]',
        'input[data-testid*="username"]',
        'input[type="text"]:not([name="password"])',
      ];
      const usernameSelector = await this.waitForSelectorWithFallback(usernameSelectors, { timeout: 15000 });
      await this.browser.type(usernameSelector, this.twitterUsername);
      await this.clickNextButton();

      operation.progress('Waiting for next step (password or challenge)');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check for unusual login activity challenge
      operation.progress('Checking for unusual login activity challenge');
      const challengeHandled = await this.handleUnusualLoginChallenge();
      if (challengeHandled) {
        operation.progress('Successfully handled unusual login activity challenge');
        // Additional wait after challenge resolution
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      operation.progress('Entering password credentials');
      const passwordSelectors = [
        'input[name="password"]',
        'input[autocomplete="current-password"]',
        'input[type="password"]',
        'input[data-testid*="password"]',
      ];
      const passwordSelector = await this.waitForSelectorWithFallback(passwordSelectors, { timeout: 15000 });
      await this.browser.type(passwordSelector, this.twitterPassword);
      await this.clickLoginButton();
      await this.browser.waitForNavigation({ timeout: 15000 });

      operation.progress('Verifying login success - waiting for authentication to complete');
      // Give X.com time to set authentication cookies after navigation
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Try authentication check multiple times as cookies may take time to be set
      let isAuth = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        operation.progress(`Authentication verification attempt ${attempt}/3`);
        isAuth = await this.isAuthenticated();
        if (isAuth) {
          break;
        }
        if (attempt < 3) {
          operation.progress(`Attempt ${attempt} failed, waiting 2s before retry`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (isAuth) {
        operation.progress('Saving authentication state');
        await this.saveAuthenticationState();
        this.clearSensitiveData();
        this.logger.info('✅ Login successful, a new session has been established.');
        operation.success('Login successful, new session established', {
          method: 'credential_login',
        });
        return true;
      } else {
        this.logger.error('Credential-based login failed after multiple verification attempts.');
        operation.error(new Error('Credential-based login failed'), 'Login verification failed after retries', {
          verificationAttempts: 3,
          finalCheck: 'failed',
        });
        throw new Error('Authentication failed');
      }
    } catch (error) {
      operation.error(error, 'Credential-based login failed');
      throw error;
    }
  }

  /**
   * Wait for a selector with fallback options
   * @param {Array<string>} selectors - Array of selectors to try in order
   * @param {Object} options - Wait options
   * @returns {Promise<string>} The successful selector
   */
  async waitForSelectorWithFallback(selectors, options = { timeout: 10000 }) {
    const operation = this.logger.startOperation('waitForSelectorWithFallback', {
      selectors,
      timeout: options.timeout,
    });

    // Give each selector at least 3 seconds, but distribute remaining time evenly
    const minTimePerSelector = 3000;
    const timePerSelector = Math.max(minTimePerSelector, Math.floor(options.timeout / selectors.length));

    operation.progress(`Using ${timePerSelector}ms per selector (${selectors.length} selectors)`);

    for (let i = 0; i < selectors.length; i++) {
      const selector = selectors[i];
      operation.progress(`Trying selector ${i + 1}/${selectors.length}: ${selector}`);

      try {
        await this.browser.waitForSelector(selector, { timeout: timePerSelector });
        operation.success(`Found element with selector: ${selector}`, { successfulSelector: selector, attempt: i + 1 });
        return selector;
      } catch (error) {
        operation.progress(`Selector ${selector} failed: ${error.message}`);

        // If this is the last selector and we're looking for password fields, add debugging
        if (i === selectors.length - 1 && selectors.some(s => s.includes('password'))) {
          operation.progress('All password selectors failed. Debugging page state...');
          try {
            const currentUrl = await this.browser.getUrl();
            const pageContent = await this.browser.getContent();
            const hasPasswordInPage = pageContent.toLowerCase().includes('password');
            const inputCount = (pageContent.match(/<input/gi) || []).length;

            operation.progress(
              `Debug info: URL=${currentUrl}, hasPasswordInPage=${hasPasswordInPage}, inputCount=${inputCount}`
            );
          } catch (debugError) {
            operation.progress(`Debug info failed: ${debugError.message}`);
          }
        }

        if (i === selectors.length - 1) {
          // Last selector failed, throw error
          operation.error(error, `All selectors failed`, { failedSelectors: selectors });
          throw new Error(`Could not find element with any of the selectors: ${selectors.join(', ')}`);
        }
      }
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
   * Handles the "unusual login activity" challenge that may appear after username entry.
   * This challenge asks for email or phone number verification before allowing password entry.
   * @returns {Promise<boolean>} True if a challenge was found and handled, false if no challenge
   */
  async handleUnusualLoginChallenge() {
    const operation = this.logger.startOperation('handleUnusualLoginChallenge', {
      hasEmail: !!this.twitterEmail,
      hasPhone: !!this.twitterPhone,
    });

    try {
      // Look for challenge indicators - these are common patterns X uses for unusual login activity
      const challengeSelectors = [
        'text="Help us protect the X community"', // Common challenge heading
        'text="Unusual login activity"',
        'text="Help us verify it\'s you"',
        'text="We noticed unusual login activity"',
        'text="To help keep your account safe"',
        '[data-testid*="challenge"]', // Challenge-related test IDs
        '[data-testid*="verify"]', // Verification-related test IDs
        'text*="verify"', // Any text containing "verify"
        'text*="phone number"', // Text mentioning phone number
        'text*="email"', // Text mentioning email
      ];

      operation.progress('Checking for challenge indicators on page');

      // Check if any challenge indicators are present
      let challengeFound = false;
      for (const selector of challengeSelectors) {
        try {
          await this.browser.waitForSelector(selector, { timeout: 2000 });
          operation.progress(`Challenge detected with selector: ${selector}`);
          challengeFound = true;
          break;
        } catch (_error) {
          // Selector not found, continue checking
        }
      }

      if (!challengeFound) {
        operation.success('No unusual login activity challenge detected', { challengeFound: false });
        return false;
      }

      operation.progress('Unusual login activity challenge detected, attempting to handle');

      // Look for verification input fields
      const verificationSelectors = [
        'input[name="text"]', // Generic text input
        'input[type="text"]', // Text input
        'input[data-testid*="challenge"]', // Challenge input
        'input[data-testid*="verify"]', // Verification input
        'input[autocomplete="email"]', // Email input
        'input[autocomplete="tel"]', // Phone input
        'input[placeholder*="email"]', // Email placeholder
        'input[placeholder*="phone"]', // Phone placeholder
      ];

      const verificationSelector = await this.waitForSelectorWithFallback(verificationSelectors, { timeout: 10000 });

      // Try to determine if this is asking for email or phone based on page content
      const pageContent = await this.browser.getContent();
      const isEmailChallenge =
        pageContent.toLowerCase().includes('email') &&
        (pageContent.toLowerCase().includes('@') || pageContent.toLowerCase().includes('email address'));
      const isPhoneChallenge =
        pageContent.toLowerCase().includes('phone') || pageContent.toLowerCase().includes('number');

      let verificationValue = null;
      let verificationType = 'unknown';

      if (isEmailChallenge && this.twitterEmail) {
        verificationValue = this.twitterEmail;
        verificationType = 'email';
        operation.progress('Using email for verification challenge');
      } else if (isPhoneChallenge && this.twitterPhone) {
        verificationValue = this.twitterPhone;
        verificationType = 'phone';
        operation.progress('Using phone number for verification challenge');
      } else if (this.twitterEmail) {
        // Fallback to email if available
        verificationValue = this.twitterEmail;
        verificationType = 'email_fallback';
        operation.progress('Using email as fallback for verification challenge');
      } else if (this.twitterPhone) {
        // Fallback to phone if available
        verificationValue = this.twitterPhone;
        verificationType = 'phone_fallback';
        operation.progress('Using phone as fallback for verification challenge');
      }

      if (!verificationValue) {
        operation.error(
          new Error('No verification credentials available'),
          'Cannot handle challenge - no email or phone configured',
          {
            hasEmail: !!this.twitterEmail,
            hasPhone: !!this.twitterPhone,
            challengeType: isEmailChallenge ? 'email' : isPhoneChallenge ? 'phone' : 'unknown',
          }
        );
        throw new Error(
          'Unusual login activity challenge detected, but no email or phone number configured for verification. Please set TWITTER_EMAIL or TWITTER_PHONE environment variables.'
        );
      }

      // Enter the verification value
      operation.progress(`Entering ${verificationType} for challenge verification`);
      await this.browser.type(verificationSelector, verificationValue);

      // Look for and click the continue/next button
      const continueSelectors = [
        'button:has-text("Next")',
        'button:has-text("Continue")',
        'button:has-text("Verify")',
        'button:has-text("Submit")',
        'button[data-testid*="next"]',
        'button[data-testid*="continue"]',
        'button[data-testid*="verify"]',
        'button[type="submit"]',
      ];

      operation.progress('Looking for continue button');
      let continueClicked = false;
      for (const selector of continueSelectors) {
        try {
          await this.browser.waitForSelector(selector, { timeout: 3000 });
          await this.browser.click(selector);
          operation.progress(`Clicked continue button with selector: ${selector}`);
          continueClicked = true;
          break;
        } catch (_error) {
          // Button not found, try next selector
        }
      }

      if (!continueClicked) {
        operation.error(
          new Error('Could not find continue button'),
          'Challenge form filled but could not find continue button',
          { verificationType }
        );
        throw new Error('Could not find continue button after filling verification challenge');
      }

      // Wait for the challenge response
      operation.progress('Waiting for challenge verification response');
      await new Promise(resolve => setTimeout(resolve, 5000));

      operation.success('Successfully handled unusual login activity challenge', {
        verificationType,
        challengeFound: true,
        verificationCompleted: true,
      });

      return true;
    } catch (error) {
      operation.error(error, 'Failed to handle unusual login activity challenge');
      throw error;
    }
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

      // X uses multiple authentication mechanisms, check for various indicators
      const authToken = cookies.find(cookie => cookie.name === 'auth_token');
      const ct0Token = cookies.find(cookie => cookie.name === 'ct0');
      const twid = cookies.find(cookie => cookie.name === 'twid');

      // Check for traditional auth_token + ct0 combination
      const hasTraditionalAuth = authToken && authToken.value && ct0Token && ct0Token.value;

      // Check for alternative auth mechanisms (ct0 + twid or other session indicators)
      const hasAlternativeAuth =
        (ct0Token && ct0Token.value && twid && twid.value) || (ct0Token && ct0Token.value && cookies.length > 5);

      const hasValidCookies = hasTraditionalAuth || hasAlternativeAuth;

      if (hasValidCookies) {
        operation.progress('Valid authentication cookies found, performing navigation test');
        try {
          // First check current URL to avoid unnecessary navigation
          const currentUrl = await this.browser.getUrl();
          const alreadyOnHomePage = currentUrl.includes('/home') || currentUrl === 'https://x.com/';

          if (!alreadyOnHomePage) {
            operation.progress('Navigating to home page for verification');
            await this.browser.goto('https://x.com/home', { timeout: 10000, waitUntil: 'domcontentloaded' });
          }

          // Wait a moment for page to stabilize
          await new Promise(resolve => setTimeout(resolve, 1000));

          const finalUrl = await this.browser.getUrl();
          const isOnHomePage = finalUrl.includes('/home') || finalUrl === 'https://x.com/';

          // Additional check: look for login-specific elements that indicate failure
          const isLoginPage = finalUrl.includes('/login') || finalUrl.includes('/i/flow/login');

          operation.success('Authentication verification completed', {
            authenticated: isOnHomePage && !isLoginPage,
            method: 'navigation_test',
            currentUrl: finalUrl.substring(0, 120),
            cookiesPresent: true,
            authMethod: hasTraditionalAuth ? 'traditional' : 'alternative',
            isLoginPage,
          });
          return isOnHomePage && !isLoginPage;
        } catch (navError) {
          // If navigation fails but cookies are present, assume authenticated
          operation.success('Authentication verified by cookies (navigation failed)', {
            authenticated: true,
            method: 'cookies_only',
            navigationError: this.sanitizeErrorMessage(navError.message),
            cookiesPresent: true,
            authMethod: hasTraditionalAuth ? 'traditional' : 'alternative',
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
        hasTwid: !!twid,
        hasTraditionalAuth,
        hasAlternativeAuth,
        cookieNames: cookies.map(c => c.name).join(', '),
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
    this.twitterEmail = null;
    this.twitterPhone = null;
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
    const originalEmail = this.config.get('TWITTER_EMAIL');
    const originalPhone = this.config.get('TWITTER_PHONE');

    // Replace credentials with placeholders
    if (originalPassword) {
      sanitized = sanitized.replace(new RegExp(originalPassword, 'g'), '[REDACTED_PASSWORD]');
    }
    if (originalUsername) {
      sanitized = sanitized.replace(new RegExp(originalUsername, 'g'), '[REDACTED_USERNAME]');
    }
    if (originalEmail) {
      sanitized = sanitized.replace(new RegExp(originalEmail, 'g'), '[REDACTED_EMAIL]');
    }
    if (originalPhone) {
      sanitized = sanitized.replace(new RegExp(originalPhone, 'g'), '[REDACTED_PHONE]');
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
