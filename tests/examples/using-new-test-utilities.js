/**
 * Example: Using New Test Utilities
 * This file demonstrates how the new test utilities simplify test creation
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { createScraperApplicationMocks, timerTestUtils, createPlaywrightMocks } from '../fixtures/test-helpers.js';

describe('Example: Simplified Test Creation', () => {
  let scraperApp;
  let mocks;
  let timerUtils;

  beforeEach(() => {
    // 🎯 BEFORE: Had to manually create 15+ mock objects across multiple files
    // 🎯 NOW: Single function call creates all necessary mocks with proper structure
    mocks = createScraperApplicationMocks();
    scraperApp = new ScraperApplication(mocks);

    // 🎯 BEFORE: Complex timer setup with multiple coordination patterns
    // 🎯 NOW: Simple utility setup for complex timer operations
    timerUtils = timerTestUtils.setupComplexTimerTest();
  });

  afterEach(() => {
    timerUtils.cleanup();
  });

  it('should process tweets with simplified mock setup', async () => {
    // Mock setup is already done - just configure specific behavior
    mocks.contentClassifier.classifyXContent.mockReturnValue({
      type: 'post',
      platform: 'x',
    });

    const tweet = {
      tweetID: '123',
      url: 'https://x.com/user/status/123',
      author: 'testuser',
      text: 'Test tweet',
      timestamp: '2024-01-01T12:00:00.000Z',
      tweetCategory: 'Post',
    };

    await scraperApp.processNewTweet(tweet);

    // All mocks are properly configured and accessible
    expect(mocks.contentCoordinator.processContent).toHaveBeenCalledWith(
      '123',
      'scraper',
      expect.objectContaining({
        platform: 'x',
        type: 'post',
        id: '123',
      })
    );
  });

  it('should handle complex timer operations with utility support', async () => {
    // 🎯 BEFORE: Complex manual timer coordination that often failed
    // 🎯 NOW: Reliable utility methods for complex timer scenarios
    const mockHealthCheck = jest.fn().mockResolvedValue(true);

    // Simulate a complex timer-based operation
    setTimeout(async () => {
      await mockHealthCheck();
    }, 1000);

    // Advanced timer progression with proper async coordination
    await timerUtils.advance(1000);

    expect(mockHealthCheck).toHaveBeenCalled();
  });
});

describe('Example: Playwright Browser Testing', () => {
  let browserMocks;

  beforeEach(() => {
    // 🎯 BEFORE: Had to manually add isClosed() and isConnected() methods
    // 🎯 NOW: Complete browser mock with all necessary methods
    browserMocks = createPlaywrightMocks();
  });

  it('should handle browser operations with complete mocks', async () => {
    const { browser, page } = browserMocks;

    // All necessary methods are available and properly mocked
    expect(browser.isConnected()).toBe(true);
    expect(page.isClosed()).toBe(false);

    await browser.close();

    // Utility method to simulate connection issues
    browserMocks.simulateConnectionLoss();
    expect(browser.isConnected()).toBe(false);
    expect(page.isClosed()).toBe(true);
  });
});
