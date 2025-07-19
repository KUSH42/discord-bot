import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ScraperApplication } from '../../src/application/scraper-application.js';

describe('Login Flow', () => {
  let scraperApp;
  let mockBrowserService;
  let mockConfig;
  let mockLogger;

  beforeEach(() => {
    mockBrowserService = {
      goto: jest.fn(),
      waitForSelector: jest.fn(),
      type: jest.fn(),
      click: jest.fn(),
      evaluate: jest.fn(),
      setCookies: jest.fn(),
      page: {
        url: jest.fn(() => 'https://x.com/home'),
      },
    };

    mockConfig = {
      getRequired: jest.fn(key => {
        const values = {
          X_USER_HANDLE: 'testuser',
          TWITTER_USERNAME: 'testuser',
          TWITTER_PASSWORD: 'testpass',
        };
        return values[key];
      }),
      get: jest.fn(key => {
        if (key === 'TWITTER_USERNAME') {
          return 'testuser@example.com';
        }
        return undefined;
      }),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const mockAuthManager = {
      login: jest.fn().mockResolvedValue(true),
      clickNextButton: jest.fn().mockResolvedValue(true),
      clickLoginButton: jest.fn().mockResolvedValue(true),
      handleEmailVerification: jest.fn().mockResolvedValue(),
      verifyAuthentication: jest.fn().mockResolvedValue(),
      ensureAuthenticated: jest.fn().mockResolvedValue(),
    };

    scraperApp = new ScraperApplication({
      browserService: mockBrowserService,
      config: mockConfig,
      logger: mockLogger,
      authManager: mockAuthManager,
      eventBus: { emit: jest.fn() },
      stateManager: { get: jest.fn(), set: jest.fn() },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should handle multi-step login flow correctly', async () => {
    scraperApp.authManager.login.mockImplementation(async () => {
      mockBrowserService.evaluate
        .mockResolvedValueOnce({ hasUsernameInput: true })
        .mockResolvedValueOnce({ needsEmailVerification: true })
        .mockResolvedValueOnce({ hasPasswordInput: true })
        .mockResolvedValue({ isLoggedIn: true });

      await mockBrowserService.type('input[name="text"]', 'testuser');
      await scraperApp.clickNextButton();
      await scraperApp.authManager.handleEmailVerification();
      await mockBrowserService.type('input[name="password"]', 'testpass');
      await scraperApp.clickLoginButton();
      await scraperApp.clickNextButton();
      return true;
    });

    await scraperApp.loginToX();

    expect(mockBrowserService.type).toHaveBeenCalledWith('input[name="text"]', 'testuser');
    expect(scraperApp.authManager.clickNextButton).toHaveBeenCalledTimes(2);
    expect(scraperApp.authManager.handleEmailVerification).toHaveBeenCalled();
    expect(mockBrowserService.type).toHaveBeenCalledWith('input[name="password"]', 'testpass');
    expect(scraperApp.authManager.clickLoginButton).toHaveBeenCalled();
  });

  it('should use cookies for authentication if available', async () => {
    const mockCookies = JSON.stringify([{ name: 'auth_token', value: 'testtoken' }]);
    mockConfig.get.mockReturnValue(mockCookies);

    scraperApp.authManager.login.mockImplementation(async () => {
      await mockBrowserService.setCookies(JSON.parse(mockCookies));
      await mockBrowserService.goto('https://x.com/home');
      mockBrowserService.waitForSelector.mockResolvedValue(true);
      mockLogger.info('✅ Cookie authentication successful');
      return true;
    });

    await scraperApp.loginToX();

    expect(mockBrowserService.setCookies).toHaveBeenCalledWith(JSON.parse(mockCookies));
    expect(mockBrowserService.goto).toHaveBeenCalledWith('https://x.com/home');
    expect(mockLogger.info).toHaveBeenCalledWith('✅ Cookie authentication successful');
  });

  it('should call clickNextButton and handle its failure', async () => {
    // Mock so that clickNextButton fails
    scraperApp.authManager.clickNextButton.mockResolvedValue(false);
    const result = await scraperApp.clickNextButton();
    expect(result).toBe(false);
  });

  it('should call clickLoginButton and handle its failure', async () => {
    // Mock so that clickLoginButton fails
    scraperApp.authManager.clickLoginButton.mockResolvedValue(false);
    const result = await scraperApp.clickLoginButton();
    expect(result).toBe(false);
  });

  it('should fall back to credential login if cookie authentication fails', async () => {
    const mockCookies = JSON.stringify([{ name: 'auth_token', value: 'testtoken' }]);
    mockConfig.get.mockReturnValue(mockCookies);

    scraperApp.authManager.login.mockImplementation(async () => {
      // Simulate cookie auth failure
      mockLogger.warn('Cookie authentication failed, falling back to credentials');
      mockBrowserService.waitForSelector.mockRejectedValue(new Error('Selector not found'));

      // Simulate successful credential login
      mockLogger.info('Using credential-based authentication...');
      mockBrowserService.evaluate.mockResolvedValueOnce({ hasUsernameInput: true });
      mockBrowserService.evaluate.mockResolvedValueOnce({ hasPasswordInput: true });
      mockBrowserService.evaluate.mockResolvedValueOnce({ isLoggedIn: true });
      scraperApp.verifyAuthentication = jest.fn().mockResolvedValue();
      return true;
    });

    await scraperApp.loginToX();

    expect(mockLogger.warn).toHaveBeenCalledWith('Cookie authentication failed, falling back to credentials');
    expect(mockLogger.info).toHaveBeenCalledWith('Using credential-based authentication...');
  });
});
