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
    this.authEnabled = this.config.get('YOUTUBE_AUTHENTICATION_ENABLED', 'false') === 'true';

    // Cookie persistence configuration
    this.cookieStorageKey = 'youtube_auth_cookies';
    this.cookieExpiryHours = 24; // Consider cookies stale after 24 hours

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

        // Try to restore saved cookies first
        await this.restoreSavedCookies();

        // Quick authentication check first (faster)
        if (await this.isQuickAuthenticated()) {
          operation.success('Already authenticated with YouTube (quick check)', {
            method: 'quick_session_check',
            attempt,
          });
          return true;
        }

        // Full authentication check as fallback
        if (await this.isAuthenticated()) {
          operation.success('Already authenticated with YouTube (full check)', {
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

      // Save existing cookies before clearing (for potential restoration)
      operation.progress('Saving existing cookies before fresh authentication');
      const existingCookies = await this.browserService.getCookies();
      const hasPotentialAuthCookies = existingCookies.some(
        cookie => cookie.name === 'SAPISID' || cookie.name === 'LOGIN_INFO' || cookie.name === 'SID'
      );

      if (hasPotentialAuthCookies) {
        operation.progress('Found existing auth cookies, testing validity before clearing');
        const cookieTestResult = await this.testProtectedEndpointAccess();
        if (cookieTestResult.hasAccess) {
          operation.success('Existing cookies are valid, skipping fresh authentication', {
            method: 'existing_valid_cookies',
            statusCode: cookieTestResult.statusCode,
          });
          return true;
        }
        operation.progress('Existing cookies are invalid, proceeding with fresh authentication');
      }

      // Clear all cookies to ensure clean authentication state
      operation.progress('Clearing existing cookies for fresh authentication');
      await this.browserService.clearCookies();

      // Navigate to YouTube sign-in page
      operation.progress('Navigating to Google sign-in page');
      await this.browserService.goto('https://accounts.google.com/signin/v2/identifier?service=youtube');

      // Wait for sign-in page to load fully
      await this.browserService.waitFor(2000);

      // Verify we're on the sign-in page
      // eslint-disable-next-line
      const currentUrl = await this.browserService.evaluate(() => window.location.href);
      if (!currentUrl.includes('accounts.google.com')) {
        operation.error(new Error('Not on Google sign-in page'), `Expected sign-in page but on: ${currentUrl}`);
        return false;
      }

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

      // Handle potential challenges (with shorter timeouts for faster detection)
      operation.progress('Checking for authentication challenges');
      const challengeResult = await this.handleAccountChallenges();
      if (!challengeResult) {
        operation.error(new Error('Authentication challenge failed'), 'Account challenge handling failed');
        return false;
      }

      // Check for 2FA (with shorter timeout for faster detection)
      operation.progress('Checking for 2FA requirements');
      const twoFAResult = await this.handle2FA();
      if (!twoFAResult) {
        operation.error(new Error('2FA required but not supported'), '2FA challenge detected');
        return false;
      }

      // Check for CAPTCHA (with shorter timeout for faster detection)
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
        // Save cookies for future use
        operation.progress('Saving authentication cookies for persistence');
        await this.saveCookies();

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
      // Clear potentially invalid saved cookies on authentication failure
      this.clearSavedCookies();

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

    /* eslint-disable no-undef */
    try {
      const currentUrl = await this.browserService.evaluate(() => {
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
        operation.success('No YouTube consent page redirect detected', {
          currentUrl: this.sanitizeUrl(currentUrl),
        });
      }
    } catch (error) {
      operation.error(error, 'Error handling YouTube consent page redirect', {
        errorMessage: this.sanitizeErrorMessage(error.message),
      });
      /* eslint-disable no-undef */
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
          await this.browserService.waitForSelector(selector, { timeout: 1000 });
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
          await this.browserService.waitForSelector(selector, { timeout: 1000 });
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
          await this.browserService.waitForSelector(selector, { timeout: 1000 });
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
          await this.browserService.waitForSelector(selector, { timeout: 1000 });
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
   * Test access to a protected YouTube endpoint to verify authentication is valid
   * @returns {Promise<Object>} Object with hasAccess boolean and statusCode
   */
  async testProtectedEndpointAccess() {
    try {
      if (!this.browserService || !this.browserService.page) {
        return { hasAccess: false, statusCode: 0, error: 'No browser service available' };
      }

      // Navigate to library page and check if we can access it without redirects to login
      const originalUrl = await this.browserService.evaluate(() => window.location.href);

      try {
        await this.browserService.goto('https://www.youtube.com/feed/library', {
          timeout: 10000,
          waitUntil: 'domcontentloaded',
        });

        // Wait for page to load
        await this.browserService.waitFor(2000);

        const finalUrl = await this.browserService.evaluate(() => window.location.href);
        const pageTitle = await this.browserService.evaluate(() => document.title);

        // If we're redirected to accounts.google.com or login pages, we don't have access
        const isOnLoginPage =
          finalUrl.includes('accounts.google.com') ||
          finalUrl.includes('/signin') ||
          pageTitle.toLowerCase().includes('sign in');

        // Check for error pages (like 400/403/404)
        const isErrorPage =
          pageTitle.includes('Error') ||
          pageTitle.includes('400') ||
          pageTitle.includes('403') ||
          pageTitle.includes('404');

        // Check if library page loaded successfully by looking for library-specific elements
        const hasLibraryContent = await this.browserService.evaluate(() => {
          // Look for typical library page elements
          const indicators = [
            document.querySelector('[href="/feed/history"]'), // History link
            document.querySelector('[href="/feed/playlists"]'), // Playlists link
            document.querySelector('[href*="playlist?list=WL"]'), // Watch later
            document.querySelector('[href*="playlist?list=LL"]'), // Liked videos
            document.title.includes('Library') || document.title.includes('YouTube'),
          ];
          return indicators.some(indicator => indicator);
        });

        const hasAccess = !isOnLoginPage && !isErrorPage && hasLibraryContent;
        const statusCode = hasAccess ? 200 : isOnLoginPage ? 401 : isErrorPage ? 403 : 0;

        // Navigate back to original URL to avoid side effects
        if (originalUrl !== finalUrl) {
          try {
            await this.browserService.goto(originalUrl, { timeout: 5000 });
          } catch {
            // Ignore navigation back errors
          }
        }

        return {
          hasAccess,
          statusCode,
          finalUrl: finalUrl.substring(0, 120), // Truncate for logging
          pageTitle: pageTitle.substring(0, 50),
        };
      } catch (navigationError) {
        // Navigation failed - likely no access
        return {
          hasAccess: false,
          statusCode: 0,
          error: navigationError.message,
        };
      }
    } catch (error) {
      return {
        hasAccess: false,
        statusCode: 0,
        error: error.message,
      };
    }
  }

  /**
   * Quick authentication check that can be called frequently without side effects.
   * Uses a lightweight approach to verify authentication status.
   * @returns {Promise<boolean>} True if authenticated
   */
  async isQuickAuthenticated() {
    try {
      if (!this.browserService || !this.browserService.page) {
        return false;
      }

      // Check if page is closed
      if (this.browserService.page.isClosed()) {
        return false;
      }

      // Quick cookie-based check first (fastest method)
      const hasAuthCookies = await this.browserService.evaluate(() => {
        return document.cookie.includes('SAPISID') || document.cookie.includes('LOGIN_INFO');
      });

      return hasAuthCookies;
    } catch (_error) {
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
      pageIsClosed: !!(this.browserService && this.browserService.page && this.browserService.page.isClosed()),
    });

    try {
      if (!this.browserService || !this.browserService.page) {
        operation.success('Browser service not available', {
          authenticated: false,
          reason: 'no_browser_service',
        });
        return false;
      }

      // Check if page is closed
      if (this.browserService.page.isClosed()) {
        operation.success('Browser page is closed', {
          authenticated: false,
          reason: 'page_closed',
        });
        return false;
      }

      // First, try to navigate to YouTube and check if we're logged in
      operation.progress('Checking authentication by navigating to YouTube');
      await this.browserService.goto('https://www.youtube.com', { timeout: 15000, waitUntil: 'domcontentloaded' });

      // Wait for page to fully load
      await this.browserService.waitFor(3000);

      // Test access to a protected endpoint to verify cookies are valid
      operation.progress('Testing access to protected endpoint to verify authentication');
      const protectedAccessTest = await this.testProtectedEndpointAccess();
      if (!protectedAccessTest.hasAccess) {
        operation.success('Authentication failed: no access to protected endpoints', {
          authenticated: false,
          reason: 'no_protected_access',
          statusCode: protectedAccessTest.statusCode,
        });
        return false;
      }

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
          avatarButton = document.querySelector(selector);
          if (avatarButton) {
            break;
          }
        }

        // Check for authentication cookies as additional indicator

        const hasAuthCookies = document.cookie.includes('SAPISID') || document.cookie.includes('LOGIN_INFO');

        // Check for authenticated user-specific elements

        const hasUserMenu = !!document.querySelector('[aria-label*="menu"], [data-target-id="topbar-menu-button"]');

        // Check if we're on login/error pages (bad indicators)

        // Multiple selectors for sign-in buttons

        const signInSelectors = [
          'a[aria-label*="Sign in"]',
          'button[aria-label*="Sign in"]',
          '.sign-in-link',
          '[href*="accounts.google.com"]',
          'tp-yt-paper-button',
          // Additional aggressive detection for YouTube's various sign-in states
          'button[aria-label*="sign in"]', // case variations
          'a[aria-label*="sign in"]',
          '[data-target-id="sign-in-button"]',
          'yt-button-renderer[aria-label*="Sign in"]',
          '.ytd-button-renderer[aria-label*="Sign in"]',
          // Note: :contains() selector removed as it's not valid CSS - handled by text-based search below
        ];

        let signInButton = null;
        for (const selector of signInSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            // Special handling for tp-yt-paper-button - check if it contains "Sign in" text
            if (selector === 'tp-yt-paper-button') {
              if (element.textContent && element.textContent.includes('Sign in')) {
                signInButton = element;
                break;
              }
            } else {
              signInButton = element;
              break;
            }
          }
        }

        // Additional aggressive text-based search for "Sign in" if not found yet
        if (!signInButton) {
          const allButtons = document.querySelectorAll('button, a, yt-button-renderer, .ytd-button-renderer');
          for (const btn of allButtons) {
            const text = btn.textContent || btn.innerText || '';
            const ariaLabel = btn.getAttribute('aria-label') || '';
            if (text.toLowerCase().includes('sign in') || ariaLabel.toLowerCase().includes('sign in')) {
              signInButton = btn;
              break;
            }
          }
        }

        const onLoginPage =
          window.location.href.includes('accounts.google.com') ||
          window.location.href.includes('login') ||
          window.location.href.includes('signin') ||
          document.title.toLowerCase().includes('sign in');

        return {
          hasAvatar: !!avatarButton,
          hasSignIn: !!signInButton,
          hasAuthCookies,
          hasUserMenu,
          onLoginPage,

          currentUrl: window.location.href,

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
      if (authIndicators.hasSignIn) {
        authScore -= 2;
      } // Moderate negative indicator - "Sign in" button visible (reduced from -4 for headless compatibility)
      if (authIndicators.hasAuthCookies) {
        authScore += 2;
      } // Good positive indicator
      if (authIndicators.hasUserMenu) {
        authScore += 1;
      } // Weak positive indicator
      if (authIndicators.onLoginPage) {
        authScore -= 5;
      } // Strong negative indicator

      const isAuthenticated = authScore >= 3; // Require positive authentication indicators, not just absence of login prompts

      operation.success(`Authentication check completed with score ${authScore}`, {
        authenticated: isAuthenticated,
        method: 'multi_indicator_scoring',
        authScore,
        hasAvatar: authIndicators.hasAvatar,
        hasSignIn: authIndicators.hasSignIn,
        hasAuthCookies: authIndicators.hasAuthCookies,
        hasUserMenu: authIndicators.hasUserMenu,
        onLoginPage: authIndicators.onLoginPage,
        currentUrl: (authIndicators.currentUrl || '').substring(0, 120),
        pageTitle: (authIndicators.pageTitle || '').substring(0, 30),
      });

      // Enhanced debugging for authentication detection issues
      this.logger.info(
        `YouTube auth debug: ${JSON.stringify({
          authScore,
          indicators: authIndicators,
          scoreBreakdown: {
            avatar: authIndicators.hasAvatar ? '+3' : '0',
            noSignIn: !authIndicators.hasSignIn ? '+2' : '0',
            hasSignIn: authIndicators.hasSignIn ? '-2' : '0',
            authCookies: authIndicators.hasAuthCookies ? '+2' : '0',
            userMenu: authIndicators.hasUserMenu ? '+1' : '0',
            loginPage: authIndicators.onLoginPage ? '-5' : '0',
          },
        })}`
      );

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
   * Save authentication cookies to persistent storage
   * @returns {Promise<void>}
   */
  async saveCookies() {
    try {
      if (!this.browserService || !this.browserService.page) {
        return;
      }

      const cookies = await this.browserService.getCookies();
      const authCookies = cookies.filter(
        cookie =>
          cookie.name === 'SAPISID' ||
          cookie.name === 'LOGIN_INFO' ||
          cookie.name === 'SID' ||
          cookie.name === 'HSID' ||
          cookie.name === 'SSID' ||
          cookie.name === 'APISID'
      );

      if (authCookies.length > 0) {
        const cookieData = {
          cookies: authCookies,
          timestamp: Date.now(),
        };

        this.state.set(this.cookieStorageKey, cookieData);
        this.logger.debug(`Saved ${authCookies.length} authentication cookies for persistence`);
      }
    } catch (error) {
      this.logger.error('Failed to save authentication cookies:', error.message);
    }
  }

  /**
   * Restore saved authentication cookies
   * @returns {Promise<void>}
   */
  async restoreSavedCookies() {
    try {
      if (!this.browserService || !this.browserService.page) {
        return;
      }

      const cookieData = this.state.get(this.cookieStorageKey);
      if (!cookieData || !cookieData.cookies) {
        return;
      }

      // Check if cookies are not too old
      const ageHours = (Date.now() - cookieData.timestamp) / (1000 * 60 * 60);
      if (ageHours > this.cookieExpiryHours) {
        this.logger.debug(`Saved cookies are ${Math.round(ageHours)}h old, clearing stale data`);
        this.state.delete(this.cookieStorageKey);
        return;
      }

      // Restore cookies
      await this.browserService.setCookies(cookieData.cookies);
      this.logger.debug(`Restored ${cookieData.cookies.length} authentication cookies from storage`);
    } catch (error) {
      this.logger.error('Failed to restore authentication cookies:', error.message);
      // Clear potentially corrupted cookie data
      this.state.delete(this.cookieStorageKey);
    }
  }

  /**
   * Clear saved authentication cookies
   * @returns {void}
   */
  clearSavedCookies() {
    this.state.delete(this.cookieStorageKey);
    this.logger.debug('Cleared saved authentication cookies');
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

  /**
   * Sanitizes URLs to remove sensitive authentication tokens and parameters.
   * @param {string} url - URL to sanitize
   * @returns {string} Sanitized URL with sensitive parameters removed
   */
  sanitizeUrl(url) {
    if (typeof url !== 'string' || url.trim() === '') {
      return '[INVALID_URL]';
    }

    try {
      const urlObj = new URL(url);

      // Remove sensitive query parameters commonly found in Google OAuth URLs
      const sensitiveParams = [
        'TL', // Google OAuth token
        'dsh', // Session hash
        'ifkv', // Form verification token
        'flowEntry', // OAuth flow entry point
        'flowName', // OAuth flow name
        'checkConnection', // Connection check parameter
        'checkedDomains', // Domain check parameter
        'pstMsg', // Post message parameter
        'lid', // Login ID
        'service', // Service identifier
        'continue', // Redirect URL (may contain sensitive info)
        'state', // OAuth state parameter
        'code', // OAuth authorization code
        'access_token', // Access token
        'id_token', // ID token
        'session_state', // Session state
        'authuser', // Authenticated user parameter
      ];

      // Remove sensitive parameters
      sensitiveParams.forEach(param => {
        urlObj.searchParams.delete(param);
      });

      // Special handling for accounts.google.com URLs - redact most query params
      if (urlObj.hostname === 'accounts.google.com') {
        // Keep only essential, non-sensitive parameters
        const allowedParams = ['hl', 'lang', 'locale']; // Language/locale params are safe
        const paramsToKeep = new URLSearchParams();

        allowedParams.forEach(param => {
          if (urlObj.searchParams.has(param)) {
            paramsToKeep.set(param, urlObj.searchParams.get(param));
          }
        });

        urlObj.search = paramsToKeep.toString();

        // If there were removed parameters, indicate this
        const originalParamCount = url.match(/[?&]/g)?.length || 0;
        const keptParamCount = paramsToKeep.toString() ? paramsToKeep.toString().split('&').length : 0;

        if (originalParamCount > keptParamCount) {
          const removedCount = originalParamCount - keptParamCount;
          return `${urlObj.toString()}${urlObj.search ? '&' : '?'}[${removedCount}_SENSITIVE_PARAMS_REMOVED]`;
        }
      }

      return urlObj.toString();
    } catch (_error) {
      // If URL parsing fails, return a safe fallback
      const domain = url.match(/https?:\/\/([^/?]+)/)?.[1] || '[UNKNOWN_DOMAIN]';
      return `https://${domain}/[SANITIZED_URL]`;
    }
  }
}
