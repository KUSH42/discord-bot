import { nowUTC } from '../utilities/utc-time.js';

/**
 * Unified Content State Management System
 * Replaces dual-logic inconsistency with single source of truth
 * Tracks content through its complete lifecycle
 */
export class ContentStateManager {
  constructor(configManager, persistentStorage, logger, stateManager = null) {
    this.configManager = configManager;
    this.storage = persistentStorage;
    this.logger = logger;
    this.stateManager = stateManager;

    // In-memory cache for active content states
    this.contentStates = new Map(); // videoId -> ContentState

    // Track when the bot started to determine content freshness
    this.botStartTime = new Date();

    // Track initialization status for comprehensive logging
    this.isFullyInitialized = false;
    this.initializationTime = null;

    // Initialize from persistent storage
    this.initializeFromStorage();
  }

  /**
   * Initialize content states from persistent storage
   */
  async initializeFromStorage() {
    try {
      const storedStates = await this.storage.getAllContentStates();

      for (const [contentId, state] of Object.entries(storedStates || {})) {
        // Only load recent states to prevent memory bloat
        const age = nowUTC().getTime() - new Date(state.lastUpdated).getTime();
        const maxAge = this.getMaxContentAgeMs();

        if (age <= maxAge * 2) {
          // Keep states up to 2x max age for safety
          this.contentStates.set(contentId, {
            ...state,
            firstSeen: new Date(state.firstSeen),
            lastUpdated: new Date(state.lastUpdated),
          });
        }
      }

      this.logger.info('Content state manager initialized', {
        loadedStates: this.contentStates.size,
        botStartTime: this.botStartTime.toISOString(),
      });
    } catch (error) {
      this.logger.warn('❌ Failed to initialize from storage, starting fresh', {
        error: error.message,
      });
    }
  }

  /**
   * Mark the system as fully initialized (all submodules started, histories populated)
   * This enables comprehensive content evaluation logging
   */
  markFullyInitialized() {
    this.isFullyInitialized = true;
    this.initializationTime = new Date();

    this.logger.info('Content state manager marked as fully initialized - comprehensive logging enabled', {
      initializationTime: this.initializationTime.toISOString(),
      botStartTime: this.botStartTime.toISOString(),
    });
  }

  /**
   * Add new content to state tracking system
   * @param {string} contentId - Unique content identifier (video ID, tweet ID, etc)
   * @param {Object} initialState - Initial content state
   * @param {string} initialState.type - Content type ('youtube_video', 'youtube_livestream', 'x_tweet', etc)
   * @param {string} initialState.state - Current state ('scheduled', 'live', 'ended', 'published')
   * @param {string} initialState.source - Detection source ('webhook', 'scraper', 'api')
   * @param {Date|string} initialState.publishedAt - When content was published
   * @param {string} [initialState.url] - Content URL
   * @param {string} [initialState.title] - Content title
   * @param {Object} [initialState.metadata] - Additional metadata
   */
  async addContent(contentId, initialState) {
    if (!contentId || typeof contentId !== 'string') {
      throw new Error('Content ID must be a non-empty string');
    }

    const now = new Date();
    const publishedAt = initialState.publishedAt ? new Date(initialState.publishedAt) : now;

    const contentState = {
      id: contentId,
      type: initialState.type || 'unknown',
      state: initialState.state || 'published',
      firstSeen: now,
      lastUpdated: now,
      publishedAt,
      announced: false,
      source: initialState.source || 'unknown',
      url: initialState.url || null,
      title: initialState.title || null,
      metadata: initialState.metadata || {},
    };

    // Store in memory cache
    this.contentStates.set(contentId, contentState);

    // Persist to storage
    await this.persistContentState(contentId, contentState);

    this.logger.debug('Content added to state management', {
      contentId,
      type: contentState.type,
      state: contentState.state,
      source: contentState.source,
    });

    return contentState;
  }

  /**
   * Update existing content state
   * @param {string} contentId - Content identifier
   * @param {Object} updates - State updates to apply
   */
  async updateContentState(contentId, updates) {
    const existing = this.contentStates.get(contentId);

    if (!existing) {
      throw new Error(`Content state not found for ID: ${contentId}`);
    }

    const updatedState = {
      ...existing,
      ...updates,
      lastUpdated: new Date(),
    };

    this.contentStates.set(contentId, updatedState);
    await this.persistContentState(contentId, updatedState);

    this.logger.debug('Content state updated', {
      contentId,
      updates: Object.keys(updates),
      newState: updatedState.state,
    });

    return updatedState;
  }

  /**
   * Get content state by ID
   * @param {string} contentId - Content identifier
   * @returns {Object|null} Content state or null if not found
   */
  getContentState(contentId) {
    return this.contentStates.get(contentId) || null;
  }

  /**
   * Check if content exists in state management
   * @param {string} contentId - Content identifier
   * @returns {boolean} True if content state exists
   */
  hasContent(contentId) {
    return this.contentStates.has(contentId);
  }

  /**
   * Unified "new content" logic - replaces botStartTime and lastKnownContentId logic
   * @param {string} contentId - Content identifier
   * @param {Date|string} publishedAt - When content was published
   * @param {Date} [detectionTime] - When content was detected (defaults to now)
   * @returns {boolean} True if content should be considered new
   */
  isNewContent(contentId, publishedAt, detectionTime = new Date()) {
    // If we've already seen this content, it's not new
    if (this.hasContent(contentId)) {
      const existingState = this.getContentState(contentId);
      return !existingState.announced; // New if not yet announced
    }

    // Validate publishedAt parameter
    if (!publishedAt) {
      this.logger.warn('isNewContent called with missing publishedAt', { contentId });
      return false; // Treat content with no publish date as old
    }

    // Check content age against configuration
    const publishTime = new Date(publishedAt);

    // Validate that the date is valid
    if (isNaN(publishTime.getTime())) {
      this.logger.warn('isNewContent called with invalid publishedAt', {
        contentId,
        publishedAt: String(publishedAt),
      });
      return false; // Treat content with invalid date as old
    }

    const maxAge = this.getMaxContentAgeMs();
    const contentAge = detectionTime.getTime() - publishTime.getTime();

    // Content is new if it's within the maximum age threshold
    const isWithinAgeLimit = contentAge <= maxAge;

    // Check against bot start time, but allow recent content even if published before bot start
    // This prevents announcing very old content while still allowing recent content from before restart
    const botStartTime = this.getBotStartTime();
    const isAfterBotStart = publishTime >= botStartTime;
    const timeSinceBotStart = detectionTime.getTime() - botStartTime.getTime();
    const botStartGracePeriod = 5 * 60 * 1000; // 5 minutes grace period

    // Allow content if:
    // 1. Published after bot started, OR
    // 2. Bot just started (within grace period) and content is within age limit
    const shouldAllow = isAfterBotStart || (timeSinceBotStart <= botStartGracePeriod && isWithinAgeLimit);

    // Always log basic debug info, but add comprehensive logging after initialization
    const logData = {
      contentId,
      publishedAt: publishTime.toISOString(),
      contentAge: Math.round(contentAge / 1000), // seconds
      maxAge: Math.round(maxAge / 1000), // seconds
      isWithinAgeLimit,
      isAfterBotStart,
      timeSinceBotStart: Math.round(timeSinceBotStart / 1000), // seconds
      botStartTime: botStartTime.toISOString(),
      shouldAllow,
    };

    if (this.isFullyInitialized) {
      // Comprehensive logging after full initialization - this helps catch issues like the one we just fixed
      const decision = shouldAllow ? '✅ ALLOW' : '❌ REJECT';
      const reason = !isWithinAgeLimit
        ? 'content too old'
        : !isAfterBotStart && timeSinceBotStart > 5 * 60 * 1000
          ? 'published before bot start (outside grace period)'
          : shouldAllow
            ? 'within criteria'
            : 'unknown';

      this.logger.debug(`Content evaluation: ${decision} - ${reason}`, {
        ...logData,
        initializationTime: this.initializationTime?.toISOString(),
        isFullyInitialized: this.isFullyInitialized,
        gracePeriodMs: 5 * 60 * 1000,
        reason,
      });
    } else {
      // Basic logging during initialization
      this.logger.debug('New content evaluation (pre-initialization)', logData);
    }

    return shouldAllow;
  }

  /**
   * Mark content as announced
   * @param {string} contentId - Content identifier
   */
  async markAsAnnounced(contentId) {
    const state = this.getContentState(contentId);

    if (!state) {
      throw new Error(`Cannot mark unknown content as announced: ${contentId}`);
    }

    await this.updateContentState(contentId, { announced: true });

    this.logger.info('Content marked as announced', {
      contentId,
      type: state.type,
      source: state.source,
    });
  }

  /**
   * Get all content with specified state
   * @param {string} state - Content state to filter by
   * @returns {Array} Array of content states
   */
  getContentByState(state) {
    return Array.from(this.contentStates.values()).filter(content => content.state === state);
  }

  /**
   * Get content by type
   * @param {string} type - Content type to filter by
   * @returns {Array} Array of content states
   */
  getContentByType(type) {
    return Array.from(this.contentStates.values()).filter(content => content.type === type);
  }

  /**
   * Get detection sources for content
   * @param {string} contentId - Content identifier
   * @returns {Array<string>} Array of sources that detected this content
   */
  getDetectionSources(contentId) {
    const state = this.getContentState(contentId);
    if (!state) {
      return [];
    }

    // For now, return single source - can be expanded for multi-source tracking
    return [state.source];
  }

  /**
   * Clean up old content states to prevent memory bloat
   * @param {number} [olderThanHours] - Remove content older than this (defaults to config)
   */
  async cleanup(olderThanHours) {
    const maxAge = olderThanHours ? olderThanHours * 60 * 60 * 1000 : this.getMaxContentAgeMs() * 2; // Default to 2x max age

    const cutoffTime = nowUTC().getTime() - maxAge;
    const toRemove = [];

    for (const [contentId, state] of this.contentStates.entries()) {
      if (state.lastUpdated.getTime() < cutoffTime) {
        toRemove.push(contentId);
      }
    }

    // Remove from memory
    toRemove.forEach(id => this.contentStates.delete(id));

    // Remove from persistent storage
    try {
      await this.storage.removeContentStates(toRemove);
    } catch (error) {
      this.logger.warn('Failed to remove content states from storage', {
        error: error.message,
        removedFromMemory: toRemove.length,
      });
    }

    if (toRemove.length > 0) {
      this.logger.info('Content state cleanup completed', {
        removedCount: toRemove.length,
        remainingCount: this.contentStates.size,
        maxAgeHours: maxAge / (60 * 60 * 1000),
      });
    }
  }

  /**
   * Get maximum content age in milliseconds from configuration
   * @returns {number} Maximum age in milliseconds
   */
  getMaxContentAgeMs() {
    const hours = this.configManager.getNumber('MAX_CONTENT_AGE_HOURS', 24);
    return hours * 60 * 60 * 1000; // Convert to milliseconds
  }

  /**
   * Get bot start time from state manager if available, otherwise use internal time
   * @returns {Date} Bot start time
   */
  getBotStartTime() {
    if (this.stateManager) {
      const stateManagerBotStartTime = this.stateManager.get('botStartTime');
      if (stateManagerBotStartTime) {
        return new Date(stateManagerBotStartTime);
      }
    }
    return this.botStartTime;
  }

  /**
   * Persist content state to storage
   * @param {string} contentId - Content identifier
   * @param {Object} state - Content state to persist
   */
  async persistContentState(contentId, state) {
    try {
      await this.storage.storeContentState(contentId, {
        ...state,
        firstSeen: state.firstSeen,
        lastUpdated: state.lastUpdated,
        publishedAt: state.publishedAt,
      });
    } catch (error) {
      this.logger.warn('Failed to persist content state', {
        contentId,
        error: error.message,
      });
    }
  }

  /**
   * Get statistics about content state management
   * @returns {Object} Statistics object
   */
  getStats() {
    const states = Array.from(this.contentStates.values());

    const byState = {};
    const byType = {};
    const bySource = {};

    states.forEach(state => {
      byState[state.state] = (byState[state.state] || 0) + 1;
      byType[state.type] = (byType[state.type] || 0) + 1;
      bySource[state.source] = (bySource[state.source] || 0) + 1;
    });

    return {
      totalContent: states.length,
      announced: states.filter(s => s.announced).length,
      unannounced: states.filter(s => !s.announced).length,
      byState,
      byType,
      bySource,
      botStartTime: this.botStartTime.toISOString(),
      maxContentAge: this.getMaxContentAgeMs() / (60 * 60 * 1000), // hours
    };
  }

  /**
   * Reset all content states (for testing)
   */
  async reset() {
    this.contentStates.clear();
    await this.storage.clearAllContentStates();
    this.botStartTime = new Date();

    this.logger.info('Content state manager reset');
  }

  /**
   * Destroy and cleanup resources
   */
  async destroy() {
    // Final cleanup and persist any pending states
    await this.cleanup();
    this.contentStates.clear();

    this.logger.info('Content state manager destroyed');
  }
}
