import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { DuplicateDetector } from '../../src/duplicate-detector.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('Duplicate Detector Integration', () => {
  let scraperApp;
  let mockDependencies;

  beforeEach(() => {
    // Create comprehensive mock dependencies with enhanced logging
    const enhancedLoggingMocks = createMockDependenciesWithEnhancedLogging();

    mockDependencies = {
      ...enhancedLoggingMocks,
      browserService: {
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
      },
      contentClassifier: {
        classifyXContent: jest.fn(() => ({ type: 'post' })),
      },
      contentCoordinator: {
        processContent: jest.fn(() => Promise.resolve({ success: true })),
      },
      config: {
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
      },
      stateManager: {
        get: jest.fn(key => {
          const values = {
            botStartTime: new Date('2024-01-01T00:00:00Z'),
          };
          return values[key];
        }),
        set: jest.fn(),
      },
      eventBus: {
        emit: jest.fn(),
      },
      xAuthManager: {
        ensureAuthenticated: jest.fn(),
        isAuthenticated: jest.fn().mockResolvedValue(true),
      },
      duplicateDetector: {
        isDuplicate: jest.fn(() => false),
        addContent: jest.fn(),
        getStats: jest.fn(() => ({
          fingerprints: 0,
          urls: 0,
          knownVideoIds: 0,
          knownTweetIds: 0,
          totalKnownIds: 0,
          fingerprintingEnabled: true,
        })),
      },
      persistentStorage: {
        hasFingerprint: jest.fn().mockResolvedValue(false),
        storeFingerprint: jest.fn().mockResolvedValue(),
        hasUrl: jest.fn().mockResolvedValue(false),
        addUrl: jest.fn().mockResolvedValue(),
      },
    };

    // Create scraper application instance
    scraperApp = new ScraperApplication(mockDependencies);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with a DuplicateDetector instance', () => {
    expect(scraperApp.duplicateDetector).toBeDefined();
    expect(typeof scraperApp.duplicateDetector.isDuplicate).toBe('function');
    expect(typeof scraperApp.duplicateDetector.addContent).toBe('function');
    expect(typeof scraperApp.duplicateDetector.getStats).toBe('function');
  });

  it('should include duplicate detector stats in getStats()', () => {
    const stats = scraperApp.getStats();
    expect(stats).toHaveProperty('duplicateDetectorStats');
    expect(stats.duplicateDetectorStats).toHaveProperty('knownTweetIds');
    expect(stats.duplicateDetectorStats).toHaveProperty('totalKnownIds');
  });
});
