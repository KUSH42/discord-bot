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
      authManager: {
        login: jest.fn(),
        clickNextButton: jest.fn(),
        clickLoginButton: jest.fn(),
        isAuthenticated: jest.fn(),
        ensureAuthenticated: jest.fn(),
      },
      duplicateDetector: mockDuplicateDetector,
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

      mockClassifier.classifyXContent.mockReturnValue(mockClassification);
      mockAnnouncer.announceContent.mockResolvedValue({ success: true });
      jest.spyOn(scraperApp, 'isNewContent').mockReturnValue(false);

      await scraperApp.processNewTweet(tweet);

      expect(mockClassifier.classifyXContent).toHaveBeenCalledWith(tweet.url, tweet.text, {
        timestamp: tweet.timestamp,
        author: tweet.author,
        monitoredUser: 'testuser',
      });

      expect(mockAnnouncer.announceContent).toHaveBeenCalledWith({
        platform: 'x',
        type: 'post',
        id: '123456789',
        url: tweet.url,
        author: 'testuser',
        originalAuthor: tweet.author,
        text: tweet.text,
        timestamp: tweet.timestamp,
        isOld: true,
      });

      expect(mockDuplicateDetector.markAsSeen).toHaveBeenCalledWith(tweet.url);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Announced post from @testuser',
        expect.objectContaining({
          module: 'scraper',
          outcome: 'success',
          tweetId: '123456789',
        })
      );
    });

    it('should bypass classifier for author-based retweets', async () => {
      const retweetTweet = {
        tweetID: '987654321',
        url: 'https://x.com/otheruser/status/987654321',
        author: 'otheruser',
        text: 'RT @testuser: Original content',
        timestamp: '2024-01-01T12:00:00.000Z',
        tweetCategory: 'Retweet',
      };

      mockAnnouncer.announceContent.mockResolvedValue({ success: true });
      jest.spyOn(scraperApp, 'isNewContent').mockReturnValue(true);

      await scraperApp.processNewTweet(retweetTweet);

      expect(mockClassifier.classifyXContent).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Announced retweet from @otheruser',
        expect.objectContaining({
          module: 'scraper',
          outcome: 'success',
          tweetId: '987654321',
        })
      );

      expect(mockAnnouncer.announceContent).toHaveBeenCalledWith({
        platform: 'x',
        type: 'retweet',
        id: '987654321',
        url: retweetTweet.url,
        author: 'testuser', // Changed to monitored user for retweets
        originalAuthor: 'otheruser',
        text: retweetTweet.text,
        timestamp: retweetTweet.timestamp,
        isOld: false,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Announced retweet from @otheruser',
        expect.objectContaining({
          module: 'scraper',
          outcome: 'success',
          tweetId: '987654321',
        })
      );
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
      jest.spyOn(scraperApp, 'isNewContent').mockReturnValue(true);

      await scraperApp.processNewTweet(tweetWithMetadata);

      expect(mockClassifier.classifyXContent).toHaveBeenCalledWith(
        tweetWithMetadata.url,
        tweetWithMetadata.text,
        expect.objectContaining({
          isRetweet: false,
          retweetDetection: { detectionMethod: 'enhanced' },
        })
      );
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
      mockAnnouncer.announceContent.mockResolvedValue({
        success: false,
        skipped: true,
        reason: 'Content filtered',
      });
      jest.spyOn(scraperApp, 'isNewContent').mockReturnValue(true);

      await scraperApp.processNewTweet(tweet);

      // The announcer is called but returns skipped result
      expect(mockAnnouncer.announceContent).toHaveBeenCalled();
      expect(mockAnnouncer.announceContent).toHaveBeenCalledWith(
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
      mockAnnouncer.announceContent.mockResolvedValue({
        success: false,
        skipped: false,
        reason: 'API error',
      });
      jest.spyOn(scraperApp, 'isNewContent').mockReturnValue(true);

      await scraperApp.processNewTweet(tweet);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to announce post',
        expect.objectContaining({
          module: 'scraper',
          outcome: 'error',
          error: 'API error',
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
      const mockResult = { success: true };

      mockClassifier.classifyXContent.mockReturnValue(mockClassification);
      mockAnnouncer.announceContent.mockResolvedValue(mockResult);
      jest.spyOn(scraperApp, 'isNewContent').mockReturnValue(true);

      await scraperApp.processNewTweet(tweet);

      expect(mockEventBus.emit).toHaveBeenCalledWith('scraper.tweet.processed', {
        tweet: expect.objectContaining({
          platform: 'x',
          type: 'post',
          id: '123',
        }),
        classification: mockClassification,
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
      mockClassifier.classifyXContent.mockImplementation(() => {
        throw processError;
      });

      await expect(scraperApp.processNewTweet(tweet)).rejects.toThrow('Processing failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error processing tweet error123',
        expect.objectContaining({
          module: 'scraper',
          outcome: 'error',
          error: 'Processing failed',
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
      jest.spyOn(scraperApp, 'isNewContent').mockReturnValue(true);

      await scraperApp.processNewTweet(tweetWithoutUrl);

      expect(mockDuplicateDetector.markAsSeen).not.toHaveBeenCalled();
      expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Marked tweet'));
    });

    it('should handle author-based retweet detection edge cases', async () => {
      // Test with @username format
      const retweetWithAt = {
        tweetID: '111',
        url: 'https://x.com/otheruser/status/111',
        author: '@testuser', // Same as monitored user with @
        text: 'Not a retweet',
        tweetCategory: 'Retweet',
      };

      mockClassifier.classifyXContent.mockReturnValue({
        type: 'post',
        platform: 'x',
      });
      mockAnnouncer.announceContent.mockResolvedValue({ success: true });
      jest.spyOn(scraperApp, 'isNewContent').mockReturnValue(true);

      await scraperApp.processNewTweet(retweetWithAt);

      // With enhanced logging, we get the final success message instead
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Announced post from @@testuser',
        expect.objectContaining({
          module: 'scraper',
          outcome: 'success',
        })
      );
      expect(mockClassifier.classifyXContent).toHaveBeenCalled();

      // Test with Unknown author
      const retweetUnknown = {
        tweetID: '222',
        url: 'https://x.com/unknown/status/222',
        author: 'Unknown',
        text: 'Unknown author tweet',
        tweetCategory: 'Retweet',
      };

      await scraperApp.processNewTweet(retweetUnknown);

      expect(mockClassifier.classifyXContent).toHaveBeenCalledTimes(2);
    });
  });
});
