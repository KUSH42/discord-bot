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
    scraperApp = new ScraperApplication(
      mockConfig,
      mockBrowserService,
      mockAuthManager,
      mockContentAnnouncer,
      mockContentClassifier,
      mockLogger,
      mockDebugManager,
      mockMetricsManager
    );

    // Mock timers
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
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
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      const result = await scraperApp.restart();

      // Assert
      expect(result).toEqual({ success: true, message: 'Scraper restarted successfully' });

      // Verify operation tracking
      expect(mockLogger.startOperation).toHaveBeenCalledWith('restart', {
        currentState: expect.objectContaining({
          isRunning: expect.any(Boolean),
          browserHealthy: true,
          authenticated: true,
        }),
      });

      expect(mockOperation.progress).toHaveBeenCalledWith('Stopping current operations');
      expect(mockOperation.progress).toHaveBeenCalledWith('Reinitializing browser and authentication');
      expect(mockOperation.progress).toHaveBeenCalledWith('Starting scraping operations');
      expect(mockOperation.success).toHaveBeenCalledWith('Restart completed successfully');

      // Verify metrics recording
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.restart.attempts');
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.restart.success');
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
      mockLogger.startOperation.mockReturnValue(mockOperation);

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
      mockLogger.startOperation.mockReturnValue(mockOperation);

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
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Mock Math.random to ensure consistent delay calculation
      const originalRandom = Math.random;
      Math.random = jest.fn(() => 0.5);

      // Act
      const restartPromise = scraperApp.restart();

      // Fast-forward through retry delays
      // First retry: 1000ms base + jitter
      await jest.advanceTimersByTimeAsync(1500);
      // Second retry: 2000ms base + jitter
      await jest.advanceTimersByTimeAsync(2500);

      const result = await restartPromise;

      // Assert
      expect(result).toEqual({ success: true, message: 'Scraper restarted successfully' });
      expect(attemptCount).toBe(3);

      // Verify retry logging
      expect(mockOperation.progress).toHaveBeenCalledWith('Retry attempt 1 failed, waiting 1500ms before next attempt');
      expect(mockOperation.progress).toHaveBeenCalledWith('Retry attempt 2 failed, waiting 2500ms before next attempt');

      // Restore Math.random
      Math.random = originalRandom;
    });

    it('should fail after maximum retry attempts', async () => {
      // Arrange
      mockBrowserService.launch.mockRejectedValue(new Error('Persistent browser failure'));
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      const restartPromise = scraperApp.restart();

      // Fast-forward through all retry attempts
      for (let i = 0; i < 3; i++) {
        await jest.advanceTimersByTimeAsync(5000); // Max delay
      }

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
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act - Start multiple restart attempts concurrently
      const restart1 = scraperApp.restart();
      const restart2 = scraperApp.restart();
      const restart3 = scraperApp.restart();

      await jest.advanceTimersByTimeAsync(200);

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
      mockLogger.startOperation.mockReturnValue(mockOperation);

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
      mockLogger.startOperation.mockReturnValue(mockOperation);

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
      mockLogger.startOperation.mockReturnValue(mockOperation);

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
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      const restartPromise = scraperApp.restart();

      // Fast-forward through retry delays
      await jest.advanceTimersByTimeAsync(3000);

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
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      const restartPromise = scraperApp.restart();

      // Fast-forward through retry delays
      await jest.advanceTimersByTimeAsync(5000);

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
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      const restartPromise = scraperApp.restart();

      // Simulate shutdown during retry delay
      setTimeout(() => {
        scraperApp.isShuttingDown = true;
      }, 500);

      await jest.advanceTimersByTimeAsync(1000);

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
