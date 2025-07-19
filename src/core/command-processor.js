/**
 * Pure business logic for processing Discord bot commands
 * No side effects - only processes input and returns command results
 */
export class CommandProcessor {
  constructor(config, stateManager) {
    this.config = config;
    this.state = stateManager;
    this.commandPrefix = config.get('COMMAND_PREFIX', '!');

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
      const validLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
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
    const restrictedCommands = ['restart', 'kill', 'update'];

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

      const validLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
      if (!validLevels.includes(newLevel)) {
        return {
          success: false,
          error: `Invalid log level. Valid levels are: ${validLevels.join(', ')}.`,
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
    // Validate command
    const validation = this.validateCommand(command, args, userId);
    if (!validation.success) {
      return {
        success: false,
        message: `❌ ${validation.error}`,
        requiresRestart: false,
      };
    }

    // Check authorization
    if (!this.isUserAuthorized(userId, command)) {
      return {
        success: false,
        message: '🚫 You are not authorized to use this command.',
        requiresRestart: false,
      };
    }

    // Process specific commands
    switch (command) {
      case 'restart':
        return await this.handleRestart(userId);

      case 'kill':
        return await this.handleKill(userId);

      case 'announce':
        return await this.handleAnnounce(args);

      case 'vxtwitter':
        return await this.handleVxTwitter(args);

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

      default:
        return {
          success: false,
          message: `❓ Unknown command: \`${command}\`. Use \`${this.commandPrefix}readme\` for help.`,
          requiresRestart: false,
        };
    }
  }

  /**
   * Handle restart command
   */
  async handleUpdate(userId) {
    return {
      success: true,
      message: '🚀 Initiating update... Pulling latest changes, please wait for confirmation.',
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
    const currentTime = new Date();
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
      botStartTime: botStartTime ? botStartTime.toLocaleString() : 'Unknown',
      timestamp: currentTime.toISOString(),
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
    const commandList = [
      `**${this.commandPrefix}kill**: Stops *all* bot posting to Discord channels (announcements and support log).`,
      `**${this.commandPrefix}restart**: Performs a full restart of the bot, reloading the .env file and all configurations. Requires specific user authorization (\`ALLOWED_USER_IDS\`).`,
      `**${this.commandPrefix}announce <true|false>**: Toggles announcement posting to non-support channels.`,
      `**${this.commandPrefix}vxtwitter <true|false>**: Toggles the conversion of \`x.com\` URLs to \`vxtwitter.com\` in announcements.`,
      `**${this.commandPrefix}loglevel <level>**: Changes the bot's logging level (e.g., info, debug).`,
      `**${this.commandPrefix}health**: Shows bot health status and system information.`,
      `**${this.commandPrefix}health-detailed**: Shows detailed health status for all components.`,
      `**${this.commandPrefix}update**: Pulls the latest changes from git, updates dependencies, and restarts the bot.`,
      `**${this.commandPrefix}readme**: Displays this command information.`,
    ];

    const readmeMessage = `**Discord Bot Message Commands**\n\nThese commands can only be used in the configured support channel.\n\n${commandList.join('\n')}`;

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
        'readme',
        'update',
      ],
      restrictedCommands: ['restart', 'kill', 'update'],
      allowedUsers: this.getAllowedUserIds().length,
      commandPrefix: this.commandPrefix,
    };
  }
}
