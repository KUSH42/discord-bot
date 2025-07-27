import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { YouTubeScraperService } from '../../src/services/implementations/youtube-scraper-service.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('YouTubeScraperService', () => {
  let scraperService;
  let mockLogger;
  let mockConfig;
  let mockBrowserService;
  let mockDependencies;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

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
        };
        return config[key] || defaultValue;
      }),
      getBoolean: jest.fn((key, defaultValue) => {
        const config = {
          YOUTUBE_AUTHENTICATION_ENABLED: false,
        };
        return config[key] !== undefined ? config[key] : defaultValue;
      }),
    };

    // Mock content coordinator
    const mockContentCoordinator = {
      processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
    };

    scraperService = new YouTubeScraperService({
      logger: mockLogger,
      config: mockConfig,
      contentCoordinator: mockContentCoordinator,
      debugManager: mockDependencies.debugManager,
      metricsManager: mockDependencies.metricsManager,
    });

    // Replace the real browser service with a mock
    mockBrowserService = {
      launch: jest.fn(),
      setUserAgent: jest.fn(),
      setViewport: jest.fn(),
      goto: jest.fn(),
      waitFor: jest.fn(),
      evaluate: jest.fn(),
      waitForSelector: jest.fn(),
      type: jest.fn(),
      click: jest.fn(),
      setCookies: jest.fn(),
      close: jest.fn(),
      isRunning: jest.fn(() => true),
    };
    scraperService.browserService = mockBrowserService;
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
      const mockVideo = {
        success: true,
        id: 'dQw4w9WgXcQ',
        title: 'Test Video',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        publishedText: '1 hour ago',
      };

      // Mock the sequence of evaluate calls during initialization
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
        }) // Debug info call
        .mockResolvedValueOnce('https://www.youtube.com/@testchannel/videos') // handleConsentPageRedirect call
        .mockResolvedValueOnce(mockVideo); // Actual video extraction call

      await scraperService.initialize('testchannel');

      expect(scraperService.isInitialized).toBe(true);
      expect(scraperService.videosUrl).toBe('https://www.youtube.com/@testchannel/videos');
      expect(scraperService.liveStreamUrl).toBe('https://www.youtube.com/@testchannel/live');
      // lastKnownContentId is no longer tracked directly - content state is managed by contentCoordinator
      // expect(scraperService.lastKnownContentId).toBe('dQw4w9WgXcQ');
      expect(mockBrowserService.launch).toHaveBeenCalledWith({
        headless: false,
        args: expect.arrayContaining([
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-images',
          '--disable-plugins',
          '--mute-audio',
        ]),
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'YouTube scraper initialized successfully',
        expect.objectContaining({
          videosUrl: 'https://www.youtube.com/@testchannel/videos',
          initialContentId: 'dQw4w9WgXcQ',
          title: 'Test Video',
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

      mockBrowserService.evaluate.mockReset();
      // Mock the sequence: debug info, consent check, video extraction
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
        }) // Debug info call
        .mockResolvedValueOnce('https://www.youtube.com/@testchannel/videos') // handleConsentPageRedirect call
        .mockResolvedValueOnce(mockVideo); // Video extraction call

      const result = await scraperService.fetchLatestVideo();
      expect(result).not.toBeNull();
      expect(result.id).toBe(mockVideo.id);
      expect(scraperService.metrics.successfulScrapes).toBe(1);
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

    it('should start monitoring and detect new videos', async () => {
      const newVideo = {
        success: true,
        id: 'new789',
        title: 'New Monitored Video',
        url: 'https://www.youtube.com/watch?v=new789',
        type: 'video',
      };

      // Mock content coordinator to verify it's called
      const mockContentCoordinator = scraperService.contentCoordinator;

      // Reset evaluate mock for cleaner test
      mockBrowserService.evaluate.mockReset();

      // For scanForContent calls: fetchActiveLiveStream returns null, fetchLatestVideo returns new video
      // fetchActiveLiveStream calls evaluate once, fetchLatestVideo calls evaluate 3 times (debug, consent, extraction)
      mockBrowserService.evaluate
        .mockResolvedValueOnce(null) // fetchActiveLiveStream in first scan
        .mockResolvedValueOnce({
          title: 'Debug',
          ytdRichGridMedia: 1,
          ytdRichItemRenderer: 0,
          videoTitleById: 1,
          videoTitleLinkById: 1,
          genericVideoLinks: 1,
          shortsLinks: 0,
        }) // fetchLatestVideo debug info in first scan
        .mockResolvedValueOnce('https://www.youtube.com/@testchannel/videos') // fetchLatestVideo consent check in first scan
        .mockResolvedValueOnce(null) // fetchLatestVideo extraction in first scan (null = no new video)
        .mockResolvedValueOnce(null) // fetchActiveLiveStream in second scan
        .mockResolvedValueOnce({
          title: 'Debug',
          ytdRichGridMedia: 1,
          ytdRichItemRenderer: 0,
          videoTitleById: 1,
          videoTitleLinkById: 1,
          genericVideoLinks: 1,
          shortsLinks: 0,
        }) // fetchLatestVideo debug info in second scan
        .mockResolvedValueOnce('https://www.youtube.com/@testchannel/videos') // fetchLatestVideo consent check in second scan
        .mockResolvedValueOnce(newVideo); // fetchLatestVideo extraction in second scan finds new video

      // CRITICAL: Mock _getNextInterval to return predictable values for testing
      const testInterval = 1000; // Use 1 second for fast tests
      jest.spyOn(scraperService, '_getNextInterval').mockReturnValue(testInterval);

      await scraperService.startMonitoring();

      expect(scraperService.isRunning).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Starting YouTube scraper monitoring',
        expect.objectContaining({
          nextCheckInMs: testInterval,
          module: 'youtube',
        })
      );

      // Fast-forward time to trigger monitoring loop twice with predictable intervals
      await jest.advanceTimersByTimeAsync(testInterval + 100); // First scan (no new content)
      await jest.advanceTimersByTimeAsync(testInterval + 100); // Second scan (finds new video)

      // Verify content coordinator was called with the new video
      expect(mockContentCoordinator.processContent).toHaveBeenCalledWith(newVideo.id, 'scraper', newVideo);

      // Explicitly stop monitoring to prevent hanging
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

  describe('YouTube Authentication', () => {
    let authenticatedService;
    let authConfig;

    beforeEach(() => {
      jest.clearAllMocks();

      authConfig = {
        get: jest.fn((key, defaultValue) => {
          const config = {
            YOUTUBE_SCRAPER_INTERVAL_MIN: '30000',
            YOUTUBE_SCRAPER_INTERVAL_MAX: '60000',
            YOUTUBE_SCRAPER_MAX_RETRIES: 3,
            YOUTUBE_SCRAPER_RETRY_DELAY_MS: 5000,
            YOUTUBE_SCRAPER_TIMEOUT_MS: 30000,
            YOUTUBE_AUTHENTICATION_ENABLED: 'true',
            YOUTUBE_USERNAME: 'test@example.com',
            YOUTUBE_PASSWORD: 'testpassword',
          };
          return config[key] || defaultValue;
        }),
        getBoolean: jest.fn((key, defaultValue) => {
          const config = {
            YOUTUBE_AUTHENTICATION_ENABLED: true,
          };
          return config[key] !== undefined ? config[key] : defaultValue;
        }),
      };

      const mockContentCoordinator = {
        processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
      };
      authenticatedService = new YouTubeScraperService({
        logger: mockLogger,
        config: authConfig,
        contentCoordinator: mockContentCoordinator,
      });
      authenticatedService.browserService = mockBrowserService;
    });

    afterEach(async () => {
      if (authenticatedService) {
        await authenticatedService.cleanup();
      }
      jest.clearAllTimers();
    });

    describe('Authentication Configuration', () => {
      it('should initialize with authentication enabled', () => {
        expect(authenticatedService.authEnabled).toBe(true);
        expect(authenticatedService.youtubeUsername).toBe('test@example.com');
        expect(authenticatedService.youtubePassword).toBe('testpassword');
        expect(authenticatedService.isAuthenticated).toBe(false);
      });

      it('should disable authentication when not configured', () => {
        const noAuthConfig = {
          get: jest.fn(() => ''),
          getBoolean: jest.fn(() => false),
        };
        const mockContentCoordinator = {
          processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
        };
        const noAuthService = new YouTubeScraperService({
          logger: mockLogger,
          config: noAuthConfig,
          contentCoordinator: mockContentCoordinator,
        });
        expect(noAuthService.authEnabled).toBe(false);
      });

      it('should include auth status in metrics', () => {
        const metrics = authenticatedService.getMetrics();
        expect(metrics.authEnabled).toBe(true);
        expect(metrics.isAuthenticated).toBe(false);
        expect(metrics.configuration.authEnabled).toBe(true);
      });
    });

    describe('Main Authentication Flow', () => {
      it('should perform successful authentication', async () => {
        // Mock individual helper methods instead of complex waitForSelector chains
        jest.spyOn(authenticatedService, 'handleCookieConsent').mockResolvedValue();
        jest.spyOn(authenticatedService, 'handleAccountChallenges').mockResolvedValue(true);
        jest.spyOn(authenticatedService, 'handle2FA').mockResolvedValue(true);
        jest.spyOn(authenticatedService, 'handleCaptcha').mockResolvedValue(true);
        jest.spyOn(authenticatedService, 'handleDeviceVerification').mockResolvedValue();

        // Mock the basic browser operations
        mockBrowserService.waitForSelector.mockResolvedValue();
        mockBrowserService.evaluate.mockResolvedValueOnce(true); // Sign-in detection

        await authenticatedService.authenticateWithYouTube();

        expect(mockBrowserService.goto).toHaveBeenCalledWith(
          'https://accounts.google.com/signin/v2/identifier?service=youtube'
        );
        expect(mockBrowserService.type).toHaveBeenCalledWith('input[type="email"]', 'test@example.com');
        expect(mockBrowserService.type).toHaveBeenCalledWith('input[type="password"]', 'testpassword');
        expect(mockBrowserService.click).toHaveBeenCalledWith('#identifierNext');
        expect(mockBrowserService.click).toHaveBeenCalledWith('#passwordNext');
        expect(authenticatedService.isAuthenticated).toBe(true);
        expect(mockLogger.info).toHaveBeenCalledWith(
          '✅ Successfully authenticated with YouTube',
          expect.objectContaining({
            module: 'youtube',
          })
        );
      });

      it('should skip authentication when disabled', async () => {
        authenticatedService.authEnabled = false;

        await authenticatedService.authenticateWithYouTube();

        expect(mockBrowserService.goto).not.toHaveBeenCalled();
        expect(mockLogger.debug).toHaveBeenCalledWith(
          'YouTube authentication is disabled',
          expect.objectContaining({
            module: 'youtube',
          })
        );
      });

      it('should skip authentication when credentials missing', async () => {
        authenticatedService.youtubeUsername = '';
        authenticatedService.youtubePassword = '';

        await authenticatedService.authenticateWithYouTube();

        expect(mockBrowserService.goto).not.toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'YouTube authentication enabled but credentials not provided',
          expect.objectContaining({
            module: 'youtube',
          })
        );
      });

      it('should handle authentication failures gracefully', async () => {
        mockBrowserService.goto.mockRejectedValue(new Error('Navigation failed'));

        await authenticatedService.authenticateWithYouTube();

        expect(authenticatedService.isAuthenticated).toBe(false);
        expect(mockLogger.error).toHaveBeenCalledWith(
          '⚠️Failed to authenticate with YouTube:',
          expect.objectContaining({
            error: 'Navigation failed',
            stack: expect.any(String),
            module: 'youtube',
          })
        );
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Continuing without YouTube authentication',
          expect.objectContaining({
            module: 'youtube',
          })
        );
      });

      it('should warn when authentication may have failed', async () => {
        // Mock helper methods to succeed
        jest.spyOn(authenticatedService, 'handleCookieConsent').mockResolvedValue();
        jest.spyOn(authenticatedService, 'handleAccountChallenges').mockResolvedValue(true);
        jest.spyOn(authenticatedService, 'handle2FA').mockResolvedValue(true);
        jest.spyOn(authenticatedService, 'handleCaptcha').mockResolvedValue(true);
        jest.spyOn(authenticatedService, 'handleDeviceVerification').mockResolvedValue();

        // Mock basic operations to succeed but sign-in detection fails
        mockBrowserService.waitForSelector.mockResolvedValue();
        mockBrowserService.evaluate.mockResolvedValueOnce(false); // Sign-in detection fails

        await authenticatedService.authenticateWithYouTube();

        expect(authenticatedService.isAuthenticated).toBe(false);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          '⚠️ YouTube authentication may have failed - proceeding without authentication',
          expect.objectContaining({
            module: 'youtube',
          })
        );
      });
    });

    describe('Cookie Consent Handling', () => {
      it('should handle cookie consent successfully', async () => {
        mockBrowserService.waitForSelector.mockResolvedValueOnce(); // Cookie consent found
        mockBrowserService.click.mockResolvedValueOnce();

        await authenticatedService.handleCookieConsent();

        expect(mockBrowserService.waitForSelector).toHaveBeenCalledWith('button:has-text("Accept all")', {
          timeout: 3000,
        });
        expect(mockBrowserService.click).toHaveBeenCalled();
        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Clicked cookie consent button: button:has-text("Accept all")',
          expect.objectContaining({
            module: 'youtube',
          })
        );
      });

      it('should handle no cookie consent banner gracefully', async () => {
        mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector timeout'));

        await authenticatedService.handleCookieConsent();

        expect(mockLogger.info).toHaveBeenCalledWith(
          'No cookie consent banner found',
          expect.objectContaining({
            module: 'youtube',
          })
        );
      });

      it('should try multiple consent selectors', async () => {
        // First selector fails, second succeeds
        mockBrowserService.waitForSelector.mockRejectedValueOnce(new Error('Not found')).mockResolvedValueOnce();

        await authenticatedService.handleCookieConsent();

        expect(mockBrowserService.waitForSelector).toHaveBeenCalledTimes(2);
        expect(mockBrowserService.click).toHaveBeenCalled();
      });
    });

    describe('Account Security Challenges', () => {
      it('should detect email verification challenge', async () => {
        mockBrowserService.waitForSelector.mockResolvedValueOnce(); // Email challenge found

        const result = await authenticatedService.handleAccountChallenges();

        expect(result).toBe(false);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Email verification challenge detected - requires manual intervention',
          expect.objectContaining({
            module: 'youtube',
          })
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          'Please check your email and complete verification manually',
          expect.objectContaining({
            module: 'youtube',
          })
        );
      });

      it('should detect phone verification challenge', async () => {
        mockBrowserService.waitForSelector
          .mockRejectedValueOnce(new Error('Email not found')) // No email challenge
          .mockRejectedValueOnce(new Error('Email not found')) // No email challenge
          .mockRejectedValueOnce(new Error('Email not found')) // No email challenge
          .mockResolvedValueOnce(); // Phone challenge found

        const result = await authenticatedService.handleAccountChallenges();

        expect(result).toBe(false);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Phone verification challenge detected - requires manual intervention',
          expect.objectContaining({
            module: 'youtube',
          })
        );
      });

      it('should return true when no challenges detected', async () => {
        mockBrowserService.waitForSelector.mockRejectedValue(new Error('Not found'));

        const result = await authenticatedService.handleAccountChallenges();

        expect(result).toBe(true);
      });
    });

    describe('2FA/MFA Handling', () => {
      it('should detect 2FA challenge', async () => {
        mockBrowserService.waitForSelector.mockResolvedValueOnce(); // 2FA input found

        const result = await authenticatedService.handle2FA();

        expect(result).toBe(false);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          '2FA challenge detected - authentication cannot proceed automatically',
          expect.objectContaining({
            module: 'youtube',
          })
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          'Please disable 2FA for this account or handle authentication manually',
          expect.objectContaining({
            module: 'youtube',
          })
        );
      });

      it('should return true when no 2FA present', async () => {
        mockBrowserService.waitForSelector.mockRejectedValue(new Error('Not found'));

        const result = await authenticatedService.handle2FA();

        expect(result).toBe(true);
      });

      it('should try multiple 2FA selectors', async () => {
        mockBrowserService.waitForSelector
          .mockRejectedValueOnce(new Error('Not found'))
          .mockRejectedValueOnce(new Error('Not found'))
          .mockResolvedValueOnce(); // Third selector succeeds

        const result = await authenticatedService.handle2FA();

        expect(result).toBe(false);
        expect(mockBrowserService.waitForSelector).toHaveBeenCalledTimes(3);
      });
    });

    describe('CAPTCHA Detection', () => {
      it('should detect CAPTCHA challenge', async () => {
        mockBrowserService.waitForSelector.mockResolvedValueOnce(); // CAPTCHA found

        const result = await authenticatedService.handleCaptcha();

        expect(result).toBe(false);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'CAPTCHA challenge detected - authentication cannot proceed automatically',
          expect.objectContaining({
            module: 'youtube',
          })
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          'Manual intervention required to complete CAPTCHA verification',
          expect.objectContaining({
            module: 'youtube',
          })
        );
      });

      it('should return true when no CAPTCHA present', async () => {
        mockBrowserService.waitForSelector.mockRejectedValue(new Error('Not found'));

        const result = await authenticatedService.handleCaptcha();

        expect(result).toBe(true);
      });

      it('should detect various CAPTCHA types', async () => {
        // Test different CAPTCHA selectors
        const captchaSelectors = [
          '[data-sitekey]',
          '.g-recaptcha',
          '#recaptcha',
          '[src*="captcha"]',
          'iframe[src*="recaptcha"]',
        ];

        for (let i = 0; i < captchaSelectors.length; i++) {
          mockBrowserService.waitForSelector.mockImplementation(selector => {
            if (selector === captchaSelectors[i]) {
              return Promise.resolve();
            }
            return Promise.reject(new Error('Not found'));
          });

          const result = await authenticatedService.handleCaptcha();
          expect(result).toBe(false);
        }
      });
    });

    describe('Device Verification Handling', () => {
      it('should handle device verification prompts', async () => {
        mockBrowserService.waitForSelector.mockResolvedValueOnce();
        mockBrowserService.click.mockResolvedValueOnce();

        await authenticatedService.handleDeviceVerification();

        expect(mockBrowserService.click).toHaveBeenCalled();
        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Handled device verification: button:has-text("Not now")',
          expect.objectContaining({
            module: 'youtube',
          })
        );
      });

      it('should try multiple device verification selectors', async () => {
        mockBrowserService.waitForSelector.mockRejectedValueOnce(new Error('Not found')).mockResolvedValueOnce();

        await authenticatedService.handleDeviceVerification();

        expect(mockBrowserService.waitForSelector).toHaveBeenCalledTimes(2);
        expect(mockBrowserService.click).toHaveBeenCalled();
      });

      it('should handle when no device verification present', async () => {
        mockBrowserService.waitForSelector.mockRejectedValue(new Error('Not found'));

        // Should not throw error
        await expect(authenticatedService.handleDeviceVerification()).resolves.not.toThrow();
        expect(mockBrowserService.click).not.toHaveBeenCalled();
      });
    });

    describe('Integration with Initialization', () => {
      it('should call authentication during initialization when enabled', async () => {
        const authSpy = jest.spyOn(authenticatedService, 'authenticateWithYouTube').mockResolvedValue();
        mockBrowserService.evaluate.mockResolvedValue({
          id: 'test123',
          title: 'Test Video',
          url: 'https://www.youtube.com/watch?v=test123',
        });

        await authenticatedService.initialize('testchannel');

        expect(authSpy).toHaveBeenCalled();
        expect(authenticatedService.isInitialized).toBe(true);
      });

      it('should skip authentication during initialization when disabled', async () => {
        const mockContentCoordinator = {
          processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
        };
        const noAuthService = new YouTubeScraperService({
          logger: mockLogger,
          config: mockConfig,
          contentCoordinator: mockContentCoordinator,
        });
        noAuthService.browserService = mockBrowserService;
        const authSpy = jest.spyOn(noAuthService, 'authenticateWithYouTube');

        mockBrowserService.evaluate.mockResolvedValue({
          id: 'test123',
          title: 'Test Video',
          url: 'https://www.youtube.com/watch?v=test123',
        });

        await noAuthService.initialize('testchannel');

        expect(authSpy).not.toHaveBeenCalled();
        expect(noAuthService.isInitialized).toBe(true);
      });
    });

    describe('Health Check with Authentication', () => {
      it('should include authentication status in health check', async () => {
        authenticatedService.isAuthenticated = true;
        mockBrowserService.evaluate.mockResolvedValue({
          success: true,
          id: 'health123',
          title: 'Health Video',
          url: 'https://www.youtube.com/watch?v=health123',
        });

        await authenticatedService.initialize('testchannel');
        const health = await authenticatedService.healthCheck();

        expect(health.status).toBe('healthy');
        expect(health.details.metrics.authEnabled).toBe(true);
        expect(health.details.metrics.isAuthenticated).toBe(true);
      });

      it('should provide authentication failure hints when enabled but not authenticated', async () => {
        authenticatedService.isAuthenticated = false;
        mockBrowserService.evaluate.mockResolvedValue({ success: false, strategies: ['modern-grid'] }); // No videos found

        await authenticatedService.initialize('testchannel');
        const health = await authenticatedService.healthCheck();

        expect(health.status).toBe('no_videos_found');
        expect(health.details.possibleCause).toBe('Authentication enabled but not authenticated');
      });

      it('should log detailed error information during health check failures', async () => {
        // Initialize first
        mockBrowserService.evaluate.mockResolvedValueOnce({
          id: 'init123',
          title: 'Init Video',
        });
        await authenticatedService.initialize('testchannel');

        // Clear previous mocks and make health check goto fail with error
        jest.clearAllMocks();
        const healthError = new Error('Health check network error');
        mockBrowserService.goto.mockRejectedValue(healthError);

        const health = await authenticatedService.healthCheck();

        // The health check catches the error and returns 'no_videos_found' status
        // but logs the error details
        expect(health.status).toBe('no_videos_found');
        expect(health.details.warning).toBe('No videos found during health check');
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Failed to scrape YouTube channel',
          expect.objectContaining({
            error: 'Health check network error',
            videosUrl: 'https://www.youtube.com/@testchannel/videos',
            attempt: expect.any(Number),
            module: 'youtube',
            outcome: 'error',
          })
        );
      });
    });
  });
});
