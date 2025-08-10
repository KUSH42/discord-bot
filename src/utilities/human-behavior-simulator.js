/**
 * Simulates human-like browser interaction patterns
 * Provides realistic mouse movements, scrolling, and reading behavior
 */
export class HumanBehaviorSimulator {
  constructor(page, logger) {
    this.page = page;
    this.logger = logger;
    this.mousePosition = { x: 0, y: 0 };

    // Configuration for behavior patterns
    this.config = {
      // Reading speed: words per minute (average human reading speed)
      readingWPM: parseInt(process.env.HUMAN_READING_WPM) || 200,

      // Mouse movement configuration
      mouseMovements: {
        enabled: process.env.MOUSE_MOVEMENT_ENABLED !== 'false',
        minMovements: 2,
        maxMovements: 6,
        stepVariation: 2, // pixels
      },

      // Scrolling configuration
      scrolling: {
        enabled: process.env.SCROLLING_SIMULATION_ENABLED !== 'false',
        probability: 0.7, // 70% chance to scroll
        minScrolls: 1,
        maxScrolls: 4,
        minScrollAmount: 100,
        maxScrollAmount: 500,
      },

      // Reading behavior configuration
      reading: {
        enabled: process.env.READING_TIME_SIMULATION !== 'false',
        charactersPerWord: 5, // Average characters per word
        comprehensionFactor: 0.3, // Factor for reading time variation (0.1-0.8 of estimated time)
        minReadingTime: 2000, // Minimum reading time in ms
      },
    };

    this.logger?.debug('HumanBehaviorSimulator initialized', {
      config: this.config,
    });
  }

  /**
   * Simulate realistic page loading with human-like behavior
   * @param {string} url - URL to navigate to
   * @param {Object} options - Navigation options
   * @returns {Promise<Object>} Navigation response
   */
  async simulateRealisticPageLoad(url, options = {}) {
    const operation = this.logger?.startOperation?.('simulateRealisticPageLoad', { url, options }) || {};

    try {
      // Random pre-navigation delay (human thinking time)
      const preDelay = this.randomDelay(500, 2000);
      operation.progress?.(`Pre-navigation delay: ${preDelay}ms`);
      await new Promise(resolve => setTimeout(resolve, preDelay));

      // Navigate to page
      operation.progress?.('Navigating to page');
      const response = await this.page.goto(url, {
        waitUntil: 'networkidle0',
        timeout: 30000,
        ...options,
      });

      // Post-navigation human behavior simulation
      await this.simulatePostNavigationBehavior();

      operation.success?.('Realistic page load completed');
      return response;
    } catch (error) {
      operation.error?.(error, 'Failed to simulate realistic page load');
      throw error;
    }
  }

  /**
   * Simulate post-navigation human behavior
   * @private
   */
  async simulatePostNavigationBehavior() {
    // Wait for page to be fully loaded
    await this.page.waitForLoadState('networkidle');

    // Simulate reading time (should happen first)
    if (this.config.reading.enabled) {
      await this.simulateReadingBehavior();
    }

    // Random mouse movements during/after reading
    if (this.config.mouseMovements.enabled) {
      await this.simulateMouseMovements();
    }

    // Occasional scrolling behavior
    if (this.config.scrolling.enabled && Math.random() < this.config.scrolling.probability) {
      await this.simulateScrolling();
    }
  }

  /**
   * Simulate human-like mouse movements
   * @returns {Promise<void>}
   */
  async simulateMouseMovements() {
    const movements =
      Math.floor(
        Math.random() * (this.config.mouseMovements.maxMovements - this.config.mouseMovements.minMovements + 1)
      ) + this.config.mouseMovements.minMovements;

    this.logger?.debug('Simulating mouse movements', { movements });

    for (let i = 0; i < movements; i++) {
      const targetX = Math.floor(Math.random() * 1200) + 100;
      const targetY = Math.floor(Math.random() * 800) + 100;

      await this.smoothMouseMove(targetX, targetY);

      // Pause between movements (human-like)
      const pauseTime = this.randomDelay(200, 800);
      await new Promise(resolve => setTimeout(resolve, pauseTime));
    }
  }

  /**
   * Perform smooth, bezier-curve-like mouse movement
   * @param {number} targetX - Target X coordinate
   * @param {number} targetY - Target Y coordinate
   * @returns {Promise<void>}
   */
  async smoothMouseMove(targetX, targetY) {
    const steps = Math.floor(Math.random() * 10) + 5; // 5-14 steps
    const deltaX = (targetX - this.mousePosition.x) / steps;
    const deltaY = (targetY - this.mousePosition.y) / steps;

    for (let i = 0; i < steps; i++) {
      // Add some randomness to make movement more natural
      const randomVarianceX = (Math.random() - 0.5) * this.config.mouseMovements.stepVariation;
      const randomVarianceY = (Math.random() - 0.5) * this.config.mouseMovements.stepVariation;

      this.mousePosition.x += deltaX + randomVarianceX;
      this.mousePosition.y += deltaY + randomVarianceY;

      // Ensure coordinates stay within reasonable bounds
      this.mousePosition.x = Math.max(0, Math.min(1920, this.mousePosition.x));
      this.mousePosition.y = Math.max(0, Math.min(1080, this.mousePosition.y));

      try {
        await this.page.mouse.move(this.mousePosition.x, this.mousePosition.y);
      } catch (error) {
        // If page is closed or unavailable, stop mouse movement
        if (error.message.includes('Target page') || error.message.includes('closed')) {
          this.logger?.debug('Page unavailable during mouse movement, stopping');
          break;
        }
        throw error;
      }

      // Small delay between movement steps
      await new Promise(resolve => setTimeout(resolve, this.randomDelay(10, 50)));
    }
  }

  /**
   * Simulate human-like scrolling behavior
   * @returns {Promise<void>}
   */
  async simulateScrolling() {
    const scrolls =
      Math.floor(Math.random() * (this.config.scrolling.maxScrolls - this.config.scrolling.minScrolls + 1)) +
      this.config.scrolling.minScrolls;

    this.logger?.debug('Simulating scrolling behavior', { scrolls });

    for (let i = 0; i < scrolls; i++) {
      const scrollAmount =
        Math.floor(
          Math.random() * (this.config.scrolling.maxScrollAmount - this.config.scrolling.minScrollAmount + 1)
        ) + this.config.scrolling.minScrollAmount;

      try {
        await this.page.evaluate(amount => {
          window.scrollBy(0, amount); // eslint-disable-line no-undef
        }, scrollAmount);
      } catch (error) {
        // If page is closed or unavailable, stop scrolling
        if (error.message.includes('Target page') || error.message.includes('closed')) {
          this.logger?.debug('Page unavailable during scrolling, stopping');
          break;
        }
        throw error;
      }

      // Reading pause after scroll (humans read after scrolling)
      const readingPause = this.randomDelay(750, 2500);
      await new Promise(resolve => setTimeout(resolve, readingPause));
    }
  }

  /**
   * Simulate reading behavior based on page content
   * @returns {Promise<void>}
   */
  async simulateReadingBehavior() {
    try {
      // Get page content to estimate reading time
      /* eslint-disable no-undef */
      const textContent = await this.page.evaluate(() => {
        return document.body ? document.body.innerText.length : 0;
      });
      /* eslint-enable no-undef */

      // Estimate reading time based on content length
      const estimatedReadingTime = this.calculateReadingTime(textContent);

      // Apply comprehension factor and add randomness
      const minTime = estimatedReadingTime * this.config.reading.comprehensionFactor;
      const maxTime = estimatedReadingTime * (this.config.reading.comprehensionFactor + 0.5);
      const actualReadingTime = Math.max(this.config.reading.minReadingTime, this.randomDelay(minTime, maxTime));

      this.logger?.debug('Simulating reading behavior', {
        textLength: textContent,
        estimatedReadingTime,
        actualReadingTime,
      });

      await new Promise(resolve => setTimeout(resolve, actualReadingTime));
    } catch (error) {
      // If we can't get page content, use minimum reading time
      this.logger?.debug('Could not analyze page content, using minimum reading time', {
        error: error.message,
      });

      await new Promise(resolve => setTimeout(resolve, this.config.reading.minReadingTime));
    }
  }

  /**
   * Calculate estimated reading time based on content length
   * @param {number} textLength - Length of text content
   * @returns {number} Estimated reading time in milliseconds
   */
  calculateReadingTime(textLength) {
    // Calculate words (assuming average characters per word)
    const wordCount = Math.max(1, textLength / this.config.reading.charactersPerWord);

    // Calculate reading time in milliseconds
    const readingTimeMs = (wordCount / this.config.reading.readingWPM) * 60 * 1000;

    return readingTimeMs;
  }

  /**
   * Generate random delay between min and max values
   * @param {number} min - Minimum delay in milliseconds
   * @param {number} max - Maximum delay in milliseconds
   * @returns {number} Random delay value
   */
  randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Simulate typing with human-like characteristics
   * @param {string} selector - CSS selector for input element
   * @param {string} text - Text to type
   * @param {Object} options - Typing options
   * @returns {Promise<void>}
   */
  async simulateHumanTyping(selector, text, options = {}) {
    const { minDelay = 50, maxDelay = 150, mistakes = false, mistakeProbability = 0.02 } = options;

    this.logger?.debug('Simulating human typing', {
      selector,
      textLength: text.length,
      mistakes,
    });

    // Focus on the element first
    await this.page.focus(selector);

    // Clear any existing content
    await this.page.fill(selector, '');

    let currentText = '';

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Simulate typing mistakes occasionally
      if (mistakes && Math.random() < mistakeProbability && i > 0) {
        // Type a wrong character
        const wrongChar = String.fromCharCode(char.charCodeAt(0) + 1);
        await this.page.type(selector, wrongChar, { delay: this.randomDelay(minDelay, maxDelay) });

        // Pause (human realizes mistake)
        await new Promise(resolve => setTimeout(resolve, this.randomDelay(200, 500)));

        // Backspace to correct
        await this.page.press(selector, 'Backspace');
        await new Promise(resolve => setTimeout(resolve, this.randomDelay(100, 200)));
      }

      // Type the correct character
      await this.page.type(selector, char, { delay: this.randomDelay(minDelay, maxDelay) });
      // Track current text for debugging if needed
      currentText += char;

      // Occasional longer pauses (thinking time)
      if (Math.random() < 0.1) {
        await new Promise(resolve => setTimeout(resolve, this.randomDelay(300, 800)));
      }
    }

    // Log completion for debugging
    this.logger?.debug('Human typing completed', {
      targetLength: text.length,
      actualLength: currentText.length,
    });
  }

  /**
   * Simulate human-like clicking with slight delays and movement
   * @param {string} selector - CSS selector for element to click
   * @param {Object} options - Click options
   * @returns {Promise<void>}
   */
  async simulateHumanClick(selector, options = {}) {
    const { preClickDelay = true, postClickDelay = true } = options;

    this.logger?.debug('Simulating human click', { selector });

    // Pre-click behavior: move mouse to element area
    if (preClickDelay) {
      // Get element bounding box
      const elementBox = await this.page.locator(selector).boundingBox();

      if (elementBox) {
        // Move mouse to random point within element
        const targetX = elementBox.x + Math.random() * elementBox.width;
        const targetY = elementBox.y + Math.random() * elementBox.height;

        await this.smoothMouseMove(targetX, targetY);

        // Small delay before clicking (human hesitation)
        await new Promise(resolve => setTimeout(resolve, this.randomDelay(100, 300)));
      }
    }

    // Perform the click
    await this.page.click(selector, options);

    // Post-click delay (human processing time)
    if (postClickDelay) {
      await new Promise(resolve => setTimeout(resolve, this.randomDelay(200, 500)));
    }
  }

  /**
   * Get current behavior configuration
   * @returns {Object} Current configuration
   */
  getConfiguration() {
    return {
      ...this.config,
      mousePosition: { ...this.mousePosition },
    };
  }

  /**
   * Update behavior configuration
   * @param {Object} newConfig - New configuration options
   */
  updateConfiguration(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
    };

    this.logger?.info('HumanBehaviorSimulator configuration updated', {
      newConfig: this.config,
    });
  }
}
