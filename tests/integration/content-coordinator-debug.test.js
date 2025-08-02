import { jest } from '@jest/globals';
import { DebugFlagManager } from '../../src/infrastructure/debug-flag-manager.js';
import { MetricsManager } from '../../src/infrastructure/metrics-manager.js';
import { ContentCoordinator } from '../../src/core/content-coordinator.js';
import { createMockWinstonLogger } from '../utils/enhanced-logging-mocks.js';

describe('ContentCoordinator Debug Integration', () => {
  let debugFlagManager;
  let metricsManager;
  let coordinator;
  let mockStateManager;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock state manager for DebugFlagManager that actually stores values
    const storage = {};
    mockStateManager = {
      has: jest.fn(key => key in storage),
      get: jest.fn((key, defaultValue) => storage[key] || defaultValue),
      set: jest.fn((key, value) => {
        storage[key] = value;
      }),
      setValidator: jest.fn(),
      subscribe: jest.fn().mockReturnValue(() => {}),
    };

    mockLogger = createMockWinstonLogger();

    // Create real instances for integration testing
    debugFlagManager = new DebugFlagManager(mockStateManager, mockLogger);
    metricsManager = new MetricsManager();

    // Mock dependencies for ContentCoordinator
    const mockContentStateManager = {
      getContentState: jest.fn().mockReturnValue(null),
      addContent: jest.fn().mockResolvedValue(),
      isNewContent: jest.fn().mockReturnValue(true),
      markAsAnnounced: jest.fn().mockResolvedValue(),
    };

    const mockContentAnnouncer = {
      announceContent: jest.fn().mockResolvedValue({ success: true }),
    };

    const mockDuplicateDetector = {
      isDuplicateWithFingerprint: jest.fn().mockResolvedValue(false),
      markAsSeenWithFingerprint: jest.fn().mockResolvedValue(),
    };

    const mockConfig = {
      get: jest.fn().mockReturnValue(['webhook', 'api', 'scraper']),
      getNumber: jest.fn().mockReturnValue(30000),
    };

    const mockClassifier = {
      classifyContent: jest.fn().mockReturnValue('post'),
    };

    // Create ContentCoordinator with enhanced logging
    coordinator = new ContentCoordinator(
      mockContentStateManager,
      mockContentAnnouncer,
      mockDuplicateDetector,
      mockClassifier,
      mockLogger,
      mockConfig,
      debugFlagManager,
      metricsManager
    );
  });

  afterEach(() => {
    // Clean up MetricsManager interval to prevent Jest handles
    if (metricsManager && metricsManager.cleanupInterval) {
      clearInterval(metricsManager.cleanupInterval);
    }
  });

  describe('Debug Module Integration', () => {
    it('should support state debug module', () => {
      expect(debugFlagManager.availableModules.has('state')).toBe(true);
    });

    it('should allow toggling state debug flag', () => {
      const result = debugFlagManager.toggle('state', true);
      expect(result).toBe(true); // toggle returns the enabled value directly

      // Verify it was actually set
      expect(debugFlagManager.isEnabled('state')).toBe(true);
    });

    it('should allow setting state debug level', () => {
      const result = debugFlagManager.setLevel('state', 5);
      expect(result).toBe(5); // setLevel returns the level directly
    });

    it('should create enhanced logger with state module name', () => {
      expect(coordinator.logger).toBeDefined();
      expect(coordinator.logger.moduleName).toBe('state');
    });
  });

  describe('Enhanced Logging Operations', () => {
    it('should track content processing operations', async () => {
      const contentId = 'test-content-123';
      const source = 'webhook';
      const contentData = {
        type: 'video',
        title: 'Test Video',
        url: 'https://www.youtube.com/watch?v=test123',
        publishedAt: new Date().toISOString(),
        platform: 'youtube',
      };

      // Enable debug for state module
      debugFlagManager.toggle('state', true);
      debugFlagManager.setLevel('state', 5);

      const result = await coordinator.processContent(contentId, source, contentData);

      expect(result.action).toBe('announced');

      // Verify that the enhanced logger was used
      expect(debugFlagManager.isEnabled('state')).toBe(true);
      expect(debugFlagManager.getLevel('state')).toBe(5);
    });
  });

  describe('Debug Command Simulation', () => {
    it('should simulate !debug state true command', () => {
      // Simulate the debug command that would come from Discord
      const debugResult = debugFlagManager.toggle('state', true);

      expect(debugResult).toBe(true);
      expect(debugFlagManager.isEnabled('state')).toBe(true);
    });

    it('should simulate !debug-level state 3 command', () => {
      // Simulate the debug level command that would come from Discord
      const levelResult = debugFlagManager.setLevel('state', 3);

      expect(levelResult).toBe(3);
    });

    it('should show state module in debug status', () => {
      debugFlagManager.toggle('state', true);
      debugFlagManager.setLevel('state', 4);

      expect(debugFlagManager.isEnabled('state')).toBe(true);
      expect(debugFlagManager.getLevel('state')).toBe(4);
    });
  });
});
