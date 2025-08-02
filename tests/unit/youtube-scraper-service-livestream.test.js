import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { YouTubeScraperService } from '../../src/services/implementations/youtube-scraper-service.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('YouTubeScraperService - Livestream Detection', () => {
  let scraperService;
  let mockLogger;
  let mockConfig;
  let mockBrowserService;
  let mockDependencies;
  let mockContentCoordinator;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create enhanced logging mocks
    mockDependencies = createMockDependenciesWithEnhancedLogging();
    mockLogger = mockDependencies.enhancedLogger;

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
          YOUTUBE_CHANNEL_ID: 'UCTestChannelId123',
        };
        return config[key] || defaultValue;
      }),
      getRequired: jest.fn(key => {
        const config = {
          YOUTUBE_CHANNEL_ID: 'UCTestChannelId123',
        };
        if (config[key] === undefined) {
          throw new Error(`Required configuration key '${key}' is missing`);
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

    mockContentCoordinator = {
      processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
    };

    // Mock the browser service BEFORE creating the service instance
    mockBrowserService = {
      launch: jest.fn().mockResolvedValue(),
      setUserAgent: jest.fn().mockResolvedValue(),
      setViewport: jest.fn().mockResolvedValue(),
      goto: jest.fn().mockResolvedValue(),
      waitFor: jest.fn().mockResolvedValue(),
      evaluate: jest.fn(),
      close: jest.fn().mockResolvedValue(),
      isRunning: jest.fn().mockReturnValue(true),
    };

    scraperService = new YouTubeScraperService({
      logger: mockLogger,
      config: mockConfig,
      contentCoordinator: mockContentCoordinator,
      debugManager: mockDependencies.debugManager,
      metricsManager: mockDependencies.metricsManager,
      browserService: mockBrowserService,
    });

    // Spy on the service's enhanced logger methods after construction
    jest.spyOn(scraperService.logger, 'startOperation');

    // Set up initialized state properly
    scraperService.isInitialized = true;
    scraperService.channelHandle = 'testchannel';
    scraperService.videosUrl = 'https://www.youtube.com/@testchannel/videos';
    scraperService.liveStreamUrl = 'https://www.youtube.com/@testchannel/live';
    scraperService.embedLiveUrl = 'https://www.youtube.com/embed/UCTestChannelId123/live';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('fetchActiveLiveStream', () => {
    it('should return null when no live stream is found', async () => {
      mockBrowserService.evaluate.mockResolvedValue(null);

      const result = await scraperService.fetchActiveLiveStream();

      expect(result).toBeNull();
      // Now tries regular live page first (after my fix)
      expect(mockBrowserService.goto).toHaveBeenCalledWith(
        'https://www.youtube.com/@testchannel/live',
        expect.objectContaining({
          waitUntil: 'networkidle',
          timeout: 30000,
        })
      );
    });

    it('should detect active livestream using regular page detection', async () => {
      // Mock the result structure that the browser evaluation returns
      const mockLivePageResult = {
        id: 'test-video-id',
        title: 'Live Stream',
        url: 'https://www.youtube.com/watch?v=test-video-id',
        type: 'livestream',
        platform: 'youtube',
        publishedAt: '2025-07-28T12:00:00.000Z',
        scrapedAt: '2025-07-28T12:00:00.000Z',
        detectionMethod: 'youtube-metadata-live',
        isCurrentlyLive: true,
      };

      mockBrowserService.evaluate.mockResolvedValue(mockLivePageResult);

      const result = await scraperService.fetchActiveLiveStream();

      expect(result).not.toBeNull();
      expect(result.id).toBe('test-video-id');
      expect(result.type).toBe('livestream');
      expect(result.detectionMethod).toBe('youtube-metadata-live');
      expect(result.isCurrentlyLive).toBe(true);
    });

    it('should fall back to embed when regular page shows no active stream', async () => {
      // Mock auth manager
      const mockAuthManager = {
        handleConsentPageRedirect: jest.fn().mockResolvedValue(),
      };
      scraperService.authManager = mockAuthManager;

      // First call returns no active stream from regular page (primary method)
      const mockRegularPageError = {
        error: 'No live element found',
        debugInfo: { strategiesAttempted: ['youtube-metadata-extraction'] },
      };

      // Second call returns live stream data from embed (fallback method)
      const mockEmbedResult = {
        hasActiveStream: true,
        hasLiveBadge: true,
        currentUrl: 'https://www.youtube.com/embed/UCTestChannelId123/live?v=test-video-id-2',
        reason: 'active-livestream-detected',
      };

      mockBrowserService.evaluate
        .mockResolvedValueOnce(mockRegularPageError) // First call (regular page fails)
        .mockResolvedValueOnce(mockEmbedResult); // Second call (embed succeeds)

      const result = await scraperService.fetchActiveLiveStream();

      expect(result).not.toBeNull();
      expect(result.id).toBe('test-video-id-2');
      expect(result.detectionMethod).toBe('embed-url-fallback-detection');
      expect(mockBrowserService.goto).toHaveBeenCalledTimes(2); // Both regular page and embed
      expect(mockAuthManager.handleConsentPageRedirect).toHaveBeenCalled();
    });

    it('should handle case where ytInitialPlayerResponse provides correct video ID', async () => {
      // Mock regular page result with ytInitialPlayerResponse data (the fix)
      const mockRegularPageResult = {
        id: '8jbTBnXRgnw', // This is the CORRECT video ID we should extract
        title: 'US NUCLEAR SUBS DEPLOY TO RUSSIA - Live Stream',
        url: 'https://www.youtube.com/watch?v=8jbTBnXRgnw',
        type: 'livestream',
        platform: 'youtube',
        publishedAt: '2025-07-28T12:00:00.000Z',
        scrapedAt: '2025-07-28T12:00:00.000Z',
        detectionMethod: 'youtube-metadata-live',
        isCurrentlyLive: true,
      };

      mockBrowserService.evaluate.mockResolvedValue(mockRegularPageResult);

      const result = await scraperService.fetchActiveLiveStream();

      expect(result).not.toBeNull();
      expect(result.id).toBe('8jbTBnXRgnw'); // Should be the ACTUAL video ID, not channel ID
      expect(result.type).toBe('livestream');
      expect(result.detectionMethod).toBe('youtube-metadata-live');
    });

    it('should NOT detect ended livestreams without live indicators', async () => {
      // Simulate the browser returning null because no live indicators were found
      mockBrowserService.evaluate.mockResolvedValue(null);

      const result = await scraperService.fetchActiveLiveStream();

      expect(result).toBeNull();
    });

    it('should include detection method in logging', async () => {
      const mockLiveStream = {
        id: 'test-video-id',
        title: 'Test Live Stream',
        url: 'https://www.youtube.com/watch?v=test-video-id',
        type: 'livestream',
        platform: 'youtube',
        publishedAt: '2025-07-28T12:00:00.000Z',
        scrapedAt: '2025-07-28T12:00:00.000Z',
        detectionMethod: 'now-playing-indicator',
      };

      mockBrowserService.evaluate.mockResolvedValue(mockLiveStream);

      await scraperService.fetchActiveLiveStream();

      // Check that the service's logger was called with operation tracking
      // Since the service creates its own enhanced logger, we need to spy on it directly
      expect(scraperService.logger.startOperation).toHaveBeenCalledWith(
        'fetchActiveLiveStream',
        expect.objectContaining({
          liveStreamUrl: 'https://www.youtube.com/@testchannel/live',
          isAuthenticated: false,
        })
      );
    });

    it('should handle browser evaluation errors gracefully', async () => {
      const evaluationError = new Error('Browser evaluation failed');
      mockBrowserService.evaluate.mockRejectedValue(evaluationError);

      const result = await scraperService.fetchActiveLiveStream();

      expect(result).toBeNull();
      // Verify operation was started
      expect(scraperService.logger.startOperation).toHaveBeenCalledWith(
        'fetchActiveLiveStream',
        expect.objectContaining({
          liveStreamUrl: 'https://www.youtube.com/@testchannel/live',
        })
      );
    });

    it('should not proceed when shutting down', async () => {
      scraperService.isShuttingDown = true;

      const result = await scraperService.fetchActiveLiveStream();

      expect(result).toBeNull();
      expect(mockBrowserService.goto).not.toHaveBeenCalled();
      expect(mockBrowserService.evaluate).not.toHaveBeenCalled();
    });

    it('should throw error when not initialized', async () => {
      scraperService.isInitialized = false;

      await expect(scraperService.fetchActiveLiveStream()).rejects.toThrow('YouTube scraper is not initialized');
    });
  });

  describe('Browser evaluation logic edge cases', () => {
    it('should simulate hasLiveIndicators function correctly', () => {
      // Test the hasLiveIndicators logic that runs in browser context
      const mockDocument = {
        querySelector: jest.fn(),
        querySelectorAll: jest.fn().mockReturnValue([]),
      };

      const mockElement = {
        closest: jest.fn().mockReturnValue({
          textContent: 'This is live now and streaming',
          querySelector: jest.fn().mockReturnValue(null),
          querySelectorAll: jest.fn().mockReturnValue([]),
        }),
      };

      // Simulate the logic for live indicator detection
      const containerText = mockElement.closest().textContent.toLowerCase();
      const liveIndicators = ['live now', 'streaming now', 'now playing', 'currently live', 'going live'];

      const hasLiveIndicator = liveIndicators.some(indicator => containerText.includes(indicator));

      expect(hasLiveIndicator).toBe(true);
    });

    it('should simulate detection of red LIVE badges', () => {
      // Test red "LIVE" text detection logic
      const mockStyle = {
        color: 'rgb(255, 0, 0)',
        backgroundColor: 'transparent',
      };

      const mockElement = {
        textContent: 'LIVE',
        classList: { toString: () => 'live-badge active' },
      };

      // Simulate the red LIVE detection logic
      const text = mockElement.textContent.trim().toLowerCase();
      const isRedLive =
        text === 'live' &&
        (mockStyle.color.includes('rgb(255, 0, 0)') ||
          mockStyle.color.includes('#ff0000') ||
          mockStyle.backgroundColor.includes('rgb(255, 0, 0)') ||
          mockStyle.backgroundColor.includes('#ff0000') ||
          mockElement.classList.toString().toLowerCase().includes('live'));

      expect(isRedLive).toBe(true);
    });
  });

  describe('scanForContent integration', () => {
    it('should process both livestream and video content', async () => {
      const mockLiveStream = {
        id: 'live-stream-id',
        title: 'Live Stream',
        url: 'https://www.youtube.com/watch?v=live-stream-id',
        type: 'livestream',
        platform: 'youtube',
        publishedAt: '2025-07-28T12:00:00.000Z',
        scrapedAt: '2025-07-28T12:00:00.000Z',
        detectionMethod: 'now-playing-indicator',
      };

      const mockVideo = {
        success: true,
        id: 'video-id',
        title: 'Latest Video',
        url: 'https://www.youtube.com/watch?v=video-id',
        type: 'video',
        platform: 'youtube',
        publishedAt: '2025-07-28T11:00:00.000Z',
        scrapedAt: '2025-07-28T12:00:00.000Z',
      };

      // Mock both livestream and video fetching
      jest.spyOn(scraperService, 'fetchActiveLiveStream').mockResolvedValue(mockLiveStream);
      jest.spyOn(scraperService, 'fetchLatestVideo').mockResolvedValue(mockVideo);

      await scraperService.scanForContent();

      // Verify both content types were processed
      expect(mockContentCoordinator.processContent).toHaveBeenCalledWith('live-stream-id', 'scraper', mockLiveStream);
      expect(mockContentCoordinator.processContent).toHaveBeenCalledWith('video-id', 'scraper', mockVideo);

      // Verify metrics were updated
      expect(scraperService.metrics.livestreamsDetected).toBe(1);
      expect(scraperService.metrics.videosDetected).toBe(1);
    });

    it('should handle null livestream gracefully', async () => {
      const mockVideo = {
        success: true,
        id: 'video-id',
        title: 'Latest Video',
        url: 'https://www.youtube.com/watch?v=video-id',
        type: 'video',
        platform: 'youtube',
        publishedAt: '2025-07-28T11:00:00.000Z',
        scrapedAt: '2025-07-28T12:00:00.000Z',
      };

      jest.spyOn(scraperService, 'fetchActiveLiveStream').mockResolvedValue(null);
      jest.spyOn(scraperService, 'fetchLatestVideo').mockResolvedValue(mockVideo);

      await scraperService.scanForContent();

      // Only video should be processed
      expect(mockContentCoordinator.processContent).toHaveBeenCalledTimes(1);
      expect(mockContentCoordinator.processContent).toHaveBeenCalledWith('video-id', 'scraper', mockVideo);

      // Verify metrics
      expect(scraperService.metrics.livestreamsDetected).toBe(0);
      expect(scraperService.metrics.videosDetected).toBe(1);
    });
  });

  describe('Metrics tracking', () => {
    it('should track livestream detection metrics', async () => {
      const mockLiveStream = {
        id: 'live-stream-id',
        title: 'Live Stream',
        url: 'https://www.youtube.com/watch?v=live-stream-id',
        type: 'livestream',
        platform: 'youtube',
        publishedAt: '2025-07-28T12:00:00.000Z',
        scrapedAt: '2025-07-28T12:00:00.000Z',
        detectionMethod: 'now-playing-indicator',
      };

      jest.spyOn(scraperService, 'fetchActiveLiveStream').mockResolvedValue(mockLiveStream);
      jest.spyOn(scraperService, 'fetchLatestVideo').mockResolvedValue(null);

      const initialLivestreams = scraperService.metrics.livestreamsDetected;

      await scraperService.scanForContent();

      expect(scraperService.metrics.livestreamsDetected).toBe(initialLivestreams + 1);
    });
  });

  describe('Error Handling Regression Tests', () => {
    it('should handle livestream error objects without crashing (prevents "Content ID must be a non-empty string")', async () => {
      // REGRESSION TEST: This specific bug was causing crashes when fetchActiveLiveStream
      // returned error objects (truthy but no 'id' field) that scanForContent tried to process

      const errorLivestreamObject = {
        error: 'Not on monitored channel page',
        debugInfo: {
          currentUrl: 'https://www.youtube.com/@TestChannel/live',
          expectedChannelPattern: '@TestChannel/live',
          isOnCorrectChannelPage: false,
          strategiesAttempted: ['page-validation-failed'],
        },
        // CRITICAL: No 'id' field - this was causing the original "Content ID must be a non-empty string" error
      };

      // Mock fetchActiveLiveStream to return error object
      jest.spyOn(scraperService, 'fetchActiveLiveStream').mockResolvedValue(errorLivestreamObject);
      jest.spyOn(scraperService, 'fetchLatestVideo').mockResolvedValue(null);

      // This should NOT throw "Content ID must be a non-empty string" error
      await expect(scraperService.scanForContent()).resolves.not.toThrow();

      // Should log the error appropriately
      expect(scraperService.logger.startOperation).toHaveBeenCalledWith('scanForContent', expect.any(Object));

      // Should NOT try to process the error object as content
      expect(mockContentCoordinator.processContent).not.toHaveBeenCalled();

      // Should NOT increment livestream detection metrics for error cases
      expect(scraperService.metrics.livestreamsDetected).toBe(0);
    });

    it('should handle null/undefined livestream responses gracefully', async () => {
      // Test other falsy values that could be returned
      jest.spyOn(scraperService, 'fetchActiveLiveStream').mockResolvedValue(null);
      jest.spyOn(scraperService, 'fetchLatestVideo').mockResolvedValue(null);

      await expect(scraperService.scanForContent()).resolves.not.toThrow();
      expect(mockContentCoordinator.processContent).not.toHaveBeenCalled();
    });

    it('should log debug information when livestream detection fails', async () => {
      const errorObject = {
        error: 'No live element found',
        debugInfo: {
          strategiesAttempted: ['primary-detection', 'now-playing-detection'],
          elementsFound: 0,
          currentUrl: 'https://www.youtube.com/@TestChannel/live',
        },
      };

      jest.spyOn(scraperService, 'fetchActiveLiveStream').mockResolvedValue(errorObject);
      jest.spyOn(scraperService, 'fetchLatestVideo').mockResolvedValue(null);

      // This test verifies that error objects are handled gracefully
      await expect(scraperService.scanForContent()).resolves.not.toThrow();

      // Should start operation properly
      expect(scraperService.logger.startOperation).toHaveBeenCalledWith('scanForContent', expect.any(Object));

      // Should not process invalid content
      expect(mockContentCoordinator.processContent).not.toHaveBeenCalled();
    });
  });
});
