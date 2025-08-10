/**
 * Comprehensive tests for MemoryMonitor enhanced logging integration
 * Tests the performance module integration with operation tracking and metrics
 */

import { jest } from '@jest/globals';
import { MemoryMonitor } from '../../../src/infrastructure/memory-monitor.js';
import { createEnhancedLoggerMocks } from '../../fixtures/test-helpers.js';

describe('MemoryMonitor', () => {
  let memoryMonitor;
  let mockLogger;
  let mockDebugManager;
  let mockMetricsManager;

  beforeEach(() => {
    // Create enhanced logger mocks
    const loggerMocks = createEnhancedLoggerMocks();
    mockLogger = loggerMocks.baseLogger;
    mockDebugManager = loggerMocks.debugManager;
    mockMetricsManager = loggerMocks.metricsManager;

    // Create MemoryMonitor with enhanced logging dependencies
    memoryMonitor = new MemoryMonitor({
      logger: mockLogger,
      debugManager: mockDebugManager,
      metricsManager: mockMetricsManager,
    });
  });

  afterEach(() => {
    if (memoryMonitor) {
      memoryMonitor.stop();
    }
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('Constructor and Enhanced Logging Integration', () => {
    it('should create enhanced logger with performance module', () => {
      expect(memoryMonitor.logger).toBeDefined();
      expect(memoryMonitor.logger).not.toBe(mockLogger);
      expect(memoryMonitor.logger.moduleName).toBe('performance');
    });

    it('should initialize with default configuration', () => {
      expect(memoryMonitor.isMonitoring).toBe(false);
      expect(memoryMonitor.contentTrackers).toEqual(new Map());
      expect(memoryMonitor.maxMemoryMB).toBe(1024);
      expect(memoryMonitor.warningThresholdMB).toBe(768);
    });

    it('should handle missing enhanced logging dependencies gracefully', () => {
      const basicMemoryMonitor = new MemoryMonitor({});
      expect(basicMemoryMonitor).toBeDefined();
      expect(basicMemoryMonitor.logger).toBeDefined();
    });
  });

  describe('Enhanced Logging Operation Tracking', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 100 * 1024 * 1024, // 100MB
        heapTotal: 80 * 1024 * 1024, // 80MB
        heapUsed: 60 * 1024 * 1024, // 60MB
        external: 5 * 1024 * 1024, // 5MB
        arrayBuffers: 2 * 1024 * 1024, // 2MB
      });
    });

    it('should track start operation with enhanced logging', async () => {
      const startOperationSpy = jest.spyOn(memoryMonitor.logger, 'startOperation').mockReturnValue({
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      });

      memoryMonitor.start();

      expect(startOperationSpy).toHaveBeenCalledWith('startMemoryMonitoring', {
        maxMemoryMB: 1024,
        warningThresholdMB: 768,
        checkIntervalMs: 30000,
      });
    });

    it('should track stop operation with enhanced logging', async () => {
      const startOperationSpy = jest.spyOn(memoryMonitor.logger, 'startOperation').mockReturnValue({
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      });

      memoryMonitor.start();
      memoryMonitor.stop();

      expect(startOperationSpy).toHaveBeenCalledWith('stopMemoryMonitoring', {
        isMonitoring: expect.any(Boolean),
      });
    });

    it('should track memory check operations with detailed context', async () => {
      const startOperationSpy = jest.spyOn(memoryMonitor.logger, 'startOperation').mockReturnValue({
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      });

      memoryMonitor.start();

      // Advance timers to trigger memory check
      await jest.advanceTimersByTimeAsync(30000);

      expect(startOperationSpy).toHaveBeenCalledWith('memoryCheck', {});
    });
  });

  describe('Content Store Integration with Enhanced Logging', () => {
    it('should register content stores successfully', () => {
      const mockAnalyzer = jest.fn().mockReturnValue({
        totalItems: 100,
        totalSizeMB: 1.5,
      });

      memoryMonitor.registerContentStore('testStore', mockAnalyzer);

      expect(memoryMonitor.contentTrackers.has('testStore')).toBe(true);
      expect(memoryMonitor.contentTrackers.size).toBe(1);
    });

    it('should analyze content stores without errors', async () => {
      const mockAnalyzer = jest.fn().mockReturnValue({
        totalItems: 150,
        totalSizeMB: 2.5,
        oldestItemHours: 12,
        itemTypes: { tweets: 100, videos: 50 },
      });

      memoryMonitor.registerContentStore('testStore', mockAnalyzer);
      const analysis = await memoryMonitor.analyzeContentStores();

      expect(analysis).toEqual({
        testStore: {
          totalItems: 150,
          totalSizeMB: 2.5,
          oldestItemHours: 12,
          itemTypes: { tweets: 100, videos: 50 },
        },
        totalContentItems: 150,
      });
    });

    it('should handle content store analysis errors gracefully', async () => {
      const errorAnalyzer = jest.fn().mockImplementation(() => {
        throw new Error('Analysis failed');
      });

      const warnSpy = jest.spyOn(memoryMonitor.logger, 'warn');

      memoryMonitor.registerContentStore('errorStore', errorAnalyzer);
      const analysis = await memoryMonitor.analyzeContentStores();

      expect(warnSpy).toHaveBeenCalledWith('Failed to analyze content store errorStore:', 'Analysis failed');

      expect(analysis.errorStore).toEqual({
        error: 'Analysis failed',
      });
    });
  });

  describe('Memory Monitoring Operations', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 200 * 1024 * 1024, // 200MB
        heapTotal: 150 * 1024 * 1024, // 150MB
        heapUsed: 100 * 1024 * 1024, // 100MB
        external: 10 * 1024 * 1024, // 10MB
        arrayBuffers: 5 * 1024 * 1024, // 5MB
      });
    });

    it('should start and stop monitoring correctly', () => {
      expect(memoryMonitor.isMonitoring).toBe(false);

      memoryMonitor.start();
      expect(memoryMonitor.isMonitoring).toBe(true);

      memoryMonitor.stop();
      expect(memoryMonitor.isMonitoring).toBe(false);
    });

    it('should collect memory samples during monitoring', async () => {
      memoryMonitor.start();

      // Advance timers to trigger memory check
      await jest.advanceTimersByTimeAsync(30000);

      expect(memoryMonitor.samples.length).toBeGreaterThan(0);
      const sample = memoryMonitor.samples[0];
      expect(sample).toEqual({
        timestamp: expect.any(Number),
        heapUsedMB: 100,
        heapTotalMB: 150,
        externalMB: 10,
        rssMB: 200,
        totalMB: 110, // heapUsed + external
        contentStores: expect.any(Object),
      });
    });

    it('should provide memory statistics', async () => {
      memoryMonitor.start();
      await jest.advanceTimersByTimeAsync(30000);

      const stats = memoryMonitor.getStats();

      expect(stats).toEqual({
        peakMemoryMB: expect.any(Number),
        averageMemoryMB: expect.any(Number),
        gcExecutions: 0,
        warningsIssued: 0,
        leakSuspicionCount: 0,
        currentMemoryMB: expect.any(Number),
        samplesCollected: expect.any(Number),
        isMonitoring: true,
        contentStores: expect.any(Object),
        thresholds: {
          warningMB: 768,
          maxMB: 1024,
          gcMB: 512,
        },
      });
    });

    it('should handle high memory scenarios', async () => {
      // Mock high memory usage scenario
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 900 * 1024 * 1024, // 900MB (above warning threshold)
        heapTotal: 800 * 1024 * 1024,
        heapUsed: 790 * 1024 * 1024, // 790MB
        external: 50 * 1024 * 1024, // 50MB
        arrayBuffers: 10 * 1024 * 1024,
      });

      const warnSpy = jest.spyOn(memoryMonitor.logger, 'warn');

      memoryMonitor.start();
      await jest.advanceTimersByTimeAsync(30000);

      expect(warnSpy).toHaveBeenCalledWith(
        'High memory usage detected',
        expect.objectContaining({
          currentMB: 840, // heapUsed + external
          thresholdMB: 768,
          consecutiveCount: 1,
        })
      );
    });
  });

  describe('Performance Module Integration', () => {
    it('should maintain enhanced logger dependencies', () => {
      expect(memoryMonitor.logger.moduleName).toBe('performance');
      expect(memoryMonitor.logger.debugManager).toBe(mockDebugManager);
      expect(memoryMonitor.logger.metricsManager).toBe(mockMetricsManager);
    });

    it('should provide detailed content analysis for debugging', async () => {
      const mockAnalyzer = jest.fn().mockReturnValue({
        totalItems: 500,
        totalSizeMB: 3.2,
        oldestItemHours: 24,
        itemTypes: { tweets: 300, videos: 200 },
      });

      memoryMonitor.registerContentStore('detailedStore', mockAnalyzer);
      memoryMonitor.start();
      await jest.advanceTimersByTimeAsync(30000);

      const detailedAnalysis = await memoryMonitor.getDetailedContentAnalysis();

      expect(detailedAnalysis).toEqual({
        timestamp: expect.any(Number),
        contentStores: expect.objectContaining({
          detailedStore: {
            totalItems: 500,
            totalSizeMB: 3.2,
            oldestItemHours: 24,
            itemTypes: { tweets: 300, videos: 200 },
          },
        }),
        memoryPressure: {
          current: expect.any(Number),
          peak: expect.any(Number),
          average: expect.any(Number),
        },
        recommendations: expect.any(Array),
      });
    });

    it('should generate appropriate memory recommendations', async () => {
      const mockAnalyzer = jest.fn().mockReturnValue({
        totalItems: 1500, // High item count to trigger recommendations
        totalSizeMB: 5.0,
        oldestItemHours: 72, // Old items to trigger cleanup recommendation
      });

      memoryMonitor.registerContentStore('largeStore', mockAnalyzer);
      const recommendations = await memoryMonitor.generateMemoryRecommendations();

      expect(recommendations).toEqual(
        expect.arrayContaining([
          expect.stringContaining('largeStore: Consider reducing cache size'),
          expect.stringContaining('largeStore: Consider more aggressive cleanup'),
        ])
      );
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle start when already running', () => {
      const warnSpy = jest.spyOn(memoryMonitor.logger, 'warn');

      memoryMonitor.start();
      memoryMonitor.start(); // Try to start again

      expect(warnSpy).toHaveBeenCalledWith('Memory monitor is already running');
    });

    it('should handle stop when not running', () => {
      // Should not throw or cause issues
      expect(() => memoryMonitor.stop()).not.toThrow();
    });

    it('should properly dispose of resources', () => {
      memoryMonitor.start();
      expect(memoryMonitor.isMonitoring).toBe(true);
      expect(memoryMonitor.samples).toHaveLength(0);

      memoryMonitor.dispose();

      expect(memoryMonitor.isMonitoring).toBe(false);
      expect(memoryMonitor.samples).toHaveLength(0);
      expect(memoryMonitor.contentTrackers.size).toBe(0);
    });

    it('should handle memory check errors gracefully', async () => {
      jest.useFakeTimers();
      jest.spyOn(process, 'memoryUsage').mockImplementation(() => {
        throw new Error('Memory check failed');
      });

      const startOperationSpy = jest.spyOn(memoryMonitor.logger, 'startOperation').mockReturnValue({
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      });

      memoryMonitor.start();
      await jest.advanceTimersByTimeAsync(30000);

      expect(startOperationSpy).toHaveBeenCalledWith('memoryCheck', {});
    });
  });
});
