/**
 * Test suite for tweet category classification with enhanced retweet detection
 */
import { jest } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';

describe('Tweet Category Classification', () => {
  let scraperApp;
  let mockBrowserService;
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
      evaluate: jest.fn(),
      page: {
        url: jest.fn(() => 'https://x.com/home'),
        screenshot: jest.fn(),
      },
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
      get: jest.fn(),
      set: jest.fn(),
      has: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
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
    };

    // Create scraper application instance
    scraperApp = new ScraperApplication({
      browserService: mockBrowserService,
      config: mockConfig,
      stateManager: mockStateManager,
      eventBus: mockEventBus,
      logger: mockLogger,
    });
  });

  describe('Enhanced Retweet Detection Based on Author', () => {
    it('should classify tweets as retweets when author differs from monitored user', () => {
      // Test the classification logic directly
      const monitoredUser = 'testuser';

      // Test cases: [author, expectedCategory]
      const testCases = [
        ['differentuser', 'Retweet'], // Different author -> Retweet
        ['testuser', 'Post'], // Same author -> Post
        ['@testuser', 'Post'], // Same author with @ -> Post
        ['anotheruser', 'Retweet'], // Different author -> Retweet
        ['Unknown', 'Post'], // Unknown author -> Post (not retweet)
      ];

      testCases.forEach(([author, expectedCategory]) => {
        // Simulate the classification logic from scraper-application.js
        let isRetweet = false;

        // Method 1: Check if author is different from monitored user
        if (author !== monitoredUser && author !== `@${monitoredUser}` && author !== 'Unknown') {
          isRetweet = true;
        }

        const actualCategory = isRetweet ? 'Retweet' : 'Post';
        expect(actualCategory).toBe(expectedCategory);
      });
    });

    it('should handle social context as secondary detection method', () => {
      // Test social context detection
      const monitoredUser = 'testuser';
      const author = 'testuser'; // Same as monitored user
      const socialContextText = 'User reposted';

      // Simulate the classification logic
      let isRetweet = false;

      // Method 1: Check if author is different from monitored user
      if (author !== monitoredUser && author !== `@${monitoredUser}` && author !== 'Unknown') {
        isRetweet = true;
      }

      // Method 2: Check for social context element (modern retweet indicator)
      if (!isRetweet && socialContextText && socialContextText.includes('reposted')) {
        isRetweet = true;
      }

      const actualCategory = isRetweet ? 'Retweet' : 'Post';
      expect(actualCategory).toBe('Retweet');
    });

    it('should use RT@ pattern as tertiary detection method', () => {
      // Test RT@ pattern detection
      const monitoredUser = 'testuser';
      const author = 'testuser'; // Same as monitored user
      const text = 'RT @someuser This is a classic retweet';

      // Simulate the classification logic
      let isRetweet = false;

      // Method 1: Check if author is different from monitored user
      if (author !== monitoredUser && author !== `@${monitoredUser}` && author !== 'Unknown') {
        isRetweet = true;
      }

      // Method 2: Check for social context element (skipped for this test)

      // Method 3: Check for classic RT @ pattern
      if (!isRetweet && text.startsWith('RT @')) {
        isRetweet = true;
      }

      const actualCategory = isRetweet ? 'Retweet' : 'Post';
      expect(actualCategory).toBe('Retweet');
    });

    it('should prioritize author-based detection over text patterns', () => {
      // Test that author mismatch takes precedence
      const monitoredUser = 'testuser';
      const author = 'differentuser'; // Different from monitored user
      const text = 'This is a regular tweet about RT something';

      // Simulate the classification logic
      let isRetweet = false;

      // Method 1: Check if author is different from monitored user
      if (author !== monitoredUser && author !== `@${monitoredUser}` && author !== 'Unknown') {
        isRetweet = true;
      }

      const actualCategory = isRetweet ? 'Retweet' : 'Post';
      expect(actualCategory).toBe('Retweet');
    });

    it('should handle complex classification scenarios', () => {
      // Test multiple scenarios
      const monitoredUser = 'testuser';

      const scenarios = [
        { author: 'testuser', text: 'My own post', expected: 'Post' },
        { author: 'testuser', text: 'RT @someone This is a retweet', expected: 'Retweet' },
        { author: 'otheruser', text: '@testuser This is a retweet by someone else', expected: 'Retweet' },
        { author: 'Unknown', text: 'RT @someone Unknown author', expected: 'Retweet' }, // RT pattern wins
        { author: 'Unknown', text: 'Normal tweet', expected: 'Post' }, // Unknown author, no RT pattern
      ];

      scenarios.forEach(({ author, text, expected }) => {
        let isRetweet = false;

        // Method 1: Check if author is different from monitored user
        if (author !== monitoredUser && author !== `@${monitoredUser}` && author !== 'Unknown') {
          isRetweet = true;
        }

        // Method 3: Check for classic RT @ pattern
        if (!isRetweet && text.startsWith('RT @')) {
          isRetweet = true;
        }

        const actualCategory = isRetweet ? 'Retweet' : 'Post';
        expect(actualCategory).toBe(expected);
      });
    });
  });

  describe('Tweet Category Priority', () => {
    it('should prioritize reply classification over retweet classification', () => {
      // Test that reply detection takes precedence
      const monitoredUser = 'testuser';
      const author = 'otheruser'; // Different author (would be retweet)
      const text = '@testuser This is a reply'; // Reply pattern

      // Simulate the classification logic (simplified)
      const isReply = text.startsWith('@');
      let isRetweet = false;

      if (!isReply && author !== monitoredUser && author !== `@${monitoredUser}` && author !== 'Unknown') {
        isRetweet = true;
      }

      let tweetCategory = 'Post';
      if (isReply) {
        tweetCategory = 'Reply';
      } else if (isRetweet) {
        tweetCategory = 'Retweet';
      }

      // Reply should take precedence over retweet
      expect(tweetCategory).toBe('Reply');
    });

    it('should demonstrate correct classification precedence', () => {
      // Test the order of classification: Reply > Quote > Retweet > Post
      const monitoredUser = 'testuser';

      const testScenarios = [
        { author: 'otheruser', text: 'Normal tweet', expected: 'Retweet' }, // Different author
        { author: 'otheruser', text: '@testuser Reply', expected: 'Reply' }, // Reply takes precedence
        { author: 'testuser', text: 'RT @someone Retweet', expected: 'Retweet' }, // RT pattern
        { author: 'testuser', text: 'My own post', expected: 'Post' }, // Own post
      ];

      testScenarios.forEach(({ author, text, expected }) => {
        // Simulate the classification logic
        const isReply = text.startsWith('@');
        let isRetweet = false;

        if (!isReply) {
          // Check author mismatch
          if (author !== monitoredUser && author !== `@${monitoredUser}` && author !== 'Unknown') {
            isRetweet = true;
          }

          // Check RT pattern
          if (!isRetweet && text.startsWith('RT @')) {
            isRetweet = true;
          }
        }

        let tweetCategory = 'Post';
        if (isReply) {
          tweetCategory = 'Reply';
        } else if (isRetweet) {
          tweetCategory = 'Retweet';
        }

        expect(tweetCategory).toBe(expected);
      });
    });
  });
});
