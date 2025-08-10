import { jest } from '@jest/globals';
import { DetectionMonitor, DETECTION_SIGNATURES } from '../../src/utilities/detection-monitor.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  startOperation: jest.fn(() => ({
    progress: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
  })),
};

// Mock debug manager
const mockDebugManager = {
  isEnabled: jest.fn(() => false),
  getLevel: jest.fn(() => 1),
};

// Mock metrics manager
const mockMetricsManager = {
  recordMetric: jest.fn(),
  startTimer: jest.fn(() => ({ end: jest.fn() })),
  incrementCounter: jest.fn(),
  setGauge: jest.fn(),
};

describe('DetectionMonitor', () => {
  let detectionMonitor;

  beforeEach(() => {
    jest.clearAllMocks();
    detectionMonitor = new DetectionMonitor(
      {
        enabled: true,
        alertThreshold: 3,
        emergencyModeThreshold: 5,
        autoEmergencyMode: true,
      },
      mockLogger,
      mockDebugManager,
      mockMetricsManager
    );
  });

  describe('initialization', () => {
    it('should initialize with correct configuration', () => {
      expect(detectionMonitor.config.enabled).toBe(true);
      expect(detectionMonitor.config.alertThreshold).toBe(3);
      expect(detectionMonitor.config.emergencyModeThreshold).toBe(5);
      expect(detectionMonitor.signatureAnalyzers.size).toBeGreaterThan(0);
    });

    it('should have all required detection signatures', () => {
      const expectedSignatures = [
        'CAPTCHA_CHALLENGE',
        'JS_CHALLENGE',
        'CLOUDFLARE_CHALLENGE',
        'HTTP_429_RATE_LIMITED',
        'WEBDRIVER_DETECTED',
        'HEADLESS_DETECTED',
      ];

      for (const signature of expectedSignatures) {
        expect(DETECTION_SIGNATURES[signature]).toBeDefined();
        expect(DETECTION_SIGNATURES[signature].severity).toBeDefined();
        expect(DETECTION_SIGNATURES[signature].description).toBeDefined();
      }
    });
  });

  describe('incident recording', () => {
    it('should record detection incidents correctly', async () => {
      await detectionMonitor.recordDetectionIncident('CAPTCHA_CHALLENGE', {
        url: 'https://example.com',
        userAgent: 'Chrome/120.0.0.0',
      });

      expect(detectionMonitor.incidents).toHaveLength(1);
      expect(detectionMonitor.incidents[0].signature).toBe('CAPTCHA_CHALLENGE');
      expect(detectionMonitor.incidents[0].severity).toBe('critical');
      expect(detectionMonitor.stats.totalIncidents).toBe(1);
      expect(detectionMonitor.stats.criticalIncidents).toBe(1);
    });

    it('should increment correct severity counters', async () => {
      await detectionMonitor.recordDetectionIncident('HTTP_429_RATE_LIMITED');
      await detectionMonitor.recordDetectionIncident('WEBDRIVER_DETECTED');
      await detectionMonitor.recordDetectionIncident('CANVAS_FINGERPRINT_BLOCKED');

      expect(detectionMonitor.stats.totalIncidents).toBe(3);
      expect(detectionMonitor.stats.highIncidents).toBe(2); // HTTP_429 and WEBDRIVER
      expect(detectionMonitor.stats.mediumIncidents).toBe(1); // CANVAS_FINGERPRINT
    });

    it('should maintain incident history limit', async () => {
      // Create monitor with small history limit
      const smallMonitor = new DetectionMonitor(
        { enabled: true, maxIncidentHistory: 2 },
        mockLogger,
        mockDebugManager,
        mockMetricsManager
      );

      await smallMonitor.recordDetectionIncident('CAPTCHA_CHALLENGE');
      await smallMonitor.recordDetectionIncident('JS_CHALLENGE');
      await smallMonitor.recordDetectionIncident('CLOUDFLARE_CHALLENGE');

      expect(smallMonitor.incidents).toHaveLength(2);
      expect(smallMonitor.incidents[0].signature).toBe('JS_CHALLENGE');
      expect(smallMonitor.incidents[1].signature).toBe('CLOUDFLARE_CHALLENGE');
    });
  });

  describe('emergency mode', () => {
    it('should activate emergency mode when critical threshold is reached', async () => {
      await detectionMonitor.recordDetectionIncident('CAPTCHA_CHALLENGE');

      expect(detectionMonitor.emergencyMode.active).toBe(true);
      expect(detectionMonitor.emergencyMode.reason).toBe('DETECTION_THRESHOLD_EXCEEDED');
      expect(detectionMonitor.stats.emergencyActivations).toBe(1);
    });

    it('should activate emergency mode when multiple high incidents occur', async () => {
      await detectionMonitor.recordDetectionIncident('HTTP_429_RATE_LIMITED');
      await detectionMonitor.recordDetectionIncident('IP_BLOCKED');
      await detectionMonitor.recordDetectionIncident('WEBDRIVER_DETECTED');

      expect(detectionMonitor.emergencyMode.active).toBe(true);
      expect(detectionMonitor.stats.emergencyActivations).toBe(1);
    });

    it('should not activate emergency mode when disabled', async () => {
      const noEmergencyMonitor = new DetectionMonitor(
        { enabled: true, autoEmergencyMode: false },
        mockLogger,
        mockDebugManager,
        mockMetricsManager
      );

      await noEmergencyMonitor.recordDetectionIncident('CAPTCHA_CHALLENGE');

      expect(noEmergencyMonitor.emergencyMode.active).toBe(false);
    });

    it('should deactivate emergency mode after duration expires', async () => {
      // Activate emergency mode
      await detectionMonitor.recordDetectionIncident('CAPTCHA_CHALLENGE');
      expect(detectionMonitor.emergencyMode.active).toBe(true);

      // Manually set expiration to past
      detectionMonitor.emergencyMode.expiresAt = Date.now() - 1000;

      await detectionMonitor.checkEmergencyModeDeactivation();

      expect(detectionMonitor.emergencyMode.active).toBe(false);
    });
  });

  describe('success rate tracking', () => {
    it('should track successful and failed requests', () => {
      detectionMonitor.recordSuccessfulRequest({ url: 'https://example.com' });
      detectionMonitor.recordSuccessfulRequest({ url: 'https://example2.com' });
      detectionMonitor.recordFailedRequest({ url: 'https://failed.com' });

      expect(detectionMonitor.stats.successfulRequests).toBe(2);
      expect(detectionMonitor.stats.totalRequests).toBe(3);
      expect(detectionMonitor.getSuccessRate()).toBeCloseTo(0.667, 2);
    });

    it('should return 100% success rate with no requests', () => {
      expect(detectionMonitor.getSuccessRate()).toBe(1.0);
    });
  });

  describe('statistics and reporting', () => {
    beforeEach(async () => {
      // Set up some test data
      await detectionMonitor.recordDetectionIncident('CAPTCHA_CHALLENGE');
      await detectionMonitor.recordDetectionIncident('HTTP_429_RATE_LIMITED');
      detectionMonitor.recordSuccessfulRequest();
      detectionMonitor.recordSuccessfulRequest();
      detectionMonitor.recordFailedRequest();
    });

    it('should provide comprehensive statistics', () => {
      const stats = detectionMonitor.getStatistics();

      expect(stats.totalIncidents).toBe(2);
      expect(stats.criticalIncidents).toBe(1);
      expect(stats.highIncidents).toBe(1);
      expect(stats.emergencyActivations).toBe(1);
      expect(stats.successRate).toBe(66.67); // 2/3 * 100
      expect(stats.detectionRate).toBe(33.33); // 1/3 * 100
      expect(stats.enabled).toBe(true);
    });

    it('should provide detailed detection report', () => {
      const report = detectionMonitor.getDetectionReport();

      expect(report.summary.totalIncidents).toBe(2);
      expect(report.summary.recentIncidents).toBe(2);
      expect(report.summary.emergencyMode.active).toBe(true);
      expect(report.incidents).toHaveLength(2);
      expect(report.configuration.enabled).toBe(true);
      expect(report.configuration.alertThreshold).toBe(3);
    });

    it('should reset statistics correctly', () => {
      detectionMonitor.resetStatistics();

      expect(detectionMonitor.stats.totalIncidents).toBe(0);
      expect(detectionMonitor.stats.successfulRequests).toBe(0);
      expect(detectionMonitor.incidents).toHaveLength(0);
    });
  });

  describe('signature detection', () => {
    let mockPage, mockResponse;

    beforeEach(() => {
      mockPage = {
        content: jest.fn(() => Promise.resolve('<html><body>Normal content</body></html>')),
        url: jest.fn(() => 'https://example.com'),
        evaluate: jest.fn(() => Promise.resolve(false)),
      };

      mockResponse = {
        url: jest.fn(() => 'https://example.com'),
        status: jest.fn(() => 200),
        headers: jest.fn(() => ({ referer: 'https://example.com' })), // Add referrer to avoid MISSING_REFERRER
      };
    });

    it('should detect CAPTCHA challenges', async () => {
      mockPage.content.mockResolvedValue('<html><body>Please solve this CAPTCHA</body></html>');

      const result = await detectionMonitor.detectJavaScriptChallenges(mockPage, mockResponse);

      expect(result.detected).toBe(true);
      expect(result.signatures).toContain('CAPTCHA_CHALLENGE');
    });

    it('should detect Cloudflare challenges', async () => {
      mockPage.content.mockResolvedValue(
        '<html><body>Checking your browser... DDoS protection by Cloudflare</body></html>'
      );

      const result = await detectionMonitor.detectJavaScriptChallenges(mockPage, mockResponse);

      expect(result.detected).toBe(true);
      expect(result.signatures).toContain('CLOUDFLARE_CHALLENGE');
    });

    it('should detect HTTP 429 rate limiting', async () => {
      mockResponse.status.mockReturnValue(429);

      const result = await detectionMonitor.detectRateLimiting(mockPage, mockResponse);

      expect(result.detected).toBe(true);
      expect(result.signatures).toContain('HTTP_429_RATE_LIMITED');
    });

    it('should detect webdriver property', async () => {
      mockPage.evaluate.mockResolvedValue(true); // navigator.webdriver === true

      const result = await detectionMonitor.detectBrowserFingerprinting(mockPage, mockResponse);

      expect(result.detected).toBe(true);
      expect(result.signatures).toContain('WEBDRIVER_DETECTED');
    });

    it('should handle signature detection errors gracefully', async () => {
      mockPage.content.mockRejectedValue(new Error('Page error'));
      mockPage.url.mockImplementation(() => {
        throw new Error('URL error');
      });

      const result = await detectionMonitor.detectJavaScriptChallenges(mockPage, mockResponse);

      expect(result.detected).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('analysis integration', () => {
    let mockPage, mockResponse;

    beforeEach(() => {
      mockPage = {
        content: jest.fn(() => Promise.resolve('<html><body>Normal content</body></html>')),
        url: jest.fn(() => 'https://example.com'),
        evaluate: jest.fn(() => Promise.resolve(false)),
      };

      mockResponse = {
        url: jest.fn(() => 'https://example.com'),
        status: jest.fn(() => 200),
        headers: jest.fn(() => ({})),
      };
    });

    it('should analyze page for multiple detection signatures', async () => {
      const result = await detectionMonitor.analyzeForDetection(mockPage, mockResponse, {
        userAgent: 'Chrome/120.0.0.0',
      });

      // May detect MISSING_REFERRER if no referrer header is provided
      expect(result.analysis).toBeDefined();
      expect(Object.keys(result.analysis)).toHaveLength(detectionMonitor.signatureAnalyzers.size);
    });

    it('should record incidents when signatures are detected', async () => {
      mockPage.content.mockResolvedValue('<html><body>Please solve this CAPTCHA</body></html>');

      const result = await detectionMonitor.analyzeForDetection(mockPage, mockResponse);

      expect(result.detected).toBe(true);
      expect(result.signatures).toContain('CAPTCHA_CHALLENGE');
      expect(detectionMonitor.incidents).toHaveLength(result.signatures.length); // May detect multiple signatures
    });

    it('should handle analysis errors gracefully', async () => {
      // Mock one analyzer to throw an error
      const originalAnalyzer = detectionMonitor.signatureAnalyzers.get('javascript-challenges');
      detectionMonitor.signatureAnalyzers.set('javascript-challenges', {
        ...originalAnalyzer,
        detect: jest.fn(() => {
          throw new Error('Analyzer error');
        }),
      });

      const result = await detectionMonitor.analyzeForDetection(mockPage, mockResponse);

      // May still detect other signatures (like MISSING_REFERRER), so focus on the error handling
      expect(result.analysis['javascript-challenges'].error).toBe('Analyzer error');

      // Restore original analyzer
      detectionMonitor.signatureAnalyzers.set('javascript-challenges', originalAnalyzer);
    });
  });

  describe('configuration management', () => {
    it('should update configuration correctly', () => {
      const newConfig = {
        alertThreshold: 5,
        emergencyModeThreshold: 10,
        autoEmergencyMode: false,
      };

      detectionMonitor.updateConfiguration(newConfig);

      expect(detectionMonitor.config.alertThreshold).toBe(5);
      expect(detectionMonitor.config.emergencyModeThreshold).toBe(10);
      expect(detectionMonitor.config.autoEmergencyMode).toBe(false);
    });

    it('should work when disabled', async () => {
      const disabledMonitor = new DetectionMonitor(
        { enabled: false },
        mockLogger,
        mockDebugManager,
        mockMetricsManager
      );

      const mockPage = { content: jest.fn() };
      const mockResponse = { url: jest.fn() };

      const result = await disabledMonitor.analyzeForDetection(mockPage, mockResponse);

      expect(result.detected).toBe(false);
      expect(result.signatures).toHaveLength(0);
    });
  });
});
