import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Manages browser profiles for persistent session state
 * Provides cookie storage, localStorage persistence, and profile isolation
 */
export class BrowserProfileManager {
  constructor(profileDir, logger) {
    this.profileDir = profileDir || path.join(__dirname, '../../browser_profiles');
    this.logger = logger;
    this.currentProfile = null;

    // Ensure base profile directory exists
    this.ensureDirectoryExists(this.profileDir);

    this.logger?.info('BrowserProfileManager initialized', {
      profileDir: this.profileDir,
    });
  }

  /**
   * Create or load a browser profile
   * @param {string} profileId - Unique identifier for the profile
   * @returns {Promise<Object>} Profile configuration object
   */
  async createOrLoadProfile(profileId) {
    if (!profileId || typeof profileId !== 'string') {
      throw new Error('Profile ID must be a non-empty string');
    }

    const profilePath = path.join(this.profileDir, profileId);

    // Ensure profile directory exists
    this.ensureDirectoryExists(profilePath);

    this.currentProfile = {
      id: profileId,
      path: profilePath,
      userDataDir: path.join(profilePath, 'user_data'),
      cookies: path.join(profilePath, 'cookies.json'),
      localStorage: path.join(profilePath, 'localStorage.json'),
      sessionStorage: path.join(profilePath, 'sessionStorage.json'),
      preferences: path.join(profilePath, 'preferences.json'),
      metadata: path.join(profilePath, 'metadata.json'),
    };

    // Ensure subdirectories exist
    this.ensureDirectoryExists(this.currentProfile.userDataDir);

    // Load or create metadata
    await this.loadOrCreateMetadata();

    this.logger?.info('Profile created/loaded', {
      profileId,
      profilePath,
      exists: await this.profileExists(profileId),
    });

    return this.currentProfile;
  }

  /**
   * Get browser launch options for the current profile
   * @param {string} userAgent - User agent string to use
   * @param {Object} additionalOptions - Additional browser options
   * @returns {Object} Browser launch options (without userDataDir for browserType.launch)
   */
  async getBrowserLaunchOptions(userAgent, additionalOptions = {}) {
    if (!this.currentProfile) {
      throw new Error('No profile loaded. Call createOrLoadProfile first.');
    }

    const stealthArgs = [
      // Core stealth features
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
      '--exclude-switches=enable-automation',
      '--disable-component-extensions-with-background-pages',

      // Fingerprinting resistance
      '--disable-client-side-phishing-detection',
      '--disable-sync',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',

      // Performance optimization
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--run-all-compositor-stages-before-draw',

      // Basic browser flags
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--disable-gpu',
      '--disable-images',
      '--disable-plugins',
      '--mute-audio',

      // User agent
      `--user-agent=${userAgent}`,
    ];

    const defaultOptions = {
      headless: false, // Stealth mode requires headful browser
      args: stealthArgs,
      ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=AutomationControlled'],
      ...additionalOptions,
    };

    this.logger?.debug('Browser launch options prepared', {
      profileId: this.currentProfile.id,
      userAgent,
      headless: defaultOptions.headless,
    });

    return defaultOptions;
  }

  /**
   * Get persistent context launch options for the current profile
   * @param {string} userAgent - User agent string to use
   * @param {Object} additionalOptions - Additional context options
   * @returns {Object} Persistent context launch options
   */
  async getPersistentContextOptions(userAgent, additionalOptions = {}) {
    if (!this.currentProfile) {
      throw new Error('No profile loaded. Call createOrLoadProfile first.');
    }

    const stealthArgs = [
      // Core stealth features
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
      '--exclude-switches=enable-automation',
      '--disable-component-extensions-with-background-pages',

      // Fingerprinting resistance
      '--disable-client-side-phishing-detection',
      '--disable-sync',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',

      // Performance optimization
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--run-all-compositor-stages-before-draw',

      // Basic browser flags
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--disable-gpu',
      '--disable-images',
      '--disable-plugins',
      '--mute-audio',

      // User agent
      `--user-agent=${userAgent}`,
    ];

    const contextOptions = {
      userAgent,
      viewport: null, // Will be set by UserAgentManager
      locale: 'en-US',
      colorScheme: 'light',
      geolocation: { longitude: -74.006, latitude: 40.7128 }, // New York
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      ...additionalOptions,
    };

    const launchOptions = {
      headless: false,
      args: stealthArgs,
      ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=AutomationControlled'],
    };

    this.logger?.debug('Persistent context options prepared', {
      profileId: this.currentProfile.id,
      userAgent,
      userDataDir: this.currentProfile.userDataDir,
      headless: launchOptions.headless,
    });

    return {
      userDataDir: this.currentProfile.userDataDir,
      contextOptions,
      launchOptions,
    };
  }

  /**
   * Save current browser session state
   * @param {Object} page - Playwright page object
   * @returns {Promise<void>}
   */
  async saveSession(page) {
    if (!this.currentProfile) {
      throw new Error('No profile loaded');
    }

    const operation =
      this.logger?.startOperation?.('saveSession', {
        profileId: this.currentProfile.id,
      }) || {};

    try {
      operation.progress?.('Saving cookies');
      await this.saveCookies(page);

      operation.progress?.('Saving localStorage');
      await this.saveLocalStorage(page);

      operation.progress?.('Saving sessionStorage');
      await this.saveSessionStorage(page);

      operation.progress?.('Updating metadata');
      await this.updateMetadata();

      operation.success?.('Browser session saved successfully');
    } catch (error) {
      operation.error?.(error, 'Failed to save browser session');
      throw error;
    }
  }

  /**
   * Restore browser session state
   * @param {Object} page - Playwright page object
   * @returns {Promise<void>}
   */
  async restoreSession(page) {
    if (!this.currentProfile) {
      throw new Error('No profile loaded');
    }

    const operation =
      this.logger?.startOperation?.('restoreSession', {
        profileId: this.currentProfile.id,
      }) || {};

    try {
      operation.progress?.('Restoring cookies');
      await this.restoreCookies(page);

      operation.progress?.('Restoring localStorage');
      await this.restoreLocalStorage(page);

      operation.progress?.('Restoring sessionStorage');
      await this.restoreSessionStorage(page);

      operation.success?.('Browser session restored successfully');
    } catch (error) {
      operation.error?.(error, 'Failed to restore browser session');
      throw error;
    }
  }

  /**
   * Save cookies to profile
   * @param {Object} page - Playwright page object
   * @private
   */
  async saveCookies(page) {
    try {
      const cookies = await page.context().cookies();
      await fs.promises.writeFile(this.currentProfile.cookies, JSON.stringify(cookies, null, 2), 'utf8');

      this.logger?.debug('Cookies saved', {
        profileId: this.currentProfile.id,
        cookieCount: cookies.length,
      });
    } catch (error) {
      this.logger?.error('Failed to save cookies', {
        error: error.message,
        profileId: this.currentProfile.id,
      });
      throw error;
    }
  }

  /**
   * Restore cookies from profile
   * @param {Object} page - Playwright page object
   * @private
   */
  async restoreCookies(page) {
    try {
      if (fs.existsSync(this.currentProfile.cookies)) {
        const cookiesData = await fs.promises.readFile(this.currentProfile.cookies, 'utf8');
        const cookies = JSON.parse(cookiesData);

        if (Array.isArray(cookies) && cookies.length > 0) {
          await page.context().addCookies(cookies);

          this.logger?.debug('Cookies restored', {
            profileId: this.currentProfile.id,
            cookieCount: cookies.length,
          });
        }
      }
    } catch (error) {
      this.logger?.warn('Failed to restore cookies', {
        error: error.message,
        profileId: this.currentProfile.id,
      });
      // Don't throw - cookies restore failure shouldn't break session restore
    }
  }

  /**
   * Save localStorage to profile
   * @param {Object} page - Playwright page object
   * @private
   */
  async saveLocalStorage(page) {
    try {
      const localStorage = await page.evaluate(() => {
        const items = {};
        /* eslint-disable no-undef */
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key) {
            items[key] = window.localStorage.getItem(key);
          }
        }
        /* eslint-enable no-undef */
        return items;
      });

      await fs.promises.writeFile(this.currentProfile.localStorage, JSON.stringify(localStorage, null, 2), 'utf8');

      this.logger?.debug('localStorage saved', {
        profileId: this.currentProfile.id,
        itemCount: Object.keys(localStorage).length,
      });
    } catch (error) {
      this.logger?.error('Failed to save localStorage', {
        error: error.message,
        profileId: this.currentProfile.id,
      });
      throw error;
    }
  }

  /**
   * Restore localStorage from profile
   * @param {Object} page - Playwright page object
   * @private
   */
  async restoreLocalStorage(page) {
    try {
      if (fs.existsSync(this.currentProfile.localStorage)) {
        const localStorageData = await fs.promises.readFile(this.currentProfile.localStorage, 'utf8');
        const localStorage = JSON.parse(localStorageData);

        if (typeof localStorage === 'object' && localStorage !== null) {
          await page.evaluate(items => {
            for (const [key, value] of Object.entries(items)) {
              try {
                // eslint-disable-next-line no-undef
                window.localStorage.setItem(key, value);
              } catch (e) {
                console.warn('Failed to restore localStorage item:', key, e);
              }
            }
          }, localStorage);

          this.logger?.debug('localStorage restored', {
            profileId: this.currentProfile.id,
            itemCount: Object.keys(localStorage).length,
          });
        }
      }
    } catch (error) {
      this.logger?.warn('Failed to restore localStorage', {
        error: error.message,
        profileId: this.currentProfile.id,
      });
      // Don't throw - localStorage restore failure shouldn't break session restore
    }
  }

  /**
   * Save sessionStorage to profile
   * @param {Object} page - Playwright page object
   * @private
   */
  async saveSessionStorage(page) {
    try {
      const sessionStorage = await page.evaluate(() => {
        const items = {};
        /* eslint-disable no-undef */
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i);
          if (key) {
            items[key] = window.sessionStorage.getItem(key);
          }
        }
        /* eslint-enable no-undef */
        return items;
      });

      await fs.promises.writeFile(this.currentProfile.sessionStorage, JSON.stringify(sessionStorage, null, 2), 'utf8');

      this.logger?.debug('sessionStorage saved', {
        profileId: this.currentProfile.id,
        itemCount: Object.keys(sessionStorage).length,
      });
    } catch (error) {
      this.logger?.error('Failed to save sessionStorage', {
        error: error.message,
        profileId: this.currentProfile.id,
      });
      throw error;
    }
  }

  /**
   * Restore sessionStorage from profile
   * @param {Object} page - Playwright page object
   * @private
   */
  async restoreSessionStorage(page) {
    try {
      if (fs.existsSync(this.currentProfile.sessionStorage)) {
        const sessionStorageData = await fs.promises.readFile(this.currentProfile.sessionStorage, 'utf8');
        const sessionStorage = JSON.parse(sessionStorageData);

        if (typeof sessionStorage === 'object' && sessionStorage !== null) {
          /* eslint-disable no-undef */
          await page.evaluate(items => {
            for (const [key, value] of Object.entries(items)) {
              try {
                window.sessionStorage.setItem(key, value);
              } catch (e) {
                console.warn('Failed to restore sessionStorage item:', key, e);
              }
            }
          }, sessionStorage);
          /* eslint-enable no-undef */

          this.logger?.debug('sessionStorage restored', {
            profileId: this.currentProfile.id,
            itemCount: Object.keys(sessionStorage).length,
          });
        }
      }
    } catch (error) {
      this.logger?.warn('Failed to restore sessionStorage', {
        error: error.message,
        profileId: this.currentProfile.id,
      });
      // Don't throw - sessionStorage restore failure shouldn't break session restore
    }
  }

  /**
   * Load or create profile metadata
   * @private
   */
  async loadOrCreateMetadata() {
    try {
      if (fs.existsSync(this.currentProfile.metadata)) {
        const metadataData = await fs.promises.readFile(this.currentProfile.metadata, 'utf8');
        this.currentProfile.meta = JSON.parse(metadataData);
      } else {
        this.currentProfile.meta = {
          created: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          sessionCount: 0,
          version: '1.0.0',
        };
        await this.updateMetadata();
      }
    } catch (error) {
      this.logger?.warn('Failed to load metadata, creating new', {
        error: error.message,
        profileId: this.currentProfile.id,
      });

      this.currentProfile.meta = {
        created: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        sessionCount: 0,
        version: '1.0.0',
      };
    }
  }

  /**
   * Update profile metadata
   * @private
   */
  async updateMetadata() {
    try {
      this.currentProfile.meta.lastUsed = new Date().toISOString();
      this.currentProfile.meta.sessionCount = (this.currentProfile.meta.sessionCount || 0) + 1;

      await fs.promises.writeFile(
        this.currentProfile.metadata,
        JSON.stringify(this.currentProfile.meta, null, 2),
        'utf8'
      );
    } catch (error) {
      this.logger?.error('Failed to update metadata', {
        error: error.message,
        profileId: this.currentProfile.id,
      });
    }
  }

  /**
   * Check if profile exists
   * @param {string} profileId - Profile identifier
   * @returns {Promise<boolean>} True if profile exists
   */
  async profileExists(profileId) {
    const profilePath = path.join(this.profileDir, profileId);
    return fs.existsSync(profilePath);
  }

  /**
   * List all available profiles
   * @returns {Promise<Array<Object>>} Array of profile information
   */
  async listProfiles() {
    try {
      const profiles = [];
      const entries = await fs.promises.readdir(this.profileDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const profileId = entry.name;
          const metadataPath = path.join(this.profileDir, profileId, 'metadata.json');

          let metadata = {
            created: 'Unknown',
            lastUsed: 'Unknown',
            sessionCount: 0,
          };

          if (fs.existsSync(metadataPath)) {
            try {
              const metadataData = await fs.promises.readFile(metadataPath, 'utf8');
              metadata = JSON.parse(metadataData);
            } catch (error) {
              this.logger?.warn('Failed to read profile metadata', {
                profileId,
                error: error.message,
              });
            }
          }

          profiles.push({
            id: profileId,
            ...metadata,
          });
        }
      }

      return profiles;
    } catch (error) {
      this.logger?.error('Failed to list profiles', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Delete a profile
   * @param {string} profileId - Profile identifier
   * @returns {Promise<void>}
   */
  async deleteProfile(profileId) {
    const profilePath = path.join(this.profileDir, profileId);

    if (!fs.existsSync(profilePath)) {
      throw new Error(`Profile does not exist: ${profileId}`);
    }

    try {
      await fs.promises.rm(profilePath, { recursive: true, force: true });

      this.logger?.info('Profile deleted', {
        profileId,
        profilePath,
      });
    } catch (error) {
      this.logger?.error('Failed to delete profile', {
        profileId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get current profile information
   * @returns {Object|null} Current profile object or null if none loaded
   */
  getCurrentProfile() {
    return this.currentProfile;
  }

  /**
   * Ensure directory exists, create if it doesn't
   * @param {string} dirPath - Directory path to ensure
   * @private
   */
  ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}
