/**
 * Content Coordinator
 * Prevents race conditions between webhook and scraper systems
 * Manages unified content processing with source priority
 */
export class ContentCoordinator {
  constructor(contentStateManager, contentAnnouncer, duplicateDetector, logger, config) {
    this.contentStateManager = contentStateManager;
    this.contentAnnouncer = contentAnnouncer;
    this.duplicateDetector = duplicateDetector;
    this.logger = logger;
    this.config = config;

    // Processing coordination
    this.processingQueue = new Map(); // contentId -> Promise
    this.lockTimeout = config?.getNumber('PROCESSING_LOCK_TIMEOUT_MS', 30000);

    // Source priority (highest to lowest)
    this.sourcePriority = config?.get('SOURCE_PRIORITY', ['webhook', 'api', 'scraper']) || [
      'webhook',
      'api',
      'scraper',
    ];

    // Processing metrics
    this.metrics = {
      totalProcessed: 0,
      duplicatesSkipped: 0,
      raceConditionsPrevented: 0,
      sourcePrioritySkips: 0,
      processingErrors: 0,
    };
  }

  /**
   * Process content with race condition prevention and source priority
   * @param {string} contentId - Unique content identifier
   * @param {string} source - Detection source ('webhook', 'api', 'scraper')
   * @param {Object} contentData - Content data object
   * @returns {Promise<Object>} Processing result
   */
  async processContent(contentId, source, contentData) {
    if (!contentId || typeof contentId !== 'string') {
      throw new Error('Content ID must be a non-empty string');
    }

    if (!this.sourcePriority.includes(source)) {
      this.logger.warn('Unknown content source', { contentId, source, validSources: this.sourcePriority });
    }

    // Prevent duplicate processing with lock
    if (this.processingQueue.has(contentId)) {
      this.logger.debug('Content already being processed, waiting for completion', { contentId, source });
      this.metrics.raceConditionsPrevented++;

      try {
        return await this.processingQueue.get(contentId);
      } catch (error) {
        // If the original processing failed, allow retry
        this.logger.debug('Original processing failed, allowing retry', { contentId, source, error: error.message });
      }
    }

    // Create processing promise
    const processingPromise = this.doProcessContent(contentId, source, contentData);
    this.processingQueue.set(contentId, processingPromise);

    // Set timeout to prevent infinite locks
    const timeoutId = setTimeout(() => {
      this.processingQueue.delete(contentId);
      this.logger.warn('Processing lock timeout, removing from queue', {
        contentId,
        source,
        timeoutMs: this.lockTimeout,
      });
    }, this.lockTimeout);

    try {
      const result = await processingPromise;
      return result;
    } finally {
      clearTimeout(timeoutId);
      this.processingQueue.delete(contentId);
    }
  }

  /**
   * Internal content processing logic
   * @param {string} contentId - Content identifier
   * @param {string} source - Detection source
   * @param {Object} contentData - Content data
   * @returns {Promise<Object>} Processing result
   */
  async doProcessContent(contentId, source, contentData) {
    const startTime = Date.now();

    try {
      this.logger.debug('Starting content processing', {
        contentId,
        source,
        title: contentData.title || 'Unknown',
        publishedAt: contentData.publishedAt,
      });

      // Check if content already exists in state management
      const existingState = this.contentStateManager.getContentState(contentId);

      if (existingState) {
        // Content already known - check if we should still process based on source priority
        const shouldProcess = this.shouldProcessFromSource(existingState, source);

        if (!shouldProcess) {
          this.metrics.sourcePrioritySkips++;
          return {
            action: 'skip',
            reason: 'source_priority',
            existingSource: existingState.source,
            newSource: source,
            contentId,
          };
        }

        // Check if already announced
        if (existingState.announced) {
          this.metrics.duplicatesSkipped++;
          return {
            action: 'skip',
            reason: 'already_announced',
            existingSource: existingState.source,
            newSource: source,
            contentId,
          };
        }
      }

      // Check for duplicates using enhanced detection
      const isDuplicate = await this.checkForDuplicates(contentData);

      if (isDuplicate) {
        this.metrics.duplicatesSkipped++;
        return {
          action: 'skip',
          reason: 'duplicate_detected',
          source,
          contentId,
        };
      }

      // Check if content is new enough to announce
      const isNew = this.contentStateManager.isNewContent(contentId, contentData.publishedAt, new Date());

      if (!isNew) {
        return {
          action: 'skip',
          reason: 'content_too_old',
          source,
          contentId,
          publishedAt: contentData.publishedAt,
        };
      }

      // Add to content state management if not exists
      if (!existingState) {
        await this.contentStateManager.addContent(contentId, {
          type: this.determineContentType(contentData),
          state: this.determineInitialState(contentData),
          source,
          publishedAt: contentData.publishedAt,
          url: contentData.url,
          title: contentData.title,
          metadata: contentData.metadata || {},
        });
      } else {
        // Update existing state with new source information
        await this.contentStateManager.updateContentState(contentId, {
          source: this.selectBestSource(existingState.source, source),
          lastUpdated: new Date(),
        });
      }

      // Process and announce content
      const announcementResult = await this.announceContent(contentId, contentData, source);

      // Mark as announced in state management
      await this.contentStateManager.markAsAnnounced(contentId);

      // Mark as seen in duplicate detector
      await this.markContentAsSeen(contentData);

      this.metrics.totalProcessed++;

      const processingTime = Date.now() - startTime;

      this.logger.info('Content processed successfully', {
        contentId,
        source,
        action: 'announced',
        processingTimeMs: processingTime,
        title: contentData.title,
      });

      return {
        action: 'announced',
        source,
        contentId,
        processingTimeMs: processingTime,
        announcementResult,
      };
    } catch (error) {
      this.metrics.processingErrors++;

      const processingTime = Date.now() - startTime;

      this.logger.error('Content processing failed', {
        contentId,
        source,
        error: error.message,
        stack: error.stack,
        processingTimeMs: processingTime,
      });

      throw error;
    }
  }

  /**
   * Check if content should be processed based on source priority
   * @param {Object} existingState - Existing content state
   * @param {string} newSource - New detection source
   * @returns {boolean} True if should process
   */
  shouldProcessFromSource(existingState, newSource) {
    const existingPriority = this.getSourcePriority(existingState.source);
    const newPriority = this.getSourcePriority(newSource);

    // Higher priority sources (lower index) can override lower priority
    return newPriority <= existingPriority;
  }

  /**
   * Get source priority index (lower = higher priority)
   * @param {string} source - Source name
   * @returns {number} Priority index
   */
  getSourcePriority(source) {
    const index = this.sourcePriority.indexOf(source);
    return index >= 0 ? index : this.sourcePriority.length;
  }

  /**
   * Select the best source between two options
   * @param {string} source1 - First source
   * @param {string} source2 - Second source
   * @returns {string} Best source
   */
  selectBestSource(source1, source2) {
    const priority1 = this.getSourcePriority(source1);
    const priority2 = this.getSourcePriority(source2);

    return priority1 <= priority2 ? source1 : source2;
  }

  /**
   * Check for duplicates using enhanced detection
   * @param {Object} contentData - Content data
   * @returns {Promise<boolean>} True if duplicate
   */
  async checkForDuplicates(contentData) {
    try {
      // Use enhanced duplicate detection if available
      if (this.duplicateDetector.isDuplicateWithFingerprint) {
        return await this.duplicateDetector.isDuplicateWithFingerprint(contentData);
      }

      // Fall back to URL-based detection
      return this.duplicateDetector.isDuplicate(contentData.url);
    } catch (error) {
      this.logger.warn('Duplicate detection failed, assuming not duplicate', {
        url: contentData.url,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Mark content as seen in duplicate detector
   * @param {Object} contentData - Content data
   */
  async markContentAsSeen(contentData) {
    try {
      // Use enhanced marking if available
      if (this.duplicateDetector.markAsSeenWithFingerprint) {
        await this.duplicateDetector.markAsSeenWithFingerprint(contentData);
      } else {
        // Fall back to URL-based marking
        this.duplicateDetector.markAsSeen(contentData.url);
      }
    } catch (error) {
      this.logger.warn('Failed to mark content as seen', {
        url: contentData.url,
        error: error.message,
      });
    }
  }

  /**
   * Determine content type from content data
   * @param {Object} contentData - Content data
   * @returns {string} Content type
   */
  determineContentType(contentData) {
    if (contentData.type) {
      return contentData.type;
    }

    if (contentData.url) {
      if (contentData.url.includes('youtube.com') || contentData.url.includes('youtu.be')) {
        return contentData.isLive ? 'youtube_livestream' : 'youtube_video';
      }

      if (contentData.url.includes('x.com') || contentData.url.includes('twitter.com')) {
        return 'x_tweet';
      }
    }

    return 'unknown';
  }

  /**
   * Determine initial state from content data
   * @param {Object} contentData - Content data
   * @returns {string} Initial state
   */
  determineInitialState(contentData) {
    if (contentData.state) {
      return contentData.state;
    }

    if (contentData.isLive) {
      return 'live';
    }

    if (contentData.scheduledStartTime) {
      const now = new Date();
      const scheduledStart = new Date(contentData.scheduledStartTime);
      return now < scheduledStart ? 'scheduled' : 'live';
    }

    return 'published';
  }

  /**
   * Announce content using the content announcer
   * @param {string} contentId - Content identifier
   * @param {Object} contentData - Content data
   * @param {string} source - Detection source
   * @returns {Promise<Object>} Announcement result
   */
  async announceContent(contentId, contentData, source) {
    const announcementData = {
      ...contentData,
      id: contentId,
      source,
      detectionTime: new Date(),
      contentType: this.determineContentType(contentData),
    };

    return await this.contentAnnouncer.announce(announcementData);
  }

  /**
   * Get processing statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.metrics,
      activeProcessing: this.processingQueue.size,
      sourcePriority: this.sourcePriority,
      lockTimeoutMs: this.lockTimeout,
    };
  }

  /**
   * Get detailed processing queue information
   * @returns {Object} Queue information
   */
  getQueueInfo() {
    return {
      activeCount: this.processingQueue.size,
      activeContentIds: Array.from(this.processingQueue.keys()),
      lockTimeoutMs: this.lockTimeout,
    };
  }

  /**
   * Force clear processing queue (for emergency situations)
   * @param {string} [reason] - Reason for clearing
   */
  forceClearQueue(reason = 'manual_clear') {
    const clearedCount = this.processingQueue.size;

    if (clearedCount > 0) {
      this.logger.warn('Force clearing processing queue', {
        reason,
        clearedCount,
        activeContentIds: Array.from(this.processingQueue.keys()),
      });

      this.processingQueue.clear();
    }

    return clearedCount;
  }

  /**
   * Reset processing metrics
   */
  resetMetrics() {
    this.metrics = {
      totalProcessed: 0,
      duplicatesSkipped: 0,
      raceConditionsPrevented: 0,
      sourcePrioritySkips: 0,
      processingErrors: 0,
    };

    this.logger.info('Content coordinator metrics reset');
  }

  /**
   * Update source priority configuration
   * @param {Array<string>} newPriority - New priority array
   */
  updateSourcePriority(newPriority) {
    if (!Array.isArray(newPriority)) {
      throw new Error('Source priority must be an array');
    }

    const oldPriority = [...this.sourcePriority];
    this.sourcePriority = [...newPriority];

    this.logger.info('Source priority updated', {
      oldPriority,
      newPriority: this.sourcePriority,
    });
  }

  /**
   * Destroy coordinator and clean up resources
   */
  async destroy() {
    const activeCount = this.processingQueue.size;

    if (activeCount > 0) {
      this.logger.warn('Destroying coordinator with active processing', {
        activeCount,
        activeContentIds: Array.from(this.processingQueue.keys()),
      });
    }

    this.processingQueue.clear();

    this.logger.info('Content coordinator destroyed', {
      finalMetrics: this.getStats(),
    });
  }
}
