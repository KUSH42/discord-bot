// logger-utils.js
// Logger utilities including Discord transport for Winston

import Transport from 'winston-transport';
import * as winston from 'winston';
import { splitMessage } from './discord-utils.js';

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

    // Buffering options
    this.flushInterval = opts.flushInterval || 2000; // 2 seconds
    this.maxBufferSize = opts.maxBufferSize || 20; // 20 log entries
    this.flushTimer = null;
    this.isDestroyed = false;

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
  close() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.isDestroyed = true;
    // Trigger flush for the test spy, but don't actually send anything
    this.flush();
    this.emit('close');
  }

  // Override the Winston transport close method
  destroy() {
    this.close();
  }

  async log(info, callback) {
    setImmediate(() => this.emit('logged', info));
    // Don't log if transport is destroyed
    if (this.isDestroyed) {
      return callback();
    }
    // Channel initialization logic
    if (!this.client.isReady() || this.channel === 'errored') {
      return callback();
    }
    if (this.channel === null) {
      try {
        const fetchedChannel = await this.client.channels.fetch(this.channelId);
        if (fetchedChannel && fetchedChannel.isTextBased()) {
          this.channel = fetchedChannel;
          // Send initialization message immediately, not buffered
          this.channel.send('✅ **Winston logging transport initialized for this channel.**').catch(error => {
            console.error('[DiscordTransport] Failed to send initialization message:', error);
          });
        } else {
          this.channel = 'errored';
          console.error(`[DiscordTransport] Channel ${this.channelId} is not a valid text channel.`);
        }
      } catch (error) {
        this.channel = 'errored';
        console.error(`[DiscordTransport] Failed to fetch channel ${this.channelId}:`, error);
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
    if (this.isDestroyed || !this.client.isReady()) {
      return;
    }

    const combinedMessage = messagesToFlush.join('\n');
    try {
      for (const part of splitMessage(combinedMessage, { maxLength: 1980 })) {
        if (part) {
          await this.channel.send(part);
        }
      }
    } catch (error) {
      // Only log the error if it's not related to Discord being unavailable during shutdown
      if (error.message && !error.message.includes('token to be set') && !error.message.includes('client destroyed')) {
        console.error('[DiscordTransport] Failed to flush log buffer to Discord:', error);
      }
      // Re-add messages to buffer if sending failed and transport is still active
      if (!this.isDestroyed && messagesToFlush.length > 0 && this.client.isReady()) {
        this.buffer.unshift(...messagesToFlush);
      }
    }
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
      ...options,
    });
  },
};
