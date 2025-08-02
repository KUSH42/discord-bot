/**
 * Content Detection Configuration
 * Centralized configuration for all content detection systems
 */
export const CONTENT_DETECTION_CONFIG = {
  // Unified content age threshold across all platforms
  MAX_CONTENT_AGE_HOURS: 24,

  // Duplicate detection settings
  DUPLICATE_DETECTION: {
    STORAGE: 'persistent', // 'persistent' vs 'memory'
    CLEANUP_INTERVAL_HOURS: 168, // 1 week
    MAX_MEMORY_ENTRIES: 10000, // Maximum entries in memory cache
    FINGERPRINT_ENABLED: true, // Enable content fingerprinting
  },

  // Livestream tracking configuration
  LIVESTREAM_TRACKING: {
    STATE_POLLING_INTERVAL: 30000, // 30 seconds
    TRANSITION_TIMEOUT: 300000, // 5 minutes
    ENABLE_SCHEDULED_MONITORING: true,
    SCHEDULED_CHECK_INTERVAL: 60000, // 1 minute
  },

  // Fallback system configuration
  FALLBACK_SYSTEM: {
    MAX_RETRIES: 3,
    BACKOFF_MULTIPLIER: 2,
    BASE_DELAY_MS: 5000,
    WEBHOOK_TIMEOUT_MS: 30000,
    ENABLE_SCRAPER_FALLBACK: true,
  },

  // Content validation settings
  CONTENT_VALIDATION: {
    ENABLE_CROSS_VALIDATION: true,
    VALIDATION_TIMEOUT_MS: 10000,
    REQUIRE_MULTIPLE_SOURCES: false, // Set to true for critical content
  },

  // System coordination settings
  COORDINATION: {
    PROCESSING_LOCK_TIMEOUT_MS: 30000,
    SOURCE_PRIORITY: ['webhook', 'api', 'scraper'], // Processing priority
    ENABLE_RACE_CONDITION_PREVENTION: true,
  },

  // Monitoring and metrics
  MONITORING: {
    ENABLE_METRICS: true,
    METRICS_RETENTION_HOURS: 168, // 1 week
    HEALTH_CHECK_INTERVAL: 300000, // 5 minutes
    ALERT_ON_MISSED_CONTENT: true,
  },

  // Storage configuration
  STORAGE: {
    DIRECTORY: 'data',
    ENABLE_COMPRESSION: false,
    BACKUP_INTERVAL_HOURS: 24,
    MAX_FILE_SIZE_MB: 100,
  },
};

/**
 * Get content detection configuration with environment variable overrides
 * @param {Object} env - Environment variables object (defaults to process.env)
 * @returns {Object} Configuration object with overrides applied
 */
export function getContentDetectionConfig(env = process.env) {
  const config = { ...CONTENT_DETECTION_CONFIG };

  // Apply environment variable overrides
  if (env.MAX_CONTENT_AGE_HOURS) {
    const hours = parseInt(env.MAX_CONTENT_AGE_HOURS, 10);
    if (!isNaN(hours) && hours > 0) {
      config.MAX_CONTENT_AGE_HOURS = hours;
    }
  }

  if (env.DUPLICATE_CLEANUP_INTERVAL_HOURS) {
    const hours = parseInt(env.DUPLICATE_CLEANUP_INTERVAL_HOURS, 10);
    if (!isNaN(hours) && hours > 0) {
      config.DUPLICATE_DETECTION.CLEANUP_INTERVAL_HOURS = hours;
    }
  }

  if (env.LIVESTREAM_POLLING_INTERVAL_MS) {
    const ms = parseInt(env.LIVESTREAM_POLLING_INTERVAL_MS, 10);
    if (!isNaN(ms) && ms > 0) {
      config.LIVESTREAM_TRACKING.STATE_POLLING_INTERVAL = ms;
    }
  }

  if (env.WEBHOOK_MAX_RETRIES) {
    const retries = parseInt(env.WEBHOOK_MAX_RETRIES, 10);
    if (!isNaN(retries) && retries >= 0) {
      config.FALLBACK_SYSTEM.MAX_RETRIES = retries;
    }
  }

  if (env.CONTENT_STORAGE_DIR) {
    config.STORAGE.DIRECTORY = env.CONTENT_STORAGE_DIR;
  }

  // Boolean overrides
  if (env.ENABLE_CONTENT_FINGERPRINTING !== undefined) {
    config.DUPLICATE_DETECTION.FINGERPRINT_ENABLED = env.ENABLE_CONTENT_FINGERPRINTING.toLowerCase() === 'true';
  }

  if (env.ENABLE_LIVESTREAM_MONITORING !== undefined) {
    config.LIVESTREAM_TRACKING.ENABLE_SCHEDULED_MONITORING = env.ENABLE_LIVESTREAM_MONITORING.toLowerCase() === 'true';
  }

  if (env.ENABLE_CROSS_VALIDATION !== undefined) {
    config.CONTENT_VALIDATION.ENABLE_CROSS_VALIDATION = env.ENABLE_CROSS_VALIDATION.toLowerCase() === 'true';
  }

  return config;
}

/**
 * Validate content detection configuration
 * @param {Object} config - Configuration to validate
 * @returns {Array} Array of validation errors (empty if valid)
 */
export function validateContentDetectionConfig(config) {
  const errors = [];

  // Validate required numeric values
  if (typeof config.MAX_CONTENT_AGE_HOURS !== 'number' || config.MAX_CONTENT_AGE_HOURS <= 0) {
    errors.push('MAX_CONTENT_AGE_HOURS must be a positive number');
  }

  if (config.MAX_CONTENT_AGE_HOURS > 168) {
    errors.push('MAX_CONTENT_AGE_HOURS should not exceed 168 hours (1 week)');
  }

  // Validate polling intervals
  const minPollingInterval = 10000; // 10 seconds
  if (config.LIVESTREAM_TRACKING.STATE_POLLING_INTERVAL < minPollingInterval) {
    errors.push(`STATE_POLLING_INTERVAL must be at least ${minPollingInterval}ms`);
  }

  // Validate retry configuration
  if (config.FALLBACK_SYSTEM.MAX_RETRIES > 10) {
    errors.push('MAX_RETRIES should not exceed 10');
  }

  if (config.FALLBACK_SYSTEM.BASE_DELAY_MS < 1000) {
    errors.push('BASE_DELAY_MS should be at least 1000ms');
  }

  // Validate storage directory
  if (!config.STORAGE.DIRECTORY || typeof config.STORAGE.DIRECTORY !== 'string') {
    errors.push('STORAGE.DIRECTORY must be a non-empty string');
  }

  // Validate source priority
  const validSources = ['webhook', 'api', 'scraper'];
  const prioritySources = config.COORDINATION.SOURCE_PRIORITY;

  if (!Array.isArray(prioritySources)) {
    errors.push('SOURCE_PRIORITY must be an array');
  } else {
    for (const source of prioritySources) {
      if (!validSources.includes(source)) {
        errors.push(`Invalid source in SOURCE_PRIORITY: ${source}`);
      }
    }
  }

  return errors;
}

/**
 * Create configuration manager with content detection settings
 * @param {Object} baseConfig - Base configuration manager
 * @returns {Object} Enhanced configuration manager
 */
export function createContentDetectionConfigManager(baseConfig) {
  const contentConfig = getContentDetectionConfig();
  const validationErrors = validateContentDetectionConfig(contentConfig);

  if (validationErrors.length > 0) {
    throw new Error(`Content detection configuration validation failed: ${validationErrors.join(', ')}`);
  }

  return {
    ...baseConfig,

    /**
     * Get content detection specific configuration
     * @param {string} key - Configuration key (supports dot notation)
     * @param {*} defaultValue - Default value if key not found
     */
    getContentDetection(key, defaultValue) {
      const keys = key.split('.');
      let value = contentConfig;

      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k];
        } else {
          return defaultValue;
        }
      }

      return value;
    },

    /**
     * Get all content detection configuration
     */
    getAllContentDetectionConfig() {
      return { ...contentConfig };
    },

    /**
     * Check if content detection feature is enabled
     * @param {string} feature - Feature name
     */
    isContentDetectionFeatureEnabled(feature) {
      switch (feature) {
        case 'fingerprinting':
          return contentConfig.DUPLICATE_DETECTION.FINGERPRINT_ENABLED;
        case 'livestream_monitoring':
          return contentConfig.LIVESTREAM_TRACKING.ENABLE_SCHEDULED_MONITORING;
        case 'cross_validation':
          return contentConfig.CONTENT_VALIDATION.ENABLE_CROSS_VALIDATION;
        case 'metrics':
          return contentConfig.MONITORING.ENABLE_METRICS;
        case 'scraper_fallback':
          return contentConfig.FALLBACK_SYSTEM.ENABLE_SCRAPER_FALLBACK;
        case 'race_condition_prevention':
          return contentConfig.COORDINATION.ENABLE_RACE_CONDITION_PREVENTION;
        default:
          return false;
      }
    },
  };
}
