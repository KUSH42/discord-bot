/**
 * Central management of debug flags with module-specific granularity
 * Provides runtime configuration of debug logging levels per module
 */
export class DebugFlagManager {
  constructor(stateManager, logger) {
    this.stateManager = stateManager;
    this.logger = logger;

    // Available debug modules as defined in the plan
    this.availableModules = new Set([
      'content-announcer',
      'scraper',
      'youtube',
      'browser',
      'auth',
      'performance',
      'api',
      'state',
      'rate-limiting',
    ]);

    // Debug levels: 1=errors, 2=warnings, 3=info, 4=debug, 5=verbose
    this.validLevels = new Set([1, 2, 3, 4, 5]);

    this.initializeState();
    this.setupValidators();
  }

  /**
   * Initialize debug flags from environment variables and state
   */
  initializeState() {
    // Get debug flags from environment variable
    const envFlags = process.env.DEBUG_FLAGS?.split(',').map(f => f.trim()) || [];

    // Initialize debug flags state if not exists
    if (!this.stateManager.has('debugFlags')) {
      const initialFlags = {};
      for (const module of this.availableModules) {
        initialFlags[module] = envFlags.includes(module);
      }
      this.stateManager.set('debugFlags', initialFlags);
    }

    // Initialize debug levels state if not exists
    if (!this.stateManager.has('debugLevels')) {
      const initialLevels = {};
      for (const module of this.availableModules) {
        // Check for environment variable like DEBUG_LEVEL_SCRAPER=4
        const envVar = `DEBUG_LEVEL_${module.toUpperCase().replace('-', '_')}`;
        const envLevel = parseInt(process.env[envVar], 10);
        initialLevels[module] = this.validLevels.has(envLevel) ? envLevel : 3; // Default to info level
      }
      this.stateManager.set('debugLevels', initialLevels);
    }

    this.logger?.info('DebugFlagManager initialized', {
      enabledModules: this.getEnabledModules(),
      debugLevels: this.getDebugLevels(),
    });
  }

  /**
   * Set up state validators for debug flags and levels
   */
  setupValidators() {
    // Validator for debug flags
    this.stateManager.setValidator('debugFlags', newValue => {
      if (typeof newValue !== 'object' || newValue === null) {
        return 'Debug flags must be an object';
      }

      for (const [module, enabled] of Object.entries(newValue)) {
        if (!this.availableModules.has(module)) {
          return `Unknown debug module: ${module}`;
        }
        if (typeof enabled !== 'boolean') {
          return `Debug flag for ${module} must be boolean`;
        }
      }

      return true;
    });

    // Validator for debug levels
    this.stateManager.setValidator('debugLevels', newValue => {
      if (typeof newValue !== 'object' || newValue === null) {
        return 'Debug levels must be an object';
      }

      for (const [module, level] of Object.entries(newValue)) {
        if (!this.availableModules.has(module)) {
          return `Unknown debug module: ${module}`;
        }
        if (!this.validLevels.has(level)) {
          return `Debug level for ${module} must be 1-5`;
        }
      }

      return true;
    });
  }

  /**
   * Check if debug logging is enabled for a module
   * @param {string} module - Module name
   * @returns {boolean} True if debug is enabled
   */
  isEnabled(module) {
    this.validateModule(module);
    const debugFlags = this.stateManager.get('debugFlags', {});
    return debugFlags[module] || false;
  }

  /**
   * Get debug level for a module
   * @param {string} module - Module name
   * @returns {number} Debug level (1-5)
   */
  getLevel(module) {
    this.validateModule(module);
    const debugLevels = this.stateManager.get('debugLevels', {});
    return debugLevels[module] || 3;
  }

  /**
   * Check if a specific log level should be output for a module
   * @param {string} module - Module name
   * @param {number} messageLevel - Message level (1-5)
   * @returns {boolean} True if message should be logged
   */
  shouldLog(module, messageLevel) {
    if (!this.isEnabled(module)) {
      return false;
    }

    const moduleLevel = this.getLevel(module);
    return messageLevel <= moduleLevel;
  }

  /**
   * Toggle debug flag for a module
   * @param {string} module - Module name
   * @param {boolean} enabled - Enable/disable debug
   * @returns {boolean} New state
   */
  toggle(module, enabled) {
    this.validateModule(module);

    const currentFlags = this.stateManager.get('debugFlags', {});
    const newFlags = { ...currentFlags, [module]: enabled };

    this.stateManager.set('debugFlags', newFlags);

    this.logger?.info('Debug flag changed', {
      module,
      enabled,
      previousState: currentFlags[module],
    });

    return enabled;
  }

  /**
   * Set debug level for a module
   * @param {string} module - Module name
   * @param {number} level - Debug level (1-5)
   * @returns {number} New level
   */
  setLevel(module, level) {
    this.validateModule(module);

    if (!this.validLevels.has(level)) {
      throw new Error(`Invalid debug level: ${level}. Must be 1-5`);
    }

    const currentLevels = this.stateManager.get('debugLevels', {});
    const newLevels = { ...currentLevels, [module]: level };

    this.stateManager.set('debugLevels', newLevels);

    this.logger?.info('Debug level changed', {
      module,
      level,
      previousLevel: currentLevels[module],
    });

    return level;
  }

  /**
   * Get all enabled debug modules
   * @returns {Array<string>} Array of enabled module names
   */
  getEnabledModules() {
    const debugFlags = this.stateManager.get('debugFlags', {});
    return Object.entries(debugFlags)
      .filter(([, enabled]) => enabled)
      .map(([module]) => module);
  }

  /**
   * Get all debug levels
   * @returns {Object} Object with module -> level mappings
   */
  getDebugLevels() {
    return this.stateManager.get('debugLevels', {});
  }

  /**
   * Get status of all debug modules
   * @returns {Object} Status object with flags and levels
   */
  getStatus() {
    const debugFlags = this.stateManager.get('debugFlags', {});
    const debugLevels = this.stateManager.get('debugLevels', {});

    const status = {};
    for (const module of this.availableModules) {
      status[module] = {
        enabled: debugFlags[module] || false,
        level: debugLevels[module] || 3,
        levelName: this.getLevelName(debugLevels[module] || 3),
      };
    }

    return {
      modules: status,
      enabledCount: this.getEnabledModules().length,
      totalCount: this.availableModules.size,
    };
  }

  /**
   * Get human-readable name for debug level
   * @param {number} level - Debug level
   * @returns {string} Level name
   */
  getLevelName(level) {
    const levelNames = {
      1: 'errors',
      2: 'warnings',
      3: 'info',
      4: 'debug',
      5: 'verbose',
    };
    return levelNames[level] || 'unknown';
  }

  /**
   * Get all available debug modules
   * @returns {Array<string>} Array of module names
   */
  getAvailableModules() {
    return Array.from(this.availableModules).sort();
  }

  /**
   * Bulk update debug flags
   * @param {Object} updates - Object with module -> boolean mappings
   * @returns {Object} Updated flags
   */
  bulkToggle(updates) {
    if (typeof updates !== 'object' || updates === null) {
      throw new Error('Updates must be an object');
    }

    // Validate all modules first
    for (const module of Object.keys(updates)) {
      this.validateModule(module);
    }

    const currentFlags = this.stateManager.get('debugFlags', {});
    const newFlags = { ...currentFlags, ...updates };

    this.stateManager.set('debugFlags', newFlags);

    this.logger?.info('Debug flags bulk updated', {
      updates,
      newState: newFlags,
    });

    return newFlags;
  }

  /**
   * Bulk update debug levels
   * @param {Object} updates - Object with module -> level mappings
   * @returns {Object} Updated levels
   */
  bulkSetLevels(updates) {
    if (typeof updates !== 'object' || updates === null) {
      throw new Error('Updates must be an object');
    }

    // Validate all modules and levels first
    for (const [module, level] of Object.entries(updates)) {
      this.validateModule(module);
      if (!this.validLevels.has(level)) {
        throw new Error(`Invalid debug level for ${module}: ${level}. Must be 1-5`);
      }
    }

    const currentLevels = this.stateManager.get('debugLevels', {});
    const newLevels = { ...currentLevels, ...updates };

    this.stateManager.set('debugLevels', newLevels);

    this.logger?.info('Debug levels bulk updated', {
      updates,
      newState: newLevels,
    });

    return newLevels;
  }

  /**
   * Reset all debug flags to default state
   */
  reset() {
    const defaultFlags = {};
    const defaultLevels = {};

    for (const module of this.availableModules) {
      defaultFlags[module] = false;
      defaultLevels[module] = 3; // Default to info level
    }

    this.stateManager.set('debugFlags', defaultFlags);
    this.stateManager.set('debugLevels', defaultLevels);

    this.logger?.info('Debug flags and levels reset to defaults');
  }

  /**
   * Subscribe to debug flag changes for a module
   * @param {string} module - Module name
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  subscribe(module, callback) {
    this.validateModule(module);

    return this.stateManager.subscribe('debugFlags', (newFlags, oldFlags) => {
      const newEnabled = newFlags[module];
      const oldEnabled = oldFlags?.[module];

      if (newEnabled !== oldEnabled) {
        callback(newEnabled, oldEnabled, module);
      }
    });
  }

  /**
   * Validate module name
   * @private
   */
  validateModule(module) {
    if (!this.availableModules.has(module)) {
      throw new Error(`Unknown debug module: ${module}. Available: ${Array.from(this.availableModules).join(', ')}`);
    }
  }

  /**
   * Get statistics about debug flag usage
   * @returns {Object} Statistics object
   */
  getStats() {
    const status = this.getStatus();
    const enabledModules = this.getEnabledModules();

    return {
      totalModules: this.availableModules.size,
      enabledModules: enabledModules.length,
      enabledPercentage: Math.round((enabledModules.length / this.availableModules.size) * 100),
      moduleStats: status.modules,
      memoryUsage: JSON.stringify(status).length,
    };
  }
}
