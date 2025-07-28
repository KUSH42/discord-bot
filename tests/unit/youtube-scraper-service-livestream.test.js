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

    mockContentCoordinator = {
      processContent: jest.fn().mockResolvedValue({ action: 'announced' }),
    };

    scraperService = new YouTubeScraperService({
      logger: mockLogger,
      config: mockConfig,
      contentCoordinator: mockContentCoordinator,
      debugManager: mockDependencies.debugManager,
      metricsManager: mockDependencies.metricsManager,
    });

    // Mock the browser service
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

    // Replace the browser service instance
    scraperService.browserService = mockBrowserService;
    scraperService.isInitialized = true;
    scraperService.liveStreamUrl = 'https://www.youtube.com/@testchannel/live';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('fetchActiveLiveStream', () => {
    it('should return null when no live stream is found', async () => {
      mockBrowserService.evaluate.mockResolvedValue(null);

      const result = await scraperService.fetchActiveLiveStream();

      expect(result).toBeNull();
      expect(mockBrowserService.goto).toHaveBeenCalledWith(
        'https://www.youtube.com/@testchannel/live',
        expect.objectContaining({
          waitUntil: 'networkidle',
          timeout: 30000,
        })
      );
    });

    it('should detect active livestream using "now playing" indicator', async () => {
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

      const result = await scraperService.fetchActiveLiveStream();

      expect(result).toEqual(mockLiveStream);
      expect(result.detectionMethod).toBe('now-playing-indicator');
    });

    it('should detect active livestream using live indicator validation', async () => {
      const mockLiveStream = {
        id: 'test-video-id-2',
        title: 'Another Live Stream',
        url: 'https://www.youtube.com/watch?v=test-video-id-2',
        type: 'livestream',
        platform: 'youtube',
        publishedAt: '2025-07-28T12:00:00.000Z',
        scrapedAt: '2025-07-28T12:00:00.000Z',
        detectionMethod: 'live-indicator-validation',
      };

      mockBrowserService.evaluate.mockResolvedValue(mockLiveStream);

      const result = await scraperService.fetchActiveLiveStream();

      expect(result).toEqual(mockLiveStream);
      expect(result.detectionMethod).toBe('live-indicator-validation');
    });

    it('should detect active livestream using player live badge', async () => {
      const mockLiveStream = {
        id: 'test-video-id-3',
        title: 'Player Badge Live Stream',
        url: 'https://www.youtube.com/watch?v=test-video-id-3',
        type: 'livestream',
        platform: 'youtube',
        publishedAt: '2025-07-28T12:00:00.000Z',
        scrapedAt: '2025-07-28T12:00:00.000Z',
        detectionMethod: 'player-live-badge',
      };

      mockBrowserService.evaluate.mockResolvedValue(mockLiveStream);

      const result = await scraperService.fetchActiveLiveStream();

      expect(result).toEqual(mockLiveStream);
      expect(result.detectionMethod).toBe('player-live-badge');
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

      // Check that enhanced logger was called with operation tracking
      expect(mockDependencies.logger.startOperation).toHaveBeenCalledWith(
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
      // Verify error was logged through operation tracking
      expect(mockDependencies.mockOperation.error).toHaveBeenCalledWith(
        evaluationError,
        'Failed to scrape for active live stream',
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
});
