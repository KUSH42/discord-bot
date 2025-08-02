import { nowUTC } from '../utilities/utc-time.js';
import { createEnhancedLogger } from '../utilities/enhanced-logger.js';

/**
 * Content Coordinator
 * Prevents race conditions between webhook and scraper systems
 * Manages unified content processing with source priority
 */
export class ContentCoordinator {
  constructor(
    contentStateManager,
    contentAnnouncer,
    duplicateDetector,
    classifier,
    logger,
    config,
    debugManager,
    metricsManager,
    discordService = null
  ) {
    this.contentStateManager = contentStateManager;
    this.contentAnnouncer = contentAnnouncer;
    this.duplicateDetector = duplicateDetector;
    this.classifier = classifier;
    this.logger = createEnhancedLogger('state', logger, debugManager, metricsManager);
    this.config = config;
    this.discordService = discordService;

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
    const operation = this.logger.startOperation('processContent', {
      contentId,
      source,
      platform: contentData.platform,
      type: contentData.type,
    });

    try {
      if (!contentId || typeof contentId !== 'string') {
        throw new Error('Content ID must be a non-empty string');
      }

      if (!this.sourcePriority.includes(source)) {
        operation.progress('Unknown content source detected', { validSources: this.sourcePriority });
      }

      // Prevent duplicate processing with lock
      if (this.processingQueue.has(contentId)) {
        operation.progress('Content already being processed, waiting for completion');
        this.metrics.raceConditionsPrevented++;

        try {
          const result = await this.processingQueue.get(contentId);
          operation.success('Retrieved result from existing processing', { action: result.action });
          return result;
        } catch (error) {
          // If the original processing failed, allow retry
          operation.progress('Original processing failed, allowing retry', { error: error.message });
        }
      }

      operation.progress('Starting new content processing');

      // Create processing promise
      const processingPromise = this.doProcessContent(contentId, source, contentData);
      this.processingQueue.set(contentId, processingPromise);

      // Set timeout to prevent infinite locks
      const timeoutId = setTimeout(() => {
        this.processingQueue.delete(contentId);
        operation.progress('Processing lock timeout, removing from queue', { timeoutMs: this.lockTimeout });
      }, this.lockTimeout);

      try {
        const result = await processingPromise;
        operation.success('Content processing completed', {
          action: result.action,
          processingTimeMs: result.processingTimeMs,
        });
        return result;
      } finally {
        clearTimeout(timeoutId);
        this.processingQueue.delete(contentId);
      }
    } catch (error) {
      operation.error(error, 'Content processing failed');
      throw error;
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
    const operation = this.logger.startOperation('doProcessContent', {
      contentId,
      source,
      platform: contentData.platform,
      type: contentData.type,
      title: contentData.title?.substring(0, 120) || 'Unknown',
      publishedAt: contentData.publishedAt,
      url: contentData.url,
    });

    try {
      operation.progress('🔄 Starting content coordination');

      // Check if content already exists in state management
      operation.progress('🔍 Checking existing content state');
      const existingState = this.contentStateManager.getContentState(contentId);

      if (existingState) {
        operation.progress('📋 Content already exists in state', {
          existingSource: existingState.source,
          announced: existingState.announced,
        });

        // Content already known - check if we should still process based on source priority
        const shouldProcess = this.shouldProcessFromSource(existingState, source);

        if (!shouldProcess) {
          this.metrics.sourcePrioritySkips++;
          operation.success('⏭️ Skipping due to source priority', {
            existingSource: existingState.source,
            sourcePriority: this.sourcePriority,
          });
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
          operation.success('⏭️ Content already announced, skipping', {
            existingSource: existingState.source,
            announcedAt: existingState.lastUpdated,
          });
          return {
            action: 'skip',
            reason: 'already_announced',
            existingSource: existingState.source,
            newSource: source,
            contentId,
          };
        }
      } else {
        operation.progress('✨ New content detected');
      }

      // Check for duplicates using enhanced detection
      operation.progress('🔍 Checking for duplicates', { url: contentData.url });
      const isDuplicate = await this.checkForDuplicates(contentData);

      if (isDuplicate) {
        this.metrics.duplicatesSkipped++;
        operation.success('⏭️ Duplicate content detected, skipping', { url: contentData.url });
        return {
          action: 'skip',
          reason: 'duplicate_detected',
          source,
          contentId,
        };
      }
      operation.progress('✅ No duplicates found');

      // Check if content is new enough to announce
      operation.progress(`📅 Checking ${contentData.type} age`, {
        publishedAt: contentData.publishedAt,
        currentTime: nowUTC().toISOString(),
      });
      const isNew = this.contentStateManager.isNewContent(contentId, contentData.publishedAt, nowUTC());

      if (!isNew) {
        operation.success(`⏭️ Skipping content: ${contentData.type} too old - published ${contentData.publishedAt}`, {
          publishedAt: contentData.publishedAt,
          currentTime: nowUTC().toISOString(),
          title: contentData.title,
          contentId,
        });
        return {
          action: 'skip',
          reason: 'content_too_old',
          source,
          contentId,
          publishedAt: contentData.publishedAt,
        };
      }
      operation.progress(`✅ ${contentData.type} is new enough: ${contentData.publishedAt}`);

      // Classify content for proper handling (especially for X retweets)
      operation.progress('🔍 Classifying content for proper handling');
      const originalType = contentData.type;
      const classification = await this.classifyContent(contentData);
      if (classification) {
        contentData.classification = classification;
        // Update content type based on classification for proper channel routing
        if (classification.type && classification.type !== 'unknown') {
          operation.progress(
            `🔄 Updating content type from '${originalType}' to '${classification.type}' based on classification`
          );
          contentData.type = classification.type;
        }
        const classificationInfo = {
          originalType,
          classifiedType: classification.type,
          confidence: classification.confidence,
          finalType: contentData.type,
        };
        operation.progress(
          `✅ Content classification completed: ${JSON.stringify(classificationInfo, null, 1).replace(/\n/g, '')}`
        );
      }

      // Add to content state management if not exists
      if (!existingState) {
        operation.progress('📝 Adding new content to state management', {
          type: this.determineContentType(contentData),
          state: this.determineInitialState(contentData),
        });
        await this.contentStateManager.addContent(contentId, {
          type: this.determineContentType(contentData),
          state: this.determineInitialState(contentData),
          source,
          publishedAt: contentData.publishedAt,
          url: contentData.url,
          title: contentData.title,
          metadata: contentData.metadata || {},
        });
        operation.progress('✅ Content added to state management');
      } else {
        // Update existing state with new source information
        const bestSource = this.selectBestSource(existingState.source, source);
        operation.progress('🔄 Updating existing content state', {
          oldSource: existingState.source,
          bestSource,
        });
        await this.contentStateManager.updateContentState(contentId, {
          source: bestSource,
          lastUpdated: nowUTC(),
        });
        operation.progress('✅ Content state updated');
      }

      // Before announcing, check duplicate detector for previously seen content to prevent duplicates
      operation.progress('🔍 Checking duplicate detector for previously announced content');
      const duplicateCheck = await this.checkForPreviouslyAnnouncedContent(contentData);

      if (duplicateCheck.found) {
        operation.success('⏭️ Content already announced previously, skipping duplicate', {
          foundIn: duplicateCheck.foundIn,
          reason: 'previously_announced',
        });

        // Mark as seen in duplicate detector to prevent future processing
        await this.markContentAsSeen(contentData);

        return {
          action: 'skip',
          reason: 'previously_announced',
          source,
          contentId,
          foundIn: duplicateCheck.foundIn,
        };
      }

      // Process and announce content
      const announcementAttemptInfo = {
        platform: contentData.platform,
        type: contentData.type,
        title: contentData.title,
        publishedAt: contentData.publishedAt,
        url: contentData.url,
      };
      operation.progress(
        `📢 Proceeding with content announcement: ${JSON.stringify(announcementAttemptInfo, null, 1).replace(/\n/g, '')}`
      );
      const announcementResult = await this.announceContent(contentId, contentData, source);

      if (announcementResult && announcementResult.success) {
        operation.progress('✅ Content announcement successful', {
          channelId: announcementResult.channelId,
          messageId: announcementResult.messageId,
        });

        // Mark as announced in state management
        operation.progress('📝 Marking content as announced in state');
        await this.contentStateManager.markAsAnnounced(contentId);

        // Mark as seen in duplicate detector
        operation.progress('📝 Marking content as seen in duplicate detector', { url: contentData.url });
        await this.markContentAsSeen(contentData);

        this.metrics.totalProcessed++;

        const successInfo = {
          action: 'announced',
          title: contentData.title,
          channelId: announcementResult.channelId,
          messageId: announcementResult.messageId,
        };
        operation.success(
          `🎉 Content processing completed successfully: ${JSON.stringify(successInfo, null, 1).replace(/\n/g, '')}`
        );

        return {
          action: 'announced',
          source,
          contentId,
          announcementResult,
        };
      } else {
        operation.progress('⚠️ Content announcement failed or was skipped', {
          reason: announcementResult?.reason || 'Unknown error',
          skipped: announcementResult?.skipped || false,
        });

        // Still mark as processed even if announcement failed to prevent retry loops
        if (!announcementResult?.skipped) {
          await this.contentStateManager.markAsAnnounced(contentId);
        }

        const warningInfo = {
          action: announcementResult?.skipped ? 'skip' : 'failed',
          reason: announcementResult?.reason || 'Content announcement failed',
        };
        operation.success(
          `Content processing completed with warning: ${JSON.stringify(warningInfo, null, 1).replace(/\n/g, '')}`
        );

        return {
          action: announcementResult?.skipped ? 'skip' : 'failed',
          reason: announcementResult?.reason || 'Content announcement failed',
          source,
          contentId,
          announcementResult,
        };
      }
    } catch (error) {
      this.metrics.processingErrors++;
      operation.error(error, 'Content processing failed');
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
    // Use current type first (should be classified type after classification step)
    if (contentData.type && contentData.type !== 'post') {
      return contentData.type;
    }

    // Use classification result if available (for X content)
    if (contentData.classification && contentData.classification.type) {
      return contentData.classification.type;
    }

    // If still 'post' or no type, try to infer from content data
    if (contentData.type) {
      return contentData.type;
    }

    if (contentData.url) {
      if (contentData.url.includes('youtube.com') || contentData.url.includes('youtu.be')) {
        return contentData.isLive ? 'livestream' : 'video';
      }

      if (contentData.url.includes('x.com') || contentData.url.includes('twitter.com')) {
        return 'post'; // Default for X content
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
      const now = nowUTC();
      const scheduledStart = new Date(contentData.scheduledStartTime);
      return now < scheduledStart ? 'scheduled' : 'live';
    }

    return 'published';
  }

  /**
   * Classify content for proper handling (especially X retweets)
   * @param {Object} contentData - Content data to classify
   * @returns {Promise<Object|null>} Classification result or null
   */
  async classifyContent(contentData) {
    if (!this.classifier || !contentData) {
      return null;
    }

    // Only classify X content currently, as YouTube content is already handled properly
    if (contentData.platform === 'x') {
      const xUser = contentData.xUser || (this.config && this.config.get('X_USER_HANDLE'));
      const metadata = {
        tweetCategory: contentData.tweetCategory,
        author: contentData.author,
        retweetedBy: contentData.retweetedBy,
        xUser,
        // Include raw classification data from browser extraction for proper classification
        ...contentData.rawClassificationData,
      };

      // Handle retweet classification logic specifically
      // Check if this is a retweet based on retweetedBy field (set during extraction)
      if (contentData.retweetedBy === xUser && contentData.author && contentData.author !== xUser) {
        return {
          type: 'retweet',
          confidence: 0.99,
          platform: 'x',
          details: {
            statusId: contentData.id || contentData.tweetID,
            originalAuthor: contentData.author,
            retweetedBy: xUser,
            detectionMethod: 'retweetedBy-field-based',
          },
        };
      }

      // Use classifier for other content
      const classificationResult = this.classifier.classifyXContent(
        contentData.url,
        contentData.text || contentData.content,
        metadata
      );

      // Debug logging for quote tweet classification
      if (classificationResult && classificationResult.type === 'quote') {
        this.logger.debug('Quote tweet detected during classification', {
          contentId: contentData.id,
          url: contentData.url,
          type: classificationResult.type,
          confidence: classificationResult.confidence,
          quoteTweetIndicators: metadata.quoteTweetBlock,
          hasQuoteUrl:
            metadata.allText && /https?:\/\/(?:twitter\.com|x\.com)\/\w+\/status\/\d+/.test(metadata.allText),
        });
      }

      return classificationResult;
    }

    return null;
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
      detectionTime: nowUTC(),
      contentType: this.determineContentType(contentData),
      // Ensure the classified type is used for announcement
      type: contentData.type, // This should now contain the classified type
      // Preserve classification metadata for announcer
      classification: contentData.classification,
      // Ensure key metadata fields are preserved
      retweetedBy: contentData.retweetedBy,
      authorDisplayName: contentData.authorDisplayName,
      channelTitle: contentData.channelTitle,
    };

    return await this.contentAnnouncer.announceContent(announcementData);
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
   * Initialize Discord channel scanning for duplicate detection integration
   * This method should be called after Discord client is ready
   * @param {Object} discordService - Discord service instance
   * @param {Object} config - Configuration instance
   * @returns {Promise<Object>} Scanning results summary
   */
  async initializeDiscordChannelScanning(discordService, config) {
    const operation = this.logger.startOperation('initializeDiscordChannelScanning', {
      duplicateDetectorAvailable: !!this.duplicateDetector,
    });

    try {
      if (!this.duplicateDetector) {
        operation.progress('No duplicate detector available, skipping Discord scanning');
        operation.success('Discord scanning skipped - no duplicate detector', {
          scanned: false,
          reason: 'no_duplicate_detector',
        });
        return {
          scanned: false,
          reason: 'no_duplicate_detector',
        };
      }

      if (!discordService || !discordService.isReady()) {
        operation.progress('Discord service not ready, skipping Discord scanning');
        operation.success('Discord scanning skipped - service not ready', {
          scanned: false,
          reason: 'discord_not_ready',
        });
        return {
          scanned: false,
          reason: 'discord_not_ready',
        };
      }

      operation.progress('Starting Discord channel scanning for duplicate detection');

      const scanResults = {
        youtube: { messagesScanned: 0, videoIdsAdded: 0, errors: [] },
        x: { messagesScanned: 0, tweetIdsAdded: 0, channelsScanned: 0, errors: [] },
        totalScanned: 0,
        totalAdded: 0,
      };

      // Scan YouTube announcement channel
      const youtubeChannelId = config.get('DISCORD_YOUTUBE_CHANNEL_ID');
      if (youtubeChannelId) {
        try {
          operation.progress('Scanning YouTube announcement channel', { channelId: youtubeChannelId });
          const youtubeChannel = await discordService.fetchChannel(youtubeChannelId);
          if (youtubeChannel) {
            const videoResults = await this.duplicateDetector.scanDiscordChannelForVideos(youtubeChannel, 100);
            scanResults.youtube = videoResults;
            scanResults.totalScanned += videoResults.messagesScanned;
            scanResults.totalAdded += videoResults.videoIdsAdded;

            operation.progress(
              `YouTube channel scanned: ${videoResults.messagesScanned} messages, ${videoResults.videoIdsAdded} videos added`
            );
          }
        } catch (error) {
          const errorMsg = `Failed to scan YouTube channel: ${error.message}`;
          operation.progress('Error scanning YouTube channel', { error: errorMsg });
          scanResults.youtube.errors.push(errorMsg);
        }
      } else {
        operation.progress('No YouTube channel ID configured, skipping YouTube history scanning');
      }

      // Scan X/Twitter announcement channels
      const xChannelConfigs = [
        { id: config.get('DISCORD_X_POSTS_CHANNEL_ID'), name: 'X posts' },
        { id: config.get('DISCORD_X_REPLIES_CHANNEL_ID'), name: 'X replies' },
        { id: config.get('DISCORD_X_QUOTES_CHANNEL_ID'), name: 'X quotes' },
        { id: config.get('DISCORD_X_RETWEETS_CHANNEL_ID'), name: 'X retweets' },
      ];

      for (const channelConfig of xChannelConfigs) {
        if (channelConfig.id) {
          try {
            operation.progress(`Scanning ${channelConfig.name} channel`, { channelId: channelConfig.id });
            const xChannel = await discordService.fetchChannel(channelConfig.id);
            if (xChannel) {
              const tweetResults = await this.duplicateDetector.scanDiscordChannelForTweets(xChannel, 50);
              scanResults.x.messagesScanned += tweetResults.messagesScanned;
              scanResults.x.tweetIdsAdded += tweetResults.tweetIdsAdded;
              scanResults.x.channelsScanned += 1;
              scanResults.x.errors.push(...tweetResults.errors);
              scanResults.totalScanned += tweetResults.messagesScanned;
              scanResults.totalAdded += tweetResults.tweetIdsAdded;

              operation.progress(
                `${channelConfig.name} channel scanned: ${tweetResults.messagesScanned} messages, ${tweetResults.tweetIdsAdded} tweets added`
              );
            }
          } catch (error) {
            const errorMsg = `Failed to scan ${channelConfig.name} channel: ${error.message}`;
            operation.progress('Error scanning X channel', { channel: channelConfig.name, error: errorMsg });
            scanResults.x.errors.push(errorMsg);
          }
        } else {
          operation.progress(`No ${channelConfig.name} channel ID configured, skipping`);
        }
      }

      const result = {
        scanned: true,
        results: scanResults,
      };

      operation.success(
        `Discord channel scanning completed: ${scanResults.totalScanned} messages scanned, ${scanResults.totalAdded} items cached`,
        result
      );

      return result;
    } catch (error) {
      operation.error(error, 'Discord channel scanning failed');
      throw error;
    }
  }

  /**
   * Check duplicate detector for previously announced content
   * @param {Object} contentData - Content data to check for
   * @returns {Promise<Object>} Check result with found status and location
   */
  async checkForPreviouslyAnnouncedContent(contentData) {
    const operation = this.logger.startOperation('checkForPreviouslyAnnouncedContent', {
      platform: contentData.platform,
      type: contentData.type,
      contentId: contentData.id || contentData.videoId || contentData.tweetId,
    });

    try {
      if (!this.duplicateDetector) {
        operation.progress('No duplicate detector available, skipping duplicate check');
        const result = {
          found: false,
          reason: 'no_duplicate_detector',
        };
        operation.success('Duplicate check skipped - no duplicate detector', result);
        return result;
      }

      // First check the duplicate detector cache (from startup scan)
      operation.progress('Checking duplicate detector cache');

      // For YouTube content, check video IDs
      if (contentData.platform === 'YouTube' && contentData.videoId) {
        operation.progress('Checking for YouTube video ID in duplicate detector');
        const videoExists = this.duplicateDetector.isVideoIdKnown(contentData.videoId);

        if (videoExists) {
          const result = {
            found: true,
            foundIn: 'youtube_duplicate_detector_cache',
            contentId: contentData.videoId,
          };
          operation.success('YouTube video found in duplicate detector cache', result);
          return result;
        }
      }

      // For X/Twitter content, check tweet IDs
      if (contentData.platform === 'X' && contentData.tweetId) {
        operation.progress('Checking for X/Twitter tweet ID in duplicate detector');
        const tweetExists = this.duplicateDetector.isTweetIdKnown(contentData.tweetId);

        if (tweetExists) {
          const result = {
            found: true,
            foundIn: 'x_duplicate_detector_cache',
            contentId: contentData.tweetId,
          };
          operation.success('X/Twitter tweet found in duplicate detector cache', result);
          return result;
        }
      }

      // For general URL-based content, check URLs
      if (contentData.url) {
        operation.progress('Checking for URL in duplicate detector');
        const urlExists = await this.duplicateDetector.isDuplicateByUrl(contentData.url);

        if (urlExists) {
          const result = {
            found: true,
            foundIn: 'url_duplicate_detector_cache',
            url: contentData.url,
          };
          operation.success('URL found in duplicate detector cache', result);
          return result;
        }
      }

      // Cache miss - now do live Discord channel scanning to catch recent messages
      operation.progress('Cache miss - performing live Discord channel scan for recent messages');
      const liveDiscordResult = await this.scanRecentDiscordMessages(contentData);

      if (liveDiscordResult.found) {
        // Update duplicate detector cache with found content
        if (contentData.platform === 'YouTube' && contentData.videoId) {
          this.duplicateDetector.addVideoId(contentData.videoId);
        } else if (contentData.platform === 'X' && contentData.tweetId) {
          // X content - mark URL as seen
          await this.duplicateDetector.markAsSeenByUrl(contentData.url);
        } else if (contentData.url) {
          await this.duplicateDetector.markAsSeenByUrl(contentData.url);
        }

        operation.success('Content found in live Discord scan', liveDiscordResult);
        return liveDiscordResult;
      }

      const result = {
        found: false,
      };
      operation.success(
        'Content not found in duplicate detector or recent Discord messages - proceeding with announcement',
        result
      );
      return result;
    } catch (error) {
      operation.error(error, 'Failed to check duplicate detector for previously announced content');
      // Return false on error to allow announcement to proceed
      return {
        found: false,
        error: error.message,
      };
    }
  }

  /**
   * Scan recent Discord messages for content that might have been posted after startup
   * @param {Object} contentData - Content data to check for
   * @returns {Promise<Object>} Check result with found status and location
   */
  async scanRecentDiscordMessages(contentData) {
    const operation = this.logger.startOperation('scanRecentDiscordMessages', {
      platform: contentData.platform,
      type: contentData.type,
      contentId: contentData.id || contentData.videoId || contentData.tweetId,
    });

    try {
      // Get Discord service for live scanning
      if (!this.discordService || !this.discordService.isReady()) {
        operation.progress('Discord service not available, skipping live scan');
        return { found: false, reason: 'discord_not_ready' };
      }

      // Determine which channels to scan based on content platform
      const channelsToScan = [];

      if (contentData.platform === 'YouTube') {
        const youtubeChannelId = this.config?.get('DISCORD_YOUTUBE_CHANNEL_ID');
        if (youtubeChannelId) {
          channelsToScan.push({ id: youtubeChannelId, name: 'YouTube', type: 'youtube' });
        }
      } else if (contentData.platform === 'X') {
        // Scan all X-related channels
        const xChannelConfigs = [
          { id: this.config?.get('DISCORD_X_POSTS_CHANNEL_ID'), name: 'X posts', type: 'x' },
          { id: this.config?.get('DISCORD_X_REPLIES_CHANNEL_ID'), name: 'X replies', type: 'x' },
          { id: this.config?.get('DISCORD_X_QUOTES_CHANNEL_ID'), name: 'X quotes', type: 'x' },
          { id: this.config?.get('DISCORD_X_RETWEETS_CHANNEL_ID'), name: 'X retweets', type: 'x' },
        ];
        channelsToScan.push(...xChannelConfigs.filter(ch => ch.id));
      }

      if (channelsToScan.length === 0) {
        operation.progress('No channels configured for scanning');
        return { found: false, reason: 'no_channels_configured' };
      }

      // Scan recent messages (last 10 minutes or since bot startup)
      const scanSince = new Date(
        Math.max(
          Date.now() - 10 * 60 * 1000, // 10 minutes ago
          this.getBotStartTime().getTime() // Bot startup time
        )
      );

      operation.progress(`Scanning ${channelsToScan.length} channels for messages since ${scanSince.toISOString()}`);

      for (const channelConfig of channelsToScan) {
        try {
          const channel = await this.discordService.fetchChannel(channelConfig.id);
          if (!channel) {
            continue;
          }

          operation.progress(`Scanning ${channelConfig.name} channel for recent messages`);

          // Fetch recent messages
          const messages = await channel.messages.fetch({ limit: 20, after: this.getSnowflakeFromDate(scanSince) });

          for (const [, message] of messages) {
            const messageContent = message.content || '';

            // Check if message contains our target content
            if (contentData.url && messageContent.includes(contentData.url)) {
              operation.success(`Found matching URL in recent ${channelConfig.name} message`, {
                messageId: message.id,
                timestamp: message.createdAt.toISOString(),
                channelName: channelConfig.name,
              });
              return {
                found: true,
                foundIn: `recent_discord_${channelConfig.type}`,
                channelName: channelConfig.name,
                messageId: message.id,
                timestamp: message.createdAt.toISOString(),
              };
            }

            // Platform-specific content matching
            if (contentData.platform === 'YouTube' && contentData.videoId) {
              if (
                messageContent.includes(contentData.videoId) ||
                messageContent.includes(`youtu.be/${contentData.videoId}`) ||
                messageContent.includes(`watch?v=${contentData.videoId}`)
              ) {
                operation.success(`Found matching YouTube video in recent ${channelConfig.name} message`, {
                  messageId: message.id,
                  videoId: contentData.videoId,
                });
                return {
                  found: true,
                  foundIn: `recent_discord_youtube`,
                  channelName: channelConfig.name,
                  messageId: message.id,
                  timestamp: message.createdAt.toISOString(),
                };
              }
            } else if (contentData.platform === 'X' && contentData.tweetId) {
              if (
                messageContent.includes(contentData.tweetId) ||
                messageContent.includes(`status/${contentData.tweetId}`)
              ) {
                operation.success(`Found matching X tweet in recent ${channelConfig.name} message`, {
                  messageId: message.id,
                  tweetId: contentData.tweetId,
                });
                return {
                  found: true,
                  foundIn: `recent_discord_x`,
                  channelName: channelConfig.name,
                  messageId: message.id,
                  timestamp: message.createdAt.toISOString(),
                };
              }
            }
          }
        } catch (channelError) {
          operation.progress(`Error scanning ${channelConfig.name} channel: ${channelError.message}`);
          // Continue with other channels
        }
      }

      operation.success('No matching content found in recent Discord messages');
      return { found: false };
    } catch (error) {
      operation.error(error, 'Failed to scan recent Discord messages');
      return { found: false, error: error.message };
    }
  }

  /**
   * Convert Date to Discord snowflake for message filtering
   * @param {Date} date - Date to convert
   * @returns {string} Discord snowflake
   */
  getSnowflakeFromDate(date) {
    // Discord snowflake epoch is January 1, 2015
    const DISCORD_EPOCH = 1420070400000;
    const timestamp = date.getTime() - DISCORD_EPOCH;
    return (timestamp << 22).toString();
  }

  /**
   * Get bot start time (helper method)
   * @returns {Date} Bot start time
   */
  getBotStartTime() {
    if (this.contentStateManager && typeof this.contentStateManager.getBotStartTime === 'function') {
      return this.contentStateManager.getBotStartTime();
    }
    // Fallback to 10 minutes ago if no state manager
    return new Date(Date.now() - 10 * 60 * 1000);
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
