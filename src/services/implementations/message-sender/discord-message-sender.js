import { EventEmitter } from 'events';
import { MessageQueue } from './message-queue.js';
import { Message } from './message.js';
import { RateLimiter, RateLimitError } from './rate-limiter.js';
import { RetryHandler, RetryableError } from './retry-handler.js';
import { MessageProcessor } from './message-processor.js';
import { ProcessingScheduler } from './processing-scheduler.js';

/**
 * Discord Message Sender - New Architecture
 * Event-driven, testable message sending with rate limiting and retry logic
 */
export class DiscordMessageSender extends EventEmitter {
  constructor(logger, options = {}) {
    super();

    this.logger = logger || console;

    // Core components
    this.queue = new MessageQueue(options);
    this.rateLimiter = new RateLimiter(options);
    this.retryHandler = new RetryHandler(options);
    this.processor = new MessageProcessor(this.rateLimiter, this.retryHandler, {
      ...options,
      logger: this.logger,
    });
    this.scheduler = options.testMode
      ? ProcessingScheduler.forTesting(options)
      : ProcessingScheduler.forProduction(options);

    // State
    this.isProcessing = false;
    this.isPaused = false;
    this.processingPromise = null;
    this._processingResolve = null;

    // Configuration
    this.autoStart = options.autoStart !== false;
    this.testMode = options.testMode || false;
    this.maxConcurrentProcessing = options.maxConcurrentProcessing || 1;

    // Metrics aggregation
    this.globalMetrics = {
      totalMessages: 0,
      successfulSends: 0,
      failedSends: 0,
      averageQueueTime: 0,
      maxQueueTime: 0,
      startedAt: Date.now(),
    };

    // Event handlers setup
    this.setupEventHandlers();

    // Auto-start if enabled
    if (this.autoStart) {
      this.startProcessing();
    }
  }

  /**
   * Queue a message for sending
   * @param {Object} channel - Discord channel object
   * @param {string|Object} content - Message content
   * @param {Object} options - Message options
   * @returns {Promise<Object>} Promise that resolves when message is sent
   */
  async queueMessage(channel, content, options = {}) {
    return new Promise((resolve, reject) => {
      const message = new Message({
        channel,
        content,
        options,
        resolve,
        reject,
        priority: options.priority || 0,
        maxRetries: options.maxRetries || this.retryHandler.maxRetries,
      });

      try {
        // Add to queue
        this.queue.enqueue(message);
        this.globalMetrics.totalMessages++;

        this.emit('message-queued', message);

        // Start processing if not already running
        if (!this.isProcessing && !this.isPaused) {
          this.startProcessing();
        }

        // In test mode, trigger immediate processing for this message only
        if (this.testMode && this.isProcessing) {
          setImmediate(() => this.processNextMessage());
        }
      } catch (error) {
        // Queue full or other queueing error
        reject(error);
      }
    });
  }

  /**
   * Send a message immediately without queuing
   * @param {Object} channel - Discord channel object
   * @param {string|Object} content - Message content
   * @param {Object} options - Message options
   * @returns {Promise<Object>} Discord API response
   */
  async sendImmediate(channel, content, options = {}) {
    const message = new Message({
      channel,
      content,
      options,
      priority: 1000, // Highest priority
    });

    this.globalMetrics.totalMessages++;

    try {
      const result = await this.processor.processMessage(message);
      this.globalMetrics.successfulSends++;

      this.emit('message-sent', message, result);
      return result;
    } catch (error) {
      this.globalMetrics.failedSends++;
      this.emit('message-failed', message, error);
      throw error;
    }
  }

  /**
   * Start processing the message queue
   */
  startProcessing() {
    if (this.isProcessing) {
      this.logger.warn('Message processing already running');
      return;
    }

    if (this.isPaused) {
      this.logger.warn('Message processing is paused');
      return;
    }

    this.isProcessing = true;
    this.processingPromise = new Promise(resolve => {
      this._processingResolve = resolve;
    });

    this.emit('processing-started');
    this.logger.info('Started message processing', {
      queueSize: this.queue.size(),
      testMode: this.testMode,
    });

    // Start the processing loop
    this.scheduleProcessing();
  }

  /**
   * Stop processing the message queue
   * @param {number} timeoutMs - Timeout for graceful shutdown
   * @returns {Promise<void>}
   */
  async stopProcessing(timeoutMs = 5000) {
    if (!this.isProcessing) {
      return;
    }

    this.logger.info('Stopping message processing', {
      queueSize: this.queue.size(),
      timeout: timeoutMs,
    });

    this.isProcessing = false;
    this.scheduler.stop();

    // Wait for current processing to complete
    if (this.processingPromise) {
      const timeoutPromise = new Promise(resolve => setTimeout(resolve, timeoutMs));
      await Promise.race([this.processingPromise, timeoutPromise]);
    }

    if (this._processingResolve) {
      this._processingResolve();
    }

    this.emit('processing-stopped');
    this.logger.info('Message processing stopped');
  }

  /**
   * Pause processing (can be resumed)
   * @param {string} reason - Reason for pausing
   */
  pauseProcessing(reason = 'Manual pause') {
    if (this.isPaused) {
      return;
    }

    this.isPaused = true;
    this.scheduler.stop();

    this.emit('processing-paused', reason);
    this.logger.info('Message processing paused', { reason });
  }

  /**
   * Resume processing
   */
  resumeProcessing() {
    if (!this.isPaused) {
      return;
    }

    this.isPaused = false;

    this.emit('processing-resumed');
    this.logger.info('Message processing resumed', {
      queueSize: this.queue.size(),
    });

    if (this.isProcessing) {
      this.scheduleProcessing();
    }
  }

  /**
   * Schedule processing loop
   */
  scheduleProcessing() {
    if (!this.isProcessing || this.isPaused) {
      return;
    }

    this.scheduler.scheduleNextCheck(() => this.processNextBatch(), this.queue.isEmpty());
  }

  /**
   * Process next batch of messages
   */
  async processNextBatch() {
    if (!this.isProcessing || this.isPaused) {
      return;
    }

    try {
      let processedCount = 0;
      const maxBatchSize = Math.min(this.maxConcurrentProcessing, this.queue.size());

      // Process messages in batch
      const promises = [];
      for (let i = 0; i < maxBatchSize && !this.queue.isEmpty(); i++) {
        promises.push(this.processNextMessage());
      }

      if (promises.length > 0) {
        const results = await Promise.allSettled(promises);
        processedCount = results.filter(r => r.status === 'fulfilled').length;

        this.emit('batch-processed', {
          processed: processedCount,
          total: results.length,
          remaining: this.queue.size(),
        });
      }

      // Schedule next processing cycle (only if not in test mode or queue has items)
      if (!this.testMode || !this.queue.isEmpty()) {
        this.scheduleProcessing();
      }
    } catch (error) {
      this.logger.error('Error in processing batch', error);
      this.emit('processing-error', error);

      // Continue processing despite errors (only if not in test mode)
      if (!this.testMode) {
        this.scheduleProcessing();
      }
    }
  }

  /**
   * Process the next message in the queue
   * @returns {Promise<Object|null>} Processing result or null if no messages
   */
  async processNextMessage() {
    if (this.queue.isEmpty()) {
      return null;
    }

    const message = this.queue.dequeue();
    if (!message) {
      return null;
    }

    const startTime = Date.now();

    try {
      const result = await this.processor.processMessage(message);

      // Update metrics
      const queueTime = startTime - message.createdAt;
      this.updateQueueTimeMetrics(queueTime);
      this.globalMetrics.successfulSends++;

      this.emit('message-processed', message, result);
      return result;
    } catch (error) {
      return await this.handleMessageError(message, error);
    }
  }

  /**
   * Handle message processing errors
   * @param {Message} message - Message that failed
   * @param {Error} error - Error that occurred
   */
  async handleMessageError(message, error) {
    if (error instanceof RateLimitError) {
      // Re-queue message for later processing
      this.queue.enqueue(message);
      this.emit('message-rate-limited', message, error);

      // Pause processing if reactive rate limit
      if (error.type === 'reactive') {
        this.pauseProcessing(`Rate limited: ${error.message}`);

        // Resume after rate limit expires
        setTimeout(() => {
          this.resumeProcessing();
        }, error.retryAfter);
      }

      return null;
    } else if (error instanceof RetryableError) {
      // Re-queue message for retry
      this.queue.enqueue(message);
      this.emit('message-retry', message, error);

      return null;
    } else {
      // Permanent failure
      this.globalMetrics.failedSends++;
      this.emit('message-failed', message, error);

      throw error;
    }
  }

  /**
   * Clear all messages from queue
   * @param {string} reason - Reason for clearing
   * @returns {Array<Message>} Cleared messages
   */
  clearQueue(reason = 'Queue cleared') {
    const cleared = this.queue.clear();

    // Reject all cleared messages
    cleared.forEach(message => {
      if (message.reject) {
        message.reject(new Error(reason));
      }
    });

    this.emit('queue-cleared', { count: cleared.length, reason });
    this.logger.info('Queue cleared', { count: cleared.length, reason });

    return cleared;
  }

  /**
   * Graceful shutdown
   * @param {number} timeoutMs - Timeout for shutdown
   * @returns {Promise<void>}
   */
  async shutdown(timeoutMs = 30000) {
    this.logger.info('Starting graceful shutdown', {
      queueSize: this.queue.size(),
      timeout: timeoutMs,
    });

    const startTime = Date.now();

    // Wait for queue to empty or timeout
    while (this.queue.size() > 0 && Date.now() - startTime < timeoutMs) {
      if (!this.testMode) {
        await this.scheduler.getNextDelay();
      } else {
        // In test mode, process remaining messages immediately
        await this.processNextBatch();
      }
    }

    // Stop processing
    await this.stopProcessing(Math.max(1000, timeoutMs - (Date.now() - startTime)));

    // Clear remaining messages
    if (this.queue.size() > 0) {
      this.clearQueue('Shutdown timeout reached');
    }

    this.emit('shutdown-complete');
    this.logger.info('Graceful shutdown complete');
  }

  /**
   * Setup event handlers for internal events
   */
  setupEventHandlers() {
    // Forward processor events
    this.processor.rateLimiter.on?.('rate-limited', info => {
      this.emit('rate-limited', info);
    });

    // Handle processing errors
    this.on('processing-error', error => {
      this.logger.error('Processing error', error);
    });

    // Handle message events for logging
    this.on('message-processed', (message, _result) => {
      this.logger.verbose('Message processed successfully', {
        messageId: message.id,
        processingTime: message.getProcessingTime(),
      });
    });

    this.on('message-failed', (message, error) => {
      this.logger.error('Message failed permanently', {
        messageId: message.id,
        error: error.message,
        retryCount: message.retryCount,
        messageContent: this.sanitizeMessageContent(message),
      });
    });
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
   * Update queue time metrics
   * @param {number} queueTime - Time in queue in milliseconds
   */
  updateQueueTimeMetrics(queueTime) {
    this.globalMetrics.maxQueueTime = Math.max(this.globalMetrics.maxQueueTime, queueTime);

    const { totalMessages } = this.globalMetrics;
    if (totalMessages > 0) {
      const currentAverage = this.globalMetrics.averageQueueTime;
      this.globalMetrics.averageQueueTime = (currentAverage * (totalMessages - 1) + queueTime) / totalMessages;
    }
  }

  /**
   * Get comprehensive metrics
   * @returns {Object} All metrics from all components
   */
  getMetrics() {
    const uptime = Date.now() - this.globalMetrics.startedAt;
    const messagesPerSecond = uptime > 0 ? this.globalMetrics.totalMessages / (uptime / 1000) : 0;

    return {
      global: {
        ...this.globalMetrics,
        uptime,
        messagesPerSecond: Math.round(messagesPerSecond * 100) / 100,
        currentQueueSize: this.queue.size(),
        isProcessing: this.isProcessing,
        isPaused: this.isPaused,
        testMode: this.testMode,
      },
      queue: this.queue.getStats(),
      rateLimiter: this.rateLimiter.getMetrics(),
      retryHandler: this.retryHandler.getMetrics(),
      processor: this.processor.getMetrics(),
      scheduler: this.scheduler.getMetrics(),
    };
  }

  /**
   * Generate a unique task ID (for compatibility)
   * @returns {string} Unique task ID
   */
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
