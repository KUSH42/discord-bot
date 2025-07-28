import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('ScraperApplication Edge Cases and Error Scenarios', () => {
  let scraperApp;
  let mockDependencies;
  let mockConfig;
  let mockBrowserService;
  let mockAuthManager;
  let mockContentAnnouncer;
  let mockContentClassifier;
  let mockLogger;
  let mockDebugManager;
  let mockMetricsManager;

  beforeEach(() => {
    mockDependencies = createMockDependenciesWithEnhancedLogging();

    // Extract mocks from dependencies
    mockConfig = mockDependencies.config;
    mockBrowserService = mockDependencies.browserService;
    mockAuthManager = mockDependencies.authManager;
    mockContentAnnouncer = mockDependencies.contentAnnouncer;
    mockContentClassifier = mockDependencies.contentClassifier;
    mockLogger = mockDependencies.logger;
    mockDebugManager = mockDependencies.debugManager;
    mockMetricsManager = mockDependencies.metricsManager;

    // Configure default behavior
    mockConfig.xUserHandle = 'testuser';
    mockConfig.xPollingInterval = 30000;
    mockConfig.isAnnouncingEnabled = jest.fn(() => true);

    mockBrowserService.isHealthy = jest.fn(() => true);
    mockBrowserService.launch = jest.fn().mockResolvedValue(undefined);
    mockBrowserService.navigateTo = jest.fn().mockResolvedValue(undefined);
    mockBrowserService.scrapePage = jest.fn().mockResolvedValue([]);
    mockBrowserService.close = jest.fn().mockResolvedValue(undefined);

    mockAuthManager.login = jest.fn().mockResolvedValue({ success: true });
    mockAuthManager.isAuthenticated = jest.fn(() => true);

    mockContentAnnouncer.announce = jest.fn().mockResolvedValue(undefined);
    mockContentClassifier.classifyContent = jest.fn().mockReturnValue('post');

    // Create ScraperApplication instance
    scraperApp = new ScraperApplication(
      mockConfig,
      mockBrowserService,
      mockAuthManager,
      mockContentAnnouncer,
      mockContentClassifier,
      mockLogger,
      mockDebugManager,
      mockMetricsManager
    );

    // Mock timers
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('Configuration Edge Cases', () => {
    it('should handle missing user handle gracefully', async () => {
      // Arrange
      mockConfig.xUserHandle = '';
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act & Assert
      await expect(scraperApp.startScraping()).rejects.toThrow('User handle is required for scraping');

      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User handle is required for scraping' }),
        'Scraping startup failed due to invalid configuration'
      );
    });

    it('should handle invalid polling interval', async () => {
      // Arrange
      mockConfig.xPollingInterval = -1000; // Invalid negative interval
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act & Assert
      await expect(scraperApp.startScraping()).rejects.toThrow('Polling interval must be positive');

      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Polling interval must be positive' }),
        'Invalid polling interval configuration'
      );
    });

    it('should handle extremely small polling intervals', async () => {
      // Arrange
      mockConfig.xPollingInterval = 100; // Too small, should be clamped
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.startScraping();

      // Assert
      expect(mockOperation.progress).toHaveBeenCalledWith(
        'Polling interval too small (100ms), clamping to minimum (5000ms)'
      );
    });
  });

  describe('Browser Service Edge Cases', () => {
    it('should handle null browser service', async () => {
      // Arrange
      const scraperWithNullBrowser = new ScraperApplication(
        mockConfig,
        null, // Null browser service
        mockAuthManager,
        mockContentAnnouncer,
        mockContentClassifier,
        mockLogger,
        mockDebugManager,
        mockMetricsManager
      );

      // Act & Assert
      await expect(scraperWithNullBrowser.startScraping()).rejects.toThrow('Browser service is required');
    });

    it('should handle browser that becomes unhealthy during operation', async () => {
      // Arrange
      let healthCallCount = 0;
      mockBrowserService.isHealthy.mockImplementation(() => {
        healthCallCount++;
        return healthCallCount <= 2; // Becomes unhealthy after 2 calls
      });

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.startScraping();

      // Simulate scraping cycles
      await jest.advanceTimersByTimeAsync(60000); // One minute

      // Assert
      expect(mockOperation.progress).toHaveBeenCalledWith(
        'Browser became unhealthy during operation, attempting recovery'
      );
      expect(mockBrowserService.launch).toHaveBeenCalledTimes(2); // Initial + recovery
    });

    it('should handle browser launch timeout', async () => {
      // Arrange
      mockBrowserService.launch.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      const startPromise = scraperApp.startScraping();
      await jest.advanceTimersByTimeAsync(30000); // 30 second timeout

      // Assert
      await expect(startPromise).rejects.toThrow('Browser launch timeout');
      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Browser launch timeout' }),
        'Browser failed to launch within timeout period'
      );
    });

    it('should handle intermittent browser crashes', async () => {
      // Arrange
      let crashCount = 0;
      mockBrowserService.scrapePage.mockImplementation(async () => {
        crashCount++;
        if (crashCount % 3 === 0) {
          throw new Error('Browser process crashed');
        }
        return [{ id: `post-${crashCount}`, content: 'Test content' }];
      });

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.startScraping();

      // Simulate multiple scraping cycles
      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(30000);
      }

      // Assert
      expect(mockOperation.progress).toHaveBeenCalledWith('Browser crash detected, attempting recovery');
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.browser.crashes');
    });
  });

  describe('Authentication Edge Cases', () => {
    it('should handle authentication service returning malformed responses', async () => {
      // Arrange
      mockAuthManager.login.mockResolvedValue({
        success: true,
        // Missing expected properties
      });
      mockAuthManager.isAuthenticated.mockReturnValue(undefined); // Malformed response

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act & Assert
      await expect(scraperApp.startScraping()).rejects.toThrow('Authentication status unclear');

      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Authentication status unclear' }),
        'Authentication service returned malformed response'
      );
    });

    it('should handle authentication timeout', async () => {
      // Arrange
      mockAuthManager.login.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      const startPromise = scraperApp.startScraping();
      await jest.advanceTimersByTimeAsync(60000); // 1 minute timeout

      // Assert
      await expect(startPromise).rejects.toThrow('Authentication timeout');
      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Authentication timeout' }),
        'Authentication process exceeded timeout limit'
      );
    });

    it('should handle session expiry during operation', async () => {
      // Arrange
      let sessionCallCount = 0;
      mockAuthManager.isAuthenticated.mockImplementation(() => {
        sessionCallCount++;
        return sessionCallCount <= 3; // Session expires after 3 calls
      });

      mockAuthManager.login.mockResolvedValueOnce({ success: false, error: 'Session expired' });

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.startScraping();

      // Simulate time passing until session expires
      await jest.advanceTimersByTimeAsync(120000); // 2 minutes

      // Assert
      expect(mockOperation.progress).toHaveBeenCalledWith(
        'Session expired during operation, re-authentication required'
      );
      expect(mockAuthManager.login).toHaveBeenCalledTimes(2); // Initial + retry
    });
  });

  describe('Content Processing Edge Cases', () => {
    it('should handle empty content arrays', async () => {
      // Arrange
      mockBrowserService.scrapePage.mockResolvedValue([]); // Empty array
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.scrapeContent();

      // Assert
      expect(mockOperation.success).toHaveBeenCalledWith('Content scraping completed with no new content found');
      expect(mockMetricsManager.recordMetric).toHaveBeenCalledWith('scraper.posts.scraped', 0);
    });

    it('should handle malformed content objects', async () => {
      // Arrange
      mockBrowserService.scrapePage.mockResolvedValue([
        { id: '1', content: 'Valid post' },
        {
          /* Missing id and content */
        },
        { id: null, content: '' },
        { id: '2' /* Missing content */ },
      ]);

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.scrapeContent();

      // Assert
      expect(mockOperation.progress).toHaveBeenCalledWith('Filtered out 3 malformed content items');
      expect(mockMetricsManager.recordMetric).toHaveBeenCalledWith('scraper.posts.scraped', 1);
      expect(mockMetricsManager.recordMetric).toHaveBeenCalledWith('scraper.posts.malformed', 3);
    });

    it('should handle content classifier failures', async () => {
      // Arrange
      mockBrowserService.scrapePage.mockResolvedValue([{ id: '1', content: 'Test post' }]);
      mockContentClassifier.classifyContent.mockImplementation(() => {
        throw new Error('Classifier crashed');
      });

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.scrapeContent();

      // Assert
      expect(mockOperation.progress).toHaveBeenCalledWith('Content classification failed, using default type');
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.classifier.failures');
    });

    it('should handle extremely large content payloads', async () => {
      // Arrange
      const largeContent = 'x'.repeat(1000000); // 1MB string
      mockBrowserService.scrapePage.mockResolvedValue([{ id: '1', content: largeContent }]);

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.scrapeContent();

      // Assert
      expect(mockOperation.progress).toHaveBeenCalledWith('Large content detected, truncating for processing');
      expect(mockMetricsManager.recordMetric).toHaveBeenCalledWith('scraper.content.large_items', 1);
    });
  });

  describe('Memory and Resource Edge Cases', () => {
    it('should handle memory pressure during operation', async () => {
      // Arrange
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn(() => ({
        heapUsed: 1500000000, // 1.5GB - high memory usage
        heapTotal: 2000000000,
        external: 100000000,
        rss: 2100000000,
      }));

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.performHealthCheck();

      // Assert
      expect(mockOperation.warn).toHaveBeenCalledWith(
        'High memory usage detected',
        expect.objectContaining({
          heapUsedMB: expect.any(Number),
          heapTotalMB: expect.any(Number),
        })
      );

      // Restore original function
      process.memoryUsage = originalMemoryUsage;
    });

    it('should handle resource cleanup failures', async () => {
      // Arrange
      mockBrowserService.close.mockRejectedValue(new Error('Failed to close browser'));

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.stop();

      // Assert
      expect(mockOperation.progress).toHaveBeenCalledWith('Resource cleanup failed, forcing termination');
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.cleanup.failures');
    });

    it('should handle file descriptor exhaustion', async () => {
      // Arrange
      mockBrowserService.launch.mockRejectedValue(new Error('EMFILE: too many open files'));

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act & Assert
      await expect(scraperApp.startScraping()).rejects.toThrow('Resource exhaustion detected');

      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Resource exhaustion detected' }),
        'System resource limits reached'
      );
    });
  });

  describe('Concurrency Edge Cases', () => {
    it('should handle race conditions in state management', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act - Start multiple concurrent operations
      const promises = [scraperApp.startScraping(), scraperApp.startScraping(), scraperApp.startScraping()];

      const results = await Promise.allSettled(promises);

      // Assert - Only one should succeed
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const rejectCount = results.filter(r => r.status === 'rejected').length;

      expect(successCount).toBe(1);
      expect(rejectCount).toBe(2);

      // Verify rejected operations have appropriate error messages
      const rejectedResults = results.filter(r => r.status === 'rejected');
      rejectedResults.forEach(result => {
        expect(result.reason.message).toContain('already running');
      });
    });

    it('should handle async operation cancellation', async () => {
      // Arrange
      let isCancelled = false;
      mockBrowserService.scrapePage.mockImplementation(async () => {
        await new Promise(resolve => {
          const checkCancellation = () => {
            if (isCancelled) {
              throw new Error('Operation cancelled');
            }
            setTimeout(checkCancellation, 100);
          };
          setTimeout(() => {
            checkCancellation();
            resolve();
          }, 500);
        });
        return [{ id: '1', content: 'Test' }];
      });

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      const scrapePromise = scraperApp.scrapeContent();

      // Cancel after 200ms
      setTimeout(() => {
        isCancelled = true;
      }, 200);

      await jest.advanceTimersByTimeAsync(600);

      // Assert
      await expect(scrapePromise).rejects.toThrow('Operation cancelled');
      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Operation cancelled' }),
        'Scraping operation was cancelled'
      );
    });
  });

  describe('Network and External Service Edge Cases', () => {
    it('should handle network timeouts gracefully', async () => {
      // Arrange
      mockBrowserService.navigateTo.mockImplementation(() => Promise.reject(new Error('net::ERR_NETWORK_TIMEOUT')));

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act & Assert
      await expect(scraperApp.scrapeContent()).rejects.toThrow('Network timeout during navigation');

      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Network timeout during navigation' }),
        'Network connectivity issue detected'
      );
    });

    it('should handle rate limiting responses', async () => {
      // Arrange
      mockBrowserService.scrapePage.mockRejectedValue(new Error('Rate limited: 429 Too Many Requests'));

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      const scrapePromise = scraperApp.scrapeContent();

      // Should implement exponential backoff
      await jest.advanceTimersByTimeAsync(60000); // 1 minute

      await expect(scrapePromise).rejects.toThrow('Rate limit exceeded, backing off');

      // Assert
      expect(mockOperation.progress).toHaveBeenCalledWith('Rate limiting detected, implementing backoff strategy');
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.rate_limited');
    });
  });

  describe('Shutdown Edge Cases', () => {
    it('should handle shutdown during critical operations', async () => {
      // Arrange
      mockBrowserService.scrapePage.mockImplementation(async () => {
        // Simulate long operation
        await new Promise(resolve => setTimeout(resolve, 5000));
        return [{ id: '1', content: 'Test' }];
      });

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      const scrapePromise = scraperApp.scrapeContent();

      // Trigger shutdown during operation
      setTimeout(() => {
        scraperApp.isShuttingDown = true;
      }, 1000);

      await jest.advanceTimersByTimeAsync(2000);

      // Assert
      await expect(scrapePromise).rejects.toThrow('Operation interrupted by shutdown');
      expect(mockOperation.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Operation interrupted by shutdown' }),
        'Graceful shutdown interrupted ongoing operation'
      );
    });

    it('should handle force shutdown scenarios', async () => {
      // Arrange
      mockBrowserService.close.mockImplementation(
        () => new Promise(() => {}) // Never resolves - simulates hanging close
      );

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      const stopPromise = scraperApp.stop();
      await jest.advanceTimersByTimeAsync(10000); // 10 second timeout

      const result = await stopPromise;

      // Assert
      expect(result).toEqual({ success: true, message: 'Scraper force-stopped due to hanging resources' });
      expect(mockOperation.progress).toHaveBeenCalledWith('Force shutdown initiated due to hanging resources');
    });
  });
});
