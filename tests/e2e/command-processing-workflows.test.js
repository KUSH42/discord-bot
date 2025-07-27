import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CommandProcessor } from '../../src/core/command-processor.js';
import { createMockClient, createMockChannel, createMockUser } from '../mocks/discord.mock.js';

describe('End-to-End Command Processing Workflows', () => {
  let commandProcessor;
  let mockConfig;
  let mockStateManager;
  let discordClient;
  let supportChannel;
  let authorizedUser;
  let unauthorizedUser;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create mock configuration
    mockConfig = {
      get: jest.fn((key, defaultValue) => {
        const config = {
          COMMAND_PREFIX: '!',
          ALLOWED_USER_IDS: '123456789012345678,987654321098765432',
        };
        return config[key] || defaultValue;
      }),
    };

    // Create mock state manager with validation support
    mockStateManager = {
      data: new Map(),
      validators: new Map(),
      subscribers: new Map(),

      get: jest.fn((key, defaultValue) => {
        return mockStateManager.data.get(key) ?? defaultValue;
      }),

      set: jest.fn((key, value) => {
        // Validate if validator exists
        if (mockStateManager.validators.has(key)) {
          const validator = mockStateManager.validators.get(key);
          const result = validator(value);
          if (result !== true) {
            throw new Error(result);
          }
        }

        const oldValue = mockStateManager.data.get(key);
        mockStateManager.data.set(key, value);

        // Notify subscribers
        if (mockStateManager.subscribers.has(key)) {
          setImmediate(() => {
            const callback = mockStateManager.subscribers.get(key);
            callback(value, oldValue);
          });
        }

        return value;
      }),

      setValidator: jest.fn((key, validator) => {
        mockStateManager.validators.set(key, validator);
      }),

      subscribe: jest.fn((key, callback) => {
        mockStateManager.subscribers.set(key, callback);
      }),
    };

    // Set initial state
    mockStateManager.data.set('botStartTime', new Date('2024-01-01T12:00:00Z'));
    mockStateManager.data.set('postingEnabled', true);
    mockStateManager.data.set('announcementEnabled', false);
    mockStateManager.data.set('vxTwitterConversionEnabled', false);
    mockStateManager.data.set('logLevel', 'info');

    // Create command processor
    commandProcessor = new CommandProcessor(mockConfig, mockStateManager);

    // Create mock Discord entities
    discordClient = createMockClient();
    supportChannel = createMockChannel({ id: 'support-channel', name: 'support' });
    authorizedUser = createMockUser({ id: '123456789012345678', username: 'authorized_user' });
    unauthorizedUser = createMockUser({ id: '555666777888999000', username: 'unauthorized_user' });

    discordClient.channels.cache.set('support-channel', supportChannel);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Health Commands Workflow', () => {
    it('should process !health command and return system status', async () => {
      const result = await commandProcessor.processCommand('health', [], authorizedUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Health check completed');
      expect(result.healthData).toBeDefined();
      expect(result.healthData).toHaveProperty('uptime');
      expect(result.healthData).toHaveProperty('memoryUsage');
      expect(result.healthData).toHaveProperty('postingStatus', 'Enabled');
      expect(result.healthData).toHaveProperty('announcements', 'Disabled');
      expect(result.healthData).toHaveProperty('vxTwitter', 'Disabled');
      expect(result.healthData).toHaveProperty('botStartTime');
      expect(result.healthData).toHaveProperty('timestamp');
    });

    it('should process !health-detailed command with app stats', async () => {
      const mockAppStats = {
        youtube: {
          status: 'operational',
          lastCheck: new Date().toISOString(),
          totalVideos: 42,
          webhookStatus: 'active',
        },
        twitter: {
          status: 'operational',
          lastScrape: new Date().toISOString(),
          totalPosts: 15,
          authStatus: 'authenticated',
        },
        discord: {
          status: 'connected',
          guilds: 1,
          channels: 5,
          latency: 45,
        },
        system: {
          uptime: '2h 30m 15s',
          memory: '128 MB',
          nodeVersion: 'v18.17.0',
        },
      };

      const result = await commandProcessor.processCommand('health-detailed', [], authorizedUser.id, mockAppStats);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Detailed health check completed');
      expect(result.healthData).toEqual(mockAppStats);
    });

    it('should handle !hd as alias for !health-detailed', async () => {
      const mockAppStats = { system: { status: 'ok' } };
      const result = await commandProcessor.processCommand('hd', [], authorizedUser.id, mockAppStats);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Detailed health check completed');
      expect(result.healthData).toEqual(mockAppStats);
    });

    it('should handle !health-detailed when app stats are unavailable', async () => {
      const result = await commandProcessor.processCommand('health-detailed', [], authorizedUser.id);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Detailed health information is not available at the moment.');
    });
  });

  describe('State Management Commands Workflow', () => {
    it('should process !announce true command and update state', async () => {
      expect(mockStateManager.get('announcementEnabled')).toBe(false);

      const result = await commandProcessor.processCommand('announce', ['true'], authorizedUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toBe('📣 Announcement posting is now **enabled**. (Support log is unaffected)');
      expect(result.logMessage).toBe('Announcement posting is now enabled.');
      expect(mockStateManager.set).toHaveBeenCalledWith('announcementEnabled', true);
      expect(mockStateManager.get('announcementEnabled')).toBe(true);
    });

    it('should process !announce false command and update state', async () => {
      mockStateManager.data.set('announcementEnabled', true);

      const result = await commandProcessor.processCommand('announce', ['false'], authorizedUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toBe('📣 Announcement posting is now **disabled**. (Support log is unaffected)');
      expect(result.logMessage).toBe('Announcement posting is now disabled.');
      expect(mockStateManager.set).toHaveBeenCalledWith('announcementEnabled', false);
      expect(mockStateManager.get('announcementEnabled')).toBe(false);
    });

    it('should show current state when !announce called without arguments', async () => {
      mockStateManager.data.set('announcementEnabled', true);

      const result = await commandProcessor.processCommand('announce', [], authorizedUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Current announcement state: enabled. Usage: !announce <true|false>');
    });

    it('should process !vxtwitter true command and update state', async () => {
      expect(mockStateManager.get('vxTwitterConversionEnabled')).toBe(false);

      const result = await commandProcessor.processCommand('vxtwitter', ['true'], authorizedUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toBe('🐦 URL conversion to vxtwitter.com is now **enabled**.');
      expect(result.logMessage).toBe('URL conversion is now enabled.');
      expect(mockStateManager.set).toHaveBeenCalledWith('vxTwitterConversionEnabled', true);
      expect(mockStateManager.get('vxTwitterConversionEnabled')).toBe(true);
    });

    it('should process !vxtwitter false command and update state', async () => {
      mockStateManager.data.set('vxTwitterConversionEnabled', true);

      const result = await commandProcessor.processCommand('vxtwitter', ['false'], authorizedUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toBe('🐦 URL conversion to vxtwitter.com is now **disabled**.');
      expect(result.logMessage).toBe('URL conversion is now disabled.');
      expect(mockStateManager.set).toHaveBeenCalledWith('vxTwitterConversionEnabled', false);
      expect(mockStateManager.get('vxTwitterConversionEnabled')).toBe(false);
    });

    it('should show current state when !vxtwitter called without arguments', async () => {
      mockStateManager.data.set('vxTwitterConversionEnabled', true);

      const result = await commandProcessor.processCommand('vxtwitter', [], authorizedUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Current vxtwitter conversion state: enabled. Usage: !vxtwitter <true|false>');
    });

    it('should process !loglevel debug command and update state', async () => {
      expect(mockStateManager.get('logLevel')).toBe('info');

      const result = await commandProcessor.processCommand('loglevel', ['debug'], authorizedUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toBe('🔧 Log level has been changed to **debug**.');
      expect(result.logMessage).toBe("Log level changed to 'debug'.");
      expect(result.newLogLevel).toBe('debug');
      expect(mockStateManager.set).toHaveBeenCalledWith('logLevel', 'debug');
      expect(mockStateManager.get('logLevel')).toBe('debug');
    });

    it('should show current state when !loglevel called without arguments', async () => {
      mockStateManager.data.set('logLevel', 'debug');

      const result = await commandProcessor.processCommand('loglevel', [], authorizedUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Current log level: debug. Usage: !loglevel <level>');
    });
  });

  describe('Authorization-Required Commands Workflow', () => {
    it('should process !restart command for authorized user', async () => {
      const result = await commandProcessor.processCommand('restart', [], authorizedUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toBe('🔄 Initiating full restart... The bot will reload all configurations.');
      expect(result.requiresRestart).toBe(true);
      expect(result.userId).toBe(authorizedUser.id);
    });

    it('should deny !restart command for unauthorized user', async () => {
      const result = await commandProcessor.processCommand('restart', [], unauthorizedUser.id);

      expect(result.success).toBe(false);
      expect(result.message).toBe('🚫 You are not authorized to use this command.');
      expect(result.requiresRestart).toBe(false);
    });

    it('should process !kill command for authorized user', async () => {
      expect(mockStateManager.get('postingEnabled')).toBe(true);

      const result = await commandProcessor.processCommand('kill', [], authorizedUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toBe('🛑 All Discord posting has been stopped.');
      expect(result.logMessage).toBe('User executed kill command. All Discord posting is now disabled.');
      expect(result.userId).toBe(authorizedUser.id);
      expect(mockStateManager.set).toHaveBeenCalledWith('postingEnabled', false);
      expect(mockStateManager.get('postingEnabled')).toBe(false);
    });

    it('should deny !kill command for unauthorized user', async () => {
      const result = await commandProcessor.processCommand('kill', [], unauthorizedUser.id);

      expect(result.success).toBe(false);
      expect(result.message).toBe('🚫 You are not authorized to use this command.');
      expect(mockStateManager.set).not.toHaveBeenCalledWith('postingEnabled', false);
    });

    it('should process !update command for authorized user', async () => {
      const result = await commandProcessor.processCommand('update', [], authorizedUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toBe(null); // Update command returns null as it handles messages separately
      expect(result.requiresUpdate).toBe(true);
      expect(result.userId).toBe(authorizedUser.id);
    });

    it('should deny !update command for unauthorized user', async () => {
      const result = await commandProcessor.processCommand('update', [], unauthorizedUser.id);

      expect(result.success).toBe(false);
      expect(result.message).toBe('🚫 You are not authorized to use this command.');
    });
  });

  describe('Informational Commands Workflow', () => {
    it('should process !readme command and return command list', async () => {
      const result = await commandProcessor.processCommand('readme', [], authorizedUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toContain('**Discord Bot Message Commands**');
      expect(result.message).toContain('**!kill**: Stops *all* bot posting');
      expect(result.message).toContain('**!restart**: Performs a full restart');
      expect(result.message).toContain('**!announce <true|false>**: Toggles announcement posting');
      expect(result.message).toContain('**!vxtwitter <true|false>**: Toggles the conversion');
      expect(result.message).toContain("**!loglevel <level>**: Changes the bot's logging level");
      expect(result.message).toContain('**!health**: Shows bot health status');
      expect(result.message).toContain('**!health-detailed**: Shows detailed health status');
      expect(result.message).toContain('**!update**: Pulls the latest changes from git');
      expect(result.message).toContain('**!readme**: Displays this command information');
    });
  });

  describe('Command Validation Workflow', () => {
    it('should reject invalid command format', async () => {
      const result = await commandProcessor.processCommand('', [], authorizedUser.id);

      expect(result.success).toBe(false);
      expect(result.message).toBe('❌ Invalid command format.');
    });

    it('should reject commands that are too long', async () => {
      const longCommand = 'a'.repeat(25);
      const result = await commandProcessor.processCommand(longCommand, [], authorizedUser.id);

      expect(result.success).toBe(false);
      expect(result.message).toBe('❌ Command name too long.');
    });

    it('should reject invalid user ID', async () => {
      const result = await commandProcessor.processCommand('health', [], '');

      expect(result.success).toBe(false);
      expect(result.message).toBe('❌ Invalid user ID.');
    });

    it('should reject invalid announce arguments', async () => {
      const result = await commandProcessor.processCommand('announce', ['maybe'], authorizedUser.id);

      expect(result.success).toBe(false);
      expect(result.message).toBe('❌ Invalid argument for !announce. Use `!announce true` or `!announce false`.');
    });

    it('should reject invalid vxtwitter arguments', async () => {
      const result = await commandProcessor.processCommand('vxtwitter', ['yes'], authorizedUser.id);

      expect(result.success).toBe(false);
      expect(result.message).toBe('❌ Invalid argument for !vxtwitter. Use `!vxtwitter true` or `!vxtwitter false`.');
    });

    it('should reject invalid log level format', async () => {
      const result = await commandProcessor.processCommand('loglevel', ['invalid-level!'], authorizedUser.id);

      expect(result.success).toBe(false);
      expect(result.message).toBe('❌ Invalid log level format.');
    });

    it('should reject unknown log level', async () => {
      const result = await commandProcessor.processCommand('loglevel', ['unknown'], authorizedUser.id);

      expect(result.success).toBe(false);
      expect(result.message).toBe('❌ Invalid log level. Valid levels are: error, warn, info, debug, verbose.');
    });

    it('should reject unknown commands', async () => {
      const result = await commandProcessor.processCommand('invalidcommand', [], authorizedUser.id);

      expect(result.success).toBe(false);
      expect(result.message).toBe('❓ Unknown command: `invalidcommand`. Use `!readme` for help.');
    });
  });

  describe('State Validation Workflow', () => {
    it('should validate boolean values for postingEnabled', async () => {
      // Valid boolean
      await expect(async () => {
        mockStateManager.set('postingEnabled', false);
      }).not.toThrow();

      // Invalid non-boolean
      await expect(async () => {
        mockStateManager.set('postingEnabled', 'invalid');
      }).rejects.toThrow('postingEnabled must be a boolean');
    });

    it('should validate boolean values for announcementEnabled', async () => {
      // Valid boolean
      await expect(async () => {
        mockStateManager.set('announcementEnabled', true);
      }).not.toThrow();

      // Invalid non-boolean
      await expect(async () => {
        mockStateManager.set('announcementEnabled', 123);
      }).rejects.toThrow('announcementEnabled must be a boolean');
    });

    it('should validate boolean values for vxTwitterConversionEnabled', async () => {
      // Valid boolean
      await expect(async () => {
        mockStateManager.set('vxTwitterConversionEnabled', false);
      }).not.toThrow();

      // Invalid non-boolean
      await expect(async () => {
        mockStateManager.set('vxTwitterConversionEnabled', null);
      }).rejects.toThrow('vxTwitterConversionEnabled must be a boolean');
    });

    it('should validate log level values', async () => {
      // Valid log levels
      const validLevels = ['error', 'warn', 'info', 'debug', 'verbose'];
      for (const level of validLevels) {
        const currentLevel = level; // Capture variable for safe closure
        const stateManager = mockStateManager; // Capture outer scope variable
        await expect(async () => {
          stateManager.set('logLevel', currentLevel);
        }).not.toThrow();
      }

      // Invalid log level
      await expect(async () => {
        mockStateManager.set('logLevel', 'invalid');
      }).rejects.toThrow('logLevel must be one of: error, warn, info, debug, verbose');
    });
  });

  describe('Complete Command Processing Workflow', () => {
    it('should simulate complete admin workflow: check health, enable features, restart', async () => {
      // Step 1: Check system health
      const healthResult = await commandProcessor.processCommand('health', [], authorizedUser.id);
      expect(healthResult.success).toBe(true);
      expect(healthResult.healthData.announcements).toBe('Disabled');

      // Step 2: Enable announcements
      const announceResult = await commandProcessor.processCommand('announce', ['true'], authorizedUser.id);
      expect(announceResult.success).toBe(true);
      expect(mockStateManager.get('announcementEnabled')).toBe(true);

      // Step 3: Enable vxtwitter conversion
      const vxResult = await commandProcessor.processCommand('vxtwitter', ['true'], authorizedUser.id);
      expect(vxResult.success).toBe(true);
      expect(mockStateManager.get('vxTwitterConversionEnabled')).toBe(true);

      // Step 4: Change log level for debugging
      const logResult = await commandProcessor.processCommand('loglevel', ['debug'], authorizedUser.id);
      expect(logResult.success).toBe(true);
      expect(mockStateManager.get('logLevel')).toBe('debug');

      // Step 5: Check health again to confirm changes
      const healthResult2 = await commandProcessor.processCommand('health', [], authorizedUser.id);
      expect(healthResult2.success).toBe(true);
      expect(healthResult2.healthData.announcements).toBe('Enabled');
      expect(healthResult2.healthData.vxTwitter).toBe('Enabled');

      // Step 6: Restart to apply changes
      const restartResult = await commandProcessor.processCommand('restart', [], authorizedUser.id);
      expect(restartResult.success).toBe(true);
      expect(restartResult.requiresRestart).toBe(true);
    });

    it('should simulate emergency shutdown workflow', async () => {
      // Scenario: Critical issue detected, need to stop all posting

      // Step 1: Check current status
      const healthResult = await commandProcessor.processCommand('health', [], authorizedUser.id);
      expect(healthResult.success).toBe(true);
      expect(healthResult.healthData.postingStatus).toBe('Enabled');

      // Step 2: Kill all posting immediately
      const killResult = await commandProcessor.processCommand('kill', [], authorizedUser.id);
      expect(killResult.success).toBe(true);
      expect(mockStateManager.get('postingEnabled')).toBe(false);

      // Step 3: Verify posting is disabled
      const healthResult2 = await commandProcessor.processCommand('health', [], authorizedUser.id);
      expect(healthResult2.success).toBe(true);
      expect(healthResult2.healthData.postingStatus).toBe('Disabled');

      // Step 4: Enable verbose logging for diagnostics
      const logResult = await commandProcessor.processCommand('loglevel', ['debug'], authorizedUser.id);
      expect(logResult.success).toBe(true);
      expect(mockStateManager.get('logLevel')).toBe('debug');
    });

    it('should simulate unauthorized user attempting restricted commands', async () => {
      // Unauthorized user tries to access restricted commands

      const restrictedCommands = [
        'restart',
        'kill',
        'update',
        'restart-scraper',
        'stop-scraper',
        'start-scraper',
        'force-reauth',
      ];

      for (const command of restrictedCommands) {
        const result = await commandProcessor.processCommand(command, [], unauthorizedUser.id);
        expect(result.success).toBe(false);
        expect(result.message).toBe('🚫 You are not authorized to use this command.');
      }

      // But can still use non-restricted commands
      const healthResult = await commandProcessor.processCommand('health', [], unauthorizedUser.id);
      expect(healthResult.success).toBe(true);

      const readmeResult = await commandProcessor.processCommand('readme', [], unauthorizedUser.id);
      expect(readmeResult.success).toBe(true);
    });
  });

  describe('Command Statistics and Metrics', () => {
    it('should provide accurate command statistics', async () => {
      const stats = commandProcessor.getStats();

      expect(stats).toHaveProperty('availableCommands');
      expect(stats.availableCommands).toEqual([
        'restart',
        'kill',
        'announce',
        'vxtwitter',
        'loglevel',
        'health',
        'health-detailed',
        'hd',
        'youtube-health',
        'x-health',
        'readme',
        'update',
        'restart-scraper',
        'stop-scraper',
        'start-scraper',
        'auth-status',
        'force-reauth',
        'scraper-health',
        'debug',
        'debug-status',
        'debug-level',
        'metrics',
        'log-pipeline',
      ]);

      expect(stats).toHaveProperty('restrictedCommands', [
        'restart',
        'kill',
        'update',
        'restart-scraper',
        'stop-scraper',
        'start-scraper',
        'force-reauth',
      ]);
      expect(stats).toHaveProperty('allowedUsers', 2); // Two users in ALLOWED_USER_IDS
      expect(stats).toHaveProperty('commandPrefix', '!');
    });

    it('should handle empty allowed user IDs configuration', async () => {
      // Mock empty ALLOWED_USER_IDS
      mockConfig.get.mockImplementation((key, defaultValue) => {
        if (key === 'ALLOWED_USER_IDS') {
          return '';
        }
        if (key === 'COMMAND_PREFIX') {
          return '!';
        }
        return defaultValue;
      });

      const processor = new CommandProcessor(mockConfig, mockStateManager);
      const stats = processor.getStats();

      expect(stats.allowedUsers).toBe(0);

      // Should deny all restricted commands when no users are allowed
      const result = await processor.processCommand('restart', [], '123456789012345678');
      expect(result.success).toBe(false);
      expect(result.message).toBe('🚫 You are not authorized to use this command.');
    });
  });
});
