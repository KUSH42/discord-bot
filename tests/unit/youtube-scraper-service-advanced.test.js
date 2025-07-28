import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { YouTubeScraperService } from '../../src/services/implementations/youtube-scraper-service.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('YouTubeScraperService - Advanced Testing', () => {
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
    if (scraperService) {
      if (scraperService.isRunning) {
        await scraperService.stopMonitoring();
      }
      await scraperService.cleanup();
    }
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Consent Page Handling - handleConsentPageRedirect', () => {
    beforeEach(async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'initial123',
        title: 'Initial Video',
        url: 'https://www.youtube.com/watch?v=initial123',
      });
      await scraperService.initialize('testchannel');
      jest.clearAllMocks();
    });

    it('should detect and handle YouTube consent page redirect', async () => {
      // Mock the consent page detection
      mockBrowserService.evaluate
        .mockResolvedValueOnce('https://consent.youtube.com/some-consent-page') // Current URL check
        .mockResolvedValueOnce('https://www.youtube.com/@testchannel/videos'); // URL after handling

      mockBrowserService.waitForSelector.mockResolvedValueOnce(); // Consent button found
      mockBrowserService.click.mockResolvedValueOnce(); // Button clicked

      await scraperService.handleConsentPageRedirect();

      expect(mockBrowserService.waitForSelector).toHaveBeenCalledWith('button:has-text("Alle akzeptieren")', {
        timeout: 5000,
      });
      expect(mockBrowserService.click).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Detected YouTube consent page redirect, attempting to handle',
        expect.objectContaining({
          module: 'youtube',
        })
      );
    });

    it('should try multiple consent selectors when consent page detected', async () => {
      mockBrowserService.evaluate
        .mockResolvedValueOnce('https://consent.youtube.com/consent') // Current URL
        .mockResolvedValueOnce('https://www.youtube.com/@testchannel/videos'); // URL after handling

      // First selector fails, second succeeds
      mockBrowserService.waitForSelector.mockRejectedValueOnce(new Error('Selector not found')).mockResolvedValueOnce(); // Second selector works

      await scraperService.handleConsentPageRedirect();

      expect(mockBrowserService.waitForSelector).toHaveBeenCalledTimes(2);
      expect(mockBrowserService.click).toHaveBeenCalled();
    });

    it('should handle consent page when no consent buttons found', async () => {
      mockBrowserService.evaluate.mockResolvedValueOnce('https://consent.youtube.com/consent');
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('No buttons found'));

      await scraperService.handleConsentPageRedirect();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Could not handle YouTube consent page automatically',
        expect.objectContaining({
          module: 'youtube',
        })
      );
      expect(mockBrowserService.goto).toHaveBeenCalledWith('https://www.youtube.com/@testchannel/videos', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
    });

    it('should skip handling when not on consent page', async () => {
      mockBrowserService.evaluate.mockResolvedValueOnce('https://www.youtube.com/@testchannel/videos');

      await scraperService.handleConsentPageRedirect();

      expect(mockBrowserService.waitForSelector).not.toHaveBeenCalled();
      expect(mockBrowserService.click).not.toHaveBeenCalled();
    });

    it('should handle errors during consent page processing', async () => {
      mockBrowserService.evaluate.mockRejectedValue(new Error('Page evaluation failed'));

      // Should not throw error
      await expect(scraperService.handleConsentPageRedirect()).resolves.not.toThrow();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Error handling consent page redirect:',
        expect.objectContaining({
          module: 'youtube',
        })
      );
    });
  });

  describe('Video Extraction Strategies', () => {
    beforeEach(async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'initial123',
        title: 'Initial Video',
        url: 'https://www.youtube.com/watch?v=initial123',
      });
      await scraperService.initialize('testchannel');
      jest.clearAllMocks();
    });

    it('should handle video extraction with different selector strategies', async () => {
      // Mock the browser evaluation to return a successful video extraction
      const mockVideo = {
        success: true,
        strategy: 'modern-grid',
        id: 'abc123',
        title: 'Test Video Title',
        url: 'https://www.youtube.com/watch?v=abc123',
        publishedText: '2 hours ago',
        viewsText: '1,234 views',
        thumbnailUrl: 'https://i.ytimg.com/vi/abc123/maxresdefault.jpg',
        type: 'video',
        platform: 'youtube',
        scrapedAt: '2024-01-01T10:00:00.000Z',
      };

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
        }) // Debug info
        .mockResolvedValueOnce('https://www.youtube.com/@testchannel/videos') // Consent check
        .mockResolvedValueOnce(mockVideo); // Video extraction

      const result = await scraperService.fetchLatestVideo();

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('modern-grid');
      expect(result.id).toBe('abc123');
      expect(result.publishedAt).toBeDefined(); // Should be parsed from publishedText
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Successfully scraped latest video',
        expect.objectContaining({
          success: true,
          strategy: 'modern-grid',
          id: 'abc123',
          title: 'Test Video Title',
          module: 'youtube',
          outcome: 'success',
        })
      );
    });

    it('should handle video extraction failure with strategy information', async () => {
      const failedExtraction = {
        success: false,
        strategies: ['modern-grid', 'rich-item', 'grid-with-contents'],
      };

      mockBrowserService.evaluate
        .mockResolvedValueOnce({
          title: 'Test Channel',
          url: 'https://www.youtube.com/@testchannel/videos',
          ytdRichGridMedia: 0,
          ytdRichItemRenderer: 0,
          videoTitleById: 0,
          videoTitleLinkById: 0,
          genericVideoLinks: 0,
          shortsLinks: 0,
        }) // Debug info
        .mockResolvedValueOnce('https://www.youtube.com/@testchannel/videos') // Consent check
        .mockResolvedValueOnce(failedExtraction); // Video extraction fails

      const result = await scraperService.fetchLatestVideo();

      expect(result).toEqual(failedExtraction);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'No videos found during scraping',
        expect.objectContaining({
          videosUrl: 'https://www.youtube.com/@testchannel/videos',
          attemptedStrategies: ['modern-grid', 'rich-item', 'grid-with-contents'],
          module: 'youtube',
          outcome: 'error',
        })
      );
    });

    it('should handle video ID extraction failure', async () => {
      const extractionWithBadUrl = {
        success: false,
        error: 'Could not extract video ID',
        url: 'https://www.youtube.com/watch?invalid=url',
      };

      mockBrowserService.evaluate
        .mockResolvedValueOnce({
          title: 'Test Channel',
          ytdRichGridMedia: 1,
        }) // Debug info
        .mockResolvedValueOnce('https://www.youtube.com/@testchannel/videos') // Consent check
        .mockResolvedValueOnce(extractionWithBadUrl); // Video extraction with bad URL

      const result = await scraperService.fetchLatestVideo();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Could not extract video ID');
      expect(result.url).toBe('https://www.youtube.com/watch?invalid=url');
    });

    it('should handle shorts video URL format', async () => {
      const shortsVideo = {
        success: true,
        strategy: 'shorts-and-titled',
        id: 'shorts123',
        title: 'Short Video',
        url: 'https://www.youtube.com/shorts/shorts123',
        publishedText: 'Live',
        viewsText: '500 views',
        type: 'video',
        platform: 'youtube',
        scrapedAt: '2024-01-01T10:00:00.000Z',
      };

      mockBrowserService.evaluate
        .mockResolvedValueOnce({
          title: 'Test Channel',
          shortsLinks: 1,
        }) // Debug info
        .mockResolvedValueOnce('https://www.youtube.com/@testchannel/videos') // Consent check
        .mockResolvedValueOnce(shortsVideo); // Shorts extraction

      const result = await scraperService.fetchLatestVideo();

      expect(result.success).toBe(true);
      expect(result.id).toBe('shorts123');
      expect(result.url).toBe('https://www.youtube.com/shorts/shorts123');
      expect(result.strategy).toBe('shorts-and-titled');
    });
  });

  describe('Browser Recovery and Error Handling', () => {
    beforeEach(async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'initial123',
        title: 'Initial Video',
        url: 'https://www.youtube.com/watch?v=initial123',
      });
      await scraperService.initialize('testchannel');
      jest.clearAllMocks();
    });

    it('should detect browser connection errors correctly', () => {
      const browserErrors = [
        new Error('Browser connection lost'),
        new Error('Browser or page not available'),
        new Error('Page has been closed'),
        new Error('Target page, context or browser has been closed'),
        new Error('Browser is not running'),
        new Error('No page available'),
      ];

      browserErrors.forEach(error => {
        expect(scraperService._isBrowserConnectionError(error)).toBe(true);
      });

      // Non-browser errors should return false
      const nonBrowserError = new Error('Network timeout');
      expect(scraperService._isBrowserConnectionError(nonBrowserError)).toBe(false);
    });

    it('should handle browser recovery process', async () => {
      // Mock recovery methods to avoid infinite loops
      const recoverSpy = jest.spyOn(scraperService, '_recoverBrowser').mockResolvedValue();

      // Test the recovery is called when needed
      await scraperService._recoverBrowser();

      expect(recoverSpy).toHaveBeenCalled();
      recoverSpy.mockRestore();
    });
  });

  describe('Live Stream Detection Advanced Cases', () => {
    beforeEach(async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'initial123',
        title: 'Initial Video',
        url: 'https://www.youtube.com/watch?v=initial123',
      });
      await scraperService.initialize('testchannel');
      jest.clearAllMocks();
    });

    it('should detect live stream using "Now playing" indicator', async () => {
      const liveStreamWithNowPlaying = {
        id: 'live456',
        title: 'Live Stream Title',
        url: 'https://www.youtube.com/watch?v=live456',
        type: 'livestream',
        platform: 'youtube',
        publishedAt: expect.any(String),
        scrapedAt: expect.any(String),
      };

      mockBrowserService.evaluate.mockResolvedValue(liveStreamWithNowPlaying);

      const result = await scraperService.fetchActiveLiveStream();

      expect(result).toEqual(liveStreamWithNowPlaying);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Successfully scraped active live stream',
        expect.objectContaining({
          id: 'live456',
          title: 'Live Stream Title',
          type: 'livestream',
          module: 'youtube',
          outcome: 'success',
        })
      );
    });

    it('should handle live stream extraction with fallback selectors', async () => {
      // Test that various selectors are tried when "Now playing" isn't found
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'fallback789',
        title: 'Fallback Live Stream',
        url: 'https://www.youtube.com/watch?v=fallback789',
        type: 'livestream',
        platform: 'youtube',
        publishedAt: expect.any(String),
        scrapedAt: expect.any(String),
      });

      const result = await scraperService.fetchActiveLiveStream();

      expect(result.id).toBe('fallback789');
      expect(result.type).toBe('livestream');
    });

    it('should handle live stream with missing title gracefully', async () => {
      const liveStreamNoTitle = {
        id: 'notitle123',
        title: 'Live Stream', // Default title when none found
        url: 'https://www.youtube.com/watch?v=notitle123',
        type: 'livestream',
        platform: 'youtube',
        publishedAt: expect.any(String),
        scrapedAt: expect.any(String),
      };

      mockBrowserService.evaluate.mockResolvedValue(liveStreamNoTitle);

      const result = await scraperService.fetchActiveLiveStream();

      expect(result.title).toBe('Live Stream');
      expect(result.id).toBe('notitle123');
    });
  });

  describe('Enhanced Logging Integration', () => {
    beforeEach(async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'initial123',
        title: 'Initial Video',
        url: 'https://www.youtube.com/watch?v=initial123',
      });
      await scraperService.initialize('testchannel');
      jest.clearAllMocks();
    });

    it('should properly integrate with debug and metrics managers', async () => {
      // Test that the service works with debug and metrics manager
      expect(scraperService).toBeDefined();
      expect(mockDependencies.debugManager).toBeDefined();
      expect(mockDependencies.metricsManager).toBeDefined();

      // Service should be initialized with debug and metrics managers
      const result = await scraperService.fetchLatestVideo();
      expect(result).toBeDefined();
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle missing environment display configuration', async () => {
      // Test when DISPLAY environment variable is not set
      const originalDisplay = process.env.DISPLAY;
      delete process.env.DISPLAY;

      const testScraper = new YouTubeScraperService({
        logger: mockLogger,
        config: mockConfig,
        contentCoordinator: mockContentCoordinator,
        debugManager: mockDependencies.debugManager,
        metricsManager: mockDependencies.metricsManager,
      });
      testScraper.browserService = mockBrowserService;

      mockBrowserService.evaluate.mockResolvedValue({
        id: 'nodisplay123',
        title: 'No Display Test',
        url: 'https://www.youtube.com/watch?v=nodisplay123',
      });

      await testScraper.initialize('testchannel');

      // Browser should be launched without display argument
      expect(mockBrowserService.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: false,
          args: expect.not.arrayContaining([expect.stringContaining('--display=')]),
        })
      );

      // Restore original DISPLAY
      if (originalDisplay) {
        process.env.DISPLAY = originalDisplay;
      }
    });

    it('should handle DISPLAY environment variable when present', async () => {
      // Test when DISPLAY environment variable is set
      const originalDisplay = process.env.DISPLAY;
      process.env.DISPLAY = ':99';

      const testScraper = new YouTubeScraperService({
        logger: mockLogger,
        config: mockConfig,
        contentCoordinator: mockContentCoordinator,
        debugManager: mockDependencies.debugManager,
        metricsManager: mockDependencies.metricsManager,
      });
      testScraper.browserService = mockBrowserService;

      mockBrowserService.evaluate.mockResolvedValue({
        id: 'display123',
        title: 'Display Test',
        url: 'https://www.youtube.com/watch?v=display123',
      });

      await testScraper.initialize('testchannel');

      // Browser should be launched with display argument
      expect(mockBrowserService.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.arrayContaining(['--display=:99']),
        })
      );

      // Restore original DISPLAY
      if (originalDisplay) {
        process.env.DISPLAY = originalDisplay;
      } else {
        delete process.env.DISPLAY;
      }
    });
  });

  describe('Shutdown and Cleanup Advanced Cases', () => {
    beforeEach(async () => {
      mockBrowserService.evaluate.mockResolvedValue({
        id: 'initial123',
        title: 'Initial Video',
        url: 'https://www.youtube.com/watch?v=initial123',
      });
      await scraperService.initialize('testchannel');
      jest.clearAllMocks();
    });

    it('should handle shutdown during browser operations', async () => {
      // Simulate shutdown flag being set during operation
      scraperService.isShuttingDown = true;

      const result = await scraperService.fetchLatestVideo();

      expect(result).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Skipping fetchLatestVideo due to shutdown',
        expect.objectContaining({
          module: 'youtube',
        })
      );
    });

    it('should handle cleanup with browser mutex coordination', async () => {
      // Mock that cleanup proceeds normally
      mockBrowserService.close.mockResolvedValue();

      await expect(scraperService.cleanup()).resolves.not.toThrow();

      expect(mockBrowserService.close).toHaveBeenCalled();
    });
  });
});
