import { jest } from '@jest/globals';
import { DiscordClientService } from '../../src/services/implementations/discord-client-service.js';

describe('Discord Service Integration', () => {
  let discordService;
  let mockClient;
  let mockChannel;
  let mockGuild;
  let mockLogger; // Mock logger

  beforeEach(() => {
    mockChannel = {
      send: jest.fn().mockResolvedValue({ id: 'message-123' }),
      id: 'channel-123',
      name: 'test-channel',
      guild: { id: 'guild-123' },
      isTextBased: jest.fn().mockReturnValue(true),
    };

    mockGuild = {
      id: 'guild-123',
      name: 'Test Guild',
    };

    mockClient = {
      login: jest.fn().mockResolvedValue(),
      channels: {
        fetch: jest.fn().mockResolvedValue(mockChannel),
      },
      guilds: {
        fetch: jest.fn().mockResolvedValue(mockGuild),
      },
      on: jest.fn(),
      removeListener: jest.fn(),
      listenerCount: jest.fn().mockReturnValue(0),
    };

    mockLogger = {
      // Create a mock logger
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      warn: jest.fn(),
      silly: jest.fn(),
      child: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
        warn: jest.fn(),
        silly: jest.fn(),
        child: jest.fn().mockReturnThis(),
      }),
    };

    discordService = new DiscordClientService(mockClient, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('login functionality', () => {
    it('should login successfully', async () => {
      const token = 'test-token';

      await discordService.login(token);

      expect(mockClient.login).toHaveBeenCalledWith(token);
    });

    it('should handle login errors gracefully', async () => {
      const connectionError = new Error('Invalid token');
      mockClient.login.mockRejectedValue(connectionError);

      await expect(discordService.login('invalid-token')).rejects.toThrow('Invalid token');
    });
  });

  describe('message sending', () => {
    it('should send text message successfully', async () => {
      const result = await discordService.sendMessage('channel-123', 'Hello, World!');

      expect(mockClient.channels.fetch).toHaveBeenCalledWith('channel-123');
      expect(mockChannel.isTextBased).toHaveBeenCalled();
      expect(mockChannel.send).toHaveBeenCalledWith('Hello, World!');
      expect(result).toEqual({ id: 'message-123' });
    });

    it('should handle channel fetch errors', async () => {
      mockClient.channels.fetch.mockRejectedValue(new Error('Channel not found'));

      await expect(discordService.sendMessage('invalid-channel', 'Test')).rejects.toThrow('Channel not found');
    });

    it('should handle non-text channels', async () => {
      mockChannel.isTextBased.mockReturnValue(false);

      await expect(discordService.sendMessage('channel-123', 'Test')).rejects.toThrow(
        'Channel channel-123 is not a valid text channel'
      );
    });

    it('should handle null channel response', async () => {
      mockClient.channels.fetch.mockResolvedValue(null);

      await expect(discordService.sendMessage('channel-123', 'Test')).rejects.toThrow(
        'Channel channel-123 is not a valid text channel'
      );
    });

    it('should handle message send errors', async () => {
      const sendError = new Error('Missing permissions');
      mockChannel.send.mockRejectedValue(sendError);

      await expect(discordService.sendMessage('channel-123', 'Test')).rejects.toThrow('Missing permissions');
    });
  });

  describe('channel operations', () => {
    it('should fetch channel successfully', async () => {
      const result = await discordService.fetchChannel('channel-123');

      expect(mockClient.channels.fetch).toHaveBeenCalledWith('channel-123');
      expect(result).toBe(mockChannel);
    });

    it('should handle channel fetch errors', async () => {
      const fetchError = new Error('Unknown channel');
      mockClient.channels.fetch.mockRejectedValue(fetchError);

      await expect(discordService.fetchChannel('invalid-channel')).rejects.toThrow('Unknown channel');
    });
  });

  describe('guild operations', () => {
    it('should fetch guild successfully', async () => {
      const result = await discordService.fetchGuild('guild-123');

      expect(mockClient.guilds.fetch).toHaveBeenCalledWith('guild-123');
      expect(result).toBe(mockGuild);
    });

    it('should handle guild fetch errors', async () => {
      const fetchError = new Error('Unknown guild');
      mockClient.guilds.fetch.mockRejectedValue(fetchError);

      await expect(discordService.fetchGuild('invalid-guild')).rejects.toThrow('Unknown guild');
    });
  });

  describe('event handling', () => {
    it('should register message handler', () => {
      const mockHandler = jest.fn();

      discordService.onMessage(mockHandler);

      expect(mockClient.on).toHaveBeenCalledWith('messageCreate', expect.any(Function));
    });

    it('should register ready handler', () => {
      const mockHandler = jest.fn();

      discordService.onReady(mockHandler);

      expect(mockClient.on).toHaveBeenCalledWith('ready', expect.any(Function));
    });

    it('should register error handler', () => {
      const mockHandler = jest.fn();

      discordService.onError(mockHandler);

      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should handle message events with error handling', () => {
      const mockHandler = jest.fn(() => {
        throw new Error('Simulated handler error');
      });

      discordService.onMessage(mockHandler);

      // Get the wrapped handler that was registered
      const wrappedHandler = mockClient.on.mock.calls.find(call => call[0] === 'messageCreate')[1];
      const messageContent = 'test message';

      // Call the wrapped handler with a non-bot message
      const testMessage = {
        content: messageContent,
        channelId: 'test-channel',
        author: { id: 'test-user', bot: false }, // Important: set bot: false to pass the filter
      };
      wrappedHandler(testMessage);

      // Assert that the handler was called, and check that no error was thrown
      expect(mockHandler).toHaveBeenCalledWith(testMessage);

      // Assert that the logger was called with the correct error information
      expect(mockLogger.error).toHaveBeenCalledWith('Error in message handler:', {
        error: 'Simulated handler error',
        messageContent,
        channelId: 'test-channel',
        userId: 'test-user',
        stack: expect.any(String), // Expect a stack trace
      });
    });
  });

  describe('bulk operations', () => {
    it('should handle multiple messages sequentially', async () => {
      const messages = ['Message 1', 'Message 2', 'Message 3'];

      const results = await Promise.all(messages.map(msg => discordService.sendMessage('channel-123', msg)));

      expect(results).toHaveLength(3);
      expect(mockChannel.send).toHaveBeenCalledTimes(3);
      expect(mockChannel.send).toHaveBeenNthCalledWith(1, 'Message 1');
      expect(mockChannel.send).toHaveBeenNthCalledWith(2, 'Message 2');
      expect(mockChannel.send).toHaveBeenNthCalledWith(3, 'Message 3');
    });

    it('should handle partial failures in bulk operations', async () => {
      mockChannel.send
        .mockResolvedValueOnce({ id: 'msg-1' })
        .mockRejectedValueOnce(new Error('Rate limited'))
        .mockResolvedValueOnce({ id: 'msg-3' });

      const promises = [
        discordService.sendMessage('channel-123', 'Success 1'),
        discordService.sendMessage('channel-123', 'Fail'),
        discordService.sendMessage('channel-123', 'Success 2'),
      ];

      const results = await Promise.allSettled(promises);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('fulfilled');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle malformed message content', async () => {
      await expect(discordService.sendMessage('channel-123', null)).resolves.toEqual({ id: 'message-123' });

      expect(mockChannel.send).toHaveBeenCalledWith(null);
    });

    it('should handle very long channel IDs', async () => {
      const longChannelId = '1'.repeat(100);

      await discordService.sendMessage(longChannelId, 'Test');

      expect(mockClient.channels.fetch).toHaveBeenCalledWith(longChannelId);
    });

    it('should handle concurrent requests to same channel', async () => {
      const promises = Array.from({ length: 10 }, (_, i) => discordService.sendMessage('channel-123', `Message ${i}`));

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      expect(mockClient.channels.fetch).toHaveBeenCalledTimes(10);
      expect(mockChannel.send).toHaveBeenCalledTimes(10);
    });
  });

  describe('service state management', () => {
    it('should maintain event handler references', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      discordService.onMessage(handler1);
      discordService.onMessage(handler2);

      expect(discordService.eventHandlers).toBeDefined();
      expect(mockClient.on).toHaveBeenCalledTimes(2);
    });
  });
});
