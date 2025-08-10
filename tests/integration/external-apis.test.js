import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  mockYouTubeAPI,
  mockVideoDetails,
  mockLiveStreamDetails,
  mockPubSubNotification,
  createMockVideoDetails,
  createMockPubSubNotification as _createMockPubSubNotification,
  createMockSignature,
} from '../mocks/youtube.mock.js';
import {
  mockTweetData as _mockTweetData,
  mockPage as _mockPage,
  mockBrowser as _mockBrowser,
  mockXCookies,
  mockScraperResults as _mockScraperResults,
  createMockTweet,
  createMockPage,
  createMockBrowser,
} from '../mocks/x-twitter.mock.js';
import {
  mockRequest as _mockRequest,
  mockResponse as _mockResponse,
  createMockRequest,
  createMockResponse,
} from '../mocks/express.mock.js';
import { timestampUTC } from '../../src/utilities/utc-time.js';

describe('External API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('YouTube Data API Integration', () => {
    it('should fetch video details successfully', async () => {
      const videoId = 'dQw4w9WgXcQ';
      mockYouTubeAPI.videos.list.mockResolvedValue({
        data: {
          items: [mockVideoDetails],
        },
      });

      const fetchVideoDetails = async id => {
        const response = await mockYouTubeAPI.videos.list({
          part: 'snippet,statistics,liveStreamingDetails',
          id,
        });

        return response.data.items[0];
      };

      const videoDetails = await fetchVideoDetails(videoId);

      expect(mockYouTubeAPI.videos.list).toHaveBeenCalledWith({
        part: 'snippet,statistics,liveStreamingDetails',
        id: videoId,
      });
      expect(videoDetails).toEqual(mockVideoDetails);
      expect(videoDetails.id).toBe(videoId);
    });

    it('should handle API rate limiting', async () => {
      const rateLimitError = new Error('Quota exceeded');
      rateLimitError.code = 403;
      rateLimitError.errors = [{ reason: 'quotaExceeded' }];

      mockYouTubeAPI.videos.list.mockRejectedValueOnce(rateLimitError).mockResolvedValue({
        data: { items: [mockVideoDetails] },
      });

      const fetchWithRetry = async (videoId, retries = 1) => {
        try {
          const response = await mockYouTubeAPI.videos.list({
            part: 'snippet,statistics',
            id: videoId,
          });
          return response.data.items[0];
        } catch (error) {
          if (error.code === 403 && retries > 0) {
            // Immediate retry in test environment
            return fetchWithRetry(videoId, retries - 1);
          }
          throw error;
        }
      };

      const result = await fetchWithRetry('dQw4w9WgXcQ');

      expect(mockYouTubeAPI.videos.list).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockVideoDetails);
    });

    it('should detect live streams correctly', async () => {
      mockYouTubeAPI.videos.list.mockResolvedValue({
        data: {
          items: [mockLiveStreamDetails],
        },
      });

      const checkIfLiveStream = async videoId => {
        const response = await mockYouTubeAPI.videos.list({
          part: 'snippet,liveStreamingDetails',
          id: videoId,
        });

        const video = response.data.items[0];
        return {
          isLive: video.snippet.liveBroadcastContent === 'live',
          liveDetails: video.liveStreamingDetails,
        };
      };

      const liveStatus = await checkIfLiveStream('live123456789');

      expect(liveStatus.isLive).toBe(true);
      expect(liveStatus.liveDetails).toBeDefined();
      expect(liveStatus.liveDetails.actualStartTime).toBeDefined();
    });

    it('should handle video not found errors', async () => {
      mockYouTubeAPI.videos.list.mockResolvedValue({
        data: { items: [] },
      });

      const fetchVideoDetails = async videoId => {
        const response = await mockYouTubeAPI.videos.list({
          part: 'snippet',
          id: videoId,
        });

        if (response.data.items.length === 0) {
          throw new Error('Video not found');
        }

        return response.data.items[0];
      };

      await expect(fetchVideoDetails('nonexistent')).rejects.toThrow('Video not found');
    });

    it('should validate API responses', async () => {
      const invalidVideoData = createMockVideoDetails({
        snippet: { title: null, channelTitle: undefined },
      });

      mockYouTubeAPI.videos.list.mockResolvedValue({
        data: { items: [invalidVideoData] },
      });

      const validateVideoData = video => {
        const required = ['id', 'snippet'];
        const requiredSnippet = ['title', 'channelTitle', 'publishedAt'];

        for (const field of required) {
          if (!video[field]) {
            throw new Error(`Missing required field: ${field}`);
          }
        }

        for (const field of requiredSnippet) {
          if (!video.snippet[field]) {
            throw new Error(`Missing required snippet field: ${field}`);
          }
        }

        return true;
      };

      const response = await mockYouTubeAPI.videos.list({ part: 'snippet', id: 'test' });
      const video = response.data.items[0];

      expect(() => validateVideoData(video)).toThrow('Missing required snippet field');
    });
  });

  describe('PubSubHubbub Integration', () => {
    it('should verify webhook signatures correctly', () => {
      const secret = 'webhook-secret';
      const payload = mockPubSubNotification;
      const validSignature = createMockSignature(payload, secret);

      const verifySignature = (receivedSignature, body, secret) => {
        const expectedSignature = createMockSignature(body, secret);
        return receivedSignature === expectedSignature;
      };

      const isValid = verifySignature(validSignature, payload, secret);
      expect(isValid).toBe(true);

      const invalidSignature = 'sha1=invalid';
      const isInvalid = verifySignature(invalidSignature, payload, secret);
      expect(isInvalid).toBe(false);
    });

    it('should parse PubSubHubbub notifications', () => {
      const parseNotification = xmlData => {
        // Simplified XML parsing for testing - get entry-specific data
        const videoIdMatch = xmlData.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
        const channelIdMatch = xmlData.match(/<yt:channelId>([^<]+)<\/yt:channelId>/);
        // Extract title from within the entry tag, not the feed title
        const entrySection = xmlData.match(/<entry[^>]*>([\s\S]*?)<\/entry>/);
        const titleMatch = entrySection ? entrySection[1].match(/<title>([^<]+)<\/title>/) : null;
        const publishedMatch = xmlData.match(/<published>([^<]+)<\/published>/);

        if (!videoIdMatch || !channelIdMatch || !titleMatch) {
          throw new Error('Invalid notification format');
        }

        return {
          videoId: videoIdMatch[1],
          channelId: channelIdMatch[1],
          title: titleMatch[1],
          publishedAt: publishedMatch ? publishedMatch[1] : null,
        };
      };

      const notification = parseNotification(mockPubSubNotification);

      expect(notification.videoId).toBe('dQw4w9WgXcQ');
      expect(notification.channelId).toBe('UCuAXFkgsw1L7xaCfnd5JJOw');
      expect(notification.title).toBe('Rick Astley - Never Gonna Give You Up (Official Video)');
    });

    it('should handle subscription management', async () => {
      const subscriptionManager = {
        subscribe: jest.fn().mockResolvedValue({ status: 202 }),
        unsubscribe: jest.fn().mockResolvedValue({ status: 202 }),
        verify: jest.fn().mockResolvedValue({ status: 200 }),
      };

      const callbackUrl = 'https://example.com/webhook/youtube';
      const topicUrl = 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UCtest';

      // Test subscription
      const subResult = await subscriptionManager.subscribe(callbackUrl, topicUrl);
      expect(subscriptionManager.subscribe).toHaveBeenCalledWith(callbackUrl, topicUrl);
      expect(subResult.status).toBe(202);

      // Test unsubscription
      const unsubResult = await subscriptionManager.unsubscribe(callbackUrl, topicUrl);
      expect(subscriptionManager.unsubscribe).toHaveBeenCalledWith(callbackUrl, topicUrl);
      expect(unsubResult.status).toBe(202);
    });

    it('should handle webhook verification challenges', () => {
      const handleChallenge = (req, res) => {
        const challenge = req.query['hub.challenge'];
        const mode = req.query['hub.mode'];
        const _topic = req.query['hub.topic'];
        const verifyToken = req.query['hub.verify_token'];

        if (mode === 'subscribe' && verifyToken === 'expected-token') {
          res.status(200).send(challenge);
          return true;
        }

        res.status(404).send('Not Found');
        return false;
      };

      const req = createMockRequest({
        method: 'GET',
        query: {
          'hub.mode': 'subscribe',
          'hub.challenge': 'test-challenge-123',
          'hub.topic': 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UCtest',
          'hub.verify_token': 'expected-token',
        },
      });

      const res = createMockResponse();
      req.query = req.query || {};

      const result = handleChallenge(req, res);

      expect(result).toBe(true);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('test-challenge-123');
    });
  });

  describe('X/Twitter Scraping Integration', () => {
    it('should login to X/Twitter successfully', async () => {
      const browser = createMockBrowser();
      const page = createMockPage();

      const loginToTwitter = async (browser, username, password) => {
        const page = await browser.newPage();

        await page.goto('https://x.com/login');
        await page.fill('input[name="text"]', username);
        await page.click('[role="button"]');
        await page.fill('input[name="password"]', password);
        await page.click('[data-testid="LoginForm_Login_Button"]');

        // Wait for login to complete
        await page.waitForSelector('[data-testid="SideNav_AccountSwitcher_Button"]', { timeout: 10000 });

        return { success: true, page };
      };

      const result = await loginToTwitter(browser, 'testuser', 'testpass');

      expect(page.goto).toHaveBeenCalledWith('https://x.com/login');
      expect(page.fill).toHaveBeenCalledWith('input[name="text"]', 'testuser');
      expect(page.fill).toHaveBeenCalledWith('input[name="password"]', 'testpass');
      expect(result.success).toBe(true);
    });

    it('should scrape posts from user timeline', async () => {
      const page = createMockPage();

      // Mock scraped post elements
      const mockPostElements = [
        {
          textContent: () => Promise.resolve('This is a test post'),
          getAttribute: jest.fn().mockResolvedValue('https://x.com/user/status/123'),
        },
        {
          textContent: () => Promise.resolve('Another test post'),
          getAttribute: jest.fn().mockResolvedValue('https://x.com/user/status/456'),
        },
      ];

      page.$$.mockResolvedValue(mockPostElements);

      const scrapePosts = async (page, username) => {
        const searchUrl = `https://x.com/search?q=(from%3A${username})+exclude%3Areplies+exclude%3Aretweets&src=typed_query&f=live`;

        await page.goto(searchUrl);
        await page.waitForSelector('[data-testid="tweet"]');

        const postElements = await page.$$('[data-testid="tweet"]');
        const posts = [];

        for (const element of postElements) {
          const text = await element.textContent();
          const url = await element.getAttribute('href');

          posts.push({
            text: text.trim(),
            url,
            timestamp: new Date().toISOString(),
          });
        }

        return posts;
      };

      const posts = await scrapePosts(page, 'testuser');

      expect(page.goto).toHaveBeenCalledWith(
        'https://x.com/search?q=(from%3Atestuser)+exclude%3Areplies+exclude%3Aretweets&src=typed_query&f=live'
      );
      expect(posts).toHaveLength(2);
      expect(posts[0].text).toBe('This is a test post');
    });

    it('should handle cookie management', async () => {
      const page = createMockPage();
      page.cookies.mockResolvedValue(mockXCookies);

      const manageCookies = async page => {
        // Get current cookies
        const cookies = await page.cookies();

        // Check if auth cookies are present
        const authCookie = cookies.find(c => c.name === 'auth_token');
        const csrfCookie = cookies.find(c => c.name === 'ct0');

        if (!authCookie || !csrfCookie) {
          throw new Error('Missing authentication cookies');
        }

        // Check if cookies are expired
        const now = timestampUTC();
        if (authCookie.expires && authCookie.expires < now) {
          throw new Error('Authentication cookies expired');
        }

        return { valid: true, cookies };
      };

      const result = await manageCookies(page);

      expect(page.cookies).toHaveBeenCalled();
      expect(result.valid).toBe(true);
      expect(result.cookies).toEqual(mockXCookies);
    });

    it('should categorize different types of content', async () => {
      const categorizeContent = posts => {
        const categorized = {
          posts: [],
          replies: [],
          quotes: [],
          retweets: [],
        };

        posts.forEach(post => {
          if (post.text.startsWith('RT @')) {
            categorized.retweets.push(post);
          } else if (post.text.includes('Replying to @')) {
            categorized.replies.push(post);
          } else if (post.quotedTweet) {
            categorized.quotes.push(post);
          } else {
            categorized.posts.push(post);
          }
        });

        return categorized;
      };

      const mixedPosts = [
        createMockTweet({ text: 'Regular post' }),
        createMockTweet({ text: 'RT @user: Retweeted content' }),
        createMockTweet({ text: 'Replying to @user: This is a reply' }),
        createMockTweet({ text: 'Quote tweet', quotedTweet: { id: '123' } }),
      ];

      const categorized = categorizeContent(mixedPosts);

      expect(categorized.posts).toHaveLength(1);
      expect(categorized.retweets).toHaveLength(1);
      expect(categorized.replies).toHaveLength(1);
      expect(categorized.quotes).toHaveLength(1);
    });

    it('should handle scraping errors gracefully', async () => {
      const page = createMockPage();
      page.goto.mockRejectedValue(new Error('Page not found'));

      const scrapeWithErrorHandling = async (page, url) => {
        try {
          await page.goto(url);
          return { success: true, data: [] };
        } catch (_error) {
          // Silenced in tests - scraping failure is expected test scenario
          return { success: false, error: _error.message };
        }
      };

      const result = await scrapeWithErrorHandling(page, 'https://x.com/nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Page not found');
    });
  });

  describe('Express Server Integration', () => {
    it('should handle YouTube webhook notifications', async () => {
      const webhookHandler = jest.fn((req, res) => {
        try {
          // Verify signature
          const signature = req.headers['x-hub-signature'];
          if (!signature || !signature.startsWith('sha1=')) {
            return res.status(401).json({ error: 'Invalid signature' });
          }

          // Parse notification
          const notification = req.body;
          if (!notification) {
            return res.status(400).json({ error: 'No notification data' });
          }

          // Process notification
          console.log('Processing YouTube notification');
          res.status(200).json({ received: true });
        } catch (_error) {
          res.status(500).json({ error: 'Processing failed' });
        }
      });

      const req = createMockRequest({
        method: 'POST',
        url: '/webhook/youtube',
        headers: {
          'x-hub-signature': 'sha1=valid-signature',
          'content-type': 'application/atom+xml',
        },
        body: mockPubSubNotification,
      });

      const res = createMockResponse();

      webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it('should implement health check endpoints', () => {
      const healthCheck = jest.fn((req, res) => {
        const health = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          components: {
            discord: 'connected',
            youtube: 'subscribed',
            xScraper: 'running',
          },
        };

        res.status(200).json(health);
      });

      const req = createMockRequest({ method: 'GET', url: '/health' });
      const res = createMockResponse();

      healthCheck(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
          components: expect.any(Object),
        })
      );
    });

    it('should handle CORS for webhook endpoints', () => {
      const corsHandler = jest.fn((req, res, next) => {
        res.set({
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Hub-Signature',
        });

        if (req.method === 'OPTIONS') {
          return res.status(200).end();
        }

        next();
      });

      const req = createMockRequest({ method: 'OPTIONS' });
      const res = createMockResponse();
      const next = jest.fn();

      corsHandler(req, res, next);

      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Access-Control-Allow-Origin': '*',
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('API Integration Error Scenarios', () => {
    it('should handle network timeouts', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.code = 'ECONNABORTED';

      mockYouTubeAPI.videos.list.mockRejectedValue(timeoutError);

      const fetchWithTimeout = async (videoId, timeout = 10) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('Request timeout'));
          }, timeout);

          mockYouTubeAPI.videos
            .list({ id: videoId })
            .then(result => {
              clearTimeout(timer);
              resolve(result);
            })
            .catch(error => {
              clearTimeout(timer);
              reject(error);
            });
        });
      };

      await expect(fetchWithTimeout('test', 1)).rejects.toThrow('Request timeout');
    });

    it('should handle API authentication failures', async () => {
      const authError = new Error('Invalid API key');
      authError.code = 401;

      mockYouTubeAPI.videos.list.mockRejectedValue(authError);

      const handleAuthError = async videoId => {
        try {
          return await mockYouTubeAPI.videos.list({ id: videoId });
        } catch (error) {
          if (error.code === 401) {
            // Silenced in tests - auth failure is expected test scenario
            throw new Error('Authentication failed');
          }
          throw error;
        }
      };

      await expect(handleAuthError('test')).rejects.toThrow('Authentication failed');
    });

    it('should handle malformed API responses', async () => {
      mockYouTubeAPI.videos.list.mockResolvedValue({
        data: null, // Malformed response
      });

      const safeApiCall = async videoId => {
        try {
          const response = await mockYouTubeAPI.videos.list({ id: videoId });

          if (!response || !response.data || !Array.isArray(response.data.items)) {
            throw new Error('Malformed API response');
          }

          return response.data.items;
        } catch (_error) {
          // Silenced in tests - API failure is expected test scenario
          return [];
        }
      };

      const result = await safeApiCall('test');
      expect(result).toEqual([]);
    });
  });
});
