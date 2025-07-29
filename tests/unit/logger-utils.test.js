import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { DiscordTransport, LoggerUtils, SystemdSafeConsoleTransport } from '../../src/logger-utils.js';

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
      // Clear the timer first to prevent issues
      if (transport.flushTimer) {
        clearInterval(transport.flushTimer);
        transport.flushTimer = null;
      }
      transport.close();
      jest.clearAllMocks();
      // Reset the mock channel send function to resolve
      mockChannel.send.mockReset().mockResolvedValue(true);
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

      // In test environment, console.error should NOT be called for flush errors
      // The error logging is suppressed to prevent noise in test output
      const discordTransportErrorCalls = consoleSpy.mock.calls.filter(call =>
        call.some(
          arg => typeof arg === 'string' && arg.includes('[DiscordTransport] Failed to flush log buffer to Discord:')
        )
      );
      expect(discordTransportErrorCalls).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it('should not flush when destroyed', async () => {
      transport.isDestroyed = true;
      transport.buffer = ['Test message'];

      await transport.flush();
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it('should send initialization message when channel is ready', async () => {
      jest.useFakeTimers();

      // Mock the messageSender to track queueMessage calls
      const mockMessageSender = {
        queueMessage: jest.fn().mockResolvedValue(true),
        getMetrics: jest.fn().mockReturnValue({ queued: 0, sent: 0, failed: 0 }),
        shutdown: jest.fn().mockResolvedValue(),
      };
      transport.messageSender = mockMessageSender;

      const callback = jest.fn();

      await transport.log({ level: 'info', message: 'First message' }, callback);

      // Fast-forward past the 2-second delay
      jest.advanceTimersByTime(2000);

      // Wait for any pending promises
      await new Promise(resolve => setImmediate(resolve));

      expect(mockMessageSender.queueMessage).toHaveBeenCalledWith(
        mockChannel,
        '✅ **Winston logging transport initialized for this channel.**',
        { priority: -1 }
      );

      jest.useRealTimers();
    });

    it('should handle periodic flushing', async () => {
      // Manually start flushing since it's disabled in test environment
      transport.startFlushing();

      const callback = jest.fn();
      await transport.log({ level: 'info', message: 'Periodic test' }, callback);

      // Wait for periodic flush (flushInterval is 100ms in test setup)
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(mockChannel.send).toHaveBeenCalled();

      // Clear the timer to prevent interference with other tests
      if (transport.flushTimer) {
        clearInterval(transport.flushTimer);
        transport.flushTimer = null;
      }
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

    describe('createSystemdSafeConsoleTransport', () => {
      it('should create SystemdSafeConsoleTransport instance', () => {
        const transport = LoggerUtils.createSystemdSafeConsoleTransport();
        expect(transport).toBeInstanceOf(SystemdSafeConsoleTransport);
        expect(transport.level).toBe('info');
      });

      it('should create transport with custom options', () => {
        const options = { level: 'debug' };
        const transport = LoggerUtils.createSystemdSafeConsoleTransport(options);
        expect(transport).toBeInstanceOf(SystemdSafeConsoleTransport);
        expect(transport.level).toBe('debug');
      });
    });
  });

  describe('SystemdSafeConsoleTransport', () => {
    let transport;
    let mockCallback;

    beforeEach(() => {
      transport = new SystemdSafeConsoleTransport({ level: 'info' });
      mockCallback = jest.fn();
    });

    describe('log method', () => {
      it('should call parent log method normally', () => {
        const logInfo = { level: 'info', message: 'Test message' };

        // Mock the parent log method
        const parentLogSpy = jest
          .spyOn(Object.getPrototypeOf(SystemdSafeConsoleTransport.prototype), 'log')
          .mockImplementation((info, callback) => {
            callback();
            return true;
          });

        const result = transport.log(logInfo, mockCallback);

        expect(parentLogSpy).toHaveBeenCalledWith(logInfo, mockCallback);
        expect(result).toBe(true);

        parentLogSpy.mockRestore();
      });

      it('should skip logging when silenced', async () => {
        transport.silent = true;
        const logInfo = { level: 'info', message: 'Test message' };

        const parentLogSpy = jest.spyOn(Object.getPrototypeOf(SystemdSafeConsoleTransport.prototype), 'log');

        const result = await new Promise(resolve => {
          const logResult = transport.log(logInfo, () => {
            expect(parentLogSpy).not.toHaveBeenCalled();
            resolve(logResult);
          });
        });

        expect(result).toBe(true);
        parentLogSpy.mockRestore();
      });

      it('should handle EPIPE errors gracefully', async () => {
        const logInfo = { level: 'info', message: 'Test message' };

        // Mock parent log to throw EPIPE error
        const epipeError = new Error('write EPIPE');
        epipeError.code = 'EPIPE';

        const parentLogSpy = jest
          .spyOn(Object.getPrototypeOf(SystemdSafeConsoleTransport.prototype), 'log')
          .mockImplementation(() => {
            throw epipeError;
          });

        const result = await new Promise(resolve => {
          const logResult = transport.log(logInfo, () => {
            expect(transport.silent).toBe(true);
            resolve(logResult);
          });
        });

        expect(result).toBe(true);
        parentLogSpy.mockRestore();
      });

      it('should re-throw non-write errors', () => {
        const logInfo = { level: 'info', message: 'Test message' };
        const otherError = new Error('Some other error');

        const parentLogSpy = jest
          .spyOn(Object.getPrototypeOf(SystemdSafeConsoleTransport.prototype), 'log')
          .mockImplementation(() => {
            throw otherError;
          });

        expect(() => {
          transport.log(logInfo, mockCallback);
        }).toThrow('Some other error');

        parentLogSpy.mockRestore();
      });
    });

    describe('write method', () => {
      it('should call parent write method normally', () => {
        const parentWriteSpy = jest
          .spyOn(Object.getPrototypeOf(SystemdSafeConsoleTransport.prototype), 'write')
          .mockReturnValue(true);

        const result = transport.write('test chunk', 'utf8');

        expect(parentWriteSpy).toHaveBeenCalledWith('test chunk', 'utf8');
        expect(result).toBe(true);

        parentWriteSpy.mockRestore();
      });

      it('should handle write errors gracefully', () => {
        const writeError = new Error('write EPIPE');
        writeError.code = 'EPIPE';

        const parentWriteSpy = jest
          .spyOn(Object.getPrototypeOf(SystemdSafeConsoleTransport.prototype), 'write')
          .mockImplementation(() => {
            throw writeError;
          });

        const result = transport.write('test chunk', 'utf8');

        expect(transport.silent).toBe(true);
        expect(result).toBe(true);

        parentWriteSpy.mockRestore();
      });
    });

    describe('isWriteError method', () => {
      it('should identify EPIPE errors', () => {
        const epipeError = new Error('write EPIPE');
        epipeError.code = 'EPIPE';
        expect(transport.isWriteError(epipeError)).toBe(true);
      });

      it('should identify ECONNRESET errors', () => {
        const connResetError = new Error('Connection reset');
        connResetError.code = 'ECONNRESET';
        expect(transport.isWriteError(connResetError)).toBe(true);
      });

      it('should identify EPIPE in error message', () => {
        const epipeMessageError = new Error('write EPIPE broken pipe');
        expect(transport.isWriteError(epipeMessageError)).toBe(true);
      });

      it('should not identify non-write errors', () => {
        const otherError = new Error('Some other error');
        otherError.code = 'EOTHER';
        expect(transport.isWriteError(otherError)).toBe(false);
      });

      it('should handle null/undefined errors', () => {
        expect(transport.isWriteError(null)).toBe(false);
        expect(transport.isWriteError(undefined)).toBe(false);
      });
    });
  });
});
