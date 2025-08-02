import { jest } from '@jest/globals';
import { ProcessCleanup } from '../../../src/utilities/process-cleanup.js';
import { createEnhancedLoggerMocks } from '../../fixtures/enhanced-logger-factory.js';

describe('ProcessCleanup', () => {
  let processCleanup;
  let mockLogger;

  beforeEach(() => {
    const mocks = createEnhancedLoggerMocks();
    mockLogger = mocks.logger;
    processCleanup = new ProcessCleanup(mockLogger);
  });

  describe('checkBrowserHealth', () => {
    it('should return healthy status for normal usage', async () => {
      const health = await processCleanup.checkBrowserHealth();

      expect(health).toHaveProperty('healthy');
      expect(health).toHaveProperty('warnings');
      expect(health).toHaveProperty('memoryMB');
      expect(health).toHaveProperty('processCount');
      expect(Array.isArray(health.warnings)).toBe(true);
    });

    it('should detect high memory usage', async () => {
      // Mock high memory usage
      jest.spyOn(processCleanup, 'getBrowserMemoryUsage').mockResolvedValue({
        totalMemoryMB: 3000, // Over 2GB limit
        processCount: 5,
      });

      const health = await processCleanup.checkBrowserHealth();

      expect(health.healthy).toBe(false);
      expect(health.warnings).toContain('High browser memory usage: 3000MB');
    });

    it('should detect too many browser processes', async () => {
      // Mock high process count
      jest.spyOn(processCleanup, 'getBrowserMemoryUsage').mockResolvedValue({
        totalMemoryMB: 500,
        processCount: 25, // Over 20 process limit
      });

      const health = await processCleanup.checkBrowserHealth();

      expect(health.healthy).toBe(false);
      expect(health.warnings).toContain('Too many browser processes: 25');
    });
  });

  describe('getBrowserProcessCount', () => {
    it('should return a number', async () => {
      const count = await processCleanup.getBrowserProcessCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('killZombieBrowsers', () => {
    it('should complete without throwing', async () => {
      await expect(processCleanup.killZombieBrowsers()).resolves.not.toThrow();
    });
  });
});
