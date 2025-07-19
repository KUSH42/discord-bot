import { jest } from '@jest/globals';
import { DiscordClientService } from '../../../src/services/implementations/discord-client-service.js';

describe('Discord Client Service', () => {
  let discordClientService;
  let mockLogger;
  let mockClient;
  let mockSend;
  let mockChannel;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
    };

    mockSend = jest.fn();
    mockChannel = {
      send: mockSend,
      isTextBased: () => true, // Mock the channel type check
    };

    mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue(mockChannel),
      },
    };

    // Correctly instantiate the service with the mock client
    discordClientService = new DiscordClientService(mockClient);
    discordClientService.logger = mockLogger; // Manually attach logger for testing
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should send a message to a channel successfully', async () => {
    const channelId = '12345';
    const message = 'Test message';
    await discordClientService.sendMessage(channelId, message);

    expect(mockClient.channels.fetch).toHaveBeenCalledWith(channelId);
    expect(mockSend).toHaveBeenCalledWith(message);
  });

  it('should throw an error if the channel is not a text channel', async () => {
    const nonTextChannel = { isTextBased: () => false };
    mockClient.channels.fetch.mockResolvedValue(nonTextChannel);

    const channelId = '54321';
    const message = 'This should fail';

    await expect(discordClientService.sendMessage(channelId, message)).rejects.toThrow(
      'Channel 54321 is not a valid text channel'
    );
  });

  it('should throw an error if the channel is not found', async () => {
    mockClient.channels.fetch.mockResolvedValue(null);

    const channelId = 'nonexistent';
    const message = 'This should also fail';

    await expect(discordClientService.sendMessage(channelId, message)).rejects.toThrow(
      'Channel nonexistent is not a valid text channel'
    );
  });
});
