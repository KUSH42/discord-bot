import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('ScraperApplication Process Tweet', () => {
  let scraperApp;
  let mockDependencies;
  let mockConfig;
  let mockClassifier;
  let mockAnnouncer;
  let mockLogger;
  let mockEventBus;
  let mockDuplicateDetector;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create enhanced logging mocks
    const enhancedLoggingMocks = createMockDependenciesWithEnhancedLogging();

    mockConfig = {
      getRequired: jest.fn(),
      get: jest.fn(),
      getBoolean: jest.fn(),
    };

    mockClassifier = {
      classifyXContent: jest.fn(),
    };

    mockAnnouncer = {
      announceContent: jest.fn(),
    };

    mockLogger = enhancedLoggingMocks.logger;

    mockEventBus = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    mockDuplicateDetector = {
      isDuplicate: jest.fn().mockReturnValue(false),
      markAsSeen: jest.fn(),
      getStats: jest.fn().mockReturnValue({ totalSeen: 0, totalChecked: 0 }),
    };

    const mockContentCoordinator = {
      processContent: jest.fn().mockResolvedValue({
        action: 'announced',
        announcementResult: { success: true },
      }),
    };

    // Configure default mock returns
    mockConfig.getRequired.mockImplementation(key => {
      const defaults = {
        X_USER_HANDLE: 'testuser',
        TWITTER_USERNAME: 'testuser@example.com',
        TWITTER_PASSWORD: 'testpass',
      };
      return defaults[key] || 'default-value';
    });

    mockConfig.get.mockImplementation((key, defaultValue) => {
      const defaults = {
        X_QUERY_INTERVAL_MIN: '300000',
        X_QUERY_INTERVAL_MAX: '600000',
        X_DEBUG_SAMPLING_RATE: '0.1',
        X_VERBOSE_LOG_SAMPLING_RATE: '0.05',
      };
      return defaults[key] || defaultValue;
    });

    mockDependencies = {
      browserService: {
        launch: jest.fn(),
        close: jest.fn(),
        goto: jest.fn(),
        waitForSelector: jest.fn(),
        evaluate: jest.fn(),
        setUserAgent: jest.fn(),
        isRunning: jest.fn().mockReturnValue(false),
        type: jest.fn(),
        click: jest.fn(),
      },
      contentClassifier: mockClassifier,
      contentAnnouncer: mockAnnouncer,
      config: mockConfig,
      stateManager: { get: jest.fn(), set: jest.fn() },
      discordService: { login: jest.fn() },
      eventBus: mockEventBus,
      logger: mockLogger,
      xAuthManager: {
        login: jest.fn(),
        clickNextButton: jest.fn(),
        clickLoginButton: jest.fn(),
        isAuthenticated: jest.fn(),
        ensureAuthenticated: jest.fn(),
      },
      duplicateDetector: mockDuplicateDetector,
      contentCoordinator: mockContentCoordinator,
      persistentStorage: { get: jest.fn(), set: jest.fn() },
      debugManager: enhancedLoggingMocks.debugManager,
      metricsManager: enhancedLoggingMocks.metricsManager,
    };

    scraperApp = new ScraperApplication(mockDependencies);
  });

  describe('processNewTweet', () => {
    it('should process regular tweet using classifier', async () => {
      const tweet = {
        tweetID: '123456789',
        url: 'https://x.com/testuser/status/123456789',
        author: 'testuser',
        text: 'Regular tweet content',
        timestamp: '2024-01-01T12:00:00.000Z',
        tweetCategory: 'Post',
      };

      const mockClassification = {
        type: 'post',
        confidence: 0.95,
        platform: 'x',
        details: { statusId: '123456789' },
      };

      await scraperApp.processNewTweet(tweet);

      // ClassifyXContent is not called in the main flow anymore - only for logging purposes

      // ContentCoordinator should be called instead of announcer directly
      expect(mockDependencies.contentCoordinator.processContent).toHaveBeenCalledWith(
        '123456789',
        'scraper',
        expect.objectContaining({
          platform: 'x',
          type: 'post',
          id: '123456789',
          url: tweet.url,
          author: 'testuser',
          text: tweet.text,
          timestamp: tweet.timestamp,
          publishedAt: tweet.timestamp,
          xUser: 'testuser',
        })
      );

      expect(mockDuplicateDetector.markAsSeen).toHaveBeenCalledWith(tweet.url);
    });

    it('should process retweets using current time for age comparison (fixes MAX_CONTENT_AGE issue)', async () => {
      const retweetTweet = {
        tweetID: '987654321',
        url: 'https://x.com/otheruser/status/987654321',
        author: 'otheruser', // Original tweet author
        text: 'RT @testuser: Original content',
        timestamp: '2024-01-01T12:00:00.000Z',
        tweetCategory: 'Retweet',
        retweetedBy: 'testuser', // Our monitored user who did the retweet
      };

      const mockClassification = {
        type: 'retweet',
        confidence: 0.9,
        platform: 'x',
      };

      await scraperApp.processNewTweet(retweetTweet);

      // ClassifyXContent is not called in the main flow - ContentCoordinator handles classification

      // ContentCoordinator should be called
      expect(mockDependencies.contentCoordinator.processContent).toHaveBeenCalledWith(
        '987654321',
        'scraper',
        expect.objectContaining({
          platform: 'x',
          type: 'post',
          id: '987654321',
          url: retweetTweet.url,
          author: 'otheruser',
          retweetedBy: 'testuser',
          text: retweetTweet.text,
          timestamp: retweetTweet.timestamp, // Original tweet timestamp (preserved)
          publishedAt: expect.any(String), // Current time for retweets (age comparison)
          originalPublishedAt: retweetTweet.timestamp, // Original timestamp preserved
          xUser: 'testuser',
        })
      );

      // Verify that for retweets, publishedAt is current time (not original timestamp)
      const callArgs = mockDependencies.contentCoordinator.processContent.mock.calls[0][2];
      expect(callArgs.publishedAt).not.toBe(retweetTweet.timestamp);
      expect(callArgs.originalPublishedAt).toBe(retweetTweet.timestamp);
    });

    it('should handle tweets with retweet metadata', async () => {
      const tweetWithMetadata = {
        tweetID: '111222333',
        url: 'https://x.com/testuser/status/111222333',
        author: 'testuser',
        text: 'Tweet with metadata',
        timestamp: '2024-01-01T12:00:00.000Z',
        tweetCategory: 'Post',
        retweetMetadata: { detectionMethod: 'enhanced' },
      };

      const mockClassification = {
        type: 'post',
        confidence: 0.9,
        platform: 'x',
      };

      mockClassifier.classifyXContent.mockReturnValue(mockClassification);
      mockAnnouncer.announceContent.mockResolvedValue({ success: true });

      await scraperApp.processNewTweet(tweetWithMetadata);

      // ClassifyXContent is not called in the main flow - ContentCoordinator handles classification
    });

    it('should handle skipped announcements', async () => {
      const tweet = {
        tweetID: '444555666',
        url: 'https://x.com/testuser/status/444555666',
        author: 'testuser',
        text: 'Skipped tweet',
        timestamp: '2024-01-01T12:00:00.000Z',
        tweetCategory: 'Post',
      };

      mockClassifier.classifyXContent.mockReturnValue({
        type: 'post',
        confidence: 0.8,
        platform: 'x',
      });

      // ContentCoordinator returns skipped result
      mockDependencies.contentCoordinator.processContent.mockResolvedValue({
        action: 'skip',
        reason: 'Content filtered',
      });

      await scraperApp.processNewTweet(tweet);

      // ContentCoordinator should be called instead of announcer directly
      expect(mockDependencies.contentCoordinator.processContent).toHaveBeenCalledWith(
        '444555666',
        'scraper',
        expect.objectContaining({
          type: 'post',
          platform: 'x',
        })
      );
    });

    it('should handle failed announcements', async () => {
      const tweet = {
        tweetID: '777888999',
        url: 'https://x.com/testuser/status/777888999',
        author: 'testuser',
        text: 'Failed tweet',
        timestamp: '2024-01-01T12:00:00.000Z',
        tweetCategory: 'Post',
      };

      mockClassifier.classifyXContent.mockReturnValue({
        type: 'post',
        confidence: 0.7,
        platform: 'x',
      });

      // ContentCoordinator returns failed result
      mockDependencies.contentCoordinator.processContent.mockResolvedValue({
        action: 'failed',
        reason: 'API error',
      });

      await scraperApp.processNewTweet(tweet);

      // ContentCoordinator should be called
      expect(mockDependencies.contentCoordinator.processContent).toHaveBeenCalledWith(
        '777888999',
        'scraper',
        expect.objectContaining({
          platform: 'x',
          type: 'post',
          id: '777888999',
        })
      );
    });

    it('should emit tweet processed event', async () => {
      const tweet = {
        tweetID: '123',
        url: 'https://x.com/testuser/status/123',
        author: 'testuser',
        text: 'Test tweet',
        timestamp: '2024-01-01T12:00:00.000Z',
        tweetCategory: 'Post',
      };

      const mockClassification = { type: 'post', platform: 'x' };
      const mockResult = {
        action: 'announced',
        announcementResult: { success: true },
      };

      mockClassifier.classifyXContent.mockReturnValue(mockClassification);
      mockDependencies.contentCoordinator.processContent.mockResolvedValue(mockResult);

      await scraperApp.processNewTweet(tweet);

      expect(mockEventBus.emit).toHaveBeenCalledWith('scraper.tweet.processed', {
        tweet: expect.objectContaining({
          platform: 'x',
          type: 'post',
          id: '123',
        }),
        result: mockResult,
        timestamp: expect.any(Date),
      });
    });

    it('should handle tweet processing errors', async () => {
      const tweet = {
        tweetID: 'error123',
        url: 'https://x.com/testuser/status/error123',
        author: 'testuser',
        text: 'Error tweet',
        timestamp: '2024-01-01T12:00:00.000Z',
        tweetCategory: 'Post',
      };

      const processError = new Error('Processing failed');
      mockDependencies.contentCoordinator.processContent.mockRejectedValue(processError);

      await expect(scraperApp.processNewTweet(tweet)).rejects.toThrow('Processing failed');

      // The enhanced logger's operation.error is called, not direct logger.error
      // So we need to verify the operation methods were called correctly
      expect(mockDependencies.contentCoordinator.processContent).toHaveBeenCalledWith(
        'error123',
        'scraper',
        expect.objectContaining({
          platform: 'x',
          type: 'post',
          id: 'error123',
        })
      );
    });

    it('should handle tweet without URL', async () => {
      const tweetWithoutUrl = {
        tweetID: '999',
        url: null,
        author: 'testuser',
        text: 'Tweet without URL',
        timestamp: '2024-01-01T12:00:00.000Z',
        tweetCategory: 'Post',
      };

      mockClassifier.classifyXContent.mockReturnValue({
        type: 'post',
        platform: 'x',
      });
      mockAnnouncer.announceContent.mockResolvedValue({ success: true });

      await scraperApp.processNewTweet(tweetWithoutUrl);

      expect(mockDuplicateDetector.markAsSeen).not.toHaveBeenCalled();
      expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Marked tweet'));
    });

    it('should handle retweet detection correctly', async () => {
      // Test actual retweet - classifier should be called in current implementation
      const actualRetweet = {
        tweetID: '111',
        url: 'https://x.com/otheruser/status/111',
        author: 'otheruser', // Original tweet author
        text: 'Original tweet content',
        tweetCategory: 'Retweet', // Detected as retweet by extraction logic
        retweetedBy: 'testuser', // Our monitored user who did the retweet
      };

      mockClassifier.classifyXContent.mockReturnValue({
        type: 'retweet',
        platform: 'x',
      });

      await scraperApp.processNewTweet(actualRetweet);

      // ClassifyXContent is not called in the main flow - ContentCoordinator handles classification
      expect(mockDependencies.contentCoordinator.processContent).toHaveBeenCalledWith(
        '111',
        'scraper',
        expect.objectContaining({
          platform: 'x',
          type: 'post',
          id: '111',
          retweetedBy: 'testuser',
        })
      );

      // Test regular post - should also use classifier
      const regularPost = {
        tweetID: '222',
        url: 'https://x.com/testuser/status/222',
        author: 'testuser',
        text: 'Regular post content',
        tweetCategory: 'Post',
      };

      mockClassifier.classifyXContent.mockReturnValue({
        type: 'post',
        platform: 'x',
      });

      await scraperApp.processNewTweet(regularPost);

      // ClassifyXContent is not called in the main flow anymore
      expect(mockDependencies.contentCoordinator.processContent).toHaveBeenCalledWith(
        '222',
        'scraper',
        expect.objectContaining({
          platform: 'x',
          type: 'post',
          id: '222',
        })
      );
    });
  });
});
