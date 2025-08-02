/**
 * Pure business logic for classifying content from different platforms
 * No side effects - only analyzes input and returns classification results
 */
export class ContentClassifier {
  constructor() {
    // URL patterns for content classification
    this.patterns = {
      youtube: {
        video: /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
        channel: /youtube\.com\/channel\/([A-Za-z0-9_-]{24})/,
        playlist: /youtube\.com\/playlist\?list=([A-Za-z0-9_-]+)/,
      },
      x: {
        status: /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/,
        profile: /(?:twitter\.com|x\.com)\/(\w+)(?:\/.*)?$/,
      },
    };
  }

  /**
   * Classify X (Twitter) content based on URL and text analysis
   * @param {string} url - Tweet URL
   * @param {string} text - Tweet text content
   * @param {Object} metadata - Additional metadata about the tweet
   * @returns {Object} Classification result
   */
  classifyXContent(url, text = '', metadata = {}) {
    const result = {
      platform: 'x',
      type: 'unknown',
      confidence: 0,
      details: {},
    };

    // Validate inputs
    if (!url || typeof url !== 'string') {
      result.error = 'Invalid URL provided';
      return result;
    }

    // Check if it's a valid X/Twitter URL
    if (!this.isXUrl(url)) {
      result.error = 'URL is not from X (Twitter)';
      return result;
    }

    // Extract status ID
    const statusMatch = url.match(this.patterns.x.status);
    if (!statusMatch) {
      result.type = 'profile';
      result.confidence = 0.9;
      return result;
    }

    result.details.statusId = statusMatch[1];

    // Analyze content to determine type
    const classification = this.analyzeXContentType(text, metadata);
    result.type = classification.type;
    result.confidence = classification.confidence;
    result.details = { ...result.details, ...classification.details };

    return result;
  }

  /**
   * Analyze X content to determine if it's a post, reply, quote, or retweet
   * @param {string} text - Tweet text
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Type classification
   */
  analyzeXContentType(text = '', metadata = {}) {
    const result = {
      type: 'post',
      confidence: 0.8,
      details: {},
    };

    // Check for reply indicators
    if (this.isReply(text, metadata)) {
      result.type = 'reply';
      result.confidence = 0.9;
      result.details.replyIndicators = this.getReplyIndicators(text, metadata);
      return result;
    }

    // Check for retweet indicators
    if (this.isRetweet(text, metadata)) {
      result.type = 'retweet';
      result.confidence = 0.95;
      result.details.retweetIndicators = this.getRetweetIndicators(text, metadata);
      return result;
    }

    // Check for quote tweet indicators
    if (this.isQuoteTweet(text, metadata)) {
      result.type = 'quote';
      result.confidence = 0.85;
      result.details.quoteIndicators = this.getQuoteIndicators(text, metadata);
      return result;
    }

    // Default to post
    return result;
  }

  /**
   * Check if content is a reply
   * @param {string} text - Tweet text
   * @param {Object} metadata - Additional metadata
   * @returns {boolean} True if content is a reply
   */
  isReply(text, metadata) {
    // Check metadata first
    if (metadata && (metadata.isReply === true || metadata.inReplyTo)) {
      return true;
    }

    // Check social context for reply indicators (most reliable for modern X/Twitter)
    if (metadata && metadata.socialContext) {
      const socialContext = metadata.socialContext.toLowerCase();
      if (socialContext.includes('replying to') || socialContext.includes('reply to')) {
        return true;
      }
    }

    // Check all text content for reply indicators
    if (metadata && metadata.allText) {
      const fullText = metadata.allText.toLowerCase();
      if (fullText.includes('replying to') || fullText.includes('reply to')) {
        return true;
      }
    }

    // Check text patterns
    if (typeof text === 'string') {
      // Starts with @username pattern
      if (/^@\w+/.test(text.trim())) {
        return true;
      }

      // Contains "Replying to" text
      if (text.includes('Replying to')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if content is a retweet using enhanced detection
   * @param {string} text - Tweet text
   * @param {Object} metadata - Additional metadata
   * @returns {boolean} True if content is a retweet
   */
  isRetweet(text, metadata) {
    // Primary check: Author-based detection (most reliable)
    if (metadata && metadata.author && metadata.xUser) {
      const { author } = metadata;
      const { xUser } = metadata;

      // If author differs from monitored user, it's a retweet
      if (author !== xUser && author !== `@${xUser}` && author !== 'Unknown') {
        return true;
      }
    }

    // Check retweetedBy field as backup detection method
    if (metadata && metadata.retweetedBy && metadata.xUser) {
      if (metadata.retweetedBy === metadata.xUser) {
        return true;
      }
    }

    // Use enhanced detection if DOM element is available
    if (metadata && metadata.domElement) {
      const enhancedResult = this.enhancedRetweetDetection(metadata.domElement);
      if (enhancedResult.isRetweet) {
        return true;
      }
    }

    // Fallback to existing metadata checks
    if (metadata && (metadata.isRetweet === true || metadata.retweetedStatus)) {
      return true;
    }

    // Fallback to text pattern checks
    if (typeof text === 'string') {
      // Starts with RT @ pattern
      if (/^RT @\w+/.test(text.trim())) {
        return true;
      }

      // Contains retweet indicators
      if (text.includes('retweeted') || text.includes('RT @') || text.includes('reposted')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if content is a quote tweet
   * @param {string} text - Tweet text
   * @param {Object} metadata - Additional metadata
   * @returns {boolean} True if content is a quote tweet
   */
  isQuoteTweet(text, metadata) {
    // Check metadata first
    if (metadata && (metadata.isQuote === true || metadata.quotedStatus || metadata.quoteTweetUrl)) {
      return true;
    }

    // Check for quote tweet block from DOM analysis (most reliable for modern X/Twitter)
    if (metadata && metadata.quoteTweetBlock === true) {
      return true;
    }

    // Check for embedded tweet URL pattern in all text content
    if (metadata && metadata.allText) {
      const quoteTweetPattern = /https?:\/\/(?:twitter\.com|x\.com)\/\w+\/status\/\d+/;
      if (quoteTweetPattern.test(metadata.allText)) {
        return true;
      }
    }

    // Check for embedded tweet URL pattern in main text
    if (typeof text === 'string') {
      const quoteTweetPattern = /https?:\/\/(?:twitter\.com|x\.com)\/\w+\/status\/\d+/;
      if (quoteTweetPattern.test(text)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get reply indicators from content
   * @param {string} text - Tweet text
   * @param {Object} metadata - Additional metadata
   * @returns {Array} Array of reply indicators
   */
  getReplyIndicators(text, metadata) {
    const indicators = [];

    if (metadata && metadata.inReplyTo) {
      indicators.push(`Reply to ${metadata.inReplyTo}`);
    }

    // Check social context for reply indicators
    if (metadata && metadata.socialContext) {
      const socialContext = metadata.socialContext.toLowerCase();
      if (socialContext.includes('replying to') || socialContext.includes('reply to')) {
        indicators.push(`Social context: ${metadata.socialContext}`);
      }
    }

    // Check all text content for reply indicators
    if (metadata && metadata.allText) {
      const fullText = metadata.allText.toLowerCase();
      if (fullText.includes('replying to') || fullText.includes('reply to')) {
        indicators.push('Contains reply text in full content');
      }
    }

    if (typeof text === 'string') {
      const mentionMatch = text.match(/^@(\w+)/);
      if (mentionMatch) {
        indicators.push(`Mentions @${mentionMatch[1]}`);
      }

      if (text.includes('Replying to')) {
        indicators.push('Contains "Replying to" text');
      }
    }

    return indicators;
  }

  /**
   * Enhanced retweet detection using multiple strategies
   * @param {Element} tweetElement - Tweet DOM element
   * @returns {Object} Detection result with confidence and metadata
   */
  enhancedRetweetDetection(tweetElement) {
    if (!tweetElement) {
      return { isRetweet: false, confidence: 0, method: 'no-element' };
    }

    const strategies = [
      this.detectBySocialContext.bind(this),
      this.detectByRetweetText.bind(this),
      this.detectByAuthorLink.bind(this),
      this.detectByTimelineContext.bind(this),
    ];

    for (const strategy of strategies) {
      const result = strategy(tweetElement);
      if (result.isRetweet) {
        return result;
      }
    }

    return { isRetweet: false, confidence: 0, method: 'no-match' };
  }

  /**
   * Detect retweet using socialContext testid (primary method)
   * @param {Element} tweetElement - Tweet DOM element
   * @returns {Object} Detection result
   */
  detectBySocialContext(tweetElement) {
    if (!tweetElement || typeof tweetElement.querySelector !== 'function') {
      return { isRetweet: false, confidence: 0, method: 'no-element' };
    }

    const socialContext = tweetElement.querySelector('[data-testid="socialContext"]');
    if (socialContext && /reposted|retweeted/i.test(socialContext.textContent)) {
      const retweetedBy = this.extractRetweetAuthor(socialContext);
      return {
        isRetweet: true,
        confidence: 0.95,
        method: 'socialContext',
        retweetedBy,
      };
    }
    return { isRetweet: false, confidence: 0, method: 'no-match' };
  }

  /**
   * Extract retweet author from social context
   * @param {Element} socialContext - Social context element
   * @returns {string|null} Retweeted by username
   */
  extractRetweetAuthor(socialContext) {
    try {
      const text = socialContext.textContent;
      const match = text.match(/(.+?)\s+(?:reposted|retweeted)/i);
      return match ? match[1].trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Detect retweet using text patterns (fallback)
   * @param {Element} tweetElement - Tweet DOM element
   * @returns {Object} Detection result
   */
  detectByRetweetText(tweetElement) {
    try {
      const textElement = tweetElement.querySelector('[data-testid="tweetText"], [lang] span, div[dir="ltr"]');
      if (textElement) {
        const text = textElement.textContent || textElement.innerText;
        if (/^RT @\w+/.test(text.trim())) {
          return {
            isRetweet: true,
            confidence: 0.85,
            method: 'textPattern',
          };
        }
      }
    } catch {
      // Ignore errors in fallback detection
    }
    return { isRetweet: false };
  }

  /**
   * Detect retweet using author link patterns
   * @param {Element} tweetElement - Tweet DOM element
   * @returns {Object} Detection result
   */
  detectByAuthorLink(tweetElement) {
    try {
      // Look for multiple author links which can indicate retweets
      const authorLinks = tweetElement.querySelectorAll('[data-testid="User-Name"] a, [data-testid="User-Names"] a');
      if (authorLinks.length > 1) {
        return {
          isRetweet: true,
          confidence: 0.7,
          method: 'multipleAuthors',
        };
      }
    } catch {
      // Ignore errors in fallback detection
    }
    return { isRetweet: false };
  }

  /**
   * Detect retweet using timeline context
   * @param {Element} tweetElement - Tweet DOM element
   * @returns {Object} Detection result
   */
  detectByTimelineContext(tweetElement) {
    try {
      // Look for retweet indicators in the broader context
      const allText = tweetElement.textContent || tweetElement.innerText || '';
      if (/\b(?:reposted|retweeted)\b/i.test(allText)) {
        return {
          isRetweet: true,
          confidence: 0.6,
          method: 'contextualText',
        };
      }
    } catch {
      // Ignore errors in fallback detection
    }
    return { isRetweet: false };
  }

  /**
   * Get retweet indicators from content
   * @param {string} text - Tweet text
   * @param {Object} metadata - Additional metadata
   * @returns {Array} Array of retweet indicators
   */
  getRetweetIndicators(text, metadata = {}) {
    const indicators = [];

    if (metadata.retweetedStatus) {
      indicators.push('Has retweeted status metadata');
    }

    // Enhanced detection indicators
    if (metadata.domElement) {
      const enhancedResult = this.enhancedRetweetDetection(metadata.domElement);
      if (enhancedResult.isRetweet) {
        indicators.push(`Enhanced detection: ${enhancedResult.method} (confidence: ${enhancedResult.confidence})`);
        if (enhancedResult.retweetedBy) {
          indicators.push(`Retweeted by: ${enhancedResult.retweetedBy}`);
        }
      }
    }

    if (typeof text === 'string') {
      if (/^RT @\w+/.test(text.trim())) {
        indicators.push('Starts with RT @');
      }
      if (text.includes('reposted')) {
        indicators.push('Contains "reposted" text');
      }
    }

    return indicators;
  }

  /**
   * Get quote tweet indicators from content
   * @param {string} text - Tweet text
   * @param {Object} metadata - Additional metadata
   * @returns {Array} Array of quote indicators
   */
  getQuoteIndicators(text, metadata) {
    const indicators = [];

    if (metadata && metadata.quotedStatus) {
      indicators.push('Has quoted status metadata');
    }

    // Check for quote tweet block from DOM analysis
    if (metadata && metadata.quoteTweetBlock === true) {
      indicators.push('Quote tweet block detected in DOM');
    }

    // Check for embedded tweet URL in all text content
    if (metadata && metadata.allText) {
      const quoteTweetPattern = /https?:\/\/(?:twitter\.com|x\.com)\/\w+\/status\/\d+/;
      const match = metadata.allText.match(quoteTweetPattern);
      if (match) {
        indicators.push(`Contains embedded tweet URL in full content: ${match[0]}`);
      }
    }

    if (typeof text === 'string') {
      const quoteTweetPattern = /https?:\/\/(?:twitter\.com|x\.com)\/\w+\/status\/\d+/;
      const match = text.match(quoteTweetPattern);
      if (match) {
        indicators.push(`Contains embedded tweet URL: ${match[0]}`);
      }
    }

    return indicators;
  }

  /**
   * Classify YouTube content based on video details
   * @param {Object} video - YouTube video object
   * @returns {Object} Classification result
   */
  classifyYouTubeContent(video) {
    const result = {
      platform: 'youtube',
      type: 'video',
      confidence: 0.9,
      details: {},
    };

    // Validate input
    if (!video || typeof video !== 'object') {
      result.error = 'Invalid video object provided';
      result.confidence = 0;
      return result;
    }

    // Check for upcoming/scheduled content first
    if (this.isYouTubeUpcoming(video)) {
      result.type = 'upcoming';
      result.confidence = 0.9;
      result.details.scheduledTime = this.getYouTubeScheduledTime(video);
    }

    // Check for livestream indicators
    else if (this.isYouTubeLivestream(video)) {
      result.type = 'livestream';
      result.confidence = 0.95;
      result.details.liveStreamDetails = this.getYouTubeLiveDetails(video);
    }

    // Check for shorts
    else if (this.isYouTubeShort(video)) {
      result.type = 'short';
      result.confidence = 0.85;
    }

    // Default to regular video
    else {
      result.details.duration = this.getYouTubeDuration(video);
    }

    // Add common details
    result.details.videoId = video.id;
    result.details.title = video.snippet?.title;
    result.details.channelId = video.snippet?.channelId;
    result.details.publishedAt = video.snippet?.publishedAt;

    return result;
  }

  /**
   * Check if YouTube video is a livestream
   * @param {Object} video - YouTube video object
   * @returns {boolean} True if livestream
   */
  isYouTubeLivestream(video) {
    // Check live streaming details - only if currently live (started but not ended)
    if (video.liveStreamingDetails && video.liveStreamingDetails.actualStartTime) {
      // If it has an end time, it's a finished livestream (now a video)
      if (video.liveStreamingDetails.actualEndTime) {
        return false;
      }
      return true;
    }

    // Check snippet broadcast content - only if currently live
    const broadcastContent = video.snippet?.liveBroadcastContent;
    return broadcastContent === 'live';
  }

  /**
   * Check if YouTube video is upcoming/scheduled
   * @param {Object} video - YouTube video object
   * @returns {boolean} True if upcoming
   */
  isYouTubeUpcoming(video) {
    return video.snippet?.liveBroadcastContent === 'upcoming';
  }

  /**
   * Check if YouTube video is a short
   * @param {Object} video - YouTube video object
   * @returns {boolean} True if short
   */
  isYouTubeShort(video) {
    // YouTube Shorts are typically under 60 seconds
    const duration = this.parseYouTubeDuration(video.contentDetails?.duration);
    return duration > 0 && duration <= 60;
  }

  /**
   * Get YouTube live streaming details
   * @param {Object} video - YouTube video object
   * @returns {Object} Live streaming details
   */
  getYouTubeLiveDetails(video) {
    const details = {};

    if (video.liveStreamingDetails) {
      details.actualStartTime = video.liveStreamingDetails.actualStartTime;
      details.scheduledStartTime = video.liveStreamingDetails.scheduledStartTime;
      details.actualEndTime = video.liveStreamingDetails.actualEndTime;
      details.concurrentViewers = video.liveStreamingDetails.concurrentViewers;
    }

    return details;
  }

  /**
   * Get YouTube scheduled time
   * @param {Object} video - YouTube video object
   * @returns {string|null} Scheduled time
   */
  getYouTubeScheduledTime(video) {
    return video.liveStreamingDetails?.scheduledStartTime || video.snippet?.publishedAt;
  }

  /**
   * Get YouTube video duration
   * @param {Object} video - YouTube video object
   * @returns {Object} Duration information
   */
  getYouTubeDuration(video) {
    const duration = video.contentDetails?.duration;
    if (!duration) {
      return null;
    }

    return {
      raw: duration,
      seconds: this.parseYouTubeDuration(duration),
    };
  }

  /**
   * Parse YouTube duration format (PT4M13S) to seconds
   * @param {string} duration - YouTube duration string
   * @returns {number} Duration in seconds
   */
  parseYouTubeDuration(duration) {
    if (!duration || typeof duration !== 'string') {
      return 0;
    }

    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) {
      return 0;
    }

    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Check if URL is from X (Twitter)
   * @param {string} url - URL to check
   * @returns {boolean} True if X URL
   */
  isXUrl(url) {
    return /^https?:\/\/(?:(?:www\.|mobile\.)?(?:twitter\.com|x\.com))\//.test(url);
  }

  /**
   * Check if URL is from YouTube
   * @param {string} url - URL to check
   * @returns {boolean} True if YouTube URL
   */
  isYouTubeUrl(url) {
    return /^https?:\/\/(?:(?:www\.|m\.)?(?:youtube\.com|youtu\.be))\//.test(url);
  }

  /**
   * Extract content ID from URL
   * @param {string} url - Content URL
   * @returns {Object} Extracted ID information
   */
  extractContentId(url) {
    if (this.isYouTubeUrl(url)) {
      const videoMatch = url.match(this.patterns.youtube.video);
      if (videoMatch) {
        return { platform: 'youtube', type: 'video', id: videoMatch[1] };
      }

      const channelMatch = url.match(this.patterns.youtube.channel);
      if (channelMatch) {
        return { platform: 'youtube', type: 'channel', id: channelMatch[1] };
      }
    }

    if (this.isXUrl(url)) {
      const statusMatch = url.match(this.patterns.x.status);
      if (statusMatch) {
        return { platform: 'x', type: 'status', id: statusMatch[1] };
      }

      // Check for malformed status URLs (has /status/ but no ID)
      if (url.includes('/status/') && !statusMatch) {
        return { platform: 'unknown', type: 'unknown', id: null };
      }

      const profileMatch = url.match(this.patterns.x.profile);
      if (profileMatch) {
        return { platform: 'x', type: 'profile', id: profileMatch[1] };
      }
    }

    return { platform: 'unknown', type: 'unknown', id: null };
  }

  /**
   * Get classification statistics
   * @returns {Object} Classification statistics
   */
  getStats() {
    return {
      supportedPlatforms: ['youtube', 'x'],
      xContentTypes: ['post', 'reply', 'quote', 'retweet'],
      youtubeContentTypes: ['video', 'livestream', 'upcoming', 'short'],
      patterns: Object.keys(this.patterns),
    };
  }
}
