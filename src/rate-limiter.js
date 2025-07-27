// rate-limiter.js
// Rate limiting utilities for Discord commands and webhook requests

import rateLimit from 'express-rate-limit';

/**
 * Command rate limiter class for Discord bot commands
 * Implements in-memory rate limiting with automatic cleanup
 */
export class CommandRateLimit {
  constructor(maxCommands = 15, windowMs = 15000) {
    this.maxCommands = maxCommands;
    this.windowMs = windowMs;
    this.users = new Map();
    this.cleanupThreshold = 1000; // Cleanup when this many users are stored
  }

  /**
   * Check if a user is allowed to execute a command
   * @param {string} userId - Discord user ID
   * @returns {boolean} - True if user is allowed, false if rate limited
   */
  isAllowed(userId) {
    const now = Date.now();
    const userData = this.users.get(userId) || { count: 0, resetTime: now + this.windowMs };

    // Reset if window has passed
    if (now >= userData.resetTime) {
      userData.count = 0;
      userData.resetTime = now + this.windowMs;
    }

    // Check if user has exceeded limit
    if (userData.count >= this.maxCommands) {
      return false;
    }

    // Increment counter
    userData.count++;
    this.users.set(userId, userData);

    // Clean up old entries periodically
    if (this.users.size > this.cleanupThreshold) {
      this.cleanup();
    }

    return true;
  }

  /**
   * Clean up expired user entries
   */
  cleanup() {
    const now = Date.now();
    for (const [userId, userData] of this.users.entries()) {
      if (now >= userData.resetTime) {
        this.users.delete(userId);
      }
    }
  }

  /**
   * Get remaining time until user's rate limit resets
   * @param {string} userId - Discord user ID
   * @returns {number} - Remaining time in milliseconds
   */
  getRemainingTime(userId) {
    const userData = this.users.get(userId);
    if (!userData) {
      return 0;
    }
    return Math.max(0, userData.resetTime - Date.now());
  }

  /**
   * Get current usage count for a user
   * @param {string} userId - Discord user ID
   * @returns {number} - Current command count
   */
  getUserCount(userId) {
    const userData = this.users.get(userId);
    if (!userData) {
      return 0;
    }

    const now = Date.now();
    if (now >= userData.resetTime) {
      return 0; // Window has expired
    }

    return userData.count;
  }

  /**
   * Get rate limit statistics
   * @returns {Object} - Statistics object
   */
  getStats() {
    return {
      maxCommands: this.maxCommands,
      windowMs: this.windowMs,
      activeUsers: this.users.size,
      cleanupThreshold: this.cleanupThreshold,
    };
  }

  /**
   * Reset rate limits for a specific user
   * @param {string} userId - Discord user ID
   */
  resetUser(userId) {
    this.users.delete(userId);
  }

  /**
   * Reset all rate limits
   */
  resetAll() {
    this.users.clear();
  }

  /**
   * Set cleanup threshold
   * @param {number} threshold - New cleanup threshold
   */
  setCleanupThreshold(threshold) {
    this.cleanupThreshold = Math.max(100, threshold);
  }
}

/**
 * Create a webhook rate limiter for Express
 * @param {Object} options - Rate limiter configuration
 * @returns {Function} - Express middleware function
 */
export function createWebhookLimiter(options = {}) {
  const defaultOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many webhook requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  };

  return rateLimit({ ...defaultOptions, ...options });
}

/**
 * Create a general purpose rate limiter
 * @param {Object} options - Rate limiter configuration
 * @returns {Function} - Express middleware function
 */
export function createGeneralLimiter(options = {}) {
  const defaultOptions = {
    windowMs: 60 * 1000, // 1 minute
    max: 60, // limit each IP to 60 requests per minute
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  };

  return rateLimit({ ...defaultOptions, ...options });
}

/**
 * Create a strict rate limiter for sensitive endpoints
 * @param {Object} options - Rate limiter configuration
 * @returns {Function} - Express middleware function
 */
export function createStrictLimiter(options = {}) {
  const defaultOptions = {
    windowMs: 60 * 1000, // 1 minute
    max: 10, // limit each IP to 10 requests per minute
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  };

  return rateLimit({ ...defaultOptions, ...options });
}

/**
 * Rate limiting middleware factory with IP validation
 * @param {Object} options - Configuration options
 * @returns {Function} - Express middleware function
 */
export function createSecureRateLimiter(options = {}) {
  const limiter = createGeneralLimiter(options);

  return (req, res, next) => {
    // Get IP address from various sources
    const ip =
      req.ip ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim();

    // Basic IP validation
    if (!ip || ip === '::1' || ip === '127.0.0.1') {
      // Allow localhost in development
      if (process.env.NODE_ENV === 'development') {
        return next();
      }
    }

    // Apply rate limiting
    return limiter(req, res, next);
  };
}

/**
 * Utility function to create a command rate limiter instance
 * @param {Object} options - Configuration options
 * @returns {CommandRateLimit} - New command rate limiter instance
 */
export function createCommandRateLimiter(options = {}) {
  const { maxCommands = 5, windowMs = 60000 } = options;
  return new CommandRateLimit(maxCommands, windowMs);
}
