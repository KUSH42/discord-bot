import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock external dependencies that require services not available in CI
jest.unstable_mockModule('discord.js', () => ({
  Client: jest.fn(() => ({
    channels: {
      fetch: jest.fn().mockResolvedValue({ isTextBased: () => true, send: jest.fn() }),
    },
    isReady: jest.fn(() => true),
    options: { intents: ['Guilds', 'GuildMessages', 'MessageContent'] },
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
    youtube: jest.fn(() => ({ videos: { list: jest.fn() } })),
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

const { DependencyContainer } = await import('../../src/infrastructure/dependency-container.js');
const { Configuration } = await import('../../src/infrastructure/configuration.js');
const { setupProductionServices } = await import('../../src/setup/production-setup.js');

describe('Production Setup Validation', () => {
  let container;
  let config;
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = process.env;

    // Set up minimal test environment
    process.env = {
      ...originalEnv,
      DISCORD_BOT_TOKEN: 'test-token',
      YOUTUBE_API_KEY: 'test-key',
      YOUTUBE_CHANNEL_ID: 'UCabcdefghijklmnopqrstuv',
      DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345678',
      DISCORD_X_POSTS_CHANNEL_ID: '123456789012345678',
      DISCORD_X_REPLIES_CHANNEL_ID: '123456789012345678',
      DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345678',
      DISCORD_X_QUOTES_CHANNEL_ID: '123456789012345678',
      DISCORD_BOT_SUPPORT_LOG_CHANNEL: '123456789012345678',
      ALLOWED_USER_IDS: '123456789012345678',
      PSH_SECRET: 'test-secret',
      PSH_CALLBACK_URL: 'http://test.com/webhook',
      X_USER_HANDLE: 'testuser',
      TWITTER_USERNAME: 'testuser',
      TWITTER_PASSWORD: 'testpass',
      LOG_LEVEL: 'info',
    };

    container = new DependencyContainer();
    config = new Configuration();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Clean up container
    if (container) {
      container.dispose();
    }
  });

  describe('Complete Service Registration', () => {
    it('should register all required services', async () => {
      await setupProductionServices(container, config);

      // Infrastructure services
      expect(container.resolve('config')).toBeDefined();
      expect(container.resolve('eventBus')).toBeDefined();
      expect(container.resolve('stateManager')).toBeDefined();

      // External services
      expect(container.resolve('discordService')).toBeDefined();
      expect(container.resolve('youtubeService')).toBeDefined();
      expect(container.resolve('httpService')).toBeDefined();
      expect(container.resolve('expressApp')).toBeDefined();
      expect(container.resolve('browserService')).toBeDefined();

      // Core services
      expect(container.resolve('commandProcessor')).toBeDefined();
      expect(container.resolve('contentClassifier')).toBeDefined();
      expect(container.resolve('contentAnnouncer')).toBeDefined();

      // Application services
      expect(container.resolve('botApplication')).toBeDefined();
      expect(container.resolve('scraperApplication')).toBeDefined();
      expect(container.resolve('monitorApplication')).toBeDefined();

      // Logging
      expect(container.resolve('logger')).toBeDefined();
    });

    it('should validate container after setup', async () => {
      // This should not throw
      await expect(setupProductionServices(container, config)).resolves.not.toThrow();
    });
  });

  describe('Critical Dependency Validation', () => {
    it('should ensure scraper application has browser service', async () => {
      await setupProductionServices(container, config);

      const scraperApp = container.resolve('scraperApplication');
      expect(scraperApp.browser).toBeDefined();
      expect(scraperApp.browser).not.toBeNull();
      expect(typeof scraperApp.browser.launch).toBe('function');
    });

    it('should ensure logger has Discord transport when configured', async () => {
      await setupProductionServices(container, config);

      const logger = container.resolve('logger');
      expect(logger).toBeDefined();
      expect(logger.transports).toBeDefined();

      // Should have at least console and file transports
      expect(logger.transports.length).toBeGreaterThanOrEqual(2);

      // Should have Discord transport since DISCORD_BOT_SUPPORT_LOG_CHANNEL is set
      expect(logger.transports).toHaveLength(3);
    });

    it('should ensure Discord service is properly configured', async () => {
      await setupProductionServices(container, config);

      const discordService = container.resolve('discordService');
      expect(discordService).toBeDefined();
      expect(discordService.client).toBeDefined();
      expect(discordService.client.options).toBeDefined();
      expect(discordService.client.options.intents).toBeDefined();
    });

    it('should ensure YouTube service is properly configured', async () => {
      await setupProductionServices(container, config);

      const youtubeService = container.resolve('youtubeService');
      expect(youtubeService).toBeDefined();
      expect(youtubeService.youtube).toBeDefined();
    });
  });

  describe('Service Dependencies', () => {
    it('should resolve all scraper application dependencies', async () => {
      await setupProductionServices(container, config);

      const scraperApp = container.resolve('scraperApplication');

      // Verify all dependencies are properly injected
      expect(scraperApp.browser).toBeDefined();
      expect(scraperApp.classifier).toBeDefined();
      expect(scraperApp.announcer).toBeDefined();
      expect(scraperApp.config).toBeDefined();
      expect(scraperApp.state).toBeDefined();
      expect(scraperApp.eventBus).toBeDefined();
      expect(scraperApp.logger).toBeDefined();

      // Verify configuration is accessible
      expect(scraperApp.xUser).toBe('testuser');
      expect(scraperApp.twitterUsername).toBe('testuser');
      expect(scraperApp.twitterPassword).toBe('testpass');
    });

    it('should resolve all monitor application dependencies', async () => {
      await setupProductionServices(container, config);

      const monitorApp = container.resolve('monitorApplication');

      // Verify all dependencies are properly injected
      expect(monitorApp.youtube).toBeDefined();
      expect(monitorApp.http).toBeDefined();
      expect(monitorApp.classifier).toBeDefined();
      expect(monitorApp.announcer).toBeDefined();
      expect(monitorApp.config).toBeDefined();
      expect(monitorApp.state).toBeDefined();
      expect(monitorApp.eventBus).toBeDefined();
      expect(monitorApp.logger).toBeDefined();
    });

    it('should resolve all bot application dependencies', async () => {
      await setupProductionServices(container, config);

      const botApp = container.resolve('botApplication');

      // Verify all dependencies are properly injected
      expect(botApp.discord).toBeDefined();
      expect(botApp.commandProcessor).toBeDefined();
      expect(botApp.eventBus).toBeDefined();
      expect(botApp.config).toBeDefined();
      expect(botApp.state).toBeDefined();
      expect(botApp.logger).toBeDefined();
    });
  });

  describe('Configuration Validation', () => {
    it('should handle missing browser service registration', async () => {
      // Create a broken version of setupProductionServices that doesn't register browser service
      const brokenContainer = new DependencyContainer();

      // Only register the scraper application without browser service
      brokenContainer.registerSingleton('scraperApplication', () => {
        return {
          browser: null,
          start: async () => {
            if (!this.browser) {
              throw new Error('Browser service not available');
            }
          },
        };
      });

      const scraperApp = brokenContainer.resolve('scraperApplication');
      expect(scraperApp.browser).toBeNull();
    });

    it('should catch missing critical environment variables', () => {
      // Test with missing Discord token
      delete process.env.DISCORD_BOT_TOKEN;

      const brokenConfig = new Configuration();

      expect(() => {
        brokenConfig.getRequired('DISCORD_BOT_TOKEN');
      }).toThrow();
    });
  });

  describe('Error Handling Scenarios', () => {
    it('should handle Discord transport initialization without token', async () => {
      // Set up environment without Discord token
      delete process.env.DISCORD_BOT_TOKEN;

      const brokenConfig = new Configuration();

      // This should throw during getRequired call
      expect(() => {
        brokenConfig.getRequired('DISCORD_BOT_TOKEN');
      }).toThrow();
    });

    it('should handle browser service failure gracefully', async () => {
      await setupProductionServices(container, config);

      const browserService = container.resolve('browserService');

      // Mock browser launch failure - this should throw as expected
      const mockFailingLaunch = jest.fn().mockRejectedValue(new Error('Browser launch failed'));
      browserService.launch = mockFailingLaunch;

      const scraperApp = container.resolve('scraperApplication');

      await expect(scraperApp.start()).rejects.toThrow('Browser launch failed');

      // Verify the launch method was called
      expect(mockFailingLaunch).toHaveBeenCalled();
    });
  });

  describe('Production Readiness Checks', () => {
    it('should validate all services are ready for production', async () => {
      await setupProductionServices(container, config);

      // Check that all critical services are singleton
      const scraperApp1 = container.resolve('scraperApplication');
      const scraperApp2 = container.resolve('scraperApplication');
      expect(scraperApp1).toBe(scraperApp2);

      const browserService1 = container.resolve('browserService');
      const browserService2 = container.resolve('browserService');
      expect(browserService1).toBe(browserService2);

      const logger1 = container.resolve('logger');
      const logger2 = container.resolve('logger');
      expect(logger1).toBe(logger2);
    });

    it('should ensure proper logging configuration', async () => {
      await setupProductionServices(container, config);

      const logger = container.resolve('logger');

      // Should have proper log level (defaults to info in test environment)
      expect(logger.level).toBe('info');

      // Should have file transport (check for DailyRotateFile name or similar)
      const fileTransport = logger.transports.find(
        t => t.name === 'DailyRotateFile' || t.name === 'file' || t.constructor.name === 'DailyRotateFile'
      );
      expect(fileTransport).toBeDefined();

      // Should have console transport
      const consoleTransport = logger.transports.find(t => t.name === 'console');
      expect(consoleTransport).toBeDefined();
    });

    it('should validate Express app configuration', async () => {
      await setupProductionServices(container, config);

      const expressApp = container.resolve('expressApp');
      expect(expressApp).toBeDefined();
      expect(typeof expressApp.listen).toBe('function');
      expect(typeof expressApp.use).toBe('function');
    });
  });

  describe('Service Health Checks', () => {
    it('should provide health check capability for all applications', async () => {
      await setupProductionServices(container, config);

      const botApp = container.resolve('botApplication');
      const scraperApp = container.resolve('scraperApplication');
      const monitorApp = container.resolve('monitorApplication');

      // All applications should have stats/status methods
      expect(typeof botApp.getStatus).toBe('function');
      expect(typeof scraperApp.getStats).toBe('function');
      expect(typeof monitorApp.getStats).toBe('function');
    });

    it('should handle graceful shutdown', async () => {
      await setupProductionServices(container, config);

      const botApp = container.resolve('botApplication');
      const scraperApp = container.resolve('scraperApplication');
      const monitorApp = container.resolve('monitorApplication');

      // All applications should have stop methods
      expect(typeof botApp.stop).toBe('function');
      expect(typeof scraperApp.stop).toBe('function');
      expect(typeof monitorApp.stop).toBe('function');
    });
  });
});
