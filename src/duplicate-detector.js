// duplicate-detector.js
// Duplicate detection utilities for YouTube videos and X/Twitter posts

/**
 * Regular expression for matching YouTube video URLs
 * Matches various YouTube URL formats and extracts the 11-character video ID
 */
export const videoUrlRegex =
  /https?:\/\/(?:(?:www\.)?youtube\.com\/(?:watch\?v=|live\/|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;

/**
 * Regular expression for matching X/Twitter post URLs
 * Matches URLs from x.com, twitter.com, vxtwitter.com, fxtwitter.com, and nitter instances
 */
export const tweetUrlRegex =
  /https?:\/\/(?:[\w-]+\.)*(?:x\.com|twitter\.com|vxtwitter\.com|fxtwitter\.com|nitter\.[^/]+)\/(?:(?:i\/web\/)?status(?:es)?|[^/]+\/status(?:es)?)\/(\d{10,})/g;
/**
 * Duplicate detector class for managing known content IDs
 */
export class DuplicateDetector {
  constructor(maxSize = 10000, cleanupInterval = 24 * 60 * 60 * 1000) {
    this.knownVideoIds = new Set();
    this.knownTweetIds = new Set();
    this.maxSize = maxSize;
    this.cleanupInterval = cleanupInterval;
    this.cleanupTimer = null;

    // Don't start periodic cleanup in test environment to prevent test timeouts
    if (process.env.NODE_ENV !== 'test') {
      this.startPeriodicCleanup();
    }
  }

  /**
   * Extract video IDs from text content
   * @param {string} content - Text content to search for video URLs
   * @returns {Array} - Array of extracted video IDs
   */
  extractVideoIds(content) {
    if (!content || typeof content !== 'string') {
      return [];
    }

    const matches = [...content.matchAll(videoUrlRegex)];
    return matches.map(match => match[1]).filter(id => id);
  }

  /**
   * Extract tweet IDs from text content
   * @param {string} content - Text content to search for tweet URLs
   * @returns {Array} - Array of extracted tweet IDs
   */
  extractTweetIds(content) {
    if (!content || typeof content !== 'string') {
      return [];
    }

    const matches = [...content.matchAll(tweetUrlRegex)];
    return matches.map(match => match[1]).filter(id => id);
  }

  /**
   * Check if a video ID is already known (duplicate)
   * @param {string} videoId - YouTube video ID to check
   * @returns {boolean} - True if the video is a duplicate
   */
  isVideoIdKnown(videoId) {
    return this.knownVideoIds.has(videoId);
  }

  /**
   * Check if a tweet ID is already known (duplicate)
   * @param {string} tweetId - X/Twitter post ID to check
   * @returns {boolean} - True if the tweet is a duplicate
   */
  isTweetIdKnown(tweetId) {
    return this.knownTweetIds.has(tweetId);
  }

  /**
   * Add a video ID to the known set
   * @param {string} videoId - YouTube video ID to add
   */
  addVideoId(videoId) {
    if (videoId && typeof videoId === 'string') {
      this.knownVideoIds.add(videoId);
      this.cleanupIfNeeded();
    }
  }

  /**
   * Add a tweet ID to the known set
   * @param {string} tweetId - X/Twitter post ID to add
   */
  addTweetId(tweetId) {
    if (tweetId && typeof tweetId === 'string') {
      this.knownTweetIds.add(tweetId);
      this.cleanupIfNeeded();
    }
  }

  /**
   * Add multiple video IDs to the known set
   * @param {Array} videoIds - Array of YouTube video IDs to add
   */
  addVideoIds(videoIds) {
    if (Array.isArray(videoIds)) {
      videoIds.forEach(id => this.addVideoId(id));
    }
  }

  /**
   * Add multiple tweet IDs to the known set
   * @param {Array} tweetIds - Array of X/Twitter post IDs to add
   */
  addTweetIds(tweetIds) {
    if (Array.isArray(tweetIds)) {
      tweetIds.forEach(id => this.addTweetId(id));
    }
  }

  /**
   * Process content and detect duplicates for both videos and tweets
   * @param {string} content - Text content to process
   * @returns {Object} - Object containing video and tweet duplicate information
   */
  processContent(content) {
    const videoIds = this.extractVideoIds(content);
    const tweetIds = this.extractTweetIds(content);

    const result = {
      videos: {
        found: videoIds,
        duplicates: videoIds.filter(id => this.isVideoIdKnown(id)),
        new: videoIds.filter(id => !this.isVideoIdKnown(id)),
      },
      tweets: {
        found: tweetIds,
        duplicates: tweetIds.filter(id => this.isTweetIdKnown(id)),
        new: tweetIds.filter(id => !this.isTweetIdKnown(id)),
      },
    };

    // Add new IDs to known sets
    result.videos.new.forEach(id => this.addVideoId(id));
    result.tweets.new.forEach(id => this.addTweetId(id));

    return result;
  }

  /**
   * Clean up memory by removing old entries if size exceeds limit
   */
  cleanupIfNeeded() {
    if (this.knownVideoIds.size > this.maxSize) {
      this.cleanupSet(this.knownVideoIds);
    }
    if (this.knownTweetIds.size > this.maxSize) {
      this.cleanupSet(this.knownTweetIds);
    }
  }

  /**
   * Clean up a Set by keeping only the most recent 80% of entries
   * @param {Set} set - Set to clean up
   */
  cleanupSet(set) {
    const array = Array.from(set);
    const keepCount = Math.floor(this.maxSize * 0.8);
    const toKeep = array.slice(-keepCount);

    set.clear();
    toKeep.forEach(item => set.add(item));
  }

  /**
   * Start periodic cleanup timer
   */
  startPeriodicCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupIfNeeded();
    }, this.cleanupInterval);
  }

  /**
   * Stop periodic cleanup timer
   */
  stopPeriodicCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Scan Discord channel history for YouTube video IDs and populate known set
   * @param {Object} discordChannel - Discord channel object to scan
   * @param {number} limit - Maximum number of messages to scan (default: 1000)
   * @returns {Promise<Object>} - Object containing scan results
   */
  async scanDiscordChannelForVideos(discordChannel, limit = 1000) {
    if (!discordChannel || typeof discordChannel.messages?.fetch !== 'function') {
      throw new Error('Invalid Discord channel provided');
    }

    const results = {
      messagesScanned: 0,
      videoIdsFound: [],
      videoIdsAdded: 0,
      errors: [],
    };

    try {
      let lastMessageId = null;
      let totalScanned = 0;
      const batchSize = 100; // Discord API limit per request

      while (totalScanned < limit) {
        const fetchOptions = { limit: Math.min(batchSize, limit - totalScanned) };
        if (lastMessageId) {
          fetchOptions.before = lastMessageId;
        }

        const messages = await discordChannel.messages.fetch(fetchOptions);

        if (messages.size === 0) {
          break; // No more messages
        }

        for (const message of messages.values()) {
          const videoIds = this.extractVideoIds(message.content);

          if (videoIds.length > 0) {
            results.videoIdsFound.push(...videoIds);

            // Add to known set
            videoIds.forEach(id => {
              if (!this.isVideoIdKnown(id)) {
                this.addVideoId(id);
                results.videoIdsAdded++;
              }
            });
          }

          lastMessageId = message.id;
          totalScanned++;
          results.messagesScanned++;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      results.errors.push({
        type: 'fetch_error',
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    return results;
  }

  /**
   * Scan Discord channel history for tweet IDs and populate known set
   * @param {Object} discordChannel - Discord channel object to scan
   * @param {number} limit - Maximum number of messages to scan (default: 1000)
   * @returns {Promise<Object>} - Object containing scan results
   */
  async scanDiscordChannelForTweets(discordChannel, limit = 1000) {
    if (!discordChannel || typeof discordChannel.messages?.fetch !== 'function') {
      throw new Error('Invalid Discord channel provided');
    }

    const results = {
      messagesScanned: 0,
      tweetIdsFound: [],
      tweetIdsAdded: 0,
      errors: [],
    };

    try {
      let lastMessageId = null;
      let totalScanned = 0;
      const batchSize = 100; // Discord API limit per request

      while (totalScanned < limit) {
        const fetchOptions = { limit: Math.min(batchSize, limit - totalScanned) };
        if (lastMessageId) {
          fetchOptions.before = lastMessageId;
        }

        const messages = await discordChannel.messages.fetch(fetchOptions);

        if (messages.size === 0) {
          break; // No more messages
        }

        for (const message of messages.values()) {
          const tweetIds = this.extractTweetIds(message.content);

          if (tweetIds.length > 0) {
            results.tweetIdsFound.push(...tweetIds);

            // Add to known set
            tweetIds.forEach(id => {
              if (!this.isTweetIdKnown(id)) {
                this.addTweetId(id);
                results.tweetIdsAdded++;
              }
            });
          }

          lastMessageId = message.id;
          totalScanned++;
          results.messagesScanned++;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      results.errors.push({
        type: 'fetch_error',
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    return results;
  }

  /**
   * Clear all known IDs
   */
  reset() {
    this.knownVideoIds.clear();
    this.knownTweetIds.clear();
  }

  /**
   * Check if a URL is a duplicate (simplified interface for applications)
   * @param {string} url - URL to check for duplicates
   * @returns {boolean} - True if URL is a duplicate
   */
  isDuplicate(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }

    // Check for video URLs
    const videoIds = this.extractVideoIds(url);
    if (videoIds.length > 0) {
      return videoIds.some(id => this.isVideoIdKnown(id));
    }

    // Check for tweet URLs
    const tweetIds = this.extractTweetIds(url);
    if (tweetIds.length > 0) {
      return tweetIds.some(id => this.isTweetIdKnown(id));
    }

    return false;
  }

  /**
   * Mark a URL as seen (simplified interface for applications)
   * @param {string} url - URL to mark as seen
   */
  markAsSeen(url) {
    if (!url || typeof url !== 'string') {
      return;
    }

    // Add video IDs if found
    const videoIds = this.extractVideoIds(url);
    videoIds.forEach(id => this.addVideoId(id));

    // Add tweet IDs if found
    const tweetIds = this.extractTweetIds(url);
    tweetIds.forEach(id => this.addTweetId(id));
  }

  /**
   * Get statistics about known IDs
   * @returns {Object} - Statistics object
   */
  getStats() {
    return {
      knownVideoIds: this.knownVideoIds.size,
      knownTweetIds: this.knownTweetIds.size,
      totalKnownIds: this.knownVideoIds.size + this.knownTweetIds.size,
      maxSize: this.maxSize,
      cleanupInterval: this.cleanupInterval,
    };
  }

  /**
   * Destroy the duplicate detector and clean up resources
   */
  destroy() {
    this.stopPeriodicCleanup();
    this.reset();
  }
}

/**
 * Utility function to create a new duplicate detector instance
 * @param {Object} options - Configuration options
 * @returns {DuplicateDetector} - New duplicate detector instance
 */
export function createDuplicateDetector(options = {}) {
  return new DuplicateDetector(options.maxSize, options.cleanupInterval);
}
