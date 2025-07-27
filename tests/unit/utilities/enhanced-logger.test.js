import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EnhancedLogger, createEnhancedLogger } from '../../../src/utilities/enhanced-logger.js';

// UTC time utilities will be imported as-is for this test

describe('EnhancedLogger', () => {
  let mockBaseLogger;
  let mockDebugManager;
  let mockMetricsManager;
  let enhancedLogger;

  beforeEach(() => {
    mockBaseLogger = {
      child: jest.fn().mockReturnThis(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    mockDebugManager = {
      shouldLog: jest.fn(() => true),
      isEnabled: jest.fn(() => true),
      getLevel: jest.fn(() => 3),
    };

    mockMetricsManager = {
      recordTiming: jest.fn(),
      incrementCounter: jest.fn(),
    };

    enhancedLogger = new EnhancedLogger('test-module', mockBaseLogger, mockDebugManager, mockMetricsManager);
  });

  describe('constructor', () => {
    it('should create enhanced logger with module name', () => {
      expect(enhancedLogger.moduleName).toBe('test-module');
      expect(mockBaseLogger.child).toHaveBeenCalledWith({ module: 'test-module' });
    });

    it('should work without debug or metrics managers', () => {
      const logger = new EnhancedLogger('test', mockBaseLogger);
      expect(logger).toBeDefined();
    });
  });

  describe('generateCorrelationId', () => {
    it('should generate unique correlation IDs', () => {
      const id1 = enhancedLogger.generateCorrelationId();
      const id2 = enhancedLogger.generateCorrelationId();

      expect(id1).toMatch(/^[a-f0-9]{16}$/);
      expect(id2).toMatch(/^[a-f0-9]{16}$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('startOperation', () => {
    it('should create operation tracker', () => {
      const operation = enhancedLogger.startOperation('testOp', { testData: 'value' });

      expect(operation).toHaveProperty('success');
      expect(operation).toHaveProperty('error');
      expect(operation).toHaveProperty('progress');
      expect(operation.correlationId).toMatch(/^[a-f0-9]{16}$/);
      expect(operation.context.testData).toBe('value');
    });

    it('should use provided correlation ID', () => {
      const correlationId = 'test-correlation-id';
      const operation = enhancedLogger.startOperation('testOp', { correlationId });

      expect(operation.correlationId).toBe(correlationId);
    });

    it('should track active operations', () => {
      const operation = enhancedLogger.startOperation('testOp');
      const activeOps = enhancedLogger.getActiveOperations();

      expect(activeOps).toHaveLength(1);
      expect(activeOps[0].name).toBe('testOp');
      expect(activeOps[0].correlationId).toBe(operation.correlationId);
    });
  });

  describe('operation tracking', () => {
    let operation;

    beforeEach(() => {
      operation = enhancedLogger.startOperation('testOp', { testId: '123' });
    });

    it('should handle successful operations', () => {
      const result = operation.success('Operation completed', { additionalData: 'value' });

      expect(result.success).toBe(true);
      expect(result.correlationId).toBe(operation.correlationId);
      expect(mockBaseLogger.info).toHaveBeenCalledWith(
        'Operation completed',
        expect.objectContaining({
          testId: '123',
          additionalData: 'value',
          outcome: 'success',
          module: 'test-module',
        })
      );
      expect(mockMetricsManager.recordTiming).toHaveBeenCalledWith('test-module.testOp', expect.any(Number));
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('test-module.testOp.success');
    });

    it('should handle failed operations', () => {
      const error = new Error('Test error');
      const result = operation.error(error, 'Operation failed', { context: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(mockBaseLogger.error).toHaveBeenCalledWith(
        'Operation failed',
        expect.objectContaining({
          testId: '123',
          context: 'test',
          outcome: 'error',
          error: 'Test error',
          stack: error.stack,
        })
      );
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('test-module.testOp.error');
    });

    it('should handle progress updates', () => {
      const result = operation.progress('Step 1 completed', { step: 1 });

      expect(result.correlationId).toBe(operation.correlationId);
      expect(mockBaseLogger.debug).toHaveBeenCalledWith(
        'Step 1 completed',
        expect.objectContaining({
          testId: '123',
          step: 1,
          outcome: 'progress',
        })
      );
    });

    it('should remove operation from active list on completion', () => {
      expect(enhancedLogger.getActiveOperations()).toHaveLength(1);

      operation.success('Completed');

      expect(enhancedLogger.getActiveOperations()).toHaveLength(0);
    });
  });

  describe('logging methods', () => {
    it('should log error messages always', () => {
      enhancedLogger.error('Test error', { data: 'value' });

      expect(mockBaseLogger.error).toHaveBeenCalledWith(
        'Test error',
        expect.objectContaining({
          data: 'value',
          module: 'test-module',
          timestamp: expect.any(Number),
        })
      );
    });

    it('should log warning messages always', () => {
      enhancedLogger.warn('Test warning', { data: 'value' });

      expect(mockBaseLogger.warn).toHaveBeenCalledWith(
        'Test warning',
        expect.objectContaining({
          data: 'value',
          module: 'test-module',
        })
      );
    });

    it('should respect debug manager for info messages', () => {
      mockDebugManager.shouldLog.mockReturnValue(false);

      enhancedLogger.info('Test info');

      expect(mockDebugManager.shouldLog).toHaveBeenCalledWith('test-module', 3);
      expect(mockBaseLogger.info).not.toHaveBeenCalled();
    });

    it('should log info messages when debug enabled', () => {
      mockDebugManager.shouldLog.mockReturnValue(true);

      enhancedLogger.info('Test info', { data: 'value' });

      expect(mockBaseLogger.info).toHaveBeenCalledWith(
        'Test info',
        expect.objectContaining({
          data: 'value',
          module: 'test-module',
        })
      );
    });

    it('should fallback to basic logging when debug manager fails', () => {
      mockDebugManager.shouldLog.mockImplementation(() => {
        throw new Error('Debug manager error');
      });

      enhancedLogger.info('Test info');

      expect(mockBaseLogger.info).toHaveBeenCalled();
    });
  });

  describe('context sanitization', () => {
    it('should sanitize sensitive information', () => {
      const sensitiveContext = {
        password: 'secret123',
        apiKey: 'key456',
        token: 'token789',
        normalData: 'safe',
        nested: {
          secret: 'hidden',
          public: 'visible',
        },
      };

      enhancedLogger.info('Test message', sensitiveContext);

      const loggedContext = mockBaseLogger.info.mock.calls[0][1];
      expect(loggedContext.password).toBe('[REDACTED]');
      expect(loggedContext.apiKey).toBe('[REDACTED]');
      expect(loggedContext.token).toBe('[REDACTED]');
      expect(loggedContext.normalData).toBe('safe');
      expect(loggedContext.nested.secret).toBe('[REDACTED]');
      expect(loggedContext.nested.public).toBe('visible');
    });

    it('should handle non-object contexts', () => {
      enhancedLogger.info('Test message', 'string context');
      expect(mockBaseLogger.info).toHaveBeenCalled();
    });
  });

  describe('child logger', () => {
    it('should create child logger with additional context', () => {
      const childLogger = enhancedLogger.child({ requestId: '123' });

      childLogger.info('Child message', { data: 'value' });

      expect(mockBaseLogger.info).toHaveBeenCalledWith(
        'Child message',
        expect.objectContaining({
          requestId: '123',
          data: 'value',
        })
      );
    });
  });

  describe('measure function', () => {
    it('should measure synchronous function execution', async () => {
      const testFn = jest.fn(() => 'result');

      const result = await enhancedLogger.measure('testOperation', testFn, { context: 'test' });

      expect(result).toBe('result');
      expect(testFn).toHaveBeenCalled();
      expect(mockBaseLogger.info).toHaveBeenCalledWith(
        'testOperation completed',
        expect.objectContaining({ outcome: 'success' })
      );
    });

    it('should measure asynchronous function execution', async () => {
      const testFn = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'async result';
      });

      const result = await enhancedLogger.measure('asyncOperation', testFn);

      expect(result).toBe('async result');
      expect(mockBaseLogger.info).toHaveBeenCalledWith(
        'asyncOperation completed',
        expect.objectContaining({ outcome: 'success' })
      );
    });

    it('should handle function errors', async () => {
      const error = new Error('Function failed');
      const testFn = jest.fn(() => {
        throw error;
      });

      await expect(enhancedLogger.measure('failingOperation', testFn)).rejects.toThrow('Function failed');

      expect(mockBaseLogger.error).toHaveBeenCalledWith(
        'failingOperation failed',
        expect.objectContaining({
          outcome: 'error',
          error: 'Function failed',
        })
      );
    });
  });

  describe('forOperation', () => {
    it('should create operation-specific logger', () => {
      const opLogger = enhancedLogger.forOperation('specificOp', 'correlation-123');

      opLogger.info('Operation message');

      expect(mockBaseLogger.info).toHaveBeenCalledWith(
        'Operation message',
        expect.objectContaining({
          operation: 'specificOp',
          correlationId: 'correlation-123',
        })
      );
    });

    it('should generate correlation ID if not provided', () => {
      const opLogger = enhancedLogger.forOperation('specificOp');

      opLogger.info('Operation message');

      const loggedContext = mockBaseLogger.info.mock.calls[0][1];
      expect(loggedContext.correlationId).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('getStats', () => {
    it('should return logger statistics', () => {
      const operation1 = enhancedLogger.startOperation('op1');
      const operation2 = enhancedLogger.startOperation('op2');

      const stats = enhancedLogger.getStats();

      expect(stats.moduleName).toBe('test-module');
      expect(stats.activeOperations).toBe(2);
      expect(stats.debugEnabled).toBe(true);
      expect(stats.debugLevel).toBe(3);
    });
  });

  describe('createEnhancedLogger function', () => {
    it('should create enhanced logger instance', () => {
      const logger = createEnhancedLogger('test', mockBaseLogger, mockDebugManager, mockMetricsManager);

      expect(logger).toBeInstanceOf(EnhancedLogger);
      expect(logger.moduleName).toBe('test');
    });
  });

  describe('metrics integration', () => {
    it('should handle missing metrics manager gracefully', () => {
      const logger = new EnhancedLogger('test', mockBaseLogger, mockDebugManager, null);
      const operation = logger.startOperation('testOp');

      expect(() => operation.success('Completed')).not.toThrow();
    });

    it('should handle metrics manager errors gracefully', () => {
      mockMetricsManager.recordTiming.mockImplementation(() => {
        throw new Error('Metrics error');
      });

      const operation = enhancedLogger.startOperation('testOp');

      expect(() => operation.success('Completed')).not.toThrow();
      expect(mockBaseLogger.info).toHaveBeenCalled();
    });
  });

  describe('fallback logging', () => {
    it('should fallback to console when base logger unavailable', () => {
      const consoleSpy = jest.spyOn(console, 'info').mockImplementation();
      const logger = new EnhancedLogger('test', null, mockDebugManager);

      logger.info('Test message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
