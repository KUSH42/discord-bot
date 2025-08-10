import { nowUTC } from '../utilities/utc-time.js';

/**
 * Livestream State Machine
 * Manages proper tracking of livestream state transitions
 * Handles scheduled -> live -> ended states with proper announcements
 */
export class LivestreamStateMachine {
  constructor(contentStateManager, contentAnnouncer, logger) {
    this.contentStateManager = contentStateManager;
    this.contentAnnouncer = contentAnnouncer;
    this.logger = logger;

    // Define valid states and their transitions
    this.states = ['scheduled', 'live', 'ended', 'cancelled', 'published'];

    this.transitions = {
      scheduled: ['live', 'cancelled'],
      live: ['ended'],
      ended: ['published'], // When live stream is processed into regular video
      cancelled: [], // Terminal state
      published: [], // Terminal state
    };

    // Track active polling for state changes
    this.activePolling = new Map(); // videoId -> intervalId
    this.transitionCallbacks = new Map(); // videoId -> callback functions
  }

  /**
   * Attempt state transition for content
   * @param {string} videoId - Video ID to transition
   * @param {string} newState - Target state
   * @param {Object} [metadata] - Additional metadata for the transition
   * @returns {boolean} True if transition was successful
   */
  async transitionState(videoId, newState, metadata = {}) {
    if (!this.states.includes(newState)) {
      this.logger.warn('Invalid livestream state', { videoId, newState, validStates: this.states });
      return false;
    }

    const currentState = this.contentStateManager.getContentState(videoId);

    if (!currentState) {
      this.logger.warn('Cannot transition unknown content', { videoId, newState });
      return false;
    }

    const currentStateName = currentState.state;

    // Check if transition is valid
    if (!this.isValidTransition(currentStateName, newState)) {
      this.logger.warn('Invalid state transition attempted', {
        videoId,
        from: currentStateName,
        to: newState,
        allowedTransitions: this.transitions[currentStateName],
      });
      return false;
    }

    // Perform the transition
    try {
      await this.contentStateManager.updateContentState(videoId, {
        state: newState,
        stateTransitionTime: nowUTC(),
        transitionMetadata: metadata,
      });

      this.logger.info('Livestream state transition successful', {
        videoId,
        from: currentStateName,
        to: newState,
        title: currentState.title || 'Unknown',
      });

      // Handle transition-specific logic
      await this.handleStateTransition(videoId, currentStateName, newState, currentState);

      return true;
    } catch (error) {
      this.logger.error('Failed to transition livestream state', {
        videoId,
        from: currentStateName,
        to: newState,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Check if transition from one state to another is valid
   * @param {string} fromState - Current state
   * @param {string} toState - Target state
   * @returns {boolean} True if transition is valid
   */
  isValidTransition(fromState, toState) {
    if (!fromState || !toState) {
      return false;
    }

    const allowedTransitions = this.transitions[fromState];
    return Array.isArray(allowedTransitions) && allowedTransitions.includes(toState);
  }

  /**
   * Handle specific logic for state transitions
   * @param {string} videoId - Video ID
   * @param {string} fromState - Previous state
   * @param {string} toState - New state
   * @param {Object} contentState - Current content state
   */
  async handleStateTransition(videoId, fromState, toState, contentState) {
    switch (toState) {
      case 'live':
        await this.handleLiveTransition(videoId, contentState);
        break;

      case 'ended':
        await this.handleEndedTransition(videoId, contentState);
        break;

      case 'cancelled':
        await this.handleCancelledTransition(videoId, contentState);
        break;

      case 'published':
        await this.handlePublishedTransition(videoId, contentState);
        break;

      default:
        this.logger.debug('No special handling for state transition', {
          videoId,
          fromState,
          toState,
        });
    }
  }

  /**
   * Handle transition to live state
   * @param {string} videoId - Video ID
   * @param {Object} contentState - Content state
   */
  async handleLiveTransition(videoId, contentState) {
    // Announce that livestream has started (if not already announced)
    if (!contentState.announced) {
      try {
        const announcementData = {
          type: 'youtube_livestream',
          videoId,
          url: contentState.url || `https://www.youtube.com/watch?v=${videoId}`,
          title: contentState.title || 'Live Stream',
          state: 'live',
          isLive: true,
        };

        await this.contentAnnouncer.announce(announcementData);

        // Mark as announced
        await this.contentStateManager.markAsAnnounced(videoId);

        this.logger.info('Livestream start announced', {
          videoId,
          title: contentState.title,
        });
      } catch (error) {
        this.logger.error('Failed to announce livestream start', {
          videoId,
          error: error.message,
        });
      }
    }

    // Start monitoring for end of stream
    this.startStatePolling(videoId, 'ended');
  }

  /**
   * Handle transition to ended state
   * @param {string} videoId - Video ID
   * @param {Object} contentState - Content state
   */
  async handleEndedTransition(videoId, contentState) {
    // Stop any active polling for this video
    this.stopStatePolling(videoId);

    // Optional: Announce that stream has ended (if configured)
    const shouldAnnounceEnd = false; // Usually we don't announce stream endings

    if (shouldAnnounceEnd) {
      try {
        const announcementData = {
          type: 'youtube_livestream_ended',
          videoId,
          url: contentState.url || `https://www.youtube.com/watch?v=${videoId}`,
          title: contentState.title || 'Live Stream',
          state: 'ended',
          isLive: false,
        };

        await this.contentAnnouncer.announce(announcementData);

        this.logger.info('Livestream end announced', {
          videoId,
          title: contentState.title,
        });
      } catch (error) {
        this.logger.error('Failed to announce livestream end', {
          videoId,
          error: error.message,
        });
      }
    }

    // Start monitoring for transition to published (when VOD becomes available)
    setTimeout(() => {
      this.startStatePolling(videoId, 'published');
    }, 60000); // Wait 1 minute before checking for VOD
  }

  /**
   * Handle transition to cancelled state
   * @param {string} videoId - Video ID
   * @param {Object} contentState - Content state
   */
  async handleCancelledTransition(videoId, contentState) {
    // Stop any active polling
    this.stopStatePolling(videoId);

    this.logger.info('Livestream cancelled', {
      videoId,
      title: contentState.title,
    });

    // Optional: Could announce cancellation if desired
  }

  /**
   * Handle transition to published state
   * @param {string} videoId - Video ID
   * @param {Object} contentState - Content state
   */
  async handlePublishedTransition(videoId, contentState) {
    // Stop any active polling
    this.stopStatePolling(videoId);

    // The VOD is now available - could announce if it wasn't already announced as live
    if (!contentState.announced) {
      try {
        const announcementData = {
          type: 'youtube_video',
          videoId,
          url: contentState.url || `https://www.youtube.com/watch?v=${videoId}`,
          title: contentState.title || 'Video',
          state: 'published',
          isLive: false,
          wasLivestream: true,
        };

        await this.contentAnnouncer.announce(announcementData);
        await this.contentStateManager.markAsAnnounced(videoId);

        this.logger.info('Livestream VOD announced', {
          videoId,
          title: contentState.title,
        });
      } catch (error) {
        this.logger.error('Failed to announce livestream VOD', {
          videoId,
          error: error.message,
        });
      }
    }
  }

  /**
   * Start polling for state changes
   * @param {string} videoId - Video ID to poll
   * @param {string} expectedState - State we're waiting for
   * @param {number} [interval] - Polling interval in ms
   */
  startStatePolling(videoId, expectedState, interval = 30000) {
    // Stop existing polling first
    this.stopStatePolling(videoId);

    this.logger.debug('Starting state polling', { videoId, expectedState, interval });

    const pollFunction = async () => {
      try {
        const currentState = await this.checkVideoState(videoId);

        if (currentState && currentState !== this.getCurrentState(videoId)) {
          this.logger.debug('State change detected via polling', {
            videoId,
            oldState: this.getCurrentState(videoId),
            newState: currentState,
          });

          // Attempt transition
          await this.transitionState(videoId, currentState, {
            detectionMethod: 'polling',
          });
        }
      } catch (error) {
        this.logger.error('State polling error', {
          videoId,
          expectedState,
          error: error.message,
        });

        // Stop polling on repeated errors
        this.stopStatePolling(videoId);
      }
    };

    // Start polling
    const intervalId = setInterval(pollFunction, interval);
    this.activePolling.set(videoId, intervalId);

    // Set timeout to prevent infinite polling
    setTimeout(
      () => {
        this.stopStatePolling(videoId);
      },
      6 * 60 * 60 * 1000
    ); // Stop after 6 hours
  }

  /**
   * Stop state polling for a video
   * @param {string} videoId - Video ID
   */
  stopStatePolling(videoId) {
    const intervalId = this.activePolling.get(videoId);

    if (intervalId) {
      clearInterval(intervalId);
      this.activePolling.delete(videoId);

      this.logger.debug('Stopped state polling', { videoId });
    }
  }

  /**
   * Get current state of content
   * @param {string} videoId - Video ID
   * @returns {string|null} Current state or null if not found
   */
  getCurrentState(videoId) {
    const contentState = this.contentStateManager.getContentState(videoId);
    return contentState ? contentState.state : null;
  }

  /**
   * Check video state using external service (to be implemented with YouTube API)
   * This is a placeholder that should be connected to actual YouTube API checking
   * @param {string} videoId - Video ID to check
   * @returns {Promise<string|null>} Current video state or null if unknown
   */
  async checkVideoState(videoId) {
    // This should be implemented to call YouTube API and determine actual state
    // For now, return null to indicate "unknown"
    this.logger.debug('State checking not yet implemented', { videoId });
    return null;
  }

  /**
   * Add callback for state transitions
   * @param {string} videoId - Video ID
   * @param {Function} callback - Callback function
   */
  addTransitionCallback(videoId, callback) {
    if (!this.transitionCallbacks.has(videoId)) {
      this.transitionCallbacks.set(videoId, []);
    }

    this.transitionCallbacks.get(videoId).push(callback);
  }

  /**
   * Remove all callbacks for a video
   * @param {string} videoId - Video ID
   */
  removeTransitionCallbacks(videoId) {
    this.transitionCallbacks.delete(videoId);
  }

  /**
   * Execute callbacks for state transition
   * @param {string} videoId - Video ID
   * @param {string} fromState - Previous state
   * @param {string} toState - New state
   */
  async executeTransitionCallbacks(videoId, fromState, toState) {
    const callbacks = this.transitionCallbacks.get(videoId);

    if (callbacks && callbacks.length > 0) {
      for (const callback of callbacks) {
        try {
          await callback(videoId, fromState, toState);
        } catch (error) {
          this.logger.error('Transition callback failed', {
            videoId,
            fromState,
            toState,
            error: error.message,
          });
        }
      }
    }
  }

  /**
   * Get statistics about active state management
   * @returns {Object} Statistics object
   */
  getStats() {
    const liveContent = this.contentStateManager.getContentByState('live');
    const scheduledContent = this.contentStateManager.getContentByState('scheduled');
    const endedContent = this.contentStateManager.getContentByState('ended');

    return {
      activePolling: this.activePolling.size,
      activeCallbacks: this.transitionCallbacks.size,
      contentByState: {
        live: liveContent.length,
        scheduled: scheduledContent.length,
        ended: endedContent.length,
      },
      validStates: this.states,
      validTransitions: this.transitions,
    };
  }

  /**
   * Clean up resources and stop all polling
   */
  async destroy() {
    // Stop all active polling
    for (const videoId of this.activePolling.keys()) {
      this.stopStatePolling(videoId);
    }

    // Clear callbacks
    this.transitionCallbacks.clear();

    this.logger.info('Livestream state machine destroyed');
  }
}
