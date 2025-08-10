import { jest } from '@jest/globals';
import { PlaywrightBrowserService } from '../../src/services/implementations/playwright-browser-service.js';
import { createEnhancedLoggerMocks } from '../fixtures/enhanced-logger-factory.js';

describe('Browser Service Disposal', () => {
  let browserService;
  let mockLogger;
  let mockDebugManager;
  let mockMetricsManager;

  beforeEach(() => {
    const mocks = createEnhancedLoggerMocks();
    mockLogger = mocks.logger;
    mockDebugManager = mocks.debugManager;
    mockMetricsManager = mocks.metricsManager;

    browserService = new PlaywrightBrowserService(mockLogger, mockDebugManager, mockMetricsManager);
  });

  describe('dispose method', () => {
    it('should have dispose method', () => {
      expect(typeof browserService.dispose).toBe('function');
    });

    it('should call close when disposing', async () => {
      const closeSpy = jest.spyOn(browserService, 'close').mockResolvedValue();

      await browserService.dispose();

      expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle disposal when browser is not running', async () => {
      // Ensure browser is not running
      expect(browserService.isRunning()).toBe(false);

      // Should not throw
      await expect(browserService.dispose()).resolves.not.toThrow();
    });
  });

  describe('connection state methods', () => {
    it('should have isConnected method', () => {
      expect(typeof browserService.isConnected).toBe('function');
    });

    it('should have isClosed method', () => {
      expect(typeof browserService.isClosed).toBe('function');
    });

    it('should return false for isConnected when browser is null', () => {
      expect(browserService.isConnected()).toBe(false);
    });

    it('should return true for isClosed when browser is null', () => {
      expect(browserService.isClosed()).toBe(true);
    });

    it('should return false for isRunning when browser is null', () => {
      expect(browserService.isRunning()).toBe(false);
    });
  });

  describe('close protection', () => {
    it('should prevent multiple concurrent close operations', async () => {
      // Mock a browser that's connected
      const mockBrowser = {
        isConnected: jest.fn(() => true),
        close: jest.fn().mockResolvedValue(),
      };
      browserService.browser = mockBrowser;

      // Start multiple close operations concurrently
      const closePromises = [browserService.close(), browserService.close(), browserService.close()];

      await Promise.all(closePromises);

      // Browser close should only be called once due to protection
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });
  });
});
