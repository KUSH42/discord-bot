import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CommandProcessor } from '../../src/core/command-processor.js';
import { Configuration } from '../../src/infrastructure/configuration.js';
import { StateManager } from '../../src/infrastructure/state-manager.js';

describe('CommandProcessor', () => {
  let processor, mockConfig, mockState;

  beforeEach(() => {
    // Create mock configuration
    mockConfig = {
      get: jest.fn(),
      getRequired: jest.fn(),
      getBoolean: jest.fn(),
      getAllConfig: jest.fn(() => ({})),
    };

    // Create mock state manager
    mockState = {
      get: jest.fn(),
      set: jest.fn(),
      setValidator: jest.fn(),
    };

    // Set up default config values
    mockConfig.get.mockImplementation((key, defaultValue) => {
      const config = {
        COMMAND_PREFIX: '!',
        ALLOWED_USER_IDS: 'user1,user2,user3',
      };
      return config[key] !== undefined ? config[key] : defaultValue;
    });

    processor = new CommandProcessor(mockConfig, mockState);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with correct configuration', () => {
      expect(mockConfig.get).toHaveBeenCalledWith('COMMAND_PREFIX', '!');
      expect(mockState.setValidator).toHaveBeenCalledTimes(4); // 4 validators set up
    });

    it('should set up state validators correctly', () => {
      const validatorCalls = mockState.setValidator.mock.calls;

      expect(validatorCalls.some(call => call[0] === 'postingEnabled')).toBe(true);
      expect(validatorCalls.some(call => call[0] === 'announcementEnabled')).toBe(true);
      expect(validatorCalls.some(call => call[0] === 'vxTwitterConversionEnabled')).toBe(true);
      expect(validatorCalls.some(call => call[0] === 'logLevel')).toBe(true);
    });
  });

  describe('User Authorization', () => {
    it('should authorize user for non-restricted commands', () => {
      const result = processor.isUserAuthorized('anyuser', 'health');
      expect(result).toBe(true);
    });

    it('should authorize allowed user for restricted commands', () => {
      const result = processor.isUserAuthorized('user1', 'restart');
      expect(result).toBe(true);
    });

    it('should not authorize non-allowed user for restricted commands', () => {
      const result = processor.isUserAuthorized('unauthorizeduser', 'kill');
      expect(result).toBe(false);
    });

    it('should handle empty allowed users list', () => {
      mockConfig.get.mockReturnValue('');
      processor = new CommandProcessor(mockConfig, mockState);

      const result = processor.isUserAuthorized('anyuser', 'restart');
      expect(result).toBe(false);
    });
  });

  describe('Command Validation', () => {
    it('should validate correct command format', () => {
      const result = processor.validateCommand('health', [], 'user123');
      expect(result.success).toBe(true);
    });

    it('should reject invalid command', () => {
      const result = processor.validateCommand('', [], 'user123');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid command format');
    });

    it('should reject too long command', () => {
      const result = processor.validateCommand('a'.repeat(25), [], 'user123');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Command name too long');
    });

    it('should reject invalid user ID', () => {
      const result = processor.validateCommand('health', [], '');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid user ID');
    });

    it('should validate announce command arguments', () => {
      let result = processor.validateCommand('announce', ['true'], 'user123');
      expect(result.success).toBe(true);

      result = processor.validateCommand('announce', ['false'], 'user123');
      expect(result.success).toBe(true);

      result = processor.validateCommand('announce', ['invalid'], 'user123');
      expect(result.success).toBe(false);
    });

    it('should validate log level arguments', () => {
      let result = processor.validateCommand('loglevel', ['info'], 'user123');
      expect(result.success).toBe(true);

      result = processor.validateCommand('loglevel', ['invalid'], 'user123');
      expect(result.success).toBe(false);

      result = processor.validateCommand('loglevel', [''], 'user123');
      expect(result.success).toBe(false);
    });
  });

  describe('Command Processing', () => {
    it('should process kill command successfully', async () => {
      const result = await processor.processCommand('kill', [], 'user1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('All Discord posting has been stopped');
      expect(mockState.set).toHaveBeenCalledWith('postingEnabled', false);
    });

    it('should reject kill command for unauthorized user', async () => {
      const result = await processor.processCommand('kill', [], 'unauthorized');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not authorized');
    });

    it('should process announce command with arguments', async () => {
      const result = await processor.processCommand('announce', ['true'], 'user1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('enabled');
      expect(mockState.set).toHaveBeenCalledWith('announcementEnabled', true);
    });

    it('should process announce command without arguments', async () => {
      mockState.get.mockReturnValue(true);

      const result = await processor.processCommand('announce', [], 'user1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('enabled');
    });

    it('should process vxtwitter command', async () => {
      const result = await processor.processCommand('vxtwitter', ['false'], 'user1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('disabled');
      expect(mockState.set).toHaveBeenCalledWith('vxTwitterConversionEnabled', false);
    });

    it('should process loglevel command', async () => {
      const result = await processor.processCommand('loglevel', ['debug'], 'user1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('debug');
      expect(mockState.set).toHaveBeenCalledWith('logLevel', 'debug');
    });

    it('should process health command', async () => {
      mockState.get.mockImplementation((key, defaultValue) => {
        const values = {
          botStartTime: new Date('2023-01-01'),
          postingEnabled: true,
          announcementEnabled: false,
          vxTwitterConversionEnabled: true,
        };
        return values[key] !== undefined ? values[key] : defaultValue;
      });

      const result = await processor.processCommand('health', [], 'user1');

      expect(result.success).toBe(true);
      expect(result.healthData).toBeDefined();
      expect(result.healthData.uptime).toBeDefined();
      expect(result.healthData.memoryUsage).toBeDefined();
    });

    it('should process health-detailed command', async () => {
      const appStats = { bot: {}, scraper: {}, monitor: {}, system: {} };
      const result = await processor.processCommand('health-detailed', [], 'user1', appStats);

      expect(result.success).toBe(true);
      expect(result.healthData).toEqual(appStats);
    });

    it('should process hd command as alias for health-detailed', async () => {
      const appStats = { bot: {}, scraper: {}, monitor: {}, system: {} };
      const result = await processor.processCommand('hd', [], 'user1', appStats);

      expect(result.success).toBe(true);
      expect(result.healthData).toEqual(appStats);
    });

    it('should process readme command', async () => {
      const result = await processor.processCommand('readme', [], 'user1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Discord Bot Message Commands');
      expect(result.message).toContain('!kill');
      expect(result.message).toContain('reloading the .env file');
    });

    it('should process restart command', async () => {
      const result = await processor.processCommand('restart', [], 'user1');

      expect(result.success).toBe(true);
      expect(result.requiresRestart).toBe(true);
      expect(result.message).toContain('Initiating full restart');
    });

    it('should process update command', async () => {
      const result = await processor.processCommand('update', [], 'user1');

      expect(result.success).toBe(true);
      expect(result.requiresUpdate).toBe(true);
      expect(result.message).toContain('Initiating update... Pulling latest changes, please wait for confirmation.');
    });

    it('should handle unknown command', async () => {
      const result = await processor.processCommand('unknown', [], 'user1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown command');
    });
  });

  describe('State Validators', () => {
    it('should validate posting enabled state', () => {
      // Get the validator function for postingEnabled
      const validatorCall = mockState.setValidator.mock.calls.find(call => call[0] === 'postingEnabled');
      const validator = validatorCall[1];

      expect(validator(true)).toBe(true);
      expect(validator(false)).toBe(true);
      expect(validator('invalid')).toContain('must be a boolean');
    });

    it('should validate log level state', () => {
      // Get the validator function for logLevel
      const validatorCall = mockState.setValidator.mock.calls.find(call => call[0] === 'logLevel');
      const validator = validatorCall[1];

      expect(validator('info')).toBe(true);
      expect(validator('debug')).toBe(true);
      expect(validator('invalid')).toContain('must be one of');
    });
  });

  describe('Statistics', () => {
    it('should return command statistics', () => {
      const stats = processor.getStats();

      expect(stats.availableCommands).toContain('kill');
      expect(stats.availableCommands).toContain('restart');
      expect(stats.availableCommands).toContain('health');
      expect(stats.restrictedCommands).toContain('kill');
      expect(stats.restrictedCommands).toContain('restart');
      expect(stats.allowedUsers).toBe(3);
      expect(stats.commandPrefix).toBe('!');
    });
  });

  describe('Edge Cases', () => {
    it('should handle null/undefined arguments gracefully', async () => {
      const result = await processor.processCommand('health', null, 'user1');
      expect(result.success).toBe(true);
    });

    it('should handle command validation errors', async () => {
      const result = await processor.processCommand(null, [], 'user1');
      expect(result.success).toBe(false);
    });

    it('should handle state manager errors gracefully', async () => {
      mockState.set.mockImplementation(() => {
        throw new Error('State error');
      });

      try {
        const result = await processor.processCommand('kill', [], 'user1');
        expect(result.success).toBe(false);
      } catch (error) {
        // The error should be thrown and caught
        expect(error.message).toBe('State error');
      }
    });
  });
});
