import { PlaywrightBrowserService } from './playwright-browser-service.js';
import { UserAgentManager } from '../../utilities/user-agent-manager.js';
import { HumanBehaviorSimulator } from '../../utilities/human-behavior-simulator.js';
import { IntelligentRateLimiter } from '../../utilities/intelligent-rate-limiter.js';
import { BrowserProfileManager } from '../../utilities/browser-profile-manager.js';
import { chromium } from 'playwright';

/**
 * Enhanced Playwright browser service with Phase 2 anti-botting capabilities
 * Integrates user agent rotation, human behavior simulation, intelligent rate limiting,
 * and persistent browser profiles for advanced stealth characteristics
 */
export class EnhancedPlaywrightBrowserService extends PlaywrightBrowserService {
  constructor(
    baseLogger,
    debugManager,
    metricsManager,
    detectionMonitor = null,
    performanceMonitor = null,
    config = {}
  ) {
    super(baseLogger, debugManager, metricsManager);

    // Add context property for persistent context support
    this.context = null;

    // Enhanced configuration
    this.config = {
      // Stealth features toggle
      stealthEnabled: process.env.BROWSER_STEALTH_ENABLED !== 'false',
      userAgentRotationEnabled: process.env.USER_AGENT_ROTATION_ENABLED !== 'false',
      behaviorSimulationEnabled: process.env.BEHAVIOR_SIMULATION_ENABLED !== 'false',
      intelligentRateLimitingEnabled: process.env.INTELLIGENT_RATE_LIMITING !== 'false',
      profilePersistenceEnabled: process.env.BROWSER_PROFILE_PERSISTENCE !== 'false',

      // Profile configuration
      profileId: config.profileId || process.env.BROWSER_PROFILE_ID || 'default',
      profileDir: process.env.BROWSER_PROFILE_DIR || './browser_profiles',

      // Rate limiting configuration
      rateLimiting: {
        humanActiveBase: parseInt(process.env.HUMAN_ACTIVE_BASE_MS) || 60000,
        humanIdleBase: parseInt(process.env.HUMAN_IDLE_BASE_MS) || 120000,
        nightModeBase: parseInt(process.env.NIGHT_MODE_BASE_MS) || 300000,
        weekendBase: parseInt(process.env.WEEKEND_BASE_MS) || 180000,
        minInterval: parseInt(process.env.MIN_REQUEST_INTERVAL) || 30000,
        maxInterval: parseInt(process.env.MAX_REQUEST_INTERVAL) || 600000,
      },

      ...config,
    };

    // Initialize Phase 2 components
    this.userAgentManager = null;
    this.behaviorSimulator = null;
    this.rateLimiter = null;
    this.profileManager = null;

    // Monitoring components
    this.detectionMonitor = detectionMonitor;
    this.performanceMonitor = performanceMonitor;

    // Enhanced state tracking
    this.stealthFeatures = {
      userAgentRotated: false,
      profileLoaded: false,
      stealthScriptsInjected: false,
      sessionRestored: false,
    };

    this.logger.info('EnhancedPlaywrightBrowserService initialized', {
      config: this.config,
      stealthEnabled: this.config.stealthEnabled,
    });

    // Initialize components if stealth is enabled
    if (this.config.stealthEnabled) {
      this.initializeStealthComponents();
    }
  }

  /**
   * Initialize stealth components
   * @private
   */
  initializeStealthComponents() {
    // Initialize user agent manager
    if (this.config.userAgentRotationEnabled) {
      this.userAgentManager = new UserAgentManager(this.logger);
    }

    // Initialize intelligent rate limiter
    if (this.config.intelligentRateLimitingEnabled) {
      this.rateLimiter = new IntelligentRateLimiter(this.config.rateLimiting, this.logger);
    }

    // Initialize browser profile manager
    if (this.config.profilePersistenceEnabled) {
      this.profileManager = new BrowserProfileManager(this.config.profileDir, this.logger);
    }

    this.logger.info('Stealth components initialized', {
      userAgentManager: !!this.userAgentManager,
      rateLimiter: !!this.rateLimiter,
      profileManager: !!this.profileManager,
    });
  }

  /**
   * Enhanced browser launch with stealth capabilities
   * @param {Object} options - Browser launch options
   * @returns {Promise<void>}
   */
  async launch(options = {}) {
    const operation = this.logger.startOperation('enhancedLaunch', {
      options,
      stealthEnabled: this.config.stealthEnabled,
    });

    try {
      let launchOptions = { ...options };

      if (this.config.stealthEnabled) {
        // Load browser profile
        if (this.profileManager) {
          operation.progress('Loading browser profile');
          await this.profileManager.createOrLoadProfile(this.config.profileId);
          this.stealthFeatures.profileLoaded = true;
        }

        // Get current user agent
        const userAgent = this.userAgentManager ? this.userAgentManager.getCurrentUserAgent() : options.userAgent;

        if (userAgent) {
          this.stealthFeatures.userAgentRotated = true;
        }

        // Use persistent context for profile support
        if (this.profileManager && userAgent) {
          operation.progress('Launching persistent browser context with profile');

          const persistentOptions = await this.profileManager.getPersistentContextOptions(userAgent, options);
          const viewport = this.userAgentManager
            ? this.userAgentManager.getMatchingViewport(userAgent)
            : { width: 1920, height: 1080 };

          // Set viewport in context options
          persistentOptions.contextOptions.viewport = viewport;

          // Launch persistent context
          this.context = await chromium.launchPersistentContext(persistentOptions.userDataDir, {
            ...persistentOptions.contextOptions,
            ...persistentOptions.launchOptions,
          });

          // Get the browser and page from context
          this.browser = this.context.browser();
          this.page = this.context.pages()[0] || (await this.context.newPage());

          // Setup monitoring
          this.setupBrowserMonitoring();
          this.setupPageMonitoring();
        } else {
          // Fallback to regular launch without profiles
          launchOptions = this.applyBasicStealthOptions(launchOptions, userAgent);
          operation.progress('Launching browser with basic stealth configuration');
          await super.launch(launchOptions);
        }
      } else {
        // Non-stealth mode - use parent implementation
        await super.launch(options);
      }

      if (this.config.stealthEnabled) {
        // Initialize behavior simulator
        if (this.config.behaviorSimulationEnabled && this.page) {
          this.behaviorSimulator = new HumanBehaviorSimulator(this.page, this.logger);
        }

        // Apply stealth scripts
        await this.applyStealthScripts();

        // Session restoration is handled automatically by persistent context
        // Mark as restored if using profile manager
        if (this.profileManager) {
          this.stealthFeatures.sessionRestored = true;
        }
      }

      operation.success('Enhanced browser launched successfully', {
        stealthFeatures: this.stealthFeatures,
      });
    } catch (error) {
      operation.error(error, 'Enhanced browser launch failed');
      throw error;
    }
  }

  /**
   * Enhanced navigation with human-like behavior and rate limiting
   * @param {string} url - URL to navigate to
   * @param {Object} options - Navigation options
   * @param {number} retries - Number of retry attempts
   * @returns {Promise<Object>} Navigation response
   */
  async goto(url, options = {}, retries = 3) {
    const operation = this.logger.startOperation('enhancedGoto', {
      url,
      options,
      retries,
      stealthEnabled: this.config.stealthEnabled,
    });

    // Start performance monitoring
    const performanceOp = this.performanceMonitor?.startOperation('navigation', { url });

    try {
      // Apply intelligent rate limiting
      if (this.rateLimiter) {
        operation.progress('Applying intelligent rate limiting');
        await this.rateLimiter.waitForNextRequest({
          metadata: { url, operation: 'goto' },
        });
      }

      let response;

      // Use human behavior simulation if enabled
      if (this.behaviorSimulator && this.config.behaviorSimulationEnabled) {
        operation.progress('Navigating with human behavior simulation');
        response = await this.behaviorSimulator.simulateRealisticPageLoad(url, options);
      } else {
        operation.progress('Navigating with standard method');
        response = await super.goto(url, options, retries);
      }

      // Analyze response for detection signatures
      if (this.detectionMonitor && response) {
        operation.progress('Analyzing for detection signatures');
        const detectionAnalysis = await this.detectionMonitor.analyzeForDetection(this.page, response, {
          url,
          userAgent: this.userAgentManager?.getCurrentUserAgent(),
          stealthEnabled: this.config.stealthEnabled,
        });

        if (detectionAnalysis.detected) {
          operation.warn('Detection signatures found', {
            signatures: detectionAnalysis.signatures,
            analysis: detectionAnalysis.analysis,
          });
        }
      }

      // Record successful request for monitoring
      if (this.detectionMonitor) {
        this.detectionMonitor.recordSuccessfulRequest({ url, userAgent: this.userAgentManager?.getCurrentUserAgent() });
      }

      // Save session after successful navigation
      if (this.profileManager && this.page) {
        await this.profileManager.saveSession(this.page);
      }

      // End performance monitoring with success
      performanceOp?.end(true, { url, statusCode: response?.status() });

      operation.success('Enhanced navigation completed', {
        url,
        behaviorSimulated: !!this.behaviorSimulator,
        rateLimited: !!this.rateLimiter,
        sessionSaved: !!this.profileManager,
        detectionAnalyzed: !!this.detectionMonitor,
      });

      return response;
    } catch (error) {
      // Record failed request for monitoring
      if (this.detectionMonitor) {
        this.detectionMonitor.recordFailedRequest({ url, error: error.message });
      }

      // End performance monitoring with failure
      performanceOp?.end(false, { url, error: error.message });

      operation.error(error, 'Enhanced navigation failed');
      throw error;
    }
  }

  /**
   * Enhanced typing with human-like characteristics
   * @param {string} selector - CSS selector
   * @param {string} text - Text to type
   * @param {Object} options - Typing options
   * @returns {Promise<void>}
   */
  async type(selector, text, options = {}) {
    if (this.behaviorSimulator && this.config.behaviorSimulationEnabled) {
      const humanOptions = {
        minDelay: 50,
        maxDelay: 150,
        mistakes: options.humanMistakes !== false,
        mistakeProbability: 0.02,
        ...options,
      };

      await this.behaviorSimulator.simulateHumanTyping(selector, text, humanOptions);
    } else {
      await super.type(selector, text, options);
    }
  }

  /**
   * Enhanced clicking with human-like movement
   * @param {string} selector - CSS selector
   * @param {Object} options - Click options
   * @returns {Promise<void>}
   */
  async click(selector, options = {}) {
    if (this.behaviorSimulator && this.config.behaviorSimulationEnabled) {
      await this.behaviorSimulator.simulateHumanClick(selector, options);
    } else {
      await super.click(selector, options);
    }
  }

  /**
   * Rotate user agent
   * @returns {Promise<string>} New user agent string
   */
  async rotateUserAgent() {
    if (!this.userAgentManager) {
      throw new Error('User agent rotation not enabled');
    }

    const operation = this.logger.startOperation('rotateUserAgent', {});

    try {
      const newUserAgent = this.userAgentManager.rotateUserAgent();

      if (this.page) {
        await this.setUserAgent(newUserAgent);

        // Update viewport to match new user agent
        const viewport = this.userAgentManager.getMatchingViewport(newUserAgent);
        await this.setViewport(viewport);
      }

      operation.success('User agent rotated', {
        newUserAgent,
        viewport: this.userAgentManager?.getMatchingViewport(newUserAgent),
      });

      return newUserAgent;
    } catch (error) {
      operation.error(error, 'User agent rotation failed');
      throw error;
    }
  }

  /**
   * Get stealth statistics
   * @returns {Object} Comprehensive stealth statistics
   */
  getStealthStatistics() {
    return {
      stealthEnabled: this.config.stealthEnabled,
      stealthFeatures: this.stealthFeatures,

      userAgent: this.userAgentManager
        ? {
            ...this.userAgentManager.getUsageStats(),
            poolInfo: this.userAgentManager.getPoolInfo(),
          }
        : null,

      rateLimiting: this.rateLimiter ? this.rateLimiter.getStatistics() : null,

      behaviorSimulation: this.behaviorSimulator ? this.behaviorSimulator.getConfiguration() : null,

      profile: this.profileManager
        ? {
            currentProfile: this.profileManager.getCurrentProfile()?.id,
            profileLoaded: this.stealthFeatures.profileLoaded,
            sessionRestored: this.stealthFeatures.sessionRestored,
          }
        : null,
    };
  }

  /**
   * Apply basic stealth options when profile manager is not available
   * @param {Object} options - Original launch options
   * @param {string} userAgent - User agent string
   * @returns {Object} Enhanced launch options
   * @private
   */
  applyBasicStealthOptions(options, userAgent) {
    const stealthArgs = [
      // Core stealth features
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
      '--exclude-switches=enable-automation',
      '--disable-component-extensions-with-background-pages',

      // Fingerprinting resistance
      '--disable-client-side-phishing-detection',
      '--disable-sync',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',

      // Performance optimization
      '--disable-background-timer-throttling',
      '--run-all-compositor-stages-before-draw',

      // Basic browser flags
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--disable-gpu',
      '--disable-images',
      '--disable-plugins',
      '--mute-audio',
    ];

    if (userAgent) {
      stealthArgs.push(`--user-agent=${userAgent}`);
    }

    // Filter out userDataDir from options since it's not supported with browserType.launch()
    const { userDataDir: _userDataDir, ...filteredOptions } = options;

    return {
      headless: false, // Stealth mode requires headful browser
      args: [...(filteredOptions.args || []), ...stealthArgs],
      ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=AutomationControlled'],
      ...filteredOptions,
    };
  }

  /**
   * Apply JavaScript stealth scripts to hide automation markers
   * @private
   */
  async applyStealthScripts() {
    if (!this.page) {
      return;
    }

    const stealthScript = `
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      
      // Hide chrome automation indicators
      if (window.chrome && window.chrome.runtime && window.chrome.runtime.onConnect) {
        delete window.chrome.runtime.onConnect;
      }
      
      // Spoof plugin array to appear natural
      Object.defineProperty(navigator, 'plugins', {
        get: () => ({
          0: { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          1: { name: 'Chromium PDF Plugin', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          2: { name: 'Microsoft Edge PDF Plugin', filename: 'pdf.dll' },
          length: 3
        }),
      });
      
      // Override permission API
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: 'granted' }) :
          originalQuery(parameters)
      );
      
      // Spoof language preferences
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      
      // Canvas fingerprinting protection
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function() {
        const ctx = this.getContext('2d');
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          
          // Modify a few pixels slightly
          for (let i = 0; i < 10; i++) {
            const idx = Math.floor(Math.random() * imageData.data.length / 4) * 4;
            imageData.data[idx] = Math.min(255, imageData.data[idx] + Math.floor(Math.random() * 3) - 1);
          }
          
          ctx.putImageData(imageData, 0, 0);
        }
        return originalToDataURL.apply(this, arguments);
      };
    `;

    try {
      await this.page.addInitScript(stealthScript);
      this.stealthFeatures.stealthScriptsInjected = true;

      this.logger.debug('Stealth scripts applied successfully');
    } catch (error) {
      this.logger.warn('Failed to apply stealth scripts', {
        error: error.message,
      });
    }
  }

  /**
   * Enhanced cleanup with session saving
   * @returns {Promise<void>}
   */
  async close() {
    const operation = this.logger.startOperation('enhancedClose', {
      stealthEnabled: this.config.stealthEnabled,
    });

    try {
      // For persistent context, session is automatically saved
      // Just need to close the context
      if (this.context) {
        operation.progress('Closing persistent context');
        await this.context.close();
        this.context = null;
        this.browser = null;
        this.page = null;
      } else {
        // Fallback to parent implementation for non-persistent browsers
        await super.close();
      }

      operation.success('Enhanced browser closed successfully');
    } catch (error) {
      operation.error(error, 'Enhanced browser close failed');
      throw error;
    }
  }

  /**
   * Update stealth configuration
   * @param {Object} newConfig - New configuration options
   */
  updateStealthConfiguration(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
    };

    // Update component configurations
    if (this.rateLimiter && newConfig.rateLimiting) {
      this.rateLimiter.updateConfiguration(newConfig.rateLimiting);
    }

    if (this.behaviorSimulator && newConfig.behaviorSimulation) {
      this.behaviorSimulator.updateConfiguration(newConfig.behaviorSimulation);
    }

    if (this.userAgentManager && newConfig.rotationInterval) {
      this.userAgentManager.setRotationInterval(newConfig.rotationInterval);
    }

    this.logger.info('Stealth configuration updated', {
      newConfig: this.config,
    });
  }
}
