// Debug script to understand why the retweet test is failing

import { ScraperApplication } from './src/application/scraper-application.js';
import { ContentCoordinator } from './src/core/content-coordinator.js';
import { ContentStateManager } from './src/core/content-state-manager.js';
import { ContentAnnouncer } from './src/core/content-announcer.js';
import { ContentClassifier } from './src/core/content-classifier.js';
import { DuplicateDetector } from './src/duplicate-detector.js';
import {
  createMockWinstonLogger,
  createMockDebugFlagManager,
  createMockMetricsManager,
  createMockEnhancedLogger,
} from './tests/utils/enhanced-logging-mocks.js';

// Track announcements
const announcementCallLog = [];

// Mock Discord service
const mockDiscordService = {
  sendMessage: jest.fn((channelId, message) => {
    console.log(`DEBUG: Discord announcement - Channel: ${channelId}, Message: ${message}`);
    announcementCallLog.push({ type: 'discord_announcement', channelId, message });
    return Promise.resolve({ status: 200 });
  }),
};

// Mock Browser service
const mockBrowserService = {
  launch: jest.fn(() => Promise.resolve()),
  goto: jest.fn(() => Promise.resolve()),
  evaluate: jest.fn(() => Promise.resolve([])),
  waitForSelector: jest.fn(() => Promise.resolve()),
  type: jest.fn(() => Promise.resolve()),
  click: jest.fn(() => Promise.resolve()),
  close: jest.fn(() => Promise.resolve()),
  isRunning: jest.fn(() => true),
  isConnected: jest.fn(() => true),
  setUserAgent: jest.fn(() => Promise.resolve()),
};

// Mock Auth Manager
const mockAuthManager = {
  login: jest.fn(() => Promise.resolve()),
  isAuthenticated: jest.fn(() => Promise.resolve(true)),
  ensureAuthenticated: jest.fn(() => Promise.resolve()),
  clickNextButton: jest.fn(() => Promise.resolve(true)),
  clickLoginButton: jest.fn(() => Promise.resolve(true)),
};

// Mock configuration
const mockConfig = {
  getRequired: jest.fn(key => {
    const values = {
      DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345682',
      X_USER_HANDLE: 'testuser',
    };
    return values[key] || `mock-${key}`;
  }),
  get: jest.fn((key, defaultValue) => {
    const values = {
      DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345682',
    };
    return values[key] || defaultValue;
  }),
  getBoolean: jest.fn((key, defaultValue) => {
    const values = {
      ENABLE_RETWEET_PROCESSING: true,
    };
    return values[key] !== undefined ? values[key] : defaultValue;
  }),
  getNumber: jest.fn((key, defaultValue) => {
    const values = {
      MAX_CONTENT_AGE_HOURS: 168,
    };
    return values[key] !== undefined ? values[key] : defaultValue;
  }),
};

// Mock state manager
const mockStateManager = {
  get: jest.fn((key, defaultValue) => {
    const state = {
      postingEnabled: true,
      announcementEnabled: true,
      botStartTime: new Date('2020-01-01T00:00:00Z'),
    };
    return state[key] !== undefined ? state[key] : defaultValue;
  }),
  set: jest.fn(),
};

async function debugRetweetTest() {
  console.log('DEBUG: Starting retweet test debug...');

  const mockLogger = createMockEnhancedLogger();
  const mockDebugManager = createMockDebugFlagManager();
  const mockMetricsManager = createMockMetricsManager();

  // Create all components
  const duplicateDetector = new DuplicateDetector();
  const contentClassifier = new ContentClassifier(mockConfig, mockLogger);
  const contentStateManager = new ContentStateManager(null, mockLogger); // null for persistent storage
  const contentAnnouncer = new ContentAnnouncer(mockDiscordService, mockStateManager, mockConfig, mockLogger);
  const contentCoordinator = new ContentCoordinator(
    contentAnnouncer,
    contentStateManager,
    mockStateManager,
    mockConfig,
    mockLogger
  );

  const scraperApp = new ScraperApplication(
    mockBrowserService,
    mockAuthManager,
    contentClassifier,
    contentCoordinator,
    duplicateDetector,
    mockStateManager,
    mockConfig,
    mockLogger,
    mockDebugManager,
    mockMetricsManager
  );

  console.log('DEBUG: Components created, setting up mocks...');

  // Set up the browser mock to return a retweet
  mockBrowserService.evaluate
    .mockResolvedValueOnce(undefined) // Scroll 1
    .mockResolvedValueOnce(undefined) // Scroll 2
    .mockResolvedValueOnce(undefined) // Scroll 3
    .mockResolvedValueOnce([]) // First extractTweets() call on search page
    .mockResolvedValueOnce(undefined) // Enhanced scrolling 1
    .mockResolvedValueOnce(undefined) // Enhanced scrolling 2
    .mockResolvedValueOnce(undefined) // Enhanced scrolling 3
    .mockResolvedValueOnce(undefined) // Enhanced scrolling 4
    .mockResolvedValueOnce(undefined) // Enhanced scrolling 5
    .mockResolvedValueOnce([
      {
        tweetID: '1234567892',
        url: 'https://x.com/testuser/status/1234567892',
        author: 'testuser',
        text: 'RT @anotheruser: This is a retweet from profile',
        timestamp: new Date().toISOString(),
        tweetCategory: 'Retweet',
      },
    ])
    .mockResolvedValue([]);

  console.log('DEBUG: Mocks set up, calling pollXProfile...');

  try {
    await scraperApp.pollXProfile();
    console.log(`DEBUG: pollXProfile completed. Announcements captured: ${announcementCallLog.length}`);
    console.log('DEBUG: announcementCallLog:', JSON.stringify(announcementCallLog, null, 2));

    const retweetAnnouncements = announcementCallLog.filter(log => log.channelId === '123456789012345682');
    console.log(`DEBUG: Retweet announcements found: ${retweetAnnouncements.length}`);
  } catch (error) {
    console.error('DEBUG: Error during pollXProfile:', error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  debugRetweetTest().catch(console.error);
}
