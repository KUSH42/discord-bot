import { jest } from '@jest/globals';

// Mock fs at the top level
const mockFs = {
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
};

const mockNowUTC = jest.fn();

// Mock modules before importing anything
jest.doMock('fs', () => mockFs);
jest.doMock('../../../src/utilities/utc-time.js', () => ({
  nowUTC: mockNowUTC,
}));

// Import after mocking
const { CrashDetector } = await import('../../../src/utilities/crash-detector.js');

describe('CrashDetector', () => {
  let crashDetector;
  let mockLogger;
  let originalProcessOn;
  let processEventHandlers;

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Mock UTC time
    mockNowUTC.mockReturnValue('2025-01-01T12:00:00.000Z');

    // Mock process event handlers
    processEventHandlers = {};
    originalProcessOn = process.on;
    process.on = jest.fn((event, handler) => {
      processEventHandlers[event] = handler;
      return process;
    });

    // Mock file system
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('[]');
    mockFs.writeFileSync.mockImplementation(() => {});

    // Mock console.error for fallback logging
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Mock process properties
    Object.defineProperty(process, 'pid', { value: 12345, configurable: true });
    Object.defineProperty(process, 'version', { value: 'v18.0.0', configurable: true });
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    process.uptime = jest.fn(() => 3600);
    process.memoryUsage = jest.fn(() => ({
      rss: 50 * 1024 * 1024,
      heapTotal: 40 * 1024 * 1024,
      heapUsed: 30 * 1024 * 1024,
      external: 5 * 1024 * 1024,
      arrayBuffers: 2 * 1024 * 1024,
    }));

    // Mock timers
    jest.useFakeTimers();

    crashDetector = new CrashDetector(mockLogger);
  });

  afterEach(() => {
    // Restore process.on
    process.on = originalProcessOn;

    // Clear all timers
    jest.clearAllTimers();
    jest.useRealTimers();

    // Clear mocks
    jest.clearAllMocks();
    console.error.mockRestore();
  });

  describe('constructor', () => {
    it('should initialize with correct default values', () => {
      expect(crashDetector.logger).toBe(mockLogger);
      expect(crashDetector.crashLogFile).toBe('crash-log.json');
      expect(crashDetector.isSetup).toBe(false);
      expect(crashDetector.heartbeatInterval).toBeNull();
      expect(typeof crashDetector.lastHeartbeat).toBe('number');
    });
  });

  describe('setup', () => {
    it('should set up crash detection handlers', () => {
      crashDetector.setup();

      expect(crashDetector.isSetup).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('🕵️ Setting up comprehensive crash detection system');
      expect(mockLogger.info).toHaveBeenCalledWith('✅ Crash detection system active');

      // Verify all event handlers are registered
      expect(process.on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith('warning', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith('exit', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    });

    it('should not setup twice', () => {
      crashDetector.setup();
      crashDetector.setup();

      // Should only log setup messages once
      expect(mockLogger.info).toHaveBeenCalledTimes(2); // Setup message + active message
    });

    it('should start heartbeat monitoring', () => {
      crashDetector.setup();

      expect(crashDetector.heartbeatInterval).not.toBeNull();
    });
  });

  describe('process event handlers', () => {
    beforeEach(() => {
      crashDetector.setup();
      jest.spyOn(crashDetector, 'logCrash');
    });

    it('should handle unhandledRejection events', () => {
      const testError = new Error('Test rejection');
      const testPromise = Promise.reject(testError);

      processEventHandlers.unhandledRejection(testError, testPromise);

      expect(crashDetector.logCrash).toHaveBeenCalledWith('unhandledRejection', {
        reason: 'Test rejection',
        stack: testError.stack,
        promise: testPromise.toString(),
        timestamp: expect.any(String),
      });
    });

    it('should handle unhandledRejection with non-error reasons', () => {
      const testReason = 'Simple string rejection';
      const testPromise = Promise.reject(testReason);

      processEventHandlers.unhandledRejection(testReason, testPromise);

      expect(crashDetector.logCrash).toHaveBeenCalledWith('unhandledRejection', {
        reason: 'Simple string rejection',
        stack: undefined,
        promise: testPromise.toString(),
        timestamp: expect.any(String),
      });
    });

    it('should handle uncaughtException events', () => {
      const testError = new Error('Test exception');

      processEventHandlers.uncaughtException(testError);

      expect(crashDetector.logCrash).toHaveBeenCalledWith('uncaughtException', {
        error: 'Test exception',
        stack: testError.stack,
        timestamp: expect.any(String),
      });
    });

    it('should handle warning events', () => {
      const testWarning = {
        name: 'DeprecationWarning',
        message: 'Test warning message',
        stack: 'Warning stack trace',
      };

      processEventHandlers.warning(testWarning);

      expect(crashDetector.logCrash).toHaveBeenCalledWith('processWarning', {
        name: 'DeprecationWarning',
        message: 'Test warning message',
        stack: 'Warning stack trace',
        timestamp: expect.any(String),
      });
    });

    it('should handle low-memory messages', () => {
      const mockMemoryUsage = {
        rss: 100 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        heapUsed: 70 * 1024 * 1024,
        external: 10 * 1024 * 1024,
      };
      process.memoryUsage.mockReturnValue(mockMemoryUsage);

      processEventHandlers.message('low-memory');

      expect(crashDetector.logCrash).toHaveBeenCalledWith('lowMemory', {
        memoryUsage: mockMemoryUsage,
        timestamp: expect.any(String),
      });
    });

    it('should ignore non-low-memory messages', () => {
      processEventHandlers.message('other-message');

      expect(crashDetector.logCrash).not.toHaveBeenCalled();
    });

    it('should handle exit events', () => {
      processEventHandlers.exit(0);

      expect(crashDetector.logCrash).toHaveBeenCalledWith('processExit', {
        exitCode: 0,
        timestamp: expect.any(String),
        lastHeartbeat: expect.any(String),
      });
    });

    it('should handle SIGTERM events', () => {
      const mockMemoryUsage = { rss: 50 * 1024 * 1024, heapUsed: 30 * 1024 * 1024 };
      process.memoryUsage.mockReturnValue(mockMemoryUsage);

      processEventHandlers.SIGTERM();

      expect(crashDetector.logCrash).toHaveBeenCalledWith('SIGTERM', {
        timestamp: expect.any(String),
        memoryUsage: mockMemoryUsage,
      });
    });

    it('should handle SIGINT events', () => {
      const mockMemoryUsage = { rss: 50 * 1024 * 1024, heapUsed: 30 * 1024 * 1024 };
      process.memoryUsage.mockReturnValue(mockMemoryUsage);

      processEventHandlers.SIGINT();

      expect(crashDetector.logCrash).toHaveBeenCalledWith('SIGINT', {
        timestamp: expect.any(String),
        memoryUsage: mockMemoryUsage,
      });
    });
  });

  describe('startHeartbeat', () => {
    beforeEach(() => {
      jest.spyOn(crashDetector, 'logCrash');
    });

    it('should update lastHeartbeat periodically', () => {
      const initialHeartbeat = crashDetector.lastHeartbeat;

      crashDetector.startHeartbeat();

      // Fast forward time
      jest.advanceTimersByTime(30000);

      expect(crashDetector.lastHeartbeat).toBeGreaterThan(initialHeartbeat);
    });

    it('should log high memory usage warnings', () => {
      // Mock high memory usage (over 2GB)
      process.memoryUsage.mockReturnValue({
        rss: 3000 * 1024 * 1024,
        heapTotal: 2500 * 1024 * 1024,
        heapUsed: 2200 * 1024 * 1024, // Over 2GB
        external: 100 * 1024 * 1024,
      });

      crashDetector.startHeartbeat();

      // Trigger heartbeat
      jest.advanceTimersByTime(30000);

      expect(mockLogger.warn).toHaveBeenCalledWith('🚨 High memory usage detected', {
        heapUsedMB: 2200,
        memoryUsage: expect.any(Object),
        timestamp: expect.any(String),
      });

      expect(crashDetector.logCrash).toHaveBeenCalledWith('highMemoryUsage', {
        heapUsedMB: 2200,
        memoryUsage: expect.any(Object),
        timestamp: expect.any(String),
      });
    });

    it('should not log normal memory usage', () => {
      // Mock normal memory usage (under 2GB)
      process.memoryUsage.mockReturnValue({
        rss: 500 * 1024 * 1024,
        heapUsed: 400 * 1024 * 1024, // Under 2GB
      });

      crashDetector.startHeartbeat();

      // Trigger heartbeat
      jest.advanceTimersByTime(30000);

      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(crashDetector.logCrash).not.toHaveBeenCalled();
    });
  });

  describe('logCrash', () => {
    const testCrashDetails = {
      error: 'Test error message',
    };

    it('should log crash to logger and file', () => {
      crashDetector.logCrash('testCrash', testCrashDetails);

      // Should log to Winston logger
      expect(mockLogger.error).toHaveBeenCalledWith('💥 CRASH DETECTED: testCrash', {
        type: 'testCrash',
        details: testCrashDetails,
        timestamp: expect.any(String),
        pid: 12345,
        nodeVersion: 'v18.0.0',
        platform: 'linux',
        arch: 'x64',
        uptime: 3600,
        memoryUsage: expect.any(Object),
      });

      // Should write to file
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        'crash-log.json',
        expect.stringContaining('"type":"testCrash"')
      );
    });

    it('should handle logger failures gracefully', () => {
      mockLogger.error.mockImplementation(() => {
        throw new Error('Logger failed');
      });

      crashDetector.logCrash('testCrash', testCrashDetails);

      // Should fallback to console.error
      expect(console.error).toHaveBeenCalledWith(
        '💥 CRASH DETECTED (logger failed):',
        expect.stringContaining('"type":"testCrash"')
      );
    });

    it('should append to existing crash log file', () => {
      const existingCrashes = [{ type: 'oldCrash', timestamp: '2025-01-01T11:00:00.000Z' }];
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingCrashes));

      crashDetector.logCrash('newCrash', testCrashDetails);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenData = JSON.parse(writeCall[1]);

      expect(writtenData).toHaveLength(2);
      expect(writtenData[0].type).toBe('oldCrash');
      expect(writtenData[1].type).toBe('newCrash');
    });

    it('should limit crash log to 100 entries', () => {
      // Create 101 existing crashes
      const existingCrashes = Array.from({ length: 101 }, (_, i) => ({
        type: `crash${i}`,
        timestamp: `2025-01-01T${String(i).padStart(2, '0')}:00:00.000Z`,
      }));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingCrashes));

      crashDetector.logCrash('newCrash', testCrashDetails);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenData = JSON.parse(writeCall[1]);

      expect(writtenData).toHaveLength(100);
      expect(writtenData[0].type).toBe('crash2'); // First entry removed
      expect(writtenData[99].type).toBe('newCrash'); // New entry added
    });

    it('should handle file write errors gracefully', () => {
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('File write failed');
      });

      crashDetector.logCrash('testCrash', testCrashDetails);

      expect(console.error).toHaveBeenCalledWith('Failed to write crash log to file:', expect.any(Error));
    });

    it('should handle corrupted crash log file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      // Should not throw error, should continue with empty array
      expect(() => {
        crashDetector.logCrash('testCrash', testCrashDetails);
      }).not.toThrow();

      expect(console.error).toHaveBeenCalledWith('Failed to write crash log to file:', expect.any(Error));
    });
  });

  describe('getRecentCrashes', () => {
    it('should return empty array when no crash log exists', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = crashDetector.getRecentCrashes();

      expect(result).toEqual([]);
    });

    it('should return recent crashes from file', () => {
      const crashes = [
        { type: 'crash1', timestamp: '2025-01-01T10:00:00.000Z' },
        { type: 'crash2', timestamp: '2025-01-01T11:00:00.000Z' },
        { type: 'crash3', timestamp: '2025-01-01T12:00:00.000Z' },
      ];
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(crashes));

      const result = crashDetector.getRecentCrashes();

      expect(result).toEqual(crashes);
    });

    it('should limit returned crashes by count parameter', () => {
      const crashes = Array.from({ length: 20 }, (_, i) => ({
        type: `crash${i}`,
        timestamp: `2025-01-01T${String(i).padStart(2, '0')}:00:00.000Z`,
      }));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(crashes));

      const result = crashDetector.getRecentCrashes(5);

      expect(result).toHaveLength(5);
      expect(result[0].type).toBe('crash15'); // Last 5 entries
      expect(result[4].type).toBe('crash19');
    });

    it('should handle file read errors gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('File read failed');
      });

      const result = crashDetector.getRecentCrashes();

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to read crash log:', expect.any(Error));
    });

    it('should handle corrupted crash log file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      const result = crashDetector.getRecentCrashes();

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to read crash log:', expect.any(Error));
    });
  });

  describe('stop', () => {
    it('should clear heartbeat interval and log stop message', () => {
      crashDetector.setup();
      const intervalId = crashDetector.heartbeatInterval;

      crashDetector.stop();

      expect(crashDetector.heartbeatInterval).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith('🛑 Crash detection system stopped');
    });

    it('should handle case when no interval is running', () => {
      crashDetector.heartbeatInterval = null;

      expect(() => {
        crashDetector.stop();
      }).not.toThrow();

      expect(mockLogger.info).toHaveBeenCalledWith('🛑 Crash detection system stopped');
    });
  });

  describe('edge cases and error scenarios', () => {
    it('should handle setup being called multiple times safely', () => {
      crashDetector.setup();
      crashDetector.setup();
      crashDetector.setup();

      expect(crashDetector.isSetup).toBe(true);
      // Should only register event handlers once
      expect(process.on).toHaveBeenCalledTimes(7); // 7 different events
    });

    it('should handle process properties being undefined', () => {
      // Mock undefined process properties
      Object.defineProperty(process, 'pid', { value: undefined, configurable: true });
      Object.defineProperty(process, 'version', { value: undefined, configurable: true });
      process.uptime.mockReturnValue(undefined);
      process.memoryUsage.mockReturnValue(undefined);

      expect(() => {
        crashDetector.logCrash('testCrash', { test: 'data' });
      }).not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith('💥 CRASH DETECTED: testCrash', {
        type: 'testCrash',
        details: { test: 'data' },
        timestamp: '2025-01-01T12:00:00.000Z',
        pid: undefined,
        nodeVersion: undefined,
        platform: 'linux',
        arch: 'x64',
        uptime: undefined,
        memoryUsage: undefined,
      });
    });

    it('should handle Date.now() returning invalid values', () => {
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => NaN);

      crashDetector.startHeartbeat();

      expect(isNaN(crashDetector.lastHeartbeat)).toBe(true);

      // Restore original Date.now
      Date.now = originalDateNow;
    });

    it('should handle filesystem permissions errors', () => {
      mockFs.writeFileSync.mockImplementation(() => {
        const error = new Error('EACCES: permission denied');
        error.code = 'EACCES';
        throw error;
      });

      crashDetector.logCrash('testCrash', { test: 'data' });

      expect(console.error).toHaveBeenCalledWith(
        'Failed to write crash log to file:',
        expect.objectContaining({ code: 'EACCES' })
      );
    });
  });

  describe('integration scenarios', () => {
    it('should work correctly with real timers for heartbeat', async () => {
      jest.useRealTimers();

      crashDetector.setup();

      const initialHeartbeat = crashDetector.lastHeartbeat;

      // Wait for heartbeat to update
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(crashDetector.lastHeartbeat).toBeGreaterThanOrEqual(initialHeartbeat);

      crashDetector.stop();
    });

    it('should handle rapid successive crash events', () => {
      crashDetector.setup();
      jest.spyOn(crashDetector, 'logCrash');

      // Simulate multiple rapid crashes
      for (let i = 0; i < 10; i++) {
        processEventHandlers.uncaughtException(new Error(`Error ${i}`));
      }

      expect(crashDetector.logCrash).toHaveBeenCalledTimes(10);
    });

    it('should maintain crash log integrity under concurrent access', () => {
      // Simulate concurrent crash logging
      const crashes = [];
      mockFs.readFileSync.mockImplementation(() => JSON.stringify(crashes));
      mockFs.writeFileSync.mockImplementation((file, data) => {
        const newCrashes = JSON.parse(data);
        crashes.splice(0, crashes.length, ...newCrashes);
      });

      crashDetector.logCrash('crash1', { data: 'test1' });
      crashDetector.logCrash('crash2', { data: 'test2' });

      expect(crashes).toHaveLength(2);
      expect(crashes[0].type).toBe('crash1');
      expect(crashes[1].type).toBe('crash2');
    });
  });
});
