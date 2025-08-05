import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BrowserProfileManager } from '../../../src/utilities/browser-profile-manager.js';
import { createEnhancedLoggerMocks } from '../../fixtures/test-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('BrowserProfileManager', () => {
  let profileManager;
  let mockLogger;
  let testProfileDir;
  let mockPage;
  let mockContext;

  beforeEach(() => {
    // Reset all mocks first
    jest.restoreAllMocks();

    // Create enhanced logger mocks
    const loggerMocks = createEnhancedLoggerMocks();
    mockLogger = loggerMocks.logger;

    // Create temporary test profile directory
    testProfileDir = path.join(__dirname, '../../../tmp/test-profiles');

    // Initialize profile manager with test directory
    profileManager = new BrowserProfileManager(testProfileDir, mockLogger);

    // Mock Playwright page and context
    mockContext = {
      cookies: jest.fn().mockResolvedValue([{ name: 'test-cookie', value: 'test-value', domain: 'example.com' }]),
      addCookies: jest.fn().mockResolvedValue(undefined),
    };

    mockPage = {
      context: jest.fn().mockReturnValue(mockContext),
      evaluate: jest.fn().mockImplementation(fn => {
        // Mock browser storage APIs
        if (fn.toString().includes('localStorage')) {
          return Promise.resolve({ 'test-key': 'test-value' });
        }
        if (fn.toString().includes('sessionStorage')) {
          return Promise.resolve({ 'session-key': 'session-value' });
        }
        return Promise.resolve({});
      }),
    };

    // Mock fs operations
    jest.spyOn(fs, 'existsSync').mockImplementation(filePath => {
      // Return false for profile directories to trigger creation
      // Return true for other paths by default to avoid unnecessary directory creation
      if (filePath.includes('/test-profiles') || filePath.includes('metadata.json')) {
        return false;
      }
      return true;
    });

    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    jest.spyOn(fs.promises, 'readFile').mockImplementation(filePath => {
      if (filePath.includes('cookies.json')) {
        return Promise.resolve(
          JSON.stringify([{ name: 'restored-cookie', value: 'restored-value', domain: 'example.com' }])
        );
      }
      if (filePath.includes('localStorage.json')) {
        return Promise.resolve(JSON.stringify({ 'restored-key': 'restored-value' }));
      }
      if (filePath.includes('sessionStorage.json')) {
        return Promise.resolve(JSON.stringify({ 'restored-session': 'restored-value' }));
      }
      if (filePath.includes('metadata.json')) {
        return Promise.resolve(
          JSON.stringify({
            created: '2024-01-01T00:00:00.000Z',
            lastUsed: '2024-01-01T12:00:00.000Z',
            sessionCount: 5,
            version: '1.0.0',
          })
        );
      }
      return Promise.reject(new Error('File not found'));
    });

    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
      { name: 'profile1', isDirectory: () => true },
      { name: 'profile2', isDirectory: () => true },
      { name: 'file.txt', isDirectory: () => false },
    ]);

    jest.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with default profile directory', () => {
      const manager = new BrowserProfileManager();
      expect(manager.profileDir).toContain('browser_profiles');
      expect(manager.currentProfile).toBeNull();
    });

    it('should initialize with custom profile directory', () => {
      const customDir = '/custom/profiles';
      const manager = new BrowserProfileManager(customDir, mockLogger);
      expect(manager.profileDir).toBe(customDir);
    });

    it('should create profile directory if it does not exist', () => {
      // Mock fs.existsSync to return false for the test directory to ensure it gets created
      fs.existsSync.mockImplementation(filePath => {
        return filePath !== testProfileDir;
      });

      // Create a new instance to trigger directory creation
      const manager = new BrowserProfileManager(testProfileDir, mockLogger);

      expect(fs.mkdirSync).toHaveBeenCalledWith(testProfileDir, { recursive: true });
    });

    it('should log initialization', () => {
      expect(mockLogger.info).toHaveBeenCalledWith(
        'BrowserProfileManager initialized',
        expect.objectContaining({
          profileDir: testProfileDir,
        })
      );
    });
  });

  describe('createOrLoadProfile', () => {
    it('should create a new profile with valid ID', async () => {
      const profileId = 'test-profile';
      const profile = await profileManager.createOrLoadProfile(profileId);

      expect(profile).toEqual({
        id: profileId,
        path: path.join(testProfileDir, profileId),
        userDataDir: path.join(testProfileDir, profileId, 'user_data'),
        cookies: path.join(testProfileDir, profileId, 'cookies.json'),
        localStorage: path.join(testProfileDir, profileId, 'localStorage.json'),
        sessionStorage: path.join(testProfileDir, profileId, 'sessionStorage.json'),
        preferences: path.join(testProfileDir, profileId, 'preferences.json'),
        metadata: path.join(testProfileDir, profileId, 'metadata.json'),
        meta: expect.objectContaining({
          created: expect.any(String),
          lastUsed: expect.any(String),
          sessionCount: expect.any(Number),
          version: '1.0.0',
        }),
      });

      expect(profileManager.currentProfile).toBe(profile);
    });

    it('should create profile directories', async () => {
      const profileId = 'test-profile';
      await profileManager.createOrLoadProfile(profileId);

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join(testProfileDir, profileId), { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join(testProfileDir, profileId, 'user_data'), { recursive: true });
    });

    it('should load existing profile metadata', async () => {
      // Mock existing metadata file
      fs.existsSync.mockImplementation(filePath => {
        return filePath.includes('metadata.json');
      });

      const profileId = 'existing-profile';
      const profile = await profileManager.createOrLoadProfile(profileId);

      expect(profile.meta).toEqual({
        created: '2024-01-01T00:00:00.000Z',
        lastUsed: '2024-01-01T12:00:00.000Z',
        sessionCount: 5,
        version: '1.0.0',
      });
    });

    it('should throw error for invalid profile ID - empty string', async () => {
      await expect(profileManager.createOrLoadProfile('')).rejects.toThrow('Profile ID must be a non-empty string');
    });

    it('should throw error for invalid profile ID - non-string', async () => {
      await expect(profileManager.createOrLoadProfile(123)).rejects.toThrow('Profile ID must be a non-empty string');
    });

    it('should throw error for invalid profile ID - null', async () => {
      await expect(profileManager.createOrLoadProfile(null)).rejects.toThrow('Profile ID must be a non-empty string');
    });

    it('should log profile creation/loading', async () => {
      const profileId = 'test-profile';
      await profileManager.createOrLoadProfile(profileId);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Profile created/loaded',
        expect.objectContaining({
          profileId,
          profilePath: path.join(testProfileDir, profileId),
          exists: false,
        })
      );
    });
  });

  describe('getBrowserLaunchOptions', () => {
    beforeEach(async () => {
      await profileManager.createOrLoadProfile('test-profile');
    });

    it('should return browser launch options without userDataDir', async () => {
      const userAgent = 'Mozilla/5.0 Test Browser';
      const options = await profileManager.getBrowserLaunchOptions(userAgent);

      expect(options).toEqual({
        headless: false,
        args: expect.arrayContaining([
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          `--user-agent=${userAgent}`,
        ]),
        ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=AutomationControlled'],
      });

      // Ensure userDataDir is NOT included (for browserType.launch compatibility)
      expect(options).not.toHaveProperty('userDataDir');
    });

    it('should merge additional options', async () => {
      const userAgent = 'Test Browser';
      const additionalOptions = {
        devtools: true,
        slowMo: 100,
      };

      const options = await profileManager.getBrowserLaunchOptions(userAgent, additionalOptions);

      expect(options.devtools).toBe(true);
      expect(options.slowMo).toBe(100);
    });

    it('should throw error if no profile loaded', async () => {
      const manager = new BrowserProfileManager();
      await expect(manager.getBrowserLaunchOptions('test-agent')).rejects.toThrow(
        'No profile loaded. Call createOrLoadProfile first.'
      );
    });

    it('should log debug information', async () => {
      const userAgent = 'Test Browser';
      await profileManager.getBrowserLaunchOptions(userAgent);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Browser launch options prepared',
        expect.objectContaining({
          profileId: 'test-profile',
          userAgent,
          headless: false,
        })
      );
    });
  });

  describe('getPersistentContextOptions', () => {
    beforeEach(async () => {
      await profileManager.createOrLoadProfile('test-profile');
    });

    it('should return persistent context options with userDataDir', async () => {
      const userAgent = 'Mozilla/5.0 Test Browser';
      const options = await profileManager.getPersistentContextOptions(userAgent);

      expect(options).toEqual({
        userDataDir: expect.stringContaining('user_data'),
        contextOptions: expect.objectContaining({
          userAgent,
          viewport: null,
          locale: 'en-US',
          colorScheme: 'light',
          geolocation: { longitude: -74.006, latitude: 40.7128 },
          permissions: ['geolocation'],
          extraHTTPHeaders: expect.objectContaining({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
          }),
        }),
        launchOptions: expect.objectContaining({
          headless: false,
          args: expect.arrayContaining(['--disable-blink-features=AutomationControlled', `--user-agent=${userAgent}`]),
          ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=AutomationControlled'],
        }),
      });
    });

    it('should merge additional context options', async () => {
      const userAgent = 'Test Browser';
      const additionalOptions = {
        timezone: 'America/New_York',
        viewport: { width: 1920, height: 1080 },
      };

      const options = await profileManager.getPersistentContextOptions(userAgent, additionalOptions);

      expect(options.contextOptions.timezone).toBe('America/New_York');
      expect(options.contextOptions.viewport).toEqual({ width: 1920, height: 1080 });
    });

    it('should throw error if no profile loaded', async () => {
      const manager = new BrowserProfileManager();
      await expect(manager.getPersistentContextOptions('test-agent')).rejects.toThrow(
        'No profile loaded. Call createOrLoadProfile first.'
      );
    });

    it('should log debug information', async () => {
      const userAgent = 'Test Browser';
      await profileManager.getPersistentContextOptions(userAgent);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Persistent context options prepared',
        expect.objectContaining({
          profileId: 'test-profile',
          userAgent,
          userDataDir: expect.stringContaining('user_data'),
          headless: false,
        })
      );
    });
  });

  describe('saveSession', () => {
    beforeEach(async () => {
      await profileManager.createOrLoadProfile('test-profile');
    });

    it('should save complete browser session', async () => {
      await profileManager.saveSession(mockPage);

      // Verify cookies were saved
      expect(mockPage.context).toHaveBeenCalled();
      expect(mockContext.cookies).toHaveBeenCalled();
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('cookies.json'),
        expect.stringContaining('test-cookie'),
        'utf8'
      );

      // Verify localStorage was saved
      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('localStorage.json'),
        expect.any(String),
        'utf8'
      );

      // Verify sessionStorage was saved
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('sessionStorage.json'),
        expect.any(String),
        'utf8'
      );

      // Verify metadata was updated
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('metadata.json'),
        expect.any(String),
        'utf8'
      );
    });

    it('should handle cookie save errors', async () => {
      mockContext.cookies.mockRejectedValue(new Error('Cookie save failed'));

      await expect(profileManager.saveSession(mockPage)).rejects.toThrow('Cookie save failed');
    });

    it('should handle localStorage save errors', async () => {
      mockPage.evaluate.mockImplementation(fn => {
        if (fn.toString().includes('localStorage')) {
          throw new Error('localStorage access failed');
        }
        return Promise.resolve({});
      });

      await expect(profileManager.saveSession(mockPage)).rejects.toThrow('localStorage access failed');
    });

    it('should throw error if no profile loaded', async () => {
      const manager = new BrowserProfileManager();
      await expect(manager.saveSession(mockPage)).rejects.toThrow('No profile loaded');
    });

    it('should use enhanced logger operation tracking', async () => {
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      await profileManager.saveSession(mockPage);

      expect(mockLogger.startOperation).toHaveBeenCalledWith('saveSession', {
        profileId: 'test-profile',
      });
      expect(mockOperation.progress).toHaveBeenCalledWith('Saving cookies');
      expect(mockOperation.progress).toHaveBeenCalledWith('Saving localStorage');
      expect(mockOperation.progress).toHaveBeenCalledWith('Saving sessionStorage');
      expect(mockOperation.progress).toHaveBeenCalledWith('Updating metadata');
      expect(mockOperation.success).toHaveBeenCalledWith('Browser session saved successfully');
    });
  });

  describe('restoreSession', () => {
    beforeEach(async () => {
      await profileManager.createOrLoadProfile('test-profile');
      // Mock existing files
      fs.existsSync.mockReturnValue(true);
    });

    it('should restore complete browser session', async () => {
      await profileManager.restoreSession(mockPage);

      // Verify cookies were restored
      expect(fs.promises.readFile).toHaveBeenCalledWith(expect.stringContaining('cookies.json'), 'utf8');
      expect(mockContext.addCookies).toHaveBeenCalledWith([
        { name: 'restored-cookie', value: 'restored-value', domain: 'example.com' },
      ]);

      // Verify localStorage was restored
      expect(fs.promises.readFile).toHaveBeenCalledWith(expect.stringContaining('localStorage.json'), 'utf8');
      expect(mockPage.evaluate).toHaveBeenCalled();

      // Verify sessionStorage was restored
      expect(fs.promises.readFile).toHaveBeenCalledWith(expect.stringContaining('sessionStorage.json'), 'utf8');
    });

    it('should skip restore if files do not exist', async () => {
      fs.existsSync.mockReturnValue(false);

      await profileManager.restoreSession(mockPage);

      // Should not attempt to read non-existent files
      expect(fs.promises.readFile).not.toHaveBeenCalled();
      expect(mockContext.addCookies).not.toHaveBeenCalled();
    });

    it('should handle cookie restore errors gracefully', async () => {
      fs.promises.readFile.mockImplementation(filePath => {
        if (filePath.includes('cookies.json')) {
          return Promise.reject(new Error('Cookie read failed'));
        }
        return Promise.resolve('{}');
      });

      // Should not throw error - cookie restore failure shouldn't break session restore
      await expect(profileManager.restoreSession(mockPage)).resolves.not.toThrow();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to restore cookies',
        expect.objectContaining({
          error: 'Cookie read failed',
        })
      );
    });

    it('should handle localStorage restore errors gracefully', async () => {
      fs.promises.readFile.mockImplementation(filePath => {
        if (filePath.includes('localStorage.json')) {
          return Promise.reject(new Error('localStorage read failed'));
        }
        if (filePath.includes('cookies.json')) {
          return Promise.resolve('[]');
        }
        return Promise.resolve('{}');
      });

      await expect(profileManager.restoreSession(mockPage)).resolves.not.toThrow();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to restore localStorage',
        expect.objectContaining({
          error: 'localStorage read failed',
        })
      );
    });

    it('should throw error if no profile loaded', async () => {
      const manager = new BrowserProfileManager();
      await expect(manager.restoreSession(mockPage)).rejects.toThrow('No profile loaded');
    });

    it('should use enhanced logger operation tracking', async () => {
      const mockOperation = {
        progress: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
      };
      mockLogger.startOperation.mockReturnValue(mockOperation);

      await profileManager.restoreSession(mockPage);

      expect(mockLogger.startOperation).toHaveBeenCalledWith('restoreSession', {
        profileId: 'test-profile',
      });
      expect(mockOperation.progress).toHaveBeenCalledWith('Restoring cookies');
      expect(mockOperation.progress).toHaveBeenCalledWith('Restoring localStorage');
      expect(mockOperation.progress).toHaveBeenCalledWith('Restoring sessionStorage');
      expect(mockOperation.success).toHaveBeenCalledWith('Browser session restored successfully');
    });
  });

  describe('localStorage Operations', () => {
    beforeEach(async () => {
      await profileManager.createOrLoadProfile('test-profile');
    });

    it('should save localStorage with proper evaluation', async () => {
      mockPage.evaluate.mockImplementation(fn => {
        if (fn.toString().includes('localStorage')) {
          return Promise.resolve({
            'user-pref': 'dark-mode',
            'session-token': 'abc123',
            'cache-key': JSON.stringify({ data: 'test' }),
          });
        }
        return Promise.resolve({});
      });

      await profileManager.saveLocalStorage(mockPage);

      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function));
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('localStorage.json'),
        JSON.stringify(
          {
            'user-pref': 'dark-mode',
            'session-token': 'abc123',
            'cache-key': JSON.stringify({ data: 'test' }),
          },
          null,
          2
        ),
        'utf8'
      );
    });

    it('should restore localStorage with proper page evaluation', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockImplementation(filePath => {
        if (filePath.includes('localStorage.json')) {
          return Promise.resolve(
            JSON.stringify({
              'restored-pref': 'light-mode',
              'restored-token': 'xyz789',
            })
          );
        }
        return Promise.resolve('{}');
      });

      const evaluateMock = jest.fn();
      mockPage.evaluate.mockImplementation(evaluateMock);

      await profileManager.restoreLocalStorage(mockPage);

      expect(evaluateMock).toHaveBeenCalledWith(expect.any(Function), {
        'restored-pref': 'light-mode',
        'restored-token': 'xyz789',
      });
    });

    it('should handle localStorage evaluation errors', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Evaluation failed'));

      await expect(profileManager.saveLocalStorage(mockPage)).rejects.toThrow('Evaluation failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to save localStorage',
        expect.objectContaining({
          error: 'Evaluation failed',
        })
      );
    });
  });

  describe('sessionStorage Operations', () => {
    beforeEach(async () => {
      await profileManager.createOrLoadProfile('test-profile');
    });

    it('should save sessionStorage correctly', async () => {
      mockPage.evaluate.mockImplementation(fn => {
        if (fn.toString().includes('sessionStorage')) {
          return Promise.resolve({
            'temp-data': 'session-value',
            'form-state': JSON.stringify({ field1: 'value1' }),
          });
        }
        return Promise.resolve({});
      });

      await profileManager.saveSessionStorage(mockPage);

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('sessionStorage.json'),
        JSON.stringify(
          {
            'temp-data': 'session-value',
            'form-state': JSON.stringify({ field1: 'value1' }),
          },
          null,
          2
        ),
        'utf8'
      );
    });

    it('should restore sessionStorage correctly', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockImplementation(filePath => {
        if (filePath.includes('sessionStorage.json')) {
          return Promise.resolve(
            JSON.stringify({
              'restored-session': 'session-data',
            })
          );
        }
        return Promise.resolve('{}');
      });

      await profileManager.restoreSessionStorage(mockPage);

      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), { 'restored-session': 'session-data' });
    });
  });

  describe('Metadata Management', () => {
    beforeEach(async () => {
      await profileManager.createOrLoadProfile('test-profile');
    });

    it('should create new metadata for new profile', async () => {
      const profile = profileManager.getCurrentProfile();

      expect(profile.meta).toEqual({
        created: expect.any(String),
        lastUsed: expect.any(String),
        sessionCount: expect.any(Number),
        version: '1.0.0',
      });

      // Verify dates are valid ISO strings
      expect(new Date(profile.meta.created).toISOString()).toBe(profile.meta.created);
      expect(new Date(profile.meta.lastUsed).toISOString()).toBe(profile.meta.lastUsed);
    });

    it('should load existing metadata', async () => {
      fs.existsSync.mockImplementation(filePath => {
        return filePath.includes('metadata.json');
      });

      const manager = new BrowserProfileManager(testProfileDir, mockLogger);
      await manager.createOrLoadProfile('existing-profile');

      const profile = manager.getCurrentProfile();
      expect(profile.meta).toEqual({
        created: '2024-01-01T00:00:00.000Z',
        lastUsed: '2024-01-01T12:00:00.000Z',
        sessionCount: 5,
        version: '1.0.0',
      });
    });

    it('should update metadata on session save', async () => {
      const initialSessionCount = profileManager.currentProfile.meta.sessionCount;

      await profileManager.updateMetadata();

      expect(profileManager.currentProfile.meta.sessionCount).toBe(initialSessionCount + 1);
      expect(profileManager.currentProfile.meta.lastUsed).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should handle metadata read errors gracefully', async () => {
      // Create a new manager to test the error handling during profile creation
      const newLoggerMocks = createEnhancedLoggerMocks();
      const newMockLogger = newLoggerMocks.logger;

      // Override fs.existsSync to simulate metadata file existing (to trigger read attempt)
      fs.existsSync.mockImplementation(filePath => {
        return filePath.includes('metadata.json');
      });

      // Override fs.promises.readFile to simulate read error
      fs.promises.readFile.mockImplementation(filePath => {
        if (filePath.includes('metadata.json')) {
          return Promise.reject(new Error('Metadata read failed'));
        }
        return Promise.resolve('{}');
      });

      const manager = new BrowserProfileManager(testProfileDir, newMockLogger);
      await manager.createOrLoadProfile('error-profile');

      const profile = manager.getCurrentProfile();
      expect(profile.meta).toEqual({
        created: expect.any(String),
        lastUsed: expect.any(String),
        sessionCount: expect.any(Number),
        version: '1.0.0',
      });

      expect(newMockLogger.warn).toHaveBeenCalledWith(
        'Failed to load metadata, creating new',
        expect.objectContaining({
          error: 'Metadata read failed',
        })
      );
    });

    it('should handle metadata write errors', async () => {
      fs.promises.writeFile.mockImplementation((filePath, data) => {
        if (filePath.includes('metadata.json')) {
          return Promise.reject(new Error('Metadata write failed'));
        }
        return Promise.resolve();
      });

      await profileManager.updateMetadata();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to update metadata',
        expect.objectContaining({
          error: 'Metadata write failed',
        })
      );
    });
  });

  describe('Profile Management', () => {
    it('should check if profile exists', async () => {
      // Temporarily override the mock for this test
      fs.existsSync.mockImplementation(filePath => {
        const pathSegments = filePath.split(path.sep);
        const lastSegment = pathSegments[pathSegments.length - 1];
        return lastSegment === 'existing-profile';
      });

      const exists = await profileManager.profileExists('existing-profile');
      const notExists = await profileManager.profileExists('non-existing-profile');

      expect(exists).toBe(true);
      expect(notExists).toBe(false);
    });

    it('should list all profiles', async () => {
      // Override fs.existsSync to simulate metadata files existing
      fs.existsSync.mockImplementation(filePath => {
        return filePath.includes('metadata.json');
      });

      const profiles = await profileManager.listProfiles();

      expect(profiles).toHaveLength(2);
      expect(profiles[0]).toEqual({
        id: 'profile1',
        created: '2024-01-01T00:00:00.000Z',
        lastUsed: '2024-01-01T12:00:00.000Z',
        sessionCount: 5,
        version: '1.0.0',
      });
      expect(profiles[1]).toEqual({
        id: 'profile2',
        created: '2024-01-01T00:00:00.000Z',
        lastUsed: '2024-01-01T12:00:00.000Z',
        sessionCount: 5,
        version: '1.0.0',
      });
    });

    it('should list profiles with default metadata when metadata file is missing', async () => {
      fs.existsSync.mockImplementation(filePath => {
        return !filePath.includes('metadata.json');
      });

      const profiles = await profileManager.listProfiles();

      expect(profiles).toHaveLength(2);
      expect(profiles[0]).toEqual({
        id: 'profile1',
        created: 'Unknown',
        lastUsed: 'Unknown',
        sessionCount: 0,
      });
    });

    it('should handle profile listing errors', async () => {
      fs.promises.readdir.mockRejectedValue(new Error('Directory read failed'));

      const profiles = await profileManager.listProfiles();

      expect(profiles).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to list profiles',
        expect.objectContaining({
          error: 'Directory read failed',
        })
      );
    });

    it('should delete existing profile', async () => {
      fs.existsSync.mockReturnValue(true);

      await profileManager.deleteProfile('test-profile');

      expect(fs.promises.rm).toHaveBeenCalledWith(path.join(testProfileDir, 'test-profile'), {
        recursive: true,
        force: true,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Profile deleted',
        expect.objectContaining({
          profileId: 'test-profile',
        })
      );
    });

    it('should throw error when deleting non-existent profile', async () => {
      fs.existsSync.mockReturnValue(false);

      await expect(profileManager.deleteProfile('non-existent')).rejects.toThrow(
        'Profile does not exist: non-existent'
      );
    });

    it('should handle profile deletion errors', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.promises.rm.mockRejectedValue(new Error('Delete failed'));

      await expect(profileManager.deleteProfile('test-profile')).rejects.toThrow('Delete failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to delete profile',
        expect.objectContaining({
          profileId: 'test-profile',
          error: 'Delete failed',
        })
      );
    });

    it('should return current profile', async () => {
      expect(profileManager.getCurrentProfile()).toBeNull();

      const profile = await profileManager.createOrLoadProfile('test-profile');
      expect(profileManager.getCurrentProfile()).toBe(profile);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    beforeEach(async () => {
      await profileManager.createOrLoadProfile('test-profile');
    });

    it('should handle file system permission errors', async () => {
      fs.promises.writeFile.mockRejectedValue(new Error('EACCES: permission denied'));

      await expect(profileManager.saveSession(mockPage)).rejects.toThrow('EACCES: permission denied');
    });

    it('should handle malformed JSON in storage files', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockImplementation(filePath => {
        if (filePath.includes('cookies.json')) {
          return Promise.resolve('invalid json');
        }
        return Promise.resolve('{}');
      });

      // Should handle JSON parse errors gracefully
      await expect(profileManager.restoreSession(mockPage)).resolves.not.toThrow();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to restore cookies',
        expect.objectContaining({
          error: expect.stringContaining('Unexpected token'),
        })
      );
    });

    it('should handle browser context errors during save', async () => {
      mockContext.cookies.mockRejectedValue(new Error('Context destroyed'));

      await expect(profileManager.saveSession(mockPage)).rejects.toThrow('Context destroyed');
    });

    it('should handle page evaluation errors during storage operations', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Page context invalidated'));

      await expect(profileManager.saveSession(mockPage)).rejects.toThrow('Page context invalidated');
    });

    it('should handle empty or null storage data', async () => {
      mockContext.cookies.mockResolvedValue([]);
      mockPage.evaluate.mockResolvedValue({});

      await expect(profileManager.saveSession(mockPage)).resolves.not.toThrow();

      // Verify empty data is still saved
      expect(fs.promises.writeFile).toHaveBeenCalledWith(expect.stringContaining('cookies.json'), '[]', 'utf8');
    });

    it('should handle profile directory creation failures', async () => {
      // Mock fs.existsSync to return false to trigger directory creation
      fs.existsSync.mockImplementation(() => false);
      fs.mkdirSync.mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      expect(() => new BrowserProfileManager('/invalid/path', mockLogger)).toThrow('ENOSPC: no space left on device');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete profile lifecycle', async () => {
      // Create profile
      const profile = await profileManager.createOrLoadProfile('lifecycle-test');
      expect(profile.id).toBe('lifecycle-test');

      // Save session data
      await profileManager.saveSession(mockPage);

      // Simulate restart - create new manager instance
      const newManager = new BrowserProfileManager(testProfileDir, mockLogger);
      await newManager.createOrLoadProfile('lifecycle-test');

      // Restore session data
      fs.existsSync.mockReturnValue(true);
      await newManager.restoreSession(mockPage);

      expect(mockContext.addCookies).toHaveBeenCalledWith([
        { name: 'restored-cookie', value: 'restored-value', domain: 'example.com' },
      ]);
    });

    it('should handle concurrent profile operations', async () => {
      const promises = [
        profileManager.createOrLoadProfile('profile-1'),
        profileManager.createOrLoadProfile('profile-2'),
        profileManager.createOrLoadProfile('profile-3'),
      ];

      // All should complete without errors
      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it('should handle profile switching', async () => {
      // Create first profile
      const profile1 = await profileManager.createOrLoadProfile('profile-1');
      expect(profileManager.getCurrentProfile()).toBe(profile1);

      // Switch to second profile
      const profile2 = await profileManager.createOrLoadProfile('profile-2');
      expect(profileManager.getCurrentProfile()).toBe(profile2);
      expect(profileManager.getCurrentProfile()).not.toBe(profile1);
    });
  });

  describe('Performance Considerations', () => {
    beforeEach(async () => {
      await profileManager.createOrLoadProfile('performance-test');
    });

    it('should handle large storage data efficiently', async () => {
      const largeStorageData = {};
      for (let i = 0; i < 1000; i++) {
        largeStorageData[`key-${i}`] = `value-${i}`.repeat(100);
      }

      mockPage.evaluate.mockImplementation(fn => {
        if (fn.toString().includes('localStorage')) {
          return Promise.resolve(largeStorageData);
        }
        return Promise.resolve({});
      });

      const startTime = Date.now();
      await profileManager.saveSession(mockPage);
      const endTime = Date.now();

      // Should complete within reasonable time (adjust threshold as needed)
      expect(endTime - startTime).toBeLessThan(5000);
    });

    it('should handle many cookies efficiently', async () => {
      const manyCookies = [];
      for (let i = 0; i < 100; i++) {
        manyCookies.push({
          name: `cookie-${i}`,
          value: `value-${i}`,
          domain: `domain-${i}.com`,
        });
      }

      mockContext.cookies.mockResolvedValue(manyCookies);

      await expect(profileManager.saveSession(mockPage)).resolves.not.toThrow();
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('cookies.json'),
        expect.stringContaining('cookie-99'),
        'utf8'
      );
    });
  });
});
