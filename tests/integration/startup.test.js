// /home/xush/Documents/prog/discord-bot/tests/integration/startup.test.js
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DependencyContainer } from '../../src/infrastructure/dependency-container.js';
import { Configuration } from '../../src/infrastructure/configuration.js';
import { setupProductionServices } from '../../src/setup/production-setup.js';

describe('Application Startup Integration Test', () => {
  let container;
  let BotApplication, MonitorApplication, ScraperApplication;
  let originalEnv;

  beforeEach(async () => {
    // Save original environment
    originalEnv = process.env;

    // Set required environment variables for tests
    process.env = {
      ...originalEnv,
      X_USER_HANDLE: 'testuser',
      TWITTER_USERNAME: 'testuser',
      TWITTER_PASSWORD: 'testpass',
      DISCORD_BOT_TOKEN: 'test-token',
      DISCORD_SUPPORT_CHANNEL_ID: '123456789012345678',
      DISCORD_ANNOUNCE_CHANNEL_ID: '123456789012345679',
      DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345680',
      DISCORD_X_POSTS_CHANNEL_ID: '123456789012345681',
      DISCORD_X_REPLIES_CHANNEL_ID: '123456789012345682',
      DISCORD_X_QUOTES_CHANNEL_ID: '123456789012345683',
      DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345684',
      YOUTUBE_API_KEY: 'test-key',
      YOUTUBE_CHANNEL_ID: 'UCrAOyUwjSM5zzPz_FqsUhuQ',
      PSH_CALLBACK_URL: 'https://example.com/webhook',
      PSH_SECRET: 'test-secret',
    };

    // Dynamically import and mock the classes
    const botAppModule = await import('../../src/application/bot-application.js');
    BotApplication = botAppModule.BotApplication;
    jest.spyOn(BotApplication.prototype, 'start').mockResolvedValue();
    jest.spyOn(BotApplication.prototype, 'stop').mockResolvedValue();

    const monitorAppModule = await import('../../src/application/monitor-application.js');
    MonitorApplication = monitorAppModule.MonitorApplication;
    jest.spyOn(MonitorApplication.prototype, 'start').mockResolvedValue();
    jest.spyOn(MonitorApplication.prototype, 'stop').mockResolvedValue();

    const scraperAppModule = await import('../../src/application/scraper-application.js');
    ScraperApplication = scraperAppModule.ScraperApplication;
    jest.spyOn(ScraperApplication.prototype, 'start').mockResolvedValue();
    jest.spyOn(ScraperApplication.prototype, 'stop').mockResolvedValue();
  });

  afterEach(async () => {
    if (container) {
      await container.dispose();
    }
    // Restore original environment
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('should initialize the dependency container and setup services without errors', async () => {
    let error;
    try {
      const configuration = new Configuration();
      container = new DependencyContainer();
      // This will throw an error if any services can't be created,
      // including ReferenceErrors for missing functions.
      await setupProductionServices(container, configuration);
    } catch (e) {
      error = e;
    }

    expect(error).toBeUndefined();

    // Verify that key services are registered
    expect(container.isRegistered('logger')).toBe(true);
    expect(container.isRegistered('discordService')).toBe(true);
    expect(container.isRegistered('botApplication')).toBe(true);
  });

  it('should have mocked application start methods available', async () => {
    // Verify that start methods are properly mocked and available
    expect(BotApplication.prototype.start).toBeDefined();
    expect(MonitorApplication.prototype.start).toBeDefined();
    expect(ScraperApplication.prototype.start).toBeDefined();

    // Verify they're mocked functions
    expect(jest.isMockFunction(BotApplication.prototype.start)).toBe(true);
    expect(jest.isMockFunction(MonitorApplication.prototype.start)).toBe(true);
    expect(jest.isMockFunction(ScraperApplication.prototype.start)).toBe(true);
  });
});
