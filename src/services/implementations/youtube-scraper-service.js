import { PlaywrightBrowserService } from './playwright-browser-service.js';

/**
 * YouTube web scraper service for near-instantaneous content detection
 * Provides an alternative to API polling for faster notifications
 */
export class YouTubeScraperService {
  constructor({ logger, config, contentCoordinator }) {
    this.logger = logger;
    this.config = config;
    this.contentCoordinator = contentCoordinator;
    this.browserService = new PlaywrightBrowserService();
    this.videosUrl = null;
    this.liveStreamUrl = null;
    this.isInitialized = false;
    this.isRunning = false;
    this.scrapingInterval = null;
    this.isAuthenticated = false;

    // Configuration
    this.minInterval = parseInt(config.get('YOUTUBE_SCRAPER_INTERVAL_MIN', '300000'), 10);
    this.maxInterval = parseInt(config.get('YOUTUBE_SCRAPER_INTERVAL_MAX', '600000'), 10);
    this.maxRetries = config.get('YOUTUBE_SCRAPER_MAX_RETRIES', 3);
    this.retryDelayMs = config.get('YOUTUBE_SCRAPER_RETRY_DELAY_MS', 5000);
    this.timeoutMs = config.get('YOUTUBE_SCRAPER_TIMEOUT_MS', 30000);

    // Authentication configuration
    this.authEnabled = config.getBoolean('YOUTUBE_AUTHENTICATION_ENABLED', false);
    this.youtubeUsername = config.get('YOUTUBE_USERNAME');
    this.youtubePassword = config.get('YOUTUBE_PASSWORD');

    // Metrics
    this.metrics = {
      totalScrapingAttempts: 0,
      successfulScrapes: 0,
      failedScrapes: 0,
      videosDetected: 0,
      livestreamsDetected: 0,
      lastSuccessfulScrape: null,
      lastError: null,
    };
  }

  /**
   * Initialize the scraper with channel URL
   * @param {string} channelHandle - YouTube channel handle (e.g., @channelname)
   * @returns {Promise<void>}
   */
  async initialize(channelHandle) {
    if (this.isInitialized) {
      throw new Error('YouTube scraper is already initialized');
    }

    // Construct channel URLs
    const baseUrl = `https://www.youtube.com/@${channelHandle}`;
    this.videosUrl = `${baseUrl}/videos`;
    this.liveStreamUrl = `${baseUrl}/live`;

    try {
      // Launch browser with optimized settings for scraping
      await this.browserService.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          // Performance optimizations for non-headless mode
          '--disable-images',
          '--disable-plugins',
          '--disable-extensions',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-audio-output',
          '--mute-audio',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
        ],
      });

      // Set user agent to appear as regular browser
      await this.browserService.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Set viewport
      await this.browserService.setViewport({ width: 1920, height: 1080 });

      // Mark as initialized before fetching to avoid circular dependency
      this.isInitialized = true;

      // Perform authentication if enabled
      if (this.authEnabled) {
        await this.authenticateWithYouTube();
      }

      // Find and set the initial latest video
      const latestVideo = await this.fetchLatestVideo();
      if (latestVideo) {
        await this.contentCoordinator.processContent(latestVideo.id, 'scraper', latestVideo);
        this.logger.info('YouTube scraper initialized', {
          videosUrl: this.videosUrl,
          initialContentId: latestVideo.id,
          title: latestVideo.title,
        });
      } else {
        this.logger.warn('YouTube scraper initialized but no videos found', {
          videosUrl: this.videosUrl,
        });
      }
    } catch (error) {
      this.isInitialized = false;
      this.logger.error('Failed to initialize YouTube scraper', {
        error: error.message,
        stack: error.stack,
        videosUrl: this.videosUrl,
      });
      throw error;
    }
  }

  /**
   * Authenticate with YouTube using credentials
   * @returns {Promise<void>}
   */
  async authenticateWithYouTube() {
    if (!this.authEnabled) {
      this.logger.debug('YouTube authentication is disabled');
      return;
    }

    if (!this.youtubeUsername || !this.youtubePassword) {
      this.logger.warn('YouTube authentication enabled but credentials not provided');
      return;
    }

    try {
      this.logger.info('Starting YouTube authentication...');

      // Navigate to YouTube sign-in page
      await this.browserService.goto('https://accounts.google.com/signin/v2/identifier?service=youtube');

      // Handle cookie consent if present
      await this.handleCookieConsent();

      // Wait for email input
      await this.browserService.waitForSelector('input[type="email"]', { timeout: 10000 });

      // Enter email/username
      await this.browserService.type('input[type="email"]', this.youtubeUsername);

      // Click Next
      await this.browserService.click('#identifierNext');
      await this.browserService.waitFor(3000);

      // Check for account security challenges
      const challengeHandled = await this.handleAccountChallenges();
      if (!challengeHandled) {
        return;
      }

      // Wait for password input
      await this.browserService.waitForSelector('input[type="password"]', { timeout: 10000 });

      // Enter password
      await this.browserService.type('input[type="password"]', this.youtubePassword);

      // Click Next/Sign In
      await this.browserService.click('#passwordNext');

      // Wait for navigation to complete and handle any post-login challenges
      await this.browserService.waitFor(5000);

      // Handle 2FA if present
      const twoFAHandled = await this.handle2FA();
      if (!twoFAHandled) {
        return;
      }

      // Check for CAPTCHA challenges
      const captchaHandled = await this.handleCaptcha();
      if (!captchaHandled) {
        return;
      }

      // Handle device verification if present
      await this.handleDeviceVerification();

      // Check if we're successfully logged in by navigating to YouTube and looking for signed-in indicators
      await this.browserService.goto('https://www.youtube.com');
      await this.browserService.waitFor(3000);

      // Check for signed-in user avatar/menu
      const signedIn = await this.browserService.evaluate(() => {
        /* eslint-disable no-undef */
        // Look for signed-in indicators
        return (
          document.querySelector('button[aria-label*="Google Account"]') ||
          document.querySelector('#avatar-btn') ||
          document.querySelector('ytd-topbar-menu-button-renderer') ||
          document.querySelector('[id="guide-section-3"]') ||
          // Additional selectors for signed-in state
          document.querySelector('[data-uia="user-menu-toggle"]') ||
          document.querySelector('.ytp-chrome-top .ytp-user-avatar') ||
          document.querySelector('yt-img-shadow#avatar')
        );
        /* eslint-enable no-undef */
      });

      if (signedIn) {
        this.isAuthenticated = true;
        this.logger.info('✅ Successfully authenticated with YouTube');
      } else {
        this.logger.warn('YouTube authentication may have failed - proceeding without authentication');
      }
    } catch (error) {
      this.logger.error('Failed to authenticate with YouTube:', {
        error: error.message,
        stack: error.stack,
      });
      this.logger.warn('Continuing without YouTube authentication');
    }
  }

  /**
   * Handle cookie consent banners
   * @returns {Promise<void>}
   */
  async handleCookieConsent() {
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
          this.logger.debug(`Clicked cookie consent button: ${selector}`);
          await this.browserService.waitFor(1000);
          return;
        } catch {
          // Continue to next selector
        }
      }

      this.logger.debug('No cookie consent banner found');
    } catch (error) {
      this.logger.debug('Error handling cookie consent:', error.message);
    }
  }

  /**
   * Handle YouTube consent page redirects
   * @returns {Promise<void>}
   */
  async handleConsentPageRedirect() {
    try {
      const currentUrl = await this.browserService.evaluate(() => {
        // eslint-disable-next-line no-undef
        return window.location.href;
      });

      if (currentUrl.includes('consent.youtube.com')) {
        this.logger.info('Detected YouTube consent page redirect, attempting to handle');

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
          'button[jsname]:has-text("Akzeptieren")', // German accept with jsname
          'button[jsname]:has-text("Accept")', // English accept with jsname
        ];

        let consentHandled = false;
        for (const selector of consentSelectors) {
          try {
            await this.browserService.waitForSelector(selector, { timeout: 5000 });
            await this.browserService.click(selector);
            this.logger.info(`Clicked YouTube consent button: ${selector}`);

            // Wait for redirect back to YouTube
            await this.browserService.waitFor(3000);

            // Check if we're back on YouTube proper
            const newUrl = await this.browserService.evaluate(() => {
              // eslint-disable-next-line no-undef
              return window.location.href;
            });
            if (!newUrl.includes('consent.youtube.com')) {
              this.logger.info('Successfully handled consent redirect, now on YouTube');
              consentHandled = true;
              break;
            }
          } catch {
            // Continue to next selector
            continue;
          }
        }

        if (!consentHandled) {
          this.logger.warn('Could not handle YouTube consent page automatically');
          // Try to navigate directly to the videos page again
          await this.browserService.goto(this.videosUrl, {
            waitUntil: 'networkidle',
            timeout: this.timeoutMs,
          });
        }
      }
    } catch (error) {
      this.logger.debug('Error handling consent page redirect:', error.message);
    }
  }

  /**
   * Handle account security challenges (email verification, etc.)
   * @returns {Promise<boolean>} True if challenge was handled or no challenge present
   */
  async handleAccountChallenges() {
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
          this.logger.warn('Email verification challenge detected - requires manual intervention');
          this.logger.info('Please check your email and complete verification manually');
          return false;
        } catch {
          // Continue to next selector
        }
      }

      // Check for phone verification challenge
      const phoneSelectors = ['input[type="tel"]', 'input[name="phoneNumberId"]'];

      for (const selector of phoneSelectors) {
        try {
          await this.browserService.waitForSelector(selector, { timeout: 3000 });
          this.logger.warn('Phone verification challenge detected - requires manual intervention');
          return false;
        } catch {
          // Continue to next selector
        }
      }

      return true; // No challenges detected
    } catch (error) {
      this.logger.debug('Error checking account challenges:', error.message);
      return true;
    }
  }

  /**
   * Handle 2FA/MFA challenges
   * @returns {Promise<boolean>} True if 2FA was handled or not present
   */
  async handle2FA() {
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
          this.logger.warn('2FA challenge detected - authentication cannot proceed automatically');
          this.logger.info('Please disable 2FA for this account or handle authentication manually');
          return false;
        } catch {
          // Continue to next selector
        }
      }

      return true; // No 2FA challenge
    } catch (error) {
      this.logger.debug('Error checking 2FA:', error.message);
      return true;
    }
  }

  /**
   * Handle CAPTCHA challenges
   * @returns {Promise<boolean>} True if no CAPTCHA present, false if CAPTCHA detected
   */
  async handleCaptcha() {
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
          this.logger.warn('CAPTCHA challenge detected - authentication cannot proceed automatically');
          this.logger.info('Manual intervention required to complete CAPTCHA verification');
          return false;
        } catch {
          // Continue to next selector
        }
      }

      return true; // No CAPTCHA detected
    } catch (error) {
      this.logger.debug('Error checking for CAPTCHA:', error.message);
      return true;
    }
  }

  /**
   * Handle device verification prompts
   * @returns {Promise<void>}
   */
  async handleDeviceVerification() {
    try {
      // Look for "Continue" or "Not now" buttons on device verification screens
      const deviceVerificationSelectors = [
        'button:has-text("Not now")',
        'button:has-text("Continue")',
        '[data-action-button-secondary]',
        'button[jsname="b3VHJd"]', // Google's "Not now" button
      ];

      for (const selector of deviceVerificationSelectors) {
        try {
          await this.browserService.waitForSelector(selector, { timeout: 3000 });
          await this.browserService.click(selector);
          this.logger.debug(`Handled device verification: ${selector}`);
          await this.browserService.waitFor(2000);
          return;
        } catch {
          // Continue to next selector
        }
      }
    } catch (error) {
      this.logger.debug('Error handling device verification:', error.message);
    }
  }

  /**
   * Fetch the latest video from the channel
   * @returns {Promise<Object|null>} Latest video details or null if none found
   */
  async fetchLatestVideo() {
    if (!this.isInitialized) {
      throw new Error('YouTube scraper is not initialized');
    }

    this.metrics.totalScrapingAttempts++;

    try {
      // Navigate to channel videos page
      await this.browserService.goto(this.videosUrl, {
        waitUntil: 'networkidle',
        timeout: this.timeoutMs,
      });

      // Handle consent page if redirected
      await this.handleConsentPageRedirect();

      // Wait for the page to load and videos to appear
      await this.browserService.waitFor(2000);

      // Debug: Log page content for troubleshooting
      let debugInfo = null;
      try {
        debugInfo = await this.browserService.evaluate(() => {
          /* eslint-disable no-undef */
          return {
            title: document.title,
            url: window.location.href,
            ytdRichGridMedia: document.querySelectorAll('ytd-rich-grid-media').length,
            ytdRichItemRenderer: document.querySelectorAll('ytd-rich-item-renderer').length,
            videoTitleById: document.querySelectorAll('a#video-title').length,
            videoTitleLinkById: document.querySelectorAll('#video-title-link').length,
            genericVideoLinks: document.querySelectorAll('a[href*="/watch?v="]').length,
            shortsLinks: document.querySelectorAll('a[href*="/shorts/"]').length,
          };
          /* eslint-enable no-undef */
        });

        this.logger.debug(`YouTube page debug info: ${JSON.stringify(debugInfo, null, 2)}`);
      } catch (error) {
        this.logger.error('Failed to get YouTube page debug info:', error.message);
        debugInfo = { error: 'Failed to evaluate page' };
      }

      // Extract latest video information using multiple selector strategies
      let latestVideo = null;
      try {
        latestVideo = await this.browserService.evaluate(() => {
          const selectors = [
            { name: 'modern-grid', selector: 'ytd-rich-grid-media:first-child #video-title-link' },
            { name: 'rich-item', selector: 'ytd-rich-item-renderer:first-child #video-title-link' },
            { name: 'grid-with-contents', selector: '#contents ytd-rich-grid-media:first-child a#video-title' },
            { name: 'list-renderer', selector: '#contents ytd-video-renderer:first-child a#video-title' },
            { name: 'generic-watch', selector: 'a[href*="/watch?v="]' },
            { name: 'shorts-and-titled', selector: 'a[href*="/shorts/"], a[title][href*="youtube.com/watch"]' },
          ];

          let videoElement = null;
          let usedStrategy = null;

          for (const strategy of selectors) {
            // eslint-disable-next-line no-undef
            videoElement = document.querySelector(strategy.selector);
            if (videoElement) {
              usedStrategy = strategy.name;
              break;
            }
          }

          if (!videoElement) {
            return { success: false, strategies: selectors.map(s => s.name) };
          }

          // Extract video ID from URL
          const videoUrl = videoElement.href;
          let videoIdMatch = videoUrl.match(/[?&]v=([^&]+)/);

          // If no standard video ID, try shorts format
          if (!videoIdMatch) {
            videoIdMatch = videoUrl.match(/\/shorts\/([^?&]+)/);
          }

          if (!videoIdMatch) {
            return { success: false, error: 'Could not extract video ID', url: videoUrl };
          }

          const videoId = videoIdMatch[1];
          const title = videoElement.textContent?.trim() || 'Unknown Title';

          // Try to get additional metadata
          const videoContainer = videoElement.closest(
            'ytd-rich-grid-media, ytd-rich-item-renderer, ytd-video-renderer'
          );
          let publishedText = 'Unknown';
          let viewsText = 'Unknown';
          let thumbnailUrl = null;

          if (videoContainer) {
            // Try to find published time
            const metadataElements = videoContainer.querySelectorAll(
              '#metadata-line span, #published-time-text, .ytd-video-meta-block span'
            );
            for (const element of metadataElements) {
              const text = element.textContent?.trim();
              if (
                text &&
                (text.includes('ago') ||
                  text.includes('hour') ||
                  text.includes('day') ||
                  text.includes('week') ||
                  text.includes('month'))
              ) {
                publishedText = text;
                break;
              }
            }

            // Try to find view count
            for (const element of metadataElements) {
              const text = element.textContent?.trim();
              if (text && (text.includes('view') || text.includes('watching'))) {
                viewsText = text;
                break;
              }
            }

            // Try to find thumbnail
            const thumbnail = videoContainer.querySelector('img[src*="i.ytimg.com"]');
            if (thumbnail) {
              thumbnailUrl = thumbnail.src;
            }
          }

          return {
            success: true,
            strategy: usedStrategy,
            id: videoId,
            title,
            url: videoUrl,
            publishedText,
            viewsText,
            thumbnailUrl,
            type: 'video',
            scrapedAt: new Date().toISOString(),
          };
        });
      } catch (error) {
        this.logger.error('Failed to extract video information:', error.message);
        latestVideo = { success: false, error: `Video extraction failed: ${error.message}` };
      }

      if (latestVideo && latestVideo.success) {
        this.metrics.successfulScrapes++;
        this.metrics.lastSuccessfulScrape = new Date();

        this.logger.info('Successfully scraped latest video', {
          strategy: latestVideo.strategy,
          videoId: latestVideo.id,
          title: latestVideo.title,
          publishedText: latestVideo.publishedText,
        });
      } else {
        const failureInfo = {
          videosUrl: this.videosUrl,
          debugInfo,
        };

        if (latestVideo && !latestVideo.success) {
          failureInfo.attemptedStrategies = latestVideo.strategies;
        }

        this.logger.warn('No videos found during scraping', failureInfo);
      }

      return latestVideo;
    } catch (error) {
      this.metrics.failedScrapes++;
      this.metrics.lastError = {
        message: error.message,
        timestamp: new Date(),
      };

      this.logger.error('Failed to scrape YouTube channel', {
        error: error.message,
        stack: error.stack,
        videosUrl: this.videosUrl,
        attempt: this.metrics.totalScrapingAttempts,
      });

      return null;
    }
  }

  /**
   * Fetch the active live stream from the channel's live tab
   * @returns {Promise<Object|null>} Active live stream details or null if none found
   */
  async fetchActiveLiveStream() {
    if (!this.isInitialized) {
      throw new Error('YouTube scraper is not initialized');
    }

    try {
      await this.browserService.goto(this.liveStreamUrl, {
        waitUntil: 'networkidle',
        timeout: this.timeoutMs,
      });

      const liveStream = await this.browserService.evaluate(() => {
        // eslint-disable-next-line no-undef
        const liveElement = document.querySelector('ytd-channel-featured-content-renderer a#video-title-link');
        if (!liveElement) {
          return null;
        }

        const url = liveElement.href;
        const videoIdMatch = url.match(/[?&]v=([^&]+)/);
        if (!videoIdMatch) {
          return null;
        }

        return {
          id: videoIdMatch[1],
          title: liveElement.getAttribute('title') || 'Live Stream',
          url,
          type: 'livestream',
          scrapedAt: new Date().toISOString(),
        };
      });

      if (liveStream) {
        this.logger.debug('Successfully scraped active live stream', {
          videoId: liveStream.id,
          title: liveStream.title,
        });
      }

      return liveStream;
    } catch (error) {
      this.logger.error('Failed to scrape for active live stream', {
        error: error.message,
        liveStreamUrl: this.liveStreamUrl,
      });
      return null;
    }
  }

  /**
   * Check for new videos since last check
   * @returns {Promise<Object|null>} New video object or null if none found
   */
  async scanForContent() {
    if (!this.isInitialized) {
      throw new Error('YouTube scraper is not initialized');
    }

    // Fetch both potential new content types concurrently
    const [activeLiveStream, latestVideo] = await Promise.all([this.fetchActiveLiveStream(), this.fetchLatestVideo()]);

    if (activeLiveStream) {
      this.metrics.livestreamsDetected++;
      await this.contentCoordinator.processContent(activeLiveStream.id, 'scraper', activeLiveStream);
    }

    if (latestVideo && latestVideo.success) {
      this.metrics.videosDetected++;
      await this.contentCoordinator.processContent(latestVideo.id, 'scraper', latestVideo);
    }
  }

  /**
   * Start continuous monitoring for new videos
   * @param {Function} onNewVideo - Callback function for new videos
   * @returns {Promise<void>}
   */
  async startMonitoring() {
    if (!this.isInitialized) {
      throw new Error('YouTube scraper is not initialized');
    }

    if (this.isRunning) {
      this.logger.warn('YouTube scraper monitoring is already running');
      return;
    }

    this.isRunning = true;

    const monitoringLoop = async () => {
      if (!this.isRunning) {
        return;
      }

      try {
        await this.scanForContent();
      } catch (error) {
        this.logger.error('Error in YouTube scraper monitoring loop', {
          error: error.message,
          stack: error.stack,
        });
      }

      // Schedule next check
      if (this.isRunning) {
        const nextInterval = this._getNextInterval();
        this.logger.debug(`Next YouTube scrape scheduled in ${nextInterval}ms`);
        this.scrapingInterval = setTimeout(monitoringLoop, nextInterval);
      }
    };

    // Start monitoring
    const firstInterval = this._getNextInterval();
    this.logger.info('Starting YouTube scraper monitoring', {
      nextCheckInMs: firstInterval,
    });
    this.scrapingInterval = setTimeout(monitoringLoop, firstInterval);
  }

  /**
   * Stop continuous monitoring
   * @returns {Promise<void>}
   */
  async stopMonitoring() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.scrapingInterval) {
      clearTimeout(this.scrapingInterval);
      this.scrapingInterval = null;
    }

    this.logger.info('YouTube scraper monitoring stopped');
  }

  /**
   * Get scraper metrics and health status
   * @returns {Object} Scraper metrics
   */
  getMetrics() {
    const successRate =
      this.metrics.totalScrapingAttempts > 0
        ? (this.metrics.successfulScrapes / this.metrics.totalScrapingAttempts) * 100
        : 0;

    return {
      ...this.metrics,
      successRate: Math.round(successRate * 100) / 100,
      isInitialized: this.isInitialized,
      isRunning: this.isRunning,
      isAuthenticated: this.isAuthenticated,
      authEnabled: this.authEnabled,
      lastKnownContentId: null, // No longer tracked here
      videosUrl: this.videosUrl,
      liveStreamUrl: this.liveStreamUrl,
      configuration: {
        minInterval: this.minInterval,
        maxInterval: this.maxInterval,
        maxRetries: this.maxRetries,
        timeoutMs: this.timeoutMs,
        authEnabled: this.authEnabled,
      },
    };
  }

  /**
   * Update the known video ID (useful for initial sync)
   * @param {string} videoId - Video ID to set as last known
   */
  // This method is now obsolete as state is managed by ContentStateManager
  // updateLastKnownContentId(contentId) { ... }

  /**
   * Force a health check of the scraper
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    const health = {
      status: 'unknown',
      timestamp: new Date().toISOString(),
      details: {},
    };

    try {
      if (!this.isInitialized) {
        health.status = 'not_initialized';
        health.details.error = 'Scraper is not initialized';
        return health;
      }

      if (!this.browserService.isRunning()) {
        health.status = 'browser_not_running';
        health.details.error = 'Browser service is not running';
        return health;
      }

      // Try to fetch latest video as health check
      const testVideo = await this.fetchLatestVideo();

      if (testVideo) {
        health.status = 'healthy';
        health.details.lastContentId = testVideo.id;
        health.details.lastContentTitle = testVideo.title;
      } else {
        health.status = 'no_videos_found';
        health.details.warning = 'No videos found during health check';
        if (this.authEnabled && !this.isAuthenticated) {
          health.details.possibleCause = 'Authentication enabled but not authenticated';
        }
      }
    } catch (error) {
      health.status = 'error';
      health.details.error = error.message;
      health.details.stack = error.stack;
      this.logger.error('YouTube scraper health check failed:', {
        error: error.message,
        stack: error.stack,
        authEnabled: this.authEnabled,
        isAuthenticated: this.isAuthenticated,
      });
    }

    health.details.metrics = this.getMetrics();

    return health;
  }

  /**
   * Clean up resources and close browser
   * @returns {Promise<void>}
   */
  async cleanup() {
    this.logger.info('Cleaning up YouTube scraper service');

    await this.stopMonitoring();

    if (this.browserService) {
      await this.browserService.close();
    }

    this.isInitialized = false;
    this.videosUrl = null;
    this.liveStreamUrl = null;
  }

  /**
   * Get the next polling interval with jitter
   * @returns {number} Interval in milliseconds
   * @private
   */
  _getNextInterval() {
    const jitter = Math.random() * 0.2 - 0.1; // +/- 10% jitter
    const baseInterval = this.minInterval + Math.random() * (this.maxInterval - this.minInterval);
    return Math.floor(baseInterval * (1 + jitter));
  }
}
