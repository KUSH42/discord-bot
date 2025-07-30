import { AsyncMutex } from '../../utilities/async-mutex.js';
import { parseRelativeTime } from '../../utilities/time-parser.js';
import { nowUTC } from '../../utilities/utc-time.js';
import { getYouTubeScrapingBrowserConfig } from '../../utilities/browser-config.js';
import { createEnhancedLogger } from '../../utilities/enhanced-logger.js';

/**
 * YouTube web scraper service for near-instantaneous content detection
 * Provides an alternative to API polling for faster notifications
 */
export class YouTubeScraperService {
  constructor({ logger, config, contentCoordinator, debugManager, metricsManager, browserService }) {
    // Create enhanced logger for YouTube module
    this.logger = createEnhancedLogger('youtube', logger, debugManager, metricsManager);
    this.config = config;
    this.contentCoordinator = contentCoordinator;
    this.browserService = browserService;
    this.browserMutex = new AsyncMutex(); // Prevent concurrent browser operations
    this.isShuttingDown = false; // Flag to coordinate graceful shutdown
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

    // Start tracked operation for initialization
    const operation = this.logger.startOperation('initialize', {
      channelHandle,
      authEnabled: this.authEnabled,
    });

    // Store channel handle for browser evaluation functions
    this.channelHandle = channelHandle;

    // Construct channel URLs
    const baseUrl = `https://www.youtube.com/@${channelHandle}`;
    this.videosUrl = `${baseUrl}/videos`;
    this.liveStreamUrl = `${baseUrl}/live`;

    try {
      operation.progress('Launching browser with optimized settings');

      // Launch browser with optimized settings for scraping
      const browserOptions = getYouTubeScrapingBrowserConfig({
        headless: false,
      });

      await this.browserService.launch(browserOptions);

      operation.progress('Configuring browser user agent and viewport');

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
        operation.progress('Performing YouTube authentication');
        await this.authenticateWithYouTube();
      }

      operation.progress('Fetching initial content to establish baseline');

      // Find and set the initial latest video
      const latestVideo = await this.fetchLatestVideo();
      if (latestVideo && latestVideo.success && latestVideo.id) {
        await this.contentCoordinator.processContent(latestVideo.id, 'scraper', latestVideo);

        return operation.success('YouTube scraper initialized successfully', {
          videosUrl: this.videosUrl,
          initialContentId: latestVideo.id,
          title: latestVideo.title,
          isAuthenticated: this.isAuthenticated,
        });
      } else {
        return operation.success('YouTube scraper initialized but no videos found', {
          videosUrl: this.videosUrl,
          isAuthenticated: this.isAuthenticated,
        });
      }
    } catch (error) {
      this.isInitialized = false;
      operation.error(error, 'Failed to initialize YouTube scraper', {
        videosUrl: this.videosUrl,
        authEnabled: this.authEnabled,
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
        this.logger.warn('⚠️ YouTube authentication may have failed - proceeding without authentication');
      }
    } catch (error) {
      this.logger.error('⚠️Failed to authenticate with YouTube:', {
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

      this.logger.info('No cookie consent banner found');
    } catch (error) {
      this.logger.warn('Error handling cookie consent:', error.message);
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

    // Use mutex to prevent concurrent browser operations
    return await this.browserMutex.runExclusive(async () => {
      // Check if shutting down before starting operation
      if (this.isShuttingDown) {
        this.logger.debug('Skipping fetchLatestVideo due to shutdown');
        return null;
      }

      // Start tracked operation for video fetching
      const operation = this.logger.startOperation('fetchLatestVideo', {
        videosUrl: this.videosUrl,
        isAuthenticated: this.isAuthenticated,
      });

      this.metrics.totalScrapingAttempts++;

      try {
        operation.progress('Navigating to channel videos page');
        // Navigate to channel videos page
        await this.browserService.goto(this.videosUrl, {
          waitUntil: 'networkidle',
          timeout: this.timeoutMs,
        });

        operation.progress('Handling consent page redirects');

        // Handle consent page if redirected
        await this.handleConsentPageRedirect();

        // Wait for the page to load and videos to appear
        await this.browserService.waitFor(2000);

        operation.progress('Extracting video information from page');

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
          this.logger.debug('Failed to get YouTube page debug info:', error.message);
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
              platform: 'youtube',
              scrapedAt: new Date().toISOString(),
            };
          });
        } catch (error) {
          this.logger.error('Failed to extract video information:', error.message);
          latestVideo = { success: false, error: `Video extraction failed: ${error.message}` };
        }

        if (latestVideo && latestVideo.success) {
          // Parse publishedText to create publishedAt Date object (outside browser context)
          const publishedAt = parseRelativeTime(latestVideo.publishedText);
          latestVideo.publishedAt = publishedAt ? publishedAt.toISOString() : new Date().toISOString();

          this.metrics.successfulScrapes++;
          this.metrics.lastSuccessfulScrape = new Date();

          // Create a plain object for logging to avoid complex object serialization issues
          const logData = {
            success: latestVideo.success,
            strategy: latestVideo.strategy,
            id: latestVideo.id,
            title: latestVideo.title,
            url: latestVideo.url,
            publishedText: latestVideo.publishedText,
            publishedAt: latestVideo.publishedAt,
            viewsText: latestVideo.viewsText,
            thumbnailUrl: latestVideo.thumbnailUrl,
            type: latestVideo.type,
            scrapedAt: latestVideo.scrapedAt,
          };

          operation.success(`Successfully scraped latest video: ${JSON.stringify(logData)}`);
        } else {
          const failureInfo = {
            videosUrl: this.videosUrl,
            debugInfo,
          };

          if (latestVideo && !latestVideo.success) {
            failureInfo.attemptedStrategies = latestVideo.strategies;
          }

          operation.error(new Error('No videos found during scraping'), 'No videos found during scraping', failureInfo);
        }

        return latestVideo;
      } catch (error) {
        this.metrics.failedScrapes++;
        this.metrics.lastError = {
          message: error.message,
          timestamp: nowUTC(),
        };

        operation.error(error, 'Failed to scrape YouTube channel', {
          videosUrl: this.videosUrl,
          attempt: this.metrics.totalScrapingAttempts,
        });

        return null;
      }
    }); // End of browserMutex.runExclusive
  }

  /**
   * Fetch the active live stream from the channel's live tab
   * @returns {Promise<Object|null>} Active live stream details or null if none found
   */
  async fetchActiveLiveStream() {
    if (!this.isInitialized) {
      throw new Error('YouTube scraper is not initialized');
    }

    // Use mutex to prevent concurrent browser operations
    return await this.browserMutex.runExclusive(async () => {
      // Check if shutting down before starting operation
      if (this.isShuttingDown) {
        this.logger.debug('Skipping fetchActiveLiveStream due to shutdown');
        return null;
      }

      // Start tracked operation for live stream fetching
      const operation = this.logger.startOperation('fetchActiveLiveStream', {
        liveStreamUrl: this.liveStreamUrl,
        isAuthenticated: this.isAuthenticated,
      });

      try {
        operation.progress('Navigating to channel live stream page');
        await this.browserService.goto(this.liveStreamUrl, {
          waitUntil: 'networkidle',
          timeout: this.timeoutMs,
        });

        operation.progress('Extracting live stream information');

        const liveStream = await this.browserService.evaluate(monitoredUser => {
          /* eslint-disable no-undef */

          /**
           * Check if a video element has indicators that it's currently live RIGHT NOW
           * @param {Element} element - Video element or its container
           * @returns {boolean} True if element shows ACTIVE live indicators
           */
          function hasLiveIndicators(element) {
            if (!element) {
              return false;
            }

            const container = element.closest(
              'ytd-rich-grid-media, ytd-rich-item-renderer, ytd-video-renderer, div, article, section'
            );
            if (!container) {
              return false;
            }

            // CRITICAL: First check for definitive LIVE badges (most reliable)
            const liveBadgeSelectors = [
              '.ytp-live-badge', // YouTube player live badge
              '.badge-style-type-live-now', // YouTube live badge
              '.ytd-badge-supported-renderer[aria-label*="live"]', // Accessibility live badge
              '.live-badge', // Generic live badge
              '[aria-label="LIVE"]', // Exact LIVE aria label
              'yt-formatted-string:has-text("LIVE")', // LIVE text in formatted string
            ];

            for (const selector of liveBadgeSelectors) {
              const badge = container.querySelector(selector);
              if (badge) {
                // Double-check the badge actually says "LIVE" and is visible
                const badgeText = badge.textContent?.trim().toUpperCase();
                const isVisible = badge.offsetWidth > 0 && badge.offsetHeight > 0;
                if (badgeText === 'LIVE' && isVisible) {
                  return true;
                }
              }
            }

            // SECONDARY: Look for red "LIVE" text indicators (stricter validation)
            const allElements = container.querySelectorAll('*');
            for (const el of allElements) {
              const text = el.textContent?.trim().toUpperCase();

              // Must be exactly "LIVE", visible, and styled as live indicator
              if (text === 'LIVE' && el.offsetWidth > 0 && el.offsetHeight > 0) {
                const style = window.getComputedStyle(el);

                // Check for red color or live-specific styling
                const isRedLive =
                  style.color.includes('rgb(255, 0, 0)') ||
                  style.color.includes('#ff0000') ||
                  style.backgroundColor.includes('rgb(255, 0, 0)') ||
                  style.backgroundColor.includes('#ff0000');

                const hasLiveClass = el.classList.toString().toLowerCase().includes('live');

                if (isRedLive || hasLiveClass) {
                  return true;
                }
              }
            }

            // TERTIARY: Check for "Now playing" text (only if combined with other indicators)
            const containerText = container.textContent?.toLowerCase() || '';
            if (containerText.includes('now playing')) {
              // Only trust "now playing" if we also find viewer count or chat indicators
              const hasViewerCount =
                containerText.includes('watching') ||
                containerText.includes('viewers') ||
                container.querySelector('[aria-label*="viewers"]');

              const hasChatIndicator =
                container.querySelector('[aria-label*="chat"]') || containerText.includes('live chat');

              if (hasViewerCount || hasChatIndicator) {
                return true;
              }
            }

            // QUATERNARY: Check URL for live indicators (very specific)
            const videoLink = container.querySelector('a[href*="/watch?v="]');
            if (videoLink) {
              const url = videoLink.href;
              // YouTube adds ?live=1 or similar for live streams
              if (url.includes('live=1') || url.includes('&live=') || url.includes('?live=')) {
                return true;
              }
            }

            return false;
          }

          let liveElement = null;
          let detectionMethod = null;
          const debugInfo = { strategiesAttempted: [], elementsFound: 0, indicatorCounts: {} };

          // CRITICAL: Verify we're on the correct channel's page to prevent cross-channel detection
          const currentUrl = window.location.href;
          const expectedChannelPattern = `@${monitoredUser}/live`;
          const isOnCorrectChannelPage = currentUrl.includes(expectedChannelPattern);

          debugInfo.currentUrl = currentUrl;
          debugInfo.expectedChannelPattern = expectedChannelPattern;
          debugInfo.isOnCorrectChannelPage = isOnCorrectChannelPage;

          if (!isOnCorrectChannelPage) {
            debugInfo.strategiesAttempted.push('page-validation-failed');
            // Return null if we're not on the correct channel's live page
            return {
              debugInfo,
              error: 'Not on monitored channel page',
              currentUrl,
              expectedPattern: expectedChannelPattern,
            };
          }

          // Strategy 1: Look for the primary live stream on channel's /live page
          // This should be the most reliable since we're on the dedicated live page
          const candidateSelectors = [
            'ytd-channel-featured-content-renderer a[href*="/watch?v="]', // Featured live content
            'ytd-rich-grid-media:first-child a[href*="/watch?v="]', // First video in grid
            'ytd-rich-item-renderer:first-child a[href*="/watch?v="]', // First rich item
            'a#video-title-link[href*="/watch?v="]', // Video title links
          ];

          debugInfo.strategiesAttempted.push('primary-live-page-detection');

          for (const selector of candidateSelectors) {
            try {
              const candidates = document.querySelectorAll(selector);
              debugInfo.elementsFound += candidates.length;

              // Only check the first few candidates to avoid false positives
              const candidatesToCheck = Array.from(candidates).slice(0, 3);

              for (let i = 0; i < candidatesToCheck.length; i++) {
                const candidate = candidatesToCheck[i];
                if (hasLiveIndicators(candidate)) {
                  liveElement = candidate;
                  detectionMethod = `primary-detection-${selector.split(' ')[0]}-index-${i}`;
                  break;
                }
              }
              if (liveElement) {
                break;
              }
            } catch (error) {
              debugInfo.strategiesAttempted.push(`error-${selector}: ${error.message}`);
            }
          }

          // Strategy 2: Look for explicit "Now playing" indicators (stricter validation)
          if (!liveElement) {
            debugInfo.strategiesAttempted.push('now-playing-detection');

            const nowPlayingElements = Array.from(document.querySelectorAll('*')).filter(
              el => el.textContent && el.textContent.trim().toLowerCase() === 'now playing'
            );

            debugInfo.indicatorCounts.nowPlaying = nowPlayingElements.length;

            if (nowPlayingElements.length > 0) {
              for (let i = 0; i < nowPlayingElements.length; i++) {
                const nowPlaying = nowPlayingElements[i];
                const container = nowPlaying.closest('div, article, section');
                if (container) {
                  const videoLink = container.querySelector('a[href*="/watch?v="]');
                  if (videoLink && hasLiveIndicators(videoLink)) {
                    liveElement = videoLink;
                    detectionMethod = `now-playing-validated-${i}`;
                    break;
                  }
                }
              }
            }
          }

          // Strategy 3: YouTube player indicators (DISABLED - causes cross-channel detection)
          // CRITICAL BUG FIX: This strategy was detecting live streams from OTHER channels
          // when YouTube redirects or suggests different content on the monitored channel's /live page
          // Disabled strategy - cross-channel detection bug
          // if (!liveElement) {
          //   debugInfo.strategiesAttempted.push('player-badge-detection-DISABLED-CROSS-CHANNEL-BUG');
          //   // This strategy has been permanently disabled due to detecting wrong channel's streams
          // }

          // Add debug information to help troubleshoot false positives
          if (liveElement) {
            debugInfo.selectedElement = {
              href: liveElement.href,
              textContent: liveElement.textContent?.trim(),
              title: liveElement.getAttribute('title'),
            };
          }

          if (!liveElement) {
            return { debugInfo, error: 'No live element found' };
          }

          const url = liveElement.href;
          const videoIdMatch = url.match(/[?&]v=([^&]+)/);
          if (!videoIdMatch) {
            return { debugInfo, error: 'Could not extract video ID', url };
          }

          // ADDITIONAL VALIDATION: Ensure the detected stream belongs to the monitored channel
          // Check if we can find channel ownership information
          const channelOwnershipVerified = true; // For now, trust that being on the /live page is sufficient
          debugInfo.channelOwnershipVerified = channelOwnershipVerified;

          // Get title from various possible sources
          let title = 'Live Stream';
          if (liveElement.getAttribute('title')) {
            title = liveElement.getAttribute('title');
          } else if (liveElement.textContent && liveElement.textContent.trim()) {
            title = liveElement.textContent.trim();
          } else {
            // Look for title in nearby heading elements
            const container = liveElement.closest('div, article, section');
            if (container) {
              const heading = container.querySelector('h1, h2, h3, h4, [role="heading"]');
              if (heading && heading.textContent) {
                title = heading.textContent.trim();
              }
            }
          }

          // CRITICAL: Extract metadata using YouTube's structured data (primary) with text parsing as fallback
          let publishedText = 'Unknown';
          let actualPublishedAt = null;
          let isCurrentlyLive = false;
          let extractionMethod = 'none';

          // PRIMARY: Look for structured metadata (JSON-LD, microdata, time elements)
          const timeElement = document.querySelector('time[datetime]');
          if (timeElement && timeElement.getAttribute('datetime')) {
            actualPublishedAt = timeElement.getAttribute('datetime');
            extractionMethod = 'time-datetime-attribute';

            // Check if this is a live stream by looking at the time context
            const timeParent = timeElement.closest('*');
            if (timeParent) {
              const contextText = timeParent.textContent?.toLowerCase() || '';
              isCurrentlyLive = contextText.includes('live') || contextText.includes('streaming');
            }
          }

          // SECONDARY: Look for JSON-LD structured data
          if (!actualPublishedAt) {
            const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of jsonLdScripts) {
              try {
                const data = JSON.parse(script.textContent);
                if (data['@type'] === 'VideoObject' || data.uploadDate || data.datePublished) {
                  actualPublishedAt = data.uploadDate || data.datePublished;
                  extractionMethod = 'json-ld-structured-data';

                  // Check for live broadcast content
                  if (data.publication && data.publication.isLiveBroadcast) {
                    isCurrentlyLive = data.publication.isLiveBroadcast;
                  }
                  break;
                }
              } catch (_e) {
                // Continue to next script
              }
            }
          }

          // TERTIARY: Look for meta tags
          if (!actualPublishedAt) {
            const metaTags = [
              'meta[property="video:release_date"]',
              'meta[property="article:published_time"]',
              'meta[name="datePublished"]',
              'meta[itemprop="datePublished"]',
              'meta[itemprop="uploadDate"]',
            ];

            for (const selector of metaTags) {
              const metaTag = document.querySelector(selector);
              if (metaTag && metaTag.getAttribute('content')) {
                actualPublishedAt = metaTag.getAttribute('content');
                extractionMethod = `meta-tag-${selector.split('"')[1]}`;
                break;
              }
            }
          }

          // FALLBACK: Text parsing (only if structured data fails)
          if (!actualPublishedAt) {
            const videoContainer = liveElement.closest(
              'ytd-rich-grid-media, ytd-rich-item-renderer, ytd-video-renderer, div, article, section'
            );

            if (videoContainer) {
              const metadataElements = videoContainer.querySelectorAll(
                '#metadata-line span, #published-time-text, .ytd-video-meta-block span, [aria-label]'
              );

              for (const element of metadataElements) {
                const text = element.textContent?.trim();
                if (text) {
                  // Check for "live now" or current streaming indicators
                  if (
                    text.toLowerCase().includes('live now') ||
                    text.toLowerCase().includes('streaming now') ||
                    text.toLowerCase().includes('watching now')
                  ) {
                    isCurrentlyLive = true;
                    publishedText = 'Live now';
                    extractionMethod = 'text-parsing-live-indicator';
                    break;
                  }
                  // Check for relative time indicators (finished livestreams)
                  else if (
                    text.includes('ago') ||
                    text.includes('hour') ||
                    text.includes('day') ||
                    text.includes('week') ||
                    text.includes('month')
                  ) {
                    publishedText = text;
                    isCurrentlyLive = false;
                    extractionMethod = 'text-parsing-relative-time';
                    break;
                  }
                }
              }

              // Additional check: look for viewer count which indicates live status
              if (!isCurrentlyLive && extractionMethod === 'none') {
                const viewerElements = videoContainer.querySelectorAll('*');
                for (const element of viewerElements) {
                  const text = element.textContent?.trim().toLowerCase();
                  if (text && (text.includes('watching') || text.includes('viewers')) && !text.includes('ago')) {
                    isCurrentlyLive = true;
                    publishedText = 'Live now';
                    extractionMethod = 'text-parsing-viewer-count';
                    break;
                  }
                }
              }
            }
          }

          debugInfo.timestampExtraction = {
            actualPublishedAt,
            publishedText,
            isCurrentlyLive,
            extractionMethod,
            structuredDataAvailable: !!actualPublishedAt,
          };

          // CRITICAL: Don't announce old/finished livestreams
          // If we have structured timestamp data, validate it's recent for live content
          if (actualPublishedAt) {
            const publishedDate = new Date(actualPublishedAt);
            const hoursAgo = (Date.now() - publishedDate.getTime()) / (1000 * 60 * 60);

            // If published more than 1 hour ago and not currently live, it's stale
            if (hoursAgo > 1 && !isCurrentlyLive) {
              return {
                debugInfo,
                error: 'Detected stale livestream based on structured data',
                actualPublishedAt,
                hoursAgo: Math.round(hoursAgo * 10) / 10,
                isCurrentlyLive,
                detectedTitle: title,
                detectedId: videoIdMatch[1],
              };
            }
          } else if (!isCurrentlyLive && publishedText !== 'Unknown' && publishedText !== 'Live now') {
            // Fallback to text-based detection
            return {
              debugInfo,
              error: 'Detected finished livestream, not currently live',
              publishedText,
              isCurrentlyLive,
              detectedTitle: title,
              detectedId: videoIdMatch[1],
            };
          }

          return {
            id: videoIdMatch[1],
            title,
            url: liveElement.href,
            type: isCurrentlyLive ? 'livestream' : 'video', // Use 'video' for ended livestreams
            platform: 'youtube',
            actualPublishedAt, // Structured timestamp data (preferred)
            publishedText, // Fallback text-based timestamp
            isCurrentlyLive, // Include live status
            wasLivestream: true, // Indicate this was originally a livestream
            publishedAt: actualPublishedAt || new Date().toISOString(), // Use structured data when available
            scrapedAt: new Date().toISOString(),
            detectionMethod, // Include detection method for debugging
            debugInfo, // Include debug information for troubleshooting false positives
          };
          /* eslint-enable no-undef */
        }, this.channelHandle);

        if (liveStream && liveStream.id) {
          // Use structured data when available, fallback to parsed text
          if (liveStream.actualPublishedAt) {
            // Structured data is already in ISO format, use it directly
            liveStream.publishedAt = liveStream.actualPublishedAt;
          } else if (liveStream.publishedText) {
            // Fallback: Parse relative text for timestamp
            const publishedAt = parseRelativeTime(liveStream.publishedText);
            liveStream.publishedAt = publishedAt ? publishedAt.toISOString() : new Date().toISOString();
          }

          // Valid live stream found
          const logData = {
            id: liveStream.id,
            title: liveStream.title,
            url: liveStream.url,
            type: liveStream.type,
            platform: liveStream.platform,
            actualPublishedAt: liveStream.actualPublishedAt,
            publishedText: liveStream.publishedText,
            isCurrentlyLive: liveStream.isCurrentlyLive,
            publishedAt: liveStream.publishedAt,
            scrapedAt: liveStream.scrapedAt,
            detectionMethod: liveStream.detectionMethod,
            debugInfo: liveStream.debugInfo,
          };

          operation.success(
            `Successfully scraped active live stream using ${liveStream.detectionMethod}: ${JSON.stringify(logData)}`
          );
        } else if (liveStream && liveStream.error) {
          // Error case with debug information
          const errorInfo = {
            error: liveStream.error,
            debugInfo: liveStream.debugInfo,
            liveStreamUrl: this.liveStreamUrl,
          };
          operation.success(`Live stream detection failed: ${JSON.stringify(errorInfo)}`);
          // Cannot reassign const - set to null-like state
          Object.assign(liveStream, { isCurrentlyLive: false, error: 'Detection failed' });
        } else {
          // No stream found (normal case)
          const noStreamInfo = {
            liveStreamUrl: this.liveStreamUrl,
            note: 'This is normal when no live stream is currently active',
          };
          operation.success(`No active live stream found: ${JSON.stringify(noStreamInfo)}`);
        }

        return liveStream;
      } catch (error) {
        operation.error(error, 'Failed to scrape for active live stream', {
          liveStreamUrl: this.liveStreamUrl,
        });
        return null;
      }
    }); // End of browserMutex.runExclusive
  }

  /**
   * Check for new videos since last check
   * @returns {Promise<Object|null>} New video object or null if none found
   */
  async scanForContent() {
    if (!this.isInitialized) {
      throw new Error('YouTube scraper is not initialized');
    }

    // Start tracked operation for content scanning
    const operation = this.logger.startOperation('scanForContent', {
      videosUrl: this.videosUrl,
      liveStreamUrl: this.liveStreamUrl,
      isAuthenticated: this.isAuthenticated,
    });

    try {
      operation.progress('Fetching both livestream and video content concurrently');

      // Fetch both potential new content types concurrently
      const [activeLiveStream, latestVideo] = await Promise.all([
        this.fetchActiveLiveStream(),
        this.fetchLatestVideo(),
      ]);

      let contentProcessed = 0;
      const contentResults = [];

      if (activeLiveStream) {
        operation.progress(
          `Processing detected livestream: ${activeLiveStream.id} (${activeLiveStream.detectionMethod})`
        );
        this.metrics.livestreamsDetected++;

        try {
          const result = await this.contentCoordinator.processContent(activeLiveStream.id, 'scraper', activeLiveStream);
          contentResults.push({ type: 'livestream', id: activeLiveStream.id, result });
          contentProcessed++;
        } catch (error) {
          operation.error(error, `Failed to process livestream ${activeLiveStream.id}`, {
            livestreamId: activeLiveStream.id,
            detectionMethod: activeLiveStream.detectionMethod,
          });
        }
      }

      if (latestVideo && latestVideo.success) {
        operation.progress(`Processing detected video: ${latestVideo.id} (${latestVideo.strategy})`);
        this.metrics.videosDetected++;

        try {
          const result = await this.contentCoordinator.processContent(latestVideo.id, 'scraper', latestVideo);
          contentResults.push({ type: 'video', id: latestVideo.id, result });
          contentProcessed++;
        } catch (error) {
          operation.error(error, `Failed to process video ${latestVideo.id}`, {
            videoId: latestVideo.id,
            strategy: latestVideo.strategy,
          });
        }
      }

      const summary = {
        livestreamFound: !!activeLiveStream,
        videoFound: !!(latestVideo && latestVideo.success),
        contentProcessed,
        results: contentResults.map(r => ({ type: r.type, id: r.id, action: r.result?.action })),
      };

      if (contentProcessed > 0) {
        operation.success(`Content scan completed: processed ${contentProcessed} items - ${JSON.stringify(summary)}`);
      } else {
        operation.success(`Content scan completed: no new content found - ${JSON.stringify(summary)}`);
      }

      return summary;
    } catch (error) {
      operation.error(error, 'Content scanning failed', {
        videosUrl: this.videosUrl,
        liveStreamUrl: this.liveStreamUrl,
      });
      throw error;
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

        // Check if this is a browser connection error that requires recovery
        if (this._isBrowserConnectionError(error)) {
          this.logger.warn('Browser connection lost, attempting recovery...');
          try {
            await this._recoverBrowser();
            this.logger.info('Browser recovery successful');
          } catch (recoveryError) {
            this.logger.error('Browser recovery failed', {
              error: recoveryError.message,
              stack: recoveryError.stack,
            });
          }
        }
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

      if (testVideo && testVideo.success && testVideo.id) {
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

    // Set shutdown flag to prevent new operations
    this.isShuttingDown = true;

    await this.stopMonitoring();

    // Wait for any ongoing browser operations to complete
    if (this.browserMutex.locked) {
      this.logger.info('Waiting for ongoing browser operations to complete...');
      const maxWaitTime = 30000; // 30 seconds
      const startTime = Date.now();

      while (this.browserMutex.locked && Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (this.browserMutex.locked) {
        this.logger.warn('Timeout waiting for browser operations, proceeding with cleanup');
      }
    }

    if (this.browserService) {
      await this.browserService.close();
    }

    this.isInitialized = false;
    this.videosUrl = null;
    this.liveStreamUrl = null;
    this.isShuttingDown = false; // Reset flag after cleanup
  }

  /**
   * Dispose method for dependency container cleanup
   * @returns {Promise<void>}
   */
  async dispose() {
    await this.cleanup();
  }

  /**
   * Check if error is related to browser connection loss
   * @param {Error} error - Error to check
   * @returns {boolean} True if error indicates browser connection lost
   * @private
   */
  _isBrowserConnectionError(error) {
    const browserErrors = [
      'Browser connection lost',
      'Browser or page not available',
      'Page has been closed',
      'Target page, context or browser has been closed',
      'Browser is not running',
      'No page available',
    ];

    return browserErrors.some(errorMsg => error.message && error.message.includes(errorMsg));
  }

  /**
   * Attempt to recover from browser connection loss
   * @returns {Promise<void>}
   * @private
   */
  async _recoverBrowser() {
    try {
      // Close existing browser if it exists
      if (this.browserService) {
        try {
          await this.browserService.close();
        } catch (closeError) {
          this.logger.debug('Error closing browser during recovery', {
            error: closeError.message,
          });
        }
      }

      // Mark as not initialized to force re-initialization
      this.isInitialized = false;

      // Wait a moment before attempting recovery
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Re-initialize the browser
      await this.initialize();

      this.logger.info('Browser recovery completed successfully');
    } catch (error) {
      this.logger.error('Browser recovery failed', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
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
