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
    if (this.browser) {
      throw new Error('Browser is already running');
    }

    this.browser = await chromium.launch(options);
    this.page = await this.browser.newPage();
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
  async goto(url, options = {}) {
    if (!this.page) {
      throw new Error('No page available');
    }
    return await this.page.goto(url, options);
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
    return await this.page.evaluate(script, ...args);
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
    if (!this.page) {
      throw new Error('No page available');
    }
    await this.page.setExtraHTTPHeaders({
      'User-Agent': userAgent
    });
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
    } catch (error) {
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
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close();
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
}