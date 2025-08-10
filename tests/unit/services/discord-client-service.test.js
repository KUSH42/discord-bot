import { jest } from '@jest/globals';
import { DiscordClientService } from '../../../src/services/implementations/discord-client-service.js';
import { createMockDependenciesWithEnhancedLogging } from '../../utils/enhanced-logging-mocks.js';

describe('Discord Client Service', () => {
  let discordClientService;
  let mockLogger;
  let mockClient;
  let mockSend;
  let mockChannel;

  beforeEach(() => {
    // Create enhanced logging mocks
    const enhancedLoggingMocks = createMockDependenciesWithEnhancedLogging();
    mockLogger = enhancedLoggingMocks.logger;

    mockSend = jest.fn();
    mockChannel = {
      send: mockSend,
      isTextBased: () => true, // Mock the channel type check
    };

    mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue(mockChannel),
      },
      destroy: jest.fn().mockResolvedValue(undefined),
    };

    // Correctly instantiate the service with the mock client and logger
    discordClientService = new DiscordClientService(mockClient, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should send a message to a channel successfully', async () => {
    const channelId = '12345';
    const message = 'Test message';
    await discordClientService.sendMessage(channelId, message);

    expect(mockClient.channels.fetch).toHaveBeenCalledWith(channelId);
    expect(mockSend).toHaveBeenCalledWith(message);
  });

  it('should throw an error if the channel is not a text channel', async () => {
    const nonTextChannel = { isTextBased: () => false };
    mockClient.channels.fetch.mockResolvedValue(nonTextChannel);

    const channelId = '54321';
    const message = 'This should fail';

    await expect(discordClientService.sendMessage(channelId, message)).rejects.toThrow(
      'Channel 54321 is not a valid text channel'
    );
  });

  it('should throw an error if the channel is not found', async () => {
    mockClient.channels.fetch.mockResolvedValue(null);

    const channelId = 'nonexistent';
    const message = 'This should also fail';

    await expect(discordClientService.sendMessage(channelId, message)).rejects.toThrow(
      'Channel nonexistent is not a valid text channel'
    );
  });

  describe('Authentication and Connection', () => {
    it('should login with valid token', async () => {
      const token = 'test-bot-token';
      mockClient.login = jest.fn().mockResolvedValue(undefined);

      await discordClientService.login(token);

      expect(mockClient.login).toHaveBeenCalledWith(token);
    });

    it('should handle login failures', async () => {
      const token = 'invalid-token';
      const loginError = new Error('Invalid bot token');
      mockClient.login = jest.fn().mockRejectedValue(loginError);

      await expect(discordClientService.login(token)).rejects.toThrow('Invalid bot token');
    });

    it('should check ready status correctly when ready', () => {
      mockClient.readyAt = new Date();

      const isReady = discordClientService.isReady();

      expect(isReady).toBe(true);
    });

    it('should check ready status correctly when not ready', () => {
      mockClient.readyAt = null;

      const isReady = discordClientService.isReady();

      expect(isReady).toBe(false);
    });

    it('should get current user info', async () => {
      const mockUser = { id: '123456789', username: 'TestBot' };
      mockClient.user = mockUser;

      const user = await discordClientService.getCurrentUser();

      expect(user).toBe(mockUser);
    });

    it('should measure latency', () => {
      const mockPing = 42;
      mockClient.ws = { ping: mockPing };

      const latency = discordClientService.getLatency();

      expect(latency).toBe(mockPing);
    });

    it('should destroy connection properly', async () => {
      await discordClientService.destroy();

      expect(mockClient.destroy).toHaveBeenCalled();
    });
  });

  describe('Channel and Guild Operations', () => {
    it('should fetch channels successfully', async () => {
      const channelId = 'test-channel-123';
      const mockChannelData = { id: channelId, name: 'test-channel' };
      mockClient.channels.fetch.mockResolvedValue(mockChannelData);

      const channel = await discordClientService.fetchChannel(channelId);

      expect(mockClient.channels.fetch).toHaveBeenCalledWith(channelId);
      expect(channel).toBe(mockChannelData);
    });

    it('should fetch guilds successfully', async () => {
      const guildId = 'test-guild-456';
      const mockGuildData = { id: guildId, name: 'Test Guild' };
      mockClient.guilds = {
        fetch: jest.fn().mockResolvedValue(mockGuildData),
      };

      const guild = await discordClientService.fetchGuild(guildId);

      expect(mockClient.guilds.fetch).toHaveBeenCalledWith(guildId);
      expect(guild).toBe(mockGuildData);
    });

    it('should handle channel fetch errors', async () => {
      const channelId = 'error-channel';
      const fetchError = new Error('Channel not found');
      mockClient.channels.fetch.mockRejectedValue(fetchError);

      await expect(discordClientService.fetchChannel(channelId)).rejects.toThrow('Channel not found');
    });

    it('should handle guild fetch errors', async () => {
      const guildId = 'error-guild';
      const fetchError = new Error('Guild not found');
      mockClient.guilds = {
        fetch: jest.fn().mockRejectedValue(fetchError),
      };

      await expect(discordClientService.fetchGuild(guildId)).rejects.toThrow('Guild not found');
    });
  });

  describe('Message Operations', () => {
    let mockMessage;

    beforeEach(() => {
      mockMessage = {
        id: 'test-message-123',
        content: 'Test message content',
        edit: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        react: jest.fn().mockResolvedValue(undefined),
      };

      mockChannel.messages = {
        fetch: jest.fn().mockResolvedValue(mockMessage),
      };
    });

    it('should edit messages successfully', async () => {
      const channelId = 'test-channel';
      const messageId = 'test-message-123';
      const newContent = 'Updated message content';

      await discordClientService.editMessage(channelId, messageId, newContent);

      expect(mockClient.channels.fetch).toHaveBeenCalledWith(channelId);
      expect(mockChannel.messages.fetch).toHaveBeenCalledWith(messageId);
      expect(mockMessage.edit).toHaveBeenCalledWith(newContent);
    });

    it('should delete messages successfully', async () => {
      const channelId = 'test-channel';
      const messageId = 'test-message-123';

      await discordClientService.deleteMessage(channelId, messageId);

      expect(mockClient.channels.fetch).toHaveBeenCalledWith(channelId);
      expect(mockChannel.messages.fetch).toHaveBeenCalledWith(messageId);
      expect(mockMessage.delete).toHaveBeenCalled();
    });

    it('should add reactions successfully', async () => {
      const channelId = 'test-channel';
      const messageId = 'test-message-123';
      const emoji = '👍';

      await discordClientService.addReaction(channelId, messageId, emoji);

      expect(mockClient.channels.fetch).toHaveBeenCalledWith(channelId);
      expect(mockChannel.messages.fetch).toHaveBeenCalledWith(messageId);
      expect(mockMessage.react).toHaveBeenCalledWith(emoji);
    });

    it('should handle edit message errors for invalid channels', async () => {
      const invalidChannel = { isTextBased: () => false };
      mockClient.channels.fetch.mockResolvedValue(invalidChannel);

      await expect(discordClientService.editMessage('invalid-channel', 'message-id', 'new content')).rejects.toThrow(
        'Channel invalid-channel is not a valid text channel'
      );
    });

    it('should handle delete message errors for invalid channels', async () => {
      mockClient.channels.fetch.mockResolvedValue(null);

      await expect(discordClientService.deleteMessage('nonexistent-channel', 'message-id')).rejects.toThrow(
        'Channel nonexistent-channel is not a valid text channel'
      );
    });

    it('should handle add reaction errors for invalid channels', async () => {
      const invalidChannel = { isTextBased: () => false };
      mockClient.channels.fetch.mockResolvedValue(invalidChannel);

      await expect(discordClientService.addReaction('invalid-channel', 'message-id', '👍')).rejects.toThrow(
        'Channel invalid-channel is not a valid text channel'
      );
    });

    it('should handle message fetch errors', async () => {
      const fetchError = new Error('Message not found');
      mockChannel.messages = {
        fetch: jest.fn().mockRejectedValue(fetchError),
      };

      await expect(
        discordClientService.editMessage('test-channel', 'nonexistent-message', 'new content')
      ).rejects.toThrow('Message not found');
    });
  });

  describe('Event Handling', () => {
    it('should register message handlers and handle messages', () => {
      const mockHandler = jest.fn();
      const mockMessage = {
        content: 'Test message',
        channelId: 'test-channel',
        author: { id: 'user-123' },
      };

      // Mock client event handling
      mockClient.on = jest.fn();
      mockClient.off = jest.fn();
      mockClient.listenerCount = jest.fn().mockReturnValue(0);

      const unregister = discordClientService.onMessage(mockHandler);

      // Verify event was registered
      expect(mockClient.on).toHaveBeenCalledWith('messageCreate', expect.any(Function));

      // Simulate message event
      const registeredHandler = mockClient.on.mock.calls[0][1];
      registeredHandler(mockMessage);

      expect(mockHandler).toHaveBeenCalledWith(mockMessage);

      // Test unregister function
      unregister();
      expect(mockClient.off).toHaveBeenCalledWith('messageCreate', expect.any(Function));
    });

    it('should handle message handler errors gracefully', () => {
      const errorMessage = 'Handler error';
      const mockHandler = jest.fn().mockImplementation(() => {
        throw new Error(errorMessage);
      });
      const mockMessage = {
        content: 'Test message',
        channelId: 'test-channel',
        author: { id: 'user-123' },
      };

      mockClient.on = jest.fn();
      mockClient.listenerCount = jest.fn().mockReturnValue(0);

      discordClientService.onMessage(mockHandler);

      // Get the wrapped handler
      const wrappedHandler = mockClient.on.mock.calls[0][1];

      // This should not throw, but should log error
      expect(() => wrappedHandler(mockMessage)).not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error in message handler:',
        expect.objectContaining({
          error: errorMessage,
          stack: expect.any(String),
          messageContent: 'Test message',
          channelId: 'test-channel',
          userId: 'user-123',
        })
      );
    });

    it('should register ready handlers', () => {
      const mockHandler = jest.fn();
      mockClient.on = jest.fn();
      mockClient.off = jest.fn();
      mockClient.listenerCount = jest.fn().mockReturnValue(0);

      const unregister = discordClientService.onReady(mockHandler);

      expect(mockClient.on).toHaveBeenCalledWith('ready', expect.any(Function));

      // Simulate ready event
      const registeredHandler = mockClient.on.mock.calls[0][1];
      registeredHandler();

      expect(mockHandler).toHaveBeenCalled();

      // Test unregister
      unregister();
      expect(mockClient.off).toHaveBeenCalledWith('ready', expect.any(Function));
    });

    it('should handle ready handler errors gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mockHandler = jest.fn().mockImplementation(() => {
        throw new Error('Ready handler error');
      });

      mockClient.on = jest.fn();

      discordClientService.onReady(mockHandler);

      const wrappedHandler = mockClient.on.mock.calls[0][1];

      expect(() => wrappedHandler()).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith('Error in ready handler:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('should register error handlers', () => {
      const mockHandler = jest.fn();
      const mockError = new Error('Test error');
      mockClient.on = jest.fn();
      mockClient.off = jest.fn();
      mockClient.listenerCount = jest.fn().mockReturnValue(0);

      const unregister = discordClientService.onError(mockHandler);

      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));

      // Simulate error event
      const registeredHandler = mockClient.on.mock.calls[0][1];
      registeredHandler(mockError);

      expect(mockHandler).toHaveBeenCalledWith(mockError);

      // Test unregister
      unregister();
      expect(mockClient.off).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should handle error handler errors gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mockHandler = jest.fn().mockImplementation(() => {
        throw new Error('Error handler error');
      });
      const mockError = new Error('Original error');

      mockClient.on = jest.fn();

      discordClientService.onError(mockHandler);

      const wrappedHandler = mockClient.on.mock.calls[0][1];

      expect(() => wrappedHandler(mockError)).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith('Error in error handler:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });
});
