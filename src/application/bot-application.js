import { exec as defaultExec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { CommandRateLimit } from '../rate-limiter.js';

/**
 * Main bot application orchestrator
 * Coordinates Discord client, command processing, and event handling
 */
export class BotApplication {
  constructor(dependencies) {
    this.exec = dependencies.exec || defaultExec;
    this.scraperApplication = dependencies.scraperApplication;
    this.monitorApplication = dependencies.monitorApplication;
    this.discord = dependencies.discordService;
    this.commandProcessor = dependencies.commandProcessor;
    this.eventBus = dependencies.eventBus;
    this.config = dependencies.config;
    this.state = dependencies.stateManager;
    this.logger = dependencies.logger;

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
      throw new Error('Bot application is already running');
    }

    try {
      this.logger.info('Starting bot application...');

      // Login to Discord
      const token = this.config.getRequired('DISCORD_BOT_TOKEN');
      await this.discord.login(token);

      // Set up event handlers
      this.setupEventHandlers();

      // Set bot presence
      await this.setBotPresence();

      this.isRunning = true;
      this.logger.info('Bot application started successfully');

      // Emit start event
      this.eventBus.emit('bot.started', {
        startTime: this.state.get('botStartTime'),
        config: this.config.getAllConfig(false), // Don't include secrets
      });
    } catch (error) {
      this.logger.error('Failed to start bot application:', error);
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

      this.isRunning = false;
      this.logger.info('Bot application stopped');

      // Emit stop event
      this.eventBus.emit('bot.stopped', {
        stopTime: new Date(),
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

    this.exec('git pull', async (error, stdout) => {
      if (error) {
        this.logger.error(`git pull failed: ${error}`);
        if (message) {
          await message.reply(`❌ **Git pull failed:**\n\`\`\`${error.message}\`\`\``);
        }
        return;
      }

      if (message) {
        const output = `**✅ Git pull successful:**\n\`\`\`${stdout || 'No new changes.'}\`\`\``;
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
    for (const cleanup of this.eventCleanup) {
      try {
        cleanup();
      } catch (error) {
        this.logger.warn('Error cleaning up event handler:', error);
      }
    }
    this.eventCleanup = [];
  }

  /**
   * Handle Discord message events
   * @param {Object} message - Discord message object
   */
  async handleMessage(message) {
    try {
      // Ignore bot messages and non-command messages
      if (message.author.bot || !message.content.startsWith(this.commandPrefix)) {
        return;
      }

      // Parse command and get user info
      const args = message.content.slice(this.commandPrefix.length).trim().split(/ +/);
      const command = args.shift().toLowerCase();
      const user = message.author;

      // Only process messages in the support channel or from admin in any other channel
      if (!user && this.supportChannelId && message.channel.id !== this.supportChannelId) {
        return;
      }

      // Validate user
      if (!user || !user.id) {
        this.logger.warn('Received message from invalid user object');
        return;
      }

      // Rate limiting check
      if (!this.commandRateLimit.isAllowed(user.id)) {
        const remainingTime = Math.ceil(this.commandRateLimit.getRemainingTime(user.id) / 1000);
        await message.reply(
          `🚫 Rate limit exceeded. Please wait ${remainingTime} seconds before using another command.`
        );
        this.logger.warn(`Rate limit exceeded for user ${user.tag} (${user.id})`);
        return;
      }

      // Process command
      const appStats = {
        bot: this.getStats(),
        scraper: this.scraperApplication.getStats(),
        monitor: this.monitorApplication.getStats(),
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString(),
        },
      };

      this.logger.info(`Processing command: "${command}" from user ${user.tag}`);
      const result = await this.commandProcessor.processCommand(command, args, user.id, appStats);
      this.logger.info(`Command "${command}" result: ${result.success ? 'success' : 'failure'}`);

      // Handle command result
      await this.handleCommandResult(message, result, command, user);
    } catch (error) {
      this.logger.error('Error processing message command:', error);
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

      // Handle restart request
      if (result.requiresRestart) {
        try {
          await message.channel.send('✅ Full restart initiated. See you in a moment!');
          await this.softRestart();
        } catch (error) {
          this.logger.error('Soft restart failed:', error);
          await message.channel.send('❌ Soft restart failed. Check logs for details.');
        }
      }

      if (result.requiresUpdate) {
        await this.handleUpdate(message);
      }

      // Handle log level change
      if (result.newLogLevel) {
        this.handleLogLevelChange(result.newLogLevel);
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
    const { bot, scraper, monitor, system } = healthData;
    const uptimeStr = new Date(system.uptime * 1000).toISOString().substr(11, 8);
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
      title: '📊 Detailed Bot Health Status',
      color: this.discord.isReady() ? 0x00ff00 : 0xff0000,
      fields: [
        { name: '🤖 Bot', value: `Status: ${bot.isRunning ? '✅ Running' : '❌ Stopped'}`, inline: true },
        {
          name: '▶️ YouTube Monitor',
          value: `Status: ${monitor.isRunning ? '✅ Running' : '❌ Stopped'}`,
          inline: true,
        },
        { name: '🐦 X Scraper', value: `Status: ${scraper.isRunning ? '✅ Running' : '❌ Stopped'}`, inline: true },

        { name: '📢 Announcements', value: bot.announcementEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
        { name: '🔄 VX Twitter', value: bot.vxTwitterEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
        { name: '⏳ Next X Poll', value: nextPollStr, inline: true },

        { name: '⏱️ System Uptime', value: uptimeStr, inline: true },
        { name: '💾 Memory Usage', value: formatMemory(system.memory.heapUsed), inline: true },
        { name: '📡 Discord Latency', value: `${this.discord.getLatency()}ms`, inline: true },

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
        {
          name: 'Error Info',
          value: `Scraper Fails: ${scraper.failedRuns}\nXML Fails: ${monitor.xmlParseFailures}\nLast Scraper Error: ${scraper.lastError || 'None'}\nLast Monitor Error: ${monitor.lastError || 'None'}`,
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
      this.logger.info('Initializing Discord history scanning for duplicate detection...');

      // Get duplicate detector from monitor application
      const duplicateDetector = this.monitorApplication?.duplicateDetector;
      if (!duplicateDetector) {
        this.logger.warn('Duplicate detector not available, skipping Discord history scanning');
        return;
      }

      // Scan YouTube announcement channel
      const youtubeChannelId = this.config.get('DISCORD_YOUTUBE_CHANNEL_ID');
      if (youtubeChannelId) {
        try {
          const youtubeChannel = await this.discord.fetchChannel(youtubeChannelId);
          if (youtubeChannel) {
            this.logger.info(`Scanning YouTube channel history (${youtubeChannelId})...`);
            const videoResults = await duplicateDetector.scanDiscordChannelForVideos(youtubeChannel, 1000);

            this.logger.info(
              `YouTube channel scan completed: ${videoResults.messagesScanned} messages, ${videoResults.videoIdsAdded} new video IDs found`
            );

            if (videoResults.errors.length > 0) {
              this.logger.warn(`YouTube channel scan had ${videoResults.errors.length} errors`);
            }
          } else {
            this.logger.warn(`Could not fetch YouTube channel: ${youtubeChannelId}`);
          }
        } catch (error) {
          this.logger.error(`Failed to scan YouTube channel history: ${error.message}`);
        }
      } else {
        this.logger.info('No YouTube channel ID configured, skipping YouTube history scanning');
      }

      // Scan X/Twitter announcement channels if scraper application has duplicate detector
      const scraperDuplicateDetector = this.scraperApplication?.duplicateDetector;
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
                this.logger.info(`Scanning ${channelConfig.name} channel history (${channelConfig.id})...`);
                const tweetResults = await scraperDuplicateDetector.scanDiscordChannelForTweets(channel, 1000);

                this.logger.info(
                  `${channelConfig.name} channel scan completed: ${tweetResults.messagesScanned} messages, ${tweetResults.tweetIdsAdded} new tweet IDs found`
                );

                if (tweetResults.errors.length > 0) {
                  this.logger.warn(`${channelConfig.name} channel scan had ${tweetResults.errors.length} errors`);
                }
              } else {
                this.logger.warn(`Could not fetch ${channelConfig.name} channel: ${channelConfig.id}`);
              }
            } catch (error) {
              this.logger.error(`Failed to scan ${channelConfig.name} channel history: ${error.message}`);
            }
          }
        }
      } else {
        this.logger.info('No scraper duplicate detector available, skipping X/Twitter history scanning');
      }

      this.logger.info('Discord history scanning initialization completed');
    } catch (error) {
      this.logger.error('Failed to initialize Discord history scanning:', error);
      // Don't throw - let bot continue running even if scanning fails
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
      timestamp: new Date(),
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
   * Dispose of resources
   * @returns {Promise<void>}
   */
  async dispose() {
    await this.stop();
  }
}
