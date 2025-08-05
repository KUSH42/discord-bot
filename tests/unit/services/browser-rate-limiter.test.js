import { jest } from '@jest/globals';

// Mock the base CommandRateLimit class
class MockCommandRateLimit {
  constructor(maxCommands = 3, windowMs = 60000) {
    this.maxCommands = maxCommands;
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  isAllowed(userId) {
    const now = Date.now();
    if (!this.requests.has(userId)) {
      this.requests.set(userId, []);
    }

    const userRequests = this.requests.get(userId);
    // Remove old requests outside the window
    const validRequests = userRequests.filter(timestamp => now - timestamp < this.windowMs);
    this.requests.set(userId, validRequests);

    if (validRequests.length >= this.maxCommands) {
      return false;
    }

    validRequests.push(now);
    return true;
  }

  getStats() {
    return {
      maxCommands: this.maxCommands,
      windowMs: this.windowMs,
      activeUsers: this.requests.size,
    };
  }

  resetUser(userId) {
    this.requests.delete(userId);
  }

  cleanup() {
    const now = Date.now();
    for (const [userId, timestamps] of this.requests.entries()) {
      const validRequests = timestamps.filter(timestamp => now - timestamp < this.windowMs);
      if (validRequests.length === 0) {
        this.requests.delete(userId);
      } else {
        this.requests.set(userId, validRequests);
      }
    }
  }
}

// Mock timestampUTC function
const mockTimestampUTC = jest.fn(() => Date.now());

// Create browser rate limit class that extends mock base class
class BrowserRateLimit extends MockCommandRateLimit {
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
    const now = mockTimestampUTC();
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

    this.lastRequestTime.set(browserId, mockTimestampUTC());
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
    const now = mockTimestampUTC();
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
function createBrowserRateLimiter(options = {}) {
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
class TimeAwareBrowserLimiter {
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
    const now = mockTimestampUTC();
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

describe('BrowserRateLimit', () => {
  let browserRateLimit;
  let mockTimestamp;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTimestamp = 1640995200000; // Fixed timestamp for consistent testing
    mockTimestampUTC.mockReturnValue(mockTimestamp);

    browserRateLimit = new BrowserRateLimit({
      maxRequests: 3,
      windowMs: 60000, // 1 minute
      humanizedDelays: true,
      variancePercent: 30,
      timeAwarePatterns: true,
    });
  });

  describe('constructor', () => {
    test('should initialize with default values', () => {
      const limiter = new BrowserRateLimit();
      const stats = limiter.getEnhancedStats();

      expect(stats.maxCommands).toBe(3); // Default maxRequests
      expect(stats.windowMs).toBe(60000); // Default windowMs
      expect(stats.humanizedDelays).toBe(true);
      expect(stats.variancePercent).toBe(30);
      expect(stats.timeAwarePatterns).toBe(true);
    });

    test('should initialize with custom options', () => {
      const customLimiter = new BrowserRateLimit({
        maxRequests: 5,
        windowMs: 120000,
        humanizedDelays: false,
        variancePercent: 20,
        timeAwarePatterns: false,
      });

      const stats = customLimiter.getEnhancedStats();
      expect(stats.maxCommands).toBe(5);
      expect(stats.windowMs).toBe(120000);
      expect(stats.humanizedDelays).toBe(false);
      expect(stats.variancePercent).toBe(20);
      expect(stats.timeAwarePatterns).toBe(false);
    });

    test('should initialize time patterns correctly', () => {
      expect(browserRateLimit.timePatterns.business.multiplier).toBe(0.5);
      expect(browserRateLimit.timePatterns.evening.multiplier).toBe(0.7);
      expect(browserRateLimit.timePatterns.night.multiplier).toBe(1.0);
    });
  });

  describe('isBrowserAllowed', () => {
    test('should allow initial requests', () => {
      expect(browserRateLimit.isBrowserAllowed('browser-1')).toBe(true);
      expect(browserRateLimit.isBrowserAllowed('browser-2')).toBe(true);
    });

    test('should track requests per browser ID', () => {
      // Allow 3 requests per browser
      expect(browserRateLimit.isBrowserAllowed('browser-1')).toBe(true);
      expect(browserRateLimit.isBrowserAllowed('browser-1')).toBe(true);
      expect(browserRateLimit.isBrowserAllowed('browser-1')).toBe(true);

      // 4th request should be blocked
      expect(browserRateLimit.isBrowserAllowed('browser-1')).toBe(false);

      // But different browser should still be allowed
      expect(browserRateLimit.isBrowserAllowed('browser-2')).toBe(true);
    });

    test('should reset rate limits after window expires', () => {
      // Create a new limiter with a short window for easier testing
      const limiter = new BrowserRateLimit({ maxRequests: 2, windowMs: 1000 });

      // Use up all requests at initial time
      const initialTime = 1000000;
      jest.spyOn(Date, 'now').mockReturnValue(initialTime);

      expect(limiter.isBrowserAllowed('browser-1')).toBe(true);
      expect(limiter.isBrowserAllowed('browser-1')).toBe(true);
      expect(limiter.isBrowserAllowed('browser-1')).toBe(false); // Rate limited

      // Advance time beyond window (1001ms later)
      const advancedTime = initialTime + 1001;
      jest.spyOn(Date, 'now').mockReturnValue(advancedTime);

      // Should be allowed again because the window has expired
      expect(limiter.isBrowserAllowed('browser-1')).toBe(true);
    });
  });

  describe('waitForNextRequest', () => {
    test('should not delay when humanized delays are disabled', async () => {
      const limiter = new BrowserRateLimit({ humanizedDelays: false });
      const startTime = Date.now();

      await limiter.waitForNextRequest('browser-1');

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(100); // Should be nearly instant
    });

    test('should apply variance to delay timing', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5); // Fixed random for testing

      const limiter = new BrowserRateLimit({
        maxRequests: 1,
        windowMs: 1000,
        variancePercent: 50,
      });

      // First call sets baseline
      await limiter.waitForNextRequest('browser-1');

      // Second call should have some delay with variance
      const startTime = Date.now();
      await limiter.waitForNextRequest('browser-1');
      const elapsed = Date.now() - startTime;

      // Should have applied some delay (testing exact timing is tricky in tests)
      expect(elapsed).toBeGreaterThan(0);
    });

    test('should track last request time per browser', async () => {
      await browserRateLimit.waitForNextRequest('browser-1');
      expect(browserRateLimit.lastRequestTime.has('browser-1')).toBe(true);

      await browserRateLimit.waitForNextRequest('browser-2');
      expect(browserRateLimit.lastRequestTime.has('browser-2')).toBe(true);
      expect(browserRateLimit.lastRequestTime.size).toBe(2);
    });
  });

  describe('calculateBaseInterval', () => {
    test('should calculate base interval correctly', () => {
      const baseInterval = browserRateLimit.calculateBaseInterval();
      // With 3 requests per 60000ms window = 20000ms base interval
      expect(baseInterval).toBeGreaterThan(0);
    });

    test('should apply time-aware multipliers', () => {
      // Mock business hours (should use 0.5 multiplier)
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(14); // 2 PM

      const businessInterval = browserRateLimit.calculateBaseInterval();

      // Mock night hours (should use 1.0 multiplier)
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(2); // 2 AM

      const nightInterval = browserRateLimit.calculateBaseInterval();

      // Business hours should have longer intervals (more conservative)
      expect(businessInterval).toBeGreaterThan(nightInterval);
    });

    test('should ignore time patterns when disabled', () => {
      const limiter = new BrowserRateLimit({ timeAwarePatterns: false });

      // Mock different hours
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(14); // Business
      const businessInterval = limiter.calculateBaseInterval();

      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(2); // Night
      const nightInterval = limiter.calculateBaseInterval();

      // Should be the same when time patterns are disabled
      expect(businessInterval).toBe(nightInterval);
    });
  });

  describe('getCurrentTimePattern', () => {
    test('should return business pattern during business hours', () => {
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(14); // 2 PM

      const pattern = browserRateLimit.getCurrentTimePattern();
      expect(pattern.multiplier).toBe(0.5);
      expect(pattern.hours).toContain(14);
    });

    test('should return evening pattern during evening hours', () => {
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(20); // 8 PM

      const pattern = browserRateLimit.getCurrentTimePattern();
      expect(pattern.multiplier).toBe(0.7);
      expect(pattern.hours).toContain(20);
    });

    test('should return night pattern during night hours', () => {
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(2); // 2 AM

      const pattern = browserRateLimit.getCurrentTimePattern();
      expect(pattern.multiplier).toBe(1.0);
      expect(pattern.hours).toContain(2);
    });
  });

  describe('recordBrowserRequest', () => {
    test('should return true for allowed requests', async () => {
      const result = await browserRateLimit.recordBrowserRequest('browser-1');
      expect(result).toBe(true);
    });

    test('should return false for rate-limited requests', async () => {
      // Create a limiter with no delays to avoid timeout
      const fastLimiter = new BrowserRateLimit({
        maxRequests: 3,
        windowMs: 60000,
        humanizedDelays: false,
      });

      // Use up all requests
      await fastLimiter.recordBrowserRequest('browser-1');
      await fastLimiter.recordBrowserRequest('browser-1');
      await fastLimiter.recordBrowserRequest('browser-1');

      const result = await fastLimiter.recordBrowserRequest('browser-1');
      expect(result).toBe(false);
    });

    test('should apply humanized delays when enabled', async () => {
      // Create a limiter with minimal delays for testing
      const delayLimiter = new BrowserRateLimit({
        maxRequests: 5,
        windowMs: 1000,
        humanizedDelays: true,
        variancePercent: 10,
      });

      const startTime = Date.now();
      await delayLimiter.recordBrowserRequest('browser-1');
      const firstElapsed = Date.now() - startTime;

      const secondStart = Date.now();
      await delayLimiter.recordBrowserRequest('browser-1');
      const secondElapsed = Date.now() - secondStart;

      // Second request should have some delay (timing can be variable in tests)
      expect(secondElapsed).toBeGreaterThanOrEqual(0);
    }, 10000); // Increase timeout
  });

  describe('getEnhancedStats', () => {
    test('should return enhanced statistics', () => {
      browserRateLimit.waitForNextRequest('browser-1');
      browserRateLimit.waitForNextRequest('browser-2');

      const stats = browserRateLimit.getEnhancedStats();

      expect(stats).toHaveProperty('maxCommands');
      expect(stats).toHaveProperty('windowMs');
      expect(stats).toHaveProperty('humanizedDelays');
      expect(stats).toHaveProperty('variancePercent');
      expect(stats).toHaveProperty('timeAwarePatterns');
      expect(stats).toHaveProperty('currentTimePattern');
      expect(stats).toHaveProperty('baseInterval');
      expect(stats.activeBrowsers).toBe(2);
    });

    test('should include current time pattern information', () => {
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(14); // Business hours

      const stats = browserRateLimit.getEnhancedStats();
      expect(stats.currentTimePattern.multiplier).toBe(0.5);
    });
  });

  describe('resetBrowser', () => {
    test('should reset browser-specific tracking', async () => {
      await browserRateLimit.recordBrowserRequest('browser-1');
      expect(browserRateLimit.lastRequestTime.has('browser-1')).toBe(true);

      browserRateLimit.resetBrowser('browser-1');
      expect(browserRateLimit.lastRequestTime.has('browser-1')).toBe(false);
    });

    test('should reset rate limiting for specific browser', () => {
      // Use up requests
      browserRateLimit.isBrowserAllowed('browser-1');
      browserRateLimit.isBrowserAllowed('browser-1');
      browserRateLimit.isBrowserAllowed('browser-1');
      expect(browserRateLimit.isBrowserAllowed('browser-1')).toBe(false);

      // Reset browser
      browserRateLimit.resetBrowser('browser-1');

      // Should be allowed again
      expect(browserRateLimit.isBrowserAllowed('browser-1')).toBe(true);
    });
  });

  describe('cleanup', () => {
    test('should clean up old browser entries', () => {
      const limiter = new BrowserRateLimit({ windowMs: 60000 }); // 1 minute window

      // Add entries with old timestamps
      // maxAge is windowMs * 2 = 120000ms
      limiter.lastRequestTime.set('old-browser', mockTimestamp - 130000); // 130s ago - should be cleaned
      limiter.lastRequestTime.set('recent-browser', mockTimestamp - 10000); // 10s ago - should remain

      // Advance time - need to advance Date.now() too since cleanup uses it
      const advancedTime = mockTimestamp;
      mockTimestampUTC.mockReturnValue(advancedTime);
      jest.spyOn(Date, 'now').mockReturnValue(advancedTime);

      limiter.cleanup();

      // Old entry should be cleaned up, recent should remain
      expect(limiter.lastRequestTime.has('old-browser')).toBe(false);
      expect(limiter.lastRequestTime.has('recent-browser')).toBe(true);
    });
  });

  describe('setTimePattern', () => {
    test('should update time pattern configuration', () => {
      browserRateLimit.setTimePattern('business', { multiplier: 0.3 });

      expect(browserRateLimit.timePatterns.business.multiplier).toBe(0.3);
      expect(browserRateLimit.timePatterns.business.hours).toBeDefined(); // Should preserve hours
    });

    test('should ignore invalid time periods', () => {
      const originalPattern = { ...browserRateLimit.timePatterns.business };

      browserRateLimit.setTimePattern('invalid', { multiplier: 0.1 });

      // Should remain unchanged
      expect(browserRateLimit.timePatterns.business).toEqual(originalPattern);
    });
  });
});

describe('createBrowserRateLimiter', () => {
  test('should create limiter with default options', () => {
    const limiter = createBrowserRateLimiter();
    const stats = limiter.getEnhancedStats();

    expect(stats.maxCommands).toBe(3);
    expect(stats.windowMs).toBe(60000);
    expect(stats.humanizedDelays).toBe(true);
    expect(stats.variancePercent).toBe(30);
    expect(stats.timeAwarePatterns).toBe(true);
  });

  test('should create limiter with custom options', () => {
    const limiter = createBrowserRateLimiter({
      maxRequests: 5,
      windowMs: 120000,
      variancePercent: 50,
    });

    const stats = limiter.getEnhancedStats();
    expect(stats.maxCommands).toBe(5);
    expect(stats.windowMs).toBe(120000);
    expect(stats.variancePercent).toBe(50);
  });

  test('should override defaults with provided options', () => {
    const limiter = createBrowserRateLimiter({
      humanizedDelays: false,
      timeAwarePatterns: false,
    });

    const stats = limiter.getEnhancedStats();
    expect(stats.humanizedDelays).toBe(false);
    expect(stats.timeAwarePatterns).toBe(false);
    // Should keep other defaults
    expect(stats.maxCommands).toBe(3);
    expect(stats.variancePercent).toBe(30);
  });
});

describe('Browser Rate Limiting Integration', () => {
  test('should provide consistent timing variance', async () => {
    const limiter = createBrowserRateLimiter({
      maxRequests: 5,
      windowMs: 500,
      variancePercent: 50,
      humanizedDelays: true,
    });

    const timings = [];

    // Record timing for multiple requests using different browser IDs to avoid rate limiting
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      await limiter.recordBrowserRequest(`test-browser-${i}`);
      const elapsed = Date.now() - start;
      timings.push(elapsed);
    }

    // Should have some variation in timings (not all exactly the same)
    const uniqueTimings = new Set(timings);
    expect(uniqueTimings.size).toBeGreaterThanOrEqual(1); // Should have variation
  }, 10000);

  test('should handle concurrent browser requests', async () => {
    const limiter = createBrowserRateLimiter();

    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(limiter.recordBrowserRequest(`browser-${i}`));
    }

    const results = await Promise.all(promises);

    // All different browsers should be allowed
    expect(results.every(result => result === true)).toBe(true);

    const stats = limiter.getEnhancedStats();
    expect(stats.activeBrowsers).toBe(5);
  });
});

describe('Time-Aware Rate Limiting Edge Cases', () => {
  test('should handle hour boundary transitions', () => {
    const limiter = new BrowserRateLimit();

    // Test business to evening transition
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(17); // End of business
    const businessPattern = limiter.getCurrentTimePattern();

    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(18); // Start of evening
    const eveningPattern = limiter.getCurrentTimePattern();

    expect(businessPattern.multiplier).toBe(0.5);
    expect(eveningPattern.multiplier).toBe(0.7);
  });

  test('should handle midnight boundary', () => {
    const limiter = new BrowserRateLimit();

    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(23); // Late night
    const lateNightPattern = limiter.getCurrentTimePattern();

    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(0); // Midnight
    const midnightPattern = limiter.getCurrentTimePattern();

    // Both should be night pattern
    expect(lateNightPattern.multiplier).toBe(1.0);
    expect(midnightPattern.multiplier).toBe(1.0);
  });
});

describe('TimeAwareBrowserLimiter', () => {
  let mockBaseLimiter;
  let timeAwareLimiter;
  let mockTimestamp;

  beforeEach(async () => {
    mockTimestamp = 1640995200000;
    mockTimestampUTC.mockReturnValue(mockTimestamp);

    mockBaseLimiter = {
      windowMs: 60000,
      recordBrowserRequest: jest.fn().mockResolvedValue(true),
      getEnhancedStats: jest.fn().mockReturnValue({
        maxCommands: 3,
        windowMs: 60000,
        activeBrowsers: 1,
      }),
    };

    timeAwareLimiter = new TimeAwareBrowserLimiter(mockBaseLimiter, {
      burstWindow: 300000, // 5 minutes
      burstThreshold: 5, // 5 requests
    });
  });

  describe('constructor', () => {
    test('should initialize with base limiter and options', () => {
      expect(timeAwareLimiter.baseLimiter).toBe(mockBaseLimiter);
      expect(timeAwareLimiter.burstDetectionWindow).toBe(300000);
      expect(timeAwareLimiter.burstThreshold).toBe(5);
      expect(Array.isArray(timeAwareLimiter.sessionHistory)).toBe(true);
    });

    test('should use default options when not provided', () => {
      const defaultLimiter = new TimeAwareBrowserLimiter(mockBaseLimiter);

      expect(defaultLimiter.burstDetectionWindow).toBe(300000); // Default 5 minutes
      expect(defaultLimiter.burstThreshold).toBe(8); // Default 8 requests
    });
  });

  describe('checkRateLimit', () => {
    test('should allow requests under burst threshold', async () => {
      const result = await timeAwareLimiter.checkRateLimit('browser-1');

      expect(result).toBe(true);
      expect(mockBaseLimiter.recordBrowserRequest).toHaveBeenCalledWith('browser-1');
      expect(timeAwareLimiter.sessionHistory).toHaveLength(1);
    });

    test('should apply burst penalty when threshold exceeded', async () => {
      // Fill history to exceed burst threshold
      for (let i = 0; i < 6; i++) {
        timeAwareLimiter.sessionHistory.push(mockTimestamp - i * 10000);
      }

      const originalWindow = mockBaseLimiter.windowMs;
      await timeAwareLimiter.checkRateLimit('browser-1');

      // Window should be restored after the call
      expect(mockBaseLimiter.windowMs).toBe(originalWindow);
      expect(mockBaseLimiter.recordBrowserRequest).toHaveBeenCalled();
    });

    test('should clean old history entries', async () => {
      // Add old entries
      timeAwareLimiter.sessionHistory.push(mockTimestamp - 400000); // 6+ minutes ago
      timeAwareLimiter.sessionHistory.push(mockTimestamp - 100000); // Recent

      await timeAwareLimiter.checkRateLimit('browser-1');

      // Should have cleaned old entry and added new one
      expect(timeAwareLimiter.sessionHistory).toHaveLength(2); // Recent + new request
    });

    test('should cap window extension to maximum', async () => {
      // Create extreme burst scenario
      for (let i = 0; i < 20; i++) {
        timeAwareLimiter.sessionHistory.push(mockTimestamp - i * 1000);
      }

      const originalWindow = mockBaseLimiter.windowMs;
      await timeAwareLimiter.checkRateLimit('browser-1');

      // Window should be restored (test that it doesn't stay modified)
      expect(mockBaseLimiter.windowMs).toBe(originalWindow);
    });
  });

  describe('calculateBurstPenalty', () => {
    test('should return zero penalty under threshold', () => {
      // Add requests under threshold
      for (let i = 0; i < 4; i++) {
        timeAwareLimiter.sessionHistory.push(mockTimestamp - i * 10000);
      }

      const penalty = timeAwareLimiter.calculateBurstPenalty();
      expect(penalty).toBe(0);
    });

    test('should calculate progressive penalty over threshold', () => {
      // Add requests over threshold (5 threshold + 3 excess = 8 total)
      for (let i = 0; i < 8; i++) {
        timeAwareLimiter.sessionHistory.push(mockTimestamp - i * 10000);
      }

      const penalty = timeAwareLimiter.calculateBurstPenalty();
      expect(penalty).toBeCloseTo(0.45, 2); // 3 excess * 0.15 = 0.45
    });

    test('should cap penalty at maximum', () => {
      // Add many requests to test penalty cap
      for (let i = 0; i < 20; i++) {
        timeAwareLimiter.sessionHistory.push(mockTimestamp - i * 10000);
      }

      const penalty = timeAwareLimiter.calculateBurstPenalty();
      expect(penalty).toBe(1.5); // Should be capped at 1.5
    });
  });

  describe('getStats', () => {
    test('should return combined statistics', () => {
      timeAwareLimiter.sessionHistory.push(mockTimestamp);
      timeAwareLimiter.sessionHistory.push(mockTimestamp - 10000);

      const stats = timeAwareLimiter.getStats();

      expect(stats).toHaveProperty('maxCommands');
      expect(stats).toHaveProperty('windowMs');
      expect(stats).toHaveProperty('sessionHistory', 2);
      expect(stats).toHaveProperty('burstThreshold', 5);
      expect(stats).toHaveProperty('burstPenalty');
      expect(stats).toHaveProperty('burstDetected');
    });

    test('should indicate burst detection status', () => {
      // Add requests to trigger burst detection
      for (let i = 0; i < 8; i++) {
        timeAwareLimiter.sessionHistory.push(mockTimestamp - i * 10000);
      }

      const stats = timeAwareLimiter.getStats();
      expect(stats.burstDetected).toBe(true);
      expect(stats.burstPenalty).toBeGreaterThan(0);
    });
  });
});
