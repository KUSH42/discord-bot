import { chromium } from 'playwright';
import { BrowserService } from '../interfaces/browser-service.js';

/**
 * Playwright-based browser service implementation
 * Provides browser automation capabilities using Playwright
 */
export class PlaywrightBrowserService extends BrowserService {
  constructor() {
    super();
    this.browser = null;
    this.page = null;
  }

  /**
   * Launch a browser instance
   * @param {Object} options - Browser launch options
   * @returns {Promise<void>}
   */
  async launch(options = {}) {
    // Check if browser is actually running and connected
    if (this.browser && this.browser.isConnected()) {
      throw new Error('Browser is already running');
    }

    // Clean up any disconnected browser references
    if (this.browser && !this.browser.isConnected()) {
      this.browser = null;
      this.page = null;
    }

    console.log('🔍 Launching browser with options:', JSON.stringify(options, null, 2));
    this.browser = await chromium.launch(options);
    console.log('🔍 Browser launched:', !!this.browser, 'Connected:', this.browser?.isConnected());

    this.page = await this.browser.newPage();
    console.log('🔍 Page created:', !!this.page, 'Closed:', this.page?.isClosed());

    // Verify browser and page are ready
    if (!this.browser || !this.page) {
      console.error('❌ Browser or page is null after launch:', { browser: !!this.browser, page: !!this.page });
      throw new Error('Failed to initialize browser or page after launch');
    }

    if (!this.browser.isConnected()) {
      throw new Error('Browser launched but not connected');
    }

    if (this.page.isClosed()) {
      throw new Error('Page was closed immediately after creation');
    }
  }

  /**
   * Create a new page
   * @returns {Promise<Object>} Page object
   */
  async newPage() {
    if (!this.browser) {
      throw new Error('Browser is not running');
    }
    this.page = await this.browser.newPage();
    return this.page;
  }

  /**
   * Navigate to a URL
   * @param {string} url - URL to navigate to
   * @param {Object} options - Navigation options
   * @returns {Promise<Object>} Response object
   */
  async goto(url, options = {}, retries = 3) {
    console.log('🔍 goto() called with URL:', url);
    console.log('🔍 Browser state:', {
      browser: !!this.browser,
      page: !!this.page,
      browserConnected: this.browser?.isConnected?.(),
      pageClosed: this.page?.isClosed?.(),
    });

    for (let i = 0; i < retries; i++) {
      // Validate browser state before each attempt
      if (!this.browser || !this.page) {
        console.error('❌ Browser or page not available at goto()');
        throw new Error(`Browser or page not available: browser=${!!this.browser}, page=${!!this.page}`);
      }

      // Check if browser is still connected
      if (!this.browser.isConnected()) {
        throw new Error('Browser connection lost');
      }

      // Check if page is closed
      if (this.page.isClosed()) {
        throw new Error('Page has been closed');
      }

      try {
        return await this.page.goto(url, options);
      } catch (error) {
        // Check if error is due to closed browser/page - don't retry these
        if (
          error.message.includes('Target page, context or browser has been closed') ||
          error.message.includes('Browser connection lost') ||
          error.message.includes('Page has been closed')
        ) {
          throw error;
        }

        if (i < retries - 1) {
          // Use setTimeout instead of page.waitForTimeout to avoid using potentially closed page
          await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Wait for a selector to appear
   * @param {string} selector - CSS selector
   * @param {Object} options - Wait options
   * @returns {Promise<Object>} Element handle
   */
  async waitForSelector(selector, options = {}) {
    if (!this.page) {
      throw new Error('No page available');
    }
    return await this.page.waitForSelector(selector, options);
  }

  /**
   * Wait for navigation to complete
   * @param {Object} options - Wait options
   * @returns {Promise<Object>} Response object
   */
  async waitForNavigation(options = {}) {
    if (!this.page) {
      throw new Error('No page available');
    }
    return await this.page.waitForNavigation(options);
  }

  /**
   * Execute JavaScript in the page context
   * @param {string|Function} script - JavaScript code or function
   * @param {...*} args - Arguments to pass to the function
   * @returns {Promise<*>} Result of the script execution
   */
  async evaluate(script, ...args) {
    if (!this.page) {
      throw new Error('No page available');
    }

    // Check if page is closed before attempting evaluation
    if (this.page.isClosed()) {
      throw new Error('Page is closed');
    }

    try {
      return await this.page.evaluate(script, ...args);
    } catch (error) {
      // Provide more context for common navigation-related errors
      if (error.message.includes('Execution context was destroyed')) {
        throw new Error(`Execution context was destroyed (likely due to navigation): ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Type text into an element
   * @param {string} selector - CSS selector
   * @param {string} text - Text to type
   * @param {Object} options - Type options
   * @returns {Promise<void>}
   */
  async type(selector, text, options = {}) {
    if (!this.page) {
      throw new Error('No page available');
    }
    await this.page.fill(selector, text, options);
  }

  /**
   * Click an element
   * @param {string} selector - CSS selector
   * @param {Object} options - Click options
   * @returns {Promise<void>}
   */
  async click(selector, options = {}) {
    if (!this.page) {
      throw new Error('No page available');
    }
    await this.page.click(selector, options);
  }

  /**
   * Get text content of an element
   * @param {string} selector - CSS selector
   * @returns {Promise<string>} Text content
   */
  async getTextContent(selector) {
    if (!this.page) {
      throw new Error('No page available');
    }
    return await this.page.textContent(selector);
  }

  /**
   * Get attribute value of an element
   * @param {string} selector - CSS selector
   * @param {string} attribute - Attribute name
   * @returns {Promise<string|null>} Attribute value
   */
  async getAttribute(selector, attribute) {
    if (!this.page) {
      throw new Error('No page available');
    }
    return await this.page.getAttribute(selector, attribute);
  }

  /**
   * Take a screenshot
   * @param {Object} options - Screenshot options
   * @returns {Promise<Buffer>} Screenshot buffer
   */
  async screenshot(options = {}) {
    if (!this.page) {
      throw new Error('No page available');
    }
    return await this.page.screenshot(options);
  }

  /**
   * Set cookies
   * @param {Array<Object>} cookies - Array of cookie objects
   * @returns {Promise<void>}
   */
  async setCookies(cookies) {
    if (!this.page) {
      throw new Error('No page available');
    }
    await this.page.context().addCookies(cookies);
  }

  /**
   * Get cookies
   * @param {Array<string>} urls - URLs to get cookies for (optional)
   * @returns {Promise<Array<Object>>} Array of cookie objects
   */
  async getCookies(urls = []) {
    if (!this.page) {
      throw new Error('No page available');
    }
    return await this.page.context().cookies(urls);
  }

  /**
   * Set user agent
   * @param {string} userAgent - User agent string
   * @returns {Promise<void>}
   */
  async setUserAgent(userAgent) {
    console.log('🔍 Setting user agent:', userAgent);
    if (!this.page) {
      console.error('❌ No page available for setUserAgent');
      throw new Error('No page available');
    }
    console.log('🔍 Page available, setting headers...');
    await this.page.setExtraHTTPHeaders({
      'User-Agent': userAgent,
    });
    console.log('✅ User agent set successfully');
  }

  /**
   * Set viewport size
   * @param {Object} viewport - Viewport dimensions
   * @returns {Promise<void>}
   */
  async setViewport(viewport) {
    if (!this.page) {
      throw new Error('No page available');
    }
    await this.page.setViewportSize(viewport);
  }

  /**
   * Wait for a specified amount of time
   * @param {number} ms - Milliseconds to wait
   * @returns {Promise<void>}
   */
  async waitFor(ms) {
    if (!this.page) {
      throw new Error('No page available');
    }
    await this.page.waitForTimeout(ms);
  }

  /**
   * Get page content/HTML
   * @returns {Promise<string>} Page HTML content
   */
  async getContent() {
    if (!this.page) {
      throw new Error('No page available');
    }
    return await this.page.content();
  }

  /**
   * Get current page URL
   * @returns {Promise<string>} Current URL
   */
  async getCurrentUrl() {
    if (!this.page) {
      throw new Error('No page available');
    }
    return this.page.url();
  }

  /**
   * Check if element exists
   * @param {string} selector - CSS selector
   * @returns {Promise<boolean>} True if element exists
   */
  async elementExists(selector) {
    if (!this.page) {
      throw new Error('No page available');
    }
    try {
      await this.page.waitForSelector(selector, { timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get multiple elements
   * @param {string} selector - CSS selector
   * @returns {Promise<Array<Object>>} Array of element handles
   */
  async getElements(selector) {
    if (!this.page) {
      throw new Error('No page available');
    }
    return await this.page.$$(selector);
  }

  /**
   * Close the current page
   * @returns {Promise<void>}
   */
  async closePage() {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
  }

  /**
   * Close the browser
   * @returns {Promise<void>}
   */
  async close() {
    // Close page first, with error handling for disconnected state
    if (this.page) {
      try {
        if (!this.page.isClosed()) {
          await this.page.close();
        }
      } catch (error) {
        // Ignore errors when page is already closed or disconnected
        if (
          !error.message.includes('Target page, context or browser has been closed') &&
          !error.message.includes('Browser connection lost')
        ) {
          throw error;
        }
      }
      this.page = null;
    }

    // Close browser with error handling for disconnected state
    if (this.browser) {
      try {
        if (this.browser.isConnected()) {
          await this.browser.close();
        }
      } catch (error) {
        // Ignore errors when browser is already closed or disconnected
        if (
          !error.message.includes('Target page, context or browser has been closed') &&
          !error.message.includes('Browser connection lost')
        ) {
          throw error;
        }
      }
      this.browser = null;
    }
  }

  /**
   * Check if browser is running
   * @returns {boolean} True if browser is running
   */
  isRunning() {
    return this.browser !== null;
  }

  /**
   * Check if browser and page are healthy and ready for use
   * @returns {boolean} True if browser is healthy
   */
  isHealthy() {
    try {
      return this.browser && this.browser.isConnected() && this.page && !this.page.isClosed();
    } catch {
      return false;
    }
  }
}
