import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock external dependencies to prevent browser launch in tests
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
const { ScraperApplication } = await import('../../src/application/scraper-application.js');

describe('Browser Service Dependency Injection', () => {
  let container;
  let config;
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = process.env;

    // Set up test environment
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

  describe('Browser Service Registration', () => {
    it('should register X browser service in container', async () => {
      await setupProductionServices(container, config);

      const xBrowserService = container.resolve('xBrowserService');
      expect(xBrowserService).toBeDefined();
      expect(xBrowserService).toHaveProperty('launch');
      expect(xBrowserService).toHaveProperty('close');
      expect(xBrowserService).toHaveProperty('isRunning');
    });

    it('should inject browser service into scraper application', async () => {
      await setupProductionServices(container, config);

      const scraperApp = container.resolve('scraperApplication');
      expect(scraperApp).toBeDefined();
      expect(scraperApp.browser).toBeDefined();
      expect(scraperApp.browser).not.toBeNull();
    });

    it('should provide browser service with required methods', async () => {
      await setupProductionServices(container, config);

      const browserService = container.resolve('xBrowserService');

      // Check all required methods exist
      const requiredMethods = [
        'launch',
        'newPage',
        'goto',
        'waitForSelector',
        'waitForNavigation',
        'evaluate',
        'type',
        'click',
        'getTextContent',
        'getAttribute',
        'screenshot',
        'setCookies',
        'getCookies',
        'setUserAgent',
        'setViewport',
        'waitFor',
        'getContent',
        'getCurrentUrl',
        'elementExists',
        'getElements',
        'closePage',
        'close',
        'isRunning',
      ];

      for (const method of requiredMethods) {
        expect(browserService).toHaveProperty(method);
        expect(typeof browserService[method]).toBe('function');
      }
    });
  });

  describe('Scraper Application Browser Integration', () => {
    it('should fail gracefully when browser service is null', () => {
      // Test the old behavior to ensure we catch it
      expect(() => {
        new ScraperApplication({
          browserService: null,
          contentCoordinator: {},
          contentClassifier: {},
          discordService: {},
          config,
          stateManager: { get: () => ({}) },
          eventBus: { emit: jest.fn() },
          logger: { info: jest.fn(), error: jest.fn(), child: jest.fn().mockReturnThis() },
          xAuthManager: {},
          duplicateDetector: {},
          persistentStorage: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
          debugManager: { isEnabled: jest.fn(() => false) },
          metricsManager: { recordMetric: jest.fn() },
        });
      }).not.toThrow();
    });

    it('should throw error when trying to start with null browser service', async () => {
      const scraperApp = new ScraperApplication({
        browserService: null,
        contentCoordinator: {},
        contentClassifier: {},
        discordService: {},
        config,
        stateManager: { get: () => ({}) },
        eventBus: { emit: jest.fn() },
        logger: { info: jest.fn(), error: jest.fn(), child: jest.fn().mockReturnThis() },
        xAuthManager: {},
        duplicateDetector: {},
        persistentStorage: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
        debugManager: { isEnabled: jest.fn(() => false) },
        metricsManager: { recordMetric: jest.fn() },
      });

      await expect(scraperApp.start()).rejects.toThrow();
    });

    it('should successfully initialize with proper browser service', async () => {
      await setupProductionServices(container, config);

      const scraperApp = container.resolve('scraperApplication');
      expect(scraperApp.browser).toBeDefined();
      expect(scraperApp.browser).not.toBeNull();
      expect(typeof scraperApp.browser.launch).toBe('function');
    });
  });

  describe('Browser Service Lifecycle', () => {
    it('should start browser service in not running state', async () => {
      await setupProductionServices(container, config);

      const browserService = container.resolve('xBrowserService');
      expect(browserService.isRunning()).toBe(false);
    });

    it('should handle browser service disposal', async () => {
      await setupProductionServices(container, config);

      const browserService = container.resolve('xBrowserService');

      // Should not throw when disposing
      await expect(browserService.dispose()).resolves.not.toThrow();
    });
  });

  describe('Configuration Validation', () => {
    it('should validate X scraper configuration requirements', () => {
      expect(config.get('X_USER_HANDLE')).toBe('testuser');
      expect(config.get('TWITTER_USERNAME')).toBe('testuser');
      expect(config.get('TWITTER_PASSWORD')).toBe('testpass');
    });

    it('should catch missing browser service configuration', async () => {
      // Mock setupProductionServices to not register browser service
      const brokenContainer = new DependencyContainer();

      // Register everything except browser service
      brokenContainer.registerSingleton('scraperApplication', () => {
        return new ScraperApplication({
          browserService: null, // This should cause issues
          contentCoordinator: {},
          contentClassifier: {},
          discordService: {},
          config,
          stateManager: { get: () => ({}) },
          eventBus: { emit: jest.fn() },
          logger: { info: jest.fn(), error: jest.fn(), child: jest.fn().mockReturnThis() },
          xAuthManager: {},
          duplicateDetector: {},
          persistentStorage: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
          debugManager: { isEnabled: jest.fn(() => false) },
          metricsManager: { recordMetric: jest.fn() },
        });
      });

      const scraperApp = brokenContainer.resolve('scraperApplication');

      // Should fail when trying to start
      await expect(scraperApp.start()).rejects.toThrow();
    });
  });
});
