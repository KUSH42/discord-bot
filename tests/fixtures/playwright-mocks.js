/**
 * Playwright Browser Mock Factory
 * Provides complete mocks for Playwright browser automation testing
 */

import { jest } from '@jest/globals';

export const createPlaywrightMocks = () => {
  const mockPage = {
    close: jest.fn(),
    isClosed: jest.fn().mockReturnValue(false),
    goto: jest.fn(),
    waitForSelector: jest.fn(),
    evaluate: jest.fn(),
    type: jest.fn(),
    click: jest.fn(),
    waitForNavigation: jest.fn(),
    screenshot: jest.fn(),
    url: jest.fn(() => 'https://example.com'),
    setUserAgent: jest.fn(),
  };

  const mockBrowser = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn(),
    isConnected: jest.fn().mockReturnValue(true),
  };

  const mockLaunch = jest.fn().mockResolvedValue(mockBrowser);

  return {
    page: mockPage,
    browser: mockBrowser,
    launch: mockLaunch,

    // Helper to reset all mocks
    reset: () => {
      Object.values(mockPage).forEach(mock => {
        if (jest.isMockFunction(mock)) {
          mock.mockClear();
        }
      });
      Object.values(mockBrowser).forEach(mock => {
        if (jest.isMockFunction(mock)) {
          mock.mockClear();
        }
      });
      mockLaunch.mockClear();
    },

    // Helper to simulate browser connection loss
    simulateConnectionLoss: () => {
      mockBrowser.isConnected.mockReturnValue(false);
      mockPage.isClosed.mockReturnValue(true);
    },

    // Helper to simulate browser recovery
    simulateRecovery: () => {
      mockBrowser.isConnected.mockReturnValue(true);
      mockPage.isClosed.mockReturnValue(false);
    },
  };
};

export const mockPlaywrightModule = () => {
  const mocks = createPlaywrightMocks();

  jest.unstable_mockModule('playwright', () => ({
    chromium: {
      launch: mocks.launch,
    },
  }));

  return mocks;
};
