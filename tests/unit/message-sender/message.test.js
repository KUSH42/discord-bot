import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Message } from '../../../src/services/implementations/message-sender/message.js';
import { timestampUTC } from '../../../src/utilities/utc-time.js';

describe('Message', () => {
  let message;
  let mockChannel;
  let mockResolve;
  let mockReject;

  beforeEach(() => {
    mockChannel = {
      id: 'channel-123',
      send: jest.fn().mockResolvedValue({ id: 'msg-456' }),
    };
    mockResolve = jest.fn();
    mockReject = jest.fn();

    message = new Message({
      channel: mockChannel,
      content: 'Test message',
      resolve: mockResolve,
      reject: mockReject,
      priority: 5,
    });
  });

  describe('Initialization', () => {
    it('should initialize with provided options', () => {
      expect(message.channel).toBe(mockChannel);
      expect(message.content).toBe('Test message');
      expect(message.resolve).toBe(mockResolve);
      expect(message.reject).toBe(mockReject);
      expect(message.priority).toBe(5);
      expect(message.retryCount).toBe(0);
      expect(message.status).toBe('pending');
      expect(message.maxRetries).toBe(3);
    });

    it('should generate unique IDs', () => {
      const message1 = new Message({ channel: mockChannel, content: 'test1' });
      const message2 = new Message({ channel: mockChannel, content: 'test2' });

      expect(message1.id).toBeDefined();
      expect(message2.id).toBeDefined();
      expect(message1.id).not.toBe(message2.id);
      expect(message1.id).toMatch(/^msg_\d+_[a-z0-9]+$/);
    });

    it('should use defaults for missing options', () => {
      const simpleMessage = new Message({
        channel: mockChannel,
        content: 'test',
      });

      expect(simpleMessage.priority).toBe(0);
      expect(simpleMessage.retryCount).toBe(0);
      expect(simpleMessage.maxRetries).toBe(3);
      expect(simpleMessage.status).toBe('pending');
      expect(simpleMessage.attempts).toEqual([]);
    });
  });

  describe('Status Management', () => {
    it('should handle processing status', () => {
      message.markProcessing();

      expect(message.status).toBe('processing');
      expect(message.processingStarted).toBeDefined();
      expect(message.processingStarted).toBeGreaterThan(timestampUTC() - 1000);
    });

    it('should handle completion', () => {
      const result = { id: 'msg-789', content: 'Sent successfully' };

      message.markProcessing();
      message.markCompleted(result);

      expect(message.status).toBe('completed');
      expect(message.completedAt).toBeDefined();
      expect(message.result).toBe(result);
      expect(mockResolve).toHaveBeenCalledWith(result);
    });

    it('should handle failure', () => {
      const error = new Error('Send failed');

      message.markFailed(error);

      expect(message.status).toBe('failed');
      expect(message.failedAt).toBeDefined();
      expect(message.finalError).toBe(error);
      expect(message.attempts).toHaveLength(1);
      expect(message.attempts[0].final).toBe(true);
      expect(mockReject).toHaveBeenCalledWith(error);
    });
  });

  describe('Retry Management', () => {
    it('should track retry eligibility', () => {
      expect(message.canRetry()).toBe(true);

      message.retryCount = 3; // At max retries
      expect(message.canRetry()).toBe(false);

      message.retryCount = 5; // Over max retries
      expect(message.canRetry()).toBe(false);
    });

    it('should record retry attempts', () => {
      const error1 = new Error('Network error');
      const error2 = new Error('Timeout');

      message.recordRetry(error1);
      expect(message.retryCount).toBe(1);
      expect(message.attempts).toHaveLength(1);
      expect(message.attempts[0].error).toBe('Network error');
      expect(message.attempts[0].retryCount).toBe(1);

      message.recordRetry(error2);
      expect(message.retryCount).toBe(2);
      expect(message.attempts).toHaveLength(2);
      expect(message.attempts[1].error).toBe('Timeout');
    });

    it('should respect custom max retries', () => {
      message = new Message({
        channel: mockChannel,
        content: 'test',
        maxRetries: 5,
      });

      expect(message.maxRetries).toBe(5);
      expect(message.canRetry()).toBe(true);

      message.retryCount = 5;
      expect(message.canRetry()).toBe(false);
    });
  });

  describe('Timing Methods', () => {
    it('should calculate message age', () => {
      const now = timestampUTC();
      message.createdAt = now - 5000; // 5 seconds ago

      const age = message.getAge();
      expect(age).toBeGreaterThanOrEqual(5000);
      expect(age).toBeLessThan(6000); // Allow some tolerance
    });

    it('should calculate processing time when completed', () => {
      message.markProcessing();
      const processingStart = message.processingStarted;

      // Simulate processing delay
      message.completedAt = processingStart + 1500;
      message.status = 'completed';

      const processingTime = message.getProcessingTime();
      expect(processingTime).toBe(1500);
    });

    it('should return null for processing time when not completed', () => {
      expect(message.getProcessingTime()).toBeNull();

      message.markProcessing();
      expect(message.getProcessingTime()).toBeNull();

      message.status = 'failed';
      expect(message.getProcessingTime()).toBeNull();
    });
  });

  describe('Serialization', () => {
    it('should convert to JSON with all relevant information', () => {
      message.markProcessing();
      message.recordRetry(new Error('Test error'));
      message.markCompleted({ id: 'msg-success' });

      const json = message.toJSON();

      expect(json).toMatchObject({
        id: message.id,
        status: 'completed',
        priority: 5,
        retryCount: 1,
        maxRetries: 3,
        createdAt: message.createdAt,
        age: expect.any(Number),
        processingTime: expect.any(Number),
        channelId: 'channel-123',
        contentType: 'string',
        contentLength: 12, // 'Test message'.length
        attempts: 1,
        hasOptions: false,
      });
    });

    it('should handle object content in JSON', () => {
      message = new Message({
        channel: mockChannel,
        content: { embeds: [{ title: 'Test' }] },
        options: { components: [] },
      });

      const json = message.toJSON();
      expect(json.contentType).toBe('object');
      expect(json.contentLength).toBe(0); // Objects don't have length
      expect(json.hasOptions).toBe(true);
    });
  });

  describe('Cloning', () => {
    it('should create identical clone', () => {
      const clone = message.clone();

      expect(clone.id).toBe(message.id);
      expect(clone.channel).toBe(message.channel);
      expect(clone.content).toBe(message.content);
      expect(clone.priority).toBe(message.priority);
      expect(clone.retryCount).toBe(message.retryCount);
      expect(clone.createdAt).toBe(message.createdAt);
      expect(clone).not.toBe(message); // Different instance
    });

    it('should apply overrides when cloning', () => {
      const clone = message.clone({
        priority: 10,
        retryCount: 2,
        maxRetries: 5,
      });

      expect(clone.priority).toBe(10);
      expect(clone.retryCount).toBe(2);
      expect(clone.maxRetries).toBe(5);

      // Original unchanged
      expect(message.priority).toBe(5);
      expect(message.retryCount).toBe(0);
      expect(message.maxRetries).toBe(3);
    });

    it('should clone options object separately', () => {
      message = new Message({
        channel: mockChannel,
        content: 'test',
        options: { components: ['button1'] },
      });

      const clone = message.clone();

      // Modify clone options
      clone.options.components.push('button2');

      // Original should be unchanged
      expect(message.options.components).toEqual(['button1']);
      expect(clone.options.components).toEqual(['button1', 'button2']);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing resolve/reject functions', () => {
      message = new Message({
        channel: mockChannel,
        content: 'test',
        // No resolve/reject provided
      });

      // Should not throw errors
      expect(() => {
        message.markCompleted({ id: 'success' });
      }).not.toThrow();

      expect(() => {
        message.markFailed(new Error('failed'));
      }).not.toThrow();
    });

    it('should handle empty content', () => {
      message = new Message({
        channel: mockChannel,
        content: '',
        priority: 0,
      });

      const json = message.toJSON();
      expect(json.contentLength).toBe(0);
      expect(json.contentType).toBe('string');
    });

    it('should handle null/undefined channel in JSON', () => {
      message = new Message({
        content: 'test without channel',
      });

      const json = message.toJSON();
      expect(json.channelId).toBeUndefined();
    });
  });
});
