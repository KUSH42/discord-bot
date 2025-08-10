/**
 * @fileoverview Tests for content detection configuration
 */

import {
  CONTENT_DETECTION_CONFIG,
  getContentDetectionConfig,
  validateContentDetectionConfig,
  createContentDetectionConfigManager,
} from '../../../src/config/content-detection.js';

describe('Content Detection Configuration', () => {
  // Clean environment variables that could contaminate tests
  beforeEach(() => {
    delete process.env.MAX_CONTENT_AGE_HOURS;
    delete process.env.ENABLE_CROSS_VALIDATION;
    delete process.env.WEBHOOK_MAX_RETRIES;
    delete process.env.CONTENT_STORAGE_DIR;
    delete process.env.LIVESTREAM_POLLING_INTERVAL_MS;
    delete process.env.DUPLICATE_CLEANUP_INTERVAL_HOURS;
    delete process.env.ENABLE_CONTENT_FINGERPRINTING;
    delete process.env.ENABLE_LIVESTREAM_MONITORING;
  });
  describe('CONTENT_DETECTION_CONFIG', () => {
    it('should have all required configuration sections', () => {
      expect(CONTENT_DETECTION_CONFIG).toBeDefined();
      expect(CONTENT_DETECTION_CONFIG.MAX_CONTENT_AGE_HOURS).toBeDefined();
      expect(CONTENT_DETECTION_CONFIG.DUPLICATE_DETECTION).toBeDefined();
      expect(CONTENT_DETECTION_CONFIG.LIVESTREAM_TRACKING).toBeDefined();
      expect(CONTENT_DETECTION_CONFIG.FALLBACK_SYSTEM).toBeDefined();
      expect(CONTENT_DETECTION_CONFIG.CONTENT_VALIDATION).toBeDefined();
      expect(CONTENT_DETECTION_CONFIG.COORDINATION).toBeDefined();
      expect(CONTENT_DETECTION_CONFIG.MONITORING).toBeDefined();
      expect(CONTENT_DETECTION_CONFIG.STORAGE).toBeDefined();
    });

    it('should have sensible default values', () => {
      expect(CONTENT_DETECTION_CONFIG.MAX_CONTENT_AGE_HOURS).toBe(24);
      expect(CONTENT_DETECTION_CONFIG.DUPLICATE_DETECTION.STORAGE).toBe('persistent');
      expect(CONTENT_DETECTION_CONFIG.DUPLICATE_DETECTION.CLEANUP_INTERVAL_HOURS).toBe(168);
      expect(CONTENT_DETECTION_CONFIG.DUPLICATE_DETECTION.MAX_MEMORY_ENTRIES).toBe(10000);
      expect(CONTENT_DETECTION_CONFIG.DUPLICATE_DETECTION.FINGERPRINT_ENABLED).toBe(true);
    });

    it('should have valid livestream tracking configuration', () => {
      const tracking = CONTENT_DETECTION_CONFIG.LIVESTREAM_TRACKING;
      expect(tracking.STATE_POLLING_INTERVAL).toBe(30000);
      expect(tracking.TRANSITION_TIMEOUT).toBe(300000);
      expect(tracking.ENABLE_SCHEDULED_MONITORING).toBe(true);
      expect(tracking.SCHEDULED_CHECK_INTERVAL).toBe(60000);
    });

    it('should have valid fallback system configuration', () => {
      const fallback = CONTENT_DETECTION_CONFIG.FALLBACK_SYSTEM;
      expect(fallback.MAX_RETRIES).toBe(3);
      expect(fallback.BACKOFF_MULTIPLIER).toBe(2);
      expect(fallback.BASE_DELAY_MS).toBe(5000);
      expect(fallback.WEBHOOK_TIMEOUT_MS).toBe(30000);
      expect(fallback.ENABLE_SCRAPER_FALLBACK).toBe(true);
    });

    it('should have valid coordination settings', () => {
      const coordination = CONTENT_DETECTION_CONFIG.COORDINATION;
      expect(coordination.PROCESSING_LOCK_TIMEOUT_MS).toBe(30000);
      expect(coordination.SOURCE_PRIORITY).toEqual(['webhook', 'api', 'scraper']);
      expect(coordination.ENABLE_RACE_CONDITION_PREVENTION).toBe(true);
    });

    it('should have valid monitoring configuration', () => {
      const monitoring = CONTENT_DETECTION_CONFIG.MONITORING;
      expect(monitoring.ENABLE_METRICS).toBe(true);
      expect(monitoring.METRICS_RETENTION_HOURS).toBe(168);
      expect(monitoring.HEALTH_CHECK_INTERVAL).toBe(300000);
      expect(monitoring.ALERT_ON_MISSED_CONTENT).toBe(true);
    });

    it('should have valid storage configuration', () => {
      const storage = CONTENT_DETECTION_CONFIG.STORAGE;
      expect(storage.DIRECTORY).toBe('data');
      expect(storage.ENABLE_COMPRESSION).toBe(false);
      expect(storage.BACKUP_INTERVAL_HOURS).toBe(24);
      expect(storage.MAX_FILE_SIZE_MB).toBe(100);
    });
  });

  describe('getContentDetectionConfig', () => {
    it('should return default configuration when no environment variables provided', () => {
      const config = getContentDetectionConfig({});
      expect(config.MAX_CONTENT_AGE_HOURS).toBe(24);
      expect(config.DUPLICATE_DETECTION.CLEANUP_INTERVAL_HOURS).toBe(168);
      expect(config.LIVESTREAM_TRACKING.STATE_POLLING_INTERVAL).toBe(30000);
    });

    it('should apply MAX_CONTENT_AGE_HOURS override', () => {
      const env = { MAX_CONTENT_AGE_HOURS: '48' };
      const config = getContentDetectionConfig(env);
      expect(config.MAX_CONTENT_AGE_HOURS).toBe(48);
    });

    it('should ignore invalid MAX_CONTENT_AGE_HOURS values', () => {
      const invalidValues = ['invalid', '-5', '0', '', 'NaN'];

      invalidValues.forEach(value => {
        const env = { MAX_CONTENT_AGE_HOURS: value };
        const config = getContentDetectionConfig(env);
        expect(config.MAX_CONTENT_AGE_HOURS).toBe(24); // Default value
      });
    });

    it('should apply DUPLICATE_CLEANUP_INTERVAL_HOURS override', () => {
      const env = { DUPLICATE_CLEANUP_INTERVAL_HOURS: '72' };
      const config = getContentDetectionConfig(env);
      expect(config.DUPLICATE_DETECTION.CLEANUP_INTERVAL_HOURS).toBe(72);
    });

    it('should apply LIVESTREAM_POLLING_INTERVAL_MS override', () => {
      const env = { LIVESTREAM_POLLING_INTERVAL_MS: '45000' };
      const config = getContentDetectionConfig(env);
      expect(config.LIVESTREAM_TRACKING.STATE_POLLING_INTERVAL).toBe(45000);
    });

    it('should apply WEBHOOK_MAX_RETRIES override', () => {
      const env = { WEBHOOK_MAX_RETRIES: '5' };
      const config = getContentDetectionConfig(env);
      expect(config.FALLBACK_SYSTEM.MAX_RETRIES).toBe(5);
    });

    it('should allow zero retries', () => {
      const env = { WEBHOOK_MAX_RETRIES: '0' };
      const config = getContentDetectionConfig(env);
      expect(config.FALLBACK_SYSTEM.MAX_RETRIES).toBe(0);
    });

    it('should apply CONTENT_STORAGE_DIR override', () => {
      const env = { CONTENT_STORAGE_DIR: '/custom/path' };
      const config = getContentDetectionConfig(env);
      expect(config.STORAGE.DIRECTORY).toBe('/custom/path');
    });

    it('should apply boolean overrides correctly', () => {
      const env = {
        ENABLE_CONTENT_FINGERPRINTING: 'false',
        ENABLE_LIVESTREAM_MONITORING: 'false',
        ENABLE_CROSS_VALIDATION: 'false',
      };

      const config = getContentDetectionConfig(env);
      expect(config.DUPLICATE_DETECTION.FINGERPRINT_ENABLED).toBe(false);
      expect(config.LIVESTREAM_TRACKING.ENABLE_SCHEDULED_MONITORING).toBe(false);
      expect(config.CONTENT_VALIDATION.ENABLE_CROSS_VALIDATION).toBe(false);
    });

    it('should handle boolean strings case insensitively', () => {
      const env = {
        ENABLE_CONTENT_FINGERPRINTING: 'TRUE',
        ENABLE_LIVESTREAM_MONITORING: 'True',
        ENABLE_CROSS_VALIDATION: 'tRuE',
      };

      const config = getContentDetectionConfig(env);
      expect(config.DUPLICATE_DETECTION.FINGERPRINT_ENABLED).toBe(true);
      expect(config.LIVESTREAM_TRACKING.ENABLE_SCHEDULED_MONITORING).toBe(true);
      expect(config.CONTENT_VALIDATION.ENABLE_CROSS_VALIDATION).toBe(true);
    });

    it('should not modify original config object', () => {
      const originalValue = CONTENT_DETECTION_CONFIG.MAX_CONTENT_AGE_HOURS;
      const env = { MAX_CONTENT_AGE_HOURS: '72' };

      getContentDetectionConfig(env);

      expect(CONTENT_DETECTION_CONFIG.MAX_CONTENT_AGE_HOURS).toBe(originalValue);
    });

    it('should use process.env by default', () => {
      const originalEnv = process.env.MAX_CONTENT_AGE_HOURS;
      process.env.MAX_CONTENT_AGE_HOURS = '36';

      const config = getContentDetectionConfig();
      expect(config.MAX_CONTENT_AGE_HOURS).toBe(36);

      // Cleanup
      if (originalEnv !== undefined) {
        process.env.MAX_CONTENT_AGE_HOURS = originalEnv;
      } else {
        delete process.env.MAX_CONTENT_AGE_HOURS;
      }
    });
  });

  describe('validateContentDetectionConfig', () => {
    let validConfig;

    beforeEach(() => {
      validConfig = JSON.parse(JSON.stringify(CONTENT_DETECTION_CONFIG)); // Deep copy
    });

    it('should return no errors for valid configuration', () => {
      const errors = validateContentDetectionConfig(validConfig);
      expect(errors).toEqual([]);
    });

    it('should validate MAX_CONTENT_AGE_HOURS', () => {
      validConfig.MAX_CONTENT_AGE_HOURS = -1;
      let errors = validateContentDetectionConfig(validConfig);
      expect(errors).toContain('MAX_CONTENT_AGE_HOURS must be a positive number');

      validConfig.MAX_CONTENT_AGE_HOURS = 0;
      errors = validateContentDetectionConfig(validConfig);
      expect(errors).toContain('MAX_CONTENT_AGE_HOURS must be a positive number');

      validConfig.MAX_CONTENT_AGE_HOURS = 200;
      errors = validateContentDetectionConfig(validConfig);
      expect(errors).toContain('MAX_CONTENT_AGE_HOURS should not exceed 168 hours (1 week)');

      validConfig.MAX_CONTENT_AGE_HOURS = 'invalid';
      errors = validateContentDetectionConfig(validConfig);
      expect(errors).toContain('MAX_CONTENT_AGE_HOURS must be a positive number');
    });

    it('should validate polling intervals', () => {
      validConfig.LIVESTREAM_TRACKING.STATE_POLLING_INTERVAL = 5000;
      const errors = validateContentDetectionConfig(validConfig);
      expect(errors).toContain('STATE_POLLING_INTERVAL must be at least 10000ms');
    });

    it('should validate retry configuration', () => {
      validConfig.FALLBACK_SYSTEM.MAX_RETRIES = 15;
      let errors = validateContentDetectionConfig(validConfig);
      expect(errors).toContain('MAX_RETRIES should not exceed 10');

      validConfig.FALLBACK_SYSTEM.MAX_RETRIES = 3;
      validConfig.FALLBACK_SYSTEM.BASE_DELAY_MS = 500;
      errors = validateContentDetectionConfig(validConfig);
      expect(errors).toContain('BASE_DELAY_MS should be at least 1000ms');
    });

    it('should validate storage directory', () => {
      validConfig.STORAGE.DIRECTORY = '';
      let errors = validateContentDetectionConfig(validConfig);
      expect(errors).toContain('STORAGE.DIRECTORY must be a non-empty string');

      validConfig.STORAGE.DIRECTORY = null;
      errors = validateContentDetectionConfig(validConfig);
      expect(errors).toContain('STORAGE.DIRECTORY must be a non-empty string');

      validConfig.STORAGE.DIRECTORY = 123;
      errors = validateContentDetectionConfig(validConfig);
      expect(errors).toContain('STORAGE.DIRECTORY must be a non-empty string');
    });

    it('should validate source priority configuration', () => {
      validConfig.COORDINATION.SOURCE_PRIORITY = 'invalid';
      let errors = validateContentDetectionConfig(validConfig);
      expect(errors).toContain('SOURCE_PRIORITY must be an array');

      validConfig.COORDINATION.SOURCE_PRIORITY = ['webhook', 'invalid_source'];
      errors = validateContentDetectionConfig(validConfig);
      expect(errors).toContain('Invalid source in SOURCE_PRIORITY: invalid_source');

      validConfig.COORDINATION.SOURCE_PRIORITY = ['webhook', 'api', 'scraper', 'unknown'];
      errors = validateContentDetectionConfig(validConfig);
      expect(errors).toContain('Invalid source in SOURCE_PRIORITY: unknown');
    });

    it('should accumulate multiple validation errors', () => {
      validConfig.MAX_CONTENT_AGE_HOURS = -1;
      validConfig.FALLBACK_SYSTEM.MAX_RETRIES = 15;
      validConfig.STORAGE.DIRECTORY = '';

      const errors = validateContentDetectionConfig(validConfig);
      expect(errors.length).toBeGreaterThan(2);
      expect(errors).toContain('MAX_CONTENT_AGE_HOURS must be a positive number');
      expect(errors).toContain('MAX_RETRIES should not exceed 10');
      expect(errors).toContain('STORAGE.DIRECTORY must be a non-empty string');
    });

    it('should handle edge cases for valid configuration', () => {
      // Reset to fresh config to avoid contamination from previous tests
      validConfig = JSON.parse(JSON.stringify(CONTENT_DETECTION_CONFIG));

      validConfig.MAX_CONTENT_AGE_HOURS = 168; // Exactly at limit
      validConfig.FALLBACK_SYSTEM.MAX_RETRIES = 10; // Exactly at limit
      validConfig.FALLBACK_SYSTEM.BASE_DELAY_MS = 1000; // Exactly at limit
      validConfig.LIVESTREAM_TRACKING.STATE_POLLING_INTERVAL = 10000; // Exactly at limit

      const errors = validateContentDetectionConfig(validConfig);
      expect(errors).toEqual([]);
    });
  });

  describe('createContentDetectionConfigManager', () => {
    const mockBaseConfig = {
      getBaseValue: () => 'base_value',
      baseProperty: 'test',
    };

    let originalEnvVars = {};

    beforeEach(() => {
      // Save original environment variables
      originalEnvVars = {
        MAX_CONTENT_AGE_HOURS: process.env.MAX_CONTENT_AGE_HOURS,
        ENABLE_CROSS_VALIDATION: process.env.ENABLE_CROSS_VALIDATION,
      };

      // Clean environment for each test
      delete process.env.MAX_CONTENT_AGE_HOURS;
      delete process.env.ENABLE_CROSS_VALIDATION;
    });

    afterEach(() => {
      // Restore original environment variables
      Object.keys(originalEnvVars).forEach(key => {
        if (originalEnvVars[key] !== undefined) {
          process.env[key] = originalEnvVars[key];
        } else {
          delete process.env[key];
        }
      });
    });

    it('should create enhanced configuration manager', () => {
      const manager = createContentDetectionConfigManager(mockBaseConfig);

      expect(manager).toBeDefined();
      expect(manager.getContentDetection).toBeDefined();
      expect(manager.getAllContentDetectionConfig).toBeDefined();
      expect(manager.isContentDetectionFeatureEnabled).toBeDefined();

      // Should inherit base config properties
      expect(manager.getBaseValue).toBeDefined();
      expect(manager.baseProperty).toBe('test');
    });

    it('should throw error for invalid configuration', () => {
      // Mock an invalid environment that causes validation to fail
      const originalEnv = process.env.MAX_CONTENT_AGE_HOURS;
      process.env.MAX_CONTENT_AGE_HOURS = '-1';

      expect(() => createContentDetectionConfigManager(mockBaseConfig)).toThrow(
        'Content detection configuration validation failed'
      );

      // Cleanup
      if (originalEnv !== undefined) {
        process.env.MAX_CONTENT_AGE_HOURS = originalEnv;
      } else {
        delete process.env.MAX_CONTENT_AGE_HOURS;
      }
    });

    describe('getContentDetection method', () => {
      let manager;

      beforeEach(() => {
        manager = createContentDetectionConfigManager(mockBaseConfig);
      });

      it('should get top-level configuration values', () => {
        expect(manager.getContentDetection('MAX_CONTENT_AGE_HOURS')).toBe(24);
        expect(manager.getContentDetection('MAX_CONTENT_AGE_HOURS', 48)).toBe(24);
      });

      it('should get nested configuration values using dot notation', () => {
        expect(manager.getContentDetection('DUPLICATE_DETECTION.STORAGE')).toBe('persistent');
        expect(manager.getContentDetection('LIVESTREAM_TRACKING.STATE_POLLING_INTERVAL')).toBe(30000);
        expect(manager.getContentDetection('COORDINATION.SOURCE_PRIORITY')).toEqual(['webhook', 'api', 'scraper']);
      });

      it('should return default value for non-existent keys', () => {
        expect(manager.getContentDetection('NON_EXISTENT_KEY', 'default')).toBe('default');
        expect(manager.getContentDetection('DUPLICATE_DETECTION.NON_EXISTENT', 'default')).toBe('default');
        expect(manager.getContentDetection('NON_EXISTENT.NESTED.KEY', 'default')).toBe('default');
      });

      it('should handle deeply nested paths', () => {
        // Even though not in current config, test the traversal logic
        expect(manager.getContentDetection('DUPLICATE_DETECTION.STORAGE.NON_EXISTENT', 'default')).toBe('default');
      });

      it('should return undefined for non-existent keys without default', () => {
        expect(manager.getContentDetection('NON_EXISTENT_KEY')).toBeUndefined();
      });
    });

    describe('getAllContentDetectionConfig method', () => {
      let manager;

      beforeEach(() => {
        manager = createContentDetectionConfigManager(mockBaseConfig);
      });

      it('should return complete configuration object', () => {
        const config = manager.getAllContentDetectionConfig();

        expect(config).toBeDefined();
        expect(config.MAX_CONTENT_AGE_HOURS).toBe(24);
        expect(config.DUPLICATE_DETECTION).toBeDefined();
        expect(config.LIVESTREAM_TRACKING).toBeDefined();
        expect(config.FALLBACK_SYSTEM).toBeDefined();
      });

      it('should return a copy of the configuration', () => {
        const config1 = manager.getAllContentDetectionConfig();
        const config2 = manager.getAllContentDetectionConfig();

        // Should be different objects
        expect(config1).not.toBe(config2);
        // But with same values
        expect(config1).toEqual(config2);
      });
    });

    describe('isContentDetectionFeatureEnabled method', () => {
      let manager;

      beforeEach(() => {
        manager = createContentDetectionConfigManager(mockBaseConfig);
      });

      it('should check fingerprinting feature', () => {
        expect(manager.isContentDetectionFeatureEnabled('fingerprinting')).toBe(true);
      });

      it('should check livestream monitoring feature', () => {
        expect(manager.isContentDetectionFeatureEnabled('livestream_monitoring')).toBe(true);
      });

      it('should check cross validation feature', () => {
        expect(manager.isContentDetectionFeatureEnabled('cross_validation')).toBe(true);
      });

      it('should check metrics feature', () => {
        expect(manager.isContentDetectionFeatureEnabled('metrics')).toBe(true);
      });

      it('should check scraper fallback feature', () => {
        expect(manager.isContentDetectionFeatureEnabled('scraper_fallback')).toBe(true);
      });

      it('should check race condition prevention feature', () => {
        expect(manager.isContentDetectionFeatureEnabled('race_condition_prevention')).toBe(true);
      });

      it('should return false for unknown features', () => {
        expect(manager.isContentDetectionFeatureEnabled('unknown_feature')).toBe(false);
        expect(manager.isContentDetectionFeatureEnabled('')).toBe(false);
        expect(manager.isContentDetectionFeatureEnabled(null)).toBe(false);
      });
    });
  });

  describe('Integration Tests', () => {
    it('should work with environment variable overrides and validation', () => {
      const env = {
        MAX_CONTENT_AGE_HOURS: '48',
        ENABLE_CONTENT_FINGERPRINTING: 'false',
        CONTENT_STORAGE_DIR: '/custom/data',
      };

      const config = getContentDetectionConfig(env);
      const errors = validateContentDetectionConfig(config);

      expect(errors).toEqual([]);
      expect(config.MAX_CONTENT_AGE_HOURS).toBe(48);
      expect(config.DUPLICATE_DETECTION.FINGERPRINT_ENABLED).toBe(false);
      expect(config.STORAGE.DIRECTORY).toBe('/custom/data');
    });

    it('should detect validation errors after environment overrides', () => {
      const env = {
        MAX_CONTENT_AGE_HOURS: '200', // Too high
        WEBHOOK_MAX_RETRIES: '15', // Too high
        CONTENT_STORAGE_DIR: '', // Empty
      };

      const config = getContentDetectionConfig(env);
      const errors = validateContentDetectionConfig(config);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('MAX_CONTENT_AGE_HOURS should not exceed 168 hours (1 week)');
      expect(errors).toContain('MAX_RETRIES should not exceed 10');
      expect(errors).toContain('STORAGE.DIRECTORY must be a non-empty string');
    });

    it('should create functional config manager with overrides', () => {
      // Clean environment variables first
      delete process.env.MAX_CONTENT_AGE_HOURS;
      delete process.env.ENABLE_CROSS_VALIDATION;
      delete process.env.WEBHOOK_MAX_RETRIES;

      const env = {
        MAX_CONTENT_AGE_HOURS: '12',
        ENABLE_CROSS_VALIDATION: 'false',
      };

      // Temporarily set environment
      process.env.MAX_CONTENT_AGE_HOURS = env.MAX_CONTENT_AGE_HOURS;
      process.env.ENABLE_CROSS_VALIDATION = env.ENABLE_CROSS_VALIDATION;

      try {
        const manager = createContentDetectionConfigManager({});

        expect(manager.getContentDetection('MAX_CONTENT_AGE_HOURS')).toBe(12);
        expect(manager.isContentDetectionFeatureEnabled('cross_validation')).toBe(false);
      } finally {
        // Cleanup
        delete process.env.MAX_CONTENT_AGE_HOURS;
        delete process.env.ENABLE_CROSS_VALIDATION;
      }
    });
  });
});
