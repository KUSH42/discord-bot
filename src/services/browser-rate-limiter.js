// browser-rate-limiter.js
// Enhanced rate limiting for browser operations with anti-bot patterns
// Extends existing CommandRateLimit with humanized delays and time-aware patterns

import { CommandRateLimit } from '../rate-limiter.js';
import { timestampUTC } from '../utilities/utc-time.js';

/**
 * Browser rate limiter with anti-bot enhancements
 * Extends CommandRateLimit with humanized delays, timing variance, and time-aware patterns
 */
export class BrowserRateLimit extends CommandRateLimit {
  constructor(options = {}) {
    // More conservative defaults for browser operations
    super(options.maxRequests || 3, options.windowMs || 60000); // 3 requests per minute

    this.humanizedDelays = options.humanizedDelays !== false;
    this.variancePercent = options.variancePercent || 30; // ±30% variance
    this.timeAwarePatterns = options.timeAwarePatterns !== false;
    this.lastRequestTime = new Map();

    // Time-aware patterns for different periods
    this.timePatterns = {
      business: {
        multiplier: 0.5, // More conservative during business hours
        hours: [9, 10, 11, 12, 13, 14, 15, 16, 17],
      },
      evening: {
        multiplier: 0.7, // Moderate during evening hours
        hours: [18, 19, 20, 21, 22],
      },
      night: {
        multiplier: 1.0, // More relaxed during night/early morning
        hours: [23, 0, 1, 2, 3, 4, 5, 6, 7, 8],
      },
    };
  }

  /**
   * Wait for next request with humanized delay patterns
   * @param {string} browserId - Browser instance identifier
   * @returns {Promise<void>} - Promise that resolves when safe to proceed
   */
  async waitForNextRequest(browserId) {
    if (!this.humanizedDelays) {
      return;
    }

    const lastTime = this.lastRequestTime.get(browserId) || 0;
    const now = timestampUTC();
    const baseInterval = this.calculateBaseInterval();

    // Add variance to make timing less predictable
    const variance = baseInterval * (this.variancePercent / 100);
    const randomVariance = (Math.random() - 0.5) * 2 * variance;
    const targetInterval = baseInterval + randomVariance;

    const elapsed = now - lastTime;
    const waitTime = Math.max(0, targetInterval - elapsed);

    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime.set(browserId, timestampUTC());
  }

  /**
   * Calculate base interval considering time-aware patterns
   * @returns {number} - Base interval in milliseconds
   */
  calculateBaseInterval() {
    const baseInterval = this.windowMs / this.maxCommands;

    if (!this.timeAwarePatterns) {
      return baseInterval;
    }

    const timePattern = this.getCurrentTimePattern();
    return baseInterval * (1 / timePattern.multiplier); // Lower multiplier = longer intervals
  }

  /**
   * Get current time pattern based on hour of day
   * @returns {Object} - Time pattern configuration
   */
  getCurrentTimePattern() {
    const currentHour = new Date().getHours();

    if (this.timePatterns.business.hours.includes(currentHour)) {
      return this.timePatterns.business;
    } else if (this.timePatterns.evening.hours.includes(currentHour)) {
      return this.timePatterns.evening;
    } else {
      return this.timePatterns.night;
    }
  }

  /**
   * Check if browser ID is rate limited with enhanced tracking
   * @param {string} browserId - Browser instance identifier
   * @returns {boolean} - True if allowed, false if rate limited
   */
  isBrowserAllowed(browserId) {
    // Use existing rate limiting logic but track by browser ID
    return this.isAllowed(browserId);
  }

  /**
   * Record a browser request and apply intelligent delays
   * @param {string} browserId - Browser instance identifier
   * @returns {Promise<boolean>} - True if request allowed after delay
   */
  async recordBrowserRequest(browserId) {
    // Check if allowed before applying delay
    if (!this.isBrowserAllowed(browserId)) {
      return false;
    }

    // Apply humanized delay before next request
    await this.waitForNextRequest(browserId);
    return true;
  }

  /**
   * Get enhanced statistics including timing patterns
   * @returns {Object} - Enhanced statistics object
   */
  getEnhancedStats() {
    const baseStats = this.getStats();
    const currentPattern = this.getCurrentTimePattern();

    return {
      ...baseStats,
      humanizedDelays: this.humanizedDelays,
      variancePercent: this.variancePercent,
      timeAwarePatterns: this.timeAwarePatterns,
      currentTimePattern: currentPattern,
      baseInterval: this.calculateBaseInterval(),
      activeBrowsers: this.lastRequestTime.size,
    };
  }

  /**
   * Reset browser-specific tracking data
   * @param {string} browserId - Browser instance identifier
   */
  resetBrowser(browserId) {
    this.resetUser(browserId);
    this.lastRequestTime.delete(browserId);
  }

  /**
   * Cleanup old browser entries
   */
  cleanup() {
    super.cleanup();

    // Clean up old browser request times
    const now = timestampUTC();
    const maxAge = this.windowMs * 2; // Keep for 2 windows

    for (const [browserId, lastTime] of this.lastRequestTime.entries()) {
      if (now - lastTime > maxAge) {
        this.lastRequestTime.delete(browserId);
      }
    }
  }

  /**
   * Set time pattern configuration
   * @param {string} period - Time period (business, evening, night)
   * @param {Object} config - Pattern configuration
   */
  setTimePattern(period, config) {
    if (this.timePatterns[period]) {
      this.timePatterns[period] = { ...this.timePatterns[period], ...config };
    }
  }
}

/**
 * Create a browser rate limiter instance with anti-bot configuration
 * @param {Object} options - Configuration options
 * @returns {BrowserRateLimit} - New browser rate limiter instance
 */
export function createBrowserRateLimiter(options = {}) {
  const defaultOptions = {
    maxRequests: 3, // Very conservative for browser operations
    windowMs: 60000, // 1 minute windows
    humanizedDelays: true, // Enable humanized timing
    variancePercent: 30, // ±30% timing variance
    timeAwarePatterns: true, // Enable time-of-day awareness
  };

  return new BrowserRateLimit({ ...defaultOptions, ...options });
}

/**
 * Time-aware browser rate limiter that adapts to usage patterns
 */
export class TimeAwareBrowserLimiter {
  constructor(baseLimiter, options = {}) {
    this.baseLimiter = baseLimiter;
    this.sessionHistory = [];
    this.burstDetectionWindow = options.burstWindow || 300000; // 5 minutes
    this.burstThreshold = options.burstThreshold || 8; // 8 requests in 5 minutes
  }

  /**
   * Check rate limit with burst detection and adaptive timing
   * @param {string} browserId - Browser instance identifier
   * @returns {Promise<boolean>} - True if request allowed
   */
  async checkRateLimit(browserId) {
    // Record request timestamp
    const now = timestampUTC();
    this.sessionHistory.push(now);

    // Clean old history
    this.sessionHistory = this.sessionHistory.filter(timestamp => now - timestamp < this.burstDetectionWindow);

    // Apply burst penalty if detected
    const burstPenalty = this.calculateBurstPenalty();

    // Temporarily adjust the base limiter's window if burst detected
    const originalWindow = this.baseLimiter.windowMs;
    if (burstPenalty > 0) {
      this.baseLimiter.windowMs = Math.min(
        originalWindow * (1 + burstPenalty),
        300000 // Cap at 5 minutes
      );
    }

    let result;
    try {
      result = await this.baseLimiter.recordBrowserRequest(browserId);
    } finally {
      // Restore original window
      this.baseLimiter.windowMs = originalWindow;
    }

    return result;
  }

  /**
   * Calculate burst penalty multiplier
   * @returns {number} - Penalty multiplier (0 = no penalty, 1.5 = 150% longer delays)
   */
  calculateBurstPenalty() {
    const recentRequests = this.sessionHistory.length;

    if (recentRequests > this.burstThreshold) {
      // Progressive penalty: 15% per request over threshold, capped at 150%
      const excessRequests = recentRequests - this.burstThreshold;
      return Math.min(1.5, excessRequests * 0.15);
    }

    return 0;
  }

  /**
   * Get statistics including burst detection metrics
   * @returns {Object} - Statistics with burst detection data
   */
  getStats() {
    const baseStats = this.baseLimiter.getEnhancedStats();
    const burstPenalty = this.calculateBurstPenalty();

    return {
      ...baseStats,
      sessionHistory: this.sessionHistory.length,
      burstThreshold: this.burstThreshold,
      burstPenalty,
      burstDetected: burstPenalty > 0,
    };
  }
}
