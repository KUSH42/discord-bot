import { describe, it, expect, beforeEach } from '@jest/globals';
import { MessageQueue } from '../../../src/services/implementations/message-sender/message-queue.js';
import { timestampUTC } from '../../../src/utilities/utc-time.js';

describe('MessageQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new MessageQueue();
  });

  describe('Basic Operations', () => {
    it('should initialize empty', () => {
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
      expect(queue.peek()).toBeNull();
    });

    it('should enqueue and dequeue messages', () => {
      const message = { id: '1', content: 'test', priority: 0, createdAt: timestampUTC() };

      queue.enqueue(message);
      expect(queue.size()).toBe(1);
      expect(queue.isEmpty()).toBe(false);
      expect(queue.peek()).toBe(message);

      const dequeued = queue.dequeue();
      expect(dequeued).toBe(message);
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });

    it('should handle multiple messages', () => {
      const messages = [
        { id: '1', content: 'first', priority: 0, createdAt: 1000 },
        { id: '2', content: 'second', priority: 0, createdAt: 2000 },
        { id: '3', content: 'third', priority: 0, createdAt: 3000 },
      ];

      messages.forEach(msg => queue.enqueue(msg));
      expect(queue.size()).toBe(3);

      // Should dequeue in order (oldest first for same priority)
      expect(queue.dequeue().id).toBe('1');
      expect(queue.dequeue().id).toBe('2');
      expect(queue.dequeue().id).toBe('3');
      expect(queue.isEmpty()).toBe(true);
    });
  });

  describe('Priority Handling', () => {
    it('should sort by priority (higher first)', () => {
      const messages = [
        { id: '1', priority: 1, createdAt: 1000 },
        { id: '2', priority: 5, createdAt: 2000 },
        { id: '3', priority: 3, createdAt: 3000 },
      ];

      messages.forEach(msg => queue.enqueue(msg));

      // Should dequeue in priority order: 5, 3, 1
      expect(queue.dequeue().id).toBe('2');
      expect(queue.dequeue().id).toBe('3');
      expect(queue.dequeue().id).toBe('1');
    });

    it('should use creation time as secondary sort', () => {
      const messages = [
        { id: '1', priority: 5, createdAt: 3000 },
        { id: '2', priority: 5, createdAt: 1000 },
        { id: '3', priority: 5, createdAt: 2000 },
      ];

      messages.forEach(msg => queue.enqueue(msg));

      // Same priority, should sort by creation time (oldest first)
      expect(queue.dequeue().id).toBe('2'); // createdAt: 1000
      expect(queue.dequeue().id).toBe('3'); // createdAt: 2000
      expect(queue.dequeue().id).toBe('1'); // createdAt: 3000
    });
  });

  describe('Queue Management', () => {
    it('should clear all messages', () => {
      const messages = [
        { id: '1', priority: 1, createdAt: 1000 },
        { id: '2', priority: 2, createdAt: 2000 },
      ];

      messages.forEach(msg => queue.enqueue(msg));
      expect(queue.size()).toBe(2);

      const cleared = queue.clear();
      expect(queue.size()).toBe(0);
      expect(cleared).toHaveLength(2);
      expect(cleared.map(m => m.id)).toEqual(['2', '1']); // Priority order
    });

    it('should convert to array', () => {
      const messages = [
        { id: '1', priority: 1, createdAt: 1000 },
        { id: '2', priority: 3, createdAt: 2000 },
      ];

      messages.forEach(msg => queue.enqueue(msg));

      const array = queue.toArray();
      expect(array).toHaveLength(2);
      expect(array[0].id).toBe('2'); // Higher priority first
      expect(array[1].id).toBe('1');
    });

    it('should find messages with predicate', () => {
      const messages = [
        { id: '1', priority: 1, type: 'normal' },
        { id: '2', priority: 2, type: 'urgent' },
        { id: '3', priority: 1, type: 'normal' },
      ];

      messages.forEach(msg => queue.enqueue(msg));

      const urgent = queue.find(msg => msg.type === 'urgent');
      expect(urgent).toHaveLength(1);
      expect(urgent[0].id).toBe('2');

      const normal = queue.find(msg => msg.type === 'normal');
      expect(normal).toHaveLength(2);
    });

    it('should remove messages with predicate', () => {
      const messages = [
        { id: '1', priority: 1, type: 'normal' },
        { id: '2', priority: 2, type: 'urgent' },
        { id: '3', priority: 1, type: 'normal' },
      ];

      messages.forEach(msg => queue.enqueue(msg));
      expect(queue.size()).toBe(3);

      const removed = queue.remove(msg => msg.type === 'normal');
      expect(removed).toHaveLength(2);
      expect(queue.size()).toBe(1);
      expect(queue.peek().type).toBe('urgent');
    });
  });

  describe('Queue Limits', () => {
    it('should respect max size', () => {
      queue = new MessageQueue({ maxSize: 2 });

      queue.enqueue({ id: '1', priority: 1 });
      queue.enqueue({ id: '2', priority: 2 });

      expect(() => {
        queue.enqueue({ id: '3', priority: 3 });
      }).toThrow('Queue is full (max size: 2)');
    });
  });

  describe('Statistics', () => {
    it('should provide empty stats for empty queue', () => {
      const stats = queue.getStats();
      expect(stats).toEqual({
        size: 0,
        highestPriority: null,
        lowestPriority: null,
        oldestMessage: null,
        newestMessage: null,
      });
    });

    it('should calculate stats correctly', () => {
      const messages = [
        { id: '1', priority: 1, createdAt: 1000 },
        { id: '2', priority: 5, createdAt: 3000 },
        { id: '3', priority: 3, createdAt: 2000 },
      ];

      messages.forEach(msg => queue.enqueue(msg));

      const stats = queue.getStats();
      expect(stats.size).toBe(3);
      expect(stats.highestPriority).toBe(5);
      expect(stats.lowestPriority).toBe(1);
      expect(stats.oldestMessage).toBe(1000);
      expect(stats.newestMessage).toBe(3000);
    });
  });

  describe('Custom Priority Comparator', () => {
    it('should use custom comparator', () => {
      // Custom comparator: reverse order (lower priority first)
      const customComparator = (a, b) => a.priority - b.priority;
      queue = new MessageQueue({ priorityComparator: customComparator });

      const messages = [
        { id: '1', priority: 5 },
        { id: '2', priority: 1 },
        { id: '3', priority: 3 },
      ];

      messages.forEach(msg => queue.enqueue(msg));

      // Should dequeue in ascending priority order: 1, 3, 5
      expect(queue.dequeue().id).toBe('2');
      expect(queue.dequeue().id).toBe('3');
      expect(queue.dequeue().id).toBe('1');
    });
  });
});
