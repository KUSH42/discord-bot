import { describe, it, expect, beforeEach } from '@jest/globals';
import { ContentClassifier } from '../../src/core/content-classifier.js';

describe('ContentClassifier', () => {
  let classifier;

  beforeEach(() => {
    classifier = new ContentClassifier();
  });

  describe('X (Twitter) Content Classification', () => {
    describe('Basic Classification', () => {
      it('should classify regular post', () => {
        const result = classifier.classifyXContent('https://x.com/user/status/1234567890', 'This is a regular tweet');

        expect(result.platform).toBe('x');
        expect(result.type).toBe('post');
        expect(result.confidence).toBeGreaterThan(0.7);
        expect(result.details.statusId).toBe('1234567890');
      });

      it('should classify reply tweet', () => {
        const result = classifier.classifyXContent('https://x.com/user/status/1234567890', '@someone This is a reply', {
          isReply: true,
        });

        expect(result.type).toBe('reply');
        expect(result.confidence).toBeGreaterThan(0.8);
      });

      it('should classify retweet', () => {
        const result = classifier.classifyXContent(
          'https://x.com/user/status/1234567890',
          'RT @someone This is a retweet',
          { isRetweet: true }
        );

        expect(result.type).toBe('retweet');
        expect(result.confidence).toBeGreaterThan(0.9);
      });

      it('should classify quote tweet', () => {
        const result = classifier.classifyXContent(
          'https://x.com/user/status/1234567890',
          'My comment https://x.com/other/status/0987654321',
          { isQuote: true }
        );

        expect(result.type).toBe('quote');
        expect(result.confidence).toBeGreaterThan(0.8);
      });
    });

    describe('URL Validation', () => {
      it('should handle valid X URLs', () => {
        const urls = [
          'https://x.com/user/status/1234567890',
          'https://twitter.com/user/status/1234567890',
          'http://x.com/user/status/1234567890',
        ];

        urls.forEach(url => {
          const result = classifier.classifyXContent(url, 'test');
          expect(result.platform).toBe('x');
          expect(result.error).toBeUndefined();
        });
      });

      it('should reject invalid URLs', () => {
        const result = classifier.classifyXContent('invalid-url', 'test');
        expect(result.error).toContain('not from X');
      });

      it('should handle null/undefined URLs', () => {
        const result = classifier.classifyXContent(null, 'test');
        expect(result.error).toContain('Invalid URL');
      });

      it('should handle profile URLs', () => {
        const result = classifier.classifyXContent('https://x.com/username', 'test');
        expect(result.type).toBe('profile');
        expect(result.confidence).toBeGreaterThan(0.8);
      });
    });

    describe('Content Analysis', () => {
      it('should detect reply by text starting with @', () => {
        const result = classifier.analyzeXContentType('@username This is a reply');
        expect(result.type).toBe('reply');
      });

      it('should detect reply by "Replying to" text', () => {
        const result = classifier.analyzeXContentType('Replying to @username');
        expect(result.type).toBe('reply');
      });

      it('should detect retweet by RT @ pattern', () => {
        const result = classifier.analyzeXContentType('RT @username: Original tweet');
        expect(result.type).toBe('retweet');
      });

      it('should detect quote tweet by embedded URL', () => {
        const result = classifier.analyzeXContentType('My comment https://x.com/user/status/123');
        expect(result.type).toBe('quote');
      });

      it('should default to post for regular content', () => {
        const result = classifier.analyzeXContentType('Regular tweet content');
        expect(result.type).toBe('post');
      });
    });

    describe('Metadata Analysis', () => {
      it('should prioritize metadata over text analysis', () => {
        const result = classifier.analyzeXContentType('Regular text', { isRetweet: true });
        expect(result.type).toBe('retweet');
      });

      it('should use metadata for reply detection', () => {
        const result = classifier.analyzeXContentType('Some text', { inReplyTo: 'user123' });
        expect(result.type).toBe('reply');
      });

      it('should use metadata for quote detection', () => {
        const result = classifier.analyzeXContentType('Some text', { quotedStatus: true });
        expect(result.type).toBe('quote');
      });
    });

    describe('Author-based Retweet Detection', () => {
      it('should detect retweet when author differs from monitored user', () => {
        const result = classifier.classifyXContent('https://x.com/user/status/1234567890', 'Some tweet content', {
          author: 'differentuser',
          monitoredUser: 'testuser',
        });

        expect(result.type).toBe('retweet');
        expect(result.confidence).toBeGreaterThan(0.9);
      });

      it('should detect retweet when author differs from monitored user with @ prefix', () => {
        const result = classifier.classifyXContent('https://x.com/user/status/1234567890', 'Some tweet content', {
          author: 'differentuser',
          monitoredUser: '@testuser',
        });

        expect(result.type).toBe('retweet');
        expect(result.confidence).toBeGreaterThan(0.9);
      });

      it('should NOT detect retweet when author matches monitored user', () => {
        const result = classifier.classifyXContent('https://x.com/user/status/1234567890', 'Some tweet content', {
          author: 'testuser',
          monitoredUser: 'testuser',
        });

        expect(result.type).toBe('post');
      });

      it('should NOT detect retweet when author matches monitored user with @ prefix', () => {
        const result = classifier.classifyXContent('https://x.com/user/status/1234567890', 'Some tweet content', {
          author: '@testuser',
          monitoredUser: 'testuser',
        });

        expect(result.type).toBe('post');
      });

      it('should ignore Unknown authors', () => {
        const result = classifier.classifyXContent('https://x.com/user/status/1234567890', 'Some tweet content', {
          author: 'Unknown',
          monitoredUser: 'testuser',
        });

        expect(result.type).toBe('post');
      });

      it('should fallback to text-based detection when author metadata is missing', () => {
        const result = classifier.classifyXContent(
          'https://x.com/user/status/1234567890',
          'RT @someone This is a retweet'
        );

        expect(result.type).toBe('retweet');
      });

      it('should fallback to text-based detection when monitoredUser metadata is missing', () => {
        const result = classifier.classifyXContent(
          'https://x.com/user/status/1234567890',
          'RT @someone This is a retweet',
          { author: 'differentuser' }
        );

        expect(result.type).toBe('retweet');
      });
    });
  });

  describe('YouTube Content Classification', () => {
    describe('Video Classification', () => {
      it('should classify regular video', () => {
        const video = {
          id: 'dQw4w9WgXcQ',
          snippet: {
            title: 'Test Video',
            channelId: 'UC123',
            publishedAt: '2023-01-01T00:00:00Z',
            liveBroadcastContent: 'none',
          },
          contentDetails: {
            duration: 'PT3M33S',
          },
        };

        const result = classifier.classifyYouTubeContent(video);

        expect(result.platform).toBe('youtube');
        expect(result.type).toBe('video');
        expect(result.confidence).toBeGreaterThan(0.8);
        expect(result.details.videoId).toBe('dQw4w9WgXcQ');
      });

      it('should classify livestream', () => {
        const video = {
          id: 'liveVideoId',
          snippet: {
            liveBroadcastContent: 'live',
          },
          liveStreamingDetails: {
            actualStartTime: '2023-01-01T12:00:00Z',
          },
        };

        const result = classifier.classifyYouTubeContent(video);

        expect(result.type).toBe('livestream');
        expect(result.confidence).toBeGreaterThan(0.9);
      });

      it('should classify upcoming stream', () => {
        const video = {
          id: 'upcomingVideoId',
          snippet: {
            liveBroadcastContent: 'upcoming',
          },
          liveStreamingDetails: {
            scheduledStartTime: '2023-01-01T15:00:00Z',
          },
        };

        const result = classifier.classifyYouTubeContent(video);

        expect(result.type).toBe('upcoming');
        expect(result.confidence).toBeGreaterThan(0.8);
      });

      it('should classify YouTube Short', () => {
        const video = {
          id: 'shortVideoId',
          snippet: {
            title: 'Test Short',
          },
          contentDetails: {
            duration: 'PT45S', // 45 seconds
          },
        };

        const result = classifier.classifyYouTubeContent(video);

        expect(result.type).toBe('short');
        expect(result.confidence).toBeGreaterThan(0.8);
      });
    });

    describe('Duration Parsing', () => {
      it('should parse YouTube duration format correctly', () => {
        const testCases = [
          { duration: 'PT4M13S', expected: 253 },
          { duration: 'PT1H23M45S', expected: 5025 },
          { duration: 'PT30S', expected: 30 },
          { duration: 'PT2M', expected: 120 },
          { duration: 'PT1H', expected: 3600 },
        ];

        testCases.forEach(({ duration, expected }) => {
          const result = classifier.parseYouTubeDuration(duration);
          expect(result).toBe(expected);
        });
      });

      it('should handle invalid duration formats', () => {
        const invalidFormats = [null, undefined, '', 'invalid', 'P1D'];

        invalidFormats.forEach(duration => {
          const result = classifier.parseYouTubeDuration(duration);
          expect(result).toBe(0);
        });
      });
    });

    describe('Live Stream Detection', () => {
      it('should detect livestream by streaming details', () => {
        const video = {
          liveStreamingDetails: {
            actualStartTime: '2023-01-01T12:00:00Z',
          },
        };

        expect(classifier.isYouTubeLivestream(video)).toBe(true);
      });

      it('should detect livestream by broadcast content', () => {
        const video = {
          snippet: {
            liveBroadcastContent: 'live',
          },
        };

        expect(classifier.isYouTubeLivestream(video)).toBe(true);
      });

      it('should not detect regular video as livestream', () => {
        const video = {
          snippet: {
            liveBroadcastContent: 'none',
          },
        };

        expect(classifier.isYouTubeLivestream(video)).toBe(false);
      });
    });

    describe('Error Handling', () => {
      it('should handle invalid video object', () => {
        const result = classifier.classifyYouTubeContent(null);

        expect(result.error).toContain('Invalid video object');
        expect(result.confidence).toBe(0);
      });

      it('should handle missing video properties gracefully', () => {
        const video = {};
        const result = classifier.classifyYouTubeContent(video);

        expect(result.platform).toBe('youtube');
        expect(result.type).toBe('video');
      });
    });
  });

  describe('URL Recognition', () => {
    it('should recognize X/Twitter URLs', () => {
      const urls = ['https://x.com/user/status/123', 'https://twitter.com/user/status/123', 'http://x.com/user'];

      urls.forEach(url => {
        expect(classifier.isXUrl(url)).toBe(true);
      });
    });

    it('should recognize YouTube URLs', () => {
      const urls = ['https://youtube.com/watch?v=123', 'https://www.youtube.com/watch?v=123', 'https://youtu.be/123'];

      urls.forEach(url => {
        expect(classifier.isYouTubeUrl(url)).toBe(true);
      });
    });

    it('should not recognize non-platform URLs', () => {
      const urls = ['https://google.com', 'https://facebook.com', 'invalid-url'];

      urls.forEach(url => {
        expect(classifier.isXUrl(url)).toBe(false);
        expect(classifier.isYouTubeUrl(url)).toBe(false);
      });
    });
  });

  describe('Content ID Extraction', () => {
    it('should extract YouTube video ID', () => {
      const urls = [
        'https://youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ',
        'https://youtube.com/embed/dQw4w9WgXcQ',
      ];

      urls.forEach(url => {
        const result = classifier.extractContentId(url);
        expect(result.platform).toBe('youtube');
        expect(result.type).toBe('video');
        expect(result.id).toBe('dQw4w9WgXcQ');
      });
    });

    it('should extract X status ID', () => {
      const url = 'https://x.com/user/status/1234567890';
      const result = classifier.extractContentId(url);

      expect(result.platform).toBe('x');
      expect(result.type).toBe('status');
      expect(result.id).toBe('1234567890');
    });

    it('should handle unknown URLs', () => {
      const result = classifier.extractContentId('https://unknown.com/content');

      expect(result.platform).toBe('unknown');
      expect(result.type).toBe('unknown');
      expect(result.id).toBe(null);
    });
  });

  describe('Statistics', () => {
    it('should return classification statistics', () => {
      const stats = classifier.getStats();

      expect(stats.supportedPlatforms).toContain('youtube');
      expect(stats.supportedPlatforms).toContain('x');
      expect(stats.xContentTypes).toContain('post');
      expect(stats.xContentTypes).toContain('reply');
      expect(stats.youtubeContentTypes).toContain('video');
      expect(stats.youtubeContentTypes).toContain('livestream');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty or whitespace text', () => {
      const result = classifier.classifyXContent('https://x.com/user/status/123', '   ');

      expect(result.type).toBe('post');
    });

    it('should handle very long text content', () => {
      const longText = 'A'.repeat(10000);
      const result = classifier.analyzeXContentType(longText);

      expect(result.type).toBe('post');
    });

    it('should handle malformed URLs gracefully', () => {
      const result = classifier.classifyXContent('not-a-url', 'text');
      expect(result.error).toBeDefined();
    });

    it('should handle missing metadata gracefully', () => {
      const result = classifier.analyzeXContentType('text', null);
      expect(result.type).toBe('post');
    });
  });
});
