import { jest } from '@jest/globals';
import { google } from 'googleapis';
import { YouTubeApiService } from '../../../src/services/implementations/youtube-api-service.js';

// Mock all YouTube API methods
const mockVideosList = jest.fn();
const mockChannelsList = jest.fn();
const mockPlaylistsList = jest.fn();
const mockPlaylistItemsList = jest.fn();
const mockSearchList = jest.fn();
const mockCommentThreadsList = jest.fn();

jest.spyOn(google, 'youtube').mockReturnValue({
  videos: { list: mockVideosList },
  channels: { list: mockChannelsList },
  playlists: { list: mockPlaylistsList },
  playlistItems: { list: mockPlaylistItemsList },
  search: { list: mockSearchList },
  commentThreads: { list: mockCommentThreadsList },
});

describe('YouTubeApiService', () => {
  let youtubeService;
  let mockLogger;
  let mockYouTubeApi;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    mockYouTubeApi = {
      videos: { list: mockVideosList },
      channels: { list: mockChannelsList },
      playlists: { list: mockPlaylistsList },
      playlistItems: { list: mockPlaylistItemsList },
      search: { list: mockSearchList },
      commentThreads: { list: mockCommentThreadsList },
    };

    youtubeService = new YouTubeApiService({
      logger: mockLogger,
      youtube: mockYouTubeApi,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with provided dependencies', () => {
      expect(youtubeService.logger).toBe(mockLogger);
      expect(youtubeService.youtube).toBe(mockYouTubeApi);
    });

    it('should create google youtube instance when not provided', () => {
      const originalEnv = process.env.YOUTUBE_API_KEY;
      process.env.YOUTUBE_API_KEY = 'test-api-key';

      const service = new YouTubeApiService({ logger: mockLogger });
      expect(service.youtube).toBeDefined();

      process.env.YOUTUBE_API_KEY = originalEnv;
    });
  });

  describe('getVideoDetails', () => {
    const validVideoId = 'dQw4w9WgXcQ';
    const mockVideoData = {
      items: [
        {
          id: validVideoId,
          snippet: {
            title: 'Test Video',
            channelTitle: 'Test Channel',
            description: 'Test description',
            publishedAt: '2023-01-01T00:00:00Z',
          },
          contentDetails: { duration: 'PT4M33S' },
          statistics: { viewCount: '1000', likeCount: '100' },
          liveStreamingDetails: { scheduledStartTime: new Date().toISOString() },
        },
      ],
    };

    it('should fetch video details successfully', async () => {
      mockVideosList.mockResolvedValue({ data: mockVideoData });

      const result = await youtubeService.getVideoDetails(validVideoId);

      expect(result).toEqual(mockVideoData.items[0]);
      expect(mockVideosList).toHaveBeenCalledWith({
        part: 'snippet,contentDetails,liveStreamingDetails,statistics',
        id: validVideoId,
      });
    });

    it('should return null when video not found', async () => {
      mockVideosList.mockResolvedValue({ data: { items: [] } });

      const result = await youtubeService.getVideoDetails(validVideoId);

      expect(result).toBeNull();
    });

    it('should throw error for invalid video ID', async () => {
      await expect(youtubeService.getVideoDetails('')).rejects.toThrow('Invalid video ID:');
      await expect(youtubeService.getVideoDetails(null)).rejects.toThrow('Invalid video ID:');
    });

    it('should handle API errors', async () => {
      const apiError = new Error('API quota exceeded');
      mockVideosList.mockRejectedValue(apiError);

      await expect(youtubeService.getVideoDetails(validVideoId)).rejects.toThrow(
        `Failed to fetch video details for ${validVideoId}: API quota exceeded`
      );
    });
  });

  describe('getChannelDetails', () => {
    const validChannelId = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
    const mockChannelData = {
      items: [
        {
          id: validChannelId,
          snippet: {
            title: 'Test Channel',
            description: 'Test channel description',
            customUrl: '@testchannel',
          },
          statistics: {
            subscriberCount: '1000000',
            videoCount: '500',
          },
        },
      ],
    };

    it('should fetch channel details successfully', async () => {
      mockChannelsList.mockResolvedValue({ data: mockChannelData });

      const result = await youtubeService.getChannelDetails(validChannelId);

      expect(result).toEqual(mockChannelData.items[0]);
      expect(mockChannelsList).toHaveBeenCalledWith({
        part: 'snippet,contentDetails,statistics',
        id: validChannelId,
      });
    });

    it('should return null when channel not found', async () => {
      mockChannelsList.mockResolvedValue({ data: { items: [] } });

      const result = await youtubeService.getChannelDetails(validChannelId);

      expect(result).toBeNull();
    });

    it('should throw error for invalid channel ID', async () => {
      await expect(youtubeService.getChannelDetails('')).rejects.toThrow('Invalid channel ID:');
    });

    it('should handle API errors', async () => {
      mockChannelsList.mockRejectedValue(new Error('Network error'));

      await expect(youtubeService.getChannelDetails(validChannelId)).rejects.toThrow('Failed to fetch channel details');
    });
  });

  describe('getChannelVideos', () => {
    const validChannelId = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
    const uploadPlaylistId = 'UU_x5XG1OV2P6uZZ5FSM9Ttw';

    const mockChannelResponse = {
      items: [
        {
          contentDetails: {
            relatedPlaylists: {
              uploads: uploadPlaylistId,
            },
          },
        },
      ],
    };

    const mockPlaylistResponse = {
      items: [
        {
          snippet: {
            resourceId: { videoId: 'video1' },
          },
        },
        {
          snippet: {
            resourceId: { videoId: 'video2' },
          },
        },
      ],
    };

    const mockVideosResponse = {
      items: [
        {
          id: 'video1',
          snippet: { title: 'Video 1' },
        },
        {
          id: 'video2',
          snippet: { title: 'Video 2' },
        },
      ],
    };

    it('should fetch channel videos successfully', async () => {
      mockChannelsList.mockResolvedValue({ data: mockChannelResponse });
      mockPlaylistItemsList.mockResolvedValue({ data: mockPlaylistResponse });
      mockVideosList.mockResolvedValue({ data: mockVideosResponse });

      const result = await youtubeService.getChannelVideos(validChannelId, 10);

      expect(result).toEqual(mockVideosResponse.items);
      expect(mockChannelsList).toHaveBeenCalledWith({
        part: 'contentDetails',
        id: validChannelId,
      });
      expect(mockPlaylistItemsList).toHaveBeenCalledWith({
        part: 'snippet',
        playlistId: uploadPlaylistId,
        maxResults: 10,
      });
      expect(mockVideosList).toHaveBeenCalledWith({
        part: 'snippet,contentDetails,liveStreamingDetails,statistics',
        id: 'video1,video2',
      });
    });

    it('should return empty array when no videos found', async () => {
      mockChannelsList.mockResolvedValue({ data: mockChannelResponse });
      mockPlaylistItemsList.mockResolvedValue({ data: { items: [] } });

      const result = await youtubeService.getChannelVideos(validChannelId);

      expect(result).toEqual([]);
      expect(mockVideosList).not.toHaveBeenCalled();
    });

    it('should throw error when channel not found', async () => {
      mockChannelsList.mockResolvedValue({ data: { items: [] } });

      await expect(youtubeService.getChannelVideos(validChannelId)).rejects.toThrow(
        `Channel ${validChannelId} not found`
      );
    });

    it('should limit maxResults to 50', async () => {
      mockChannelsList.mockResolvedValue({ data: mockChannelResponse });
      mockPlaylistItemsList.mockResolvedValue({ data: { items: [] } });

      await youtubeService.getChannelVideos(validChannelId, 100);

      expect(mockPlaylistItemsList).toHaveBeenCalledWith({
        part: 'snippet',
        playlistId: uploadPlaylistId,
        maxResults: 50,
      });
    });
  });

  describe('searchVideos', () => {
    const mockSearchResponse = {
      items: [
        {
          id: { videoId: 'search1' },
          snippet: { title: 'Search Result 1' },
        },
        {
          id: { videoId: 'search2' },
          snippet: { title: 'Search Result 2' },
        },
      ],
    };

    it('should search videos with basic query', async () => {
      mockSearchList.mockResolvedValue({ data: mockSearchResponse });

      const result = await youtubeService.searchVideos('test query');

      expect(result).toEqual(mockSearchResponse.items);
      expect(mockSearchList).toHaveBeenCalledWith({
        part: 'snippet',
        q: 'test query',
        type: 'video',
        maxResults: 10,
        order: 'relevance',
      });
    });

    it('should search videos with options', async () => {
      mockSearchList.mockResolvedValue({ data: mockSearchResponse });

      const options = {
        maxResults: 25,
        order: 'date',
        channelId: 'UC123',
        publishedAfter: '2023-01-01T00:00:00Z',
      };

      await youtubeService.searchVideos('test query', options);

      expect(mockSearchList).toHaveBeenCalledWith({
        part: 'snippet',
        q: 'test query',
        type: 'video',
        maxResults: 25,
        order: 'date',
        channelId: 'UC123',
        publishedAfter: '2023-01-01T00:00:00Z',
      });
    });

    it('should handle search API errors', async () => {
      mockSearchList.mockRejectedValue(new Error('Search failed'));

      await expect(youtubeService.searchVideos('test')).rejects.toThrow('Failed to search videos: Search failed');
    });
  });

  describe('getVideoStatistics', () => {
    const validVideoId = 'dQw4w9WgXcQ';
    const mockStatsResponse = {
      items: [
        {
          statistics: {
            viewCount: '1000000',
            likeCount: '50000',
            commentCount: '1000',
          },
        },
      ],
    };

    it('should fetch video statistics successfully', async () => {
      mockVideosList.mockResolvedValue({ data: mockStatsResponse });

      const result = await youtubeService.getVideoStatistics(validVideoId);

      expect(result).toEqual(mockStatsResponse.items[0].statistics);
      expect(mockVideosList).toHaveBeenCalledWith({
        part: 'statistics',
        id: validVideoId,
      });
    });

    it('should return null when video not found', async () => {
      mockVideosList.mockResolvedValue({ data: { items: [] } });

      const result = await youtubeService.getVideoStatistics(validVideoId);

      expect(result).toBeNull();
    });

    it('should throw error for invalid video ID', async () => {
      await expect(youtubeService.getVideoStatistics('')).rejects.toThrow('Invalid video ID:');
    });
  });

  describe('getPlaylistDetails', () => {
    const playlistId = 'PLtest123';
    const mockPlaylistResponse = {
      items: [
        {
          id: playlistId,
          snippet: {
            title: 'Test Playlist',
            description: 'Test playlist description',
          },
          contentDetails: {
            itemCount: 25,
          },
        },
      ],
    };

    it('should fetch playlist details successfully', async () => {
      mockPlaylistsList.mockResolvedValue({ data: mockPlaylistResponse });

      const result = await youtubeService.getPlaylistDetails(playlistId);

      expect(result).toEqual(mockPlaylistResponse.items[0]);
      expect(mockPlaylistsList).toHaveBeenCalledWith({
        part: 'snippet,contentDetails',
        id: playlistId,
      });
    });

    it('should return null when playlist not found', async () => {
      mockPlaylistsList.mockResolvedValue({ data: { items: [] } });

      const result = await youtubeService.getPlaylistDetails(playlistId);

      expect(result).toBeNull();
    });

    it('should handle API errors', async () => {
      const apiError = new Error('Playlist API failed');
      mockPlaylistsList.mockRejectedValue(apiError);

      await expect(youtubeService.getPlaylistDetails(playlistId)).rejects.toThrow(
        `Failed to fetch playlist details for ${playlistId}: Playlist API failed`
      );
    });
  });

  describe('getPlaylistVideos', () => {
    const playlistId = 'PLtest123';
    const mockPlaylistVideosResponse = {
      items: [
        {
          snippet: {
            title: 'Playlist Video 1',
            resourceId: { videoId: 'video1' },
          },
        },
        {
          snippet: {
            title: 'Playlist Video 2',
            resourceId: { videoId: 'video2' },
          },
        },
      ],
    };

    it('should fetch playlist videos successfully', async () => {
      mockPlaylistItemsList.mockResolvedValue({ data: mockPlaylistVideosResponse });

      const result = await youtubeService.getPlaylistVideos(playlistId, 25);

      expect(result).toEqual(mockPlaylistVideosResponse.items);
      expect(mockPlaylistItemsList).toHaveBeenCalledWith({
        part: 'snippet',
        playlistId,
        maxResults: 25,
      });
    });

    it('should use default maxResults when not specified', async () => {
      mockPlaylistItemsList.mockResolvedValue({ data: mockPlaylistVideosResponse });

      await youtubeService.getPlaylistVideos(playlistId);

      expect(mockPlaylistItemsList).toHaveBeenCalledWith({
        part: 'snippet',
        playlistId,
        maxResults: 50,
      });
    });

    it('should limit maxResults to 50', async () => {
      mockPlaylistItemsList.mockResolvedValue({ data: { items: [] } });

      await youtubeService.getPlaylistVideos(playlistId, 100);

      expect(mockPlaylistItemsList).toHaveBeenCalledWith({
        part: 'snippet',
        playlistId,
        maxResults: 50,
      });
    });

    it('should handle API errors', async () => {
      const apiError = new Error('Playlist videos API failed');
      mockPlaylistItemsList.mockRejectedValue(apiError);

      await expect(youtubeService.getPlaylistVideos(playlistId)).rejects.toThrow(
        `Failed to fetch playlist videos for ${playlistId}: Playlist videos API failed`
      );
    });
  });

  describe('isVideoLive', () => {
    const validVideoId = 'dQw4w9WgXcQ';

    it('should return true for live video', async () => {
      const mockLiveVideo = {
        snippet: { liveBroadcastContent: 'live' },
      };
      jest.spyOn(youtubeService, 'getVideoDetails').mockResolvedValue(mockLiveVideo);

      const result = await youtubeService.isVideoLive(validVideoId);

      expect(result).toBe(true);
    });

    it('should return false for non-live video', async () => {
      const mockRegularVideo = {
        snippet: { liveBroadcastContent: 'none' },
      };
      jest.spyOn(youtubeService, 'getVideoDetails').mockResolvedValue(mockRegularVideo);

      const result = await youtubeService.isVideoLive(validVideoId);

      expect(result).toBe(false);
    });

    it('should return false when video not found', async () => {
      jest.spyOn(youtubeService, 'getVideoDetails').mockResolvedValue(null);

      const result = await youtubeService.isVideoLive(validVideoId);

      expect(result).toBe(false);
    });

    it('should return false when error occurs', async () => {
      jest.spyOn(youtubeService, 'getVideoDetails').mockRejectedValue(new Error('API error'));

      const result = await youtubeService.isVideoLive(validVideoId);

      expect(result).toBe(false);
    });
  });

  describe('getLiveStreamDetails', () => {
    const validVideoId = 'dQw4w9WgXcQ';

    it('should return live stream details', async () => {
      const mockLiveStreamDetails = {
        scheduledStartTime: '2023-01-01T12:00:00Z',
        actualStartTime: '2023-01-01T12:01:00Z',
        concurrentViewers: '1000',
      };
      const mockVideo = {
        liveStreamingDetails: mockLiveStreamDetails,
      };
      jest.spyOn(youtubeService, 'getVideoDetails').mockResolvedValue(mockVideo);

      const result = await youtubeService.getLiveStreamDetails(validVideoId);

      expect(result).toEqual(mockLiveStreamDetails);
    });

    it('should return null when video has no live stream details', async () => {
      const mockVideo = { snippet: { title: 'Regular video' } };
      jest.spyOn(youtubeService, 'getVideoDetails').mockResolvedValue(mockVideo);

      const result = await youtubeService.getLiveStreamDetails(validVideoId);

      expect(result).toBeNull();
    });

    it('should return null when video not found', async () => {
      jest.spyOn(youtubeService, 'getVideoDetails').mockResolvedValue(null);

      const result = await youtubeService.getLiveStreamDetails(validVideoId);

      expect(result).toBeNull();
    });

    it('should return null when error occurs', async () => {
      jest.spyOn(youtubeService, 'getVideoDetails').mockRejectedValue(new Error('API error'));

      const result = await youtubeService.getLiveStreamDetails(validVideoId);

      expect(result).toBeNull();
    });
  });

  describe('getVideoComments', () => {
    const validVideoId = 'dQw4w9WgXcQ';
    const mockCommentsResponse = {
      items: [
        {
          snippet: {
            topLevelComment: {
              snippet: {
                textDisplay: 'Great video!',
                authorDisplayName: 'User1',
              },
            },
          },
        },
      ],
    };

    it('should fetch video comments successfully', async () => {
      mockCommentThreadsList.mockResolvedValue({ data: mockCommentsResponse });

      const result = await youtubeService.getVideoComments(validVideoId, 10);

      expect(result).toEqual(mockCommentsResponse.items);
      expect(mockCommentThreadsList).toHaveBeenCalledWith({
        part: 'snippet',
        videoId: validVideoId,
        maxResults: 10,
        order: 'time',
      });
    });

    it('should limit maxResults to 100', async () => {
      mockCommentThreadsList.mockResolvedValue({ data: { items: [] } });

      await youtubeService.getVideoComments(validVideoId, 200);

      expect(mockCommentThreadsList).toHaveBeenCalledWith({
        part: 'snippet',
        videoId: validVideoId,
        maxResults: 100,
        order: 'time',
      });
    });

    it('should throw error for invalid video ID', async () => {
      await expect(youtubeService.getVideoComments('')).rejects.toThrow('Invalid video ID:');
    });

    it('should handle API errors', async () => {
      const apiError = new Error('Comments API failed');
      mockCommentThreadsList.mockRejectedValue(apiError);

      await expect(youtubeService.getVideoComments(validVideoId)).rejects.toThrow(
        `Failed to fetch comments for ${validVideoId}: Comments API failed`
      );
    });

    it('should use default maxResults when not specified', async () => {
      mockCommentThreadsList.mockResolvedValue({ data: mockCommentsResponse });

      await youtubeService.getVideoComments(validVideoId);

      expect(mockCommentThreadsList).toHaveBeenCalledWith({
        part: 'snippet',
        videoId: validVideoId,
        maxResults: 20,
        order: 'time',
      });
    });
  });

  describe('getChannelUploadPlaylist', () => {
    const validChannelId = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
    const uploadPlaylistId = 'UU_x5XG1OV2P6uZZ5FSM9Ttw';

    it('should get channel upload playlist ID', async () => {
      const mockResponse = {
        items: [
          {
            contentDetails: {
              relatedPlaylists: {
                uploads: uploadPlaylistId,
              },
            },
          },
        ],
      };
      mockChannelsList.mockResolvedValue({ data: mockResponse });

      const result = await youtubeService.getChannelUploadPlaylist(validChannelId);

      expect(result).toBe(uploadPlaylistId);
      expect(mockChannelsList).toHaveBeenCalledWith({
        part: 'contentDetails',
        id: validChannelId,
      });
    });

    it('should throw error when channel not found', async () => {
      mockChannelsList.mockResolvedValue({ data: { items: [] } });

      await expect(youtubeService.getChannelUploadPlaylist(validChannelId)).rejects.toThrow(
        `Channel ${validChannelId} not found`
      );
    });

    it('should throw error for invalid channel ID', async () => {
      await expect(youtubeService.getChannelUploadPlaylist('')).rejects.toThrow('Invalid channel ID:');
      await expect(youtubeService.getChannelUploadPlaylist(null)).rejects.toThrow('Invalid channel ID:');
    });

    it('should handle API errors', async () => {
      const apiError = new Error('Upload playlist API failed');
      mockChannelsList.mockRejectedValue(apiError);

      await expect(youtubeService.getChannelUploadPlaylist(validChannelId)).rejects.toThrow(
        `Failed to get upload playlist for ${validChannelId}: Upload playlist API failed`
      );
    });
  });

  describe('getQuotaUsage', () => {
    it('should return quota usage information', async () => {
      const result = await youtubeService.getQuotaUsage();

      expect(result).toEqual({
        used: 'unknown',
        remaining: 'unknown',
        resetTime: 'daily',
      });
    });
  });

  describe('validateApiKey', () => {
    it('should return true for valid API key', async () => {
      mockChannelsList.mockResolvedValue({ data: { items: [] } });

      const result = await youtubeService.validateApiKey();

      expect(result).toBe(true);
      expect(mockChannelsList).toHaveBeenCalledWith({
        part: 'id',
        mine: false,
        id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
      });
    });

    it('should return false for invalid API key', async () => {
      mockChannelsList.mockRejectedValue(new Error('Invalid API key'));

      const result = await youtubeService.validateApiKey();

      expect(result).toBe(false);
    });

    it('should return true for non-API key errors', async () => {
      mockChannelsList.mockRejectedValue(new Error('Network timeout'));

      const result = await youtubeService.validateApiKey();

      expect(result).toBe(true);
    });
  });

  describe('getScheduledContent', () => {
    const validChannelId = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
    const mockSearchResponse = {
      items: [
        {
          id: { videoId: 'scheduled1' },
          snippet: { title: 'Scheduled Stream 1' },
        },
        {
          id: { videoId: 'scheduled2' },
          snippet: { title: 'Scheduled Stream 2' },
        },
      ],
    };

    const mockVideosResponse = {
      items: [
        {
          id: 'scheduled1',
          snippet: {
            title: 'Scheduled Stream 1',
            description: 'Test scheduled stream',
            publishedAt: '2023-01-01T00:00:00Z',
            liveBroadcastContent: 'upcoming',
            channelId: validChannelId,
            channelTitle: 'Test Channel',
            thumbnails: { default: { url: 'test.jpg' } },
          },
          liveStreamingDetails: {
            scheduledStartTime: '2023-01-01T12:00:00Z',
          },
        },
        {
          id: 'scheduled2',
          snippet: {
            title: 'Scheduled Stream 2',
            description: 'Another test stream',
            publishedAt: '2023-01-01T01:00:00Z',
            liveBroadcastContent: 'upcoming',
            channelId: validChannelId,
            channelTitle: 'Test Channel',
            thumbnails: { default: { url: 'test2.jpg' } },
          },
          liveStreamingDetails: {
            scheduledStartTime: '2023-01-01T15:00:00Z',
          },
        },
      ],
    };

    it('should fetch scheduled content successfully', async () => {
      mockSearchList.mockResolvedValue({ data: mockSearchResponse });
      mockVideosList.mockResolvedValue({ data: mockVideosResponse });

      const result = await youtubeService.getScheduledContent(validChannelId, 25);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'scheduled1',
        title: 'Scheduled Stream 1',
        state: 'scheduled',
        scheduledStartTime: '2023-01-01T12:00:00Z',
      });

      expect(mockSearchList).toHaveBeenCalledWith({
        part: ['snippet'],
        channelId: validChannelId,
        eventType: 'upcoming',
        type: 'video',
        maxResults: 25,
        order: 'date',
      });

      expect(mockVideosList).toHaveBeenCalledWith({
        part: 'snippet,liveStreamingDetails,contentDetails',
        id: 'scheduled1,scheduled2',
      });
    });

    it('should return empty array when no scheduled content found', async () => {
      mockSearchList.mockResolvedValue({ data: { items: [] } });

      const result = await youtubeService.getScheduledContent(validChannelId);

      expect(result).toEqual([]);
      expect(mockVideosList).not.toHaveBeenCalled();
    });

    it('should handle search returning no video IDs', async () => {
      const noVideoIdResponse = {
        items: [
          {
            snippet: { title: 'No video ID' },
            id: {}, // Empty id object without videoId
          },
        ],
      };
      mockSearchList.mockResolvedValue({ data: noVideoIdResponse });

      const result = await youtubeService.getScheduledContent(validChannelId);

      expect(result).toEqual([]);
    });

    it('should limit maxResults to 50', async () => {
      mockSearchList.mockResolvedValue({ data: { items: [] } });

      await youtubeService.getScheduledContent(validChannelId, 100);

      expect(mockSearchList).toHaveBeenCalledWith({
        part: ['snippet'],
        channelId: validChannelId,
        eventType: 'upcoming',
        type: 'video',
        maxResults: 50,
        order: 'date',
      });
    });

    it('should throw error for invalid channel ID', async () => {
      await expect(youtubeService.getScheduledContent('')).rejects.toThrow('Invalid channel ID:');
      await expect(youtubeService.getScheduledContent(null)).rejects.toThrow('Invalid channel ID:');
    });

    it('should handle API errors', async () => {
      const apiError = new Error('Search API failed');
      mockSearchList.mockRejectedValue(apiError);

      await expect(youtubeService.getScheduledContent(validChannelId)).rejects.toThrow(
        `Failed to fetch scheduled content for ${validChannelId}: Search API failed`
      );
    });

    it('should handle quota exceeded errors gracefully', async () => {
      const quotaError = new Error('The request cannot be completed because you have exceeded your quota.');
      mockSearchList.mockRejectedValue(quotaError);

      const result = await youtubeService.getScheduledContent(validChannelId);

      expect(result).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith('YouTube API quota exceeded while fetching scheduled content', {
        channelId: validChannelId,
        error: quotaError.message,
      });
    });
  });

  describe('checkScheduledContentStates', () => {
    const videoIds = ['video1', 'video2', 'video3'];
    const mockStatesResponse = {
      items: [
        {
          id: 'video1',
          snippet: { liveBroadcastContent: 'upcoming' },
          liveStreamingDetails: {
            scheduledStartTime: '2023-01-01T12:00:00Z',
          },
        },
        {
          id: 'video2',
          snippet: { liveBroadcastContent: 'live' },
          liveStreamingDetails: {
            scheduledStartTime: '2023-01-01T11:00:00Z',
            actualStartTime: '2023-01-01T11:01:00Z',
          },
        },
        {
          id: 'video3',
          snippet: { liveBroadcastContent: 'none' },
          liveStreamingDetails: {
            scheduledStartTime: '2023-01-01T10:00:00Z',
            actualStartTime: '2023-01-01T10:01:00Z',
            actualEndTime: '2023-01-01T11:30:00Z',
          },
        },
      ],
    };

    it('should check scheduled content states successfully', async () => {
      mockVideosList.mockResolvedValue({ data: mockStatesResponse });

      const result = await youtubeService.checkScheduledContentStates(videoIds);

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        id: 'video1',
        state: 'scheduled',
        liveBroadcastContent: 'upcoming',
        scheduledStartTime: '2023-01-01T12:00:00Z',
      });

      expect(result[1]).toMatchObject({
        id: 'video2',
        state: 'live',
        liveBroadcastContent: 'live',
        actualStartTime: '2023-01-01T11:01:00Z',
      });

      expect(result[2]).toMatchObject({
        id: 'video3',
        state: 'ended',
        liveBroadcastContent: 'none',
        actualEndTime: '2023-01-01T11:30:00Z',
      });

      expect(mockVideosList).toHaveBeenCalledWith({
        part: 'snippet,liveStreamingDetails',
        id: 'video1,video2,video3',
      });
    });

    it('should return empty array for empty video IDs', async () => {
      const result = await youtubeService.checkScheduledContentStates([]);
      expect(result).toEqual([]);
      expect(mockVideosList).not.toHaveBeenCalled();
    });

    it('should return empty array for non-array input', async () => {
      const result = await youtubeService.checkScheduledContentStates(null);
      expect(result).toEqual([]);
      expect(mockVideosList).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      const apiError = new Error('Videos API failed');
      mockVideosList.mockRejectedValue(apiError);

      await expect(youtubeService.checkScheduledContentStates(videoIds)).rejects.toThrow(
        'Failed to check content states: Videos API failed'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to check scheduled content states',
        expect.objectContaining({
          videoIds: ['video1', 'video2', 'video3'],
          error: 'Videos API failed',
        })
      );
    });

    it('should limit logged video IDs to first 5', async () => {
      const manyVideoIds = Array.from({ length: 10 }, (_, i) => `video${i + 1}`);
      const apiError = new Error('Too many videos');
      mockVideosList.mockRejectedValue(apiError);

      await expect(youtubeService.checkScheduledContentStates(manyVideoIds)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to check scheduled content states',
        expect.objectContaining({
          videoIds: ['video1', 'video2', 'video3', 'video4', 'video5'],
          error: 'Too many videos',
        })
      );
    });
  });

  describe('pollScheduledContent', () => {
    const scheduledContent = [
      {
        id: 'video1',
        state: 'scheduled',
        title: 'Upcoming Stream',
      },
      {
        id: 'video2',
        state: 'scheduled',
        title: 'Another Stream',
      },
    ];

    const mockCurrentStates = [
      {
        id: 'video1',
        state: 'live',
        liveBroadcastContent: 'live',
        scheduledStartTime: '2023-01-01T12:00:00Z',
        actualStartTime: '2023-01-01T12:01:00Z',
      },
      {
        id: 'video2',
        state: 'scheduled',
        liveBroadcastContent: 'upcoming',
        scheduledStartTime: '2023-01-01T15:00:00Z',
      },
    ];

    beforeEach(() => {
      // Mock current time to be after video1's scheduled start but before video2's
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2023-01-01T13:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should detect state changes in scheduled content', async () => {
      jest.spyOn(youtubeService, 'checkScheduledContentStates').mockResolvedValue(mockCurrentStates);

      const result = await youtubeService.pollScheduledContent(scheduledContent);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'video1',
        title: 'Upcoming Stream',
        newState: 'live',
        oldState: 'scheduled',
        actualStartTime: '2023-01-01T12:01:00Z',
        stateChangeDetected: true,
      });

      expect(youtubeService.checkScheduledContentStates).toHaveBeenCalledWith(['video1', 'video2']);
    });

    it('should warn about scheduled content that should be live but API shows scheduled', async () => {
      const pastScheduledContent = [
        {
          id: 'video1',
          state: 'scheduled',
          title: 'Past Stream',
        },
      ];

      const stillScheduledStates = [
        {
          id: 'video1',
          state: 'scheduled',
          liveBroadcastContent: 'upcoming',
          scheduledStartTime: '2023-01-01T11:00:00Z', // In the past
        },
      ];

      jest.spyOn(youtubeService, 'checkScheduledContentStates').mockResolvedValue(stillScheduledStates);

      const result = await youtubeService.pollScheduledContent(pastScheduledContent);

      expect(result).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Scheduled content may have started but API not updated',
        expect.objectContaining({
          videoId: 'video1',
          scheduledStart: '2023-01-01T11:00:00.000Z',
          currentTime: '2023-01-01T13:00:00.000Z',
        })
      );
    });

    it('should return empty array for empty scheduled content', async () => {
      const result = await youtubeService.pollScheduledContent([]);
      expect(result).toEqual([]);
    });

    it('should return empty array for non-array input', async () => {
      const result = await youtubeService.pollScheduledContent(null);
      expect(result).toEqual([]);
    });

    it('should handle missing original content gracefully', async () => {
      const missingCurrentStates = [
        {
          id: 'nonexistent',
          state: 'live',
          liveBroadcastContent: 'live',
        },
      ];

      jest.spyOn(youtubeService, 'checkScheduledContentStates').mockResolvedValue(missingCurrentStates);

      const result = await youtubeService.pollScheduledContent(scheduledContent);

      expect(result).toHaveLength(0);
    });

    it('should handle API errors and return empty array', async () => {
      const apiError = new Error('States check failed');
      jest.spyOn(youtubeService, 'checkScheduledContentStates').mockRejectedValue(apiError);

      const result = await youtubeService.pollScheduledContent(scheduledContent);

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to poll scheduled content',
        expect.objectContaining({
          contentCount: 2,
          error: 'States check failed',
        })
      );
    });
  });

  describe('determineLivestreamState', () => {
    it('should return "scheduled" for upcoming broadcasts', () => {
      const videoData = {
        snippet: { liveBroadcastContent: 'upcoming' },
        liveStreamingDetails: {
          scheduledStartTime: '2023-01-01T12:00:00Z',
        },
      };

      const result = youtubeService.determineLivestreamState(videoData);
      expect(result).toBe('scheduled');
    });

    it('should return "live" for live broadcasts', () => {
      const videoData = {
        snippet: { liveBroadcastContent: 'live' },
        liveStreamingDetails: {
          actualStartTime: '2023-01-01T12:01:00Z',
        },
      };

      const result = youtubeService.determineLivestreamState(videoData);
      expect(result).toBe('live');
    });

    it('should return "ended" for completed livestreams', () => {
      const videoData = {
        snippet: { liveBroadcastContent: 'none' },
        liveStreamingDetails: {
          actualStartTime: '2023-01-01T12:01:00Z',
          actualEndTime: '2023-01-01T13:30:00Z',
        },
      };

      const result = youtubeService.determineLivestreamState(videoData);
      expect(result).toBe('ended');
    });

    it('should return "published" for livestreams without end time', () => {
      const videoData = {
        snippet: { liveBroadcastContent: 'none' },
        liveStreamingDetails: {
          actualStartTime: '2023-01-01T12:01:00Z',
        },
      };

      const result = youtubeService.determineLivestreamState(videoData);
      expect(result).toBe('published');
    });

    it('should return "published" for regular videos', () => {
      const videoData = {
        snippet: { liveBroadcastContent: 'none' },
      };

      const result = youtubeService.determineLivestreamState(videoData);
      expect(result).toBe('published');
    });

    it('should return "unknown" for unrecognized broadcast content', () => {
      const videoData = {
        snippet: { liveBroadcastContent: 'mysterious' },
      };

      const result = youtubeService.determineLivestreamState(videoData);
      expect(result).toBe('unknown');
    });
  });

  describe('validation methods', () => {
    describe('validateVideoId', () => {
      it('should validate correct video IDs', () => {
        expect(youtubeService.validateVideoId('dQw4w9WgXcQ')).toBe(true);
        expect(youtubeService.validateVideoId('_9bZkp7q19w')).toBe(true);
        expect(youtubeService.validateVideoId('xvFZjo5PgG0')).toBe(true);
      });

      it('should reject invalid video IDs', () => {
        expect(youtubeService.validateVideoId('')).toBe(false);
        expect(youtubeService.validateVideoId('too-short')).toBe(false);
        expect(youtubeService.validateVideoId('way-too-long-to-be-valid')).toBe(false);
        expect(youtubeService.validateVideoId('invalid@chars')).toBe(false);
        expect(youtubeService.validateVideoId(null)).toBe(false);
        expect(youtubeService.validateVideoId(undefined)).toBe(false);
        expect(youtubeService.validateVideoId(123)).toBe(false);
      });
    });

    describe('validateChannelId', () => {
      it('should validate correct channel IDs', () => {
        expect(youtubeService.validateChannelId('UC_x5XG1OV2P6uZZ5FSM9Ttw')).toBe(true);
        expect(youtubeService.validateChannelId('UCuAXFkgsw1L7xaCfnd5JJOw')).toBe(true);
      });

      it('should reject invalid channel IDs', () => {
        expect(youtubeService.validateChannelId('')).toBe(false);
        expect(youtubeService.validateChannelId('invalid-format')).toBe(false);
        expect(youtubeService.validateChannelId('UC-too-short')).toBe(false);
        expect(youtubeService.validateChannelId('UC_way_too_long_to_be_valid_channel_id')).toBe(false);
        expect(youtubeService.validateChannelId('XC_x5XG1OV2P6uZZ5FSM9Ttw')).toBe(false); // Wrong prefix
        expect(youtubeService.validateChannelId(null)).toBe(false);
        expect(youtubeService.validateChannelId(undefined)).toBe(false);
        expect(youtubeService.validateChannelId(123)).toBe(false);
      });
    });

    describe('extractVideoId', () => {
      it('should extract video ID from various URL formats', () => {
        expect(youtubeService.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        expect(youtubeService.extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        expect(youtubeService.extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        expect(youtubeService.extractVideoId('https://www.youtube.com/v/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        expect(youtubeService.extractVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ'); // Already a video ID
      });

      it('should return null for invalid URLs', () => {
        expect(youtubeService.extractVideoId('')).toBe(null);
        expect(youtubeService.extractVideoId('not-a-valid-video-id')).toBe(null);
        expect(youtubeService.extractVideoId('https://example.com')).toBe(null);
        expect(youtubeService.extractVideoId(null)).toBe(null);
        expect(youtubeService.extractVideoId(undefined)).toBe(null);
        expect(youtubeService.extractVideoId(123)).toBe(null);
      });
    });

    describe('extractChannelId', () => {
      it('should extract channel ID from various URL formats', () => {
        const channelId = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
        expect(youtubeService.extractChannelId(`https://www.youtube.com/channel/${channelId}`)).toBe(channelId);
        expect(youtubeService.extractChannelId('https://www.youtube.com/c/testchannel')).toBe('testchannel');
        expect(youtubeService.extractChannelId('https://www.youtube.com/user/testuser')).toBe('testuser');
        expect(youtubeService.extractChannelId('https://www.youtube.com/@testhandle')).toBe('testhandle');
        expect(youtubeService.extractChannelId(channelId)).toBe(channelId); // Already a channel ID
      });

      it('should return null for invalid URLs', () => {
        expect(youtubeService.extractChannelId('')).toBe(null);
        expect(youtubeService.extractChannelId('invalid-url')).toBe(null);
        expect(youtubeService.extractChannelId('https://example.com')).toBe(null);
        expect(youtubeService.extractChannelId(null)).toBe(null);
        expect(youtubeService.extractChannelId(undefined)).toBe(null);
        expect(youtubeService.extractChannelId(123)).toBe(null);
      });
    });

    describe('dispose', () => {
      it('should dispose resources without error', async () => {
        await expect(youtubeService.dispose()).resolves.toBeUndefined();
      });
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      const networkError = new Error('ECONNREFUSED');
      mockVideosList.mockRejectedValue(networkError);

      await expect(youtubeService.getVideoDetails('dQw4w9WgXcQ')).rejects.toThrow(
        'Failed to fetch video details for dQw4w9WgXcQ: ECONNREFUSED'
      );
    });

    it('should handle rate limiting errors', async () => {
      const rateLimitError = new Error('quotaExceeded');
      mockSearchList.mockRejectedValue(rateLimitError);

      await expect(youtubeService.searchVideos('test')).rejects.toThrow('Failed to search videos: quotaExceeded');
    });

    it('should handle malformed API responses', async () => {
      mockVideosList.mockResolvedValue({ data: null });

      await expect(youtubeService.getVideoDetails('dQw4w9WgXcQ')).rejects.toThrow();
    });

    it('should handle empty search options gracefully', async () => {
      const mockEmptySearchResponse = { items: [] };
      mockSearchList.mockResolvedValue({ data: mockEmptySearchResponse });

      const result = await youtubeService.searchVideos('test', {});

      expect(result).toEqual([]);
      expect(mockSearchList).toHaveBeenCalledWith({
        part: 'snippet',
        q: 'test',
        type: 'video',
        maxResults: 10,
        order: 'relevance',
      });
    });

    it('should handle search with all options', async () => {
      const mockSearchResponse = { items: [] };
      mockSearchList.mockResolvedValue({ data: mockSearchResponse });

      const options = {
        maxResults: 5,
        order: 'date',
        channelId: 'UC123',
        publishedAfter: '2023-01-01T00:00:00Z',
      };

      await youtubeService.searchVideos('test', options);

      expect(mockSearchList).toHaveBeenCalledWith({
        part: 'snippet',
        q: 'test',
        type: 'video',
        maxResults: 5,
        order: 'date',
        channelId: 'UC123',
        publishedAfter: '2023-01-01T00:00:00Z',
      });
    });
  });
});
