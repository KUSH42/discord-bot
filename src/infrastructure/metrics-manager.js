import { nowUTC, timestampUTC } from '../utilities/utc-time.js';

/**
 * Metrics collection and aggregation system
 * Provides real-time metric collection, aggregation, and analysis
 */
export class MetricsManager {
  constructor(config = {}) {
    // Configuration
    this.retentionHours = config.retentionHours || 24;
    this.maxSamplesPerMetric = config.maxSamplesPerMetric || 10000;
    this.aggregationWindows = config.aggregationWindows || [60, 300, 900, 3600]; // 1min, 5min, 15min, 1hour in seconds

    // Storage for different metric types
    this.counters = new Map(); // Simple increment counters
    this.gauges = new Map(); // Current value metrics
    this.timers = new Map(); // Timing/latency metrics
    this.histograms = new Map(); // Distribution metrics

    // Aggregated data storage
    this.aggregatedData = new Map();

    // Cleanup interval (every 5 minutes)
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);

    // Performance tracking
    this.startTime = nowUTC();
    this.totalMetricsRecorded = 0;
  }

  /**
   * Increment a counter metric
   * @param {string} name - Metric name
   * @param {number} value - Value to add (default 1)
   * @param {Object} tags - Optional tags for grouping
   */
  incrementCounter(name, value = 1, tags = {}) {
    this.ensureMetricExists('counter', name);
    const timestamp = timestampUTC();

    const metric = this.counters.get(name);
    metric.value += value;
    metric.samples.push({ timestamp, value, tags, delta: value });

    this.trimSamples(metric);
    this.totalMetricsRecorded++;

    // Update aggregations
    this.updateAggregations('counter', name, value, timestamp, tags);
  }

  /**
   * Set a gauge metric value
   * @param {string} name - Metric name
   * @param {number} value - Current value
   * @param {Object} tags - Optional tags for grouping
   */
  setGauge(name, value, tags = {}) {
    this.ensureMetricExists('gauge', name);
    const timestamp = timestampUTC();

    const metric = this.gauges.get(name);
    metric.value = value;
    metric.samples.push({ timestamp, value, tags });

    this.trimSamples(metric);
    this.totalMetricsRecorded++;

    // Update aggregations
    this.updateAggregations('gauge', name, value, timestamp, tags);
  }

  /**
   * Record a timing metric
   * @param {string} name - Metric name
   * @param {number} duration - Duration in milliseconds
   * @param {Object} tags - Optional tags for grouping
   */
  recordTiming(name, duration, tags = {}) {
    this.ensureMetricExists('timer', name);
    const timestamp = timestampUTC();

    const metric = this.timers.get(name);
    metric.samples.push({ timestamp, value: duration, tags });

    this.trimSamples(metric);
    this.totalMetricsRecorded++;

    // Update statistics
    this.updateTimerStats(metric, duration);

    // Update aggregations
    this.updateAggregations('timer', name, duration, timestamp, tags);
  }

  /**
   * Record a histogram value
   * @param {string} name - Metric name
   * @param {number} value - Value to record
   * @param {Object} tags - Optional tags for grouping
   */
  recordHistogram(name, value, tags = {}) {
    this.ensureMetricExists('histogram', name);
    const timestamp = timestampUTC();

    const metric = this.histograms.get(name);
    metric.samples.push({ timestamp, value, tags });

    this.trimSamples(metric);
    this.totalMetricsRecorded++;

    // Update histogram buckets
    this.updateHistogramBuckets(metric, value);

    // Update aggregations
    this.updateAggregations('histogram', name, value, timestamp, tags);
  }

  /**
   * Create a timer that can be started and stopped
   * @param {string} name - Metric name
   * @param {Object} tags - Optional tags for grouping
   * @returns {Object} Timer object with start/stop methods
   */
  createTimer(name, tags = {}) {
    let startTime = null;

    return {
      start: () => {
        startTime = nowUTC();
        return this;
      },

      stop: () => {
        if (startTime === null) {
          throw new Error('Timer not started');
        }

        const duration = nowUTC() - startTime;
        this.recordTiming(name, duration, tags);
        startTime = null;

        return duration;
      },

      measure: async fn => {
        const timer = {
          start: () => {
            startTime = nowUTC();
            return this;
          },
          stop: () => {
            if (startTime === null) {
              throw new Error('Timer not started');
            }
            const duration = nowUTC() - startTime;
            startTime = null;
            return duration;
          },
        };

        timer.start();
        try {
          const result = await fn();
          const duration = timer.stop();
          this.recordTiming(name, duration, tags);
          return result;
        } catch (error) {
          if (startTime !== null) {
            const duration = timer.stop();
            this.recordTiming(name, duration, tags);
          }
          throw error;
        }
      },
    };
  }

  /**
   * Ensure a metric exists with proper structure
   * @private
   */
  ensureMetricExists(type, name) {
    const storage = this.getStorageForType(type);

    if (!storage.has(name)) {
      const baseMetric = {
        name,
        type,
        created: timestampUTC(),
        samples: [],
      };

      switch (type) {
        case 'counter':
          baseMetric.value = 0;
          break;
        case 'gauge':
          baseMetric.value = 0;
          break;
        case 'timer':
          baseMetric.stats = { min: Infinity, max: -Infinity, sum: 0, count: 0, mean: 0 };
          break;
        case 'histogram':
          baseMetric.buckets = new Map();
          baseMetric.stats = { min: Infinity, max: -Infinity, sum: 0, count: 0, mean: 0 };
          break;
      }

      storage.set(name, baseMetric);
    }
  }

  /**
   * Get storage map for metric type
   * @private
   */
  getStorageForType(type) {
    switch (type) {
      case 'counter':
        return this.counters;
      case 'gauge':
        return this.gauges;
      case 'timer':
        return this.timers;
      case 'histogram':
        return this.histograms;
      default:
        throw new Error(`Unknown metric type: ${type}`);
    }
  }

  /**
   * Update timer statistics
   * @private
   */
  updateTimerStats(metric, duration) {
    const { stats } = metric;
    stats.min = Math.min(stats.min, duration);
    stats.max = Math.max(stats.max, duration);
    stats.sum += duration;
    stats.count++;
    stats.mean = stats.sum / stats.count;

    // Calculate percentiles from recent samples
    const recentSamples = metric.samples
      .slice(-1000)
      .map(s => s.value)
      .sort((a, b) => a - b);
    if (recentSamples.length > 0) {
      stats.p50 = this.percentile(recentSamples, 0.5);
      stats.p95 = this.percentile(recentSamples, 0.95);
      stats.p99 = this.percentile(recentSamples, 0.99);
    }
  }

  /**
   * Update histogram buckets
   * @private
   */
  updateHistogramBuckets(metric, value) {
    // Define bucket boundaries (in powers of 2 for timing, custom for other metrics)
    const buckets = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, Infinity];

    for (const bucket of buckets) {
      if (value <= bucket) {
        const count = metric.buckets.get(bucket) || 0;
        metric.buckets.set(bucket, count + 1);
      }
    }

    // Update basic stats
    const { stats } = metric;
    stats.min = Math.min(stats.min, value);
    stats.max = Math.max(stats.max, value);
    stats.sum += value;
    stats.count++;
    stats.mean = stats.sum / stats.count;
  }

  /**
   * Calculate percentile from sorted array
   * @private
   */
  percentile(sortedArray, p) {
    if (sortedArray.length === 0) {
      return 0;
    }

    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  /**
   * Update aggregated data for time windows
   * @private
   */
  updateAggregations(type, name, value, timestamp, tags) {
    const now = Math.floor(timestamp / 1000); // Convert to seconds

    for (const windowSeconds of this.aggregationWindows) {
      const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
      const key = `${type}:${name}:${windowSeconds}:${windowStart}`;

      if (!this.aggregatedData.has(key)) {
        this.aggregatedData.set(key, {
          type,
          name,
          windowSeconds,
          windowStart,
          windowEnd: windowStart + windowSeconds,
          count: 0,
          sum: 0,
          min: Infinity,
          max: -Infinity,
          samples: [],
        });
      }

      const agg = this.aggregatedData.get(key);
      agg.count++;
      agg.sum += value;
      agg.min = Math.min(agg.min, value);
      agg.max = Math.max(agg.max, value);
      agg.mean = agg.sum / agg.count;

      // Store sample for percentile calculations
      agg.samples.push(value);
    }
  }

  /**
   * Trim samples to stay within memory limits
   * @private
   */
  trimSamples(metric) {
    if (metric.samples.length > this.maxSamplesPerMetric) {
      metric.samples = metric.samples.slice(-this.maxSamplesPerMetric);
    }
  }

  /**
   * Get current value of a metric
   * @param {string} type - Metric type
   * @param {string} name - Metric name
   * @returns {*} Current metric value or null
   */
  getMetric(type, name) {
    const storage = this.getStorageForType(type);
    return storage.get(name) || null;
  }

  /**
   * Get all metrics of a specific type
   * @param {string} type - Metric type
   * @returns {Object} Object with metric names as keys
   */
  getMetrics(type) {
    const storage = this.getStorageForType(type);
    const result = {};

    for (const [name, metric] of storage) {
      result[name] = { ...metric };
    }

    return result;
  }

  /**
   * Get aggregated data for a metric over a time window
   * @param {string} type - Metric type
   * @param {string} name - Metric name
   * @param {number} windowSeconds - Time window in seconds
   * @param {number} limit - Maximum number of windows to return
   * @returns {Array} Array of aggregated data points
   */
  getAggregatedData(type, name, windowSeconds, limit = 100) {
    const pattern = `${type}:${name}:${windowSeconds}:`;
    const results = [];

    for (const [key, data] of this.aggregatedData) {
      if (key.startsWith(pattern)) {
        results.push({ ...data });
      }
    }

    // Sort by window start time and limit results
    return results.sort((a, b) => b.windowStart - a.windowStart).slice(0, limit);
  }

  /**
   * Get comprehensive statistics for all metrics
   * @returns {Object} Statistics object
   */
  getStats() {
    const now = timestampUTC();
    const uptimeMs = now - this.startTime;

    return {
      uptime: Math.floor(uptimeMs / 1000),
      totalMetricsRecorded: this.totalMetricsRecorded,
      metricsPerSecond: this.totalMetricsRecorded / (uptimeMs / 1000),
      storage: {
        counters: this.counters.size,
        gauges: this.gauges.size,
        timers: this.timers.size,
        histograms: this.histograms.size,
        aggregations: this.aggregatedData.size,
      },
      memoryUsage: this.getMemoryUsage(),
      retentionHours: this.retentionHours,
      maxSamplesPerMetric: this.maxSamplesPerMetric,
    };
  }

  /**
   * Get memory usage estimate
   * @private
   */
  getMemoryUsage() {
    let totalSamples = 0;

    for (const metric of this.counters.values()) {
      totalSamples += metric.samples.length;
    }
    for (const metric of this.gauges.values()) {
      totalSamples += metric.samples.length;
    }
    for (const metric of this.timers.values()) {
      totalSamples += metric.samples.length;
    }
    for (const metric of this.histograms.values()) {
      totalSamples += metric.samples.length;
    }

    // Rough estimate: 100 bytes per sample, plus aggregation overhead
    const estimatedBytes = totalSamples * 100 + this.aggregatedData.size * 200;

    return {
      totalSamples,
      estimatedBytes,
      estimatedMB: Math.round((estimatedBytes / 1024 / 1024) * 100) / 100,
    };
  }

  /**
   * Clean up old metrics and aggregations
   * @private
   */
  cleanup() {
    const cutoffTime = timestampUTC() - this.retentionHours * 60 * 60 * 1000;

    // Clean up old samples from metrics
    for (const metric of [
      ...this.counters.values(),
      ...this.gauges.values(),
      ...this.timers.values(),
      ...this.histograms.values(),
    ]) {
      metric.samples = metric.samples.filter(sample => sample.timestamp > cutoffTime);
    }

    // Clean up old aggregations
    const cutoffSeconds = Math.floor(cutoffTime / 1000);
    for (const [key, agg] of this.aggregatedData) {
      if (agg.windowEnd < cutoffSeconds) {
        this.aggregatedData.delete(key);
      }
    }
  }

  /**
   * Export metrics data for external monitoring systems
   * @param {string} format - Export format ('prometheus', 'json')
   * @returns {string} Formatted metrics data
   */
  export(format = 'json') {
    switch (format) {
      case 'json':
        return JSON.stringify(
          {
            timestamp: timestampUTC(),
            counters: this.getMetrics('counter'),
            gauges: this.getMetrics('gauge'),
            timers: this.getMetrics('timer'),
            histograms: this.getMetrics('histogram'),
            stats: this.getStats(),
          },
          null,
          2
        );

      case 'prometheus':
        return this.exportPrometheus();

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Export in Prometheus format
   * @private
   */
  exportPrometheus() {
    const lines = [];

    // Export counters
    for (const [name, metric] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${metric.value}`);
    }

    // Export gauges
    for (const [name, metric] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${metric.value}`);
    }

    // Export timer summaries
    for (const [name, metric] of this.timers) {
      if (metric.stats.count > 0) {
        lines.push(`# TYPE ${name} summary`);
        lines.push(`${name}_sum ${metric.stats.sum}`);
        lines.push(`${name}_count ${metric.stats.count}`);
        if (metric.stats.p50 !== undefined) {
          lines.push(`${name}{quantile="0.5"} ${metric.stats.p50}`);
          lines.push(`${name}{quantile="0.95"} ${metric.stats.p95}`);
          lines.push(`${name}{quantile="0.99"} ${metric.stats.p99}`);
        }
      }
    }

    return `${lines.join('\n')}\n`;
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.counters.clear();
    this.gauges.clear();
    this.timers.clear();
    this.histograms.clear();
    this.aggregatedData.clear();
    this.totalMetricsRecorded = 0;
    this.startTime = nowUTC();
  }

  /**
   * Dispose of the metrics manager
   */
  dispose() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.reset();
  }
}
