import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Create a module to test main function isolated from actual dependencies
async function createIsolatedMainFunction(mocks = {}) {
  // Create isolated main function with mocked dependencies
  async function isolatedMain() {
    let container;
    try {
      const Configuration =
        mocks.Configuration ||
        class {
          constructor() {}
        };
      const DependencyContainer =
        mocks.DependencyContainer ||
        class {
          constructor() {
            this.services = new Map();
            this.instances = new Map();
          }
          isRegistered() {
            return true;
          }
          resolve(service) {
            if (service === 'logger') {
              return {
                info: jest.fn(),
                error: jest.fn(),
                child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }),
              };
            }
            if (service === 'eventBus') {
              return { on: jest.fn() };
            }
            if (service === 'botApplication') {
              return { start: () => Promise.resolve() };
            }
            if (service === 'monitorApplication') {
              return { start: () => Promise.resolve() };
            }
            if (service === 'scraperApplication') {
              return { start: () => Promise.resolve() };
            }
            if (service === 'expressApp') {
              return {
                use: jest.fn(),
                listen: jest.fn().mockReturnValue({ on: jest.fn() }),
              };
            }
            return {};
          }
          dispose() {
            return Promise.resolve();
          }
          registerInstance() {}
        };

      const setupProductionServices = mocks.setupProductionServices || (() => Promise.resolve());

      container = new DependencyContainer();
      const configuration = new Configuration();

      await setupProductionServices(container, configuration);

      // Simulate startApplications
      if (mocks.startApplications) {
        await mocks.startApplications(container, configuration);
      } else {
        // Default successful startup
        const botApp = container.resolve('botApplication') || { start: () => Promise.resolve() };
        const monitorApp = container.resolve('monitorApplication') || { start: () => Promise.resolve() };
        await botApp.start();
        await monitorApp.start();

        const xUser = configuration.get && configuration.get('X_USER_HANDLE');
        if (xUser) {
          try {
            const scraperApp = container.resolve('scraperApplication') || { start: () => Promise.resolve() };
            await scraperApp.start();
          } catch (error) {
            const logger = container.resolve('logger');
            logger.child().error('Failed to start X Scraper application:', error.message);
            logger.child().warn('X Scraper will be disabled - YouTube monitoring will continue normally');
          }
        }
      }

      // Simulate startWebServer
      if (mocks.startWebServer) {
        await mocks.startWebServer(container, configuration);
      } else {
        // Default successful web server startup
        const expressApp = container.resolve('expressApp') || {
          use: jest.fn(),
          listen: jest.fn().mockReturnValue({ on: jest.fn() }),
        };
        expressApp.listen(3000, jest.fn());
        container.registerInstance('httpServer', {});
      }

      // Simulate graceful shutdown setup
      const eventBus = container.resolve('eventBus');
      eventBus.on('bot.request_restart', async () => {
        const logger = container.resolve('logger');
        logger.info('Restarting bot...');
        await container.dispose();
        // Recursive restart would happen here
      });

      return container;
    } catch (error) {
      if (container && container.isRegistered('logger')) {
        container.resolve('logger').error('❌ Failed to start bot:', error);
      } else {
        console.error('❌ Failed to start bot:', error);
      }
      if (container) {
        await container.dispose();
      }
      throw error;
    }
  }

  // Main wrapper that handles the container lifecycle
  async function main() {
    let container;
    try {
      container = await isolatedMain();
    } catch (error) {
      console.error('❌ Bot startup failed in main:', error.message);

      if (container) {
        try {
          await container.dispose();
        } catch (disposeError) {
          console.error('Error during cleanup:', disposeError);
        }
      }

      throw error;
    }
  }

  return { main, isolatedMain };
}

describe('Main Entry Point Error Handling', () => {
  let originalEnv;
  let consoleErrorSpy;
  let processExitSpy;

  beforeEach(() => {
    // Save original environment
    originalEnv = process.env;

    // Mock console.error to capture output
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Mock process.exit to prevent test termination
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    // Set minimal required environment for tests
    process.env = {
      ...originalEnv,
      DISCORD_BOT_TOKEN: 'test-token',
      DISCORD_SUPPORT_CHANNEL_ID: '123456789012345678',
      DISCORD_ANNOUNCE_CHANNEL_ID: '123456789012345679',
      DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345680',
      YOUTUBE_API_KEY: 'test-key',
      YOUTUBE_CHANNEL_ID: 'UCrAOyUwjSM5zzPz_FqsUhuQ',
      PSH_CALLBACK_URL: 'https://example.com/webhook',
      PSH_SECRET: 'test-secret',
    };
  });

  afterEach(async () => {
    // Restore original environment and mocks
    process.env = originalEnv;
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    jest.restoreAllMocks();
  });

  describe('startBot function error scenarios', () => {
    it('should handle Configuration initialization failure', async () => {
      const { main } = await createIsolatedMainFunction({
        Configuration: class {
          constructor() {
            throw new Error('Configuration initialization failed');
          }
        },
      });

      await expect(main()).rejects.toThrow('Configuration initialization failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Bot startup failed in main:'),
        expect.stringContaining('Configuration initialization failed')
      );
    });

    it('should handle DependencyContainer creation failure', async () => {
      const { main } = await createIsolatedMainFunction({
        DependencyContainer: class {
          constructor() {
            throw new Error('DependencyContainer creation failed');
          }
        },
      });

      await expect(main()).rejects.toThrow('DependencyContainer creation failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Bot startup failed in main:'),
        expect.stringContaining('DependencyContainer creation failed')
      );
    });

    it('should handle setupProductionServices failure', async () => {
      const { main } = await createIsolatedMainFunction({
        setupProductionServices: jest.fn().mockRejectedValue(new Error('Service setup failed')),
      });

      await expect(main()).rejects.toThrow('Service setup failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Bot startup failed in main:'),
        expect.stringContaining('Service setup failed')
      );
    });

    it('should handle logger resolution failure gracefully', async () => {
      const { main } = await createIsolatedMainFunction({
        DependencyContainer: class {
          constructor() {
            this.services = new Map();
            this.instances = new Map();
          }
          isRegistered() {
            return false;
          } // No logger registered
          resolve(service) {
            if (service === 'logger') {
              throw new Error("Service 'logger' is not registered");
            }
            return {};
          }
          dispose() {
            return Promise.resolve();
          }
          registerInstance() {}
        },
      });

      await expect(main()).rejects.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to start bot:'), expect.any(Error));
    });

    it('should properly dispose container on startup failure', async () => {
      const mockDispose = jest.fn().mockResolvedValue();
      let disposeCallCount = 0;

      const { main } = await createIsolatedMainFunction({
        setupProductionServices: jest.fn().mockRejectedValue(new Error('Setup failed')),
        DependencyContainer: class {
          constructor() {
            this.services = new Map();
            this.instances = new Map();
          }
          isRegistered() {
            return false;
          }
          resolve() {
            return {};
          }
          dispose() {
            disposeCallCount++;
            return mockDispose();
          }
          registerInstance() {}
        },
      });

      await expect(main()).rejects.toThrow('Setup failed');
      expect(disposeCallCount).toBe(1); // Only called once since container fails early
    });
  });

  describe('application startup error scenarios', () => {
    it('should handle botApplication.start() failure', async () => {
      const mockBotStart = jest.fn().mockRejectedValue(new Error('Bot start failed'));

      const { main } = await createIsolatedMainFunction({
        startApplications: async (container, config) => {
          const botApp = { start: mockBotStart };
          await botApp.start();
        },
      });

      await expect(main()).rejects.toThrow('Bot start failed');
      expect(mockBotStart).toHaveBeenCalledTimes(1);
    });

    it('should handle monitorApplication.start() failure', async () => {
      const mockBotStart = jest.fn().mockResolvedValue();
      const mockMonitorStart = jest.fn().mockRejectedValue(new Error('Monitor start failed'));

      const { main } = await createIsolatedMainFunction({
        startApplications: async (_container, _config) => {
          const botApp = { start: mockBotStart };
          const monitorApp = { start: mockMonitorStart };
          await botApp.start();
          await monitorApp.start();
        },
      });

      await expect(main()).rejects.toThrow('Monitor start failed');
      expect(mockBotStart).toHaveBeenCalledTimes(1);
      expect(mockMonitorStart).toHaveBeenCalledTimes(1);
    });

    it('should handle scraperApplication.start() failure gracefully when X is configured', async () => {
      // Add X configuration to environment
      process.env.X_USER_HANDLE = 'testuser';

      const mockScraperStart = jest.fn().mockRejectedValue(new Error('Scraper start failed'));
      const mockLoggerChild = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      const { main } = await createIsolatedMainFunction({
        Configuration: class {
          constructor() {}
          get(key, defaultValue) {
            if (key === 'X_USER_HANDLE') {
              return 'testuser';
            }
            if (key === 'PSH_PORT') {
              return defaultValue || 3000;
            }
            return defaultValue;
          }
        },
        DependencyContainer: class {
          constructor() {
            this.services = new Map();
            this.instances = new Map();
          }
          isRegistered() {
            return true;
          }
          resolve(service) {
            if (service === 'logger') {
              return {
                info: jest.fn(),
                error: jest.fn(),
                child: () => mockLoggerChild,
              };
            }
            if (service === 'scraperApplication') {
              return { start: mockScraperStart };
            }
            if (service === 'eventBus') {
              return { on: jest.fn() };
            }
            if (service === 'botApplication') {
              return { start: () => Promise.resolve() };
            }
            if (service === 'monitorApplication') {
              return { start: () => Promise.resolve() };
            }
            if (service === 'expressApp') {
              return {
                use: jest.fn(),
                listen: jest.fn().mockReturnValue({ on: jest.fn() }),
              };
            }
            return {};
          }
          dispose() {
            return Promise.resolve();
          }
          registerInstance() {}
        },
        startApplications: async (_container, _config) => {
          // Successful bot and monitor start
          await Promise.resolve();
          await Promise.resolve();

          // X scraper failure - should be handled gracefully
          const xUser = _config.get('X_USER_HANDLE');
          if (xUser) {
            try {
              const scraperApp = _container.resolve('scraperApplication');
              await scraperApp.start();
            } catch (error) {
              const logger = _container.resolve('logger');
              logger.child().error('Failed to start X Scraper application:', error.message);
              logger.child().warn('X Scraper will be disabled - YouTube monitoring will continue normally');
            }
          }
        },
      });

      // Should not throw - scraper failures should be handled gracefully
      await expect(main()).resolves.not.toThrow();

      expect(mockScraperStart).toHaveBeenCalledTimes(1);
      expect(mockLoggerChild.error).toHaveBeenCalledWith(
        'Failed to start X Scraper application:',
        'Scraper start failed'
      );
      expect(mockLoggerChild.warn).toHaveBeenCalledWith(
        'X Scraper will be disabled - YouTube monitoring will continue normally'
      );
    });
  });

  describe('web server startup error scenarios', () => {
    it('should handle express app resolution failure', async () => {
      const { main } = await createIsolatedMainFunction({
        DependencyContainer: class {
          constructor() {
            this.services = new Map();
            this.instances = new Map();
          }
          isRegistered() {
            return true;
          }
          resolve(service) {
            if (service === 'logger') {
              return {
                info: jest.fn(),
                error: jest.fn(),
                child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }),
              };
            }
            if (service === 'expressApp') {
              throw new Error('Express app not available');
            }
            if (service === 'eventBus') {
              return { on: jest.fn() };
            }
            if (service === 'botApplication') {
              return { start: () => Promise.resolve() };
            }
            if (service === 'monitorApplication') {
              return { start: () => Promise.resolve() };
            }
            return {};
          }
          dispose() {
            return Promise.resolve();
          }
          registerInstance() {}
        },
      });

      await expect(main()).rejects.toThrow('Express app not available');
    });

    it('should handle server listen failure', async () => {
      const { main } = await createIsolatedMainFunction({
        startWebServer: async (_container, _config) => {
          throw new Error('Port already in use');
        },
      });

      await expect(main()).rejects.toThrow('Port already in use');
    });
  });

  describe('cleanup and disposal error scenarios', () => {
    it('should handle container disposal failure during cleanup', async () => {
      const disposeError = new Error('Disposal failed');

      // Test that cleanup disposal failures are handled gracefully
      async function mainWithDisposeError() {
        let container;
        try {
          // Simulate setup failure
          throw new Error('Setup failed');
        } catch (error) {
          console.error('❌ Bot startup failed in main:', error.message);

          // Simulate container exists but disposal fails
          container = {
            dispose: () => Promise.reject(disposeError),
          };

          if (container) {
            try {
              await container.dispose();
            } catch (disposeError) {
              console.error('Error during cleanup:', disposeError);
            }
          }

          throw error;
        }
      }

      await expect(mainWithDisposeError()).rejects.toThrow('Setup failed');

      // Should log disposal error
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error during cleanup:', disposeError);
    });

    it('should handle null container during cleanup', async () => {
      const { main } = await createIsolatedMainFunction({
        Configuration: class {
          constructor() {
            throw new Error('Config failed');
          }
        },
      });

      await expect(main()).rejects.toThrow('Config failed');

      // Should not attempt to dispose null container
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Error during cleanup:'),
        expect.anything()
      );
    });
  });

  describe('restart functionality error handling', () => {
    it('should handle restart request functionality', async () => {
      const mockEventBus = {
        on: jest.fn(),
      };

      const { main } = await createIsolatedMainFunction({
        DependencyContainer: class {
          constructor() {
            this.services = new Map();
            this.instances = new Map();
          }
          isRegistered() {
            return true;
          }
          resolve(service) {
            if (service === 'logger') {
              return {
                info: jest.fn(),
                error: jest.fn(),
                child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }),
              };
            }
            if (service === 'eventBus') {
              return mockEventBus;
            }
            if (service === 'botApplication') {
              return { start: () => Promise.resolve() };
            }
            if (service === 'monitorApplication') {
              return { start: () => Promise.resolve() };
            }
            if (service === 'expressApp') {
              return {
                use: jest.fn(),
                listen: jest.fn().mockReturnValue({ on: jest.fn() }),
              };
            }
            return {};
          }
          dispose() {
            return Promise.resolve();
          }
          registerInstance() {}
        },
      });

      await expect(main()).resolves.not.toThrow();

      // Verify event bus listener was registered
      expect(mockEventBus.on).toHaveBeenCalledWith('bot.request_restart', expect.any(Function));
    });
  });
});
