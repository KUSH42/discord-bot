import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RateLimiter, RateLimitError } from '../../../src/services/implementations/message-sender/rate-limiter.js';

describe('RateLimitError', () => {
  it('should create error with default values', () => {
    const error = new RateLimitError('Test message');

    expect(error.message).toBe('Test message');
    expect(error.name).toBe('RateLimitError');
    expect(error.retryAfter).toBe(1000);
    expect(error.type).toBe('proactive');
    expect(error.isRateLimitError).toBe(true);
  });

  it('should create error with custom values', () => {
    const error = new RateLimitError('Rate limited', 5000, 'reactive');

    expect(error.message).toBe('Rate limited');
    expect(error.retryAfter).toBe(5000);
    expect(error.type).toBe('reactive');
    expect(error.isRateLimitError).toBe(true);
  });
});

describe('RateLimiter', () => {
  let rateLimiter;
  let mockTimeSource;
  let currentTime;

  beforeEach(() => {
    currentTime = 1000000; // Start at a fixed time
    mockTimeSource = jest.fn(() => currentTime);

    rateLimiter = new RateLimiter({
      burstAllowance: 3,
      burstResetTime: 60000, // 1 minute
      baseSendDelay: 1000,
      timeSource: mockTimeSource,
    });
  });

  describe('Constructor', () => {
    it('should initialize with default options', () => {
      const limiter = new RateLimiter();

      expect(limiter.burstAllowance).toBe(30);
      expect(limiter.burstResetTime).toBe(60000);
      expect(limiter.baseSendDelay).toBe(1000);
      expect(limiter.burstCounter).toBe(0);
      expect(limiter.isPaused).toBe(false);
    });

    it('should initialize with custom options', () => {
      const limiter = new RateLimiter({
        burstAllowance: 10,
        burstResetTime: 120000,
        baseSendDelay: 2000,
      });

      expect(limiter.burstAllowance).toBe(10);
      expect(limiter.burstResetTime).toBe(120000);
      expect(limiter.baseSendDelay).toBe(2000);
    });

    it('should initialize metrics', () => {
      expect(rateLimiter.metrics).toEqual({
        burstLimitsHit: 0,
        rateLimitHits: 0,
        totalDelaysApplied: 0,
        averageDelay: 0,
        maxDelay: 0,
        lastRateLimitHit: null,
      });
    });
  });

  describe('checkRateLimit', () => {
    it('should allow sending when under burst limit', async () => {
      await expect(rateLimiter.checkRateLimit()).resolves.toBeUndefined();
      expect(rateLimiter.burstCounter).toBe(1);

      await expect(rateLimiter.checkRateLimit()).resolves.toBeUndefined();
      expect(rateLimiter.burstCounter).toBe(2);

      await expect(rateLimiter.checkRateLimit()).resolves.toBeUndefined();
      expect(rateLimiter.burstCounter).toBe(3);
    });

    it('should throw when burst limit exceeded', async () => {
      // Use up the burst allowance
      await rateLimiter.checkRateLimit(); // 1
      await rateLimiter.checkRateLimit(); // 2
      await rateLimiter.checkRateLimit(); // 3

      await expect(rateLimiter.checkRateLimit()).rejects.toThrow(RateLimitError);
      expect(rateLimiter.metrics.burstLimitsHit).toBe(1);
    });

    it('should reset burst counter after reset time', async () => {
      // Use up burst allowance
      await rateLimiter.checkRateLimit(); // 1
      await rateLimiter.checkRateLimit(); // 2
      await rateLimiter.checkRateLimit(); // 3

      // Advance time past burst reset time
      currentTime += 61000; // 61 seconds

      // Should reset and allow sending again
      await expect(rateLimiter.checkRateLimit()).resolves.toBeUndefined();
      expect(rateLimiter.burstCounter).toBe(1);
    });

    it('should enforce pause state from rate limit responses', async () => {
      // Set a pause state
      rateLimiter.setPause(5000, 'Test pause');

      await expect(rateLimiter.checkRateLimit()).rejects.toThrow(RateLimitError);

      // Test the specific error properties
      await expect(rateLimiter.checkRateLimit()).rejects.toMatchObject({
        type: 'reactive',
        retryAfter: 5000,
        message: expect.stringContaining('Test pause'),
      });
    });

    it('should clear pause when time expires', async () => {
      // Set a pause state
      rateLimiter.setPause(5000, 'Test pause');

      // Advance time past pause duration
      currentTime += 6000;

      // Should clear pause and allow sending
      await expect(rateLimiter.checkRateLimit()).resolves.toBeUndefined();
      expect(rateLimiter.isPaused).toBe(false);
    });
  });

  describe('handleRateLimit', () => {
    it('should handle error with retryAfter property', () => {
      const error = { retryAfter: 5 }; // 5 seconds

      rateLimiter.handleRateLimit(error);

      expect(rateLimiter.isPaused).toBe(true);
      expect(rateLimiter.pauseUntil).toBe(currentTime + 5500); // 5000ms + 500ms buffer
      expect(rateLimiter.metrics.rateLimitHits).toBe(1);
    });

    it('should handle error with retry_after property', () => {
      const error = { retry_after: 3 }; // 3 seconds

      rateLimiter.handleRateLimit(error);

      expect(rateLimiter.isPaused).toBe(true);
      expect(rateLimiter.pauseUntil).toBe(currentTime + 3500); // 3000ms + 500ms buffer
    });

    it('should handle headers with retry-after', () => {
      const error = {};
      const headers = { 'retry-after': '10' };

      rateLimiter.handleRateLimit(error, headers);

      expect(rateLimiter.isPaused).toBe(true);
      expect(rateLimiter.pauseUntil).toBe(currentTime + 10500); // 10000ms + 500ms buffer
    });

    it('should handle headers with x-ratelimit-reset-after', () => {
      const error = {};
      const headers = { 'x-ratelimit-reset-after': '2.5' };

      rateLimiter.handleRateLimit(error, headers);

      expect(rateLimiter.isPaused).toBe(true);
      expect(rateLimiter.pauseUntil).toBe(currentTime + 3000); // 2500ms + 500ms buffer
    });

    it('should use default retry time when no timing info available', () => {
      const error = {};

      rateLimiter.handleRateLimit(error);

      expect(rateLimiter.isPaused).toBe(true);
      expect(rateLimiter.pauseUntil).toBe(currentTime + 1500); // 1000ms + 500ms buffer
    });

    it('should update metrics', () => {
      const error = { retryAfter: 2 };

      rateLimiter.handleRateLimit(error);

      expect(rateLimiter.metrics.rateLimitHits).toBe(1);
      expect(rateLimiter.metrics.lastRateLimitHit).toBe(currentTime);
      expect(rateLimiter.metrics.totalDelaysApplied).toBe(1);
      expect(rateLimiter.metrics.maxDelay).toBe(2500);
      expect(rateLimiter.metrics.averageDelay).toBe(2500);
    });
  });

  describe('setPause and clearPause', () => {
    it('should set pause state correctly', () => {
      rateLimiter.setPause(3000, 'Test reason');

      expect(rateLimiter.isPaused).toBe(true);
      expect(rateLimiter.pauseUntil).toBe(currentTime + 3000);
      expect(rateLimiter.pauseReason).toBe('Test reason');
    });

    it('should clear pause state correctly', () => {
      rateLimiter.setPause(3000, 'Test reason');
      rateLimiter.clearPause();

      expect(rateLimiter.isPaused).toBe(false);
      expect(rateLimiter.pauseUntil).toBeNull();
      expect(rateLimiter.pauseReason).toBeNull();
    });
  });

  describe('resetBurstCounter', () => {
    it('should reset burst counter and timestamp', () => {
      rateLimiter.burstCounter = 5;
      const oldTime = rateLimiter.lastBurstReset;

      currentTime += 1000;
      rateLimiter.resetBurstCounter();

      expect(rateLimiter.burstCounter).toBe(0);
      expect(rateLimiter.lastBurstReset).toBe(currentTime);
      expect(rateLimiter.lastBurstReset).not.toBe(oldTime);
    });
  });

  describe('updateDelayMetrics', () => {
    it('should update delay metrics correctly', () => {
      rateLimiter.updateDelayMetrics(1000);

      expect(rateLimiter.metrics.totalDelaysApplied).toBe(1);
      expect(rateLimiter.metrics.maxDelay).toBe(1000);
      expect(rateLimiter.metrics.averageDelay).toBe(1000);
    });

    it('should calculate running average correctly', () => {
      rateLimiter.updateDelayMetrics(1000);
      rateLimiter.updateDelayMetrics(2000);
      rateLimiter.updateDelayMetrics(3000);

      expect(rateLimiter.metrics.totalDelaysApplied).toBe(3);
      expect(rateLimiter.metrics.maxDelay).toBe(3000);
      expect(rateLimiter.metrics.averageDelay).toBe(2000); // (1000 + 2000 + 3000) / 3
    });
  });

  describe('getStatus', () => {
    it('should return status when not paused', () => {
      const status = rateLimiter.getStatus();

      expect(status).toEqual({
        isPaused: false,
        pauseReason: null,
        pauseRemainingMs: 0,
        burstCounter: 0,
        burstAllowance: 3,
        burstRemainingMs: 60000, // Full burst reset time remaining
        canSendImmediately: true,
      });
    });

    it('should return status when paused', () => {
      rateLimiter.setPause(5000, 'Rate limited');
      currentTime += 2000; // 2 seconds later

      const status = rateLimiter.getStatus();

      expect(status).toEqual({
        isPaused: true,
        pauseReason: 'Rate limited',
        pauseRemainingMs: 3000, // 5000 - 2000
        burstCounter: 0,
        burstAllowance: 3,
        burstRemainingMs: 58000, // 60000 - 2000
        canSendImmediately: false,
      });
    });

    it('should return status when burst limit reached', async () => {
      // Use up burst allowance
      await rateLimiter.checkRateLimit(); // 1
      await rateLimiter.checkRateLimit(); // 2
      await rateLimiter.checkRateLimit(); // 3

      const status = rateLimiter.getStatus();

      expect(status.burstCounter).toBe(3);
      expect(status.canSendImmediately).toBe(false);
    });
  });

  describe('getMetrics', () => {
    it('should return comprehensive metrics', () => {
      rateLimiter.updateDelayMetrics(1500);

      const metrics = rateLimiter.getMetrics();

      expect(metrics).toHaveProperty('burstLimitsHit');
      expect(metrics).toHaveProperty('rateLimitHits');
      expect(metrics).toHaveProperty('totalDelaysApplied');
      expect(metrics).toHaveProperty('averageDelay');
      expect(metrics).toHaveProperty('maxDelay');
      expect(metrics).toHaveProperty('lastRateLimitHit');
      expect(metrics).toHaveProperty('currentStatus');
      expect(metrics.totalDelaysApplied).toBe(1);
      expect(metrics.averageDelay).toBe(1500);
    });
  });

  describe('reset', () => {
    it('should reset all state and metrics', async () => {
      // Set up some state
      await rateLimiter.checkRateLimit();
      rateLimiter.setPause(1000, 'Test');
      rateLimiter.updateDelayMetrics(2000);

      rateLimiter.reset();

      expect(rateLimiter.burstCounter).toBe(0);
      expect(rateLimiter.isPaused).toBe(false);
      expect(rateLimiter.pauseUntil).toBeNull();
      expect(rateLimiter.metrics).toEqual({
        burstLimitsHit: 0,
        rateLimitHits: 0,
        totalDelaysApplied: 0,
        averageDelay: 0,
        maxDelay: 0,
        lastRateLimitHit: null,
      });
    });
  });

  describe('static isRateLimitError', () => {
    it('should identify Discord 429 errors by code', () => {
      const error = { code: 429 };
      expect(RateLimiter.isRateLimitError(error)).toBe(true);
    });

    it('should identify Discord 429 errors by status', () => {
      const error = { status: 429 };
      expect(RateLimiter.isRateLimitError(error)).toBe(true);
    });

    it('should identify custom rate limit errors', () => {
      const error = { isRateLimitError: true };
      expect(RateLimiter.isRateLimitError(error)).toBe(true);
    });

    it('should not identify non-rate-limit errors', () => {
      const error = { code: 500 };
      expect(RateLimiter.isRateLimitError(error)).toBe(false);
    });
  });

  describe('forceRateLimit', () => {
    it('should force rate limit state for testing', () => {
      rateLimiter.forceRateLimit(3000, 'Testing');

      expect(rateLimiter.isPaused).toBe(true);
      expect(rateLimiter.pauseUntil).toBe(currentTime + 3000);
      expect(rateLimiter.pauseReason).toBe('Testing');
      expect(rateLimiter.metrics.rateLimitHits).toBe(1);
    });

    it('should use default values when not specified', () => {
      rateLimiter.forceRateLimit();

      expect(rateLimiter.isPaused).toBe(true);
      expect(rateLimiter.pauseUntil).toBe(currentTime + 1000);
      expect(rateLimiter.pauseReason).toBe('Forced for testing');
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle burst limit reset during pause', async () => {
      // Use up burst allowance
      await rateLimiter.checkRateLimit(); // 1
      await rateLimiter.checkRateLimit(); // 2
      await rateLimiter.checkRateLimit(); // 3

      // Set a pause
      rateLimiter.setPause(5000, 'Test pause');

      // Advance time past burst reset AND past pause
      currentTime += 61000; // 61 seconds (past both pause and burst reset)

      // Should no longer be paused and burst should be reset
      await expect(rateLimiter.checkRateLimit()).resolves.toBeUndefined();
      expect(rateLimiter.burstCounter).toBe(1); // Reset and then incremented by checkRateLimit
      expect(rateLimiter.isPaused).toBe(false); // Pause cleared
    });

    it('should handle multiple rate limit responses', () => {
      const error1 = { retryAfter: 2 };
      const error2 = { retryAfter: 5 };

      rateLimiter.handleRateLimit(error1);
      const firstPause = rateLimiter.pauseUntil;

      currentTime += 1000;
      rateLimiter.handleRateLimit(error2);
      const secondPause = rateLimiter.pauseUntil;

      expect(rateLimiter.metrics.rateLimitHits).toBe(2);
      expect(secondPause).toBeGreaterThan(firstPause);
    });
  });
});
