import { jest } from '@jest/globals';
import { AuthManager } from '../../src/application/auth-manager.js';
import { createMockDependenciesWithEnhancedLogging } from '../utils/enhanced-logging-mocks.js';

describe('Persistent Cookie Storage', () => {
  let authManager;
  let mockBrowserService;
  let mockConfig;
  let mockStateManager;
  let mockLogger;

  beforeEach(() => {
    // Create enhanced logging mocks
    const enhancedLoggingMocks = createMockDependenciesWithEnhancedLogging();

    mockBrowserService = {
      goto: jest.fn(),
      setCookies: jest.fn(),
      getCookies: jest.fn(),
      page: {
        url: jest.fn().mockReturnValue('https://x.com/home'),
      },
    };

    mockConfig = {
      getRequired: jest.fn(
        key =>
          ({
            TWITTER_USERNAME: 'testuser',
            TWITTER_PASSWORD: 'testpassword',
          })[key]
      ),
    };

    mockStateManager = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    };

    mockLogger = enhancedLoggingMocks.logger;

    authManager = new AuthManager({
      browserService: mockBrowserService,
      config: mockConfig,
      stateManager: mockStateManager,
      logger: mockLogger,
      debugManager: enhancedLoggingMocks.debugManager,
      metricsManager: enhancedLoggingMocks.metricsManager,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Cookie Storage Management', () => {
    it('should save cookies to state after successful login', async () => {
      const mockCookies = [{ name: 'auth_token', value: 'token123', domain: '.x.com' }];
      mockBrowserService.getCookies.mockResolvedValue(mockCookies);
      jest.spyOn(authManager, 'loginToX').mockResolvedValue(true);
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(true);

      await authManager.ensureAuthenticated();

      // Directly call saveAuthenticationState to test it, as loginToX is mocked
      await authManager.saveAuthenticationState();

      expect(mockBrowserService.getCookies).toHaveBeenCalled();
      expect(mockStateManager.set).toHaveBeenCalledWith('x_session_cookies', mockCookies);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Saved session cookies to state',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should attempt to use saved cookies before performing login', async () => {
      const savedCookies = [{ name: 'auth_token', value: 'saved123', domain: '.x.com' }];
      mockStateManager.get.mockReturnValue(savedCookies);
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(true);
      const loginSpy = jest.spyOn(authManager, 'loginToX');

      await authManager.ensureAuthenticated();

      expect(mockBrowserService.setCookies).toHaveBeenCalledWith(savedCookies);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '✅ Successfully authenticated using saved cookies.',
        expect.objectContaining({
          module: 'auth',
        })
      );
      expect(loginSpy).not.toHaveBeenCalled();
    });

    it('should fallback to login when saved cookies fail', async () => {
      const savedCookies = [{ name: 'auth_token', value: 'expired123', domain: '.x.com' }];
      mockStateManager.get.mockReturnValue(savedCookies);
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(false); // Cookies are invalid
      const loginSpy = jest.spyOn(authManager, 'loginToX').mockResolvedValue(true);

      await authManager.ensureAuthenticated();

      expect(mockBrowserService.setCookies).toHaveBeenCalledWith(savedCookies);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Saved cookies failed, attempting login',
        expect.objectContaining({
          module: 'auth',
        })
      );
      expect(loginSpy).toHaveBeenCalled();
    });

    it('should handle missing saved cookies gracefully', async () => {
      mockStateManager.get.mockReturnValue(null);
      const loginSpy = jest.spyOn(authManager, 'loginToX').mockResolvedValue(true);

      await authManager.ensureAuthenticated();

      expect(mockBrowserService.setCookies).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'No saved cookies found, performing login',
        expect.objectContaining({
          module: 'auth',
        })
      );
      expect(loginSpy).toHaveBeenCalled();
    });

    it('should handle invalid saved cookies gracefully', async () => {
      mockStateManager.get.mockReturnValue('invalid-format');
      const loginSpy = jest.spyOn(authManager, 'loginToX').mockResolvedValue(true);

      await authManager.ensureAuthenticated();

      expect(mockBrowserService.setCookies).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid saved cookies format, performing login',
        expect.objectContaining({
          module: 'auth',
        })
      );
      expect(loginSpy).toHaveBeenCalled();
    });
  });

  describe('Cookie Persistence Flow', () => {
    it('should update saved cookies after successful credential login', async () => {
      const newCookies = [{ name: 'new_token', value: 'new123', domain: '.x.com' }];
      mockStateManager.get.mockReturnValue(null);
      mockBrowserService.getCookies.mockResolvedValue(newCookies);
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(true);
      jest.spyOn(authManager, 'loginToX').mockImplementation(async () => {
        await authManager.saveAuthenticationState();
        return true;
      });

      await authManager.ensureAuthenticated();

      expect(mockStateManager.set).toHaveBeenCalledWith('x_session_cookies', newCookies);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Saved session cookies to state',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });

    it('should clear saved cookies on persistent authentication failure', async () => {
      const expiredCookies = [{ name: 'expired_token', value: 'expired123', domain: '.x.com' }];
      mockStateManager.get.mockReturnValue(expiredCookies);
      jest.spyOn(authManager, 'isAuthenticated').mockResolvedValue(false);
      jest.spyOn(authManager, 'loginToX').mockRejectedValue(new Error('Authentication failed'));

      await expect(authManager.ensureAuthenticated()).rejects.toThrow('Authentication failed');

      expect(mockStateManager.delete).toHaveBeenCalledWith('x_session_cookies');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Saved cookies failed, attempting login',
        expect.objectContaining({
          module: 'auth',
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle cookie setting errors gracefully', async () => {
      const savedCookies = [{ name: 'auth_token', value: 'abc123', domain: '.x.com' }];
      mockStateManager.get.mockReturnValue(savedCookies);
      mockBrowserService.setCookies.mockRejectedValue(new Error('Cookie setting error'));
      const loginSpy = jest.spyOn(authManager, 'loginToX').mockResolvedValue(true);

      await authManager.ensureAuthenticated();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error validating saved cookies, falling back to login:',
        expect.objectContaining({
          module: 'auth',
        })
      );
      expect(loginSpy).toHaveBeenCalled();
    });

    it('should handle state manager errors when retrieving cookies', async () => {
      mockStateManager.get.mockImplementation(() => {
        throw new Error('State manager read error');
      });
      const loginSpy = jest.spyOn(authManager, 'loginToX').mockResolvedValue(true);

      await expect(authManager.ensureAuthenticated()).rejects.toThrow('Authentication failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Non-recoverable authentication error:',
        expect.objectContaining({
          module: 'auth',
        })
      );
      expect(loginSpy).not.toHaveBeenCalled(); // Should fail before calling login
    });
  });
});
