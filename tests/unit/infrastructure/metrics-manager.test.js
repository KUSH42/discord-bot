import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MetricsManager } from '../../../src/infrastructure/metrics-manager.js';
import { timestampUTC } from '../../../src/utilities/utc-time.js';

describe('MetricsManager', () => {
  let metricsManager;

  beforeEach(() => {
    jest.clearAllMocks();
    metricsManager = new MetricsManager({
      retentionHours: 1,
      maxSamplesPerMetric: 100,
      aggregationWindows: [60, 300], // 1min, 5min
    });
  });

  afterEach(() => {
    if (metricsManager) {
      metricsManager.dispose();
    }
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const manager = new MetricsManager();
      const stats = manager.getStats();

      expect(stats.retentionHours).toBe(24);
      expect(stats.maxSamplesPerMetric).toBe(10000);

      // Clean up the manager to prevent open handles
      manager.dispose();
    });

    it('should initialize with custom configuration', () => {
      const stats = metricsManager.getStats();

      expect(stats.retentionHours).toBe(1);
      expect(stats.maxSamplesPerMetric).toBe(100);
    });

    it('should start cleanup interval', () => {
      expect(metricsManager.cleanupInterval).toBeDefined();
    });
  });

  describe('counter metrics', () => {
    it('should increment counter with default value', () => {
      metricsManager.incrementCounter('test.counter');

      const metric = metricsManager.getMetric('counter', 'test.counter');
      expect(metric.value).toBe(1);
      expect(metric.samples).toHaveLength(1);
    });

    it('should increment counter with custom value', () => {
      metricsManager.incrementCounter('test.counter', 5);

      const metric = metricsManager.getMetric('counter', 'test.counter');
      expect(metric.value).toBe(5);
    });

    it('should accumulate counter increments', () => {
      metricsManager.incrementCounter('test.counter', 3);
      metricsManager.incrementCounter('test.counter', 2);

      const metric = metricsManager.getMetric('counter', 'test.counter');
      expect(metric.value).toBe(5);
      expect(metric.samples).toHaveLength(2);
    });

    it('should include tags in counter samples', () => {
      metricsManager.incrementCounter('test.counter', 1, { service: 'test' });

      const metric = metricsManager.getMetric('counter', 'test.counter');
      expect(metric.samples[0].tags).toEqual({ service: 'test' });
    });
  });

  describe('gauge metrics', () => {
    it('should set gauge value', () => {
      metricsManager.setGauge('test.gauge', 42);

      const metric = metricsManager.getMetric('gauge', 'test.gauge');
      expect(metric.value).toBe(42);
      expect(metric.samples).toHaveLength(1);
    });

    it('should update gauge value', () => {
      metricsManager.setGauge('test.gauge', 10);
      metricsManager.setGauge('test.gauge', 20);

      const metric = metricsManager.getMetric('gauge', 'test.gauge');
      expect(metric.value).toBe(20);
      expect(metric.samples).toHaveLength(2);
    });

    it('should include tags in gauge samples', () => {
      metricsManager.setGauge('test.gauge', 42, { host: 'server1' });

      const metric = metricsManager.getMetric('gauge', 'test.gauge');
      expect(metric.samples[0].tags).toEqual({ host: 'server1' });
    });
  });

  describe('timer metrics', () => {
    it('should record timing value', () => {
      metricsManager.recordTiming('test.timer', 100);

      const metric = metricsManager.getMetric('timer', 'test.timer');
      expect(metric.samples).toHaveLength(1);
      expect(metric.samples[0].value).toBe(100);
      expect(metric.stats.count).toBe(1);
      expect(metric.stats.sum).toBe(100);
      expect(metric.stats.mean).toBe(100);
      expect(metric.stats.min).toBe(100);
      expect(metric.stats.max).toBe(100);
    });

    it('should calculate timer statistics', () => {
      metricsManager.recordTiming('test.timer', 50);
      metricsManager.recordTiming('test.timer', 100);
      metricsManager.recordTiming('test.timer', 150);

      const metric = metricsManager.getMetric('timer', 'test.timer');
      expect(metric.stats.count).toBe(3);
      expect(metric.stats.sum).toBe(300);
      expect(metric.stats.mean).toBe(100);
      expect(metric.stats.min).toBe(50);
      expect(metric.stats.max).toBe(150);
    });

    it('should calculate percentiles for timers', () => {
      // Add enough samples to calculate percentiles
      for (let i = 1; i <= 100; i++) {
        metricsManager.recordTiming('test.timer', i);
      }

      const metric = metricsManager.getMetric('timer', 'test.timer');
      expect(metric.stats.p50).toBeDefined();
      expect(metric.stats.p95).toBeDefined();
      expect(metric.stats.p99).toBeDefined();
    });
  });

  describe('histogram metrics', () => {
    it('should record histogram value', () => {
      metricsManager.recordHistogram('test.histogram', 75);

      const metric = metricsManager.getMetric('histogram', 'test.histogram');
      expect(metric.samples).toHaveLength(1);
      expect(metric.samples[0].value).toBe(75);
      expect(metric.stats.count).toBe(1);
    });

    it('should update histogram buckets', () => {
      metricsManager.recordHistogram('test.histogram', 5);
      metricsManager.recordHistogram('test.histogram', 25);
      metricsManager.recordHistogram('test.histogram', 150);

      const metric = metricsManager.getMetric('histogram', 'test.histogram');
      expect(metric.buckets.get(10)).toBe(1); // 5 falls in <=10 bucket
      expect(metric.buckets.get(50)).toBe(2); // 5,25 fall in <=50 bucket
      expect(metric.buckets.get(250)).toBe(3); // all values fall in <=250 bucket
    });
  });

  describe('timer creation', () => {
    it('should create and use timer', () => {
      const timer = metricsManager.createTimer('test.operation');

      timer.start();
      const duration = timer.stop();

      expect(duration).toBe(0); // mocked time doesn't advance

      const metric = metricsManager.getMetric('timer', 'test.operation');
      expect(metric.samples).toHaveLength(1);
    });

    it('should measure function execution', async () => {
      const timer = metricsManager.createTimer('test.function');
      const testFn = jest.fn(() => 'result');

      const result = await timer.measure(testFn);

      expect(result).toBe('result');
      expect(testFn).toHaveBeenCalled();

      const metric = metricsManager.getMetric('timer', 'test.function');
      expect(metric.samples).toHaveLength(1);
    });

    it('should handle timer errors', async () => {
      const timer = metricsManager.createTimer('test.error');
      const errorFn = jest.fn(() => {
        throw new Error('Test error');
      });

      await expect(timer.measure(errorFn)).rejects.toThrow('Test error');

      // Timer should still record the duration
      const metric = metricsManager.getMetric('timer', 'test.error');
      expect(metric.samples).toHaveLength(1);
    });

    it('should throw error when stopping non-started timer', () => {
      const timer = metricsManager.createTimer('test.timer');

      expect(() => timer.stop()).toThrow('Timer not started');
    });
  });

  describe('metric retrieval', () => {
    beforeEach(() => {
      metricsManager.incrementCounter('test.counter', 5);
      metricsManager.setGauge('test.gauge', 42);
      metricsManager.recordTiming('test.timer', 100);
    });

    it('should get specific metric', () => {
      const counter = metricsManager.getMetric('counter', 'test.counter');
      expect(counter.value).toBe(5);

      const gauge = metricsManager.getMetric('gauge', 'test.gauge');
      expect(gauge.value).toBe(42);

      const timer = metricsManager.getMetric('timer', 'test.timer');
      expect(timer.stats.mean).toBe(100);
    });

    it('should return null for non-existent metric', () => {
      const metric = metricsManager.getMetric('counter', 'non.existent');
      expect(metric).toBeNull();
    });

    it('should get all metrics of a type', () => {
      const counters = metricsManager.getMetrics('counter');
      expect(counters['test.counter']).toBeDefined();
      expect(counters['test.counter'].value).toBe(5);
    });
  });

  describe('aggregated data', () => {
    beforeEach(() => {
      // Use real time for aggregation tests
    });

    it('should create aggregated data for time windows', () => {
      metricsManager.incrementCounter('test.counter', 5);

      const aggregated = metricsManager.getAggregatedData('counter', 'test.counter', 60);
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].count).toBe(1);
      expect(aggregated[0].sum).toBe(5);
    });

    it('should limit aggregated data results', () => {
      // Create multiple time windows worth of data
      for (let i = 0; i < 10; i++) {
        metricsManager.incrementCounter('test.counter', 1);
      }

      const aggregated = metricsManager.getAggregatedData('counter', 'test.counter', 60, 5);
      expect(aggregated.length).toBeLessThanOrEqual(5);
    });
  });

  describe('statistics', () => {
    beforeEach(() => {
      metricsManager.incrementCounter('counter1', 1);
      metricsManager.incrementCounter('counter2', 2);
      metricsManager.setGauge('gauge1', 10);
      metricsManager.recordTiming('timer1', 100);
    });

    it('should provide comprehensive statistics', () => {
      const stats = metricsManager.getStats();

      expect(stats.totalMetricsRecorded).toBe(4);
      expect(stats.storage.counters).toBe(2);
      expect(stats.storage.gauges).toBe(1);
      expect(stats.storage.timers).toBe(1);
      expect(stats.storage.histograms).toBe(0);
      expect(stats.uptime).toBe(0); // mocked time
      expect(stats.metricsPerSecond).toBeGreaterThanOrEqual(0);
    });

    it('should calculate memory usage', () => {
      const stats = metricsManager.getStats();
      const memUsage = metricsManager.getMemoryUsage();

      expect(memUsage.totalSamples).toBe(4);
      expect(memUsage.estimatedBytes).toBeGreaterThan(0);
      expect(memUsage.estimatedMB).toBeGreaterThanOrEqual(0);
      expect(stats.memoryUsage).toEqual(memUsage);
    });
  });

  describe('data export', () => {
    beforeEach(() => {
      metricsManager.incrementCounter('requests.total', 100);
      metricsManager.setGauge('memory.usage', 1024);
      metricsManager.recordTiming('request.duration', 250);
    });

    it('should export JSON format', () => {
      const exported = metricsManager.export('json');
      const data = JSON.parse(exported);

      expect(data.timestamp).toBeDefined();
      expect(data.counters['requests.total'].value).toBe(100);
      expect(data.gauges['memory.usage'].value).toBe(1024);
      expect(data.timers['request.duration'].stats.mean).toBe(250);
      expect(data.stats).toBeDefined();
    });

    it('should export Prometheus format', () => {
      const exported = metricsManager.export('prometheus');

      expect(exported).toContain('# TYPE requests.total counter');
      expect(exported).toContain('requests.total 100');
      expect(exported).toContain('# TYPE memory.usage gauge');
      expect(exported).toContain('memory.usage 1024');
      expect(exported).toContain('# TYPE request.duration summary');
    });

    it('should throw error for unsupported format', () => {
      expect(() => metricsManager.export('invalid')).toThrow('Unsupported export format: invalid');
    });
  });

  describe('sample trimming', () => {
    it('should trim samples when exceeding limit', () => {
      // Set a low limit for testing
      metricsManager.maxSamplesPerMetric = 3;

      for (let i = 0; i < 5; i++) {
        metricsManager.incrementCounter('test.counter', 1);
      }

      const metric = metricsManager.getMetric('counter', 'test.counter');
      expect(metric.samples).toHaveLength(3);
      expect(metric.value).toBe(5); // Total value should be preserved
    });
  });

  describe('cleanup', () => {
    it('should clean up old samples', () => {
      // Add some samples
      metricsManager.incrementCounter('test.counter', 1);
      metricsManager.incrementCounter('test.counter', 1);

      // Run cleanup
      metricsManager.cleanup();

      const metric = metricsManager.getMetric('counter', 'test.counter');
      // Should maintain metrics structure after cleanup
      expect(metric).not.toBeNull();
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      metricsManager.incrementCounter('test.counter', 5);
      metricsManager.setGauge('test.gauge', 42);

      expect(metricsManager.getMetric('counter', 'test.counter')).not.toBeNull();

      metricsManager.reset();

      expect(metricsManager.getMetric('counter', 'test.counter')).toBeNull();

      const stats = metricsManager.getStats();
      expect(stats.totalMetricsRecorded).toBe(0);
      expect(stats.storage.counters).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should clean up resources', () => {
      const interval = metricsManager.cleanupInterval;

      metricsManager.dispose();

      expect(metricsManager.cleanupInterval).toBeNull();
      expect(metricsManager.getMetric('counter', 'any')).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle invalid metric type', () => {
      expect(() => metricsManager.getMetrics('invalid')).toThrow('Unknown metric type: invalid');
    });

    it('should handle null/undefined values gracefully', () => {
      expect(() => metricsManager.incrementCounter('test', null)).not.toThrow();
      expect(() => metricsManager.setGauge('test', undefined)).not.toThrow();
    });
  });
});
