/**
 * Shared browser configuration for consistent browser launch options
 * Prevents duplication of browser arguments across different services
 *
 * Global Configuration:
 * - HEADLESS_BROWSER: Set to 'true' for headless mode, 'false' for GUI mode (default: 'false')
 */

/**
 * Safe browser arguments that avoid bot detection
 * These are tested to work without triggering anti-bot systems
 */
const SAFE_BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu',
  '--disable-images',
  '--disable-plugins',
  '--mute-audio',
];

/**
 * Arguments that should be avoided as they trigger bot detection
 */
const DANGEROUS_BROWSER_ARGS = ['--disable-web-security', '--disable-extensions', '--disable-ipc-flooding-protection'];

/**
 * Get the global headless browser setting from environment
 * @returns {boolean} True if browser should run headless, false for GUI mode
 */
function getGlobalHeadlessSetting() {
  const headlessEnv = process.env.HEADLESS_BROWSER;
  if (headlessEnv === undefined) {
    return false; // Default to GUI mode for better compatibility
  }
  return headlessEnv.toLowerCase() === 'true';
}

/**
 * Get standard browser configuration for X scraping
 * @param {Object} options - Additional options
 * @param {boolean} options.headless - Whether to run headless (overrides global HEADLESS_BROWSER setting)
 * @param {string[]} options.additionalArgs - Additional arguments to include
 * @returns {Object} Browser configuration object
 */
export function getXScrapingBrowserConfig(options = {}) {
  const config = {
    headless: options.headless ?? getGlobalHeadlessSetting(),
    args: [...SAFE_BROWSER_ARGS],
  };

  // Add display if running in headless environment
  // Skip display argument for true headless mode
  if (process.env.DISPLAY && !config.headless) {
    config.args.push(`--display=${process.env.DISPLAY}`);
  }

  // Add any additional args that were specifically requested
  if (options.additionalArgs?.length > 0) {
    config.args.push(...options.additionalArgs);
  }

  return config;
}

/**
 * Get standard browser configuration for YouTube scraping
 * @param {Object} options - Additional options
 * @param {boolean} options.headless - Whether to run headless (overrides global HEADLESS_BROWSER setting)
 * @param {string[]} options.additionalArgs - Additional arguments to include
 * @returns {Object} Browser configuration object
 */
export function getYouTubeScrapingBrowserConfig(options = {}) {
  const config = {
    headless: options.headless ?? getGlobalHeadlessSetting(),
    args: [...SAFE_BROWSER_ARGS],
  };

  // Add display if running in headless environment
  // Skip display argument for true headless mode
  if (process.env.DISPLAY && !config.headless) {
    config.args.push(`--display=${process.env.DISPLAY}`);
  }

  // Add any additional args that were specifically requested
  if (options.additionalArgs?.length > 0) {
    config.args.push(...options.additionalArgs);
  }

  return config;
}

/**
 * Get browser configuration for profile management (can be more permissive)
 * @param {Object} options - Additional options
 * @param {boolean} options.headless - Whether to run headless (overrides global HEADLESS_BROWSER setting)
 * @param {string} options.userDataDir - User data directory for profile
 * @param {string[]} options.additionalArgs - Additional arguments to include
 * @returns {Object} Browser configuration object
 */
export function getProfileBrowserConfig(options = {}) {
  const config = {
    headless: options.headless ?? getGlobalHeadlessSetting(),
    args: [...SAFE_BROWSER_ARGS],
  };

  if (options.userDataDir) {
    config.userDataDir = options.userDataDir;
  }

  // Add display if running in headless environment
  // Skip display argument for true headless mode
  if (process.env.DISPLAY && !config.headless) {
    config.args.push(`--display=${process.env.DISPLAY}`);
  }

  // Add any additional args that were specifically requested
  if (options.additionalArgs?.length > 0) {
    config.args.push(...options.additionalArgs);
  }

  return config;
}

/**
 * Validate browser arguments against known dangerous patterns
 * @param {string[]} args - Browser arguments to validate
 * @returns {Object} Validation result with warnings
 */
export function validateBrowserArgs(args) {
  const warnings = [];
  const dangerous = [];

  for (const arg of args) {
    if (DANGEROUS_BROWSER_ARGS.includes(arg)) {
      dangerous.push(arg);
      warnings.push(`Dangerous argument detected: ${arg} (may trigger bot detection)`);
    }
  }

  return {
    isValid: dangerous.length === 0,
    warnings,
    dangerousArgs: dangerous,
  };
}

export { SAFE_BROWSER_ARGS, DANGEROUS_BROWSER_ARGS, getGlobalHeadlessSetting };
