import { jest } from '@jest/globals';

// Mock X/Twitter post data
export const mockTweetData = {
  id: '1234567890123456789',
  text: 'This is a test tweet with some content',
  user: {
    id: '987654321',
    username: 'testuser',
    displayName: 'Test User',
    verified: false,
  },
  createdAt: new Date().toISOString(),
  metrics: {
    retweets: 10,
    likes: 50,
    replies: 5,
  },
  media: [],
  urls: ['https://example.com'],
  hashtags: ['test', 'example'],
  mentions: [],
};

export const mockQuoteTweet = {
  ...mockTweetData,
  id: '1111222233334444555',
  text: 'Quote tweet with original content',
  quotedTweet: {
    id: '9999888877776666555',
    text: 'Original quoted tweet',
    user: {
      username: 'originaluser',
      displayName: 'Original User',
    },
  },
};

export const mockReplyTweet = {
  ...mockTweetData,
  id: '5555444433332222111',
  text: '@testuser This is a reply',
  replyTo: {
    id: '1234567890123456789',
    user: {
      username: 'testuser',
    },
  },
};

export const mockRetweetData = {
  id: '7777666655554444333',
  type: 'retweet',
  user: {
    username: 'retweetuser',
    displayName: 'Retweet User',
  },
  originalTweet: mockTweetData,
  createdAt: new Date().toISOString(),
};

// Mock Playwright/Puppeteer browser and page
export const mockPage = {
  goto: jest.fn().mockResolvedValue(),
  waitForSelector: jest.fn().mockResolvedValue(),
  waitForTimeout: jest.fn().mockResolvedValue(),
  click: jest.fn().mockResolvedValue(),
  type: jest.fn().mockResolvedValue(),
  fill: jest.fn().mockResolvedValue(),
  press: jest.fn().mockResolvedValue(),
  screenshot: jest.fn().mockResolvedValue(Buffer.from('mock-screenshot')),
  content: jest.fn().mockResolvedValue('<html>Mock page content</html>'),
  evaluate: jest.fn().mockImplementation(fn => fn()),
  locator: jest.fn().mockReturnValue({
    textContent: jest.fn().mockResolvedValue('Mock text'),
    getAttribute: jest.fn().mockResolvedValue('mock-attribute'),
    click: jest.fn().mockResolvedValue(),
    isVisible: jest.fn().mockResolvedValue(true),
  }),
  $: jest.fn().mockResolvedValue({
    textContent: jest.fn().mockResolvedValue('Mock text'),
    getAttribute: jest.fn().mockResolvedValue('mock-attribute'),
  }),
  $$: jest.fn().mockResolvedValue([
    {
      textContent: jest.fn().mockResolvedValue('Mock text 1'),
      getAttribute: jest.fn().mockResolvedValue('mock-attribute-1'),
    },
    {
      textContent: jest.fn().mockResolvedValue('Mock text 2'),
      getAttribute: jest.fn().mockResolvedValue('mock-attribute-2'),
    },
  ]),
  cookies: jest.fn().mockResolvedValue([]),
  setCookie: jest.fn().mockResolvedValue(),
  close: jest.fn().mockResolvedValue(),
};

export const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn().mockResolvedValue(),
  contexts: jest.fn().mockReturnValue([]),
  newContext: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn().mockResolvedValue(),
  }),
};

export const mockPlaywright = {
  chromium: {
    launch: jest.fn().mockResolvedValue(mockBrowser),
    launchPersistentContext: jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn().mockResolvedValue(),
    }),
  },
  firefox: {
    launch: jest.fn().mockResolvedValue(mockBrowser),
  },
  webkit: {
    launch: jest.fn().mockResolvedValue(mockBrowser),
  },
};

// Mock cookie data for X/Twitter authentication
export const mockXCookies = [
  {
    name: 'auth_token',
    value: 'mock-auth-token-value',
    domain: '.x.com',
    path: '/',
    expires: Date.now() + 86400000, // 24 hours
    httpOnly: true,
    secure: true,
  },
  {
    name: 'ct0',
    value: 'mock-csrf-token',
    domain: '.x.com',
    path: '/',
    expires: Date.now() + 86400000,
    httpOnly: false,
    secure: true,
  },
];

// Mock scraper results
export const mockScraperResults = {
  posts: [mockTweetData],
  replies: [mockReplyTweet],
  quotes: [mockQuoteTweet],
  retweets: [mockRetweetData],
  totalFound: 4,
  newContentCount: 2,
  duplicatesFiltered: 1,
  timestamp: new Date().toISOString(),
};

// Helper functions for creating test data
export const createMockTweet = (overrides = {}) => ({
  ...mockTweetData,
  ...overrides,
  user: {
    ...mockTweetData.user,
    ...(overrides.user || {}),
  },
});

export const createMockPage = (overrides = {}) => ({
  ...mockPage,
  ...overrides,
});

export const createMockBrowser = (overrides = {}) => ({
  ...mockBrowser,
  newPage: jest.fn().mockResolvedValue({
    ...mockPage,
    ...(overrides.pageOverrides || {}),
  }),
  ...overrides,
});

// Mock X/Twitter search URL patterns
export const mockSearchUrls = {
  posts: 'https://x.com/search?q=(from%3Atestuser)+exclude%3Areplies+exclude%3Aretweets&src=typed_query&f=live',
  replies: 'https://x.com/search?q=(from%3Atestuser)+filter%3Areplies&src=typed_query&f=live',
  quotes: 'https://x.com/search?q=quoted%3Atestuser&src=typed_query&f=live',
  retweets: 'https://x.com/search?q=(from%3Atestuser)+filter%3Aretweets&src=typed_query&f=live',
};

// Mock login flow
export const mockLoginSequence = [
  { action: 'goto', url: 'https://x.com/login' },
  { action: 'fill', selector: 'input[name="text"]', value: 'mock-username' },
  { action: 'click', selector: '[role="button"]' },
  { action: 'fill', selector: 'input[name="password"]', value: 'mock-password' },
  { action: 'click', selector: '[data-testid="LoginForm_Login_Button"]' },
];
