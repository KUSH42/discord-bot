import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { YouTubeScraperService } from '../../src/services/implementations/youtube-scraper-service.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('YouTubeScraperService', () => {
  let scraperService;
  let mockLogger;
  let mockConfig;
  let mockBrowserService;
  let mockDependencies;
  let mockContentCoordinator;
  let mockYouTubeAuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Reset scraperService to ensure fresh instance
    scraperService = null;

    // Create enhanced logging mocks
    mockDependencies = createMockDependenciesWithEnhancedLogging();
    mockLogger = mockDependencies.logger;

    mockConfig = {
      get: jest.fn((key, defaultValue) => {
        const config = {
          YOUTUBE_SCRAPER_INTERVAL_MIN: '300000',
          YOUTUBE_SCRAPER_INTERVAL_MAX: '600000',
          YOUTUBE_SCRAPER_MAX_RETRIES: 3,
          YOUTUBE_SCRAPER_RETRY_DELAY_MS: 5000,
          YOUTUBE_SCRAPER_TIMEOUT_MS: 30000,
          YOUTUBE_AUTHENTICATION_ENABLED: 'false',
          YOUTUBE_USERNAME: '',
          YOUTUBE_PASSWORD: '',
          YOUTUBE_CHANNEL_ID: 'UC_test_channel_id',
        };
        return config[key] || defaultValue;
      }),
      getRequired: jest.fn(key => {
        const config = {
          YOUTUBE_CHANNEL_ID: 'UC_test_channel_id',
        };
        if (config[key] === undefined) {
          throw new Error(`Required configuration key '${key}' is not set`);
        }
        return config[key];
      }),
      getBoolean: jest.fn((key, defaultValue) => {
        const config = {
          YOUTUBE_AUTHENTICATION_ENABLED: false,
        };
        return config[key] !== undefined ? config[key] : defaultValue;
      }),
    };

    // Mock content coordinator
    mockContentCoordinator = {
      processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
    };

    // Mock YouTube auth manager
    mockYouTubeAuthManager = {
      handleConsentPageRedirect: jest.fn().mockResolvedValue(),
      authenticateWithYouTube: jest.fn().mockResolvedValue(),
      isAuthenticated: false,
    };

    // Create the browser service mock first
    mockBrowserService = {
      launch: jest.fn().mockResolvedValue(),
      setUserAgent: jest.fn().mockResolvedValue(),
      setViewport: jest.fn().mockResolvedValue(),
      goto: jest.fn().mockResolvedValue(),
      waitFor: jest.fn().mockResolvedValue(),
      evaluate: jest.fn(),
      waitForSelector: jest.fn().mockResolvedValue(),
      type: jest.fn().mockResolvedValue(),
      click: jest.fn().mockResolvedValue(),
      setCookies: jest.fn().mockResolvedValue(),
      close: jest.fn().mockResolvedValue(),
      isRunning: jest.fn(() => true),
    };

    scraperService = new YouTubeScraperService({
      logger: mockLogger,
      config: mockConfig,
      contentCoordinator: mockContentCoordinator,
      debugManager: mockDependencies.debugManager,
      metricsManager: mockDependencies.metricsManager,
      youtubeAuthManager: mockYouTubeAuthManager,
      browserService: mockBrowserService,
    });
  });

  afterEach(async () => {
    // Ensure service is properly cleaned up and timers are cleared
    if (scraperService) {
      // Force stop monitoring first
      if (scraperService.isRunning) {
        await scraperService.stopMonitoring();
      }
      await scraperService.cleanup();
    }
    // Clear any remaining timers
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Initialization', () => {
    it('should initialize successfully with valid channel handle', async () => {
      // For now, let's test the simpler case - initialization without finding videos
      // This tests the core initialization logic without complex mock sequences
      mockBrowserService.evaluate.mockResolvedValue({ success: false, strategies: ['modern-grid'] });

      await scraperService.initialize('testchannel');

      expect(scraperService.isInitialized).toBe(true);
      expect(scraperService.videosUrl).toBe('https://www.youtube.com/@testchannel/videos');
      expect(scraperService.liveStreamUrl).toBe('https://www.youtube.com/@testchannel/live');
      expect(scraperService.embedLiveUrl).toBe('https://www.youtube.com/embed/UC_test_channel_id/live');
      expect(mockBrowserService.launch).toHaveBeenCalledWith({
        headless: true,
        args: expect.arrayContaining([
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-images',
          '--disable-plugins',
          '--mute-audio',
        ]),
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'YouTube scraper initialized but no videos found',
        expect.objectContaining({
          videosUrl: 'https://www.youtube.com/@testchannel/videos',
          authEnabled: false,
          channelHandle: 'testchannel',
        })
      );
    });

    it('should handle initialization when no videos are found', async () => {
      mockBrowserService.evaluate.mockResolvedValue({ success: false, strategies: ['modern-grid'] });

      await scraperService.initialize('emptychannel');

      expect(scraperService.isInitialized).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'YouTube scraper initialized but no videos found',
        expect.objectContaining({
          videosUrl: 'https://www.youtube.com/@emptychannel/videos',
          module: 'youtube',
          outcome: 'success',
        })
      );
    });

    it('should throw error if already initialized', async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        success: true,
        id: 'test123',
        title: 'Test',
        url: 'https://www.youtube.com/watch?v=test123',
      });

      await scraperService.initialize('testchannel');

      await expect(scraperService.initialize('anotherchannel')).rejects.toThrow(
        'YouTube scraper is already initialized'
      );
    });

    it('should handle browser launch failures', async () => {
      const launchError = new Error('Failed to launch browser');
      mockBrowserService.launch.mockRejectedValue(launchError);

      await expect(scraperService.initialize('testchannel')).rejects.toThrow('Failed to launch browser');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to initialize YouTube scraper',
        expect.objectContaining({
          error: 'Failed to launch browser',
          stack: expect.any(String),
          channelHandle: 'testchannel',
          module: 'youtube',
          outcome: 'error',
        })
      );
    });
  });

  describe('Video Fetching', () => {
    beforeEach(async () => {
      // Ensure evaluate resolves with a valid video object for initialization
      mockBrowserService.evaluate.mockResolvedValue({
        success: true,
        id: 'initial123',
        title: 'Initial Video',
        url: 'https://www.youtube.com/watch?v=initial123',
      });
      await scraperService.initialize('testchannel');
      jest.clearAllMocks();

      // Reset metrics after initialization for clean test state
      scraperService.metrics.totalScrapingAttempts = 0;
      scraperService.metrics.successfulScrapes = 0;
      scraperService.metrics.failedScrapes = 0;
    });

    it('should fetch latest video successfully', async () => {
      const mockVideo = {
        success: true,
        id: 'latest456',
        title: 'Latest Video',
      };

      // Set up mocks for fetchLatestVideo call only (service is already initialized)
      mockBrowserService.evaluate
        .mockResolvedValueOnce({
          title: 'Test Channel',
          url: 'https://www.youtube.com/@testchannel/videos',
          ytdRichGridMedia: 1,
          ytdRichItemRenderer: 0,
          videoTitleById: 1,
          videoTitleLinkById: 1,
          genericVideoLinks: 1,
          shortsLinks: 0,
        }) // Debug info call during fetchLatestVideo
        .mockResolvedValueOnce(mockVideo); // Video extraction call during fetchLatestVideo

      const result = await scraperService.fetchLatestVideo();
      expect(result).not.toBeNull();
      expect(result.id).toBe(mockVideo.id);
      expect(scraperService.metrics.successfulScrapes).toBe(1); // One during fetchLatestVideo only
    });

    it('should handle scraping failures gracefully', async () => {
      const scrapingError = new Error('Page timeout');
      mockBrowserService.goto.mockRejectedValue(scrapingError);

      const result = await scraperService.fetchLatestVideo();

      expect(result).toBeNull();
      expect(scraperService.metrics.failedScrapes).toBe(1);
      expect(scraperService.metrics.lastError).toEqual({
        message: 'Page timeout',
        timestamp: expect.any(Date),
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to scrape YouTube channel',
        expect.objectContaining({
          error: 'Page timeout',
          videosUrl: 'https://www.youtube.com/@testchannel/videos',
          attempt: 1,
          module: 'youtube',
          outcome: 'error',
        })
      );
    });

    it('should throw error if not initialized', async () => {
      const mockContentCoordinator = {
        processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
      };
      const uninitializedScraper = new YouTubeScraperService({
        logger: mockLogger,
        config: mockConfig,
        contentCoordinator: mockContentCoordinator,
      });

      await expect(uninitializedScraper.fetchLatestVideo()).rejects.toThrow('YouTube scraper is not initialized');
    });
  });

  describe('Live Stream Fetching', () => {
    beforeEach(async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'initial123',
        title: 'Initial Video',
        url: 'https://www.youtube.com/watch?v=initial123',
      });
      await scraperService.initialize('testchannel');
      jest.clearAllMocks();
    });

    it('should fetch active live stream successfully', async () => {
      const mockLiveStream = {
        id: 'live123',
        title: '🔴 Now Live!',
        url: 'https://www.youtube.com/watch?v=live123',
        type: 'livestream',
        scrapedAt: expect.any(String),
      };
      mockBrowserService.evaluate.mockResolvedValue(mockLiveStream);

      const result = await scraperService.fetchActiveLiveStream();

      expect(result).toEqual(mockLiveStream);
      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://www.youtube.com/@testchannel/live', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      // The service logs progress steps but doesn't log final success for live stream fetch
    });

    it('should return null when no live stream is active', async () => {
      mockBrowserService.evaluate.mockResolvedValue(null);
      const result = await scraperService.fetchActiveLiveStream();
      expect(result).toBeNull();
    });

    it('should handle errors during live stream fetching', async () => {
      mockBrowserService.goto.mockRejectedValue(new Error('Live page error'));
      const result = await scraperService.fetchActiveLiveStream();
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to scrape for active live stream',
        expect.objectContaining({
          error: 'Live page error',
          liveStreamUrl: 'https://www.youtube.com/@testchannel/live',
          module: 'youtube',
          outcome: 'error',
        })
      );
    });
  });

  describe('Continuous Monitoring', () => {
    beforeEach(async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'initial123',
        title: 'Initial Video',
        url: 'https://www.youtube.com/watch?v=initial123',
      });
      await scraperService.initialize('testchannel');
      jest.clearAllMocks();

      // Reset metrics after initialization for clean test state
      scraperService.metrics.totalScrapingAttempts = 0;
      scraperService.metrics.successfulScrapes = 0;
      scraperService.metrics.failedScrapes = 0;
    });

    it('should start monitoring and set up periodic checks', async () => {
      // Mock _getNextInterval to return predictable values for testing
      const testInterval = 1000;
      jest.spyOn(scraperService, '_getNextInterval').mockReturnValue(testInterval);

      // Service is already initialized by beforeEach
      await scraperService.startMonitoring();

      expect(scraperService.isRunning).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Starting YouTube scraper monitoring',
        expect.objectContaining({
          nextCheckInMs: testInterval,
        })
      );

      // Stop monitoring to clean up
      await scraperService.stopMonitoring();
    });

    it('should stop monitoring when requested', async () => {
      await scraperService.startMonitoring();
      expect(scraperService.isRunning).toBe(true);

      await scraperService.stopMonitoring();

      expect(scraperService.isRunning).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'YouTube scraper monitoring stopped',
        expect.objectContaining({
          module: 'youtube',
        })
      );
    });

    it('should handle errors in monitoring loop gracefully', async () => {
      mockBrowserService.goto.mockRejectedValue(new Error('Monitoring error'));

      // CRITICAL: Mock _getNextInterval to return predictable values for testing
      const testInterval = 1000; // Use 1 second for fast tests
      jest.spyOn(scraperService, '_getNextInterval').mockReturnValue(testInterval);

      await scraperService.startMonitoring();

      // Advance timer to trigger monitoring loop with predictable interval
      await jest.advanceTimersByTimeAsync(testInterval + 100);

      // The error occurs in the individual fetch methods, not the monitoring loop itself
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to scrape'), expect.any(Object));
      expect(scraperService.isRunning).toBe(true); // Should continue running despite error

      // Explicitly stop monitoring to prevent hanging
      await scraperService.stopMonitoring();
    });

    it('should warn if monitoring is already running', async () => {
      await scraperService.startMonitoring();

      await scraperService.startMonitoring();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'YouTube scraper monitoring is already running',
        expect.objectContaining({
          module: 'youtube',
        })
      );

      // Explicitly stop monitoring to prevent hanging
      await scraperService.stopMonitoring();
    });

    it('should throw error if not initialized', async () => {
      const mockContentCoordinator = {
        processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
      };
      const uninitializedScraper = new YouTubeScraperService({
        logger: mockLogger,
        config: mockConfig,
        contentCoordinator: mockContentCoordinator,
      });

      await expect(uninitializedScraper.startMonitoring()).rejects.toThrow('YouTube scraper is not initialized');
    });
  });

  describe('Metrics and Health', () => {
    beforeEach(async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'initial123',
        title: 'Initial Video',
        url: 'https://www.youtube.com/watch?v=initial123',
      });
      await scraperService.initialize('testchannel');
      jest.clearAllMocks();

      // Don't reset metrics here as this section tests the metrics functionality
    });

    it('should return accurate metrics', async () => {
      // Reset metrics to a known state before the test
      scraperService.metrics = {
        totalScrapingAttempts: 0,
        successfulScrapes: 0,
        failedScrapes: 0,
        lastSuccessfulScrape: null,
        lastError: null,
      };

      // Mock a successful fetch
      mockBrowserService.evaluate.mockReset();
      mockBrowserService.evaluate.mockResolvedValue({
        success: true,
        id: 'test456',
        title: 'Test Video',
      });
      await scraperService.fetchLatestVideo(); // Success

      // Mock a failed fetch
      mockBrowserService.goto.mockRejectedValue(new Error('Network error'));
      await scraperService.fetchLatestVideo(); // Failure

      const metrics = scraperService.getMetrics();
      expect(metrics.successfulScrapes).toBe(1);
      expect(metrics.failedScrapes).toBe(1);
    });

    it('should perform health check successfully', async () => {
      const mockVideo = {
        success: true,
        id: 'health123',
        title: 'Health Check Video',
        url: 'https://www.youtube.com/watch?v=health123',
      };

      mockBrowserService.evaluate.mockResolvedValue(mockVideo);

      const health = await scraperService.healthCheck();

      expect(health.status).toBe('healthy');
      expect(health.details.lastContentId).toBe('health123');
      expect(health.details.lastContentTitle).toBe('Health Check Video');
      expect(health.details.metrics).toBeDefined();
    });

    it('should detect unhealthy state when not initialized', async () => {
      const mockContentCoordinator = {
        processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
      };
      const uninitializedScraper = new YouTubeScraperService({
        logger: mockLogger,
        config: mockConfig,
        contentCoordinator: mockContentCoordinator,
      });

      const health = await uninitializedScraper.healthCheck();

      expect(health.status).toBe('not_initialized');
      expect(health.details.error).toBe('Scraper is not initialized');
    });

    it('should detect unhealthy state when browser is not running', async () => {
      mockBrowserService.isRunning.mockReturnValue(false);

      const health = await scraperService.healthCheck();

      expect(health.status).toBe('browser_not_running');
      expect(health.details.error).toBe('Browser service is not running');
    });

    it('should handle health check errors', async () => {
      mockBrowserService.goto.mockRejectedValue(new Error('Health check failed'));

      const health = await scraperService.healthCheck();

      expect(health.status).toBe('no_videos_found');
      expect(health.details.warning).toBe('No videos found during health check');
    });
  });

  describe('Utility Methods', () => {
    beforeEach(async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'initial123',
        title: 'Initial Video',
        url: 'https://www.youtube.com/watch?v=initial123',
      });
      await scraperService.initialize('testchannel');
      jest.clearAllMocks();
    });

    it('should cleanup resources properly', async () => {
      await scraperService.startMonitoring();
      expect(scraperService.isRunning).toBe(true);

      await scraperService.cleanup();

      expect(scraperService.isRunning).toBe(false);
      expect(scraperService.isInitialized).toBe(false);
      expect(scraperService.videosUrl).toBeNull();
      expect(scraperService.liveStreamUrl).toBeNull();
      expect(mockBrowserService.close).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cleaning up YouTube scraper service',
        expect.objectContaining({
          module: 'youtube',
        })
      );
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle configuration with custom values', () => {
      const customConfig = {
        get: jest.fn((key, defaultValue) => {
          const config = {
            YOUTUBE_SCRAPER_INTERVAL_MIN: '10000',
            YOUTUBE_SCRAPER_INTERVAL_MAX: '20000',
            YOUTUBE_SCRAPER_MAX_RETRIES: 5,
            YOUTUBE_SCRAPER_RETRY_DELAY_MS: 3000,
            YOUTUBE_SCRAPER_TIMEOUT_MS: 60000,
          };
          return config[key] || defaultValue;
        }),
        getBoolean: jest.fn(() => false),
      };

      const mockContentCoordinator = {
        processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
      };
      const customScraper = new YouTubeScraperService({
        logger: mockLogger,
        config: customConfig,
        contentCoordinator: mockContentCoordinator,
      });

      expect(customScraper.minInterval).toBe(10000);
      expect(customScraper.maxInterval).toBe(20000);
      expect(customScraper.maxRetries).toBe(5);
      expect(customScraper.retryDelayMs).toBe(3000);
      expect(customScraper.timeoutMs).toBe(60000);
    });

    it('should handle monitoring without errors when content coordinator processes content', async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'initial123',
        title: 'Initial Video',
        url: 'https://www.youtube.com/watch?v=initial123',
      });
      await scraperService.initialize('testchannel');

      // CRITICAL: Mock _getNextInterval to return predictable values for testing
      const testInterval = 1000; // Use 1 second for fast tests
      jest.spyOn(scraperService, '_getNextInterval').mockReturnValue(testInterval);

      // Should not throw error during monitoring
      await expect(scraperService.startMonitoring()).resolves.not.toThrow();

      // Advance timer to trigger monitoring loop
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'new123',
        title: 'New Video',
        url: 'https://www.youtube.com/watch?v=new123',
      });

      await jest.advanceTimersByTimeAsync(testInterval + 100);

      // Should continue running without errors
      expect(scraperService.isRunning).toBe(true);

      // Explicitly stop monitoring to prevent hanging
      await scraperService.stopMonitoring();
    });
  });

  describe('Authentication Integration', () => {
    let authenticatedService;
    let mockAuthManager;
    let mockContentCoordinator;

    beforeEach(() => {
      // Create service with authentication enabled
      mockContentCoordinator = {
        processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
      };

      const authConfig = {
        get: jest.fn((key, defaultValue) => {
          const config = {
            YOUTUBE_SCRAPER_INTERVAL_MIN: '30000',
            YOUTUBE_SCRAPER_INTERVAL_MAX: '60000',
            YOUTUBE_SCRAPER_MAX_RETRIES: 3,
            YOUTUBE_SCRAPER_RETRY_DELAY_MS: 5000,
            YOUTUBE_SCRAPER_TIMEOUT_MS: 30000,
          };
          return config[key] || defaultValue;
        }),
        getRequired: jest.fn(key => {
          const config = {
            YOUTUBE_CHANNEL_ID: 'UC_test_channel_id',
          };
          if (config[key] === undefined) {
            throw new Error(`Required configuration key '${key}' is not set`);
          }
          return config[key];
        }),
        getBoolean: jest.fn((key, defaultValue) => {
          if (key === 'YOUTUBE_AUTHENTICATION_ENABLED') {
            return true;
          }
          return defaultValue;
        }),
      };

      mockAuthManager = {
        authenticateWithYouTube: jest.fn().mockResolvedValue(),
        isAuthenticated: false,
        handleConsentPageRedirect: jest.fn().mockResolvedValue(),
      };

      authenticatedService = new YouTubeScraperService({
        logger: mockLogger,
        config: authConfig,
        contentCoordinator: mockContentCoordinator,
        debugManager: mockDependencies.debugManager,
        metricsManager: mockDependencies.metricsManager,
        browserService: mockBrowserService,
        youtubeAuthManager: mockAuthManager,
      });
    });

    describe('Integration with Initialization', () => {
      it('should call auth manager during initialization when enabled', async () => {
        mockBrowserService.evaluate.mockResolvedValue({
          success: true,
          id: 'test123',
          title: 'Test Video',
          url: 'https://www.youtube.com/watch?v=test123',
        });

        await authenticatedService.initialize('testchannel');

        expect(mockAuthManager.authenticateWithYouTube).toHaveBeenCalled();
        expect(authenticatedService.isInitialized).toBe(true);
      });

      it('should skip authentication during initialization when disabled', async () => {
        const noAuthConfig = {
          get: jest.fn((key, defaultValue) => {
            const config = {
              YOUTUBE_SCRAPER_INTERVAL_MIN: '30000',
              YOUTUBE_SCRAPER_INTERVAL_MAX: '60000',
              YOUTUBE_SCRAPER_MAX_RETRIES: 3,
              YOUTUBE_SCRAPER_RETRY_DELAY_MS: 5000,
              YOUTUBE_SCRAPER_TIMEOUT_MS: 30000,
            };
            return config[key] || defaultValue;
          }),
          getRequired: jest.fn(key => {
            const config = {
              YOUTUBE_CHANNEL_ID: 'UC_test_channel_id',
            };
            return config[key];
          }),
          getBoolean: jest.fn((key, defaultValue) => {
            if (key === 'YOUTUBE_AUTHENTICATION_ENABLED') {
              return false;
            }
            return defaultValue;
          }),
        };

        const noAuthService = new YouTubeScraperService({
          logger: mockLogger,
          config: noAuthConfig,
          contentCoordinator: mockContentCoordinator,
          debugManager: mockDependencies.debugManager,
          metricsManager: mockDependencies.metricsManager,
          browserService: mockBrowserService,
          youtubeAuthManager: null,
        });

        mockBrowserService.evaluate.mockResolvedValue({
          success: true,
          id: 'test123',
          title: 'Test Video',
          url: 'https://www.youtube.com/watch?v=test123',
        });

        await noAuthService.initialize('testchannel');

        expect(noAuthService.isInitialized).toBe(true);
      });
    });

    describe('Health Check with Authentication', () => {
      it('should include authentication status in health check', async () => {
        mockAuthManager.isAuthenticated = true;
        mockBrowserService.evaluate.mockResolvedValue({
          success: true,
          id: 'health123',
          title: 'Health Video',
          url: 'https://www.youtube.com/watch?v=health123',
        });

        await authenticatedService.initialize();
        const health = await authenticatedService.healthCheck();

        expect(health.status).toBe('healthy');
        expect(health.details.metrics.authEnabled).toBe(true);
        expect(health.details.metrics.isAuthenticated).toBe(true);
      });

      it('should provide authentication failure hints when enabled but not authenticated', async () => {
        authenticatedService.isAuthenticated = false;
        mockBrowserService.evaluate.mockResolvedValue(null);

        await authenticatedService.initialize();
        const health = await authenticatedService.healthCheck();

        expect(health.status).toBe('no_videos_found');
        expect(health.details.possibleCause).toBe('Authentication enabled but not authenticated');
      });
    });
  });
});
