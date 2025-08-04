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

    // Sampling configuration (can be overridden per operation)
    this.defaultSamplingRates = {
      debug: 0.1, // Log 10% of debug messages by default
      verbose: 0.05, // Log 5% of verbose messages by default
      info: 1.0, // Log all info messages by default
      warn: 1.0, // Log all warnings
      error: 1.0, // Log all errors
    };

    // Operation sampling counters
    this.samplingCounters = new Map();
  }

  /**
   * Generate a correlation ID for operation tracking
   * @returns {string} Unique correlation ID
   */
  generateCorrelationId() {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Check if a message should be logged based on sampling rate
   * @param {string} level - Log level (debug, verbose, info, warn, error)
   * @param {string} operationName - Operation name for sampling tracking
   * @param {number} sampleRate - Custom sample rate (0.0-1.0), defaults to level default
   * @returns {boolean} True if message should be logged
   */
  shouldSample(level, operationName = 'default', sampleRate = null) {
    const rate = sampleRate !== null ? sampleRate : this.defaultSamplingRates[level] || 1.0;

    // Always log if rate is 1.0 (100%)
    if (rate >= 1.0) {
      return true;
    }

    // Never log if rate is 0.0 (0%)
    if (rate <= 0.0) {
      return false;
    }

    // Use deterministic sampling based on operation counter for consistency
    const counterKey = `${this.moduleName}.${operationName}.${level}`;
    const currentCount = (this.samplingCounters.get(counterKey) || 0) + 1;
    this.samplingCounters.set(counterKey, currentCount);

    // Sample every Nth message where N = 1/rate
    const interval = Math.ceil(1 / rate);
    return currentCount % interval === 0;
  }

  /**
   * Set sampling rate for a specific level and operation
   * @param {string} level - Log level
   * @param {number} rate - Sample rate (0.0-1.0)
   * @param {string} operationName - Optional operation name for specific sampling
   */
  setSamplingRate(level, rate, operationName = null) {
    if (operationName) {
      const key = `${this.moduleName}.${operationName}.${level}`;
      this.samplingCounters.set(key, 0); // Reset counter when changing rate
    } else {
      this.defaultSamplingRates[level] = rate;
    }
  }

  /**
   * Start a sampled tracked operation (logs only a percentage of operations)
   * @param {string} operationName - Name of the operation
   * @param {Object} context - Additional context for the operation
   * @param {number} sampleRate - Custom sample rate (0.0-1.0), defaults to 0.1 for high-volume ops
   * @returns {Object|null} Operation tracker or null if not sampled
   */
  startSampledOperation(operationName, context = {}, sampleRate = 0.1) {
    // Check if this operation should be sampled
    if (!this.shouldSample('debug', operationName, sampleRate)) {
      // Return a no-op operation tracker that still records metrics but doesn't log
      return this.createNoOpOperation(operationName, context);
    }

    // Log this operation normally
    return this.startOperation(operationName, { ...context, sampled: true });
  }

  /**
   * Create a no-op operation tracker that records metrics but doesn't log
   * @private
   */
  createNoOpOperation(operationName, context = {}) {
    const startTime = nowUTC();
    const correlationId = context.correlationId || this.generateCorrelationId();

    return {
      name: operationName,
      correlationId,
      startTime,
      context: { ...context, correlationId, noLog: true },

      success: (message, additionalContext = {}) => {
        const duration = nowUTC() - startTime;
        this.recordMetrics(operationName, duration, true);
        return { correlationId, duration, success: true, sampled: false };
      },

      error: (error, message, additionalContext = {}) => {
        const duration = nowUTC() - startTime;
        this.recordMetrics(operationName, duration, false);
        // Always log errors regardless of sampling
        this.error(message, {
          ...context,
          ...additionalContext,
          duration,
          error: error?.message,
          stack: error?.stack,
          outcome: 'error',
        });
        return { correlationId, duration, success: false, error, sampled: false };
      },

      progress: (message, progressContext = {}) => {
        // No-op for progress in sampled operations
        return { correlationId, currentDuration: nowUTC() - startTime };
      },
    };
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
   * Log error with inline object stringification
   * @param {string} message - Base error message
   * @param {Object} obj - Object to stringify inline
   */
  errorWithObject(message, obj) {
    const objStr = typeof obj === 'object' && obj !== null ? JSON.stringify(obj) : String(obj);
    this.error(`${message}: ${objStr}`);
  }

  /**
   * Log warning with inline object stringification
   * @param {string} message - Base warning message
   * @param {Object} obj - Object to stringify inline
   */
  warnWithObject(message, obj) {
    const objStr = typeof obj === 'object' && obj !== null ? JSON.stringify(obj) : String(obj);
    this.warn(`${message}: ${objStr}`);
  }

  /**
   * Log info with inline object stringification
   * @param {string} message - Base info message
   * @param {Object} obj - Object to stringify inline
   */
  infoWithObject(message, obj) {
    const objStr = typeof obj === 'object' && obj !== null ? JSON.stringify(obj) : String(obj);
    this.info(`${message}: ${objStr}`);
  }

  /**
   * Log debug message with sampling (for high-volume operations)
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   * @param {string} operationName - Operation name for sampling
   * @param {number} sampleRate - Custom sample rate (0.0-1.0)
   */
  debugSampled(message, context = {}, operationName = 'default', sampleRate = 0.1) {
    this.log('debug', 4, message, { ...context, operationName, sampleRate });
  }

  /**
   * Log verbose message with sampling (for very high-volume operations)
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   * @param {string} operationName - Operation name for sampling
   * @param {number} sampleRate - Custom sample rate (0.0-1.0)
   */
  verboseSampled(message, context = {}, operationName = 'default', sampleRate = 0.05) {
    this.log('verbose', 5, message, { ...context, operationName, sampleRate });
  }

  /**
   * Log info message with sampling
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   * @param {string} operationName - Operation name for sampling
   * @param {number} sampleRate - Custom sample rate (0.0-1.0)
   */
  infoSampled(message, context = {}, operationName = 'default', sampleRate = 0.5) {
    this.log('info', 3, message, { ...context, operationName, sampleRate });
  }

  /**
   * Core logging method with debug level filtering and sampling
   * @private
   */
  log(level, levelNumber, message, context = {}) {
    // Check sampling first (unless it's an error/warning or no-log context)
    const operationName = context.operationName || 'default';
    const customSampleRate = context.sampleRate;

    // Skip sampling check for errors/warnings and forced no-log contexts
    if (levelNumber > 2 && !context.noLog && !this.shouldSample(level, operationName, customSampleRate)) {
      return;
    }

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

    // Enhanced message with inline object stringification
    let enhancedMessage = message;

    // If context has complex objects, append them to the message for better visibility
    if (Object.keys(sanitizedContext).length > 3) {
      // More than just timestamp, module, and maybe one other field
      const contextKeys = Object.keys(sanitizedContext).filter(
        key => key !== 'timestamp' && key !== 'module' && sanitizedContext[key] !== undefined
      );

      if (contextKeys.length > 0) {
        const contextStr = contextKeys
          .map(key => {
            const value = sanitizedContext[key];
            if (typeof value === 'object' && value !== null) {
              return `${key}: ${JSON.stringify(value)}`;
            }
            return `${key}: ${value}`;
          })
          .join(', ');

        enhancedMessage = `${message} | ${contextStr}`;
      }
    }

    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](enhancedMessage, sanitizedContext);
    } else {
      // Fallback to console
      console[level] || console.log(`[${level.toUpperCase()}] ${enhancedMessage}`, sanitizedContext);
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
