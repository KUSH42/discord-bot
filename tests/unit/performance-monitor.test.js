import { jest } from '@jest/globals';
import { PerformanceMonitor } from '../../src/utilities/performance-monitor.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  startOperation: jest.fn(() => ({
    progress: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
  })),
};

// Mock debug manager
const mockDebugManager = {
  isEnabled: jest.fn(() => false),
  getLevel: jest.fn(() => 1),
};

// Mock metrics manager
const mockMetricsManager = {
  recordMetric: jest.fn(),
  startTimer: jest.fn(() => ({ end: jest.fn() })),
  incrementCounter: jest.fn(),
  setGauge: jest.fn(),
};

describe('PerformanceMonitor', () => {
  let performanceMonitor;

  beforeEach(() => {
    jest.clearAllMocks();
    performanceMonitor = new PerformanceMonitor(
      {
        enabled: true,
        sampleRetention: 100,
        memoryAlertMB: 1000,
        cpuAlertPercent: 80,
        navigationAlertMs: 30000,
        errorRateAlert: 0.05,
      },
      mockLogger,
      mockDebugManager,
      mockMetricsManager
    );
  });

  describe('initialization', () => {
    it('should initialize with correct configuration', () => {
      expect(performanceMonitor.config.enabled).toBe(true);
      expect(performanceMonitor.config.sampleRetention).toBe(100);
      expect(performanceMonitor.config.alertThresholds.memory).toBe(1000);
      expect(performanceMonitor.grades.overall).toBe('A');
    });

    it('should have correct grading criteria', () => {
      const criteria = performanceMonitor.config.gradingCriteria;

      expect(criteria.memory.A).toBe(512);
      expect(criteria.memory.F).toBe(9999);
      expect(criteria.navigation.A).toBe(5000);
      expect(criteria.successRate.A).toBe(0.98);
    });
  });

  describe('operation tracking', () => {
    it('should track operation performance correctly', () => {
      const operation = performanceMonitor.startOperation('navigation', { url: 'https://example.com' });

      expect(operation.id).toBeDefined();
      expect(operation.end).toBeInstanceOf(Function);
    });

    it('should record successful operations', () => {
      const operation = performanceMonitor.startOperation('navigation', { url: 'https://example.com' });

      // Simulate some time passing
      setTimeout(() => {
        operation.end(true, { statusCode: 200 });
      }, 100);

      expect(performanceMonitor.stats.totalOperations).toBe(1);
      expect(performanceMonitor.stats.successfulOperations).toBe(1);
    });

    it('should record failed operations', () => {
      const operation = performanceMonitor.startOperation('navigation', { url: 'https://example.com' });
      operation.end(false, { error: 'Network timeout' });

      expect(performanceMonitor.stats.totalOperations).toBe(1);
      expect(performanceMonitor.stats.failedOperations).toBe(1);
    });

    it('should handle operation tracking when disabled', () => {
      const disabledMonitor = new PerformanceMonitor(
        { enabled: false },
        mockLogger,
        mockDebugManager,
        mockMetricsManager
      );

      const operation = disabledMonitor.startOperation('navigation');
      expect(operation.end).toBeInstanceOf(Function);

      // Should not throw when called
      operation.end(true);
    });
  });

  describe('performance grading', () => {
    it('should calculate memory grades correctly', () => {
      // Set low memory usage
      performanceMonitor.currentMetrics.memoryUsageMB = 400; // Should be A grade
      performanceMonitor.calculateGrades();
      expect(performanceMonitor.grades.memory).toBe('A');

      // Set high memory usage
      performanceMonitor.currentMetrics.memoryUsageMB = 2500; // Should be F grade
      performanceMonitor.calculateGrades();
      expect(performanceMonitor.grades.memory).toBe('F');
    });

    it('should calculate navigation grades correctly', () => {
      // Fast navigation
      performanceMonitor.currentMetrics.averageNavigationTime = 3000; // 3 seconds - A grade
      performanceMonitor.calculateGrades();
      expect(performanceMonitor.grades.navigation).toBe('A');

      // Slow navigation
      performanceMonitor.currentMetrics.averageNavigationTime = 35000; // 35 seconds - F grade
      performanceMonitor.calculateGrades();
      expect(performanceMonitor.grades.navigation).toBe('F');
    });

    it('should calculate reliability grades correctly', () => {
      // High success rate
      performanceMonitor.currentMetrics.successRate = 0.99; // 99% - A grade
      performanceMonitor.calculateGrades();
      expect(performanceMonitor.grades.reliability).toBe('A');

      // Low success rate
      performanceMonitor.currentMetrics.successRate = 0.75; // 75% - F grade
      performanceMonitor.calculateGrades();
      expect(performanceMonitor.grades.reliability).toBe('F');
    });

    it('should calculate overall grade as weighted average', () => {
      // Set all metrics to B grade levels
      performanceMonitor.currentMetrics.memoryUsageMB = 800; // B grade
      performanceMonitor.currentMetrics.averageNavigationTime = 8000; // B grade
      performanceMonitor.currentMetrics.cpuUsagePercent = 40; // B grade
      performanceMonitor.currentMetrics.successRate = 0.96; // B grade

      performanceMonitor.calculateGrades();

      expect(performanceMonitor.grades.overall).toBe('B');
    });
  });

  describe('alert system', () => {
    it('should trigger memory alerts', () => {
      const operation = performanceMonitor.startOperation('test');

      // Mock high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn(() => ({
        heapUsed: 1200 * 1024 * 1024, // 1200MB - above threshold
      }));

      operation.end(true);

      expect(performanceMonitor.stats.alertsTriggered).toBeGreaterThan(0);

      // Restore original function
      process.memoryUsage = originalMemoryUsage;
    });

    it('should trigger navigation time alerts', () => {
      const operation = performanceMonitor.startOperation('navigation');

      // Simulate long navigation time
      const startTime = process.hrtime.bigint();
      const longDuration = 35000; // 35 seconds in milliseconds

      // Mock hrtime to simulate long duration
      process.hrtime.bigint = jest.fn(() => startTime + BigInt(longDuration * 1000000));

      operation.end(true);

      expect(performanceMonitor.stats.alertsTriggered).toBeGreaterThan(0);
    });

    it('should not trigger alerts when values are within thresholds', () => {
      const operation = performanceMonitor.startOperation('test');
      operation.end(true);

      // With default low values, no alerts should be triggered
      expect(performanceMonitor.stats.alertsTriggered).toBe(0);
    });
  });

  describe('sample management', () => {
    it('should maintain sample retention limits', () => {
      const smallMonitor = new PerformanceMonitor(
        { enabled: true, sampleRetention: 3 },
        mockLogger,
        mockDebugManager,
        mockMetricsManager
      );

      // Add more samples than retention limit
      for (let i = 0; i < 5; i++) {
        const operation = smallMonitor.startOperation('navigation');
        operation.end(true);
      }

      expect(smallMonitor.samples.navigation.length).toBeLessThanOrEqual(3);
      expect(smallMonitor.samples.memory.length).toBeLessThanOrEqual(3);
    });

    it('should record different types of samples', () => {
      const navOperation = performanceMonitor.startOperation('navigation');
      const testOperation = performanceMonitor.startOperation('test');

      navOperation.end(true);
      testOperation.end(false, { error: 'Test error' });

      expect(performanceMonitor.samples.navigation).toHaveLength(1);
      expect(performanceMonitor.samples.memory).toHaveLength(2);
      expect(performanceMonitor.samples.errors).toHaveLength(1);
    });
  });

  describe('statistics and reporting', () => {
    beforeEach(() => {
      // Set up some test data
      for (let i = 0; i < 5; i++) {
        const operation = performanceMonitor.startOperation('navigation');
        operation.end(i < 4, { statusCode: i < 4 ? 200 : 500 });
      }
    });

    it('should provide comprehensive statistics', () => {
      const stats = performanceMonitor.getStatistics();

      expect(stats.totalOperations).toBe(5);
      expect(stats.successfulOperations).toBe(4);
      expect(stats.failedOperations).toBe(1);
      expect(stats.grades.overall).toBeDefined();
      expect(stats.enabled).toBe(true);
    });

    it('should provide detailed performance report', () => {
      const report = performanceMonitor.getPerformanceReport();

      expect(report.grades).toBeDefined();
      expect(report.currentMetrics).toBeDefined();
      expect(report.statistics).toBeDefined();
      expect(report.recentSamples).toBeDefined();
      expect(report.recommendations).toBeInstanceOf(Array);
      expect(report.lastUpdated).toBeDefined();
    });

    it('should generate appropriate recommendations', () => {
      // Set poor performance metrics
      performanceMonitor.currentMetrics.memoryUsageMB = 2500; // F grade
      performanceMonitor.currentMetrics.averageNavigationTime = 35000; // F grade
      performanceMonitor.currentMetrics.successRate = 0.7; // F grade
      performanceMonitor.calculateGrades();

      const recommendations = performanceMonitor.generateRecommendations();

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations.some(r => r.category === 'memory')).toBe(true);
      expect(recommendations.some(r => r.category === 'navigation')).toBe(true);
      expect(recommendations.some(r => r.category === 'reliability')).toBe(true);
    });

    it('should reset statistics correctly', () => {
      performanceMonitor.resetStatistics();

      expect(performanceMonitor.stats.totalOperations).toBe(0);
      expect(performanceMonitor.stats.successfulOperations).toBe(0);
      expect(performanceMonitor.samples.navigation).toHaveLength(0);
      expect(performanceMonitor.samples.memory).toHaveLength(0);
      expect(performanceMonitor.grades.overall).toBe('A');
    });
  });

  describe('metric recording', () => {
    it('should record manual metrics', () => {
      performanceMonitor.recordMetric('custom_metric', 42, { source: 'test' });

      // Should not throw and should log the metric
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Manual metric recorded',
        expect.objectContaining({
          type: 'manual',
          name: 'custom_metric',
          value: 42,
        })
      );
    });

    it('should calculate average memory usage', () => {
      // Add some memory samples
      performanceMonitor.samples.memory = [{ memoryMB: 500 }, { memoryMB: 600 }, { memoryMB: 700 }];

      const average = performanceMonitor.calculateAverageMemory();
      expect(average).toBe(600);
    });

    it('should estimate CPU usage', () => {
      // Add some navigation samples
      const now = Date.now();
      performanceMonitor.samples.navigation = [
        { timestamp: now - 30000, duration: 1000 },
        { timestamp: now - 20000, duration: 2000 },
        { timestamp: now - 10000, duration: 1500 },
      ];

      const cpuEstimate = performanceMonitor.estimateCpuUsage();
      expect(cpuEstimate).toBeGreaterThanOrEqual(0);
      expect(cpuEstimate).toBeLessThanOrEqual(100);
    });
  });

  describe('configuration management', () => {
    it('should update configuration correctly', () => {
      const newConfig = {
        sampleRetention: 500,
        memoryAlertMB: 2000,
        errorRateAlert: 0.1,
      };

      performanceMonitor.updateConfiguration(newConfig);

      expect(performanceMonitor.config.sampleRetention).toBe(500);
      expect(performanceMonitor.config.alertThresholds.memory).toBe(2000);
      expect(performanceMonitor.config.alertThresholds.errorRate).toBe(0.1);
    });

    it('should work when disabled', () => {
      const disabledMonitor = new PerformanceMonitor(
        { enabled: false },
        mockLogger,
        mockDebugManager,
        mockMetricsManager
      );

      const operation = disabledMonitor.startOperation('test');
      operation.end(true);

      expect(disabledMonitor.stats.totalOperations).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle operation tracking errors gracefully', () => {
      // Mock process.hrtime.bigint to throw an error
      const originalHrtime = process.hrtime.bigint;
      process.hrtime.bigint = jest.fn(() => {
        throw new Error('Hrtime error');
      });

      const operation = performanceMonitor.startOperation('test');

      expect(() => operation.end(true)).not.toThrow();

      // Restore original function
      process.hrtime.bigint = originalHrtime;
    });

    it('should handle empty samples gracefully', () => {
      const average = performanceMonitor.calculateAverageMemory();
      expect(average).toBe(0);

      const cpuEstimate = performanceMonitor.estimateCpuUsage();
      expect(cpuEstimate).toBe(0);
    });

    it('should handle grade calculation with undefined metrics', () => {
      performanceMonitor.currentMetrics = {};
      performanceMonitor.calculateGrades();

      // Should not throw and should have default grades
      expect(performanceMonitor.grades.overall).toBeDefined();
    });
  });
});
