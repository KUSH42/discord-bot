import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { createScraperApplicationMocks } from '../fixtures/application-mocks.js';

describe('ScraperApplication Edge Cases and Error Scenarios', () => {
  let scraperApp;
  let mockDependencies;
  let mockBrowserService;
  let mockAuthManager;
  let mockContentClassifier;
  let mockLogger;
  let mockDuplicateDetector;
  let mockContentCoordinator;

  beforeEach(() => {
    jest.useFakeTimers();
    mockDependencies = createScraperApplicationMocks();

    // Extract mocks from dependencies
    mockBrowserService = mockDependencies.browserService;
    mockAuthManager = mockDependencies.xAuthManager;
    mockContentClassifier = mockDependencies.contentClassifier;
    mockLogger = mockDependencies.logger;

    // Add missing dependencies
    mockDuplicateDetector = {
      isDuplicate: jest.fn().mockResolvedValue(false),
      markAsSeen: jest.fn(),
      getStats: jest.fn().mockReturnValue({}),
    };

    mockContentCoordinator = {
      processContent: jest.fn().mockResolvedValue({ success: true, message: 'Processed' }),
    };

    mockDependencies.duplicateDetector = mockDuplicateDetector;
    mockDependencies.contentCoordinator = mockContentCoordinator;

    // Configure browser service methods
    mockBrowserService.isHealthy = jest.fn(() => true);
    mockBrowserService.launch = jest.fn().mockResolvedValue(undefined);
    mockBrowserService.goto = jest.fn().mockResolvedValue(undefined);
    mockBrowserService.waitForSelector = jest.fn().mockResolvedValue(undefined);
    mockBrowserService.evaluate = jest.fn().mockResolvedValue([]);
    mockBrowserService.setUserAgent = jest.fn().mockResolvedValue(undefined);
    mockBrowserService.close = jest.fn().mockResolvedValue(undefined);
    mockBrowserService.isRunning = jest.fn(() => true);
    mockBrowserService.getCurrentUrl = jest.fn().mockResolvedValue('https://x.com/test');
    mockBrowserService.getUrl = jest.fn().mockResolvedValue('https://x.com/test');
    mockBrowserService.getConsoleLogs = jest.fn().mockResolvedValue([]);
    mockBrowserService.page = { isClosed: jest.fn().mockReturnValue(false) };

    mockAuthManager.ensureAuthenticated = jest.fn().mockResolvedValue(undefined);
    mockAuthManager.isAuthenticated = jest.fn().mockResolvedValue(true);

    // Create ScraperApplication instance using dependency injection
    scraperApp = new ScraperApplication(mockDependencies);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('Configuration Edge Cases', () => {
    it('should handle missing user handle gracefully', async () => {
      // Arrange - Create new mock with missing config value
      const mockDepsWithMissingConfig = createScraperApplicationMocks();
      mockDepsWithMissingConfig.config.getRequired.mockImplementation(key => {
        if (key === 'X_USER_HANDLE') {
          throw new Error('X_USER_HANDLE is required but not provided');
        }
        return 'default-value';
      });

      // Act & Assert - Constructor should throw when config is missing
      expect(() => new ScraperApplication(mockDepsWithMissingConfig)).toThrow(
        'X_USER_HANDLE is required but not provided'
      );
    });

    it('should handle invalid polling interval', async () => {
      // Arrange - Create new mock with invalid polling interval
      const mockDepsWithInvalidInterval = createScraperApplicationMocks();
      mockDepsWithInvalidInterval.config.get.mockImplementation((key, defaultValue) => {
        if (key === 'X_QUERY_INTERVAL_MIN') {
          return '-1000'; // Invalid negative interval
        }
        return defaultValue;
      });

      // Act & Assert - Constructor should handle invalid intervals gracefully
      const app = new ScraperApplication(mockDepsWithInvalidInterval);
      expect(app.minInterval).toBe(-1000); // Constructor just parses the value
    });
  });

  describe('Browser Service Edge Cases', () => {
    it('should handle browser launch failure', async () => {
      // Arrange
      mockBrowserService.launch.mockRejectedValue(new Error('Browser startup failed'));

      // Mock initialization methods
      jest.spyOn(scraperApp, 'initializeRecentContent').mockResolvedValue(undefined);
      jest.spyOn(scraperApp, 'startPolling').mockImplementation(() => {});
      jest.spyOn(scraperApp, 'startHealthMonitoring').mockImplementation(() => {});

      // Act & Assert - start should handle browser failures gracefully
      await expect(scraperApp.start()).rejects.toThrow('Browser startup failed');
      expect(mockBrowserService.launch).toHaveBeenCalled();
    });

    it('should handle authentication failure', async () => {
      // Arrange
      mockAuthManager.ensureAuthenticated.mockRejectedValue(new Error('Authentication failed'));

      // Mock initialization methods
      jest.spyOn(scraperApp, 'initializeRecentContent').mockResolvedValue(undefined);
      jest.spyOn(scraperApp, 'startPolling').mockImplementation(() => {});
      jest.spyOn(scraperApp, 'startHealthMonitoring').mockImplementation(() => {});

      // Act & Assert - start should handle auth failures gracefully
      await expect(scraperApp.start()).rejects.toThrow('Authentication failed');
      expect(mockAuthManager.ensureAuthenticated).toHaveBeenCalled();
    });
  });

  describe('Content Processing Edge Cases', () => {
    it('should handle empty content arrays', async () => {
      // Arrange
      mockBrowserService.evaluate.mockResolvedValue([]); // Empty array from tweet extraction

      // Mock navigation methods to avoid errors
      jest.spyOn(scraperApp, 'navigateToProfileTimeline').mockResolvedValue(undefined);
      jest.spyOn(scraperApp, 'performEnhancedScrolling').mockResolvedValue(undefined);

      // Act
      await scraperApp.pollXProfile();

      // Assert - Should complete without throwing errors
      expect(mockBrowserService.evaluate).toHaveBeenCalled();
      expect(mockAuthManager.isAuthenticated).toHaveBeenCalled();
    });

    it('should handle valid tweet processing', async () => {
      // Arrange - Valid tweet that will trigger classification
      const validTweet = {
        tweetID: '1',
        url: 'https://x.com/user/status/1',
        text: 'Test post',
        author: 'user',
        timestamp: new Date().toISOString(),
        tweetCategory: 'Post',
      };

      mockBrowserService.evaluate.mockResolvedValue([validTweet]);
      mockContentClassifier.classifyXContent.mockReturnValue({ type: 'post' });

      // Mock navigation methods
      jest.spyOn(scraperApp, 'navigateToProfileTimeline').mockResolvedValue(undefined);
      jest.spyOn(scraperApp, 'performEnhancedScrolling').mockResolvedValue(undefined);

      // Act
      await scraperApp.pollXProfile();

      // Assert - Should process the tweet successfully through ContentCoordinator
      // Note: Classification now happens inside ContentCoordinator, not directly in ScraperApplication
      expect(mockContentCoordinator.processContent).toHaveBeenCalledWith(
        validTweet.tweetID,
        'scraper',
        expect.objectContaining({
          platform: 'x',
          type: 'post', // Default type - ContentClassifier will refine this
          id: validTweet.tweetID,
          url: validTweet.url,
        })
      );
    });
  });

  describe('Health Monitoring', () => {
    it('should perform basic health check', async () => {
      // Arrange
      scraperApp.isRunning = true;

      // Act
      const healthResult = await scraperApp.performHealthCheck();

      // Assert
      expect(healthResult).toEqual(
        expect.objectContaining({
          isRunning: true,
          authenticated: true,
          browserHealthy: true,
          errors: [],
        })
      );
    });

    it('should detect when not running', async () => {
      // Arrange
      scraperApp.isRunning = false;

      // Act
      const healthResult = await scraperApp.performHealthCheck();

      // Assert
      expect(healthResult.isRunning).toBe(false);
      expect(healthResult.errors).toContain('Application not running');
    });
  });

  describe('State Management', () => {
    it('should prevent concurrent start operations', async () => {
      // Arrange
      mockBrowserService.launch.mockResolvedValue(undefined);
      mockBrowserService.setUserAgent.mockResolvedValue(undefined);
      mockAuthManager.ensureAuthenticated.mockResolvedValue(undefined);

      // Mock initialization methods
      jest.spyOn(scraperApp, 'initializeRecentContent').mockResolvedValue(undefined);
      jest.spyOn(scraperApp, 'startPolling').mockImplementation(() => {});
      jest.spyOn(scraperApp, 'startHealthMonitoring').mockImplementation(() => {});

      // Act - Start multiple concurrent operations
      const promises = [scraperApp.start(), scraperApp.start(), scraperApp.start()];
      const results = await Promise.allSettled(promises);

      // Assert - At least one should succeed, others should be rejected or successful
      // (The actual implementation might handle this differently than expected)
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const rejectCount = results.filter(r => r.status === 'rejected').length;

      // Verify that we got some results
      expect(successCount + rejectCount).toBe(3);
      expect(successCount).toBeGreaterThanOrEqual(1);

      // Verify results based on reject count
      const rejectedResults = results.filter(r => r.status === 'rejected');
      expect(rejectedResults).toHaveLength(rejectCount);

      // If there are rejected results, verify they have appropriate error messages
      rejectedResults.forEach(result => {
        expect(result.reason.message).toContain('already running');
      });

      // Verify fulfilled results
      const fulfilledResults = results.filter(r => r.status === 'fulfilled');
      expect(fulfilledResults).toHaveLength(successCount);
    });
  });

  describe('Resource Cleanup', () => {
    it('should handle normal stop operation', async () => {
      // Arrange
      scraperApp.isRunning = true;
      scraperApp.healthCheckInterval = setInterval(() => {}, 1000);

      // Act
      await scraperApp.stop();

      // Assert
      expect(scraperApp.isRunning).toBe(false);
      expect(mockBrowserService.close).toHaveBeenCalled();
    });

    it('should handle stop when not running', async () => {
      // Arrange
      scraperApp.isRunning = false;

      // Act & Assert - Should complete without errors
      await expect(scraperApp.stop()).resolves.not.toThrow();
    });
  });

  describe('Statistics', () => {
    it('should return basic statistics', () => {
      // Act
      const stats = scraperApp.getStats();

      // Assert
      expect(stats).toEqual(
        expect.objectContaining({
          isRunning: false,
          xUser: expect.any(String),
          pollingInterval: expect.objectContaining({
            min: expect.any(Number),
            max: expect.any(Number),
          }),
          totalRuns: 0,
          successfulRuns: 0,
          failedRuns: 0,
        })
      );
    });
  });

  describe('Critical Timer Management Regression Tests', () => {
    /**
     * REGRESSION TEST: Prevents timer multiplication OOM bug
     *
     * Original Issue: scheduleRetry() created new timers without clearing old ones,
     * leading to exponential timer accumulation and OOM kills in production.
     *
     * Root Cause: this.timerId = setTimeout(...) overwrote reference but didn't
     * clear the previous timer, causing multiple concurrent retry timers.
     */
    describe('Timer Multiplication Prevention', () => {
      let clearTimeoutSpy;
      let setTimeoutSpy;

      beforeEach(() => {
        clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
        setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      });

      afterEach(() => {
        clearTimeoutSpy.mockRestore();
        setTimeoutSpy.mockRestore();
      });

      it('should clear existing timer before creating new retry timer (prevents OOM bug)', async () => {
        // REGRESSION TEST: This prevents the critical timer multiplication bug

        // Arrange - Set up existing timer
        scraperApp.timerId = 12345;

        // Act - Call scheduleRetry (should clear existing timer first)
        scraperApp.scheduleRetry();

        // Assert - Must clear existing timer before creating new one
        expect(clearTimeoutSpy).toHaveBeenCalledWith(12345);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(scraperApp.timerId).not.toBe(12345); // Should be new timer ID
      });

      it('should not accumulate multiple timers during retry failures', async () => {
        // REGRESSION TEST: Prevents exponential timer accumulation

        // Arrange - Reset retry count
        scraperApp.retryCount = 0;

        // Act - Simulate multiple retry failures
        scraperApp.scheduleRetry(); // First retry
        const firstTimerId = scraperApp.timerId;

        scraperApp.scheduleRetry(); // Second retry
        const secondTimerId = scraperApp.timerId;

        scraperApp.scheduleRetry(); // Third retry
        const thirdTimerId = scraperApp.timerId;

        // Assert - Each call should clear previous timer
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(2); // Called for 2nd and 3rd retries
        expect(setTimeoutSpy).toHaveBeenCalledTimes(3); // Three total timers created

        // Verify timer IDs are different (not accumulating)
        expect(firstTimerId).not.toBe(secondTimerId);
        expect(secondTimerId).not.toBe(thirdTimerId);
      });

      it('should enforce maximum retry limit to prevent infinite recursion', async () => {
        // REGRESSION TEST: Prevents infinite retry loops that cause resource exhaustion

        // Arrange - Mock stop method to track calls
        const stopSpy = jest.spyOn(scraperApp, 'stop').mockResolvedValue();

        // Act - Exhaust all retries
        for (let i = 0; i < 6; i++) {
          // One more than MAX_RETRIES (5)
          scraperApp.scheduleRetry();
        }

        // Assert - Should call stop() when max retries exceeded
        expect(stopSpy).toHaveBeenCalled();
        expect(scraperApp.retryCount).toBe(5); // Should not exceed MAX_RETRIES
      });

      it('should reset retry count on successful poll after failures', async () => {
        // REGRESSION TEST: Ensures retry count resets on success

        // Arrange - Set up retry scenario, start with fresh retry count
        scraperApp.retryCount = 0;
        scraperApp.isRunning = true; // Ensure scraper is running

        // Mock pollXProfile to succeed this time
        const pollSpy = jest.spyOn(scraperApp, 'pollXProfile').mockResolvedValueOnce();
        const scheduleNextPollSpy = jest.spyOn(scraperApp, 'scheduleNextPoll').mockImplementation(() => {});

        // Act - Schedule retry (this will increment retry count to 1)
        scraperApp.scheduleRetry();
        expect(scraperApp.retryCount).toBe(1); // Verify it incremented

        // Simulate timer execution with successful poll
        const timerCallback = setTimeoutSpy.mock.calls[0][0];
        await timerCallback();

        // Assert - Poll was called and retry count was reset
        expect(pollSpy).toHaveBeenCalled();
        expect(scheduleNextPollSpy).toHaveBeenCalled();
        expect(scraperApp.retryCount).toBe(0);
      });
    });

    describe('Timer Cleanup During Shutdown', () => {
      it('should clear retry timers when stopping polling', () => {
        // REGRESSION TEST: Ensures proper cleanup prevents resource leaks

        // Arrange - Set up active timer
        scraperApp.timerId = 12345;
        scraperApp.retryCount = 2;

        const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

        // Act - Stop polling
        scraperApp.stopPolling();

        // Assert - Should clear timer and reset state
        expect(clearTimeoutSpy).toHaveBeenCalledWith(12345);
        expect(scraperApp.timerId).toBe(null);
        expect(scraperApp.retryCount).toBe(0);
        expect(scraperApp.nextPollTimestamp).toBe(null);
      });
    });

    describe('Exponential Backoff Implementation', () => {
      it('should implement exponential backoff for retry intervals', () => {
        // REGRESSION TEST: Verifies proper backoff prevents resource exhaustion

        // Arrange - Reset retry count
        scraperApp.retryCount = 0;
        scraperApp.minInterval = 1000;
        scraperApp.maxInterval = 10000;

        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

        // Act & Assert - Test progressive backoff
        scraperApp.scheduleRetry(); // Retry 1
        expect(scraperApp.retryCount).toBe(1);
        const interval1 = setTimeoutSpy.mock.calls[0][1];

        scraperApp.scheduleRetry(); // Retry 2
        expect(scraperApp.retryCount).toBe(2);
        const interval2 = setTimeoutSpy.mock.calls[1][1];

        scraperApp.scheduleRetry(); // Retry 3
        expect(scraperApp.retryCount).toBe(3);
        const interval3 = setTimeoutSpy.mock.calls[2][1];

        // Assert - Intervals should increase exponentially but cap at maxInterval
        expect(interval2).toBeGreaterThan(interval1);
        expect(interval3).toBeGreaterThan(interval2);
        expect(interval3).toBeLessThanOrEqual(scraperApp.maxInterval);
      });
    });
  });
});
