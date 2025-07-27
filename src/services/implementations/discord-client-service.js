import { DiscordService } from '../interfaces/discord-service.js';

/**
 * Discord.js implementation of DiscordService
 */
export class DiscordClientService extends DiscordService {
  constructor(client, logger) {
    super();
    this.client = client;
    this.logger = logger;
    this.eventHandlers = new Map();
  }

  /**
   * Login to Discord with bot token
   */
  async login(token) {
    // Check if client is already logged in
    if (this.client.readyAt) {
      this.logger.warn('Discord client is already logged in, skipping login attempt');
      return;
    }

    this.logger.info('Attempting Discord client login');
    await this.client.login(token);
    this.logger.info('Discord client login successful');
  }

  /**
   * Send a message to a Discord channel
   */
  async sendMessage(channelId, content) {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${channelId} is not a valid text channel`);
    }
    return await channel.send(content);
  }

  /**
   * Fetch a Discord channel
   */
  async fetchChannel(channelId) {
    return await this.client.channels.fetch(channelId);
  }

  /**
   * Fetch a Discord guild
   */
  async fetchGuild(guildId) {
    return await this.client.guilds.fetch(guildId);
  }

  /**
   * Register a message event handler
   */
  onMessage(handler) {
    const wrappedHandler = message => {
      try {
        // FILTER OUT BOT MESSAGES AT DISCORD.JS LEVEL to reduce processing load
        if (message.author.bot) {
          // Check if it's this bot's own message (silently ignore to reduce log spam)
          return; // Don't process bot messages at all
        }

        this.logger.verbose(
          `📨 Discord messageCreate event - ID: ${message.id}, Handlers: ${this.client.listenerCount('messageCreate')}, Instance: ${this.client._botInstanceId}, Content: "${message.content?.substring(0, 50) || 'empty'}"`
        );
        handler(message);
      } catch (error) {
        // Log the error with context
        this.logger.error('Error in message handler:', {
          error: error.message, // Include the error message
          stack: error.stack, // Include the stack trace
          messageContent: message.content, // Include the message content
          channelId: message.channelId, // Include the channel ID
          userId: message.author?.id, // Include the user ID, if available
        });
      }
    };

    this.logger.info('🔗 Registering Discord message handler', {
      clientId: this.client.user?.id,
      clientReady: this.client.readyAt !== null,
      instanceId: this.client._botInstanceId,
      existingHandlerCount: this.client.listenerCount('messageCreate'),
    });

    this.client.on('messageCreate', wrappedHandler);

    this.logger.info('✅ Discord message handler registered', {
      clientId: this.client.user?.id,
      newHandlerCount: this.client.listenerCount('messageCreate'),
      instanceId: this.client._botInstanceId,
    });

    // Return unregister function
    return () => {
      this.logger.info('🔌 Unregistering Discord message handler', {
        clientId: this.client.user?.id,
        instanceId: this.client._botInstanceId,
        handlerCountBefore: this.client.listenerCount('messageCreate'),
      });
      this.client.off('messageCreate', wrappedHandler);
      this.logger.info('❌ Discord message handler unregistered', {
        clientId: this.client.user?.id,
        handlerCountAfter: this.client.listenerCount('messageCreate'),
        instanceId: this.client._botInstanceId,
      });
    };
  }

  /**
   * Register a ready event handler
   */
  onReady(handler) {
    const wrappedHandler = () => {
      try {
        handler();
      } catch (error) {
        console.error('Error in ready handler:', error);
      }
    };

    this.client.on('ready', wrappedHandler);

    // Return unregister function
    return () => {
      this.client.off('ready', wrappedHandler);
    };
  }

  /**
   * Register an error event handler
   */
  onError(handler) {
    const wrappedHandler = error => {
      try {
        handler(error);
      } catch (handlerError) {
        console.error('Error in error handler:', handlerError);
      }
    };

    this.client.on('error', wrappedHandler);

    // Return unregister function
    return () => {
      this.client.off('error', wrappedHandler);
    };
  }

  /**
   * Get current user information
   */
  async getCurrentUser() {
    return this.client.user;
  }

  /**
   * Check if the bot is logged in and ready
   */
  isReady() {
    return this.client.readyAt !== null;
  }

  /**
   * Get bot latency/ping
   */
  getLatency() {
    return this.client.ws.ping;
  }

  /**
   * Destroy the Discord client connection
   */
  async destroy() {
    if (this.client && typeof this.client.destroy === 'function') {
      this.logger.info('Destroying Discord client', {
        clientId: this.client.user?.id,
        isReady: this.client.readyAt !== null,
        eventListenerCount: typeof this.client.eventNames === 'function' ? this.client.eventNames().length : 0,
        instanceId: this.client._botInstanceId,
      });

      // Remove all event listeners first to prevent any remaining callbacks
      if (typeof this.client.removeAllListeners === 'function') {
        this.client.removeAllListeners();
        this.logger.debug('Removed all Discord client event listeners');
      } else {
        this.logger.debug('removeAllListeners not available on client');
      }

      await this.client.destroy();
      this.logger.info('Discord client destroyed successfully');

      // Set client to null to prevent any lingering references
      this.client = null;
    } else {
      this.logger.warn('Discord client is not available for destruction');
    }
  }

  /**
   * Edit a message
   */
  async editMessage(channelId, messageId, newContent) {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${channelId} is not a valid text channel`);
    }

    const message = await channel.messages.fetch(messageId);
    return await message.edit(newContent);
  }

  /**
   * Delete a message
   */
  async deleteMessage(channelId, messageId) {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${channelId} is not a valid text channel`);
    }

    const message = await channel.messages.fetch(messageId);
    await message.delete();
  }

  /**
   * Add a reaction to a message
   */
  async addReaction(channelId, messageId, emoji) {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${channelId} is not a valid text channel`);
    }

    const message = await channel.messages.fetch(messageId);
    await message.react(emoji);
  }

  /**
   * Get user from guild
   */
  async getGuildMember(guildId, userId) {
    const guild = await this.client.guilds.fetch(guildId);
    return await guild.members.fetch(userId);
  }

  /**
   * Check if user has permission in channel
   */
  async hasPermission(channelId, userId, permission) {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.guild) {
      return false;
    }

    const member = await channel.guild.members.fetch(userId);
    return channel.permissionsFor(member).has(permission);
  }

  /**
   * Set bot presence/status
   */
  async setPresence(presence) {
    this.client.user.setPresence(presence);
  }
}
