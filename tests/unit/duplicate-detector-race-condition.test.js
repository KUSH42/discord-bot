import { jest } from '@jest/globals';
import { DuplicateDetector } from '../../src/duplicate-detector.js';

describe('DuplicateDetector - Race Condition Scenarios', () => {
  let duplicateDetector;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Create duplicate detector without persistent storage to test in-memory caches only
    duplicateDetector = new DuplicateDetector(null, mockLogger);
  });

  describe('Cache Population from Startup Scan', () => {
    it('should populate video ID cache during startup scan', () => {
      // Arrange - Simulate startup scan finding existing videos
      const existingVideoIds = ['dQw4w9WgXcQ', 'jNQXAC9IVRw', 'ZZ5LpwO-An4'];

      // Act - Simulate startup scan populating cache
      existingVideoIds.forEach(videoId => {
        duplicateDetector.addVideoId(videoId);
      });

      // Assert - Cache should contain all video IDs
      existingVideoIds.forEach(videoId => {
        expect(duplicateDetector.isVideoIdKnown(videoId)).toBe(true);
      });
    });

    it('should populate tweet ID cache during startup scan', async () => {
      // Arrange - Simulate startup scan finding existing tweets
      const existingTweetUrls = [
        'https://x.com/user/status/1234567890123456789',
        'https://x.com/user/status/9876543210987654321',
        'https://twitter.com/user/status/1111111111111111111',
      ];

      // Act - Simulate startup scan populating cache
      for (const url of existingTweetUrls) {
        await duplicateDetector.markAsSeenByUrl(url);
      }

      // Assert - Cache should contain all tweet IDs
      expect(duplicateDetector.isTweetIdKnown('1234567890123456789')).toBe(true);
      expect(duplicateDetector.isTweetIdKnown('9876543210987654321')).toBe(true);
      expect(duplicateDetector.isTweetIdKnown('1111111111111111111')).toBe(true);
    });
  });

  describe('Race Condition Detection', () => {
    it('should detect content posted after startup but before bot detection', async () => {
      // Arrange - Startup scan completed, cache populated with some content
      duplicateDetector.addVideoId('StartupVideo1');
      duplicateDetector.addVideoId('StartupVideo2');

      // Content posted after startup (not in cache)
      const newContent = {
        platform: 'YouTube',
        type: 'video',
        videoId: 'PostStartupVideo',
        url: 'https://www.youtube.com/watch?v=PostStartupVideo',
        title: 'Video Posted After Startup',
      };

      // Act - Check if content is duplicate (should not be in cache)
      const isDuplicateInCache = duplicateDetector.isVideoIdKnown(newContent.videoId);

      // Assert - Should not be in startup cache (this is the race condition scenario)
      expect(isDuplicateInCache).toBe(false);

      // But when we add it to cache after finding in Discord...
      duplicateDetector.addVideoId(newContent.videoId);

      // It should now be detected as duplicate
      expect(duplicateDetector.isVideoIdKnown(newContent.videoId)).toBe(true);
    });

    it('should handle URL-based duplicate detection for content not in ID cache', async () => {
      // Arrange - Content not in video ID cache but URL might be seen (valid 11-char video ID)
      const contentData = {
        platform: 'YouTube',
        type: 'video',
        videoId: 'dQw4w9WgXcQ', // Valid 11-character YouTube video ID
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Content Not In Cache',
      };

      // Initially not in any cache
      expect(duplicateDetector.isVideoIdKnown(contentData.videoId)).toBe(false);
      expect(await duplicateDetector.isDuplicateByUrl(contentData.url)).toBe(false);

      // Act - Mark as seen by URL (simulating finding it in Discord messages)
      await duplicateDetector.markAsSeenByUrl(contentData.url);

      // Assert - Should now be detected as duplicate by URL
      expect(await duplicateDetector.isDuplicateByUrl(contentData.url)).toBe(true);

      // And should also populate the video ID cache (due to markAsSeenByUrl implementation)
      expect(duplicateDetector.isVideoIdKnown(contentData.videoId)).toBe(true);
    });

    it('should handle mixed platform content in race conditions', async () => {
      // Arrange - Startup cache has some YouTube and X content
      duplicateDetector.addVideoId('StartupYouTube1');
      await duplicateDetector.markAsSeenByUrl('https://x.com/user/status/1111111111111111111');

      // New content from different platforms
      const youtubeContent = {
        videoId: 'NewYouTubeVideo',
        url: 'https://www.youtube.com/watch?v=NewYouTubeVideo',
      };

      const xContent = {
        tweetId: '2222222222222222222',
        url: 'https://x.com/user/status/2222222222222222222',
      };

      // Act & Assert - New content should not be in cache initially
      expect(duplicateDetector.isVideoIdKnown(youtubeContent.videoId)).toBe(false);
      expect(duplicateDetector.isTweetIdKnown(xContent.tweetId)).toBe(false);

      // But existing content should still be detected
      expect(duplicateDetector.isVideoIdKnown('StartupYouTube1')).toBe(true);
      expect(duplicateDetector.isTweetIdKnown('1111111111111111111')).toBe(true);

      // After adding new content to cache
      duplicateDetector.addVideoId(youtubeContent.videoId);
      await duplicateDetector.markAsSeenByUrl(xContent.url);

      // Should now be detected
      expect(duplicateDetector.isVideoIdKnown(youtubeContent.videoId)).toBe(true);
      expect(duplicateDetector.isTweetIdKnown(xContent.tweetId)).toBe(true);
    });
  });

  describe('Cache Update Patterns', () => {
    it('should update cache when content is found in live Discord scan', async () => {
      // Arrange - Empty cache (startup scan missed this content)
      const missedContent = {
        videoId: 'MissedByStartupScan',
        url: 'https://www.youtube.com/watch?v=MissedByStartupScan',
      };

      expect(duplicateDetector.isVideoIdKnown(missedContent.videoId)).toBe(false);

      // Act - Simulate finding content in live Discord scan
      duplicateDetector.addVideoId(missedContent.videoId);

      // Assert - Cache should now contain the content
      expect(duplicateDetector.isVideoIdKnown(missedContent.videoId)).toBe(true);

      // Future checks should detect it as duplicate
      expect(duplicateDetector.isVideoIdKnown(missedContent.videoId)).toBe(true);
    });

    it('should handle URL normalization consistently across cache operations', async () => {
      // Arrange - Different URL formats for the same video (valid 11-char video ID)
      const videoId = 'jNQXAC9IVRw'; // Valid 11-character YouTube video ID
      const urlVariants = [
        `https://www.youtube.com/watch?v=${videoId}`,
        `https://youtube.com/watch?v=${videoId}`,
        `https://youtu.be/${videoId}`,
        `https://www.youtube.com/watch?v=${videoId}&t=30s`,
      ];

      // Act - Mark one variant as seen
      await duplicateDetector.markAsSeenByUrl(urlVariants[0]);

      // Assert - All variants should be normalized to the same format
      for (const url of urlVariants) {
        const normalizedUrl = duplicateDetector.normalizeUrl(url);
        expect(normalizedUrl).toBe(`https://www.youtube.com/watch?v=${videoId}`);
      }

      // Video ID should be in cache
      expect(duplicateDetector.isVideoIdKnown(videoId)).toBe(true);
    });

    it('should handle edge case of same content detected from multiple sources simultaneously', async () => {
      // Arrange - Content that might be detected by webhook and scraper simultaneously (valid 11-char ID)
      const contentData = {
        videoId: 'ZZ5LpwO-An4', // Valid 11-character YouTube video ID
        url: 'https://www.youtube.com/watch?v=ZZ5LpwO-An4',
      };

      // Act - Simulate simultaneous detection (both try to add to cache)
      const operations = [
        duplicateDetector.markAsSeenByUrl(contentData.url),
        duplicateDetector.markAsSeenByUrl(contentData.url),
        duplicateDetector.markAsSeenByUrl(contentData.url),
      ];

      await Promise.all(operations);

      // Assert - Should handle multiple simultaneous operations gracefully
      expect(duplicateDetector.isVideoIdKnown(contentData.videoId)).toBe(true);
      expect(await duplicateDetector.isDuplicateByUrl(contentData.url)).toBe(true);
    });
  });

  describe('Content Fingerprinting in Race Conditions', () => {
    it('should use content fingerprinting for enhanced duplicate detection', async () => {
      // Arrange - Content with title and timestamp for fingerprinting
      const contentData = {
        videoId: 'FingerprintTest',
        url: 'https://www.youtube.com/watch?v=FingerprintTest',
        title: 'Test Video for Fingerprinting',
        publishedAt: '2024-01-01T10:00:00Z',
      };

      // Generate fingerprint
      const fingerprint = duplicateDetector.generateContentFingerprint(contentData);
      expect(fingerprint).toBeTruthy();
      expect(typeof fingerprint).toBe('string');

      // Act - Check for duplicates using fingerprinting
      const initialCheck = await duplicateDetector.isDuplicate(contentData);
      expect(initialCheck).toBe(false);

      // Mark as seen
      await duplicateDetector.markAsSeen(contentData);

      // Should now be detected as duplicate
      const subsequentCheck = await duplicateDetector.isDuplicate(contentData);
      expect(subsequentCheck).toBe(true);
    });

    it('should handle content with missing fingerprint data gracefully', async () => {
      // Arrange - Content without title or timestamp (limited fingerprint data)
      const limitedContentData = {
        videoId: 'LimitedData',
        url: 'https://www.youtube.com/watch?v=LimitedData',
        // title: missing
        // publishedAt: missing
      };

      // Act - Should fall back to URL-based detection
      const initialCheck = await duplicateDetector.isDuplicate(limitedContentData);
      expect(initialCheck).toBe(false);

      await duplicateDetector.markAsSeen(limitedContentData);

      const subsequentCheck = await duplicateDetector.isDuplicate(limitedContentData);
      expect(subsequentCheck).toBe(true);
    });
  });

  describe('Memory Management and Performance', () => {
    it('should handle large numbers of cache entries efficiently', () => {
      // Arrange - Add many entries to test performance
      const numEntries = 1000;
      const videoIds = Array.from({ length: numEntries }, (_, i) => `video${i}`);

      // Act - Add all entries
      const startTime = Date.now();
      videoIds.forEach(videoId => {
        duplicateDetector.addVideoId(videoId);
      });
      const duration = Date.now() - startTime;

      // Assert - Should complete quickly and all entries should be detectable
      expect(duration).toBeLessThan(100); // Should be very fast

      // Random sampling to verify entries
      const sampleIndices = [0, 100, 500, 999];
      sampleIndices.forEach(index => {
        expect(duplicateDetector.isVideoIdKnown(`video${index}`)).toBe(true);
      });
    });

    it('should provide accurate statistics about cached content', async () => {
      // Arrange - Populate cache with known amounts of data
      const videoIds = ['dQw4w9WgXcQ', 'jNQXAC9IVRw', 'ZZ5LpwO-An4']; // Valid 11-char video IDs
      const tweetIds = ['1111111111111111111', '2222222222222222222'];

      videoIds.forEach(id => duplicateDetector.addVideoId(id));

      // Add tweet IDs through URL marking (await each one)
      for (const id of tweetIds) {
        await duplicateDetector.markAsSeenByUrl(`https://x.com/user/status/${id}`);
      }

      // Act - Get statistics
      const stats = duplicateDetector.getStats();

      // Assert - Statistics should reflect actual cache content
      expect(stats.knownVideoIds).toBe(3);
      expect(stats.knownTweetIds).toBe(2); // Should be 2 after async operations complete
      expect(stats.fingerprintingEnabled).toBe(true);
    });
  });

  describe('Integration with ContentCoordinator Race Condition Prevention', () => {
    it('should support the two-phase detection pattern used by ContentCoordinator', async () => {
      // Arrange - Simulate ContentCoordinator's usage pattern
      const contentData = {
        platform: 'YouTube',
        videoId: 'CoordinatorTest',
        url: 'https://www.youtube.com/watch?v=CoordinatorTest',
      };

      // Phase 1: Check cache (simulates ContentCoordinator.checkForPreviouslyAnnouncedContent)
      const cacheResult = duplicateDetector.isVideoIdKnown(contentData.videoId);
      expect(cacheResult).toBe(false); // Not in startup cache

      // Phase 2: Live Discord scan finds content, updates cache
      duplicateDetector.addVideoId(contentData.videoId);

      // Phase 3: Subsequent checks should find it in cache
      const updatedCacheResult = duplicateDetector.isVideoIdKnown(contentData.videoId);
      expect(updatedCacheResult).toBe(true);

      // Verify URL-based detection also works
      expect(await duplicateDetector.isDuplicateByUrl(contentData.url)).toBe(false); // URL cache not updated
      await duplicateDetector.markAsSeenByUrl(contentData.url);
      expect(await duplicateDetector.isDuplicateByUrl(contentData.url)).toBe(true);
    });

    it('should handle the exact race condition timeline from requirements', async () => {
      // Timeline simulation:
      // 1. Bot starts → Scans Discord history → Populates duplicate detector cache
      const startupVideoIds = ['StartupVideo1', 'StartupVideo2'];
      startupVideoIds.forEach(id => duplicateDetector.addVideoId(id));

      // 2. User posts content link manually in Discord (after startup, before bot detection)
      const manuallyPostedContent = {
        videoId: 'ManuallyPosted123',
        url: 'https://www.youtube.com/watch?v=ManuallyPosted123',
      };

      // This content is NOT in the startup cache
      expect(duplicateDetector.isVideoIdKnown(manuallyPostedContent.videoId)).toBe(false);

      // 3. Bot detects same content → Checks cache → Cache miss
      const initialCacheCheck = duplicateDetector.isVideoIdKnown(manuallyPostedContent.videoId);
      expect(initialCacheCheck).toBe(false);

      // 4. Live Discord scan finds manual post → Updates cache
      duplicateDetector.addVideoId(manuallyPostedContent.videoId);

      // 5. Bot should now detect it as duplicate
      const finalCacheCheck = duplicateDetector.isVideoIdKnown(manuallyPostedContent.videoId);
      expect(finalCacheCheck).toBe(true);

      // Verify original startup content is still detected
      startupVideoIds.forEach(id => {
        expect(duplicateDetector.isVideoIdKnown(id)).toBe(true);
      });
    });
  });
});
