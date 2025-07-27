import { exec as defaultExec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { CommandRateLimit } from '../rate-limiter.js';
import { nowUTC } from '../utilities/utc-time.js';
import { createEnhancedLogger } from '../utilities/enhanced-logger.js';

// Global message processing tracker to detect duplicates across all instances
const globalMessageTracker = new Map();

/**
 * Main bot application orchestrator
 * Coordinates Discord client, command processing, and event handling
 */
export class BotApplication {
  constructor(dependencies) {
    // Add unique instance ID for debugging
    this.instanceId = `${nowUTC().getTime()}-${Math.random().toString(36).substring(2, 11)}`;
    this.exec = dependencies.exec || defaultExec;
    this.scraperApplication = dependencies.scraperApplication;
    this.monitorApplication = dependencies.monitorApplication;
    this.youtubeScraper = dependencies.youtubeScraperService;
    this.discord = dependencies.discordService;
    this.commandProcessor = dependencies.commandProcessor;
    this.eventBus = dependencies.eventBus;
    this.config = dependencies.config;
    this.state = dependencies.stateManager;

    // Create enhanced logger for this module
    this.logger = createEnhancedLogger(
      'api',
      dependencies.logger,
      dependencies.debugManager,
      dependencies.metricsManager
    );

    // Log BotApplication instance creation
    this.logger.info('BotApplication instance created', {
      botInstanceId: this.instanceId,
      discordClientInstanceId: this.discord.client?._botInstanceId || 'unknown',
    });

    // Initialize rate limiter for commands
    this.commandRateLimit = new CommandRateLimit(5, 60000); // 5 commands per minute

    // Bot configuration
    this.commandPrefix = this.config.get('COMMAND_PREFIX', '!');
    this.supportChannelId = this.config.get('DISCORD_BOT_SUPPORT_LOG_CHANNEL');
    this.allowedUserIds = this.getAllowedUserIds();

    // State initialization
    this.initializeState();

    // Event handler cleanup functions
    this.eventCleanup = [];
    this.isRunning = false;
    this.buildInfo = this.loadBuildInfo();

    // Debug: Message processing counter to detect duplicates
    this.messageProcessingCounter = new Map();
  }

  loadBuildInfo() {
    try {
      const buildInfoPath = path.join(process.cwd(), 'build-version.json');
      const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
      return buildInfo;
    } catch (error) {
      this.logger.error('Could not load build information:', error);
      return { version: 'N/A', build: 'N/A' };
    }
  }

  /**
   * Initialize bot state
   */
  initializeState() {
    // Set default state values
    this.state.set('postingEnabled', true);
    this.state.set('announcementEnabled', this.config.getBoolean('ANNOUNCEMENT_ENABLED', false));
    this.state.set('vxTwitterConversionEnabled', this.config.getBoolean('X_VX_TWITTER_CONVERSION', false));
    this.state.set('logLevel', this.config.get('LOG_LEVEL', 'info'));
    this.state.set('botStartTime', new Date());
  }

  /**
   * Get allowed user IDs from configuration
   * @returns {Array<string>} Array of allowed user IDs
   */
  getAllowedUserIds() {
    const allowedUserIdsStr = this.config.get('ALLOWED_USER_IDS', '');
    return allowedUserIdsStr ? allowedUserIdsStr.split(',').map(id => id.trim()) : [];
  }

  /**
   * Start the bot application
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('Bot application is already running, ignoring start() call', {
        botInstanceId: this.instanceId,
        discordInstanceId: this.discord.client?._botInstanceId || 'unknown',
      });
      throw new Error('Bot application is already running');
    }

    const operation = this.logger.startOperation('startBotApplication', {
      botInstanceId: this.instanceId,
      discordInstanceId: this.discord.client?._botInstanceId || 'unknown',
    });

    try {
      operation.progress('Logging in to Discord');
      const token = this.config.getRequired('DISCORD_BOT_TOKEN');
      await this.discord.login(token);

      operation.progress('Setting up Discord event handlers');
      this.setupEventHandlers();

      operation.progress('Setting bot presence');
      await this.setBotPresence();

      operation.progress('Starting YouTube Scraper if configured');
      if (this.youtubeScraper) {
        try {
          const youtubeChannelHandle = this.config.get('YOUTUBE_CHANNEL_HANDLE');
          if (youtubeChannelHandle) {
            await this.youtubeScraper.initialize(youtubeChannelHandle);
            await this.youtubeScraper.startMonitoring();
          } else {
            this.logger.info('YOUTUBE_CHANNEL_HANDLE not configured, YouTube scraper will not start.');
          }
        } catch (error) {
          operation.error(error, 'Failed to start YouTube Scraper');
        }
      }

      this.isRunning = true;

      // Emit start event
      this.eventBus.emit('bot.started', {
        startTime: this.state.get('botStartTime'),
        config: this.config.getAllConfig(false), // Don't include secrets
      });

      return operation.success('Bot application started successfully', {
        botInstanceId: this.instanceId,
        discordClientReady: this.discord.isReady(),
      });
    } catch (error) {
      operation.error(error, 'Failed to start bot application');
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop the bot application
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    try {
      this.logger.info('Stopping bot application...');

      // Clean up event handlers
      this.cleanupEventHandlers();

      // Disconnect from Discord
      await this.discord.destroy();

      // Stop YouTube Scraper
      if (this.youtubeScraper) {
        await this.youtubeScraper.cleanup();
      }

      this.isRunning = false;
      this.logger.info('Bot application stopped');

      // Emit stop event
      this.eventBus.emit('bot.stopped', {
        stopTime: nowUTC(),
      });
    } catch (err) {
      this.logger.error('Error stopping bot application:', err);
    }
  }

  /**
   * Perform a soft restart of the bot
   * @returns {Promise<void>}
   */
  async handleUpdate(message) {
    const serviceName = this.config.get('SYSTEMD_SERVICE_NAME');
    if (!serviceName) {
      this.logger.error('SYSTEMD_SERVICE_NAME is not configured.');
      if (message) {
        await message.reply('❌ Update functionality is not configured on the server.');
      }
      return;
    }

    // Send initial update message
    if (message) {
      await message.reply('🚀 Initiating update... Pulling latest changes, please wait for confirmation.');
    }

    this.exec('git pull', async (error, stdout) => {
      if (error) {
        this.logger.error(`git pull failed: ${error}`);
        if (message) {
          await message.reply(`❌ **Git pull failed:**\n\`\`\`ansi\n${this._formatGitPullOutput(error.message)}\`\`\``);
        }
        return;
      }

      if (message) {
        const formattedOutput = this._formatGitPullOutput(stdout || 'No new changes.');
        const output = `**✅ Git pull successful:**\n\`\`\`ansi\n${formattedOutput}\`\`\``;
        await message.reply(output);
      }

      // Delay restart to ensure the message is sent
      setTimeout(() => {
        this.exec(`sudo systemctl restart ${serviceName}`, restartError => {
          if (restartError) {
            this.logger.error(`systemctl restart failed: ${restartError}`);
            // We cannot reply here as the bot might be down
          } else {
            this.logger.info('Systemd restart command issued successfully.');
          }
        });
      }, 5000); // 5-second delay
    });
  }

  async softRestart() {
    this.logger.info('Requesting full bot restart...');
    this.eventBus.emit('bot.request_restart');
  }

  /**
   * Set up Discord event handlers
   */
  setupEventHandlers() {
    this.logger.info('Setting up Discord event handlers', {
      existingHandlerCount: this.eventCleanup.length,
      instanceId: this.discord.client?._botInstanceId || 'unknown',
    });

    // Check if handlers are already set up
    if (this.eventCleanup.length > 0) {
      this.logger.warn('Event handlers already exist! This might cause duplicates', {
        existingHandlerCount: this.eventCleanup.length,
        instanceId: this.discord.client?._botInstanceId || 'unknown',
      });
    }

    // Message handler
    const messageHandler = async message => {
      await this.handleMessage(message);
    };

    // Ready handler
    const readyHandler = async () => {
      await this.handleReady();
    };

    // Error handler
    const errorHandler = error => {
      this.handleError(error);
    };

    // Register handlers and store cleanup functions
    this.eventCleanup.push(this.discord.onMessage(messageHandler));
    this.eventCleanup.push(this.discord.onReady(readyHandler));
    this.eventCleanup.push(this.discord.onError(errorHandler));

    this.logger.info('Discord event handlers registered', {
      totalHandlerCount: this.eventCleanup.length,
      instanceId: this.discord.client?._botInstanceId || 'unknown',
    });

    // State change handlers
    this.eventCleanup.push(
      this.state.subscribe('logLevel', newLevel => {
        this.handleLogLevelChange(newLevel);
      })
    );
  }

  /**
   * Clean up event handlers
   */
  cleanupEventHandlers() {
    this.logger.info(`Cleaning up ${this.eventCleanup.length} event handlers`);
    for (const cleanup of this.eventCleanup) {
      try {
        cleanup();
      } catch (error) {
        this.logger.warn('Error cleaning up event handler:', error);
      }
    }
    this.eventCleanup = [];
    this.logger.info('Event handlers cleanup completed');
  }

  /**
   * Handle Discord message events
   * @param {Object} message - Discord message object
   */
  async handleMessage(message) {
    const operation = this.logger.startOperation('handleMessage', {
      messageId: message.id,
      authorId: message.author?.id,
      channelId: message.channel?.id,
      contentPreview: message.content?.substring(0, 50) || 'empty',
      instanceId: this.instanceId,
    });

    let command = 'unknown';

    try {
      // ATOMIC DUPLICATE PREVENTION - Must be FIRST thing we do
      const isCommand = message.content?.startsWith(this.commandPrefix);

      if (isCommand) {
        operation.progress('Performing duplicate command detection');
        const globalKey = `${message.id}-${message.content}`;

        // ATOMIC CHECK-AND-SET to prevent race conditions
        if (globalMessageTracker.has(globalKey)) {
          const currentCount = globalMessageTracker.get(globalKey) + 1;
          globalMessageTracker.set(globalKey, currentCount);

          return operation.success('Duplicate command blocked', {
            messageId: message.id,
            duplicateCount: currentCount,
            action: 'blocked_duplicate',
          });
        }

        // ATOMICALLY mark as processing (first instance wins)
        globalMessageTracker.set(globalKey, 1);
      }

      operation.progress('Validating message and author');
      // Ignore bot messages and non-command messages
      if (message.author.bot || !message.content.startsWith(this.commandPrefix)) {
        if (message.author.bot) {
          return operation.success('Ignoring bot message', {
            messageId: message.id,
            authorId: message.author?.id,
            action: 'ignored_bot',
          });
        }
        return operation.success('Ignoring non-command message', {
          action: 'ignored_non_command',
        });
      }

      // Additional safety check: Ignore messages from this bot specifically
      const currentBotUser = await this.discord.getCurrentUser();
      if (currentBotUser && message.author.id === currentBotUser.id) {
        return operation.success('Ignoring message from self', {
          messageId: message.id,
          authorId: message.author?.id,
          botUserId: currentBotUser.id,
          action: 'ignored_self',
        });
      }

      // Ensure Discord client is ready before processing
      if (!this.discord.isReady()) {
        return operation.error(new Error('Discord client not ready'), 'Discord client not ready', {
          messageId: message.id,
          authorId: message.author?.id,
        });
      }

      operation.progress('Parsing command and validating user');
      // Parse command and get user info
      const args = message.content.slice(this.commandPrefix.length).trim().split(/ +/);
      command = args.shift().toLowerCase();
      const user = message.author;

      // Only process messages in the support channel or from admin in any other channel
      if (!user && this.supportChannelId && message.channel.id !== this.supportChannelId) {
        return operation.success('Message not in support channel', {
          action: 'ignored_wrong_channel',
        });
      }

      // Validate user
      if (!user || !user.id) {
        return operation.error(new Error('Invalid user object'), 'Received message from invalid user object');
      }

      operation.progress('Checking rate limits');
      // Rate limiting check
      if (!this.commandRateLimit.isAllowed(user.id)) {
        const remainingTime = Math.ceil(this.commandRateLimit.getRemainingTime(user.id) / 1000);
        await message.reply(
          `🚫 Rate limit exceeded. Please wait ${remainingTime} seconds before using another command.`
        );
        return operation.success('Rate limit exceeded', {
          userId: user.id,
          remainingTime,
          action: 'rate_limited',
        });
      }

      operation.progress('Gathering application statistics');
      // Process command
      const appStats = {
        bot: this.getStats(),
        scraper: this.scraperApplication.getStats(),
        monitor: this.monitorApplication.getStats(),
        youtubeScraper: this.youtubeScraper ? this.youtubeScraper.getMetrics() : null,
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString(),
        },
      };

      operation.progress(`Processing command: ${command}`);
      const result = await this.commandProcessor.processCommand(command, args, user.id, appStats);

      operation.progress('Handling command result');
      await this.handleCommandResult(message, result, command, user);

      operation.progress('Performing cleanup tasks');
      // Cleanup: Remove old message tracking entries to prevent memory leaks
      if (this.messageProcessingCounter.size > 1000) {
        const entries = Array.from(this.messageProcessingCounter.entries());
        // Keep only the most recent 500 entries
        const recentEntries = entries.slice(-500);
        this.messageProcessingCounter.clear();
        recentEntries.forEach(([key, value]) => {
          this.messageProcessingCounter.set(key, value);
        });
      }

      // Global cleanup: Prevent memory leaks in global tracker
      if (globalMessageTracker.size > 1000) {
        const globalEntries = Array.from(globalMessageTracker.entries());
        const recentGlobalEntries = globalEntries.slice(-500);
        globalMessageTracker.clear();
        recentGlobalEntries.forEach(([key, value]) => {
          globalMessageTracker.set(key, value);
        });
      }

      return operation.success('Message processed successfully', {
        command,
        userId: user.id,
        success: result.success,
        messageId: message.id,
      });
    } catch (error) {
      operation.error(error, 'Error processing message command', {
        messageId: message.id,
        command: command || 'unknown',
      });
      try {
        await message.reply('❌ An error occurred while processing your command. Please try again.');
      } catch (replyError) {
        this.logger.error('Failed to send error reply:', replyError);
      }
    }
  }

  /**
   * Handle command processing result
   * @param {Object} message - Original Discord message
   * @param {Object} result - Command result
   * @param {string} command - Command name
   * @param {Object} user - Discord user
   */
  async handleCommandResult(message, result, command, user) {
    try {
      // Send response message
      if (result.message) {
        if (result.healthData) {
          if (command === 'health-detailed' || command === 'hd') {
            const healthEmbed = this.createDetailedHealthEmbed(result.healthData);
            await message.reply({ embeds: [healthEmbed] });
          } else if (command === 'health') {
            const healthEmbed = this.createHealthEmbed(result.healthData);
            await message.reply({ embeds: [healthEmbed] });
          } else if (command === 'youtube-health') {
            const healthEmbed = this.createYoutubeHealthEmbed(result.healthData);
            await message.reply({ embeds: [healthEmbed] });
          } else if (command === 'x-health') {
            const healthEmbed = this.createXHealthEmbed(result.healthData);
            await message.reply({ embeds: [healthEmbed] });
          }
        } else {
          await message.reply(result.message);
        }
      }

      // Log command execution
      if (result.logMessage && result.userId) {
        this.logger.warn(
          `${user.tag} (${user.id}) executed ${this.commandPrefix}${command} command. ${result.logMessage}`
        );
      }

      // Handle restart request (consume the flag)
      if (result.requiresRestart) {
        result.requiresRestart = false; // Consume the flag to prevent duplicate processing
        try {
          await message.channel.send('✅ Full restart initiated. See you in a moment!');
          await this.softRestart();
        } catch (error) {
          this.logger.error('Soft restart failed:', error);
          await message.channel.send('❌ Soft restart failed. Check logs for details.');
        }
      }

      if (result.requiresUpdate) {
        result.requiresUpdate = false; // Consume the flag to prevent duplicate processing
        await this.handleUpdate(message);
      }

      // Handle log level change
      if (result.newLogLevel) {
        this.handleLogLevelChange(result.newLogLevel);
      }

      // Handle scraper actions (consume the flag)
      if (result.scraperAction) {
        const { scraperAction } = result;
        const { userId } = result;
        result.scraperAction = null; // Consume the flag to prevent duplicate processing
        await this.handleScraperAction(scraperAction, userId, message);
      }
    } catch (error) {
      this.logger.error('Error handling command result:', error);
    }
  }

  /**
   * Create health status embed
   * @param {Object} healthData - Health data from command processor
   * @returns {Object} Discord embed object
   */
  createHealthEmbed(healthData) {
    return {
      title: '🏥 Bot Health Status',
      color: this.discord.isReady() ? 0x00ff00 : 0xff0000, // Green if ready, red if not
      fields: [
        {
          name: '🤖 Discord Connection',
          value: this.discord.isReady() ? `✅ Connected (${this.discord.getLatency()}ms ping)` : '❌ Disconnected',
          inline: true,
        },
        {
          name: '⏱️ Uptime',
          value: healthData.uptime,
          inline: true,
        },
        {
          name: '💾 Memory Usage',
          value: healthData.memoryUsage,
          inline: true,
        },
        {
          name: '📡 Posting Status',
          value: healthData.postingStatus === 'Enabled' ? '✅ Enabled' : '❌ Disabled',
          inline: true,
        },
        {
          name: '📢 Announcements',
          value: healthData.announcements === 'Enabled' ? '✅ Enabled' : '❌ Disabled',
          inline: true,
        },
        {
          name: '🐦 VX Twitter',
          value: healthData.vxTwitter === 'Enabled' ? '✅ Enabled' : '❌ Disabled',
          inline: true,
        },
      ],
      timestamp: healthData.timestamp,
      footer: {
        text: `Bot v${this.buildInfo.version} (Build ${this.buildInfo.build}) | Started: ${healthData.botStartTime}`,
      },
    };
  }

  /**
   * Create detailed health status embed
   * @param {Object} healthData - Health data from command processor
   * @returns {Object} Discord embed object
   */
  createDetailedHealthEmbed(healthData) {
    const { bot, scraper, monitor, youtubeScraper, system } = healthData;
    const uptimeStr = new Date(system.uptime * 1000).toISOString().substring(11, 19);
    const formatMemory = bytes => `${Math.round(bytes / 1024 / 1024)} MB`;
    const nextPoll = scraper.pollingInterval.next;
    let nextPollStr = 'Not scheduled';
    if (scraper.isRunning) {
      if (nextPoll) {
        nextPollStr = `<t:${Math.round(nextPoll / 1000)}:R>`;
      } else {
        nextPollStr = 'In progress...';
      }
    }

    return {
      title: '🤖 Detailed Bot Health Status 📊',
      color: this.discord.isReady() ? 0x00ff00 : 0xff0000,
      fields: [
        { name: '📡 Discord Latency', value: `${this.discord.getLatency()}ms`, inline: true },
        {
          name: '▶️ YouTube Monitor',
          value: `Status: ${monitor.isRunning ? '✅ Running' : '❌ Stopped'}`,
          inline: true,
        },
        { name: '🐦 X Scraper', value: `Status: ${scraper.isRunning ? '✅ Running' : '❌ Stopped'}`, inline: true },
        {
          name: '📺 YouTube Scraper',
          value: `Status: ${youtubeScraper?.isRunning ? '✅ Running' : '❌ Stopped'}`,
          inline: true,
        },
        { name: '📢 Announcements', value: bot.announcementEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
        { name: '🔄 VX Twitter', value: bot.vxTwitterEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
        { name: '⏳ Next X Poll', value: nextPollStr, inline: true },

        { name: '⏱️ System Uptime', value: uptimeStr, inline: true },
        { name: '💾 Memory Usage', value: formatMemory(system.memory.heapUsed), inline: true },

        {
          name: 'Error Info',
          value: `Scraper Fails: ${scraper.failedRuns}\nXML Fails: ${monitor.xmlParseFailures}\nLast Scraper Error: ${scraper.lastError || 'None'}\nLast Monitor Error: ${monitor.lastError || 'None'}`,
          inline: true,
        },
        {
          name: 'YouTube Stats',
          value: `Subs: ${monitor.subscriptions}\nWebhooks: ${monitor.webhooksReceived}\nProcessed: ${monitor.videosProcessed}\nAnnounced: ${monitor.videosAnnounced}`,
          inline: true,
        },
        {
          name: 'X Stats',
          value: `Runs: ${scraper.totalRuns}\nSuccessful: ${scraper.successfulRuns}\nFound: ${scraper.totalTweetsFound}\nAnnounced: ${scraper.totalTweetsAnnounced}`,
          inline: true,
        },
      ],
      timestamp: system.timestamp,
      footer: {
        text: `Bot v${this.buildInfo.version} (Build ${this.buildInfo.build}) | Started: ${new Date(bot.botStartTime).toLocaleString()}`,
      },
    };
  }

  /**
   * Create YouTube health embed
   * @param {Object} healthData - Health data from command processor
   * @returns {Object} Discord embed object
   */
  createYoutubeHealthEmbed(healthData) {
    const { monitor, system } = healthData;
    const formatMemory = bytes => `${Math.round(bytes / 1024 / 1024)} MB`;
    const uptimeStr = new Date(system.uptime * 1000).toISOString().substring(11, 19);

    return {
      title: '📺 YouTube Monitor Health Status',
      color: monitor.isRunning ? 0x00ff00 : 0xff0000, // Green if running, red if not
      fields: [
        {
          name: '🔄 Monitor Status',
          value: monitor.isRunning ? '✅ Running' : '❌ Stopped',
          inline: true,
        },
        {
          name: '📡 Subscription Status',
          value: monitor.subscriptionActive ? '✅ Active' : '❌ Inactive',
          inline: true,
        },
        {
          name: '📺 YouTube Channel',
          value: monitor.youtubeChannelId || 'Not configured',
          inline: true,
        },
        {
          name: '🔗 Callback URL',
          value: monitor.callbackUrl ? `\`${monitor.callbackUrl}\`` : 'Not set',
          inline: false,
        },
        {
          name: '📊 Processing Stats',
          value: `Subscriptions: ${monitor.subscriptions}\nWebhooks Received: ${monitor.webhooksReceived}\nVideos Processed: ${monitor.videosProcessed}\nVideos Announced: ${monitor.videosAnnounced}`,
          inline: true,
        },
        {
          name: '❌ Error Statistics',
          value: `XML Parse Failures: ${monitor.xmlParseFailures}\nLast Error: ${monitor.lastError || 'None'}`,
          inline: true,
        },
        {
          name: '🔍 Duplicate Detection',
          value: `Total Checked: ${monitor.duplicateDetectorStats?.totalChecked || 0}\nDuplicates Found: ${monitor.duplicateDetectorStats?.duplicatesDetected || 0}\nCache Size: ${monitor.duplicateDetectorStats?.cacheSize || 0}`,
          inline: true,
        },
        {
          name: '💻 System Info',
          value: `Uptime: ${uptimeStr}\nMemory: ${formatMemory(system.memory.heapUsed)}`,
          inline: true,
        },
      ],
      timestamp: system.timestamp,
      footer: {
        text: `Bot v${this.buildInfo.version} (Build ${this.buildInfo.build}) | YouTube Monitor`,
      },
    };
  }

  /**
   * Create X scraper health embed
   * @param {Object} healthData - Health data from command processor
   * @returns {Object} Discord embed object
   */
  createXHealthEmbed(healthData) {
    const { scraper, system } = healthData;
    const formatMemory = bytes => `${Math.round(bytes / 1024 / 1024)} MB`;
    const uptimeStr = new Date(system.uptime * 1000).toISOString().substring(11, 19);

    const nextPoll = scraper.pollingInterval.next;
    let nextPollStr = 'Not scheduled';
    if (scraper.isRunning) {
      if (nextPoll) {
        nextPollStr = `<t:${Math.round(nextPoll / 1000)}:R>`;
      } else {
        nextPollStr = 'In progress...';
      }
    }

    const successRate = scraper.totalRuns > 0 ? Math.round((scraper.successfulRuns / scraper.totalRuns) * 100) : 0;

    return {
      title: '🐦 X Scraper Health Status',
      color: scraper.isRunning ? 0x00ff00 : 0xff0000, // Green if running, red if not
      fields: [
        {
          name: '🔄 Scraper Status',
          value: scraper.isRunning ? '✅ Running' : '❌ Stopped',
          inline: true,
        },
        {
          name: '👤 X User',
          value: scraper.xUser || 'Not configured',
          inline: true,
        },
        {
          name: '⏳ Next Poll',
          value: nextPollStr,
          inline: true,
        },
        {
          name: '🔄 Polling Interval',
          value: `Min: ${Math.round(scraper.pollingInterval.min / 1000)}s\nMax: ${Math.round(scraper.pollingInterval.max / 1000)}s\nCurrent: ${Math.round(scraper.pollingInterval.current / 1000)}s`,
          inline: true,
        },
        {
          name: '📊 Execution Stats',
          value: `Total Runs: ${scraper.totalRuns}\nSuccessful: ${scraper.successfulRuns}\nFailed: ${scraper.failedRuns}\nSuccess Rate: ${successRate}%`,
          inline: true,
        },
        {
          name: '📢 Content Stats',
          value: `Tweets Found: ${scraper.totalTweetsFound}\nTweets Announced: ${scraper.totalTweetsAnnounced}`,
          inline: true,
        },
        {
          name: '❌ Error Info',
          value: `Last Error: ${scraper.lastError || 'None'}`,
          inline: false,
        },
        {
          name: '🔍 Duplicate Detection',
          value: `Total Checked: ${scraper.duplicateDetectorStats?.totalChecked || 0}\nDuplicates Found: ${scraper.duplicateDetectorStats?.duplicatesDetected || 0}\nCache Size: ${scraper.duplicateDetectorStats?.cacheSize || 0}`,
          inline: true,
        },
        {
          name: '💻 System Info',
          value: `Uptime: ${uptimeStr}\nMemory: ${formatMemory(system.memory.heapUsed)}`,
          inline: true,
        },
      ],
      timestamp: system.timestamp,
      footer: {
        text: `Bot v${this.buildInfo.version} (Build ${this.buildInfo.build}) | X Scraper`,
      },
    };
  }

  /**
   * Handle Discord ready event
   */
  async handleReady() {
    this.logger.info(`Discord bot is ready! Logged in as ${await this.getCurrentUserTag()}`);

    // Initialize Discord history scanning for duplicate detection
    await this.initializeDiscordHistoryScanning();

    // Emit ready event
    this.eventBus.emit('discord.ready', {
      user: await this.discord.getCurrentUser(),
      readyTime: new Date(),
    });
  }

  /**
   * Initialize Discord history scanning to populate duplicate detection
   */
  async initializeDiscordHistoryScanning() {
    try {
      // Use debug level to reduce Discord logging during startup
      this.logger.debug('Initializing Discord history scanning for duplicate detection...');

      // Get duplicate detector from monitor application
      const duplicateDetector = this.monitorApplication?.duplicateDetector;
      if (!duplicateDetector) {
        this.logger.debug('Duplicate detector not available, skipping Discord history scanning');
        return;
      }

      // Scan YouTube announcement channel
      const youtubeChannelId = this.config.get('DISCORD_YOUTUBE_CHANNEL_ID');
      if (youtubeChannelId) {
        try {
          const youtubeChannel = await this.discord.fetchChannel(youtubeChannelId);
          if (youtubeChannel) {
            // Suppress Discord history scanning logs - only log summary
            const videoResults = await duplicateDetector.scanDiscordChannelForVideos(youtubeChannel, 1000);

            // Single summary log for Discord history scan (not actual YouTube scraping)
            this.logger.info(
              `Discord YouTube history: ${videoResults.messagesScanned} messages scanned, ${videoResults.videoIdsAdded} videos cached`
            );
          }
        } catch (error) {
          this.logger.error(`Failed to scan YouTube channel history: ${error.message}`);
        }
      } else {
        this.logger.debug('No YouTube channel ID configured, skipping YouTube history scanning');
      }

      // Scan X/Twitter announcement channels if scraper application has duplicate detector
      const scraperDuplicateDetector = this.scraperApplication?.duplicateDetector;
      const totalTwitterResults = { messagesScanned: 0, tweetIdsAdded: 0, channelsScanned: 0, errors: 0 };

      if (scraperDuplicateDetector) {
        const twitterChannels = [
          { id: this.config.get('DISCORD_X_POSTS_CHANNEL_ID'), name: 'X posts' },
          { id: this.config.get('DISCORD_X_REPLIES_CHANNEL_ID'), name: 'X replies' },
          { id: this.config.get('DISCORD_X_QUOTES_CHANNEL_ID'), name: 'X quotes' },
          { id: this.config.get('DISCORD_X_RETWEETS_CHANNEL_ID'), name: 'X retweets' },
        ];

        for (const channelConfig of twitterChannels) {
          if (channelConfig.id) {
            try {
              const channel = await this.discord.fetchChannel(channelConfig.id);
              if (channel) {
                const tweetResults = await scraperDuplicateDetector.scanDiscordChannelForTweets(channel, 1000);
                totalTwitterResults.messagesScanned += tweetResults.messagesScanned;
                totalTwitterResults.tweetIdsAdded += tweetResults.tweetIdsAdded;
                totalTwitterResults.channelsScanned++;
                totalTwitterResults.errors += tweetResults.errors?.length || 0;

                // Small delay between channels to prevent rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            } catch (error) {
              totalTwitterResults.errors++;
              this.logger.error(`Failed to scan ${channelConfig.name} channel: ${error.message}`);
            }
          }
        }

        // Single summary log for all X/Twitter channels
        if (totalTwitterResults.channelsScanned > 0) {
          this.logger.info(
            `Discord X/Twitter history: ${totalTwitterResults.channelsScanned} channels, ${totalTwitterResults.messagesScanned} messages scanned, ${totalTwitterResults.tweetIdsAdded} tweets cached`
          );
        }
      }

      this.logger.info('Discord history caching completed (for duplicate detection only)');

      // Emit event to signal that initialization is complete
      this.eventBus.emit('bot.initialization.complete', {
        timestamp: nowUTC(),
        historyScanned: true,
      });
    } catch (error) {
      this.logger.error('❌ Failed to initialize Discord history scanning:', error);
      // Don't throw - let bot continue running even if scanning fails

      // Still emit completion event even if scanning failed
      this.eventBus.emit('bot.initialization.complete', {
        timestamp: nowUTC(),
        historyScanned: false,
        error: error.message,
      });
    }
  }

  /**
   * Handle Discord error events
   * @param {Error} error - Discord error
   */
  handleError(error) {
    this.logger.error('Discord client error:', error);

    // Emit error event
    this.eventBus.emit('discord.error', {
      error,
      timestamp: nowUTC(),
    });
  }

  /**
   * Handle log level changes
   * @param {string} newLevel - New log level
   */
  handleLogLevelChange(newLevel) {
    try {
      // Update logger level if possible
      if (this.logger && typeof this.logger.level !== 'undefined') {
        this.logger.level = newLevel;

        // Update transport levels
        if (this.logger.transports) {
          this.logger.transports.forEach(transport => {
            transport.level = newLevel;
          });
        }
      }

      this.logger.info(`Log level changed to: ${newLevel}`);
    } catch (err) {
      this.logger.error('Error changing log level:', err);
    }
  }

  /**
   * Set bot presence/status
   */
  async setBotPresence() {
    try {
      const presence = {
        activities: [
          {
            name: 'for new content',
            type: 3, // Watching
          },
        ],
        status: 'online',
      };

      await this.discord.setPresence(presence);
    } catch (error) {
      this.logger.warn('Failed to set bot presence:', error);
    }
  }

  /**
   * Get current user tag
   * @returns {Promise<string>} User tag
   */
  async getCurrentUserTag() {
    try {
      const user = await this.discord.getCurrentUser();
      return user.tag || user.username || 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  /**
   * Check if bot is running
   * @returns {boolean} True if running
   */
  isRunning() {
    return this.isRunning;
  }

  /**
   * Get bot status information
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isDiscordReady: this.discord.isReady(),
      botStartTime: this.state.get('botStartTime'),
      postingEnabled: this.state.get('postingEnabled'),
      announcementEnabled: this.state.get('announcementEnabled'),
      vxTwitterEnabled: this.state.get('vxTwitterConversionEnabled'),
      currentLogLevel: this.state.get('logLevel'),
      allowedUsers: this.allowedUserIds.length,
      supportChannelId: this.supportChannelId,
    };
  }

  /**
   * Get bot statistics
   * @returns {Object} Bot statistics
   */
  getStats() {
    return {
      ...this.getStatus(),
      commandRateLimit: this.commandRateLimit.getStats(),
      commandProcessor: this.commandProcessor.getStats(),
      eventBusStats: this.eventBus.getStats(),
      stateStats: this.state.getStats(),
    };
  }

  /**
   * Handle scraper action commands
   * @param {string} action - The scraper action to perform
   * @param {string} userId - The user ID who issued the command
   * @param {Object} message - The Discord message object
   * @returns {Promise<void>}
   */
  async handleScraperAction(action, userId, message) {
    try {
      const scraperApp = this.scraperApplication;

      if (!scraperApp) {
        await message.channel.send('❌ X scraper application is not available.');
        return;
      }

      switch (action) {
        case 'restart':
          try {
            await message.channel.send('🔄 Restarting X scraper application...');
            await scraperApp.restart();
            await message.channel.send('✅ X scraper application restarted successfully!');
            this.logger.info(`Scraper restarted by user ${userId}`);
          } catch (error) {
            await message.channel.send(`❌ Failed to restart X scraper: ${error.message}`);
            this.logger.error(`Scraper restart failed (user ${userId}):`, error);
          }
          break;

        case 'stop':
          try {
            await message.channel.send('⏹️ Stopping X scraper application...');
            await scraperApp.stop();
            await message.channel.send('✅ X scraper application stopped successfully!');
            this.logger.info(`Scraper stopped by user ${userId}`);
          } catch (error) {
            await message.channel.send(`❌ Failed to stop X scraper: ${error.message}`);
            this.logger.error(`Scraper stop failed (user ${userId}):`, error);
          }
          break;

        case 'start':
          try {
            await message.channel.send('▶️ Starting X scraper application...');
            await scraperApp.start();
            await message.channel.send('✅ X scraper application started successfully!');
            this.logger.info(`Scraper started by user ${userId}`);
          } catch (error) {
            await message.channel.send(`❌ Failed to start X scraper: ${error.message}`);
            this.logger.error(`Scraper start failed (user ${userId}):`, error);
          }
          break;

        case 'auth-status':
          try {
            const health = await scraperApp.performHealthCheck();
            const statusIcon = health.authenticated ? '✅' : '❌';
            const statusText = health.authenticated ? 'Authenticated' : 'Not authenticated';
            const errors = health.errors.length > 0 ? `\n⚠️ Issues: ${health.errors.join(', ')}` : '';

            await message.channel.send(`🔐 **X Authentication Status**\n${statusIcon} ${statusText}${errors}`);
          } catch (error) {
            await message.channel.send(`❌ Failed to check authentication status: ${error.message}`);
            this.logger.error(`Auth status check failed (user ${userId}):`, error);
          }
          break;

        case 'force-reauth':
          try {
            await message.channel.send('🔑 Forcing re-authentication...');

            // Clear saved cookies
            this.state.delete('x_session_cookies');

            // Restart scraper to trigger fresh authentication
            await scraperApp.restart();

            await message.channel.send('✅ Re-authentication completed! X scraper restarted with fresh login.');
            this.logger.info(`Force re-authentication completed by user ${userId}`);
          } catch (error) {
            await message.channel.send(`❌ Failed to force re-authentication: ${error.message}`);
            this.logger.error(`Force re-authentication failed (user ${userId}):`, error);
          }
          break;

        case 'health':
          try {
            const health = await scraperApp.performHealthCheck();
            const runningIcon = health.isRunning ? '✅' : '❌';
            const authIcon = health.authenticated ? '✅' : '❌';
            const browserIcon = health.browserHealthy ? '✅' : '❌';

            const healthMessage = [
              '🩺 **X Scraper Health Status**',
              `${runningIcon} Running: ${health.isRunning}`,
              `${authIcon} Authenticated: ${health.authenticated}`,
              `${browserIcon} Browser: ${health.browserHealthy ? 'Healthy' : 'Unhealthy'}`,
              `📅 Last Check: ${health.timestamp.toLocaleString()}`,
            ];

            if (health.errors.length > 0) {
              healthMessage.push(`⚠️ Issues: ${health.errors.join(', ')}`);
            }

            await message.channel.send(healthMessage.join('\n'));
          } catch (error) {
            await message.channel.send(`❌ Failed to check scraper health: ${error.message}`);
            this.logger.error(`Scraper health check failed (user ${userId}):`, error);
          }
          break;

        default:
          await message.channel.send(`❓ Unknown scraper action: ${action}`);
          this.logger.warn(`Unknown scraper action requested: ${action} by user ${userId}`);
      }
    } catch (error) {
      this.logger.error(`Error handling scraper action ${action}:`, error);
      await message.channel.send('❌ An error occurred while processing the scraper command.');
    }
  }

  /**
   * Dispose of resources
   * @returns {Promise<void>}
   */
  async dispose() {
    await this.stop();
  }

  /**
   * Formats git pull output with ANSI color codes for Discord.
   * @param {string} text - The raw output from git pull.
   * @returns {string} The formatted text.
   * @private
   */
  _formatGitPullOutput(text) {
    const green = '\x1b[32m';
    const red = '\x1b[31m';
    const reset = '\x1b[0m';

    return text
      .split('\n')
      .map(line => {
        // Regex for git pull summary line: " filename | 15 +++++++++------"
        const summaryRegex = /^(\s*[\w./-]+\s*\|\s*\d+\s+)([+-]+)$/;
        const summaryMatch = line.match(summaryRegex);

        if (summaryMatch) {
          const prefix = summaryMatch[1];
          const changes = summaryMatch[2];

          // Use a replacer function to wrap contiguous blocks of '+' or '-'
          const coloredChanges = changes.replace(/(\++|-+)/g, match => {
            if (match.startsWith('+')) {
              return `${green}${match}${reset}`;
            }
            return `${red}${match}${reset}`;
          });

          return `${prefix}${coloredChanges}`;
        }

        // Regex for standard diff lines
        if (line.startsWith('+') && !line.startsWith('+++')) {
          return `${green}${line}${reset}`;
        }
        if (line.startsWith('-') && !line.startsWith('---')) {
          return `${red}${line}${reset}`;
        }

        // Colorize (+) and (-) in summary lines like "13 files changed, 3319 insertions(+), 11 deletions(-)"
        return line.replace(/(\()(\+)(\))/g, `$1${green}$2${reset}$3`).replace(/(\()(-)(\))/g, `$1${red}$2${reset}$3`);
      })
      .join('\n');
  }
}
