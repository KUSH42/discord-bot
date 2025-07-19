import { splitMessage } from '../discord-utils.js';

/**
 * Pure business logic for announcing content to Discord channels
 * Handles message formatting and channel routing based on content type
 */
export class ContentAnnouncer {
  constructor(discordService, config, stateManager) {
    this.discord = discordService;
    this.config = config;
    this.state = stateManager;

    // Channel mapping based on content types
    this.channelMap = {
      youtube: {
        video: config.getRequired('DISCORD_YOUTUBE_CHANNEL_ID'),
        livestream: config.getRequired('DISCORD_YOUTUBE_CHANNEL_ID'),
        upcoming: config.getRequired('DISCORD_YOUTUBE_CHANNEL_ID'),
        short: config.getRequired('DISCORD_YOUTUBE_CHANNEL_ID'),
      },
      x: {
        post: config.getRequired('DISCORD_X_POSTS_CHANNEL_ID'),
        reply: config.getRequired('DISCORD_X_REPLIES_CHANNEL_ID'),
        quote: config.getRequired('DISCORD_X_QUOTES_CHANNEL_ID'),
        retweet: config.get('DISCORD_X_RETWEETS_CHANNEL_ID') || config.getRequired('DISCORD_X_POSTS_CHANNEL_ID'),
      },
    };

    this.supportChannelId = config.get('DISCORD_BOT_SUPPORT_LOG_CHANNEL');
  }

  /**
   * Announce content to the appropriate Discord channel
   * @param {Object} content - Content object with type, platform, and data
   * @param {Object} options - Announcement options
   * @returns {Promise<Object>} Announcement result
   */
  async announceContent(content, options = {}) {
    const result = {
      success: false,
      channelId: null,
      messageId: null,
      skipped: false,
      reason: null,
    };

    try {
      // Validate input
      const validation = this.validateContent(content);
      if (!validation.success) {
        result.reason = validation.error;
        return result;
      }

      // Check if announcements are enabled
      if (!this.shouldAnnounce(content, options)) {
        result.skipped = true;
        result.reason = this.getSkipReason(content, options);
        return result;
      }

      // Get target channel
      const channelId = this.getChannelForContent(content);
      if (!channelId) {
        result.reason = `No channel configured for ${content.platform} ${content.type}`;
        return result;
      }

      result.channelId = channelId;

      // Format message
      const message = this.formatMessage(content, options);

      // Send announcement
      const sentMessage = await this.discord.sendMessage(channelId, message);
      result.messageId = sentMessage.id;
      result.success = true;

      // Send mirror message if configured
      if (this.shouldMirrorMessage(channelId, options)) {
        await this.sendMirrorMessage(channelId, message, options);
      }

      return result;
    } catch (error) {
      result.reason = error.message;
      return result;
    }
  }

  /**
   * Validate content object
   * @param {Object} content - Content to validate
   * @returns {Object} Validation result
   */
  validateContent(content) {
    if (!content || typeof content !== 'object') {
      return { success: false, error: 'Content must be an object' };
    }

    if (!content.platform || typeof content.platform !== 'string') {
      return { success: false, error: 'Content must have a platform' };
    }

    if (!content.type || typeof content.type !== 'string') {
      return { success: false, error: 'Content must have a type' };
    }

    if (!this.channelMap[content.platform]) {
      return { success: false, error: `Unsupported platform: ${content.platform}` };
    }

    if (!this.channelMap[content.platform][content.type]) {
      return { success: false, error: `Unsupported content type: ${content.type} for platform ${content.platform}` };
    }

    return { success: true };
  }

  /**
   * Check if content should be announced
   * @param {Object} content - Content object
   * @param {Object} options - Announcement options
   * @returns {boolean} True if should announce
   */
  shouldAnnounce(content, options) {
    // Check force override first
    if (options.force === true) {
      return true;
    }

    // Check global posting status
    if (!this.state.get('postingEnabled', true)) {
      return false;
    }

    // Check announcement-specific status
    if (!this.state.get('announcementEnabled', true)) {
      return false;
    }

    // Platform-specific checks
    if (content.platform === 'youtube') {
      return this.shouldAnnounceYouTubeContent(content, options);
    }

    if (content.platform === 'x') {
      return this.shouldAnnounceXContent(content, options);
    }

    return true;
  }

  /**
   * Check if YouTube content should be announced
   * @param {Object} content - YouTube content
   * @param {Object} options - Options
   * @returns {boolean} True if should announce
   */
  shouldAnnounceYouTubeContent(content) {
    // Check if content is new enough
    if (content.publishedAt && this.state.get('botStartTime')) {
      const publishedTime = new Date(content.publishedAt);
      const botStartTime = this.state.get('botStartTime');

      if (publishedTime < botStartTime) {
        return false; // Don't announce old content
      }
    }

    return true;
  }

  /**
   * Check if X content should be announced
   * @param {Object} content - X content
   * @param {Object} options - Options
   * @returns {boolean} True if should announce
   */
  shouldAnnounceXContent(content) {
    // Check if old tweets should be announced
    const announceOldTweets = this.config.getBoolean('ANNOUNCE_OLD_TWEETS', false);
    if (!announceOldTweets && content.isOld) {
      return false;
    }

    return true;
  }

  /**
   * Get reason why content was skipped
   * @param {Object} content - Content object
   * @param {Object} options - Options
   * @returns {string} Skip reason
   */
  getSkipReason(content) {
    if (!this.state.get('postingEnabled', true)) {
      return 'Bot posting is disabled';
    }

    if (!this.state.get('announcementEnabled', true)) {
      return 'Announcements are disabled';
    }

    if (content.platform === 'youtube' && content.publishedAt && this.state.get('botStartTime')) {
      const publishedTime = new Date(content.publishedAt);
      const botStartTime = this.state.get('botStartTime');

      if (publishedTime < botStartTime) {
        return 'Content was published before bot started';
      }
    }

    if (content.platform === 'x' && content.isOld) {
      const announceOldTweets = this.config.getBoolean('ANNOUNCE_OLD_TWEETS', false);
      if (!announceOldTweets) {
        return 'Old tweets are not configured to be announced';
      }
    }

    return 'Unknown reason';
  }

  /**
   * Get channel ID for content type
   * @param {Object} content - Content object
   * @returns {string|null} Channel ID
   */
  getChannelForContent(content) {
    return this.channelMap[content.platform]?.[content.type] || null;
  }

  /**
   * Format message for content
   * @param {Object} content - Content object
   * @param {Object} options - Formatting options
   * @returns {string|Object} Formatted message
   */
  formatMessage(content, options = {}) {
    if (content.platform === 'youtube') {
      return this.formatYouTubeMessage(content, options);
    }

    if (content.platform === 'x') {
      return this.formatXMessage(content, options);
    }

    // Generic fallback
    return this.formatGenericMessage(content, options);
  }

  /**
   * Format YouTube content message
   * @param {Object} content - YouTube content
   * @param {Object} options - Options
   * @returns {string|Object} Formatted message
   */
  formatYouTubeMessage(content, options) {
    const { title, url, type, channelTitle } = content;

    let emoji = '📺';
    let typeText = 'video';

    switch (type) {
      case 'livestream':
        emoji = '🔴';
        typeText = 'is now live';
        break;
      case 'upcoming':
        emoji = '📅';
        typeText = 'scheduled';
        break;
      case 'short':
        emoji = '🩳';
        typeText = 'Short';
        break;
      default:
        emoji = '🎬';
        typeText = 'uploaded a new video';
    }

    if (options.useEmbed && type === 'livestream') {
      return {
        embeds: [
          {
            title: `🔴 ${channelTitle || 'Channel'} is now live!`,
            description: title,
            url,
            color: 0xff0000, // Red for live
            timestamp: new Date().toISOString(),
            fields: [
              {
                name: 'Watch now',
                value: url,
                inline: false,
              },
            ],
          },
        ],
      };
    }

    return `${emoji} **${channelTitle || 'Channel'}** ${typeText}:\n**${title}**\n${url}`;
  }

  /**
   * Format X (Twitter) content message
   * @param {Object} content - X content
   * @param {Object} options - Options
   * @returns {string} Formatted message
   */
  formatXMessage(content) {
    const { author, url, type, retweetedBy } = content;
    let emoji = '🐦';
    let actionText = 'posted';

    switch (type) {
      case 'reply':
        emoji = '↩️';
        actionText = 'replied';
        break;
      case 'quote':
        emoji = '💬';
        actionText = 'quoted';
        break;
      case 'retweet':
        emoji = '🔄';
        actionText = 'retweeted';
        break;
      default:
        emoji = '🐦';
        actionText = 'posted';
    }

    let finalUrl = url;

    // Apply VX Twitter conversion if enabled
    if (this.state.get('vxTwitterConversionEnabled', false)) {
      finalUrl = this.convertToVxTwitter(url);
    }

    let message = `${emoji} **${author}** ${actionText}:\n${finalUrl}`;
    if (type === 'retweet' && retweetedBy) {
      message = `${emoji} **${retweetedBy}** retweeted:\n**${author}**: ${finalUrl}`;
    }

    return message;
  }

  /**
   * Format generic content message
   * @param {Object} content - Generic content
   * @param {Object} options - Options
   * @returns {string} Formatted message
   */
  formatGenericMessage(content) {
    const { title, url, author, platform, type } = content;

    let message = `📎 **New ${platform} ${type}**`;

    if (author) {
      message += ` from **${author}**`;
    }

    if (title) {
      message += `:\n**${title}**`;
    }

    if (url) {
      message += `\n${url}`;
    }

    return message;
  }

  /**
   * Convert X URL to VX Twitter format
   * @param {string} url - Original X/Twitter URL
   * @returns {string} VX Twitter URL
   */
  convertToVxTwitter(url) {
    if (!url || typeof url !== 'string') {
      return url;
    }

    return url
      .replace(/^https?:\/\/twitter\.com/, 'https://vxtwitter.com')
      .replace(/^https?:\/\/x\.com/, 'https://vxtwitter.com');
  }

  /**
   * Check if message should be mirrored to support channel
   * @param {string} channelId - Target channel ID
   * @param {Object} options - Options
   * @returns {boolean} True if should mirror
   */
  shouldMirrorMessage(channelId, options) {
    if (!this.supportChannelId || options.noMirror === true) {
      return false;
    }

    // Don't mirror messages sent to the support channel itself
    if (channelId === this.supportChannelId) {
      return false;
    }

    return options.mirror === true || this.config.getBoolean('MIRROR_ANNOUNCEMENTS', false);
  }

  /**
   * Send mirror message to support channel
   * @param {string} originalChannelId - Original channel ID
   * @param {string|Object} originalMessage - Original message
   * @param {Object} options - Options
   * @returns {Promise<void>}
   */
  async sendMirrorMessage(originalChannelId, originalMessage) {
    try {
      const channel = await this.discord.fetchChannel(originalChannelId);
      const channelName = channel?.name || 'unknown-channel';

      let mirrorContent;

      if (typeof originalMessage === 'string') {
        mirrorContent = `[Bot message from #${channelName}]:\n>>> ${originalMessage}`;
      } else {
        // Handle embed messages
        mirrorContent = `[Bot message from #${channelName}]: Embed message sent`;
      }

      // Split long messages
      const messageParts = splitMessage(mirrorContent);

      for (const part of messageParts) {
        if (part.trim()) {
          await this.discord.sendMessage(this.supportChannelId, part);
        }
      }
    } catch (error) {
      // Log error but don't fail the main announcement
      console.warn(`Failed to send mirror message: ${error.message}`);
    }
  }

  /**
   * Send notification about disabled posting
   * @param {string} targetChannelId - Target channel that was skipped
   * @param {Object} content - Content that was skipped
   * @returns {Promise<void>}
   */
  async sendDisabledNotification(targetChannelId, content) {
    if (!this.supportChannelId || targetChannelId === this.supportChannelId) {
      return;
    }

    try {
      const channel = await this.discord.fetchChannel(targetChannelId);
      const channelName = channel?.name || 'unknown-channel';

      const message = `(Posting is currently disabled. Skipped ${content.platform} ${content.type} announcement to #${channelName})`;

      await this.discord.sendMessage(this.supportChannelId, message);
    } catch (error) {
      console.warn(`Failed to send disabled notification: ${error.message}`);
    }
  }

  /**
   * Get announcement statistics
   * @returns {Object} Statistics about announcements
   */
  getStats() {
    return {
      supportedPlatforms: Object.keys(this.channelMap),
      channelMapping: this.channelMap,
      supportChannelId: this.supportChannelId,
      postingEnabled: this.state.get('postingEnabled', true),
      announcementEnabled: this.state.get('announcementEnabled', false),
      vxTwitterEnabled: this.state.get('vxTwitterConversionEnabled', false),
    };
  }

  /**
   * Bulk announce multiple content items
   * @param {Array<Object>} contentItems - Array of content objects
   * @param {Object} options - Bulk announcement options
   * @returns {Promise<Array<Object>>} Array of announcement results
   */
  async bulkAnnounce(contentItems, options = {}) {
    const results = [];
    const delay = options.delay || 0; // Delay between announcements to avoid rate limits

    for (const content of contentItems) {
      try {
        const result = await this.announceContent(content, options);
        results.push({ content, result });

        if (delay > 0 && results.length < contentItems.length) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        results.push({
          content,
          result: {
            success: false,
            reason: error.message,
          },
        });
      }
    }

    return results;
  }
}
