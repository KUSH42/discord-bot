/**
 * Pure business logic for processing Discord bot commands
 * No side effects - only processes input and returns command results
 */

import { nowUTC, toISOStringUTC } from '../utilities/utc-time.js';
import { createEnhancedLogger } from '../utilities/enhanced-logger.js';

export class CommandProcessor {
  constructor(config, stateManager, debugFlagManager = null, metricsManager = null, baseLogger = null) {
    this.config = config;
    this.state = stateManager;
    this.debugManager = debugFlagManager;
    this.metricsManager = metricsManager;
    this.commandPrefix = config.get('COMMAND_PREFIX', '!');

    // Create enhanced logger if components are available
    if (baseLogger && debugFlagManager && metricsManager) {
      this.logger = createEnhancedLogger('api', baseLogger, debugFlagManager, metricsManager);
    } else {
      this.logger = baseLogger || console;
    }

    // Set up validators for state keys this processor manages
    this.setupStateValidators();
  }

  /**
   * Set up state validators for command-managed state
   */
  setupStateValidators() {
    this.state.setValidator('postingEnabled', value => {
      return typeof value === 'boolean' ? true : 'postingEnabled must be a boolean';
    });

    this.state.setValidator('announcementEnabled', value => {
      return typeof value === 'boolean' ? true : 'announcementEnabled must be a boolean';
    });

    this.state.setValidator('vxTwitterConversionEnabled', value => {
      return typeof value === 'boolean' ? true : 'vxTwitterConversionEnabled must be a boolean';
    });

    this.state.setValidator('logLevel', value => {
      const validLevels = ['error', 'warn', 'info', 'debug', 'verbose'];
      return validLevels.includes(value) ? true : `logLevel must be one of: ${validLevels.join(', ')}`;
    });
  }

  /**
   * Check if user is authorized for a command
   * @param {string} userId - Discord user ID
   * @param {string} command - Command name
   * @returns {boolean} True if authorized
   */
  isUserAuthorized(userId, command) {
    const allowedUserIds = this.getAllowedUserIds();
    const restrictedCommands = [
      'restart',
      'kill',
      'update',
      'restart-scraper',
      'stop-scraper',
      'start-scraper',
      'force-reauth',
    ];

    if (restrictedCommands.includes(command)) {
      return allowedUserIds.includes(userId);
    }

    return true; // All other commands are allowed for any user
  }

  /**
   * Get list of allowed user IDs from configuration
   * @returns {Array<string>} Array of allowed user IDs
   */
  getAllowedUserIds() {
    const allowedUserIdsStr = this.config.get('ALLOWED_USER_IDS', '');
    return allowedUserIdsStr ? allowedUserIdsStr.split(',').map(id => id.trim()) : [];
  }

  /**
   * Validate command format and inputs
   * @param {string} command - Command name
   * @param {Array<string>} args - Command arguments
   * @param {string} userId - User ID
   * @returns {Object} Validation result with success boolean and error message
   */
  validateCommand(command, args, userId) {
    // Basic format validation
    if (!command || typeof command !== 'string') {
      return { success: false, error: 'Invalid command format.' };
    }

    if (command.length > 20) {
      return { success: false, error: 'Command name too long.' };
    }

    if (!userId || typeof userId !== 'string') {
      return { success: false, error: 'Invalid user ID.' };
    }

    // Validate Discord user ID format (should be 17-19 digits)
    if (!/^\d{17,19}$/.test(userId)) {
      return { success: false, error: 'Invalid user ID format.' };
    }

    // Command-specific validation
    if (command === 'announce' || command === 'vxtwitter') {
      if (args.length > 0) {
        const arg = args[0].toLowerCase();
        if (arg !== 'true' && arg !== 'false') {
          return {
            success: false,
            error: `Invalid argument for ${this.commandPrefix}${command}. Use \`${this.commandPrefix}${command} true\` or \`${this.commandPrefix}${command} false\`.`,
          };
        }
      }
    }

    if (command === 'loglevel' && args.length > 0) {
      const newLevel = args[0] ? args[0].toLowerCase().trim() : '';

      if (!newLevel || newLevel.length > 10 || !/^[a-z]+$/.test(newLevel)) {
        return { success: false, error: 'Invalid log level format.' };
      }

      const validLevels = ['error', 'warn', 'info', 'debug', 'verbose'];
      if (!validLevels.includes(newLevel)) {
        return {
          success: false,
          error: `Invalid log level. Valid levels are: ${validLevels.join(', ')}.`,
        };
      }
    }

    // Debug command validation
    if (command === 'debug' && args.length > 0) {
      if (!this.debugManager) {
        return {
          success: false,
          error: 'Debug manager is not available.',
        };
      }

      // Check if it's global toggle (just true/false)
      if (args.length === 1) {
        const enabledStr = args[0];
        if (enabledStr.toLowerCase() !== 'true' && enabledStr.toLowerCase() !== 'false') {
          return {
            success: false,
            error: `Invalid argument. Use \`${this.commandPrefix}debug true\` or \`${this.commandPrefix}debug false\`.`,
          };
        }
      } else {
        // Check if it's module list with toggle
        const enabledStr = args[args.length - 1];
        if (enabledStr.toLowerCase() !== 'true' && enabledStr.toLowerCase() !== 'false') {
          return {
            success: false,
            error: `Invalid argument. Last argument must be true or false.`,
          };
        }

        // Validate all modules except the last argument (which is the toggle)
        const availableModules = this.debugManager.getAvailableModules();
        const modules = args.slice(0, -1);

        for (const module of modules) {
          if (!availableModules.includes(module)) {
            return {
              success: false,
              error: `Unknown debug module: ${module}. Available: ${availableModules.join(', ')}.`,
            };
          }
        }
      }
    }

    // Debug level command validation
    if (command === 'debug-level' && args.length > 0) {
      if (!this.debugManager) {
        return {
          success: false,
          error: 'Debug manager is not available.',
        };
      }

      // Check if it's global level setting (just a number)
      if (args.length === 1) {
        const level = parseInt(args[0], 10);
        if (isNaN(level) || level < 1 || level > 5) {
          return {
            success: false,
            error: 'Invalid debug level. Must be 1-5 (1=errors, 2=warnings, 3=info, 4=debug, 5=verbose).',
          };
        }
      } else {
        // Check if it's module list with level
        const levelStr = args[args.length - 1];
        const level = parseInt(levelStr, 10);
        if (isNaN(level) || level < 1 || level > 5) {
          return {
            success: false,
            error: 'Invalid debug level. Must be 1-5 (1=errors, 2=warnings, 3=info, 4=debug, 5=verbose).',
          };
        }

        // Validate all modules except the last argument (which is the level)
        const availableModules = this.debugManager.getAvailableModules();
        const modules = args.slice(0, -1);

        for (const module of modules) {
          if (!availableModules.includes(module)) {
            return {
              success: false,
              error: `Unknown debug module: ${module}. Available: ${availableModules.join(', ')}.`,
            };
          }
        }
      }
    }

    return { success: true };
  }

  /**
   * Process a Discord command
   * @param {string} command - Command name
   * @param {Array<string>} args - Command arguments
   * @param {string} userId - UserID who issued the command
   * @returns {Promise<Object>} Command result object
   */
  async processCommand(command, args = [], userId, appStats = null) {
    const operation = this.logger.startOperation
      ? this.logger.startOperation('processCommand', {
          command,
          argsCount: args.length,
          userId: `${userId?.substring(0, 8)}...`, // Truncate for privacy
          hasAppStats: !!appStats,
        })
      : null;

    try {
      // Validate command
      if (operation) {
        operation.progress('Validating command and arguments');
      }
      const validation = this.validateCommand(command, args, userId);
      if (!validation.success) {
        const result = {
          success: false,
          message: `❌ ${validation.error}`,
          requiresRestart: false,
        };
        if (operation) {
          operation.error(new Error(validation.error), 'Command validation failed');
        }
        return result;
      }

      // Check authorization
      if (operation) {
        operation.progress('Checking user authorization');
      }
      if (!this.isUserAuthorized(userId, command)) {
        const result = {
          success: false,
          message: '🚫 You are not authorized to use this command.',
          requiresRestart: false,
        };
        if (operation) {
          operation.error(new Error('Unauthorized'), 'User not authorized for command');
        }
        return result;
      }

      // Process specific commands
      if (operation) {
        operation.progress(`Executing ${command} command`);
      }
      let result;
      switch (command) {
        case 'restart':
          result = await this.handleRestart(userId);
          break;

        case 'kill':
          result = await this.handleKill(userId);
          break;

        case 'announce':
          result = await this.handleAnnounce(args);
          break;

        case 'vxtwitter':
          result = await this.handleVxTwitter(args);
          break;

        case 'loglevel':
          return await this.handleLogLevel(args);

        case 'health':
          return await this.handleHealth();

        case 'health-detailed':
          return await this.handleHealthDetailed(appStats);

        case 'hd':
          return await this.handleHealthDetailed(appStats);

        case 'readme':
          return await this.handleReadme();

        case 'update':
          return await this.handleUpdate(userId);

        case 'restart-scraper':
          return await this.handleRestartScraper(userId);

        case 'stop-scraper':
          return await this.handleStopScraper(userId);

        case 'start-scraper':
          return await this.handleStartScraper(userId);

        case 'auth-status':
          return await this.handleAuthStatus(userId);

        case 'force-reauth':
          return await this.handleForceReauth(userId);

        case 'scraper-health':
          return await this.handleScraperHealth(userId);

        case 'youtube-health':
          return await this.handleYoutubeHealth(appStats);

        case 'x-health':
          return await this.handleXHealth(appStats);

        case 'debug':
          return await this.handleDebugToggle(args);

        case 'debug-status':
          return await this.handleDebugStatus();

        case 'debug-level':
          return await this.handleDebugLevel(args);

        case 'metrics':
          return await this.handleMetrics();

        case 'log-pipeline':
          return await this.handleLogPipeline();

        default:
          result = {
            success: false,
            message: `❓ Unknown command: \`${command}\`. Use \`${this.commandPrefix}readme\` for help.`,
            requiresRestart: false,
          };
          break;
      }

      if (operation) {
        if (result.success) {
          operation.success(`Command ${command} executed successfully`, {
            commandResult: result.message ? 'with_message' : 'without_message',
            requiresRestart: result.requiresRestart,
          });
        } else {
          operation.error(new Error(result.message || 'Command failed'), `Command ${command} failed`);
        }
      }

      return result;
    } catch (error) {
      if (operation) {
        operation.error(error, 'Unexpected error during command processing');
      }
      return {
        success: false,
        message: '❌ An unexpected error occurred while processing the command.',
        requiresRestart: false,
      };
    }
  }

  /**
   * Handle update command
   */
  async handleUpdate(userId) {
    return {
      success: true,
      message: null, // No message here - handleUpdate will send its own messages
      requiresUpdate: true,
      userId,
    };
  }

  async handleRestart(userId) {
    // Note: The actual restart logic is handled by the application layer
    return {
      success: true,
      message: '🔄 Initiating full restart... The bot will reload all configurations.',
      requiresRestart: true,
      userId,
    };
  }

  /**
   * Handle kill command
   */
  async handleKill(userId) {
    this.state.set('postingEnabled', false);

    return {
      success: true,
      message: '🛑 All Discord posting has been stopped.',
      requiresRestart: false,
      logMessage: `User executed kill command. All Discord posting is now disabled.`,
      userId,
    };
  }

  /**
   * Handle announce command
   */
  async handleAnnounce(args) {
    if (args.length === 0) {
      const currentState = this.state.get('announcementEnabled', false);
      return {
        success: true,
        message: `Current announcement state: ${currentState ? 'enabled' : 'disabled'}. Usage: ${this.commandPrefix}announce <true|false>`,
        requiresRestart: false,
      };
    }

    const enableArg = args[0].toLowerCase();
    const isEnabled = enableArg === 'true';

    this.state.set('announcementEnabled', isEnabled);

    return {
      success: true,
      message: `📣 Announcement posting is now **${isEnabled ? 'enabled' : 'disabled'}**. (Support log is unaffected)`,
      requiresRestart: false,
      logMessage: `Announcement posting is now ${isEnabled ? 'enabled' : 'disabled'}.`,
    };
  }

  /**
   * Handle vxtwitter command
   */
  async handleVxTwitter(args) {
    if (args.length === 0) {
      const currentState = this.state.get('vxTwitterConversionEnabled', false);
      return {
        success: true,
        message: `Current vxtwitter conversion state: ${currentState ? 'enabled' : 'disabled'}. Usage: ${this.commandPrefix}vxtwitter <true|false>`,
        requiresRestart: false,
      };
    }

    const enableArg = args[0].toLowerCase();
    const isEnabled = enableArg === 'true';

    this.state.set('vxTwitterConversionEnabled', isEnabled);

    return {
      success: true,
      message: `🐦 URL conversion to vxtwitter.com is now **${isEnabled ? 'enabled' : 'disabled'}**.`,
      requiresRestart: false,
      logMessage: `URL conversion is now ${isEnabled ? 'enabled' : 'disabled'}.`,
    };
  }

  /**
   * Handle loglevel command
   */
  async handleLogLevel(args) {
    if (args.length === 0) {
      const currentLevel = this.state.get('logLevel', 'info');
      return {
        success: true,
        message: `Current log level: ${currentLevel}. Usage: ${this.commandPrefix}loglevel <level>`,
        requiresRestart: false,
      };
    }

    const newLevel = args[0].toLowerCase().trim();

    // Validation was already done in validateCommand
    this.state.set('logLevel', newLevel);

    return {
      success: true,
      message: `🔧 Log level has been changed to **${newLevel}**.`,
      requiresRestart: false,
      logMessage: `Log level changed to '${newLevel}'.`,
      newLogLevel: newLevel,
    };
  }

  /**
   * Handle health command
   */
  async handleHealth() {
    const uptime = Math.floor(process.uptime());
    const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`;
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);

    const botStartTime = this.state.get('botStartTime');
    const postingEnabled = this.state.get('postingEnabled', true);
    const announcementEnabled = this.state.get('announcementEnabled', false);
    const vxTwitterEnabled = this.state.get('vxTwitterConversionEnabled', false);

    const healthData = {
      uptime: uptimeStr,
      memoryUsage: `${memMB} MB`,
      postingStatus: postingEnabled ? 'Enabled' : 'Disabled',
      announcements: announcementEnabled ? 'Enabled' : 'Disabled',
      vxTwitter: vxTwitterEnabled ? 'Enabled' : 'Disabled',
      botStartTime: botStartTime ? botStartTime.toISOString() : 'Unknown',
      timestamp: toISOStringUTC(),
    };

    return {
      success: true,
      message: 'Health check completed',
      requiresRestart: false,
      healthData,
    };
  }

  /**
   * Handle readme command
   */
  async handleReadme() {
    const generalCommands = [
      `**${this.commandPrefix}announce <true|false>**: Toggles announcement posting to non-support channels.`,
      `**${this.commandPrefix}vxtwitter <true|false>**: Toggles the conversion of \`x.com\` URLs to \`vxtwitter.com\` in announcements.`,
      `**${this.commandPrefix}loglevel <level>**: Changes the bot's logging level (e.g., info, debug).`,
      `**${this.commandPrefix}debug <true|false>**: Toggles debug logging for all modules.`,
      `**${this.commandPrefix}debug <module1> <module2> ... <true|false>**: Toggles debug logging for specific modules.`,
      `**${this.commandPrefix}debug-status**: Shows current debug status for all modules.`,
      `**${this.commandPrefix}debug-level <1-5>**: Sets debug level for all modules (1=errors, 5=verbose).`,
      `**${this.commandPrefix}debug-level <module1> <module2> ... <1-5>**: Sets debug level for specific modules.`,
      `**${this.commandPrefix}metrics**: Shows performance metrics and system statistics.`,
      `**${this.commandPrefix}log-pipeline**: Shows recent pipeline activities with correlation tracking.`,
      `**${this.commandPrefix}health**: Shows bot health status and system information.`,
      `**${this.commandPrefix}health-detailed**: Shows detailed health status for all components.`,
      `**${this.commandPrefix}youtube-health**: Shows detailed YouTube monitor health status.`,
      `**${this.commandPrefix}x-health**: Shows detailed X scraper health status.`,
      `**${this.commandPrefix}auth-status**: Shows X authentication status.`,
      `**${this.commandPrefix}scraper-health**: Shows X scraper health status.`,
      `**${this.commandPrefix}readme**: Displays this command information.`,
    ];

    const adminCommands = [
      `**${this.commandPrefix}kill**: Stops *all* bot posting to Discord channels (announcements and support log).`,
      `**${this.commandPrefix}restart**: Performs a full restart of the bot, reloading the .env file and all configurations.`,
      `**${this.commandPrefix}update**: Pulls the latest changes from git, updates dependencies, and restarts the bot.`,
      `**${this.commandPrefix}restart-scraper**: Restarts only the X scraper application with retry logic.`,
      `**${this.commandPrefix}stop-scraper**: Stops the X scraper application.`,
      `**${this.commandPrefix}start-scraper**: Starts the X scraper application.`,
      `**${this.commandPrefix}force-reauth**: Forces re-authentication with X, clearing saved cookies.`,
    ];

    const readmeMessage = `**Discord Bot Message Commands**\n\nThese commands can only be used in the configured support channel.\n\n**General Commands:**\n${generalCommands.join('\n')}\n\n**Admin Commands** (require \`ALLOWED_USER_IDS\` authorization):\n${adminCommands.join('\n')}`;

    return {
      success: true,
      message: readmeMessage,
      requiresRestart: false,
    };
  }

  /**
   * Get command statistics
   * @returns {Object} Command usage statistics
   */
  /**
   * Handle detailed health command
   */
  async handleHealthDetailed(appStats) {
    if (!appStats) {
      return {
        success: false,
        message: 'Detailed health information is not available at the moment.',
        requiresRestart: false,
      };
    }

    return {
      success: true,
      message: 'Detailed health check completed',
      requiresRestart: false,
      healthData: appStats,
    };
  }

  /**
   * Handle restart scraper command
   */
  async handleRestartScraper(userId) {
    return {
      success: true,
      message: null, // No message here - handleScraperAction will send its own messages
      requiresRestart: false,
      scraperAction: 'restart',
      userId,
    };
  }

  /**
   * Handle stop scraper command
   */
  async handleStopScraper(userId) {
    return {
      success: true,
      message: null, // No message here - handleScraperAction will send its own messages
      requiresRestart: false,
      scraperAction: 'stop',
      userId,
    };
  }

  /**
   * Handle start scraper command
   */
  async handleStartScraper(userId) {
    return {
      success: true,
      message: null, // No message here - handleScraperAction will send its own messages
      requiresRestart: false,
      scraperAction: 'start',
      userId,
    };
  }

  /**
   * Handle authentication status command
   */
  async handleAuthStatus(userId) {
    return {
      success: true,
      message: null, // No message here - handleScraperAction will send its own messages
      requiresRestart: false,
      scraperAction: 'auth-status',
      userId,
    };
  }

  /**
   * Handle force re-authentication command
   */
  async handleForceReauth(userId) {
    return {
      success: true,
      message: null, // No message here - handleScraperAction will send its own messages
      requiresRestart: false,
      scraperAction: 'force-reauth',
      userId,
    };
  }

  /**
   * Handle scraper health command
   */
  async handleScraperHealth(userId) {
    return {
      success: true,
      message: null, // No message here - handleScraperAction will send its own messages
      requiresRestart: false,
      scraperAction: 'health',
      userId,
    };
  }

  /**
   * Handle YouTube health command
   */
  async handleYoutubeHealth(appStats) {
    if (!appStats) {
      return {
        success: false,
        message: 'YouTube health information is not available at the moment.',
        requiresRestart: false,
      };
    }

    return {
      success: true,
      message: 'YouTube health check completed',
      requiresRestart: false,
      healthData: appStats,
      healthType: 'youtube',
    };
  }

  /**
   * Handle X scraper health command
   */
  async handleXHealth(appStats) {
    if (!appStats) {
      return {
        success: false,
        message: 'X scraper health information is not available at the moment.',
        requiresRestart: false,
      };
    }

    return {
      success: true,
      message: 'X scraper health check completed',
      requiresRestart: false,
      healthData: appStats,
      healthType: 'x-scraper',
    };
  }

  /**
   * Handle debug toggle command
   */
  async handleDebugToggle(args) {
    if (!this.debugManager) {
      return {
        success: false,
        message: '❌ Debug manager is not available.',
        requiresRestart: false,
      };
    }

    if (args.length === 0) {
      const status = this.debugManager.getStatus();
      const enabledModules = Object.entries(status.modules)
        .filter(([, info]) => info.enabled)
        .map(([module]) => module);

      const message =
        enabledModules.length > 0
          ? `🔧 Enabled debug modules: ${enabledModules.join(', ')}`
          : '🔧 No debug modules currently enabled.';

      return {
        success: true,
        message: `${message}\n\n**Usage:**\n• \`${this.commandPrefix}debug <true|false>\` - Toggle all modules\n• \`${this.commandPrefix}debug <module1> <module2> ... <true|false>\` - Toggle specific modules`,
        requiresRestart: false,
      };
    }

    // Global toggle (just true/false)
    if (args.length === 1) {
      const enabled = args[0].toLowerCase() === 'true';
      const availableModules = this.debugManager.getAvailableModules();
      const results = [];
      const errors = [];

      try {
        for (const module of availableModules) {
          try {
            this.debugManager.toggle(module, enabled);
            results.push(module);
          } catch (error) {
            errors.push(`${module}: ${error.message}`);
          }
        }

        const successMessage =
          results.length > 0
            ? `🔧 Debug logging **${enabled ? 'enabled' : 'disabled'}** for **${results.length}** modules: ${results.join(', ')}`
            : '';

        const errorMessage = errors.length > 0 ? `⚠️ Errors for ${errors.length} modules: ${errors.join('; ')}` : '';

        const message = [successMessage, errorMessage].filter(Boolean).join('\n');

        return {
          success: results.length > 0,
          message: message || '❌ No modules were updated.',
          requiresRestart: false,
          logMessage: `Debug logging ${enabled ? 'enabled' : 'disabled'} for ${results.length} modules.`,
        };
      } catch (error) {
        return {
          success: false,
          message: `❌ Failed to toggle global debug: ${error.message}`,
          requiresRestart: false,
        };
      }
    }

    // Module list with toggle (e.g., youtube auth true)
    const enabled = args[args.length - 1].toLowerCase() === 'true';
    const modules = args.slice(0, -1);
    const results = [];
    const errors = [];

    try {
      for (const module of modules) {
        try {
          this.debugManager.toggle(module, enabled);
          results.push(module);
        } catch (error) {
          errors.push(`${module}: ${error.message}`);
        }
      }

      const successMessage =
        results.length > 0 ? `🔧 Debug logging **${enabled ? 'enabled' : 'disabled'}** for: ${results.join(', ')}` : '';

      const errorMessage = errors.length > 0 ? `⚠️ Errors: ${errors.join('; ')}` : '';

      const message = [successMessage, errorMessage].filter(Boolean).join('\n');

      return {
        success: results.length > 0,
        message: message || '❌ No modules were updated.',
        requiresRestart: false,
        logMessage: `Debug logging ${enabled ? 'enabled' : 'disabled'} for modules: ${results.join(', ')}.`,
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to toggle debug: ${error.message}`,
        requiresRestart: false,
      };
    }
  }

  /**
   * Handle debug status command
   */
  async handleDebugStatus() {
    if (!this.debugManager) {
      return {
        success: false,
        message: '❌ Debug manager is not available.',
        requiresRestart: false,
      };
    }

    try {
      const status = this.debugManager.getStatus();
      const stats = this.debugManager.getStats();

      const moduleLines = Object.entries(status.modules).map(([module, info]) => {
        const statusIcon = info.enabled ? '✅' : '❌';
        return `${statusIcon} **${module}**: ${info.enabled ? 'enabled' : 'disabled'} (level ${info.level}: ${info.levelName})`;
      });

      const summary = [
        `**Debug Status Summary**`,
        `📊 Enabled: ${status.enabledCount}/${status.totalCount} modules (${stats.enabledPercentage}%)`,
        ``,
        `**Module Status:**`,
        ...moduleLines,
      ].join('\n');

      return {
        success: true,
        message: summary,
        requiresRestart: false,
        debugStatus: status,
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to get debug status: ${error.message}`,
        requiresRestart: false,
      };
    }
  }

  /**
   * Handle debug level command
   */
  async handleDebugLevel(args) {
    if (!this.debugManager) {
      return {
        success: false,
        message: '❌ Debug manager is not available.',
        requiresRestart: false,
      };
    }

    if (args.length === 0) {
      const levels = this.debugManager.getDebugLevels();
      const levelLines = Object.entries(levels).map(([module, level]) => {
        const levelName = this.debugManager.getLevelName(level);
        return `**${module}**: ${level} (${levelName})`;
      });

      const message = [
        `**Current Debug Levels:**`,
        ...levelLines,
        ``,
        `**Levels:** 1=errors, 2=warnings, 3=info, 4=debug, 5=verbose`,
        `**Usage:**`,
        `• \`${this.commandPrefix}debug-level <level>\` - Set level for all modules`,
        `• \`${this.commandPrefix}debug-level <module1> <module2> ... <level>\` - Set level for specific modules`,
      ].join('\n');

      return {
        success: true,
        message,
        requiresRestart: false,
      };
    }

    // Global level setting (just a number)
    if (args.length === 1) {
      const level = parseInt(args[0], 10);
      const availableModules = this.debugManager.getAvailableModules();
      const results = [];
      const errors = [];

      try {
        for (const module of availableModules) {
          try {
            this.debugManager.setLevel(module, level);
            results.push(module);
          } catch (error) {
            errors.push(`${module}: ${error.message}`);
          }
        }

        const levelName = this.debugManager.getLevelName(level);
        const successMessage =
          results.length > 0
            ? `🔧 Debug level set to **${level}** (${levelName}) for **${results.length}** modules: ${results.join(', ')}`
            : '';

        const errorMessage = errors.length > 0 ? `⚠️ Errors for ${errors.length} modules: ${errors.join('; ')}` : '';

        const message = [successMessage, errorMessage].filter(Boolean).join('\n');

        return {
          success: results.length > 0,
          message: message || '❌ No modules were updated.',
          requiresRestart: false,
          logMessage: `Debug level set to ${level} (${levelName}) for ${results.length} modules.`,
        };
      } catch (error) {
        return {
          success: false,
          message: `❌ Failed to set global debug level: ${error.message}`,
          requiresRestart: false,
        };
      }
    }

    // Module list with level (e.g., youtube auth 4)
    const level = parseInt(args[args.length - 1], 10);
    const modules = args.slice(0, -1);
    const results = [];
    const errors = [];

    try {
      for (const module of modules) {
        try {
          this.debugManager.setLevel(module, level);
          results.push(module);
        } catch (error) {
          errors.push(`${module}: ${error.message}`);
        }
      }

      const levelName = this.debugManager.getLevelName(level);
      const successMessage =
        results.length > 0 ? `🔧 Debug level set to **${level}** (${levelName}) for: ${results.join(', ')}` : '';

      const errorMessage = errors.length > 0 ? `⚠️ Errors: ${errors.join('; ')}` : '';

      const message = [successMessage, errorMessage].filter(Boolean).join('\n');

      return {
        success: results.length > 0,
        message: message || '❌ No modules were updated.',
        requiresRestart: false,
        logMessage: `Debug level set to ${level} (${levelName}) for modules: ${results.join(', ')}.`,
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to set debug level: ${error.message}`,
        requiresRestart: false,
      };
    }
  }

  /**
   * Handle metrics command
   */
  async handleMetrics() {
    if (!this.metricsManager) {
      return {
        success: false,
        message: '❌ Metrics manager is not available.',
        requiresRestart: false,
      };
    }

    try {
      const stats = this.metricsManager.getStats();
      const memUsage = this.metricsManager.getMemoryUsage();

      // Get some key metrics
      const counters = this.metricsManager.getMetrics('counter');
      const timers = this.metricsManager.getMetrics('timer');

      const summary = [
        `**📊 Metrics Summary**`,
        `⏱️ Uptime: ${Math.floor(stats.uptime / 3600)}h ${Math.floor((stats.uptime % 3600) / 60)}m`,
        `📈 Total metrics recorded: ${stats.totalMetricsRecorded.toLocaleString()}`,
        `⚡ Rate: ${Math.round(stats.metricsPerSecond * 100) / 100} metrics/sec`,
        `💾 Memory: ${memUsage.estimatedMB} MB (${memUsage.totalSamples.toLocaleString()} samples)`,
        ``,
        `**Storage:**`,
        `🔢 Counters: ${stats.storage.counters}`,
        `📊 Gauges: ${stats.storage.gauges}`,
        `⏱️ Timers: ${stats.storage.timers}`,
        `📈 Histograms: ${stats.storage.histograms}`,
        ``,
      ];

      // Add top counters
      const sortedCounters = Object.entries(counters)
        .sort(([, a], [, b]) => b.value - a.value)
        .slice(0, 5);

      if (sortedCounters.length > 0) {
        summary.push(`**Top Counters:**`);
        for (const [name, metric] of sortedCounters) {
          summary.push(`• **${name}**: ${metric.value.toLocaleString()}`);
        }
        summary.push(``);
      }

      // Add timer performance
      const sortedTimers = Object.entries(timers)
        .filter(([, metric]) => metric.stats.count > 0)
        .sort(([, a], [, b]) => b.stats.mean - a.stats.mean)
        .slice(0, 5);

      if (sortedTimers.length > 0) {
        summary.push(`**Timer Performance (avg):**`);
        for (const [name, metric] of sortedTimers) {
          const avg = Math.round(metric.stats.mean);
          const p95 = metric.stats.p95 ? Math.round(metric.stats.p95) : 'N/A';
          summary.push(`• **${name}**: ${avg}ms avg, ${p95}ms p95`);
        }
      }

      return {
        success: true,
        message: summary.join('\n'),
        requiresRestart: false,
        metricsData: { stats, counters, timers },
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to get metrics: ${error.message}`,
        requiresRestart: false,
      };
    }
  }

  /**
   * Handle log-pipeline command
   */
  async handleLogPipeline() {
    // This would integrate with enhanced logger to show recent pipeline activities
    // For now, return a placeholder implementation

    const activities = [
      `**📋 Recent Pipeline Activities**`,
      ``,
      `ℹ️ This command shows recent logging activities with correlation tracking.`,
      `🚧 Full implementation requires integration with EnhancedLogger instances.`,
      ``,
      `**Planned Features:**`,
      `• Recent operation timings and outcomes`,
      `• Failed operations with context`,
      `• Correlation ID tracking across modules`,
      `• Pipeline performance metrics`,
      ``,
    ];

    // If we have enhanced loggers available, we could add real data here
    if (this.debugManager) {
      const enabledModules = this.debugManager.getEnabledModules();
      if (enabledModules.length > 0) {
        activities.push(`**Currently Debugging:**`);
        for (const module of enabledModules) {
          const level = this.debugManager.getLevel(module);
          const levelName = this.debugManager.getLevelName(level);
          activities.push(`• **${module}**: level ${level} (${levelName})`);
        }
      }
    }

    return {
      success: true,
      message: activities.join('\n'),
      requiresRestart: false,
      logMessage: 'Log pipeline status requested',
    };
  }

  getStats() {
    return {
      availableCommands: [
        'restart',
        'kill',
        'announce',
        'vxtwitter',
        'loglevel',
        'health',
        'health-detailed',
        'hd',
        'youtube-health',
        'x-health',
        'readme',
        'update',
        'restart-scraper',
        'stop-scraper',
        'start-scraper',
        'auth-status',
        'force-reauth',
        'scraper-health',
        'debug',
        'debug-status',
        'debug-level',
        'metrics',
        'log-pipeline',
      ],
      restrictedCommands: [
        'restart',
        'kill',
        'update',
        'restart-scraper',
        'stop-scraper',
        'start-scraper',
        'force-reauth',
      ],
      allowedUsers: this.getAllowedUserIds().length,
      commandPrefix: this.commandPrefix,
    };
  }
}
