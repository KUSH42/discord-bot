import { timestampUTC } from './utc-time.js';

/**
 * Intelligent rate limiter with context-aware timing patterns
 * Optimized for timely updates (1-2 minutes) while maintaining stealth characteristics
 */
export class IntelligentRateLimiter {
  constructor(config = {}, logger) {
    this.config = {
      // Enable/disable intelligent rate limiting
      enabled: config.enabled !== false,

      // Base patterns with optimized timing for content updates
      patterns: {
        human_active: {
          base: config.humanActiveBase || 60000, // 1 minute (for timely updates)
          variance: config.humanActiveVariance || 30000, // ±30 seconds
          weight: 0.3,
        },
        human_idle: {
          base: config.humanIdleBase || 120000, // 2 minutes (reduced for timely updates)
          variance: config.humanIdleVariance || 60000, // ±1 minute
          weight: 0.4,
        },
        night_mode: {
          base: config.nightModeBase || 300000, // 5 minutes (reduced for better coverage)
          variance: config.nightModeVariance || 120000, // ±2 minutes
          weight: 0.2,
        },
        weekend: {
          base: config.weekendBase || 180000, // 3 minutes (reduced for consistent updates)
          variance: config.weekendVariance || 90000, // ±1.5 minutes
          weight: 0.1,
        },
      },

      // Burst detection configuration
      burstDetection: {
        enabled: config.burstDetectionEnabled !== false,
        windowMs: config.burstWindowMs || 300000, // 5 minutes
        threshold: config.burstThreshold || 8, // Reduced for timely updates
        maxPenalty: config.maxBurstPenalty || 1.5, // Up to 150% penalty (reduced from 200%)
        penaltyStep: config.penaltyStep || 0.15, // 15% penalty per request over threshold
      },

      // Minimum interval to maintain stealth balance
      minInterval: config.minInterval || 30000, // 30 seconds minimum

      // Maximum interval cap for timely updates
      maxInterval: config.maxInterval || 600000, // 10 minutes maximum
    };

    this.logger = logger;
    this.sessionHistory = [];

    // Operational state
    this.lastRequestTime = 0;
    this.currentPattern = null;

    // Statistics
    this.stats = {
      totalRequests: 0,
      burstDetections: 0,
      averageInterval: 0,
      patternUsage: {
        human_active: 0,
        human_idle: 0,
        night_mode: 0,
        weekend: 0,
      },
    };

    this.logger?.info('IntelligentRateLimiter initialized', {
      config: this.config,
      enabled: this.config.enabled,
    });
  }

  /**
   * Calculate next interval based on current context and patterns
   * @returns {number} Next interval in milliseconds
   */
  calculateNextInterval() {
    if (!this.config.enabled) {
      return 0; // No rate limiting when disabled
    }

    // Determine current context
    const context = this.analyzeCurrentContext();

    // Select appropriate pattern
    const selectedPattern = this.selectPattern(context);
    this.currentPattern = selectedPattern.name;
    this.stats.patternUsage[selectedPattern.name]++;

    // Calculate base interval with variance
    const baseInterval = selectedPattern.pattern.base;
    const { variance } = selectedPattern.pattern;
    const randomVariance = (Math.random() - 0.5) * 2 * variance;

    let calculatedInterval = baseInterval + randomVariance;

    // Apply burst detection penalty
    const burstPenalty = this.calculateBurstPenalty();
    if (burstPenalty > 0) {
      calculatedInterval *= 1 + burstPenalty;
      this.logger?.warn('Burst penalty applied', {
        originalInterval: calculatedInterval / (1 + burstPenalty),
        penaltyMultiplier: 1 + burstPenalty,
        finalInterval: calculatedInterval,
      });
    }

    // Apply min/max constraints
    calculatedInterval = Math.max(this.config.minInterval, calculatedInterval);
    calculatedInterval = Math.min(this.config.maxInterval, calculatedInterval);

    // Update statistics
    this.updateAverageInterval(calculatedInterval);

    this.logger?.debug('Next interval calculated', {
      context,
      pattern: selectedPattern.name,
      baseInterval,
      variance: randomVariance,
      burstPenalty,
      finalInterval: calculatedInterval,
    });

    return Math.round(calculatedInterval);
  }

  /**
   * Analyze current context to determine appropriate timing pattern
   * @returns {Object} Context information
   */
  analyzeCurrentContext() {
    const now = new Date();
    const currentHour = now.getUTCHours();
    const currentDay = now.getUTCDay(); // 0 = Sunday, 6 = Saturday

    const isWeekend = currentDay === 0 || currentDay === 6;
    const isNightTime = currentHour < 6 || currentHour > 22;
    const isBusinessHours = currentHour >= 9 && currentHour <= 17 && !isWeekend;
    const isActiveSession = this.isActiveSession();

    return {
      currentHour,
      currentDay,
      isWeekend,
      isNightTime,
      isBusinessHours,
      isActiveSession,
      dayOfWeekName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentDay],
    };
  }

  /**
   * Select appropriate timing pattern based on context
   * @param {Object} context - Current context information
   * @returns {Object} Selected pattern with name
   */
  selectPattern(context) {
    let selectedPattern;
    let patternName;

    if (context.isNightTime) {
      selectedPattern = this.config.patterns.night_mode;
      patternName = 'night_mode';
    } else if (context.isWeekend) {
      selectedPattern = this.config.patterns.weekend;
      patternName = 'weekend';
    } else if (context.isActiveSession) {
      selectedPattern = this.config.patterns.human_active;
      patternName = 'human_active';
    } else {
      selectedPattern = this.config.patterns.human_idle;
      patternName = 'human_idle';
    }

    return {
      name: patternName,
      pattern: selectedPattern,
    };
  }

  /**
   * Check if current session is considered active
   * @returns {boolean} True if session is active
   */
  isActiveSession() {
    const recentRequests = this.sessionHistory.filter(
      timestamp => timestampUTC() - timestamp < 600000 // Last 10 minutes
    );
    return recentRequests.length > 3;
  }

  /**
   * Calculate burst detection penalty
   * @returns {number} Penalty multiplier (0 = no penalty, 0.5 = 50% penalty)
   */
  calculateBurstPenalty() {
    if (!this.config.burstDetection.enabled) {
      return 0;
    }

    const recentRequests = this.sessionHistory.filter(
      timestamp => timestampUTC() - timestamp < this.config.burstDetection.windowMs
    );

    if (recentRequests.length > this.config.burstDetection.threshold) {
      const excessRequests = recentRequests.length - this.config.burstDetection.threshold;
      const penalty = Math.min(
        this.config.burstDetection.maxPenalty,
        excessRequests * this.config.burstDetection.penaltyStep
      );

      this.stats.burstDetections++;

      this.logger?.warn('Burst activity detected', {
        recentRequests: recentRequests.length,
        threshold: this.config.burstDetection.threshold,
        excessRequests,
        penalty,
        windowMs: this.config.burstDetection.windowMs,
      });

      return penalty;
    }

    return 0;
  }

  /**
   * Record a request for timing analysis
   * @param {Object} metadata - Optional metadata about the request
   */
  recordRequest(metadata = {}) {
    const now = timestampUTC();
    this.sessionHistory.push(now);
    this.lastRequestTime = now;
    this.stats.totalRequests++;

    // Keep only recent history (last 50 requests or 24 hours)
    const dayAgo = now - 24 * 60 * 60 * 1000;
    this.sessionHistory = this.sessionHistory.filter(timestamp => timestamp > dayAgo).slice(-50);

    this.logger?.debug('Request recorded', {
      timestamp: now,
      totalRequests: this.stats.totalRequests,
      recentHistoryLength: this.sessionHistory.length,
      metadata,
    });
  }

  /**
   * Wait for the next request based on intelligent timing
   * @param {Object} options - Wait options
   * @returns {Promise<void>}
   */
  async waitForNextRequest(options = {}) {
    const { skipWait = false, metadata = {} } = options;

    if (!this.config.enabled || skipWait) {
      this.recordRequest(metadata);
      return;
    }

    const nextInterval = this.calculateNextInterval();

    if (nextInterval > 0) {
      this.logger?.info('Waiting for next request', {
        intervalMs: nextInterval,
        intervalSeconds: Math.round(nextInterval / 1000),
        pattern: this.currentPattern,
        metadata,
      });

      await new Promise(resolve => setTimeout(resolve, nextInterval));
    }

    this.recordRequest(metadata);
  }

  /**
   * Get current timing statistics
   * @returns {Object} Current statistics
   */
  getStatistics() {
    const sessionDuration = this.lastRequestTime > 0 ? timestampUTC() - Math.min(...this.sessionHistory) : 0;

    const recentIntervals = [];
    for (let i = 1; i < this.sessionHistory.length; i++) {
      recentIntervals.push(this.sessionHistory[i] - this.sessionHistory[i - 1]);
    }

    const timingVariance = recentIntervals.length > 0 ? this.calculateVarianceCoefficient(recentIntervals) : 0;

    return {
      ...this.stats,
      enabled: this.config.enabled,
      sessionDurationMs: sessionDuration,
      sessionDurationHours: Math.round((sessionDuration / 3600000) * 100) / 100,
      recentRequestCount: this.sessionHistory.length,
      currentPattern: this.currentPattern,
      timingVariancePercent: Math.round(timingVariance * 100),
      lastRequestTime: this.lastRequestTime,
      burstDetectionRate:
        this.stats.totalRequests > 0 ? Math.round((this.stats.burstDetections / this.stats.totalRequests) * 100) : 0,
    };
  }

  /**
   * Calculate variance coefficient for timing analysis
   * @param {number[]} intervals - Array of intervals
   * @returns {number} Coefficient of variation (0-1)
   */
  calculateVarianceCoefficient(intervals) {
    if (intervals.length < 2) {
      return 0;
    }

    const mean = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const variance = intervals.reduce((sum, interval) => sum + Math.pow(interval - mean, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);

    return mean > 0 ? stdDev / mean : 0;
  }

  /**
   * Update rolling average interval
   * @param {number} newInterval - New interval to include in average
   */
  updateAverageInterval(newInterval) {
    if (this.stats.totalRequests === 0) {
      this.stats.averageInterval = newInterval;
    } else {
      // Rolling average
      this.stats.averageInterval =
        (this.stats.averageInterval * (this.stats.totalRequests - 1) + newInterval) / this.stats.totalRequests;
    }
  }

  /**
   * Force a specific timing pattern for testing or special cases
   * @param {string} patternName - Pattern name to force
   * @param {number} durationMs - Duration to maintain forced pattern
   */
  forcePattern(patternName, durationMs = 3600000) {
    if (!this.config.patterns[patternName]) {
      throw new Error(`Invalid pattern name: ${patternName}`);
    }

    this.forcedPattern = {
      name: patternName,
      pattern: this.config.patterns[patternName],
      expiresAt: timestampUTC() + durationMs,
    };

    this.logger?.info('Pattern forced', {
      pattern: patternName,
      durationMs,
      expiresAt: this.forcedPattern.expiresAt,
    });
  }

  /**
   * Clear any forced pattern
   */
  clearForcedPattern() {
    if (this.forcedPattern) {
      this.logger?.info('Forced pattern cleared', {
        previousPattern: this.forcedPattern.name,
      });
      this.forcedPattern = null;
    }
  }

  /**
   * Update configuration
   * @param {Object} newConfig - New configuration options
   */
  updateConfiguration(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
    };

    this.logger?.info('IntelligentRateLimiter configuration updated', {
      newConfig: this.config,
    });
  }

  /**
   * Reset statistics and session history
   */
  resetStatistics() {
    this.stats = {
      totalRequests: 0,
      burstDetections: 0,
      averageInterval: 0,
      patternUsage: {
        human_active: 0,
        human_idle: 0,
        night_mode: 0,
        weekend: 0,
      },
    };

    this.sessionHistory = [];
    this.lastRequestTime = 0;

    this.logger?.info('IntelligentRateLimiter statistics reset');
  }
}
