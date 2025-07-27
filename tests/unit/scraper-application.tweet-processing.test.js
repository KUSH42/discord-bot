import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
// import { DuplicateDetector } from '../../src/duplicate-detector.js';

describe('Tweet Processing and Duplicate Detection', () => {
  let scraperApp;
  let mockBrowserService;
  let mockContentClassifier;
  let mockContentAnnouncer;
  let mockConfig;
  let mockStateManager;
  let mockEventBus;
  let mockLogger;

  beforeEach(() => {
    // Mock browser service
    mockBrowserService = {
      launch: jest.fn(),
      close: jest.fn(),
      isRunning: jest.fn(() => true),
      goto: jest.fn(),
      waitForSelector: jest.fn(),
      type: jest.fn(),
      click: jest.fn(),
      waitForNavigation: jest.fn(),
      evaluate: jest.fn(),
      page: {
        url: jest.fn(() => 'https://x.com/home'),
        screenshot: jest.fn(),
      },
    };

    // Mock content classifier
    mockContentClassifier = {
      classifyXContent: jest.fn(() => ({ type: 'post' })),
    };

    // Mock content announcer
    mockContentAnnouncer = {
      announceContent: jest.fn(() => Promise.resolve({ success: true })),
    };

    // Mock config
    mockConfig = {
      getRequired: jest.fn(key => {
        const values = {
          X_USER_HANDLE: 'testuser',
          TWITTER_USERNAME: 'testuser',
          TWITTER_PASSWORD: 'testpass',
        };
        return values[key] || `mock-${key}`;
      }),
      get: jest.fn((key, defaultValue) => {
        const values = {
          X_QUERY_INTERVAL_MIN: '300000',
          X_QUERY_INTERVAL_MAX: '600000',
          MAX_CONTENT_AGE_HOURS: '2', // 2 hours backoff
        };
        return values[key] || defaultValue;
      }),
      getBoolean: jest.fn((key, defaultValue) => {
        const values = {
          ANNOUNCE_OLD_TWEETS: false,
        };
        return values[key] !== undefined ? values[key] : defaultValue;
      }),
    };

    // Mock state manager
    mockStateManager = {
      get: jest.fn(key => {
        const values = {};
        return values[key];
      }),
      set: jest.fn(),
    };

    // Mock event bus
    mockEventBus = {
      emit: jest.fn(),
    };

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    // Mock auth manager
    const mockAuthManager = {
      ensureAuthenticated: jest.fn(),
      isAuthenticated: jest.fn().mockResolvedValue(true),
    };

    // Create scraper application instance
    scraperApp = new ScraperApplication({
      browserService: mockBrowserService,
      contentClassifier: mockContentClassifier,
      contentAnnouncer: mockContentAnnouncer,
      config: mockConfig,
      stateManager: mockStateManager,
      eventBus: mockEventBus,
      logger: mockLogger,
      authManager: mockAuthManager,
      persistentStorage: {
        hasFingerprint: jest.fn().mockResolvedValue(false),
        storeFingerprint: jest.fn().mockResolvedValue(),
        hasUrl: jest.fn().mockResolvedValue(false),
        addUrl: jest.fn().mockResolvedValue(),
      },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks(); // Restore Date.now and other mocks
  });

  it('should mark all non-duplicate tweets as seen regardless of announcement', async () => {
    // Mock Date.now to work with 2-hour backoff: tweet1 (23:59:59) will be >2h old, tweet2 (00:01:00) will be <2h old
    const mockNow = new Date('2024-01-01T02:00:30Z').getTime(); // Just over 2h from tweet1, just under 2h from tweet2
    jest.spyOn(Date, 'now').mockReturnValue(mockNow);

    const mockTweets = [
      {
        tweetID: '1234567890',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'Test tweet 1',
        timestamp: '2023-12-31T23:59:59Z', // Before bot start time
        tweetCategory: 'Post',
      },
      {
        tweetID: '1234567891',
        url: 'https://x.com/testuser/status/1234567891',
        author: 'testuser',
        text: 'Test tweet 2',
        timestamp: '2024-01-01T00:01:00Z', // After bot start time
        tweetCategory: 'Post',
      },
    ];

    // Mock duplicate detector to track what gets marked as seen
    const markAsSeenSpy = jest.spyOn(scraperApp.duplicateDetector, 'markAsSeen');
    const _isDuplicateSpy = jest.spyOn(scraperApp.duplicateDetector, 'isDuplicate').mockResolvedValue(false);

    const result = await scraperApp.filterNewTweets(mockTweets);

    // Should mark both tweets as seen
    expect(markAsSeenSpy).toHaveBeenCalledTimes(2);
    expect(markAsSeenSpy).toHaveBeenCalledWith('https://x.com/testuser/status/1234567890');
    expect(markAsSeenSpy).toHaveBeenCalledWith('https://x.com/testuser/status/1234567891');

    // Only the new tweet should be returned for announcement
    expect(result).toHaveLength(1);
    expect(result[0].tweetID).toBe('1234567891');
  });

  it('should respect ANNOUNCE_OLD_TWEETS configuration', async () => {
    mockConfig.getBoolean.mockImplementation((key, defaultValue) => {
      if (key === 'ANNOUNCE_OLD_TWEETS') {
        return true;
      }
      return defaultValue;
    });

    const mockTweets = [
      {
        tweetID: '1234567890',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'Old tweet',
        timestamp: '2023-12-31T23:59:59Z', // Before bot start time
        tweetCategory: 'Post',
      },
    ];

    jest.spyOn(scraperApp.duplicateDetector, 'isDuplicate').mockResolvedValue(false);

    const result = await scraperApp.filterNewTweets(mockTweets);

    // Should include the old tweet when ANNOUNCE_OLD_TWEETS is true
    expect(result).toHaveLength(1);
    expect(result[0].tweetID).toBe('1234567890');
  });

  it('should filter out duplicate tweets without re-marking them', async () => {
    const mockTweets = [
      {
        tweetID: '1234567890',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'Duplicate tweet',
        timestamp: '2024-01-01T00:01:00Z',
        tweetCategory: 'Post',
      },
    ];

    const markAsSeenSpy = jest.spyOn(scraperApp.duplicateDetector, 'markAsSeen');
    jest.spyOn(scraperApp.duplicateDetector, 'isDuplicate').mockResolvedValue(true);

    const result = await scraperApp.filterNewTweets(mockTweets);

    // Should not mark duplicate tweets as seen again
    expect(markAsSeenSpy).not.toHaveBeenCalled();

    // Should return empty array for duplicates
    expect(result).toHaveLength(0);
  });

  it('should handle tweets without timestamps gracefully', async () => {
    const mockTweets = [
      {
        tweetID: '1234567890',
        url: 'https://x.com/testuser/status/1234567890',
        author: 'testuser',
        text: 'Tweet without timestamp',
        timestamp: null,
        tweetCategory: 'Post',
      },
    ];

    jest.spyOn(scraperApp.duplicateDetector, 'isDuplicate').mockResolvedValue(false);

    const result = await scraperApp.filterNewTweets(mockTweets);

    // Should include tweets without timestamps (treated as new)
    expect(result).toHaveLength(1);
    expect(result[0].tweetID).toBe('1234567890');
  });
});

describe('Tweet Processing Pipeline', () => {
  let scraperApp;
  let mockBrowserService;
  let mockContentClassifier;
  let mockContentAnnouncer;
  let mockConfig;
  let mockStateManager;
  let mockEventBus;
  let mockLogger;

  beforeEach(() => {
    // Mock browser service
    mockBrowserService = {
      launch: jest.fn(),
      close: jest.fn(),
      isRunning: jest.fn(() => true),
      goto: jest.fn(),
      waitForSelector: jest.fn(),
      type: jest.fn(),
      click: jest.fn(),
      waitForNavigation: jest.fn(),
      evaluate: jest.fn(),
      page: {
        url: jest.fn(() => 'https://x.com/home'),
        screenshot: jest.fn(),
      },
    };

    // Mock content classifier
    mockContentClassifier = {
      classifyXContent: jest.fn(() => ({ type: 'post' })),
    };

    // Mock content announcer
    mockContentAnnouncer = {
      announceContent: jest.fn(() => Promise.resolve({ success: true })),
    };

    // Mock config
    mockConfig = {
      getRequired: jest.fn(key => {
        const values = {
          X_USER_HANDLE: 'testuser',
          TWITTER_USERNAME: 'testuser',
          TWITTER_PASSWORD: 'testpass',
        };
        return values[key] || `mock-${key}`;
      }),
      get: jest.fn((key, defaultValue) => {
        const values = {
          X_QUERY_INTERVAL_MIN: '300000',
          X_QUERY_INTERVAL_MAX: '600000',
          MAX_CONTENT_AGE_HOURS: '2', // 2 hours backoff
        };
        return values[key] || defaultValue;
      }),
      getBoolean: jest.fn((key, defaultValue) => {
        const values = {
          ANNOUNCE_OLD_TWEETS: false,
        };
        return values[key] !== undefined ? values[key] : defaultValue;
      }),
    };

    // Mock state manager
    mockStateManager = {
      get: jest.fn(key => {
        const values = {};
        return values[key];
      }),
      set: jest.fn(),
    };

    // Mock event bus
    mockEventBus = {
      emit: jest.fn(),
    };

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    // Mock auth manager
    const mockAuthManager = {
      ensureAuthenticated: jest.fn(),
      isAuthenticated: jest.fn().mockResolvedValue(true),
    };

    // Create scraper application instance
    scraperApp = new ScraperApplication({
      browserService: mockBrowserService,
      contentClassifier: mockContentClassifier,
      contentAnnouncer: mockContentAnnouncer,
      config: mockConfig,
      stateManager: mockStateManager,
      eventBus: mockEventBus,
      logger: mockLogger,
      authManager: mockAuthManager,
      persistentStorage: {
        hasFingerprint: jest.fn().mockResolvedValue(false),
        storeFingerprint: jest.fn().mockResolvedValue(),
        hasUrl: jest.fn().mockResolvedValue(false),
        addUrl: jest.fn().mockResolvedValue(),
      },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should process new tweets through the complete pipeline', async () => {
    // Mock Date.now to work with 2-hour backoff: tweet (00:01:00) will be <2h old
    const mockNow = new Date('2024-01-01T01:30:00Z').getTime(); // 1.5 hours after tweet, within backoff window
    jest.spyOn(Date, 'now').mockReturnValue(mockNow);

    const mockTweet = {
      tweetID: '1234567890',
      url: 'https://x.com/testuser/status/1234567890',
      author: 'testuser',
      text: 'Test tweet',
      timestamp: '2024-01-01T00:01:00Z',
      tweetCategory: 'Post',
    };

    // Mock duplicate detector to return false for new tweet
    jest.spyOn(scraperApp.duplicateDetector, 'isDuplicate').mockReturnValue(false);

    await scraperApp.processNewTweet(mockTweet);

    // Should classify the tweet
    expect(mockContentClassifier.classifyXContent).toHaveBeenCalledWith(
      mockTweet.url,
      mockTweet.text,
      expect.objectContaining({
        timestamp: mockTweet.timestamp,
        author: mockTweet.author,
      })
    );

    // Should announce the content
    expect(mockContentAnnouncer.announceContent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'x',
        type: 'post',
        id: mockTweet.tweetID,
        url: mockTweet.url,
        author: mockTweet.author,
        text: mockTweet.text,
        timestamp: mockTweet.timestamp,
        isOld: false,
      })
    );

    // Should emit event
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      'scraper.tweet.processed',
      expect.objectContaining({
        tweet: expect.any(Object),
        classification: expect.any(Object),
        result: expect.any(Object),
        timestamp: expect.any(Date),
      })
    );
  });

  it('should handle announcement failures gracefully', async () => {
    const mockTweet = {
      tweetID: '1234567890',
      url: 'https://x.com/testuser/status/1234567890',
      author: 'testuser',
      text: 'Test tweet',
      timestamp: '2024-01-01T00:01:00Z',
      tweetCategory: 'Post',
    };

    mockContentAnnouncer.announceContent.mockResolvedValue({
      success: false,
      reason: 'Channel not found',
    });

    await scraperApp.processNewTweet(mockTweet);

    // Should still complete processing despite announcement failure
    expect(mockContentClassifier.classifyXContent).toHaveBeenCalled();
    expect(mockContentAnnouncer.announceContent).toHaveBeenCalled();
    expect(mockEventBus.emit).toHaveBeenCalledWith('scraper.tweet.processed', expect.any(Object));
  });

  it('should bypass classifier for author-based retweets', async () => {
    const mockRetweet = {
      tweetID: '1234567890',
      url: 'https://x.com/testuser/status/1234567890',
      author: 'differentuser', // Different from xUser
      text: 'Some retweet content',
      timestamp: '2024-01-01T00:01:00Z',
      tweetCategory: 'Retweet',
    };

    await scraperApp.processNewTweet(mockRetweet);

    // Should NOT call the classifier since it's an author-based retweet
    expect(mockContentClassifier.classifyXContent).not.toHaveBeenCalled();

    // Should still announce the content as a retweet with correct author
    expect(mockContentAnnouncer.announceContent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'retweet',
        author: 'testuser', // Should be the monitored user, not the original author
        originalAuthor: 'differentuser', // Original author stored separately
        platform: 'x',
      })
    );
  });

  it('should use classifier for same-author tweets even if marked as retweet', async () => {
    const mockTweet = {
      tweetID: '1234567890',
      url: 'https://x.com/testuser/status/1234567890',
      author: 'testuser', // Same as xUser
      text: 'Some tweet content',
      timestamp: '2024-01-01T00:01:00Z',
      tweetCategory: 'Retweet',
    };

    await scraperApp.processNewTweet(mockTweet);

    // Should call the classifier since author matches xUser
    expect(mockContentClassifier.classifyXContent).toHaveBeenCalled();
    expect(mockContentAnnouncer.announceContent).toHaveBeenCalled();

    // Verify classifier was called with correct metadata
    expect(mockContentClassifier.classifyXContent).toHaveBeenCalledWith(
      'https://x.com/testuser/status/1234567890',
      'Some tweet content',
      expect.objectContaining({
        author: 'testuser',
        monitoredUser: 'testuser',
      })
    );

    // Should announce as a 'post' (based on our mock classifier returning { type: 'post' })
    expect(mockContentAnnouncer.announceContent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'post', // Should be 'post', not 'retweet'
        author: 'testuser',
        platform: 'x',
      })
    );
  });

  it('should correctly classify monitored user quotes as quotes, not retweets', async () => {
    // Configure classifier to return quote type
    mockContentClassifier.classifyXContent.mockReturnValue({ type: 'quote', confidence: 0.9 });

    const mockQuote = {
      tweetID: '1234567890',
      url: 'https://x.com/testuser/status/1234567890',
      author: 'testuser', // Same as xUser
      text: 'My comment on this tweet https://x.com/other/status/123',
      timestamp: '2024-01-01T00:01:00Z',
      tweetCategory: 'Quote', // This might be misidentified somewhere
    };

    await scraperApp.processNewTweet(mockQuote);

    // Should call the classifier since author matches xUser
    expect(mockContentClassifier.classifyXContent).toHaveBeenCalled();

    // Should announce as a 'quote', not 'retweet'
    expect(mockContentAnnouncer.announceContent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'quote',
        author: 'testuser',
        platform: 'x',
      })
    );
  });

  it('should correctly classify monitored user replies as replies, not retweets', async () => {
    // Configure classifier to return reply type
    mockContentClassifier.classifyXContent.mockReturnValue({ type: 'reply', confidence: 0.9 });

    const mockReply = {
      tweetID: '1234567890',
      url: 'https://x.com/testuser/status/1234567890',
      author: 'testuser', // Same as xUser
      text: '@someone This is my reply',
      timestamp: '2024-01-01T00:01:00Z',
      tweetCategory: 'Reply', // This might be misidentified somewhere
    };

    await scraperApp.processNewTweet(mockReply);

    // Should call the classifier since author matches xUser
    expect(mockContentClassifier.classifyXContent).toHaveBeenCalled();

    // Should announce as a 'reply', not 'retweet'
    expect(mockContentAnnouncer.announceContent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reply',
        author: 'testuser',
        platform: 'x',
      })
    );
  });

  it('should use classifier for Unknown author tweets', async () => {
    const mockTweet = {
      tweetID: '1234567890',
      url: 'https://x.com/testuser/status/1234567890',
      author: 'Unknown',
      text: 'Some tweet content',
      timestamp: '2024-01-01T00:01:00Z',
      tweetCategory: 'Retweet',
    };

    await scraperApp.processNewTweet(mockTweet);

    // Should call the classifier since author is Unknown
    expect(mockContentClassifier.classifyXContent).toHaveBeenCalled();
    expect(mockContentAnnouncer.announceContent).toHaveBeenCalled();
  });

  it('should correctly categorize monitored user tweets in extractTweets', async () => {
    // Mock browser.evaluate to simulate extractTweets behavior
    mockBrowserService.evaluate.mockImplementation((_fn, _monitoredUser) => {
      // Simulate the extracted tweets - one from monitored user, one retweet
      return Promise.resolve([
        {
          tweetID: '1111111111',
          url: 'https://x.com/testuser/status/1111111111',
          author: 'testuser', // Same as monitored user
          text: 'This is my own post',
          timestamp: '2024-01-01T00:01:00Z',
          tweetCategory: 'Post', // Should be Post, not Retweet
        },
        {
          tweetID: '2222222222',
          url: 'https://x.com/testuser/status/2222222222',
          author: 'differentuser', // Different from monitored user
          text: 'This is a retweet',
          timestamp: '2024-01-01T00:02:00Z',
          tweetCategory: 'Retweet', // Should be Retweet
        },
      ]);
    });

    // Call extractTweets directly
    const extractedTweets = await scraperApp.extractTweets();

    expect(extractedTweets).toHaveLength(2);

    // First tweet should be categorized as Post (author matches monitored user)
    expect(extractedTweets[0].tweetCategory).toBe('Post');
    expect(extractedTweets[0].author).toBe('testuser');

    // Second tweet should be categorized as Retweet (author differs from monitored user)
    expect(extractedTweets[1].tweetCategory).toBe('Retweet');
    expect(extractedTweets[1].author).toBe('differentuser');

    // Verify that monitoredUser was passed to the evaluate function
    expect(mockBrowserService.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      'testuser' // monitoredUser parameter
    );
  });
});
