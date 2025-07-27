import { describe, it, expect } from '@jest/globals';
import {
  getXScrapingBrowserConfig,
  getYouTubeScrapingBrowserConfig,
  getProfileBrowserConfig,
  validateBrowserArgs,
  SAFE_BROWSER_ARGS,
  DANGEROUS_BROWSER_ARGS,
} from '../../../src/utilities/browser-config.js';

describe('Browser Configuration Utility', () => {
  describe('getXScrapingBrowserConfig', () => {
    it('should return default X scraping configuration', () => {
      const config = getXScrapingBrowserConfig();

      expect(config).toHaveProperty('headless', false);
      expect(config).toHaveProperty('args');
      expect(config.args).toEqual(expect.arrayContaining(SAFE_BROWSER_ARGS));
    });

    it('should accept custom headless option', () => {
      const config = getXScrapingBrowserConfig({ headless: true });
      expect(config.headless).toBe(true);
    });

    it('should include additional args when provided', () => {
      const additionalArgs = ['--custom-arg', '--another-arg'];
      const config = getXScrapingBrowserConfig({ additionalArgs });

      expect(config.args).toEqual(expect.arrayContaining(additionalArgs));
    });
  });

  describe('getYouTubeScrapingBrowserConfig', () => {
    it('should return default YouTube scraping configuration', () => {
      const config = getYouTubeScrapingBrowserConfig();

      expect(config).toHaveProperty('headless', false);
      expect(config).toHaveProperty('args');
      expect(config.args).toEqual(expect.arrayContaining(SAFE_BROWSER_ARGS));
    });
  });

  describe('getProfileBrowserConfig', () => {
    it('should return default profile configuration', () => {
      const config = getProfileBrowserConfig();

      expect(config).toHaveProperty('headless', true);
      expect(config).toHaveProperty('args');
      expect(config.args).toEqual(expect.arrayContaining(SAFE_BROWSER_ARGS));
    });

    it('should include userDataDir when provided', () => {
      const userDataDir = '/path/to/profile';
      const config = getProfileBrowserConfig({ userDataDir });

      expect(config.userDataDir).toBe(userDataDir);
    });
  });

  describe('validateBrowserArgs', () => {
    it('should validate safe args as valid', () => {
      const result = validateBrowserArgs(SAFE_BROWSER_ARGS);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.dangerousArgs).toHaveLength(0);
    });

    it('should identify dangerous args', () => {
      const result = validateBrowserArgs(['--disable-web-security']);

      expect(result.isValid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.dangerousArgs).toContain('--disable-web-security');
    });

    it('should provide warnings for dangerous args', () => {
      const result = validateBrowserArgs(['--disable-extensions']);

      expect(result.warnings[0]).toContain('Dangerous argument detected');
      expect(result.warnings[0]).toContain('--disable-extensions');
    });
  });

  describe('Constants', () => {
    it('should export SAFE_BROWSER_ARGS', () => {
      expect(SAFE_BROWSER_ARGS).toBeDefined();
      expect(Array.isArray(SAFE_BROWSER_ARGS)).toBe(true);
      expect(SAFE_BROWSER_ARGS.length).toBeGreaterThan(0);
    });

    it('should export DANGEROUS_BROWSER_ARGS', () => {
      expect(DANGEROUS_BROWSER_ARGS).toBeDefined();
      expect(Array.isArray(DANGEROUS_BROWSER_ARGS)).toBe(true);
      expect(DANGEROUS_BROWSER_ARGS.length).toBeGreaterThan(0);
    });

    it('should have safe args that do not overlap with dangerous args', () => {
      const overlap = SAFE_BROWSER_ARGS.filter(arg => DANGEROUS_BROWSER_ARGS.includes(arg));
      expect(overlap).toHaveLength(0);
    });
  });
});

// Additional branch coverage tests
describe('Browser Config Branch Coverage', () => {
  describe('DISPLAY environment variable', () => {
    it('should add display argument when DISPLAY is set', () => {
      const originalDisplay = process.env.DISPLAY;
      process.env.DISPLAY = ':99';

      const config = getXScrapingBrowserConfig();
      expect(config.args).toContain('--display=:99');

      // Restore
      if (originalDisplay !== undefined) {
        process.env.DISPLAY = originalDisplay;
      } else {
        delete process.env.DISPLAY;
      }
    });

    it('should handle DISPLAY for YouTube config', () => {
      const originalDisplay = process.env.DISPLAY;
      process.env.DISPLAY = ':0';

      const config = getYouTubeScrapingBrowserConfig();
      expect(config.args).toContain('--display=:0');

      // Restore
      if (originalDisplay !== undefined) {
        process.env.DISPLAY = originalDisplay;
      } else {
        delete process.env.DISPLAY;
      }
    });

    it('should handle DISPLAY for Profile config', () => {
      const originalDisplay = process.env.DISPLAY;
      process.env.DISPLAY = ':1';

      const config = getProfileBrowserConfig();
      expect(config.args).toContain('--display=:1');

      // Restore
      if (originalDisplay !== undefined) {
        process.env.DISPLAY = originalDisplay;
      } else {
        delete process.env.DISPLAY;
      }
    });
  });

  describe('Additional args branches', () => {
    it('should handle empty additionalArgs array', () => {
      const originalDisplay = process.env.DISPLAY;
      delete process.env.DISPLAY;

      const config = getXScrapingBrowserConfig({ additionalArgs: [] });
      expect(config.args).toEqual(SAFE_BROWSER_ARGS);

      // Restore
      if (originalDisplay !== undefined) {
        process.env.DISPLAY = originalDisplay;
      }
    });

    it('should handle additionalArgs for YouTube', () => {
      const additionalArgs = ['--test-arg'];
      const config = getYouTubeScrapingBrowserConfig({ additionalArgs });
      expect(config.args).toEqual(expect.arrayContaining(additionalArgs));
    });

    it('should handle additionalArgs for Profile', () => {
      const additionalArgs = ['--profile-arg'];
      const config = getProfileBrowserConfig({ additionalArgs });
      expect(config.args).toEqual(expect.arrayContaining(additionalArgs));
    });
  });

  describe('userDataDir branch', () => {
    it('should not include userDataDir when not provided', () => {
      const config = getProfileBrowserConfig();
      expect(config).not.toHaveProperty('userDataDir');
    });
  });

  describe('Validation edge cases', () => {
    it('should handle empty args array', () => {
      const result = validateBrowserArgs([]);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should handle multiple dangerous args', () => {
      const args = ['--disable-web-security', '--disable-extensions'];
      const result = validateBrowserArgs(args);
      expect(result.isValid).toBe(false);
      expect(result.warnings).toHaveLength(2);
    });
  });
});
