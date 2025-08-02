// /home/xush/Documents/prog/discord-youtube-bot/tests/unit/playwright-browser-service.test.js
import { PlaywrightBrowserService } from '../../src/services/implementations/playwright-browser-service.js';
import { jest } from '@jest/globals';
import { createEnhancedLoggerMocks } from '../fixtures/enhanced-logger-factory.js';

describe('PlaywrightBrowserService', () => {
  let browserService;
  let mockPage;
  let mockBrowser;
  let mockLogger;
  let mockDebugManager;
  let mockMetricsManager;

  beforeEach(() => {
    const loggerMocks = createEnhancedLoggerMocks();
    mockLogger = loggerMocks.baseLogger;
    mockDebugManager = loggerMocks.debugManager;
    mockMetricsManager = loggerMocks.metricsManager;

    browserService = new PlaywrightBrowserService(mockLogger, mockDebugManager, mockMetricsManager);
    mockPage = {
      goto: jest.fn(),
      waitForTimeout: jest.fn().mockResolvedValue(),
      isClosed: jest.fn().mockReturnValue(false),
    };
    mockBrowser = {
      isConnected: jest.fn().mockReturnValue(true),
    };
    browserService.page = mockPage;
    browserService.browser = mockBrowser;
  });

  describe('goto with retries', () => {
    it('should retry navigation on failure and succeed on the third attempt', async () => {
      mockPage.goto
        .mockRejectedValueOnce(new Error('net::ERR_ABORTED'))
        .mockRejectedValueOnce(new Error('net::ERR_ABORTED'))
        .mockResolvedValueOnce('success');

      // Override setTimeout to make delays instant for testing
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = (fn, _delay) => originalSetTimeout(fn, 0);

      try {
        const result = await browserService.goto('https://example.com');
        expect(result).toBe('success');
        expect(mockPage.goto).toHaveBeenCalledTimes(3);
      } finally {
        // Restore original setTimeout
        global.setTimeout = originalSetTimeout;
      }
    });

    it('should retry exactly 3 times when navigation fails consistently', async () => {
      // Use mockRejectedValueOnce for each attempt to avoid Jest error logging issues
      mockPage.goto
        .mockRejectedValueOnce(new Error('net::ERR_ABORTED'))
        .mockRejectedValueOnce(new Error('net::ERR_ABORTED'))
        .mockRejectedValueOnce(new Error('net::ERR_ABORTED'));

      // Override setTimeout to make delays instant for testing
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = (fn, _delay) => originalSetTimeout(fn, 0);

      let thrownError;
      try {
        await browserService.goto('https://example.com');
      } catch (error) {
        thrownError = error;
      } finally {
        // Restore original setTimeout
        global.setTimeout = originalSetTimeout;
      }

      // Verify the error was thrown and retries occurred
      expect(thrownError).toBeDefined();
      expect(thrownError.message).toBe('net::ERR_ABORTED');
      expect(mockPage.goto).toHaveBeenCalledTimes(3);
    });
  });
});
