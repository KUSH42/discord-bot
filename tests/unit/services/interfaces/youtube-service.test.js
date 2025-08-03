/**
 * @fileoverview Tests for YouTubeService interface contract
 */

import { YouTubeService } from '../../../../src/services/interfaces/youtube-service.js';

describe('YouTubeService Interface', () => {
  let service;

  beforeEach(() => {
    service = new YouTubeService();
  });

  describe('Interface Contract', () => {
    it('should define all required methods', () => {
      const requiredMethods = [
        'getVideoDetails',
        'getChannelDetails',
        'getChannelVideos',
        'searchVideos',
        'getVideoStatistics',
        'getPlaylistDetails',
        'getPlaylistVideos',
        'isVideoLive',
        'getLiveStreamDetails',
        'getVideoComments',
        'getChannelUploadPlaylist',
        'validateVideoId',
        'validateChannelId',
        'extractVideoId',
        'extractChannelId',
        'getQuotaUsage',
        'validateApiKey',
        'dispose',
      ];

      requiredMethods.forEach(method => {
        expect(service[method]).toBeDefined();
        expect(typeof service[method]).toBe('function');
      });
    });

    it('should be an abstract class throwing errors on API method calls', async () => {
      const apiMethods = [
        { name: 'getVideoDetails', args: ['dQw4w9WgXcQ'] },
        { name: 'getChannelDetails', args: ['UCuAXFkgsw1L7xaCfnd5JJOw'] },
        { name: 'getChannelVideos', args: ['UCuAXFkgsw1L7xaCfnd5JJOw'] },
        { name: 'searchVideos', args: ['nodejs tutorial'] },
        { name: 'getVideoStatistics', args: ['dQw4w9WgXcQ'] },
        { name: 'getPlaylistDetails', args: ['PLrAXtmRdnEQy1kIj1yI6PW8vfFWPJZZhX'] },
        { name: 'getPlaylistVideos', args: ['PLrAXtmRdnEQy1kIj1yI6PW8vfFWPJZZhX'] },
        { name: 'isVideoLive', args: ['dQw4w9WgXcQ'] },
        { name: 'getLiveStreamDetails', args: ['dQw4w9WgXcQ'] },
        { name: 'getVideoComments', args: ['dQw4w9WgXcQ'] },
        { name: 'getChannelUploadPlaylist', args: ['UCuAXFkgsw1L7xaCfnd5JJOw'] },
        { name: 'getQuotaUsage', args: [] },
        { name: 'validateApiKey', args: [] },
      ];

      for (const method of apiMethods) {
        await expect(service[method.name](...method.args)).rejects.toThrow(
          `Abstract method: ${method.name} must be implemented`
        );
      }
    });
  });

  describe('Method Signatures', () => {
    it('should validate video method signatures', () => {
      expect(service.getVideoDetails).toBeDefined();
      expect(service.getVideoDetails).toHaveLength(1); // videoId parameter

      expect(service.getVideoStatistics).toBeDefined();
      expect(service.getVideoStatistics).toHaveLength(1); // videoId parameter

      expect(service.isVideoLive).toBeDefined();
      expect(service.isVideoLive).toHaveLength(1); // videoId parameter
    });

    it('should validate channel method signatures', () => {
      expect(service.getChannelDetails).toBeDefined();
      expect(service.getChannelDetails).toHaveLength(1); // channelId parameter

      expect(service.getChannelVideos).toBeDefined();
      expect(service.getChannelVideos).toHaveLength(1); // channelId parameter (maxResults handled by eslint disable)

      expect(service.getChannelUploadPlaylist).toBeDefined();
      expect(service.getChannelUploadPlaylist).toHaveLength(1); // channelId parameter
    });

    it('should validate search and playlist method signatures', () => {
      expect(service.searchVideos).toBeDefined();
      expect(service.searchVideos).toHaveLength(1); // query parameter (options handled by eslint disable)

      expect(service.getPlaylistDetails).toBeDefined();
      expect(service.getPlaylistDetails).toHaveLength(1); // playlistId parameter

      expect(service.getPlaylistVideos).toBeDefined();
      expect(service.getPlaylistVideos).toHaveLength(1); // playlistId parameter
    });
  });

  describe('Video ID Validation', () => {
    it('should validate correct video IDs', () => {
      const validVideoIds = [
        'dQw4w9WgXcQ', // Rick Roll
        'jNQXAC9IVRw', // Me at the Zoo
        'kJQP7kiw5Fk', // Despacito
        '9bZkp7q19f0', // Gangnam Style
        'fJ9rUzIMcZQ', // Test ID
      ];

      validVideoIds.forEach(videoId => {
        expect(service.validateVideoId(videoId)).toBe(true);
      });
    });

    it('should reject invalid video IDs', () => {
      const invalidVideoIds = [
        '', // empty string
        'invalid', // too short
        'this-is-way-too-long-for-a-video-id', // too long
        'dQw4w9WgXc@', // invalid character
        'dQw4w9WgXc', // too short by 1
        'dQw4w9WgXcQQ', // too long by 1
        null,
        undefined,
        123,
        {},
      ];

      invalidVideoIds.forEach(videoId => {
        expect(service.validateVideoId(videoId)).toBe(false);
      });
    });

    it('should handle non-string input for video ID validation', () => {
      expect(service.validateVideoId(123)).toBe(false);
      expect(service.validateVideoId(null)).toBe(false);
      expect(service.validateVideoId(undefined)).toBe(false);
      expect(service.validateVideoId({})).toBe(false);
      expect(service.validateVideoId([])).toBe(false);
    });
  });

  describe('Channel ID Validation', () => {
    it('should validate correct channel IDs', () => {
      const validChannelIds = [
        'UCuAXFkgsw1L7xaCfnd5JJOw', // Random valid format
        'UC_x5XG1OV2P6uZZ5FSM9Ttw', // Google Developers
        'UCBVVhG9FHL5K2yMBtXjANhA', // Example channel
        'UCsooa4yRKGN_zEE8iknghZA', // TED-Ed
      ];

      validChannelIds.forEach(channelId => {
        expect(service.validateChannelId(channelId)).toBe(true);
      });
    });

    it('should reject invalid channel IDs', () => {
      const invalidChannelIds = [
        '', // empty string
        'invalid', // doesn't start with UC
        'ACuAXFkgsw1L7xaCfnd5JJOw', // starts with AC instead of UC
        'UCinvalid', // too short
        `UC${'a'.repeat(25)}`, // too long
        'UCuAXFkgsw1L7xaCfnd5JJO@', // invalid character
        null,
        undefined,
        123,
        {},
      ];

      invalidChannelIds.forEach(channelId => {
        expect(service.validateChannelId(channelId)).toBe(false);
      });
    });

    it('should handle non-string input for channel ID validation', () => {
      expect(service.validateChannelId(123)).toBe(false);
      expect(service.validateChannelId(null)).toBe(false);
      expect(service.validateChannelId(undefined)).toBe(false);
      expect(service.validateChannelId({})).toBe(false);
      expect(service.validateChannelId([])).toBe(false);
    });
  });

  describe('Video ID Extraction', () => {
    it('should extract video ID from standard YouTube URLs', () => {
      const testCases = [
        { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
        { url: 'https://youtu.be/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
        { url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
        { url: 'https://www.youtube.com/v/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
        { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be', expected: 'dQw4w9WgXcQ' },
      ];

      testCases.forEach(({ url, expected }) => {
        expect(service.extractVideoId(url)).toBe(expected);
      });
    });

    it('should return video ID if input is already a valid video ID', () => {
      const videoId = 'dQw4w9WgXcQ';
      expect(service.extractVideoId(videoId)).toBe(videoId);
    });

    it('should return null for invalid URLs', () => {
      const invalidUrls = [
        'https://example.com/watch?v=invalid',
        'https://youtube.com/watch?v=invalid',
        'not-a-url',
        '',
        null,
        undefined,
        123,
        {},
      ];

      invalidUrls.forEach(url => {
        expect(service.extractVideoId(url)).toBe(null);
      });
    });

    it('should handle various YouTube URL formats', () => {
      const urlFormats = [
        'youtube.com/watch?v=dQw4w9WgXcQ',
        'www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtube.com/watch?v=dQw4w9WgXcQ',
        'http://youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ?t=10',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLtest',
      ];

      urlFormats.forEach(url => {
        expect(service.extractVideoId(url)).toBe('dQw4w9WgXcQ');
      });
    });
  });

  describe('Channel ID Extraction', () => {
    it('should extract channel ID from various YouTube channel URLs', () => {
      const testCases = [
        { url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw', expected: 'UCuAXFkgsw1L7xaCfnd5JJOw' },
        { url: 'https://www.youtube.com/c/channelname', expected: 'channelname' },
        { url: 'https://www.youtube.com/user/username', expected: 'username' },
        { url: 'https://www.youtube.com/@handlename', expected: 'handlename' },
      ];

      testCases.forEach(({ url, expected }) => {
        expect(service.extractChannelId(url)).toBe(expected);
      });
    });

    it('should return channel ID if input is already a valid channel ID', () => {
      const channelId = 'UCuAXFkgsw1L7xaCfnd5JJOw';
      expect(service.extractChannelId(channelId)).toBe(channelId);
    });

    it('should return null for invalid channel URLs', () => {
      const invalidUrls = [
        'https://example.com/channel/invalid',
        'https://youtube.com/invalid',
        'not-a-url',
        '',
        null,
        undefined,
        123,
        {},
      ];

      invalidUrls.forEach(url => {
        expect(service.extractChannelId(url)).toBe(null);
      });
    });
  });

  describe('Video Operations', () => {
    it('should handle video details retrieval', async () => {
      const videoId = 'dQw4w9WgXcQ';

      await expect(service.getVideoDetails(videoId)).rejects.toThrow(
        'Abstract method: getVideoDetails must be implemented'
      );
    });

    it('should handle video statistics retrieval', async () => {
      const videoId = 'dQw4w9WgXcQ';

      await expect(service.getVideoStatistics(videoId)).rejects.toThrow(
        'Abstract method: getVideoStatistics must be implemented'
      );
    });

    it('should handle live video detection', async () => {
      const videoId = 'dQw4w9WgXcQ';

      await expect(service.isVideoLive(videoId)).rejects.toThrow('Abstract method: isVideoLive must be implemented');
    });

    it('should handle live stream details', async () => {
      const videoId = 'dQw4w9WgXcQ';

      await expect(service.getLiveStreamDetails(videoId)).rejects.toThrow(
        'Abstract method: getLiveStreamDetails must be implemented'
      );
    });

    it('should handle video comments retrieval', async () => {
      const videoId = 'dQw4w9WgXcQ';

      await expect(service.getVideoComments(videoId)).rejects.toThrow(
        'Abstract method: getVideoComments must be implemented'
      );
    });
  });

  describe('Channel Operations', () => {
    it('should handle channel details retrieval', async () => {
      const channelId = 'UCuAXFkgsw1L7xaCfnd5JJOw';

      await expect(service.getChannelDetails(channelId)).rejects.toThrow(
        'Abstract method: getChannelDetails must be implemented'
      );
    });

    it('should handle channel videos retrieval', async () => {
      const channelId = 'UCuAXFkgsw1L7xaCfnd5JJOw';

      await expect(service.getChannelVideos(channelId)).rejects.toThrow(
        'Abstract method: getChannelVideos must be implemented'
      );
    });

    it('should handle channel upload playlist retrieval', async () => {
      const channelId = 'UCuAXFkgsw1L7xaCfnd5JJOw';

      await expect(service.getChannelUploadPlaylist(channelId)).rejects.toThrow(
        'Abstract method: getChannelUploadPlaylist must be implemented'
      );
    });
  });

  describe('Playlist Operations', () => {
    it('should handle playlist details retrieval', async () => {
      const playlistId = 'PLrAXtmRdnEQy1kIj1yI6PW8vfFWPJZZhX';

      await expect(service.getPlaylistDetails(playlistId)).rejects.toThrow(
        'Abstract method: getPlaylistDetails must be implemented'
      );
    });

    it('should handle playlist videos retrieval', async () => {
      const playlistId = 'PLrAXtmRdnEQy1kIj1yI6PW8vfFWPJZZhX';

      await expect(service.getPlaylistVideos(playlistId)).rejects.toThrow(
        'Abstract method: getPlaylistVideos must be implemented'
      );
    });
  });

  describe('Search Operations', () => {
    it('should handle video search', async () => {
      const query = 'nodejs tutorial';

      await expect(service.searchVideos(query)).rejects.toThrow('Abstract method: searchVideos must be implemented');
    });
  });

  describe('API Management', () => {
    it('should handle quota usage retrieval', async () => {
      await expect(service.getQuotaUsage()).rejects.toThrow('Abstract method: getQuotaUsage must be implemented');
    });

    it('should handle API key validation', async () => {
      await expect(service.validateApiKey()).rejects.toThrow('Abstract method: validateApiKey must be implemented');
    });
  });

  describe('Resource Management', () => {
    it('should have dispose method', () => {
      expect(service.dispose).toBeDefined();
      expect(typeof service.dispose).toBe('function');
    });

    it('should implement dispose method with no-op', async () => {
      // Default implementation should not throw
      await expect(service.dispose()).resolves.toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string inputs gracefully', () => {
      expect(service.validateVideoId('')).toBe(false);
      expect(service.validateChannelId('')).toBe(false);
      expect(service.extractVideoId('')).toBe(null);
      expect(service.extractChannelId('')).toBe(null);
    });

    it('should handle special characters in validation', () => {
      expect(service.validateVideoId('dQw4w9WgXc@')).toBe(false);
      expect(service.validateChannelId('UCuAXFkgsw1L7xaCfnd5JJO@')).toBe(false);
    });

    it('should handle boundary cases for ID lengths', () => {
      // Video ID boundary cases (should be 11 characters)
      expect(service.validateVideoId('dQw4w9WgXc')).toBe(false); // 10 chars
      expect(service.validateVideoId('dQw4w9WgXcQ')).toBe(true); // 11 chars
      expect(service.validateVideoId('dQw4w9WgXcQQ')).toBe(false); // 12 chars

      // Channel ID boundary cases (should be 24 characters starting with UC)
      expect(service.validateChannelId('UCuAXFkgsw1L7xaCfnd5JJO')).toBe(false); // 23 chars
      expect(service.validateChannelId('UCuAXFkgsw1L7xaCfnd5JJOw')).toBe(true); // 24 chars
      expect(service.validateChannelId('UCuAXFkgsw1L7xaCfnd5JJOwx')).toBe(false); // 25 chars
    });
  });

  describe('Integration with Validation Methods', () => {
    it('should validate extracted video IDs', () => {
      const extractedId = service.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(extractedId).toBe('dQw4w9WgXcQ');
      expect(service.validateVideoId(extractedId)).toBe(true);
    });

    it('should validate extracted channel IDs', () => {
      const extractedId = service.extractChannelId('https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw');
      expect(extractedId).toBe('UCuAXFkgsw1L7xaCfnd5JJOw');
      expect(service.validateChannelId(extractedId)).toBe(true);
    });
  });
});
