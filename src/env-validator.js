// env-validator.js
// Configuration validation utilities for environment variables and security settings

/**
 * Validates all required and optional environment variables
 * @param {Object} env - Environment variables object (defaults to process.env)
 * @returns {Object} - Validation result with success status and any issues
 */
export function validateEnvironmentVariables(env = process.env) {
  const requiredVars = [
    'DISCORD_BOT_TOKEN',
    'YOUTUBE_API_KEY',
    'YOUTUBE_CHANNEL_ID',
    'DISCORD_YOUTUBE_CHANNEL_ID',
    'PSH_CALLBACK_URL',
    'X_USER_HANDLE',
    'DISCORD_X_POSTS_CHANNEL_ID',
    'DISCORD_X_REPLIES_CHANNEL_ID',
    'DISCORD_X_QUOTES_CHANNEL_ID',
    'DISCORD_X_RETWEETS_CHANNEL_ID',
    'TWITTER_USERNAME',
    'TWITTER_PASSWORD',
    'DISCORD_BOT_SUPPORT_LOG_CHANNEL',
  ];

  const optionalVars = [
    { name: 'COMMAND_PREFIX', defaultValue: '!' },
    { name: 'PSH_PORT', defaultValue: '3000' },
    { name: 'LOG_FILE_PATH', defaultValue: 'bot.log' },
    { name: 'LOG_LEVEL', defaultValue: 'info' },
    { name: 'PSH_SECRET', defaultValue: 'your_super_secret_string_here' },
    { name: 'PSH_VERIFY_TOKEN', defaultValue: 'your_optional_verify_token' },
    { name: 'ANNOUNCEMENT_ENABLED', defaultValue: 'false' },
    { name: 'X_VX_TWITTER_CONVERSION', defaultValue: 'false' },
    { name: 'X_QUERY_INTERVAL_MIN', defaultValue: '300000' },
    { name: 'X_QUERY_INTERVAL_MAX', defaultValue: '600000' },
    { name: 'ALLOWED_USER_IDS', defaultValue: null },
    { name: 'ANNOUNCE_OLD_TWEETS', defaultValue: 'false' },
    { name: 'INITIALIZATION_WINDOW_HOURS', defaultValue: '24' },
    { name: 'WEBHOOK_DEBUG_LOGGING', defaultValue: 'false' },
    { name: 'YOUTUBE_USERNAME', defaultValue: null },
    { name: 'YOUTUBE_PASSWORD', defaultValue: null },
    { name: 'YOUTUBE_AUTHENTICATION_ENABLED', defaultValue: 'false' },
  ];

  const missing = [];
  const warnings = [];

  // Check required variables
  for (const varName of requiredVars) {
    if (!env[varName]) {
      missing.push(varName);
    }
  }

  // Check optional variables and warn about security defaults
  for (const { name } of optionalVars) {
    if (!env[name]) {
      if (name === 'PSH_SECRET' || name === 'PSH_VERIFY_TOKEN') {
        warnings.push(`${name} not set - using default value (consider setting for security)`);
      } else if (name === 'ALLOWED_USER_IDS') {
        warnings.push(`${name} not set - restart command will be unavailable`);
      }
    }
  }

  return {
    success: missing.length === 0,
    missing,
    warnings,
    requiredVars,
    optionalVars,
  };
}

/**
 * Validates Discord channel ID format
 * @param {string} channelId - Discord channel ID to validate
 * @returns {boolean} - True if valid Discord channel ID format
 */
export function validateDiscordChannelId(channelId) {
  if (!channelId || typeof channelId !== 'string') {
    return false;
  }

  // Discord channel IDs are 17-19 digit numbers
  const channelIdRegex = /^\d{17,19}$/;
  return channelIdRegex.test(channelId);
}

/**
 * Validates YouTube channel ID format
 * @param {string} channelId - YouTube channel ID to validate
 * @returns {boolean} - True if valid YouTube channel ID format
 */
export function validateYouTubeChannelId(channelId) {
  if (!channelId || typeof channelId !== 'string') {
    return false;
  }

  // YouTube channel IDs start with 'UC' followed by 22 characters
  const youtubeChannelIdRegex = /^UC[a-zA-Z0-9_-]{22}$/;
  return youtubeChannelIdRegex.test(channelId);
}

/**
 * Validates URL format
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid URL format
 */
export function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates port number
 * @param {string|number} port - Port number to validate
 * @returns {boolean} - True if valid port number
 */
export function validatePort(port) {
  const portNum = parseInt(port, 10);
  return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}

/**
 * Validates log level
 * @param {string} level - Log level to validate
 * @returns {boolean} - True if valid log level
 */
export function validateLogLevel(level) {
  const validLevels = ['error', 'warn', 'info', 'verbose', 'debug'];
  return validLevels.includes(level);
}

/**
 * Validates boolean-like environment variable
 * @param {string} value - Environment variable value
 * @returns {boolean} - True if valid boolean representation
 */
export function validateBooleanEnvVar(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalizedValue = value.toLowerCase().trim();
  return ['true', 'false', '1', '0', 'yes', 'no'].includes(normalizedValue);
}

/**
 * Parses boolean environment variable
 * @param {string} value - Environment variable value
 * @param {boolean} defaultValue - Default value if parsing fails
 * @returns {boolean} - Parsed boolean value
 */
export function parseBooleanEnvVar(value, defaultValue = false) {
  if (!value || typeof value !== 'string') {
    return defaultValue;
  }

  const normalizedValue = value.toLowerCase().trim();
  return ['true', '1', 'yes'].includes(normalizedValue);
}
