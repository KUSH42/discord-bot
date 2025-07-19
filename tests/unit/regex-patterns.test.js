import { describe, it, expect, beforeEach } from '@jest/globals';
import { videoUrlRegex, tweetUrlRegex } from '../../src/duplicate-detector.js';

describe('URL Regex Pattern Tests', () => {
  // Using imported regex patterns from src/duplicate-detector.js

  describe('YouTube URL Pattern Matching', () => {
    const testCases = [
      {
        description: 'Standard YouTube watch URL',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
      },
      {
        description: 'YouTube short URL',
        url: 'https://youtu.be/dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
      },
      {
        description: 'YouTube Shorts URL',
        url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
      },
      {
        description: 'YouTube embed URL',
        url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
      },
      {
        description: 'YouTube live URL',
        url: 'https://www.youtube.com/live/dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
      },
      {
        description: 'YouTube v/ URL format',
        url: 'https://www.youtube.com/v/dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
      },
      {
        description: 'YouTube URL without www',
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
      },
      {
        description: 'HTTP YouTube URL',
        url: 'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
      },
    ];

    testCases.forEach(({ description, url, expectedId }) => {
      it(`should extract video ID from ${description}`, () => {
        const matches = [...url.matchAll(videoUrlRegex)];
        expect(matches).toHaveLength(1);
        expect(matches[0][1]).toBe(expectedId);
      });
    });

    it('should handle YouTube URLs with additional parameters', () => {
      const urlWithParams = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLrAXtmRdnEQy6nuLviYjIbjG1Bc8BzD8G';
      const matches = [...urlWithParams.matchAll(videoUrlRegex)];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe('dQw4w9WgXcQ');
    });

    it('should extract multiple video IDs from text with multiple URLs', () => {
      const text = 'Check these videos: https://youtu.be/abc12345678 and https://www.youtube.com/watch?v=def98765432';
      const matches = [...text.matchAll(videoUrlRegex)];
      expect(matches).toHaveLength(2);
      expect(matches[0][1]).toBe('abc12345678');
      expect(matches[1][1]).toBe('def98765432');
    });

    it('should not match invalid YouTube URLs', () => {
      const invalidUrls = [
        'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
        'https://www.youtube.com/user/rickastleyofficial',
        'https://www.youtube.com/playlist?list=PLrAXtmRdnEQy6nuLviYjIbjG1Bc8BzD8G',
        'https://www.youtube.com/watch?v=',
        'https://www.youtube.com/watch?v=invalid',
        'https://not-youtube.com/watch?v=dQw4w9WgXcQ',
      ];

      invalidUrls.forEach(url => {
        const matches = [...url.matchAll(videoUrlRegex)];
        expect(matches).toHaveLength(0);
      });
    });

    it('should validate video ID format (11 characters, alphanumeric + _ -)', () => {
      const validIds = ['dQw4w9WgXcQ', 'abc123456_7', 'DEF-9876543'];
      const invalidIds = ['short', 'toolongvideoid1', 'invalid@id'];

      validIds.forEach(id => {
        const url = `https://www.youtube.com/watch?v=${id}`;
        const matches = [...url.matchAll(videoUrlRegex)];
        expect(matches).toHaveLength(1);
        expect(matches[0][1]).toBe(id);
      });

      invalidIds.forEach(id => {
        const url = `https://www.youtube.com/watch?v=${id}`;
        const matches = [...url.matchAll(videoUrlRegex)];
        // Invalid IDs should not match or match with different length
        if (matches.length > 0) {
          expect(matches[0][1]).not.toBe(id);
        } else {
          expect(matches).toHaveLength(0);
        }
      });
    });
  });

  describe('X/Twitter URL Pattern Matching', () => {
    const testCases = [
      {
        description: 'X.com status URL',
        url: 'https://x.com/user/status/1234567890123456789',
        expectedId: '1234567890123456789',
      },
      {
        description: 'Twitter.com status URL',
        url: 'https://twitter.com/elonmusk/status/9876543210987654321',
        expectedId: '9876543210987654321',
      },
      {
        description: 'VX Twitter URL',
        url: 'https://vxtwitter.com/user/status/1111222233334444555',
        expectedId: '1111222233334444555',
      },
      {
        description: 'FX Twitter URL',
        url: 'https://fxtwitter.com/user/status/5555444433332222111',
        expectedId: '5555444433332222111',
      },
      {
        description: 'Nitter URL',
        url: 'https://nitter.net/user/status/9999888877776666555',
        expectedId: '9999888877776666555',
      },
      {
        description: 'X.com i/web/status URL',
        url: 'https://x.com/i/web/status/1234567890123456789',
        expectedId: '1234567890123456789',
      },
      {
        description: 'Twitter with subdomain',
        url: 'https://mobile.twitter.com/user/status/1111111111111111111',
        expectedId: '1111111111111111111',
      },
      {
        description: 'HTTP X.com URL',
        url: 'http://x.com/user/status/2222222222222222222',
        expectedId: '2222222222222222222',
      },
    ];

    testCases.forEach(({ description, url, expectedId }) => {
      it(`should extract tweet ID from ${description}`, () => {
        const matches = [...url.matchAll(tweetUrlRegex)];
        expect(matches).toHaveLength(1);
        expect(matches[0][1]).toBe(expectedId);
      });
    });

    it('should extract multiple tweet IDs from text with multiple URLs', () => {
      const text =
        'Check these tweets: https://x.com/user1/status/1111111111 and https://twitter.com/user2/status/2222222222';
      const matches = [...text.matchAll(tweetUrlRegex)];
      expect(matches).toHaveLength(2);
      expect(matches[0][1]).toBe('1111111111');
      expect(matches[1][1]).toBe('2222222222');
    });

    it('should not match invalid Twitter URLs', () => {
      const invalidUrls = [
        'https://x.com/user',
        'https://x.com/user/followers',
        'https://twitter.com/user/media',
        'https://x.com/user/status/',
        'https://x.com/user/status/invalid',
        'https://not-twitter.com/user/status/123',
      ];

      invalidUrls.forEach(url => {
        const matches = [...url.matchAll(tweetUrlRegex)];
        expect(matches).toHaveLength(0);
      });
    });

    it('should validate tweet ID format (numeric only)', () => {
      const validIds = ['1234567890123456789', '1234567890', '999999999999999999'];
      const invalidIds = ['abc123', '123abc', '123-456', '123', '1']; // Short IDs are invalid

      validIds.forEach(id => {
        const url = `https://x.com/user/status/${id}`;
        const matches = [...url.matchAll(tweetUrlRegex)];
        expect(matches).toHaveLength(1);
        expect(matches[0][1]).toBe(id);
      });

      invalidIds.forEach(id => {
        const url = `https://x.com/user/status/${id}`;
        const matches = [...url.matchAll(tweetUrlRegex)];
        // Invalid IDs should not match (non-numeric or too short IDs won't match)
        expect(matches).toHaveLength(0);
      });
    });

    it('should confirm capture group indexing (match[1] not match[2])', () => {
      const testUrl = 'https://x.com/user/status/1234567890123456789';
      const matches = [...testUrl.matchAll(tweetUrlRegex)];

      expect(matches).toHaveLength(1);
      expect(matches[0][0]).toBe(testUrl); // Full match
      expect(matches[0][1]).toBe('1234567890123456789'); // Tweet ID (correct index)
      expect(matches[0][2]).toBeUndefined(); // Should be undefined
    });
  });

  describe('Regex Performance and Edge Cases', () => {
    it('should handle very long text with many URLs efficiently', () => {
      const longText = Array(1000)
        .fill(0)
        .map((_, i) => `Text ${i} https://www.youtube.com/watch?v=video${i.toString().padStart(7, '0')} more text`)
        .join(' ');

      const start = performance.now();
      const matches = [...longText.matchAll(videoUrlRegex)];
      const end = performance.now();

      expect(matches).toHaveLength(1000);
      expect(end - start).toBeLessThan(100); // Should complete in under 100ms
    });

    it('should handle mixed YouTube and Twitter URLs in same text', () => {
      const mixedText =
        'Check this video https://youtu.be/dQw4w9WgXcQ and this tweet https://x.com/user/status/1234567890';

      const videoMatches = [...mixedText.matchAll(videoUrlRegex)];
      const tweetMatches = [...mixedText.matchAll(tweetUrlRegex)];

      expect(videoMatches).toHaveLength(1);
      expect(videoMatches[0][1]).toBe('dQw4w9WgXcQ');

      expect(tweetMatches).toHaveLength(1);
      expect(tweetMatches[0][1]).toBe('1234567890');
    });

    it('should handle URLs with special characters and encoding', () => {
      const encodedUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be&t=1m42s';
      const matches = [...encodedUrl.matchAll(videoUrlRegex)];

      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe('dQw4w9WgXcQ');
    });

    it('should reset regex state between matches due to global flag', () => {
      const text = 'https://youtu.be/video001abc and https://youtu.be/video002def';

      // First search
      const firstMatches = [...text.matchAll(videoUrlRegex)];
      expect(firstMatches).toHaveLength(2);

      // Second search should yield same results
      const secondMatches = [...text.matchAll(videoUrlRegex)];
      expect(secondMatches).toHaveLength(2);
      expect(secondMatches[0][1]).toBe(firstMatches[0][1]);
    });
  });

  describe('Regex Capture Group Analysis', () => {
    it('should use non-capturing groups for alternative matching', () => {
      // Verify regex uses (?:...) for grouping without capturing
      expect(videoUrlRegex.source).toContain('(?:');
      expect(tweetUrlRegex.source).toContain('(?:');
    });
  });
});
