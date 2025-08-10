import { EnhancedPlaywrightBrowserService } from './enhanced-playwright-browser-service.js';

/**
 * Factory for creating stealth-enabled browser services
 * Provides a centralized way to create browser services with anti-botting capabilities
 */
export class StealthBrowserFactory {
  constructor(baseLogger, debugManager, metricsManager, detectionMonitor = null, performanceMonitor = null) {
    this.baseLogger = baseLogger;
    this.debugManager = debugManager;
    this.metricsManager = metricsManager;
    this.detectionMonitor = detectionMonitor;
    this.performanceMonitor = performanceMonitor;
  }

  /**
   * Create a stealth-enabled browser service
   * @param {Object} config - Browser configuration options
   * @returns {Promise<EnhancedPlaywrightBrowserService>} Configured browser service
   */
  async createStealthBrowser(config = {}) {
    const browserService = new EnhancedPlaywrightBrowserService(
      this.baseLogger,
      this.debugManager,
      this.metricsManager,
      this.detectionMonitor,
      this.performanceMonitor,
      {
        stealthEnabled: true,
        ...config,
      }
    );

    // Note: Don't auto-launch here - let the caller handle launch timing
    // This prevents the userDataDir issue by letting the enhanced service
    // decide whether to use launchPersistentContext or regular launch
    return browserService;
  }

  /**
   * Create a basic browser service without stealth features
   * @param {Object} config - Browser configuration options
   * @returns {Promise<EnhancedPlaywrightBrowserService>} Basic browser service
   */
  async createBasicBrowser(config = {}) {
    const browserConfig = {
      stealthEnabled: false,
      ...config,
    };

    const browserService = new EnhancedPlaywrightBrowserService(
      this.baseLogger,
      this.debugManager,
      this.metricsManager,
      this.detectionMonitor,
      this.performanceMonitor,
      browserConfig
    );

    // Note: Don't auto-launch here - let the caller handle launch timing
    return browserService;
  }
}
