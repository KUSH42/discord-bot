import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DependencyContainer } from '../../src/infrastructure/dependency-container.js';
import { Configuration } from '../../src/infrastructure/configuration.js';
import { setupProductionServices } from '../../src/setup/production-setup.js';
import { createEnhancedLoggerMocks } from '../fixtures/enhanced-logger-factory.js';
import { timerTestUtils } from '../fixtures/timer-test-utils.js';

/**
 * System Recovery E2E Tests
 *
 * Tests complete system recovery scenarios:
 * - Browser crash recovery
 * - Network failure handling
 * - Service restart coordination
 * - State consistency after failures
 * - Cascading failure prevention
 * - Graceful degradation under multiple failures
 */
describe('System Recovery Flow E2E', () => {
  let container;
  let config;
  let loggerMocks;
  let timerUtils;
  let originalEnv;

  // System components for recovery testing
  let botApp;
  let monitorApp;
  let scraperApp;
  let contentCoordinator;
  let xAuthManager;
  let browserService;

  beforeEach(async () => {
    jest.clearAllMocks();
    timerUtils = timerTestUtils.setupComplexTimerTest();

    // Save original environment
    originalEnv = process.env;

    // Set comprehensive test environment
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      DISCORD_BOT_TOKEN: 'test-recovery-token',
      DISCORD_SUPPORT_CHANNEL_ID: '123456789012345678',
      DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345679',
      DISCORD_X_POSTS_CHANNEL_ID: '123456789012345680',
      DISCORD_X_REPLIES_CHANNEL_ID: '123456789012345681',
      DISCORD_X_QUOTES_CHANNEL_ID: '123456789012345682',
      DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345683',
      YOUTUBE_API_KEY: 'test-youtube-key',
      YOUTUBE_CHANNEL_ID: 'UCrAOyUwjSM5zzPz_FqsUhuQ',
      X_USER_HANDLE: 'testuser',
      X_LOGIN_EMAIL: 'test@example.com',
      X_LOGIN_PASSWORD: 'testpassword',
      TWITTER_USERNAME: 'testuser',
      TWITTER_PASSWORD: 'testpassword',
      PSH_WEBHOOK_URL: 'https://test.example.com/webhook',
      PSH_CALLBACK_URL: 'https://test.example.com/webhook/psh',
      PSH_SECRET: 'test-secret',

      // Recovery-specific configuration
      BROWSER_CRASH_RECOVERY_ENABLED: 'true',
      NETWORK_RETRY_MAX_ATTEMPTS: '3',
      NETWORK_RETRY_DELAY_MS: '1000',
      SERVICE_RESTART_COOLDOWN_MS: '5000',
      HEALTH_CHECK_INTERVAL_MS: '10000',
      GRACEFUL_SHUTDOWN_TIMEOUT_MS: '30000',
    };

    // Create enhanced logger mocks
    loggerMocks = createEnhancedLoggerMocks();

    // Create configuration and container
    config = new Configuration();
    container = new DependencyContainer();

    // Setup production services with mocked components
    await setupProductionServices(container, config);

    // Replace real services with mocked versions for testing
    setupMockedServices();

    // Resolve system components
    botApp = container.resolve('botApplication');
    monitorApp = container.resolve('monitorApplication');
    scraperApp = container.resolve('scraperApplication');
    contentCoordinator = container.resolve('contentCoordinator');
    xAuthManager = container.resolve('xAuthManager');
    browserService = container.resolve('browserService');
  });

  afterEach(async () => {
    // Cleanup
    timerUtils.cleanup();
    process.env = originalEnv;

    if (container) {
      await container.dispose();
    }
  });

  function setupMockedServices() {
    // Mock Discord client service
    const mockDiscordService = {
      client: {
        isReady: () => true,
        user: { id: 'test-bot-id' },
        destroy: jest.fn(),
      },
      sendMessage: jest.fn(async () => ({ id: 'msg123', timestamp: new Date() })),
      fetchChannel: jest.fn(async id => ({ id, name: `test-channel-${id}` })),

      // Failure simulation
      simulateConnectionLoss: () => {
        mockDiscordService.client.isReady = () => false;
        mockDiscordService.sendMessage = jest.fn().mockRejectedValue(new Error('Discord connection lost'));
      },

      simulateRecovery: () => {
        mockDiscordService.client.isReady = () => true;
        mockDiscordService.sendMessage = jest.fn(async () => ({ id: 'msg123', timestamp: new Date() }));
      },
    };

    // Mock browser service with failure scenarios
    const mockBrowserService = {
      browser: null,
      page: null,
      isConnected: jest.fn(() => true),
      isClosed: jest.fn(() => false),

      launch: jest.fn(async () => {
        mockBrowserService.browser = {
          isConnected: () => true,
          close: jest.fn(),
          newPage: jest.fn(async () => {
            mockBrowserService.page = {
              goto: jest.fn(),
              evaluate: jest.fn(() => []),
              close: jest.fn(),
              isClosed: () => false,
            };
            return mockBrowserService.page;
          }),
        };
        return mockBrowserService.browser;
      }),

      close: jest.fn(async () => {
        if (mockBrowserService.browser) {
          await mockBrowserService.browser.close();
          mockBrowserService.browser = null;
          mockBrowserService.page = null;
        }
      }),

      goto: jest.fn(),
      evaluate: jest.fn(() => Promise.resolve([])),

      // Failure simulation methods
      simulateBrowserCrash: () => {
        mockBrowserService.browser = null;
        mockBrowserService.page = null;
        mockBrowserService.isConnected = jest.fn(() => false);
        mockBrowserService.isClosed = jest.fn(() => true);
        mockBrowserService.goto = jest.fn().mockRejectedValue(new Error('Browser connection lost'));
        mockBrowserService.evaluate = jest.fn().mockRejectedValue(new Error('Browser connection lost'));
      },

      simulateBrowserRecovery: () => {
        mockBrowserService.isConnected = jest.fn(() => true);
        mockBrowserService.isClosed = jest.fn(() => false);
        mockBrowserService.goto = jest.fn();
        mockBrowserService.evaluate = jest.fn(() => Promise.resolve([]));
      },
    };

    // Mock YouTube service
    const mockYoutubeService = {
      getVideoDetails: jest.fn(),
      getChannelVideos: jest.fn(() => Promise.resolve([])),
      verifyApiAccess: jest.fn(() => Promise.resolve(true)),

      simulateApiFailure: () => {
        mockYoutubeService.getVideoDetails = jest.fn().mockRejectedValue(new Error('YouTube API error'));
        mockYoutubeService.getChannelVideos = jest.fn().mockRejectedValue(new Error('YouTube API error'));
        mockYoutubeService.verifyApiAccess = jest.fn(() => Promise.resolve(false));
      },

      simulateApiRecovery: () => {
        mockYoutubeService.getVideoDetails = jest.fn();
        mockYoutubeService.getChannelVideos = jest.fn(() => Promise.resolve([]));
        mockYoutubeService.verifyApiAccess = jest.fn(() => Promise.resolve(true));
      },
    };

    // Register mocked services in container
    container.register('discordService', () => mockDiscordService);
    container.register('browserService', () => mockBrowserService);
    container.register('youtubeService', () => mockYoutubeService);
  }

  describe('Browser Crash Recovery E2E', () => {
    it('should detect browser crash and perform full recovery', async () => {
      const mockBrowserService = container.resolve('browserService');

      // Start scraper application
      await scraperApp.start();
      expect(scraperApp.isRunning).toBe(true);

      // Simulate browser crash during operation
      mockBrowserService.simulateBrowserCrash();

      // Trigger scraping operation that will encounter crashed browser
      const scrapingPromise = scraperApp.runScrapingCycle();

      // Advance timers to trigger crash detection
      await timerUtils.advance(1000);

      // Simulate recovery process
      mockBrowserService.simulateBrowserRecovery();
      mockBrowserService.launch.mockResolvedValueOnce(mockBrowserService.browser);

      // Allow recovery to complete
      await timerUtils.advance(5000);
      await scrapingPromise;

      // Verify: Browser crash detected and recovery initiated
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('browser_crash_detected', 1, 'scraper');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('browser_recovery_initiated', 1, 'scraper');

      // Verify: New browser instance launched
      expect(mockBrowserService.launch).toHaveBeenCalled();

      // Verify: Scraper continues operation after recovery
      expect(scraperApp.isRunning).toBe(true);
    }, 20000);

    it('should handle cascading browser failures with exponential backoff', async () => {
      const mockBrowserService = container.resolve('browserService');

      await scraperApp.start();

      // Simulate repeated browser failures
      let launchAttempts = 0;
      mockBrowserService.launch.mockImplementation(async () => {
        launchAttempts++;
        if (launchAttempts <= 3) {
          throw new Error(`Browser launch failed (attempt ${launchAttempts})`);
        }
        // Success on 4th attempt
        return mockBrowserService.browser;
      });

      // Trigger multiple recovery attempts
      for (let i = 0; i < 3; i++) {
        mockBrowserService.simulateBrowserCrash();

        // Trigger recovery
        const recoveryPromise = scraperApp.runScrapingCycle();
        await timerUtils.advance(2000 * Math.pow(2, i)); // Exponential backoff
        await recoveryPromise.catch(() => {}); // Expected to fail
      }

      // Final successful recovery
      mockBrowserService.simulateBrowserRecovery();
      await scraperApp.runScrapingCycle();

      // Verify: Exponential backoff applied
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('exponential_backoff_applied', 3, 'scraper');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'recovery_success_after_retries',
        1,
        'scraper'
      );
    }, 25000);
  });

  describe('Network Failure Recovery E2E', () => {
    it('should recover from complete network outage across all services', async () => {
      const mockDiscordService = container.resolve('discordService');
      const mockYoutubeService = container.resolve('youtubeService');
      const mockBrowserService = container.resolve('browserService');

      // Start all applications
      await Promise.all([botApp.start(), monitorApp.start(), scraperApp.start()]);

      // Simulate complete network outage
      mockDiscordService.simulateConnectionLoss();
      mockYoutubeService.simulateApiFailure();
      mockBrowserService.goto = jest.fn().mockRejectedValue(new Error('Network unreachable'));

      // Attempt operations during outage
      const operations = [
        contentCoordinator.processContent('test1', 'webhook', { title: 'Test during outage' }),
        scraperApp.runScrapingCycle(),
        monitorApp.checkForNewContent(),
      ];

      const outageResults = await Promise.allSettled(operations);

      // Verify: All operations fail during outage
      expect(outageResults.every(r => r.status === 'rejected')).toBe(true);

      // Simulate network recovery
      await timerUtils.advance(10000); // Wait for recovery timeout
      mockDiscordService.simulateRecovery();
      mockYoutubeService.simulateApiRecovery();
      mockBrowserService.goto = jest.fn();

      // Attempt operations after recovery
      const recoveryOperations = [
        contentCoordinator.processContent('test2', 'webhook', { title: 'Test after recovery' }),
        scraperApp.runScrapingCycle(),
        monitorApp.checkForNewContent(),
      ];

      const recoveryResults = await Promise.allSettled(recoveryOperations);

      // Verify: Operations succeed after recovery
      const successCount = recoveryResults.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBeGreaterThan(0);

      // Verify: Network recovery metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('network_outage_detected', 1, 'system');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('network_recovery_confirmed', 1, 'system');
    }, 30000);

    it('should maintain partial functionality during partial network failures', async () => {
      const mockDiscordService = container.resolve('discordService');
      const mockYoutubeService = container.resolve('youtubeService');

      await Promise.all([botApp.start(), monitorApp.start(), scraperApp.start()]);

      // Simulate partial failure (Discord down, YouTube working)
      mockDiscordService.simulateConnectionLoss();
      // YouTube remains functional

      // Test mixed operations
      const mixedOperations = [
        // Should fail - Discord dependent
        contentCoordinator.processContent('discord1', 'webhook', { title: 'Discord test' }),
        // Should succeed - YouTube API only
        monitorApp.checkForNewContent(),
        // Should partially succeed - scraping works, announcement fails
        scraperApp.runScrapingCycle(),
      ];

      const mixedResults = await Promise.allSettled(mixedOperations);

      // Verify: Partial system functionality maintained
      expect(mixedResults.some(r => r.status === 'fulfilled')).toBe(true);
      expect(mixedResults.some(r => r.status === 'rejected')).toBe(true);

      // Verify: Partial failure handling metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('partial_service_failure', 1, 'system');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('graceful_degradation_active', 1, 'system');
    }, 20000);
  });

  describe('Service Restart Coordination E2E', () => {
    it('should coordinate graceful restart of all applications', async () => {
      // Start all applications
      await Promise.all([botApp.start(), monitorApp.start(), scraperApp.start()]);

      // Verify all applications are running
      expect(botApp.isRunning).toBe(true);
      expect(monitorApp.isRunning).toBe(true);
      expect(scraperApp.isRunning).toBe(true);

      // Initiate graceful shutdown
      const shutdownPromise = Promise.all([botApp.stop(), monitorApp.stop(), scraperApp.stop()]);

      // Allow shutdown process to complete
      await timerUtils.advance(5000);
      await shutdownPromise;

      // Verify all applications stopped
      expect(botApp.isRunning).toBe(false);
      expect(monitorApp.isRunning).toBe(false);
      expect(scraperApp.isRunning).toBe(false);

      // Restart all applications
      const restartPromise = Promise.all([botApp.start(), monitorApp.start(), scraperApp.start()]);

      await timerUtils.advance(3000);
      await restartPromise;

      // Verify all applications restarted successfully
      expect(botApp.isRunning).toBe(true);
      expect(monitorApp.isRunning).toBe(true);
      expect(scraperApp.isRunning).toBe(true);

      // Verify: Restart coordination metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('graceful_shutdown_completed', 3, 'system');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith(
        'coordinated_restart_completed',
        3,
        'system'
      );
    }, 25000);

    it('should handle individual service failures without affecting others', async () => {
      await Promise.all([botApp.start(), monitorApp.start(), scraperApp.start()]);

      // Simulate scraper failure
      const mockBrowserService = container.resolve('browserService');
      mockBrowserService.simulateBrowserCrash();

      // Force scraper to detect failure
      await scraperApp.runScrapingCycle().catch(() => {});

      // Other services should continue working
      await contentCoordinator.processContent('isolated1', 'webhook', { title: 'Isolation test' });
      await monitorApp.checkForNewContent();

      // Verify: Service isolation maintained
      expect(botApp.isRunning).toBe(true);
      expect(monitorApp.isRunning).toBe(true);
      // Scraper may attempt recovery but others unaffected

      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('service_isolation_maintained', 1, 'system');
    }, 15000);
  });

  describe('State Consistency Recovery E2E', () => {
    it('should maintain content state consistency across service failures', async () => {
      const contentId = 'consistency_test_123';

      await Promise.all([botApp.start(), monitorApp.start()]);

      // Process content successfully
      const initialResult = await contentCoordinator.processContent(contentId, 'webhook', {
        id: contentId,
        title: 'Consistency Test Content',
        publishedAt: '2024-01-01T12:00:00Z',
      });

      expect(initialResult.action).toBe('announced');

      // Simulate system failure during duplicate processing
      const mockDiscordService = container.resolve('discordService');
      mockDiscordService.simulateConnectionLoss();

      // Attempt to process same content (should be detected as duplicate)
      const duplicateResult = await contentCoordinator.processContent(contentId, 'api', {
        id: contentId,
        title: 'Consistency Test Content',
        publishedAt: '2024-01-01T12:00:00Z',
      });

      // Verify: Duplicate detection works despite service failure
      expect(duplicateResult.action).toBe('duplicate_detected');

      // Restore service and verify state consistency
      mockDiscordService.simulateRecovery();

      const finalResult = await contentCoordinator.processContent(contentId, 'scraper', {
        id: contentId,
        title: 'Consistency Test Content',
        publishedAt: '2024-01-01T12:00:00Z',
      });

      expect(finalResult.action).toBe('duplicate_detected');

      // Verify: State consistency metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('state_consistency_maintained', 1, 'state');
    }, 15000);

    it('should recover authentication state after browser restart', async () => {
      await scraperApp.start();

      // Establish authentication
      const initialAuth = await xAuthManager.ensureAuthenticated();
      expect(initialAuth).toBe(true);

      // Simulate browser restart
      const mockBrowserService = container.resolve('browserService');
      await mockBrowserService.close();
      mockBrowserService.simulateBrowserCrash();

      // Recovery process
      mockBrowserService.simulateBrowserRecovery();

      // Verify authentication state recovered
      const recoveredAuth = await xAuthManager.ensureAuthenticated();
      expect(recoveredAuth).toBe(true);

      // Verify: Authentication state recovery metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('auth_state_recovered', 1, 'auth');
    }, 15000);
  });

  describe('Cascading Failure Prevention E2E', () => {
    it('should prevent cascading failures across system components', async () => {
      await Promise.all([botApp.start(), monitorApp.start(), scraperApp.start()]);

      // Initiate failure in scraper (browser crash)
      const mockBrowserService = container.resolve('browserService');
      mockBrowserService.simulateBrowserCrash();

      // Trigger scraper failure
      await scraperApp.runScrapingCycle().catch(() => {});

      // Verify other components continue working
      const coordinatorResult = await contentCoordinator.processContent('cascade1', 'webhook', {
        title: 'Cascade Prevention Test',
      });
      expect(coordinatorResult.action).toBe('announced');

      await monitorApp.checkForNewContent();

      // Verify: Cascading failure prevention
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('cascading_failure_prevented', 1, 'system');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('system_resilience_maintained', 1, 'system');
    }, 15000);

    it('should implement circuit breaker pattern for failing services', async () => {
      const mockDiscordService = container.resolve('discordService');

      await botApp.start();

      // Cause multiple consecutive failures to trigger circuit breaker
      mockDiscordService.sendMessage.mockRejectedValue(new Error('Service unavailable'));

      const failurePromises = [];
      for (let i = 0; i < 5; i++) {
        failurePromises.push(
          contentCoordinator
            .processContent(`circuit_${i}`, 'webhook', {
              title: `Circuit Breaker Test ${i}`,
            })
            .catch(() => {})
        );
      }

      await Promise.all(failurePromises);

      // Circuit breaker should now be open - subsequent calls should fail fast
      const fastFailStart = Date.now();
      await contentCoordinator
        .processContent('circuit_fast_fail', 'webhook', {
          title: 'Fast Fail Test',
        })
        .catch(() => {});
      const fastFailTime = Date.now() - fastFailStart;

      // Verify: Fast failure (circuit breaker open)
      expect(fastFailTime).toBeLessThan(100); // Should fail immediately

      // Verify: Circuit breaker metrics
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('circuit_breaker_opened', 1, 'system');
      expect(loggerMocks.metricsManager.recordMetric).toHaveBeenCalledWith('fast_failure_applied', 1, 'system');
    }, 15000);
  });
});
