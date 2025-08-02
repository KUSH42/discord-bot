import { jest } from '@jest/globals';
import { createEnhancedLoggerMocks } from '../../fixtures/enhanced-logger-factory.js';

// Mock the playwright library
const mockLaunch = jest.fn();
const mockClose = jest.fn();
jest.unstable_mockModule('playwright', () => ({
  chromium: {
    launch: mockLaunch,
  },
}));

describe('Playwright Browser Service', () => {
  let browserService;
  let mockLogger;
  let mockDebugManager;
  let mockMetricsManager;
  let PlaywrightBrowserService;

  beforeEach(async () => {
    const loggerMocks = createEnhancedLoggerMocks();
    mockLogger = loggerMocks.baseLogger;
    mockDebugManager = loggerMocks.debugManager;
    mockMetricsManager = loggerMocks.metricsManager;

    PlaywrightBrowserService = (await import('../../../src/services/implementations/playwright-browser-service.js'))
      .PlaywrightBrowserService;
    browserService = new PlaywrightBrowserService(mockLogger, mockDebugManager, mockMetricsManager);
  });

  afterEach(async () => {
    // Clean up browser service if it was launched
    if (browserService && browserService.browser) {
      await browserService.close();
    }
    jest.clearAllMocks();
  });

  it('should launch a browser successfully', async () => {
    const mockPage = {
      close: jest.fn(),
      isClosed: jest.fn().mockReturnValue(false),
    };
    const mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: mockClose,
      isConnected: jest.fn().mockReturnValue(true),
    };
    mockLaunch.mockResolvedValue(mockBrowser);

    await browserService.launch();

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(browserService.browser).toBe(mockBrowser);
    expect(browserService.page).toBe(mockPage);
  });

  it('should close the browser successfully', async () => {
    const mockPage = {
      close: jest.fn(),
      isClosed: jest.fn().mockReturnValue(false),
    };
    const mockBrowser = {
      close: mockClose,
      isConnected: jest.fn().mockReturnValue(true),
    };
    browserService.browser = mockBrowser;
    browserService.page = mockPage;

    await browserService.close();

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(browserService.browser).toBeNull();
  });
});
