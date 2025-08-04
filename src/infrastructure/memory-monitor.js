import { nowUTC, timestampUTC } from '../utilities/utc-time.js';
import { createEnhancedLogger } from '../utilities/enhanced-logger.js';

/**
 * Memory monitoring and leak detection system
 * Monitors memory usage patterns and provides cleanup suggestions
 */
export class MemoryMonitor {
  constructor(dependencies) {
    const { logger, debugManager, metricsManager, config = {} } = dependencies;

    // Create enhanced logger for performance monitoring
    this.logger = createEnhancedLogger('performance', logger, debugManager, metricsManager);

    // Configuration
    this.maxMemoryMB = config.maxMemoryMB || 1024; // 1GB default limit
    this.warningThresholdMB = config.warningThresholdMB || 768; // 768MB warning
    this.checkIntervalMs = config.checkIntervalMs || 30000; // 30 second checks
    this.samplesRetention = config.samplesRetention || 100; // Keep 100 samples
    this.gcThresholdMB = config.gcThresholdMB || 512; // Force GC at 512MB

    // Memory tracking
    this.samples = [];
    this.isMonitoring = false;
    this.monitorTimer = null;
    this.lastGCTime = Date.now();
    this.consecutiveHighMemory = 0;

    // Content tracking for memory analysis
    this.contentTrackers = new Map(); // Track registered content stores

    // Statistics
    this.stats = {
      peakMemoryMB: 0,
      averageMemoryMB: 0,
      gcExecutions: 0,
      warningsIssued: 0,
      leakSuspicionCount: 0,
    };
  }

  /**
   * Start memory monitoring
   */
  start() {
    if (this.isMonitoring) {
      this.logger.warn('Memory monitor is already running');
      return;
    }

    const operation = this.logger.startOperation('startMemoryMonitoring', {
      maxMemoryMB: this.maxMemoryMB,
      warningThresholdMB: this.warningThresholdMB,
      checkIntervalMs: this.checkIntervalMs,
    });

    this.isMonitoring = true;
    operation.progress('Memory monitoring initialized');

    this.scheduleNextCheck();

    operation.success('Memory monitoring started successfully', {
      status: 'active',
      nextCheckMs: this.checkIntervalMs,
    });
  }

  /**
   * Stop memory monitoring
   */
  stop() {
    if (!this.isMonitoring) {
      return;
    }

    const operation = this.logger.startOperation('stopMemoryMonitoring', {
      isMonitoring: this.isMonitoring,
    });

    this.isMonitoring = false;

    if (this.monitorTimer) {
      clearTimeout(this.monitorTimer);
      this.monitorTimer = null;
      operation.progress('Monitoring timer cleared');
    }

    const finalStats = this.getStats();
    operation.success('Memory monitoring stopped successfully', {
      finalStats,
      samplesCollected: this.samples.length,
    });
  }

  /**
   * Schedule next memory check
   * @private
   */
  scheduleNextCheck() {
    if (!this.isMonitoring) {
      return;
    }

    this.monitorTimer = setTimeout(async () => {
      await this.checkMemoryUsage();
      this.scheduleNextCheck();
    }, this.checkIntervalMs);
  }

  /**
   * Check current memory usage and take action if needed
   * @private
   */
  async checkMemoryUsage() {
    const operation = this.logger.startOperation('memoryCheck', {});

    try {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
      const externalMB = Math.round(memUsage.external / 1024 / 1024);
      const rssMB = Math.round(memUsage.rss / 1024 / 1024);

      operation.progress(`Memory usage: ${heapUsedMB}MB heap, ${externalMB}MB external`);

      // Analyze content stores
      const contentAnalysis = await this.analyzeContentStores();
      operation.progress(`Analyzed ${Object.keys(contentAnalysis).length} content stores`);

      // Record sample
      const sample = {
        timestamp: timestampUTC(),
        heapUsedMB,
        heapTotalMB,
        externalMB,
        rssMB,
        totalMB: heapUsedMB + externalMB,
        contentStores: contentAnalysis,
      };

      this.samples.push(sample);
      this.trimSamples();
      this.updateStats(sample);

      // Check for memory issues
      this.analyzeMemoryPattern(sample);

      // Force GC if memory is high
      if (sample.totalMB > this.gcThresholdMB) {
        operation.progress(`High memory detected (${sample.totalMB}MB), forcing GC`);
        this.forceGarbageCollection();
      }

      operation.success('Memory check completed', {
        totalMB: sample.totalMB,
        contentStores: Object.keys(contentAnalysis).length,
        isHighMemory: sample.totalMB > this.warningThresholdMB,
      });
    } catch (error) {
      operation.error(error, 'Memory check failed', { error: error.message });
    }
  }

  /**
   * Analyze memory usage patterns for leaks
   * @private
   */
  analyzeMemoryPattern(sample) {
    const { totalMB } = sample;

    // Warning threshold check
    if (totalMB > this.warningThresholdMB) {
      this.consecutiveHighMemory++;
      this.stats.warningsIssued++;

      this.logger.warn('High memory usage detected', {
        currentMB: totalMB,
        thresholdMB: this.warningThresholdMB,
        consecutiveCount: this.consecutiveHighMemory,
        sample,
      });

      // If memory stays high for multiple checks, suspect a leak
      if (this.consecutiveHighMemory >= 3) {
        this.detectPotentialLeak(sample);
      }
    } else {
      this.consecutiveHighMemory = 0;
    }

    // Critical memory check
    if (totalMB > this.maxMemoryMB) {
      this.handleCriticalMemory(sample);
    }
  }

  /**
   * Detect potential memory leaks
   * @private
   */
  detectPotentialLeak(sample) {
    this.stats.leakSuspicionCount++;

    // Check if memory is consistently growing
    if (this.samples.length >= 10) {
      const recent = this.samples.slice(-10);
      const trend = this.calculateMemoryTrend(recent);

      if (trend > 5) {
        // Memory growing >5MB per check
        this.logger.error('POTENTIAL MEMORY LEAK DETECTED', {
          currentMB: sample.totalMB,
          trendMBPerCheck: trend,
          consecutiveHighMemory: this.consecutiveHighMemory,
          recommendation: 'Consider investigating browser instances, timers, and event listeners',
        });

        // Suggest cleanup actions
        this.suggestCleanupActions();
      }
    }
  }

  /**
   * Handle critical memory situation
   * @private
   */
  handleCriticalMemory(sample) {
    this.logger.error('CRITICAL MEMORY USAGE - IMMEDIATE ACTION REQUIRED', {
      currentMB: sample.totalMB,
      maxMB: this.maxMemoryMB,
      recommendation: 'Consider emergency cleanup or restart',
    });

    // Force aggressive GC
    this.forceGarbageCollection();

    // Emit critical memory event
    process.emit('criticalMemory', {
      sample,
      stats: this.getStats(),
    });
  }

  /**
   * Calculate memory growth trend
   * @private
   */
  calculateMemoryTrend(samples) {
    if (samples.length < 2) {
      return 0;
    }

    const first = samples[0].totalMB;
    const last = samples[samples.length - 1].totalMB;
    return (last - first) / samples.length;
  }

  /**
   * Suggest cleanup actions based on memory analysis
   * @private
   */
  suggestCleanupActions() {
    const suggestions = [
      'Check for unclosed browser instances',
      'Verify timer cleanup in polling operations',
      'Review event listener cleanup',
      'Check metrics collection sample limits',
      'Verify proper disposal of disposable services',
    ];

    this.logger.warn('Memory cleanup suggestions:', {
      suggestions,
      stats: this.getStats(),
    });
  }

  /**
   * Force garbage collection if available
   * @private
   */
  forceGarbageCollection() {
    const timeSinceLastGC = Date.now() - this.lastGCTime;

    // Don't GC too frequently (minimum 30 seconds)
    if (timeSinceLastGC < 30000) {
      return;
    }

    if (global.gc) {
      const beforeMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      global.gc();
      const afterMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      this.stats.gcExecutions++;
      this.lastGCTime = Date.now();

      this.logger.info('Forced garbage collection', {
        beforeMB,
        afterMB,
        freedMB: beforeMB - afterMB,
      });
    } else {
      this.logger.warn('Garbage collection not available (start with --expose-gc)');
    }
  }

  /**
   * Trim memory samples to prevent unbounded growth
   * @private
   */
  trimSamples() {
    if (this.samples.length > this.samplesRetention) {
      this.samples = this.samples.slice(-this.samplesRetention);
    }
  }

  /**
   * Update statistics
   * @private
   */
  updateStats(sample) {
    const { totalMB } = sample;

    // Update peak memory
    if (totalMB > this.stats.peakMemoryMB) {
      this.stats.peakMemoryMB = totalMB;
    }

    // Calculate average
    if (this.samples.length > 0) {
      const sum = this.samples.reduce((acc, s) => acc + s.totalMB, 0);
      this.stats.averageMemoryMB = Math.round(sum / this.samples.length);
    }
  }

  /**
   * Register a content store for memory tracking
   * @param {string} name - Name of the content store
   * @param {Function} analyzer - Function that returns analysis of the store
   */
  registerContentStore(name, analyzer) {
    this.contentTrackers.set(name, analyzer);
    this.logger.info(`Registered content store for memory tracking: ${name}`);
  }

  /**
   * Analyze all registered content stores
   * @private
   * @returns {Object} Analysis of content stores
   */
  async analyzeContentStores() {
    const analysis = {};
    let totalItems = 0;

    for (const [name, analyzer] of this.contentTrackers) {
      try {
        const storeAnalysis = await analyzer();
        analysis[name] = storeAnalysis;
        totalItems += storeAnalysis.totalItems || 0;
      } catch (error) {
        this.logger.warn(`Failed to analyze content store ${name}:`, error.message);
        analysis[name] = { error: error.message };
      }
    }

    analysis.totalContentItems = totalItems;
    return analysis;
  }

  /**
   * Get current memory statistics
   * @returns {Object} Memory statistics
   */
  getStats() {
    const currentSample = this.samples[this.samples.length - 1];

    return {
      ...this.stats,
      currentMemoryMB: currentSample ? currentSample.totalMB : 0,
      samplesCollected: this.samples.length,
      isMonitoring: this.isMonitoring,
      contentStores: currentSample ? currentSample.contentStores : {},
      thresholds: {
        warningMB: this.warningThresholdMB,
        maxMB: this.maxMemoryMB,
        gcMB: this.gcThresholdMB,
      },
    };
  }

  /**
   * Get recent memory samples
   * @param {number} count - Number of recent samples to return
   * @returns {Array} Recent memory samples
   */
  getRecentSamples(count = 10) {
    return this.samples.slice(-count);
  }

  /**
   * Get detailed content breakdown for debugging
   * @returns {Object} Detailed content analysis
   */
  async getDetailedContentAnalysis() {
    return {
      timestamp: timestampUTC(),
      contentStores: await this.analyzeContentStores(),
      memoryPressure: {
        current: this.samples.length > 0 ? this.samples[this.samples.length - 1].totalMB : 0,
        peak: this.stats.peakMemoryMB,
        average: this.stats.averageMemoryMB,
      },
      recommendations: this.generateMemoryRecommendations(),
    };
  }

  /**
   * Generate memory optimization recommendations
   * @private
   * @returns {Array} Array of recommendations
   */
  async generateMemoryRecommendations() {
    const recommendations = [];
    const contentAnalysis = await this.analyzeContentStores();

    // Check for large content stores
    for (const [name, analysis] of Object.entries(contentAnalysis)) {
      if (analysis.totalItems > 1000) {
        recommendations.push(`${name}: Consider reducing cache size (${analysis.totalItems} items)`);
      }
      if (analysis.oldestItemHours && analysis.oldestItemHours > 48) {
        recommendations.push(`${name}: Consider more aggressive cleanup (oldest item: ${analysis.oldestItemHours}h)`);
      }
    }

    // Memory pressure recommendations
    if (this.stats.peakMemoryMB > this.warningThresholdMB) {
      recommendations.push('Memory pressure detected - consider reducing cache sizes');
    }

    return recommendations;
  }

  /**
   * Dispose of the memory monitor
   */
  dispose() {
    this.stop();
    this.samples = [];
    this.contentTrackers.clear();
  }
}
