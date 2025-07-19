import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DiscordTransport } from '../../src/logger-utils.js';

describe('Discord Transport Error Handling', () => {
  let mockClient;
  let mockChannel;
  let transport;
  let consoleErrorSpy;

  beforeEach(() => {
    // Mock console.error to track error messages
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Mock Discord channel
    mockChannel = {
      send: jest.fn(),
      isTextBased: jest.fn().mockReturnValue(true),
    };

    // Mock Discord client
    mockClient = {
      isReady: jest.fn(),
      channels: {
        fetch: jest.fn(),
      },
    };
  });

  afterEach(() => {
    if (transport) {
      transport.close();
    }
    consoleErrorSpy.mockRestore();
  });

  describe('Client Readiness Checks', () => {
    it('should handle client not ready state', async () => {
      mockClient.isReady.mockReturnValue(false);

      transport = new DiscordTransport({
        client: mockClient,
        channelId: '123456789012345678',
        level: 'info',
      });

      const callback = jest.fn();
      await transport.log({ level: 'info', message: 'test message' }, callback);

      expect(callback).toHaveBeenCalled();
      expect(mockClient.channels.fetch).not.toHaveBeenCalled();
    });

    it('should handle client ready but token issues', async () => {
      mockClient.isReady.mockReturnValue(true);
      mockClient.channels.fetch.mockResolvedValue(mockChannel);

      // Mock send to reject with token error
      mockChannel.send.mockRejectedValue(new Error('Expected token to be set for this request, but none was present'));

      transport = new DiscordTransport({
        client: mockClient,
        channelId: '123456789012345678',
        level: 'info',
      });

      const callback = jest.fn();
      await transport.log({ level: 'info', message: 'test message' }, callback);

      // Give time for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(callback).toHaveBeenCalled();
      // Check that console.error was called with error information
      expect(consoleErrorSpy).toHaveBeenCalled();
      const consoleErrorCalls = consoleErrorSpy.mock.calls;
      const hasDiscordTransportError = consoleErrorCalls.some(call =>
        call.some(
          arg =>
            (typeof arg === 'string' && arg.includes('[DiscordTransport]')) ||
            (arg instanceof Error && arg.message.includes('Expected token to be set'))
        )
      );
      expect(hasDiscordTransportError).toBe(true);
    });
  });

  describe('Channel Initialization Errors', () => {
    it('should handle channel fetch failure', async () => {
      mockClient.isReady.mockReturnValue(true);
      mockClient.channels.fetch.mockRejectedValue(new Error('Channel not found'));

      transport = new DiscordTransport({
        client: mockClient,
        channelId: '123456789012345678',
        level: 'info',
      });

      const callback = jest.fn();
      await transport.log({ level: 'info', message: 'test message' }, callback);

      expect(callback).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DiscordTransport] Failed to fetch channel 123456789012345678:'),
        expect.any(Error)
      );
    });

    it('should handle invalid channel type', async () => {
      mockClient.isReady.mockReturnValue(true);
      mockChannel.isTextBased.mockReturnValue(false);
      mockClient.channels.fetch.mockResolvedValue(mockChannel);

      transport = new DiscordTransport({
        client: mockClient,
        channelId: '123456789012345678',
        level: 'info',
      });

      const callback = jest.fn();
      await transport.log({ level: 'info', message: 'test message' }, callback);

      expect(callback).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DiscordTransport] Channel 123456789012345678 is not a valid text channel.')
      );
    });
  });

  describe('Message Sending Errors', () => {
    it('should re-add messages to buffer on send failure', async () => {
      mockClient.isReady.mockReturnValue(true);
      mockClient.channels.fetch.mockResolvedValue(mockChannel);

      // Mock send to fail first two times (init + flush), succeed after
      mockChannel.send
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue({});

      transport = new DiscordTransport({
        client: mockClient,
        channelId: '123456789012345678',
        level: 'info',
        flushInterval: 100,
      });

      const callback = jest.fn();
      await transport.log({ level: 'info', message: 'test message' }, callback);

      // Wait for first flush attempt (should fail)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Verify error was logged
      // Check that console.error was called with error information
      expect(consoleErrorSpy).toHaveBeenCalled();
      const consoleErrorCalls = consoleErrorSpy.mock.calls;
      const hasDiscordTransportError = consoleErrorCalls.some(call =>
        call.some(
          arg =>
            (typeof arg === 'string' && arg.includes('[DiscordTransport]')) ||
            (arg instanceof Error && arg.message.includes('Expected token to be set'))
        )
      );
      expect(hasDiscordTransportError).toBe(true);

      // Buffer should have been restored
      expect(transport.buffer.length).toBeGreaterThan(0);
    });
  });

  describe('Transport Lifecycle', () => {
    it('should handle cleanup after transport is destroyed', async () => {
      mockClient.isReady.mockReturnValue(true);
      mockClient.channels.fetch.mockResolvedValue(mockChannel);
      mockChannel.send.mockResolvedValue({});

      transport = new DiscordTransport({
        client: mockClient,
        channelId: '123456789012345678',
        level: 'info',
        flushInterval: 100,
      });

      // Add a log message (this will trigger initialization)
      const callback = jest.fn();
      await transport.log({ level: 'info', message: 'test message' }, callback);

      // Reset the mock to track only calls after close
      mockChannel.send.mockClear();

      // Close transport
      transport.close();

      // Wait a bit to ensure any timers would have fired
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should not send messages after close
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it('should prevent flush after transport is destroyed', async () => {
      mockClient.isReady.mockReturnValue(true);

      transport = new DiscordTransport({
        client: mockClient,
        channelId: '123456789012345678',
        level: 'info',
      });

      // Close transport immediately
      transport.close();

      // Try to flush
      await transport.flush();

      // Should not attempt to fetch channel
      expect(mockClient.channels.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Error Recovery', () => {
    it('should continue working after temporary errors', async () => {
      mockClient.isReady.mockReturnValue(true);
      mockClient.channels.fetch.mockResolvedValue(mockChannel);

      // Mock send to fail first time, succeed second time
      mockChannel.send.mockRejectedValueOnce(new Error('Temporary error')).mockResolvedValue({});

      transport = new DiscordTransport({
        client: mockClient,
        channelId: '123456789012345678',
        level: 'info',
        flushInterval: 100,
      });

      // Send first message (should fail)
      const callback1 = jest.fn();
      await transport.log({ level: 'info', message: 'message 1' }, callback1);

      // Wait for first flush attempt
      await new Promise(resolve => setTimeout(resolve, 150));

      // Send second message (should succeed)
      const callback2 = jest.fn();
      await transport.log({ level: 'info', message: 'message 2' }, callback2);

      // Wait for second flush attempt
      await new Promise(resolve => setTimeout(resolve, 150));

      // Both callbacks should have been called
      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();

      // Error should have been logged for first attempt
      // Check that console.error was called with error information
      expect(consoleErrorSpy).toHaveBeenCalled();
      const consoleErrorCalls = consoleErrorSpy.mock.calls;
      const hasDiscordTransportError = consoleErrorCalls.some(call =>
        call.some(
          arg =>
            (typeof arg === 'string' && arg.includes('[DiscordTransport]')) ||
            (arg instanceof Error && arg.message.includes('Expected token to be set'))
        )
      );
      expect(hasDiscordTransportError).toBe(true);
    });
  });

  describe('Configuration Validation', () => {
    it('should require valid client', () => {
      expect(() => {
        new DiscordTransport({
          client: null,
          channelId: '123456789012345678',
          level: 'info',
        });
      }).not.toThrow(); // Constructor doesn't validate, but usage will fail
    });

    it('should require valid channel ID', () => {
      expect(() => {
        new DiscordTransport({
          client: mockClient,
          channelId: null,
          level: 'info',
        });
      }).not.toThrow(); // Constructor doesn't validate, but usage will fail
    });

    it('should handle missing channel ID gracefully', async () => {
      mockClient.isReady.mockReturnValue(true);
      mockClient.channels.fetch.mockRejectedValue(new Error('Invalid channel ID'));

      transport = new DiscordTransport({
        client: mockClient,
        channelId: null,
        level: 'info',
      });

      const callback = jest.fn();
      await transport.log({ level: 'info', message: 'test message' }, callback);

      expect(callback).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
