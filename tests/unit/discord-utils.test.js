import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { splitMessage, DiscordManager, createDiscordManager } from '../../src/discord-utils.js';

describe('Discord Utils Tests', () => {
  describe('splitMessage', () => {
    it('should return single message if under limit', () => {
      const message = 'Short message';
      const result = splitMessage(message);
      expect(result).toEqual(['Short message']);
    });

    it('should split message at line breaks', () => {
      const message = 'Line 1\nLine 2\nLine 3';
      const result = splitMessage(message, { maxLength: 10 });
      expect(result.length).toBeGreaterThan(1);
      expect(result[0]).toBe('Line 1');
    });

    it('should handle very long lines by breaking them', () => {
      const longLine = 'a'.repeat(100);
      const result = splitMessage(longLine, { maxLength: 50 });
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('a'.repeat(50));
      expect(result[1]).toBe('a'.repeat(50));
    });

    it('should handle empty input', () => {
      const result = splitMessage('');
      expect(result).toEqual(['']);
    });

    it('should respect default maxLength of 2000', () => {
      const message = 'x'.repeat(1500);
      const result = splitMessage(message);
      expect(result).toEqual([message]);
    });

    it('should handle mixed content with line breaks and long lines', () => {
      const message = `Short line\n${'a'.repeat(100)}\nAnother short line`;
      const result = splitMessage(message, { maxLength: 50 });
      expect(result.length).toBeGreaterThan(2);
      expect(result[0]).toBe('Short line');
      expect(result[result.length - 1]).toBe('Another short line');
    });
  });

  describe('DiscordManager', () => {
    let mockClient;
    let mockLogger;
    let mockChannel;
    let mockSupportChannel;
    let discordManager;

    beforeEach(() => {
      mockChannel = {
        id: 'channel123',
        name: 'test-channel',
        send: jest.fn().mockResolvedValue(true),
        isTextBased: jest.fn().mockReturnValue(true),
      };

      mockSupportChannel = {
        id: 'support123',
        name: 'support-channel',
        send: jest.fn().mockResolvedValue(true),
        isTextBased: jest.fn().mockReturnValue(true),
      };

      mockClient = {
        channels: {
          fetch: jest.fn().mockImplementation(id => {
            if (id === 'support123') {
              return Promise.resolve(mockSupportChannel);
            }
            return Promise.resolve(mockChannel);
          }),
        },
      };

      mockLogger = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      discordManager = new DiscordManager(mockClient, mockLogger, {
        isPostingEnabled: true,
        mirrorMessage: true,
        supportChannelId: 'support123',
      });
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should send message when posting is enabled', async () => {
      await discordManager.sendMirroredMessage(mockChannel, 'Test message');
      expect(mockChannel.send).toHaveBeenCalledWith('Test message');
    });

    it('should not send message when posting is disabled', async () => {
      discordManager.setPostingEnabled(false);
      await discordManager.sendMirroredMessage(mockChannel, 'Test message');
      expect(mockChannel.send).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Posting is disabled. Skipping message to test-channel.');
    });

    it('should mirror message to support channel when enabled', async () => {
      await discordManager.sendMirroredMessage(mockChannel, 'Test message');
      expect(mockSupportChannel.send).toHaveBeenCalledWith(expect.stringContaining('[Bot message from #test-channel]'));
    });

    it('should not mirror message when disabled', async () => {
      discordManager.setMirrorMessage(false);
      await discordManager.sendMirroredMessage(mockChannel, 'Test message');
      expect(mockSupportChannel.send).not.toHaveBeenCalled();
    });

    it('should handle support channel fetch errors', async () => {
      mockClient.channels.fetch.mockRejectedValue(new Error('Channel not found'));
      await discordManager.sendMirroredMessage(mockChannel, 'Test message');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send mirrored message:', expect.any(Error));
    });

    it('should update posting enabled state', () => {
      expect(discordManager.isPostingEnabled).toBe(true);
      discordManager.setPostingEnabled(false);
      expect(discordManager.isPostingEnabled).toBe(false);
    });

    it('should update mirror message state', () => {
      expect(discordManager.mirrorMessage).toBe(true);
      discordManager.setMirrorMessage(false);
      expect(discordManager.mirrorMessage).toBe(false);
    });

    it('should not mirror to same channel', async () => {
      const supportChannel = { ...mockChannel, id: 'support123' };
      await discordManager.sendMirroredMessage(supportChannel, 'Test message');
      expect(mockClient.channels.fetch).not.toHaveBeenCalled();
    });

    it('should handle long messages in mirror', async () => {
      const longMessage = 'x'.repeat(3000);
      await discordManager.sendMirroredMessage(mockChannel, longMessage);
      expect(mockSupportChannel.send).toHaveBeenCalledTimes(3); // Split into multiple parts (including prefix)
    });
  });

  describe('createDiscordManager', () => {
    it('should create DiscordManager instance', () => {
      const mockClient = {};
      const mockLogger = {};
      const config = { isPostingEnabled: true };

      const manager = createDiscordManager(mockClient, mockLogger, config);
      expect(manager).toBeInstanceOf(DiscordManager);
      expect(manager.client).toBe(mockClient);
      expect(manager.logger).toBe(mockLogger);
      expect(manager.isPostingEnabled).toBe(true);
    });

    it('should create DiscordManager with default config', () => {
      const mockClient = {};
      const mockLogger = {};

      const manager = createDiscordManager(mockClient, mockLogger);
      expect(manager).toBeInstanceOf(DiscordManager);
      expect(manager.isPostingEnabled).toBe(false);
    });
  });
});
