import { jest } from '@jest/globals';
import { UserAgentManager } from '../../../src/utilities/user-agent-manager.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('UserAgentManager', () => {
  let userAgentManager;

  beforeEach(() => {
    jest.clearAllMocks();
    userAgentManager = new UserAgentManager(mockLogger);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    test('should initialize with default configuration', () => {
      expect(userAgentManager).toBeDefined();
      expect(userAgentManager.userAgentPool).toHaveLength(14);
      expect(userAgentManager.rotationInterval).toBe(3600000); // 1 hour
      expect(userAgentManager.currentIndex).toBeGreaterThanOrEqual(0);
      expect(userAgentManager.currentIndex).toBeLessThan(14);
    });

    test('should respect environment configuration', () => {
      process.env.USER_AGENT_ROTATION_INTERVAL = '7200000'; // 2 hours

      const manager = new UserAgentManager(mockLogger);
      expect(manager.rotationInterval).toBe(7200000);

      delete process.env.USER_AGENT_ROTATION_INTERVAL;
    });

    test('should initialize usage statistics', () => {
      const freshManager = new UserAgentManager(mockLogger);
      const stats = freshManager.getUsageStats();
      expect(stats.totalRotations).toBe(0);
      expect(stats.uniqueAgentsUsed).toBe(1); // getCurrentUserAgent called during initialization
      expect(stats.sessionDurationHours).toBe(0);
    });
  });

  describe('getCurrentUserAgent', () => {
    test('should return a valid user agent string', () => {
      const userAgent = userAgentManager.getCurrentUserAgent();
      expect(typeof userAgent).toBe('string');
      expect(userAgent.length).toBeGreaterThan(50);
      expect(userAgent).toMatch(/Mozilla\/5\.0/);
    });

    test('should track usage statistics', () => {
      const userAgent = userAgentManager.getCurrentUserAgent();

      const stats = userAgentManager.getUsageStats();
      expect(stats.uniqueAgentsUsed).toBe(1);
      expect(stats.totalUsage).toBe(2); // Called once in constructor, once in test
      expect(stats.currentAgent).toBe(userAgent);
    });

    test('should not rotate if interval has not passed', () => {
      const initialAgent = userAgentManager.getCurrentUserAgent();
      const secondAgent = userAgentManager.getCurrentUserAgent();

      expect(secondAgent).toBe(initialAgent);
      expect(userAgentManager.usageStats.totalRotations).toBe(0);
    });
  });

  describe('Rotation Logic', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    test('should rotate after interval passes', () => {
      const initialAgent = userAgentManager.getCurrentUserAgent();

      // Advance time beyond rotation interval
      jest.advanceTimersByTime(3600001); // 1 hour + 1ms

      const rotatedAgent = userAgentManager.getCurrentUserAgent();

      expect(rotatedAgent).not.toBe(initialAgent);
      expect(userAgentManager.usageStats.totalRotations).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'User agent rotated',
        expect.objectContaining({
          from: initialAgent,
          to: rotatedAgent,
          rotationNumber: 1,
        })
      );
    });

    test('should wrap around to beginning of pool', () => {
      // Set to last index
      userAgentManager.currentIndex = userAgentManager.userAgentPool.length - 1;

      const rotatedAgent = userAgentManager.rotateUserAgent();

      expect(userAgentManager.currentIndex).toBe(0);
      expect(rotatedAgent).toBe(userAgentManager.userAgentPool[0]);
    });
  });

  describe('forceRotateToIndex', () => {
    test('should rotate to specific index', () => {
      const targetIndex = 5;
      const expectedAgent = userAgentManager.userAgentPool[targetIndex];

      const result = userAgentManager.forceRotateToIndex(targetIndex);

      expect(result).toBe(expectedAgent);
      expect(userAgentManager.currentIndex).toBe(targetIndex);
      expect(userAgentManager.usageStats.totalRotations).toBe(1);
    });

    test('should throw error for invalid index', () => {
      expect(() => {
        userAgentManager.forceRotateToIndex(-1);
      }).toThrow('Invalid user agent index');

      expect(() => {
        userAgentManager.forceRotateToIndex(100);
      }).toThrow('Invalid user agent index');
    });
  });

  describe('getMatchingViewport', () => {
    test('should return Windows viewport for Windows user agent', () => {
      const windowsAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      const viewport = userAgentManager.getMatchingViewport(windowsAgent);

      expect(viewport).toHaveProperty('width');
      expect(viewport).toHaveProperty('height');
      expect(viewport.width).toBeGreaterThan(1000);
      expect(viewport.height).toBeGreaterThan(700);
    });

    test('should return macOS viewport for macOS user agent', () => {
      const macAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
      const viewport = userAgentManager.getMatchingViewport(macAgent);

      expect(viewport).toHaveProperty('width');
      expect(viewport).toHaveProperty('height');
      expect([1440, 1680, 1920, 2560]).toContain(viewport.width);
    });

    test('should return Linux viewport for Linux user agent', () => {
      const linuxAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';
      const viewport = userAgentManager.getMatchingViewport(linuxAgent);

      expect(viewport).toHaveProperty('width');
      expect(viewport).toHaveProperty('height');
      expect([1920, 1366, 1600, 1440]).toContain(viewport.width);
    });

    test('should return default viewport for unknown user agent', () => {
      const unknownAgent = 'Unknown/1.0';
      const viewport = userAgentManager.getMatchingViewport(unknownAgent);

      expect(viewport).toEqual({ width: 1366, height: 768 });
    });

    test('should use current user agent if none provided', () => {
      const viewport = userAgentManager.getMatchingViewport();

      expect(viewport).toHaveProperty('width');
      expect(viewport).toHaveProperty('height');
    });
  });

  describe('getPlatformInfo', () => {
    test('should detect Windows platform and Chrome browser', () => {
      const agent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      const info = userAgentManager.getPlatformInfo(agent);

      expect(info.platform).toBe('Windows 10');
      expect(info.browser).toBe('Chrome');
      expect(info.version).toBe('120.0.0.0');
    });

    test('should detect macOS platform and Chrome browser', () => {
      const agent =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
      const info = userAgentManager.getPlatformInfo(agent);

      expect(info.platform).toBe('macOS');
      expect(info.browser).toBe('Chrome');
      expect(info.version).toBe('119.0.0.0');
    });

    test('should detect Edge browser', () => {
      const agent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
      const info = userAgentManager.getPlatformInfo(agent);

      expect(info.browser).toBe('Edge');
      expect(info.version).toBe('120.0.0.0');
    });

    test('should detect Firefox browser', () => {
      const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0';
      const info = userAgentManager.getPlatformInfo(agent);

      expect(info.browser).toBe('Firefox');
      expect(info.version).toBe('121.0');
    });

    test('should use current user agent if none provided', () => {
      const info = userAgentManager.getPlatformInfo();

      expect(info).toHaveProperty('platform');
      expect(info).toHaveProperty('browser');
      expect(info).toHaveProperty('version');
    });
  });

  describe('getRandomUserAgent', () => {
    test('should return random user agent from pool', () => {
      const agent = userAgentManager.getRandomUserAgent();

      expect(typeof agent).toBe('string');
      expect(userAgentManager.userAgentPool).toContain(agent);
    });

    test('should not affect current index', () => {
      const initialIndex = userAgentManager.currentIndex;

      userAgentManager.getRandomUserAgent();

      expect(userAgentManager.currentIndex).toBe(initialIndex);
    });
  });

  describe('Statistics and Information', () => {
    test('should provide comprehensive usage statistics', () => {
      // Generate some usage
      userAgentManager.getCurrentUserAgent();
      userAgentManager.rotateUserAgent();
      userAgentManager.getCurrentUserAgent();

      const stats = userAgentManager.getUsageStats();

      expect(stats).toHaveProperty('totalRotations');
      expect(stats).toHaveProperty('sessionDurationHours');
      expect(stats).toHaveProperty('uniqueAgentsUsed');
      expect(stats).toHaveProperty('agentDiversityPercent');
      expect(stats).toHaveProperty('currentAgent');
      expect(stats).toHaveProperty('nextRotationInMs');

      expect(stats.totalRotations).toBe(1);
      expect(stats.uniqueAgentsUsed).toBe(2);
      expect(stats.totalUsage).toBe(3); // Called once in constructor, once before rotation, once after
    });

    test('should provide pool information', () => {
      const poolInfo = userAgentManager.getPoolInfo();

      expect(poolInfo.totalAgents).toBe(14);
      expect(poolInfo.platforms).toContain('Windows 10');
      expect(poolInfo.platforms).toContain('macOS');
      expect(poolInfo.platforms).toContain('Linux');
      expect(poolInfo.browsers).toContain('Chrome');
      expect(poolInfo.browsers).toContain('Edge');
      expect(poolInfo.browsers).toContain('Firefox');
      expect(poolInfo.rotationIntervalMs).toBe(3600000);
    });
  });

  describe('Configuration Management', () => {
    test('should update rotation interval', () => {
      const newInterval = 1800000; // 30 minutes

      userAgentManager.setRotationInterval(newInterval);

      expect(userAgentManager.rotationInterval).toBe(newInterval);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'User agent rotation interval updated',
        expect.objectContaining({
          newIntervalMs: newInterval,
          newIntervalHours: 0.5,
        })
      );
    });

    test('should reject intervals less than 1 minute', () => {
      expect(() => {
        userAgentManager.setRotationInterval(30000); // 30 seconds
      }).toThrow('Rotation interval must be at least 60000ms');
    });
  });

  describe('Diversity and Randomness', () => {
    test('should provide good diversity across multiple rotations', () => {
      const usedAgents = new Set();

      // Force multiple rotations
      for (let i = 0; i < 10; i++) {
        userAgentManager.rotateUserAgent();
        usedAgents.add(userAgentManager.getCurrentUserAgent());
      }

      // Should have used multiple different agents
      expect(usedAgents.size).toBeGreaterThan(5);
    });

    test('should vary viewport dimensions for same platform', () => {
      const viewports = new Set();

      // Test multiple Windows agents
      const windowsAgents = userAgentManager.userAgentPool.filter(agent => agent.includes('Windows NT 10.0'));

      windowsAgents.forEach(agent => {
        const viewport = userAgentManager.getMatchingViewport(agent);
        viewports.add(`${viewport.width}x${viewport.height}`);
      });

      // Should have some variety in viewport sizes
      expect(viewports.size).toBeGreaterThan(1);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty logger gracefully', () => {
      const managerWithoutLogger = new UserAgentManager(null);

      expect(managerWithoutLogger.getCurrentUserAgent()).toBeDefined();
      expect(() => managerWithoutLogger.rotateUserAgent()).not.toThrow();
    });

    test('should maintain state consistency across operations', () => {
      const initialStats = userAgentManager.getUsageStats();

      // Perform various operations
      userAgentManager.getCurrentUserAgent();
      userAgentManager.getRandomUserAgent();
      userAgentManager.rotateUserAgent();
      userAgentManager.forceRotateToIndex(3);

      const finalStats = userAgentManager.getUsageStats();

      expect(finalStats.totalRotations).toBe(initialStats.totalRotations + 2);
      expect(finalStats.totalUsage).toBeGreaterThan(initialStats.totalUsage);
    });

    test('should handle rapid successive calls efficiently', () => {
      const startTime = Date.now();

      // Make many rapid calls
      for (let i = 0; i < 100; i++) {
        userAgentManager.getCurrentUserAgent();
      }

      const endTime = Date.now();

      // Should complete quickly (under 100ms)
      expect(endTime - startTime).toBeLessThan(100);

      const stats = userAgentManager.getUsageStats();
      expect(stats.totalUsage).toBe(101); // Called once in constructor, 100 times in loop
    });
  });
});
