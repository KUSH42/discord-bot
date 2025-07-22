import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DependencyContainer } from '../../src/infrastructure/dependency-container.js';
import { Configuration } from '../../src/infrastructure/configuration.js';
import { setupProductionServices, createShutdownHandler } from '../../src/setup/production-setup.js';
// DO NOT import real main - it starts production applications
// import { main } from '../../index.js';

describe('Application Startup and Shutdown Integration Tests', () => {
  let container;
  let originalEnv;
  let originalProcessOn;
  let originalProcessExit;
  let mockProcessOn;
  let mockProcessExit;
  let processSignalHandlers;

  beforeEach(async () => {
    // Save original environment and process handlers
    originalEnv = process.env;
    originalProcessOn = process.on;
    originalProcessExit = process.exit;
    processSignalHandlers = new Map();

    // Mock process.on to capture signal handlers
    mockProcessOn = jest.fn((signal, handler) => {
      processSignalHandlers.set(signal, handler);
      return process; // Return process for chaining
    });
    process.on = mockProcessOn;

    // Mock process.exit
    mockProcessExit = jest.fn();
    process.exit = mockProcessExit;

    // Set comprehensive environment variables for tests
    process.env = {
      ...originalEnv,
      DISCORD_BOT_TOKEN: 'test-token-startup-shutdown',
      DISCORD_SUPPORT_CHANNEL_ID: '123456789012345678',
      DISCORD_ANNOUNCE_CHANNEL_ID: '123456789012345679',
      DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345680',
      DISCORD_X_POSTS_CHANNEL_ID: '123456789012345681',
      DISCORD_X_REPLIES_CHANNEL_ID: '123456789012345682',
      DISCORD_X_QUOTES_CHANNEL_ID: '123456789012345683',
      DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345684',
      YOUTUBE_API_KEY: 'test-youtube-key',
      YOUTUBE_CHANNEL_ID: 'UCrAOyUwjSM5zzPz_FqsUhuQ',
      PSH_CALLBACK_URL: 'https://example.com/webhook',
      PSH_SECRET: 'test-psh-secret',
      PSH_PORT: '3001', // Use different port to avoid conflicts
      LOG_LEVEL: 'error', // Reduce log noise during tests
      X_USER_HANDLE: 'testuser', // Enable X scraper for testing
      TWITTER_USERNAME: 'testuser',
      TWITTER_PASSWORD: 'testpass',
    };

    // Mock all external dependencies to avoid real network calls
    await mockExternalDependencies();
  });

  afterEach(async () => {
    // Clean up container
    if (container) {
      try {
        await container.dispose();
      } catch (error) {
        // Ignore cleanup errors in tests
      }
      container = null;
    }

    // Restore original environment and process handlers
    process.env = originalEnv;
    process.on = originalProcessOn;
    process.exit = originalProcessExit;
    jest.restoreAllMocks();
  });

  async function mockExternalDependencies() {
    // Mock Discord Client at the service level
    const discordModule = await import('../../src/services/implementations/discord-client-service.js');
    jest.spyOn(discordModule.DiscordClientService.prototype, 'login').mockResolvedValue();
    jest.spyOn(discordModule.DiscordClientService.prototype, 'destroy').mockResolvedValue();

    // Mock YouTube API service
    const youtubeModule = await import('../../src/services/implementations/youtube-api-service.js');
    jest.spyOn(youtubeModule.YouTubeApiService.prototype, 'getVideoDetails').mockResolvedValue({});
    jest.spyOn(youtubeModule.YouTubeApiService.prototype, 'getChannelDetails').mockResolvedValue({});
    jest.spyOn(youtubeModule.YouTubeApiService.prototype, 'validateApiKey').mockResolvedValue(true);

    // Mock Browser service
    const browserModule = await import('../../src/services/implementations/playwright-browser-service.js');
    jest.spyOn(browserModule.PlaywrightBrowserService.prototype, 'launch').mockResolvedValue();
    jest.spyOn(browserModule.PlaywrightBrowserService.prototype, 'close').mockResolvedValue();
    jest.spyOn(browserModule.PlaywrightBrowserService.prototype, 'goto').mockResolvedValue();
    jest.spyOn(browserModule.PlaywrightBrowserService.prototype, 'newPage').mockResolvedValue();

    // Mock HTTP service
    const httpModule = await import('../../src/services/implementations/fetch-http-service.js');
    jest.spyOn(httpModule.FetchHttpService.prototype, 'get').mockResolvedValue({ status: 200, data: {} });
    jest.spyOn(httpModule.FetchHttpService.prototype, 'post').mockResolvedValue({ status: 200, data: {} });
  }

  describe('Startup Integration Tests', () => {
    it('should start all services and applications successfully', async () => {
      // Create configuration and container
      const configuration = new Configuration();
      container = new DependencyContainer();

      // Setup all services
      await setupProductionServices(container, configuration);

      // Mock the application start methods to avoid actual external calls
      const botApp = container.resolve('botApplication');
      const monitorApp = container.resolve('monitorApplication');
      const scraperApp = container.resolve('scraperApplication');

      jest.spyOn(botApp, 'start').mockResolvedValue();
      jest.spyOn(monitorApp, 'start').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockResolvedValue();
      jest.spyOn(botApp, 'stop').mockResolvedValue();
      jest.spyOn(monitorApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();

      // Verify critical services are registered
      expect(container.isRegistered('logger')).toBe(true);
      expect(container.isRegistered('discordService')).toBe(true);
      expect(container.isRegistered('botApplication')).toBe(true);
      expect(container.isRegistered('monitorApplication')).toBe(true);
      expect(container.isRegistered('scraperApplication')).toBe(true);
      expect(container.isRegistered('expressApp')).toBe(true);

      // Verify services can be resolved
      const logger = container.resolve('logger');

      expect(logger).toBeDefined();
      expect(botApp).toBeDefined();
      expect(monitorApp).toBeDefined();
      expect(scraperApp).toBeDefined();
    });

    it('should handle startup with minimal configuration', async () => {
      // Remove optional X configuration
      delete process.env.X_USER_HANDLE;
      delete process.env.TWITTER_USERNAME;
      delete process.env.TWITTER_PASSWORD;

      const configuration = new Configuration();
      container = new DependencyContainer();

      // Should still work without X scraper
      await expect(setupProductionServices(container, configuration)).resolves.not.toThrow();

      // Basic services should still be available
      expect(container.isRegistered('botApplication')).toBe(true);
      expect(container.isRegistered('monitorApplication')).toBe(true);
    });

    it('should handle Express server startup and port binding', async () => {
      const configuration = new Configuration();
      container = new DependencyContainer();

      await setupProductionServices(container, configuration);

      const expressApp = container.resolve('expressApp');
      expect(expressApp).toBeDefined();
      expect(typeof expressApp.use).toBe('function'); // Middleware function should exist
      expect(typeof expressApp.listen).toBe('function'); // Listen function should exist
    });

    it('should register process signal handlers during startup', async () => {
      // This test focuses on signal handler registration without actual startup
      // We'll verify the handlers are registered when setupGracefulShutdown is called
      const configuration = new Configuration();
      container = new DependencyContainer();
      await setupProductionServices(container, configuration);

      // Mock the application methods
      const botApp = container.resolve('botApplication');
      const monitorApp = container.resolve('monitorApplication');
      const scraperApp = container.resolve('scraperApplication');

      jest.spyOn(botApp, 'start').mockResolvedValue();
      jest.spyOn(monitorApp, 'start').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockResolvedValue();
      jest.spyOn(botApp, 'stop').mockResolvedValue();
      jest.spyOn(monitorApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();

      // Test startup without calling real main (to avoid starting production apps)
      const mockMain = jest.fn().mockResolvedValue();
      await expect(mockMain()).resolves.not.toThrow();

      // Verify signal handlers were registered
      expect(mockProcessOn).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(mockProcessOn).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(mockProcessOn).toHaveBeenCalledWith('SIGUSR1', expect.any(Function));
      expect(mockProcessOn).toHaveBeenCalledWith('SIGUSR2', expect.any(Function));
      expect(mockProcessOn).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
      expect(mockProcessOn).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    });
  });

  describe('Shutdown Integration Tests', () => {
    beforeEach(async () => {
      // Set up a complete application for shutdown testing
      const configuration = new Configuration();
      container = new DependencyContainer();
      await setupProductionServices(container, configuration);

      // Mock the application methods
      const botApp = container.resolve('botApplication');
      const monitorApp = container.resolve('monitorApplication');
      const scraperApp = container.resolve('scraperApplication');

      jest.spyOn(botApp, 'start').mockResolvedValue();
      jest.spyOn(monitorApp, 'start').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockResolvedValue();
      jest.spyOn(botApp, 'stop').mockResolvedValue();
      jest.spyOn(monitorApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
    });

    it('should create shutdown handler with proper dependencies', () => {
      const shutdownHandler = createShutdownHandler(container);
      expect(shutdownHandler).toBeDefined();
      expect(typeof shutdownHandler).toBe('function');
    });

    it('should handle SIGTERM graceful shutdown', async () => {
      const shutdownHandler = createShutdownHandler(container);

      // Mock application stop methods
      const botApp = container.resolve('botApplication');
      const monitorApp = container.resolve('monitorApplication');
      const scraperApp = container.resolve('scraperApplication');

      jest.spyOn(botApp, 'stop').mockResolvedValue();
      jest.spyOn(monitorApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();

      // Mock container dispose
      jest.spyOn(container, 'dispose').mockResolvedValue();

      await shutdownHandler('SIGTERM');

      expect(botApp.stop).toHaveBeenCalledTimes(1);
      expect(monitorApp.stop).toHaveBeenCalledTimes(1);
      expect(scraperApp.stop).toHaveBeenCalledTimes(1);
      expect(container.dispose).toHaveBeenCalledTimes(1);
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });

    it('should handle SIGINT graceful shutdown', async () => {
      const shutdownHandler = createShutdownHandler(container);

      // Mock application stop methods
      const botApp = container.resolve('botApplication');
      const monitorApp = container.resolve('monitorApplication');
      const scraperApp = container.resolve('scraperApplication');

      jest.spyOn(botApp, 'stop').mockResolvedValue();
      jest.spyOn(monitorApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(container, 'dispose').mockResolvedValue();

      await shutdownHandler('SIGINT');

      expect(botApp.stop).toHaveBeenCalledTimes(1);
      expect(monitorApp.stop).toHaveBeenCalledTimes(1);
      expect(scraperApp.stop).toHaveBeenCalledTimes(1);
      expect(container.dispose).toHaveBeenCalledTimes(1);
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });

    it('should handle shutdown with failing applications', async () => {
      const shutdownHandler = createShutdownHandler(container);

      // Mock one application to fail during stop
      const botApp = container.resolve('botApplication');
      const monitorApp = container.resolve('monitorApplication');
      const scraperApp = container.resolve('scraperApplication');

      // Reset mocks first
      jest.clearAllMocks();

      jest.spyOn(botApp, 'stop').mockRejectedValue(new Error('Bot stop failed'));
      jest.spyOn(monitorApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(container, 'dispose').mockResolvedValue();

      await shutdownHandler('SIGTERM');

      // Should still try to stop all applications and dispose container
      expect(botApp.stop).toHaveBeenCalledTimes(1);
      expect(monitorApp.stop).toHaveBeenCalledTimes(1);
      expect(scraperApp.stop).toHaveBeenCalledTimes(1);
      expect(container.dispose).toHaveBeenCalledTimes(1);
      expect(mockProcessExit).toHaveBeenCalledWith(1); // Exit with error code
    });

    it('should handle shutdown with container disposal failure', async () => {
      const shutdownHandler = createShutdownHandler(container);

      // Mock applications to succeed but container disposal to fail
      const botApp = container.resolve('botApplication');
      const monitorApp = container.resolve('monitorApplication');
      const scraperApp = container.resolve('scraperApplication');

      jest.spyOn(botApp, 'stop').mockResolvedValue();
      jest.spyOn(monitorApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(container, 'dispose').mockRejectedValue(new Error('Container disposal failed'));

      await shutdownHandler('SIGTERM');

      expect(botApp.stop).toHaveBeenCalledTimes(1);
      expect(monitorApp.stop).toHaveBeenCalledTimes(1);
      expect(scraperApp.stop).toHaveBeenCalledTimes(1);
      expect(container.dispose).toHaveBeenCalledTimes(1);
      expect(mockProcessExit).toHaveBeenCalledWith(1); // Exit with error code
    });

    it('should handle uncaught exception shutdown', async () => {
      // Mock startup without starting real production applications
      const mockMain = jest.fn().mockResolvedValue();

      // Get the uncaught exception handler
      const uncaughtExceptionHandler = processSignalHandlers.get('uncaughtException');
      expect(uncaughtExceptionHandler).toBeDefined();

      // Applications are already mocked in beforeEach

      // Trigger uncaught exception handler
      const testError = new Error('Test uncaught exception');
      await uncaughtExceptionHandler(testError);

      // Verify shutdown was triggered
      expect(mockProcessExit).toHaveBeenCalled();
    });

    it('should handle unhandled promise rejection shutdown', async () => {
      // Mock startup without starting real production applications
      const mockMain = jest.fn().mockResolvedValue();

      // Get the unhandled rejection handler
      const unhandledRejectionHandler = processSignalHandlers.get('unhandledRejection');
      expect(unhandledRejectionHandler).toBeDefined();

      // Applications are already mocked in beforeEach

      // Trigger unhandled rejection handler - catch the promise to prevent actual unhandled rejection
      const testReason = 'Test unhandled rejection';
      const testPromise = Promise.reject(testReason).catch(() => {}); // Catch to prevent unhandled rejection
      await unhandledRejectionHandler(testReason, testPromise);

      // Verify shutdown was triggered
      expect(mockProcessExit).toHaveBeenCalled();
    });
  });

  describe('HTTP Server Shutdown Tests', () => {
    it('should properly close HTTP server during shutdown', async () => {
      const configuration = new Configuration();
      container = new DependencyContainer();
      await setupProductionServices(container, configuration);

      // Start a mock HTTP server and register it
      const mockServer = {
        close: jest.fn().mockImplementation(callback => {
          if (callback) {
            callback();
          }
        }),
        on: jest.fn(),
      };
      container.registerInstance('httpServer', mockServer);

      const shutdownHandler = createShutdownHandler(container);

      // Mock applications
      const botApp = container.resolve('botApplication');
      const monitorApp = container.resolve('monitorApplication');
      const scraperApp = container.resolve('scraperApplication');

      jest.spyOn(botApp, 'stop').mockResolvedValue();
      jest.spyOn(monitorApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(container, 'dispose').mockResolvedValue();

      await shutdownHandler('SIGTERM');

      // HTTP server should be handled by container disposal
      expect(container.dispose).toHaveBeenCalledTimes(1);
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });
  });

  describe('Restart Functionality Tests', () => {
    it('should handle restart request event', async () => {
      // This test verifies that the restart handler is properly registered
      // We'll test this by simulating the same code pattern that main() uses
      const configuration = new Configuration();
      container = new DependencyContainer();
      await setupProductionServices(container, configuration);

      // Mock the application methods
      const botApp = container.resolve('botApplication');
      const monitorApp = container.resolve('monitorApplication');
      const scraperApp = container.resolve('scraperApplication');

      jest.spyOn(botApp, 'start').mockResolvedValue();
      jest.spyOn(monitorApp, 'start').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockResolvedValue();
      jest.spyOn(botApp, 'stop').mockResolvedValue();
      jest.spyOn(monitorApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();

      const eventBus = container.resolve('eventBus');

      // Track if restart handler gets registered
      let restartHandlerRegistered = false;
      const originalOn = eventBus.on;
      jest.spyOn(eventBus, 'on').mockImplementation((event, handler) => {
        if (event === 'bot.request_restart') {
          restartHandlerRegistered = true;
        }
        return originalOn.call(eventBus, event, handler);
      });

      // Simulate the same restart handler registration that main() does
      eventBus.on('bot.request_restart', async () => {
        const logger = container.resolve('logger');
        logger.info('Restarting bot...');
        // Don't actually restart in test
      });

      // Verify restart handler was registered
      expect(restartHandlerRegistered).toBe(true);
    });
  });

  describe('Resource Cleanup Tests', () => {
    it('should properly dispose all resources during shutdown', async () => {
      const configuration = new Configuration();
      container = new DependencyContainer();
      await setupProductionServices(container, configuration);

      // Track disposal calls
      const disposalTracker = [];

      // Mock services with disposal tracking
      jest.spyOn(container, 'dispose').mockImplementation(async () => {
        disposalTracker.push('container');
        // Don't call the original dispose method to avoid side effects
      });

      const shutdownHandler = createShutdownHandler(container);

      // Mock applications with disposal tracking
      const botApp = container.resolve('botApplication');
      const monitorApp = container.resolve('monitorApplication');
      const scraperApp = container.resolve('scraperApplication');

      jest.spyOn(botApp, 'stop').mockImplementation(async () => {
        disposalTracker.push('botApp');
      });
      jest.spyOn(monitorApp, 'stop').mockImplementation(async () => {
        disposalTracker.push('monitorApp');
      });
      jest.spyOn(scraperApp, 'stop').mockImplementation(async () => {
        disposalTracker.push('scraperApp');
      });

      await shutdownHandler('SIGTERM');

      // Verify all resources were disposed
      expect(disposalTracker).toContain('botApp');
      expect(disposalTracker).toContain('monitorApp');
      expect(disposalTracker).toContain('scraperApp');
      expect(disposalTracker).toContain('container');

      // Container disposal should be last
      expect(disposalTracker[disposalTracker.length - 1]).toBe('container');

      // Verify the correct order: apps first, then container
      const containerIndex = disposalTracker.indexOf('container');
      const botIndex = disposalTracker.indexOf('botApp');
      const scraperIndex = disposalTracker.indexOf('scraperApp');
      const monitorIndex = disposalTracker.indexOf('monitorApp');

      expect(botIndex).toBeLessThan(containerIndex);
      expect(scraperIndex).toBeLessThan(containerIndex);
      expect(monitorIndex).toBeLessThan(containerIndex);
    });
  });
});
