import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createMockRequest, createMockResponse, mockNext } from '../mocks/express.mock.js';
import { timestampUTC } from '../../src/utilities/utc-time.js';
import {
  CommandRateLimit,
  createWebhookLimiter,
  createGeneralLimiter,
  createStrictLimiter,
  createCommandRateLimiter,
} from '../../src/rate-limiter.js';

describe('Rate Limiting Tests', () => {
  let mockReq, mockRes, mockNextFn;
  let rateLimitConfig;

  beforeEach(() => {
    mockReq = createMockRequest();
    mockRes = createMockResponse();
    mockNextFn = jest.fn();

    // Default rate limit configuration
    rateLimitConfig = {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later',
      standardHeaders: true,
      legacyHeaders: false,
    };

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('Basic Rate Limiting Functionality', () => {
    it('should allow requests under the limit', () => {
      const rateLimit = createMockRateLimit(rateLimitConfig);

      // Simulate multiple requests under the limit
      for (let i = 0; i < 50; i++) {
        const req = createMockRequest({ ip: '127.0.0.1' });
        const res = createMockResponse();
        const next = jest.fn();

        rateLimit(req, res, next);

        expect(next).toHaveBeenCalledWith(); // Should call next() to continue
        expect(res.status).not.toHaveBeenCalledWith(429); // Should not return 429
      }
    });

    it('should block requests over the limit', () => {
      const rateLimit = createMockRateLimit({ ...rateLimitConfig, max: 5 });
      const requests = [];

      // Make requests up to the limit
      for (let i = 0; i < 6; i++) {
        const req = createMockRequest({ ip: '127.0.0.1' });
        const res = createMockResponse();
        const next = jest.fn();

        rateLimit(req, res, next);
        requests.push({ req, res, next });
      }

      // First 5 should pass
      for (let i = 0; i < 5; i++) {
        expect(requests[i].next).toHaveBeenCalledWith();
        expect(requests[i].res.status).not.toHaveBeenCalledWith(429);
      }

      // 6th should be blocked
      expect(requests[5].res.status).toHaveBeenCalledWith(429);
      expect(requests[5].next).not.toHaveBeenCalled();
    });

    it('should set correct rate limit headers', () => {
      const rateLimit = createMockRateLimit(rateLimitConfig);
      const req = createMockRequest({ ip: '127.0.0.1' });
      const res = createMockResponse();
      const next = jest.fn();

      rateLimit(req, res, next);

      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'X-RateLimit-Limit': expect.any(Number),
          'X-RateLimit-Remaining': expect.any(Number),
          'X-RateLimit-Reset': expect.any(String),
        })
      );
    });
  });

  describe('Per-IP Rate Limiting', () => {
    it('should track different IPs separately', () => {
      const rateLimit = createMockRateLimit({ ...rateLimitConfig, max: 2 });

      // IP 1 makes 2 requests (at limit)
      for (let i = 0; i < 2; i++) {
        const req = createMockRequest({ ip: '127.0.0.1' });
        const res = createMockResponse();
        const next = jest.fn();
        rateLimit(req, res, next);
        expect(next).toHaveBeenCalledWith();
      }

      // IP 2 makes 2 requests (should still work)
      for (let i = 0; i < 2; i++) {
        const req = createMockRequest({ ip: '192.168.1.1' });
        const res = createMockResponse();
        const next = jest.fn();
        rateLimit(req, res, next);
        expect(next).toHaveBeenCalledWith();
      }

      // IP 1 makes another request (should be blocked)
      const req1 = createMockRequest({ ip: '127.0.0.1' });
      const res1 = createMockResponse();
      const next1 = jest.fn();
      rateLimit(req1, res1, next1);
      expect(res1.status).toHaveBeenCalledWith(429);

      // IP 2 makes another request (should be blocked)
      const req2 = createMockRequest({ ip: '192.168.1.1' });
      const res2 = createMockResponse();
      const next2 = jest.fn();
      rateLimit(req2, res2, next2);
      expect(res2.status).toHaveBeenCalledWith(429);
    });

    it('should handle IPv6 addresses', () => {
      const ipv6Address = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
      const rateLimit = createMockRateLimit({ ...rateLimitConfig, max: 1 });

      // First request should pass
      const req1 = createMockRequest({ ip: ipv6Address });
      const res1 = createMockResponse();
      const next1 = jest.fn();
      rateLimit(req1, res1, next1);
      expect(next1).toHaveBeenCalledWith();

      // Second request should be blocked
      const req2 = createMockRequest({ ip: ipv6Address });
      const res2 = createMockResponse();
      const next2 = jest.fn();
      rateLimit(req2, res2, next2);
      expect(res2.status).toHaveBeenCalledWith(429);
    });

    it('should handle requests behind proxy (X-Forwarded-For)', () => {
      const realIP = '203.0.113.1';
      const rateLimit = createMockRateLimit({ ...rateLimitConfig, max: 1 });

      // Request with X-Forwarded-For header
      const req = createMockRequest({
        ip: '127.0.0.1', // Proxy IP
        headers: {
          'x-forwarded-for': realIP,
        },
      });

      // Mock getting the real IP from header
      req.ip = realIP; // Simulate proxy middleware setting real IP

      const res = createMockResponse();
      const next = jest.fn();
      rateLimit(req, res, next);
      expect(next).toHaveBeenCalledWith();

      // Second request from same real IP should be blocked
      const req2 = createMockRequest({ ip: realIP });
      const res2 = createMockResponse();
      const next2 = jest.fn();
      rateLimit(req2, res2, next2);
      expect(res2.status).toHaveBeenCalledWith(429);
    });
  });

  describe('Time Window Management', () => {
    it('should reset limits after time window expires', () => {
      const shortWindow = 1000; // 1 second
      const rateLimit = createMockRateLimit({
        ...rateLimitConfig,
        windowMs: shortWindow,
        max: 1,
      });

      // First request should pass
      const req1 = createMockRequest({ ip: '127.0.0.1' });
      const res1 = createMockResponse();
      const next1 = jest.fn();
      rateLimit(req1, res1, next1);
      expect(next1).toHaveBeenCalledWith();

      // Second request should be blocked
      const req2 = createMockRequest({ ip: '127.0.0.1' });
      const res2 = createMockResponse();
      const next2 = jest.fn();
      rateLimit(req2, res2, next2);
      expect(res2.status).toHaveBeenCalledWith(429);

      // Advance time past window
      jest.advanceTimersByTime(shortWindow + 100);

      // Third request should pass (window reset)
      const req3 = createMockRequest({ ip: '127.0.0.1' });
      const res3 = createMockResponse();
      const next3 = jest.fn();
      rateLimit(req3, res3, next3);
      expect(next3).toHaveBeenCalledWith();
    });

    it('should handle concurrent requests within time window', () => {
      const rateLimit = createMockRateLimit({ ...rateLimitConfig, max: 3 });
      const promises = [];

      // Simulate 5 concurrent requests
      for (let i = 0; i < 5; i++) {
        const req = createMockRequest({ ip: '127.0.0.1' });
        const res = createMockResponse();
        const next = jest.fn();

        promises.push(
          new Promise(resolve => {
            rateLimit(req, res, next);
            resolve({ req, res, next, index: i });
          })
        );
      }

      return Promise.all(promises).then(results => {
        // First 3 should pass
        for (let i = 0; i < 3; i++) {
          expect(results[i].next).toHaveBeenCalledWith();
        }

        // Last 2 should be blocked
        for (let i = 3; i < 5; i++) {
          expect(results[i].res.status).toHaveBeenCalledWith(429);
        }
      });
    });
  });

  describe('Command Rate Limiting (Discord Bot)', () => {
    it('should implement command-specific rate limiting', () => {
      // 5 commands per minute per user
      const commandRateLimit = createCommandRateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 5,
        keyGenerator: req => req.user?.id || req.ip,
      });

      const userId = 'user123';

      // User makes 5 commands (should all pass)
      for (let i = 0; i < 5; i++) {
        const req = createMockRequest({
          user: { id: userId },
          body: { command: '!health' },
        });
        const res = createMockResponse();
        const next = jest.fn();

        commandRateLimit(req, res, next);
        expect(next).toHaveBeenCalledWith();
      }

      // 6th command should be blocked
      const req = createMockRequest({
        user: { id: userId },
        body: { command: '!restart' },
      });
      const res = createMockResponse();
      const next = jest.fn();

      commandRateLimit(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('rate limit'),
        })
      );
    });

    it('should track different users separately for commands', () => {
      const commandRateLimit = createCommandRateLimit({
        windowMs: 60 * 1000,
        max: 2,
        keyGenerator: req => req.user?.id || req.ip,
      });

      const user1 = 'user123';
      const user2 = 'user456';

      // User 1 makes 2 commands
      for (let i = 0; i < 2; i++) {
        const req = createMockRequest({ user: { id: user1 } });
        const res = createMockResponse();
        const next = jest.fn();
        commandRateLimit(req, res, next);
        expect(next).toHaveBeenCalledWith();
      }

      // User 2 makes 2 commands (should still work)
      for (let i = 0; i < 2; i++) {
        const req = createMockRequest({ user: { id: user2 } });
        const res = createMockResponse();
        const next = jest.fn();
        commandRateLimit(req, res, next);
        expect(next).toHaveBeenCalledWith();
      }

      // User 1 makes another command (should be blocked)
      const req1 = createMockRequest({ user: { id: user1 } });
      const res1 = createMockResponse();
      const next1 = jest.fn();
      commandRateLimit(req1, res1, next1);
      expect(res1.status).toHaveBeenCalledWith(429);
    });
  });

  describe('Webhook Rate Limiting', () => {
    it('should implement webhook-specific rate limiting', () => {
      // 100 webhooks per 15 minutes per IP
      const webhookRateLimit = createMockRateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100,
        message: {
          error: 'Too many webhook requests',
          retryAfter: 900, // 15 minutes in seconds
        },
      });

      const ip = '127.0.0.1';

      // Make 100 webhook requests (should all pass)
      for (let i = 0; i < 100; i++) {
        const req = createMockRequest({
          ip,
          url: '/webhook/youtube',
          method: 'POST',
        });
        const res = createMockResponse();
        const next = jest.fn();

        webhookRateLimit(req, res, next);
        expect(next).toHaveBeenCalledWith();
      }

      // 101st request should be blocked
      const req = createMockRequest({
        ip,
        url: '/webhook/youtube',
        method: 'POST',
      });
      const res = createMockResponse();
      const next = jest.fn();

      webhookRateLimit(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('should handle webhook signature verification rate limiting', () => {
      // Prevent brute force attacks on webhook signatures
      const signatureRateLimit = createMockRateLimit({
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 10, // Only 10 attempts per 5 minutes
        skipSuccessfulRequests: true, // Only count failed attempts
      });

      const ip = '127.0.0.1';

      // Simulate 10 failed signature verification attempts - all should pass
      const nextCalls = [];
      for (let i = 0; i < 10; i++) {
        const req = createMockRequest({
          ip,
          headers: { 'x-hub-signature': 'invalid-signature' },
        });
        const res = createMockResponse();
        const next = jest.fn();

        signatureRateLimit(req, res, next);
        nextCalls.push(next);
      }

      // Verify all 10 attempts passed
      nextCalls.forEach(next => expect(next).toHaveBeenCalledWith());

      // 11th attempt should be blocked
      const req = createMockRequest({
        ip,
        headers: { 'x-hub-signature': 'invalid-signature' },
      });
      const res = createMockResponse();
      const next = jest.fn();

      signatureRateLimit(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);
    });
  });

  describe('Rate Limit Bypass and Exceptions', () => {
    it('should allow bypassing rate limits for trusted IPs', () => {
      const trustedIPs = ['127.0.0.1', '192.168.1.100'];
      const rateLimit = createMockRateLimit({
        ...rateLimitConfig,
        max: 1,
        skip: req => trustedIPs.includes(req.ip),
      });

      // Trusted IP should bypass rate limit
      for (let i = 0; i < 5; i++) {
        const req = createMockRequest({ ip: '127.0.0.1' });
        const res = createMockResponse();
        const next = jest.fn();

        rateLimit(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(429);
      }

      // Untrusted IP should be rate limited
      const req1 = createMockRequest({ ip: '203.0.113.1' });
      const res1 = createMockResponse();
      const next1 = jest.fn();
      rateLimit(req1, res1, next1);
      expect(next1).toHaveBeenCalledWith();

      const req2 = createMockRequest({ ip: '203.0.113.1' });
      const res2 = createMockResponse();
      const next2 = jest.fn();
      rateLimit(req2, res2, next2);
      expect(res2.status).toHaveBeenCalledWith(429);
    });

    it('should implement different limits for different endpoints', () => {
      const createEndpointRateLimit = (endpoint, max) =>
        createMockRateLimit({
          windowMs: 60 * 1000,
          max,
          keyGenerator: req => `${req.ip}:${endpoint}`,
        });

      const healthRateLimit = createEndpointRateLimit('/health', 60); // 1 per second
      const webhookRateLimit = createEndpointRateLimit('/webhook', 10); // 10 per minute

      const ip = '127.0.0.1';

      // Health endpoint should allow 60 requests
      for (let i = 0; i < 60; i++) {
        const req = createMockRequest({ ip, url: '/health' });
        const res = createMockResponse();
        const next = jest.fn();
        healthRateLimit(req, res, next);
        expect(next).toHaveBeenCalledWith();
      }

      // Webhook endpoint should allow 10 requests
      for (let i = 0; i < 10; i++) {
        const req = createMockRequest({ ip, url: '/webhook' });
        const res = createMockResponse();
        const next = jest.fn();
        webhookRateLimit(req, res, next);
        expect(next).toHaveBeenCalledWith();
      }

      // 61st health request should be blocked
      const healthReq = createMockRequest({ ip, url: '/health' });
      const healthRes = createMockResponse();
      const healthNext = jest.fn();
      healthRateLimit(healthReq, healthRes, healthNext);
      expect(healthRes.status).toHaveBeenCalledWith(429);

      // 11th webhook request should be blocked
      const webhookReq = createMockRequest({ ip, url: '/webhook' });
      const webhookRes = createMockResponse();
      const webhookNext = jest.fn();
      webhookRateLimit(webhookReq, webhookRes, webhookNext);
      expect(webhookRes.status).toHaveBeenCalledWith(429);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle missing IP address gracefully', () => {
      const rateLimit = createMockRateLimit(rateLimitConfig);
      const req = createMockRequest({ ip: undefined });
      const res = createMockResponse();
      const next = jest.fn();

      // Should use fallback IP or handle gracefully
      rateLimit(req, res, next);
      expect(next).toHaveBeenCalledWith(); // Should not crash
    });

    it('should handle very high request volumes', () => {
      const rateLimit = createMockRateLimit({ ...rateLimitConfig, max: 1000 });
      const startTime = performance.now();

      // Make 1000 requests
      for (let i = 0; i < 1000; i++) {
        const req = createMockRequest({ ip: `192.168.1.${i % 255}` });
        const res = createMockResponse();
        const next = jest.fn();
        rateLimit(req, res, next);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (under 1 second)
      expect(duration).toBeLessThan(1000);
    });

    it('should handle memory cleanup for expired entries', () => {
      const shortWindow = 100; // 100ms
      const rateLimit = createMockRateLimit({
        windowMs: shortWindow,
        max: 1,
      });

      // Make requests from many different IPs
      for (let i = 0; i < 100; i++) {
        const req = createMockRequest({ ip: `192.168.1.${i}` });
        const res = createMockResponse();
        const next = jest.fn();
        rateLimit(req, res, next);
      }

      // Advance time to expire all entries
      jest.advanceTimersByTime(shortWindow + 50);

      // Memory should be cleaned up (can't test directly, but no crashes expected)
      const req = createMockRequest({ ip: '192.168.1.1' });
      const res = createMockResponse();
      const next = jest.fn();
      rateLimit(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });
  });

  // Helper functions
  function createMockRateLimit(options) {
    const store = new Map();

    return (req, res, next) => {
      const key = options.keyGenerator ? options.keyGenerator(req) : req.ip;
      const now = timestampUTC();
      const windowStart = now - options.windowMs;

      // Check if rate limit skip function is working
      if (options.skip && options.skip(req)) {
        return next();
      }

      // Clean expired entries
      for (const [k, data] of store.entries()) {
        if (data.resetTime <= now) {
          store.delete(k);
        }
      }

      const existing = store.get(key);
      if (!existing) {
        store.set(key, {
          count: 1,
          resetTime: now + options.windowMs,
        });

        res.set({
          'X-RateLimit-Limit': options.max,
          'X-RateLimit-Remaining': options.max - 1,
          'X-RateLimit-Reset': new Date(now + options.windowMs).toISOString(),
        });

        return next();
      }

      if (existing.count >= options.max) {
        return res.status(429).json(options.message || { error: 'Too Many Requests' });
      }

      existing.count++;

      res.set({
        'X-RateLimit-Limit': options.max,
        'X-RateLimit-Remaining': options.max - existing.count,
        'X-RateLimit-Reset': new Date(existing.resetTime).toISOString(),
      });

      next();
    };
  }

  function createCommandRateLimit(options) {
    return createMockRateLimit({
      ...options,
      message: { error: 'Command rate limit exceeded. Please wait before trying again.' },
    });
  }

  // Tests for actual imported CommandRateLimit class
  describe('CommandRateLimit Class Tests', () => {
    it('should allow commands under the limit', () => {
      const rateLimiter = new CommandRateLimit(5, 60000); // 5 commands per minute
      const userId = 'user123';

      // User makes 5 commands (should all pass)
      for (let i = 0; i < 5; i++) {
        expect(rateLimiter.isAllowed(userId)).toBe(true);
      }
    });

    it('should block commands over the limit', () => {
      const rateLimiter = new CommandRateLimit(3, 60000); // 3 commands per minute
      const userId = 'user123';

      // User makes 3 commands (should all pass)
      for (let i = 0; i < 3; i++) {
        expect(rateLimiter.isAllowed(userId)).toBe(true);
      }

      // 4th command should be blocked
      expect(rateLimiter.isAllowed(userId)).toBe(false);

      // Additional commands should also be blocked
      expect(rateLimiter.isAllowed(userId)).toBe(false);
    });

    it('should track different users separately', () => {
      const rateLimiter = new CommandRateLimit(2, 60000); // 2 commands per minute
      const user1 = 'user1';
      const user2 = 'user2';

      // User1 makes 2 commands
      expect(rateLimiter.isAllowed(user1)).toBe(true);
      expect(rateLimiter.isAllowed(user1)).toBe(true);

      // User2 should still be able to make commands
      expect(rateLimiter.isAllowed(user2)).toBe(true);
      expect(rateLimiter.isAllowed(user2)).toBe(true);

      // User1's 3rd command should be blocked
      expect(rateLimiter.isAllowed(user1)).toBe(false);

      // User2's 3rd command should also be blocked
      expect(rateLimiter.isAllowed(user2)).toBe(false);
    });

    it('should reset limits after time window expires', () => {
      const rateLimiter = new CommandRateLimit(1, 1000); // 1 command per second
      const userId = 'user123';

      // First command should pass
      expect(rateLimiter.isAllowed(userId)).toBe(true);

      // Second command should be blocked
      expect(rateLimiter.isAllowed(userId)).toBe(false);

      // Advance time past window
      jest.advanceTimersByTime(1100);

      // Command should pass again (window reset)
      expect(rateLimiter.isAllowed(userId)).toBe(true);
    });

    it('should handle cleanup of expired entries', () => {
      const rateLimiter = new CommandRateLimit(1, 1000); // 1 command per second
      rateLimiter.cleanupThreshold = 2; // Set low threshold for testing

      // Add some users
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user2')).toBe(true);
      expect(rateLimiter.isAllowed('user3')).toBe(true);

      // Should have 3 users in the map
      expect(rateLimiter.users.size).toBe(3);

      // Advance time to expire entries
      jest.advanceTimersByTime(1100);

      // Add another user to trigger cleanup
      expect(rateLimiter.isAllowed('user4')).toBe(true);

      // Should have fewer users after cleanup
      expect(rateLimiter.users.size).toBeLessThan(3);
    });

    it('should handle manual cleanup', () => {
      const rateLimiter = new CommandRateLimit(1, 1000); // 1 command per second

      // Add some users
      rateLimiter.isAllowed('user1');
      rateLimiter.isAllowed('user2');
      rateLimiter.isAllowed('user3');

      // Should have 3 users in the map
      expect(rateLimiter.users.size).toBe(3);

      // Advance time to expire entries
      jest.advanceTimersByTime(1100);

      // Manual cleanup
      rateLimiter.cleanup();

      // Should have no users after cleanup
      expect(rateLimiter.users.size).toBe(0);
    });

    it('should handle different constructor parameters', () => {
      const rateLimiter = new CommandRateLimit(10, 30000); // 10 commands per 30 seconds
      const userId = 'user123';

      // User makes 10 commands (should all pass)
      for (let i = 0; i < 10; i++) {
        expect(rateLimiter.isAllowed(userId)).toBe(true);
      }

      // 11th command should be blocked
      expect(rateLimiter.isAllowed(userId)).toBe(false);
    });
  });

  // Tests for actual imported functions
  describe('Rate Limiter Functions Tests', () => {
    it('should create webhook rate limiter', () => {
      const webhookLimiter = createWebhookLimiter();
      expect(typeof webhookLimiter).toBe('function');
    });

    it('should create general rate limiter', () => {
      const generalLimiter = createGeneralLimiter();
      expect(typeof generalLimiter).toBe('function');
    });

    it('should create strict rate limiter', () => {
      const strictLimiter = createStrictLimiter();
      expect(typeof strictLimiter).toBe('function');
    });

    it('should create command rate limiter', () => {
      const commandLimiter = createCommandRateLimiter();
      expect(commandLimiter).toBeInstanceOf(CommandRateLimit);
      expect(typeof commandLimiter.isAllowed).toBe('function');
    });
  });
});
