import { jest } from '@jest/globals';
import { IntelligentRateLimiter } from '../../../src/utilities/intelligent-rate-limiter.js';
import { timestampUTC } from '../../../src/utilities/utc-time.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('IntelligentRateLimiter', () => {
  let rateLimiter;
  // Note: originalNow was for legacy Date.now() mocking, now using jest.setSystemTime()

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock Date for consistent testing
    jest.setSystemTime(new Date('2022-01-01T12:00:00Z')); // Saturday, noon

    rateLimiter = new IntelligentRateLimiter({}, mockLogger);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    test('should initialize with default configuration', () => {
      expect(rateLimiter.config.enabled).toBe(true);
      expect(rateLimiter.config.patterns.human_active.base).toBe(60000);
      expect(rateLimiter.config.patterns.human_idle.base).toBe(120000);
      expect(rateLimiter.config.minInterval).toBe(30000);
      expect(rateLimiter.config.maxInterval).toBe(600000);
    });

    test('should respect custom configuration', () => {
      const customConfig = {
        humanActiveBase: 90000,
        humanIdleBase: 180000,
        minInterval: 45000,
        burstDetectionEnabled: false,
      };

      const customLimiter = new IntelligentRateLimiter(customConfig, mockLogger);

      expect(customLimiter.config.patterns.human_active.base).toBe(90000);
      expect(customLimiter.config.patterns.human_idle.base).toBe(180000);
      expect(customLimiter.config.minInterval).toBe(45000);
      expect(customLimiter.config.burstDetection.enabled).toBe(false);
    });

    test('should initialize statistics', () => {
      const stats = rateLimiter.getStatistics();
      expect(stats.totalRequests).toBe(0);
      expect(stats.burstDetections).toBe(0);
      expect(stats.averageInterval).toBe(0);
    });
  });

  describe('Context Analysis', () => {
    test('should detect business hours correctly', () => {
      // Set to Tuesday 2:00 PM (14:00) local time
      jest.setSystemTime(new Date(2022, 0, 4, 14, 0, 0));

      const context = rateLimiter.analyzeCurrentContext();

      expect(context.isBusinessHours).toBe(true);
      expect(context.isWeekend).toBe(false);
      expect(context.isNightTime).toBe(false);
      expect(context.currentHour).toBe(14);
    });

    test('should detect weekend correctly', () => {
      // Set to Saturday 10:00 AM local time
      jest.setSystemTime(new Date(2022, 0, 1, 10, 0, 0));

      const context = rateLimiter.analyzeCurrentContext();

      expect(context.isWeekend).toBe(true);
      expect(context.isBusinessHours).toBe(false);
      expect(context.currentDay).toBe(6); // Saturday
    });

    test('should detect night time correctly', () => {
      // Set to 2:00 AM local time
      jest.setSystemTime(new Date(2022, 0, 4, 2, 0, 0));

      const context = rateLimiter.analyzeCurrentContext();

      expect(context.isNightTime).toBe(true);
      expect(context.isBusinessHours).toBe(false);
      expect(context.currentHour).toBe(2);
    });

    test('should detect active session correctly', () => {
      // Add recent requests to make session active
      const now = timestampUTC();
      rateLimiter.sessionHistory = [
        now - 300000, // 5 minutes ago
        now - 240000, // 4 minutes ago
        now - 180000, // 3 minutes ago
        now - 120000, // 2 minutes ago
      ];

      expect(rateLimiter.isActiveSession()).toBe(true);
    });
  });

  describe('Pattern Selection', () => {
    test('should select night mode pattern during night hours', () => {
      // Set to 3:00 AM local time
      jest.setSystemTime(new Date(2022, 0, 4, 3, 0, 0));

      const context = rateLimiter.analyzeCurrentContext();
      const pattern = rateLimiter.selectPattern(context);

      expect(pattern.name).toBe('night_mode');
      expect(pattern.pattern.base).toBe(300000); // 5 minutes
    });

    test('should select weekend pattern during weekends', () => {
      // Set to Sunday 10:00 AM local time
      jest.setSystemTime(new Date(2022, 0, 2, 10, 0, 0));

      const context = rateLimiter.analyzeCurrentContext();
      const pattern = rateLimiter.selectPattern(context);

      expect(pattern.name).toBe('weekend');
      expect(pattern.pattern.base).toBe(180000); // 3 minutes
    });

    test('should select active pattern for active sessions', () => {
      // Set to weekday (Tuesday) during business hours
      jest.setSystemTime(new Date(2022, 0, 4, 14, 0, 0));

      // Make session active with recent requests
      const now = timestampUTC();
      rateLimiter.sessionHistory = [now - 300000, now - 240000, now - 180000, now - 120000];

      const context = rateLimiter.analyzeCurrentContext();
      const pattern = rateLimiter.selectPattern(context);

      expect(pattern.name).toBe('human_active');
      expect(pattern.pattern.base).toBe(60000); // 1 minute
    });

    test('should select idle pattern by default', () => {
      // Regular Tuesday afternoon, no active session
      jest.setSystemTime(new Date(2022, 0, 4, 14, 0, 0));

      const context = rateLimiter.analyzeCurrentContext();
      const pattern = rateLimiter.selectPattern(context);

      expect(pattern.name).toBe('human_idle');
      expect(pattern.pattern.base).toBe(120000); // 2 minutes
    });
  });

  describe('Interval Calculation', () => {
    test('should calculate interval within expected range', () => {
      const interval = rateLimiter.calculateNextInterval();

      expect(interval).toBeGreaterThanOrEqual(rateLimiter.config.minInterval);
      expect(interval).toBeLessThanOrEqual(rateLimiter.config.maxInterval);
      expect(typeof interval).toBe('number');
    });

    test('should apply variance to base interval', () => {
      const intervals = [];

      // Calculate multiple intervals to test variance
      for (let i = 0; i < 20; i++) {
        intervals.push(rateLimiter.calculateNextInterval());
      }

      // Should have some variety (not all the same)
      const uniqueIntervals = new Set(intervals);
      expect(uniqueIntervals.size).toBeGreaterThan(5);
    });

    test('should respect minimum and maximum constraints', () => {
      // Create limiter with extreme variance
      const extremeLimiter = new IntelligentRateLimiter(
        {
          humanActiveBase: 10000, // Very low base
          humanActiveVariance: 50000, // High variance
          minInterval: 30000,
          maxInterval: 120000,
        },
        mockLogger
      );

      for (let i = 0; i < 10; i++) {
        const interval = extremeLimiter.calculateNextInterval();
        expect(interval).toBeGreaterThanOrEqual(30000);
        expect(interval).toBeLessThanOrEqual(120000);
      }
    });

    test('should return 0 when disabled', () => {
      const disabledLimiter = new IntelligentRateLimiter({ enabled: false }, mockLogger);

      const interval = disabledLimiter.calculateNextInterval();
      expect(interval).toBe(0);
    });
  });

  describe('Burst Detection', () => {
    test('should detect burst activity', () => {
      const now = timestampUTC();

      // Add many recent requests to trigger burst detection
      rateLimiter.sessionHistory = Array.from(
        { length: 10 },
        (_, i) => now - i * 10000 // Every 10 seconds
      );

      const penalty = rateLimiter.calculateBurstPenalty();

      expect(penalty).toBeGreaterThan(0);
      expect(rateLimiter.stats.burstDetections).toBe(1);
    });

    test('should not apply penalty for normal activity', () => {
      const now = timestampUTC();

      // Add normal amount of requests
      rateLimiter.sessionHistory = [
        now - 300000, // 5 minutes ago
        now - 240000, // 4 minutes ago
        now - 180000, // 3 minutes ago
      ];

      const penalty = rateLimiter.calculateBurstPenalty();

      expect(penalty).toBe(0);
      expect(rateLimiter.stats.burstDetections).toBe(0);
    });

    test('should cap penalty at maximum value', () => {
      const now = timestampUTC();

      // Add excessive requests
      rateLimiter.sessionHistory = Array.from(
        { length: 50 },
        (_, i) => now - i * 5000 // Every 5 seconds
      );

      const penalty = rateLimiter.calculateBurstPenalty();

      expect(penalty).toBeLessThanOrEqual(rateLimiter.config.burstDetection.maxPenalty);
    });

    test('should not detect bursts when disabled', () => {
      const noBurstLimiter = new IntelligentRateLimiter(
        {
          burstDetectionEnabled: false,
        },
        mockLogger
      );

      const now = timestampUTC();
      noBurstLimiter.sessionHistory = Array.from({ length: 20 }, (_, i) => now - i * 5000);

      const penalty = noBurstLimiter.calculateBurstPenalty();
      expect(penalty).toBe(0);
    });
  });

  describe('Request Recording', () => {
    test('should record requests correctly', () => {
      rateLimiter.recordRequest({ test: 'metadata' });

      expect(rateLimiter.sessionHistory).toHaveLength(1);
      expect(rateLimiter.stats.totalRequests).toBe(1);
      expect(rateLimiter.lastRequestTime).toBeGreaterThan(0);
    });

    test('should limit session history size', () => {
      // Add more than 50 requests
      for (let i = 0; i < 60; i++) {
        rateLimiter.recordRequest();
      }

      expect(rateLimiter.sessionHistory.length).toBeLessThanOrEqual(50);
      expect(rateLimiter.stats.totalRequests).toBe(60);
    });

    test('should clean old history', () => {
      const oldTimestamp = timestampUTC() - 25 * 60 * 60 * 1000; // 25 hours ago
      const recentTimestamp = timestampUTC() - 1 * 60 * 60 * 1000; // 1 hour ago

      rateLimiter.sessionHistory = [oldTimestamp, recentTimestamp];
      rateLimiter.recordRequest();

      // Old timestamp should be removed
      expect(rateLimiter.sessionHistory).not.toContain(oldTimestamp);
      expect(rateLimiter.sessionHistory).toContain(recentTimestamp);
    });
  });

  describe('waitForNextRequest', () => {
    test('should wait for calculated interval', async () => {
      const waitPromise = rateLimiter.waitForNextRequest();

      // Should not resolve immediately
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      // Advance timers
      jest.runAllTimers();

      await waitPromise;

      expect(rateLimiter.stats.totalRequests).toBe(1);
    });

    test('should skip wait when disabled', async () => {
      const disabledLimiter = new IntelligentRateLimiter({ enabled: false }, mockLogger);

      const startTime = Date.now();
      await disabledLimiter.waitForNextRequest();
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(10); // Should be immediate
      expect(disabledLimiter.stats.totalRequests).toBe(1);
    });

    test('should skip wait when requested', async () => {
      const startTime = Date.now();
      await rateLimiter.waitForNextRequest({ skipWait: true });
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(10); // Should be immediate
      expect(rateLimiter.stats.totalRequests).toBe(1);
    });

    test('should include metadata when recording', async () => {
      const metadata = { operation: 'test', url: 'https://example.com' };

      const waitPromise = rateLimiter.waitForNextRequest({ metadata });
      jest.runAllTimers();
      await waitPromise;

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Request recorded',
        expect.objectContaining({
          metadata,
        })
      );
    });
  });

  describe('Statistics', () => {
    test('should provide comprehensive statistics', () => {
      // Generate some activity
      rateLimiter.recordRequest();
      rateLimiter.recordRequest();
      rateLimiter.calculateNextInterval(); // Trigger pattern usage

      const stats = rateLimiter.getStatistics();

      expect(stats).toHaveProperty('enabled');
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('sessionDurationMs');
      expect(stats).toHaveProperty('sessionDurationHours');
      expect(stats).toHaveProperty('timingVariancePercent');
      expect(stats).toHaveProperty('burstDetectionRate');

      expect(stats.totalRequests).toBe(2);
      expect(stats.enabled).toBe(true);
    });

    test('should calculate timing variance correctly', () => {
      const intervals = [1000, 2000, 1500, 1800, 1200];
      const variance = rateLimiter.calculateVarianceCoefficient(intervals);

      expect(variance).toBeGreaterThan(0);
      expect(variance).toBeLessThan(1);
    });

    test('should handle empty intervals for variance calculation', () => {
      const variance = rateLimiter.calculateVarianceCoefficient([]);
      expect(variance).toBe(0);
    });
  });

  describe('Pattern Forcing', () => {
    test('should force specific pattern', () => {
      rateLimiter.forcePattern('night_mode', 1800000);

      expect(rateLimiter.forcedPattern.name).toBe('night_mode');
      expect(rateLimiter.forcedPattern.pattern.base).toBe(300000);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Pattern forced',
        expect.objectContaining({
          pattern: 'night_mode',
          durationMs: 1800000,
        })
      );
    });

    test('should throw error for invalid pattern', () => {
      expect(() => {
        rateLimiter.forcePattern('invalid_pattern');
      }).toThrow('Invalid pattern name: invalid_pattern');
    });

    test('should clear forced pattern', () => {
      rateLimiter.forcePattern('weekend');
      rateLimiter.clearForcedPattern();

      expect(rateLimiter.forcedPattern).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Forced pattern cleared',
        expect.objectContaining({
          previousPattern: 'weekend',
        })
      );
    });
  });

  describe('Configuration Management', () => {
    test('should update configuration', () => {
      const newConfig = {
        patterns: {
          human_active: { base: 45000, variance: 30000, weight: 0.3 },
        },
        minInterval: 20000,
        burstDetection: { enabled: false },
      };

      rateLimiter.updateConfiguration(newConfig);

      expect(rateLimiter.config.patterns.human_active.base).toBe(45000);
      expect(rateLimiter.config.minInterval).toBe(20000);
      expect(rateLimiter.config.burstDetection.enabled).toBe(false);
    });

    test('should reset statistics', () => {
      // Generate some activity
      rateLimiter.recordRequest();
      rateLimiter.recordRequest();

      rateLimiter.resetStatistics();

      const stats = rateLimiter.getStatistics();
      expect(stats.totalRequests).toBe(0);
      expect(stats.burstDetections).toBe(0);
      expect(rateLimiter.sessionHistory).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    test('should handle rapid successive requests', async () => {
      const promises = [];

      // Make multiple rapid requests
      for (let i = 0; i < 5; i++) {
        promises.push(rateLimiter.waitForNextRequest({ skipWait: true }));
      }

      await Promise.all(promises);

      expect(rateLimiter.stats.totalRequests).toBe(5);
    });

    test('should handle missing logger gracefully', () => {
      const limiterWithoutLogger = new IntelligentRateLimiter({}, null);

      expect(() => {
        limiterWithoutLogger.calculateNextInterval();
        limiterWithoutLogger.recordRequest();
      }).not.toThrow();
    });

    test('should maintain consistency with concurrent operations', () => {
      // Simulate concurrent access
      rateLimiter.recordRequest({ op: 1 });
      const interval1 = rateLimiter.calculateNextInterval();
      rateLimiter.recordRequest({ op: 2 });
      const interval2 = rateLimiter.calculateNextInterval();

      expect(interval1).toBeGreaterThan(0);
      expect(interval2).toBeGreaterThan(0);
      expect(rateLimiter.stats.totalRequests).toBe(2);
    });
  });
});
