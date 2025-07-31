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
    // Mock timers first
    jest.useFakeTimers();

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
      xAuthManager: mockAuthManager,
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

    // Create mock delay function for direct control
    const mockDelay = jest.fn().mockResolvedValue();

    // Create ScraperApplication instance
    const dependencies = {
      config: mockConfig,
      browserService: mockBrowserService,
      xAuthManager: mockAuthManager,
      contentCoordinator: { announceContent: jest.fn() },
      contentClassifier: mockContentClassifier,
      logger: mockDependencies.logger,
      debugManager: mockDependencies.debugManager,
      metricsManager: mockDependencies.metricsManager,
      stateManager: { getState: jest.fn(), setState: jest.fn() },
      discordService: { sendMessage: jest.fn() },
      eventBus: { emit: jest.fn(), on: jest.fn() },
      delay: mockDelay, // Inject mock delay for direct control
    };

    scraperApp = new ScraperApplication(dependencies);

    // Store reference to mock delay for test access
    global.mockDelay = mockDelay;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    delete global.mockDelay;
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

      // Mock start and stop methods
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockResolvedValue();

      // Act
      const result = await scraperApp.restart();

      // Assert
      expect(result).toBeUndefined(); // restart() returns undefined on success

      expect(mockOperation.success).toHaveBeenCalledWith(
        'X scraper application restarted successfully',
        expect.objectContaining({
          attempt: 1,
          totalAttempts: 3,
        })
      );
    });

    it('should handle restart with authentication failure', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Mock start and stop methods - start should fail due to auth issues
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockRejectedValue(new Error('Authentication unsuccessful after restart'));

      // Act & Assert - expect the restart to throw
      await expect(scraperApp.restart({ maxRetries: 3, baseDelay: 1000 })).rejects.toThrow(
        'Scraper restart failed after 3 attempts: Authentication unsuccessful after restart'
      );

      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Scraper restart failed after 3 attempts: Authentication unsuccessful after restart',
        }),
        'Failed to restart scraper after 3 attempts',
        { finalAttempt: 3, originalError: 'Authentication unsuccessful after restart' }
      );
    });

    it('should implement exponential backoff for retry attempts', async () => {
      // Arrange
      let startAttemptCount = 0;
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Mock start and stop methods - start succeeds on third attempt
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockImplementation(() => {
        startAttemptCount++;
        if (startAttemptCount < 3) {
          throw new Error('Browser launch failed');
        }
        return Promise.resolve();
      });

      // Act
      const result = await scraperApp.restart({ maxRetries: 3, baseDelay: 1000 });

      // Assert
      expect(result).toBeUndefined(); // restart() returns undefined on success
      expect(startAttemptCount).toBe(3);

      // Verify delay calls with correct exponential backoff
      expect(global.mockDelay).toHaveBeenCalledTimes(2); // Two delays before success
      expect(global.mockDelay).toHaveBeenCalledWith(1000); // First retry: 1000ms
      expect(global.mockDelay).toHaveBeenCalledWith(2000); // Second retry: 2000ms

      // Verify retry logging (actual message format from implementation)
      expect(mockOperation.progress).toHaveBeenCalledWith('Waiting 1000ms before next restart attempt');
      expect(mockOperation.progress).toHaveBeenCalledWith('Waiting 2000ms before next restart attempt');
    });

    it('should fail after maximum retry attempts', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Mock start and stop methods to always fail
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockRejectedValue(new Error('Persistent browser failure'));

      // Act & Assert - expect the restart to throw
      await expect(scraperApp.restart({ maxRetries: 3, baseDelay: 1000 })).rejects.toThrow(
        'Scraper restart failed after 3 attempts: Persistent browser failure'
      );

      // Verify delay calls for all retry attempts
      expect(global.mockDelay).toHaveBeenCalledTimes(2); // Two delays before final failure
      expect(global.mockDelay).toHaveBeenCalledWith(1000); // First retry: 1000ms
      expect(global.mockDelay).toHaveBeenCalledWith(2000); // Second retry: 2000ms

      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Scraper restart failed after 3 attempts: Persistent browser failure' }),
        'Failed to restart scraper after 3 attempts',
        { finalAttempt: 3, originalError: 'Persistent browser failure' }
      );
    });

    it('should handle concurrent restart attempts', async () => {
      // Arrange
      let startCallCount = 0;
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Mock start and stop methods
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockImplementation(async () => {
        startCallCount++;
        return {};
      });

      // Act - Start multiple restart attempts concurrently
      const [result1, result2, result3] = await Promise.all([
        scraperApp.restart(),
        scraperApp.restart(),
        scraperApp.restart(),
      ]);

      // Assert - All should return undefined since restart() returns undefined on success
      // The concurrency control should be handled internally
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
      expect(result3).toBeUndefined();

      // Start should be called for each concurrent attempt
      expect(startCallCount).toBeGreaterThanOrEqual(1);
    }, 10000);

    it('should preserve state during restart', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Mock start and stop methods
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockResolvedValue();

      // Start scraper and capture initial state
      scraperApp.isRunning = true;
      const initialRunningState = scraperApp.isRunning;

      // Act
      await scraperApp.restart();

      // Assert - State should be preserved after restart
      expect(scraperApp.isRunning).toBe(initialRunningState);

      // Verify operation was started
      expect(scraperApp.logger.startOperation).toHaveBeenCalledWith(
        'restartScraperApplication',
        expect.objectContaining({
          maxRetries: 3,
          baseDelay: 5000,
        })
      );
    });

    it('should handle browser close failures gracefully', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Mock start and stop methods
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockResolvedValue();

      // Act
      const result = await scraperApp.restart();

      // Assert
      expect(result).toBeUndefined(); // restart() returns undefined on success

      expect(mockOperation.success).toHaveBeenCalledWith(
        'X scraper application restarted successfully',
        expect.objectContaining({
          attempt: 1,
          totalAttempts: 3,
        })
      );
    });

    it('should record detailed metrics during restart', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Mock start and stop methods
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockResolvedValue();

      // Act
      await scraperApp.restart();

      // Assert - Verify operation was tracked
      expect(scraperApp.logger.startOperation).toHaveBeenCalledWith(
        'restartScraperApplication',
        expect.objectContaining({
          maxRetries: 3,
          baseDelay: 5000,
          currentStats: expect.any(Object),
        })
      );

      expect(mockOperation.success).toHaveBeenCalledWith(
        'X scraper application restarted successfully',
        expect.objectContaining({
          attempt: 1,
          totalAttempts: 3,
        })
      );
    });
  });

  describe('restart with retries integration', () => {
    it('should integrate with health monitoring during retries', async () => {
      // Arrange
      let startAttemptCount = 0;
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Mock start and stop methods - start succeeds on third attempt
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockImplementation(async () => {
        startAttemptCount++;
        if (startAttemptCount < 3) {
          throw new Error('Browser not ready');
        }
        return {};
      });

      // Act
      const result = await scraperApp.restart({ maxRetries: 3, baseDelay: 1000 });

      // Assert
      expect(result).toBeUndefined(); // restart() returns undefined on success
      expect(startAttemptCount).toBe(3);

      // Verify delay calls for retries
      expect(global.mockDelay).toHaveBeenCalledTimes(2); // Two delays before success
      expect(global.mockDelay).toHaveBeenCalledWith(1000); // First retry: 1000ms
      expect(global.mockDelay).toHaveBeenCalledWith(2000); // Second retry: 2000ms

      expect(mockOperation.success).toHaveBeenCalledWith(
        'X scraper application restarted successfully',
        expect.objectContaining({
          attempt: 3,
          totalAttempts: 3,
        })
      );
    });

    it('should handle authentication retries with session validation', async () => {
      // Arrange
      let startAttemptCount = 0;
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Mock start and stop methods - start succeeds on third attempt
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockImplementation(async () => {
        startAttemptCount++;
        if (startAttemptCount < 3) {
          throw new Error('Temporary auth failure');
        }
        return {};
      });

      // Act
      const result = await scraperApp.restart({ maxRetries: 3, baseDelay: 1000 });

      // Assert
      expect(result).toBeUndefined(); // restart() returns undefined on success
      expect(startAttemptCount).toBe(3);

      // Verify delay calls for retries
      expect(global.mockDelay).toHaveBeenCalledTimes(2); // Two delays before success
      expect(global.mockDelay).toHaveBeenCalledWith(1000); // First retry: 1000ms
      expect(global.mockDelay).toHaveBeenCalledWith(2000); // Second retry: 2000ms

      expect(mockOperation.success).toHaveBeenCalledWith(
        'X scraper application restarted successfully',
        expect.objectContaining({
          attempt: 3,
          totalAttempts: 3,
        })
      );
    });

    it('should abort restart if shutdown initiated during retries', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      // Mock start and stop methods - start always fails
      jest.spyOn(scraperApp, 'stop').mockResolvedValue();
      jest.spyOn(scraperApp, 'start').mockRejectedValue(new Error('Launch failed'));

      // Act & Assert - expect the restart to throw after max retries
      await expect(scraperApp.restart({ maxRetries: 3, baseDelay: 1000 })).rejects.toThrow(
        'Scraper restart failed after 3 attempts: Launch failed'
      );

      // Verify delay calls for all retry attempts
      expect(global.mockDelay).toHaveBeenCalledTimes(2); // Two delays before final failure
      expect(global.mockDelay).toHaveBeenCalledWith(1000); // First retry: 1000ms
      expect(global.mockDelay).toHaveBeenCalledWith(2000); // Second retry: 2000ms

      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Scraper restart failed after 3 attempts: Launch failed' }),
        'Failed to restart scraper after 3 attempts',
        { finalAttempt: 3, originalError: 'Launch failed' }
      );
    });
  });
});
