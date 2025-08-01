import { delay } from '../utils/delay.js';
import { nowUTC, toISOStringUTC, daysAgoUTC } from '../utilities/utc-time.js';
import { getXScrapingBrowserConfig } from '../utilities/browser-config.js';
import { createEnhancedLogger } from '../utilities/enhanced-logger.js';
import { getBrowserTweetHelperFunctions } from '../utilities/browser-tweet-helpers.js';

/**
 * X (Twitter) scraping application orchestrator
 * Coordinates browser automation, content classification, and announcements
 */
export class ScraperApplication {
  constructor(dependencies) {
    this.browser = dependencies.browserService;
    this.contentCoordinator = dependencies.contentCoordinator;
    this.classifier = dependencies.contentClassifier;
    this.config = dependencies.config;
    this.state = dependencies.stateManager;
    this.discord = dependencies.discordService;
    this.eventBus = dependencies.eventBus;
    this.xAuthManager = dependencies.xAuthManager;
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

    // Polling configuration
    this.minInterval = parseInt(this.config.get('X_QUERY_INTERVAL_MIN', '300000'), 10);
    this.maxInterval = parseInt(this.config.get('X_QUERY_INTERVAL_MAX', '600000'), 10);

    // Use injected duplicate detector service
    this.duplicateDetector = dependencies.duplicateDetector;
    if (!this.duplicateDetector) {
      throw new Error('DuplicateDetector dependency is required but not provided');
    }
    this.isRunning = false;
    this.timerId = null;
    this.currentSession = null;
    this.retryCount = 0;

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
      xUsername: this.xUsername,
      pollingInterval: { min: this.minInterval, max: this.maxInterval },
    });

    try {
      // Test enhanced logging is working
      operation.progress('Enhanced logging system is operational - you should see this message');

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
          health.authenticated = await this.xAuthManager.isAuthenticated();
          if (!health.authenticated) {
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
      headless: true,
    });

    try {
      const browserOptions = getXScrapingBrowserConfig({
        headless: true,
      });

      operation.progress('Launching browser with X scraping configuration');
      await this.browser.launch(browserOptions);

      const userAgent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

      operation.progress('Setting user agent for stealth browsing');
      await this.browser.setUserAgent(userAgent);

      operation.success('Browser initialized for X scraping', {
        userAgent: `${userAgent.substring(0, 120)}...`,
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
    // Reset retry count when stopping
    this.retryCount = 0;
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
    // ✅ FIX: Clear existing timer before creating new one to prevent timer multiplication
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    // Initialize retry count if not exists
    if (!this.retryCount) {
      this.retryCount = 0;
    }

    // ✅ FIX: Add retry limit to prevent infinite recursion and OOM
    const MAX_RETRIES = 5;
    if (this.retryCount >= MAX_RETRIES) {
      this.logger.error(`Max retries (${MAX_RETRIES}) exceeded, stopping scraper to prevent resource exhaustion`);
      this.stop().catch(error => {
        this.logger.error('Error stopping scraper after max retries:', error);
      });
      return;
    }

    this.retryCount++;
    const retryInterval = Math.min(this.maxInterval, this.minInterval * Math.pow(2, this.retryCount - 1));
    this.nextPollTimestamp = Date.now() + retryInterval;

    this.timerId = setTimeout(async () => {
      if (!this.isRunning) {
        return;
      }
      try {
        await this.pollXProfile();
        // ✅ Success: Reset retry count and resume normal scheduling
        this.retryCount = 0;
        this.scheduleNextPoll();
      } catch (error) {
        this.logger.error(`Retry attempt ${this.retryCount}/${MAX_RETRIES} failed:`, error);
        this.scheduleRetry(); // Continue retry with incremented counter
      }
    }, retryInterval);

    this.logger.info(`Retry ${this.retryCount}/${MAX_RETRIES} scheduled in ${retryInterval}ms`);
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

      // ========================================================================
      // CRITICAL IMPLEMENTATION NOTE: TWO-STEP APPROACH IS MANDATORY
      // ========================================================================
      // 1. ADVANCED SEARCH: Get posts AUTHORED by the user (excludes retweets)
      //    - Uses "from:username" search to find only original posts
      //    - This is the primary method for detecting new content
      //
      // 2. PROFILE TIMELINE: Get ONLY retweets (everything else already covered)
      //    - Retweets don't appear in "from:username" search results
      //    - Profile timeline includes both posts AND retweets
      //    - We filter to process only retweets to avoid duplicates
      //
      // DO NOT CHANGE THIS TO USE ONLY ONE METHOD - IT WILL MISS CONTENT
      // ========================================================================

      operation.progress('STEP 1: Using advanced search for user-authored posts');
      const searchUrl = this.generateSearchUrl(true);
      operation.progress(`Navigating to search URL: ${searchUrl}`);
      await this.browser.goto(searchUrl);

      // Check if we got redirected to home page (login required)
      const currentUrl = await this.browser.getCurrentUrl();
      if (currentUrl.includes('/home') || currentUrl.includes('twitter.com/home')) {
        operation.error(
          new Error(`Authentication failed: redirected to home page instead of search results`),
          'Redirected to home page - search aborted',
          { expectedUrl: searchUrl, actualUrl: currentUrl }
        );
        throw new Error('Authentication required: redirected to home page');
      }

      operation.progress('Waiting for search results to load');
      await this.browser.waitForSelector('[data-testid="primaryColumn"]', { timeout: 10000 });

      // Additional wait for tweet content to load dynamically
      operation.progress('Waiting for tweet content to load');
      try {
        // Wait for either articles to appear or "No results" message
        await Promise.race([
          this.browser.waitForSelector('article[data-testid="tweet"]', { timeout: 5000 }),
          this.browser.waitForSelector('[data-testid="emptyState"]', { timeout: 5000 }),
          new Promise(resolve => setTimeout(resolve, 3000)), // 3s fallback timeout
        ]);
      } catch (_waitError) {
        operation.progress('Content wait timeout, proceeding with extraction');
      }

      operation.progress('Extracting tweets from search results');
      const searchTweets = await this.extractTweets();

      // Validate we're on the correct page before processing results
      const finalUrl = await this.browser.getCurrentUrl();
      if (finalUrl.includes('/home') || finalUrl.includes('twitter.com/home')) {
        operation.error(
          new Error(`Invalid page detected during extraction: on home page instead of search results`),
          'Home page detected during tweet extraction - aborting',
          { expectedPattern: 'search?q=', actualUrl: finalUrl }
        );
        throw new Error('Invalid page: extracted tweets from home page instead of search');
      }

      this.stats.totalTweetsFound += searchTweets.length;

      // Enhanced logging for debugging intermittent detection
      if (searchTweets.length === 0) {
        const currentUrl = (await this.browser.getUrl?.()) || 'unknown';
        operation.progress(`No tweets found on search page. URL: ${currentUrl}`);
      } else {
        operation.progress(`Found ${searchTweets.length} tweets on search page`);
      }

      operation.progress(
        `Processing ${searchTweets.length} tweets from search (ContentCoordinator will handle filtering)`
      );
      let processedCount = 0;
      if (searchTweets.length > 0) {
        for (const tweet of searchTweets) {
          try {
            await this.processNewTweet(tweet);
            processedCount++;
          } catch (error) {
            this.logger.error(`Error processing tweet ${tweet.tweetID}:`, error);
          }
        }
      }
      this.stats.totalTweetsAnnounced += processedCount;

      // STEP 2: Enhanced retweet detection (MANDATORY - DO NOT SKIP)
      operation.progress('STEP 2: Performing enhanced retweet detection from profile timeline');
      await this.performEnhancedRetweetDetection();

      this.stats.successfulRuns++;

      // Emit poll completion event
      this.eventBus.emit('scraper.poll.completed', {
        timestamp: nowUTC(),
        tweetsFound: searchTweets.length,
        tweetsProcessed: processedCount,
        stats: this.getStats(),
      });

      const nextInterval = this.getNextInterval();
      const nextRunTime = new Date(Date.now() + nextInterval);
      const nextRunTimeFormatted = nextRunTime.toISOString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      operation.success('X profile polling completed successfully', {
        tweetsFound: searchTweets.length,
        tweetsProcessed: processedCount,
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
   * CRITICAL: Enhanced retweet detection from profile timeline
   *
   * ========================================================================
   * PURPOSE: ONLY detect and process RETWEETS that are missed by search
   * ========================================================================
   *
   * WHY THIS EXISTS:
   * - Advanced search (from:username) only returns original posts, NOT retweets
   * - User retweets are important content that must be announced
   * - Profile timeline contains both original posts AND retweets
   *
   * FILTERING STRATEGY:
   * - Process ALL content from profile timeline (posts + retweets)
   * - Duplicate detection will automatically skip posts already processed from search
   * - Only truly new content (primarily retweets) will be announced
   *
   * DO NOT MODIFY THIS TO SKIP RETWEETS OR CHANGE THE APPROACH
   *
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

      // Verify we're on the correct user profile page
      const currentUrl = (await this.browser.getCurrentUrl?.()) || 'unknown';
      const expectedProfileUrl = `https://x.com/${this.xUser}`;

      // Check for home page redirect first (authentication issue)
      if (currentUrl.includes('/home') || currentUrl.includes('twitter.com/home')) {
        operation.error(
          new Error(`Authentication failed: redirected to home page instead of user profile`),
          'Redirected to home page during profile navigation',
          { expectedUrl: expectedProfileUrl, actualUrl: currentUrl }
        );
        throw new Error('Authentication required: redirected to home page during profile access');
      }

      if (!currentUrl.includes(`x.com/${this.xUser}`) && !currentUrl.includes(`twitter.com/${this.xUser}`)) {
        operation.error(
          new Error(`Navigation failed: Expected ${expectedProfileUrl}, but got ${currentUrl}`),
          'URL verification failed - not on correct user profile',
          { expectedUrl: expectedProfileUrl, actualUrl: currentUrl }
        );
        return;
      }

      operation.progress(`URL verification passed: on ${this.xUser} profile (${currentUrl})`);

      operation.progress('Performing enhanced scrolling to load more timeline content');
      await this.performEnhancedScrolling();

      operation.progress('Extracting tweets from profile page');
      const tweets = await this.extractTweets();

      operation.progress(
        `Processing ${tweets.length} tweets from enhanced detection (ContentCoordinator will handle filtering)`
      );
      let processedCount = 0;

      for (const tweet of tweets) {
        this.logger.debug(`Processing tweet ${tweet.tweetID}, category: ${tweet.tweetCategory || 'unknown'}`);
        try {
          await this.processNewTweet(tweet);
          processedCount++;
        } catch (error) {
          this.logger.error(`Error processing tweet ${tweet.tweetID}:`, error);
        }
      }

      operation.success('Enhanced retweet detection completed', {
        totalTweetsFound: tweets.length,
        tweetsProcessed: processedCount,
      });
    } catch (error) {
      operation.error(error, 'Error during enhanced retweet detection', {
        note: 'This error is non-fatal and will not stop the main polling cycle',
      });
      // Do not rethrow, as a failure here should not stop the main polling cycle.
    }
  }

  /**
   * Extract tweets from current page (streamlined)
   * @returns {Promise<Array>} Array of tweet objects
   */
  async extractTweets() {
    const currentUrl = (await this.browser.getCurrentUrl?.()) || 'unknown';
    const operation = this.logger.startOperation('extractTweets', {
      xUser: this.xUser,
      pageUrl: currentUrl,
    });

    this.logger.info(`Extracting tweets from URL: ${currentUrl} (expected user: ${this.xUser})`);

    const monitoredUser = this.xUser; // Pass the monitored user to browser context
    try {
      operation.progress('Injecting helper functions into browser context');
      await this.browser.evaluate(getBrowserTweetHelperFunctions());

      operation.progress('Executing streamlined tweet extraction script');
      const result = await this.browser.evaluate(monitoredUser => {
        /* eslint-disable no-undef, no-console */
        const tweets = [];

        // Enhanced error handling for selector evolution (moved to helper function)
        function robustQuerySelector(selectors, context = document) {
          for (const selector of selectors) {
            try {
              const elements = context.querySelectorAll(selector);
              if (elements.length > 0) {
                console.log(`SUCCESS: Using selector "${selector}" found ${elements.length} elements`);
                return elements;
              }
            } catch (error) {
              console.log(`FAILED: Selector "${selector}" error:`, error.message);
            }
          }
          return [];
        }

        // Use helper function to find articles
        let { articles, workingSelector } = window.findTweetArticles
          ? window.findTweetArticles()
          : (() => {
              const articleSelectors = [
                'article[data-testid="tweet"]',
                'div[data-testid="cellInnerDiv"] article',
                'article[role="article"]',
                'article[tabindex="-1"]',
                'article',
              ];
              const foundArticles = robustQuerySelector(articleSelectors);
              return { articles: foundArticles, workingSelector: foundArticles.length > 0 ? 'robust-selection' : null };
            })();

        // Handle case where no articles found with debugging
        if (articles.length === 0) {
          window.debugNoArticlesFound && window.debugNoArticlesFound();

          console.log('DEBUG: No articles found - checking fallback selectors');
          const fallbackArticles = window.tryFallbackSelectors ? window.tryFallbackSelectors() : [];

          if (fallbackArticles.length > 0) {
            articles = fallbackArticles;
            workingSelector = 'fallback';
          } else {
            return tweets;
          }
        }

        // Process each article to extract basic tweet data
        for (const article of articles) {
          try {
            // Extract basic tweet information using helper functions
            const tweetUrl = window.extractTweetUrl ? window.extractTweetUrl(article) : null;
            if (!tweetUrl) {
              continue;
            }

            const tweetIdMatch = tweetUrl.match(/status\/(\d+)/);
            if (!tweetIdMatch) {
              continue;
            }

            const tweetID = tweetIdMatch[1];

            // Extract author and social context using helper functions
            const authorData = window.extractAuthorInfo
              ? window.extractAuthorInfo(article, tweetUrl)
              : { author: 'Unknown', authorDisplayName: null, retweetedBy: null };

            const { author, authorDisplayName, retweetedBy } = authorData;

            // CRITICAL: Validate author matches monitored user
            // Skip tweets that aren't from our monitored user (posts/quotes/replies)
            // or retweeted by our monitored user (retweets)
            const isFromMonitoredUser = author === monitoredUser;
            const isRetweetByMonitoredUser = retweetedBy === monitoredUser;

            if (!isFromMonitoredUser && !isRetweetByMonitoredUser) {
              console.log(
                `SKIP: Tweet ${tweetID} - author '${author}' (retweetedBy: '${retweetedBy}') doesn't match monitored user '${monitoredUser}'`
              );
              continue;
            }

            // Extract text content using helper function
            const text = window.extractTweetText
              ? window.extractTweetText(article)
              : (article.querySelector('[data-testid="tweetText"]')?.innerText || '').trim();

            // Extract timestamp using helper function
            const timestamp = window.extractTimestamp
              ? window.extractTimestamp(article)
              : article.querySelector('time')?.getAttribute('datetime') || null;

            // Store raw data for ContentClassifier processing - no inline classification
            const tweetData = {
              tweetID,
              url: tweetUrl,
              author,
              authorDisplayName,
              text,
              timestamp,
              // Remove inline classification - let ContentClassifier handle this
              rawClassificationData: {
                socialContext: article.querySelector('[data-testid="socialContext"]')?.innerText || null,
                quoteTweetBlock: !!article.querySelector('div[role="link"][tabindex="0"] a[href*="/status/"]'),
                retweetedBy,
                monitoredUser,
                allText: article.innerText || '',
                // Provide raw DOM data for ContentClassifier
                articleHtml: article.outerHTML,
              },
            };

            // Add retweetedBy if detected
            if (retweetedBy === monitoredUser) {
              tweetData.retweetedBy = monitoredUser;
            }

            tweets.push(tweetData);
            // Successfully extracted tweet data
          } catch (_err) {
            // Error extracting tweet (caught and handled)
          }
        }

        // Tweet extraction completed
        console.log(`DEBUG: Extraction completed with selector "${workingSelector}", found ${tweets.length} tweets`);
        if (tweets.length > 0) {
          console.log(
            `DEBUG: Sample tweet IDs: ${tweets
              .slice(0, 3)
              .map(t => t.tweetID)
              .join(', ')}`
          );
        }
        return tweets;
        /* eslint-enable no-undef */
      }, monitoredUser);

      // Ensure we always return an array, even if browser.evaluate returns undefined
      const tweets = Array.isArray(result) ? result : [];

      // Create breakdown by category for better logging
      const stats = {
        tweetsFound: tweets.length,
        breakdown: {
          post: 0,
          reply: 0,
          quote: 0,
          retweet: 0,
          unknown: 0,
        },
      };

      // Classify tweets for logging breakdown
      for (const tweet of tweets) {
        try {
          const classificationInput = {
            author: tweet.author,
            monitoredUser: this.xUser,
            retweetedBy: tweet.retweetedBy,
            ...tweet.rawClassificationData,
          };

          this.logger.debug(
            `Classifying tweet ${tweet.tweetID}: URL=${tweet.url}, text="${(tweet.text || '').substring(0, 100)}...", metadata=${JSON.stringify(classificationInput)}`
          );

          const classification = this.classifier.classifyXContent(tweet.url, tweet.text, classificationInput);
          const category = classification.type || 'unknown';

          this.logger.debug(
            `Tweet ${tweet.tweetID} classified as: ${category}, full result: ${JSON.stringify(classification)}`
          );

          if (stats.breakdown[category] !== undefined) {
            stats.breakdown[category]++;
          } else {
            stats.breakdown.unknown++;
          }
        } catch (error) {
          this.logger.debug(`Classification failed for tweet ${tweet.tweetID}: ${error.message}`);
          stats.breakdown.unknown++;
        }
      }

      operation.success(`Tweet extraction completed: ${JSON.stringify(stats)}`);

      // Enhanced logging for debugging intermittent detection in both Step 1 and Step 2
      if (tweets.length === 0) {
        const currentUrl = (await this.browser.getUrl?.()) || 'unknown';
        operation.progress(`No tweets extracted from page. URL: ${currentUrl}`);
      } else {
        operation.progress(`Successfully extracted ${tweets.length} tweets from page`);
      }

      // Log browser console messages for debugging selector issues
      try {
        const browserLogs = (await this.browser.getConsoleLogs?.()) || [];
        const debugLogs = browserLogs.filter(log => log.text && log.text.includes('DEBUG:'));
        if (debugLogs.length > 0) {
          operation.progress(`Browser debug messages: ${debugLogs.map(log => log.text).join(' | ')}`);
        }
      } catch (_logError) {
        // Browser console logging not available or failed
      }

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
   * Check if enhanced retweet processing should be enabled
   * @returns {boolean} True if retweet processing is enabled
   */
  shouldProcessRetweets() {
    return this.config.getBoolean('ENABLE_RETWEET_PROCESSING', true);
  }

  /**
   * Process a new tweet (streamlined to delegate to ContentCoordinator)
   * @param {Object} tweet - Tweet object with raw classification data
   * @returns {Promise<void>}
   */
  async processNewTweet(tweet) {
    const operation = this.logger.startOperation('processNewTweet', {
      tweetId: tweet.tweetID,
      author: tweet.author,
      monitoredUser: this.xUser,
    });

    try {
      // Create streamlined content object - let ContentCoordinator handle classification
      const content = {
        platform: 'x',
        type: 'post', // ContentClassifier will determine actual type
        id: tweet.tweetID,
        url: tweet.url,
        author: tweet.author,
        authorDisplayName: tweet.authorDisplayName,
        retweetedBy: tweet.retweetedBy,
        text: tweet.text,
        timestamp: tweet.timestamp,
        publishedAt: tweet.timestamp,
        // Pass raw classification data for ContentClassifier
        rawClassificationData: tweet.rawClassificationData,
        xUser: this.xUser,
      };

      const result = await this.contentCoordinator.processContent(content.id, 'scraper', content);
      if (tweet.url) {
        this.duplicateDetector.markAsSeen(tweet.url);
      }

      // Emit processing event for monitoring
      this.eventBus.emit('scraper.tweet.processed', {
        tweet: content,
        result,
        timestamp: nowUTC(),
      });

      // Log result based on ContentCoordinator response
      if (result.action === 'announced') {
        const authorInfo = tweet.retweetedBy ? `@${tweet.retweetedBy}` : `@${tweet.author}`;
        operation.success(`Successfully processed content from ${authorInfo}`, {
          tweetId: tweet.tweetID,
          result: result.reason || 'announced',
        });
      } else if (result.action === 'skip') {
        // Get tweet category for enhanced logging
        let category = 'unknown';
        try {
          const classificationInput = {
            author: tweet.author,
            monitoredUser: this.xUser,
            retweetedBy: tweet.retweetedBy,
            ...tweet.rawClassificationData,
          };

          this.logger.debug(
            `Classifying tweet for logging: URL=${tweet.url}, text="${(tweet.text || '').substring(0, 100)}...", input=${JSON.stringify(classificationInput)}`
          );

          const classification = this.classifier.classifyXContent(tweet.url, tweet.text, classificationInput);
          category = classification.type || 'unknown';

          this.logger.debug(`Classification result: ${JSON.stringify(classification)}`);
        } catch (error) {
          this.logger.debug(`Classification failed: ${error.message}`);
          // Keep default category if classification fails
        }

        // Get first 50 characters of tweet text
        const textPreview = (tweet.text || '').substring(0, 120);
        const textSuffix = (tweet.text || '').length > 50 ? '...' : '';

        operation.success(
          `Skipping content: ${category} too old - published ${tweet.timestamp}\n${textPreview}${textSuffix}`,
          {
            tweetId: tweet.tweetID,
            skipReason: result.reason,
            publishedAt: tweet.timestamp,
            category,
            textPreview: `${textPreview}${textSuffix}`,
          }
        );
      } else if (result.action === 'failed') {
        operation.error(
          new Error(result.reason || 'ContentCoordinator processing failed'),
          'Content processing failed',
          {
            tweetId: tweet.tweetID,
            author: tweet.author,
            reason: result.reason,
          }
        );
      } else {
        // Handle unexpected result format
        operation.error(
          new Error(`Unexpected ContentCoordinator result: ${JSON.stringify(result)}`),
          'Unexpected processing result format',
          {
            tweetId: tweet.tweetID,
            author: tweet.author,
            result: JSON.stringify(result),
          }
        );
      }
    } catch (error) {
      operation.error(error, `Error processing tweet ${tweet.tweetID}`, {
        tweetId: tweet.tweetID,
        author: tweet.author,
      });
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
      const isAuthenticated = await this.xAuthManager.isAuthenticated();
      if (!isAuthenticated) {
        operation.progress('Authentication check failed, re-authenticating');
        await this.ensureAuthenticated();
      }
      operation.success('Authentication verification completed');
    } catch (error) {
      operation.error(error, 'Authentication verification failed');
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
      try {
        // Check if page context is still valid before evaluating
        if (!this.browser.page || this.browser.page.isClosed()) {
          this.logger.warn('Page context lost during scrolling, aborting');
          return;
        }

        /* eslint-disable no-undef */
        await this.browser.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        /* eslint-enable no-undef */
        await this.delay(1500); // Wait for content to load
      } catch (error) {
        if (
          error.message.includes('Execution context was destroyed') ||
          error.message.includes('Target closed') ||
          error.message.includes('Page closed')
        ) {
          this.logger.warn(`Page navigation interrupted scrolling at step ${i + 1}`, { error: error.message });
          return; // Gracefully exit instead of failing
        }
        throw error; // Re-throw other errors
      }
    }
  }

  /**
   * Navigate to user profile timeline for retweet detection
   * @param {string} username - X username
   * @returns {Promise<void>}
   */
  async navigateToProfileTimeline(username) {
    const profileUrl = `https://x.com/${username}`;
    this.logger.info(`Navigating to profile timeline: ${profileUrl} (username: ${username})`);
    await this.browser.goto(profileUrl);

    // Wait for timeline to load
    await this.browser.waitForSelector('[data-testid="primaryColumn"]');

    // Additional wait for tweet content to load dynamically on profile page
    try {
      // Wait for either articles to appear or profile content to load
      await Promise.race([
        this.browser.waitForSelector('article[data-testid="tweet"]', { timeout: 5000 }),
        this.browser.waitForSelector('[aria-label*="Timeline"]', { timeout: 5000 }),
        new Promise(resolve => setTimeout(resolve, 3000)), // 3s fallback timeout
      ]);
    } catch (_waitError) {
      // Continue even if wait fails - some profiles may be empty
    }

    // Brief delay to ensure page is fully stabilized before scrolling
    await this.delay(500);

    // Perform deeper scrolling for retweets with error handling
    try {
      await this.performEnhancedScrolling();
    } catch (error) {
      this.logger.warn('Enhanced scrolling failed, continuing without it', {
        username,
        error: error.message,
      });
      // Don't throw - this is not critical to the scraping process
    }
  }

  /**
   * Ensure user is authenticated
   * @returns {Promise<void>}
   */
  async ensureAuthenticated(options = {}) {
    return this.xAuthManager.ensureAuthenticated(options);
  }

  /**
   * Helper functions for tweet extraction (to be moved to browser context if needed)
   * These functions can be injected into the browser context for cleaner extraction
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
