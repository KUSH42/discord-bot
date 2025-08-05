import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('ScraperApplication Health Monitoring', () => {
  let scraperApp;
  let mockDependencies;
  let mockConfig;
  let mockBrowserService;
  let mockAuthManager;
  let mockEventBus;
  let mockLogger;
  let mockContentCoordinator;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Basic timer advancement (from TIMER-TESTING-GUIDE.md)
    global.advanceAsyncTimers = async ms => {
      await jest.advanceTimersByTimeAsync(ms);
      await Promise.resolve();
      await new Promise(resolve => setImmediate(resolve));
    };

    // ADVANCED: Deep async coordination for nested operations (from ADVANCED-TIMER-PATTERNS.md)
    global.advanceAsyncTimersDeep = async (ms, maxIterations = 15) => {
      await jest.advanceTimersByTimeAsync(ms);
      for (let i = 0; i < maxIterations; i++) {
        await Promise.resolve();
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => process.nextTick(resolve));
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    };

    // ENHANCED: setInterval-specific advancement
    global.advanceIntervalTimersDeep = async (ms, maxIterations = 20) => {
      await jest.advanceTimersByTimeAsync(ms);
      for (let i = 0; i < maxIterations; i++) {
        await Promise.resolve();
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => process.nextTick(resolve));
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      // Additional tick to ensure setInterval callbacks are processed
      await new Promise(resolve => process.nextTick(resolve));
    };

    // ADVANCED: State synchronization
    global.waitForStateChange = async (stateChecker, timeoutMs = 5000) => {
      const startTime = Date.now();
      while (!stateChecker() && Date.now() - startTime < timeoutMs) {
        await global.advanceAsyncTimersDeep(10);
      }
      if (!stateChecker()) {
        throw new Error(`State change timeout after ${timeoutMs}ms`);
      }
    };

    // Create enhanced logging mocks
    const enhancedLoggingMocks = createMockDependenciesWithEnhancedLogging();

    // Mock all dependencies
    mockConfig = {
      getRequired: jest.fn(key => {
        const values = {
          X_USER_HANDLE: 'testuser',
          TWITTER_USERNAME: 'test@example.com',
          TWITTER_PASSWORD: 'testpass123',
        };
        return values[key] || `mock-${key}`;
      }),
      get: jest.fn((key, defaultValue) => {
        const values = {
          X_QUERY_INTERVAL_MIN: '300000',
          X_QUERY_INTERVAL_MAX: '600000',
        };
        return values[key] || defaultValue;
      }),
      getBoolean: jest.fn(),
    };

    mockBrowserService = {
      launch: jest.fn(),
      close: jest.fn(),
      goto: jest.fn(),
      waitForSelector: jest.fn(),
      evaluate: jest.fn(),
      setUserAgent: jest.fn(),
      isRunning: jest.fn().mockReturnValue(false),
      isHealthy: jest.fn().mockReturnValue(true),
    };

    mockAuthManager = {
      login: jest.fn(),
      isAuthenticated: jest.fn().mockResolvedValue(true),
      ensureAuthenticated: jest.fn(),
    };

    mockEventBus = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    mockLogger = enhancedLoggingMocks.enhancedLogger;

    mockContentCoordinator = {
      processContent: jest.fn().mockResolvedValue({ success: true }),
    };

    // Configure default mock returns
    mockConfig.getRequired.mockImplementation(key => {
      const defaults = {
        X_USER_HANDLE: 'testuser',
        TWITTER_USERNAME: 'testuser@example.com',
        TWITTER_PASSWORD: 'testpass',
      };
      return defaults[key] || 'default-value';
    });

    mockConfig.get.mockImplementation((key, defaultValue) => {
      const defaults = {
        X_QUERY_INTERVAL_MIN: '300000',
        X_QUERY_INTERVAL_MAX: '600000',
        X_DEBUG_SAMPLING_RATE: '0.1',
        X_VERBOSE_LOG_SAMPLING_RATE: '0.05',
        MAX_CONTENT_AGE_HOURS: '24',
        INITIALIZATION_WINDOW_HOURS: '24',
      };
      return defaults[key] || defaultValue;
    });

    mockConfig.getBoolean.mockImplementation((key, defaultValue) => {
      const defaults = {
        ANNOUNCE_OLD_TWEETS: false,
        ENABLE_RETWEET_PROCESSING: true,
      };
      return defaults[key] !== undefined ? defaults[key] : defaultValue;
    });

    mockDependencies = {
      browserService: mockBrowserService,
      config: mockConfig,
      xAuthManager: mockAuthManager,
      eventBus: mockEventBus,
      logger: mockLogger,
      contentCoordinator: mockContentCoordinator,
      debugManager: enhancedLoggingMocks.debugManager,
      metricsManager: enhancedLoggingMocks.metricsManager,
      duplicateDetector: {
        isDuplicate: jest.fn().mockReturnValue(false),
        markAsSeen: jest.fn(),
        getStats: jest.fn().mockReturnValue({ totalSeen: 0, totalChecked: 0 }),
      },
    };

    scraperApp = new ScraperApplication(mockDependencies);
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.advanceAsyncTimers;
    if (scraperApp.healthCheckInterval) {
      clearInterval(scraperApp.healthCheckInterval);
    }
    if (scraperApp.timerId) {
      clearTimeout(scraperApp.timerId);
    }
  });

  describe('startHealthMonitoring', () => {
    it('should start health monitoring with default interval', () => {
      const performHealthCheckSpy = jest.spyOn(scraperApp, 'performHealthCheck').mockResolvedValue({
        errors: [],
      });

      // Spy on the logger that actually gets used
      const loggerSpy = jest.spyOn(scraperApp.logger, 'startOperation');

      scraperApp.startHealthMonitoring();

      expect(scraperApp.healthCheckInterval).toBeDefined();
      expect(loggerSpy).toHaveBeenCalledWith(
        'startHealthMonitoring',
        expect.objectContaining({
          intervalMs: 300000,
          intervalSeconds: 300,
        })
      );
    });

    it('should start health monitoring with custom interval', () => {
      const customInterval = 120000; // 2 minutes

      // Spy on the logger that actually gets used
      const loggerSpy = jest.spyOn(scraperApp.logger, 'startOperation');

      scraperApp.startHealthMonitoring(customInterval);

      expect(scraperApp.healthCheckInterval).toBeDefined();
      expect(loggerSpy).toHaveBeenCalledWith(
        'startHealthMonitoring',
        expect.objectContaining({
          intervalMs: customInterval,
          intervalSeconds: 120,
        })
      );
    });

    it('should clear existing health check interval before starting new one', () => {
      // Start first health monitoring
      scraperApp.startHealthMonitoring(60000);
      const firstInterval = scraperApp.healthCheckInterval;

      // Start second health monitoring
      scraperApp.startHealthMonitoring(120000);
      const secondInterval = scraperApp.healthCheckInterval;

      expect(firstInterval).not.toBe(secondInterval);
      expect(scraperApp.healthCheckInterval).toBe(secondInterval);
    });

    it('should execute health checks at specified intervals', async () => {
      // Mock setInterval to capture the callback function
      let intervalCallback;
      jest.spyOn(global, 'setInterval').mockImplementation(callback => {
        intervalCallback = callback;
        return 'mock-interval-id';
      });

      const performHealthCheckSpy = jest.spyOn(scraperApp, 'performHealthCheck').mockResolvedValue({ errors: [] });

      // Mock the operation that gets created inside the interval callback for health check
      const mockHealthOperation = { success: jest.fn(), error: jest.fn() };
      const mockStartOperation = { success: jest.fn(), error: jest.fn() };
      jest.spyOn(scraperApp.logger, 'startOperation').mockImplementation(operationName => {
        if (operationName === 'performHealthCheck') {
          return mockHealthOperation;
        } else if (operationName === 'startHealthMonitoring') {
          return mockStartOperation;
        }
        return { success: jest.fn(), error: jest.fn() };
      });

      scraperApp.startHealthMonitoring(100); // 100ms for testing

      // Directly execute the interval callback instead of waiting for timer
      expect(intervalCallback).toBeDefined();
      await intervalCallback();

      expect(performHealthCheckSpy).toHaveBeenCalled();
      expect(mockHealthOperation.success).toHaveBeenCalledWith('Health check passed', { errors: [] });
    });

    it('should handle successful health checks', async () => {
      const healthResult = {
        timestamp: new Date(),
        isRunning: true,
        authenticated: true,
        browserHealthy: true,
        errors: [],
      };

      jest.spyOn(scraperApp, 'performHealthCheck').mockResolvedValue(healthResult);

      // Mock the operation that gets created inside the interval callback for health check
      const mockHealthOperation = { success: jest.fn(), error: jest.fn() };
      const mockStartOperation = { success: jest.fn(), error: jest.fn() };
      jest.spyOn(scraperApp.logger, 'startOperation').mockImplementation(operationName => {
        if (operationName === 'performHealthCheck') {
          return mockHealthOperation;
        } else if (operationName === 'startHealthMonitoring') {
          return mockStartOperation;
        }
        return { success: jest.fn(), error: jest.fn() };
      });

      // Mock setInterval to capture the callback function
      let intervalCallback;
      jest.spyOn(global, 'setInterval').mockImplementation(callback => {
        intervalCallback = callback;
        return 'mock-interval-id';
      });

      scraperApp.startHealthMonitoring(100);

      // Execute the interval callback directly
      expect(intervalCallback).toBeDefined();
      await intervalCallback();

      expect(mockHealthOperation.success).toHaveBeenCalledWith('Health check passed', healthResult);
    });

    it('should handle health check failures', async () => {
      const healthResult = {
        timestamp: new Date(),
        isRunning: true,
        authenticated: false,
        browserHealthy: false,
        errors: ['Authentication verification failed', 'Browser not available or closed'],
      };

      jest.spyOn(scraperApp, 'performHealthCheck').mockResolvedValue(healthResult);
      jest.spyOn(scraperApp, 'handleHealthCheckFailure').mockResolvedValue();

      // Mock the operation that gets created inside the interval callback for health check
      const mockHealthOperation = { success: jest.fn(), error: jest.fn() };
      const mockStartOperation = { success: jest.fn(), error: jest.fn() };
      jest.spyOn(scraperApp.logger, 'startOperation').mockImplementation(operationName => {
        if (operationName === 'performHealthCheck') {
          return mockHealthOperation;
        } else if (operationName === 'startHealthMonitoring') {
          return mockStartOperation;
        }
        return { success: jest.fn(), error: jest.fn() };
      });

      // Mock setInterval to capture the callback function
      let intervalCallback;
      jest.spyOn(global, 'setInterval').mockImplementation(callback => {
        intervalCallback = callback;
        return 'mock-interval-id';
      });

      scraperApp.startHealthMonitoring(100);

      // Execute the interval callback directly
      expect(intervalCallback).toBeDefined();
      await intervalCallback();

      expect(mockHealthOperation.error).toHaveBeenCalledWith(
        expect.any(Error),
        'Health check detected problems',
        healthResult
      );
      expect(scraperApp.handleHealthCheckFailure).toHaveBeenCalled();
    });

    it('should handle health check exceptions', async () => {
      const healthCheckError = new Error('Health check crashed');

      jest.spyOn(scraperApp, 'performHealthCheck').mockRejectedValue(healthCheckError);
      jest.spyOn(scraperApp, 'handleHealthCheckFailure').mockResolvedValue();

      // Mock the operation that gets created inside the interval callback for health check
      const mockHealthOperation = { success: jest.fn(), error: jest.fn() };
      const mockStartOperation = { success: jest.fn(), error: jest.fn() };
      jest.spyOn(scraperApp.logger, 'startOperation').mockImplementation(operationName => {
        if (operationName === 'performHealthCheck') {
          return mockHealthOperation;
        } else if (operationName === 'startHealthMonitoring') {
          return mockStartOperation;
        }
        return { success: jest.fn(), error: jest.fn() };
      });

      // Mock setInterval to capture the callback function
      let intervalCallback;
      jest.spyOn(global, 'setInterval').mockImplementation(callback => {
        intervalCallback = callback;
        return 'mock-interval-id';
      });

      scraperApp.startHealthMonitoring(100);

      // Execute the interval callback directly
      expect(intervalCallback).toBeDefined();
      await intervalCallback();

      expect(mockHealthOperation.error).toHaveBeenCalledWith(healthCheckError, 'Health check failed');
      expect(scraperApp.handleHealthCheckFailure).toHaveBeenCalledWith(healthCheckError);
    });
  });

  describe('stopHealthMonitoring', () => {
    it('should stop health monitoring when interval exists', () => {
      const mockOperation = { success: jest.fn(), error: jest.fn() };
      const loggerSpy = jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);

      scraperApp.startHealthMonitoring();
      expect(scraperApp.healthCheckInterval).toBeDefined();

      scraperApp.stopHealthMonitoring();

      expect(scraperApp.healthCheckInterval).toBeNull();
      expect(loggerSpy).toHaveBeenCalledWith('stopHealthMonitoring', {});
      expect(mockOperation.success).toHaveBeenCalledWith('Health monitoring stopped');
    });

    it('should handle stopping when no interval exists', () => {
      scraperApp.healthCheckInterval = null;

      scraperApp.stopHealthMonitoring();

      // Should not log anything when no interval exists
      expect(mockLogger.info).not.toHaveBeenCalledWith('Health monitoring stopped', expect.any(Object));
    });
  });

  describe('performHealthCheck', () => {
    beforeEach(() => {
      scraperApp.isRunning = true;
    });

    it('should return healthy status when all checks pass', async () => {
      mockBrowserService.isHealthy.mockReturnValue(true);
      mockAuthManager.isAuthenticated.mockResolvedValue(true);

      const health = await scraperApp.performHealthCheck();

      expect(health).toEqual({
        timestamp: expect.any(Date),
        isRunning: true,
        authenticated: true,
        browserHealthy: true,
        errors: [],
      });
    });

    it('should detect when application is not running', async () => {
      scraperApp.isRunning = false;

      const health = await scraperApp.performHealthCheck();

      expect(health.isRunning).toBe(false);
      expect(health.errors).toContain('Application not running');
    });

    it('should detect when browser is not healthy', async () => {
      mockBrowserService.isHealthy.mockReturnValue(false);

      const health = await scraperApp.performHealthCheck();

      expect(health.browserHealthy).toBe(false);
      expect(health.errors).toContain('Browser not available or closed');
    });

    it('should detect when browser service is missing', async () => {
      scraperApp.browser = null;

      const health = await scraperApp.performHealthCheck();

      expect(health.browserHealthy).toBe(false);
      expect(health.errors).toContain('Browser not available or closed');
    });

    it('should detect authentication failures', async () => {
      mockBrowserService.isHealthy.mockReturnValue(true);
      mockAuthManager.isAuthenticated.mockResolvedValue(false);

      const health = await scraperApp.performHealthCheck();

      expect(health.authenticated).toBe(false);
      expect(health.errors).toContain('Authentication verification failed');
    });

    it('should handle authentication check errors', async () => {
      mockBrowserService.isHealthy.mockReturnValue(true);
      mockAuthManager.isAuthenticated.mockRejectedValue(new Error('Auth check failed'));

      const health = await scraperApp.performHealthCheck();

      expect(health.authenticated).toBe(false);
      expect(health.errors).toContain('Authentication check failed: Auth check failed');
    });

    it('should skip authentication check when browser is not healthy', async () => {
      mockBrowserService.isHealthy.mockReturnValue(false);

      const health = await scraperApp.performHealthCheck();

      expect(mockAuthManager.isAuthenticated).not.toHaveBeenCalled();
      expect(health.authenticated).toBe(false);
    });

    it('should handle general health check errors', async () => {
      // Mock browser service to throw an error
      mockBrowserService.isHealthy.mockImplementation(() => {
        throw new Error('Property access failed');
      });

      const health = await scraperApp.performHealthCheck();

      expect(health.errors).toContain('Health check error: Property access failed');
    });
  });

  describe('handleHealthCheckFailure', () => {
    it('should attempt automatic recovery via restart', async () => {
      const healthError = new Error('Health check failed');
      const mockOperation = { success: jest.fn(), error: jest.fn(), progress: jest.fn() };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);
      jest.spyOn(scraperApp, 'restart').mockResolvedValue();

      await scraperApp.handleHealthCheckFailure(healthError);

      expect(scraperApp.restart).toHaveBeenCalledWith({ maxRetries: 2, baseDelay: 3000 });
      expect(mockOperation.success).toHaveBeenCalledWith(
        'Automatic recovery successful',
        expect.objectContaining({
          recoveryMethod: 'restart',
          maxRetries: 2,
        })
      );
    });

    it('should handle recovery failure and emit event', async () => {
      const healthError = new Error('Health check failed');
      const recoveryError = new Error('Recovery failed');
      const mockOperation = { success: jest.fn(), error: jest.fn(), progress: jest.fn() };
      jest.spyOn(scraperApp.logger, 'startOperation').mockReturnValue(mockOperation);
      jest.spyOn(scraperApp, 'restart').mockRejectedValue(recoveryError);

      await scraperApp.handleHealthCheckFailure(healthError);

      expect(mockEventBus.emit).toHaveBeenCalledWith('scraper.recovery.failed', {
        originalError: 'Health check failed',
        recoveryError: 'Recovery failed',
        timestamp: expect.any(Date),
      });

      expect(mockOperation.error).toHaveBeenCalledWith(
        recoveryError,
        'Automatic recovery failed',
        expect.objectContaining({
          originalError: 'Health check failed',
          recoveryMethod: 'restart',
        })
      );
    });
  });

  describe('Integration with start/stop operations', () => {
    it('should start health monitoring when application starts', async () => {
      jest.spyOn(scraperApp, 'initializeBrowser').mockResolvedValue();
      jest.spyOn(scraperApp, 'ensureAuthenticated').mockResolvedValue();
      jest.spyOn(scraperApp, 'initializeRecentContent').mockResolvedValue();
      jest.spyOn(scraperApp, 'startPolling').mockImplementation(() => {});
      jest.spyOn(scraperApp, 'startHealthMonitoring').mockImplementation(() => {});

      await scraperApp.start();

      expect(scraperApp.startHealthMonitoring).toHaveBeenCalled();
    });

    it('should stop health monitoring when application stops', async () => {
      scraperApp.isRunning = true;
      jest.spyOn(scraperApp, 'stopPolling').mockImplementation(() => {});
      jest.spyOn(scraperApp, 'closeBrowser').mockResolvedValue();
      jest.spyOn(scraperApp, 'stopHealthMonitoring').mockImplementation(() => {});

      await scraperApp.stop();

      expect(scraperApp.stopHealthMonitoring).toHaveBeenCalled();
    });
  });

  describe('Health monitoring error resilience', () => {
    it('should continue health monitoring even after individual check failures', async () => {
      let healthCheckCallCount = 0;
      let intervalCallback;

      jest.spyOn(global, 'setInterval').mockImplementation(callback => {
        intervalCallback = callback;
        return 'mock-interval-id';
      });

      jest.spyOn(scraperApp, 'performHealthCheck').mockImplementation(async () => {
        healthCheckCallCount++;
        if (healthCheckCallCount === 1) {
          throw new Error('First check failed');
        }
        return { errors: [] };
      });

      jest.spyOn(scraperApp, 'handleHealthCheckFailure').mockResolvedValue();

      scraperApp.startHealthMonitoring(100);

      // Trigger first health check (should fail)
      await intervalCallback();

      // Trigger second health check (should succeed)
      await intervalCallback();

      expect(healthCheckCallCount).toBe(2);
      expect(scraperApp.handleHealthCheckFailure).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent health monitoring operations safely', async () => {
      jest.spyOn(scraperApp, 'performHealthCheck').mockResolvedValue({ errors: [] });

      // Start multiple health monitoring instances
      scraperApp.startHealthMonitoring(5000);
      scraperApp.startHealthMonitoring(10000);
      scraperApp.startHealthMonitoring(15000);

      // Should only have one active interval (the last one)
      expect(scraperApp.healthCheckInterval).toBeDefined();

      expect(scraperApp.performHealthCheck).not.toHaveBeenCalled();
    });
  });
});
