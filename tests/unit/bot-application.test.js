import { BotApplication } from '../../src/application/bot-application.js';
import { jest } from '@jest/globals';

describe('BotApplication', () => {
  let botApplication;
  let mockDiscordService;
  let mockCommandProcessor;
  let mockEventBus;
  let mockConfig;
  let mockStateManager;
  let mockLogger;
  let mockScraperApplication;
  let mockMonitorApplication;
  let mockExec;

  beforeEach(() => {
    mockDiscordService = {};
    mockCommandProcessor = {};
    mockEventBus = {
      emit: jest.fn(),
    };
    mockConfig = {
      get: jest.fn((key, defaultValue) => {
        if (key === 'SYSTEMD_SERVICE_NAME') {
          return 'test-service';
        }
        return defaultValue;
      }),
      getBoolean: jest.fn(),
      getRequired: jest.fn(),
    };
    mockStateManager = {
      set: jest.fn(),
      get: jest.fn(),
      subscribe: jest.fn(),
    };
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      child: jest.fn(() => mockLogger),
    };
    mockScraperApplication = {
      getStats: jest.fn().mockReturnValue({ pollingInterval: {} }),
    };
    mockMonitorApplication = {
      getStats: jest.fn().mockReturnValue({}),
    };
    mockExec = jest.fn();

    botApplication = new BotApplication({
      exec: mockExec,
      discordService: mockDiscordService,
      commandProcessor: mockCommandProcessor,
      eventBus: mockEventBus,
      config: mockConfig,
      stateManager: mockStateManager,
      logger: mockLogger,
      scraperApplication: mockScraperApplication,
      monitorApplication: mockMonitorApplication,
    });
  });

  describe('softRestart', () => {
    it('should emit a bot.request_restart event', () => {
      botApplication.softRestart();
      expect(mockEventBus.emit).toHaveBeenCalledWith('bot.request_restart');
    });
  });

  describe('handleUpdate', () => {
    it('should execute git pull, npm install, and restart the service', () => {
      // Configure the mock to immediately execute the callback
      mockExec.mockImplementation((command, callback) => {
        // The first call is 'git pull', its callback schedules npm install
        if (command === 'git pull') {
          callback(null, 'OK', '');
        }
        // The second call is 'npm install', its callback schedules the restart
        if (command === 'npm install') {
          callback(null, 'Dependencies updated', '');
        }
        // The third call is the restart, we don't need to do anything in its callback
        if (command.includes('systemctl restart')) {
          callback(null, '', '');
        }
      });

      // Use fake timers to control setTimeout
      jest.useFakeTimers();

      botApplication.handleUpdate();

      // Verify git pull was called
      expect(mockExec).toHaveBeenCalledWith('git pull', expect.any(Function));

      // Fast-forward time to trigger the setTimeout for the restart
      jest.advanceTimersByTime(5000);

      // Verify restart was called
      expect(mockExec).toHaveBeenCalledWith('sudo systemctl restart test-service', expect.any(Function));

      // Restore real timers
      jest.useRealTimers();
    });
  });

  describe('createDetailedHealthEmbed', () => {
    it('should create a detailed health embed correctly', () => {
      const healthData = {
        bot: {
          isRunning: true,
          announcementEnabled: true,
          vxTwitterEnabled: false,
          botStartTime: new Date().toISOString(),
        },
        scraper: {
          isRunning: true,
          pollingInterval: { next: Date.now() + 60000 },
          totalRuns: 10,
          successfulRuns: 9,
          failedRuns: 1,
          totalTweetsFound: 100,
          totalTweetsAnnounced: 50,
          lastError: 'None',
        },
        monitor: {
          isRunning: true,
          subscriptions: 1,
          webhooksReceived: 5,
          videosProcessed: 5,
          videosAnnounced: 4,
          xmlParseFailures: 0,
          lastError: 'None',
        },
        system: { uptime: 12345, memory: { heapUsed: 1024 * 1024 * 50 }, timestamp: new Date().toISOString() },
      };
      botApplication.discord.isReady = () => true;
      botApplication.discord.getLatency = () => 123;
      botApplication.buildInfo = { version: '1.0', build: '123' };

      const embed = botApplication.createDetailedHealthEmbed(healthData);

      expect(embed.title).toBe('📊 Detailed Bot Health Status');
      expect(embed.fields).toHaveLength(12);
    });

    it('should display "In progress..." for next X poll when scraper is running but no next poll time is set', () => {
      const healthData = {
        bot: {
          isRunning: true,
          announcementEnabled: true,
          vxTwitterEnabled: false,
          botStartTime: new Date().toISOString(),
        },
        scraper: {
          isRunning: true,
          pollingInterval: { next: null },
          totalRuns: 10,
          successfulRuns: 9,
          failedRuns: 1,
          totalTweetsFound: 100,
          totalTweetsAnnounced: 50,
          lastError: 'None',
        },
        monitor: {
          isRunning: true,
          subscriptions: 1,
          webhooksReceived: 5,
          videosProcessed: 5,
          videosAnnounced: 4,
          xmlParseFailures: 0,
          lastError: 'None',
        },
        system: { uptime: 12345, memory: { heapUsed: 1024 * 1024 * 50 }, timestamp: new Date().toISOString() },
      };
      botApplication.discord.isReady = () => true;
      botApplication.discord.getLatency = () => 123;
      botApplication.buildInfo = { version: '1.0', build: '123' };

      const embed = botApplication.createDetailedHealthEmbed(healthData);
      const nextPollField = embed.fields.find(f => f.name === '⏳ Next X Poll');

      expect(nextPollField).toBeDefined();
      expect(nextPollField.value).toBe('In progress...');
    });
  });

  describe('handleMessage', () => {
    let mockMessage;

    beforeEach(() => {
      mockMessage = {
        author: {
          bot: false,
          id: 'user123',
        },
        content: '!test',
        channel: {
          id: 'channel123',
        },
        reply: jest.fn(),
      };
      botApplication.supportChannelId = 'channel123';
      botApplication.commandPrefix = '!';
    });

    it('should ignore bot messages', async () => {
      mockMessage.author.bot = true;
      const result = await botApplication.handleMessage(mockMessage);
      expect(result).toBeUndefined();
    });

    it('should ignore non-command messages', async () => {
      mockMessage.content = 'not a command';
      const result = await botApplication.handleMessage(mockMessage);
      expect(result).toBeUndefined();
    });

    it('should process commands when user is properly defined', async () => {
      // Use a simple command that doesn't require complex mocking
      mockMessage.content = '!readme';

      await botApplication.handleMessage(mockMessage);

      // Verify that the message was processed (reply was called)
      expect(mockMessage.reply).toHaveBeenCalled();
    });

    it('should handle messages with user variable properly initialized', async () => {
      // This test verifies that the user variable is accessible after being declared
      mockMessage.content = '!readme';
      mockMessage.author.id = 'validUserId';

      // This should not throw a ReferenceError about user being accessed before initialization
      await expect(botApplication.handleMessage(mockMessage)).resolves.not.toThrow();
      expect(mockMessage.reply).toHaveBeenCalled();
    });
  });
});
