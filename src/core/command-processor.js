/**
 * Pure business logic for processing Discord bot commands
 * No side effects - only processes input and returns command results
 */

import { nowUTC as _nowUTC, toISOStringUTC } from '../utilities/utc-time.js';
import { createEnhancedLogger } from '../utilities/enhanced-logger.js';
import { ProcessCleanup } from '../utilities/process-cleanup.js';
import gradient from 'gradient-string';

export class CommandProcessor {
  constructor(
    config,
    stateManager,
    debugFlagManager = null,
    metricsManager = null,
    baseLogger = null,
    memoryMonitor = null
  ) {
    this.config = config;
    this.state = stateManager;
    this.debugManager = debugFlagManager;
    this.metricsManager = metricsManager;
    this.memoryMonitor = memoryMonitor;
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
      'delete',
      'colorize',
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

    // Delete command validation
    if (command === 'delete' && args.length > 0) {
      // Single message ID format
      if (args.length === 1) {
        const messageId = args[0];
        if (!/^\d{17,19}$/.test(messageId)) {
          return {
            success: false,
            error: 'Invalid message ID format. Message IDs should be 17-19 digits.',
          };
        }
      }
      // Channel ID + count format
      else if (args.length === 2) {
        const channelId = args[0];
        const countStr = args[1];

        if (!/^\d{17,19}$/.test(channelId)) {
          return {
            success: false,
            error: 'Invalid channel ID format. Channel IDs should be 17-19 digits.',
          };
        }

        const count = parseInt(countStr, 10);
        if (isNaN(count) || count < 1 || count > 50) {
          return {
            success: false,
            error: 'Count must be a number between 1 and 50.',
          };
        }
      }
      // Invalid format
      else {
        return {
          success: false,
          error: `Invalid delete command format. Use \`${this.commandPrefix}delete <CHANNEL_ID> <count>\` or \`${this.commandPrefix}delete <MESSAGE_ID>\`.`,
        };
      }
    }

    // Colorize command validation
    if (command === 'colorize') {
      // Basic validation - more detailed validation happens in the handler
      if (args.length === 0) {
        return {
          success: false,
          error: `Invalid usage. Use \`${this.commandPrefix}colorize help\` for usage information.`,
        };
      }

      // Check for overly long input to prevent abuse
      // Account for ANSI color codes which can add 50-100% overhead
      const totalArgLength = args.join(' ').length;
      if (totalArgLength > 1000) {
        return {
          success: false,
          error: 'Input text is too long. Maximum 1000 characters allowed (to account for color codes).',
        };
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

        case 'browser-health':
          return await this.handleBrowserHealth();

        case 'debug':
          return await this.handleDebugToggle(args);

        case 'debug-status':
          return await this.handleDebugStatus();

        case 'crash-status':
          return await this.handleCrashStatus();

        case 'debug-level':
          return await this.handleDebugLevel(args);

        case 'metrics':
          return await this.handleMetrics();

        case 'log-pipeline':
          return await this.handleLogPipeline();

        case 'memory-status':
          return await this.handleMemoryStatus();

        case 'delete':
          return await this.handleDelete(args, userId);

        case 'colorize':
          return await this.handleColorize(args, userId);

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
      `**${this.commandPrefix}crash-status**: Shows system health, memory usage, and recent crash information.`,
      `**${this.commandPrefix}debug-level <1-5>**: Sets debug level for all modules (1=errors, 5=verbose).`,
      `**${this.commandPrefix}debug-level <module1> <module2> ... <1-5>**: Sets debug level for specific modules.`,
      `**${this.commandPrefix}metrics**: Shows performance metrics and system statistics.`,
      `**${this.commandPrefix}memory-status**: Shows real-time memory analysis with content store breakdown.`,
      `**${this.commandPrefix}log-pipeline**: Shows recent pipeline activities with correlation tracking.`,
      `**${this.commandPrefix}health**: Shows bot health status and system information.`,
      `**${this.commandPrefix}health-detailed**: Shows detailed health status for all components.`,
      `**${this.commandPrefix}youtube-health**: Shows detailed YouTube monitor health status.`,
      `**${this.commandPrefix}x-health**: Shows detailed X scraper health status.`,
      `**${this.commandPrefix}browser-health**: Shows browser process memory usage and health status.`,
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
      `**${this.commandPrefix}delete <CHANNEL_ID> <count>**: Deletes the bot's most recent messages (1-50) from the specified channel.`,
      `**${this.commandPrefix}delete <MESSAGE_ID>**: Deletes a specific message by its ID.`,
      `**${this.commandPrefix}colorize "text" <preset>**: Creates colorized text using gradient presets (DM only).`,
      `**${this.commandPrefix}colorize advanced**: Starts multi-step custom gradient configuration (DM only).`,
      `**${this.commandPrefix}colorize help**: Shows detailed colorize command help and available presets.`,
    ];

    // Split into multiple messages to stay under Discord's 2000 character limit
    const generalSection = `**Discord Bot Message Commands**\n\nThese commands can only be used in the configured support channel.\n\n**General Commands:**\n${generalCommands.join('\n')}`;

    const adminSection = `**Admin Commands** (require \`ALLOWED_USER_IDS\` authorization):\n${adminCommands.join('\n')}`;

    return {
      success: true,
      message: generalSection,
      additionalMessage: adminSection,
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
   * Handle browser health command
   */
  async handleBrowserHealth() {
    try {
      const processCleanup = new ProcessCleanup(this.logger);
      const health = await processCleanup.checkBrowserHealth();

      const healthData = {
        browserProcessCount: health.processCount,
        memoryUsageMB: Math.round(health.memoryMB),
        healthy: health.healthy,
        warnings: health.warnings,
        timestamp: toISOStringUTC(),
      };

      return {
        success: true,
        message: health.healthy
          ? 'Browser processes are healthy'
          : `Browser health issues detected: ${health.warnings.join(', ')}`,
        requiresRestart: false,
        healthData,
        healthType: 'browser',
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to check browser health: ${error.message}`,
        requiresRestart: false,
      };
    }
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
   * Handle crash status command
   */
  async handleCrashStatus() {
    try {
      // Get memory usage
      const memUsage = process.memoryUsage();
      const memUsageMB = {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
      };

      // Get process information
      const uptime = Math.round(process.uptime());
      const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`;

      // Try to get recent crashes from crash detector
      let recentCrashes = [];
      let crashDetectorStatus = '❌ Not available';

      try {
        // Access crash detector via dependency container if available
        if (this.container && this.container.resolve) {
          const crashDetector = this.container.resolve('crashDetector');
          recentCrashes = crashDetector.getRecentCrashes(5);
          crashDetectorStatus = '✅ Active';
        }
      } catch (error) {
        // Crash detector not available
      }

      // Memory status
      let memoryStatus = '✅ Normal';
      if (memUsageMB.heapUsed > 2048) {
        memoryStatus = '🚨 Critical (>2GB)';
      } else if (memUsageMB.heapUsed > 1536) {
        memoryStatus = '⚠️ High (>1.5GB)';
      } else if (memUsageMB.heapUsed > 1024) {
        memoryStatus = '📊 Elevated (>1GB)';
      }

      const crashLines =
        recentCrashes.length > 0
          ? recentCrashes.map(crash => `• ${crash.type}: ${crash.details.timestamp || 'Unknown time'}`)
          : ['• No recent crashes detected'];

      const summary = [
        `🕵️ **System Health & Crash Status**`,
        ``,
        `**Process Information:**`,
        `🔗 PID: ${process.pid}`,
        `⏱️ Uptime: ${uptimeStr}`,
        `📱 Node.js: ${process.version}`,
        `🖥️ Platform: ${process.platform}`,
        ``,
        `**Memory Usage:**`,
        `${memoryStatus}`,
        `💾 Heap Used: ${memUsageMB.heapUsed} MB / ${memUsageMB.heapTotal} MB`,
        `🔧 External: ${memUsageMB.external} MB`,
        `📊 RSS: ${memUsageMB.rss} MB`,
        ``,
        `**Crash Detection:**`,
        `${crashDetectorStatus}`,
        `📝 Recent Crashes (last 5):`,
        ...crashLines,
      ].join('\n');

      return {
        success: true,
        message: summary,
        requiresRestart: false,
        crashStatus: {
          memoryUsage: memUsageMB,
          uptime,
          recentCrashes: recentCrashes.length,
          memoryStatus,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to get crash status: ${error.message}`,
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
   * Handle delete command
   * @param {Array<string>} args - Command arguments
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Command result
   */
  async handleDelete(args, userId) {
    if (args.length === 0) {
      return {
        success: false,
        message: `❌ Invalid usage. Use:\n• \`${this.commandPrefix}delete <CHANNEL_ID> <count>\` - Delete bot's recent messages (1-50)\n• \`${this.commandPrefix}delete <MESSAGE_ID>\` - Delete specific message`,
        requiresRestart: false,
      };
    }

    // Check if it's a single message ID (Discord message IDs are 17-19 digits)
    if (args.length === 1 && /^\d{17,19}$/.test(args[0])) {
      return {
        success: true,
        message: null, // No message here - deleteMessages will send its own messages
        requiresRestart: false,
        deleteAction: 'single',
        messageId: args[0],
        userId,
      };
    }

    // Check if it's channel ID + count
    if (args.length === 2) {
      const channelId = args[0];
      const count = parseInt(args[1], 10);

      // Validate channel ID format
      if (!/^\d{17,19}$/.test(channelId)) {
        return {
          success: false,
          message: '❌ Invalid channel ID format. Channel IDs should be 17-19 digits.',
          requiresRestart: false,
        };
      }

      // Validate count
      if (isNaN(count) || count < 1 || count > 50) {
        return {
          success: false,
          message: '❌ Count must be a number between 1 and 50.',
          requiresRestart: false,
        };
      }

      return {
        success: true,
        message: null, // No message here - deleteMessages will send its own messages
        requiresRestart: false,
        deleteAction: 'bulk',
        channelId,
        count,
        userId,
      };
    }

    return {
      success: false,
      message: `❌ Invalid usage. Use:\n• \`${this.commandPrefix}delete <CHANNEL_ID> <count>\` - Delete bot's recent messages (1-50)\n• \`${this.commandPrefix}delete <MESSAGE_ID>\` - Delete specific message`,
      requiresRestart: false,
    };
  }

  /**
   * Handle memory-status command
   */
  async handleMemoryStatus() {
    if (!this.memoryMonitor) {
      return {
        success: false,
        message: '❌ Memory monitor is not available.',
        requiresRestart: false,
      };
    }

    try {
      const stats = this.memoryMonitor.getStats();
      const detailed = this.memoryMonitor.getDetailedContentAnalysis();
      const currentMem = process.memoryUsage();
      const currentMB = Math.round(currentMem.heapUsed / 1024 / 1024);

      const summary = [
        `**💾 Memory Status Report**`,
        `🔍 Current: ${currentMB} MB heap used`,
        `📊 Peak: ${stats.peakMemoryMB} MB | Avg: ${stats.averageMemoryMB} MB`,
        `⚠️ Warning: ${stats.thresholds.warningMB} MB | Max: ${stats.thresholds.maxMB} MB`,
        `🗑️ GC Executions: ${stats.gcExecutions} | Warnings: ${stats.warningsIssued}`,
        ``,
      ];

      // Content stores analysis
      const { contentStores } = stats;
      if (contentStores && Object.keys(contentStores).length > 0) {
        summary.push(`**📦 Content Stores:**`);
        for (const [name, analysis] of Object.entries(contentStores)) {
          if (analysis.error) {
            summary.push(`❌ **${name}**: Error - ${analysis.error}`);
          } else {
            const sizeMB = analysis.totalSizeMB || 0;
            const items = analysis.totalItems || 0;
            const age = analysis.oldestItemHours ? `${Math.round(analysis.oldestItemHours)}h old` : 'unknown age';
            summary.push(`• **${name}**: ${items} items, ${sizeMB} MB, ${age}`);
          }
        }
        summary.push(``);
      }

      // Memory recommendations
      if (detailed.recommendations && detailed.recommendations.length > 0) {
        summary.push(`**💡 Recommendations:**`);
        for (const rec of detailed.recommendations) {
          summary.push(`• ${rec}`);
        }
        summary.push(``);
      }

      // Status indicator
      let statusIcon = '✅';
      let statusText = 'Healthy';
      if (currentMB > stats.thresholds.warningMB) {
        statusIcon = '⚠️';
        statusText = 'High Memory Usage';
      }
      if (currentMB > stats.thresholds.maxMB) {
        statusIcon = '🚨';
        statusText = 'Critical Memory Usage';
      }

      summary.unshift(`${statusIcon} **Status**: ${statusText}`);

      return {
        success: true,
        message: summary.join('\n'),
        requiresRestart: false,
        memoryData: { stats, detailed },
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to get memory status: ${error.message}`,
        requiresRestart: false,
      };
    }
  }

  /**
   * Handle log-pipeline command
   */
  async handleLogPipeline() {
    if (!this.metricsManager) {
      return {
        success: false,
        message: '❌ Metrics manager is not available.',
        requiresRestart: false,
      };
    }

    try {
      const recentOps = this.metricsManager.getRecentOperations(8);
      const stats = this.metricsManager.getStats();

      const activities = [
        `**📋 Recent Pipeline Activities**`,
        `⏱️ Uptime: ${Math.floor(stats.uptime / 60)}m | Metrics: ${stats.totalMetricsRecorded} total`,
        ``,
      ];

      if (recentOps.length === 0) {
        activities.push(`ℹ️ No recent operations recorded yet.`);
        activities.push(`🔄 Operations will appear here as enhanced logging captures activity.`);
      } else {
        activities.push(`**Last ${recentOps.length} Operations:**`);
        for (const op of recentOps) {
          const icon = op.success ? '✅' : '❌';
          const duration = op.duration ? `${op.duration}ms` : 'N/A';
          const timeDiff = Math.floor((Date.now() - op.timestamp) / 1000);
          const timeText = timeDiff < 60 ? `${timeDiff}s ago` : `${Math.floor(timeDiff / 60)}m ago`;

          // Format operation name for readability
          const opName = op.operation
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();

          activities.push(`${icon} **${opName}** (${duration}) - ${timeText}`);
        }
      }

      activities.push(``);

      // Add debugging status if available
      if (this.debugManager) {
        const enabledModules = this.debugManager.getEnabledModules();
        if (enabledModules.length > 0) {
          activities.push(`**🔍 Active Debug Modules:**`);
          for (const module of enabledModules) {
            const level = this.debugManager.getLevel(module);
            const levelName = this.debugManager.getLevelName(level);
            activities.push(`• **${module}**: level ${level} (${levelName})`);
          }
        } else {
          activities.push(`🔇 No debug modules currently active.`);
        }
      }

      return {
        success: true,
        message: activities.join('\n'),
        requiresRestart: false,
        logMessage: 'Log pipeline status requested',
        operationsData: { recentOps, stats },
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to get pipeline status: ${error.message}`,
        requiresRestart: false,
      };
    }
  }

  /**
   * Handle colorize command
   * @param {Array<string>} args - Command arguments
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Command result
   */
  async handleColorize(args, userId) {
    try {
      // Check if this is a session management command
      const firstArg = args[0]?.toLowerCase();

      if (firstArg === 'help') {
        return this.getColorizeHelp();
      }

      if (firstArg === 'cancel') {
        return this.cancelColorizeSession(userId);
      }

      if (firstArg === 'restart') {
        return this.restartColorizeSession(userId);
      }

      // Check if there's an active session
      const session = this.getColorizeSession(userId);

      if (session) {
        return this.handleColorizeSessionStep(args, userId, session);
      }

      // No active session - handle new colorize request
      if (firstArg === 'advanced') {
        return this.startAdvancedColorizeSession(userId);
      }

      // Simple mode - try to parse as one-liner
      return this.handleSimpleColorize(args);
    } catch (error) {
      return {
        success: false,
        message: `❌ Error processing colorize command: ${error.message}`,
        requiresRestart: false,
      };
    }
  }

  /**
   * Get colorize help information
   */
  getColorizeHelp() {
    const presets = [
      'rainbow',
      'pastel',
      'cristal',
      'teen',
      'mind',
      'morning',
      'vice',
      'passion',
      'fruit',
      'instagram',
      'retro',
      'summer',
      'dark',
    ];

    const helpText = [
      `**🎨 Colorize Command Help**`,
      ``,
      `**Simple Mode:**`,
      `\`!colorize "Your text here" <preset>\``,
      ``,
      `**Available Presets:**`,
      `${presets.map(p => `\`${p}\``).join(', ')}`,
      ``,
      `**Advanced Mode:**`,
      `\`!colorize advanced\` - Start multi-step configuration`,
      ``,
      `**Session Commands:**`,
      `\`!colorize cancel\` - Cancel current session`,
      `\`!colorize restart\` - Restart current step`,
      `\`!colorize help\` - Show this help`,
      ``,
      `**Examples:**`,
      `\`!colorize "Hello World!" rainbow\``,
      `\`!colorize "Gaming Time" vice\``,
      `\`!colorize advanced\` (for custom colors)`,
      ``,
      `**Note:** This command only works in DMs and is restricted to authorized users.`,
    ];

    return {
      success: true,
      message: helpText.join('\n'),
      requiresRestart: false,
    };
  }

  /**
   * Handle simple colorize mode
   * @param {Array<string>} args - Command arguments
   */
  handleSimpleColorize(args) {
    if (args.length < 2) {
      return {
        success: false,
        message: `❌ Invalid usage. Format: \`!colorize "text" <preset>\`\nUse \`!colorize help\` for more information.`,
        requiresRestart: false,
      };
    }

    // Extract text and preset
    const text = args
      .slice(0, -1)
      .join(' ')
      .replace(/^["']|["']$/g, ''); // Remove surrounding quotes
    const preset = args[args.length - 1].toLowerCase();

    // Validate preset
    const validPresets = [
      'rainbow',
      'pastel',
      'cristal',
      'teen',
      'mind',
      'morning',
      'vice',
      'passion',
      'fruit',
      'instagram',
      'retro',
      'summer',
      'dark',
    ];

    if (!validPresets.includes(preset)) {
      return {
        success: false,
        message: `❌ Invalid preset: \`${preset}\`\nValid presets: ${validPresets.map(p => `\`${p}\``).join(', ')}\nUse \`!colorize help\` for more information.`,
        requiresRestart: false,
      };
    }

    // Apply gradient
    try {
      const colorizedText = gradient[preset](text);

      // Check if result fits in Discord message
      const resultMessage = `🎨 **Colorized Text:**\n\`\`\`ansi\n${colorizedText}\n\`\`\``;

      if (resultMessage.length > 1950) {
        // Leave buffer for Discord
        return {
          success: true,
          message: [
            `🎨 **Colorized Text:**`,
            ``,
            `⚠️ **Result too long for Discord (${resultMessage.length} chars)**`,
            ``,
            `**Options:**`,
            `• Try with shorter text (under 500 characters)`,
            `• The colorization worked, but can't display here`,
            ``,
            `**Preview (first 100 chars):**`,
            `\`\`\`ansi\n${colorizedText.substring(0, 100)}...\n\`\`\``,
          ].join('\n'),
          requiresRestart: false,
          colorizeData: {
            originalText: text,
            preset,
            result: colorizedText,
            tooLong: true,
            resultLength: resultMessage.length,
          },
        };
      }

      return {
        success: true,
        message: resultMessage,
        requiresRestart: false,
        colorizeData: {
          originalText: text,
          preset,
          result: colorizedText,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to apply gradient: ${error.message}`,
        requiresRestart: false,
      };
    }
  }

  /**
   * Start advanced colorize session
   * @param {string} userId - User ID
   */
  startAdvancedColorizeSession(userId) {
    const session = {
      userId,
      mode: 'advanced',
      step: 1,
      config: {},
      timestamp: Date.now(),
    };

    this.setColorizeSession(userId, session);

    const message = [
      `🎨 **Starting Advanced Colorize Session**`,
      ``,
      `**Step 1/4: Choose Gradient Type**`,
      ``,
      `Choose one of the following options:`,
      `• Type \`preset\` to use a built-in gradient`,
      `• Type \`custom\` to define your own colors`,
      ``,
      `You can type \`!colorize cancel\` to cancel or \`!colorize help\` for help.`,
    ];

    return {
      success: true,
      message: message.join('\n'),
      requiresRestart: false,
      colorizeSession: true,
    };
  }

  /**
   * Handle colorize session step
   * @param {Array<string>} args - Command arguments
   * @param {string} userId - User ID
   * @param {Object} session - Current session
   */
  handleColorizeSessionStep(args, userId, session) {
    const input = args.join(' ').trim();

    switch (session.step) {
      case 1:
        return this.handleGradientTypeStep(input, userId, session);
      case 2:
        return this.handleGradientConfigStep(input, userId, session);
      case 3:
        return this.handleOptionsStep(input, userId, session);
      case 4:
        return this.handleTextInputStep(input, userId, session);
      default:
        return {
          success: false,
          message: '❌ Invalid session state.',
          requiresRestart: false,
        };
    }
  }

  /**
   * Handle gradient type selection step
   */
  handleGradientTypeStep(input, userId, session) {
    const type = input.toLowerCase();

    if (type === 'preset') {
      session.config.type = 'preset';
      session.step = 2;
      this.setColorizeSession(userId, session);

      const presets = [
        'rainbow',
        'pastel',
        'cristal',
        'teen',
        'mind',
        'morning',
        'vice',
        'passion',
        'fruit',
        'instagram',
        'retro',
        'summer',
        'dark',
      ];

      const message = [
        `🎨 **Step 2/4: Choose Preset**`,
        ``,
        `Available presets:`,
        `${presets.map(p => `\`${p}\``).join(', ')}`,
        ``,
        `Type the name of the preset you want to use.`,
      ];

      return {
        success: true,
        message: message.join('\n'),
        requiresRestart: false,
        colorizeSession: true,
      };
    } else if (type === 'custom') {
      session.config.type = 'custom';
      session.step = 2;
      this.setColorizeSession(userId, session);

      const message = [
        `🎨 **Step 2/4: Define Custom Colors**`,
        ``,
        `Enter your colors separated by spaces. You can use:`,
        `• Hex codes: \`#ff0000 #00ff00 #0000ff\``,
        `• CSS names: \`red green blue\``,
        `• RGB: \`rgb(255,0,0) rgb(0,255,0) rgb(0,0,255)\``,
        ``,
        `Minimum 2 colors, maximum 10 colors.`,
        ``,
        `Example: \`#ff6b6b #4ecdc4 #45b7d1\``,
      ];

      return {
        success: true,
        message: message.join('\n'),
        requiresRestart: false,
        colorizeSession: true,
      };
    } else {
      return {
        success: false,
        message: `❌ Invalid choice. Please type \`preset\` or \`custom\`.`,
        requiresRestart: false,
        colorizeSession: true,
      };
    }
  }

  /**
   * Handle gradient configuration step
   */
  handleGradientConfigStep(input, userId, session) {
    if (session.config.type === 'preset') {
      const presets = [
        'rainbow',
        'pastel',
        'cristal',
        'teen',
        'mind',
        'morning',
        'vice',
        'passion',
        'fruit',
        'instagram',
        'retro',
        'summer',
        'dark',
      ];

      if (!presets.includes(input.toLowerCase())) {
        return {
          success: false,
          message: `❌ Invalid preset. Choose from: ${presets.map(p => `\`${p}\``).join(', ')}`,
          requiresRestart: false,
          colorizeSession: true,
        };
      }

      session.config.preset = input.toLowerCase();
    } else {
      // Custom colors
      const colors = input.split(/\s+/).filter(c => c.trim());

      if (colors.length < 2) {
        return {
          success: false,
          message: `❌ You need at least 2 colors. Currently have ${colors.length}.`,
          requiresRestart: false,
          colorizeSession: true,
        };
      }

      if (colors.length > 10) {
        return {
          success: false,
          message: `❌ Maximum 10 colors allowed. Currently have ${colors.length}.`,
          requiresRestart: false,
          colorizeSession: true,
        };
      }

      // Validate colors (basic validation)
      for (const color of colors) {
        if (!this.isValidColor(color)) {
          return {
            success: false,
            message: `❌ Invalid color format: \`${color}\`\nUse hex (#ff0000), CSS names (red), or RGB (rgb(255,0,0)).`,
            requiresRestart: false,
            colorizeSession: true,
          };
        }
      }

      session.config.colors = colors;
    }

    session.step = 3;
    this.setColorizeSession(userId, session);

    const message = [
      `🎨 **Step 3/4: Gradient Options**`,
      ``,
      `Configure additional options (optional):`,
      ``,
      `**Direction:**`,
      `• \`horizontal\` (default) - Left to right`,
      `• \`vertical\` - Top to bottom`,
      `• \`diagonal\` - Diagonal gradient`,
      ``,
      `**Example:** \`horizontal\` or just press Enter to skip to text input.`,
    ];

    return {
      success: true,
      message: message.join('\n'),
      requiresRestart: false,
      colorizeSession: true,
    };
  }

  /**
   * Handle options step
   */
  handleOptionsStep(input, userId, session) {
    const trimmedInput = input.trim().toLowerCase();

    // Set default options
    session.config.direction = 'horizontal';

    if (trimmedInput) {
      const validDirections = ['horizontal', 'vertical', 'diagonal'];
      if (validDirections.includes(trimmedInput)) {
        session.config.direction = trimmedInput;
      } else if (trimmedInput !== '') {
        return {
          success: false,
          message: `❌ Invalid direction. Use: ${validDirections.map(d => `\`${d}\``).join(', ')} or press Enter to skip.`,
          requiresRestart: false,
          colorizeSession: true,
        };
      }
    }

    session.step = 4;
    this.setColorizeSession(userId, session);

    const message = [
      `🎨 **Step 4/4: Enter Your Text**`,
      ``,
      `Enter the text you want to colorize:`,
      `• Maximum 1000 characters (Discord limit with color codes)`,
      `• Multiline text is supported`,
      `• Just type your text and press Enter`,
      ``,
      `Current configuration:`,
      session.config.type === 'preset'
        ? `• Preset: \`${session.config.preset}\``
        : `• Colors: ${session.config.colors.map(c => `\`${c}\``).join(' ')}`,
      `• Direction: \`${session.config.direction}\``,
    ];

    return {
      success: true,
      message: message.join('\n'),
      requiresRestart: false,
      colorizeSession: true,
    };
  }

  /**
   * Handle text input step and generate final result
   */
  handleTextInputStep(input, userId, session) {
    if (!input.trim()) {
      return {
        success: false,
        message: `❌ Please enter some text to colorize.`,
        requiresRestart: false,
        colorizeSession: true,
      };
    }

    if (input.length > 1000) {
      return {
        success: false,
        message: `❌ Text too long (${input.length} characters). Maximum 1000 characters allowed.`,
        requiresRestart: false,
        colorizeSession: true,
      };
    }

    try {
      let colorizedText;

      if (session.config.type === 'preset') {
        colorizedText = gradient[session.config.preset](input);
      } else {
        // Create custom gradient
        const gradientColors = session.config.colors;
        colorizedText = gradient(gradientColors)(input);
      }

      // Clear the session
      this.clearColorizeSession(userId);

      // Check if the result will fit in a Discord message
      const resultMessage = `\`\`\`ansi\n${colorizedText}\n\`\`\``;
      const headerInfo = [
        `🎨 **Colorized Text Complete!**`,
        ``,
        `**Configuration:**`,
        session.config.type === 'preset'
          ? `• Preset: \`${session.config.preset}\``
          : `• Colors: ${session.config.colors.join(' → ')}`,
        `• Direction: \`${session.config.direction}\``,
        `• Text length: ${input.length} characters`,
        ``,
        `**Result:**`,
      ].join('\n');

      const totalLength = headerInfo.length + resultMessage.length;

      if (totalLength > 1950) {
        // Leave some buffer for Discord
        // Provide fallback options
        const fallbackMessage = [
          `🎨 **Colorized Text Complete!**`,
          ``,
          `**Configuration:**`,
          session.config.type === 'preset'
            ? `• Preset: \`${session.config.preset}\``
            : `• Colors: ${session.config.colors.join(' → ')}`,
          `• Direction: \`${session.config.direction}\``,
          `• Text length: ${input.length} characters`,
          ``,
          `⚠️ **Result too long for Discord (${totalLength} chars)**`,
          ``,
          `**Options:**`,
          `• Try with shorter text (under 500 characters)`,
          `• Use simple mode: \`!colorize "shorter text" ${session.config.preset || 'rainbow'}\``,
          `• The colorization worked, but can't display here`,
          ``,
          `**Preview (first 100 chars):**`,
          `\`\`\`ansi\n${colorizedText.substring(0, 100)}...\n\`\`\``,
        ];

        return {
          success: true,
          message: fallbackMessage.join('\n'),
          requiresRestart: false,
          colorizeData: {
            originalText: input,
            config: session.config,
            result: colorizedText,
            tooLong: true,
            resultLength: totalLength,
          },
        };
      }

      const message = [headerInfo, resultMessage].join('\n');

      return {
        success: true,
        message,
        requiresRestart: false,
        colorizeData: {
          originalText: input,
          config: session.config,
          result: colorizedText,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to apply gradient: ${error.message}`,
        requiresRestart: false,
        colorizeSession: true,
      };
    }
  }

  /**
   * Cancel colorize session
   */
  cancelColorizeSession(userId) {
    const session = this.getColorizeSession(userId);

    if (!session) {
      return {
        success: false,
        message: `❌ No active colorize session to cancel.`,
        requiresRestart: false,
      };
    }

    this.clearColorizeSession(userId);

    return {
      success: true,
      message: `🎨 Colorize session cancelled.`,
      requiresRestart: false,
    };
  }

  /**
   * Restart colorize session
   */
  restartColorizeSession(userId) {
    const session = this.getColorizeSession(userId);

    if (!session) {
      return {
        success: false,
        message: `❌ No active colorize session to restart.`,
        requiresRestart: false,
      };
    }

    // Reset to step 1
    session.step = 1;
    session.config = {};
    session.timestamp = Date.now();
    this.setColorizeSession(userId, session);

    return this.startAdvancedColorizeSession(userId);
  }

  /**
   * Get colorize session for user
   */
  getColorizeSession(userId) {
    const sessions = this.state.get('colorizeSessions', {});
    const session = sessions[userId];

    // Check if session is expired (10 minutes)
    if (session && Date.now() - session.timestamp > 10 * 60 * 1000) {
      this.clearColorizeSession(userId);
      return null;
    }

    return session;
  }

  /**
   * Set colorize session for user
   */
  setColorizeSession(userId, session) {
    const sessions = this.state.get('colorizeSessions', {});
    sessions[userId] = session;
    this.state.set('colorizeSessions', sessions);
  }

  /**
   * Clear colorize session for user
   */
  clearColorizeSession(userId) {
    const sessions = this.state.get('colorizeSessions', {});
    delete sessions[userId];
    this.state.set('colorizeSessions', sessions);
  }

  /**
   * Basic color validation
   */
  isValidColor(color) {
    // Hex color (3 or 6 digits)
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
      return true;
    }

    // RGB color
    if (/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i.test(color)) {
      return true;
    }

    // Common CSS color names
    const cssColors = [
      'red',
      'green',
      'blue',
      'yellow',
      'orange',
      'purple',
      'pink',
      'brown',
      'black',
      'white',
      'gray',
      'grey',
      'cyan',
      'magenta',
      'lime',
      'navy',
      'teal',
      'silver',
      'maroon',
      'olive',
      'aqua',
      'fuchsia',
      'gold',
      'indigo',
      'violet',
      'coral',
      'salmon',
      'khaki',
      'plum',
      'orchid',
    ];

    return cssColors.includes(color.toLowerCase());
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
        'crash-status',
        'debug-level',
        'metrics',
        'memory-status',
        'log-pipeline',
        'delete',
        'colorize',
      ],
      restrictedCommands: [
        'restart',
        'kill',
        'update',
        'restart-scraper',
        'stop-scraper',
        'start-scraper',
        'force-reauth',
        'delete',
        'colorize',
      ],
      allowedUsers: this.getAllowedUserIds().length,
      commandPrefix: this.commandPrefix,
    };
  }
}
