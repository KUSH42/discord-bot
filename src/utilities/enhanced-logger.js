import crypto from 'crypto';
import { nowUTC, timestampUTC } from './utc-time.js';

/**
 * Enhanced logger wrapper with module-specific debugging, correlation IDs, and performance measurement
 */
export class EnhancedLogger {
  constructor(moduleName, baseLogger, debugFlagManager, metricsManager = null) {
    this.moduleName = moduleName;
    this.baseLogger = baseLogger;
    this.debugManager = debugFlagManager;
    this.metricsManager = metricsManager;

    // Create a child logger with module context
    this.logger = baseLogger?.child({ module: moduleName }) || console;

    // Active operations tracking
    this.activeOperations = new Map();
  }

  /**
   * Generate a correlation ID for operation tracking
   * @returns {string} Unique correlation ID
   */
  generateCorrelationId() {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Start a tracked operation with timing and correlation
   * @param {string} operationName - Name of the operation
   * @param {Object} context - Additional context for the operation
   * @returns {Object} Operation tracker with success/error methods
   */
  startOperation(operationName, context = {}) {
    const correlationId = context.correlationId || this.generateCorrelationId();
    const startTime = nowUTC();
    const startTimestamp = timestampUTC();

    const operation = {
      name: operationName,
      correlationId,
      startTime,
      startTimestamp,
      context: { ...context, correlationId },

      /**
       * Mark operation as successful
       * @param {string} message - Success message
       * @param {Object} additionalContext - Additional context
       */
      success: (message, additionalContext = {}) => {
        const duration = nowUTC() - startTime;
        const finalContext = {
          ...operation.context,
          ...additionalContext,
          duration,
          outcome: 'success',
        };

        this.info(message, finalContext);
        this.recordMetrics(operationName, duration, true);
        this.activeOperations.delete(correlationId);

        return { correlationId, duration, success: true };
      },

      /**
       * Mark operation as failed
       * @param {Error} error - Error that occurred
       * @param {string} message - Error message
       * @param {Object} additionalContext - Additional context
       */
      error: (error, message, additionalContext = {}) => {
        const duration = nowUTC() - startTime;
        const finalContext = {
          ...operation.context,
          ...additionalContext,
          duration,
          outcome: 'error',
          error: error?.message,
          stack: error?.stack,
        };

        this.error(message, finalContext);
        this.recordMetrics(operationName, duration, false);
        this.activeOperations.delete(correlationId);

        return { correlationId, duration, success: false, error };
      },

      /**
       * Add progress update to operation
       * @param {string} message - Progress message
       * @param {Object} progressContext - Progress-specific context
       */
      progress: (message, progressContext = {}) => {
        const currentDuration = nowUTC() - startTime;
        const finalContext = {
          ...operation.context,
          ...progressContext,
          currentDuration,
          outcome: 'progress',
        };

        this.debug(message, finalContext);

        return { correlationId, currentDuration };
      },
    };

    // Track active operation
    this.activeOperations.set(correlationId, operation);

    // Log operation start
    this.debug(`Starting operation: ${operationName}`, operation.context);

    return operation;
  }

  /**
   * Record metrics for an operation
   * @private
   */
  recordMetrics(operationName, duration, success) {
    if (!this.metricsManager) {
      return;
    }

    try {
      // Record timing metrics
      this.metricsManager.recordTiming(`${this.moduleName}.${operationName}`, duration);

      // Record success/failure counters
      if (success) {
        this.metricsManager.incrementCounter(`${this.moduleName}.${operationName}.success`);
      } else {
        this.metricsManager.incrementCounter(`${this.moduleName}.${operationName}.error`);
      }
    } catch (error) {
      // Don't let metrics recording break the main operation
      console.error('Failed to record metrics:', error);
    }
  }

  /**
   * Log error message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  error(message, context = {}) {
    this.log('error', 1, message, context);
  }

  /**
   * Log warning message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  warn(message, context = {}) {
    this.log('warn', 2, message, context);
  }

  /**
   * Log info message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  info(message, context = {}) {
    this.log('info', 3, message, context);
  }

  /**
   * Log debug message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  debug(message, context = {}) {
    this.log('debug', 4, message, context);
  }

  /**
   * Log verbose message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  verbose(message, context = {}) {
    this.log('verbose', 5, message, context);
  }

  /**
   * Core logging method with debug level filtering
   * @private
   */
  log(level, levelNumber, message, context = {}) {
    // Always log errors and warnings
    if (levelNumber <= 2) {
      this.executeLog(level, message, context);
      return;
    }

    // For info and above, check if debug is enabled for this module
    if (!this.debugManager) {
      // Fallback to basic logging if no debug manager
      this.executeLog(level, message, context);
      return;
    }

    try {
      if (this.debugManager.shouldLog(this.moduleName, levelNumber)) {
        this.executeLog(level, message, context);
      }
    } catch (error) {
      // Fallback to basic logging if debug manager fails
      console.error('Debug manager error:', error);
      this.executeLog(level, message, context);
    }
  }

  /**
   * Execute the actual log operation
   * @private
   */
  executeLog(level, message, context) {
    const enrichedContext = {
      ...context,
      timestamp: timestampUTC(),
      module: this.moduleName,
    };

    // Sanitize sensitive information
    const sanitizedContext = this.sanitizeContext(enrichedContext);

    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](message, sanitizedContext);
    } else {
      // Fallback to console
      console[level] || console.log(`[${level.toUpperCase()}] ${message}`, sanitizedContext);
    }
  }

  /**
   * Sanitize context to remove sensitive information
   * @private
   */
  sanitizeContext(context) {
    const sensitiveKeys = [
      'password',
      'token',
      'key',
      'secret',
      'auth',
      'credential',
      'authorization',
      'cookie',
      'session',
    ];

    const sanitized = { ...context };

    const sanitizeValue = (obj, path = []) => {
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }

      const result = Array.isArray(obj) ? [] : {};

      for (const [key, value] of Object.entries(obj)) {
        const keyLower = key.toLowerCase();
        const isSensitive = sensitiveKeys.some(sensitiveKey => keyLower.includes(sensitiveKey));

        if (isSensitive && typeof value === 'string') {
          result[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
          result[key] = sanitizeValue(value, [...path, key]);
        } else {
          result[key] = value;
        }
      }

      return result;
    };

    return sanitizeValue(sanitized);
  }

  /**
   * Get active operations for this logger instance
   * @returns {Array} Array of active operation info
   */
  getActiveOperations() {
    const operations = [];

    for (const [correlationId, operation] of this.activeOperations) {
      operations.push({
        correlationId,
        name: operation.name,
        startTime: operation.startTimestamp,
        duration: nowUTC() - operation.startTime,
        context: operation.context,
      });
    }

    return operations;
  }

  /**
   * Get statistics about this logger's usage
   * @returns {Object} Statistics object
   */
  getStats() {
    const activeOps = this.getActiveOperations();

    return {
      moduleName: this.moduleName,
      activeOperations: activeOps.length,
      longestRunningOperation: activeOps.length > 0 ? Math.max(...activeOps.map(op => op.duration)) : 0,
      debugEnabled: this.debugManager?.isEnabled(this.moduleName) || false,
      debugLevel: this.debugManager?.getLevel(this.moduleName) || 3,
    };
  }

  /**
   * Create a child logger with additional context
   * @param {Object} additionalContext - Context to add to all log messages
   * @returns {EnhancedLogger} Child logger instance
   */
  child(additionalContext = {}) {
    const childLogger = new EnhancedLogger(this.moduleName, this.baseLogger, this.debugManager, this.metricsManager);

    // Override the executeLog method to include additional context
    const originalExecuteLog = childLogger.executeLog.bind(childLogger);
    childLogger.executeLog = (level, message, context) => {
      const mergedContext = { ...additionalContext, ...context };
      originalExecuteLog(level, message, mergedContext);
    };

    return childLogger;
  }

  /**
   * Measure execution time of a function
   * @param {string} operationName - Name for the operation
   * @param {Function} fn - Function to measure
   * @param {Object} context - Additional context
   * @returns {Promise|*} Function result
   */
  async measure(operationName, fn, context = {}) {
    const operation = this.startOperation(operationName, context);

    try {
      const result = await fn();
      operation.success(`${operationName} completed`);
      return result;
    } catch (error) {
      operation.error(error, `${operationName} failed`);
      throw error;
    }
  }

  /**
   * Create a logger instance for a specific operation with correlation ID
   * @param {string} operationName - Name of the operation
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {EnhancedLogger} Logger with correlation context
   */
  forOperation(operationName, correlationId = null) {
    const id = correlationId || this.generateCorrelationId();
    return this.child({
      operation: operationName,
      correlationId: id,
    });
  }
}

/**
 * Create an enhanced logger instance
 * @param {string} moduleName - Name of the module
 * @param {Object} baseLogger - Base Winston logger
 * @param {DebugFlagManager} debugManager - Debug flag manager
 * @param {MetricsManager} metricsManager - Optional metrics manager
 * @returns {EnhancedLogger} Enhanced logger instance
 */
export function createEnhancedLogger(moduleName, baseLogger, debugManager, metricsManager = null) {
  return new EnhancedLogger(moduleName, baseLogger, debugManager, metricsManager);
}
