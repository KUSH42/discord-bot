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
 * Enhanced Duplicate Detector
 * Implements persistent, reliable duplicate detection with content fingerprinting
 */
export class DuplicateDetector {
  constructor(persistentStorage, logger) {
    // Make persistentStorage optional - we'll use only in-memory caches and Discord history
    this.storage = persistentStorage; // May be null - that's fine
    this.logger = logger;
    // In-memory cache for performance
    this.fingerprintCache = new Set();
    this.urlCache = new Set();
    this.maxSize = 10000; // Maximum cache size for memory management

    // Legacy compatibility cache
    this.knownVideoIds = new Set();
    this.knownTweetIds = new Set();

    // Flag to indicate whether persistent storage is disabled
    this.persistentStorageDisabled = !persistentStorage;
    if (this.persistentStorageDisabled && this.logger) {
      this.logger.info('PersistentStorage disabled - using only in-memory caches and Discord history');
    }
  }

  /**
   * Generates a unique "fingerprint" for a piece of content.
   * This is more reliable than URLs, which can sometimes change.
   * @param {object} content - The content object.
   * @returns {string|null} A unique fingerprint string or null if not possible.
   * @private
   */
  _generateContentFingerprint(content) {
    if (!content || typeof content !== 'object') {
      return null;
    }
    const normalizedTitle = this._normalizeTitle(content.title || '');
    const contentId = this._extractContentId(content.url || '');
    const publishTime = content.publishedAt ? new Date(content.publishedAt).getTime() : 0;
    const timeSlot = Math.floor(publishTime / 60000); // 1-minute precision
    return `${contentId}:${normalizedTitle}:${timeSlot}`;
  }

  /**
   * The primary method to check for duplicates using a robust fingerprint.
   * @param {object|string} content - The content object or URL string (for backward compatibility).
   * @returns {Promise<boolean>} True if the content is a duplicate.
   */
  async isDuplicate(content) {
    // Handle legacy string URLs for backward compatibility
    if (typeof content === 'string') {
      return this.isDuplicateByUrl(content);
    }

    const fingerprint = this._generateContentFingerprint(content);
    if (!fingerprint) {
      // Fallback to URL check if fingerprint cannot be generated
      return this.isDuplicateByUrl(content.url);
    }
    // Check in-memory cache first for speed
    if (this.fingerprintCache.has(fingerprint)) {
      return true;
    }
    // Check persistent storage only if available
    if (!this.persistentStorageDisabled && this.storage) {
      const isDupe = await this.storage.hasFingerprint(fingerprint);
      if (isDupe) {
        this.fingerprintCache.add(fingerprint); // Cache for next time
      }
      return isDupe;
    }
    // Without persistent storage, only rely on in-memory cache
    return false;
  }

  /**
   * Marks content as seen using its robust fingerprint.
   * @param {object|string} content - The content object or URL string (for backward compatibility).
   */
  async markAsSeen(content) {
    // Handle legacy string URLs for backward compatibility
    if (typeof content === 'string') {
      return this.markAsSeenByUrl(content);
    }

    const fingerprint = this._generateContentFingerprint(content);
    if (fingerprint) {
      this.fingerprintCache.add(fingerprint);
      // Store to persistent storage only if available
      if (!this.persistentStorageDisabled && this.storage) {
        await this.storage.storeFingerprint(fingerprint, {
          url: content.url,
          title: content.title,
          publishedAt: content.publishedAt,
        });
      }
    }
    // Also mark the URL as seen for fallback checks
    await this.markAsSeenByUrl(content.url);
  }

  /**
   * Fallback check using a normalized URL.
   * @param {string} url - The URL of the content.
   * @returns {Promise<boolean>} True if the URL has been seen.
   */
  async isDuplicateByUrl(url) {
    const normalizedUrl = this._normalizeUrl(url);
    if (this.urlCache.has(normalizedUrl)) {
      return true;
    }

    // Check persistent storage only if available
    if (!this.persistentStorageDisabled && this.storage) {
      const exists = await this.storage.hasUrl(normalizedUrl);
      if (exists) {
        this.urlCache.add(normalizedUrl);
      }
      return exists;
    }

    // Without persistent storage, only rely on in-memory cache
    return false;
  }

  /**
   * Fallback method to mark a normalized URL as seen.
   * @param {string} url - The URL of the content.
   */
  async markAsSeenByUrl(url) {
    const normalizedUrl = this._normalizeUrl(url);
    this.urlCache.add(normalizedUrl);

    // Store to persistent storage only if available
    if (!this.persistentStorageDisabled && this.storage) {
      await this.storage.addUrl(normalizedUrl);
    }

    // Also update legacy compatibility sets
    const videoMatches = [...url.matchAll(videoUrlRegex)];
    const tweetMatches = [...url.matchAll(tweetUrlRegex)];

    videoMatches.forEach(match => {
      if (match[1]) {
        this.knownVideoIds.add(match[1]);
      }
    });

    tweetMatches.forEach(match => {
      if (match[1]) {
        this.knownTweetIds.add(match[1]);
      }
    });
  }

  _normalizeUrl(url) {
    if (!url) {
      return url;
    }

    const videoId = this._extractVideoId(url);
    if (videoId) {
      return `https://www.youtube.com/watch?v=${videoId}`;
    }

    // Normalize X/Twitter URLs
    const tweetId = this._extractTweetId(url);
    if (tweetId) {
      return `https://x.com/i/status/${tweetId}`;
    }

    return url;
  }

  _extractVideoId(url) {
    if (!url) {
      return null;
    }
    // Create a non-global version for single extraction
    const videoRegex =
      /https?:\/\/(?:(?:www\.)?youtube\.com\/(?:watch\?v=|live\/|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(videoRegex);
    return match ? match[1] : null;
  }

  _extractTweetId(url) {
    if (!url) {
      return null;
    }
    // Create a non-global version for single extraction
    const tweetRegex =
      /https?:\/\/(?:[\w-]+\.)*(?:x\.com|twitter\.com|vxtwitter\.com|fxtwitter\.com|nitter\.[^/]+)\/(?:(?:i\/web\/)?status(?:es)?|[^/]+\/status(?:es)?)\/(\d{10,})/;
    const match = url.match(tweetRegex);
    return match ? match[1] : null;
  }

  _extractContentId(url) {
    return this._extractVideoId(url) || this._extractTweetId(url) || null;
  }

  _normalizeTitle(title) {
    return (title || '')
      .toLowerCase()
      .replace(/[^\w\s]/gi, '') // Remove special characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  // === Public methods for enhanced testing and functionality ===

  /**
   * Public wrapper for _generateContentFingerprint for testing
   */
  generateContentFingerprint(content) {
    return this._generateContentFingerprint(content);
  }

  /**
   * Public wrapper for _normalizeTitle for testing
   */
  normalizeTitle(title) {
    return this._normalizeTitle(title);
  }

  /**
   * Public wrapper for _extractContentId for testing
   */
  extractContentId(url) {
    return this._extractContentId(url);
  }

  /**
   * Public wrapper for _normalizeUrl for testing
   */
  normalizeUrl(url) {
    return this._normalizeUrl(url);
  }

  /**
   * Enhanced duplicate detection using fingerprinting
   */
  async isDuplicateWithFingerprint(content) {
    return await this.isDuplicate(content);
  }

  /**
   * Mark content as seen using fingerprinting
   */
  async markAsSeenWithFingerprint(content) {
    await this.markAsSeen(content);
  }

  /**
   * Process content with fingerprinting and return detailed results
   */
  async processContentWithFingerprint(content) {
    // Handle string input for backwards compatibility
    if (typeof content === 'string') {
      content = { url: content };
    }

    const fingerprint = this._generateContentFingerprint(content);
    const isDuplicateFingerprint = fingerprint ? await this.isDuplicate(content) : false;
    const isDuplicateUrl = await this.isDuplicateByUrl(content.url);

    // Extract video and tweet IDs for legacy compatibility
    const videoMatches = [...(content.url || '').matchAll(videoUrlRegex)];
    const tweetMatches = [...(content.url || '').matchAll(tweetUrlRegex)];

    // Check if fingerprinting is meaningful (has title or publishedAt)
    const fingerprintingEnabled = !!fingerprint && (!!content.title || !!content.publishedAt);

    const result = {
      videos: videoMatches.map(match => match[1]).filter(Boolean),
      tweets: tweetMatches.map(match => match[1]).filter(Boolean),
      fingerprint: {
        enabled: fingerprintingEnabled,
        generated: fingerprint,
        isDuplicate: isDuplicateFingerprint || isDuplicateUrl,
      },
    };

    // Mark as seen if not duplicate
    if (!result.fingerprint.isDuplicate) {
      await this.markAsSeen(content);
    }

    return result;
  }

  /**
   * Determine the content type from URL
   */
  determineContentType(url) {
    if (this._extractVideoId(url)) {
      return 'youtube_video';
    }
    if (this._extractTweetId(url)) {
      return 'x_tweet';
    }
    return 'unknown';
  }

  /**
   * Get enhanced statistics with fingerprint information
   */
  getEnhancedStats() {
    return {
      fingerprints: this.fingerprintCache.size,
      urls: this.urlCache.size,
      knownVideoIds: this.knownVideoIds.size,
      knownTweetIds: this.knownTweetIds.size,
      totalKnownIds: this.fingerprintCache.size + this.urlCache.size,
      fingerprintingEnabled: true,
    };
  }

  /**
   * Legacy isDuplicate method for backwards compatibility with string URLs
   */
  isDuplicateCompat(url) {
    // Extract video/tweet IDs and check against legacy sets
    const videoMatches = [...url.matchAll(videoUrlRegex)];
    const tweetMatches = [...url.matchAll(tweetUrlRegex)];

    for (const match of videoMatches) {
      if (this.knownVideoIds.has(match[1])) {
        return true;
      }
    }

    for (const match of tweetMatches) {
      if (this.knownTweetIds.has(match[1])) {
        return true;
      }
    }

    return false;
  }

  /**
   * Legacy markAsSeen method for backwards compatibility with string URLs
   */
  markAsSeenCompat(url) {
    const videoMatches = [...url.matchAll(videoUrlRegex)];
    const tweetMatches = [...url.matchAll(tweetUrlRegex)];

    videoMatches.forEach(match => {
      if (match[1]) {
        this.knownVideoIds.add(match[1]);
      }
    });

    tweetMatches.forEach(match => {
      if (match[1]) {
        this.knownTweetIds.add(match[1]);
      }
    });
  }

  /**
   * Memory management - clean up old entries
   */
  _cleanupMemory() {
    if (this.fingerprintCache.size > this.maxSize) {
      // Convert to array, slice to keep only recent entries
      const fingerprintArray = Array.from(this.fingerprintCache);
      this.fingerprintCache.clear();
      fingerprintArray.slice(-Math.floor(this.maxSize * 0.8)).forEach(fp => {
        this.fingerprintCache.add(fp);
      });
    }

    if (this.urlCache.size > this.maxSize) {
      const urlArray = Array.from(this.urlCache);
      this.urlCache.clear();
      urlArray.slice(-Math.floor(this.maxSize * 0.8)).forEach(url => {
        this.urlCache.add(url);
      });
    }
  }

  /**
   * Scan Discord channel for YouTube video URLs and extract video IDs
   * @param {Object} channel - Discord channel object with messages
   * @param {number} limit - Maximum number of messages to scan
   * @returns {Promise<Object>} Results with messagesScanned, videoIdsFound, videoIdsAdded
   */
  async scanDiscordChannelForVideos(channel, limit = 100) {
    if (!channel || !channel.messages) {
      throw new Error('Invalid Discord channel provided');
    }

    const results = {
      messagesScanned: 0,
      videoIdsFound: [],
      videoIdsAdded: 0,
      errors: [],
    };

    try {
      let messagesProcessed = 0;
      let lastId = null;

      while (messagesProcessed < limit) {
        const fetchOptions = { limit: Math.min(50, limit - messagesProcessed) };
        if (lastId) {
          fetchOptions.before = lastId;
        }

        const messages = await channel.messages.fetch(fetchOptions);
        if (messages.size === 0) {
          break;
        }

        for (const [, message] of messages) {
          const videoMatches = [...(message.content || '').matchAll(videoUrlRegex)];
          for (const match of videoMatches) {
            const videoId = match[1];
            const videoUrl = match[0];
            if (videoId && videoUrl) {
              results.videoIdsFound.push(videoId);
              // Use modern duplicate detection system instead of legacy Sets
              if (!(await this.isDuplicateByUrl(videoUrl))) {
                await this.markAsSeenByUrl(videoUrl);
                results.videoIdsAdded++;
              }
            }
          }
          messagesProcessed++;
          if (messagesProcessed >= limit) {
            break;
          }
        }

        lastId = messages.last()?.id;

        // Rate limiting between batches
        if (messages.size > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      results.messagesScanned = messagesProcessed;
    } catch (error) {
      results.errors.push({
        type: 'fetch_error',
        message: error.message,
      });
    }

    return results;
  }

  /**
   * Scan Discord channel for X/Twitter URLs and extract tweet IDs
   * @param {Object} channel - Discord channel object with messages
   * @param {number} limit - Maximum number of messages to scan
   * @returns {Promise<Object>} Results with messagesScanned, tweetIdsFound, tweetIdsAdded
   */
  async scanDiscordChannelForTweets(channel, limit = 100) {
    if (!channel || !channel.messages) {
      throw new Error('Invalid Discord channel provided');
    }

    const results = {
      messagesScanned: 0,
      tweetIdsFound: [],
      tweetIdsAdded: 0,
      errors: [],
    };

    try {
      let messagesProcessed = 0;
      let lastId = null;

      while (messagesProcessed < limit) {
        const fetchOptions = { limit: Math.min(50, limit - messagesProcessed) };
        if (lastId) {
          fetchOptions.before = lastId;
        }

        const messages = await channel.messages.fetch(fetchOptions);
        if (messages.size === 0) {
          break;
        }

        for (const [, message] of messages) {
          const tweetMatches = [...(message.content || '').matchAll(tweetUrlRegex)];
          for (const match of tweetMatches) {
            const tweetId = match[1];
            const tweetUrl = match[0];
            if (tweetId && tweetUrl) {
              results.tweetIdsFound.push(tweetId);
              // Use modern duplicate detection system instead of legacy Sets
              if (!(await this.isDuplicateByUrl(tweetUrl))) {
                await this.markAsSeenByUrl(tweetUrl);
                results.tweetIdsAdded++;
              }
            }
          }
          messagesProcessed++;
          if (messagesProcessed >= limit) {
            break;
          }
        }

        lastId = messages.last()?.id;

        // Rate limiting between batches
        if (messages.size > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      results.messagesScanned = messagesProcessed;
    } catch (error) {
      results.errors.push({
        type: 'fetch_error',
        message: error.message,
      });
    }

    return results;
  }

  /**
   * Get statistics about the duplicate detector
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      fingerprints: this.fingerprintCache.size,
      urls: this.urlCache.size,
      knownVideoIds: this.knownVideoIds.size,
      knownTweetIds: this.knownTweetIds.size,
      totalKnownIds: this.fingerprintCache.size + this.urlCache.size,
      fingerprintingEnabled: true,
    };
  }

  /**
   * Check if a video ID is known
   * @param {string} videoId - YouTube video ID
   * @returns {boolean} True if video ID is known
   */
  isVideoIdKnown(videoId) {
    return this.knownVideoIds.has(videoId);
  }

  /**
   * Add a video ID to the known set (legacy compatibility method)
   * @param {string} videoId - YouTube video ID
   */
  addVideoId(videoId) {
    this.knownVideoIds.add(videoId);
  }

  /**
   * Check if a tweet ID is known
   * @param {string} tweetId - Tweet ID
   * @returns {boolean} True if tweet ID is known
   */
  isTweetIdKnown(tweetId) {
    return this.knownTweetIds.has(tweetId);
  }

  /**
   * Cleanup method (for test compatibility)
   */
  destroy() {
    this.fingerprintCache.clear();
    this.urlCache.clear();
    this.knownVideoIds.clear();
    this.knownTweetIds.clear();
  }
}
