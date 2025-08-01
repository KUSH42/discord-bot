// logger-utils.js
// Logger utilities including Discord transport for Winston

import Transport from 'winston-transport';
import * as winston from 'winston';
import { splitMessage } from '../setup/discord-utils.js';
import { DiscordMessageSender } from '../services/implementations/message-sender/discord-message-sender.js';
import { createEnhancedLogger } from '../utilities/enhanced-logger.js';

/**
 * Discord Transport for Winston logger
 * Buffers log messages and sends them to a Discord channel
 */
export class DiscordTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.client = opts.client;
    this.channelId = opts.channelId;
    this.channel = null;
    this.buffer = [];

    // Store debug manager and metrics manager for enhanced logging
    this.debugManager = opts.debugManager;
    this.metricsManager = opts.metricsManager;

    // Buffering options
    this.flushInterval = opts.flushInterval || 1000; // 1 seconds to match send delay
    this.maxBufferSize = opts.maxBufferSize || 15; // 15 log entries to match burst allowance
    this.flushTimer = null;
    this.isDestroyed = false;

    // New event-driven message sender for real-time Discord logging
    // Optimized settings for ≤2s delay real-time logging while respecting Discord limits
    // Create enhanced logger for DiscordMessageSender
    const baseLogger =
      process.env.NODE_ENV === 'test'
        ? { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, verbose: () => {} }
        : {
            debug: console.debug?.bind(console) || console.log.bind(console),
            info: console.info?.bind(console) || console.log.bind(console),
            warn: console.warn?.bind(console) || console.log.bind(console),
            error: console.error?.bind(console) || console.log.bind(console),
            verbose: console.debug?.bind(console) || console.log.bind(console),
          };

    // Create enhanced logger for the discord-transport module itself
    this.logger =
      this.debugManager && this.metricsManager
        ? createEnhancedLogger('discord-transport', baseLogger, this.debugManager, this.metricsManager)
        : {
            debug: baseLogger.debug,
            info: baseLogger.info,
            warn: baseLogger.warn,
            error: baseLogger.error,
            verbose: baseLogger.verbose,
          };

    // Create enhanced logger for DiscordMessageSender
    const messageSenderLogger =
      this.debugManager && this.metricsManager
        ? createEnhancedLogger('discord-message-sender', baseLogger, this.debugManager, this.metricsManager)
        : baseLogger;
    this.messageSender = new DiscordMessageSender(messageSenderLogger, {
      baseSendDelay: opts.baseSendDelay || 1000, // 1 second between sends to respect Discord limits
      burstAllowance: opts.burstAllowance || 30, // Allow 30 quick messages per 2 minutes
      burstResetTime: opts.burstResetTime || 60000, // 1 minute burst reset for better recovery
      maxRetries: opts.maxRetries || 5, // More retries for better reliability
      backoffMultiplier: 1.5,
      maxBackoffDelay: opts.maxBackoffDelay || 30000, // 30 second max backoff
      testMode: process.env.NODE_ENV === 'test', // Enable test mode in test environment
      autoStart: process.env.NODE_ENV !== 'test', // Don't auto-start in test environment
    });

    // Don't start periodic flushing in test environment to prevent test timeouts
    if (process.env.NODE_ENV !== 'test') {
      this.startFlushing();
    }
  }

  startFlushing() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushTimer = setInterval(() => {
      if (!this.isDestroyed) {
        this.flush();
      }
    }, this.flushInterval);
  }

  // Add cleanup method to prevent memory leaks
  async close() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.isDestroyed = true;

    // Flush any remaining messages
    try {
      await this.flush();
    } catch (error) {
      // Ignore flush errors during shutdown
      if (process.env.NODE_ENV !== 'test' && !this.isWriteError(error) && !this.isShutdownError(error)) {
        this.logError('Error during final flush:', error);
      }
    }

    // Gracefully shutdown the message sender
    if (this.messageSender) {
      try {
        await this.messageSender.shutdown(5000); // 5 second timeout
      } catch (error) {
        // Ignore shutdown errors - they're expected during disconnect
        if (process.env.NODE_ENV !== 'test' && !this.isWriteError(error) && !this.isShutdownError(error)) {
          this.logError('Error during message sender shutdown:', error);
        }
      }
    }

    this.emit('close');
  }

  // Override the Winston transport close method
  async destroy() {
    await this.close();
  }

  // Check if Discord client is unavailable or shutting down
  isClientUnavailable() {
    if (!this.client) {
      return true;
    }

    // Check if client is ready
    if (!this.client.isReady || !this.client.isReady()) {
      return true;
    }

    // Check if client is being destroyed
    if (this.client.destroy && this.client.destroyed) {
      return true;
    }

    // Check for WebSocket connection state
    if (this.client.ws && this.client.ws.status !== 0 && this.client.ws.status !== 1) {
      return true;
    }

    return false;
  }

  // Check if error is a write error (EPIPE, ECONNRESET, etc.)
  isWriteError(error) {
    if (!error) {
      return false;
    }

    const writeErrorCodes = ['EPIPE', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'];
    return writeErrorCodes.includes(error.code) || (error.message && error.message.includes('write EPIPE'));
  }

  // Check if error is related to shutdown/destruction
  isShutdownError(error) {
    if (!error || !error.message) {
      return false;
    }

    const shutdownMessages = [
      'token to be set',
      'client destroyed',
      'Cannot send messages',
      'WebSocket connection',
      'Client not ready',
    ];

    return shutdownMessages.some(msg => error.message.includes(msg));
  }

  // Enhanced error logging using enhanced logger when available
  logError(message, error = null) {
    if (this.logger && typeof this.logger.error === 'function') {
      this.logger.error(message, error ? { error: error.message, stack: error.stack } : {});
    } else {
      this.safeConsoleError(`[DiscordTransport] ${message}`, error);
    }
  }

  // Safe logging to prevent EPIPE errors on console.error (fallback)
  safeConsoleError(message, ...args) {
    try {
      console.error(message, ...args);
    } catch (_error) {
      // If console.error fails (EPIPE), try console.log, then give up
      try {
        console.log('ERROR:', message, ...args);
      } catch (_fallbackError) {
        // Can't log - just give up silently
      }
    }
  }

  async log(info, callback) {
    setImmediate(() => this.emit('logged', info));
    // Don't log if transport is destroyed or client is shutting down
    if (this.isDestroyed || this.isClientUnavailable()) {
      return callback();
    }
    // Channel initialization logic
    if (!this.client || !this.client.isReady || !this.client.isReady() || this.channel === 'errored') {
      return callback();
    }
    if (this.channel === null) {
      try {
        const fetchedChannel = await this.client.channels.fetch(this.channelId);
        if (fetchedChannel && fetchedChannel.isTextBased()) {
          this.channel = fetchedChannel;
          // Send initialization message asynchronously (non-blocking) with lower priority
          setTimeout(() => {
            this.messageSender
              .queueMessage(this.channel, '✅ **Winston logging transport initialized for this channel.**', {
                priority: -1, // Low priority, won't block startup
              })
              .catch(error => {
                if (process.env.NODE_ENV !== 'test' && !this.isWriteError(error)) {
                  this.logError('Failed to send initialization message:', error);
                }
              });
          }, 2000); // 2 second delay to avoid blocking startup
        } else {
          this.channel = 'errored';
          if (process.env.NODE_ENV !== 'test') {
            this.logError(`Channel ${this.channelId} is not a valid text channel.`);
          }
        }
      } catch (error) {
        this.channel = 'errored';
        if (process.env.NODE_ENV !== 'test') {
          this.logError(`Failed to fetch channel ${this.channelId}:`, error);
        }
      }
    }
    if (!this.channel || this.channel === 'errored') {
      return callback();
    }

    // Buffering logic
    const { level, message, stack } = info;
    let logMessage = `**[${level.toUpperCase()}]**: ${message}`;
    if (stack) {
      logMessage += `\n\`\`\`\n${stack}\n\`\`\``;
    }
    this.buffer.push(logMessage);
    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush();
    }
    callback();
  }

  async flush() {
    if (this.buffer.length === 0 || !this.channel || this.channel === 'errored') {
      return;
    }
    const messagesToFlush = [...this.buffer];
    this.buffer = [];

    // Don't actually send if transport is destroyed or client is not ready
    if (this.isDestroyed || this.isClientUnavailable()) {
      return;
    }

    const combinedMessage = messagesToFlush.join('\n');
    try {
      // Use event-driven message sender for improved Discord API handling
      for (const part of splitMessage(combinedMessage, { maxLength: 1980 })) {
        if (part) {
          await this.messageSender.queueMessage(this.channel, part, {
            priority: 1, // Logging messages have normal priority
          });
        }
      }
    } catch (error) {
      // Only log the error if it's not related to Discord being unavailable during shutdown
      // and we're not in test environment, and not a write error
      if (process.env.NODE_ENV !== 'test' && !this.isWriteError(error) && !this.isShutdownError(error)) {
        this.logError('Failed to flush log buffer to Discord:', error);

        // Log rate limiting metrics for debugging only if client is still available
        if (!this.isClientUnavailable()) {
          const metrics = this.messageSender.getMetrics();
          if (this.logger && typeof this.logger.debug === 'function') {
            this.logger.debug(
              `Message sender metrics: ${JSON.stringify({
                successRate: metrics.successRate,
                rateLimitHits: metrics.rateLimitHits,
                currentQueueSize: metrics.currentQueueSize,
                isPaused: metrics.isPaused,
              })}`
            );
          } else {
            this.safeConsoleError('[DiscordTransport] Message sender metrics:', {
              successRate: metrics.successRate,
              rateLimitHits: metrics.rateLimitHits,
              currentQueueSize: metrics.currentQueueSize,
              isPaused: metrics.isPaused,
            });
          }
        }
      }

      // Re-add messages to buffer if sending failed and transport is still active
      // Only re-queue if it's not a write error or shutdown error
      if (
        !this.isDestroyed &&
        !this.isClientUnavailable() &&
        !this.isWriteError(error) &&
        !this.isShutdownError(error) &&
        messagesToFlush.length > 0
      ) {
        this.buffer.unshift(...messagesToFlush);
      }
    }
  }

  /**
   * Set Discord log level
   */
  async setLogLevel(loglevel) {
    this.client.logger.level = loglevel;
  }
}

/**
 * Systemd-safe console transport that handles EPIPE errors gracefully
 */
export class SystemdSafeConsoleTransport extends winston.transports.Console {
  constructor(options) {
    super(options);
    this.silent = false;
    this._setupErrorHandling();
  }

  _setupErrorHandling() {
    // Handle errors on the stdout/stderr streams directly
    if (process.stdout) {
      process.stdout.on('error', error => {
        if (this.isWriteError(error)) {
          this.silent = true;
          // Silently ignore EPIPE errors
        }
      });
    }

    if (process.stderr) {
      process.stderr.on('error', error => {
        if (this.isWriteError(error)) {
          this.silent = true;
          // Silently ignore EPIPE errors
        }
      });
    }
  }

  log(info, callback) {
    // If already silenced due to EPIPE, skip logging
    if (this.silent) {
      setImmediate(() => callback());
      return true;
    }

    try {
      // Call the parent log method
      return super.log(info, callback);
    } catch (error) {
      // Handle EPIPE and other write errors silently
      if (this.isWriteError(error)) {
        // Mark transport as silent to prevent further EPIPE errors
        this.silent = true;
        // Call callback without error to prevent Winston from crashing
        setImmediate(() => callback());
        return true;
      }
      // Re-throw non-write errors
      throw error;
    }
  }

  write(chunk, encoding) {
    // If already silenced due to EPIPE, skip writing
    if (this.silent) {
      return true;
    }

    try {
      return super.write(chunk, encoding);
    } catch (error) {
      // Silently handle write errors to prevent crashing
      if (this.isWriteError(error)) {
        this.silent = true;
        return true;
      }
      throw error;
    }
  }

  // Check if error is a write error (EPIPE, ECONNRESET, etc.)
  isWriteError(error) {
    if (!error) {
      return false;
    }
    const writeErrorCodes = ['EPIPE', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'];
    return writeErrorCodes.includes(error.code) || (error.message && error.message.includes('write EPIPE'));
  }
}

/**
 * Logger utility functions
 */
export const LoggerUtils = {
  /**
   * Create a file log format
   * @returns {winston.Logform.Format} Winston log format
   */
  createFileLogFormat() {
    return winston.format.printf(({ level, message, timestamp, stack, service }) => {
      const serviceLabel = service ? `[${service}]` : '';
      const baseMessage = `[${timestamp}] ${serviceLabel} [${level.toUpperCase()}]: ${message}`;
      return stack ? `${baseMessage}\n${stack}` : baseMessage;
    });
  },

  /**
   * Create a console log format
   * @returns {winston.Logform.Format} Winston log format
   */
  createConsoleLogFormat() {
    return winston.format.printf(({ level, message, stack, service }) => {
      const serviceLabel = service ? `[${service}]` : '';
      const baseMessage = `${serviceLabel} [${level.toUpperCase()}]: ${message}`;
      return stack ? `${baseMessage}\n${stack}` : baseMessage;
    });
  },

  /**
   * Create Discord transport instance
   * @param {Object} client - Discord client
   * @param {string} channelId - Discord channel ID
   * @param {Object} options - Transport options
   * @returns {DiscordTransport} Discord transport instance
   */
  createDiscordTransport(client, channelId, options = {}) {
    return new DiscordTransport({
      client,
      channelId,
      level: options.level || 'info',
      debugManager: options.debugManager,
      metricsManager: options.metricsManager,
      ...options,
    });
  },

  /**
   * Create systemd-safe console transport that handles EPIPE errors
   * @param {Object} options - Transport options
   * @returns {SystemdSafeConsoleTransport} Systemd-safe console transport instance
   */
  createSystemdSafeConsoleTransport(options = {}) {
    return new SystemdSafeConsoleTransport({
      level: options.level || 'info',
      format: options.format || this.createConsoleLogFormat(),
      ...options,
    });
  },
};
