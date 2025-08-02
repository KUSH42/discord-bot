import {
  validateEnvironmentVariables,
  validateDiscordChannelId,
  validateYouTubeChannelId,
} from '../config-validator.js';

/**
 * Centralized configuration management with validation
 */
export class Configuration {
  constructor(source = process.env) {
    this.env = source;
    this.validated = this.validateAll();
  }

  /**
   * Get configuration value with optional default
   */
  get(key, defaultValue = undefined) {
    const value = this.env[key];
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Get required configuration value, throws if missing
   */
  getRequired(key) {
    const value = this.env[key];
    if (value === undefined) {
      throw new Error(`Required configuration key '${key}' is missing`);
    }
    return value;
  }

  /**
   * Get numeric configuration value
   */
  getNumber(key, defaultValue = undefined) {
    const value = this.get(key, defaultValue);
    if (value === undefined) {
      return undefined;
    }

    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      throw new Error(`Configuration key '${key}' must be a valid number, got: ${value}`);
    }
    return parsed;
  }

  /**
   * Get boolean configuration value
   */
  getBoolean(key, defaultValue = undefined) {
    const value = this.get(key);
    if (value === undefined) {
      return defaultValue;
    }

    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') {
      return true;
    }
    if (lower === 'false' || lower === '0' || lower === 'no') {
      return false;
    }

    throw new Error(`Configuration key '${key}' must be a boolean value, got: ${value}`);
  }

  /**
   * Validate all required configuration
   */
  validateAll() {
    try {
      // Use existing validation from config-validator
      const validationResult = validateEnvironmentVariables(this.env);

      // Additional specific validations
      this.validateDiscordConfig();
      this.validateYouTubeConfig();
      this.validateXConfig();
      this.validateBrowserStealthConfig();
      this.validateMonitoringConfig();

      return validationResult;
    } catch (error) {
      throw new Error(`Configuration validation failed: ${error.message}`);
    }
  }

  /**
   * Validate Discord-specific configuration
   */
  validateDiscordConfig() {
    const token = this.get('DISCORD_BOT_TOKEN');
    if (token && !token.startsWith('Bot ') && !token.match(/^[A-Za-z0-9._-]{59}$/)) {
      console.warn('Discord token format may be invalid');
    }

    const supportChannelId = this.get('DISCORD_SUPPORT_CHANNEL_ID');
    if (supportChannelId && !validateDiscordChannelId(supportChannelId)) {
      throw new Error('Invalid Discord support channel ID format');
    }

    const youtubeChannelId = this.get('DISCORD_YOUTUBE_CHANNEL_ID');
    if (youtubeChannelId && !validateDiscordChannelId(youtubeChannelId)) {
      throw new Error('Invalid Discord YouTube channel ID format');
    }

    const xChannelId = this.get('DISCORD_X_CHANNEL_ID');
    if (xChannelId && !validateDiscordChannelId(xChannelId)) {
      throw new Error('Invalid Discord X channel ID format');
    }
  }

  /**
   * Validate YouTube-specific configuration
   */
  validateYouTubeConfig() {
    const channelId = this.get('YOUTUBE_CHANNEL_ID');
    if (channelId && !validateYouTubeChannelId(channelId)) {
      throw new Error('Invalid YouTube channel ID format');
    }

    const apiKey = this.get('YOUTUBE_API_KEY');
    if (apiKey && apiKey.length < 30) {
      console.warn('YouTube API key seems too short');
    }
  }

  /**
   * Validate X (Twitter) configuration
   */
  validateXConfig() {
    const xUser = this.get('X_USER_HANDLE');
    if (xUser && (xUser.startsWith('@') || xUser.includes(' '))) {
      throw new Error('X_USER_HANDLE should be username without @ symbol and no spaces');
    }

    const interval = this.getNumber('X_QUERY_INTERVAL_MIN');
    if (interval !== undefined && interval < 60000) {
      console.warn('X query interval less than 1 minute may cause rate limiting');
    }
  }

  /**
   * Validate browser stealth and anti-detection configuration
   */
  validateBrowserStealthConfig() {
    // User agent rotation interval validation
    const rotationInterval = this.getNumber('USER_AGENT_ROTATION_INTERVAL');
    if (rotationInterval !== undefined && rotationInterval < 60000) {
      console.warn('User agent rotation interval less than 1 minute may be too frequent');
    }

    // Rate limiting interval validation
    const minInterval = this.getNumber('MIN_REQUEST_INTERVAL', 30000);
    const maxInterval = this.getNumber('MAX_REQUEST_INTERVAL', 300000);

    if (minInterval >= maxInterval) {
      throw new Error('MIN_REQUEST_INTERVAL must be less than MAX_REQUEST_INTERVAL');
    }

    if (minInterval < 10000) {
      console.warn('MIN_REQUEST_INTERVAL less than 10 seconds may trigger detection');
    }

    // Browser profile directory validation
    const profileDir = this.get('BROWSER_PROFILE_DIR', './browser-profiles');
    if (profileDir.includes('..') || profileDir.startsWith('/etc/') || profileDir.startsWith('/sys/')) {
      throw new Error('BROWSER_PROFILE_DIR path appears unsafe');
    }

    // Rate limiter configuration validation
    const burstThreshold = this.getNumber('RATE_LIMITER_BURST_THRESHOLD', 8);
    if (burstThreshold < 3 || burstThreshold > 20) {
      console.warn('RATE_LIMITER_BURST_THRESHOLD should be between 3 and 20 for optimal performance');
    }

    const maxPenalty = parseFloat(this.get('RATE_LIMITER_MAX_PENALTY', '1.5'));
    if (maxPenalty < 1.0 || maxPenalty > 3.0) {
      console.warn('RATE_LIMITER_MAX_PENALTY should be between 1.0 and 3.0');
    }
  }

  /**
   * Validate monitoring configuration
   */
  validateMonitoringConfig() {
    // Detection monitoring validation
    const alertThreshold = this.getNumber('DETECTION_ALERT_THRESHOLD', 3);
    if (alertThreshold < 1 || alertThreshold > 10) {
      console.warn('DETECTION_ALERT_THRESHOLD should be between 1 and 10');
    }

    const monitoringWindow = this.getNumber('DETECTION_MONITORING_WINDOW', 3600000);
    if (monitoringWindow < 300000) {
      // Less than 5 minutes
      console.warn('DETECTION_MONITORING_WINDOW less than 5 minutes may cause false alerts');
    }

    // Performance monitoring validation
    const samplingInterval = this.getNumber('PERFORMANCE_SAMPLING_INTERVAL', 30000);
    if (samplingInterval < 5000) {
      console.warn('PERFORMANCE_SAMPLING_INTERVAL less than 5 seconds may impact performance');
    }

    const memoryThreshold = this.getNumber('PERFORMANCE_MEMORY_THRESHOLD', 1073741824);
    if (memoryThreshold < 134217728) {
      // Less than 128MB
      console.warn('PERFORMANCE_MEMORY_THRESHOLD less than 128MB may cause frequent alerts');
    }

    const cpuThreshold = this.getNumber('PERFORMANCE_CPU_THRESHOLD', 80);
    if (cpuThreshold < 50 || cpuThreshold > 95) {
      console.warn('PERFORMANCE_CPU_THRESHOLD should be between 50 and 95');
    }

    // Profile management validation
    const maxAgeDays = this.getNumber('PROFILE_MAX_AGE_DAYS', 30);
    if (maxAgeDays < 1) {
      throw new Error('PROFILE_MAX_AGE_DAYS must be at least 1 day');
    }

    const sessionTimeout = this.getNumber('PROFILE_SESSION_TIMEOUT', 86400000);
    if (sessionTimeout < 3600000) {
      // Less than 1 hour
      console.warn('PROFILE_SESSION_TIMEOUT less than 1 hour may cause frequent profile regeneration');
    }
  }

  /**
   * Get browser stealth configuration
   * @returns {Object} Browser stealth configuration
   */
  getBrowserStealthConfig() {
    return {
      stealthEnabled: this.getBoolean('BROWSER_STEALTH_ENABLED', true),
      behaviorSimulationEnabled: this.getBoolean('BEHAVIOR_SIMULATION_ENABLED', true),
      headless: this.getBoolean('BROWSER_HEADLESS', false),
      userAgentRotationInterval: this.getNumber('USER_AGENT_ROTATION_INTERVAL', 3600000),
      intelligentRateLimiting: this.getBoolean('INTELLIGENT_RATE_LIMITING', true),
      minRequestInterval: this.getNumber('MIN_REQUEST_INTERVAL', 30000),
      maxRequestInterval: this.getNumber('MAX_REQUEST_INTERVAL', 300000),
      profilePersistence: this.getBoolean('BROWSER_PROFILE_PERSISTENCE', true),
      profileDir: this.get('BROWSER_PROFILE_DIR', './browser-profiles'),
      mouseMovementEnabled: this.getBoolean('MOUSE_MOVEMENT_ENABLED', true),
      scrollingSimulationEnabled: this.getBoolean('SCROLLING_SIMULATION_ENABLED', true),
      readingTimeSimulation: this.getBoolean('READING_TIME_SIMULATION', true),
      interactionSimulationEnabled: this.getBoolean('INTERACTION_SIMULATION_ENABLED', true),
    };
  }

  /**
   * Get detection monitoring configuration
   * @returns {Object} Detection monitoring configuration
   */
  getDetectionMonitoringConfig() {
    return {
      enabled: this.getBoolean('DETECTION_MONITORING_ENABLED', true),
      alertThreshold: this.getNumber('DETECTION_ALERT_THRESHOLD', 3),
      monitoringWindow: this.getNumber('DETECTION_MONITORING_WINDOW', 3600000),
      maxIncidentHistory: this.getNumber('DETECTION_MAX_INCIDENT_HISTORY', 1000),
    };
  }

  /**
   * Get performance monitoring configuration
   * @returns {Object} Performance monitoring configuration
   */
  getPerformanceMonitoringConfig() {
    return {
      enabled: this.getBoolean('PERFORMANCE_MONITORING_ENABLED', true),
      samplingInterval: this.getNumber('PERFORMANCE_SAMPLING_INTERVAL', 30000),
      maxSamples: this.getNumber('PERFORMANCE_MAX_SAMPLES', 1000),
      alertThresholds: {
        memoryUsage: this.getNumber('PERFORMANCE_MEMORY_THRESHOLD', 1073741824),
        cpuUsage: this.getNumber('PERFORMANCE_CPU_THRESHOLD', 80),
        responseTime: this.getNumber('PERFORMANCE_RESPONSE_TIME_THRESHOLD', 30000),
      },
    };
  }

  /**
   * Get rate limiter configuration
   * @returns {Object} Rate limiter configuration
   */
  getRateLimiterConfig() {
    return {
      enabled: this.getBoolean('INTELLIGENT_RATE_LIMITING', true),
      minInterval: this.getNumber('MIN_REQUEST_INTERVAL', 30000),
      maxInterval: this.getNumber('MAX_REQUEST_INTERVAL', 300000),
      burstThreshold: this.getNumber('RATE_LIMITER_BURST_THRESHOLD', 8),
      maxPenaltyMultiplier: parseFloat(this.get('RATE_LIMITER_MAX_PENALTY', '1.5')),
      penaltyDecayTime: this.getNumber('RATE_LIMITER_PENALTY_DECAY_TIME', 1800000),
    };
  }

  /**
   * Get browser profile management configuration
   * @returns {Object} Profile management configuration
   */
  getProfileManagementConfig() {
    return {
      enabled: this.getBoolean('BROWSER_PROFILE_PERSISTENCE', true),
      profileDir: this.get('BROWSER_PROFILE_DIR', './browser-profiles'),
      cleanupEnabled: this.getBoolean('PROFILE_CLEANUP_ENABLED', true),
      maxAgeDays: this.getNumber('PROFILE_MAX_AGE_DAYS', 30),
      sessionTimeout: this.getNumber('PROFILE_SESSION_TIMEOUT', 86400000),
    };
  }

  /**
   * Get all configuration as object (for debugging)
   */
  getAllConfig(includeSecrets = false) {
    const config = {};
    const secretKeys = ['DISCORD_BOT_TOKEN', 'YOUTUBE_API_KEY', 'WEBHOOK_SECRET'];

    for (const [key, value] of Object.entries(this.env)) {
      if (
        key.startsWith('DISCORD_') ||
        key.startsWith('YOUTUBE_') ||
        key.startsWith('X_') ||
        key.startsWith('WEBHOOK_') ||
        key.startsWith('BROWSER_') ||
        key.startsWith('DETECTION_') ||
        key.startsWith('PERFORMANCE_') ||
        key.startsWith('MOUSE_') ||
        key.startsWith('SCROLLING_') ||
        key.startsWith('READING_') ||
        key.startsWith('INTERACTION_') ||
        key.startsWith('RATE_LIMITER_') ||
        key.startsWith('PROFILE_') ||
        key.startsWith('USER_AGENT_') ||
        key.startsWith('MIN_REQUEST_') ||
        key.startsWith('MAX_REQUEST_') ||
        key.startsWith('INTELLIGENT_') ||
        key.startsWith('STEALTH_')
      ) {
        if (includeSecrets || !secretKeys.includes(key)) {
          config[key] = value;
        } else if (secretKeys.includes(key)) {
          config[key] = '[REDACTED]';
        }
      }
    }

    return config;
  }

  /**
   * Check if configuration is valid
   */
  isValid() {
    try {
      this.validateAll();
      return true;
    } catch {
      return false;
    }
  }
}
