import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('ScraperApplication Restart Functionality', () => {
  let scraperApp;
  let mockDependencies;
  let mockConfig;
  let mockBrowserService;
  let mockAuthManager;
  let mockContentAnnouncer;
  let mockContentClassifier;
  let mockLogger;
  let mockDebugManager;
  let mockMetricsManager;

  beforeEach(() => {
    // Create mock config
    mockConfig = {
      xUserHandle: 'testuser',
      xPollingInterval: 30000,
      isAnnouncingEnabled: jest.fn(() => true),
      getRequired: jest.fn(key => {
        const values = {
          X_USER_HANDLE: 'testuser',
          TWITTER_USERNAME: 'testuser',
          TWITTER_PASSWORD: 'testpass',
        };
        return values[key];
      }),
      get: jest.fn((key, defaultValue) => {
        const values = {
          X_QUERY_INTERVAL_MIN: '300000',
          X_QUERY_INTERVAL_MAX: '600000',
          STARTUP_TIMESTAMP: Date.now().toString(),
          PARALLEL_SCRAPING: 'false',
          LOGIN_RETRY_DELAY: '5000',
          PROFILE_RETRY_DELAY: '10000',
          MAX_RETRY_ATTEMPTS: '3',
          SCRAPING_ANNOUNCEMENT_DELAY: '2000',
          X_POLLING_INTERVAL: '900000',
          MAX_SCROLLS: '50',
        };
        return values[key] || defaultValue;
      }),
    };

    // Create additional mocks
    mockBrowserService = {
      isHealthy: jest.fn(() => true),
      launch: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      isRunning: jest.fn(() => true),
    };

    mockAuthManager = {
      login: jest.fn().mockResolvedValue({ success: true }),
      isAuthenticated: jest.fn(() => true),
      ensureAuthenticated: jest.fn(),
    };

    mockContentAnnouncer = {
      announceContent: jest.fn(() => Promise.resolve({ success: true })),
    };

    mockContentClassifier = {
      classifyXContent: jest.fn(() => ({ type: 'post' })),
    };

    const mockContentCoordinator = {
      processContent: jest.fn(() => Promise.resolve({ success: true, skipped: false })),
    };

    mockDependencies = createMockDependenciesWithEnhancedLogging({
      config: mockConfig,
      browserService: mockBrowserService,
      authManager: mockAuthManager,
      contentAnnouncer: mockContentAnnouncer,
      contentClassifier: mockContentClassifier,
      contentCoordinator: mockContentCoordinator,
      stateManager: {
        getLastScrapedTimestamp: jest.fn(() => null),
        updateLastScrapedTimestamp: jest.fn(),
        isKilled: jest.fn(() => false),
      },
      eventBus: {
        emit: jest.fn(),
        on: jest.fn(),
      },
      discordService: {
        sendMessage: jest.fn(),
      },
      persistentStorage: {
        hasFingerprint: jest.fn().mockResolvedValue(false),
        storeFingerprint: jest.fn().mockResolvedValue(),
        hasUrl: jest.fn().mockResolvedValue(false),
        addUrl: jest.fn().mockResolvedValue(),
      },
    });

    // Extract mocks from dependencies
    mockLogger = mockDependencies.logger;
    mockDebugManager = mockDependencies.debugManager;
    mockMetricsManager = mockDependencies.metricsManager;
    mockAuthManager.getCurrentSession = jest.fn(() => ({
      isValid: true,
      expiresAt: Date.now() + 3600000,
    }));

    // Create ScraperApplication instance
    const dependencies = {
      config: mockConfig,
      browserService: mockBrowserService,
      authManager: mockAuthManager,
      contentCoordinator: { announceContent: jest.fn() },
      contentClassifier: mockContentClassifier,
      logger: mockDependencies.logger,
      debugManager: mockDependencies.debugManager,
      metricsManager: mockDependencies.metricsManager,
      stateManager: { getState: jest.fn(), setState: jest.fn() },
      discordService: { sendMessage: jest.fn() },
      eventBus: { emit: jest.fn(), on: jest.fn() },
    };

    scraperApp = new ScraperApplication(dependencies);

    // Mock timers first
    jest.useFakeTimers();

    // Test helper for synchronized async timer advancement (from TIMER-TESTING-GUIDE.md)
    global.advanceAsyncTimers = async ms => {
      await jest.advanceTimersByTimeAsync(ms);
      // Allow promises to resolve
      await Promise.resolve();
      await new Promise(resolve => setImmediate(resolve));
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    delete global.advanceAsyncTimers;
  });

  describe('restart()', () => {
    it('should perform clean restart when healthy', async () => {
      // Arrange
      mockBrowserService.isHealthy.mockReturnValue(true);
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      // Spy on the actual enhanced logger that ScraperApplication creates
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Mock the start and stop methods that restart() calls
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockResolvedValue();

      // Act
      const result = await scraperApp.restart();

      // Assert - restart() returns undefined on success
      expect(result).toBeUndefined();

      // Verify operation tracking
      expect(scraperApp.logger.startOperation).toHaveBeenCalledWith(
        'restartScraperApplication',
        expect.objectContaining({
          maxRetries: 3,
          baseDelay: 5000,
        })
      );

      expect(mockOperation.progress).toHaveBeenCalledWith('Stopping current scraper instance');
      expect(mockOperation.success).toHaveBeenCalledWith(
        'X scraper application restarted successfully',
        expect.objectContaining({
          attempt: 1,
          totalAttempts: 3,
        })
      );
    });

    it('should handle restart with unhealthy browser', async () => {
      // Arrange
      mockBrowserService.isHealthy.mockReturnValue(false);
      mockBrowserService.launch.mockResolvedValue(undefined);
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Act
      const result = await scraperApp.restart();

      // Assert
      expect(result).toEqual({ success: true, message: 'Scraper restarted successfully' });

      // Verify browser relaunch was attempted
      expect(mockBrowserService.close).toHaveBeenCalled();
      expect(mockBrowserService.launch).toHaveBeenCalled();

      expect(mockOperation.progress).toHaveBeenCalledWith('Browser unhealthy, forcing close and relaunch');
    });

    it('should handle restart with authentication failure', async () => {
      // Arrange
      mockAuthManager.isAuthenticated.mockReturnValue(false);
      mockAuthManager.login.mockResolvedValue({ success: false, error: 'Login failed' });
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Act
      const result = await scraperApp.restart();

      // Assert
      expect(result).toEqual({
        success: false,
        message: 'Restart failed: Authentication unsuccessful after restart',
      });

      expect(mockOperation.progress).toHaveBeenCalledWith('Authentication required, attempting login');
      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Authentication unsuccessful after restart' }),
        'Restart failed due to authentication failure'
      );

      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.restart.failures');
    });

    it('should implement exponential backoff for retry attempts', async () => {
      // Arrange
      let attemptCount = 0;
      mockBrowserService.launch.mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Browser launch failed');
        }
        return Promise.resolve();
      });

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Act - Use shorter delays for testing
      const restartPromise = scraperApp.restart({ maxRetries: 3, baseDelay: 1000 });

      // Fast-forward through retry delays with synchronized advancement
      // First retry delay: baseDelay * Math.pow(2, 0) = 1000ms
      await global.advanceAsyncTimers(1000);
      // Second retry delay: baseDelay * Math.pow(2, 1) = 2000ms
      await global.advanceAsyncTimers(2000);

      const result = await restartPromise;

      // Assert
      expect(result).toEqual({ success: true, message: 'Scraper restarted successfully' });
      expect(attemptCount).toBe(3);

      // Verify retry logging (actual message format from implementation)
      expect(mockOperation.progress).toHaveBeenCalledWith('Waiting 1000ms before next restart attempt');
      expect(mockOperation.progress).toHaveBeenCalledWith('Waiting 2000ms before next restart attempt');
    });

    it('should fail after maximum retry attempts', async () => {
      // Arrange
      mockBrowserService.launch.mockRejectedValue(new Error('Persistent browser failure'));
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Act - Use shorter delays for testing
      const restartPromise = scraperApp.restart({ maxRetries: 3, baseDelay: 1000 });

      // Fast-forward through all retry attempts with synchronized advancement
      // First attempt fails immediately, then wait for first retry delay (1000ms)
      await global.advanceAsyncTimers(1000);
      // Second attempt fails, wait for second retry delay (2000ms)
      await global.advanceAsyncTimers(2000);
      // Third attempt fails, wait for third retry delay (4000ms)
      await global.advanceAsyncTimers(4000);

      const result = await restartPromise;

      // Assert
      expect(result).toEqual({
        success: false,
        message: 'Restart failed after 3 attempts: Persistent browser failure',
      });

      expect(mockBrowserService.launch).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Persistent browser failure' }),
        'Restart failed after maximum retry attempts',
        { maxRetries: 3, finalError: 'Persistent browser failure' }
      );

      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.restart.failures');
    });

    it('should handle concurrent restart attempts', async () => {
      // Arrange
      let launchCallCount = 0;
      mockBrowserService.launch.mockImplementation(async () => {
        launchCallCount++;
        // Remove setTimeout delay - just resolve immediately for testing
        return {};
      });

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Act - Start multiple restart attempts concurrently
      const restart1 = scraperApp.restart();
      const restart2 = scraperApp.restart();
      const restart3 = scraperApp.restart();

      // Use synchronized timer advancement - no delay needed for concurrency test
      await global.advanceAsyncTimers(100);

      const [result1, result2, result3] = await Promise.all([restart1, restart2, restart3]);

      // Assert - Only one should succeed, others should be blocked
      const successCount = [result1, result2, result3].filter(r => r.success).length;
      const blockedCount = [result1, result2, result3].filter(
        r => !r.success && r.message.includes('already in progress')
      ).length;

      expect(successCount).toBe(1);
      expect(blockedCount).toBe(2);

      // Browser should only be launched once despite multiple attempts
      expect(launchCallCount).toBe(1);
    });

    it('should preserve state during restart', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Start scraper and capture initial state
      scraperApp.isRunning = true;
      const initialRunningState = scraperApp.isRunning;

      // Act
      await scraperApp.restart();

      // Assert - State should be preserved after restart
      expect(scraperApp.isRunning).toBe(initialRunningState);

      // Verify operation captured initial state
      expect(mockLogger.startOperation).toHaveBeenCalledWith('restart', {
        currentState: expect.objectContaining({
          isRunning: true,
        }),
      });
    });

    it('should handle browser close failures gracefully', async () => {
      // Arrange
      mockBrowserService.isHealthy.mockReturnValue(false);
      mockBrowserService.close.mockRejectedValue(new Error('Close failed'));
      mockBrowserService.launch.mockResolvedValue(undefined);

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Act
      const result = await scraperApp.restart();

      // Assert
      expect(result).toEqual({ success: true, message: 'Scraper restarted successfully' });

      // Should still attempt to launch despite close failure
      expect(mockBrowserService.launch).toHaveBeenCalled();
      expect(mockOperation.progress).toHaveBeenCalledWith('Browser close failed, proceeding with launch');
    });

    it('should record detailed metrics during restart', async () => {
      // Arrange
      const mockTimer = { end: jest.fn() };
      mockMetricsManager.startTimer.mockReturnValue(mockTimer);

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Act
      await scraperApp.restart();

      // Assert
      expect(mockMetricsManager.startTimer).toHaveBeenCalledWith('scraper.restart.duration');
      expect(mockTimer.end).toHaveBeenCalled();
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.restart.attempts');
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.restart.success');
    });
  });

  describe('restart with retries integration', () => {
    it('should integrate with health monitoring during retries', async () => {
      // Arrange
      let healthCheckCount = 0;
      mockBrowserService.isHealthy.mockImplementation(() => {
        healthCheckCount++;
        return healthCheckCount > 2; // Become healthy after 2 checks
      });

      mockBrowserService.launch.mockImplementation(async () => {
        if (healthCheckCount <= 2) {
          throw new Error('Browser not ready');
        }
      });

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Act - Use shorter delays for testing
      const restartPromise = scraperApp.restart({ maxRetries: 3, baseDelay: 1000 });

      // Fast-forward through retry delays with synchronized advancement
      await global.advanceAsyncTimers(3000);

      const result = await restartPromise;

      // Assert
      expect(result).toEqual({ success: true, message: 'Scraper restarted successfully' });
      expect(healthCheckCount).toBeGreaterThan(2);
      expect(mockOperation.progress).toHaveBeenCalledWith(expect.stringMatching(/Browser health check.*healthy: true/));
    });

    it('should handle authentication retries with session validation', async () => {
      // Arrange
      let loginAttempts = 0;
      mockAuthManager.login.mockImplementation(async () => {
        loginAttempts++;
        if (loginAttempts < 3) {
          return { success: false, error: 'Temporary auth failure' };
        }
        return { success: true };
      });

      mockAuthManager.isAuthenticated.mockImplementation(() => loginAttempts >= 3);

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Act - Use shorter delays for testing
      const restartPromise = scraperApp.restart({ maxRetries: 3, baseDelay: 1000 });

      // Fast-forward through retry delays with synchronized advancement
      await global.advanceAsyncTimers(3000);

      const result = await restartPromise;

      // Assert
      expect(result).toEqual({ success: true, message: 'Scraper restarted successfully' });
      expect(loginAttempts).toBe(3);
      expect(mockOperation.progress).toHaveBeenCalledWith('Authentication retry 1 failed: Temporary auth failure');
      expect(mockOperation.progress).toHaveBeenCalledWith('Authentication retry 2 failed: Temporary auth failure');
    });

    it('should abort restart if shutdown initiated during retries', async () => {
      // Arrange
      mockBrowserService.launch.mockRejectedValue(new Error('Launch failed'));

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Act - Use shorter delays for testing
      const restartPromise = scraperApp.restart({ maxRetries: 3, baseDelay: 1000 });

      // Advance to trigger first retry attempt
      await global.advanceAsyncTimers(500);

      // Simulate shutdown during retry delay
      scraperApp.isShuttingDown = true;

      // Advance rest of the time to complete the retry cycle
      await global.advanceAsyncTimers(1500);

      const result = await restartPromise;

      // Assert
      expect(result).toEqual({
        success: false,
        message: 'Restart aborted due to shutdown signal',
      });

      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Restart aborted due to shutdown signal' }),
        'Restart operation cancelled during shutdown'
      );
    });
  });
});
