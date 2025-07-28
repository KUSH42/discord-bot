import { DuplicateDetector } from '../duplicate-detector.js';
import { delay } from '../utils/delay.js';
import { nowUTC, toISOStringUTC, daysAgoUTC } from '../utilities/utc-time.js';
import { getXScrapingBrowserConfig } from '../utilities/browser-config.js';
import { createEnhancedLogger } from '../utilities/enhanced-logger.js';

/**
 * X (Twitter) scraping application orchestrator
 * Coordinates browser automation, content classification, and announcements
 */
export class ScraperApplication {
  constructor(dependencies) {
    this.browser = dependencies.browserService;
    this.classifier = dependencies.contentClassifier;
    this.announcer = dependencies.contentAnnouncer;
    this.config = dependencies.config;
    this.state = dependencies.stateManager;
    this.discord = dependencies.discordService;
    this.eventBus = dependencies.eventBus;
    this.authManager = dependencies.authManager;
    this.delay = dependencies.delay || delay;

    // Create enhanced logger for this module
    this.logger = createEnhancedLogger(
      'scraper',
      dependencies.logger,
      dependencies.debugManager,
      dependencies.metricsManager
    );

    // Scraper configuration
    this.xUser = this.config.getRequired('X_USER_HANDLE');
    this.twitterUsername = this.config.getRequired('TWITTER_USERNAME');
    this.twitterPassword = this.config.getRequired('TWITTER_PASSWORD');

    // Polling configuration
    this.minInterval = parseInt(this.config.get('X_QUERY_INTERVAL_MIN', '300000'), 10);
    this.maxInterval = parseInt(this.config.get('X_QUERY_INTERVAL_MAX', '600000'), 10);

    // State management - accept duplicateDetector dependency
    this.duplicateDetector =
      dependencies.duplicateDetector ||
      new DuplicateDetector(
        null, // Disable persistent storage - rely only on Discord history and in-memory caches
        dependencies.logger?.child({ service: 'DuplicateDetector' })
      );
    this.isRunning = false;
    this.timerId = null;
    this.currentSession = null;

    // Statistics
    this.stats = {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      totalTweetsFound: 0,
      totalTweetsAnnounced: 0,
      lastRunTime: null,
      lastError: null,
    };
    this.nextPollTimestamp = null;

    // Debug logging sampling configuration to prevent Discord spam
    this.debugSamplingRate = parseFloat(this.config.get('X_DEBUG_SAMPLING_RATE', '0.1')); // 10% default
    this.verboseLogSamplingRate = parseFloat(this.config.get('X_VERBOSE_LOG_SAMPLING_RATE', '0.05')); // 5% default
  }

  /**
   * Check if debug logging should be sampled to reduce Discord spam
   * @returns {boolean} True if debug logging should occur
   */
  shouldLogDebug() {
    return Math.random() < this.debugSamplingRate;
  }

  /**
   * Check if verbose logging should be sampled to reduce Discord spam
   * @returns {boolean} True if verbose logging should occur
   */
  shouldLogVerbose() {
    return Math.random() < this.verboseLogSamplingRate;
  }

  /**
   * Start X content monitoring
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Scraper application is already running');
    }

    const operation = this.logger.startOperation('startScraperApplication', {
      xUser: this.xUser,
      pollingInterval: { min: this.minInterval, max: this.maxInterval },
    });

    try {
      operation.progress('Initializing browser for X scraping');
      await this.initializeBrowser();

      operation.progress('Performing initial authentication');
      await this.ensureAuthenticated();

      operation.progress('Initializing with recent content to prevent old announcements');
      await this.initializeRecentContent();

      operation.progress('Starting polling and health monitoring');
      this.startPolling();
      this.startHealthMonitoring();

      this.isRunning = true;

      // Emit start event
      this.eventBus.emit('scraper.started', {
        startTime: nowUTC(),
        xUser: this.xUser,
        pollingInterval: this.getNextInterval(),
      });

      return operation.success('X scraper application started successfully', {
        xUser: this.xUser,
        pollingIntervalMs: this.getNextInterval(),
      });
    } catch (error) {
      operation.error(error, 'Failed to start scraper application');
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop X content monitoring
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    const operation = this.logger.startOperation('stopScraperApplication', {
      isRunning: this.isRunning,
      stats: this.getStats(),
    });

    try {
      operation.progress('Stopping health monitoring');
      this.stopHealthMonitoring();

      operation.progress('Stopping polling timer');
      this.stopPolling();

      operation.progress('Closing browser session');
      await this.closeBrowser();

      this.isRunning = false;

      // Emit stop event
      this.eventBus.emit('scraper.stopped', {
        stopTime: nowUTC(),
        stats: this.getStats(),
      });

      operation.success('X scraper application stopped successfully', {
        finalStats: this.getStats(),
      });
    } catch (error) {
      operation.error(error, 'Error stopping scraper application');
      throw error;
    }
  }

  /**
   * Restart the scraper application with retry logic
   * @param {Object} options - Restart options
   * @param {number} options.maxRetries - Maximum restart attempts (default: 3)
   * @param {number} options.baseDelay - Base delay between restart attempts (default: 5000ms)
   * @returns {Promise<void>}
   */
  async restart(options = {}) {
    const { maxRetries = 3, baseDelay = 5000 } = options;

    const operation = this.logger.startOperation('restartScraperApplication', {
      maxRetries,
      baseDelay,
      currentStats: this.getStats(),
    });

    try {
      operation.progress('Stopping current scraper instance');
      await this.stop();

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          operation.progress(`Starting restart attempt ${attempt}/${maxRetries}`);
          await this.start();
          operation.success('X scraper application restarted successfully', {
            attempt,
            totalAttempts: maxRetries,
          });
          return;
        } catch (error) {
          operation.progress(`Restart attempt ${attempt} failed: ${error.message}`);

          if (attempt === maxRetries) {
            operation.error(
              new Error(`Scraper restart failed after ${maxRetries} attempts: ${error.message}`),
              `Failed to restart scraper after ${maxRetries} attempts`,
              { finalAttempt: attempt, originalError: error.message }
            );
            throw new Error(`Scraper restart failed after ${maxRetries} attempts: ${error.message}`);
          }

          const delay = baseDelay * Math.pow(2, attempt - 1);
          operation.progress(`Waiting ${delay}ms before next restart attempt`);
          await this.delay(delay);
        }
      }
    } catch (error) {
      operation.error(error, 'Restart operation failed');
      throw error;
    }
  }

  /**
   * Start periodic health monitoring with automatic recovery
   * @param {number} intervalMs - Health check interval in milliseconds (default: 300000 = 5 minutes)
   */
  startHealthMonitoring(intervalMs = 300000) {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    const operation = this.logger.startOperation('startHealthMonitoring', {
      intervalMs,
      intervalSeconds: intervalMs / 1000,
    });

    this.healthCheckInterval = setInterval(async () => {
      const healthOperation = this.logger.startOperation('performHealthCheck', {
        timestamp: nowUTC(),
      });

      try {
        const health = await this.performHealthCheck();
        if (health.errors.length === 0) {
          healthOperation.success('Health check passed', health);
        } else {
          healthOperation.error(
            new Error(`Health check found issues: ${health.errors.join(', ')}`),
            'Health check detected problems',
            health
          );
          await this.handleHealthCheckFailure(new Error(health.errors.join(', ')));
        }
      } catch (error) {
        healthOperation.error(error, 'Health check failed');
        await this.handleHealthCheckFailure(error);
      }
    }, intervalMs);

    operation.success('Health monitoring started', {
      intervalMs,
      intervalSeconds: intervalMs / 1000,
    });
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;

      const operation = this.logger.startOperation('stopHealthMonitoring', {});
      operation.success('Health monitoring stopped');
    }
  }

  /**
   * Perform health check on the scraper
   * @returns {Promise<Object>} Health check results
   */
  async performHealthCheck() {
    const health = {
      timestamp: nowUTC(),
      isRunning: this.isRunning,
      authenticated: false,
      browserHealthy: false,
      errors: [],
    };

    try {
      // Check if application is running
      if (!this.isRunning) {
        health.errors.push('Application not running');
        return health;
      }

      // Check browser health
      if (this.browser && this.browser.isHealthy && this.browser.isHealthy()) {
        health.browserHealthy = true;
      } else {
        health.errors.push('Browser not available or closed');
      }

      // Check authentication status
      if (health.browserHealthy) {
        try {
          const authStatus = await this.authManager.isAuthenticated();
          health.authenticated = authStatus;
          if (!authStatus) {
            health.errors.push('Authentication verification failed');
          }
        } catch (error) {
          health.errors.push(`Authentication check failed: ${error.message}`);
        }
      }
    } catch (error) {
      health.errors.push(`Health check error: ${error.message}`);
    }

    return health;
  }

  /**
   * Handle health check failure with automatic recovery
   * @param {Error} error - The health check error
   */
  async handleHealthCheckFailure(error) {
    const operation = this.logger.startOperation('handleHealthCheckFailure', {
      originalError: error.message,
    });

    try {
      operation.progress('Attempting automatic recovery via restart');
      await this.restart({ maxRetries: 2, baseDelay: 3000 });

      operation.success('Automatic recovery successful', {
        recoveryMethod: 'restart',
        maxRetries: 2,
      });
    } catch (recoveryError) {
      // Emit event for external monitoring
      this.eventBus.emit('scraper.recovery.failed', {
        originalError: error.message,
        recoveryError: recoveryError.message,
        timestamp: nowUTC(),
      });

      operation.error(recoveryError, 'Automatic recovery failed', {
        originalError: error.message,
        recoveryMethod: 'restart',
      });
    }
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
   * Initialize browser for scraping
   * @returns {Promise<void>}
   */
  async initializeBrowser() {
    const operation = this.logger.startOperation('initializeBrowser', {
      headless: false,
    });

    try {
      const browserOptions = getXScrapingBrowserConfig({
        headless: false,
      });

      operation.progress('Launching browser with X scraping configuration');
      await this.browser.launch(browserOptions);

      const userAgent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

      operation.progress('Setting user agent for stealth browsing');
      await this.browser.setUserAgent(userAgent);

      operation.success('Browser initialized for X scraping', {
        userAgent: `${userAgent.substring(0, 50)}...`,
      });
    } catch (error) {
      operation.error(error, 'Failed to initialize browser');
      throw error;
    }
  }

  /**
   * Close browser
   * @returns {Promise<void>}
   */
  async closeBrowser() {
    const operation = this.logger.startOperation('closeBrowser', {
      isRunning: this.browser.isRunning(),
    });

    try {
      if (this.browser.isRunning()) {
        operation.progress('Closing browser instance');
        await this.browser.close();
        operation.success('Browser closed successfully');
      } else {
        operation.success('Browser was not running, no action needed');
      }
    } catch (error) {
      operation.error(error, 'Failed to close browser');
      throw error;
    }
  }

  /**
   * Login to X (Twitter)
   * @returns {Promise<void>}
   */
  async loginToX() {
    const operation = this.logger.startOperation('loginToX', {
      xUser: this.xUser,
    });

    try {
      operation.progress('Delegating to AuthManager for X login');
      const result = await this.authManager.login();
      operation.success('X login completed via AuthManager');
      return result;
    } catch (error) {
      operation.error(error, 'X login failed');
      throw error;
    }
  }

  /**
   * Clicks the "Next" button during login
   * @returns {Promise<boolean>}
   */
  async clickNextButton() {
    return this.authManager.clickNextButton();
  }

  /**
   * Clicks the "Log in" button
   * @returns {Promise<boolean>}
   */
  async clickLoginButton() {
    return this.authManager.clickLoginButton();
  }

  /**
   * Start polling for new content
   */
  startPolling() {
    if (this.timerId) {
      this.stopPolling();
    }

    const runPolling = async () => {
      try {
        await this.pollXProfile();
        this.scheduleNextPoll();
      } catch (error) {
        this.logger.error('Error in polling cycle:', error);
        this.stats.failedRuns++;
        this.stats.lastError = error.message;

        // Emit error event
        this.eventBus.emit('scraper.error', {
          error,
          timestamp: nowUTC(),
          stats: this.getStats(),
        });

        // Schedule retry with exponential backoff
        this.scheduleRetry();
      }
    };

    // Start first poll immediately
    runPolling();
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
      this.nextPollTimestamp = null;
    }
  }

  /**
   * Schedule next polling cycle
   */
  scheduleNextPoll() {
    const interval = this.getNextInterval();
    this.nextPollTimestamp = Date.now() + interval;
    this.timerId = setTimeout(async () => {
      if (!this.isRunning) {
        return;
      }
      try {
        await this.pollXProfile();
        this.scheduleNextPoll();
      } catch (error) {
        this.logger.error('Unhandled error in scheduled poll, rescheduling with retry:', error);
        this.scheduleRetry();
      }
    }, interval);

    this.logger.debug(`Next X poll scheduled in ${interval}ms`);
  }

  /**
   * Schedule retry after error
   */
  scheduleRetry() {
    const retryInterval = Math.min(this.maxInterval, this.minInterval * 2);
    this.nextPollTimestamp = Date.now() + retryInterval;
    this.timerId = setTimeout(async () => {
      if (!this.isRunning) {
        return;
      }
      try {
        await this.pollXProfile();
        this.scheduleNextPoll(); // Resume normal scheduling on success
      } catch (error) {
        this.logger.error('Unhandled error in scheduled retry, rescheduling:', error);
        this.scheduleRetry(); // Continue retry on failure
      }
    }, retryInterval);

    this.logger.info(`Retry scheduled in ${retryInterval}ms`);
  }

  /**
   * Get next polling interval with jitter
   * @returns {number} Interval in milliseconds
   */
  getNextInterval() {
    const jitter = Math.random() * 0.2 - 0.1; // ±10% jitter
    const baseInterval = this.minInterval + Math.random() * (this.maxInterval - this.minInterval);
    return Math.floor(baseInterval * (1 + jitter));
  }

  /**
   * Poll X profile for new content
   * @returns {Promise<void>}
   */
  async pollXProfile() {
    this.nextPollTimestamp = null;
    this.stats.totalRuns++;
    this.stats.lastRunTime = nowUTC();

    const operation = this.logger.startOperation('pollXProfile', {
      xUser: this.xUser,
      runNumber: this.stats.totalRuns,
    });

    try {
      const yesterday = daysAgoUTC(1);
      yesterday.toISOString().split('T')[0]; // Used for search URL generation

      operation.progress('Verifying authentication before polling');
      await this.verifyAuthentication();

      operation.progress('Navigating to X search page');
      const searchUrl = this.generateSearchUrl(true);
      await this.browser.goto(searchUrl);

      operation.progress('Waiting for content to load');
      const contentSelectors = [
        'article[data-testid="tweet"]',
        'article[role="article"]',
        'div[data-testid="cellInnerDiv"]',
        'main[role="main"]',
      ];

      let contentLoaded = false;
      for (const selector of contentSelectors) {
        try {
          await this.browser.waitForSelector(selector, { timeout: 5000 });
          contentLoaded = true;
          break;
        } catch {
          continue;
        }
      }

      if (!contentLoaded) {
        operation.progress('No content selectors found, proceeding anyway');
      }

      operation.progress('Scrolling to load additional content');
      for (let i = 0; i < 3; i++) {
        /* eslint-disable no-undef */
        await this.browser.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        /* eslint-enable no-undef */
        await this.delay(3000);
      }

      operation.progress('Extracting tweets from page');
      const tweets = await this.extractTweets();
      this.stats.totalTweetsFound += tweets.length;

      operation.progress('Filtering for new tweets only');
      const newTweets = await this.filterNewTweets(tweets);

      operation.progress(`Processing ${newTweets.length} new tweets`);
      if (newTweets.length > 0) {
        for (const tweet of newTweets) {
          try {
            await this.processNewTweet(tweet);
            this.stats.totalTweetsAnnounced++;
          } catch (error) {
            this.logger.error(`Error processing tweet ${tweet.tweetID}:`, error);
          }
        }
      }

      this.stats.successfulRuns++;

      // Emit poll completion event
      this.eventBus.emit('scraper.poll.completed', {
        timestamp: nowUTC(),
        tweetsFound: tweets.length,
        newTweets: newTweets.length,
        stats: this.getStats(),
      });

      operation.progress('Performing enhanced retweet detection');
      await this.performEnhancedRetweetDetection();

      const nextInterval = this.getNextInterval();
      const nextRunTime = new Date(Date.now() + nextInterval);
      const nextRunTimeFormatted = nextRunTime.toISOString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      operation.success('X profile polling completed successfully', {
        tweetsFound: tweets.length,
        newTweets: newTweets.length,
        nextRunInMs: nextInterval,
        nextRunTime: nextRunTimeFormatted,
      });

      if (nextInterval < 180000) {
        this.logger.info(
          `X scraper run finished. Next run in ~${Math.round(nextInterval / 1000)} seconds, at ${nextRunTimeFormatted}`
        );
      } else {
        this.logger.info(
          `X scraper run finished. Next run in ~${Math.round(nextInterval / 60000)} minutes, at ${nextRunTimeFormatted}`
        );
      }
    } catch (error) {
      operation.error(error, 'Error polling X profile', {
        xUser: this.xUser,
        runNumber: this.stats.totalRuns,
      });
      this.scheduleNextPoll();
      throw error;
    }
  }

  /**
   * Performs a separate check for retweets by navigating to the user's profile.
   * This is designed to catch retweets that might be missed by the standard search.
   * @returns {Promise<void>}
   */
  async performEnhancedRetweetDetection() {
    const operation = this.logger.startOperation('performEnhancedRetweetDetection', {
      xUser: this.xUser,
      retweetProcessingEnabled: this.shouldProcessRetweets(),
    });

    try {
      if (!this.shouldProcessRetweets()) {
        operation.success('Enhanced retweet detection skipped - retweet processing disabled');
        return;
      }

      operation.progress('Navigating to user profile timeline for retweet detection');
      await this.navigateToProfileTimeline(this.xUser);

      operation.progress('Extracting tweets from profile page');
      const tweets = await this.extractTweets();

      operation.progress(`Filtering ${tweets.length} potential retweets`);
      const newTweets = await this.filterNewTweets(tweets);

      operation.progress(`Processing ${newTweets.length} new tweets from enhanced detection`);
      let processedCount = 0;
      let skippedCount = 0;

      for (const tweet of newTweets) {
        // Reduce debug frequency for tweet checking
        if (this.shouldLogDebug()) {
          this.logger.debug(`Checking tweet ${tweet.tweetID}, category: ${tweet.tweetCategory}`);
        }
        if (await this.isNewContent(tweet)) {
          this.logger.info(`✅ Found new tweet to process: ${tweet.url} (${tweet.tweetCategory})`);
          await this.processNewTweet(tweet);
          this.stats.totalTweetsAnnounced++;
          processedCount++;
        } else {
          // Log filtered content with beginning of tweet text
          if (this.shouldLogVerbose()) {
            const contentPreview = tweet.text ? tweet.text.substring(0, 80) : 'No content';
            this.logger.debug(`Skipping old tweet ${tweet.tweetID} - "${contentPreview}..." (${tweet.tweetCategory})`);
          }
          skippedCount++;
        }
      }

      operation.success('Enhanced retweet detection completed', {
        totalTweetsFound: tweets.length,
        newTweetsFound: newTweets.length,
        tweetsProcessed: processedCount,
        tweetsSkipped: skippedCount,
      });
    } catch (error) {
      operation.error(error, 'Error during enhanced retweet detection', {
        note: 'This error is non-fatal and will not stop the main polling cycle',
      });
      // Do not rethrow, as a failure here should not stop the main polling cycle.
    }
  }

  /**
   * Extract tweets from current page
   * @returns {Promise<Array>} Array of tweet objects
   */
  async extractTweets() {
    const operation = this.logger.startOperation('extractTweets', {
      xUser: this.xUser,
      pageUrl: 'current_page',
    });

    const monitoredUser = this.xUser; // Pass the monitored user to browser context
    try {
      operation.progress('Executing tweet extraction script in browser context');
      const result = await this.browser.evaluate(monitoredUser => {
        /* eslint-disable no-undef */
        const tweets = [];

        // Try multiple selectors for tweet articles (X keeps changing these)
        const articleSelectors = [
          'article[data-testid="tweet"]',
          'article[role="article"]',
          'div[data-testid="cellInnerDiv"] article',
          'article',
          // Additional selectors for newer X.com layout
          '[data-testid="tweet"]',
          '[role="article"]',
          'div[data-testid="cellInnerDiv"]',
          'article[tabindex="-1"]',
          'div[aria-labelledby]',
        ];

        let articles = [];
        for (const selector of articleSelectors) {
          articles = document.querySelectorAll(selector);
          console.log(`Selector "${selector}" found ${articles.length} elements`);
          if (articles.length > 0) {
            console.log(`Using selector: ${selector} (found ${articles.length} articles)`);
            break;
          }
        }

        if (articles.length === 0) {
          console.log('No articles found with any selector');
          // Debug: Check what content is actually on the page
          const bodyText = document.body.innerText || '';
          console.log(`Page body text length: ${bodyText.length}`);
          console.log(`Page URL: ${window.location.href}`);

          // Check for common X.com indicators
          const indicators = ['Sign up', 'Log in', "What's happening", 'Home', 'Timeline'];

          for (const indicator of indicators) {
            if (bodyText.includes(indicator)) {
              console.log(`Found page indicator: "${indicator}"`);
            }
          }

          return tweets;
        }

        console.log(`Processing ${articles.length} articles for tweet extraction`);

        for (const article of articles) {
          try {
            // Extract tweet URL with multiple selectors
            const linkSelectors = [
              'a[href*="/status/"]',
              'time[datetime] + a',
              'a[role="link"][href*="/status/"]',
              // Additional selectors for newer layouts
              'time[datetime]',
              'time + a',
              'a[href*="status"]',
              '[data-testid="User-Name"] ~ * a[href*="/status/"]',
              'div a[href*="/status/"]',
            ];

            let tweetLink = null;
            let url = null;

            for (const selector of linkSelectors) {
              const element = article.querySelector(selector);
              if (element) {
                if (element.href && element.href.includes('/status/')) {
                  tweetLink = element;
                  url = element.href;
                  break;
                } else if (element.tagName === 'TIME' && element.parentElement && element.parentElement.href) {
                  // Handle time elements that are wrapped in links
                  tweetLink = element.parentElement;
                  url = element.parentElement.href;
                  break;
                }
              }
            }

            // Fallback: search for any link with /status/ in the article
            if (!tweetLink) {
              const allLinks = article.querySelectorAll('a[href*="/status/"]');
              if (allLinks.length > 0) {
                tweetLink = allLinks[0];
                url = tweetLink.href;
              }
            }

            if (!tweetLink || !url) {
              console.log('No tweet link found in article');
              continue;
            }

            const tweetIdMatch = url.match(/status\/(\d+)/);
            if (!tweetIdMatch) {
              continue;
            }

            const tweetID = tweetIdMatch[1];

            // Extract author username (not display name)
            let author = 'Unknown';

            // Method 1: Try to extract username from href attribute (most reliable)
            const userLinkSelectors = [
              '[data-testid="User-Name"] a[href^="/"]',
              '[data-testid="User-Names"] a[href^="/"]',
              'a[role="link"][href^="/"][href*="status"]',
              'a[href^="/"][href*="status"]',
            ];

            for (const selector of userLinkSelectors) {
              const linkElement = article.querySelector(selector);
              if (linkElement && linkElement.href) {
                const usernameMatch = linkElement.href.match(/\/([^/]+)\/status/);
                if (usernameMatch && usernameMatch[1]) {
                  author = usernameMatch[1];
                  break;
                }
              }
            }

            // Method 2: Try to extract from tweet URL as fallback
            if (author === 'Unknown' && url) {
              const urlUsernameMatch = url.match(/\/([^/]+)\/status/);
              if (urlUsernameMatch && urlUsernameMatch[1]) {
                author = urlUsernameMatch[1];
              }
            }

            // Method 3: Fallback to text content (display name) if username extraction fails
            if (author === 'Unknown') {
              const displayNameSelectors = [
                '[data-testid="User-Name"] a',
                '[data-testid="User-Names"] a',
                'a[role="link"][href^="/"]',
                'div[dir="ltr"] span',
              ];

              for (const selector of displayNameSelectors) {
                const authorElement = article.querySelector(selector);
                if (authorElement && authorElement.textContent.trim()) {
                  author = authorElement.textContent.trim();
                  break;
                }
              }
            }

            // Extract text content with multiple selectors
            const textSelectors = [
              '[data-testid="tweetText"]',
              '[lang] span',
              'div[dir="ltr"]',
              'span[dir="ltr"]',
              // Additional selectors for newer layouts
              '[data-testid="tweetText"] span',
              'div[lang] span',
              'div[lang]',
              'span[lang]',
              'div[data-testid="tweetText"]',
              // Fallback to any text in the article
              'div:not([data-testid="User-Name"]):not([data-testid="User-Names"]) span',
            ];

            let text = '';
            for (const selector of textSelectors) {
              const textElement = article.querySelector(selector);
              if (textElement && textElement.innerText && textElement.innerText.trim()) {
                text = textElement.innerText.trim();
                break;
              }
            }

            // If no text found with specific selectors, try to extract from article text
            if (!text) {
              const articleText = article.innerText || '';
              // Extract meaningful text (skip user names, timestamps, etc.)
              const lines = articleText.split('\n').filter(line => {
                const trimmed = line.trim();
                return (
                  trimmed &&
                  !trimmed.match(/^\d+[hms]$/) && // timestamps like "2h", "5m"
                  !trimmed.match(/^@\w+$/) && // usernames
                  !trimmed.startsWith('·') && // separator dots
                  trimmed.length > 3
                ); // meaningful text
              });
              if (lines.length > 0) {
                text = lines[0]; // Take first meaningful line
              }
            }

            // Extract timestamp
            const timeElement = article.querySelector('time');
            const timestamp = timeElement ? timeElement.getAttribute('datetime') : null;

            // Determine tweet category
            let tweetCategory = 'Post';

            // Check for reply indicators
            let isReply = text.startsWith('@');
            if (!isReply) {
              // Check for "Replying to" text content in the article
              const allText = article.innerText || '';
              isReply = allText.includes('Replying to') || allText.includes('Show this thread');
            }

            if (isReply) {
              tweetCategory = 'Reply';
            }

            // Check for quote tweet
            const quoteTweetBlock = article.querySelector('div[role="link"][tabindex="0"] a[href*="/status/"]');
            if (quoteTweetBlock && quoteTweetBlock.href !== url) {
              tweetCategory = 'Quote';
            }

            // Check for retweet - only when monitored user retweets someone else's content
            let isRetweet = false;

            // Method 1: Check for social context element with monitored user link (most reliable)
            const socialContext = article.querySelector('[data-testid="socialContext"]');
            if (socialContext) {
              // Look for a link to our monitored user within the social context
              const monitoredUserLink = socialContext.querySelector(`a[href="/${monitoredUser}"]`);
              if (monitoredUserLink && socialContext.innerText.includes('reposted')) {
                isRetweet = true;
              }
            }

            // Method 2: Check for classic RT @ pattern (when found on monitored user's timeline)
            if (!isRetweet && text.startsWith('RT @') && window.location.href.includes(`/${monitoredUser}`)) {
              isRetweet = true;
            }

            // Method 3: Fallback - if social context says "reposted" and we're on the monitored user's timeline
            if (
              !isRetweet &&
              socialContext &&
              socialContext.innerText.includes('reposted') &&
              window.location.href.includes(`/${monitoredUser}`)
            ) {
              isRetweet = true;
            }

            if (isRetweet) {
              tweetCategory = 'Retweet';
            }

            const tweetData = {
              tweetID,
              url,
              author,
              text,
              timestamp,
              tweetCategory,
            };

            // For retweets, add retweetedBy property to track who did the retweet
            if (isRetweet) {
              tweetData.retweetedBy = monitoredUser;
            }

            tweets.push(tweetData);
            console.log(`Successfully extracted tweet ${tweetID} from ${author} (${tweetCategory})`);
          } catch (_err) {
            console.error('Error extracting tweet:', _err);
          }
        }

        console.log(`Tweet extraction completed: found ${tweets.length} tweets`);
        return tweets;
        /* eslint-enable no-undef */
      }, monitoredUser);

      // Ensure we always return an array, even if browser.evaluate returns undefined
      const tweets = Array.isArray(result) ? result : [];

      const stats = {
        tweetsFound: tweets.length,
        categories: tweets.reduce((acc, tweet) => {
          acc[tweet.tweetCategory] = (acc[tweet.tweetCategory] || 0) + 1;
          return acc;
        }, {}),
      };

      operation.success(`Tweet extraction completed: ${JSON.stringify(stats)}`);

      return tweets;
    } catch (error) {
      operation.error(error, 'Error extracting tweets', {
        browserAvailable: !!this.browser,
        errorType: error.constructor.name,
      });
      // Return empty array on error to prevent undefined issues
      return [];
    }
  }

  /**
   * Filter tweets to only include new ones
   * @param {Array} tweets - All extracted tweets
   * @returns {Promise<Array>} New tweets only
   */
  async filterNewTweets(tweets) {
    const operation = this.logger.startOperation('filterNewTweets', {
      totalTweets: tweets.length,
    });

    const newTweets = [];
    let duplicateCount = 0;
    let oldContentCount = 0;

    try {
      operation.progress(`Processing ${tweets.length} tweets for filtering`);

      for (const tweet of tweets) {
        const contentPreview = tweet.text ? tweet.text.substring(0, 80) : 'No content';

        if (!(await this.duplicateDetector.isDuplicate(tweet.url))) {
          // Mark as seen immediately to prevent future duplicates
          this.duplicateDetector.markAsSeen(tweet.url);

          // Check if tweet is new enough based on bot start time
          if (await this.isNewContent(tweet)) {
            newTweets.push(tweet);
            this.logger.verbose(`Added new tweet: ${tweet.tweetID} - ${contentPreview}...`);
          } else {
            oldContentCount++;
            // Log filtered content with beginning of tweet text
            this.logger.verbose(
              `Filtered out old tweet: ${tweet.tweetID} - "${contentPreview}..." - timestamp: ${tweet.timestamp}`
            );
          }
        } else {
          duplicateCount++;
          // Log filtered duplicate content with beginning of tweet text
          this.logger.verbose(`Filtered out duplicate tweet: ${tweet.tweetID} - "${contentPreview}..."`);
        }
      }

      operation.success('Tweet filtering completed', {
        newTweets: newTweets.length,
        duplicates: duplicateCount,
        oldContent: oldContentCount,
        filterEfficiency: Math.round(((duplicateCount + oldContentCount) / tweets.length) * 100),
      });

      return newTweets;
    } catch (error) {
      operation.error(error, 'Error filtering tweets');
      return [];
    }
  }

  /**
   * Check if content is new enough to announce
   * Uses duplicate detection and reasonable time windows instead of strict bot startup time
   * @param {Object} tweet - Tweet object
   * @returns {Promise<boolean>} True if content is new
   */
  async isNewContent(tweet) {
    const announceOldTweets = this.config.getBoolean('ANNOUNCE_OLD_TWEETS', false);

    // If configured to announce old tweets, consider all tweets as new
    if (announceOldTweets) {
      this.logger.debug(`ANNOUNCE_OLD_TWEETS=true, considering tweet ${tweet.tweetID} as new`);
      return true;
    }

    // Check: Have we seen this tweet before? (Primary duplicate detection)
    if (tweet.url && (await this.duplicateDetector.isDuplicate(tweet.url))) {
      this.logger.debug(`🔍 Tweet ${tweet.tweetID} already known (duplicate detection), not new`, {
        tweetUrl: tweet.url,
        duplicateDetectionMethod: 'url_based',
        contentType: tweet.type || 'unknown',
      });
      return false;
    }

    // Check: Is the content too old based on MAX_CONTENT_AGE_HOURS?
    const maxAgeHours = this.config.get('MAX_CONTENT_AGE_HOURS', '24'); // Default 24 hours
    const maxAgeMs = parseInt(maxAgeHours) * 60 * 60 * 1000;
    const cutoffTime = new Date(Date.now() - maxAgeMs);

    if (tweet.timestamp) {
      const tweetTime = new Date(tweet.timestamp);
      const ageInMinutes = Math.floor((Date.now() - tweetTime.getTime()) / (1000 * 60));
      const ageInHours = Math.floor(ageInMinutes / 60);

      if (tweetTime < cutoffTime) {
        this.logger.debug(
          `⏰ Tweet ${tweet.tweetID} is too old - exceeds MAX_CONTENT_AGE_HOURS=${maxAgeHours}h, not new`,
          {
            tweetTime: tweetTime.toISOString(),
            cutoffTime: cutoffTime.toISOString(),
            ageInMinutes,
            ageInHours,
            maxAgeHours: parseInt(maxAgeHours),
            contentType: tweet.type || 'unknown',
            tweetUrl: tweet.url,
          }
        );
        return false;
      } else {
        this.logger.debug(`⏰ Tweet ${tweet.tweetID} age check passed: ${ageInHours}h old (limit: ${maxAgeHours}h)`, {
          ageInMinutes,
          ageInHours,
          maxAgeHours: parseInt(maxAgeHours),
          contentType: tweet.type || 'unknown',
        });
      }
    }

    // If no timestamp available, assume it's new (but will be caught by duplicate detection if seen again)
    if (!tweet.timestamp) {
      this.logger.debug(`⚠️ No timestamp for tweet ${tweet.tweetID}, considering as new`, {
        tweetUrl: tweet.url,
        contentType: tweet.type || 'unknown',
        fallbackReason: 'missing_timestamp',
      });
      return true;
    }

    this.logger.debug(`✅ Tweet ${tweet.tweetID} passed all checks, considering as new`, {
      tweetUrl: tweet.url,
      contentType: tweet.type || 'unknown',
      timestamp: tweet.timestamp,
      checksPerformed: ['duplicate_detection', 'age_filtering'],
    });
    return true;
  }

  /**
   * Check if enhanced retweet processing should be enabled
   * @returns {boolean} True if retweet processing is enabled
   */
  shouldProcessRetweets() {
    return this.config.getBoolean('ENABLE_RETWEET_PROCESSING', true);
  }

  /**
   * Process a new tweet
   * @param {Object} tweet - Tweet object
   * @returns {Promise<void>}
   */
  async processNewTweet(tweet) {
    const operation = this.logger.startOperation('processNewTweet', {
      tweetId: tweet.tweetID,
      author: tweet.author,
      category: tweet.tweetCategory,
      monitoredUser: this.xUser,
    });

    try {
      // Prepare metadata for classification
      const metadata = {
        timestamp: tweet.timestamp,
        author: tweet.author,
        monitoredUser: this.xUser,
      };

      // Add retweet metadata if available from enhanced detection
      if (tweet.retweetMetadata) {
        metadata.isRetweet = tweet.tweetCategory === 'Retweet';
        metadata.retweetDetection = tweet.retweetMetadata;
      }

      operation.progress('Classifying tweet content');
      // Check if this is a retweet (where our monitored user retweeted someone else's content)
      let classification;
      if (
        tweet.tweetCategory === 'Retweet' &&
        tweet.author !== this.xUser &&
        tweet.author !== `@${this.xUser}` &&
        tweet.author !== 'Unknown' &&
        tweet.retweetedBy &&
        (tweet.retweetedBy === this.xUser || tweet.retweetedBy === `@${this.xUser}`)
      ) {
        // True retweet: monitored user retweeted someone else's content
        // Only treat as retweet if we have confirmed that our monitored user did the retweet
        classification = {
          type: 'retweet',
          confidence: 0.99,
          platform: 'x',
          details: {
            statusId: tweet.tweetID,
            originalAuthor: tweet.author, // The original tweet author
            retweetedBy: this.xUser, // Our monitored user who did the retweet
            detectionMethod: 'social-context-based',
          },
        };
      } else {
        // Use classifier for other tweets (including same-author tweets incorrectly marked as retweet)
        classification = this.classifier.classifyXContent(tweet.url, tweet.text, metadata);
      }

      operation.progress('Creating content object for announcement');
      // Create content object for announcement
      const content = {
        platform: 'x',
        type: classification.type,
        id: tweet.tweetID,
        url: tweet.url,
        author: tweet.retweetedBy || tweet.author, // Use retweetedBy for retweets, otherwise original author
        originalAuthor: tweet.author, // Always store the original tweet author
        retweetedBy: tweet.retweetedBy, // Track who did the retweet (if applicable)
        text: tweet.text,
        timestamp: tweet.timestamp,
        isOld: !(await this.isNewContent(tweet)),
      };

      operation.progress('Announcing content to Discord');
      const result = await this.announcer.announceContent(content);

      operation.progress('Marking tweet as seen to prevent reprocessing');
      if (tweet.url) {
        this.duplicateDetector.markAsSeen(tweet.url);
      }

      // Emit tweet processed event
      this.eventBus.emit('scraper.tweet.processed', {
        tweet: content,
        classification,
        result,
        timestamp: nowUTC(),
      });

      if (result.success) {
        const authorInfo = tweet.retweetedBy ? `@${tweet.retweetedBy}` : `@${tweet.author}`;
        operation.success(`Announced ${classification.type} from ${authorInfo}`, {
          tweetId: tweet.tweetID,
          classificationType: classification.type,
          announcementResult: result,
        });
      } else if (result.skipped) {
        operation.success(`Skipped ${classification.type} - ${result.reason}`, {
          tweetId: tweet.tweetID,
          skipReason: result.reason,
        });
      } else {
        operation.error(
          new Error(result.reason || 'Unknown announcement failure'),
          `Failed to announce ${classification.type}`,
          {
            tweetId: tweet.tweetID,
            author: tweet.author,
            retweetedBy: tweet.retweetedBy,
            classificationType: classification.type,
          }
        );
      }
    } catch (error) {
      operation.error(error, `Error processing tweet ${tweet.tweetID}`, {
        tweetId: tweet.tweetID,
        author: tweet.author,
        category: tweet.tweetCategory,
      });
      throw error;
    }
  }

  /**
   * Handle email verification screen
   * @returns {Promise<void>}
   */
  async handleEmailVerification() {
    try {
      this.logger.info('Handling email verification screen...');

      // Get email from configuration
      const email = this.config.get('TWITTER_EMAIL') || this.config.get('TWITTER_USERNAME');
      if (!email || !email.includes('@')) {
        this.logger.warn('No valid email found in configuration for email verification');
        throw new Error('Email verification required but no email configured');
      }

      // Look for email input field - X uses a generic text input for email/phone
      const emailInputSelectors = [
        'input[data-testid="ocfEnterTextTextInput"]', // X's email verification input
        'input[name="text"]', // Fallback generic text input
        'input[name="email"]',
        'input[type="email"]',
        'input[placeholder*="email" i]',
      ];

      let emailInput = null;
      for (const selector of emailInputSelectors) {
        try {
          await this.browser.waitForSelector(selector, { timeout: 5000 });
          emailInput = selector;
          this.logger.debug(`Found email input with selector: ${selector}`);
          break;
        } catch {
          this.logger.debug(`Email input selector failed: ${selector}`);
          continue;
        }
      }

      if (!emailInput) {
        this.logger.warn('Could not find email input field, proceeding anyway');
        return;
      }

      // Enter email
      await this.browser.type(emailInput, email);
      this.logger.info(`Entered email: ${email}`);

      // Look for and click continue/next button
      const continueButtonSelectors = [
        'div[role="button"]:has-text("Next")',
        'button:has-text("Next")',
        'div[role="button"]:has-text("Continue")',
        'button:has-text("Continue")',
        '[data-testid="ocf_submit_button"]',
        'button[type="submit"]',
      ];

      let continueClicked = false;
      for (const selector of continueButtonSelectors) {
        try {
          await this.browser.waitForSelector(selector, { timeout: 5000 });
          await this.browser.click(selector);
          this.logger.info(`Clicked continue button using selector: ${selector}`);
          continueClicked = true;
          break;
        } catch {
          this.logger.debug(`Continue button selector failed: ${selector}`);
          continue;
        }
      }

      if (!continueClicked) {
        this.logger.warn('Could not find continue button after email entry');
      }

      // Wait a bit for the next screen to load
      await this.delay(3000);
    } catch (error) {
      this.logger.error('Error handling email verification:', error.message);
      throw error;
    }
  }

  /**
   * Verify authentication status
   * @returns {Promise<void>}
   */
  async verifyAuthentication() {
    const operation = this.logger.startOperation('verifyAuthentication', {
      xUser: this.xUser,
    });

    try {
      operation.progress('Checking authentication status with AuthManager');
      const isAuthenticated = await this.authManager.isAuthenticated();

      if (isAuthenticated) {
        operation.success('Authentication verified successfully', {
          authStatus: 'valid',
        });
        return;
      }

      operation.progress('Authentication check failed, re-authenticating');
      await this.ensureAuthenticated();
      operation.success('Re-authentication completed after verification failure');
    } catch (error) {
      operation.error(error, 'Authentication verification failed, attempting recovery');

      try {
        operation.progress('Attempting recovery authentication after verification failure');
        await this.ensureAuthenticated();
        operation.success('Recovery authentication successful');
      } catch (recoveryError) {
        operation.error(recoveryError, 'Recovery authentication also failed');
        throw recoveryError;
      }
    }
  }

  /**
   * Refresh authentication cookies
   * @returns {Promise<void>}
   */
  async refreshAuth() {
    const operation = this.logger.startOperation('refreshAuth', {
      currentUrl: 'unknown',
    });

    try {
      operation.progress('Navigating to X home page for session refresh');
      await this.browser.goto('https://x.com/home');

      operation.progress('Checking if user is still logged in');
      const isLoggedIn = await this.browser.evaluate(() => {
        /* eslint-disable no-undef */
        return !document.querySelector('[data-testid="login"]');
        /* eslint-enable no-undef */
      });

      if (!isLoggedIn) {
        operation.progress('Authentication expired, performing full login');
        await this.loginToX();
      }

      operation.success('Authentication refreshed successfully', {
        wasLoggedIn: isLoggedIn,
        actionTaken: isLoggedIn ? 'session_refresh' : 'full_login',
      });
    } catch (error) {
      operation.error(error, 'Failed to refresh authentication');
      throw error;
    }
  }

  /**
   * Check if scraper is running
   * @returns {boolean} True if running
   */
  isRunning() {
    return this.isRunning;
  }

  /**
   * Get scraper statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      xUser: this.xUser,
      pollingInterval: {
        min: this.minInterval,
        max: this.maxInterval,
        next: this.nextPollTimestamp,
      },
      ...this.stats,
      duplicateDetectorStats: this.duplicateDetector.getStats(),
    };
  }

  /**
   * Perform enhanced scrolling for comprehensive content loading
   * @returns {Promise<void>}
   */
  async performEnhancedScrolling() {
    // Scroll down multiple times to load more content for retweet detection
    for (let i = 0; i < 5; i++) {
      /* eslint-disable no-undef */
      await this.browser.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      /* eslint-enable no-undef */
      await this.delay(1500); // Wait for content to load
    }
  }

  /**
   * Navigate to user profile timeline for retweet detection
   * @param {string} username - X username
   * @returns {Promise<void>}
   */
  async navigateToProfileTimeline(username) {
    const profileUrl = `https://x.com/${username}`;
    await this.browser.goto(profileUrl);

    // Wait for timeline to load
    await this.browser.waitForSelector('[data-testid="primaryColumn"]');

    // Perform deeper scrolling for retweets
    await this.performEnhancedScrolling();
  }

  /**
   * Ensure user is authenticated (alias for loginToX)
   * @returns {Promise<void>}
   */
  async ensureAuthenticated(options = {}) {
    const defaultOptions = {
      maxRetries: 3,
      baseDelay: 2000,
      ...options,
    };

    try {
      await this.authManager.ensureAuthenticated(defaultOptions);
    } catch (err) {
      this.logger.error('Authentication failed after all retry attempts:', err);
      throw err;
    }
  }

  /**
   * Validate cookie format
   * @param {Array} cookies - Array of cookie objects
   * @returns {boolean} True if cookies are valid
   */
  validateCookieFormat(cookies) {
    if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
      return false;
    }

    return cookies.every(cookie => {
      return (
        cookie && typeof cookie === 'object' && typeof cookie.name === 'string' && typeof cookie.value === 'string'
      );
    });
  }

  /**
   * Dispose of resources
   * @returns {Promise<void>}
   */
  /**
   * Generate X search URL
   * @param {boolean} includeDate - Whether to include the since date parameter
   * @returns {string} The search URL
   */
  generateSearchUrl(includeDate = true) {
    let searchUrl = `https://x.com/search?q=(from%3A${this.xUser})`;
    if (includeDate) {
      const yesterday = daysAgoUTC(1);
      const sinceDate = yesterday.toISOString().split('T')[0];
      searchUrl += `%20since%3A${sinceDate}`;
    }
    searchUrl += '&f=live&pf=on&src=typed_query';
    return searchUrl;
  }

  /**
   * Initialize recent content on startup to prevent announcing old posts
   * This scans recent content and marks it as "seen" without announcing it
   * @returns {Promise<void>}
   */
  async initializeRecentContent() {
    const initializationHours = parseInt(this.config.get('INITIALIZATION_WINDOW_HOURS', '24'), 10);
    const initializationWindow = initializationHours * 60 * 60 * 1000;
    const cutoffTime = new Date(Date.now() - initializationWindow);

    const operation = this.logger.startOperation('initializeRecentContent', {
      xUser: this.xUser,
      initializationHours,
      cutoffTime: cutoffTime.toISOString(),
    });

    try {
      this.logger.info('Initializing with recent content to prevent old post announcements...');

      // First, scan Discord channels for already announced content to avoid duplicates
      const discordScanResults = await this.scanDiscordChannelsForContent();
      let markedAsSeen = discordScanResults.totalMarked;
      this.logger.info(
        `Discord channel scan: marked ${discordScanResults.totalMarked} content items from ${discordScanResults.channelsScanned} unique channels`
      );

      // Then navigate to user's profile to get recent content from X directly
      operation.progress('Navigating to user profile for recent content scan');
      await this.navigateToProfileTimeline(this.xUser);

      operation.progress('Extracting recent tweets from profile');
      const tweets = await this.extractTweets();

      operation.progress(`Marking recent tweets as seen within ${initializationHours}h window`);
      for (const tweet of tweets) {
        // Only mark tweets that are within our initialization window
        const tweetTime = tweet.timestamp ? new Date(tweet.timestamp) : null;

        if (tweetTime && tweetTime >= cutoffTime) {
          // Mark as seen by adding to duplicate detector
          if (tweet.url) {
            await this.duplicateDetector.markAsSeen(tweet.url);
            markedAsSeen++;
            this.logger.debug(`Marked tweet ${tweet.tweetID} as seen (${tweetTime.toISOString()})`);
          }
        }
      }

      // Also scan for retweets separately to ensure we catch them
      if (this.shouldProcessRetweets()) {
        operation.progress('Processing retweets during initialization');
        try {
          const retweetTweets = await this.extractTweets();
          for (const tweet of retweetTweets) {
            const tweetTime = tweet.timestamp ? new Date(tweet.timestamp) : null;

            if (tweetTime && tweetTime >= cutoffTime && tweet.url) {
              if (!(await this.duplicateDetector.isDuplicate(tweet.url))) {
                await this.duplicateDetector.markAsSeen(tweet.url);
                markedAsSeen++;
                this.logger.debug(`Marked retweet ${tweet.tweetID} as seen (${tweetTime.toISOString()})`);
              }
            }
          }
        } catch (error) {
          operation.progress(`Error during retweet initialization scan: ${error.message}`);
        }
      }

      operation.success('Recent content initialization completed', {
        totalTweetsScanned: tweets.length,
        markedAsSeen,
        cutoffTime: cutoffTime.toISOString(),
        announcementStartTime: toISOStringUTC(),
      });
    } catch (error) {
      operation.error(error, 'Error during recent content initialization', {
        note: 'This is non-fatal, continuing with normal operation',
        initializationHours,
      });
      // Don't throw - this is a best-effort initialization
    }
  }

  /**
   * Scan Discord channels for already announced content to mark as seen
   * Prevents duplicate announcements by checking Discord channel history
   * @returns {Promise<Object>} Scan results with channelsScanned and totalMarked counts
   */
  async scanDiscordChannelsForContent() {
    const results = {
      channelsScanned: 0,
      totalMarked: 0,
      errors: [],
    };

    try {
      if (!this.discord?.client) {
        this.logger.warn('Discord client not available for channel scanning');
        return results;
      }

      // Get unique channel IDs to scan (avoid duplicates)
      const channelIds = this.getUniqueDiscordChannelIds();
      this.logger.info(`Scanning ${channelIds.length} unique Discord channels for existing content...`);

      // Scan limit per channel (configurable)
      const scanLimit = parseInt(this.config.get('DISCORD_SCAN_LIMIT', '200'), 10);

      for (const channelId of channelIds) {
        try {
          const channel = await this.discord.client.channels.fetch(channelId);
          if (!channel) {
            this.logger.warn(`Could not fetch Discord channel ${channelId}`);
            continue;
          }

          this.logger.debug(`Scanning Discord channel ${channelId} (${channel.name || 'unnamed'}) for X content...`);

          // Scan for tweet URLs
          const tweetScanResults = await this.duplicateDetector.scanDiscordChannelForTweets(channel, scanLimit);
          results.totalMarked += tweetScanResults.tweetIdsAdded;
          results.channelsScanned++;

          this.logger.debug(
            `Channel ${channelId}: found ${tweetScanResults.tweetIdsFound.length} tweets, marked ${tweetScanResults.tweetIdsAdded} new ones`
          );

          if (tweetScanResults.errors.length > 0) {
            results.errors.push({
              channelId,
              type: 'tweet_scan_errors',
              errors: tweetScanResults.errors,
            });
          }

          // Rate limiting between channels
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          this.logger.warn(`Error scanning Discord channel ${channelId}:`, error.message);
          results.errors.push({
            channelId,
            type: 'channel_access_error',
            message: error.message,
          });
        }
      }

      this.logger.info(
        `Discord channel scan complete: ${results.channelsScanned} channels scanned, ${results.totalMarked} content items marked as seen`
      );
    } catch (error) {
      this.logger.error('Error during Discord channel scanning:', error);
      results.errors.push({
        type: 'general_scan_error',
        message: error.message,
      });
    }

    return results;
  }

  /**
   * Get unique Discord channel IDs to prevent scanning the same channel multiple times
   * @returns {Array<string>} Array of unique channel IDs
   */
  getUniqueDiscordChannelIds() {
    const channelIds = new Set();

    // Add X-related channels (these are the ones that would have X content)
    const xPostsChannelId = this.config.get('DISCORD_X_POSTS_CHANNEL_ID');
    const xRepliesChannelId = this.config.get('DISCORD_X_REPLIES_CHANNEL_ID');
    const xQuotesChannelId = this.config.get('DISCORD_X_QUOTES_CHANNEL_ID');
    const xRetweetsChannelId = this.config.get('DISCORD_X_RETWEETS_CHANNEL_ID');

    if (xPostsChannelId) {
      channelIds.add(xPostsChannelId);
    }
    if (xRepliesChannelId) {
      channelIds.add(xRepliesChannelId);
    }
    if (xQuotesChannelId) {
      channelIds.add(xQuotesChannelId);
    }
    if (xRetweetsChannelId) {
      channelIds.add(xRetweetsChannelId);
    }

    // If retweets channel not configured, it defaults to posts channel (already added above)

    this.logger.debug(
      `Identified ${channelIds.size} unique Discord channels for X content scanning:`,
      Array.from(channelIds)
    );

    return Array.from(channelIds);
  }

  async dispose() {
    await this.stop();
  }
}
