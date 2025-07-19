import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  DuplicateDetector,
  videoUrlRegex,
  tweetUrlRegex,
  createDuplicateDetector,
} from '../../src/duplicate-detector.js';

describe('Duplicate Detection Logic Tests', () => {
  let knownVideoIds, knownTweetIds;
  let duplicateDetector;

  beforeEach(() => {
    knownVideoIds = new Set();
    knownTweetIds = new Set();
    duplicateDetector = new DuplicateDetector();
  });

  afterEach(() => {
    if (duplicateDetector) {
      duplicateDetector.destroy();
    }
  });

  describe('Set-based Duplicate Detection', () => {
    it('should detect YouTube duplicates correctly', () => {
      const videoId = 'dQw4w9WgXcQ';
      const urls = [
        `Check this out: https://www.youtube.com/watch?v=${videoId}`,
        `Short link: https://youtu.be/${videoId}`,
        `Shorts format: https://youtube.com/shorts/${videoId}`,
        `Embedded: https://www.youtube.com/embed/${videoId}`,
      ];

      let duplicateCount = 0;
      let uniqueCount = 0;

      urls.forEach(url => {
        const matches = [...url.matchAll(videoUrlRegex)];
        matches.forEach(match => {
          const extractedId = match[1];
          if (knownVideoIds.has(extractedId)) {
            duplicateCount++;
          } else {
            knownVideoIds.add(extractedId);
            uniqueCount++;
          }
        });
      });

      expect(uniqueCount).toBe(1);
      expect(duplicateCount).toBe(3);
      expect(knownVideoIds.size).toBe(1);
      expect(knownVideoIds.has(videoId)).toBe(true);
    });

    it('should detect Twitter duplicates correctly', () => {
      const tweetId = '1234567890123456789';
      const urls = [
        `Original: https://x.com/user/status/${tweetId}`,
        `Twitter: https://twitter.com/user/status/${tweetId}`,
        `VX: https://vxtwitter.com/user/status/${tweetId}`,
        `FX: https://fxtwitter.com/user/status/${tweetId}`,
      ];

      let duplicateCount = 0;
      let uniqueCount = 0;

      urls.forEach(url => {
        const matches = [...url.matchAll(tweetUrlRegex)];
        matches.forEach(match => {
          const extractedId = match[1];
          if (knownTweetIds.has(extractedId)) {
            duplicateCount++;
          } else {
            knownTweetIds.add(extractedId);
            uniqueCount++;
          }
        });
      });

      expect(uniqueCount).toBe(1);
      expect(duplicateCount).toBe(3);
      expect(knownTweetIds.size).toBe(1);
      expect(knownTweetIds.has(tweetId)).toBe(true);
    });

    it('should handle multiple unique IDs correctly', () => {
      const videoIds = ['dQw4w9WgXcQ', 'jNQXAC9IVRw', 'oHg5SJYRHA0'];
      const urls = videoIds.map(id => `https://youtu.be/${id}`);

      urls.forEach(url => {
        const matches = [...url.matchAll(videoUrlRegex)];
        matches.forEach(match => {
          knownVideoIds.add(match[1]);
        });
      });

      expect(knownVideoIds.size).toBe(3);
      videoIds.forEach(id => {
        expect(knownVideoIds.has(id)).toBe(true);
      });
    });
  });

  describe('Original Bug Demonstration', () => {
    it('should demonstrate the original Twitter bug with match[2]', () => {
      const buggyKnownIds = new Set();
      const correctKnownIds = new Set();

      const testUrls = [
        'First: https://x.com/user/status/1111111111',
        'Second: https://x.com/user/status/2222222222',
        'Third: https://x.com/user/status/3333333333',
      ];

      testUrls.forEach(url => {
        const matches = [...url.matchAll(tweetUrlRegex)];
        matches.forEach(match => {
          // Original buggy behavior (using match[2])
          const buggyId = match[2]; // undefined
          buggyKnownIds.add(buggyId);

          // Correct behavior (using match[1])
          const correctId = match[1]; // actual tweet ID
          correctKnownIds.add(correctId);
        });
      });

      // Buggy behavior: all undefined values collapse to single Set entry
      expect(buggyKnownIds.size).toBe(1);
      expect(buggyKnownIds.has(undefined)).toBe(true);

      // Correct behavior: 3 unique tweet IDs
      expect(correctKnownIds.size).toBe(3);
      expect(correctKnownIds.has('1111111111')).toBe(true);
      expect(correctKnownIds.has('2222222222')).toBe(true);
      expect(correctKnownIds.has('3333333333')).toBe(true);
    });

    it('should show how undefined values break duplicate detection', () => {
      const testSet = new Set();

      // Simulate adding undefined values (original bug)
      testSet.add(undefined);
      testSet.add(undefined);
      testSet.add('realId1');
      testSet.add(undefined);
      testSet.add('realId2');
      testSet.add(undefined);

      // Set deduplicates undefined values, making duplicate detection fail
      expect(testSet.size).toBe(3); // 1 undefined + 2 real IDs
      expect(testSet.has(undefined)).toBe(true);
      expect(testSet.has('realId1')).toBe(true);
      expect(testSet.has('realId2')).toBe(true);
    });
  });

  describe('Cross-platform Duplicate Detection', () => {
    it('should detect duplicates across different URL formats', () => {
      const sameVideoId = 'dQw4w9WgXcQ';
      const urls = [
        `https://www.youtube.com/watch?v=${sameVideoId}`,
        `https://youtu.be/${sameVideoId}`,
        `https://youtube.com/shorts/${sameVideoId}`,
        `https://www.youtube.com/embed/${sameVideoId}?autoplay=1`,
      ];

      const detectedVideos = new Set();
      let totalMatches = 0;

      urls.forEach(url => {
        const matches = [...url.matchAll(videoUrlRegex)];
        totalMatches += matches.length;
        matches.forEach(match => {
          detectedVideos.add(match[1]);
        });
      });

      expect(totalMatches).toBe(4); // 4 URLs matched
      expect(detectedVideos.size).toBe(1); // But only 1 unique video
      expect(detectedVideos.has(sameVideoId)).toBe(true);
    });

    it('should detect duplicates across different Twitter platforms', () => {
      const sameTweetId = '1234567890123456789';
      const urls = [
        `https://x.com/user/status/${sameTweetId}`,
        `https://twitter.com/user/status/${sameTweetId}`,
        `https://vxtwitter.com/user/status/${sameTweetId}`,
        `https://fxtwitter.com/user/status/${sameTweetId}`,
        `https://nitter.net/user/status/${sameTweetId}`,
      ];

      const detectedTweets = new Set();
      let totalMatches = 0;

      urls.forEach(url => {
        const matches = [...url.matchAll(tweetUrlRegex)];
        totalMatches += matches.length;
        matches.forEach(match => {
          detectedTweets.add(match[1]);
        });
      });

      expect(totalMatches).toBe(5); // 5 URLs matched
      expect(detectedTweets.size).toBe(1); // But only 1 unique tweet
      expect(detectedTweets.has(sameTweetId)).toBe(true);
    });
  });

  describe('Memory Management and Cleanup', () => {
    it('should handle large sets efficiently', () => {
      const largeSet = new Set();
      const numberOfIds = 10000;

      // Add many unique IDs
      for (let i = 0; i < numberOfIds; i++) {
        largeSet.add(`video${i.toString().padStart(7, '0')}`);
      }

      expect(largeSet.size).toBe(numberOfIds);

      // Test duplicate detection performance
      const start = performance.now();
      const duplicateTest = largeSet.has('video0005000');
      const end = performance.now();

      expect(duplicateTest).toBe(true);
      expect(end - start).toBeLessThan(1); // Should be very fast
    });

    it('should handle Set clear operation', () => {
      knownVideoIds.add('video1');
      knownVideoIds.add('video2');
      knownVideoIds.add('video3');

      expect(knownVideoIds.size).toBe(3);

      knownVideoIds.clear();

      expect(knownVideoIds.size).toBe(0);
      expect(knownVideoIds.has('video1')).toBe(false);
    });

    it('should handle Set deletion operation', () => {
      const videoIds = ['video1', 'video2', 'video3'];
      videoIds.forEach(id => knownVideoIds.add(id));

      expect(knownVideoIds.size).toBe(3);

      // Delete specific entries
      knownVideoIds.delete('video2');

      expect(knownVideoIds.size).toBe(2);
      expect(knownVideoIds.has('video1')).toBe(true);
      expect(knownVideoIds.has('video2')).toBe(false);
      expect(knownVideoIds.has('video3')).toBe(true);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty strings gracefully', () => {
      const emptyText = '';
      const videoMatches = [...emptyText.matchAll(videoUrlRegex)];
      const tweetMatches = [...emptyText.matchAll(tweetUrlRegex)];

      expect(videoMatches).toHaveLength(0);
      expect(tweetMatches).toHaveLength(0);
    });

    it('should handle text without URLs gracefully', () => {
      const noUrlText = 'This is just regular text without any URLs';
      const videoMatches = [...noUrlText.matchAll(videoUrlRegex)];
      const tweetMatches = [...noUrlText.matchAll(tweetUrlRegex)];

      expect(videoMatches).toHaveLength(0);
      expect(tweetMatches).toHaveLength(0);
    });

    it('should handle malformed URLs gracefully', () => {
      const malformedUrls = [
        'https://youtube.com/watch?v=',
        'https://x.com/user/status/',
        'https://youtube.com/watch?v=invalid',
        'https://x.com/user/status/notanumber',
      ];

      malformedUrls.forEach(url => {
        const videoMatches = [...url.matchAll(videoUrlRegex)];
        const tweetMatches = [...url.matchAll(tweetUrlRegex)];

        expect(videoMatches).toHaveLength(0);
        expect(tweetMatches).toHaveLength(0);
      });
    });

    it('should handle null and undefined values in Set operations', () => {
      const testSet = new Set();

      testSet.add(null);
      testSet.add(undefined);
      testSet.add('validId');
      testSet.add(null); // Duplicate null
      testSet.add(undefined); // Duplicate undefined

      expect(testSet.size).toBe(3); // null, undefined, 'validId'
      expect(testSet.has(null)).toBe(true);
      expect(testSet.has(undefined)).toBe(true);
      expect(testSet.has('validId')).toBe(true);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle concurrent duplicate checks efficiently', () => {
      const ids = Array.from({ length: 1000 }, (_, i) => `id${i}`);
      const duplicateIds = [...ids, ...ids]; // Create duplicates

      const uniqueSet = new Set();
      let duplicateCount = 0;

      const start = performance.now();

      duplicateIds.forEach(id => {
        if (uniqueSet.has(id)) {
          duplicateCount++;
        } else {
          uniqueSet.add(id);
        }
      });

      const end = performance.now();

      expect(uniqueSet.size).toBe(1000); // 1000 unique IDs
      expect(duplicateCount).toBe(1000); // 1000 duplicates detected
      expect(end - start).toBeLessThan(50); // Should complete quickly
    });

    it('should maintain constant-time lookup performance', () => {
      const largeSet = new Set();

      // Add 50,000 items
      for (let i = 0; i < 50000; i++) {
        largeSet.add(`item${i}`);
      }

      // Test lookup times at different positions
      const lookupTimes = [];
      const testItems = ['item1', 'item25000', 'item49999', 'nonexistent'];

      testItems.forEach(item => {
        const start = performance.now();
        largeSet.has(item);
        const end = performance.now();
        lookupTimes.push(end - start);
      });

      // All lookups should be roughly the same time (constant time)
      const maxTime = Math.max(...lookupTimes);
      const minTime = Math.min(...lookupTimes);
      expect(maxTime - minTime).toBeLessThan(1); // Difference should be minimal
    });
  });

  describe('Discord Channel History Scanning', () => {
    let mockDiscordChannel;
    let mockMessages;

    beforeEach(() => {
      // Mock Discord channel with message history
      mockMessages = new Map();

      // Create mock messages with YouTube and Twitter content
      mockMessages.set('msg1', {
        id: 'msg1',
        content: 'Check out this video: https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });
      mockMessages.set('msg2', {
        id: 'msg2',
        content: 'Another video: https://youtu.be/oHg5SJYRHA0',
      });
      mockMessages.set('msg3', {
        id: 'msg3',
        content: 'Tweet: https://x.com/user/status/1234567890123456789',
      });
      mockMessages.set('msg4', {
        id: 'msg4',
        content:
          'Multiple links: https://www.youtube.com/watch?v=dQw4w9WgXcQ and https://x.com/user/status/9876543210987654321',
      });
      mockMessages.set('msg5', {
        id: 'msg5',
        content: 'No links here, just text',
      });

      // Mock Discord channel
      mockDiscordChannel = {
        messages: {
          fetch: jest.fn().mockImplementation(async (options = {}) => {
            const { limit = 100, before } = options;

            // Simulate Discord API pagination
            const allMessages = Array.from(mockMessages.values()).reverse(); // Newest first
            let startIndex = 0;

            if (before) {
              const beforeIndex = allMessages.findIndex(msg => msg.id === before);
              if (beforeIndex !== -1) {
                startIndex = beforeIndex + 1;
              }
            }

            const messagesToReturn = allMessages.slice(startIndex, startIndex + limit);

            // Return a Map-like object similar to Discord.js Collection
            const resultMap = new Map();
            messagesToReturn.forEach(msg => resultMap.set(msg.id, msg));

            return {
              size: resultMap.size,
              values: () => resultMap.values(),
            };
          }),
        },
      };
    });

    describe('scanDiscordChannelForVideos', () => {
      it('should scan channel and extract YouTube video IDs', async () => {
        const results = await duplicateDetector.scanDiscordChannelForVideos(mockDiscordChannel, 100);

        expect(results).toHaveProperty('messagesScanned');
        expect(results).toHaveProperty('videoIdsFound');
        expect(results).toHaveProperty('videoIdsAdded');
        expect(results).toHaveProperty('errors');

        expect(results.messagesScanned).toBe(5);
        expect(results.videoIdsFound).toEqual(['dQw4w9WgXcQ', 'oHg5SJYRHA0', 'dQw4w9WgXcQ']);
        expect(results.videoIdsAdded).toBe(2); // Two unique video IDs
        expect(results.errors).toHaveLength(0);

        // Verify IDs were added to known set
        expect(duplicateDetector.isVideoIdKnown('dQw4w9WgXcQ')).toBe(true);
        expect(duplicateDetector.isVideoIdKnown('oHg5SJYRHA0')).toBe(true);
      });

      it('should handle pagination correctly', async () => {
        // Test with a limit smaller than total messages
        const results = await duplicateDetector.scanDiscordChannelForVideos(mockDiscordChannel, 3);

        expect(results.messagesScanned).toBe(3);
        expect(mockDiscordChannel.messages.fetch).toHaveBeenCalled();
      });

      it('should handle empty channel gracefully', async () => {
        const emptyChannel = {
          messages: {
            fetch: jest.fn().mockResolvedValue({
              size: 0,
              values: () => [].values(),
            }),
          },
        };

        const results = await duplicateDetector.scanDiscordChannelForVideos(emptyChannel, 100);

        expect(results.messagesScanned).toBe(0);
        expect(results.videoIdsFound).toHaveLength(0);
        expect(results.videoIdsAdded).toBe(0);
        expect(results.errors).toHaveLength(0);
      });

      it('should handle API errors gracefully', async () => {
        const errorChannel = {
          messages: {
            fetch: jest.fn().mockRejectedValue(new Error('Discord API error')),
          },
        };

        const results = await duplicateDetector.scanDiscordChannelForVideos(errorChannel, 100);

        expect(results.messagesScanned).toBe(0);
        expect(results.errors).toHaveLength(1);
        expect(results.errors[0]).toHaveProperty('type', 'fetch_error');
        expect(results.errors[0]).toHaveProperty('message', 'Discord API error');
      });

      it('should throw error for invalid channel', async () => {
        await expect(duplicateDetector.scanDiscordChannelForVideos(null)).rejects.toThrow(
          'Invalid Discord channel provided'
        );

        await expect(duplicateDetector.scanDiscordChannelForVideos({})).rejects.toThrow(
          'Invalid Discord channel provided'
        );
      });
    });

    describe('scanDiscordChannelForTweets', () => {
      it('should scan channel and extract tweet IDs', async () => {
        const results = await duplicateDetector.scanDiscordChannelForTweets(mockDiscordChannel, 100);

        expect(results).toHaveProperty('messagesScanned');
        expect(results).toHaveProperty('tweetIdsFound');
        expect(results).toHaveProperty('tweetIdsAdded');
        expect(results).toHaveProperty('errors');

        expect(results.messagesScanned).toBe(5);
        expect(results.tweetIdsFound).toEqual(['9876543210987654321', '1234567890123456789']);
        expect(results.tweetIdsAdded).toBe(2); // Two unique tweet IDs
        expect(results.errors).toHaveLength(0);

        // Verify IDs were added to known set
        expect(duplicateDetector.isTweetIdKnown('1234567890123456789')).toBe(true);
        expect(duplicateDetector.isTweetIdKnown('9876543210987654321')).toBe(true);
      });

      it('should not add duplicate tweet IDs', async () => {
        // Pre-add one tweet ID
        duplicateDetector.addTweetId('1234567890123456789');

        const results = await duplicateDetector.scanDiscordChannelForTweets(mockDiscordChannel, 100);

        expect(results.tweetIdsFound).toEqual(['9876543210987654321', '1234567890123456789']);
        expect(results.tweetIdsAdded).toBe(1); // Only one new ID added
      });

      it('should handle rate limiting with delays', async () => {
        const startTime = Date.now();

        // Mock a channel with multiple batches
        const largeMockChannel = {
          messages: {
            fetch: jest
              .fn()
              .mockResolvedValueOnce({
                size: 2,
                values: () => [mockMessages.get('msg1'), mockMessages.get('msg2')].values(),
              })
              .mockResolvedValueOnce({
                size: 2,
                values: () => [mockMessages.get('msg3'), mockMessages.get('msg4')].values(),
              })
              .mockResolvedValueOnce({
                size: 0,
                values: () => [].values(),
              }),
          },
        };

        await duplicateDetector.scanDiscordChannelForTweets(largeMockChannel, 200);

        const elapsed = Date.now() - startTime;

        // Should have included delays between batches (at least 200ms total)
        expect(elapsed).toBeGreaterThan(150);
        expect(largeMockChannel.messages.fetch).toHaveBeenCalledTimes(3);
      });
    });

    describe('Integration with existing duplicate detection', () => {
      it('should work with existing isDuplicate method', async () => {
        // Scan channel first
        await duplicateDetector.scanDiscordChannelForVideos(mockDiscordChannel, 100);

        // Test duplicate detection
        expect(duplicateDetector.isDuplicate('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
        expect(duplicateDetector.isDuplicate('https://youtu.be/oHg5SJYRHA0')).toBe(true);
        expect(duplicateDetector.isDuplicate('https://www.youtube.com/watch?v=newVideoId123')).toBe(false);
      });

      it('should work with existing markAsSeen method', async () => {
        // Scan channel first
        await duplicateDetector.scanDiscordChannelForVideos(mockDiscordChannel, 100);

        // Add a new video
        const newVideoUrl = 'https://www.youtube.com/watch?v=newVideoId123';
        expect(duplicateDetector.isDuplicate(newVideoUrl)).toBe(false);

        duplicateDetector.markAsSeen(newVideoUrl);
        expect(duplicateDetector.isDuplicate(newVideoUrl)).toBe(true);
      });

      it('should maintain statistics correctly after scanning', async () => {
        const initialStats = duplicateDetector.getStats();

        await duplicateDetector.scanDiscordChannelForVideos(mockDiscordChannel, 100);
        await duplicateDetector.scanDiscordChannelForTweets(mockDiscordChannel, 100);

        const finalStats = duplicateDetector.getStats();

        expect(finalStats.knownVideoIds).toBeGreaterThan(initialStats.knownVideoIds);
        expect(finalStats.knownTweetIds).toBeGreaterThan(initialStats.knownTweetIds);
        expect(finalStats.totalKnownIds).toBeGreaterThan(initialStats.totalKnownIds);
      });
    });
  });
});
