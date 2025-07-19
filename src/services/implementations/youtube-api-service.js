import { google } from 'googleapis';
import { YouTubeService } from '../interfaces/youtube-service.js';

/**
 * YouTube Data API implementation of YouTubeService
 */
export class YouTubeApiService extends YouTubeService {
  constructor({ logger, youtube }) {
    super();
    this.logger = logger;
    this.youtube =
      youtube ||
      google.youtube({
        version: 'v3',
        auth: process.env.YOUTUBE_API_KEY,
      });
  }

  /**
   * Get video details by ID
   */
  async getVideoDetails(videoId) {
    if (!this.validateVideoId(videoId)) {
      throw new Error(`Invalid video ID: ${videoId}`);
    }

    try {
      const response = await this.youtube.videos.list({
        part: 'snippet,contentDetails,liveStreamingDetails,statistics',
        id: videoId,
      });

      return response.data.items[0] || null;
    } catch (error) {
      throw new Error(`Failed to fetch video details for ${videoId}: ${error.message}`);
    }
  }

  /**
   * Get channel details by ID
   */
  async getChannelDetails(channelId) {
    if (!this.validateChannelId(channelId)) {
      throw new Error(`Invalid channel ID: ${channelId}`);
    }

    try {
      const response = await this.youtube.channels.list({
        part: 'snippet,contentDetails,statistics',
        id: channelId,
      });

      return response.data.items[0] || null;
    } catch (error) {
      throw new Error(`Failed to fetch channel details for ${channelId}: ${error.message}`);
    }
  }

  /**
   * Get latest videos from a channel
   */
  async getChannelVideos(channelId, maxResults = 10) {
    if (!this.validateChannelId(channelId)) {
      throw new Error(`Invalid channel ID: ${channelId}`);
    }

    try {
      // First get the upload playlist ID
      const channelResponse = await this.youtube.channels.list({
        part: 'contentDetails',
        id: channelId,
      });

      if (!channelResponse.data.items[0]) {
        throw new Error(`Channel ${channelId} not found`);
      }

      const uploadPlaylistId = channelResponse.data.items[0].contentDetails.relatedPlaylists.uploads;

      // Then get videos from the upload playlist
      const playlistResponse = await this.youtube.playlistItems.list({
        part: 'snippet',
        playlistId: uploadPlaylistId,
        maxResults: Math.min(maxResults, 50),
      });

      // Get detailed info for each video
      const videoIds = playlistResponse.data.items.map(item => item.snippet.resourceId.videoId);

      if (videoIds.length === 0) {
        return [];
      }

      const videosResponse = await this.youtube.videos.list({
        part: 'snippet,contentDetails,liveStreamingDetails,statistics',
        id: videoIds.join(','),
      });

      return videosResponse.data.items;
    } catch (error) {
      throw new Error(`Failed to fetch channel videos for ${channelId}: ${error.message}`);
    }
  }

  /**
   * Search for videos
   */
  async searchVideos(query, options = {}) {
    try {
      const searchParams = {
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: options.maxResults || 10,
        order: options.order || 'relevance',
      };

      if (options.channelId) {
        searchParams.channelId = options.channelId;
      }

      if (options.publishedAfter) {
        searchParams.publishedAfter = options.publishedAfter;
      }

      const response = await this.youtube.search.list(searchParams);
      return response.data.items;
    } catch (error) {
      throw new Error(`Failed to search videos: ${error.message}`);
    }
  }

  /**
   * Get video statistics
   */
  async getVideoStatistics(videoId) {
    if (!this.validateVideoId(videoId)) {
      throw new Error(`Invalid video ID: ${videoId}`);
    }

    try {
      const response = await this.youtube.videos.list({
        part: 'statistics',
        id: videoId,
      });

      return response.data.items[0]?.statistics || null;
    } catch (error) {
      throw new Error(`Failed to fetch video statistics for ${videoId}: ${error.message}`);
    }
  }

  /**
   * Get playlist details
   */
  async getPlaylistDetails(playlistId) {
    try {
      const response = await this.youtube.playlists.list({
        part: 'snippet,contentDetails',
        id: playlistId,
      });

      return response.data.items[0] || null;
    } catch (error) {
      throw new Error(`Failed to fetch playlist details for ${playlistId}: ${error.message}`);
    }
  }

  /**
   * Get videos from a playlist
   */
  async getPlaylistVideos(playlistId, maxResults = 50) {
    try {
      const response = await this.youtube.playlistItems.list({
        part: 'snippet',
        playlistId,
        maxResults: Math.min(maxResults, 50),
      });

      return response.data.items;
    } catch (error) {
      throw new Error(`Failed to fetch playlist videos for ${playlistId}: ${error.message}`);
    }
  }

  /**
   * Check if a video is live
   */
  async isVideoLive(videoId) {
    try {
      const video = await this.getVideoDetails(videoId);
      if (!video) {
        return false;
      }

      return video.snippet.liveBroadcastContent === 'live';
    } catch {
      return false;
    }
  }

  /**
   * Get live streaming details
   */
  async getLiveStreamDetails(videoId) {
    try {
      const video = await this.getVideoDetails(videoId);
      if (!video || !video.liveStreamingDetails) {
        return null;
      }

      return video.liveStreamingDetails;
    } catch {
      return null;
    }
  }

  /**
   * Get video comments
   */
  async getVideoComments(videoId, maxResults = 20) {
    if (!this.validateVideoId(videoId)) {
      throw new Error(`Invalid video ID: ${videoId}`);
    }

    try {
      const response = await this.youtube.commentThreads.list({
        part: 'snippet',
        videoId,
        maxResults: Math.min(maxResults, 100),
        order: 'time',
      });

      return response.data.items;
    } catch (error) {
      throw new Error(`Failed to fetch comments for ${videoId}: ${error.message}`);
    }
  }

  /**
   * Get channel's upload playlist ID
   */
  async getChannelUploadPlaylist(channelId) {
    if (!this.validateChannelId(channelId)) {
      throw new Error(`Invalid channel ID: ${channelId}`);
    }

    try {
      const response = await this.youtube.channels.list({
        part: 'contentDetails',
        id: channelId,
      });

      const channel = response.data.items[0];
      if (!channel) {
        throw new Error(`Channel ${channelId} not found`);
      }

      return channel.contentDetails.relatedPlaylists.uploads;
    } catch (error) {
      throw new Error(`Failed to get upload playlist for ${channelId}: ${error.message}`);
    }
  }

  /**
   * Get API quota usage information
   */
  async getQuotaUsage() {
    // YouTube API doesn't provide direct quota usage info
    // This would need to be tracked externally
    return {
      used: 'unknown',
      remaining: 'unknown',
      resetTime: 'daily',
    };
  }

  /**
   * Check if API key is valid
   */
  async validateApiKey() {
    try {
      // Try a simple API call to validate the key
      await this.youtube.channels.list({
        part: 'id',
        mine: false,
        id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', // Google Developers channel
      });
      return true;
    } catch (error) {
      if (error.message.includes('API key')) {
        return false;
      }
      // Other errors might be network issues, so assume key is valid
      return true;
    }
  }
}
