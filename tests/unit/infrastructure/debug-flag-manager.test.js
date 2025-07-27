import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { DebugFlagManager } from '../../../src/infrastructure/debug-flag-manager.js';
import { StateManager } from '../../../src/infrastructure/state-manager.js';

describe('DebugFlagManager', () => {
  let stateManager;
  let mockLogger;
  let debugManager;

  beforeEach(() => {
    // Clean up environment variables before each test
    delete process.env.DEBUG_FLAGS;
    delete process.env.DEBUG_LEVEL_SCRAPER;
    delete process.env.DEBUG_LEVEL_BROWSER;

    stateManager = new StateManager();
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    debugManager = new DebugFlagManager(stateManager, mockLogger);
  });

  describe('constructor', () => {
    it('should initialize with default state', () => {
      const availableModules = debugManager.getAvailableModules();
      expect(availableModules).toContain('content-announcer');
      expect(availableModules).toContain('scraper');
      expect(availableModules).toContain('youtube');
      expect(availableModules).toContain('browser');
      expect(availableModules).toHaveLength(9);
    });

    it('should initialize debug flags from environment', () => {
      process.env.DEBUG_FLAGS = 'content-announcer,scraper';
      const localStateManager = new StateManager();
      const manager = new DebugFlagManager(localStateManager, mockLogger);

      expect(manager.isEnabled('content-announcer')).toBe(true);
      expect(manager.isEnabled('scraper')).toBe(true);
      expect(manager.isEnabled('youtube')).toBe(false);

      delete process.env.DEBUG_FLAGS;
    });

    it('should initialize debug levels from environment', () => {
      process.env.DEBUG_LEVEL_SCRAPER = '5';
      process.env.DEBUG_LEVEL_BROWSER = '1';
      const localStateManager = new StateManager();
      const manager = new DebugFlagManager(localStateManager, mockLogger);

      expect(manager.getLevel('scraper')).toBe(5);
      expect(manager.getLevel('browser')).toBe(1);
      expect(manager.getLevel('youtube')).toBe(3); // default

      delete process.env.DEBUG_LEVEL_SCRAPER;
      delete process.env.DEBUG_LEVEL_BROWSER;
    });
  });

  describe('isEnabled', () => {
    it('should return false for disabled modules', () => {
      expect(debugManager.isEnabled('content-announcer')).toBe(false);
    });

    it('should return true for enabled modules', () => {
      debugManager.toggle('content-announcer', true);
      expect(debugManager.isEnabled('content-announcer')).toBe(true);
    });

    it('should throw error for unknown modules', () => {
      expect(() => debugManager.isEnabled('unknown-module')).toThrow('Unknown debug module: unknown-module');
    });
  });

  describe('getLevel', () => {
    it('should return default level for modules', () => {
      expect(debugManager.getLevel('content-announcer')).toBe(3);
    });

    it('should return set level for modules', () => {
      debugManager.setLevel('content-announcer', 5);
      expect(debugManager.getLevel('content-announcer')).toBe(5);
    });

    it('should throw error for unknown modules', () => {
      expect(() => debugManager.getLevel('unknown-module')).toThrow('Unknown debug module: unknown-module');
    });
  });

  describe('shouldLog', () => {
    beforeEach(() => {
      debugManager.toggle('content-announcer', true);
      debugManager.setLevel('content-announcer', 4);
    });

    it('should return false if module is disabled', () => {
      debugManager.toggle('content-announcer', false);
      expect(debugManager.shouldLog('content-announcer', 1)).toBe(false);
    });

    it('should return true for message level <= module level', () => {
      expect(debugManager.shouldLog('content-announcer', 3)).toBe(true);
      expect(debugManager.shouldLog('content-announcer', 4)).toBe(true);
    });

    it('should return false for message level > module level', () => {
      expect(debugManager.shouldLog('content-announcer', 5)).toBe(false);
    });
  });

  describe('toggle', () => {
    it('should enable debug for module', () => {
      const result = debugManager.toggle('content-announcer', true);
      expect(result).toBe(true);
      expect(debugManager.isEnabled('content-announcer')).toBe(true);
    });

    it('should disable debug for module', () => {
      debugManager.toggle('content-announcer', true);
      const result = debugManager.toggle('content-announcer', false);
      expect(result).toBe(false);
      expect(debugManager.isEnabled('content-announcer')).toBe(false);
    });

    it('should log the change', () => {
      debugManager.toggle('content-announcer', true);
      expect(mockLogger.info).toHaveBeenLastCalledWith('Debug flag changed', {
        module: 'content-announcer',
        enabled: true,
        previousState: false,
      });
    });

    it('should throw error for unknown modules', () => {
      expect(() => debugManager.toggle('unknown-module', true)).toThrow('Unknown debug module: unknown-module');
    });
  });

  describe('setLevel', () => {
    it('should set debug level for module', () => {
      const result = debugManager.setLevel('content-announcer', 5);
      expect(result).toBe(5);
      expect(debugManager.getLevel('content-announcer')).toBe(5);
    });

    it('should log the change', () => {
      debugManager.setLevel('content-announcer', 5);
      expect(mockLogger.info).toHaveBeenLastCalledWith('Debug level changed', {
        module: 'content-announcer',
        level: 5,
        previousLevel: 3,
      });
    });

    it('should throw error for invalid levels', () => {
      expect(() => debugManager.setLevel('content-announcer', 0)).toThrow('Invalid debug level: 0. Must be 1-5');
      expect(() => debugManager.setLevel('content-announcer', 6)).toThrow('Invalid debug level: 6. Must be 1-5');
    });

    it('should throw error for unknown modules', () => {
      expect(() => debugManager.setLevel('unknown-module', 3)).toThrow('Unknown debug module: unknown-module');
    });
  });

  describe('getStatus', () => {
    beforeEach(() => {
      debugManager.toggle('content-announcer', true);
      debugManager.toggle('scraper', true);
      debugManager.setLevel('content-announcer', 5);
    });

    it('should return status for all modules', () => {
      const status = debugManager.getStatus();

      expect(status.enabledCount).toBe(2);
      expect(status.totalCount).toBe(9);
      expect(status.modules['content-announcer']).toEqual({
        enabled: true,
        level: 5,
        levelName: 'verbose',
      });
      expect(status.modules['youtube']).toEqual({
        enabled: false,
        level: 3,
        levelName: 'info',
      });
    });
  });

  describe('getLevelName', () => {
    it('should return correct level names', () => {
      expect(debugManager.getLevelName(1)).toBe('errors');
      expect(debugManager.getLevelName(2)).toBe('warnings');
      expect(debugManager.getLevelName(3)).toBe('info');
      expect(debugManager.getLevelName(4)).toBe('debug');
      expect(debugManager.getLevelName(5)).toBe('verbose');
      expect(debugManager.getLevelName(99)).toBe('unknown');
    });
  });

  describe('bulkToggle', () => {
    it('should update multiple debug flags', () => {
      const updates = {
        'content-announcer': true,
        scraper: true,
        youtube: false,
      };

      const result = debugManager.bulkToggle(updates);

      expect(debugManager.isEnabled('content-announcer')).toBe(true);
      expect(debugManager.isEnabled('scraper')).toBe(true);
      expect(debugManager.isEnabled('youtube')).toBe(false);
      expect(result['content-announcer']).toBe(true);
    });

    it('should throw error for invalid input', () => {
      expect(() => debugManager.bulkToggle(null)).toThrow('Updates must be an object');
      expect(() => debugManager.bulkToggle('invalid')).toThrow('Updates must be an object');
    });

    it('should throw error for unknown modules', () => {
      expect(() => debugManager.bulkToggle({ 'unknown-module': true })).toThrow('Unknown debug module: unknown-module');
    });
  });

  describe('bulkSetLevels', () => {
    it('should update multiple debug levels', () => {
      const updates = {
        'content-announcer': 5,
        scraper: 1,
        youtube: 4,
      };

      const result = debugManager.bulkSetLevels(updates);

      expect(debugManager.getLevel('content-announcer')).toBe(5);
      expect(debugManager.getLevel('scraper')).toBe(1);
      expect(debugManager.getLevel('youtube')).toBe(4);
      expect(result['content-announcer']).toBe(5);
    });

    it('should throw error for invalid levels', () => {
      expect(() => debugManager.bulkSetLevels({ 'content-announcer': 0 })).toThrow(
        'Invalid debug level for content-announcer: 0. Must be 1-5'
      );
    });
  });

  describe('reset', () => {
    it('should reset all flags and levels to defaults', () => {
      debugManager.toggle('content-announcer', true);
      debugManager.setLevel('scraper', 5);

      debugManager.reset();

      expect(debugManager.isEnabled('content-announcer')).toBe(false);
      expect(debugManager.getLevel('scraper')).toBe(3);
    });
  });

  describe('subscribe', () => {
    it('should call callback when debug flag changes', async () => {
      const callback = jest.fn();
      const unsubscribe = debugManager.subscribe('content-announcer', callback);

      debugManager.toggle('content-announcer', true);

      // StateManager uses setImmediate for async callbacks
      await new Promise(resolve => setImmediate(resolve));

      expect(callback).toHaveBeenCalledWith(true, false, 'content-announcer');
      unsubscribe();
    });
  });

  describe('getStats', () => {
    it('should return statistics about debug usage', () => {
      debugManager.toggle('content-announcer', true);
      debugManager.toggle('scraper', true);

      const stats = debugManager.getStats();

      expect(stats.totalModules).toBe(9);
      expect(stats.enabledModules).toBe(2);
      expect(stats.enabledPercentage).toBe(22); // 2/9 * 100 rounded
      expect(stats.moduleStats).toBeDefined();
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });
  });

  describe('state validation', () => {
    it('should validate debug flags object', () => {
      expect(() => stateManager.set('debugFlags', 'invalid')).toThrow('Debug flags must be an object');
      expect(() => stateManager.set('debugFlags', { 'unknown-module': true })).toThrow(
        'Unknown debug module: unknown-module'
      );
      expect(() => stateManager.set('debugFlags', { 'content-announcer': 'invalid' })).toThrow(
        'Debug flag for content-announcer must be boolean'
      );
    });

    it('should validate debug levels object', () => {
      expect(() => stateManager.set('debugLevels', 'invalid')).toThrow('Debug levels must be an object');
      expect(() => stateManager.set('debugLevels', { 'unknown-module': 3 })).toThrow(
        'Unknown debug module: unknown-module'
      );
      expect(() => stateManager.set('debugLevels', { 'content-announcer': 6 })).toThrow(
        'Debug level for content-announcer must be 1-5'
      );
    });
  });
});
