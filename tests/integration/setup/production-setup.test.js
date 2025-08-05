import { jest } from '@jest/globals';

// Mock the dependencies that require external services
jest.unstable_mockModule('discord.js', () => ({
  Client: jest.fn(() => ({
    channels: {
      fetch: jest.fn().mockResolvedValue({ isTextBased: () => true, send: jest.fn() }),
    },
    isReady: jest.fn(() => true),
    login: jest.fn().mockResolvedValue(),
    destroy: jest.fn().mockResolvedValue(),
    on: jest.fn(),
    once: jest.fn(),
  })),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 512,
    MessageContent: 32768,
  },
  Partials: {
    Message: 'Message',
    Channel: 'Channel',
    Reaction: 'Reaction',
  },
}));

jest.unstable_mockModule('googleapis', () => ({
  google: {
    youtube: jest.fn(() => ({})),
  },
}));

jest.unstable_mockModule('playwright', () => ({
  chromium: {
    launch: jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue({
        goto: jest.fn(),
        close: jest.fn(),
      }),
      close: jest.fn(),
    }),
  },
}));

let Configuration, DependencyContainer, setupProductionServices;

describe('Production Setup', () => {
  let container;
  let config;

  beforeAll(async () => {
    ({ Configuration } = await import('../../../src/config/configurations.js'));
    ({ DependencyContainer } = await import('../../../src/infrastructure/dependency-container.js'));
    ({ setupProductionServices } = await import('../../../src/setup/production-setup.js'));
  });

  beforeEach(() => {
    // Create a mock configuration with all required variables
    const configObject = {
      NODE_ENV: 'test',
      DISCORD_BOT_TOKEN: 'test-token',
      YOUTUBE_API_KEY: 'test-api-key',
      YOUTUBE_CHANNEL_ID: 'UCtest-channel1234567890',
      DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345678',
      DISCORD_X_POSTS_CHANNEL_ID: '123456789012345678',
      DISCORD_X_REPLIES_CHANNEL_ID: '123456789012345678',
      DISCORD_X_QUOTES_CHANNEL_ID: '123456789012345678',
      DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345678',
      DISCORD_BOT_SUPPORT_LOG_CHANNEL: '123456789012345678',
      PSH_CALLBACK_URL: 'http://localhost:3000/youtube-webhook',
      PSH_SECRET: 'test-secret',
      X_USER_HANDLE: 'testuser',
      TWITTER_USERNAME: 'testuser',
      TWITTER_PASSWORD: 'testpass',
      ALLOWED_USER_IDS: '123456789012345678',
      LOG_LEVEL: 'info',
    };

    config = new Configuration(configObject);
    container = new DependencyContainer();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should set up all production services without errors', async () => {
    await expect(setupProductionServices(container, config)).resolves.not.toThrow();
  });

  it('should register all required services in the container', async () => {
    await setupProductionServices(container, config);

    // List of services that should be registered
    const expectedServices = [
      'config',
      'eventBus',
      'stateManager',
      'discordService',
      'youtubeService',
      'httpService',
      'expressApp',
      'browserService',
      'commandProcessor',
      'contentClassifier',
      'contentAnnouncer',
      'botApplication',
      'scraperApplication',
      'monitorApplication',
      'logger',
    ];

    for (const serviceName of expectedServices) {
      try {
        container.resolve(serviceName);
      } catch (error) {
        // Fail the test if resolving any service throws an error
        throw new Error(`Failed to resolve service "${serviceName}": ${error.message}`);
      }
    }
  });

  it('should handle optional discord logging channel', async () => {
    // Test without the optional channel
    await expect(setupProductionServices(container, config)).resolves.not.toThrow();

    // Test with the optional channel
    const newConfigMap = new Map(config.config);
    newConfigMap.set('DISCORD_BOT_SUPPORT_LOG_CHANNEL', '0987654321');
    const newConfig = new Configuration(newConfigMap);
    const newContainer = new DependencyContainer();

    await expect(setupProductionServices(newContainer, newConfig)).resolves.not.toThrow();
  });

  it('should successfully import and execute logger setup without mocking', async () => {
    // This test specifically validates the logger import path works in production
    await setupProductionServices(container, config);
    const logger = container.resolve('logger');

    // Test that logger has the expected methods
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');

    // Test that the logger can actually log without throwing
    expect(() => logger.info('Test log message')).not.toThrow();
  });
});
