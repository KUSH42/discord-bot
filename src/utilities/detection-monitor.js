import { timestampUTC } from './utc-time.js';
import { createEnhancedLogger } from './enhanced-logger.js';

/**
 * Detection signature types and their severity levels
 */
export const DETECTION_SIGNATURES = {
  // JavaScript Challenge Signatures (High Severity)
  CAPTCHA_CHALLENGE: { severity: 'critical', description: 'CAPTCHA challenge detected' },
  JS_CHALLENGE: { severity: 'critical', description: 'JavaScript challenge detected' },
  CLOUDFLARE_CHALLENGE: { severity: 'critical', description: 'Cloudflare challenge detected' },

  // Rate Limiting Signatures (High Severity)
  HTTP_429_RATE_LIMITED: { severity: 'high', description: 'HTTP 429 rate limit response' },
  IP_BLOCKED: { severity: 'critical', description: 'IP address blocked' },
  PROGRESSIVE_RATE_LIMITING: { severity: 'high', description: 'Progressive rate limiting detected' },

  // Browser Fingerprint Detection (Medium Severity)
  WEBDRIVER_DETECTED: { severity: 'high', description: 'WebDriver property detected' },
  HEADLESS_DETECTED: { severity: 'high', description: 'Headless browser detected' },
  CANVAS_FINGERPRINT_BLOCKED: { severity: 'medium', description: 'Canvas fingerprinting blocked' },
  PLUGIN_MISMATCH: { severity: 'medium', description: 'Plugin configuration mismatch' },

  // Behavioral Analysis (Medium Severity)
  TIMING_PATTERN_DETECTED: { severity: 'medium', description: 'Predictable timing pattern detected' },
  MOUSE_PATTERN_DETECTED: { severity: 'medium', description: 'Non-human mouse patterns detected' },
  SCROLL_PATTERN_DETECTED: { severity: 'low', description: 'Automated scrolling detected' },

  // Network-Level Detection (High Severity)
  TLS_FINGERPRINT_BLOCKED: { severity: 'high', description: 'TLS fingerprint blocked' },
  USER_AGENT_BLACKLISTED: { severity: 'high', description: 'User agent blacklisted' },
  HEADER_MISMATCH: { severity: 'medium', description: 'HTTP header mismatch detected' },

  // Session Analysis (Medium Severity)
  SESSION_INCONSISTENCY: { severity: 'medium', description: 'Session state inconsistency' },
  RAPID_PAGE_TRANSITIONS: { severity: 'medium', description: 'Unrealistic page transition speed' },
  MISSING_REFERRER: { severity: 'low', description: 'Missing or suspicious referrer headers' },
};

/**
 * Detection Monitor for tracking bot detection incidents and automated response
 */
export class DetectionMonitor {
  constructor(config = {}, logger, debugManager, metricsManager) {
    this.config = {
      // Detection sensitivity settings
      enabled: config.enabled !== false,
      alertThreshold: config.alertThreshold || 3,
      monitoringWindow: config.monitoringWindow || 3600000, // 1 hour
      emergencyModeThreshold: config.emergencyModeThreshold || 5,
      emergencyModeDuration: config.emergencyModeDuration || 1800000, // 30 minutes

      // Signature detection settings
      enabledSignatures: config.enabledSignatures || Object.keys(DETECTION_SIGNATURES),
      severityThresholds: config.severityThresholds || {
        critical: 1, // 1 critical incident triggers emergency
        high: 3, // 3 high incidents trigger emergency
        medium: 5, // 5 medium incidents trigger alert
        low: 10, // 10 low incidents trigger warning
      },

      // Response configuration
      autoEmergencyMode: config.autoEmergencyMode !== false,
      notificationEnabled: config.notificationEnabled !== false,
      maxIncidentHistory: config.maxIncidentHistory || 1000,
    };

    this.logger = createEnhancedLogger('detection-monitor', logger, debugManager, metricsManager);

    // Incident tracking
    this.incidents = [];
    this.emergencyMode = {
      active: false,
      activatedAt: null,
      reason: null,
      expiresAt: null,
    };

    // Statistics
    this.stats = {
      totalIncidents: 0,
      criticalIncidents: 0,
      highIncidents: 0,
      mediumIncidents: 0,
      lowIncidents: 0,
      emergencyActivations: 0,
      successfulRequests: 0,
      totalRequests: 0,
    };

    // Detection signature analyzers
    this.signatureAnalyzers = this.initializeSignatureAnalyzers();

    this.logger.info('DetectionMonitor initialized', {
      config: this.config,
      enabledSignatures: this.config.enabledSignatures.length,
      alertThreshold: this.config.alertThreshold,
    });
  }

  /**
   * Initialize signature analyzers for different detection types
   * @returns {Map} Map of signature analyzers
   */
  initializeSignatureAnalyzers() {
    const analyzers = new Map();

    // JavaScript Challenge Analyzer
    analyzers.set('javascript-challenges', {
      detect: (page, response) => this.detectJavaScriptChallenges(page, response),
      signatures: ['CAPTCHA_CHALLENGE', 'JS_CHALLENGE', 'CLOUDFLARE_CHALLENGE'],
    });

    // Rate Limiting Analyzer
    analyzers.set('rate-limiting', {
      detect: (page, response) => this.detectRateLimiting(page, response),
      signatures: ['HTTP_429_RATE_LIMITED', 'IP_BLOCKED', 'PROGRESSIVE_RATE_LIMITING'],
    });

    // Browser Fingerprint Analyzer
    analyzers.set('browser-fingerprint', {
      detect: (page, response) => this.detectBrowserFingerprinting(page, response),
      signatures: ['WEBDRIVER_DETECTED', 'HEADLESS_DETECTED', 'CANVAS_FINGERPRINT_BLOCKED', 'PLUGIN_MISMATCH'],
    });

    // Behavioral Analysis Analyzer
    analyzers.set('behavioral-analysis', {
      detect: (page, response) => this.detectBehavioralAnalysis(page, response),
      signatures: ['TIMING_PATTERN_DETECTED', 'MOUSE_PATTERN_DETECTED', 'SCROLL_PATTERN_DETECTED'],
    });

    // Network-Level Analyzer
    analyzers.set('network-level', {
      detect: (page, response) => this.detectNetworkLevelBlocking(page, response),
      signatures: ['TLS_FINGERPRINT_BLOCKED', 'USER_AGENT_BLACKLISTED', 'HEADER_MISMATCH'],
    });

    // Session Analysis Analyzer
    analyzers.set('session-analysis', {
      detect: (page, response) => this.detectSessionAnalysis(page, response),
      signatures: ['SESSION_INCONSISTENCY', 'RAPID_PAGE_TRANSITIONS', 'MISSING_REFERRER'],
    });

    return analyzers;
  }

  /**
   * Analyze page and response for detection signatures
   * @param {Object} page - Playwright page object
   * @param {Object} response - HTTP response object
   * @param {Object} metadata - Additional context metadata
   * @returns {Promise<Object>} Analysis results
   */
  async analyzeForDetection(page, response, metadata = {}) {
    if (!this.config.enabled) {
      return { detected: false, signatures: [], analysis: {} };
    }

    const operation = this.logger.startOperation('analyzeForDetection', {
      url: response?.url(),
      status: response?.status(),
      metadata,
    });

    try {
      const detectedSignatures = [];
      const analysisResults = {};

      // Run all signature analyzers
      for (const [analyzerName, analyzer] of this.signatureAnalyzers) {
        try {
          const result = await analyzer.detect(page, response);
          analysisResults[analyzerName] = result;

          if (result.detected && result.signatures) {
            detectedSignatures.push(...result.signatures);
          }
        } catch (error) {
          operation.error(error, `Analyzer ${analyzerName} failed`, { analyzerName });
          analysisResults[analyzerName] = { error: error.message };
        }
      }

      // Record any detected incidents
      for (const signature of detectedSignatures) {
        if (this.config.enabledSignatures.includes(signature)) {
          await this.recordDetectionIncident(signature, {
            url: response?.url(),
            userAgent: metadata.userAgent,
            analysisResults,
            ...metadata,
          });
        }
      }

      const hasDetection = detectedSignatures.length > 0;

      operation.success('Detection analysis completed', {
        detected: hasDetection,
        signatures: detectedSignatures,
        analyzersRun: this.signatureAnalyzers.size,
      });

      return {
        detected: hasDetection,
        signatures: detectedSignatures,
        analysis: analysisResults,
      };
    } catch (error) {
      operation.error(error, 'Detection analysis failed');
      throw error;
    }
  }

  /**
   * Detect JavaScript challenges (CAPTCHA, Cloudflare, etc.)
   * @param {Object} page - Playwright page object
   * @param {Object} response - HTTP response object
   * @returns {Promise<Object>} Detection result
   */
  async detectJavaScriptChallenges(page, response) {
    const detected = [];

    try {
      const url = response?.url() || '';
      const content = await page.content().catch(() => '');

      // CAPTCHA detection
      if (
        content.includes('captcha') ||
        content.includes('CAPTCHA') ||
        url.includes('captcha') ||
        page.url().includes('captcha')
      ) {
        detected.push('CAPTCHA_CHALLENGE');
      }

      // Cloudflare challenge detection
      if (
        content.includes('cloudflare') ||
        content.includes('cf-ray') ||
        content.includes('Checking your browser') ||
        content.includes('DDoS protection')
      ) {
        detected.push('CLOUDFLARE_CHALLENGE');
      }

      // Generic JavaScript challenge detection
      if (
        content.includes('Please enable JavaScript') ||
        content.includes('browser verification') ||
        content.includes('security check')
      ) {
        detected.push('JS_CHALLENGE');
      }

      return {
        detected: detected.length > 0,
        signatures: detected,
        details: { url, contentLength: content.length },
      };
    } catch (error) {
      return { detected: false, error: error.message };
    }
  }

  /**
   * Detect rate limiting responses
   * @param {Object} page - Playwright page object
   * @param {Object} response - HTTP response object
   * @returns {Promise<Object>} Detection result
   */
  async detectRateLimiting(page, response) {
    const detected = [];

    try {
      const status = response?.status();
      const headers = response?.headers() || {};
      const url = response?.url() || '';

      // HTTP 429 Rate Limited
      if (status === 429) {
        detected.push('HTTP_429_RATE_LIMITED');
      }

      // IP blocked (403 with specific patterns)
      if (status === 403) {
        const content = await page.content().catch(() => '');
        if (content.includes('blocked') || content.includes('banned') || content.includes('IP address')) {
          detected.push('IP_BLOCKED');
        }
      }

      // Progressive rate limiting (specific headers)
      if (headers['x-rate-limit-remaining'] === '0' || headers['retry-after'] || headers['x-ratelimit-reset']) {
        detected.push('PROGRESSIVE_RATE_LIMITING');
      }

      return {
        detected: detected.length > 0,
        signatures: detected,
        details: { status, url, rateLimitHeaders: this.extractRateLimitHeaders(headers) },
      };
    } catch (error) {
      return { detected: false, error: error.message };
    }
  }

  /**
   * Detect browser fingerprinting and automation detection
   * @param {Object} page - Playwright page object
   * @param {Object} response - HTTP response object
   * @returns {Promise<Object>} Detection result
   */
  async detectBrowserFingerprinting(page, _response) {
    const detected = [];

    try {
      // Check for webdriver detection
      const webdriverDetected = await page
        .evaluate(() => {
          return navigator.webdriver === true;
        })
        .catch(() => false);

      if (webdriverDetected) {
        detected.push('WEBDRIVER_DETECTED');
      }

      // Check for headless detection
      const headlessDetected = await page
        .evaluate(() => {
          /* eslint-disable no-undef */
          return navigator.webdriver === true || !window.chrome || navigator.plugins.length === 0;
        })
        .catch(() => false);
      /* eslint-enable no-undef */

      if (headlessDetected) {
        detected.push('HEADLESS_DETECTED');
      }

      // Check for plugin mismatch
      const pluginCount = await page
        .evaluate(() => {
          return navigator.plugins.length;
        })
        .catch(() => 0);

      if (pluginCount === 0) {
        detected.push('PLUGIN_MISMATCH');
      }

      return {
        detected: detected.length > 0,
        signatures: detected,
        details: { webdriverDetected, headlessDetected, pluginCount },
      };
    } catch (error) {
      return { detected: false, error: error.message };
    }
  }

  /**
   * Detect behavioral analysis patterns
   * @param {Object} page - Playwright page object
   * @param {Object} response - HTTP response object
   * @returns {Promise<Object>} Detection result
   */
  async detectBehavioralAnalysis(_page, _response) {
    // This would be enhanced with actual behavioral tracking
    // For now, return basic detection
    return {
      detected: false,
      signatures: [],
      details: { note: 'Behavioral analysis requires integration with browser service' },
    };
  }

  /**
   * Detect network-level blocking
   * @param {Object} page - Playwright page object
   * @param {Object} response - HTTP response object
   * @returns {Promise<Object>} Detection result
   */
  async detectNetworkLevelBlocking(page, response) {
    const detected = [];

    try {
      const status = response?.status();
      const headers = response?.headers() || {};

      // Check for user agent blacklisting (specific error patterns)
      if (status === 403 || status === 406) {
        const content = await page.content().catch(() => '');
        if (content.includes('user agent') || content.includes('browser')) {
          detected.push('USER_AGENT_BLACKLISTED');
        }
      }

      // Check for header mismatches
      if (status >= 400 && headers['content-type']?.includes('text/html')) {
        const content = await page.content().catch(() => '');
        if (content.includes('header') || content.includes('request format')) {
          detected.push('HEADER_MISMATCH');
        }
      }

      return {
        detected: detected.length > 0,
        signatures: detected,
        details: { status, headers: Object.keys(headers) },
      };
    } catch (error) {
      return { detected: false, error: error.message };
    }
  }

  /**
   * Detect session analysis issues
   * @param {Object} page - Playwright page object
   * @param {Object} response - HTTP response object
   * @returns {Promise<Object>} Detection result
   */
  async detectSessionAnalysis(page, response) {
    const detected = [];

    try {
      const headers = response?.headers() || {};

      // Check for missing referrer issues
      if (!headers['referer'] && !headers['referrer']) {
        detected.push('MISSING_REFERRER');
      }

      return {
        detected: detected.length > 0,
        signatures: detected,
        details: { hasReferrer: !!(headers['referer'] || headers['referrer']) },
      };
    } catch (error) {
      return { detected: false, error: error.message };
    }
  }

  /**
   * Record a detection incident
   * @param {string} signature - Detection signature type
   * @param {Object} context - Incident context
   * @returns {Promise<void>}
   */
  async recordDetectionIncident(signature, context = {}) {
    if (!DETECTION_SIGNATURES[signature]) {
      this.logger.warn('Unknown detection signature', { signature });
      return;
    }

    const incident = {
      id: `incident-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      signature,
      severity: DETECTION_SIGNATURES[signature].severity,
      description: DETECTION_SIGNATURES[signature].description,
      timestamp: timestampUTC(),
      context: {
        url: context.url,
        userAgent: context.userAgent,
        ...context,
      },
    };

    this.incidents.push(incident);
    this.stats.totalIncidents++;
    this.stats[`${incident.severity}Incidents`]++;

    // Maintain incident history limit
    if (this.incidents.length > this.config.maxIncidentHistory) {
      this.incidents = this.incidents.slice(-this.config.maxIncidentHistory);
    }

    this.logger.errorWithObject('Detection incident recorded', incident);

    // Check if emergency mode should be activated
    if (this.config.autoEmergencyMode && !this.emergencyMode.active) {
      await this.checkEmergencyModeActivation();
    }

    // Send notifications if enabled
    if (this.config.notificationEnabled) {
      await this.sendDetectionAlert(incident);
    }
  }

  /**
   * Check if emergency mode should be activated
   * @returns {Promise<void>}
   */
  async checkEmergencyModeActivation() {
    const recentIncidents = this.getRecentIncidents(this.config.monitoringWindow);

    const severityCounts = {
      critical: recentIncidents.filter(i => i.severity === 'critical').length,
      high: recentIncidents.filter(i => i.severity === 'high').length,
      medium: recentIncidents.filter(i => i.severity === 'medium').length,
      low: recentIncidents.filter(i => i.severity === 'low').length,
    };

    const shouldActivate =
      severityCounts.critical >= this.config.severityThresholds.critical ||
      severityCounts.high >= this.config.severityThresholds.high ||
      recentIncidents.length >= this.config.emergencyModeThreshold;

    if (shouldActivate) {
      await this.activateEmergencyMode('DETECTION_THRESHOLD_EXCEEDED', severityCounts);
    }
  }

  /**
   * Activate emergency mode
   * @param {string} reason - Reason for activation
   * @param {Object} context - Additional context
   * @returns {Promise<void>}
   */
  async activateEmergencyMode(reason, context = {}) {
    if (this.emergencyMode.active) {
      this.logger.warn('Emergency mode already active', this.emergencyMode);
      return;
    }

    const now = timestampUTC();
    this.emergencyMode = {
      active: true,
      activatedAt: now,
      reason,
      context,
      expiresAt: now + this.config.emergencyModeDuration,
    };

    this.stats.emergencyActivations++;

    this.logger.errorWithObject('EMERGENCY MODE ACTIVATED', {
      reason,
      context,
      duration: this.config.emergencyModeDuration,
      expiresAt: this.emergencyMode.expiresAt,
    });

    // Trigger emergency response protocols
    await this.executeEmergencyProtocols();
  }

  /**
   * Execute emergency response protocols
   * @returns {Promise<void>}
   */
  async executeEmergencyProtocols() {
    const operation = this.logger.startOperation('executeEmergencyProtocols', {
      emergencyMode: this.emergencyMode,
    });

    try {
      // Emergency protocols would be implemented here
      // For now, just log the activation
      operation.success('Emergency protocols executed', {
        protocols: ['INCREASED_INTERVALS', 'USER_AGENT_ROTATION', 'ENHANCED_STEALTH'],
      });
    } catch (error) {
      operation.error(error, 'Emergency protocol execution failed');
    }
  }

  /**
   * Check if emergency mode should be deactivated
   * @returns {Promise<void>}
   */
  async checkEmergencyModeDeactivation() {
    if (!this.emergencyMode.active) {
      return;
    }

    const now = timestampUTC();
    if (now >= this.emergencyMode.expiresAt) {
      await this.deactivateEmergencyMode('DURATION_EXPIRED');
    }
  }

  /**
   * Deactivate emergency mode
   * @param {string} reason - Reason for deactivation
   * @returns {Promise<void>}
   */
  async deactivateEmergencyMode(reason) {
    if (!this.emergencyMode.active) {
      return;
    }

    const previousEmergency = { ...this.emergencyMode };

    this.emergencyMode = {
      active: false,
      activatedAt: null,
      reason: null,
      context: null,
      expiresAt: null,
    };

    this.logger.infoWithObject('Emergency mode deactivated', {
      reason,
      previousEmergency,
      duration: timestampUTC() - previousEmergency.activatedAt,
    });
  }

  /**
   * Record successful request for success rate calculation
   * @param {Object} metadata - Request metadata
   */
  recordSuccessfulRequest(metadata = {}) {
    this.stats.successfulRequests++;
    this.stats.totalRequests++;

    this.logger.debug('Successful request recorded', {
      successRate: this.getSuccessRate(),
      totalRequests: this.stats.totalRequests,
      metadata,
    });
  }

  /**
   * Record failed request
   * @param {Object} metadata - Request metadata
   */
  recordFailedRequest(metadata = {}) {
    this.stats.totalRequests++;

    this.logger.debug('Failed request recorded', {
      successRate: this.getSuccessRate(),
      totalRequests: this.stats.totalRequests,
      metadata,
    });
  }

  /**
   * Get recent incidents within specified window
   * @param {number} windowMs - Time window in milliseconds
   * @returns {Array} Recent incidents
   */
  getRecentIncidents(windowMs = this.config.monitoringWindow) {
    const cutoff = timestampUTC() - windowMs;
    return this.incidents.filter(incident => incident.timestamp > cutoff);
  }

  /**
   * Get current success rate
   * @returns {number} Success rate (0-1)
   */
  getSuccessRate() {
    if (this.stats.totalRequests === 0) {
      return 1.0;
    }
    return this.stats.successfulRequests / this.stats.totalRequests;
  }

  /**
   * Get detection statistics
   * @returns {Object} Current statistics
   */
  getStatistics() {
    const recentIncidents = this.getRecentIncidents();

    return {
      ...this.stats,
      emergencyMode: this.emergencyMode,
      recentIncidents: recentIncidents.length,
      successRate: Math.round(this.getSuccessRate() * 10000) / 100, // Percentage with 2 decimal places
      detectionRate:
        this.stats.totalRequests > 0
          ? Math.round(
              ((this.stats.totalRequests - this.stats.successfulRequests) / this.stats.totalRequests) * 10000
            ) / 100
          : 0,
      incidentsByseverity: {
        critical: recentIncidents.filter(i => i.severity === 'critical').length,
        high: recentIncidents.filter(i => i.severity === 'high').length,
        medium: recentIncidents.filter(i => i.severity === 'medium').length,
        low: recentIncidents.filter(i => i.severity === 'low').length,
      },
      enabled: this.config.enabled,
      monitoringWindow: this.config.monitoringWindow,
    };
  }

  /**
   * Get detailed detection report
   * @returns {Object} Detailed report
   */
  getDetectionReport() {
    const recentIncidents = this.getRecentIncidents();
    const stats = this.getStatistics();

    return {
      summary: {
        totalIncidents: this.stats.totalIncidents,
        recentIncidents: recentIncidents.length,
        successRate: stats.successRate,
        detectionRate: stats.detectionRate,
        emergencyMode: this.emergencyMode,
      },
      incidents: recentIncidents.slice(-20), // Last 20 incidents
      statistics: stats,
      configuration: {
        enabled: this.config.enabled,
        alertThreshold: this.config.alertThreshold,
        emergencyModeThreshold: this.config.emergencyModeThreshold,
        enabledSignatures: this.config.enabledSignatures.length,
      },
    };
  }

  /**
   * Send detection alert (placeholder for notification system)
   * @param {Object} incident - Detection incident
   * @returns {Promise<void>}
   */
  async sendDetectionAlert(incident) {
    // This would integrate with Discord notifications or other alerting systems
    this.logger.warn('Detection alert would be sent', { incident });
  }

  /**
   * Extract rate limit headers from response
   * @param {Object} headers - Response headers
   * @returns {Object} Rate limit header information
   */
  extractRateLimitHeaders(headers) {
    return {
      remaining: headers['x-rate-limit-remaining'] || headers['x-ratelimit-remaining'],
      reset: headers['x-rate-limit-reset'] || headers['x-ratelimit-reset'],
      retryAfter: headers['retry-after'],
    };
  }

  /**
   * Update configuration
   * @param {Object} newConfig - New configuration options
   */
  updateConfiguration(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.logger.infoWithObject('DetectionMonitor configuration updated', { newConfig });
  }

  /**
   * Reset statistics and incident history
   */
  resetStatistics() {
    this.stats = {
      totalIncidents: 0,
      criticalIncidents: 0,
      highIncidents: 0,
      mediumIncidents: 0,
      lowIncidents: 0,
      emergencyActivations: 0,
      successfulRequests: 0,
      totalRequests: 0,
    };

    this.incidents = [];
    this.logger.info('DetectionMonitor statistics reset');
  }
}
