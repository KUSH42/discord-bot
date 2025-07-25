import { jest } from '@jest/globals';

describe('X Scraper Entry Point', () => {
  let originalEnv;

  beforeEach(async () => {
    // Save original environment
    originalEnv = process.env;

    // Set required environment variables for tests
    process.env = {
      ...originalEnv,
      X_USER_HANDLE: 'testuser',
      TWITTER_USERNAME: 'testuser',
      TWITTER_PASSWORD: 'testpass',
      DISCORD_BOT_TOKEN: 'test-token',
      DISCORD_SUPPORT_CHANNEL_ID: '123456789012345678',
      DISCORD_ANNOUNCE_CHANNEL_ID: '123456789012345679',
      YOUTUBE_API_KEY: 'test-key',
      YOUTUBE_CHANNEL_ID: 'UCrAOyUwjSM5zzPz_FqsUhuQ',
      PSH_CALLBACK_URL: 'https://example.com/webhook',
      PSH_SECRET: 'test-secret',
      DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345680',
      DISCORD_X_POSTS_CHANNEL_ID: '123456789012345681',
      DISCORD_X_REPLIES_CHANNEL_ID: '123456789012345682',
      DISCORD_X_QUOTES_CHANNEL_ID: '123456789012345683',
      DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345684',
    };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('should have valid environment variables', () => {
    expect(process.env.X_USER_HANDLE).toBe('testuser');
    expect(process.env.DISCORD_BOT_TOKEN).toBe('test-token');
  });
});
