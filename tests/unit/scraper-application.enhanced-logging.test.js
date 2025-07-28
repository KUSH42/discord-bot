import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('ScraperApplication Enhanced Logging Integration', () => {
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

    mockAuthManager.login = jest.fn().mockResolvedValue({ success: true });
    mockAuthManager.isAuthenticated = jest.fn(() => true);

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

  describe('Enhanced Logger Creation and Usage', () => {
    it('should create enhanced logger with correct module name', () => {
      // Assert
      expect(mockLogger.startOperation).toBeDefined();
      expect(mockLogger.generateCorrelationId).toBeDefined();
      expect(mockLogger.forOperation).toBeDefined();

      // Verify logger was configured for scraper module
      expect(mockDebugManager.isEnabled).toHaveBeenCalledWith('scraper');
    });

    it('should use operation tracking for major operations', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.startScraping();

      // Assert
      expect(mockLogger.startOperation).toHaveBeenCalledWith('startScraping', {
        userHandle: 'testuser',
        pollingInterval: 30000,
      });

      expect(mockOperation.progress).toHaveBeenCalledWith('Initializing browser and authentication');
      expect(mockOperation.success).toHaveBeenCalledWith('Scraping started successfully');
    });

    it('should generate correlation IDs for related operations', async () => {
      // Arrange
      const mockCorrelationId = 'test-correlation-123';
      mockLogger.generateCorrelationId.mockReturnValue(mockCorrelationId);

      const _mockParentLogger = {
        startOperation: jest.fn().mockReturnValue({
          progress: jest.fn(),
          success: jest.fn(),
          error: jest.fn(),
        }),
      };
      mockLogger.forOperation.mockReturnValue(_mockParentLogger);

      // Act
      await scraperApp.performHealthCheck();

      // Assert
      expect(mockLogger.generateCorrelationId).toHaveBeenCalled();
      expect(mockLogger.forOperation).toHaveBeenCalledWith('health-check', mockCorrelationId);
    });

    it('should sanitize sensitive data in logs', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      const _sensitiveConfig = {
        xUserHandle: 'testuser',
        xPassword: 'secretpassword123',
        apiKey: 'sensitive-api-key',
      };

      // Act
      await scraperApp.restart();

      // Assert - Verify operation was called but sensitive data was not logged
      expect(mockLogger.startOperation).toHaveBeenCalledWith(
        'restart',
        expect.objectContaining({
          currentState: expect.not.objectContaining({
            password: expect.anything(),
            apiKey: expect.anything(),
            secret: expect.anything(),
          }),
        })
      );
    });
  });

  describe('Debug Flag Integration', () => {
    it('should respect debug flag settings for scraper module', async () => {
      // Arrange
      mockDebugManager.isEnabled.mockImplementation(module => module === 'scraper');
      mockDebugManager.getLevel.mockReturnValue(3);

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.startScraping();

      // Assert
      expect(mockDebugManager.isEnabled).toHaveBeenCalledWith('scraper');
      expect(mockDebugManager.getLevel).toHaveBeenCalledWith('scraper');

      // Verify debug information was included in operation context
      expect(mockOperation.progress).toHaveBeenCalledWith(expect.stringContaining('Debug level: 3'));
    });

    it('should adjust logging verbosity based on debug level', async () => {
      // Arrange
      mockDebugManager.getLevel.mockReturnValue(5); // Verbose

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      mockBrowserService.scrapePage.mockResolvedValue([
        { id: '1', content: 'Test post 1' },
        { id: '2', content: 'Test post 2' },
      ]);

      // Act
      await scraperApp.scrapeContent();

      // Assert - Verbose logging should include detailed progress
      expect(mockOperation.progress).toHaveBeenCalledWith('Starting content scraping');
      expect(mockOperation.progress).toHaveBeenCalledWith('Navigating to user profile');
      expect(mockOperation.progress).toHaveBeenCalledWith('Extracting posts from page');
      expect(mockOperation.progress).toHaveBeenCalledWith('Found 2 posts to process');
      expect(mockOperation.progress).toHaveBeenCalledWith('Content scraping completed');
    });

    it('should minimize logging when debug level is low', async () => {
      // Arrange
      mockDebugManager.getLevel.mockReturnValue(1); // Errors only

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.scrapeContent();

      // Assert - Minimal logging should only show essential progress
      expect(mockOperation.progress).toHaveBeenCalledTimes(1);
      expect(mockOperation.progress).toHaveBeenCalledWith('Content scraping initiated');
    });
  });

  describe('Metrics Integration', () => {
    it('should record operation metrics automatically', async () => {
      // Arrange
      const mockTimer = { end: jest.fn() };
      mockMetricsManager.startTimer.mockReturnValue(mockTimer);

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      await scraperApp.startScraping();

      // Assert
      expect(mockMetricsManager.startTimer).toHaveBeenCalledWith('scraper.operation.startScraping');
      expect(mockTimer.end).toHaveBeenCalled();
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.operations.total');
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.operations.success');
    });

    it('should record failure metrics on errors', async () => {
      // Arrange
      mockBrowserService.launch.mockRejectedValue(new Error('Browser launch failed'));

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Act
      try {
        await scraperApp.startScraping();
      } catch (_error) {
        // Expected to throw
      }

      // Assert
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.operations.total');
      expect(mockMetricsManager.incrementCounter).toHaveBeenCalledWith('scraper.operations.failures');
      expect(mockMetricsManager.recordMetric).toHaveBeenCalledWith('scraper.error.browser_launch', 1);
    });

    it('should record custom metrics for scraper-specific events', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      mockBrowserService.scrapePage.mockResolvedValue([
        { id: '1', content: 'New post' },
        { id: '2', content: 'Another post' },
      ]);

      // Act
      await scraperApp.scrapeContent();

      // Assert
      expect(mockMetricsManager.recordMetric).toHaveBeenCalledWith('scraper.posts.scraped', 2);
      expect(mockMetricsManager.recordMetric).toHaveBeenCalledWith('scraper.scrape.success', 1);
      expect(mockMetricsManager.setGauge).toHaveBeenCalledWith('scraper.last_scrape_count', 2);
    });
  });

  describe('Error Context Enhancement', () => {
    it('should provide rich error context for debugging', async () => {
      // Arrange
      const error = new Error('Scraping failed');
      mockBrowserService.scrapePage.mockRejectedValue(error);

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      mockDebugManager.isEnabled.mockReturnValue(true);
      mockDebugManager.getLevel.mockReturnValue(4);

      // Act
      try {
        await scraperApp.scrapeContent();
      } catch (_e) {
        // Expected to throw
      }

      // Assert
      expect(mockOperation.error).toHaveBeenCalledWith(
        error,
        'Content scraping failed',
        expect.objectContaining({
          userHandle: 'testuser',
          browserHealthy: expect.any(Boolean),
          authenticated: expect.any(Boolean),
          debugLevel: 4,
          debugEnabled: true,
        })
      );
    });

    it('should track operation correlation across async boundaries', async () => {
      // Arrange
      const correlationId = 'async-correlation-456';
      mockLogger.generateCorrelationId.mockReturnValue(correlationId);

      const mockParentOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };

      const mockChildOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };

      mockLogger.startOperation.mockReturnValueOnce(mockParentOperation);

      const mockChildLogger = {
        startOperation: jest.fn().mockReturnValue(mockChildOperation),
      };
      mockLogger.forOperation.mockReturnValue(mockChildLogger);

      // Act
      await scraperApp.performComplexOperation();

      // Assert
      expect(mockLogger.forOperation).toHaveBeenCalledWith('complex-operation', correlationId);
      expect(mockChildLogger.startOperation).toHaveBeenCalledWith(
        'sub-operation',
        expect.objectContaining({
          correlationId,
          parentOperation: 'complex-operation',
        })
      );
    });
  });

  describe('Performance Monitoring', () => {
    it('should monitor operation timing with enhanced logger', async () => {
      // Arrange
      const mockTimer = { end: jest.fn() };
      mockMetricsManager.startTimer.mockReturnValue(mockTimer);

      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
        timing: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Mock a slow operation
      mockBrowserService.scrapePage.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return [{ id: '1', content: 'Test' }];
      });

      // Act
      await scraperApp.scrapeContent();
      await jest.advanceTimersByTimeAsync(100);

      // Assert
      expect(mockOperation.timing).toHaveBeenCalledWith(
        'Page scraping completed',
        expect.objectContaining({
          duration: expect.any(Number),
          operation: 'scrapePage',
        })
      );
    });

    it('should set performance thresholds and warnings', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Mock a very slow operation
      mockBrowserService.scrapePage.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds
        return [{ id: '1', content: 'Test' }];
      });

      // Act
      const scrapePromise = scraperApp.scrapeContent();
      await jest.advanceTimersByTimeAsync(5000);
      await scrapePromise;

      // Assert
      expect(mockOperation.warn).toHaveBeenCalledWith(
        'Operation exceeded expected duration',
        expect.objectContaining({
          duration: expect.any(Number),
          threshold: 3000, // 3 second threshold
          operation: 'scrapePage',
        })
      );
    });
  });

  describe('Shutdown Integration', () => {
    it('should handle graceful shutdown with operation cleanup', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
        cancel: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      // Start a long-running operation
      const longOperation = scraperApp.scrapeContent();

      // Act - Trigger shutdown
      scraperApp.isShuttingDown = true;
      await jest.advanceTimersByTimeAsync(100);

      // Assert
      expect(mockOperation.cancel).toHaveBeenCalledWith('Operation cancelled due to shutdown');

      // Assert that the operation throws with shutdown message
      await expect(longOperation).rejects.toThrow('cancelled due to shutdown');
    });

    it('should log shutdown state in final operation summarie', async () => {
      // Arrange
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      scraperApp.isShuttingDown = true;

      // Act
      await scraperApp.stop();

      // Assert
      expect(mockOperation.success).toHaveBeenCalledWith(
        'Scraper stopped successfully',
        expect.objectContaining({
          shutdownReason: 'Graceful shutdown requested',
          operationsCleanedUp: expect.any(Boolean),
        })
      );
    });
  });
});
