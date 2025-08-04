import { createEnhancedLogger } from '../../../utilities/enhanced-logger.js';

/**
 * Processing Scheduler for Discord Message Sender
 * Manages timing and scheduling of message processing in a testable way
 */
export class ProcessingScheduler {
  constructor(dependencies = {}) {
    const { logger, debugManager, metricsManager, ...options } = dependencies;

    // Create enhanced logger for performance monitoring
    if (logger && debugManager && metricsManager) {
      this.logger = createEnhancedLogger('performance', logger, debugManager, metricsManager);
    } else {
      this.logger = logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    }
    // Configuration
    this.testMode = options.testMode || false;
    this.baseCheckInterval = options.baseCheckInterval || 100; // ms between checks
    this.idleCheckInterval = options.idleCheckInterval || 1000; // ms when queue is empty
    this.maxJitter = options.maxJitter || 0.1; // 10% jitter by default
    this.enableJitter = options.enableJitter !== false;

    // State
    this.currentTimeout = null;
    this.isScheduled = false;
    this.lastScheduledTime = 0;
    this.scheduledCallbacks = new Set();

    // Test mode helpers
    this.testModeQueue = [];
    this.testModeExecutionCount = 0;

    // Metrics
    this.metrics = {
      totalSchedules: 0,
      averageDelay: 0,
      maxDelay: 0,
      missedSchedules: 0,
      testModeExecutions: 0,
    };
  }

  /**
   * Check if running in test mode
   * @returns {boolean} True if in test mode
   */
  isTestMode() {
    return this.testMode;
  }

  /**
   * Schedule a callback to run
   * @param {Function} callback - Callback to execute
   * @param {number} delay - Optional delay override
   * @returns {Object} Schedule information
   */
  schedule(callback, delay = null) {
    if (!callback || typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }

    const operation = this.logger.startOperation('scheduleCallback', {
      testMode: this.testMode,
      requestedDelay: delay,
    });

    this.metrics.totalSchedules++;
    const actualDelay = delay !== null ? delay : this.calculateDelay();

    operation.progress(`Calculated delay: ${actualDelay}ms`);

    let result;
    if (this.testMode) {
      result = this.scheduleTestMode(callback, actualDelay);
      operation.success('Scheduled in test mode', { actualDelay, mode: 'immediate' });
    } else {
      result = this.scheduleProduction(callback, actualDelay);
      operation.success('Scheduled in production mode', { actualDelay, mode: 'timeout' });
    }

    return result;
  }

  /**
   * Schedule callback for test mode (synchronous execution)
   * @param {Function} callback - Callback to execute
   * @param {number} delay - Delay (ignored in test mode)
   * @returns {Object} Schedule information
   */
  scheduleTestMode(callback, _delay) {
    // In test mode, execute immediately without queueing
    try {
      if (typeof callback === 'function') {
        callback();
      }
    } catch (error) {
      console.error('Test mode callback error:', error);
    }

    this.metrics.testModeExecutions++;
    this.testModeExecutionCount++;

    return {
      testMode: true,
      delay: 0,
      executedImmediately: true,
    };
  }

  /**
   * Execute callbacks in test mode
   */
  async executeTestModeCallbacks() {
    this.metrics.testModeExecutions++;
    this.testModeExecutionCount++;

    while (this.testModeQueue.length > 0) {
      const item = this.testModeQueue.shift();

      try {
        if (typeof item.callback === 'function') {
          await item.callback();
        }
      } catch (error) {
        console.error('Test mode callback error:', error);
      }
    }
  }

  /**
   * Schedule callback for production mode
   * @param {Function} callback - Callback to execute
   * @param {number} delay - Delay in milliseconds
   * @returns {Object} Schedule information
   */
  scheduleProduction(callback, delay) {
    // Clear existing timeout
    this.clearCurrentTimeout();

    const wrappedCallback = this.wrapCallback(callback, delay);

    this.currentTimeout = setTimeout(wrappedCallback, delay);
    this.isScheduled = true;
    this.lastScheduledTime = Date.now();

    this.scheduledCallbacks.add(callback);
    this.updateDelayMetrics(delay);

    return {
      testMode: false,
      delay,
      scheduledAt: this.lastScheduledTime,
    };
  }

  /**
   * Wrap callback with error handling and cleanup
   * @param {Function} callback - Original callback
   * @param {number} delay - Scheduled delay
   * @returns {Function} Wrapped callback
   */
  wrapCallback(callback, _delay) {
    return async () => {
      this.isScheduled = false;
      this.currentTimeout = null;
      this.scheduledCallbacks.delete(callback);

      try {
        await callback();
      } catch (error) {
        console.error('Scheduled callback error:', error);
        this.metrics.missedSchedules++;
      }
    };
  }

  /**
   * Schedule after a specific delay
   * @param {Function} callback - Callback to execute
   * @param {number} delay - Delay in milliseconds
   * @returns {Object} Schedule information
   */
  scheduleAfter(callback, delay) {
    return this.schedule(callback, delay);
  }

  /**
   * Schedule next check (for continuous processing)
   * @param {Function} callback - Callback to execute
   * @param {boolean} isIdle - Whether queue is idle
   * @returns {Object} Schedule information
   */
  scheduleNextCheck(callback, isIdle = false) {
    const delay = isIdle ? this.idleCheckInterval : this.baseCheckInterval;
    return this.schedule(callback, delay);
  }

  /**
   * Get delay for next processing cycle
   * @param {boolean} isIdle - Whether queue is idle
   * @returns {Promise<void>} Promise that resolves after delay
   */
  async getNextDelay(isIdle = false) {
    const delay = this.calculateDelay(isIdle);

    if (this.testMode) {
      // In test mode, return immediately resolved promise
      return Promise.resolve();
    } else {
      // In production, return promise that resolves after delay
      return new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  /**
   * Calculate delay with optional jitter
   * @param {boolean} isIdle - Whether queue is idle
   * @returns {number} Delay in milliseconds
   */
  calculateDelay(isIdle = false) {
    let baseDelay = isIdle ? this.idleCheckInterval : this.baseCheckInterval;

    if (this.enableJitter && !this.testMode) {
      const jitter = baseDelay * this.maxJitter * (Math.random() - 0.5);
      baseDelay += jitter;
    }

    return Math.max(Math.floor(baseDelay), 1);
  }

  /**
   * Stop all scheduled operations
   */
  stop() {
    this.clearCurrentTimeout();
    this.scheduledCallbacks.clear();

    // Clear test mode queue
    this.testModeQueue = [];

    this.isScheduled = false;
  }

  /**
   * Clear current timeout if exists
   */
  clearCurrentTimeout() {
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
      this.currentTimeout = null;
      this.isScheduled = false;
    }
  }

  /**
   * Check if there are pending scheduled operations
   * @returns {boolean} True if operations are scheduled
   */
  hasPendingOperations() {
    return this.isScheduled || this.testModeQueue.length > 0;
  }

  /**
   * Force execution of test mode queue (for testing)
   */
  async flushTestModeQueue() {
    if (this.testMode) {
      await this.executeTestModeCallbacks();
    }
  }

  /**
   * Update delay metrics
   * @param {number} delay - Delay in milliseconds
   */
  updateDelayMetrics(delay) {
    this.metrics.maxDelay = Math.max(this.metrics.maxDelay, delay);

    // Calculate running average
    const { totalSchedules } = this.metrics;
    if (totalSchedules > 0) {
      const currentAverage = this.metrics.averageDelay;
      this.metrics.averageDelay = (currentAverage * (totalSchedules - 1) + delay) / totalSchedules;
    }
  }

  /**
   * Get scheduler status
   * @returns {Object} Current status
   */
  getStatus() {
    return {
      testMode: this.testMode,
      isScheduled: this.isScheduled,
      pendingCallbacks: this.scheduledCallbacks.size,
      testModeQueueSize: this.testModeQueue.length,
      testModeExecutions: this.testModeExecutionCount,
      lastScheduledTime: this.lastScheduledTime,
      hasPendingOperations: this.hasPendingOperations(),
    };
  }

  /**
   * Get scheduler metrics
   * @returns {Object} Performance metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      status: this.getStatus(),
      configuration: {
        testMode: this.testMode,
        baseCheckInterval: this.baseCheckInterval,
        idleCheckInterval: this.idleCheckInterval,
        enableJitter: this.enableJitter,
        maxJitter: this.maxJitter,
      },
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalSchedules: 0,
      averageDelay: 0,
      maxDelay: 0,
      missedSchedules: 0,
      testModeExecutions: 0,
    };
    this.testModeExecutionCount = 0;
  }

  /**
   * Create a scheduler optimized for testing
   * @param {Object} options - Additional options
   * @returns {ProcessingScheduler} Scheduler instance for testing
   */
  static forTesting(options = {}) {
    return new ProcessingScheduler({
      testMode: true,
      baseCheckInterval: 0,
      idleCheckInterval: 0,
      enableJitter: false,
      ...options,
    });
  }

  /**
   * Create a scheduler optimized for production
   * @param {Object} options - Additional options
   * @returns {ProcessingScheduler} Scheduler instance for production
   */
  static forProduction(options = {}) {
    return new ProcessingScheduler({
      testMode: false,
      baseCheckInterval: 100,
      idleCheckInterval: 1000,
      enableJitter: true,
      maxJitter: 0.1,
      ...options,
    });
  }
}
