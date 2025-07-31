/**
 * Application Mock Factory
 * Provides standardized mock dependencies for application classes
 */

import { jest } from '@jest/globals';
import { createEnhancedLoggerMocks, createMockContentCoordinator } from './enhanced-logger-factory.js';

export const createScraperApplicationMocks = () => {
  const enhancedMocks = createEnhancedLoggerMocks();

  return {
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
    contentClassifier: {
      classifyXContent: jest.fn().mockReturnValue({ type: 'post', platform: 'x' }),
    },
    contentAnnouncer: {
      announceContent: jest.fn().mockResolvedValue({ success: true }),
    },
    contentCoordinator: createMockContentCoordinator(),
    config: {
      getRequired: jest.fn().mockImplementation(key => {
        const defaults = {
          X_USER_HANDLE: 'testuser',
          TWITTER_USERNAME: 'testuser@example.com',
          TWITTER_PASSWORD: 'testpass',
        };
        return defaults[key] || 'default-value';
      }),
      get: jest.fn().mockImplementation((key, defaultValue) => {
        const defaults = {
          X_QUERY_INTERVAL_MIN: '300000',
          X_QUERY_INTERVAL_MAX: '600000',
          X_DEBUG_SAMPLING_RATE: '0.1',
          X_VERBOSE_LOG_SAMPLING_RATE: '0.05',
        };
        return defaults[key] || defaultValue;
      }),
      getBoolean: jest.fn().mockReturnValue(false),
    },
    stateManager: {
      get: jest.fn(),
      set: jest.fn(),
    },
    discordService: {
      login: jest.fn(),
    },
    eventBus: {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    },
    xAuthManager: {
      login: jest.fn(),
      clickNextButton: jest.fn(),
      clickLoginButton: jest.fn(),
      isAuthenticated: jest.fn(),
      ensureAuthenticated: jest.fn(),
    },
    duplicateDetector: {
      isDuplicate: jest.fn().mockReturnValue(false),
      markAsSeen: jest.fn(),
      getStats: jest.fn().mockReturnValue({ totalSeen: 0, totalChecked: 0 }),
    },
    persistentStorage: {
      get: jest.fn(),
      set: jest.fn(),
    },
    ...enhancedMocks,
  };
};

export const createMonitorApplicationMocks = () => {
  const enhancedMocks = createEnhancedLoggerMocks();

  return {
    youtubeService: {
      getChannelDetails: jest.fn(),
      getVideoDetails: jest.fn(),
      getChannelVideos: jest.fn(),
      getScheduledContent: jest.fn(),
      checkScheduledContentStates: jest.fn(),
    },
    httpService: {
      post: jest.fn(),
      isSuccessResponse: jest.fn(),
    },
    contentClassifier: {
      classifyYouTubeContent: jest.fn(),
    },
    contentAnnouncer: {
      announceContent: jest.fn(),
    },
    contentCoordinator: createMockContentCoordinator(),
    config: {
      getRequired: jest.fn(),
      get: jest.fn(),
      getNumber: jest.fn(),
      getBoolean: jest.fn().mockReturnValue(false),
    },
    stateManager: {
      get: jest.fn(),
    },
    eventBus: {
      emit: jest.fn(),
    },
    contentStateManager: {
      hasContent: jest.fn(),
      addContent: jest.fn(),
      getContentByState: jest.fn(),
      getContentState: jest.fn(),
    },
    livestreamStateMachine: {
      transitionState: jest.fn(),
    },
    persistentStorage: {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    },
    ...enhancedMocks,
  };
};

export const createContentAnnouncerMocks = () => {
  const enhancedMocks = createEnhancedLoggerMocks();

  return {
    discordService: {
      sendMessage: jest.fn().mockResolvedValue({ success: true }),
      getChannel: jest.fn().mockResolvedValue({ id: 'channel-123' }),
    },
    config: {
      get: jest.fn().mockImplementation((key, defaultValue) => {
        const defaults = {
          DISCORD_X_CHANNEL_ID: 'x-channel-123',
          DISCORD_YOUTUBE_CHANNEL_ID: 'youtube-channel-123',
          VX_TWITTER_ENABLED: 'false',
          ANNOUNCE_OLD_TWEETS: 'false',
        };
        return defaults[key] || defaultValue;
      }),
      getBoolean: jest.fn().mockImplementation((key, defaultValue) => {
        const booleanDefaults = {
          VX_TWITTER_ENABLED: false,
          ANNOUNCE_OLD_TWEETS: false,
          POSTING_ENABLED: true,
          ANNOUNCEMENTS_ENABLED: true,
        };
        return booleanDefaults[key] !== undefined ? booleanDefaults[key] : defaultValue;
      }),
    },
    stateManager: {
      get: jest.fn().mockImplementation(key => {
        if (key === 'botStartTime') {
          return new Date('2024-01-01T00:00:00.000Z').toISOString();
        }
        return null;
      }),
    },
    ...enhancedMocks,
  };
};
