import { timestampUTC } from './utc-time.js';
import { createEnhancedLogger } from './enhanced-logger.js';

/**
 * Performance metrics and monitoring with A-F grading system
 */
export class PerformanceMonitor {
  constructor(config = {}, logger, debugManager, metricsManager) {
    this.config = {
      // Performance monitoring settings
      enabled: config.enabled !== false,
      sampleRetention: config.sampleRetention || 1000, // Keep last 1000 samples
      alertThresholds: {
        memory: config.memoryAlertMB || 1500, // 1.5GB alert threshold
        cpu: config.cpuAlertPercent || 80, // 80% CPU alert
        navigation: config.navigationAlertMs || 30000, // 30s navigation alert
        errorRate: config.errorRateAlert || 0.05, // 5% error rate alert
      },

      // Grading thresholds
      gradingCriteria: {
        memory: {
          A: 512, // < 512MB = A
          B: 1024, // < 1GB = B
          C: 1536, // < 1.5GB = C
          D: 2048, // < 2GB = D
          F: 9999, // >= 2GB = F
        },
        navigation: {
          A: 5000, // < 5s = A
          B: 10000, // < 10s = B
          C: 20000, // < 20s = C
          D: 30000, // < 30s = D
          F: 99999, // >= 30s = F
        },
        cpu: {
          A: 25, // < 25% = A
          B: 50, // < 50% = B
          C: 70, // < 70% = C
          D: 85, // < 85% = D
          F: 100, // >= 85% = F
        },
        successRate: {
          A: 0.98, // >= 98% = A
          B: 0.95, // >= 95% = B
          C: 0.9, // >= 90% = C
          D: 0.8, // >= 80% = D
          F: 0, // < 80% = F
        },
      },
    };

    this.logger = createEnhancedLogger('performance-monitor', logger, debugManager, metricsManager);

    // Performance samples storage
    this.samples = {
      navigation: [],
      memory: [],
      cpu: [],
      errors: [],
    };

    // Real-time metrics
    this.currentMetrics = {
      memoryUsageMB: 0,
      cpuUsagePercent: 0,
      averageNavigationTime: 0,
      successRate: 1.0,
      errorRate: 0.0,
      lastUpdated: timestampUTC(),
    };

    // Statistics
    this.stats = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      totalNavigationTime: 0,
      averageMemoryUsage: 0,
      peakMemoryUsage: 0,
      averageCpuUsage: 0,
      peakCpuUsage: 0,
      alertsTriggered: 0,
    };

    // Performance grades
    this.grades = {
      overall: 'A',
      memory: 'A',
      navigation: 'A',
      cpu: 'A',
      reliability: 'A',
    };

    this.logger.info('PerformanceMonitor initialized', {
      config: this.config,
      alertThresholds: this.config.alertThresholds,
    });
  }

  /**
   * Start tracking a performance operation
   * @param {string} operationType - Type of operation being tracked
   * @param {Object} metadata - Additional operation metadata
   * @returns {Object} Operation tracker
   */
  startOperation(operationType, metadata = {}) {
    if (!this.config.enabled) {
      return { end: () => {} };
    }

    try {
      const startData = {
        type: operationType,
        startTime: process.hrtime.bigint(),
        startMemory: process.memoryUsage(),
        metadata,
        id: `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      };

      return {
        id: startData.id,
        end: (success = true, result = {}) => this.endOperation(startData, success, result),
      };
    } catch (error) {
      this.logger.error('Failed to start operation tracking', {
        operationType,
        error: error.message,
      });

      // Return a no-op tracker
      return {
        id: 'error-op',
        end: () => {},
      };
    }
  }

  /**
   * End a performance operation and record metrics
   * @param {Object} startData - Data from startOperation
   * @param {boolean} success - Whether operation was successful
   * @param {Object} result - Operation result data
   */
  endOperation(startData, success = true, result = {}) {
    try {
      const endTime = process.hrtime.bigint();
      const endMemory = process.memoryUsage();

      const duration = Number(endTime - startData.startTime) / 1000000; // Convert to milliseconds
      const memoryDelta = endMemory.heapUsed - startData.startMemory.heapUsed;
      const currentMemoryMB = Math.round(endMemory.heapUsed / 1024 / 1024);

      // Record the sample
      const sample = {
        id: startData.id,
        type: startData.type,
        timestamp: timestampUTC(),
        duration,
        memoryDelta,
        currentMemoryMB,
        success,
        metadata: startData.metadata,
        result,
      };

      this.recordSample(sample);
      this.updateStatistics(sample);
      this.updateCurrentMetrics();
      this.calculateGrades();

      // Check for performance alerts
      this.checkAlertThresholds(sample);

      this.logger.debug('Operation performance recorded', {
        type: startData.type,
        duration: Math.round(duration),
        memoryMB: currentMemoryMB,
        success,
        grade: this.grades.overall,
      });
    } catch (error) {
      this.logger.error('Failed to record operation performance', {
        error: error.message,
        operationId: startData.id,
      });
    }
  }

  /**
   * Record a performance sample
   * @param {Object} sample - Performance sample data
   */
  recordSample(sample) {
    // Add to appropriate sample arrays
    if (sample.type === 'navigation' || sample.type.includes('goto')) {
      this.samples.navigation.push(sample);
      this.maintainSampleLimit(this.samples.navigation);
    }

    this.samples.memory.push({
      timestamp: sample.timestamp,
      memoryMB: sample.currentMemoryMB,
      delta: sample.memoryDelta,
    });
    this.maintainSampleLimit(this.samples.memory);

    if (!sample.success) {
      this.samples.errors.push({
        timestamp: sample.timestamp,
        type: sample.type,
        error: sample.result.error || 'Unknown error',
      });
      this.maintainSampleLimit(this.samples.errors);
    }
  }

  /**
   * Maintain sample array size limit
   * @param {Array} sampleArray - Array to maintain
   */
  maintainSampleLimit(sampleArray) {
    if (sampleArray.length > this.config.sampleRetention) {
      sampleArray.splice(0, sampleArray.length - this.config.sampleRetention);
    }
  }

  /**
   * Update running statistics
   * @param {Object} sample - New sample data
   */
  updateStatistics(sample) {
    this.stats.totalOperations++;

    if (sample.success) {
      this.stats.successfulOperations++;
    } else {
      this.stats.failedOperations++;
    }

    if (sample.type === 'navigation' || sample.type.includes('goto')) {
      this.stats.totalNavigationTime += sample.duration;
    }

    // Update memory statistics
    this.stats.averageMemoryUsage = this.calculateAverageMemory();
    this.stats.peakMemoryUsage = Math.max(this.stats.peakMemoryUsage, sample.currentMemoryMB);
  }

  /**
   * Update current real-time metrics
   */
  updateCurrentMetrics() {
    const currentMemory = process.memoryUsage();
    this.currentMetrics.memoryUsageMB = Math.round(currentMemory.heapUsed / 1024 / 1024);

    // Calculate success rate
    if (this.stats.totalOperations > 0) {
      this.currentMetrics.successRate = this.stats.successfulOperations / this.stats.totalOperations;
      this.currentMetrics.errorRate = this.stats.failedOperations / this.stats.totalOperations;
    }

    // Calculate average navigation time
    if (this.samples.navigation.length > 0) {
      const totalNavTime = this.samples.navigation.reduce((sum, sample) => sum + sample.duration, 0);
      this.currentMetrics.averageNavigationTime = totalNavTime / this.samples.navigation.length;
    }

    // Estimate CPU usage (simplified)
    this.currentMetrics.cpuUsagePercent = this.estimateCpuUsage();
    this.currentMetrics.lastUpdated = timestampUTC();
  }

  /**
   * Calculate performance grades using A-F system
   */
  calculateGrades() {
    const criteria = this.config.gradingCriteria;

    // Memory grade
    this.grades.memory = this.calculateGrade(this.currentMetrics.memoryUsageMB, criteria.memory);

    // Navigation performance grade
    this.grades.navigation = this.calculateGrade(this.currentMetrics.averageNavigationTime, criteria.navigation);

    // CPU grade
    this.grades.cpu = this.calculateGrade(this.currentMetrics.cpuUsagePercent, criteria.cpu);

    // Reliability grade (based on success rate)
    this.grades.reliability = this.calculateGradeReverse(this.currentMetrics.successRate, criteria.successRate);

    // Overall grade (weighted average)
    this.grades.overall = this.calculateOverallGrade();
  }

  /**
   * Calculate grade for a metric (lower is better)
   * @param {number} value - Metric value
   * @param {Object} thresholds - Grade thresholds
   * @returns {string} Grade (A-F)
   */
  calculateGrade(value, thresholds) {
    if (value <= thresholds.A) {
      return 'A';
    }
    if (value <= thresholds.B) {
      return 'B';
    }
    if (value <= thresholds.C) {
      return 'C';
    }
    if (value <= thresholds.D) {
      return 'D';
    }
    return 'F';
  }

  /**
   * Calculate grade for a metric (higher is better)
   * @param {number} value - Metric value
   * @param {Object} thresholds - Grade thresholds
   * @returns {string} Grade (A-F)
   */
  calculateGradeReverse(value, thresholds) {
    if (value >= thresholds.A) {
      return 'A';
    }
    if (value >= thresholds.B) {
      return 'B';
    }
    if (value >= thresholds.C) {
      return 'C';
    }
    if (value >= thresholds.D) {
      return 'D';
    }
    return 'F';
  }

  /**
   * Calculate overall performance grade
   * @returns {string} Overall grade (A-F)
   */
  calculateOverallGrade() {
    const gradePoints = {
      A: 4.0,
      B: 3.0,
      C: 2.0,
      D: 1.0,
      F: 0.0,
    };

    // Weighted average (reliability is most important)
    const weights = {
      memory: 0.25,
      navigation: 0.25,
      cpu: 0.2,
      reliability: 0.3,
    };

    const weightedSum =
      gradePoints[this.grades.memory] * weights.memory +
      gradePoints[this.grades.navigation] * weights.navigation +
      gradePoints[this.grades.cpu] * weights.cpu +
      gradePoints[this.grades.reliability] * weights.reliability;

    // Convert back to letter grade
    if (weightedSum >= 3.5) {
      return 'A';
    }
    if (weightedSum >= 2.5) {
      return 'B';
    }
    if (weightedSum >= 1.5) {
      return 'C';
    }
    if (weightedSum >= 0.5) {
      return 'D';
    }
    return 'F';
  }

  /**
   * Check if current metrics exceed alert thresholds
   * @param {Object} sample - Current sample data
   */
  checkAlertThresholds(sample) {
    const alerts = [];

    // Memory alert
    if (sample.currentMemoryMB > this.config.alertThresholds.memory) {
      alerts.push({
        type: 'MEMORY_HIGH',
        value: sample.currentMemoryMB,
        threshold: this.config.alertThresholds.memory,
        message: `Memory usage ${sample.currentMemoryMB}MB exceeds threshold ${this.config.alertThresholds.memory}MB`,
      });
    }

    // Navigation time alert
    if (sample.type === 'navigation' && sample.duration > this.config.alertThresholds.navigation) {
      alerts.push({
        type: 'NAVIGATION_SLOW',
        value: Math.round(sample.duration),
        threshold: this.config.alertThresholds.navigation,
        message: `Navigation time ${Math.round(sample.duration)}ms exceeds threshold ${this.config.alertThresholds.navigation}ms`,
      });
    }

    // Error rate alert
    if (this.currentMetrics.errorRate > this.config.alertThresholds.errorRate) {
      alerts.push({
        type: 'ERROR_RATE_HIGH',
        value: Math.round(this.currentMetrics.errorRate * 100),
        threshold: Math.round(this.config.alertThresholds.errorRate * 100),
        message: `Error rate ${Math.round(this.currentMetrics.errorRate * 100)}% exceeds threshold ${Math.round(this.config.alertThresholds.errorRate * 100)}%`,
      });
    }

    // Log alerts
    for (const alert of alerts) {
      this.stats.alertsTriggered++;
      this.logger.warn('Performance alert triggered', alert);
    }
  }

  /**
   * Calculate average memory usage from samples
   * @returns {number} Average memory usage in MB
   */
  calculateAverageMemory() {
    if (this.samples.memory.length === 0) {
      return 0;
    }

    const totalMemory = this.samples.memory.reduce((sum, sample) => sum + sample.memoryMB, 0);
    return Math.round(totalMemory / this.samples.memory.length);
  }

  /**
   * Estimate CPU usage (simplified calculation)
   * @returns {number} Estimated CPU usage percentage
   */
  estimateCpuUsage() {
    // This is a simplified estimation
    // In a real implementation, you'd use more sophisticated CPU monitoring
    const recentOperations = this.samples.navigation.filter(
      sample => timestampUTC() - sample.timestamp < 60000 // Last minute
    );

    if (recentOperations.length === 0) {
      return 0;
    }

    // Estimate based on operation frequency and duration
    const avgDuration = recentOperations.reduce((sum, op) => sum + op.duration, 0) / recentOperations.length;
    const operationsPerMinute = recentOperations.length;

    // Simple heuristic: more operations + longer duration = higher CPU
    const estimatedCpu = Math.min(100, (operationsPerMinute * avgDuration) / 1000);

    return Math.round(estimatedCpu);
  }

  /**
   * Get current performance report
   * @returns {Object} Performance report with grades and metrics
   */
  getPerformanceReport() {
    return {
      grades: { ...this.grades },
      currentMetrics: { ...this.currentMetrics },
      statistics: { ...this.stats },
      recentSamples: {
        navigation: this.samples.navigation.slice(-10),
        memory: this.samples.memory.slice(-10),
        errors: this.samples.errors.slice(-5),
      },
      recommendations: this.generateRecommendations(),
      lastUpdated: timestampUTC(),
    };
  }

  /**
   * Generate performance recommendations based on current grades
   * @returns {Array} Array of recommendations
   */
  generateRecommendations() {
    const recommendations = [];

    if (this.grades.memory === 'D' || this.grades.memory === 'F') {
      recommendations.push({
        category: 'memory',
        priority: 'high',
        message: 'Memory usage is high. Consider implementing garbage collection or reducing cache sizes.',
        action: 'OPTIMIZE_MEMORY',
      });
    }

    if (this.grades.navigation === 'D' || this.grades.navigation === 'F') {
      recommendations.push({
        category: 'navigation',
        priority: 'medium',
        message: 'Navigation performance is slow. Check network conditions and page complexity.',
        action: 'OPTIMIZE_NAVIGATION',
      });
    }

    if (this.grades.cpu === 'D' || this.grades.cpu === 'F') {
      recommendations.push({
        category: 'cpu',
        priority: 'medium',
        message: 'CPU usage is high. Consider reducing operation frequency or complexity.',
        action: 'OPTIMIZE_CPU',
      });
    }

    if (this.grades.reliability === 'D' || this.grades.reliability === 'F') {
      recommendations.push({
        category: 'reliability',
        priority: 'high',
        message: 'Success rate is low. Investigate error patterns and improve error handling.',
        action: 'IMPROVE_RELIABILITY',
      });
    }

    return recommendations;
  }

  /**
   * Get performance statistics summary
   * @returns {Object} Summary statistics
   */
  getStatistics() {
    return {
      ...this.stats,
      grades: this.grades,
      currentMetrics: this.currentMetrics,
      sampleCounts: {
        navigation: this.samples.navigation.length,
        memory: this.samples.memory.length,
        errors: this.samples.errors.length,
      },
      enabled: this.config.enabled,
    };
  }

  /**
   * Reset all performance data and statistics
   */
  resetStatistics() {
    this.samples = {
      navigation: [],
      memory: [],
      cpu: [],
      errors: [],
    };

    this.stats = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      totalNavigationTime: 0,
      averageMemoryUsage: 0,
      peakMemoryUsage: 0,
      averageCpuUsage: 0,
      peakCpuUsage: 0,
      alertsTriggered: 0,
    };

    this.grades = {
      overall: 'A',
      memory: 'A',
      navigation: 'A',
      cpu: 'A',
      reliability: 'A',
    };

    this.logger.info('PerformanceMonitor statistics reset');
  }

  /**
   * Update configuration
   * @param {Object} newConfig - New configuration options
   */
  updateConfiguration(newConfig) {
    // Deep merge for nested objects like alertThresholds
    if (newConfig.alertThresholds) {
      this.config.alertThresholds = { ...this.config.alertThresholds, ...newConfig.alertThresholds };
    }

    // Merge other top-level properties
    const { alertThresholds, ...otherConfig } = newConfig;
    this.config = { ...this.config, ...otherConfig };

    // Re-apply alertThresholds if it was provided
    if (alertThresholds) {
      this.config.alertThresholds = { ...this.config.alertThresholds, ...alertThresholds };
    }

    this.logger.infoWithObject('PerformanceMonitor configuration updated', { newConfig });
  }

  /**
   * Record a manual performance metric
   * @param {string} metricName - Name of the metric
   * @param {number} value - Metric value
   * @param {Object} metadata - Additional metadata
   */
  recordMetric(metricName, value, metadata = {}) {
    const sample = {
      type: 'manual',
      name: metricName,
      value,
      timestamp: timestampUTC(),
      metadata,
    };

    this.logger.debug('Manual metric recorded', sample);
  }
}
