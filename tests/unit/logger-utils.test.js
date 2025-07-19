import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { DiscordTransport, LoggerUtils } from '../../src/logger-utils.js';

describe('Logger Utils Tests', () => {
  describe('DiscordTransport', () => {
    let mockClient;
    let mockChannel;
    let transport;

    beforeEach(() => {
      mockChannel = {
        id: 'channel123',
        send: jest.fn().mockResolvedValue(true),
        isTextBased: jest.fn().mockReturnValue(true),
      };

      mockClient = {
        isReady: jest.fn().mockReturnValue(true),
        channels: {
          fetch: jest.fn().mockResolvedValue(mockChannel),
        },
      };

      transport = new DiscordTransport({
        client: mockClient,
        channelId: 'channel123',
        flushInterval: 100,
        maxBufferSize: 3,
      });
    });

    afterEach(() => {
      transport.close();
      jest.clearAllMocks();
    });

    it('should initialize transport with options', () => {
      expect(transport.client).toBe(mockClient);
      expect(transport.channelId).toBe('channel123');
      expect(transport.flushInterval).toBe(100);
      expect(transport.maxBufferSize).toBe(3);
    });

    it('should buffer log messages', async () => {
      const callback = jest.fn();
      const logInfo = { level: 'info', message: 'Test message' };

      await transport.log(logInfo, callback);
      expect(transport.buffer).toHaveLength(1);
      expect(callback).toHaveBeenCalled();
    });

    it('should flush when buffer reaches max size', async () => {
      const callback = jest.fn();

      // Fill buffer to max size
      for (let i = 0; i < 3; i++) {
        await transport.log({ level: 'info', message: `Message ${i}` }, callback);
      }

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockChannel.send).toHaveBeenCalled();
    });

    it('should handle channel fetch errors', async () => {
      mockClient.channels.fetch.mockRejectedValue(new Error('Channel not found'));
      const callback = jest.fn();

      await transport.log({ level: 'error', message: 'Test error' }, callback);
      expect(callback).toHaveBeenCalled();
    });

    it('should handle non-text channels', async () => {
      mockChannel.isTextBased.mockReturnValue(false);
      const callback = jest.fn();

      await transport.log({ level: 'info', message: 'Test message' }, callback);
      expect(transport.channel).toBe('errored');
    });

    it('should not log when client is not ready', async () => {
      mockClient.isReady.mockReturnValue(false);
      const callback = jest.fn();

      await transport.log({ level: 'info', message: 'Test message' }, callback);
      expect(callback).toHaveBeenCalled();
      expect(transport.buffer).toHaveLength(0);
    });

    it('should format log messages with stack traces', async () => {
      const callback = jest.fn();
      const logInfo = {
        level: 'error',
        message: 'Test error',
        stack: 'Error stack trace',
      };

      await transport.log(logInfo, callback);
      expect(transport.buffer[0]).toContain('**[ERROR]**: Test error');
      expect(transport.buffer[0]).toContain('Error stack trace');
    });

    it('should clean up properly on close', () => {
      const flushSpy = jest.spyOn(transport, 'flush');
      transport.close();

      expect(transport.isDestroyed).toBe(true);
      expect(transport.flushTimer).toBe(null);
      expect(flushSpy).toHaveBeenCalled();
    });

    it('should handle flush errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Set up channel first
      const callback = jest.fn();
      await transport.log({ level: 'info', message: 'Setup' }, callback);

      // Then make send fail
      mockChannel.send.mockRejectedValue(new Error('Send failed'));

      transport.buffer = ['Test message'];
      await transport.flush();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[DiscordTransport] Failed to flush log buffer to Discord:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should not flush when destroyed', async () => {
      transport.isDestroyed = true;
      transport.buffer = ['Test message'];

      await transport.flush();
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it('should send initialization message when channel is ready', async () => {
      const callback = jest.fn();

      await transport.log({ level: 'info', message: 'First message' }, callback);

      expect(mockChannel.send).toHaveBeenCalledWith('✅ **Winston logging transport initialized for this channel.**');
    });

    it('should handle periodic flushing', async () => {
      const callback = jest.fn();
      await transport.log({ level: 'info', message: 'Periodic test' }, callback);

      // Wait for periodic flush
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(mockChannel.send).toHaveBeenCalled();
    });
  });

  describe('LoggerUtils', () => {
    describe('createFileLogFormat', () => {
      it('should create file log format', () => {
        const format = LoggerUtils.createFileLogFormat();
        expect(format).toBeDefined();
        expect(typeof format.transform).toBe('function');
      });

      it('should format log messages correctly', () => {
        const format = LoggerUtils.createFileLogFormat();
        const logInfo = {
          level: 'info',
          message: 'Test message',
          timestamp: '2023-01-01T00:00:00.000Z',
        };

        const result = format.transform(logInfo);
        const message = result[Symbol.for('message')] || result.message;
        expect(message).toBe('[2023-01-01T00:00:00.000Z]  [INFO]: Test message');
      });

      it('should include stack traces in formatted messages', () => {
        const format = LoggerUtils.createFileLogFormat();
        const logInfo = {
          level: 'error',
          message: 'Test error',
          timestamp: '2023-01-01T00:00:00.000Z',
          stack: 'Error stack trace',
        };

        const result = format.transform(logInfo);
        const message = result[Symbol.for('message')] || result.message;
        expect(message).toContain('Test error');
        expect(message).toContain('Error stack trace');
      });
    });

    describe('createConsoleLogFormat', () => {
      it('should create console log format', () => {
        const format = LoggerUtils.createConsoleLogFormat();
        expect(format).toBeDefined();
        expect(typeof format.transform).toBe('function');
      });
    });

    describe('createDiscordTransport', () => {
      it('should create Discord transport instance', () => {
        const mockClient = {};
        const channelId = 'channel123';

        const transport = LoggerUtils.createDiscordTransport(mockClient, channelId);
        expect(transport).toBeInstanceOf(DiscordTransport);
        expect(transport.client).toBe(mockClient);
        expect(transport.channelId).toBe(channelId);

        // Clean up
        transport.close();
      });

      it('should create Discord transport with options', () => {
        const mockClient = {};
        const channelId = 'channel123';
        const options = { level: 'debug', maxBufferSize: 10 };

        const transport = LoggerUtils.createDiscordTransport(mockClient, channelId, options);
        expect(transport).toBeInstanceOf(DiscordTransport);
        expect(transport.maxBufferSize).toBe(10);

        // Clean up
        transport.close();
      });

      it('should use default options when not provided', () => {
        const mockClient = {};
        const channelId = 'channel123';

        const transport = LoggerUtils.createDiscordTransport(mockClient, channelId);
        expect(transport).toBeInstanceOf(DiscordTransport);

        // Clean up
        transport.close();
      });
    });
  });
});
