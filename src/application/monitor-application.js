import { DuplicateDetector } from '../duplicate-detector.js';
import crypto from 'crypto';
import { nowUTC, toISOStringUTC } from '../utilities/utc-time.js';
import { createEnhancedLogger } from '../utilities/enhanced-logger.js';

/**
 * YouTube monitoring application orchestrator
 * Coordinates PubSubHubbub subscriptions, webhook handling, and content announcements
 */
export class MonitorApplication {
  constructor(dependencies) {
    this.youtube = dependencies.youtubeService;
    this.http = dependencies.httpService;
    this.classifier = dependencies.contentClassifier;
    this.announcer = dependencies.contentAnnouncer;
    this.config = dependencies.config;
    this.state = dependencies.stateManager;
    this.eventBus = dependencies.eventBus;
    // Create enhanced logger for this module
    this.logger = createEnhancedLogger(
      'youtube',
      dependencies.logger,
      dependencies.debugManager,
      dependencies.metricsManager
    );
    this.contentStateManager = dependencies.contentStateManager;
    this.livestreamStateMachine = dependencies.livestreamStateMachine;
    this.contentCoordinator = dependencies.contentCoordinator;

    // Polling configuration
    this.scheduledContentPollInterval = this.config.get('SCHEDULED_CONTENT_POLL_INTERVAL_MS', 3600000); // 1 hour (was 10 min - too aggressive for quota)
    this.liveStatePollInterval = this.config.get('LIVE_STATE_POLL_INTERVAL_MS', 60000); // 1 minute

    // YouTube configuration
    this.youtubeChannelId = this.config.getRequired('YOUTUBE_CHANNEL_ID');
    this.youtubeApiKey = this.config.getRequired('YOUTUBE_API_KEY');

    // PubSubHubbub configuration
    this.callbackUrl = this.config.getRequired('PSH_CALLBACK_URL');
    this.webhookSecret = this.config.get('PSH_SECRET', 'your_super_secret_string_here');
    this.verifyToken = this.config.get('PSH_VERIFY_TOKEN', 'your_optional_verify_token');

    // Webhook debugging configuration
    this.webhookDebugEnabled = this.config.getBoolean('WEBHOOK_DEBUG_LOGGING', false);

    // API fallback configuration (triggered only on notification failures)
    this.fallbackEnabled = true;

    // State management - accept duplicateDetector dependency
    this.duplicateDetector =
      dependencies.duplicateDetector ||
      new DuplicateDetector(
        null, // Disable persistent storage - rely only on Discord history and in-memory caches
        dependencies.logger?.child({ service: 'DuplicateDetector' })
      );
    this.isRunning = false;
    this.subscriptionActive = false;
    this.fallbackTimerId = null;
    this.scheduledContentPollTimerId = null;
    this.liveStatePollTimerId = null;
    this.lastQuotaError = null; // Track quota errors for backoff
    this.lastSuccessfulScheduledPoll = null; // Track successful polls

    // Statistics
    this.stats = {
      subscriptions: 0,
      webhooksReceived: 0,
      videosProcessed: 0,
      videosAnnounced: 0,
      fallbackPolls: 0,
      lastSubscriptionTime: null,
      lastWebhookTime: null,
      lastError: null,
      xmlParseFailures: 0,
    };
  }

  /**
   * Start YouTube content monitoring
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Monitor application is already running');
    }

    const operation = this.logger.startOperation('startMonitorApplication', {
      youtubeChannelId: this.youtubeChannelId,
      callbackUrl: this.callbackUrl,
      scheduledPollInterval: this.scheduledContentPollInterval,
    });

    try {
      operation.progress('Validating YouTube API access');
      await this.validateYouTubeAccess();

      operation.progress('Subscribing to PubSubHubbub notifications');
      await this.subscribeToPubSubHubbub();

      operation.progress('Starting scheduled content polling');
      this.startScheduledContentPolling();

      this.isRunning = true;

      // Emit start event
      this.eventBus.emit('monitor.started', {
        startTime: nowUTC(),
        youtubeChannelId: this.youtubeChannelId,
        callbackUrl: this.callbackUrl,
        fallbackEnabled: this.fallbackEnabled,
      });

      operation.success('YouTube monitor application started successfully', {
        youtubeChannelId: this.youtubeChannelId,
        scheduledPollInterval: this.scheduledContentPollInterval,
        subscriptionActive: this.subscriptionActive,
      });
    } catch (error) {
      operation.error(error, 'Failed to start monitor application');
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop YouTube content monitoring
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    const operation = this.logger.startOperation('stopMonitorApplication', {
      isRunning: this.isRunning,
      subscriptionActive: this.subscriptionActive,
      stats: this.getStats(),
    });

    try {
      operation.progress('Stopping fallback polling');
      this.stopFallbackPolling();

      operation.progress('Unsubscribing from PubSubHubbub');
      await this.unsubscribeFromPubSubHubbub();

      operation.progress('Stopping all polling timers');
      this.stopScheduledContentPolling();
      this.stopLiveStatePolling();

      this.isRunning = false;

      // Emit stop event
      this.eventBus.emit('monitor.stopped', {
        stopTime: nowUTC(),
        stats: this.getStats(),
      });

      operation.success('YouTube monitor application stopped successfully', {
        finalStats: this.getStats(),
      });
    } catch (error) {
      operation.error(error, 'Error stopping monitor application');
      throw error;
    }
  }

  /**
   * Validate YouTube API access
   * @returns {Promise<void>}
   */
  async validateYouTubeAccess() {
    const operation = this.logger.startOperation('validateYouTubeAccess', {
      youtubeChannelId: this.youtubeChannelId,
    });

    try {
      operation.progress('Testing YouTube API connectivity');

      // Test API key by fetching channel details
      const channelDetails = await this.youtube.getChannelDetails(this.youtubeChannelId);

      if (!channelDetails) {
        throw new Error('Failed to fetch YouTube channel details');
      }

      operation.success('YouTube API validation successful', {
        channelTitle: channelDetails.snippet?.title || 'Unknown',
        channelId: this.youtubeChannelId,
        subscriberCount: channelDetails.statistics?.subscriberCount,
      });
    } catch (error) {
      operation.error(error, 'YouTube API validation failed');
      throw new Error(`YouTube API validation failed: ${error.message}`);
    }
  }

  /**
   * Subscribe to PubSubHubbub for real-time notifications
   * @returns {Promise<void>}
   */
  async subscribeToPubSubHubbub() {
    try {
      this.logger.info('Subscribing to PubSubHubbub...');

      const hubUrl = 'https://pubsubhubbub.appspot.com/subscribe';
      const topicUrl = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${this.youtubeChannelId}`;

      const subscriptionData = new URLSearchParams({
        'hub.callback': this.callbackUrl,
        'hub.topic': topicUrl,
        'hub.verify': 'async',
        'hub.mode': 'subscribe',
        'hub.verify_token': this.verifyToken,
        'hub.lease_seconds': '86400', // 24 hours
      });

      this.logWebhookDebug('PUBSUBHUBBUB SUBSCRIPTION REQUEST', {
        hubUrl,
        topicUrl,
        callbackUrl: this.callbackUrl,
        verifyToken: this.verifyToken ? '[SET]' : '[NOT_SET]',
        leaseSeconds: '86400',
      });

      const response = await this.http.post(hubUrl, subscriptionData.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      this.logWebhookDebug('PUBSUBHUBBUB SUBSCRIPTION RESPONSE', {
        status: response.status,
        statusText: response.statusText || 'unknown',
        headers: response.headers || {},
        success: this.http.isSuccessResponse(response),
      });

      if (this.http.isSuccessResponse(response)) {
        this.subscriptionActive = true;
        this.stats.subscriptions++;
        this.stats.lastSubscriptionTime = nowUTC();
        this.logger.info('Successfully subscribed to PubSubHubbub');

        // Schedule subscription renewal
        this.scheduleSubscriptionRenewal();
      } else {
        throw new Error(`Subscription failed with status: ${response.status}`);
      }
    } catch (error) {
      this.logWebhookDebug('PUBSUBHUBBUB SUBSCRIPTION ERROR', {
        error: error.message,
        stack: error.stack,
      });
      this.logger.error('PubSubHubbub subscription failed:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe from PubSubHubbub
   * @returns {Promise<void>}
   */
  async unsubscribeFromPubSubHubbub() {
    if (!this.subscriptionActive) {
      return;
    }

    try {
      this.logger.info('Unsubscribing from PubSubHubbub...');

      const hubUrl = 'https://pubsubhubbub.appspot.com/subscribe';
      const topicUrl = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${this.youtubeChannelId}`;

      const unsubscriptionData = new URLSearchParams({
        'hub.callback': this.callbackUrl,
        'hub.topic': topicUrl,
        'hub.verify': 'async',
        'hub.mode': 'unsubscribe',
        'hub.verify_token': this.verifyToken,
      });

      const response = await this.http.post(hubUrl, unsubscriptionData.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (this.http.isSuccessResponse(response)) {
        this.subscriptionActive = false;
        this.logger.info('Successfully unsubscribed from PubSubHubbub');
      } else {
        this.logger.warn(`Unsubscription failed with status: ${response.status}`);
      }
    } catch (error) {
      this.logger.error('PubSubHubbub unsubscription failed:', error);
    }
  }

  /**
   * Schedule automatic subscription renewal
   */
  scheduleSubscriptionRenewal() {
    // Renew subscription every 20 hours (4 hours before expiry)
    setTimeout(
      async () => {
        if (this.isRunning && this.subscriptionActive) {
          try {
            await this.subscribeToPubSubHubbub();
          } catch (error) {
            this.logger.error('Subscription renewal failed:', error);
          }
        }
      },
      20 * 60 * 60 * 1000
    ); // 20 hours
  }

  /**
   * Schedule API fallback check when notification processing fails
   * This replaces the old automatic polling system
   */
  scheduleApiFallback() {
    if (!this.fallbackEnabled) {
      this.logger.warn('API fallback is disabled');
      return;
    }

    if (this.fallbackTimerId) {
      this.logger.debug('API fallback already scheduled, skipping');
      return;
    }

    this.logger.warn('Scheduling API fallback due to notification processing failure');

    this.fallbackTimerId = setTimeout(async () => {
      try {
        await this.performApiFallback();
      } catch (error) {
        this.logger.error('API fallback execution failed:', error);
      } finally {
        this.fallbackTimerId = null;
      }
    }, 30000); // 30 second delay to allow for temporary issues
  }

  /**
   * Perform API fallback check for new videos
   * This is only called when notification processing fails
   */
  async performApiFallback() {
    try {
      this.stats.fallbackPolls++;
      this.logger.warn('Performing API fallback check due to notification failure...');

      // Get latest videos from the channel
      const videos = await this.youtube.getChannelVideos(this.youtubeChannelId, 5);

      if (!videos || videos.length === 0) {
        this.logger.debug('No videos found in API fallback check');
        return;
      }

      this.logger.warn(`API fallback found ${videos.length} videos from YouTube API.`);

      // Process each video
      for (const video of videos) {
        try {
          this.logger.warn(`Processing video from API fallback: ${video.snippet.title}`);
          await this.processVideo(video, 'api-fallback');
        } catch (error) {
          this.logger.error(`Error processing video ${video.id} in API fallback:`, error);
        }
      }

      this.logger.info('API fallback check completed successfully');
    } catch (error) {
      this.logger.error('API fallback check failed:', error);
      throw error;
    }
  }

  /**
   * Stop and clear any scheduled fallback
   */
  stopFallbackPolling() {
    if (this.fallbackTimerId) {
      clearTimeout(this.fallbackTimerId);
      this.fallbackTimerId = null;
      this.logger.info('Scheduled API fallback cleared');
    }
  }

  /**
   * Handle PubSubHubbub webhook notification
   * @param {Object} request - Webhook request object
   * @returns {Promise<Object>} Response object
   */
  async handleWebhook(request) {
    const operation = this.logger.startOperation('handleWebhook', {
      method: request.method,
      contentType: request.headers['content-type'],
      bodyLength: request.body ? request.body.length : 0,
      remoteAddress: request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || 'unknown',
    });

    try {
      this.stats.webhooksReceived++;
      this.stats.lastWebhookTime = nowUTC();

      // Enhanced webhook debugging
      this.logWebhookDebug('=== WEBHOOK REQUEST RECEIVED ===', {
        method: request.method,
        timestamp: toISOStringUTC(),
        headers: this.sanitizeHeaders(request.headers),
        bodyLength: request.body ? request.body.length : 0,
        bodyType: typeof request.body,
        query: request.query || {},
        remoteAddress: request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || 'unknown',
      });

      // Handle verification request (GET requests don't require signature verification)
      if (request.method === 'GET') {
        operation.progress('Processing webhook verification request');
        const verificationResult = this.handleVerificationRequest(request.query);
        this.logWebhookDebug('WEBHOOK VERIFICATION REQUEST', {
          query: request.query,
          result: verificationResult,
        });
        operation.success('Webhook verification request processed', verificationResult);
        return verificationResult;
      }

      // Handle notification (POST requests require signature verification)
      if (request.method === 'POST') {
        operation.progress('Verifying webhook signature');
        const signatureResult = this.verifyWebhookSignatureDebug(request.body, request.headers);
        if (!signatureResult.isValid) {
          this.logWebhookDebug('WEBHOOK SIGNATURE VERIFICATION FAILED', signatureResult.details);
          const errorResult = { status: 403, message: 'Invalid signature' };
          operation.error(
            new Error('Webhook signature verification failed'),
            'Invalid webhook signature',
            signatureResult.details
          );
          return errorResult;
        }

        this.logWebhookDebug('WEBHOOK SIGNATURE VERIFIED', {
          signatureMethod: signatureResult.details.method,
          secretLength: this.webhookSecret.length,
        });

        operation.progress('Processing notification payload');
        const notificationResult = await this.handleNotification(request.body);
        this.logWebhookDebug('WEBHOOK NOTIFICATION PROCESSED', {
          bodyPreview: this.getBodyPreview(request.body),
          result: notificationResult,
        });
        operation.success('Webhook notification processed successfully', notificationResult);
        return notificationResult;
      }

      this.logWebhookDebug('WEBHOOK METHOD NOT ALLOWED', { method: request.method });
      const methodNotAllowedResult = { status: 405, message: 'Method not allowed' };
      operation.error(new Error(`Method ${request.method} not allowed`), 'Unsupported HTTP method', {
        method: request.method,
      });
      return methodNotAllowedResult;
    } catch (error) {
      this.logWebhookDebug('WEBHOOK ERROR', {
        error: error.message,
        stack: error.stack,
        requestMethod: request.method,
        bodyLength: request.body ? request.body.length : 0,
      });

      this.stats.lastError = error.message;
      operation.error(error, 'Webhook handling error', {
        requestMethod: request.method,
        bodyLength: request.body ? request.body.length : 0,
      });
      return { status: 500, message: 'Internal server error' };
    }
  }

  /**
   * Verify webhook signature with detailed debugging information
   * @param {string|Buffer} body - Request body
   * @param {Object} headers - Request headers
   * @returns {Object} Validation result with debugging details
   */
  verifyWebhookSignatureDebug(body, headers) {
    const signature = headers['x-hub-signature'];
    const debugDetails = {
      hasSignatureHeader: !!signature,
      signatureReceived: signature || 'none',
      bodyLength: body ? body.length : 0,
      secretConfigured: !!this.webhookSecret,
      secretLength: this.webhookSecret ? this.webhookSecret.length : 0,
      method: 'HMAC-SHA1',
    };

    if (!signature) {
      return {
        isValid: false,
        details: { ...debugDetails, reason: 'No x-hub-signature header provided' },
      };
    }

    if (!this.webhookSecret) {
      return {
        isValid: false,
        details: { ...debugDetails, reason: 'No webhook secret configured' },
      };
    }

    const expectedSignature = `sha1=${crypto.createHmac('sha1', this.webhookSecret).update(body).digest('hex')}`;
    debugDetails.expectedSignature = expectedSignature;
    debugDetails.signatureMatch = signature === expectedSignature;

    try {
      const isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
      return {
        isValid,
        details: { ...debugDetails, reason: isValid ? 'Signature valid' : 'Signature mismatch' },
      };
    } catch (error) {
      return {
        isValid: false,
        details: {
          ...debugDetails,
          reason: `Signature comparison failed: ${error.message}`,
          error: error.message,
        },
      };
    }
  }

  /**
   * Verify webhook signature (legacy method for backward compatibility)
   * @param {string|Buffer} body - Request body
   * @param {Object} headers - Request headers
   * @returns {boolean} True if signature is valid
   */
  verifyWebhookSignature(body, headers) {
    return this.verifyWebhookSignatureDebug(body, headers).isValid;
  }

  /**
   * Log webhook debugging information
   * @param {string} message - Debug message
   * @param {Object} data - Additional data to log
   */
  logWebhookDebug(message, data = {}) {
    if (!this.webhookDebugEnabled) {
      return;
    }

    // Always log webhook debug info at INFO level when debugging is enabled
    this.logger.info(`[WEBHOOK-DEBUG] ${message}`, {
      webhookDebug: true,
      timestamp: toISOStringUTC(),
      ...data,
    });
  }

  /**
   * Sanitize headers for logging (remove sensitive information)
   * @param {Object} headers - Request headers
   * @returns {Object} Sanitized headers
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };

    // Remove or mask sensitive headers
    if (sanitized['authorization']) {
      sanitized['authorization'] = '[REDACTED]';
    }
    if (sanitized['x-hub-signature']) {
      sanitized['x-hub-signature'] = `[SIGNATURE:${sanitized['x-hub-signature'].length}chars]`;
    }

    return sanitized;
  }

  /**
   * Get a safe preview of the request body for logging
   * @param {string|Buffer} body - Request body
   * @returns {string} Body preview
   */
  getBodyPreview(body) {
    if (!body) {
      return '[EMPTY]';
    }

    const bodyStr = body.toString();

    // Return first 200 characters for preview
    if (bodyStr.length <= 200) {
      return bodyStr;
    }

    return `${bodyStr.substring(0, 200)}... [TRUNCATED:${bodyStr.length}total]`;
  }

  /**
   * Handle verification request from PubSubHubbub hub
   * @param {Object} query - Query parameters
   * @returns {Object} Response object
   */
  handleVerificationRequest(query) {
    const challenge = query['hub.challenge'];
    const verifyToken = query['hub.verify_token'];
    const mode = query['hub.mode'];

    if (verifyToken !== this.verifyToken) {
      this.logger.warn('Verification token mismatch');
      return { status: 403, message: 'Invalid verify token' };
    }

    this.logger.info(`PubSubHubbub verification successful (mode: ${mode})`);
    return { status: 200, body: challenge };
  }

  /**
   * Handle notification from PubSubHubbub
   * @param {string} body - XML notification body
   * @returns {Promise<Object>} Response object
   */
  async handleNotification(body) {
    const notificationId = Date.now().toString(36);

    try {
      this.logWebhookDebug('NOTIFICATION PROCESSING START', {
        notificationId,
        bodyLength: body ? body.length : 0,
        bodyType: typeof body,
        isEmpty: !body || body.length === 0,
      });

      // Parse XML to extract video information
      const videoInfo = this.parseNotificationXML(body);

      this.logWebhookDebug('XML PARSING RESULT', {
        notificationId,
        success: !!videoInfo,
        videoInfo: videoInfo || 'parsing_failed',
        bodyPreview: this.getBodyPreview(body),
      });

      if (!videoInfo) {
        this.logger.warn('Failed to parse notification XML');
        this.stats.xmlParseFailures++;
        this.logWebhookDebug('XML PARSING FAILED', {
          notificationId,
          xmlParseFailures: this.stats.xmlParseFailures,
          bodyPreview: this.getBodyPreview(body),
        });
        return { status: 400, message: 'Invalid XML' };
      }

      this.logWebhookDebug('FETCHING VIDEO DETAILS', {
        notificationId,
        videoId: videoInfo.videoId,
        videoTitle: videoInfo.title || 'unknown',
      });

      // Fetch detailed video information
      const videoDetails = await this.youtube.getVideoDetails(videoInfo.videoId);

      this.logWebhookDebug('VIDEO DETAILS RESULT', {
        notificationId,
        videoId: videoInfo.videoId,
        found: !!videoDetails,
        title: videoDetails?.snippet?.title || 'not_available',
        liveBroadcastContent: videoDetails?.snippet?.liveBroadcastContent || 'unknown',
        publishedAt: videoDetails?.snippet?.publishedAt || 'unknown',
      });

      if (!videoDetails) {
        this.logger.warn(`Could not fetch details for video: ${videoInfo.videoId}`);
        this.logWebhookDebug('VIDEO DETAILS NOT FOUND', {
          notificationId,
          videoId: videoInfo.videoId,
          reason: 'youtube_api_returned_null',
        });
        return { status: 200, message: 'OK' };
      }

      this.logWebhookDebug('PROCESSING VIDEO', {
        notificationId,
        videoId: videoInfo.videoId,
        title: videoDetails.snippet.title,
        liveBroadcastContent: videoDetails.snippet.liveBroadcastContent,
        source: 'webhook',
      });

      // Process the video
      await this.processVideo(videoDetails, 'webhook');

      this.logWebhookDebug('NOTIFICATION PROCESSING COMPLETE', {
        notificationId,
        videoId: videoInfo.videoId,
        title: videoDetails.snippet.title,
        success: true,
      });

      this.logger.info(`Successfully processed webhook notification for video: ${videoDetails.snippet.title}`);
      return { status: 200, message: 'OK' };
    } catch (error) {
      this.logWebhookDebug('NOTIFICATION PROCESSING ERROR', {
        notificationId,
        error: error.message,
        stack: error.stack,
        fallbackWillTrigger: this.fallbackEnabled,
      });

      this.logger.error('Notification processing error:', error);

      // Trigger API fallback on notification processing error
      if (this.fallbackEnabled) {
        this.scheduleApiFallback();
        this.logWebhookDebug('API FALLBACK SCHEDULED', {
          notificationId,
          reason: 'notification_processing_error',
        });
      }

      return { status: 200, message: 'OK' }; // Always return 200 to prevent retry spam
    }
  }

  /**
   * Parse PubSubHubbub notification XML
   * @param {string} xmlBody - XML content
   * @returns {Object|null} Parsed video information
   */
  parseNotificationXML(xmlBody) {
    try {
      // Simple regex-based XML parsing for YouTube feeds
      const videoIdMatch = xmlBody.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const titleMatch = xmlBody.match(/<media:title>([^<]+)<\/media:title>/);
      const linkMatch = xmlBody.match(/<link rel="alternate" href="([^"]+)"/);

      if (!videoIdMatch) {
        return null;
      }

      return {
        videoId: videoIdMatch[1],
        title: titleMatch ? titleMatch[1] : null,
        link: linkMatch ? linkMatch[1] : null,
      };
    } catch (error) {
      this.logger.error('XML parsing error:', error);
      return null;
    }
  }

  /**
   * Process a video for potential announcement
   * @param {Object} video - Video object from YouTube API
   * @param {string} source - Source of the video ('webhook' or 'fallback')
   * @returns {Promise<void>}
   */
  async processVideo(video, source = 'unknown') {
    const videoSummary = {
      videoId: video.id,
      title: video.snippet?.title?.substring(0, 50) || 'Unknown title',
      channelTitle: video.snippet?.channelTitle,
      publishedAt: video.snippet?.publishedAt,
      liveBroadcastContent: video.snippet?.liveBroadcastContent,
      source,
    };

    const operation = this.logger.startOperation('processVideo', videoSummary);

    try {
      this.stats.videosProcessed++;

      const videoId = video.id;
      const title = video.snippet?.title || 'Unknown title';
      const url = `https://www.youtube.com/watch?v=${videoId}`;

      operation.progress('Checking for duplicate video');
      if (await this.duplicateDetector.isDuplicate(url)) {
        return operation.success('Duplicate video detected, skipping', {
          videoId,
          title: title.substring(0, 50),
          source,
          action: 'skipped_duplicate',
        });
      }

      operation.progress('Checking if video is new enough');
      if (!this.isNewContent(video)) {
        return operation.success('Video is too old, skipping', {
          videoId,
          title: title.substring(0, 50),
          publishedAt: video.snippet?.publishedAt,
          botStartTime: this.state.get('botStartTime'),
          source,
          action: 'skipped_old',
        });
      }

      operation.progress('Classifying video content');
      const classification = this.classifier.classifyYouTubeContent(video);

      operation.progress('Creating content object for announcement');
      const content = {
        platform: 'youtube',
        type: classification.type,
        id: videoId,
        url,
        title,
        channelTitle: video.snippet?.channelTitle,
        publishedAt: video.snippet?.publishedAt,
        ...classification.details,
      };

      operation.progress('Processing video announcement');
      let result;
      if (this.contentCoordinator) {
        result = await this.contentCoordinator.processContent(videoId, source, content);
        if (result.action === 'announced') {
          result = { success: true, ...result.announcementResult };
        } else {
          result = { success: false, skipped: true, reason: result.reason };
        }
      } else {
        result = await this.announcer.announceContent(content);
      }

      if (result.success) {
        this.stats.videosAnnounced++;
        this.duplicateDetector.markAsSeen(url);

        // Emit video processed event
        this.eventBus.emit('monitor.video.processed', {
          video: content,
          classification,
          result,
          source,
          timestamp: nowUTC(),
        });

        return operation.success('Video announcement successful', {
          videoId,
          type: classification.type,
          title: title.substring(0, 50),
          source,
          channelId: result.channelId,
          messageId: result.messageId,
        });
      } else if (result.skipped) {
        return operation.success('Video announcement skipped', {
          videoId,
          type: classification.type,
          title: title.substring(0, 50),
          reason: result.reason,
          source,
        });
      } else {
        operation.error(new Error(result.reason || 'Unknown announcement failure'), 'Video announcement failed', {
          videoId,
          type: classification.type,
          title: title.substring(0, 50),
          source,
        });
        throw new Error(`Video announcement failed: ${result.reason}`);
      }
    } catch (error) {
      operation.error(error, 'Error processing video', videoSummary);
      throw error;
    }
  }

  /**
   * Check if video content is new enough to announce
   * @param {Object} video - Video object
   * @returns {boolean} True if content is new
   */
  isNewContent(video) {
    const botStartTime = this.state.get('botStartTime');
    if (!botStartTime) {
      return true; // If no start time set, consider all content new
    }

    const publishedAt = video.snippet?.publishedAt;
    if (!publishedAt) {
      return true; // If no publish time available, assume it's new
    }

    const publishTime = new Date(publishedAt);
    return publishTime >= botStartTime;
  }

  /**
   * Check if monitor is running
   * @returns {boolean} True if running
   */
  isRunning() {
    return this.isRunning;
  }

  /**
   * Get monitor statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      subscriptionActive: this.subscriptionActive,
      youtubeChannelId: this.youtubeChannelId,
      callbackUrl: this.callbackUrl,
      fallbackEnabled: this.fallbackEnabled,
      ...this.stats,
      duplicateDetectorStats: this.duplicateDetector.getStats(),
    };
  }

  /**
   * Dispose of resources
   * @returns {Promise<void>}
   */
  async dispose() {
    await this.stop();
  }

  /**
   * Starts the polling loop for discovering scheduled content.
   */
  startScheduledContentPolling() {
    if (this.scheduledContentPollTimerId) {
      this.stopScheduledContentPolling();
    }
    const loop = async () => {
      try {
        await this.pollScheduledContent();
      } catch (error) {
        this.logger.error('Error in scheduled content polling loop:', error);
      }
      if (this.isRunning) {
        this.scheduledContentPollTimerId = setTimeout(loop, this.scheduledContentPollInterval);
      }
    };
    this.scheduledContentPollTimerId = setTimeout(loop, 5000); // Start after 5s
    this.logger.info('Scheduled content polling started', { interval: this.scheduledContentPollInterval });
  }

  /**
   * Stops the scheduled content polling loop.
   */
  stopScheduledContentPolling() {
    if (this.scheduledContentPollTimerId) {
      clearTimeout(this.scheduledContentPollTimerId);
      this.scheduledContentPollTimerId = null;
      this.logger.info('Scheduled content polling stopped.');
    }
  }

  /**
   * Fetches upcoming streams and adds them to the state manager.
   * Implements smart polling with quota error backoff.
   */
  async pollScheduledContent() {
    // Check if we should skip polling due to recent quota errors
    if (this.lastQuotaError) {
      const timeSinceQuotaError = Date.now() - this.lastQuotaError;
      const backoffTime = 4 * 60 * 60 * 1000; // 4 hours backoff after quota error

      if (timeSinceQuotaError < backoffTime) {
        this.logger.debug('Skipping scheduled content poll due to recent quota error', {
          timeSinceError: Math.round(timeSinceQuotaError / 1000 / 60),
          backoffMinutes: Math.round(backoffTime / 1000 / 60),
        });
        return;
      } else {
        // Clear quota error after backoff period
        this.lastQuotaError = null;
      }
    }

    this.logger.debug('Polling for scheduled content...');

    try {
      const scheduledVideos = await this.youtube.getScheduledContent(this.youtubeChannelId);
      this.lastSuccessfulScheduledPoll = Date.now();

      for (const video of scheduledVideos) {
        if (!this.contentStateManager.hasContent(video.id)) {
          await this.contentStateManager.addContent(video.id, {
            type: 'youtube_livestream',
            state: 'scheduled',
            source: 'api',
            publishedAt: video.publishedAt,
            url: `https://www.youtube.com/watch?v=${video.id}`,
            title: video.title,
            metadata: { scheduledStartTime: video.scheduledStartTime },
          });
        }
      }
      // Start or restart the live state polling after discovering new content
      this.startLiveStatePolling();

      this.logger.debug('Scheduled content polling completed', {
        foundVideos: scheduledVideos.length,
        newVideos: scheduledVideos.filter(v => !this.contentStateManager.hasContent(v.id)).length,
      });
    } catch (error) {
      // Check if this was a quota error
      if (error.message && error.message.includes('quota')) {
        this.lastQuotaError = Date.now();
        this.logger.warn('YouTube API quota exceeded during scheduled content polling - implementing 4 hour backoff', {
          nextAttemptTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        });
      } else {
        // Re-throw non-quota errors
        throw error;
      }
    }
  }

  /**
   * Starts the polling loop for checking state transitions of scheduled streams.
   */
  startLiveStatePolling() {
    if (this.liveStatePollTimerId) {
      // It's already running, no need to start another one
      return;
    }
    const loop = async () => {
      try {
        await this.pollLiveStateTransitions();
      } catch (error) {
        this.logger.error('Error in live state polling loop:', error);
      }

      const scheduledContent = this.contentStateManager.getContentByState('scheduled');
      if (this.isRunning && scheduledContent.length > 0) {
        this.liveStatePollTimerId = setTimeout(loop, this.liveStatePollInterval);
      } else {
        this.stopLiveStatePolling(); // No more scheduled content to check
      }
    };
    this.liveStatePollTimerId = setTimeout(loop, 1000); // Start immediately
    this.logger.info('Live state transition polling started', { interval: this.liveStatePollInterval });
  }

  /**
   * Stops the live state polling loop.
   */
  stopLiveStatePolling() {
    if (this.liveStatePollTimerId) {
      clearTimeout(this.liveStatePollTimerId);
      this.liveStatePollTimerId = null;
      this.logger.info('Live state transition polling stopped.');
    }
  }

  /**
   * Checks for state changes in scheduled content and processes them.
   */
  async pollLiveStateTransitions() {
    const scheduledContent = this.contentStateManager.getContentByState('scheduled');
    if (scheduledContent.length === 0) {
      this.logger.debug('No scheduled content to poll for state changes.');
      return;
    }

    this.logger.debug(`Polling state for ${scheduledContent.length} scheduled item(s)...`);
    const videoIds = scheduledContent.map(c => c.id);
    const currentStates = await this.youtube.checkScheduledContentStates(videoIds);

    for (const currentState of currentStates) {
      const oldState = this.contentStateManager.getContentState(currentState.id);
      if (oldState && oldState.state !== currentState.state) {
        this.logger.info(
          `State transition detected for ${currentState.id}: ${oldState.state} -> ${currentState.state}`
        );
        await this.livestreamStateMachine.transitionState(currentState.id, currentState.state);
      }
    }
  }
}
