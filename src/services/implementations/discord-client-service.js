import { DiscordService } from '../interfaces/discord-service.js';

/**
 * Discord.js implementation of DiscordService
 */
export class DiscordClientService extends DiscordService {
  constructor(client) {
    super();
    this.client = client;
    this.eventHandlers = new Map();
  }

  /**
   * Login to Discord with bot token
   */
  async login(token) {
    await this.client.login(token);
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
        handler(message);
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    };

    this.client.on('messageCreate', wrappedHandler);

    // Return unregister function
    return () => {
      this.client.off('messageCreate', wrappedHandler);
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
    await this.client.destroy();
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
