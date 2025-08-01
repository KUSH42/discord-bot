import { createEnhancedLogger } from '../utilities/enhanced-logger.js';

/**
 * Manages authentication for YouTube/Google services, handling login flows and session management.
 */
export class YouTubeAuthManager {
  constructor(dependencies) {
    this.browserService = dependencies.browserService;
    this.config = dependencies.config;
    this.state = dependencies.stateManager;
    this.youtubeUsername = this.config.getRequired('YOUTUBE_USERNAME');
    this.youtubePassword = this.config.getRequired('YOUTUBE_PASSWORD');
    this.authEnabled = this.config.get('YOUTUBE_AUTH_ENABLED', 'false') === 'true';

    // Create enhanced logger for this module
    this.logger = createEnhancedLogger(
      'auth',
      dependencies.logger,
      dependencies.debugManager,
      dependencies.metricsManager
    );
  }

  /**
   * Ensures the user is authenticated with YouTube, using saved session if available.
   * @param {Object} options - Configuration options
   * @param {number} options.maxRetries - Maximum number of retry attempts (default: 3)
   * @param {number} options.baseDelay - Base delay between retries in ms (default: 2000)
   * @returns {Promise<boolean>} True if authentication is successful or disabled
   */
  async ensureAuthenticated(options = {}) {
    const { maxRetries = 3, baseDelay = 2000 } = options;

    const operation = this.logger.startOperation('ensureAuthenticated', {
      authEnabled: this.authEnabled,
      maxRetries,
      baseDelay,
      username: this.youtubeUsername ? '[CONFIGURED]' : '[NOT_SET]',
    });

    if (!this.authEnabled) {
      operation.success('YouTube authentication is disabled', {
        method: 'disabled',
      });
      return true;
    }

    if (!this.youtubeUsername || !this.youtubePassword) {
      operation.error(new Error('Missing credentials'), 'YouTube authentication enabled but credentials not provided');
      return false;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        operation.progress(`Authentication attempt ${attempt}/${maxRetries}`);

        // Check if already authenticated
        if (await this.isAuthenticated()) {
          operation.success('Already authenticated with YouTube', {
            method: 'existing_session',
            attempt,
          });
          return true;
        }

        // Attempt authentication
        const authResult = await this.authenticateWithYouTube();
        if (authResult) {
          operation.success('Authentication successful', {
            method: 'fresh_login',
            attempt,
          });
          return true;
        }

        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          operation.progress(`Attempt ${attempt} failed, retrying in ${delay}ms`);
          await this.delay(delay);
        }
      } catch (error) {
        const sanitizedMessage = this.sanitizeErrorMessage(error.message);

        if (attempt === maxRetries) {
          operation.error(error, `Authentication failed after ${maxRetries} attempts`, {
            attempts: maxRetries,
            finalError: sanitizedMessage,
          });
          return false;
        }

        // Check if this is a recoverable error
        const isRecoverable = this.isRecoverableError(error);
        if (!isRecoverable) {
          operation.error(error, 'Non-recoverable authentication error', {
            attempt,
            errorType: 'non_recoverable',
          });
          return false;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        operation.progress(`Attempt ${attempt} failed, retrying in ${delay}ms`);
        await this.delay(delay);
      }
    }

    operation.error(new Error('Authentication failed'), 'All authentication attempts failed');
    return false;
  }

  /**
   * Performs the full YouTube/Google authentication flow.
   * @returns {Promise<boolean>} True if authentication is successful
   */
  async authenticateWithYouTube() {
    const operation = this.logger.startOperation('authenticateWithYouTube', {
      username: this.youtubeUsername ? '[CONFIGURED]' : '[NOT_SET]',
      loginUrl: 'https://accounts.google.com/signin/v2/identifier?service=youtube',
    });

    try {
      operation.progress('Starting YouTube authentication...');

      // Navigate to YouTube sign-in page
      operation.progress('Navigating to Google sign-in page');
      await this.browserService.goto('https://accounts.google.com/signin/v2/identifier?service=youtube');

      // Handle cookie consent if present
      operation.progress('Handling cookie consent');
      await this.handleCookieConsent();

      // Wait for email input
      operation.progress('Entering email credentials');
      await this.browserService.waitForSelector('input[type="email"]', { timeout: 10000 });
      await this.browserService.type('input[type="email"]', this.youtubeUsername);
      await this.browserService.click('#identifierNext');
      await this.browserService.waitFor(3000);

      // Wait for password input
      operation.progress('Entering password credentials');
      await this.browserService.waitForSelector('input[type="password"]', { timeout: 10000 });
      await this.browserService.type('input[type="password"]', this.youtubePassword);
      await this.browserService.click('#passwordNext');
      await this.browserService.waitFor(5000);

      // Handle potential challenges
      operation.progress('Checking for authentication challenges');
      const challengeResult = await this.handleAccountChallenges();
      if (!challengeResult) {
        operation.error(new Error('Authentication challenge failed'), 'Account challenge handling failed');
        return false;
      }

      // Check for 2FA
      operation.progress('Checking for 2FA requirements');
      const twoFAResult = await this.handle2FA();
      if (!twoFAResult) {
        operation.error(new Error('2FA required but not supported'), '2FA challenge detected');
        return false;
      }

      // Check for CAPTCHA
      operation.progress('Checking for CAPTCHA challenges');
      const captchaResult = await this.handleCaptcha();
      if (!captchaResult) {
        operation.error(new Error('CAPTCHA required but not supported'), 'CAPTCHA challenge detected');
        return false;
      }

      // Handle consent page redirect
      operation.progress('Handling consent page redirects');
      await this.handleConsentPageRedirect();

      // Verify authentication success
      operation.progress('Verifying authentication success');
      const isAuth = await this.isAuthenticated();
      if (isAuth) {
        this.clearSensitiveData();
        operation.success('YouTube authentication completed successfully', {
          method: 'credential_login',
        });
        return true;
      } else {
        operation.error(new Error('Authentication verification failed'), 'Login completed but verification failed');
        return false;
      }
    } catch (error) {
      operation.error(error, 'YouTube authentication failed', {
        errorMessage: this.sanitizeErrorMessage(error.message),
      });
      return false;
    }
  }

  /**
   * Handles cookie consent banners during authentication.
   * @returns {Promise<void>}
   */
  async handleCookieConsent() {
    const operation = this.logger.startOperation('handleCookieConsent');

    try {
      // Wait a moment for cookie banners to appear
      await this.browserService.waitFor(2000);

      // Common cookie consent selectors
      const consentSelectors = [
        'button:has-text("Accept all")',
        'button:has-text("I agree")',
        'button:has-text("Accept")',
        '[data-testid="accept-all-button"]',
        '[data-testid="consent-accept-all"]',
        'button[aria-label*="Accept"]',
        '#L2AGLb', // Google's "I agree" button
        'button:has-text("Reject all")', // Fallback - reject if accept not found
      ];

      for (const selector of consentSelectors) {
        try {
          await this.browserService.waitForSelector(selector, { timeout: 3000 });
          await this.browserService.click(selector);
          operation.progress(`Clicked consent button: ${selector}`);
          await this.browserService.waitFor(2000);
          operation.success('Cookie consent handled successfully', { selector });
          return;
        } catch {
          // Continue to next selector
        }
      }

      operation.success('No cookie consent banner found or already handled');
    } catch (error) {
      operation.error(error, 'Error handling cookie consent', {
        errorMessage: this.sanitizeErrorMessage(error.message),
      });
    }
  }

  /**
   * Handles YouTube consent page redirects during authentication.
   * @returns {Promise<void>}
   */
  async handleConsentPageRedirect() {
    const operation = this.logger.startOperation('handleConsentPageRedirect');

    try {
      const currentUrl = await this.browserService.evaluate(() => {
        // eslint-disable-next-line no-undef
        return window.location.href;
      });

      if (currentUrl.includes('consent.youtube.com')) {
        operation.progress('Detected YouTube consent page redirect, attempting to handle');

        // Wait for consent page to load
        await this.browserService.waitFor(2000);

        // YouTube consent page specific selectors
        const consentSelectors = [
          'button:has-text("Alle akzeptieren")', // German "Accept all"
          'button:has-text("Accept all")', // English
          'button:has-text("I agree")',
          'button:has-text("Einverstanden")', // German "Agree"
          'form[action*="consent"] button[type="submit"]', // Generic consent form
          '[data-value="1"]', // YouTube consent accept button
        ];

        for (const selector of consentSelectors) {
          try {
            await this.browserService.waitForSelector(selector, { timeout: 3000 });
            await this.browserService.click(selector);
            operation.progress(`Clicked YouTube consent button: ${selector}`);
            await this.browserService.waitFor(3000);
            operation.success('YouTube consent page handled successfully', { selector });
            return;
          } catch {
            // Continue to next selector
          }
        }

        operation.error(new Error('No consent buttons found'), 'Could not handle YouTube consent page');
      } else {
        operation.success('No YouTube consent page redirect detected', { currentUrl });
      }
    } catch (error) {
      operation.error(error, 'Error handling YouTube consent page redirect', {
        errorMessage: this.sanitizeErrorMessage(error.message),
      });
    }
  }

  /**
   * Handles account security challenges during authentication.
   * @returns {Promise<boolean>} True if no challenges or successfully handled
   */
  async handleAccountChallenges() {
    const operation = this.logger.startOperation('handleAccountChallenges');

    try {
      // Check for email verification challenge
      const emailChallengeSelectors = [
        'input[type="email"][placeholder*="verification"]',
        'input[name="knowledgePreregisteredEmailResponse"]',
        'input[data-initial-value][type="email"]',
      ];

      for (const selector of emailChallengeSelectors) {
        try {
          await this.browserService.waitForSelector(selector, { timeout: 3000 });
          operation.error(
            new Error('Email verification challenge detected'),
            'Email verification challenge requires manual intervention'
          );
          return false;
        } catch {
          // Continue to next selector
        }
      }

      // Check for phone verification challenge
      const phoneChallengeSelectors = [
        'input[type="tel"][placeholder*="phone"]',
        'input[name="phoneNumberId"]',
        'input[data-initial-value][type="tel"]',
      ];

      for (const selector of phoneChallengeSelectors) {
        try {
          await this.browserService.waitForSelector(selector, { timeout: 3000 });
          operation.error(
            new Error('Phone verification challenge detected'),
            'Phone verification challenge requires manual intervention'
          );
          return false;
        } catch {
          // Continue to next selector
        }
      }

      operation.success('No account challenges detected');
      return true;
    } catch (error) {
      operation.error(error, 'Error checking account challenges', {
        errorMessage: this.sanitizeErrorMessage(error.message),
      });
      return false;
    }
  }

  /**
   * Handles 2FA challenges during authentication.
   * @returns {Promise<boolean>} True if no 2FA required or successfully handled
   */
  async handle2FA() {
    const operation = this.logger.startOperation('handle2FA');

    try {
      // Check for 2FA code input
      const twoFASelectors = [
        'input[name="totpPin"]',
        'input[type="tel"][maxlength="6"]',
        'input[placeholder*="code"]',
        'input[aria-label*="verification code"]',
      ];

      for (const selector of twoFASelectors) {
        try {
          await this.browserService.waitForSelector(selector, { timeout: 3000 });
          operation.error(
            new Error('2FA challenge detected'),
            '2FA challenge detected - authentication cannot proceed automatically'
          );
          return false;
        } catch {
          // Continue to next selector
        }
      }

      operation.success('No 2FA challenge detected');
      return true;
    } catch (error) {
      operation.error(error, 'Error checking 2FA requirements', {
        errorMessage: this.sanitizeErrorMessage(error.message),
      });
      return false;
    }
  }

  /**
   * Handles CAPTCHA challenges during authentication.
   * @returns {Promise<boolean>} True if no CAPTCHA required or successfully handled
   */
  async handleCaptcha() {
    const operation = this.logger.startOperation('handleCaptcha');

    try {
      // Common CAPTCHA selectors
      const captchaSelectors = [
        '[data-sitekey]', // reCAPTCHA
        '.g-recaptcha', // reCAPTCHA v2
        '#recaptcha', // Generic reCAPTCHA
        '[src*="captcha"]', // Image CAPTCHA
        'iframe[src*="recaptcha"]', // reCAPTCHA iframe
        '[aria-label*="captcha"]', // Accessibility CAPTCHA
        'canvas[width][height]', // Canvas-based CAPTCHA (some bot detection)
      ];

      for (const selector of captchaSelectors) {
        try {
          await this.browserService.waitForSelector(selector, { timeout: 2000 });
          operation.error(
            new Error('CAPTCHA challenge detected'),
            'CAPTCHA challenge detected - authentication cannot proceed automatically'
          );
          return false;
        } catch {
          // Continue to next selector
        }
      }

      operation.success('No CAPTCHA challenge detected');
      return true;
    } catch (error) {
      operation.error(error, 'Error checking CAPTCHA requirements', {
        errorMessage: this.sanitizeErrorMessage(error.message),
      });
      return false;
    }
  }

  /**
   * Checks if the current session is authenticated with YouTube.
   * Uses multiple verification methods for robust authentication detection.
   * @returns {Promise<boolean>} True if authenticated
   */
  async isAuthenticated() {
    const operation = this.logger.startOperation('isAuthenticated', {
      hasBrowser: !!this.browserService,
      hasPage: !!(this.browserService && this.browserService.page),
    });

    try {
      if (!this.browserService || !this.browserService.page) {
        operation.success('Browser service not available', {
          authenticated: false,
          reason: 'no_browser_service',
        });
        return false;
      }

      // Try to navigate to YouTube and check if we're logged in
      operation.progress('Checking authentication by navigating to YouTube');
      await this.browserService.goto('https://www.youtube.com', { timeout: 15000, waitUntil: 'domcontentloaded' });

      // Wait for page to fully load
      await this.browserService.waitFor(3000);

      // Check for signs of being logged in using multiple indicators
      const authIndicators = await this.browserService.evaluate(() => {
        // Multiple selectors for avatar/account buttons (YouTube UI changes frequently)

        const avatarSelectors = [
          '#avatar-btn',
          '[aria-label*="Account menu"]',
          'button[aria-label*="Google Account"]',
          'button[aria-label*="account"]',
          'yt-img-shadow[id="avatar"]',
          '.ytd-topbar-menu-button-renderer button',
          '#img',
        ];

        let avatarButton = null;
        for (const selector of avatarSelectors) {
          // eslint-disable-next-line no-undef
          avatarButton = document.querySelector(selector);
          if (avatarButton) {
            break;
          }
        }

        // Multiple selectors for sign-in buttons

        const signInSelectors = [
          'a[aria-label*="Sign in"]',
          'button[aria-label*="Sign in"]',
          '.sign-in-link',
          '[href*="accounts.google.com"]',
          'tp-yt-paper-button:has-text("Sign in")',
        ];

        let signInButton = null;
        for (const selector of signInSelectors) {
          // eslint-disable-next-line no-undef
          signInButton = document.querySelector(selector);
          if (signInButton) {
            break;
          }
        }

        // Check for authentication cookies as additional indicator
        // eslint-disable-next-line no-undef
        const hasAuthCookies = document.cookie.includes('SAPISID') || document.cookie.includes('LOGIN_INFO');

        // Check for authenticated user-specific elements
        // eslint-disable-next-line no-undef
        const hasUserMenu = !!document.querySelector('[aria-label*="menu"], [data-target-id="topbar-menu-button"]');

        // Check if we're on login/error pages (bad indicators)

        const onLoginPage =
          // eslint-disable-next-line no-undef
          window.location.href.includes('accounts.google.com') ||
          // eslint-disable-next-line no-undef
          window.location.href.includes('login') ||
          // eslint-disable-next-line no-undef
          window.location.href.includes('signin') ||
          // eslint-disable-next-line no-undef
          document.title.toLowerCase().includes('sign in');

        return {
          hasAvatar: !!avatarButton,
          hasSignIn: !!signInButton,
          hasAuthCookies,
          hasUserMenu,
          onLoginPage,
          // eslint-disable-next-line no-undef
          currentUrl: window.location.href,
          // eslint-disable-next-line no-undef
          pageTitle: document.title,
        };
      });

      // Multiple authentication indicators - use a scoring system
      let authScore = 0;

      if (authIndicators.hasAvatar) {
        authScore += 3;
      } // Strong positive indicator
      if (!authIndicators.hasSignIn) {
        authScore += 2;
      } // Good positive indicator
      if (authIndicators.hasAuthCookies) {
        authScore += 2;
      } // Good positive indicator
      if (authIndicators.hasUserMenu) {
        authScore += 1;
      } // Weak positive indicator
      if (authIndicators.onLoginPage) {
        authScore -= 5;
      } // Strong negative indicator

      const isAuthenticated = authScore >= 3; // Require strong evidence

      operation.success(`Authentication check completed with score ${authScore}`, {
        authenticated: isAuthenticated,
        method: 'multi_indicator_scoring',
        authScore,
        hasAvatar: authIndicators.hasAvatar,
        hasSignIn: authIndicators.hasSignIn,
        hasAuthCookies: authIndicators.hasAuthCookies,
        hasUserMenu: authIndicators.hasUserMenu,
        onLoginPage: authIndicators.onLoginPage,
        currentUrl: authIndicators.currentUrl.substring(0, 120),
        pageTitle: authIndicators.pageTitle.substring(0, 30),
      });

      return isAuthenticated;
    } catch (error) {
      operation.error(error, 'Error checking authentication status', {
        errorMessage: this.sanitizeErrorMessage(error.message),
      });
      return false;
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
   * Clears sensitive data from memory after successful authentication.
   * @returns {void}
   */
  clearSensitiveData() {
    // Clear credentials from memory after successful authentication
    this.youtubeUsername = null;
    this.youtubePassword = null;
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
    const originalUsername = this.config.getRequired('YOUTUBE_USERNAME');
    const originalPassword = this.config.getRequired('YOUTUBE_PASSWORD');

    // Replace credentials with placeholders
    if (originalPassword) {
      sanitized = sanitized.replace(new RegExp(originalPassword, 'g'), '[REDACTED_PASSWORD]');
    }
    if (originalUsername) {
      sanitized = sanitized.replace(new RegExp(originalUsername, 'g'), '[REDACTED_USERNAME]');
    }

    return sanitized;
  }
}
