import { describe, it, expect, beforeEach, jest } from '@jest/globals';
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

    describe('Enhanced Reply Detection', () => {
      it('should detect reply from socialContext metadata', () => {
        const result = classifier.analyzeXContentType('This is a tweet', {
          socialContext: 'Replying to @username',
          xUser: 'testuser',
        });
        expect(result.type).toBe('reply');
        expect(result.confidence).toBeGreaterThan(0.8);
      });

      it('should detect reply from allText metadata', () => {
        const result = classifier.analyzeXContentType('This is a tweet', {
          allText: 'Replying to @username\nThis is a tweet',
          xUser: 'testuser',
        });
        expect(result.type).toBe('reply');
        expect(result.confidence).toBeGreaterThan(0.8);
      });

      it('should include socialContext in reply indicators', () => {
        const indicators = classifier.getReplyIndicators('Some text', {
          socialContext: 'Replying to @testuser',
        });
        expect(indicators).toContain('Social context: Replying to @testuser');
      });

      it('should detect reply with case-insensitive social context', () => {
        const result = classifier.analyzeXContentType('This is a tweet', {
          socialContext: 'REPLYING TO @username',
          xUser: 'testuser',
        });
        expect(result.type).toBe('reply');
      });
    });

    describe('Enhanced Quote Detection', () => {
      it('should detect quote from quoteTweetBlock metadata', () => {
        const result = classifier.analyzeXContentType('My comment about this tweet', {
          quoteTweetBlock: true,
          xUser: 'testuser',
        });
        expect(result.type).toBe('quote');
        expect(result.confidence).toBeGreaterThan(0.8);
      });

      it('should detect quote from embedded URL in allText', () => {
        const result = classifier.analyzeXContentType('My comment', {
          allText: 'My comment https://x.com/other/status/123456789',
          xUser: 'testuser',
        });
        expect(result.type).toBe('quote');
        expect(result.confidence).toBeGreaterThan(0.8);
      });

      it('should include quoteTweetBlock in quote indicators', () => {
        const indicators = classifier.getQuoteIndicators('Some text', {
          quoteTweetBlock: true,
        });
        expect(indicators).toContain('Quote tweet block detected in DOM');
      });

      it('should include embedded URL from allText in indicators', () => {
        const indicators = classifier.getQuoteIndicators('Some text', {
          allText: 'Some text https://x.com/user/status/123',
        });
        expect(indicators.some(indicator => indicator.includes('Contains embedded tweet URL in full content'))).toBe(
          true
        );
      });
    });

    describe('Author-based Retweet Detection', () => {
      it('should detect retweet when author differs from monitored user', () => {
        const result = classifier.classifyXContent('https://x.com/user/status/1234567890', 'Some tweet content', {
          author: 'differentuser',
          xUser: 'testuser',
        });

        expect(result.type).toBe('retweet');
        expect(result.confidence).toBeGreaterThan(0.9);
      });

      it('should detect retweet when author differs from monitored user with @ prefix', () => {
        const result = classifier.classifyXContent('https://x.com/user/status/1234567890', 'Some tweet content', {
          author: 'differentuser',
          xUser: '@testuser',
        });

        expect(result.type).toBe('retweet');
        expect(result.confidence).toBeGreaterThan(0.9);
      });

      it('should NOT detect retweet when author matches monitored user', () => {
        const result = classifier.classifyXContent('https://x.com/user/status/1234567890', 'Some tweet content', {
          author: 'testuser',
          xUser: 'testuser',
        });

        expect(result.type).toBe('post');
      });

      it('should NOT detect retweet when author matches monitored user with @ prefix', () => {
        const result = classifier.classifyXContent('https://x.com/user/status/1234567890', 'Some tweet content', {
          author: '@testuser',
          xUser: 'testuser',
        });

        expect(result.type).toBe('post');
      });

      it('should ignore Unknown authors', () => {
        const result = classifier.classifyXContent('https://x.com/user/status/1234567890', 'Some tweet content', {
          author: 'Unknown',
          xUser: 'testuser',
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

      it('should fallback to text-based detection when xUser metadata is missing', () => {
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

  describe('Enhanced Retweet Detection', () => {
    it('should detect retweet using DOM element with socialContext', () => {
      const mockElement = {
        querySelector: jest.fn().mockReturnValue({
          textContent: 'User retweeted',
        }),
      };

      const result = classifier.classifyXContent('https://x.com/user/status/123', 'Some content', {
        domElement: mockElement,
      });

      expect(result.type).toBe('retweet');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should handle DOM element without querySelector', () => {
      const mockElement = {}; // No querySelector method

      const result = classifier.classifyXContent('https://x.com/user/status/123', 'Some content', {
        domElement: mockElement,
      });

      expect(result.type).toBe('post'); // Should fallback to text analysis
    });

    it('should extract retweet author from social context', () => {
      const mockSocialContext = {
        textContent: 'Username retweeted',
      };

      const extractedAuthor = classifier.extractRetweetAuthor(mockSocialContext);
      expect(extractedAuthor).toContain('Username');
    });

    it('should handle social context extraction errors gracefully', () => {
      const mockSocialContext = null;

      const extractedAuthor = classifier.extractRetweetAuthor(mockSocialContext);
      expect(extractedAuthor).toBeNull();
    });

    it('should detect retweet using multiple detection strategies', () => {
      const mockElement = {
        querySelector: jest.fn().mockReturnValue(null), // No socialContext
      };

      const enhancedResult = classifier.enhancedRetweetDetection(mockElement);
      expect(enhancedResult).toHaveProperty('isRetweet');
      expect(enhancedResult).toHaveProperty('confidence');
      expect(enhancedResult).toHaveProperty('method');
    });

    it('should handle null DOM element in enhanced detection', () => {
      const enhancedResult = classifier.enhancedRetweetDetection(null);

      expect(enhancedResult.isRetweet).toBe(false);
      expect(enhancedResult.confidence).toBe(0);
      expect(enhancedResult.method).toBe('no-element');
    });

    it('should detect retweet by reposted text', () => {
      const result = classifier.analyzeXContentType('User reposted this tweet');

      expect(result.type).toBe('retweet');
      expect(result.confidence).toBeGreaterThan(0.7);
    });
  });

  describe('Retweet and Quote Indicators', () => {
    it('should get retweet indicators with enhanced detection', () => {
      const mockElement = {
        querySelector: jest.fn().mockReturnValue({
          textContent: 'User retweeted',
        }),
      };

      const indicators = classifier.getRetweetIndicators('RT @someone text', {
        domElement: mockElement,
        retweetedStatus: true,
      });

      expect(indicators).toContain('Has retweeted status metadata');
      expect(indicators).toContain('Starts with RT @');
      expect(indicators.some(indicator => indicator.includes('Enhanced detection'))).toBe(true);
    });

    it('should get retweet indicators with reposted text', () => {
      const indicators = classifier.getRetweetIndicators('User reposted this content');

      expect(indicators).toContain('Contains "reposted" text');
    });

    it('should get quote indicators with quoted status metadata', () => {
      const indicators = classifier.getQuoteIndicators('Quote text https://x.com/user/status/123', {
        quotedStatus: true,
      });

      expect(indicators).toContain('Has quoted status metadata');
      expect(indicators.some(indicator => indicator.includes('Contains embedded tweet URL'))).toBe(true);
    });

    it('should handle empty text for indicators', () => {
      const retweetIndicators = classifier.getRetweetIndicators('');
      const quoteIndicators = classifier.getQuoteIndicators('', {});

      expect(Array.isArray(retweetIndicators)).toBe(true);
      expect(Array.isArray(quoteIndicators)).toBe(true);
    });
  });

  describe('URL Pattern Extraction Edge Cases', () => {
    it('should extract YouTube channel ID from URL', () => {
      const url = 'https://youtube.com/channel/UC1234567890123456789012';
      const result = classifier.extractContentId(url);

      expect(result.platform).toBe('youtube');
      expect(result.type).toBe('channel');
      expect(result.id).toBe('UC1234567890123456789012');
    });

    it('should extract X profile from URL', () => {
      const url = 'https://x.com/username';
      const result = classifier.extractContentId(url);

      expect(result.platform).toBe('x');
      expect(result.type).toBe('profile');
      expect(result.id).toBe('username');
    });

    it('should handle YouTube URLs without video ID', () => {
      const url = 'https://youtube.com/watch';
      const result = classifier.extractContentId(url);

      expect(result.platform).toBe('unknown');
      expect(result.type).toBe('unknown');
      expect(result.id).toBeNull();
    });

    it('should handle X URLs without status ID', () => {
      const url = 'https://x.com/user/status/';
      const result = classifier.extractContentId(url);

      expect(result.platform).toBe('unknown');
      expect(result.type).toBe('unknown');
      expect(result.id).toBeNull();
    });
  });

  describe('Advanced YouTube Classification', () => {
    it('should handle video with missing content details', () => {
      const video = {
        id: 'video123',
        snippet: {
          title: 'Test Video',
          liveBroadcastContent: 'none',
        },
        // Missing contentDetails
      };

      const result = classifier.classifyYouTubeContent(video);

      expect(result.platform).toBe('youtube');
      expect(result.type).toBe('video');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('should handle video with missing snippet', () => {
      const video = {
        id: 'video123',
        // Missing snippet
        contentDetails: {
          duration: 'PT5M',
        },
      };

      const result = classifier.classifyYouTubeContent(video);

      expect(result.platform).toBe('youtube');
      expect(result.type).toBe('video');
    });

    it('should classify ended livestream correctly', () => {
      const video = {
        id: 'endedLive',
        snippet: {
          liveBroadcastContent: 'none',
        },
        liveStreamingDetails: {
          actualStartTime: '2023-01-01T12:00:00Z',
          actualEndTime: '2023-01-01T14:00:00Z',
        },
      };

      const result = classifier.classifyYouTubeContent(video);

      expect(result.platform).toBe('youtube');
      expect(result.type).toBe('video'); // Ended livestream becomes a video
    });

    it('should handle premiere video', () => {
      const video = {
        id: 'premiere123',
        snippet: {
          liveBroadcastContent: 'upcoming',
          title: 'Premiere Video',
        },
        liveStreamingDetails: {
          scheduledStartTime: '2023-01-01T15:00:00Z',
        },
        contentDetails: {
          duration: 'PT10M',
        },
      };

      const result = classifier.classifyYouTubeContent(video);

      expect(result.platform).toBe('youtube');
      expect(result.type).toBe('upcoming');
    });
  });

  describe('Text Content Analysis Edge Cases', () => {
    it('should handle null text in quote tweet detection', () => {
      const result = classifier.isQuoteTweet(null, {});
      expect(result).toBe(false);
    });

    it('should handle undefined metadata in quote tweet detection', () => {
      const result = classifier.isQuoteTweet('Some text', undefined);
      expect(result).toBe(false);
    });

    it('should detect quote tweet with quoteTweetUrl metadata', () => {
      const result = classifier.isQuoteTweet('Some text', {
        quoteTweetUrl: 'https://x.com/other/status/123',
      });
      expect(result).toBe(true);
    });

    it('should handle complex retweet patterns', () => {
      const testCases = ['RT @user: This is a retweet', 'User retweeted', 'This was reposted by someone', 'RT @user'];

      testCases.forEach(text => {
        const result = classifier.analyzeXContentType(text);
        expect(result.type).toBe('retweet');
      });
    });

    it('should handle mixed content patterns', () => {
      const result = classifier.analyzeXContentType('@user This is a reply with https://x.com/other/status/123');

      // Should prioritize reply detection over quote detection
      expect(result.type).toBe('reply');
    });
  });

  describe('Platform Detection Accuracy', () => {
    it('should correctly identify X platform variations', () => {
      const urls = [
        'https://x.com/user',
        'https://twitter.com/user',
        'http://x.com/user',
        'https://www.x.com/user',
        'https://mobile.x.com/user',
      ];

      urls.forEach(url => {
        expect(classifier.isXUrl(url)).toBe(true);
      });
    });

    it('should correctly identify YouTube platform variations', () => {
      const urls = [
        'https://youtube.com/watch?v=123',
        'https://www.youtube.com/watch?v=123',
        'https://m.youtube.com/watch?v=123',
        'https://youtu.be/123',
        'http://youtube.com/watch?v=123',
      ];

      urls.forEach(url => {
        expect(classifier.isYouTubeUrl(url)).toBe(true);
      });
    });

    it('should reject similar but invalid URLs', () => {
      const invalidUrls = [
        'https://xitter.com/user',
        'https://youtub.com/watch',
        'https://x-com.fake/user',
        'https://fake-youtube.com/watch',
      ];

      invalidUrls.forEach(url => {
        expect(classifier.isXUrl(url)).toBe(false);
        expect(classifier.isYouTubeUrl(url)).toBe(false);
      });
    });
  });

  describe('Statistics and Metadata', () => {
    it('should return comprehensive statistics', () => {
      const stats = classifier.getStats();

      expect(stats).toHaveProperty('supportedPlatforms');
      expect(stats).toHaveProperty('xContentTypes');
      expect(stats).toHaveProperty('youtubeContentTypes');
      expect(stats.supportedPlatforms).toEqual(['youtube', 'x']);
      expect(stats.xContentTypes).toContain('post');
      expect(stats.xContentTypes).toContain('reply');
      expect(stats.xContentTypes).toContain('retweet');
      expect(stats.xContentTypes).toContain('quote');
      expect(stats.youtubeContentTypes).toContain('video');
      expect(stats.youtubeContentTypes).toContain('livestream');
      expect(stats.youtubeContentTypes).toContain('upcoming');
      expect(stats.youtubeContentTypes).toContain('short');
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

    it('should handle circular references in metadata', () => {
      const circularMetadata = {};
      circularMetadata.self = circularMetadata;

      const result = classifier.classifyXContent('https://x.com/user/status/123', 'text', circularMetadata);
      expect(result.type).toBe('post');
    });

    it('should handle extremely nested metadata', () => {
      const deepMetadata = { level1: { level2: { level3: { value: 'deep' } } } };

      const result = classifier.classifyXContent('https://x.com/user/status/123', 'text', deepMetadata);
      expect(result.type).toBe('post');
    });

    it('should handle non-string text input', () => {
      const result = classifier.analyzeXContentType(123);
      expect(result.type).toBe('post');
    });

    it('should handle special characters in URLs', () => {
      const url = 'https://x.com/user_123/status/1234567890?ref=special&utm=test';
      const result = classifier.extractContentId(url);

      expect(result.platform).toBe('x');
      expect(result.type).toBe('status');
      expect(result.id).toBe('1234567890');
    });
  });
});
