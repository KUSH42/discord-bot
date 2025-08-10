/**
 * Rate Limiter for Discord API
 * Handles both proactive rate limiting and reactive rate limit responses
 */

/**
 * Custom error for rate limiting scenarios
 */
export class RateLimitError extends Error {
  constructor(message, retryAfter = 1000, type = 'proactive') {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.type = type; // 'proactive' or 'reactive'
    this.isRateLimitError = true;
  }
}

/**
 * Rate Limiter Implementation
 */
export class RateLimiter {
  constructor(options = {}) {
    // Configuration - use options from parent or reasonable defaults
    this.burstAllowance = options.burstAllowance || 30; // Match DiscordTransport setting
    this.burstResetTime = options.burstResetTime || 60000; // Match DiscordTransport setting
    this.baseSendDelay = options.baseSendDelay || 1000; // Match DiscordTransport setting
    this.timeSource = options.timeSource || (() => Date.now());

    // Burst tracking
    this.burstCounter = 0;
    this.lastBurstReset = this.timeSource();

    // Pause state (for handling 429 responses)
    this.isPaused = false;
    this.pauseUntil = null;
    this.pauseReason = null;

    // Metrics
    this.metrics = {
      burstLimitsHit: 0,
      rateLimitHits: 0,
      totalDelaysApplied: 0,
      averageDelay: 0,
      maxDelay: 0,
      lastRateLimitHit: null,
    };
  }

  /**
   * Check if we can send a message right now
   * @throws {RateLimitError} If rate limited
   */
  async checkRateLimit() {
    const now = this.timeSource();

    // Check if we're in a pause state (from 429 responses)
    if (this.isPaused && this.pauseUntil && now < this.pauseUntil) {
      const waitTime = this.pauseUntil - now;
      throw new RateLimitError(`Rate limited: ${this.pauseReason}`, waitTime, 'reactive');
    }

    // Clear pause if expired
    if (this.isPaused && this.pauseUntil && now >= this.pauseUntil) {
      this.clearPause();
    }

    // Reset burst counter if time window has passed
    if (now - this.lastBurstReset > this.burstResetTime) {
      this.resetBurstCounter();
    }

    // Check burst limit
    if (this.burstCounter >= this.burstAllowance) {
      this.metrics.burstLimitsHit++;
      throw new RateLimitError(
        `Burst limit exceeded (${this.burstCounter}/${this.burstAllowance})`,
        this.baseSendDelay,
        'proactive'
      );
    }

    // Increment burst counter
    this.burstCounter++;
  }

  /**
   * Handle a rate limit response from Discord (429)
   * @param {Error} error - Discord API error
   * @param {Object} headers - Response headers (optional)
   */
  handleRateLimit(error, headers = {}) {
    this.metrics.rateLimitHits++;
    this.metrics.lastRateLimitHit = this.timeSource();

    // Extract retry-after time
    let retryAfterMs = 1000; // Default 1 second

    if (error.retryAfter) {
      retryAfterMs = error.retryAfter * 1000;
    } else if (error.retry_after) {
      retryAfterMs = error.retry_after * 1000;
    } else if (headers['retry-after']) {
      retryAfterMs = parseInt(headers['retry-after']) * 1000;
    } else if (headers['x-ratelimit-reset-after']) {
      retryAfterMs = parseFloat(headers['x-ratelimit-reset-after']) * 1000;
    }

    // Add safety buffer
    retryAfterMs += 500;

    // Update delay metrics
    this.updateDelayMetrics(retryAfterMs);

    // Set pause state
    this.setPause(retryAfterMs, `Discord API rate limit (retry after ${retryAfterMs}ms)`);
  }

  /**
   * Set pause state
   * @param {number} duration - Duration to pause in milliseconds
   * @param {string} reason - Reason for pause
   */
  setPause(duration, reason = 'Rate limited') {
    this.isPaused = true;
    this.pauseUntil = this.timeSource() + duration;
    this.pauseReason = reason;
  }

  /**
   * Clear pause state
   */
  clearPause() {
    this.isPaused = false;
    this.pauseUntil = null;
    this.pauseReason = null;
  }

  /**
   * Reset burst counter
   */
  resetBurstCounter() {
    this.burstCounter = 0;
    this.lastBurstReset = this.timeSource();
  }

  /**
   * Update delay metrics
   * @param {number} delay - Delay in milliseconds
   */
  updateDelayMetrics(delay) {
    this.metrics.totalDelaysApplied++;
    this.metrics.maxDelay = Math.max(this.metrics.maxDelay, delay);

    // Calculate running average
    const currentAverage = this.metrics.averageDelay;
    const count = this.metrics.totalDelaysApplied;
    this.metrics.averageDelay = (currentAverage * (count - 1) + delay) / count;
  }

  /**
   * Get current rate limiter status
   * @returns {Object} Current status
   */
  getStatus() {
    const now = this.timeSource();

    return {
      isPaused: this.isPaused,
      pauseReason: this.pauseReason,
      pauseRemainingMs: this.isPaused && this.pauseUntil ? Math.max(0, this.pauseUntil - now) : 0,
      burstCounter: this.burstCounter,
      burstAllowance: this.burstAllowance,
      burstRemainingMs: Math.max(0, this.burstResetTime - (now - this.lastBurstReset)),
      canSendImmediately: !this.isPaused && this.burstCounter < this.burstAllowance,
    };
  }

  /**
   * Get rate limiter metrics
   * @returns {Object} Performance metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      currentStatus: this.getStatus(),
    };
  }

  /**
   * Reset all counters and state
   */
  reset() {
    this.burstCounter = 0;
    this.lastBurstReset = this.timeSource();
    this.clearPause();

    // Reset metrics
    this.metrics = {
      burstLimitsHit: 0,
      rateLimitHits: 0,
      totalDelaysApplied: 0,
      averageDelay: 0,
      maxDelay: 0,
      lastRateLimitHit: null,
    };
  }

  /**
   * Check if an error is a rate limit error (429)
   * @param {Error} error - Error to check
   * @returns {boolean} True if it's a rate limit error
   */
  static isRateLimitError(error) {
    return error.code === 429 || error.status === 429 || error.isRateLimitError === true;
  }

  /**
   * Force a rate limit state for testing
   * @param {number} duration - Duration in milliseconds
   * @param {string} reason - Reason for the rate limit
   */
  forceRateLimit(duration = 1000, reason = 'Forced for testing') {
    this.setPause(duration, reason);
    this.metrics.rateLimitHits++;
  }
}
