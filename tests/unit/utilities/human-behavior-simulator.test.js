import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HumanBehaviorSimulator } from '../../../src/utilities/human-behavior-simulator.js';
import { createEnhancedLoggerMocks } from '../../fixtures/enhanced-logger-factory.js';

describe('HumanBehaviorSimulator', () => {
  let mockPage;
  let mockLogger;
  let simulator;
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Mock Playwright page object with complete interface
    mockPage = {
      goto: jest.fn().mockResolvedValue({ status: () => 200 }),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      mouse: {
        move: jest.fn().mockResolvedValue(undefined),
      },
      evaluate: jest.fn().mockResolvedValue(1000), // Default text content length
      focus: jest.fn().mockResolvedValue(undefined),
      fill: jest.fn().mockResolvedValue(undefined),
      type: jest.fn().mockResolvedValue(undefined),
      press: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockReturnValue({
        boundingBox: jest.fn().mockResolvedValue({
          x: 100,
          y: 100,
          width: 200,
          height: 50,
        }),
      }),
    };

    // Create enhanced logger mocks
    const loggerMocks = createEnhancedLoggerMocks();
    mockLogger = loggerMocks.logger;

    // Create simulator instance
    simulator = new HumanBehaviorSimulator(mockPage, mockLogger);

    // Don't use fake timers for this test - too complex
    jest.useRealTimers();
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      expect(simulator.page).toBe(mockPage);
      expect(simulator.logger).toBe(mockLogger);
      expect(simulator.mousePosition).toEqual({ x: 0, y: 0 });
      expect(simulator.config.readingWPM).toBe(200); // Default value
    });

    it('should use environment variables for configuration', () => {
      process.env.HUMAN_READING_WPM = '250';
      process.env.MOUSE_MOVEMENT_ENABLED = 'false';
      process.env.SCROLLING_SIMULATION_ENABLED = 'false';
      process.env.READING_TIME_SIMULATION = 'false';

      const customSimulator = new HumanBehaviorSimulator(mockPage, mockLogger);

      expect(customSimulator.config.readingWPM).toBe(250);
      expect(customSimulator.config.mouseMovements.enabled).toBe(false);
      expect(customSimulator.config.scrolling.enabled).toBe(false);
      expect(customSimulator.config.reading.enabled).toBe(false);
    });

    it('should log initialization with debug', () => {
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'HumanBehaviorSimulator initialized',
        expect.objectContaining({
          config: expect.any(Object),
        })
      );
    });
  });

  describe('calculateReadingTime', () => {
    it('should calculate reading time based on WPM and text length', () => {
      simulator.config.reading.readingWPM = 200;
      simulator.config.reading.charactersPerWord = 5;

      const textLength = 1000; // 200 words at 5 chars per word
      const expectedTimeMs = (200 / 200) * 60 * 1000; // 1 minute

      const result = simulator.calculateReadingTime(textLength);

      expect(result).toBe(expectedTimeMs);
    });

    it('should handle zero text length', () => {
      const result = simulator.calculateReadingTime(0);

      // Should calculate for at least minimum characters (1 word worth)
      const expectedTime = (1 / simulator.config.reading.readingWPM) * 60 * 1000;
      expect(result).toBe(expectedTime);
    });

    it('should handle very large text lengths', () => {
      const textLength = 10000; // Large but reasonable text

      // Ensure config is valid
      simulator.config.reading.readingWPM = 200;
      simulator.config.reading.charactersPerWord = 5;

      const result = simulator.calculateReadingTime(textLength);

      expect(result).toBeGreaterThan(0);
      expect(Number.isFinite(result)).toBe(true);
      expect(typeof result).toBe('number');
    });
  });

  describe('randomDelay', () => {
    it('should generate random values within range', () => {
      const min = 100;
      const max = 500;

      // Test multiple times to verify randomness
      for (let i = 0; i < 10; i++) {
        const delay = simulator.randomDelay(min, max);
        expect(delay).toBeGreaterThanOrEqual(min);
        expect(delay).toBeLessThanOrEqual(max);
        expect(Number.isInteger(delay)).toBe(true);
      }
    });

    it('should handle equal min and max values', () => {
      const value = simulator.randomDelay(100, 100);
      expect(value).toBe(100);
    });

    it('should handle edge cases', () => {
      expect(simulator.randomDelay(0, 1)).toBeGreaterThanOrEqual(0);
      expect(simulator.randomDelay(0, 1)).toBeLessThanOrEqual(1);
    });
  });

  describe('getConfiguration', () => {
    it('should return current configuration with mouse position', () => {
      const config = simulator.getConfiguration();

      expect(config).toEqual({
        ...simulator.config,
        mousePosition: { ...simulator.mousePosition },
      });
    });

    it('should return a copy of configuration objects', () => {
      const config = simulator.getConfiguration();

      // Modifying returned config should not affect original
      config.mousePosition.x = 999;
      config.readingWPM = 999;

      expect(simulator.mousePosition.x).not.toBe(999);
      expect(simulator.config.readingWPM).not.toBe(999);
    });
  });

  describe('updateConfiguration', () => {
    it('should update configuration with new values', () => {
      const newConfig = {
        readingWPM: 300,
        mouseMovements: {
          enabled: false,
          minMovements: 5,
        },
      };

      simulator.updateConfiguration(newConfig);

      expect(simulator.config.readingWPM).toBe(300);
      expect(simulator.config.mouseMovements.enabled).toBe(false);
      expect(simulator.config.mouseMovements.minMovements).toBe(5);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'HumanBehaviorSimulator configuration updated',
        expect.objectContaining({
          newConfig: simulator.config,
        })
      );
    });

    it('should preserve existing configuration when partially updating', () => {
      const originalReadingWPM = simulator.config.readingWPM;
      const newConfig = {
        mouseMovements: {
          enabled: false,
        },
      };

      simulator.updateConfiguration(newConfig);

      expect(simulator.config.readingWPM).toBe(originalReadingWPM);
      expect(simulator.config.mouseMovements.enabled).toBe(false);
    });
  });

  describe('smoothMouseMove', () => {
    it('should update mouse position to target coordinates', async () => {
      const targetX = 500;
      const targetY = 300;

      await simulator.smoothMouseMove(targetX, targetY);

      expect(mockPage.mouse.move).toHaveBeenCalled();
      // Allow for some randomness in the final position due to variance (within 5 pixels)
      expect(Math.abs(simulator.mousePosition.x - targetX)).toBeLessThan(5);
      expect(Math.abs(simulator.mousePosition.y - targetY)).toBeLessThan(5);
    });

    it('should constrain mouse position to screen bounds', async () => {
      await simulator.smoothMouseMove(3000, 2000); // Beyond typical screen size

      expect(simulator.mousePosition.x).toBeLessThanOrEqual(1920);
      expect(simulator.mousePosition.y).toBeLessThanOrEqual(1080);
      expect(simulator.mousePosition.x).toBeGreaterThanOrEqual(0);
      expect(simulator.mousePosition.y).toBeGreaterThanOrEqual(0);
    });

    it('should handle page closed errors gracefully', async () => {
      mockPage.mouse.move.mockRejectedValue(new Error('Target page closed'));

      // Should not throw error
      await expect(simulator.smoothMouseMove(100, 100)).resolves.toBeUndefined();
      expect(mockLogger.debug).toHaveBeenCalledWith('Page unavailable during mouse movement, stopping');
    });
  });

  describe('configuration validation', () => {
    it('should handle invalid environment variable values', () => {
      process.env.HUMAN_READING_WPM = 'invalid-number';

      const testSimulator = new HumanBehaviorSimulator(mockPage, mockLogger);

      // Should fall back to default value
      expect(testSimulator.config.readingWPM).toBe(200);
    });

    it('should handle missing environment variables', () => {
      delete process.env.HUMAN_READING_WPM;
      delete process.env.MOUSE_MOVEMENT_ENABLED;

      const testSimulator = new HumanBehaviorSimulator(mockPage, mockLogger);

      expect(testSimulator.config.readingWPM).toBe(200);
      expect(testSimulator.config.mouseMovements.enabled).toBe(true);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle missing logger gracefully', () => {
      const simulatorWithoutLogger = new HumanBehaviorSimulator(mockPage, null);

      expect(() => simulatorWithoutLogger.randomDelay(100, 200)).not.toThrow();
      expect(simulatorWithoutLogger.config).toBeDefined();
    });

    it('should handle page navigation timeout', async () => {
      const error = new Error('Navigation timeout');
      mockPage.goto.mockRejectedValue(error);

      await expect(simulator.simulateRealisticPageLoad('https://slow-site.com')).rejects.toThrow('Navigation timeout');
    });
  });

  describe('behavior simulation basic functionality', () => {
    it('should call basic page interactions for reading behavior', async () => {
      mockPage.evaluate.mockResolvedValue(1000);

      await simulator.simulateReadingBehavior();

      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function));
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Simulating reading behavior',
        expect.objectContaining({
          textLength: 1000,
        })
      );
    });

    it('should handle page content evaluation errors', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Page unavailable'));

      await simulator.simulateReadingBehavior();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Could not analyze page content, using minimum reading time',
        expect.objectContaining({
          error: 'Page unavailable',
        })
      );
    });

    it('should perform basic scrolling operations', async () => {
      simulator.config.scrolling.minScrolls = 1;
      simulator.config.scrolling.maxScrolls = 1;

      await simulator.simulateScrolling();

      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Simulating scrolling behavior',
        expect.objectContaining({ scrolls: 1 })
      );
    });

    it('should handle scrolling errors gracefully', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Target page closed'));

      await expect(simulator.simulateScrolling()).resolves.toBeUndefined();
      expect(mockLogger.debug).toHaveBeenCalledWith('Page unavailable during scrolling, stopping');
    });
  });

  describe('human interaction simulation', () => {
    it('should simulate basic mouse movements', async () => {
      simulator.config.mouseMovements.minMovements = 1;
      simulator.config.mouseMovements.maxMovements = 1;

      await simulator.simulateMouseMovements();

      expect(mockPage.mouse.move).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Simulating mouse movements',
        expect.objectContaining({ movements: 1 })
      );
    });

    it('should simulate human typing without mistakes', async () => {
      const selector = '#input-field';
      const text = 'Hello';
      const options = { minDelay: 10, maxDelay: 20, mistakes: false };

      await simulator.simulateHumanTyping(selector, text, options);

      expect(mockPage.focus).toHaveBeenCalledWith(selector);
      expect(mockPage.fill).toHaveBeenCalledWith(selector, '');
      expect(mockPage.type).toHaveBeenCalledWith(selector, expect.any(String), {
        delay: expect.any(Number),
      });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Human typing completed',
        expect.objectContaining({
          targetLength: text.length,
          actualLength: text.length,
        })
      );
    });

    it('should simulate human clicking with element detection', async () => {
      const selector = '.button';

      await simulator.simulateHumanClick(selector, { preClickDelay: true, postClickDelay: false });

      expect(mockPage.locator).toHaveBeenCalledWith(selector);
      expect(mockPage.click).toHaveBeenCalledWith(selector, { preClickDelay: true, postClickDelay: false });
      expect(mockLogger.debug).toHaveBeenCalledWith('Simulating human click', expect.objectContaining({ selector }));
    });

    it('should handle element without bounding box', async () => {
      const selector = '.missing-element';
      mockPage.locator().boundingBox.mockResolvedValue(null);

      await simulator.simulateHumanClick(selector);

      expect(mockPage.click).toHaveBeenCalledWith(selector, {});
    });
  });

  describe('integration scenarios', () => {
    it('should handle disabled behaviors gracefully', async () => {
      simulator.config.reading.enabled = false;
      simulator.config.mouseMovements.enabled = false;
      simulator.config.scrolling.enabled = false;

      await simulator.simulatePostNavigationBehavior();

      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('networkidle');
      // Since all behaviors are disabled, minimal interactions should occur
      expect(mockPage.evaluate).not.toHaveBeenCalled();
      expect(mockPage.mouse.move).not.toHaveBeenCalled();
    });

    it('should perform basic page load without complex behaviors', async () => {
      // Disable complex behaviors for simpler testing
      simulator.config.reading.enabled = false;
      simulator.config.mouseMovements.enabled = false;
      simulator.config.scrolling.enabled = false;

      const url = 'https://example.com';
      const result = await simulator.simulateRealisticPageLoad(url);

      expect(mockPage.goto).toHaveBeenCalledWith(url, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });
      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('networkidle');
      expect(result).toEqual({ status: expect.any(Function) });
    });
  });
});
