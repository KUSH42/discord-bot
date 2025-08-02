/**
 * Abstract Browser service interface
 * Defines the contract for browser automation that can be mocked in tests
 */
export class BrowserService {
  /**
   * Launch a browser instance
   * @param {Object} options - Browser launch options
   * @returns {Promise<void>}
   */
  async launch(_options = {}) {
    throw new Error('Abstract method: launch must be implemented');
  }

  /**
   * Create a new page
   * @returns {Promise<Object>} Page object
   */
  async newPage() {
    throw new Error('Abstract method: newPage must be implemented');
  }

  /**
   * Navigate to a URL
   * @param {string} url - URL to navigate to
   * @param {Object} options - Navigation options
   * @returns {Promise<Object>} Response object
   */
  async goto(url, _options = {}) {
    throw new Error('Abstract method: goto must be implemented');
  }

  /**
   * Wait for a selector to appear
   * @param {string} selector - CSS selector
   * @param {Object} options - Wait options
   * @returns {Promise<Object>} Element handle
   */
  async waitForSelector(selector, _options = {}) {
    throw new Error('Abstract method: waitForSelector must be implemented');
  }

  /**
   * Wait for navigation to complete
   * @param {Object} options - Wait options
   * @returns {Promise<Object>} Response object
   */
  async waitForNavigation(_options = {}) {
    throw new Error('Abstract method: waitForNavigation must be implemented');
  }

  /**
   * Execute JavaScript in the page context
   * @param {string|Function} script - JavaScript code or function
   * @param {...*} args - Arguments to pass to the function
   * @returns {Promise<*>} Result of the script execution
   */
  async evaluate(_script, ..._args) {
    throw new Error('Abstract method: evaluate must be implemented');
  }

  /**
   * Type text into an element
   * @param {string} selector - CSS selector
   * @param {string} text - Text to type
   * @param {Object} options - Type options
   * @returns {Promise<void>}
   */
  async type(selector, text, _options = {}) {
    throw new Error('Abstract method: type must be implemented');
  }

  /**
   * Click an element
   * @param {string} selector - CSS selector
   * @param {Object} options - Click options
   * @returns {Promise<void>}
   */
  async click(selector, _options = {}) {
    throw new Error('Abstract method: click must be implemented');
  }

  /**
   * Get text content of an element
   * @param {string} selector - CSS selector
   * @returns {Promise<string>} Text content
   */
  async getTextContent(_selector) {
    throw new Error('Abstract method: getTextContent must be implemented');
  }

  /**
   * Get attribute value of an element
   * @param {string} selector - CSS selector
   * @param {string} attribute - Attribute name
   * @returns {Promise<string|null>} Attribute value
   */
  async getAttribute(_selector, _attribute) {
    throw new Error('Abstract method: getAttribute must be implemented');
  }

  /**
   * Take a screenshot
   * @param {Object} options - Screenshot options
   * @returns {Promise<Buffer>} Screenshot buffer
   */
  async screenshot(_options = {}) {
    throw new Error('Abstract method: screenshot must be implemented');
  }

  /**
   * Set cookies
   * @param {Array<Object>} cookies - Array of cookie objects
   * @returns {Promise<void>}
   */
  async setCookies(_cookies) {
    throw new Error('Abstract method: setCookies must be implemented');
  }

  /**
   * Get cookies
   * @param {Array<string>} urls - URLs to get cookies for (optional)
   * @returns {Promise<Array<Object>>} Array of cookie objects
   */
  async getCookies(_urls = []) {
    throw new Error('Abstract method: getCookies must be implemented');
  }

  /**
   * Set user agent
   * @param {string} userAgent - User agent string
   * @returns {Promise<void>}
   */
  async setUserAgent(_userAgent) {
    throw new Error('Abstract method: setUserAgent must be implemented');
  }

  /**
   * Set viewport size
   * @param {Object} viewport - Viewport dimensions
   * @returns {Promise<void>}
   */
  async setViewport(_viewport) {
    throw new Error('Abstract method: setViewport must be implemented');
  }

  /**
   * Wait for a specified amount of time
   * @param {number} ms - Milliseconds to wait
   * @returns {Promise<void>}
   */
  async waitFor(_ms) {
    throw new Error('Abstract method: waitFor must be implemented');
  }

  /**
   * Wait for a function to return truthy value
   * @param {Function} fn - Function to evaluate in page context
   * @param {Object} options - Wait options
   * @returns {Promise<*>} Function result
   */
  async waitForFunction(_fn, _options = {}) {
    throw new Error('Abstract method: waitForFunction must be implemented');
  }

  /**
   * Get page content/HTML
   * @returns {Promise<string>} Page HTML content
   */
  async getContent() {
    throw new Error('Abstract method: getContent must be implemented');
  }

  /**
   * Get current page URL
   * @returns {Promise<string>} Current URL
   */
  async getCurrentUrl() {
    throw new Error('Abstract method: getCurrentUrl must be implemented');
  }

  /**
   * Check if element exists
   * @param {string} selector - CSS selector
   * @returns {Promise<boolean>} True if element exists
   */
  async elementExists(_selector) {
    throw new Error('Abstract method: elementExists must be implemented');
  }

  /**
   * Get multiple elements
   * @param {string} selector - CSS selector
   * @returns {Promise<Array<Object>>} Array of element handles
   */
  async getElements(_selector) {
    throw new Error('Abstract method: getElements must be implemented');
  }

  /**
   * Close the current page
   * @returns {Promise<void>}
   */
  async closePage() {
    throw new Error('Abstract method: closePage must be implemented');
  }

  /**
   * Close the browser
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error('Abstract method: close must be implemented');
  }

  /**
   * Check if browser is running
   * @returns {boolean} True if browser is running
   */
  isRunning() {
    throw new Error('Abstract method: isRunning must be implemented');
  }

  /**
   * Dispose of resources
   * @returns {Promise<void>}
   */
  async dispose() {
    await this.close();
  }
}
