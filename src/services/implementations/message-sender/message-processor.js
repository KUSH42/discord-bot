import { RateLimitError } from './rate-limiter.js';
import { RetryableError } from './retry-handler.js';

/**
 * Message Processor for Discord API
 * Handles the actual sending of messages with rate limiting and retry logic
 */
export class MessageProcessor {
  constructor(rateLimiter, retryHandler, options = {}) {
    this.rateLimiter = rateLimiter;
    this.retryHandler = retryHandler;
    this.logger = options.logger || console;

    // Processing options
    this.enableRateLimiting = options.enableRateLimiting !== false;
    this.enableRetries = options.enableRetries !== false;
    this.validateChannels = options.validateChannels !== false;

    // Metrics
    this.metrics = {
      totalProcessed: 0,
      successfulSends: 0,
      failedSends: 0,
      rateLimitHits: 0,
      retriesAttempted: 0,
      averageProcessingTime: 0,
      maxProcessingTime: 0,
    };
  }

  /**
   * Process a message (main entry point)
   * @param {Message} message - Message to process
   * @returns {Promise<Object>} Discord API response
   * @throws {Error} If message processing fails permanently
   */
  async processMessage(message) {
    const startTime = Date.now();
    this.metrics.totalProcessed++;

    try {
      // Mark message as processing
      message.markProcessing();

      // Validate message
      this.validateMessage(message);

      // Check rate limiting
      if (this.enableRateLimiting) {
        await this.rateLimiter.checkRateLimit();
      }

      // Send the message
      const result = await this.sendMessage(message);

      // Mark as successful
      message.markCompleted(result);
      this.metrics.successfulSends++;

      // Update metrics
      const processingTime = Date.now() - startTime;
      this.updateProcessingTimeMetrics(processingTime);

      this.logger.debug('Message processed successfully', {
        messageId: message.id,
        processingTime,
        retryCount: message.retryCount,
      });

      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateProcessingTimeMetrics(processingTime);

      return await this.handleProcessingError(message, error);
    }
  }

  /**
   * Handle processing errors with retry logic
   * @param {Message} message - Message that failed
   * @param {Error} error - Error that occurred
   * @throws {Error} Re-throws error for upstream handling
   */
  async handleProcessingError(message, error) {
    this.logger.debug('Message processing error', {
      messageId: message.id,
      error: error.message,
      errorCode: error.code,
      retryCount: message.retryCount,
      messageContent: this.sanitizeMessageContent(message),
    });

    // Handle rate limit errors (both proactive and reactive)
    if (error.code === 429 || error.status === 429 || error instanceof RateLimitError) {
      this.metrics.rateLimitHits++;

      // Handle reactive rate limits (429 responses from Discord)
      if ((error.code === 429 || error.status === 429) && this.enableRateLimiting) {
        this.rateLimiter.handleRateLimit(error);
      }

      // All rate limit errors are retryable
      if (error instanceof RateLimitError) {
        // Re-throw the existing RateLimitError
        throw error;
      } else {
        // Create new RateLimitError for 429 responses
        throw new RateLimitError(
          `Discord API rate limit: ${error.message}`,
          error.retryAfter ? error.retryAfter * 1000 : 1000,
          'reactive'
        );
      }
    }

    // Handle other retryable errors
    if (this.enableRetries && this.retryHandler.shouldRetry(error, message.retryCount)) {
      this.metrics.retriesAttempted++;

      const retryInfo = this.retryHandler.handleRetry(message, error);

      this.logger.warn('Message will be retried', {
        messageId: message.id,
        retryCount: retryInfo.retryCount,
        maxRetries: retryInfo.maxRetries,
        retryDelay: retryInfo.retryDelay,
        error: error.message,
      });

      throw new RetryableError(`Retryable error: ${error.message}`, error, retryInfo.retryDelay);
    }

    // Permanent failure
    this.metrics.failedSends++;
    message.markFailed(error);

    this.logger.error('Message processing permanently failed', {
      messageId: message.id,
      retryCount: message.retryCount,
      error: error.message,
      errorCode: error.code,
      messageContent: this.sanitizeMessageContent(message),
    });

    throw error;
  }

  /**
   * Send message via Discord API
   * @param {Message} message - Message to send
   * @returns {Promise<Object>} Discord API response
   */
  async sendMessage(message) {
    // Validate channel
    if (this.validateChannels && !this.isValidChannel(message.channel)) {
      throw new Error(`Invalid channel: ${message.channel?.id || 'undefined'}`);
    }

    try {
      // Send based on content type
      if (typeof message.content === 'string') {
        return await message.channel.send(message.content);
      } else if (message.content && typeof message.content === 'object') {
        // Merge content and options
        const sendOptions = { ...message.content, ...message.options };
        return await message.channel.send(sendOptions);
      } else {
        throw new Error('Invalid message content type');
      }
    } catch (error) {
      // Enhance error with context
      error.messageId = message.id;
      error.channelId = message.channel?.id;
      throw error;
    }
  }

  /**
   * Validate message before processing
   * @param {Message} message - Message to validate
   * @throws {Error} If message is invalid
   */
  validateMessage(message) {
    if (!message) {
      throw new Error('Message is required');
    }

    if (!message.channel) {
      throw new Error('Message channel is required');
    }

    if (!message.content && !message.options) {
      throw new Error('Message content or options are required');
    }

    if (message.status === 'completed') {
      throw new Error('Message has already been processed');
    }

    if (message.status === 'failed' && !message.canRetry()) {
      throw new Error('Message has permanently failed and cannot be retried');
    }
  }

  /**
   * Validate Discord channel
   * @param {Object} channel - Discord channel object
   * @returns {boolean} True if channel is valid
   */
  isValidChannel(channel) {
    if (!channel) {
      return false;
    }

    // Check for required methods
    if (typeof channel.send !== 'function') {
      return false;
    }

    // Check for Discord.js text channel
    if (channel.isTextBased && typeof channel.isTextBased === 'function') {
      return channel.isTextBased();
    }

    // Fallback check for basic channel properties
    return !!(channel.id && channel.send);
  }

  /**
   * Sanitize message content for logging purposes
   * @param {Message} message - Message to sanitize
   * @returns {Object} Sanitized content info
   */
  sanitizeMessageContent(message) {
    if (!message) {
      return { error: 'No message provided' };
    }

    try {
      const result = {
        channelId: message.channel?.id || 'unknown',
        contentType: typeof message.content,
      };

      if (typeof message.content === 'string') {
        // Truncate long content and remove sensitive patterns
        const truncated = message.content.length > 200 ? `${message.content.substring(0, 200)}...` : message.content;

        // Basic sanitization - remove potential tokens/secrets
        const sanitized = truncated
          .replace(/[A-Za-z0-9]{24,}/g, '[REDACTED_TOKEN]') // Discord tokens
          .replace(/https?:\/\/[^\s]+/g, '[URL]'); // URLs for privacy

        result.content = sanitized;
        result.contentLength = message.content.length;
      } else if (message.content && typeof message.content === 'object') {
        // For embed objects, log structure but not full content
        result.contentKeys = Object.keys(message.content);
        if (message.content.description) {
          const desc = message.content.description;
          const truncated = desc.length > 100 ? `${desc.substring(0, 100)}...` : desc;
          result.description = truncated.replace(/[A-Za-z0-9]{24,}/g, '[REDACTED]');
        }
        if (message.content.title) {
          result.title = message.content.title.substring(0, 50);
        }
      }

      // Add message options info
      if (message.options && Object.keys(message.options).length > 0) {
        result.optionsKeys = Object.keys(message.options);
      }

      return result;
    } catch (sanitizeError) {
      return {
        error: 'Failed to sanitize message content',
        sanitizeError: sanitizeError.message,
        messageId: message.id,
      };
    }
  }

  /**
   * Update processing time metrics
   * @param {number} processingTime - Time in milliseconds
   */
  updateProcessingTimeMetrics(processingTime) {
    this.metrics.maxProcessingTime = Math.max(this.metrics.maxProcessingTime, processingTime);

    // Calculate running average
    const { totalProcessed } = this.metrics;
    if (totalProcessed > 0) {
      const currentAverage = this.metrics.averageProcessingTime;
      this.metrics.averageProcessingTime = (currentAverage * (totalProcessed - 1) + processingTime) / totalProcessed;
    }
  }

  /**
   * Get processing metrics
   * @returns {Object} Current metrics and statistics
   */
  getMetrics() {
    const { totalProcessed } = this.metrics;
    const successRate = totalProcessed > 0 ? (this.metrics.successfulSends / totalProcessed) * 100 : 0;
    const retryRate = totalProcessed > 0 ? (this.metrics.retriesAttempted / totalProcessed) * 100 : 0;

    return {
      ...this.metrics,
      successRate: Math.round(successRate * 100) / 100,
      retryRate: Math.round(retryRate * 100) / 100,
      rateLimiterMetrics: this.rateLimiter.getMetrics(),
      retryHandlerMetrics: this.retryHandler.getMetrics(),
      configuration: {
        enableRateLimiting: this.enableRateLimiting,
        enableRetries: this.enableRetries,
        validateChannels: this.validateChannels,
      },
    };
  }

  /**
   * Reset all metrics
   */
  resetMetrics() {
    this.metrics = {
      totalProcessed: 0,
      successfulSends: 0,
      failedSends: 0,
      rateLimitHits: 0,
      retriesAttempted: 0,
      averageProcessingTime: 0,
      maxProcessingTime: 0,
    };

    this.rateLimiter.reset();
    this.retryHandler.resetMetrics();
  }

  /**
   * Send message immediately without queue (for testing/urgent messages)
   * @param {Object} channel - Discord channel
   * @param {string|Object} content - Message content
   * @param {Object} options - Message options
   * @returns {Promise<Object>} Discord API response
   */
  async sendImmediate(channel, content, options = {}) {
    const { Message } = await import('./message.js');

    const message = new Message({
      channel,
      content,
      options,
      priority: 1000, // High priority
    });

    return await this.processMessage(message);
  }
}
