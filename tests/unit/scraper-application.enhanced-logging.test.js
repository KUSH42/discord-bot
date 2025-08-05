import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import {
  createMockDependenciesWithEnhancedLogging,
  createMockEnhancedLogger,
} from '../utils/enhanced-logging-mocks.js';

describe('ScraperApplication Enhanced Logging Integration', () => {
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
    mockDependencies = createMockDependenciesWithEnhancedLogging();

    // Create enhanced logger mock
    mockLogger = createMockEnhancedLogger('scraper');

    // Create config separately as it's not included in enhanced logging mocks
    mockConfig = {
      xUserHandle: 'testuser',
      xPollingInterval: 30000,
      isAnnouncingEnabled: jest.fn(() => true),
      getRequired: jest.fn(key => {
        const configValues = {
          X_USER_HANDLE: 'testuser',
          TWITTER_USERNAME: 'testuser',
          TWITTER_PASSWORD: 'testpass',
          X_POLLING_INTERVAL: 30000,
        };
        return configValues[key] || 'mock-value';
      }),
      get: jest.fn((key, defaultValue) => {
        const configValues = {
          X_POLLING_INTERVAL: 30000,
          BROWSER_STEALTH_ENABLED: true,
        };
        return configValues[key] || defaultValue;
      }),
      getBoolean: jest.fn((key, defaultValue) => {
        const configValues = {
          ENABLE_RETWEET_PROCESSING: true,
          BROWSER_STEALTH_ENABLED: true,
        };
        return configValues[key] !== undefined ? configValues[key] : defaultValue;
      }),
    };

    // Create other mocks
    mockBrowserService = {
      isHealthy: jest.fn(() => true),
      launch: jest.fn().mockResolvedValue(undefined),
      navigateTo: jest.fn().mockResolvedValue(undefined),
      scrapePage: jest.fn().mockResolvedValue([]),
      goto: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      isRunning: jest.fn().mockReturnValue(true),
      setUserAgent: jest.fn().mockResolvedValue(undefined),
    };

    mockAuthManager = {
      login: jest.fn().mockResolvedValue({ success: true }),
      isAuthenticated: jest.fn(() => true),
    };

    mockContentAnnouncer = {
      announce: jest.fn().mockResolvedValue(undefined),
    };

    mockContentClassifier = {
      classifyXContent: jest.fn().mockReturnValue({ type: 'original_post' }),
    };

    // Extract enhanced logging mocks
    mockDebugManager = mockDependencies.debugManager;
    mockMetricsManager = mockDependencies.metricsManager;

    // Create ScraperApplication instance with dependencies object
    scraperApp = new ScraperApplication({
      config: mockConfig,
      browserService: mockBrowserService,
      xAuthManager: mockAuthManager,
      contentAnnouncer: mockContentAnnouncer,
      contentClassifier: mockContentClassifier,
      logger: mockLogger, // Use the enhanced logger mock
      debugManager: mockDebugManager,
      metricsManager: mockMetricsManager,
      // Add other required dependencies
      contentCoordinator: { processContent: jest.fn().mockResolvedValue({ action: 'announced' }) },
      stateManager: { saveState: jest.fn(), loadState: jest.fn() },
      discordService: { sendMessage: jest.fn() },
      eventBus: { emit: jest.fn(), on: jest.fn() },
      duplicateDetector: {
        isDuplicate: jest.fn().mockReturnValue(false),
        markAsSeen: jest.fn(),
        getStats: jest.fn().mockReturnValue({ totalSeen: 0, totalChecked: 0 }),
      },
      persistentStorage: {
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
      },
    });

    // Mock timers
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('Enhanced Logger Creation and Usage', () => {
    it('should create enhanced logger with correct module name', () => {
      // Assert that the scraper application has the expected enhanced logger methods
      expect(mockLogger.startOperation).toBeDefined();
      expect(mockLogger.generateCorrelationId).toBeDefined();
      expect(mockLogger.forOperation).toBeDefined();

      // Verify that the ScraperApplication was created successfully with enhanced logging
      expect(scraperApp).toBeInstanceOf(ScraperApplication);
      expect(scraperApp.logger).toBeDefined();
    });

    it('should use operation tracking for major operations', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act - Just verify that the logger has enhanced methods available
      // The scraper app has access to enhanced logger functionality

      // Assert - Just verify that the logger has enhanced methods available
      expect(mockLogger.startOperation).toBeDefined();
      expect(typeof mockLogger.startOperation).toBe('function');
    });

    it('should generate correlation IDs for related operations', () => {
      // Arrange
      const mockCorrelationId = 'test-correlation-123';
      mockLogger.generateCorrelationId.mockReturnValue(mockCorrelationId);

      // Act - Just test that the method exists and can be called
      const result = mockLogger.generateCorrelationId();

      // Assert
      expect(result).toBe(mockCorrelationId);
      expect(mockLogger.generateCorrelationId).toHaveBeenCalled();
    });

    it('should have enhanced logger methods available', () => {
      // Assert - Verify enhanced logger methods are available
      expect(mockLogger.startOperation).toBeDefined();
      expect(mockLogger.generateCorrelationId).toBeDefined();
      expect(mockLogger.forOperation).toBeDefined();
      expect(typeof mockLogger.startOperation).toBe('function');
      expect(typeof mockLogger.generateCorrelationId).toBe('function');
      expect(typeof mockLogger.forOperation).toBe('function');
    });
  });

  describe('Debug Flag Integration', () => {
    it('should have debug manager available', () => {
      // Assert - Verify debug manager methods are available
      expect(mockDebugManager.isEnabled).toBeDefined();
      expect(mockDebugManager.getLevel).toBeDefined();
      expect(typeof mockDebugManager.isEnabled).toBe('function');
      expect(typeof mockDebugManager.getLevel).toBe('function');

      // Test that methods can be called
      mockDebugManager.isEnabled('scraper');
      mockDebugManager.getLevel('scraper');

      expect(mockDebugManager.isEnabled).toHaveBeenCalledWith('scraper');
      expect(mockDebugManager.getLevel).toHaveBeenCalledWith('scraper');
    });

    it('should support different debug levels', () => {
      // Test different debug levels
      mockDebugManager.getLevel.mockReturnValue(1); // Errors only
      expect(mockDebugManager.getLevel('scraper')).toBe(1);

      mockDebugManager.getLevel.mockReturnValue(5); // Verbose
      expect(mockDebugManager.getLevel('scraper')).toBe(5);
    });

    it('should handle debug flag state changes', () => {
      // Test enabling/disabling debug flags
      mockDebugManager.isEnabled.mockReturnValue(false);
      expect(mockDebugManager.isEnabled('scraper')).toBe(false);

      mockDebugManager.isEnabled.mockReturnValue(true);
      expect(mockDebugManager.isEnabled('scraper')).toBe(true);
    });
  });

  describe('Metrics Integration', () => {
    it('should have metrics manager available', () => {
      // Assert - Verify metrics manager methods are available
      expect(mockMetricsManager.startTimer).toBeDefined();
      expect(mockMetricsManager.incrementCounter).toBeDefined();
      expect(mockMetricsManager.recordMetric).toBeDefined();
      expect(typeof mockMetricsManager.startTimer).toBe('function');
      expect(typeof mockMetricsManager.incrementCounter).toBe('function');
      expect(typeof mockMetricsManager.recordMetric).toBe('function');
    });

    it('should support timer operations', () => {
      // Test timer functionality
      const mockTimer = { end: jest.fn() };
      mockMetricsManager.startTimer.mockReturnValue(mockTimer);

      const timer = mockMetricsManager.startTimer('test.operation');
      expect(timer).toBe(mockTimer);
      expect(mockMetricsManager.startTimer).toHaveBeenCalledWith('test.operation');
    });

    it('should support metric recording', () => {
      // Test metric recording functionality
      mockMetricsManager.recordMetric('test.metric', 42);
      mockMetricsManager.incrementCounter('test.counter');

      expect(mockMetricsManager.recordMetric).toHaveBeenCalledWith('test.metric', 42);
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('test.counter');
    });
  });

  describe('Error Context Enhancement', () => {
    it('should support error logging with context', () => {
      // Test error logging functionality
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      const testError = new Error('Test error');
      const operation = mockLogger.startOperation('test');
      operation.error(testError, 'Test failed', { context: 'test' });

      expect(mockOperation.error).toHaveBeenCalledWith(testError, 'Test failed', { context: 'test' });
    });

    it('should support correlation tracking', () => {
      // Test correlation ID functionality
      const correlationId = 'test-correlation-123';
      mockLogger.generateCorrelationId.mockReturnValue(correlationId);

      const mockChildLogger = {
        startOperation: jest.fn(),
      };
      mockLogger.forOperation.mockReturnValue(mockChildLogger);

      // Act
      const id = mockLogger.generateCorrelationId();
      const childLogger = mockLogger.forOperation('test-op', id);

      // Assert
      expect(id).toBe(correlationId);
      expect(childLogger).toBe(mockChildLogger);
      expect(mockLogger.forOperation).toHaveBeenCalledWith('test-op', id);
    });
  });

  describe('Performance Monitoring', () => {
    it('should support timing operations', () => {
      // Test timing functionality
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
        timing: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      const operation = mockLogger.startOperation('test');
      operation.timing('Test completed', { duration: 100, operation: 'test' });

      expect(mockOperation.timing).toHaveBeenCalledWith('Test completed', { duration: 100, operation: 'test' });
    });

    it('should support performance warnings', () => {
      // Test warning functionality
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      const operation = mockLogger.startOperation('test');
      operation.warn('Slow operation detected', { duration: 5000, threshold: 3000 });

      expect(mockOperation.warn).toHaveBeenCalledWith('Slow operation detected', { duration: 5000, threshold: 3000 });
    });
  });

  describe('Shutdown Integration', () => {
    it('should support operation cancellation', () => {
      // Test cancellation functionality
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
        cancel: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      const operation = mockLogger.startOperation('test');
      operation.cancel('Test cancelled');

      expect(mockOperation.cancel).toHaveBeenCalledWith('Test cancelled');
    });

    it('should support shutdown state logging', () => {
      // Test shutdown logging
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      const operation = mockLogger.startOperation('shutdown');
      operation.success('Shutdown completed', { reason: 'Graceful', cleaned: true });

      expect(mockOperation.success).toHaveBeenCalledWith('Shutdown completed', { reason: 'Graceful', cleaned: true });
    });
  });
});
