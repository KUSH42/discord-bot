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
  constructor({
    logger,
    config,
    contentCoordinator,
    debugManager,
    metricsManager,
    browserService,
    youtubeAuthManager,
    stateManager,
    memoryMonitor,
  }) {
    // Create enhanced logger for YouTube module
    this.logger = createEnhancedLogger('youtube', logger, debugManager, metricsManager);
    this.config = config;
    this.contentCoordinator = contentCoordinator;
    this.browserService = browserService;
    this.stateManager = stateManager;
    this.browserMutex = new AsyncMutex(); // Prevent concurrent browser operations
    this.isShuttingDown = false; // Flag to coordinate graceful shutdown
    this.videosUrl = null;
    this.liveStreamUrl = null;
    this.isInitialized = false;
    this.isRunning = false;
    this.scrapingInterval = null;
    this.extractedDisplayName = null;
    this.consecutiveFailures = 0;

    // Configuration
    this.minInterval = parseInt(config.get('YOUTUBE_SCRAPER_INTERVAL_MIN', '300000'), 10);
    this.maxInterval = parseInt(config.get('YOUTUBE_SCRAPER_INTERVAL_MAX', '600000'), 10);
    this.maxRetries = config.get('YOUTUBE_SCRAPER_MAX_RETRIES', 3);
    this.retryDelayMs = config.get('YOUTUBE_SCRAPER_RETRY_DELAY_MS', 5000);
    this.timeoutMs = config.get('YOUTUBE_SCRAPER_TIMEOUT_MS', 30000);

    // Authentication configuration
    this.authEnabled = config.getBoolean('YOUTUBE_AUTHENTICATION_ENABLED', false);
    this.authManager = youtubeAuthManager;

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

    // Memory management
    this.videoCache = new Map(); // Cache video data with timestamps
    this.maxCachedVideos = 500; // Limit cached videos
    this.videoCacheHours = 48; // Keep videos for 48 hours
    this.lastMemoryCleanup = Date.now();
    this.memoryMonitor = memoryMonitor; // Optional
    this.videoCacheMutex = new AsyncMutex(); // Synchronize access to videoCache Map

    // Register with memory monitor if available
    if (this.memoryMonitor) {
      this.memoryMonitor.registerContentStore('youtubeVideos', () => this.analyzeVideoCache());
    }
  }

  /**
   * Get real-time authentication status instead of using cached value
   * @returns {Promise<boolean>} True if currently authenticated
   */
  async getAuthenticationStatus() {
    if (!this.authEnabled || !this.authManager) {
      return false;
    }

    try {
      // Use quick authentication check for performance
      return await this.authManager.isQuickAuthenticated();
    } catch (error) {
      this.logger.debug('Authentication status check failed', { error: error.message });
      return false;
    }
  }

  /**
   * Get the channel title from state manager or fallback to extracted name
   * @returns {string} Channel title for display
   */
  getChannelTitle() {
    // First try to get from state manager (set by MonitorApplication API validation)
    const apiChannelTitle = this.stateManager?.get('youtubeChannelTitle');
    if (apiChannelTitle && apiChannelTitle !== 'Unknown') {
      return apiChannelTitle;
    }

    // Fallback to extracted display name
    if (this.extractedDisplayName) {
      return this.extractedDisplayName;
    }

    // Final fallback to processed channel handle
    if (this.channelHandle) {
      return this.channelHandle.startsWith('@') ? this.channelHandle.substring(1) : this.channelHandle;
    }

    return 'Unknown Channel';
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
    this.streamsUrl = `${baseUrl}/streams`; // Add streams endpoint

    try {
      operation.progress('Launching browser with optimized settings');

      // Launch browser with optimized settings for scraping
      const browserOptions = getYouTubeScrapingBrowserConfig();

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
      if (this.authEnabled && this.authManager) {
        operation.progress('Ensuring YouTube authentication');
        await this.authManager.ensureAuthenticated();
      }

      operation.progress('Fetching initial content to establish baseline');

      // Find and set the initial latest video
      const latestVideo = await this.fetchLatestVideo();
      if (latestVideo && latestVideo.success && latestVideo.id) {
        await this.contentCoordinator.processContent(latestVideo.id, 'scraper', latestVideo);
        const activeLiveStream = await this.fetchActiveLiveStream();
        if (activeLiveStream && activeLiveStream.id) {
          await this.contentCoordinator.processContent(activeLiveStream.id, 'scraper', activeLiveStream);
        }

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
      const currentAuthStatus = await this.getAuthenticationStatus();
      const operation = this.logger.startOperation('fetchLatestVideo', {
        videosUrl: this.videosUrl,
        isAuthenticated: currentAuthStatus,
      });

      this.metrics.totalScrapingAttempts++;

      try {
        operation.progress('Navigating to channel videos page');
        // Navigate to channel videos page
        await this.browserService.goto(this.videosUrl, {
          waitUntil: 'networkidle',
          timeout: this.timeoutMs,
        });

        if (this.extractedDisplayName === null) {
          this.extractedDisplayName = (await this.extractChannelTitle()) ?? this.channelHandle;
          const apiChannelTitle = this.stateManager?.get('youtubeChannelTitle');
          const finalChannelTitle = this.getChannelTitle();
          operation.progress(
            `Channel title resolved: ${finalChannelTitle} (API: ${apiChannelTitle || 'none'}, extracted: ${this.extractedDisplayName})`
          );
        }

        operation.progress('Handling consent page redirects');

        // Handle consent page if redirected
        await this.authManager.handleConsentPageRedirect();

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
          latestVideo = await this.browserService.evaluate(
            ({ channelHandle, extractedDisplayName, apiChannelTitle }) => {
              const selectors = [
                // Primary selectors (authenticated users)
                { name: 'modern-grid', selector: 'ytd-rich-grid-media:first-child #video-title-link' },
                { name: 'rich-item', selector: 'ytd-rich-item-renderer:first-child #video-title-link' },
                { name: 'grid-with-contents', selector: '#contents ytd-rich-grid-media:first-child a#video-title' },
                { name: 'list-renderer', selector: '#contents ytd-video-renderer:first-child a#video-title' },

                // Fallback selectors (logged-out/different layouts)
                { name: 'logged-out-grid', selector: 'ytd-grid-video-renderer:first-child a#video-title' },
                { name: 'logged-out-item', selector: 'ytd-item-section-renderer a#video-title' },
                { name: 'mobile-grid', selector: '.ytd-rich-grid-renderer a[href*="/watch?v="]' },
                { name: 'basic-video-link', selector: 'h3 a[href*="/watch?v="]' },

                // Generic fallbacks (broad compatibility)
                { name: 'generic-watch', selector: 'a[href*="/watch?v="]' },
                { name: 'shorts-and-titled', selector: 'a[href*="/shorts/"], a[title][href*="youtube.com/watch"]' },

                // Additional rotation-resistant selectors
                { name: 'any-video-title', selector: '[id*="video-title"] a[href*="/watch?v="]' },
                { name: 'data-context-menu', selector: 'a[data-context-menu-trigger][href*="/watch?v="]' },
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

              // Channel display name will be passed as parameter

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
                // Use channel title from API or extracted display name
                channelTitle:
                  apiChannelTitle ||
                  extractedDisplayName ||
                  (channelHandle.startsWith('@') ? channelHandle.substring(1) : channelHandle),
              };
            },
            {
              channelHandle: this.channelHandle,
              extractedDisplayName: this.extractedDisplayName,
              apiChannelTitle: this.stateManager?.get('youtubeChannelTitle'),
            }
          );
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
          this.consecutiveFailures = 0; // Reset failure counter on success

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

          operation.success(
            `Successfully scraped latest video: ${JSON.stringify(logData, null, 1).replace(/\n/g, '')}`
          );
        } else {
          // Increment failure counter for authentication refresh logic
          this.consecutiveFailures++;

          const failureInfo = {
            videosUrl: this.videosUrl,
            debugInfo,
            consecutiveFailures: this.consecutiveFailures,
          };

          if (latestVideo && !latestVideo.success) {
            failureInfo.attemptedStrategies = latestVideo.strategies;
          }

          // Check authentication status immediately if we're failing to find content
          if (this.authManager && (this.consecutiveFailures === 1 || this.consecutiveFailures >= 3)) {
            operation.progress('Checking authentication status due to scraping failure');
            try {
              const isAuthenticated = await this.authManager.isAuthenticated();
              if (!isAuthenticated) {
                this.logger.warn('Authentication check failed during scraping - attempting refresh', {
                  consecutiveFailures: this.consecutiveFailures,
                });

                // Force re-authentication immediately if not authenticated
                const authResult = await this.authManager.ensureAuthenticated();
                if (authResult) {
                  this.logger.info('Authentication refresh completed successfully');
                  this.consecutiveFailures = 0; // Reset on successful auth
                  operation.progress('Authentication refreshed - ready to retry');
                } else {
                  this.logger.error('Authentication refresh failed');
                }
              }
            } catch (authError) {
              this.logger.error('Authentication status check error:', authError.message);
            }
          }

          // If we still have multiple consecutive failures, try refreshing authentication
          if (this.consecutiveFailures >= 3 && this.authManager) {
            operation.progress('Multiple failures detected, attempting authentication refresh');
            try {
              this.logger.info('Attempting authentication refresh due to consecutive scraping failures', {
                consecutiveFailures: this.consecutiveFailures,
                lastSuccessfulScrape: this.metrics.lastSuccessfulScrape,
              });

              // Force re-authentication
              const authResult = await this.authManager.ensureAuthenticated();
              if (authResult) {
                this.logger.info('Authentication refresh completed, resetting failure counter');
                this.consecutiveFailures = 0; // Reset on successful auth
                operation.progress('Authentication refreshed successfully');
              } else {
                this.logger.warn('Authentication refresh failed');
              }
            } catch (authError) {
              this.logger.error('Authentication refresh error:', authError.message);
            }
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

  async extractChannelTitle() {
    const result = await this.browserService.evaluate(() => {
      /* eslint-disable no-undef */
      let extractedDisplayName = null;
      const debugInfo = [];

      try {
        // Look for channel name in page header/title areas
        const channelNameSelectors = [
          'h1.dynamic-text-view-model-wiz__h1', // YouTube channel page main heading (NEW - most reliable)
          'yt-dynamic-text-view-model h1', // Alternative new layout selector
          'ytd-channel-name yt-formatted-string#text a', // Main channel name link (most specific)
          'ytd-channel-name yt-formatted-string#text', // Main channel name text container
          '.ytd-channel-name yt-formatted-string#text a', // Alternative class-based selector
          '.ytd-channel-name yt-formatted-string#text', // Alternative class-based text container
          '#channel-name #text', // Alternative channel name selector
          'ytd-channel-name #text', // Channel name in header
          '#owner-name a', // Channel name in video owner section
          'ytd-video-owner-renderer #channel-name #text', // Owner section channel name
          '#upload-info #channel-name #text', // Upload info channel name
        ];

        for (const selector of channelNameSelectors) {
          const channelElement = document.querySelector(selector);
          debugInfo.push({
            selector,
            found: !!channelElement,
            textContent: channelElement?.textContent?.trim() || null,
            isEmpty: !channelElement?.textContent?.trim(),
          });

          if (channelElement && channelElement.textContent?.trim()) {
            extractedDisplayName = channelElement.textContent.trim();
            break;
          }
        }

        // If still not found, try extracting from page title (for any channel page)
        if (!extractedDisplayName && document.title && window.location.href.includes('/@')) {
          // YouTube channel page titles follow format "Channel Name - YouTube"
          const titleMatch = document.title.match(/^(.+?)\s*-\s*YouTube$/);
          if (titleMatch) {
            const potentialChannelName = titleMatch[1].trim();
            debugInfo.push({
              selector: 'page-title',
              found: true,
              textContent: potentialChannelName,
              length: potentialChannelName.length,
              hasColon: potentialChannelName.includes(':'),
            });

            // Additional validation: ensure it doesn't look like a video title
            if (potentialChannelName.length < 50 && !potentialChannelName.includes(':')) {
              extractedDisplayName = potentialChannelName;
            }
          } else {
            debugInfo.push({
              selector: 'page-title',
              found: false,
              title: document.title,
              url: window.location.href,
            });
          }
        }
      } catch (error) {
        debugInfo.push({ error: error.message });
      }

      return { extractedDisplayName, debugInfo };
      /* eslint-enable no-undef */
    });

    this.logger.info(`Extracted YouTube channel display name: ${result.extractedDisplayName}`, {
      debugInfo: result.debugInfo,
    });

    return result.extractedDisplayName;
  }

  /**
   * Fetch the active live stream from the channel's live or streams endpoint
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
      const currentAuthStatus = await this.getAuthenticationStatus();
      const operation = this.logger.startOperation('fetchActiveLiveStream', {
        liveStreamUrl: this.liveStreamUrl,
        streamsUrl: this.streamsUrl,
        isAuthenticated: currentAuthStatus,
      });

      try {
        // First, try the /live endpoint (direct to active stream)
        operation.progress('Attempting /live endpoint for direct active stream detection');
        const liveResult = await this.tryLiveEndpoint(operation);

        if (liveResult && liveResult.id && liveResult.isCurrentlyLive) {
          return liveResult;
        }

        // If /live didn't work or no active stream, try /streams endpoint
        operation.progress('Falling back to /streams endpoint for stream list detection');
        const streamsResult = await this.tryStreamsEndpoint(operation);

        if (streamsResult && streamsResult.id && streamsResult.isCurrentlyLive) {
          return streamsResult;
        }

        // Final: return null
        operation.progress('No active livestream detected');
        return null;
      } catch (error) {
        operation.error(error, 'Failed to scrape for active live stream', {
          liveStreamUrl: this.liveStreamUrl,
          streamsUrl: this.streamsUrl,
        });
        return null;
      }
    }); // End of browserMutex.runExclusive
  }

  /**
   * Try to detect live stream from /live endpoint (direct to active stream)
   * @private
   */
  async tryLiveEndpoint(operation) {
    try {
      operation.progress('Navigating to /live endpoint');
      await this.browserService.goto(this.liveStreamUrl, {
        waitUntil: 'domcontentloaded', // Changed from 'networkidle' to avoid video player loading issues
        timeout: this.timeoutMs,
      });

      operation.progress('Handling consent page redirects');
      await this.authManager.handleConsentPageRedirect();

      // Check what page we ended up on
      const currentUrl = await this.browserService.getCurrentUrl();

      if (currentUrl.includes('/watch?v=')) {
        // We were redirected to a specific video - this is likely an active livestream
        operation.progress('Redirected to video page - extracting livestream data');
        return await this.extractLivestreamFromVideoPage();
      } else if (currentUrl.includes('/live')) {
        // We're on the live page but it might just be showing "No live streams"
        operation.progress('On live page - checking for active stream indicators');
        return await this.extractLivestreamFromLivePage();
      } else {
        operation.progress(`Unexpected redirect from /live endpoint: ${currentUrl}`);
        return null;
      }
    } catch (error) {
      operation.progress(`Error with /live endpoint: ${error.message}`);
      return null;
    }
  }

  /**
   * Try to detect live stream from /streams endpoint (list of streams)
   * @private
   */
  async tryStreamsEndpoint(operation) {
    try {
      operation.progress('Navigating to /streams endpoint');
      await this.browserService.goto(this.streamsUrl, {
        waitUntil: 'networkidle',
        timeout: this.timeoutMs,
      });

      operation.progress('Handling consent page redirects');
      await this.authManager.handleConsentPageRedirect();

      operation.progress('Waiting for YouTube JavaScript to load');
      await this.waitForYouTubeLoad();

      operation.progress('Extracting active livestream from streams list');
      return await this.extractLivestreamFromStreamsList();
    } catch (error) {
      operation.progress(`Error with /streams endpoint: ${error.message}`);
      return null;
    }
  }

  /**
   * Wait for YouTube JavaScript to load
   * @private
   */
  async waitForYouTubeLoad() {
    try {
      await this.browserService.waitForFunction(
        () => {
          /* eslint-disable no-undef */
          return window.ytInitialPlayerResponse || window.ytInitialData || document.querySelector('ytd-app') !== null;
          /* eslint-enable no-undef */
        },
        { timeout: 10000 }
      );
    } catch (_waitError) {
      // Still proceed with a basic delay as fallback
      await this.browserService.waitFor(3000);
    }
  }

  /**
   * Extract livestream data from video page (when /live redirects to active stream)
   * @private
   */
  async extractLivestreamFromVideoPage() {
    await this.waitForYouTubeLoad();

    return await this.browserService.evaluate(
      ({ channelHandle, extractedDisplayName, apiChannelTitle }) => {
        /* eslint-disable no-undef */

        // Get video ID from URL
        const videoIdMatch = window.location.href.match(/[?&]v=([^&]+)/);
        if (!videoIdMatch) {
          return null;
        }

        const videoId = videoIdMatch[1];

        // Check if currently live using page indicators
        let isCurrentlyLive = false;
        const title = document.title.replace(' - YouTube', '');

        // Check for live indicators on the page
        const liveIndicators = ['.ytp-live-badge', '.live-badge', '[aria-label*="live"]'];

        for (const selector of liveIndicators) {
          const element = document.querySelector(selector);
          if (element && element.textContent.toUpperCase().includes('LIVE')) {
            isCurrentlyLive = true;
            break;
          }
        }

        // Check for viewer count (indicates live stream)
        const viewerCountElement = document.querySelector('[class*="watching"]');
        if (viewerCountElement && viewerCountElement.textContent.includes('watching')) {
          isCurrentlyLive = true;
        }

        return {
          id: videoId,
          title,
          url: window.location.href,
          type: 'livestream',
          platform: 'youtube',
          isCurrentlyLive,
          publishedAt: new Date().toISOString(),
          scrapedAt: new Date().toISOString(),
          detectionMethod: 'live-endpoint-redirect',
          channelTitle: apiChannelTitle || extractedDisplayName || channelHandle,
        };

        /* eslint-enable no-undef */
      },
      {
        channelHandle: this.channelHandle,
        extractedDisplayName: this.extractedDisplayName,
        apiChannelTitle: this.stateManager?.get('youtubeChannelTitle'),
      }
    );
  }

  /**
   * Extract livestream data from live page (when /live shows live page)
   * @private
   */
  async extractLivestreamFromLivePage() {
    await this.waitForYouTubeLoad();

    return await this.browserService.evaluate(
      ({ channelHandle, extractedDisplayName, apiChannelTitle }) => {
        /* eslint-disable no-undef */

        // PRIORITY 1: Check canonical/meta tags for the actual livestream video ID
        const canonicalLink = document.querySelector('link[rel="canonical"]');
        const metaVideoUrl = document.querySelector('meta[property="og:video:url"]');

        let canonicalVideoId = null;
        if (canonicalLink && canonicalLink.href) {
          const match = canonicalLink.href.match(/[?&]v=([^&]+)/);
          if (match) {
            canonicalVideoId = match[1];
          }
        }

        if (!canonicalVideoId && metaVideoUrl && metaVideoUrl.content) {
          const match = metaVideoUrl.content.match(/[?&]v=([^&]+)/);
          if (match) {
            canonicalVideoId = match[1];
          }
        }

        // If we found a canonical video ID, verify it's actually live
        if (canonicalVideoId) {
          // Check for live indicators on the page to confirm this is an active livestream
          const liveIndicators = [
            document.querySelector('.ytp-live-badge'),
            document.querySelector('.live-badge'),
            document.querySelector('[aria-label*="live"]'),
            document.querySelector('[class*="watching"]'),
            ...Array.from(document.querySelectorAll('*')).filter(
              el =>
                el.textContent &&
                (el.textContent.includes('watching now') || el.textContent.includes('Started streaming'))
            ),
          ].filter(Boolean);

          const hasLiveIndicators = liveIndicators.length > 0;
          const title = document.title.replace(' - YouTube', '').replace('Live Stream', '').trim();

          if (hasLiveIndicators) {
            return {
              id: canonicalVideoId,
              title: title || 'Live Stream',
              url: `https://www.youtube.com/watch?v=${canonicalVideoId}`,
              type: 'livestream',
              platform: 'youtube',
              isCurrentlyLive: true,
              publishedAt: new Date().toISOString(),
              scrapedAt: new Date().toISOString(),
              detectionMethod: 'live-page-canonical',
              channelTitle: apiChannelTitle || extractedDisplayName || channelHandle,
            };
          }
        }

        // PRIORITY 2: Look for channel-specific featured content (not recommendations)
        const channelFeaturedLink = document.querySelector(
          'ytd-channel-featured-content-renderer a[href*="/watch?v="]'
        );
        if (channelFeaturedLink) {
          const container = channelFeaturedLink.closest('ytd-channel-featured-content-renderer');
          const hasLiveText =
            container &&
            (container.textContent.toLowerCase().includes('live') ||
              container.textContent.toLowerCase().includes('now playing') ||
              container.textContent.toLowerCase().includes('watching'));

          if (hasLiveText) {
            const videoIdMatch = channelFeaturedLink.href.match(/[?&]v=([^&]+)/);
            if (videoIdMatch) {
              return {
                id: videoIdMatch[1],
                title:
                  channelFeaturedLink.textContent.trim() || channelFeaturedLink.getAttribute('title') || 'Live Stream',
                url: channelFeaturedLink.href,
                type: 'livestream',
                platform: 'youtube',
                isCurrentlyLive: true,
                publishedAt: new Date().toISOString(),
                scrapedAt: new Date().toISOString(),
                detectionMethod: 'live-page-featured',
                channelTitle: apiChannelTitle || extractedDisplayName || channelHandle,
              };
            }
          }
        }

        // PRIORITY 3: Look for main content area (avoid recommendations sidebar)
        const mainContentSelectors = [
          '#primary #contents a[href*="/watch?v="]', // Main content area
          'ytd-two-column-browse-results-renderer #primary a[href*="/watch?v="]', // Primary column only
          '.ytd-channel-video-player-renderer a[href*="/watch?v="]', // Channel video player
        ];

        for (const selector of mainContentSelectors) {
          const links = document.querySelectorAll(selector);
          for (const link of links) {
            // Skip if this link is in the recommendations/secondary sidebar
            if (
              link.closest('#secondary') ||
              link.closest('#related') ||
              link.closest('ytd-watch-next-secondary-results-renderer')
            ) {
              continue;
            }

            const container = link.closest('div, article, section, ytd-rich-grid-media');
            if (container) {
              const containerText = container.textContent.toLowerCase();
              const hasLiveText =
                containerText.includes('live') ||
                containerText.includes('now playing') ||
                containerText.includes('watching');

              // Additional check: ensure this belongs to our channel
              const belongsToChannel =
                containerText.includes(channelHandle.toLowerCase()) ||
                containerText.includes((extractedDisplayName || '').toLowerCase()) ||
                containerText.includes((apiChannelTitle || '').toLowerCase());

              if (hasLiveText && belongsToChannel) {
                const videoIdMatch = link.href.match(/[?&]v=([^&]+)/);
                if (videoIdMatch) {
                  return {
                    id: videoIdMatch[1],
                    title: link.textContent.trim() || link.getAttribute('title') || 'Live Stream',
                    url: link.href,
                    type: 'livestream',
                    platform: 'youtube',
                    isCurrentlyLive: true,
                    publishedAt: new Date().toISOString(),
                    scrapedAt: new Date().toISOString(),
                    detectionMethod: 'live-page-main-content',
                    channelTitle: apiChannelTitle || extractedDisplayName || channelHandle,
                  };
                }
              }
            }
          }
        }

        return null;
        /* eslint-enable no-undef */
      },
      {
        channelHandle: this.channelHandle,
        extractedDisplayName: this.extractedDisplayName,
        apiChannelTitle: this.stateManager?.get('youtubeChannelTitle'),
      }
    );
  }

  /**
   * Extract livestream data from streams list page
   * @private
   */
  async extractLivestreamFromStreamsList() {
    await this.waitForYouTubeLoad();

    return await this.browserService.evaluate(
      ({ channelHandle, extractedDisplayName, apiChannelTitle }) => {
        /* eslint-disable no-undef */

        // Look for the first stream with live indicators
        const streamElements = document.querySelectorAll('ytd-rich-grid-media, ytd-rich-item-renderer');

        for (const element of streamElements) {
          const link = element.querySelector('a[href*="/watch?v="]');
          if (!link) {
            continue;
          }

          // Check for live indicators in this stream element
          const hasLiveIndicator =
            element.textContent.includes('watching') ||
            element.querySelector('[class*="live"]') ||
            element.querySelector('[aria-label*="live"]') ||
            Array.from(element.querySelectorAll('*')).some(el => el.textContent.trim().toUpperCase() === 'LIVE');

          if (hasLiveIndicator) {
            const videoIdMatch = link.href.match(/[?&]v=([^&]+)/);
            if (videoIdMatch) {
              return {
                id: videoIdMatch[1],
                title: link.textContent.trim() || link.getAttribute('title') || 'Live Stream',
                url: link.href,
                type: 'livestream',
                platform: 'youtube',
                isCurrentlyLive: true,
                publishedAt: new Date().toISOString(),
                scrapedAt: new Date().toISOString(),
                detectionMethod: 'streams-list-detection',
                channelTitle: apiChannelTitle || extractedDisplayName || channelHandle,
              };
            }
          }
        }

        return null;
        /* eslint-enable no-undef */
      },
      {
        channelHandle: this.channelHandle,
        extractedDisplayName: this.extractedDisplayName,
        apiChannelTitle: this.stateManager?.get('youtubeChannelTitle'),
      }
    );
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
    const currentAuthStatus = await this.getAuthenticationStatus();
    const operation = this.logger.startOperation('scanForContent', {
      videosUrl: this.videosUrl,
      liveStreamUrl: this.liveStreamUrl,
      isAuthenticated: currentAuthStatus,
    });

    try {
      // Proactively re-authenticate if not authenticated and auth is enabled
      if (!currentAuthStatus && this.authEnabled && this.authManager) {
        operation.progress('Not authenticated, attempting re-authentication');
        const authResult = await this.authManager.ensureAuthenticated();
        if (authResult) {
          operation.progress('Re-authentication successful');
        } else {
          operation.progress('Re-authentication failed, continuing with limited access');
        }
      }

      operation.progress('Fetching both livestream and video content concurrently');

      // Fetch both potential new content types concurrently
      const [activeLiveStream, latestVideo] = await Promise.all([
        this.fetchActiveLiveStream(),
        this.fetchLatestVideo(),
      ]);

      let contentProcessed = 0;
      const contentResults = [];

      if (activeLiveStream && activeLiveStream.id) {
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
      } else if (activeLiveStream && !activeLiveStream.id) {
        // Log when we detected a livestream object but it has no ID (likely an error case)
        operation.progress(
          `Livestream detection returned error: ${JSON.stringify({
            error: activeLiveStream.error,
            debugInfo: activeLiveStream.debugInfo,
            hasId: !!activeLiveStream.id,
          })}`
        );
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
        operation.success(
          `Content scan completed: processed ${contentProcessed} items - ${JSON.stringify(summary, null, 1).replace(/\n/g, '')}`
        );
      } else {
        operation.success(
          `Content scan completed: no new content found - ${JSON.stringify(summary, null, 1).replace(/\n/g, '')}`
        );
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
        // Periodic memory cleanup
        await this.cleanupVideoCache();
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
      streamsUrl: this.streamsUrl,
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

  /**
   * Clean up old cached videos to prevent memory leaks
   * 🚨 RACE CONDITION FIX: Create snapshot before iterating to prevent iterator invalidation
   * @private
   */
  async cleanupVideoCache() {
    return await this.videoCacheMutex.runExclusive(async () => {
      const now = Date.now();
      const cleanupThreshold = now - this.videoCacheHours * 60 * 60 * 1000;
      let cleaned = 0;

      // 🚨 FIX: Create snapshot to prevent race condition with concurrent iterations
      const entries = Array.from(this.videoCache.entries());

      // Remove videos older than threshold
      for (const [key, video] of entries) {
        if (video.cachedAt && video.cachedAt < cleanupThreshold) {
          this.videoCache.delete(key);
          cleaned++;
        }
      }

      // If still too many videos, remove oldest ones
      if (this.videoCache.size > this.maxCachedVideos) {
        // Use existing snapshot, re-sort by age
        const sortedEntries = entries
          .filter(([key]) => this.videoCache.has(key)) // Only keep entries that still exist
          .sort((a, b) => (a[1].cachedAt || 0) - (b[1].cachedAt || 0));

        const toRemove = sortedEntries.slice(0, sortedEntries.length - this.maxCachedVideos);
        for (const [key] of toRemove) {
          if (this.videoCache.has(key)) {
            // Double-check before deletion
            this.videoCache.delete(key);
            cleaned++;
          }
        }
      }

      if (cleaned > 0) {
        this.logger.debug(`[MEMORY] Cleaned up ${cleaned} old cached videos, ${this.videoCache.size} remaining`);
      }

      this.lastMemoryCleanup = now;
    });
  }

  /**
   * Analyze video cache for memory monitoring
   * 🚨 RACE CONDITION FIX: Create snapshot to prevent iterator invalidation during cleanup
   * @private
   * @returns {Object} Analysis of video cache
   */
  async analyzeVideoCache() {
    return await this.videoCacheMutex.runExclusive(async () => {
      if (this.videoCache.size === 0) {
        return {
          totalItems: 0,
          totalSizeMB: 0,
          oldestItemHours: 0,
          newestItemHours: 0,
        };
      }

      const now = Date.now();
      let oldestTime = now;
      let newestTime = 0;
      let totalSize = 0;

      // 🚨 FIX: Create snapshot to prevent race condition with concurrent cleanup
      const videos = Array.from(this.videoCache.values());

      // Analyze videos from snapshot
      for (const video of videos) {
        if (video.cachedAt) {
          oldestTime = Math.min(oldestTime, video.cachedAt);
          newestTime = Math.max(newestTime, video.cachedAt);
        }

        // Estimate size (rough calculation)
        totalSize += JSON.stringify(video).length;
      }

      return {
        totalItems: videos.length, // Use snapshot size for consistency
        totalSizeMB: Math.round((totalSize / 1024 / 1024) * 100) / 100,
        oldestItemHours: Math.round(((now - oldestTime) / (1000 * 60 * 60)) * 10) / 10,
        newestItemHours: Math.round(((now - newestTime) / (1000 * 60 * 60)) * 10) / 10,
        itemTypes: {
          videos: videos.length, // Use snapshot size for consistency
        },
      };
    });
  }
}
