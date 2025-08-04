/**
 * Comprehensive tests for ProcessingScheduler enhanced logging integration
 * Tests the performance module integration with callback scheduling and timing metrics
 */

import { jest } from '@jest/globals';
import { ProcessingScheduler } from '../../../../src/services/implementations/message-sender/processing-scheduler.js';
import { createEnhancedLoggerMocks } from '../../../fixtures/test-helpers.js';

describe('ProcessingScheduler', () => {
  let processingScheduler;
  let mockLogger;
  let mockDebugManager;
  let mockMetricsManager;

  beforeEach(() => {
    // Create enhanced logger mocks
    const loggerMocks = createEnhancedLoggerMocks();
    mockLogger = loggerMocks.baseLogger;
    mockDebugManager = loggerMocks.debugManager;
    mockMetricsManager = loggerMocks.metricsManager;

    // Create ProcessingScheduler with enhanced logging dependencies
    processingScheduler = new ProcessingScheduler({
      logger: mockLogger,
      debugManager: mockDebugManager,
      metricsManager: mockMetricsManager,
    });
  });

  afterEach(() => {
    if (processingScheduler) {
      processingScheduler.stop();
    }
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('Constructor and Enhanced Logging Integration', () => {
    it('should create enhanced logger with performance module', () => {
      expect(processingScheduler.logger).toBeDefined();
      expect(processingScheduler.logger).not.toBe(mockLogger);
      expect(processingScheduler.logger.moduleName).toBe('performance');
    });

    it('should initialize with default configuration', () => {
      expect(processingScheduler.isScheduled).toBe(false);
      expect(processingScheduler.scheduledCallbacks).toEqual(new Set());
      expect(processingScheduler.testMode).toBe(false);
    });

    it('should handle missing enhanced logging dependencies gracefully', () => {
      const basicScheduler = new ProcessingScheduler();
      expect(basicScheduler).toBeDefined();
      expect(basicScheduler.logger).toBeDefined();
    });

    it('should support test mode configuration', () => {
      const testScheduler = new ProcessingScheduler({ testMode: true });
      expect(testScheduler.testMode).toBe(true);
      expect(testScheduler.isTestMode()).toBe(true);
    });
  });

  describe('Enhanced Logging Operation Tracking', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('should track callback scheduling operation with enhanced logging', async () => {
      const startOperationSpy = jest.spyOn(processingScheduler.logger, 'startOperation').mockReturnValue({
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      });

      const testCallback = jest.fn();

      processingScheduler.schedule(testCallback, 1000);

      expect(startOperationSpy).toHaveBeenCalledWith('scheduleCallback', {
        testMode: false,
        requestedDelay: 1000,
      });
    });

    it('should track callback execution in production mode', async () => {
      const testCallback = jest.fn().mockResolvedValue({ processed: true });

      const result = processingScheduler.schedule(testCallback, 100);

      expect(result).toEqual({
        testMode: false,
        delay: 100,
        scheduledAt: expect.any(Number),
      });

      await jest.advanceTimersByTimeAsync(100);

      expect(testCallback).toHaveBeenCalled();
    });

    it('should handle test mode scheduling with immediate execution', () => {
      const testScheduler = new ProcessingScheduler({
        testMode: true,
        logger: mockLogger,
        debugManager: mockDebugManager,
        metricsManager: mockMetricsManager,
      });

      const testCallback = jest.fn();
      const result = testScheduler.schedule(testCallback);

      expect(result).toEqual({
        testMode: true,
        delay: 0,
        executedImmediately: true,
      });

      expect(testCallback).toHaveBeenCalled();
    });

    it('should track scheduling with jitter calculations', () => {
      const testCallback = jest.fn();

      processingScheduler.enableJitter = true;
      processingScheduler.maxJitter = 0.2;

      const result = processingScheduler.schedule(testCallback);

      expect(result.testMode).toBe(false);
      expect(typeof result.delay).toBe('number');
      expect(result.delay).toBeGreaterThan(0);
    });
  });

  describe('Performance Metrics Integration', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('should track scheduling metrics', async () => {
      const testCallback = jest.fn().mockResolvedValue({});

      processingScheduler.schedule(testCallback, 100);

      const metrics = processingScheduler.getMetrics();

      expect(metrics.totalSchedules).toBe(1);
      expect(metrics.averageDelay).toBe(100);
      expect(metrics.maxDelay).toBe(100);
    });

    it('should update metrics after multiple schedules', async () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const callback3 = jest.fn();

      processingScheduler.schedule(callback1, 100);
      processingScheduler.schedule(callback2, 200);
      processingScheduler.schedule(callback3, 300);

      const metrics = processingScheduler.getMetrics();

      expect(metrics.totalSchedules).toBe(3);
      expect(metrics.maxDelay).toBe(300);
      expect(metrics.averageDelay).toBeCloseTo(200, 0);
    });

    it('should track test mode executions separately', () => {
      const testScheduler = new ProcessingScheduler({
        testMode: true,
        logger: mockLogger,
        debugManager: mockDebugManager,
        metricsManager: mockMetricsManager,
      });
      const testCallback = jest.fn();

      testScheduler.schedule(testCallback);
      testScheduler.schedule(testCallback);

      const metrics = testScheduler.getMetrics();

      expect(metrics.testModeExecutions).toBe(2);
      expect(metrics.totalSchedules).toBe(2);
    });
  });

  describe('Callback Error Handling with Enhanced Logging', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('should handle callback execution errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const failingCallback = jest.fn().mockRejectedValue(new Error('Processing failed'));

      processingScheduler.schedule(failingCallback, 100);

      await jest.advanceTimersByTimeAsync(100);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Scheduled callback error:', expect.any(Error));

      const metrics = processingScheduler.getMetrics();
      expect(metrics.missedSchedules).toBe(1);

      consoleErrorSpy.mockRestore();
    });

    it('should handle test mode callback errors', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const testScheduler = new ProcessingScheduler({
        testMode: true,
        logger: mockLogger,
        debugManager: mockDebugManager,
        metricsManager: mockMetricsManager,
      });
      const failingCallback = jest.fn().mockImplementation(() => {
        throw new Error('Test mode error');
      });

      testScheduler.schedule(failingCallback);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Test mode callback error:', expect.any(Error));

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Scheduler Lifecycle with Enhanced Logging', () => {
    it('should track scheduler status correctly', () => {
      const status = processingScheduler.getStatus();

      expect(status).toEqual({
        testMode: false,
        isScheduled: false,
        pendingCallbacks: 0,
        testModeQueueSize: 0,
        testModeExecutions: 0,
        lastScheduledTime: 0,
        hasPendingOperations: false,
      });
    });

    it('should update status after scheduling', () => {
      jest.useFakeTimers();
      const testCallback = jest.fn();

      processingScheduler.schedule(testCallback, 100);

      const status = processingScheduler.getStatus();

      expect(status.isScheduled).toBe(true);
      expect(status.pendingCallbacks).toBe(1);
      expect(status.hasPendingOperations).toBe(true);
      expect(status.lastScheduledTime).toBeGreaterThan(0);
    });

    it('should handle stop operation with cleanup', () => {
      jest.useFakeTimers();
      const testCallback = jest.fn();

      processingScheduler.schedule(testCallback, 1000);

      expect(processingScheduler.getStatus().isScheduled).toBe(true);

      processingScheduler.stop();

      const status = processingScheduler.getStatus();
      expect(status.isScheduled).toBe(false);
      expect(status.pendingCallbacks).toBe(0);
      expect(status.hasPendingOperations).toBe(false);
    });
  });

  describe('Advanced Scheduling Features', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('should support scheduleAfter method', () => {
      const testCallback = jest.fn();

      const result = processingScheduler.scheduleAfter(testCallback, 500);

      expect(result).toEqual({
        testMode: false,
        delay: 500,
        scheduledAt: expect.any(Number),
      });
    });

    it('should support scheduleNextCheck for continuous processing', () => {
      const testCallback = jest.fn();

      // Test normal check interval
      const normalResult = processingScheduler.scheduleNextCheck(testCallback, false);
      expect(normalResult.delay).toBe(processingScheduler.baseCheckInterval);

      processingScheduler.stop();

      // Test idle check interval
      const idleResult = processingScheduler.scheduleNextCheck(testCallback, true);
      expect(idleResult.delay).toBe(processingScheduler.idleCheckInterval);
    });

    it('should calculate delays with jitter correctly', () => {
      processingScheduler.enableJitter = true;
      processingScheduler.maxJitter = 0.1;
      processingScheduler.baseCheckInterval = 1000;

      const delays = [];
      for (let i = 0; i < 10; i++) {
        const delay = processingScheduler.calculateDelay(false);
        delays.push(delay);
      }

      // Should have variation due to jitter
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);

      // All delays should be close to base interval
      delays.forEach(delay => {
        expect(delay).toBeGreaterThan(900);
        expect(delay).toBeLessThan(1100);
      });
    });

    it('should support getNextDelay method', async () => {
      const testScheduler = new ProcessingScheduler({ testMode: true });

      const delayPromise = testScheduler.getNextDelay(false);

      expect(delayPromise).toBeInstanceOf(Promise);
      await expect(delayPromise).resolves.toBeUndefined();
    });
  });

  describe('Performance Module Integration', () => {
    it('should respect performance debug flag settings', () => {
      // Test when performance debugging is enabled
      mockDebugManager.isEnabled.mockReturnValue(true);
      mockDebugManager.getLevel.mockReturnValue(5);

      const verboseScheduler = new ProcessingScheduler({
        logger: mockLogger,
        debugManager: mockDebugManager,
        metricsManager: mockMetricsManager,
      });

      expect(verboseScheduler.logger.moduleName).toBe('performance');
      expect(verboseScheduler.logger).toBeDefined();
    });

    it('should provide comprehensive metrics', () => {
      const testCallback = jest.fn();

      processingScheduler.schedule(testCallback, 150);

      const metrics = processingScheduler.getMetrics();

      expect(metrics).toEqual({
        totalSchedules: 1,
        averageDelay: 150,
        maxDelay: 150,
        missedSchedules: 0,
        testModeExecutions: 0,
        status: expect.objectContaining({
          testMode: false,
          isScheduled: true,
          pendingCallbacks: 1,
        }),
        configuration: expect.objectContaining({
          testMode: false,
          baseCheckInterval: expect.any(Number),
          idleCheckInterval: expect.any(Number),
          enableJitter: expect.any(Boolean),
          maxJitter: expect.any(Number),
        }),
      });
    });

    it('should support metrics reset', () => {
      const testCallback = jest.fn();

      processingScheduler.schedule(testCallback, 100);
      processingScheduler.schedule(testCallback, 200);

      let metrics = processingScheduler.getMetrics();
      expect(metrics.totalSchedules).toBe(2);

      processingScheduler.resetMetrics();

      metrics = processingScheduler.getMetrics();
      expect(metrics.totalSchedules).toBe(0);
      expect(metrics.averageDelay).toBe(0);
      expect(metrics.maxDelay).toBe(0);
    });
  });

  describe('Static Factory Methods', () => {
    it('should create test-optimized scheduler', () => {
      const testScheduler = ProcessingScheduler.forTesting({ maxJitter: 0.05 });

      expect(testScheduler.testMode).toBe(true);
      expect(testScheduler.baseCheckInterval).toBe(0);
      expect(testScheduler.idleCheckInterval).toBe(0);
      expect(testScheduler.enableJitter).toBe(false);
      expect(testScheduler.maxJitter).toBe(0.05);
    });

    it('should create production-optimized scheduler', () => {
      const prodScheduler = ProcessingScheduler.forProduction({ maxJitter: 0.15 });

      expect(prodScheduler.testMode).toBe(false);
      expect(prodScheduler.baseCheckInterval).toBe(100);
      expect(prodScheduler.idleCheckInterval).toBe(1000);
      expect(prodScheduler.enableJitter).toBe(true);
      expect(prodScheduler.maxJitter).toBe(0.15);
    });
  });

  describe('Integration with Production Setup', () => {
    it('should integrate with dependency injection container', () => {
      // This test verifies that the enhanced logging dependencies are properly injected
      expect(processingScheduler.logger).toBeDefined();
      expect(processingScheduler.logger).not.toBe(mockLogger); // Should be enhanced logger instance
      expect(processingScheduler.logger.moduleName).toBe('performance');
    });

    it('should maintain backward compatibility with existing scheduling code', async () => {
      jest.useFakeTimers();

      // Test that existing ProcessingScheduler functionality still works
      const legacyCallback = jest.fn().mockResolvedValue({ legacy: true });

      processingScheduler.schedule(legacyCallback, 500);

      await jest.advanceTimersByTimeAsync(500);

      expect(legacyCallback).toHaveBeenCalled();
      expect(processingScheduler.scheduledCallbacks.size).toBe(0); // Should be cleaned up after execution
    });

    it('should handle async callbacks correctly', async () => {
      jest.useFakeTimers();

      const asyncCallback = jest.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { async: true };
      });

      processingScheduler.schedule(asyncCallback, 200);

      // Advance to trigger callback
      await jest.advanceTimersByTimeAsync(200);

      // Advance to allow async callback to complete
      await jest.advanceTimersByTimeAsync(100);

      expect(asyncCallback).toHaveBeenCalled();
    });
  });
});
