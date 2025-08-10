import { timestampUTC } from './utc-time.js';

/**
 * Manages dynamic user agent rotation for browser automation
 * Provides realistic user agent strings with matching viewport configurations
 */
export class UserAgentManager {
  constructor(logger) {
    this.logger = logger;

    // Comprehensive user agent pool with current browser versions
    this.userAgentPool = [
      // Chrome on Windows
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',

      // Chrome on macOS
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',

      // Chrome on Linux
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',

      // Edge on Windows
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',

      // Firefox alternatives
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0',
    ];

    // Initialize with random starting index
    this.currentIndex = Math.floor(Math.random() * this.userAgentPool.length);

    // Rotation configuration
    this.rotationInterval = parseInt(process.env.USER_AGENT_ROTATION_INTERVAL) || 3600000; // 1 hour default
    this.lastRotation = timestampUTC();

    // Track usage for monitoring
    this.usageStats = {
      totalRotations: 0,
      currentSessionStart: timestampUTC(),
      agentUsageCount: new Map(),
    };

    this.logger?.info('UserAgentManager initialized', {
      poolSize: this.userAgentPool.length,
      rotationIntervalMs: this.rotationInterval,
      initialAgent: this.getCurrentUserAgent(),
    });
  }

  /**
   * Get current user agent string
   * Automatically rotates if rotation interval has passed
   * @returns {string} Current user agent string
   */
  getCurrentUserAgent() {
    // Check if rotation is needed
    if (this.shouldRotate()) {
      this.rotateUserAgent();
    }

    const userAgent = this.userAgentPool[this.currentIndex];

    // Track usage
    const count = this.usageStats.agentUsageCount.get(userAgent) || 0;
    this.usageStats.agentUsageCount.set(userAgent, count + 1);

    return userAgent;
  }

  /**
   * Check if user agent should be rotated
   * @returns {boolean} True if rotation is needed
   */
  shouldRotate() {
    const timeSinceLastRotation = timestampUTC() - this.lastRotation;
    return timeSinceLastRotation > this.rotationInterval;
  }

  /**
   * Rotate to next user agent in pool
   * @returns {string} New user agent string
   */
  rotateUserAgent() {
    const previousIndex = this.currentIndex;
    const previousAgent = this.userAgentPool[previousIndex];

    // Move to next user agent (with wraparound)
    this.currentIndex = (this.currentIndex + 1) % this.userAgentPool.length;
    this.lastRotation = timestampUTC();
    this.usageStats.totalRotations++;

    const newAgent = this.userAgentPool[this.currentIndex];

    this.logger?.info('User agent rotated', {
      from: previousAgent,
      to: newAgent,
      rotationNumber: this.usageStats.totalRotations,
      timeSinceLastRotation: timestampUTC() - this.lastRotation + this.rotationInterval,
    });

    return newAgent;
  }

  /**
   * Force rotation to a specific user agent
   * @param {number} index - Index in user agent pool
   * @returns {string} New user agent string
   */
  forceRotateToIndex(index) {
    if (index < 0 || index >= this.userAgentPool.length) {
      throw new Error(`Invalid user agent index: ${index}. Must be 0-${this.userAgentPool.length - 1}`);
    }

    const previousAgent = this.userAgentPool[this.currentIndex];
    this.currentIndex = index;
    this.lastRotation = timestampUTC();
    this.usageStats.totalRotations++;

    const newAgent = this.userAgentPool[this.currentIndex];

    this.logger?.info('User agent force rotated', {
      from: previousAgent,
      to: newAgent,
      forcedIndex: index,
    });

    return newAgent;
  }

  /**
   * Get viewport dimensions that match the current user agent
   * @param {string} userAgent - User agent string (optional, uses current if not provided)
   * @returns {Object} Viewport configuration {width, height}
   */
  getMatchingViewport(userAgent = null) {
    const agent = userAgent || this.getCurrentUserAgent();

    // Determine platform from user agent
    if (agent.includes('Windows NT 10.0')) {
      // Windows - common resolutions
      const windowsResolutions = [
        { width: 1920, height: 1080 }, // Full HD - most common
        { width: 1366, height: 768 }, // Laptop standard
        { width: 1440, height: 900 }, // MacBook Pro equivalent
        { width: 1600, height: 900 }, // Wide screen laptop
      ];
      return windowsResolutions[Math.floor(Math.random() * windowsResolutions.length)];
    } else if (agent.includes('Macintosh') && agent.includes('Intel Mac OS X')) {
      // macOS - typical Apple display resolutions
      const macResolutions = [
        { width: 1440, height: 900 }, // MacBook Pro 13"
        { width: 1680, height: 1050 }, // MacBook Pro 15"
        { width: 1920, height: 1080 }, // External monitor
        { width: 2560, height: 1600 }, // MacBook Pro 16" (scaled)
      ];
      return macResolutions[Math.floor(Math.random() * macResolutions.length)];
    } else if (agent.includes('X11; Linux')) {
      // Linux - variety of resolutions
      const linuxResolutions = [
        { width: 1920, height: 1080 }, // Full HD - most common
        { width: 1366, height: 768 }, // Standard laptop
        { width: 1600, height: 900 }, // Wide laptop
        { width: 1440, height: 900 }, // Standard desktop
      ];
      return linuxResolutions[Math.floor(Math.random() * linuxResolutions.length)];
    }

    // Default fallback
    return { width: 1366, height: 768 };
  }

  /**
   * Get platform information from user agent
   * @param {string} userAgent - User agent string (optional, uses current if not provided)
   * @returns {Object} Platform information
   */
  getPlatformInfo(userAgent = null) {
    const agent = userAgent || this.getCurrentUserAgent();

    let platform = 'Unknown';
    let browser = 'Unknown';
    let version = 'Unknown';

    // Detect platform
    if (agent.includes('Windows NT 10.0')) {
      platform = 'Windows 10';
    } else if (agent.includes('Macintosh')) {
      platform = 'macOS';
    } else if (agent.includes('X11; Linux')) {
      platform = 'Linux';
    }

    // Detect browser
    if (agent.includes('Chrome/') && agent.includes('Safari/') && !agent.includes('Edg/')) {
      browser = 'Chrome';
      const match = agent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
      version = match ? match[1] : version;
    } else if (agent.includes('Edg/')) {
      browser = 'Edge';
      const match = agent.match(/Edg\/(\d+\.\d+\.\d+\.\d+)/);
      version = match ? match[1] : version;
    } else if (agent.includes('Firefox/')) {
      browser = 'Firefox';
      const match = agent.match(/Firefox\/(\d+\.\d+)/);
      version = match ? match[1] : version;
    }

    return { platform, browser, version };
  }

  /**
   * Get randomized user agent from pool
   * @returns {string} Random user agent string
   */
  getRandomUserAgent() {
    const randomIndex = Math.floor(Math.random() * this.userAgentPool.length);
    return this.userAgentPool[randomIndex];
  }

  /**
   * Get usage statistics
   * @returns {Object} Usage statistics
   */
  getUsageStats() {
    const sessionDurationMs = timestampUTC() - this.usageStats.currentSessionStart;
    const uniqueAgentsUsed = this.usageStats.agentUsageCount.size;
    const totalUsage = Array.from(this.usageStats.agentUsageCount.values()).reduce((sum, count) => sum + count, 0);

    return {
      totalRotations: this.usageStats.totalRotations,
      sessionDurationHours: Math.round((sessionDurationMs / 3600000) * 100) / 100,
      uniqueAgentsUsed,
      totalAgentsAvailable: this.userAgentPool.length,
      agentDiversityPercent: Math.round((uniqueAgentsUsed / this.userAgentPool.length) * 100),
      totalUsage,
      averageUsagePerAgent: totalUsage > 0 ? Math.round((totalUsage / uniqueAgentsUsed) * 100) / 100 : 0,
      currentAgent: this.getCurrentUserAgent(),
      timeSinceLastRotationMs: timestampUTC() - this.lastRotation,
      nextRotationInMs: Math.max(0, this.rotationInterval - (timestampUTC() - this.lastRotation)),
    };
  }

  /**
   * Get user agent pool information
   * @returns {Object} Pool information
   */
  getPoolInfo() {
    const platforms = new Set();
    const browsers = new Set();

    this.userAgentPool.forEach(agent => {
      const info = this.getPlatformInfo(agent);
      platforms.add(info.platform);
      browsers.add(info.browser);
    });

    return {
      totalAgents: this.userAgentPool.length,
      platforms: Array.from(platforms),
      browsers: Array.from(browsers),
      rotationIntervalMs: this.rotationInterval,
      currentIndex: this.currentIndex,
    };
  }

  /**
   * Reset rotation interval
   * @param {number} intervalMs - New rotation interval in milliseconds
   */
  setRotationInterval(intervalMs) {
    if (intervalMs < 60000) {
      // Minimum 1 minute
      throw new Error('Rotation interval must be at least 60000ms (1 minute)');
    }

    this.rotationInterval = intervalMs;
    this.logger?.info('User agent rotation interval updated', {
      newIntervalMs: intervalMs,
      newIntervalHours: Math.round((intervalMs / 3600000) * 100) / 100,
    });
  }
}
