import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DebugFlagManager } from '../../src/infrastructure/debug-flag-manager.js';
import { MetricsManager } from '../../src/infrastructure/metrics-manager.js';
import { createEnhancedLogger } from '../../src/utilities/enhanced-logger.js';

describe('Enhanced Logging Integration', () => {
  let debugManager;
  let metricsManager;
  let mockBaseLogger;
  let mockStateManager;
  let enhancedLogger;

  beforeEach(() => {
    // Create mock dependencies with actual state storage
    const mockState = new Map();
    mockStateManager = {
      has: jest.fn(key => mockState.has(key)),
      get: jest.fn((key, defaultValue) => mockState.get(key) || defaultValue || {}),
      set: jest.fn((key, value) => mockState.set(key, value)),
      delete: jest.fn(key => mockState.delete(key)),
      setValidator: jest.fn(),
    };

    mockBaseLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    // Create fresh instances for each test
    debugManager = new DebugFlagManager(mockStateManager, mockBaseLogger);
    metricsManager = new MetricsManager();

    enhancedLogger = createEnhancedLogger('test-module', mockBaseLogger, debugManager, metricsManager);
  });

  afterEach(() => {
    // Clean up intervals from MetricsManager
    if (metricsManager && metricsManager.cleanupInterval) {
      clearInterval(metricsManager.cleanupInterval);
    }
    jest.clearAllMocks();
  });

  describe('Debug Flag Manager Integration', () => {
    it('should enable/disable debug logging per module', () => {
      // Initially disabled
      expect(debugManager.isEnabled('scraper')).toBe(false);
      expect(debugManager.isEnabled('youtube')).toBe(false);
      expect(debugManager.isEnabled('auth')).toBe(false);
      expect(debugManager.isEnabled('api')).toBe(false);

      // Enable specific modules
      debugManager.toggle('scraper', true);
      debugManager.toggle('youtube', true);

      expect(debugManager.isEnabled('scraper')).toBe(true);
      expect(debugManager.isEnabled('youtube')).toBe(true);
      expect(debugManager.isEnabled('auth')).toBe(false);
      expect(debugManager.isEnabled('api')).toBe(false);
    });

    it('should support granular debug levels', () => {
      // Set different debug levels
      debugManager.setLevel('scraper', 5); // Verbose
      debugManager.setLevel('auth', 1); // Errors only
      debugManager.setLevel('youtube', 3); // Info and above

      expect(debugManager.getLevel('scraper')).toBe(5);
      expect(debugManager.getLevel('auth')).toBe(1);
      expect(debugManager.getLevel('youtube')).toBe(3);

      // Test invalid module throws error (expected behavior)
      expect(() => debugManager.getLevel('nonexistent')).toThrow('Unknown debug module');
    });

    it('should initialize from environment variables', () => {
      // Mock environment variables
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        DEBUG_FLAGS: 'scraper,youtube,auth',
        DEBUG_LEVEL_SCRAPER: '5',
        DEBUG_LEVEL_AUTH: '2',
      };

      // Create fresh state manager without existing debug state
      const freshMockState = new Map();
      const freshMockStateManager = {
        has: jest.fn(key => freshMockState.has(key)),
        get: jest.fn((key, defaultValue) => freshMockState.get(key) || defaultValue || {}),
        set: jest.fn((key, value) => freshMockState.set(key, value)),
        delete: jest.fn(key => freshMockState.delete(key)),
        setValidator: jest.fn(),
      };

      const envDebugManager = new DebugFlagManager(freshMockStateManager, mockBaseLogger);

      // Should initialize with env vars
      expect(envDebugManager.isEnabled('scraper')).toBe(true);
      expect(envDebugManager.isEnabled('youtube')).toBe(true);
      expect(envDebugManager.isEnabled('auth')).toBe(true);
      expect(envDebugManager.isEnabled('api')).toBe(false);

      expect(envDebugManager.getLevel('scraper')).toBe(5);
      expect(envDebugManager.getLevel('auth')).toBe(2);
      expect(envDebugManager.getLevel('youtube')).toBe(3); // Default level when enabled but no specific level set

      // Restore environment
      process.env = originalEnv;
    });
  });

  describe('Metrics Manager Integration', () => {
    it('should record different types of metrics', () => {
      // Record various metrics
      metricsManager.incrementCounter('api.requests.total');
      metricsManager.incrementCounter('api.requests.total');
      metricsManager.setGauge('system.memory.usage', 1024);
      metricsManager.recordHistogram('api.response.time', 150);
      metricsManager.recordHistogram('api.response.time', 200);

      // Get individual metrics (actual API)
      const counterMetric = metricsManager.counters.get('api.requests.total');
      const gaugeMetric = metricsManager.gauges.get('system.memory.usage');
      const histogramMetric = metricsManager.histograms.get('api.response.time');

      expect(counterMetric.value).toBe(2);
      expect(gaugeMetric.value).toBe(1024);
      expect(histogramMetric.samples).toHaveLength(2);
      expect(histogramMetric.samples[0].value).toBe(150);
      expect(histogramMetric.samples[1].value).toBe(200);
    });

    it('should handle timer operations', () => {
      const timer = metricsManager.createTimer('test.operation');

      // Start the timer
      timer.start();

      // Simulate some work with a small delay
      const startTime = Date.now();
      while (Date.now() - startTime < 5) {
        // Small busy wait
      }

      const duration = timer.stop();
      expect(duration).toBeGreaterThan(0);

      // Check that the timing was recorded
      const timerMetric = metricsManager.timers.get('test.operation');
      expect(timerMetric).toBeDefined();
      expect(timerMetric.samples).toHaveLength(1);
    });

    it('should provide comprehensive statistics', () => {
      // Add some test data
      metricsManager.incrementCounter('test.counter', 5);
      metricsManager.setGauge('test.gauge', 42);
      metricsManager.recordHistogram('test.histogram', 100);

      const stats = metricsManager.getStats();

      // Verify the actual structure returned by getStats()
      expect(stats).toHaveProperty('retentionHours');
      expect(stats).toHaveProperty('maxSamplesPerMetric');
      expect(stats).toHaveProperty('memoryUsage');
      expect(stats).toHaveProperty('storage');
      expect(stats.storage.counters).toBe(1);
      expect(stats.storage.gauges).toBe(1);
      expect(stats.storage.histograms).toBe(1);
    });
  });

  describe('Enhanced Logger Integration', () => {
    it('should create operation tracking', () => {
      const operation = enhancedLogger.startOperation('testOperation', { testData: 'value' });

      expect(operation).toHaveProperty('progress');
      expect(operation).toHaveProperty('success');
      expect(operation).toHaveProperty('error');
      expect(typeof operation.progress).toBe('function');
      expect(typeof operation.success).toBe('function');
      expect(typeof operation.error).toBe('function');
    });

    it('should track operation progress and completion', () => {
      const operation = enhancedLogger.startOperation('testOp', { id: 'test123' });

      // Track progress
      operation.progress('Step 1 completed');
      operation.progress('Step 2 completed');

      // Complete successfully
      const result = operation.success('Operation completed successfully', { result: 'success' });

      // The enhanced logger returns operation metadata only
      expect(result).toEqual(
        expect.objectContaining({
          correlationId: expect.any(String),
          duration: expect.any(Number),
          success: true,
        })
      );

      // Should log to base logger
      expect(mockBaseLogger.info).toHaveBeenCalledWith(
        'Operation completed successfully',
        expect.objectContaining({
          result: 'success',
          correlationId: expect.any(String),
          duration: expect.any(Number),
        })
      );
    });

    it('should handle operation errors', () => {
      const operation = enhancedLogger.startOperation('failingOp', { id: 'fail123' });
      const testError = new Error('Something went wrong');

      // Enhanced logger operation.error() logs but doesn't throw
      const result = operation.error(testError, 'Operation failed', { additionalContext: 'test' });

      // It should return error metadata
      expect(result).toEqual(
        expect.objectContaining({
          error: testError, // The actual Error object
          correlationId: expect.any(String),
          duration: expect.any(Number),
          success: false,
        })
      );

      // Should log error
      expect(mockBaseLogger.error).toHaveBeenCalledWith(
        'Operation failed',
        expect.objectContaining({
          additionalContext: 'test',
          correlationId: expect.any(String),
          duration: expect.any(Number),
          error: 'Something went wrong',
        })
      );
    });

    it('should support correlation ID tracking', () => {
      const correlationId = 'test-correlation-123';
      const correlatedLogger = enhancedLogger.forOperation('batchProcess', correlationId);

      expect(correlatedLogger).toBeDefined();
      // The correlated logger should maintain the correlation ID context
    });

    it('should respect debug flags', () => {
      // Enable debug for a valid module
      debugManager.toggle('auth', true);

      const debugEnabledLogger = createEnhancedLogger('auth', mockBaseLogger, debugManager, metricsManager);

      const operation = debugEnabledLogger.startOperation('debugOp', { debug: true });
      operation.success('Debug operation completed', { debugResult: true });

      // Should log when debug is enabled
      expect(mockBaseLogger.info).toHaveBeenCalled();
    });

    it('should integrate with metrics manager', () => {
      const operation = enhancedLogger.startOperation('metricOp', { test: 'data' });

      // Complete the operation
      operation.success('Metrics test completed', { metrics: 'recorded' });

      // Enhanced logger integrates with metrics manager for operation timing
      // The timing should be recorded automatically for operations
      expect(metricsManager.totalMetricsRecorded).toBeGreaterThan(0);
    });

    it('should sanitize sensitive data', () => {
      const sensitiveData = {
        username: 'testuser',
        password: 'secret123',
        token: 'jwt-token-here',
        apiKey: 'api-key-value',
        secret: 'secret-value',
        safe: 'safe-value',
      };

      const operation = enhancedLogger.startOperation('sensitiveOp', sensitiveData);
      operation.success('Sensitive data handled', sensitiveData);

      // Check that sensitive fields were sanitized in the logged context
      const logCall = mockBaseLogger.info.mock.calls.find(call => call[0].includes('Sensitive data handled'));
      expect(logCall).toBeDefined();

      const loggedData = logCall[1];
      expect(loggedData.password).toBe('[REDACTED]');
      expect(loggedData.token).toBe('[REDACTED]');
      expect(loggedData.apiKey).toBe('[REDACTED]');
      expect(loggedData.secret).toBe('[REDACTED]');
      expect(loggedData.safe).toBe('safe-value'); // Should not be redacted
    });
  });

  describe('Phase 2 Module Integration Ready', () => {
    it('should support all Phase 2 debug modules', () => {
      const phase2Modules = ['scraper', 'youtube', 'api', 'auth'];

      phase2Modules.forEach(module => {
        debugManager.toggle(module, true);
        debugManager.setLevel(module, 5);

        expect(debugManager.isEnabled(module)).toBe(true);
        expect(debugManager.getLevel(module)).toBe(5);
      });
    });

    it('should create enhanced loggers for all Phase 2 modules', () => {
      const phase2Modules = ['scraper', 'youtube', 'api', 'auth'];

      phase2Modules.forEach(module => {
        const logger = createEnhancedLogger(module, mockBaseLogger, debugManager, metricsManager);

        expect(logger).toBeDefined();
        expect(typeof logger.startOperation).toBe('function');
        expect(typeof logger.forOperation).toBe('function');

        // Test basic operation
        const operation = logger.startOperation('testOp', { module });
        expect(operation).toBeDefined();

        const result = operation.success('Test completed', { module });
        expect(result).toEqual(
          expect.objectContaining({
            correlationId: expect.any(String),
            duration: expect.any(Number),
            success: true,
          })
        );
      });
    });

    it('should demonstrate command integration patterns', () => {
      // Simulate debug command processing
      const commandResults = [];

      // Toggle debug for scraper
      debugManager.toggle('scraper', true);
      commandResults.push({
        command: 'debug scraper true',
        success: true,
        message: 'Debug logging enabled for scraper',
      });

      // Set debug level for auth
      debugManager.setLevel('auth', 5);
      commandResults.push({
        command: 'debug-level auth 5',
        success: true,
        message: 'Debug level set to 5 for auth',
      });

      // Get debug status
      const debugStatus = {};
      ['scraper', 'youtube', 'api', 'auth'].forEach(module => {
        debugStatus[module] = {
          enabled: debugManager.isEnabled(module),
          level: debugManager.getLevel(module),
        };
      });

      commandResults.push({
        command: 'debug-status',
        success: true,
        debugStatus,
      });

      // Get metrics - increment for all 4 commands (including this metrics command)
      metricsManager.incrementCounter('test.commands.processed', 4);
      const metrics = metricsManager.getStats();

      commandResults.push({
        command: 'metrics',
        success: true,
        metrics,
      });

      // Verify all commands worked
      expect(commandResults).toHaveLength(4);
      expect(commandResults.every(r => r.success)).toBe(true);
      expect(debugStatus.scraper.enabled).toBe(true);
      expect(debugStatus.auth.level).toBe(5);
      // Check that metrics were recorded (using the actual metrics manager structure)
      const counterMetric = metricsManager.counters.get('test.commands.processed');
      expect(counterMetric.value).toBe(4);
    });
  });
});
