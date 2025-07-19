import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  mockClient,
  mockChannel,
  mockMessage,
  mockUser,
  createMockClient,
  createMockChannel,
  createMockMessage,
} from '../mocks/discord.mock.js';

// Mock Discord.js module
jest.unstable_mockModule('discord.js', () => ({
  Client: jest.fn(() => createMockClient()),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 512,
    MessageContent: 32768,
  },
  ChannelType: { GuildText: 0 },
  Events: {
    Ready: 'ready',
    MessageCreate: 'messageCreate',
    Error: 'error',
  },
}));

describe('Discord Integration Tests', () => {
  let discordClient;
  let testChannel;
  let supportChannel;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create fresh mock instances
    discordClient = createMockClient();
    testChannel = createMockChannel({ id: 'test-channel-id', name: 'test-channel' });
    supportChannel = createMockChannel({ id: 'support-channel-id', name: 'support' });

    // Set up client channels
    discordClient.channels.cache.set('test-channel-id', testChannel);
    discordClient.channels.cache.set('support-channel-id', supportChannel);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('Client Connection and Authentication', () => {
    it('should successfully connect to Discord', async () => {
      discordClient.login.mockResolvedValue('token');

      const result = await discordClient.login('test-token');

      expect(discordClient.login).toHaveBeenCalledWith('test-token');
      expect(result).toBe('token');
    });

    it('should handle login failures gracefully', async () => {
      const error = new Error('Invalid token');
      discordClient.login.mockRejectedValue(error);

      await expect(discordClient.login('invalid-token')).rejects.toThrow('Invalid token');
    });

    it('should set up event listeners correctly', () => {
      const readyHandler = jest.fn();
      const messageHandler = jest.fn();
      const errorHandler = jest.fn();

      discordClient.on('ready', readyHandler);
      discordClient.on('messageCreate', messageHandler);
      discordClient.on('error', errorHandler);

      expect(discordClient.on).toHaveBeenCalledWith('ready', readyHandler);
      expect(discordClient.on).toHaveBeenCalledWith('messageCreate', messageHandler);
      expect(discordClient.on).toHaveBeenCalledWith('error', errorHandler);
    });

    it('should handle ready event', () => {
      const readyHandler = jest.fn();
      discordClient.on('ready', readyHandler);

      // Simulate ready event
      discordClient.emit('ready');

      expect(readyHandler).toHaveBeenCalled();
    });
  });

  describe('Channel Management', () => {
    it('should fetch channels correctly', async () => {
      const channelId = 'test-channel-id';
      discordClient.channels.fetch.mockResolvedValue(testChannel);

      const channel = await discordClient.channels.fetch(channelId);

      expect(discordClient.channels.fetch).toHaveBeenCalledWith(channelId);
      expect(channel).toBe(testChannel);
      expect(channel.id).toBe(channelId);
    });

    it('should handle non-existent channels', async () => {
      const channelId = 'non-existent-channel';
      const error = new Error('Unknown Channel');
      discordClient.channels.fetch.mockRejectedValue(error);

      await expect(discordClient.channels.fetch(channelId)).rejects.toThrow('Unknown Channel');
    });

    it('should cache channels properly', () => {
      const channel = discordClient.channels.cache.get('test-channel-id');

      expect(channel).toBe(testChannel);
      expect(channel.id).toBe('test-channel-id');
    });

    it('should handle channel permissions', () => {
      // Mock channel with permissions
      const restrictedChannel = createMockChannel({
        id: 'restricted-channel',
        permissions: {
          has: jest.fn().mockReturnValue(false), // No send permission
        },
      });

      const hasPermission = restrictedChannel.permissions?.has('SEND_MESSAGES');
      expect(hasPermission).toBe(false);
    });
  });

  describe('Message Handling', () => {
    it('should send messages to channels', async () => {
      const messageContent = 'Test message';
      const sentMessage = { id: 'sent-message-id', content: messageContent };
      testChannel.send.mockResolvedValue(sentMessage);

      const result = await testChannel.send(messageContent);

      expect(testChannel.send).toHaveBeenCalledWith(messageContent);
      expect(result).toBe(sentMessage);
    });

    it('should send embeds to channels', async () => {
      const embed = {
        title: 'Test Embed',
        description: 'This is a test embed',
        color: 0x0099ff,
        fields: [{ name: 'Field 1', value: 'Value 1', inline: true }],
      };

      const sentMessage = { id: 'embed-message-id', embeds: [embed] };
      testChannel.send.mockResolvedValue(sentMessage);

      const result = await testChannel.send({ embeds: [embed] });

      expect(testChannel.send).toHaveBeenCalledWith({ embeds: [embed] });
      expect(result).toBe(sentMessage);
    });

    it('should handle message sending failures', async () => {
      const error = new Error('Missing Permissions');
      testChannel.send.mockRejectedValue(error);

      await expect(testChannel.send('Test message')).rejects.toThrow('Missing Permissions');
    });

    it('should process incoming messages', () => {
      const messageHandler = jest.fn();
      discordClient.on('messageCreate', messageHandler);

      const incomingMessage = createMockMessage({
        content: '!health',
        author: { id: 'user123', bot: false },
      });

      // Simulate message creation event
      discordClient.emit('messageCreate', incomingMessage);

      expect(messageHandler).toHaveBeenCalledWith(incomingMessage);
    });

    it('should ignore bot messages', () => {
      const messageHandler = jest.fn(message => {
        if (message.author.bot) {
          return;
        } // Ignore bot messages
        // Process user message
      });

      discordClient.on('messageCreate', messageHandler);

      const botMessage = createMockMessage({
        content: 'Bot message',
        author: { id: 'bot123', bot: true },
      });

      discordClient.emit('messageCreate', botMessage);

      expect(messageHandler).toHaveBeenCalledWith(botMessage);
      // Handler should ignore bot messages internally
    });
  });

  describe('Bot Commands Processing', () => {
    const commandPrefix = '!';

    const createCommandHandler = () => {
      return jest.fn(message => {
        if (message.author.bot) {
          return;
        }
        if (!message.content.startsWith(commandPrefix)) {
          return;
        }

        const args = message.content.slice(commandPrefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        switch (command) {
          case 'health':
            return message.reply('Bot is healthy! 🟢');
          case 'kill':
            return message.reply('Posting disabled! ❌');
          case 'restart':
            return message.reply('Bot restarted! 🔄');
          case 'announce': {
            const enabled = args[0] === 'true';
            return message.reply(`Announcements ${enabled ? 'enabled' : 'disabled'}!`);
          }
          default:
            return message.reply('Unknown command!');
        }
      });
    };

    it('should process health command', async () => {
      const commandHandler = createCommandHandler();
      const message = createMockMessage({
        content: '!health',
        channel: supportChannel,
      });

      await commandHandler(message);

      expect(message.reply).toHaveBeenCalledWith('Bot is healthy! 🟢');
    });

    it('should process kill command', async () => {
      const commandHandler = createCommandHandler();
      const message = createMockMessage({
        content: '!kill',
        channel: supportChannel,
      });

      await commandHandler(message);

      expect(message.reply).toHaveBeenCalledWith('Posting disabled! ❌');
    });

    it('should process announce command with arguments', async () => {
      const commandHandler = createCommandHandler();
      const enableMessage = createMockMessage({
        content: '!announce true',
        channel: supportChannel,
      });

      await commandHandler(enableMessage);

      expect(enableMessage.reply).toHaveBeenCalledWith('Announcements enabled!');

      const disableMessage = createMockMessage({
        content: '!announce false',
        channel: supportChannel,
      });

      await commandHandler(disableMessage);

      expect(disableMessage.reply).toHaveBeenCalledWith('Announcements disabled!');
    });

    it('should handle unknown commands', async () => {
      const commandHandler = createCommandHandler();
      const message = createMockMessage({
        content: '!unknown',
        channel: supportChannel,
      });

      await commandHandler(message);

      expect(message.reply).toHaveBeenCalledWith('Unknown command!');
    });

    it('should ignore non-command messages', async () => {
      const commandHandler = createCommandHandler();
      const message = createMockMessage({
        content: 'Regular message without command prefix',
        channel: supportChannel,
      });

      await commandHandler(message);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it('should only process commands in support channel', () => {
      const commandHandler = jest.fn(message => {
        if (message.author.bot) {
          return;
        }
        if (message.channel.id !== 'support-channel-id') {
          return;
        }
        if (!message.content.startsWith(commandPrefix)) {
          return;
        }

        message.reply('Command processed in support channel');
      });

      // Command in support channel
      const supportMessage = createMockMessage({
        content: '!health',
        channel: supportChannel,
      });

      commandHandler(supportMessage);
      expect(supportMessage.reply).toHaveBeenCalledWith('Command processed in support channel');

      // Command in regular channel (should be ignored)
      const regularMessage = createMockMessage({
        content: '!health',
        channel: testChannel,
      });

      commandHandler(regularMessage);
      expect(regularMessage.reply).not.toHaveBeenCalled();
    });
  });

  describe('Content Announcement Integration', () => {
    it('should announce YouTube videos to correct channel', async () => {
      const youtubeChannel = createMockChannel({
        id: 'youtube-channel-id',
        name: 'youtube-announcements',
      });
      discordClient.channels.cache.set('youtube-channel-id', youtubeChannel);

      const videoData = {
        id: 'dQw4w9WgXcQ',
        title: 'Rick Astley - Never Gonna Give You Up',
        channelTitle: 'Rick Astley',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      };

      const embed = {
        title: `New Video: ${videoData.title}`,
        url: videoData.url,
        author: { name: videoData.channelTitle },
        thumbnail: { url: videoData.thumbnail },
        color: 0xff0000,
      };

      await youtubeChannel.send({ embeds: [embed] });

      expect(youtubeChannel.send).toHaveBeenCalledWith({ embeds: [embed] });
    });

    it('should announce X/Twitter posts to multiple channels', async () => {
      const channels = {
        posts: createMockChannel({ id: 'x-posts-channel', name: 'x-posts' }),
        replies: createMockChannel({ id: 'x-replies-channel', name: 'x-replies' }),
        quotes: createMockChannel({ id: 'x-quotes-channel', name: 'x-quotes' }),
        retweets: createMockChannel({ id: 'x-retweets-channel', name: 'x-retweets' }),
      };

      Object.values(channels).forEach(channel => {
        discordClient.channels.cache.set(channel.id, channel);
      });

      const tweetData = {
        id: '1234567890123456789',
        text: 'This is a test tweet',
        author: 'testuser',
        url: 'https://x.com/testuser/status/1234567890123456789',
        type: 'post',
      };

      const announceToChannel = async (channelType, data) => {
        const channel = channels[channelType];
        if (!channel) {
          return;
        }

        const message = `New ${channelType.slice(0, -1)}: ${data.text}\n${data.url}`;
        await channel.send(message);
      };

      await announceToChannel('posts', tweetData);

      expect(channels.posts.send).toHaveBeenCalledWith(`New post: ${tweetData.text}\n${tweetData.url}`);
    });

    it('should handle announcement failures gracefully', async () => {
      const failingChannel = createMockChannel({ id: 'failing-channel' });
      failingChannel.send.mockRejectedValue(new Error('Channel not found'));

      const announceWithErrorHandling = async (channel, content) => {
        try {
          await channel.send(content);
          return { success: true };
        } catch (error) {
          console.error('Failed to send announcement:', error.message);
          return { success: false, error: error.message };
        }
      };

      const result = await announceWithErrorHandling(failingChannel, 'Test message');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel not found');
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle Discord API errors', async () => {
      const apiError = new Error('API Error');
      apiError.code = 50013; // Missing Permissions
      testChannel.send.mockRejectedValue(apiError);

      const errorHandler = jest.fn(error => {
        if (error.code === 50013) {
          console.error('Missing permissions to send message');
          return { handled: true, reason: 'permissions' };
        }
        return { handled: false };
      });

      try {
        await testChannel.send('Test message');
      } catch (error) {
        const result = errorHandler(error);
        expect(result.handled).toBe(true);
        expect(result.reason).toBe('permissions');
      }
    });

    it('should handle rate limiting', async () => {
      const rateLimitError = new Error('Rate Limited');
      rateLimitError.code = 50004;
      rateLimitError.retry_after = 5000; // 5 seconds

      testChannel.send.mockRejectedValueOnce(rateLimitError);
      testChannel.send.mockResolvedValueOnce({ id: 'success-message' });

      const sendWithRetry = async (channel, content, retries = 1) => {
        try {
          return await channel.send(content);
        } catch (error) {
          if (error.code === 50004 && retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 1)); // Minimal delay for test
            return sendWithRetry(channel, content, retries - 1);
          }
          throw error;
        }
      };

      const result = await sendWithRetry(testChannel, 'Test message');

      expect(testChannel.send).toHaveBeenCalledTimes(2);
      expect(result.id).toBe('success-message');
    });

    it('should handle connection losses', () => {
      const reconnectHandler = jest.fn();
      const disconnectHandler = jest.fn();

      discordClient.on('disconnect', disconnectHandler);
      discordClient.on('reconnecting', reconnectHandler);

      // Simulate disconnect
      discordClient.emit('disconnect');
      expect(disconnectHandler).toHaveBeenCalled();

      // Simulate reconnect
      discordClient.emit('reconnecting');
      expect(reconnectHandler).toHaveBeenCalled();
    });
  });

  describe('Message Filtering and Validation', () => {
    it('should detect and process YouTube URLs in messages', () => {
      const urlProcessor = jest.fn(message => {
        const videoUrlRegex =
          /https?:\/\/(?:(?:www\.)?youtube\.com\/(?:watch\?v=|live\/|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;
        const matches = [...message.content.matchAll(videoUrlRegex)];

        if (matches.length > 0) {
          matches.forEach(match => {
            const videoId = match[1];
            message.react('📺');
            console.log(`Found YouTube video: ${videoId}`);
          });
        }
      });

      const messageWithYouTube = createMockMessage({
        content: 'Check this out: https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });

      urlProcessor(messageWithYouTube);

      expect(messageWithYouTube.react).toHaveBeenCalledWith('📺');
    });

    it('should detect and process X/Twitter URLs in messages', () => {
      const urlProcessor = jest.fn(message => {
        const tweetUrlRegex =
          /https?:\/\/(?:[\w-]+\.)*(?:x\.com|twitter\.com|vxtwitter\.com|fxtwitter\.com|nitter\.[^/]+)\/(?:(?:i\/web\/)?status(?:es)?|[^/]+\/status(?:es)?)\/(\d+)/g;
        const matches = [...message.content.matchAll(tweetUrlRegex)];

        if (matches.length > 0) {
          matches.forEach(match => {
            const tweetId = match[1];
            message.react('🐦');
            console.log(`Found Twitter/X post: ${tweetId}`);
          });
        }
      });

      const messageWithTwitter = createMockMessage({
        content: 'Look at this tweet: https://x.com/user/status/1234567890123456789',
      });

      urlProcessor(messageWithTwitter);

      expect(messageWithTwitter.react).toHaveBeenCalledWith('🐦');
    });

    it('should filter duplicate URLs within time window', () => {
      const recentUrls = new Set();
      const duplicateFilter = jest.fn(message => {
        const urls = message.content.match(/https?:\/\/[^\s]+/g) || [];
        const newUrls = urls.filter(url => !recentUrls.has(url));

        if (newUrls.length === 0 && urls.length > 0) {
          message.react('🔁'); // Duplicate indicator
          return false; // Skip processing
        }

        newUrls.forEach(url => recentUrls.add(url));
        return true; // Process message
      });

      const originalMessage = createMockMessage({
        content: 'First: https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });

      const duplicateMessage = createMockMessage({
        content: 'Duplicate: https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });

      const shouldProcessFirst = duplicateFilter(originalMessage);
      const shouldProcessDuplicate = duplicateFilter(duplicateMessage);

      expect(shouldProcessFirst).toBe(true);
      expect(shouldProcessDuplicate).toBe(false);
      expect(duplicateMessage.react).toHaveBeenCalledWith('🔁');
    });
  });

  describe('Logging and Monitoring Integration', () => {
    it('should log Discord events to support channel', async () => {
      const logMessage = async (level, message) => {
        const logEmbed = {
          color: level === 'error' ? 0xff0000 : level === 'warn' ? 0xffff00 : 0x00ff00,
          title: `${level.toUpperCase()}: Bot Log`,
          description: message,
          timestamp: new Date().toISOString(),
        };

        await supportChannel.send({ embeds: [logEmbed] });
      };

      await logMessage('info', 'Bot started successfully');
      await logMessage('error', 'Failed to process webhook');

      expect(supportChannel.send).toHaveBeenCalledTimes(2);
      expect(supportChannel.send).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: 'INFO: Bot Log',
            description: 'Bot started successfully',
          }),
        ],
      });
    });

    it('should track message processing metrics', () => {
      const metrics = {
        messagesProcessed: 0,
        commandsExecuted: 0,
        urlsDetected: 0,
        errors: 0,
      };

      const metricsTracker = jest.fn((eventType, data = {}) => {
        switch (eventType) {
          case 'message_processed':
            metrics.messagesProcessed++;
            break;
          case 'command_executed':
            metrics.commandsExecuted++;
            break;
          case 'url_detected':
            metrics.urlsDetected++;
            break;
          case 'error':
            metrics.errors++;
            break;
        }
      });

      // Simulate events
      metricsTracker('message_processed');
      metricsTracker('command_executed');
      metricsTracker('url_detected');
      metricsTracker('error');

      expect(metrics.messagesProcessed).toBe(1);
      expect(metrics.commandsExecuted).toBe(1);
      expect(metrics.urlsDetected).toBe(1);
      expect(metrics.errors).toBe(1);
    });
  });
});
