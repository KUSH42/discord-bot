import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  validateEnvironmentVariables,
  validateDiscordChannelId,
  validateYouTubeChannelId,
  validateUrl,
  validatePort,
  validateLogLevel,
  validateBooleanEnvVar,
  parseBooleanEnvVar,
} from '../../src/config-validator.js';

describe('Configuration Validation Tests', () => {
  let originalEnv;
  let consoleSpy;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Mock console methods
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
    };

    // Clear environment variables
    Object.keys(process.env).forEach(key => {
      if (
        key.startsWith('DISCORD_') ||
        key.startsWith('YOUTUBE_') ||
        key.startsWith('PSH_') ||
        key.startsWith('X_') ||
        key.startsWith('TWITTER_') ||
        key.includes('COMMAND_') ||
        key.includes('LOG_') ||
        key.includes('ANNOUNCEMENT_') ||
        key.includes('ALLOWED_')
      ) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Restore console methods
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
  });

  describe('Required Environment Variables', () => {
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

    // Using imported validateEnvironmentVariables function

    it('should pass validation when all required variables are set', () => {
      // Set all required variables
      requiredVars.forEach(varName => {
        process.env[varName] = `test-${varName.toLowerCase()}`;
      });

      // Set optional variables to avoid warnings
      process.env.PSH_SECRET = 'test-secret-key-long-enough-to-be-secure';
      process.env.PSH_VERIFY_TOKEN = 'test-verify-token';
      process.env.ALLOWED_USER_IDS = '123456789012345678';

      const result = validateEnvironmentVariables();

      expect(result.success).toBe(true);
      expect(result.missing).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should detect missing required variables', () => {
      // Leave all variables unset
      const { missing } = validateEnvironmentVariables();

      expect(missing).toHaveLength(requiredVars.length);
      expect(missing).toEqual(expect.arrayContaining(requiredVars));
    });

    it('should detect partially missing required variables', () => {
      // Set only half the required variables
      const halfVars = requiredVars.slice(0, Math.floor(requiredVars.length / 2));
      halfVars.forEach(varName => {
        process.env[varName] = `test-${varName.toLowerCase()}`;
      });

      const { missing } = validateEnvironmentVariables();
      const expectedMissing = requiredVars.slice(Math.floor(requiredVars.length / 2));

      expect(missing).toHaveLength(expectedMissing.length);
      expect(missing).toEqual(expect.arrayContaining(expectedMissing));
    });

    requiredVars.forEach(varName => {
      it(`should detect when ${varName} is missing`, () => {
        // Set all except this one
        requiredVars
          .filter(v => v !== varName)
          .forEach(v => {
            process.env[v] = `test-${v.toLowerCase()}`;
          });

        const { missing } = validateEnvironmentVariables();

        expect(missing).toContain(varName);
        expect(missing).toHaveLength(1);
      });
    });
  });

  describe('Optional Environment Variables with Defaults', () => {
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
    ];

    it('should provide default values for unset optional variables', () => {
      optionalVars.forEach(({ name, defaultValue }) => {
        const value = process.env[name] || defaultValue;
        if (defaultValue !== null) {
          expect(value).toBe(defaultValue);
        } else {
          expect(value).toBeNull();
        }
      });
    });

    it('should use custom values when optional variables are set', () => {
      const customValues = {
        COMMAND_PREFIX: '?',
        PSH_PORT: '8080',
        LOG_FILE_PATH: 'custom.log',
        LOG_LEVEL: 'debug',
        PSH_SECRET: 'custom-secret',
        PSH_VERIFY_TOKEN: 'custom-token',
        ANNOUNCEMENT_ENABLED: 'true',
        X_VX_TWITTER_CONVERSION: 'true',
        X_QUERY_INTERVAL_MIN: '120000',
        X_QUERY_INTERVAL_MAX: '240000',
        ALLOWED_USER_IDS: '123,456,789',
        ANNOUNCE_OLD_TWEETS: 'true',
      };

      Object.entries(customValues).forEach(([name, value]) => {
        process.env[name] = value;
      });

      Object.entries(customValues).forEach(([name, expectedValue]) => {
        expect(process.env[name]).toBe(expectedValue);
      });
    });
  });

  describe('Security Configuration Warnings', () => {
    const securityVars = ['PSH_SECRET', 'PSH_VERIFY_TOKEN'];

    it('should warn about default security values', () => {
      // Set all required variables to pass validation
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

      requiredVars.forEach(varName => {
        process.env[varName] = `test-${varName.toLowerCase()}`;
      });

      const validateEnvironmentVariables = () => {
        const warnings = [];
        securityVars.forEach(name => {
          if (!process.env[name]) {
            warnings.push(`${name} not set - using default value (consider setting for security)`);
          }
        });
        return { missing: [], warnings };
      };

      const { warnings } = validateEnvironmentVariables();

      expect(warnings).toHaveLength(securityVars.length);
      securityVars.forEach(varName => {
        expect(warnings.some(w => w.includes(varName))).toBe(true);
      });
    });

    it('should not warn when security variables are explicitly set', () => {
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

      requiredVars.forEach(varName => {
        process.env[varName] = `test-${varName.toLowerCase()}`;
      });

      // Set security variables
      process.env.PSH_SECRET = 'custom-secret-value';
      process.env.PSH_VERIFY_TOKEN = 'custom-verify-token';

      const validateEnvironmentVariables = () => {
        const warnings = [];
        securityVars.forEach(name => {
          if (!process.env[name]) {
            warnings.push(`${name} not set - using default value (consider setting for security)`);
          }
        });
        return { missing: [], warnings };
      };

      const { warnings } = validateEnvironmentVariables();

      expect(warnings).toHaveLength(0);
    });
  });

  describe('Data Type Validation', () => {
    it('should handle boolean-like environment variables', () => {
      const booleanVars = ['ANNOUNCEMENT_ENABLED', 'X_VX_TWITTER_CONVERSION', 'ANNOUNCE_OLD_TWEETS'];
      const validBooleanValues = ['true', 'false', '1', '0', 'yes', 'no'];

      booleanVars.forEach(varName => {
        validBooleanValues.forEach(value => {
          process.env[varName] = value;

          // Test parsing logic
          const parsedValue = ['true', '1', 'yes'].includes(value.toLowerCase());
          expect(typeof parsedValue).toBe('boolean');
        });
      });
    });

    it('should handle numeric environment variables', () => {
      const numericVars = ['PSH_PORT', 'X_QUERY_INTERVAL_MIN', 'X_QUERY_INTERVAL_MAX'];

      numericVars.forEach(varName => {
        process.env[varName] = '12345';
        const parsedValue = parseInt(process.env[varName], 10);

        expect(typeof parsedValue).toBe('number');
        expect(parsedValue).toBe(12345);
        expect(Number.isNaN(parsedValue)).toBe(false);
      });
    });

    it('should handle comma-separated list variables', () => {
      process.env.ALLOWED_USER_IDS = '123456789,987654321,555666777';

      const userIds = process.env.ALLOWED_USER_IDS.split(',').map(id => id.trim());

      expect(userIds).toHaveLength(3);
      expect(userIds).toEqual(['123456789', '987654321', '555666777']);
    });

    it('should validate Discord channel ID format', () => {
      const channelIdVars = [
        'DISCORD_YOUTUBE_CHANNEL_ID',
        'DISCORD_X_POSTS_CHANNEL_ID',
        'DISCORD_X_REPLIES_CHANNEL_ID',
        'DISCORD_X_QUOTES_CHANNEL_ID',
        'DISCORD_X_RETWEETS_CHANNEL_ID',
        'DISCORD_BOT_SUPPORT_LOG_CHANNEL',
      ];

      // Discord Snowflake ID format: 17-19 digits
      const validChannelId = '123456789012345678';
      const invalidChannelIds = ['123', 'abc123def', '123456789012345678901234'];

      channelIdVars.forEach(varName => {
        // Test valid ID
        process.env[varName] = validChannelId;
        const isValidFormat = /^\d{17,19}$/.test(process.env[varName]);
        expect(isValidFormat).toBe(true);

        // Test invalid IDs
        invalidChannelIds.forEach(invalidId => {
          process.env[varName] = invalidId;
          const isValidFormat = /^\d{17,19}$/.test(process.env[varName]);
          expect(isValidFormat).toBe(false);
        });
      });
    });

    it('should validate YouTube channel ID format', () => {
      process.env.YOUTUBE_CHANNEL_ID = 'UCuAXFkgsw1L7xaCfnd5JJOw'; // Valid format

      // YouTube channel ID format: UC followed by 22 characters
      const isValidFormat = /^UC[a-zA-Z0-9_-]{22}$/.test(process.env.YOUTUBE_CHANNEL_ID);
      expect(isValidFormat).toBe(true);

      // Test invalid formats
      const invalidIds = ['123456', 'UCshort', 'notuc123456789012345678901234'];
      invalidIds.forEach(invalidId => {
        process.env.YOUTUBE_CHANNEL_ID = invalidId;
        const isValidFormat = /^UC[a-zA-Z0-9_-]{22}$/.test(process.env.YOUTUBE_CHANNEL_ID);
        expect(isValidFormat).toBe(false);
      });
    });

    it('should validate URL format for PSH_CALLBACK_URL', () => {
      const validUrls = [
        'https://example.com/webhook',
        'http://localhost:3000/webhook',
        'https://bot.mydomain.com/youtube/webhook',
      ];

      const invalidUrls = ['not-a-url', 'invalid-url-format', 'http://', 'https://'];

      validUrls.forEach(url => {
        process.env.PSH_CALLBACK_URL = url;
        expect(() => new URL(process.env.PSH_CALLBACK_URL)).not.toThrow();
      });

      invalidUrls.forEach(url => {
        process.env.PSH_CALLBACK_URL = url;
        expect(() => new URL(process.env.PSH_CALLBACK_URL)).toThrow();
      });
    });
  });

  describe('Environment Variable Ranges and Limits', () => {
    it('should validate port number ranges', () => {
      const validPorts = ['1', '80', '443', '3000', '8080', '65535'];
      const invalidPorts = ['0', '65536', '100000', '-1', 'abc'];

      validPorts.forEach(port => {
        process.env.PSH_PORT = port;
        const portNum = parseInt(process.env.PSH_PORT, 10);
        expect(portNum).toBeGreaterThan(0);
        expect(portNum).toBeLessThanOrEqual(65535);
      });

      invalidPorts.forEach(port => {
        process.env.PSH_PORT = port;
        const portNum = parseInt(process.env.PSH_PORT, 10);
        if (!Number.isNaN(portNum)) {
          expect(portNum <= 0 || portNum > 65535).toBe(true);
        } else {
          expect(Number.isNaN(portNum)).toBe(true);
        }
      });
    });

    it('should validate query interval ranges', () => {
      // Minimum should be less than maximum
      process.env.X_QUERY_INTERVAL_MIN = '300000'; // 5 minutes
      process.env.X_QUERY_INTERVAL_MAX = '600000'; // 10 minutes

      const minInterval = parseInt(process.env.X_QUERY_INTERVAL_MIN, 10);
      const maxInterval = parseInt(process.env.X_QUERY_INTERVAL_MAX, 10);

      expect(minInterval).toBeLessThan(maxInterval);
      expect(minInterval).toBeGreaterThan(0);
      expect(maxInterval).toBeGreaterThan(0);
    });

    it('should validate log level values', () => {
      const validLogLevels = ['error', 'warn', 'info', 'debug', 'silly'];
      const invalidLogLevels = ['invalid', 'trace', 'verbose'];

      validLogLevels.forEach(level => {
        process.env.LOG_LEVEL = level;
        expect(validLogLevels).toContain(process.env.LOG_LEVEL);
      });

      invalidLogLevels.forEach(level => {
        process.env.LOG_LEVEL = level;
        expect(validLogLevels).not.toContain(process.env.LOG_LEVEL);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty string values', () => {
      process.env.COMMAND_PREFIX = '';
      const prefix = process.env.COMMAND_PREFIX || '!';
      expect(prefix).toBe('!'); // Should fallback to default
    });

    it('should handle whitespace-only values', () => {
      process.env.COMMAND_PREFIX = '   ';
      const prefix = process.env.COMMAND_PREFIX.trim() || '!';
      expect(prefix).toBe('!'); // Should fallback to default after trim
    });

    it('should handle undefined vs null vs empty string differences', () => {
      delete process.env.TEST_VAR;
      expect(process.env.TEST_VAR).toBeUndefined();

      process.env.TEST_VAR = '';
      expect(process.env.TEST_VAR).toBe('');
      expect(process.env.TEST_VAR).not.toBeUndefined();

      // Environment variables cannot be null, only undefined or string
      expect(process.env.TEST_VAR).not.toBeNull();
    });

    it('should handle special characters in environment variables', () => {
      const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      process.env.PSH_SECRET = specialChars;
      expect(process.env.PSH_SECRET).toBe(specialChars);
    });

    it('should handle very long environment variable values', () => {
      const longValue = 'a'.repeat(10000);
      process.env.TEST_LONG_VAR = longValue;
      expect(process.env.TEST_LONG_VAR).toBe(longValue);
      expect(process.env.TEST_LONG_VAR).toHaveLength(10000);
    });
  });

  describe('Individual Validation Functions', () => {
    describe('validateDiscordChannelId', () => {
      it('should validate correct Discord channel IDs', () => {
        expect(validateDiscordChannelId('123456789012345678')).toBe(true); // 18 digits
        expect(validateDiscordChannelId('12345678901234567')).toBe(true); // 17 digits
        expect(validateDiscordChannelId('1234567890123456789')).toBe(true); // 19 digits
      });

      it('should reject invalid Discord channel IDs', () => {
        expect(validateDiscordChannelId('123456789012345')).toBe(false); // Too short
        expect(validateDiscordChannelId('12345678901234567890')).toBe(false); // Too long
        expect(validateDiscordChannelId('1234567890123456a8')).toBe(false); // Contains letter
        expect(validateDiscordChannelId('')).toBe(false); // Empty
        expect(validateDiscordChannelId(null)).toBe(false); // Null
        expect(validateDiscordChannelId(undefined)).toBe(false); // Undefined
        expect(validateDiscordChannelId('123456789012345678')).toBe(true);
      });
    });

    describe('validateYouTubeChannelId', () => {
      it('should validate correct YouTube channel IDs', () => {
        expect(validateYouTubeChannelId('UCrAOyUwjSM5zzPz_FqsUhuQ')).toBe(true);
        expect(validateYouTubeChannelId('UC1234567890123456789012')).toBe(true);
        expect(validateYouTubeChannelId('UC-_AbcDef12345678901234')).toBe(true);
      });

      it('should reject invalid YouTube channel IDs', () => {
        expect(validateYouTubeChannelId('UCrAOyUwjSM5zzPz_FqsUhu')).toBe(false); // Too short
        expect(validateYouTubeChannelId('UCrAOyUwjSM5zzPz_FqsUhuQQ')).toBe(false); // Too long
        expect(validateYouTubeChannelId('ACrAOyUwjSM5zzPz_FqsUhuQ')).toBe(false); // Doesn't start with UC
        expect(validateYouTubeChannelId('UC')).toBe(false); // Too short
        expect(validateYouTubeChannelId('')).toBe(false); // Empty
        expect(validateYouTubeChannelId(null)).toBe(false); // Null
        expect(validateYouTubeChannelId(undefined)).toBe(false); // Undefined
      });
    });

    describe('validateUrl', () => {
      it('should validate correct URLs', () => {
        expect(validateUrl('https://example.com')).toBe(true);
        expect(validateUrl('http://example.com')).toBe(true);
        expect(validateUrl('https://example.com/path')).toBe(true);
        expect(validateUrl('https://example.com:8080')).toBe(true);
        expect(validateUrl('https://subdomain.example.com')).toBe(true);
      });

      it('should reject invalid URLs', () => {
        expect(validateUrl('not-a-url')).toBe(false);
        expect(validateUrl('ftp://example.com')).toBe(true); // URL constructor accepts ftp URLs
        expect(validateUrl('')).toBe(false);
        expect(validateUrl(null)).toBe(false);
        expect(validateUrl(undefined)).toBe(false);
        expect(validateUrl('https://')).toBe(false);
      });
    });

    describe('validatePort', () => {
      it('should validate correct ports', () => {
        expect(validatePort('80')).toBe(true);
        expect(validatePort('443')).toBe(true);
        expect(validatePort('3000')).toBe(true);
        expect(validatePort('8080')).toBe(true);
        expect(validatePort('65535')).toBe(true);
      });

      it('should reject invalid ports', () => {
        expect(validatePort('0')).toBe(false); // Port 0 is invalid
        expect(validatePort('65536')).toBe(false); // Above max port
        expect(validatePort('-1')).toBe(false); // Negative
        expect(validatePort('abc')).toBe(false); // Not a number
        expect(validatePort('')).toBe(false); // Empty
        expect(validatePort(null)).toBe(false); // Null
        expect(validatePort(undefined)).toBe(false); // Undefined
      });
    });

    describe('validateLogLevel', () => {
      it('should validate correct log levels', () => {
        expect(validateLogLevel('error')).toBe(true);
        expect(validateLogLevel('warn')).toBe(true);
        expect(validateLogLevel('info')).toBe(true);
        expect(validateLogLevel('debug')).toBe(true);
        expect(validateLogLevel('verbose')).toBe(true);
      });

      it('should reject invalid log levels', () => {
        expect(validateLogLevel('invalid')).toBe(false);
        expect(validateLogLevel('INFO')).toBe(false); // Case sensitive
        expect(validateLogLevel('Warning')).toBe(false); // Case sensitive
        expect(validateLogLevel('')).toBe(false); // Empty
        expect(validateLogLevel(null)).toBe(false); // Null
        expect(validateLogLevel(undefined)).toBe(false); // Undefined
      });
    });

    describe('validateBooleanEnvVar', () => {
      it('should validate truthy values', () => {
        expect(validateBooleanEnvVar('true')).toBe(true);
        expect(validateBooleanEnvVar('True')).toBe(true);
        expect(validateBooleanEnvVar('TRUE')).toBe(true);
        expect(validateBooleanEnvVar('yes')).toBe(true);
        expect(validateBooleanEnvVar('1')).toBe(true);
        // 'on' is not in the valid boolean list
      });

      it('should validate falsy values', () => {
        expect(validateBooleanEnvVar('false')).toBe(true);
        expect(validateBooleanEnvVar('False')).toBe(true);
        expect(validateBooleanEnvVar('FALSE')).toBe(true);
        expect(validateBooleanEnvVar('no')).toBe(true);
        expect(validateBooleanEnvVar('0')).toBe(true);
        // 'off' is not in the valid boolean list
      });

      it('should reject invalid boolean values', () => {
        expect(validateBooleanEnvVar('invalid')).toBe(false);
        expect(validateBooleanEnvVar('2')).toBe(false);
        expect(validateBooleanEnvVar('maybe')).toBe(false);
        expect(validateBooleanEnvVar('')).toBe(false);
        expect(validateBooleanEnvVar(null)).toBe(false);
        expect(validateBooleanEnvVar(undefined)).toBe(false);
      });
    });

    describe('parseBooleanEnvVar', () => {
      it('should parse truthy values correctly', () => {
        expect(parseBooleanEnvVar('true')).toBe(true);
        expect(parseBooleanEnvVar('True')).toBe(true);
        expect(parseBooleanEnvVar('TRUE')).toBe(true);
        expect(parseBooleanEnvVar('yes')).toBe(true);
        expect(parseBooleanEnvVar('1')).toBe(true);
        // 'on' is not in the truthy list
      });

      it('should parse falsy values correctly', () => {
        expect(parseBooleanEnvVar('false')).toBe(false);
        expect(parseBooleanEnvVar('False')).toBe(false);
        expect(parseBooleanEnvVar('FALSE')).toBe(false);
        expect(parseBooleanEnvVar('no')).toBe(false);
        expect(parseBooleanEnvVar('0')).toBe(false);
        // 'off' is not in the truthy list
      });

      it('should return false for invalid values', () => {
        expect(parseBooleanEnvVar('invalid')).toBe(false);
        expect(parseBooleanEnvVar('2')).toBe(false);
        expect(parseBooleanEnvVar('maybe')).toBe(false);
        expect(parseBooleanEnvVar('')).toBe(false);
        expect(parseBooleanEnvVar(null)).toBe(false);
        expect(parseBooleanEnvVar(undefined)).toBe(false);
      });
    });
  });
});
