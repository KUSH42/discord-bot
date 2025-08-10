/**
 * Basic tests for the colorize command functionality without complex mocking
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CommandProcessor } from '../../src/core/command-processor.js';

describe('CommandProcessor - Colorize Command Basic Tests', () => {
  let commandProcessor;
  let mockConfig;
  let mockStateManager;
  let mockDebugManager;
  let mockMetricsManager;
  let mockBaseLogger;

  beforeEach(() => {
    // Mock configuration
    mockConfig = {
      get: jest.fn((key, defaultValue) => {
        const configMap = {
          COMMAND_PREFIX: '!',
          ALLOWED_USER_IDS: '123456789012345678,987654321098765432',
        };
        return configMap[key] || defaultValue;
      }),
    };

    // Mock state manager with colorize session support
    const stateData = {
      colorizeSessions: {},
    };

    mockStateManager = {
      get: jest.fn((key, defaultValue) => stateData[key] || defaultValue),
      set: jest.fn((key, value) => {
        stateData[key] = value;
      }),
      setValidator: jest.fn(),
    };

    // Mock debug manager
    mockDebugManager = {
      isEnabled: jest.fn(() => false),
      getLevel: jest.fn(() => 1),
      toggleFlag: jest.fn(),
      setLevel: jest.fn(),
    };

    // Mock metrics manager
    mockMetricsManager = {
      recordMetric: jest.fn(),
      startTimer: jest.fn(() => ({ end: jest.fn() })),
      incrementCounter: jest.fn(),
      setGauge: jest.fn(),
    };

    // Mock logger with child method
    mockBaseLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      })),
    };

    // Create command processor instance
    commandProcessor = new CommandProcessor(
      mockConfig,
      mockStateManager,
      mockDebugManager,
      mockMetricsManager,
      mockBaseLogger
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Authorization and Validation', () => {
    it('should restrict colorize command to authorized users', async () => {
      const result = await commandProcessor.processCommand('colorize', ['help'], '111111111111111111');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not authorized');
    });

    it('should allow authorized users to use colorize command', async () => {
      const result = await commandProcessor.processCommand('colorize', ['help'], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Colorize Command Help');
    });

    it('should reject empty colorize command', async () => {
      const validation = commandProcessor.validateCommand('colorize', [], '123456789012345678');

      expect(validation.success).toBe(false);
      expect(validation.error).toContain('Invalid usage');
    });

    it('should reject overly long input', async () => {
      const longText = 'a'.repeat(1001);
      const validation = commandProcessor.validateCommand('colorize', [longText, 'rainbow'], '123456789012345678');

      expect(validation.success).toBe(false);
      expect(validation.error).toContain('too long');
    });
  });

  describe('Help Command', () => {
    it('should display help information', async () => {
      const result = await commandProcessor.processCommand('colorize', ['help'], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Colorize Command Help');
      expect(result.message).toContain('Simple Mode');
      expect(result.message).toContain('Advanced Mode');
      expect(result.message).toContain('rainbow');
      expect(result.message).toContain('DMs');
    });
  });

  describe('Advanced Mode - Session Management', () => {
    it('should start advanced session', async () => {
      const result = await commandProcessor.processCommand('colorize', ['advanced'], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Starting Advanced Colorize Session');
      expect(result.message).toContain('Step 1/4');
      expect(result.colorizeSession).toBe(true);

      // Check session was created
      const sessions = mockStateManager.get('colorizeSessions');
      expect(sessions['123456789012345678']).toBeDefined();
      expect(sessions['123456789012345678'].step).toBe(1);
    });

    it('should handle preset gradient type selection', async () => {
      // Start session
      await commandProcessor.processCommand('colorize', ['advanced'], '123456789012345678');

      // Select preset type
      const result = await commandProcessor.processCommand('colorize', ['preset'], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Step 2/4');
      expect(result.message).toContain('Choose Preset');

      // Check session was updated
      const sessions = mockStateManager.get('colorizeSessions');
      expect(sessions['123456789012345678'].step).toBe(2);
      expect(sessions['123456789012345678'].config.type).toBe('preset');
    });

    it('should handle custom gradient type selection', async () => {
      // Start session
      await commandProcessor.processCommand('colorize', ['advanced'], '123456789012345678');

      // Select custom type
      const result = await commandProcessor.processCommand('colorize', ['custom'], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Step 2/4');
      expect(result.message).toContain('Define Custom Colors');

      // Check session was updated
      const sessions = mockStateManager.get('colorizeSessions');
      expect(sessions['123456789012345678'].step).toBe(2);
      expect(sessions['123456789012345678'].config.type).toBe('custom');
    });

    it('should reject invalid gradient type', async () => {
      // Start session
      await commandProcessor.processCommand('colorize', ['advanced'], '123456789012345678');

      // Invalid type
      const result = await commandProcessor.processCommand('colorize', ['invalid'], '123456789012345678');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid choice');
      expect(result.colorizeSession).toBe(true);
    });

    it('should cancel session', async () => {
      // Start session
      await commandProcessor.processCommand('colorize', ['advanced'], '123456789012345678');

      // Cancel session
      const result = await commandProcessor.processCommand('colorize', ['cancel'], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('session cancelled');

      // Check session was cleared
      const sessions = mockStateManager.get('colorizeSessions');
      expect(sessions['123456789012345678']).toBeUndefined();
    });

    it('should handle session timeout', async () => {
      // Create expired session
      const expiredTimestamp = Date.now() - 11 * 60 * 1000; // 11 minutes ago
      const sessions = { '123456789012345678': { timestamp: expiredTimestamp } };
      mockStateManager.set('colorizeSessions', sessions);

      // Try to continue session
      const result = await commandProcessor.processCommand('colorize', ['preset'], '123456789012345678');

      // Should start new session instead of continuing expired one
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid usage'); // No active session
    });
  });

  describe('Custom Colors Validation', () => {
    it('should validate hex colors', () => {
      expect(commandProcessor.isValidColor('#ff0000')).toBe(true);
      expect(commandProcessor.isValidColor('#f00')).toBe(true);
      expect(commandProcessor.isValidColor('#xyz')).toBe(false);
    });

    it('should validate RGB colors', () => {
      expect(commandProcessor.isValidColor('rgb(255,0,0)')).toBe(true);
      expect(commandProcessor.isValidColor('rgb( 255 , 0 , 0 )')).toBe(true);
      expect(commandProcessor.isValidColor('rgb(300,0,0)')).toBe(true); // Basic validation, doesn't check ranges
    });

    it('should validate CSS color names', () => {
      expect(commandProcessor.isValidColor('red')).toBe(true);
      expect(commandProcessor.isValidColor('blue')).toBe(true);
      expect(commandProcessor.isValidColor('invalidcolorname')).toBe(false);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle session without active user', async () => {
      const result = await commandProcessor.processCommand('colorize', ['cancel'], '123456789012345678');

      expect(result.success).toBe(false);
      expect(result.message).toContain('No active colorize session');
    });
  });

  describe('Command Infrastructure', () => {
    it('should be included in restricted commands list', () => {
      const stats = commandProcessor.getStats();
      expect(stats.restrictedCommands).toContain('colorize');
      expect(stats.availableCommands).toContain('colorize');
    });

    it('should require user authorization', async () => {
      expect(commandProcessor.isUserAuthorized('123456789012345678', 'colorize')).toBe(true);
      expect(commandProcessor.isUserAuthorized('111111111', 'colorize')).toBe(false);
    });
  });
});
